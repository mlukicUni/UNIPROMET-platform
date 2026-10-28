import { exec } from 'child_process';
import util from 'util';
import dns from 'dns/promises';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { getAllPrinters } from '../db/printerDb';
import { getAllRfReaders } from '../db/rfReaderDb';
import { getAllWifiAps } from '../db/wifiApDb';
import { acquireScanLock } from './scanLockManager';
import { netbiosNodeStatus } from '../utils/hostProbe';
import { publicHost } from '../utils/appConfig';

const execAsync = util.promisify(exec);

export interface LanDevice {
  ip: string;
  mac: string;
  vendor: string;
  hostname: string;
  domain?: string;
  category: 'server' | 'router' | 'workstation' | 'camera' | 'wifi' | 'voip' | 'switch' | 'other';
  categoryLabel: string;
  categoryIcon: string;
  location: string;
  locationCode: 'kraljevo' | 'ljubic' | 'cacak' | 'other';
  openPorts: number[];
  services: string[];
  status: 'online' | 'offline';
  pingMs?: number;
  arpType: string;
  lastSeen: string;
  webUrl?: string;
}

// Comprehensive OUI Vendor Prefix Map
const OUI_MAP: Record<string, string> = {
  // Virtualization & Servers
  '00:50:56': 'VMware, Inc.',
  '00:0C:29': 'VMware, Inc.',
  '00:05:69': 'VMware, Inc.',
  '00:1C:42': 'Parallels',
  '52:54:00': 'QEMU / KVM',

  // Network Infrastructure & Routing
  '00:60:97': 'Cisco Systems',
  '00:1B:D4': 'Cisco Systems',
  '00:24:14': 'Cisco Systems',
  '00:26:0B': 'Cisco Systems',
  '2C:58:B9': 'Cisco / Hikvision',
  '48:8F:5A': 'MikroTik',
  '6C:3B:6B': 'MikroTik',
  'B8:69:F4': 'MikroTik',
  'CC:2D:E0': 'MikroTik',
  'D4:01:C3': 'MikroTik',
  'E4:8D:8C': 'MikroTik',
  '08:55:31': 'MikroTik',
  '2C:C8:1B': 'MikroTik',
  '70:8B:CD': 'Ubiquiti Inc. (UniFi)',
  'E4:E7:49': 'Ubiquiti Inc. (UniFi)',
  '24:A4:3C': 'Ubiquiti Inc. (UniFi)',
  '78:8A:20': 'Ubiquiti Inc. (UniFi)',
  'B4:FB:E4': 'Ubiquiti Inc. (UniFi)',
  'F0:9F:C2': 'Ubiquiti Inc. (UniFi)',
  '00:27:22': 'Ubiquiti Inc. (UniFi)',
  '04:18:D6': 'Ubiquiti Inc. (UniFi)',
  '18:E8:29': 'Ubiquiti Inc. (UniFi)',
  'AC:8B:A9': 'Ubiquiti Inc. (UniFi)',
  '60:22:32': 'Ubiquiti Inc. (UniFi)',
  'F4:E2:C6': 'Ubiquiti Inc. (UniFi)',
  'E0:63:DA': 'Ubiquiti Inc. (UniFi)',
  '14:20:5E': 'Ubiquiti Inc. (UniFi)',
  '00:15:6D': 'Ubiquiti Inc. (UniFi)',
  '50:D4:F7': 'TP-Link Corporation',
  '00:1D:0F': 'TP-Link Corporation',
  'E8:48:B8': 'TP-Link Corporation',
  '74:DA:38': 'Edimax / TP-Link',
  'D8:07:B6': 'D-Link Corporation',

  // Workstations & Laptops (Dell)
  '00:1A:A0': 'Dell Inc.',
  '14:CB:19': 'Dell Inc.',
  '38:D5:47': 'Dell Inc.',
  '84:A9:3E': 'Dell Inc.',
  'C8:D9:D2': 'Dell Inc.',
  'D8:5E:D3': 'Dell Inc.',
  '50:9A:4C': 'Dell Inc.',
  '54:AB:3A': 'Dell Inc.',
  '74:56:3C': 'Dell Inc.',
  '80:E8:2C': 'Dell Inc.',
  'B0:6E:BF': 'Dell Inc.',
  'C8:5A:CF': 'Dell Inc.',
  'D4:BE:D9': 'Dell Inc.',
  'F8:DB:88': 'Dell Inc.',
  'F4:02:70': 'Dell Inc.',
  'E4:F0:04': 'Dell Inc.',
  'BC:30:5B': 'Dell Inc.',
  '70:B5:E8': 'Dell Inc.',
  '48:4D:7E': 'Dell Inc.',

  // Workstations & Laptops (Intel)
  'B4:B6:86': 'Intel Corporation',
  'A8:2B:DD': 'Intel Corporation',
  '7C:4D:8F': 'Intel Corporation',
  '84:2A:FD': 'Intel Corporation',
  '80:56:F2': 'Intel Corporation',
  '9C:29:76': 'Intel Corporation',
  'DC:71:96': 'Intel Corporation',
  '40:1A:58': 'Intel Corporation',
  '00:DB:70': 'Intel Corporation',
  'AC:74:B1': 'Intel Corporation',

  // Workstations & Laptops (HP)
  'C4:65:16': 'HP Inc.',
  '5C:28:86': 'HP Inc.',
  '98:E7:43': 'HP Inc.',
  '38:CA:84': 'HP Inc.',
  '4C:CC:6A': 'HP Inc.',
  '00:1E:0B': 'HP Inc.',
  '00:25:B3': 'HP Inc.',
  '2C:44:FD': 'HP Inc.',
  '70:5A:0F': 'HP Inc.',
  '9C:B6:54': 'HP Inc.',
  'A0:48:1C': 'HP Inc.',
  'B4:99:BA': 'HP Inc.',
  'E8:39:35': 'HP Inc.',

  // Lenovo / ThinkPad
  'C0:18:03': 'Lenovo (ThinkPad)',
  '64:4E:D7': 'Lenovo (ThinkPad)',
  '54:E1:AD': 'Lenovo (ThinkPad)',
  '70:CD:60': 'Lenovo (ThinkPad)',
  '98:54:1B': 'Lenovo (ThinkPad)',
  'A4:BB:6D': 'Lenovo (ThinkPad)',

  // Surveillance & CCTV Cameras
  'C4:EF:BB': 'Hikvision Digital',
  'D0:AD:08': 'Dahua Technology',
  '3C:EF:8C': 'Dahua Technology',
  'E0:50:8B': 'Hikvision Digital',
  '44:19:B6': 'Hikvision Digital',
  'AC:A2:13': 'Hikvision Digital',
  'BC:5E:CD': 'Hikvision Digital',
  '00:12:12': 'Hikvision / CCTV',
  '00:40:8C': 'Axis Communications',
  'AC:CC:8E': 'Axis Communications',
  'B8:A4:4F': 'Uniview (UNV)',

  // VoIP & IP Telephony
  '00:0B:82': 'Grandstream Networks',
  '00:15:65': 'Yealink Network',
  '80:5E:C0': 'Yealink Network',
  '24:9A:D8': 'Yealink Network',
  '00:04:F2': 'Polycom / Plantronics',
  '64:16:7F': 'Polycom / Poly',
  '00:08:5D': 'Aastra / Mitel',
  '00:04:13': 'SNOM Technology',

  // Mobile / Apple / Samsung / Misc
  '00:03:93': 'Apple Inc.',
  '00:05:02': 'Apple Inc.',
  '00:10:FA': 'Apple Inc.',
  '00:17:F2': 'Apple Inc.',
  'F0:18:98': 'Apple Inc.',
  'AC:BC:32': 'Apple Inc.',
  '00:12:FB': 'Samsung Electronics',
  '50:81:40': 'Samsung Electronics',
  '00:11:32': 'Synology Inc. (NAS)',
  '00:08:9B': 'QNAP Systems (NAS)'
};

