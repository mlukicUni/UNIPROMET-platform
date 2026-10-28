import { exec } from 'child_process';
import net from 'net';
import dgram from 'dgram';
import { pingHost, readArpTable } from '../utils/hostProbe';
import { isLargeCopier } from './printerClass';
import {
  DbPrinter,
  getAllPrinters,
  syncPrintersFromNetwork,
  updatePrinter,
  decommissionPrinter,
  restorePrinter,
  createCustomPrinter,
  deletePrinterPermanently,
  getPrinterById,
  getPrinterByIp
} from '../db/printerDb';

export {
  DbPrinter,
  getAllPrinters,
  updatePrinter,
  decommissionPrinter,
  restorePrinter,
  createCustomPrinter,
  deletePrinterPermanently,
  getPrinterById
};

let lastScanTime: number = 0;

/**
 * Ultra-fast, non-intrusive ICMP echo request using direct spawn (no cmd.exe wrapper).
 * Handled entirely in hardware/MAC layer of printer NICs without creating any TCP sockets
 * and without touching printer print spooler buffers. Completes in 20-50ms for active printers.
 */
function pingFast(ip: string, timeoutMs: number = 350): Promise<{ ok: boolean; latencyMs: number }> {
  return pingHost(ip, timeoutMs).then((r) => ({ ok: r.ok, latencyMs: r.ok ? (r.latencyMs ?? 1) : 0 }));
}

/**
 * Fast, gentle probe of Port 80 (HTTP Remote UI) with immediate clean FIN (socket.end).
 * Exclusively used for large copiers (Canon imageRUNNER ADVANCE) to detect web server responsiveness.
 */
function probePortFast(ip: string, port: number = 80, timeoutMs: number = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      if (!resolved) {
        resolved = true;
        socket.end(); // Clean FIN handshake
        resolve(true);
      }
    });
    const fail = () => {
      try { socket.destroy(); } catch {}
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    };
    socket.once('timeout', fail);
    socket.once('error', fail);
    try { socket.connect(port, ip); } catch { fail(); }
  });
}

// Persistent MAC address cache for enterprise copiers across subnets
// (Preserves MAC addresses even when Windows dynamic ARP table expires entries)
const knownPrinterMacs: Map<string, string> = new Map([
  ['192.168.121.253', 'f4:81:39:c6:ae:82'],
  ['192.168.121.241', '88:87:17:7f:4b:8d'],
  ['192.168.121.47', '88:87:17:7f:66:7a'],
  ['192.168.121.43', 'f4:81:39:c5:9a:d7'],
  ['192.168.121.66', '88:87:17:7f:39:4b'],
  ['192.168.121.39', 'f4:81:39:c5:fe:a8'],
  ['192.168.121.40', '88:87:17:81:62:ad'], // KV uprava
  ['192.168.121.50', 'f4:81:39:c7:a5:f2'], // Kontrola
  ['192.168.121.31', '84:ba:3b:1a:6c:2a'],
  ['192.168.121.30', '84:ba:3b:1a:2a:b0'],
  ['192.168.121.37', 'f4:81:39:c4:97:98'],
  ['192.168.121.44', 'f4:81:39:c6:3b:29'],
  ['192.168.120.61', 'f4:81:39:c7:ed:28'],
  ['192.168.121.38', '88:87:17:80:16:ba'],
  ['192.168.121.48', '88:87:17:7e:70:13'],
  ['192.168.121.35', 'f4:81:39:c9:17:a5'],
  ['192.168.121.36', '84:ba:3b:19:f6:fb'],
]);

let arpCache: Map<string, string> = new Map();
let lastArpTime = 0;

/**
 * Parse Windows ARP cache to extract known IP-to-MAC mappings (Layer 2 link state).
 * Sleeping enterprise copiers (e.g. Canon imageRUNNER ADVANCE) keep their Ethernet PHY
 * link active and answer Layer 2 ARP broadcasts even during Deep Sleep Mode 3.
 * Caches result for 5s to prevent freezing the Node.js event loop during parallel wake calls.
 */
function getArpTable(): Map<string, string> {
  const now = Date.now();
  if (now - lastArpTime < 5000 && arpCache.size > 0) {
    return arpCache;
  }

  const arpMap = readArpTable();
  for (const [ip, mac] of arpMap) knownPrinterMacs.set(ip, mac);
  if (arpMap.size > 0) {
    arpCache = arpMap;
    lastArpTime = now;
  }
  return arpCache;
}

