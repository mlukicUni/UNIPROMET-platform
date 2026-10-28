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
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: GATEWAY_PORT,
        path: '/api',
        timeout: 1000
      },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
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
