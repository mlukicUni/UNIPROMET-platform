import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import http from 'http';
import https from 'https';
import net from 'net';
import { apiRouter, authRouter } from './routes';
import { getLocalIpAddresses } from './utils/network';
import { isEnabled, publicHost } from './utils/appConfig';
import { migrateLegacyJsonToSqlite } from './db/migrateFromJson';
import { getOrCreateSslCertificate } from './services/sslService';
import { getCurrentUser, getOrRefreshCurrentUser, verifySessionCookie, renewSessionCookie, sessionCookieOptions, COOKIE_NAME } from './services/authService';
import { getCameraCredentials } from './services/cameraLiveService';
import { isUserAllowed, getAccess, hasLevel } from './services/accessService';
import { enforceRouteAccess, checkVideoGatewayAccess } from './services/routeAccess';
import { initRolesSchema, writeAudit } from './db/rolesDb';
import { initMonitoringSchema } from './db/monitoringDb';
import { initAiAgentSchema } from './db/aiAgentDb';
import { initNolekoDocsSchema } from './db/nolekoDocsDb';

// Ensure SQLite database and schema are initialized on startup
migrateLegacyJsonToSqlite();
initRolesSchema();
initMonitoringSchema();
initAiAgentSchema();
initNolekoDocsSchema();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '3443', 10);

/**
 * Resolves abstract video gateway stream names (e.g. src=cam_192_168_124_10_sub)
 * into internal authenticated RTSP URLs for the local go2rtc gateway.
 * This completely shields camera credentials from the browser/frontend!
 */
function resolveGatewayTargetPath(targetUrl: string): string {
  return targetUrl.replace(/src=cam_([0-9_]+)_(main|sub)/g, (_, ipUnder, streamType) => {
    const ip = ipUnder.replace(/_/g, '.');
    const ch = streamType === 'main' ? '101' : '102';
    const { user, pass } = getCameraCredentials(ip);
    const rtsp = `rtsp://${user}:${encodeURIComponent(pass)}@${ip}:554/Streaming/Channels/${ch}`;
    return `src=${encodeURIComponent(rtsp)}`;
  });
}

// Middleware
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Aktivan korisnik: rok sesije se pomera na 7 dana od poslednjeg korišćenja platforme
app.use((req, res, next) => {
  const renewed = renewSessionCookie(req.cookies?.[COOKIE_NAME]);
  if (renewed) {
    req.cookies[COOKIE_NAME] = renewed;
    res.cookie(COOKIE_NAME, renewed, sessionCookieOptions(req));
  }
  next();
});

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.url.startsWith('/css') && !req.url.startsWith('/js') && !req.url.startsWith('/favicon')) {
      console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Top-level Auth Routes for Microsoft Entra ID SSO (/auth/login, /auth/callback, /auth/logout)
app.use('/auth', authRouter);

// Dedicated Login Page
const publicPath = path.join(process.cwd(), 'public');

// Browser tab icon for pages without <link rel="icon"> (PDF, JSON, downloads)
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(publicPath, 'assets', 'favicon.png'));
});

app.get('/login', (req, res) => {
  const user = getCurrentUser(req);
  if (user) {
    if (isUserAllowed(user)) return res.redirect('/');
    return res.redirect('/access-denied');
  }
  res.sendFile(path.join(publicPath, 'login.html'));
});

// Dedicated Access Denied Page (for non-IT Unipromet accounts)
app.get('/access-denied', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.redirect('/login');
  if (isUserAllowed(user)) return res.redirect('/');
  res.sendFile(path.join(publicPath, 'access-denied.html'));
});

// API Access Control Middleware
app.use('/api', (req, res, next) => {
  // Allow auth endpoints and legacy webhook endpoints through without authorization gate
  if (req.path.startsWith('/auth') || req.path.startsWith('/equipment/webhook')) {
    return next();
  }

  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Prijava je obavezna za pristup podacima.',
      requiresLogin: true
    });
  }

  // Seamlessly keep Active Directory groups fresh in background
  getOrRefreshCurrentUser(req, false).catch(() => {});

  if (!isUserAllowed(user)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Nemate dodeljenu nijednu rolu za pristup platformi. Obratite se IT administratoru.',
      requiresRole: true
    });
  }

  next();
});