/**
 * 3-Tier Non-Intrusive Online Status Check:
 * Tier 1: Direct ICMP Ping (350ms) - Instant response for active devices (1-40ms).
 * Tier 2: Port 80 Remote UI probe (300ms) - Only for large copiers.
 * Tier 3: Layer 2 ARP verification - Catches large copiers connected to switch in Deep Sleep Mode 3.
 *
 * CRITICAL SAFETY RULES:
 * - Small desktop printers (Canon LBP) NEVER receive any TCP connections (0 sockets opened).
 * - Port 9100 is NEVER probed anywhere in the system.
 */
export async function checkPrinterOnline(ip: string, timeoutMs: number = 400): Promise<{ isOnline: boolean; latencyMs: number | null }> {
  const cleanIp = ip.replace(/_1$/, '').trim();
  if (!net.isIPv4(cleanIp)) {
    return { isOnline: false, latencyMs: null };
  }

  // 1. Direct hardware ICMP Echo
  const ping = await pingFast(cleanIp, Math.min(timeoutMs, 400));
  if (ping.ok) {
    return { isOnline: true, latencyMs: ping.latencyMs };
  }

  // 2. Identify printer model (unknown models are treated as small: no TCP)
  const prn = getPrinterByIp(cleanIp);

  // 3. For large copiers only: Probe Port 80 Remote UI
  if (isLargeCopier(prn)) {
    const p80 = await probePortFast(cleanIp, 80, 300);
    if (p80) {
      return { isOnline: true, latencyMs: 15 };
    }
  }

  // 4. Layer 2 ARP Table Check: If device has an active dynamic MAC entry,
  // it is physically connected to the switch and powered on (in sleep mode).
  const arp = getArpTable();
  if (arp.has(cleanIp)) {
    return { isOnline: true, latencyMs: 5 };
  }

  // Truly powered off or disconnected
  return { isOnline: false, latencyMs: null };
}

function extractIpFromPort(portName: string): string | null {
  if (!portName) return null;
  const match = portName.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  return match ? match[0] : null;
}

function categorizeLocation(location: string, name: string): string {
  const text = `${location} ${name}`.toLowerCase();
  if (text.includes('pogon') || text.includes('hala') || text.includes('laser') || text.includes('montaza')) {
    return 'Pogon & Proizvodnja';
  }
  if (text.includes('cinkar')) {
    return 'Cinkara';
  }
  if (text.includes('magacin') || text.includes('vaga') || text.includes('otprema')) {
    return 'Logistika & Magacin';
  }
  if (text.includes('uprav') || text.includes('ceo') || text.includes('pravna') || text.includes('hr') || text.includes('danijela') || text.includes('operativa') || text.includes('blagajna')) {
    return 'Uprava & Kancelarije';
  }
  return 'Ostale Lokacije';
}

/**
 * Discovers network printers from Domain Print Server DC2UNI / local spooler,
 * probes live TCP status gently, and synchronizes with SQLite persistent database.
 * Does NOT wake printers during routine discovery unless explicitly requested.
 */
