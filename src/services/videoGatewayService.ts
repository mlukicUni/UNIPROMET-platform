import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';

let gatewayProcess: ChildProcess | null = null;
let isStarting = false;

const GATEWAY_PORT = 1984;

/**
 * Checks if go2rtc is responding on port 1984.
 */
export function checkGatewayHealth(): Promise<boolean> {
  return probeGateway(1000).then(r => r === 'ok');
}

/** ok = odgovara; down = veza odbijena/greška (proces ne radi); slow = veza postoji, ali ne odgovara u roku (zauzet) */
function probeGateway(timeoutMs: number): Promise<'ok' | 'down' | 'slow'> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: GATEWAY_PORT,
        path: '/api',
        timeout: timeoutMs
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200 ? 'ok' : 'down');
      }
    );
    req.on('error', () => resolve('down'));
    req.on('timeout', () => {
      req.destroy();
      resolve('slow');
    });
  });
}

let lastHealthyAt = 0;
let restartInFlight: Promise<boolean> | null = null;

/**
 * Pre otvaranja kamere: gateway mora da radi. Restart go2rtc-a prekida SVE tokove SVIH gledalaca,
 * pa se radi samo kad je zaista potreban:
 *  - proces ne radi (veza odbijena) -> odmah pokretanje, kao do sada;
 *  - proces je samo zauzet (ne odgovara u roku od 1 s dok ima mnogo tokova) -> do 3 pokušaja sa rokom od 2 s,
 *    restart tek ako ne odgovori ni posle ~7 s (zaglavljen).
 * Rezultat "radi" važi 5 s, pa nekoliko kamera otvorenih zaredom ne proverava gateway svaki put.
 */
export async function ensureGatewayRunning(): Promise<boolean> {
  if (Date.now() - lastHealthyAt < 5000) return true;

  let state = await probeGateway(1000);
  for (let attempt = 0; state === 'slow' && attempt < 3; attempt++) {
    state = await probeGateway(2000);
    if (state === 'slow') await new Promise((r) => setTimeout(r, 500));
  }
  if (state === 'ok') {
    lastHealthyAt = Date.now();
    return true;
  }

  // Ne radi ili je zaglavljen: restart (jedan istovremeno, ostali čekaju njegov ishod)
  if (!restartInFlight) {
    restartInFlight = startVideoGateway().finally(() => { restartInFlight = null; });
  }
  await restartInFlight;
  const healthy = await checkGatewayHealth();
  if (healthy) lastHealthyAt = Date.now();
  return healthy;
}

/**
 * Resolves the correct go2rtc binary path depending on the host OS and architecture.
 */
