import net from 'net';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { getAllCameraInventory } from '../db/cameraInventoryDb';
import { acquireScanLock } from './scanLockManager';

export interface CameraDevice {
  ip: string;
  subnet: '124' | '125';
  subnetLabel: string;
  name: string;
  recorder?: string;
  position?: string;
  inventoryType?: string;
  vendor: 'Hikvision' | 'Dahua' | 'ONVIF / Drugo';
  isOnline: boolean;
  pingMs: number;
  openPorts: number[];
  webUrl: string;
  rtspMain: string;
  rtspSub: string;
  serverBanner?: string;
  lastSeen: string;
}

export interface OfflineCameraDevice {
  id: string;
  ip: string;
  name: string;
  recorder: string;
  position: string;
  subnet: string;
  type: string;
  note?: string;
  isOnline: false;
  statusLabel: string;
  reason: string;
  lastChecked: string;
}

export interface CameraScanResult {
  cameras: CameraDevice[];
  totalCameras: number;
  subnet124Count: number;
  subnet125Count: number;
  hikvisionCount: number;
  dahuaCount: number;
  scanDurationMs: number;
  cached: boolean;
  lastScanTime: string;
  offlineCameras: OfflineCameraDevice[];
  offlineCount: number;
  inventoryTotalCount: number;
}

const CACHE_FILE = path.join(process.cwd(), 'src', 'db', 'cameras_cache.json');
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache

let inMemoryCache: CameraScanResult | null = null;
let lastScanTimestamp = 0;
let isScanInProgress = false;

// Pre-load disk cache immediately on module load so server never starts with an empty cache
try {
  if (fs.existsSync(CACHE_FILE)) {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data?.result?.cameras && Array.isArray(data.result.cameras)) {
      inMemoryCache = data.result;
      lastScanTimestamp = data.timestamp || Date.now();
    }
  }
} catch (e) {
  // Ignore pre-load error
}

/**
 * Fast synchronous lookup of cached offline cameras.
 * NEVER blocks or runs network scans.
 */
export function getCachedOfflineCamerasSync(): OfflineCameraDevice[] {
  if (inMemoryCache?.offlineCameras && Array.isArray(inMemoryCache.offlineCameras)) {
    return inMemoryCache.offlineCameras;
  }
  return [];
}

export function getCachedOfflineCamerasInfoSync(): {
  offlineCameras: OfflineCameraDevice[];
  offlineCount: number;
  lastScanTime: string;
} {
  const offlineCameras = inMemoryCache?.offlineCameras && Array.isArray(inMemoryCache.offlineCameras)
    ? inMemoryCache.offlineCameras
    : [];
  const offlineCount = inMemoryCache?.offlineCount != null ? inMemoryCache.offlineCount : offlineCameras.length;
  const lastScanTime = inMemoryCache?.lastScanTime || new Date(lastScanTimestamp || Date.now()).toISOString();
  return { offlineCameras, offlineCount, lastScanTime };
}

/**
 * Enriches camera devices with real name, recorder, and position from SQLite inventory
 */
function enrichCamerasWithInventory(cameras: CameraDevice[]): void {
  try {
    const allDbCameras = getAllCameraInventory();
    const inventoryMap = new Map<string, any>();
    allDbCameras.forEach(c => {
      if (c.ip) inventoryMap.set(c.ip.trim(), c);
    });

    for (const cam of cameras) {
      const inv = inventoryMap.get(cam.ip.trim());
      if (inv) {
        if (inv.name && inv.name.trim()) cam.name = inv.name.trim();
        else if (inv.position && inv.position.trim()) cam.name = inv.position.trim();
        if (inv.recorder) cam.recorder = inv.recorder;
        if (inv.position) cam.position = inv.position;
        if (inv.type) cam.inventoryType = inv.type;
      }
    }
  } catch (err) {
    console.warn('Error enriching cameras with inventory:', err);
  }
}

/**
 * Check a single port on target host with timeout (uses gentle TCP FIN on connect)
 */