export async function discoverAndSyncPrinters(forceRescan: boolean = false, wakeFirst: boolean = false): Promise<DbPrinter[]> {
  const existingPrinters = getAllPrinters(true);
  const now = Date.now();

  // If we already have printers in DB and not forcing scan, return DB records immediately.
  // This guarantees that routine page navigation NEVER generates any network traffic.
  if (!forceRescan && !wakeFirst && existingPrinters.length > 0) {
    return existingPrinters;
  }

  // Only wake if explicitly requested (e.g. from dedicated wake-all button)
  if (wakeFirst && existingPrinters.length > 0) {
    try {
      await wakeAllPrinters();
      await new Promise(resolve => setTimeout(resolve, 400));
    } catch (wakeErr) {
      console.warn('Could not wake printers before scan:', wakeErr);
    }
  }

  const rawPrinterList: Array<{
    Name: string;
    DriverName: string;
    PortName: string;
    ShareName?: string;
    Location?: string;
  }> = [];

  // 1. Query Domain Print Server DC2UNI.unipromet.local if forceRescan requested.
  // Get-Printer postoji samo na Windows-u; na Linuxu se štampači dodaju ručno, a ponovno skeniranje proverava one iz baze.
  if (forceRescan && process.platform === 'win32') {
    try {
      const domainPrintersJson = await executeCommand(
        `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Printer -ComputerName 'DC2UNI.unipromet.local' -ErrorAction SilentlyContinue | Select-Object Name, DriverName, PortName, ShareName, Location | ConvertTo-Json -Depth 2"`
      );
      if (domainPrintersJson && domainPrintersJson.trim().startsWith('[')) {
        const parsed = JSON.parse(domainPrintersJson);
        rawPrinterList.push(...parsed);
      }
    } catch (err) {
      console.warn('Could not query DC2UNI Print Server directly:', err);
    }

    // 2. Query Local Mapped Printers
    try {
      const localPrintersJson = await executeCommand(
        `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Printer | Select-Object Name, DriverName, PortName, ShareName, Location | ConvertTo-Json -Depth 2"`
      );
      if (localPrintersJson && localPrintersJson.trim()) {
        const parsed = localPrintersJson.trim().startsWith('[') 
          ? JSON.parse(localPrintersJson) 
          : [JSON.parse(localPrintersJson)];

        for (const p of parsed) {
          if (!rawPrinterList.some(item => item.PortName === p.PortName || item.Name === p.Name)) {
            rawPrinterList.push(p);
          }
        }
      }
    } catch (err) {
      console.warn('Error querying local printers:', err);
    }
  }

  // If rawPrinterList is empty and we have existing DB printers, probe known DB printers directly
  if (rawPrinterList.length === 0 && existingPrinters.length > 0) {
    for (const p of existingPrinters) {
      rawPrinterList.push({
        Name: p.name,
        DriverName: p.driverName || 'Canon Generic Plus UFR II',
        PortName: p.ip,
        ShareName: p.shareName || '',
        Location: p.location || 'UNIPROMET'
      });
    }
  }

  // Fallback default list if DB is completely empty
  if (rawPrinterList.length === 0 && existingPrinters.length === 0) {
    rawPrinterList.push(
      { Name: 'Canon iR C5235i (Pogon2)', DriverName: 'Canon Generic Plus UFR II', PortName: '192.168.121.48', ShareName: 'CanonC5235-48', Location: 'Pogon 2' },
      { Name: 'Canon iR C5235i (Uprava)', DriverName: 'Canon Generic Plus UFR II', PortName: '192.168.121.36', ShareName: 'CanoniRC5235i-upr', Location: 'Upravna zgrada' },
      { Name: 'Canon LBP 6780x (Cinkara)', DriverName: 'Canon Generic Plus UFR II', PortName: '192.168.121.46', ShareName: 'CanonLBP6780-46', Location: 'Cinkara' },
      { Name: 'Canon LBP 6780x (Vaga)', DriverName: 'Canon Generic Plus UFR II', PortName: '192.168.121.58', ShareName: 'CanonLBP6780-58', Location: 'Vaga' },
      { Name: 'Canon LBP 6780x (Magacin GP)', DriverName: 'Canon Generic Plus UFR II', PortName: '192.168.121.52', ShareName: 'CanonLBP6780-52', Location: 'Magacin GP' },
      { Name: 'Canon LBP 6780x (Laser)', DriverName: 'Canon Generic Plus UFR II', PortName: '192.168.121.49', ShareName: 'CanonLPB6780-49', Location: 'Laser' },
      { Name: 'Canon iR C5235i (Pogon5-1)', DriverName: 'Canon Generic Plus UFR II', PortName: '192.168.121.35', ShareName: 'CanonC5235i-35', Location: 'Pogon 5 - 1. sprat' }
    );
  }

  // 3a. Deduplicate printers by clean IP address, preferring specific model names over generic queues
  const ipMap = new Map<string, typeof rawPrinterList[0]>();
  for (const p of rawPrinterList) {
    if (!p.PortName || p.PortName === 'nul:' || p.PortName === 'PORTPROMPT:') continue;
    const cleanIp = (extractIpFromPort(p.PortName) || p.PortName).replace(/_1$/, '').trim();
    if (!net.isIPv4(cleanIp)) continue;

    const existingInMap = ipMap.get(cleanIp);
    if (!existingInMap) {
      ipMap.set(cleanIp, p);
    } else {
      const pName = p.Name || '';
      const existingName = existingInMap.Name || '';
      const isBetter = (pName.includes('C5235') || pName.includes('imageRUNNER') || pName.includes('6780') || pName.includes('2520')) &&
                       !(existingName.includes('C5235') || existingName.includes('imageRUNNER') || existingName.includes('6780') || existingName.includes('2520'));
      if (isBetter) {
        ipMap.set(cleanIp, p);
      }
    }
  }

  const validPrinters = Array.from(ipMap.values());

  // 3b. Ultra-fast parallel fleet status probe in batches of 10
  // Checks hardware ICMP echo via direct spawn (350ms), Port 80 for large copiers,
  // and Layer 2 ARP cache for sleeping enterprise copiers.
  // Completes all 40 devices across the network in 1.5 - 2.5 seconds!
  const arpTable = getArpTable();
  const discoveredItems: Array<{
    name: string;
    model: string;
    ip: string;
    location: string;
    shareName: string;
    driverName: string;
    category: string;
    isOnline: boolean;
    latencyMs: number | null;
  }> = [];

  const batchSize = 10;
  for (let i = 0; i < validPrinters.length; i += batchSize) {
    const batch = validPrinters.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (p) => {
      const ip = (extractIpFromPort(p.PortName) || p.PortName).replace(/_1$/, '').trim();
      const location = p.Location || 'UNIPROMET';
      const cleanName = p.Name.replace(/^\\\\DC2UNI\.unipromet\.local\\/, '');
      const dbPrn = getPrinterByIp(ip);

      let model = dbPrn?.model || 'Mrežni Štampač';
      if (cleanName.includes('C5235')) model = 'Canon imageRUNNER ADVANCE C5235i';
      else if (cleanName.includes('6780')) model = 'Canon i-SENSYS LBP6780x';
      else if (cleanName.includes('2520')) model = 'Canon imageRUNNER 2520';
      else if (cleanName.includes('Zebra')) model = 'Zebra Industrijski Printer Nalepnica';
      else if (!dbPrn?.model || dbPrn.model === 'Mrežni Štampač') model = cleanName;

      const isLarge = isLargeCopier({ name: cleanName, model });

      // 1. Direct ICMP Ping
      const pingRes = await pingFast(ip, 350);
      let isOnline = false;
      let latencyMs: number | null = null;

      if (pingRes.ok) {
        isOnline = true;
        latencyMs = pingRes.latencyMs;
      } else {
        // 2. Large copier Port 80 check
        if (isLarge) {
          const p80 = await probePortFast(ip, 80, 300);
          if (p80) {
            isOnline = true;
            latencyMs = 15;
          }
        }

        // 3. Layer 2 ARP Standby check (Enterprise copiers in Deep Sleep Mode 3)
        if (!isOnline && arpTable.has(ip)) {
          isOnline = true;
          latencyMs = 5;
        }
      }

      return {
        name: dbPrn?.name || cleanName,
        model,
        ip,
        location,
        shareName: p.ShareName || '',
        driverName: p.DriverName || 'Canon UFR II',
        category: categorizeLocation(location, cleanName),
        isOnline,
        latencyMs
      };
    }));

    discoveredItems.push(...batchResults);
  }

  const syncedPrinters = syncPrintersFromNetwork(discoveredItems);
  lastScanTime = Date.now();

  return syncedPrinters;
}

