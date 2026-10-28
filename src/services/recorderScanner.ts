import http from 'http';
import https from 'https';
import net from 'net';
import { getRecordersInventory, updateRecorderCheckStatus, RecorderItem } from '../db/recorderInventoryDb';
import { pingHost } from '../utils/hostProbe';
import { acquireScanLock } from './scanLockManager';

export interface RecorderCheckResult {
  id: string;
  name: string;
  location: string;
  ip: string;
  model: string;
  type: string;
  status: 'online' | 'offline';
  pingStatus: 'online' | 'offline';
  webuiStatus: 'online' | 'offline';
  latencyMs?: number;
  reason: string;
  lastCheckedAt: string;
}

export interface RecordersCheckSummary {
  total: number;
  onlineCount: number;
  offlineCount: number;
  allRecorders: RecorderCheckResult[];
  offlineRecorders: RecorderCheckResult[];
  lastCheckedAt: string;
}

/**
 * Pings a recorder IP with a 1000ms timeout
 */
export async function pingRecorder(ip: string): Promise<{ ok: boolean; latencyMs?: number }> {
  try {
    const cleanIp = (ip || '').replace(/[^0-9.]/g, '').trim();
    if (!cleanIp) return { ok: false };

    const r = await pingHost(cleanIp, 1000);
    return r.ok ? { ok: true, latencyMs: r.latencyMs ?? 1 } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Probes TCP port connection
 */
function probeTcpPort(ip: string, port: number, timeout = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(timeout);
    sock.on('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.on('error', () => {
      sock.destroy();
      resolve(false);
    });
    try {
      sock.connect(port, ip);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Checks if the WebUI of the NVR/DVR is responding via HTTP or HTTPS
 */
export async function checkRecorderWebUI(ip: string, httpPort = 80, timeout = 2500): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  const cleanIp = (ip || '').replace(/[^0-9.]/g, '').trim();
  if (!cleanIp) return { ok: false, error: 'INVALID_IP' };

  // 1. First probe standard HTTP port (typically 80)
  const httpResult = await new Promise<{ ok: boolean; statusCode?: number; error?: string }>((resolve) => {
    const req = http.get(
      {
        host: cleanIp,
        port: httpPort,
        path: '/',
        timeout
      },
      (res) => {
        const code = res.statusCode || 200;
        // Any HTTP response (including 401 Unauthorized / 302 Redirect) means the web server is alive
        resolve({ ok: true, statusCode: code });
        res.resume();
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'TIMEOUT' });
    });

    req.on('error', (err: any) => {
      resolve({ ok: false, error: err?.code || err?.message || 'ERROR' });
    });
  });

  if (httpResult.ok) {
    return httpResult;
  }

  // 2. If HTTP failed, check if HTTPS (443) is active
  const httpsResult = await new Promise<{ ok: boolean; statusCode?: number; error?: string }>((resolve) => {
    const req = https.get(
      {
        host: cleanIp,
        port: 443,
        path: '/',
        rejectUnauthorized: false,
        timeout: 1800
      },
      (res) => {
        resolve({ ok: true, statusCode: res.statusCode || 200 });
        res.resume();
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'TIMEOUT' });
    });

    req.on('error', (err: any) => {
      resolve({ ok: false, error: err?.code || 'ERROR' });
    });
  });

  if (httpsResult.ok) {
    return httpsResult;
  }

  // 3. Fallback TCP probe on SDK port 8000 or HTTP port 80
  const tcp80 = await probeTcpPort(cleanIp, httpPort, 1200);
  if (tcp80) {
    return { ok: true, statusCode: 200 };
  }

  return { ok: false, error: httpResult.error || 'WEBUI_UNREACHABLE' };
}

/**
 * Checks a single recorder and updates its status in the database.
 * Rule:
 * - Ping fails -> OFFLINE
 * - Ping succeeds BUT WebUI fails -> OFFLINE (with reason 'WebUI nedostupan')
 * - Ping succeeds AND WebUI succeeds -> ONLINE
 */
export async function checkSingleRecorder(recorder: RecorderItem): Promise<RecorderCheckResult> {
  const now = new Date().toISOString();
  const ping = await pingRecorder(recorder.ip);

  if (!ping.ok) {
    const result: RecorderCheckResult = {
      id: recorder.id,
      name: recorder.name,
      location: recorder.location,
      ip: recorder.ip,
      model: recorder.model,
      type: recorder.type,
      status: 'offline',
      pingStatus: 'offline',
      webuiStatus: 'offline',
      latencyMs: undefined,
      reason: 'Nema ping odziva (uređaj je isključen ili prekid mrežne veze)',
      lastCheckedAt: now
    };

    updateRecorderCheckStatus(recorder.id, {
      status: 'offline',
      webuiStatus: 'offline',
      pingStatus: 'offline',
      latencyMs: undefined,
      lastCheckedAt: now
    });

    return result;
  }

  // Ping is OK -> Now verify WebUI
  const webui = await checkRecorderWebUI(recorder.ip, recorder.httpPort || 80);

  if (!webui.ok) {
    // Ping responds BUT WebUI is down -> mark as OFFLINE per user requirements!
    const result: RecorderCheckResult = {
      id: recorder.id,
      name: recorder.name,
      location: recorder.location,
      ip: recorder.ip,
      model: recorder.model,
      type: recorder.type,
      status: 'offline',
      pingStatus: 'online',
      webuiStatus: 'offline',
      latencyMs: ping.latencyMs,
      reason: 'Ping se odaziva, ali Web interfejs (WebUI) ne odgovara (moguća blokada servisa ili portova)',
      lastCheckedAt: now
    };

    updateRecorderCheckStatus(recorder.id, {
      status: 'offline',
      webuiStatus: 'offline',
      pingStatus: 'online',
      latencyMs: ping.latencyMs,
      lastCheckedAt: now
    });

    return result;
  }

  // Both Ping & WebUI are working
  const result: RecorderCheckResult = {
    id: recorder.id,
    name: recorder.name,
    location: recorder.location,
    ip: recorder.ip,
    model: recorder.model,
    type: recorder.type,
    status: 'online',
    pingStatus: 'online',
    webuiStatus: 'online',
    latencyMs: ping.latencyMs,
    reason: 'Uređaj aktivan i Web interfejs (WebUI) je u potpunosti dostupan',
    lastCheckedAt: now
  };

  updateRecorderCheckStatus(recorder.id, {
    status: 'online',
    webuiStatus: 'online',
    pingStatus: 'online',
    latencyMs: ping.latencyMs,
    lastCheckedAt: now
  });

  return result;
}

/**
 * Checks all inventory recorders with controlled concurrency and returns summary.
 */
export async function checkAllRecordersStatus(): Promise<RecordersCheckSummary> {
  // Global scan lock: waits for camera, LAN or toner scans instead of running alongside them
  return acquireScanLock('recorders', async () => {
    const recorders = getRecordersInventory();
    const allResults: RecorderCheckResult[] = [];
    const now = new Date().toISOString();

    // Controlled concurrency batching (4 recorders at a time to prevent burst network spikes)
    const batchSize = 4;
    for (let i = 0; i < recorders.length; i += batchSize) {
      const batch = recorders.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map((rec) => checkSingleRecorder(rec)));
      allResults.push(...batchResults);
    }

    const offlineRecorders = allResults.filter((r) => r.status === 'offline');
    const onlineCount = allResults.length - offlineRecorders.length;

    return {
      total: allResults.length,
      onlineCount,
      offlineCount: offlineRecorders.length,
      allRecorders: allResults,
      offlineRecorders,
      lastCheckedAt: now
    };
  });
}