function lookupVendor(mac: string): string {
  if (!mac) return 'Nepoznato';
  const cleanMac = mac.replace(/-/g, ':').toUpperCase();
  const prefix3 = cleanMac.substring(0, 8);
  if (OUI_MAP[prefix3]) return OUI_MAP[prefix3];

  const prefix2 = cleanMac.substring(0, 5);
  for (const [k, v] of Object.entries(OUI_MAP)) {
    if (k.startsWith(prefix2)) return v;
  }
  return 'Mrežni Uređaj';
}

/**
 * Rapid TCP Port Prober with gentle connection closing (FIN handshake)
 */
async function probePort(ip: string, port: number, timeout = 220): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(timeout);
    socket.once('connect', () => {
      if (!resolved) {
        resolved = true;
        try { socket.end(); } catch {}
        resolve(true);
      }
    });
    socket.once('timeout', () => {
      if (!resolved) {
        resolved = true;
        try { socket.destroy(); } catch {}
        resolve(false);
      }
    });
    socket.once('error', () => {
      if (!resolved) {
        resolved = true;
        try { socket.destroy(); } catch {}
        resolve(false);
      }
    });

    try {
      socket.connect(port, ip);
    } catch {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }
  });
}

/**
 * NetBIOS Name Resolver for Windows PCs, Servers and Workstations
 */