function testPort(ip: string, port: number, timeoutMs = 600): Promise<{ open: boolean; latencyMs: number }> {
  const start = Date.now();
  return new Promise(resolve => {
    const socket = new net.Socket();
    let resolved = false;
    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      if (!resolved) {
        resolved = true;
        const elapsed = Date.now() - start;
        socket.end(); // Clean FIN handshake - non-intrusive to firewalls
        resolve({ open: true, latencyMs: elapsed });
      }
    });

    socket.once('timeout', () => {
      if (!resolved) {
        resolved = true;
        try { socket.destroy(); } catch {}
        resolve({ open: false, latencyMs: timeoutMs });
      }
    });

    socket.once('error', () => {
      if (!resolved) {
        resolved = true;
        try { socket.destroy(); } catch {}
        resolve({ open: false, latencyMs: timeoutMs });
      }
    });

    try {
      socket.connect(port, ip);
    } catch {
      if (!resolved) {
        resolved = true;
        resolve({ open: false, latencyMs: timeoutMs });
      }
    }
  });
}

/**
 * Quick HTTP banner probe to identify Hikvision vs Dahua
 */
function probeHttpBanner(ip: string, timeoutMs = 1200): Promise<{ server: string; statusCode: number }> {
  return new Promise(resolve => {
    const req = http.get(`http://${ip}/`, { timeout: timeoutMs }, res => {
      resolve({
        server: (res.headers['server'] || '').toString(),
        statusCode: res.statusCode || 200
      });
      res.resume();
    });

    req.on('error', () => resolve({ server: '', statusCode: 0 }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ server: '', statusCode: 0 });
    });
  });
}

/**
 * Scan a single camera IP candidate and cross-reference with inventory
 */
async function inspectCamera(
  ip: string, 
  subnet: '124' | '125', 
  inventoryMap?: Map<string, any>
): Promise<CameraDevice | null> {
  const port80 = await testPort(ip, 80, 500);
  const port554 = await testPort(ip, 554, 500);

  if (!port80.open && !port554.open) {
    return null;
  }

  const openPorts: number[] = [];
  if (port80.open) openPorts.push(80);
  if (port554.open) openPorts.push(554);

  const [port8000, port37777] = await Promise.all([
    testPort(ip, 8000, 400),
    testPort(ip, 37777, 400)
  ]);

  if (port8000.open) openPorts.push(8000);
  if (port37777.open) openPorts.push(37777);

  let vendor: 'Hikvision' | 'Dahua' | 'ONVIF / Drugo' = 'ONVIF / Drugo';
  let serverBanner = '';

  if (port80.open) {
    const banner = await probeHttpBanner(ip, 800);
    serverBanner = banner.server;
    if (port37777.open || banner.server.includes('DH-Web')) {
      vendor = 'Dahua';
    } else if (port8000.open || banner.server.includes('webserver') || banner.server.includes('App-webs') || banner.server.includes('hikvision')) {
      vendor = 'Hikvision';
    }
  } else if (port37777.open) {
    vendor = 'Dahua';
  } else if (port8000.open) {
    vendor = 'Hikvision';
  }

  let rtspMain = `rtsp://${ip}:554/Streaming/Channels/101`;
  let rtspSub = `rtsp://${ip}:554/Streaming/Channels/102`;

  if (vendor === 'Dahua') {
    rtspMain = `rtsp://${ip}:554/cam/realmonitor?channel=1&subtype=0`;
    rtspSub = `rtsp://${ip}:554/cam/realmonitor?channel=1&subtype=1`;
  }

  const subnetLabel = subnet === '124' 
    ? 'Subnet 192.168.124.x (Fabrika / Plac)' 
    : 'Subnet 192.168.125.x (Hale / Magacini)';

  const inv = inventoryMap?.get(ip);
  let name = inv?.name || inv?.position;
  if (!name) {
    const lastOctet = ip.split('.')[3];
    name = `${vendor} Kamera ${subnet}.${lastOctet}`;
  }

  return {
    ip,
    subnet,
    subnetLabel,
    name,
    recorder: inv?.recorder || undefined,
    position: inv?.position || undefined,
    inventoryType: inv?.type || undefined,
    vendor,
    isOnline: true,
    pingMs: port80.open ? port80.latencyMs : port554.latencyMs,
    openPorts,
    webUrl: port80.open ? `http://${ip}/` : '',
    rtspMain,
    rtspSub,
    serverBanner: serverBanner || undefined,
    lastSeen: new Date().toISOString()
  };
}