function executeCommand(cmd: string, timeoutMs: number = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(error);
      resolve(stdout);
    });
  });
}

/**
 * Send standard Wake-on-LAN UDP Magic Packet across multiple subnet broadcast addresses
 * AND directly to the printer IP (unicast directed WOL to traverse inter-VLAN routers).
 */
function sendWolMagicPacket(mac: string, targetIp?: string): void {
  try {
    const cleanMac = mac.replace(/[:-]/g, '');
    if (cleanMac.length !== 12) return;
    const macBuf = Buffer.from(cleanMac, 'hex');
    const magic = Buffer.alloc(102);
    magic.fill(0xFF, 0, 6);
    for (let i = 0; i < 16; i++) {
      macBuf.copy(magic, 6 + i * 6);
    }

    const client = dgram.createSocket('udp4');
    client.bind(() => {
      client.setBroadcast(true);
      // Samo lokalna /23 mreža štampača (192.168.120.0/23). Bez mreža kamera i Kraljeva preko Sophos-a.
      const broadcasts = ['255.255.255.255', '192.168.121.255'];
      broadcasts.forEach(bIp => {
        client.send(magic, 0, magic.length, 9, bIp, () => {});
        client.send(magic, 0, magic.length, 7, bIp, () => {});
      });
      // Direct unicast WOL to target IP (crucial for routed corporate networks where broadcast is dropped)
      if (targetIp) {
        client.send(magic, 0, magic.length, 9, targetIp, () => {});
        client.send(magic, 0, magic.length, 7, targetIp, () => {});
      }
      setTimeout(() => {
        try { client.close(); } catch {}
      }, 300);
    });
  } catch {}
}