// Per-route role permission check (route map in services/routeAccess.ts)
app.use('/api', enforceRouteAccess);

// API Routes
app.use('/api', apiRouter);

// Reverse proxy for go2rtc HTTP streams (MP4, MSE, MJPEG, WebRTC SDP)
app.use('/api/video-gateway', (req, res) => {
  const targetPath = resolveGatewayTargetPath(`/api${req.url}`);
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: 1984,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:1984' }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => {
    if (!res.headersSent) res.status(502).send('Video Gateway offline');
  });
  req.pipe(proxyReq);
});

// Static files (CSS, JS, Assets) - index disabled so route guard handles '/'
app.use(express.static(publicPath, {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Dedicated Presentation Routes (/presentation, /prezentacija)
app.get(['/presentation', '/prezentacija'], (req, res) => {
  res.sendFile(path.join(publicPath, 'presentation.html'));
});

// Samostalni prozor jednog monitoring taba (bez menija platforme)
app.get('/monitor', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.redirect('/login');
  if (!isUserAllowed(user)) return res.redirect('/access-denied');
  if (!hasLevel(getAccess(user), 'video.monitoring', 'view')) return res.redirect('/');
  res.sendFile(path.join(publicPath, 'monitor.html'));
});

// HTML Page Route Guard for all other views (/, /cameras, /printers, etc.)
app.get('*', (req, res, next) => {
  if (!req.accepts('html')) return next();

  const user = getCurrentUser(req);

  // 1. Not logged in -> Redirect to Login Page
  if (!user) {
    return res.redirect('/login');
  }

  // 2. Logged in, but no role assigned (and not ITadmin) -> Redirect to Access Denied
  if (!isUserAllowed(user)) {
    return res.redirect('/access-denied');
  }

  // 3. User with at least one role (or ITadmin) -> Serve main admin dashboard
  res.sendFile(path.join(publicPath, 'index.html'));
});

/**
 * WebSocket upgrade requests bypass Express middleware, so the session cookie and
 * per-camera permission are verified here before the stream is proxied.
 */
function isWebSocketStreamAllowed(req: http.IncomingMessage): boolean {
  try {
    const cookieHeader = req.headers.cookie || '';
    const raw = cookieHeader
      .split(';')
      .map(c => c.trim())
      .find(c => c.startsWith(`${COOKIE_NAME}=`));
    if (!raw) return false;
    const user = verifySessionCookie(decodeURIComponent(raw.slice(COOKIE_NAME.length + 1)));
    if (!user || !isUserAllowed(user)) return false;

    const url = new URL(req.url || '', 'http://localhost');
    const allowed = checkVideoGatewayAccess(getAccess(user), '/ws', url.searchParams.getAll('src'));
    if (!allowed) {
      writeAudit(user, 'access.denied', 'route', 'WS /api/video-gateway/ws', `Zabranjen stream: ${url.searchParams.getAll('src').join(', ')}`, false);
    }
    return allowed;
  } catch {
    return false;
  }
}

function attachWebSocketProxy(server: http.Server | https.Server) {
  server.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/api/video-gateway/ws')) {
      if (!isWebSocketStreamAllowed(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        return;
      }
      const targetPath = resolveGatewayTargetPath(req.url.replace('/api/video-gateway/ws', '/api/ws'));
      const proxySocket = net.connect(1984, '127.0.0.1', () => {
        let rawReq = `${req.method} ${targetPath} HTTP/1.1\r\n`;
        for (const [k, v] of Object.entries(req.headers)) {
          if (k.toLowerCase() === 'host') {
            rawReq += `Host: 127.0.0.1:1984\r\n`;
          } else {
            rawReq += `${k}: ${v}\r\n`;
          }
        }
        rawReq += '\r\n';
        proxySocket.write(rawReq);
        if (head && head.length) proxySocket.write(head);
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
      });

      proxySocket.on('error', () => socket.destroy());
      socket.on('error', () => proxySocket.destroy());
    }
  });
}