async function getNetbiosDetails(ip: string): Promise<{ name: string; domain: string } | null> {
  const names = await netbiosNodeStatus(ip, 700);
  if (!names) return null;
  const compName = names.find(n => !n.group && (n.suffix === '00' || n.suffix === '20'))?.name || '';
  const domain = names.find(n => n.group && n.suffix === '00')?.name || '';
  return compName ? { name: compName, domain } : null;
}

/**
 * Sophos-Safe, Passive & Targeted ARP Cache Warmup:
 * 1. First parses existing OS ARP table (Windows arp -a / Linux /proc/net/arp or ip neighbor) without sending any network traffic.
 * 2. Only if explicit fresh scan is requested, gently probes exclusively known inventory IPs and small batches of 4 IPs with an 80ms pause.
 * 3. Prevents Sophos XGS NPU conntrack table exhaustion or race conditions.
 */
async function warmupArpCache(knownIpsToProbe: string[] = []): Promise<void> {
  if (knownIpsToProbe.length === 0) return;

  const batchSize = 4; // Ultra-gentle batch size for Sophos XGS NPU safety
  for (let i = 0; i < knownIpsToProbe.length; i += batchSize) {
    const chunk = knownIpsToProbe.slice(i, i + batchSize);
    await Promise.all(
      chunk.map((ip) => {
        return new Promise<void>((resolve) => {
          const s = new net.Socket();
          s.setTimeout(300);
          s.once('connect', () => { try { s.destroy(); } catch {} resolve(); });
          s.once('timeout', () => { try { s.destroy(); } catch {} resolve(); });
          s.once('error', () => { try { s.destroy(); } catch {} resolve(); });
          try {
            s.connect(445, ip);
          } catch {
            resolve();
          }
        });
      })
    );
    await new Promise((r) => setTimeout(r, 80)); // 80ms pause between batches
  }
}

/**
 * Cross-Platform OS ARP Table Parser (Windows & Linux)
 */
async function getOsArpEntries(): Promise<Array<{ ip: string; mac: string; arpType: string }>> {
  const entries: Array<{ ip: string; mac: string; arpType: string }> = [];

  try {
    // 1. Try Linux /proc/net/arp if available
    if (process.platform !== 'win32' && fs.existsSync('/proc/net/arp')) {
      const content = fs.readFileSync('/proc/net/arp', 'utf-8');
      const lines = content.split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 6) {
          const ip = parts[0];
          const flags = parts[2];
          const mac = parts[3].replace(/-/g, ':').toUpperCase();
          if (flags !== '0x0' && mac !== '00:00:00:00:00:00') {
            entries.push({ ip, mac, arpType: 'dynamic' });
          }
        }
      }
      if (entries.length > 0) return entries;
    }

    // 2. Windows arp -a or fallback Linux ip neighbor / arp -a
    const { stdout } = await execAsync('arp -a');
    const lines = stdout.split('\n');

    for (const line of lines) {
      const match = line.trim().match(/^(\d+\.\d+\.\d+\.\d+)\s+([a-f0-9:-]+)\s+(dynamic|static|[0-9a-f]+)/i);
      if (match) {
        const ip = match[1];
        let mac = match[2].replace(/-/g, ':').toUpperCase();
        const arpType = match[3] || 'dynamic';

        // Normalize single-digit MAC octets if any
        const macParts = mac.split(':').map(p => p.padStart(2, '0'));
        if (macParts.length === 6) {
          mac = macParts.join(':');
          entries.push({ ip, mac, arpType });
        }
      }
    }
  } catch (err) {
    console.error('[NetworkDeviceScanner] Error reading OS ARP table:', err);
  }

  return entries;
}

const LAN_CACHE_FILE = path.join(process.cwd(), 'src', 'db', 'lan_devices_cache.json');
const LAN_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache

// In-memory cache for fast UI loading
let cachedDevices: LanDevice[] = [];
let lastScanTimestamp: number = 0;
let isScanning = false;

// Pre-load disk cache immediately on module load so server never starts cold
try {
  if (fs.existsSync(LAN_CACHE_FILE)) {
    const raw = fs.readFileSync(LAN_CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data?.devices)) {
      cachedDevices = data.devices;
      lastScanTimestamp = data.timestamp || Date.now();
    }
  }
} catch {}

/**
 * Main Network Scanner Engine
 * Discovers and enriches all non-printer active devices on the LAN
 * Sophos/WAN-Friendly: Rate-limited, reduced probe ports, protected by global scan lock
 */
export async function scanLanDevices(forceFresh = false): Promise<{ devices: LanDevice[]; scanDurationMs: number; cached: boolean }> {
  const now = Date.now();
  if (!forceFresh && cachedDevices.length > 0 && now - lastScanTimestamp < LAN_CACHE_TTL_MS) {
    return { devices: cachedDevices, scanDurationMs: 0, cached: true };
  }

  // If memory cache is empty but disk cache exists, load and return it unless forceFresh
  if (!forceFresh && cachedDevices.length === 0 && fs.existsSync(LAN_CACHE_FILE)) {
    try {
      const raw = fs.readFileSync(LAN_CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data?.devices) && data.devices.length > 0) {
        cachedDevices = data.devices;
        lastScanTimestamp = data.timestamp;
        return { devices: cachedDevices, scanDurationMs: 0, cached: true };
      }
    } catch {}
  }

  return acquireScanLock<{ devices: LanDevice[]; scanDurationMs: number; cached: boolean }>('network-devices', async () => {
    isScanning = true;
    const startTimer = Date.now();

    try {
      // 1. Get known printer, RF reader, and WiFi AP IPs to strictly exclude them
      const printers = getAllPrinters(true);
      const printerIps = new Set(printers.map(p => p.ip.replace(/_1$/, '').trim()));
      const rfReaders = getAllRfReaders();
      const rfReaderIps = new Set(rfReaders.map(r => r.ip.trim()));
      const wifiAps = getAllWifiAps();
      const wifiApIps = new Set(wifiAps.map(a => a.ip.trim()));

      // 2. Parse OS ARP Table (Zero network traffic)
      const osEntries = await getOsArpEntries();
      const rawDevices: Array<{ ip: string; mac: string; arpType: string }> = [];

      for (const entry of osEntries) {
        const { ip, mac, arpType } = entry;

        // Filter out broadcast, multicast, loopback, printers, RF readers, and WiFi APs
        if (ip.startsWith('224.') || ip.startsWith('239.') || ip.startsWith('127.') || ip.endsWith('.255') || ip === '255.255.255.255') {
          continue;
        }
        if (printerIps.has(ip)) {
          continue; // Printer - belongs in Printers tab
        }
        if (rfReaderIps.has(ip)) {
          continue; // RF Reader - belongs in RF Čitači under Evidencija
        }
        if (wifiApIps.has(ip)) {
          continue; // WiFi AP - belongs in WiFi Access Points under Evidencija
        }

        rawDevices.push({ ip, mac, arpType });
      }

      // 3. Gentle Parallel Enrichment in Batches of 8 with 40ms pause
      const enrichedDevices: LanDevice[] = [];
      const batchSize = 8;

      for (let i = 0; i < rawDevices.length; i += batchSize) {
        const batch = rawDevices.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (raw) => {
            const vendor = lookupVendor(raw.mac);
            const nbt = await getNetbiosDetails(raw.ip);

            let hostname = nbt ? nbt.name : '';
            const domain = nbt ? nbt.domain : 'UNI';

            if (!hostname) {
              try {
                const rev = await dns.reverse(raw.ip);
                if (rev && rev.length > 0) {
                  hostname = rev[0].replace(/\.unipromet\.local$/i, '').replace(/\.local$/i, '');
                }
              } catch {}
            }

            // Probe key essential ports only (445 SMB for Windows PC, 80 HTTP for Web UI)
            const targetPorts = [445, 80];
            const openPorts: number[] = [];

            const portStart = Date.now();
            await Promise.all(
              targetPorts.map(async (p) => {
                const isOpen = await probePort(raw.ip, p, 200);
                if (isOpen) openPorts.push(p);
              })
            );
            const pingEstimate = Math.max(1, Math.min(25, Date.now() - portStart));

            // Human readable service badges
            const services: string[] = [];
            if (openPorts.includes(80)) services.push('HTTP Web');
            if (openPorts.includes(445)) services.push('SMB Windows Share');

            // Device Classification & Location Detection
            let category: LanDevice['category'] = 'other';
            let categoryLabel = 'Mrežni Uređaj';
            let categoryIcon = 'cpu';

            const isGateway = raw.ip.endsWith('.1');
            const isServerIp = raw.ip.endsWith('.16') || raw.ip.endsWith('.2')
              || (raw.ip.startsWith('192.168.121.') && parseInt(raw.ip.split('.')[3], 10) >= 16 && parseInt(raw.ip.split('.')[3], 10) <= 29);
            const upperName = (hostname || '').toUpperCase().trim();
            const isServerName = upperName.includes('DC') || upperName.includes('SRV') || upperName.includes('SERVER')
              || upperName.includes('APP1') || upperName.includes('APP2') || upperName.includes('DB1') || upperName.includes('DB2')
              || upperName.includes('BI1') || upperName.includes('R730') || upperName.includes('AZURE') || upperName.includes('VEEAM')
              || upperName.includes('NAS') || upperName.includes('BACKUP');
            const hasWorkstationName = upperName.includes('-L') || upperName.includes('-D') || upperName.includes('-LK') || upperName.includes('-DK') || upperName.includes('-LN') || upperName.includes('-DN');

            // Location based on company nomenclature
            let location = 'Čačak (Centrala / Pogon)';
            let locationCode: 'kraljevo' | 'ljubic' | 'cacak' | 'other' = 'cacak';

            if (upperName.endsWith('-LK') || upperName.endsWith('-DK')) {
              location = 'Kraljevo (Proizvodnja)';
              locationCode = 'kraljevo';
            } else if (upperName.endsWith('-LN') || upperName.endsWith('-DN')) {
              location = 'Ljubić';
              locationCode = 'ljubic';
            } else if (upperName.endsWith('-L') || upperName.endsWith('-D')) {
              location = 'Čačak (Centrala / Pogon)';
              locationCode = 'cacak';
            } else if (isServerIp || isGateway || isServerName) {
              location = 'Čačak (Server Sala)';
              locationCode = 'cacak';
            } else {
              location = 'Lokalna Mreža';
              locationCode = 'other';
            }

            if (isGateway || vendor.includes('MikroTik')) {
              category = 'router';
              categoryLabel = 'Ruter / Gateway';
              categoryIcon = 'router';
              if (!hostname && isGateway) hostname = 'GATEWAY / MIKROTIK';
            } else if (hasWorkstationName) {
              category = 'workstation';
              const isLaptop = upperName.endsWith('-L') || upperName.endsWith('-LK') || upperName.endsWith('-LN') || upperName.includes('-L');
              categoryLabel = isLaptop ? 'Laptop Računar' : 'Radna Stanica (PC)';
              categoryIcon = isLaptop ? 'laptop' : 'monitor';
            } else if (isServerIp || isServerName || (openPorts.includes(445) && vendor.includes('VMware')) || vendor.includes('Synology') || vendor.includes('QNAP')) {
              category = 'server';
              categoryLabel = 'Server / DC';
              categoryIcon = 'server';
              if (raw.ip.endsWith('.16') && !hostname) hostname = 'DC2UNI / CENTRALNI SERVER';
              if (raw.ip === publicHost() && !hostname) hostname = 'UNIPROMET-ADMIN-SRV';
            } else if (openPorts.includes(445)) {
              category = 'workstation';
              categoryLabel = 'Radna Stanica (PC)';
              categoryIcon = 'monitor';
            } else if (vendor.includes('Hikvision') || vendor.includes('Dahua') || vendor.includes('Axis') || vendor.includes('Uniview')) {
              category = 'camera';
              categoryLabel = 'IP Kamera / CCTV';
              categoryIcon = 'video';
            } else if (vendor.includes('Ubiquiti') || vendor.includes('UniFi') || vendor.includes('TP-Link')) {
              category = 'wifi';
              categoryLabel = 'WiFi Pristupna Tačka';
              categoryIcon = 'wifi';
            } else if (vendor.includes('Grandstream') || vendor.includes('Yealink') || vendor.includes('Polycom')) {
              category = 'voip';
              categoryLabel = 'IP VoIP Telefon';
              categoryIcon = 'phone-call';
            }

            let webUrl: string | undefined = undefined;
            if (openPorts.includes(80)) webUrl = `http://${raw.ip}`;

            const device: LanDevice = {
              ip: raw.ip,
              mac: raw.mac,
              vendor,
              hostname: hostname || `Uređaj (${raw.ip})`,
              domain,
              category,
              categoryLabel,
              categoryIcon,
              location,
              locationCode,
              openPorts,
              services,
              status: 'online',
              pingMs: pingEstimate,
              arpType: raw.arpType,
              lastSeen: new Date().toISOString(),
              webUrl
            };

            return device;
          })
        );
        enrichedDevices.push(...batchResults);
        if (i + batchSize < rawDevices.length) {
          await new Promise(r => setTimeout(r, 40));
        }
      }

      // 4. Merge with previously cached devices so historically known PCs don't disappear if sleeping
      const deviceMap = new Map<string, LanDevice>();
      for (const prev of cachedDevices) {
        deviceMap.set(prev.ip, { ...prev, status: 'offline' });
      }
      for (const curr of enrichedDevices) {
        deviceMap.set(curr.ip, curr);
      }
      const finalDevices = Array.from(deviceMap.values());

      // Sort devices logically: Servers/Gateways first, then by IP
      finalDevices.sort((a, b) => {
        const catOrder: Record<string, number> = { router: 1, server: 2, workstation: 3, wifi: 4, camera: 5, voip: 6, switch: 7, other: 8 };
        const orderA = catOrder[a.category] || 9;
        const orderB = catOrder[b.category] || 9;
        if (orderA !== orderB) return orderA - orderB;

        // IP numerical sort
        const numA = a.ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0);
        const numB = b.ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0);
        return numA - numB;
      });

      cachedDevices = finalDevices;
      lastScanTimestamp = Date.now();
      const scanDurationMs = Date.now() - startTimer;

      try {
        const dbDir = path.dirname(LAN_CACHE_FILE);
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
        fs.writeFileSync(LAN_CACHE_FILE, JSON.stringify({ timestamp: lastScanTimestamp, devices: cachedDevices }, null, 2));
      } catch (e) {
        console.warn('Failed to save lan devices cache to disk:', e);
      }

      return { devices: cachedDevices, scanDurationMs, cached: false };
    } finally {
      isScanning = false;
    }
  }, () => {
    // Fallback if scan lock is busy: return cached devices
    return { devices: cachedDevices, scanDurationMs: 0, cached: true };
  });
}