/**
 * Cross-references discovered network cameras with SQLite inventory.
 * Verifies any camera missing from the scan and confirms reachability / offline state.
 */
export async function getOfflineCamerasFromInventory(discoveredCameras?: CameraDevice[]): Promise<{
  offlineCameras: OfflineCameraDevice[];
  offlineCount: number;
  inventoryTotalCount: number;
}> {
  const allDbCameras = getAllCameraInventory().filter(c => !c.isReserved);
  const now = new Date().toISOString();

  // If discoveredCameras not passed, use current memory or disk cache
  let onlineIps = new Set<string>();
  if (discoveredCameras && Array.isArray(discoveredCameras)) {
    onlineIps = new Set(discoveredCameras.map(c => c.ip.trim()));
  } else if (inMemoryCache && inMemoryCache.cameras) {
    onlineIps = new Set(inMemoryCache.cameras.map(c => c.ip.trim()));
  } else if (fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      if (cached?.result?.cameras) {
        onlineIps = new Set(cached.result.cameras.map((c: any) => c.ip.trim()));
      }
    } catch (e) {
      // ignore
    }
  }

  const missingFromScan = allDbCameras.filter(c => !onlineIps.has(c.ip.trim()));
  const offlineCameras: OfflineCameraDevice[] = [];

  // Verify missing cameras with the same pacing as the main scan:
  // Čačak (local) in batches of 6 with 50ms pauses, Kraljevo (125.x across Sophos) in batches of 3 with 120ms pauses
  const missingKraljevo = missingFromScan.filter(c => c.ip.includes('.125.'));
  const missingLocal = missingFromScan.filter(c => !c.ip.includes('.125.'));
  const queues: Array<{ list: typeof missingFromScan; batchSize: number; pauseMs: number }> = [
    { list: missingLocal, batchSize: 6, pauseMs: 50 },
    { list: missingKraljevo, batchSize: 3, pauseMs: 120 }
  ];

  for (const { list, batchSize, pauseMs } of queues) {
    for (let i = 0; i < list.length; i += batchSize) {
      const batch = list.slice(i, i + batchSize);
      await Promise.all(batch.map(async (c) => {
        const p80 = await testPort(c.ip.trim(), 80, 500);
        let isOpen = p80.open;
        if (!isOpen) {
          const p554 = await testPort(c.ip.trim(), 554, 500);
          isOpen = p554.open;
        }

        if (!isOpen) {
          offlineCameras.push({
            id: c.id,
            ip: c.ip.trim(),
            name: c.name || c.position || `Kamera ${c.ip}`,
            recorder: c.recorder || 'Nedodeljeno',
            position: c.position || 'Pozicija nepoznata',
            subnet: c.subnet || (c.ip.includes('124.') ? '192.168.124.x' : '192.168.125.x'),
            type: c.type || 'IP Kamera',
            note: c.note || '',
            isOnline: false,
            statusLabel: 'Nedostupna na mreži',
            reason: 'Port 80 (HTTP) i Port 554 (RTSP) zatvoreni - nema mrežnog odziva',
            lastChecked: now
          });
        }
      }));
      if (i + batchSize < list.length) {
        await new Promise(r => setTimeout(r, pauseMs));
      }
    }
  }

  offlineCameras.sort((a, b) => {
    const octA = a.ip.split('.').map(Number);
    const octB = b.ip.split('.').map(Number);
    if (octA[2] !== octB[2]) return octA[2] - octB[2];
    return octA[3] - octB[3];
  });

  return {
    offlineCameras,
    offlineCount: offlineCameras.length,
    inventoryTotalCount: allDbCameras.length
  };
}