export function resolveGatewayBinary(): string | null {
  // 1. Explicit override via environment variable
  if (process.env.GO2RTC_BIN && fs.existsSync(process.env.GO2RTC_BIN)) {
    return process.env.GO2RTC_BIN;
  }

  const binDir = path.resolve(process.cwd(), 'bin');

  if (process.platform === 'win32') {
    const winBin = path.join(binDir, 'go2rtc.exe');
    if (fs.existsSync(winBin)) return winBin;
    const winBinNoExt = path.join(binDir, 'go2rtc');
    if (fs.existsSync(winBinNoExt)) return winBinNoExt;
  } else if (process.platform === 'linux') {
    // Check architecture (arm64 vs amd64/x64)
    if (process.arch === 'arm64') {
      const linuxArm = path.join(binDir, 'go2rtc_linux_arm64');
      if (fs.existsSync(linuxArm)) return linuxArm;
    }

    const linuxAmd64 = path.join(binDir, 'go2rtc_linux_amd64');
    if (fs.existsSync(linuxAmd64)) return linuxAmd64;

    const linuxGeneric = path.join(binDir, 'go2rtc');
    if (fs.existsSync(linuxGeneric)) return linuxGeneric;

    // Check system-wide paths if installed via package or curl into /usr/local/bin
    if (fs.existsSync('/usr/local/bin/go2rtc')) return '/usr/local/bin/go2rtc';
    if (fs.existsSync('/usr/bin/go2rtc')) return '/usr/bin/go2rtc';
  } else if (process.platform === 'darwin') {
    const macAmd64 = path.join(binDir, 'go2rtc_darwin_amd64');
    if (fs.existsSync(macAmd64)) return macAmd64;
    const macGeneric = path.join(binDir, 'go2rtc');
    if (fs.existsSync(macGeneric)) return macGeneric;
  }

  // Fallback: check any file named 'go2rtc' or 'go2rtc.exe'
  const fallback = path.join(binDir, process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc');
  return fs.existsSync(fallback) ? fallback : null;
}

/**
 * Removes leftover dynamic streams (playback_*, export_*) from go2rtc.yaml.
 * They carry RTSP credentials in plain text and are meaningless after a restart.
 * Must run while go2rtc is NOT running (it rewrites the file itself).
 */
export function purgeDynamicStreams(configPath: string): number {
  try {
    const text = fs.readFileSync(configPath, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const out: string[] = [];
    let inStreams = false;
    let skipping = false;
    let removed = 0;
    let kept = 0;
    for (const line of lines) {
      if (/^streams:/.test(line)) {
        inStreams = true;
        skipping = false;
        out.push(line);
        continue;
      }
      if (inStreams && /^\S/.test(line)) {
        inStreams = false; // next top-level key
        skipping = false;
      }
      if (inStreams) {
        const key = line.match(/^ {2}([^\s:#][^:]*):\s*$/);
        if (key) {
          skipping = /^(playback_|export_)/.test(key[1].trim());
          if (skipping) { removed++; continue; }
          kept++;
        } else if (skipping && (/^\s+/.test(line) || line.trim() === '')) {
          continue; // body of a removed stream
        } else {
          skipping = false;
        }
      }
      out.push(line);
    }
    if (removed === 0) return 0;
    let result = out.join(eol);
    // streams: with no entries left (next line is a top-level key / end of file) -> valid empty mapping
    if (kept === 0) result = result.replace(/^streams:[ \t]*$/m, 'streams: {}');
    fs.writeFileSync(configPath, result, 'utf8');
    console.log(`[VideoGateway] Removed ${removed} leftover playback/export stream(s) from go2rtc config`);
    return removed;
  } catch (err: any) {
    console.warn('[VideoGateway] Could not purge dynamic streams:', err?.message);
    return 0;
  }
}

/**
 * Starts the go2rtc streaming gateway process if not already running.
 */
export async function startVideoGateway(): Promise<boolean> {
  if (isStarting) return false;
  isStarting = true;

  try {
    // Terminate any previous orphan go2rtc process to guarantee current config/go2rtc.yaml is used
    try {
      const { execSync } = await import('child_process');
      if (process.platform === 'win32') {
        execSync('taskkill /F /IM go2rtc.exe /T', { stdio: 'ignore' });
      } else {
        // Linux / Unix: terminate any lingering go2rtc process
        try {
          execSync('pkill -f go2rtc', { stdio: 'ignore' });
        } catch {}
      }
    } catch {}

    await new Promise((r) => setTimeout(r, 400));

    const binPath = resolveGatewayBinary();
    const configPath = process.env.GO2RTC_CONFIG || path.resolve(process.cwd(), 'config', 'go2rtc.yaml');

    if (!binPath || !fs.existsSync(binPath)) {
      console.warn(`[VideoGateway] Binary not found for platform ${process.platform} (${process.arch}). Checked: ${binPath}`);
      isStarting = false;
      return false;
    }

    // Ensure executable permissions on Linux / macOS
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(binPath, 0o755);
      } catch (err: any) {
        console.warn(`[VideoGateway] Warning: Could not chmod +x on ${binPath}:`, err?.message);
      }
    }

    if (!fs.existsSync(configPath)) {
      console.warn(`[VideoGateway] Config not found at: ${configPath}`);
      isStarting = false;
      return false;
    }

    // go2rtc upisuje dinamicke tokove (playback_*, export_*) u config zajedno sa RTSP lozinkom;
    // ako se tok ne zaustavi uredno, ostaju zauvek. Ocisti ih pre pokretanja.
    purgeDynamicStreams(configPath);

    console.log(`[VideoGateway] Starting go2rtc gateway [${process.platform}/${process.arch}] from ${binPath}...`);

    gatewayProcess = spawn(binPath, ['-c', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true
    });

    gatewayProcess.stdout?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg.includes('ERR') || msg.includes('WRN')) {
        console.warn(`[VideoGateway] ${msg}`);
      }
    });

    gatewayProcess.stderr?.on('data', (data) => {
      console.error(`[VideoGateway Error] ${data.toString().trim()}`);
    });

    gatewayProcess.on('exit', (code, signal) => {
      console.log(`[VideoGateway] Process exited with code=${code}, signal=${signal}`);
      gatewayProcess = null;
    });

    // Wait briefly and verify health
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const healthy = await checkGatewayHealth();
      if (healthy) {
        console.log(`[VideoGateway] ✓ go2rtc gateway successfully initialized and listening on port ${GATEWAY_PORT} (WebRTC / MSE 25 FPS).`);
        isStarting = false;
        return true;
      }
    }

    console.warn(`[VideoGateway] Gateway process started, but healthcheck on port ${GATEWAY_PORT} timed out.`);
    isStarting = false;
    return false;
  } catch (err: any) {
    console.error(`[VideoGateway] Failed to start go2rtc:`, err?.message);
    isStarting = false;
    return false;
  }
}

/**
 * Stops the go2rtc streaming gateway process cleanly.
 */
export function stopVideoGateway() {
  if (gatewayProcess) {
    try {
      console.log('[VideoGateway] Stopping go2rtc gateway...');
      gatewayProcess.kill();
      gatewayProcess = null;
    } catch (err) {
      console.error('[VideoGateway] Error killing gateway process:', err);
    }
  }
}

// Ensure cleanup on Node process exit
process.on('exit', () => stopVideoGateway());
process.on('SIGINT', () => {
  stopVideoGateway();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopVideoGateway();
  process.exit(0);
});