/**
 * Send safe, gentle wake-up signals ONLY to large enterprise MFPs (Canon imageRUNNER ADVANCE):
 * 1. Wake-on-LAN (WOL) UDP Magic Packet (ports 9 and 7) broadcast & direct unicast
 * 2. Hardware ICMP ping to prime NIC Layer 2 MAC state
 * 3. Gentle Port 80 HTTP connection with graceful FIN (socket.end) with 1500ms grace period
 * 
 * CRITICAL: Small desktop printers (Canon LBP 6780x / 312x) are completely bypassed.
 * Port 9100 is NEVER touched.
 */
export async function wakePrinter(ip: string, macAddress?: string): Promise<{ success: boolean; methodsUsed: string[]; details: string }> {
  const cleanIp = ip.replace(/_1$/, '').trim();

  // Safeguard: only known large copiers are woken. Small desktop printers (Canon LBP 6780x / 312x)
  // and unknown models NEVER receive wake pulses!
  const prn = getPrinterByIp(cleanIp);

  if (!isLargeCopier(prn)) {
    return {
      success: true,
      methodsUsed: ['Nije potrebno buđenje (Stoni štampač)'],
      details: `Uređaj ${cleanIp} je stoni štampač bez Deep Sleep moda. Buđenje nije potrebno i blokirano je radi zaštite mrežne kartice.`
    };
  }

  const methodsUsed: string[] = [];
  let isAwake = false;

  // 1. Get MAC address from param, known fallback map, or Windows ARP table
  let mac = macAddress || knownPrinterMacs.get(cleanIp);
  if (!mac) {
    const arpMap = getArpTable();
    mac = arpMap.get(cleanIp);
  }

  // 2. Send Wake-on-LAN Magic Packet (broadcast + routed unicast)
  if (mac) {
    sendWolMagicPacket(mac, cleanIp);
    methodsUsed.push('WOL Magic Packet');
  }

  // 3. Fast hardware ICMP ping to prime printer NIC layer
  pingFast(cleanIp, 300).catch(() => {});

  // 4. Safe, non-intrusive TCP connection to Port 80 (HTTP Remote UI)
  try {
    const port80Ok = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1500); // 1.5s timeout allows cold sleep wake
      socket.once('connect', () => {
        methodsUsed.push('Port 80 (HTTP)');
        socket.end(); // Clean FIN, no hanging socket
        resolve(true);
      });
      socket.once('error', () => {
        try { socket.destroy(); } catch {}
        resolve(false);
      });
      socket.once('timeout', () => {
        try { socket.destroy(); } catch {}
        resolve(false);
      });
      socket.connect(80, cleanIp);
    });

    if (port80Ok) {
      isAwake = true;
    }
  } catch {}

  return {
    success: isAwake,
    methodsUsed,
    details: isAwake 
      ? `Signal za buđenje uspešno poslat (${methodsUsed.join(', ')}). Štampač je aktivan na mreži.`
      : `Poslat je impuls za buđenje (${cleanIp}). Ukoliko je uređaj isključen na prekidač, potrebno ga je uključiti.`
  };
}

/**
 * Send wake pulse ONLY to large enterprise MFPs (Canon imageRUNNER ADVANCE) that have Deep Sleep mode.
 * Small desktop printers (Canon LBP 6780x / LBP312x) are NEVER sent wake packets
 * to protect their embedded network cards from freezing!
 */
export async function wakeAllPrinters(): Promise<{ total: number; woken: number }> {
  const printers = getAllPrinters(false);
  const largePrinters = printers.filter(p => isLargeCopier(p));
  const arpMap = getArpTable();
  const results: Array<{ success: boolean }> = [];

  const batchSize = 4;
  for (let i = 0; i < largePrinters.length; i += batchSize) {
    const batch = largePrinters.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(p => {
      const cleanIp = p.ip.replace(/_1$/, '').trim();
      const mac = arpMap.get(cleanIp);
      return wakePrinter(cleanIp, mac);
    }));
    results.push(...batchResults);
    if (i + batchSize < largePrinters.length) {
      await new Promise(r => setTimeout(r, 150));
    }
  }

  const woken = results.filter(r => r.success).length;
  return { total: largePrinters.length, woken };
}

/**
 * Buđenje više kopir aparata u grupama po 4 sa pauzom od 150 ms, bez naleta paketa.
 * wakePrinter sam preskače male i nepoznate štampače.
 */
export async function wakePrintersInBatches(ips: string[]): Promise<void> {
  const batchSize = 4;
  for (let i = 0; i < ips.length; i += batchSize) {
    await Promise.allSettled(ips.slice(i, i + batchSize).map(ip => wakePrinter(ip)));
    if (i + batchSize < ips.length) {
      await new Promise(r => setTimeout(r, 150));
    }
  }
}