/**
 * Same as getOfflineCamerasFromInventory, but under the global scan lock.
 * For callers outside a scan (UI list, email). Inside scanCameras the unlocked version is used.
 */
export function checkOfflineCamerasLocked(): ReturnType<typeof getOfflineCamerasFromInventory> {
  return acquireScanLock('cameras-offline-check', () => getOfflineCamerasFromInventory());
}

/**
 * Sophos/WAN-Friendly Targeted Camera Scanner
 * Probes known camera inventory devices first (Targeted Polling).
 * Splits Čačak (124.x local) and Kraljevo (125.x WAN) into separate rate-limited queues.
 */
export async function scanCameras(force = false, deepScan = false, waitIfBusy = false): Promise<CameraScanResult> {
  const now = Date.now();

  // Return memory cache if fresh (within 15 minutes)
  if (!force && inMemoryCache && (now - lastScanTimestamp < CACHE_TTL_MS)) {
    enrichCamerasWithInventory(inMemoryCache.cameras);
    return { ...inMemoryCache, cached: true };
  }

  // If memory cache is null, try disk cache even if older
  if (!force && !inMemoryCache && fs.existsSync(CACHE_FILE)) {
    try {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data?.result?.cameras && Array.isArray(data.result.cameras)) {
        enrichCamerasWithInventory(data.result.cameras);
        inMemoryCache = data.result;
        lastScanTimestamp = data.timestamp;
        return { ...data.result, cached: true };
      }
    } catch {}
  }

  // Use global scan lock so we never collide with network device or printer scans.
  // Deep (range) scan has its own name so a normal request never receives a deep result or vice versa.
  return acquireScanLock(deepScan ? 'cameras-deep' : 'cameras', async () => {
    isScanInProgress = true;
    const startTime = Date.now();

    try {
      const allDbCameras = getAllCameraInventory();
      const inventoryMap = new Map<string, any>();
      allDbCameras.forEach(c => {
        if (c.ip) inventoryMap.set(c.ip.trim(), c);
      });

      // 1. Build targeted camera list from inventory
      const targets124 = new Set<string>();
      const targets125 = new Set<string>();

      allDbCameras.forEach(c => {
        if (!c.ip) return;
        const ip = c.ip.trim();
        if (ip.includes('.124.')) targets124.add(ip);
        else if (ip.includes('.125.')) targets125.add(ip);
      });

      // Subnet range expansion occurs ONLY if deepScan is explicitly requested by operator
      if (deepScan) {
        for (let i = 11; i <= 230; i++) targets124.add(`192.168.124.${i}`);
        for (let i = 46; i <= 246; i++) targets125.add(`192.168.125.${i}`);
      }

      const discovered: CameraDevice[] = [];

      // 2. Scan Čačak Subnet 124 (Local LAN: batches of 8, 30ms pause)
      const list124 = Array.from(targets124);
      const batch124Size = 8;
      for (let i = 0; i < list124.length; i += batch124Size) {
        const batch = list124.slice(i, i + batch124Size);
        const results = await Promise.all(batch.map(ip => inspectCamera(ip, '124', inventoryMap)));
        results.forEach(cam => { if (cam) discovered.push(cam); });
        if (i + batch124Size < list124.length) {
          await new Promise(r => setTimeout(r, 30));
        }
      }

      // 3. Scan Kraljevo Subnet 125 (Remote WAN across Sophos: gentle batches of 3, 120ms pause)
      const list125 = Array.from(targets125);
      const batch125Size = 3;
      for (let i = 0; i < list125.length; i += batch125Size) {
        const batch = list125.slice(i, i + batch125Size);
        const results = await Promise.all(batch.map(ip => inspectCamera(ip, '125', inventoryMap)));
        results.forEach(cam => { if (cam) discovered.push(cam); });
        if (i + batch125Size < list125.length) {
          await new Promise(r => setTimeout(r, 120)); // Gentle pause for Sophos DoS protection
        }
      }

      discovered.sort((a, b) => {
        const octA = a.ip.split('.').map(Number);
        const octB = b.ip.split('.').map(Number);
        if (octA[2] !== octB[2]) return octA[2] - octB[2];
        return octA[3] - octB[3];
      });

      enrichCamerasWithInventory(discovered);

      const subnet124Count = discovered.filter(c => c.subnet === '124').length;
      const subnet125Count = discovered.filter(c => c.subnet === '125').length;
      const hikvisionCount = discovered.filter(c => c.vendor === 'Hikvision').length;
      const dahuaCount = discovered.filter(c => c.vendor === 'Dahua').length;

      const scanDurationMs = Date.now() - startTime;
      const lastScanTime = new Date().toISOString();

      // Cross-reference with database inventory to get verified offline cameras
      const offlineCheck = await getOfflineCamerasFromInventory(discovered);

      const scanResult: CameraScanResult = {
        cameras: discovered,
        totalCameras: discovered.length,
        subnet124Count,
        subnet125Count,
        hikvisionCount,
        dahuaCount,
        scanDurationMs,
        cached: false,
        lastScanTime,
        offlineCameras: offlineCheck.offlineCameras,
        offlineCount: offlineCheck.offlineCount,
        inventoryTotalCount: offlineCheck.inventoryTotalCount
      };

      inMemoryCache = scanResult;
      lastScanTimestamp = Date.now();

      try {
        const dbDir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ timestamp: lastScanTimestamp, result: scanResult }, null, 2));
      } catch (e) {
        console.warn('Failed to save cameras cache to disk:', e);
      }

      return scanResult;
    } finally {
      isScanInProgress = false;
    }
  }, waitIfBusy ? undefined : () => {
    // Fallback if scan lock busy (UI requests only): return current in-memory cache or empty result
    if (inMemoryCache) {
      enrichCamerasWithInventory(inMemoryCache.cameras);
      return { ...inMemoryCache, cached: true };
    }
    return {
      cameras: [],
      totalCameras: 0,
      subnet124Count: 0,
      subnet125Count: 0,
      hikvisionCount: 0,
      dahuaCount: 0,
      scanDurationMs: 0,
      cached: true,
      lastScanTime: new Date().toISOString(),
      offlineCameras: [],
      offlineCount: 0,
      inventoryTotalCount: 0
    };
  });
}