/**
 * Detailed single device probe
 */
export async function getDeviceDeepDetails(ip: string) {
  const vendorMacMatch = cachedDevices.find(d => d.ip === ip);
  const vendor = vendorMacMatch ? vendorMacMatch.vendor : 'Mrežni Uređaj';
  const mac = vendorMacMatch ? vendorMacMatch.mac : 'Nepoznato';

  const nbt = await getNetbiosDetails(ip);
  let dnsName = '';
  try {
    const rev = await dns.reverse(ip);
    if (rev && rev.length > 0) dnsName = rev[0];
  } catch {}

  const deepPorts = [21, 22, 23, 53, 80, 88, 135, 139, 389, 443, 445, 554, 1433, 3306, 3389, 5060, 8080, 8291, 8443];
  const portResults: Array<{ port: number; name: string; isOpen: boolean }> = [];

  const portNames: Record<number, string> = {
    21: 'FTP', 22: 'SSH', 23: 'Telnet', 53: 'DNS', 80: 'HTTP', 88: 'Kerberos', 135: 'RPC', 139: 'NetBIOS',
    389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 554: 'RTSP', 1433: 'MS SQL', 3306: 'MySQL', 3389: 'RDP',
    5060: 'SIP', 8080: 'HTTP-Alt', 8291: 'Winbox', 8443: 'HTTPS-Alt'
  };

  await Promise.all(deepPorts.map(async (p) => {
    const isOpen = await probePort(ip, p, 300);
    portResults.push({ port: p, name: portNames[p] || `Port ${p}`, isOpen });
  }));

  portResults.sort((a, b) => a.port - b.port);

  return {
    ip,
    mac,
    vendor,
    netbios: nbt,
    dnsName,
    ports: portResults.filter(p => p.isOpen),
    allTestedPorts: portResults,
    timestamp: new Date().toISOString()
  };
}
