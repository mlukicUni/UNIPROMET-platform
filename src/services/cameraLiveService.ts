import http from 'http';
import crypto from 'crypto';
import { getCameraInventoryByIp } from '../db/cameraInventoryDb';

const CAMERA_USER = process.env.CAMERA_USER || 'admin';
const CAMERA_PASS_1 = process.env.CAMERA_PASS_1 || process.env.CAMERA_PASS || '';
const CAMERA_PASS_2 = process.env.CAMERA_PASS_2 || '';

export function getCameraCredentials(ip: string): { user: string; pass: string } {
  try {
    const cam = getCameraInventoryByIp(ip);
    if (cam && cam.credProfile === 2) {
      return { user: CAMERA_USER, pass: CAMERA_PASS_2 };
    }
  } catch {
    // fallback
  }
  return { user: CAMERA_USER, pass: CAMERA_PASS_1 };
}

interface DigestParams {
  realm: string;
  nonce: string;
  qop?: string;
  nc: number;
}

// In-memory cache of digest auth params per IP to prevent extra 401 roundtrips
const digestCache = new Map<string, DigestParams>();

function parseDigestHeader(header: string): { realm?: string; nonce?: string; qop?: string } | null {
  const match = header.match(/Digest\s+(.*)/i);
  if (!match) return null;
  const params: Record<string, string> = {};
  match[1].split(/,\s*/).forEach(item => {
    const [k, v] = item.split('=');
    if (k && v) params[k.trim()] = v.replace(/"/g, '').trim();
  });
  return params;
}

function buildDigestHeader(
  user: string,
  pass: string,
  method: string,
  uri: string,
  digest: DigestParams
): string {
  digest.nc++;
  const ncStr = digest.nc.toString(16).padStart(8, '0');
  const cnonce = crypto.randomBytes(8).toString('hex');

  const ha1 = crypto.createHash('md5').update(`${user}:${digest.realm}:${pass}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');

  if (digest.qop) {
    const response = crypto
      .createHash('md5')
      .update(`${ha1}:${digest.nonce}:${ncStr}:${cnonce}:${digest.qop}:${ha2}`)
      .digest('hex');
    return `Digest username="${user}", realm="${digest.realm}", nonce="${digest.nonce}", uri="${uri}", qop=${digest.qop}, nc=${ncStr}, cnonce="${cnonce}", response="${response}"`;
  } else {
    const response = crypto
      .createHash('md5')
      .update(`${ha1}:${digest.nonce}:${ha2}`)
      .digest('hex');
    return `Digest username="${user}", realm="${digest.realm}", nonce="${digest.nonce}", uri="${uri}", response="${response}"`;
  }
}

/**
 * Fetches a single live JPEG snapshot frame from camera by IP.
 * Automatically handles Digest and Basic authentication and Hikvision/Dahua paths.
 */
export async function fetchCameraSnapshot(
  ip: string,
  streamType: 'sub' | 'main' = 'sub'
): Promise<{ data: Buffer; contentType: string } | null> {
  const isSub = streamType === 'sub';
  
  // Potential snapshot paths: Hikvision ISAPI first, then Dahua CGI
  const hikPath = isSub 
    ? '/ISAPI/Streaming/channels/102/picture' 
    : '/ISAPI/Streaming/channels/101/picture';
    
  const dahuaPath = isSub
    ? '/cgi-bin/snapshot.cgi?channel=1&subtype=1'
    : '/cgi-bin/snapshot.cgi?channel=1&subtype=0';

  const pathsToTry = [hikPath, dahuaPath];

  for (const path of pathsToTry) {
    try {
      const result = await requestCameraFrame(ip, path);
      if (result) return result;
    } catch {
      // try next path
    }
  }

  return null;
}

function requestCameraFrame(
  ip: string,
  path: string
): Promise<{ data: Buffer; contentType: string } | null> {
  return new Promise((resolve) => {
    const creds = getCameraCredentials(ip);
    const cachedDigest = digestCache.get(ip);
    let authHeader = '';

    if (cachedDigest) {
      authHeader = buildDigestHeader(creds.user, creds.pass, 'GET', path, cachedDigest);
    } else {
      // Default to Basic auth initially
      authHeader = 'Basic ' + Buffer.from(`${creds.user}:${creds.pass}`).toString('base64');
    }

    const makeRequest = (headerValue: string, isRetry = false) => {
      const req = http.request({
        host: ip,
        port: 80,
        path,
        method: 'GET',
        headers: {
          'Authorization': headerValue,
          'Connection': 'close',
          'User-Agent': 'UniprometAdminCCTV/2.0'
        },
        timeout: 3000
      }, (res) => {
        if (res.statusCode === 200) {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const data = Buffer.concat(chunks);
            const contentType = res.headers['content-type'] || 'image/jpeg';
            resolve({ data, contentType });
          });
          return;
        }

        // If 401 Unauthorized and not yet retried, parse Digest challenge
        if (res.statusCode === 401 && !isRetry) {
          const wwwAuth = res.headers['www-authenticate'];
          if (wwwAuth && wwwAuth.toLowerCase().includes('digest')) {
            const parsed = parseDigestHeader(wwwAuth);
            if (parsed && parsed.realm && parsed.nonce) {
              const newDigest: DigestParams = {
                realm: parsed.realm,
                nonce: parsed.nonce,
                qop: parsed.qop,
                nc: 0
              };
              digestCache.set(ip, newDigest);
              const nextAuth = buildDigestHeader(creds.user, creds.pass, 'GET', path, newDigest);
              makeRequest(nextAuth, true);
              return;
            }
          }
        }

        res.resume();
        resolve(null);
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    };

    makeRequest(authHeader);
  });
}