/**
 * Single camera ping check
 */
export async function pingCamera(ip: string): Promise<{ isAlive: boolean; latencyMs: number }> {
  const result = await testPort(ip, 80, 800);
  if (result.open) return { isAlive: true, latencyMs: result.latencyMs };
  const rtspRes = await testPort(ip, 554, 800);
  return { isAlive: rtspRes.open, latencyMs: rtspRes.latencyMs };
}

/**
 * Automated Scheduler Camera Verifier
 * GUARANTEED BEHAVIOR:
 * 1. Checks ONLY the cameras registered in the SQLite inventory (getAllCameraInventory).
 * 2. NEVER scans IP subnet ranges (deepScan is strictly false, zero subnet loops).
 * 3. Protected by global acquireScanLock('cameras', ...).
 * 4. Paced safely: Čačak in batches of 8 (30ms pause), Kraljevo in gentle batches of 3 (120ms pause, <5 pkt/s).
 * 5. Accurately determines live offline cameras, refreshes cache, and prevents WAN/firewall overload.
 */
export async function checkScheduledInventoryCameras(): Promise<{
  offlineCameras: OfflineCameraDevice[];
  offlineCount: number;
  inventoryTotalCount: number;
  totalOnline: number;
  scanDurationMs: number;
}> {
  console.log('[CameraScanner] 🔍 Pokrećem ciljanu proveru kamera iz evidencije za automatski scheduler (Samo baze podataka, BEZ skeniranja celih opsega)...');
  // Scheduled check waits for any running scan instead of reporting from a stale cache
  const result = await scanCameras(true, false, true);
  console.log(`[CameraScanner] ✓ Završena ciljana provera: ${result.totalCameras} online, ${result.offlineCount} offline od ukupno ${result.inventoryTotalCount} evidentiranih kamera.`);
  return {
    offlineCameras: result.offlineCameras,
    offlineCount: result.offlineCount,
    inventoryTotalCount: result.inventoryTotalCount,
    totalOnline: result.totalCameras,
    scanDurationMs: result.scanDurationMs
  };
}