// Start Dual Server (HTTP on 0.0.0.0:3000 for LAN, HTTPS on 3443 for Secure SSO)
async function startServer() {
  const localIps = getLocalIpAddresses();
  const primaryLanIp = localIps[0]?.address || publicHost();

  console.log('\n======================================================');
  console.log('   🚀 UNIPROMET ADMIN SERVER JE USPEŠNO POKRENUT!    ');
  console.log('======================================================');

  try {
    const ssl = await getOrCreateSslCertificate();
    const httpsServer = https.createServer({ key: ssl.key, cert: ssl.cert }, app);
    attachWebSocketProxy(httpsServer);

    // Dedicated HTTP redirect app for plain HTTP connections on port 3000
    const httpApp = express();
    httpApp.use((req, res) => {
      const hostHeader = req.headers.host || `${primaryLanIp}:${PORT}`;
      const hostWithoutPort = hostHeader.split(':')[0];
      const targetHost = (hostWithoutPort === 'localhost' || hostWithoutPort === '127.0.0.1')
        ? `localhost:${PORT}`
        : `${primaryLanIp}:${PORT}`;
      res.redirect(`https://${targetHost}${req.url}`);
    });
    const httpServer = http.createServer(httpApp);
    attachWebSocketProxy(httpServer);

    // Master TCP connection multiplexer that dynamically handles BOTH HTTP and HTTPS on port 3000
    const masterServer = net.createServer((socket) => {
      socket.once('readable', () => {
        const buf = socket.read(1);
        if (!buf) {
          socket.destroy();
          return;
        }
        socket.unshift(buf);

        // 0x16 is TLS Handshake ClientHello
        if (buf[0] === 0x16) {
          httpsServer.emit('connection', socket);
        } else {
          httpServer.emit('connection', socket);
        }
      });

      socket.on('error', () => {});
    });

    masterServer.listen(PORT, '0.0.0.0', () => {
      console.log(`  🔒 Mrežni pristup (glavni)     : https://${primaryLanIp}:${PORT}  (Microsoft 365 SSO)`);
      console.log(`  🌐 Mrežni HTTP pristup (auto)   : http://${primaryLanIp}:${PORT} -> automatski HTTPS`);
      console.log(`  🔒 Lokalni HTTPS pristup        : https://localhost:${PORT}`);
      console.log(`  🌐 Lokalni HTTP pristup (auto)  : http://localhost:${PORT} -> automatski HTTPS`);
    });
  } catch (err: any) {
    console.warn('[Server] Note: SSL certificate initialization skipped:', err?.message);
    const fallbackServer = http.createServer(app);
    attachWebSocketProxy(fallbackServer);
    fallbackServer.listen(PORT, '0.0.0.0');
  }

  // Secondary HTTP listener on port 3080 that forwards to HTTPS
  try {
    const httpApp = express();
    httpApp.use((req, res) => {
      res.redirect(`https://${primaryLanIp}:${PORT}${req.url}`);
    });
    const redirectServer = http.createServer(httpApp);
    redirectServer.listen(3080, '0.0.0.0', () => {
      console.log(`  🌐 HTTP redirect port          : http://${primaryLanIp}:3080 -> HTTPS`);
    });
    redirectServer.on('error', () => {});
  } catch {}

  console.log('======================================================\n');

  // Initialize unified automated background scheduler (SQLite integration).
  // SCHEDULER_ENABLED=false (dev mašina): bez zakazanih provera i mejlova; ručno pokretanje iz UI-ja i dalje radi.
  if (isEnabled('SCHEDULER_ENABLED')) {
    import('./services/unifiedSchedulerManager').then(({ initUnifiedScheduler }) => {
      initUnifiedScheduler();
    });
    // DMS Analiza podataka: zakazani mailovi koje korisnici sami podešavaju
    import('./services/dms/scheduledMailService').then(({ startScheduler }) => {
      startScheduler();
    });
  } else {
    console.log('[UnifiedScheduler] Isključen (SCHEDULER_ENABLED=false u .env)');
  }

  // Initialize go2rtc 25 FPS video streaming gateway
  import('./services/videoGatewayService').then(({ startVideoGateway }) => {
    startVideoGateway();
  });
}

startServer();