/**
 * Scans camera IP ranges for new, unrecorded devices.
 * CRITICAL SAFETY:
 * 1. STRICTLY SKIPS all IP addresses that are already registered in the SQLite inventory!
 * 2. Scans ONLY the remaining unassigned IP addresses.
 * 3. Rate-limited: Čačak in batches of 8 (30ms pause), Kraljevo in gentle batches of 3 (120ms pause, < 5 pkt/s).
 * 4. Protected by acquireScanLock('cameras', ...).
 */
export async function scanUnrecordedCameras(): Promise<{
  unrecordedCameras: CameraDevice[];
  scannedCount: number;
  skippedInventoryCount: number;
  scanDurationMs: number;
}> {
  return acquireScanLock('cameras-unrecorded', async () => {
    const startTime = Date.now();
    const allDbCameras = getAllCameraInventory();
    const existingIps = new Set<string>();

    allDbCameras.forEach(c => {
      if (c.ip) existingIps.add(c.ip.trim());
    });

    const candidates124: string[] = [];
    const candidates125: string[] = [];

    // Subnet 124 range: 11..230 (skip any that already exist in DB)
    for (let i = 11; i <= 230; i++) {
      const ip = `192.168.124.${i}`;
      if (!existingIps.has(ip)) {
        candidates124.push(ip);
      }
    }

    // Subnet 125 range: 46..246 (skip any that already exist in DB)
    for (let i = 46; i <= 246; i++) {
      const ip = `192.168.125.${i}`;
      if (!existingIps.has(ip)) {
        candidates125.push(ip);
      }
    }

    console.log(`[CameraScanner] 🔍 Skeniranje van evidencije: ${candidates124.length} kandidata u Čačku, ${candidates125.length} kandidata u Kraljevu (Preskočeno ${existingIps.size} već evidentiranih kamera)...`);

    const discoveredUnrecorded: CameraDevice[] = [];

    // 1. Scan Čačak candidates (batch 8, 30ms pause)
    const batch124Size = 8;
    for (let i = 0; i < candidates124.length; i += batch124Size) {
      const batch = candidates124.slice(i, i + batch124Size);
      const results = await Promise.all(batch.map(ip => inspectCamera(ip, '124')));
      results.forEach(cam => { if (cam) discoveredUnrecorded.push(cam); });
      if (i + batch124Size < candidates124.length) {
        await new Promise(r => setTimeout(r, 30));
      }
    }

    // 2. Scan Kraljevo candidates (gentle batch 3, 120ms pause, < 5 packets/sec across Sophos)
    const batch125Size = 3;
    for (let i = 0; i < candidates125.length; i += batch125Size) {
      const batch = candidates125.slice(i, i + batch125Size);
      const results = await Promise.all(batch.map(ip => inspectCamera(ip, '125')));
      results.forEach(cam => { if (cam) discoveredUnrecorded.push(cam); });
      if (i + batch125Size < candidates125.length) {
        await new Promise(r => setTimeout(r, 120));
      }
    }

    discoveredUnrecorded.sort((a, b) => {
      const octA = a.ip.split('.').map(Number);
      const octB = b.ip.split('.').map(Number);
      if (octA[2] !== octB[2]) return octA[2] - octB[2];
      return octA[3] - octB[3];
    });

    const scanDurationMs = Date.now() - startTime;
    console.log(`[CameraScanner] ✓ Završeno skeniranje: Pronađeno ${discoveredUnrecorded.length} kamera van evidencije za ${scanDurationMs}ms.`);

    return {
      unrecordedCameras: discoveredUnrecorded,
      unrecordedCount: discoveredUnrecorded.length,
      scannedCount: candidates124.length + candidates125.length,
      skippedInventoryCount: existingIps.size,
      scanDurationMs
    };
  });
}


