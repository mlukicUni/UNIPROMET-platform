import snmp from 'net-snmp';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/sqlite';
import { readArpTable } from '../utils/hostProbe';

export interface SwitchPortDevice {
  mac: string;
  ip?: string;
  hostname?: string;
  vendor?: string;
  deviceType?: string;
  isLocalHost?: boolean;
}

export interface SwitchPortInfo {
  index: string;
  portNumber: number;
  name: string;
  descr: string;
  type: number;
  adminStatus: number; // 1 = UP/Enabled, 2 = DOWN/Disabled
  operStatus: number;  // 1 = LINK UP, 2 = LINK DOWN
  speedMbps: number;
  alias: string;
  macAddresses: string[];
  devices: SwitchPortDevice[];
  isUplink: boolean;
  inOctets: number;
  outOctets: number;
  inUcastPkts: number;
  outUcastPkts: number;
  inErrors: number;
  outErrors: number;
  inDiscards: number;
  outDiscards: number;
}

export interface SwitchDetails {
  id: string;
  name: string;
  ip: string;
  model: string;
  sysDescr: string;
  sysLocation: string;
  sysContact: string;
  uptimeMinutes: number;
  uptimeText: string;
  community: string;
  isOnline: boolean;
  totalInterfaces: number;
  physicalPortsCount: number;
  activePortsCount: number;
  inactivePortsCount: number;
  disabledPortsCount: number;
  ports: SwitchPortInfo[];
  lastScannedAt: string;
  error?: string;
}

const SWITCH_IP = '192.168.120.25';
const COMMUNITY = 'unipromet-snmp';

let cachedSwitchDetails: SwitchDetails | null = null;
let lastCacheTime = 0;
let inflightScanPromise: Promise<SwitchDetails> | null = null;

// Comprehensive OUI Prefix Map for vendor identification
const OUI_MAP: Record<string, { vendor: string; type: string }> = {
  '00:0b:82': { vendor: 'Grandstream Networks, Inc.', type: 'VoIP Telefon' },
  '00:1a:eb': { vendor: 'Allied Telesis Labs', type: 'Mrežni Svič / Uređaj' },
  '00:50:56': { vendor: 'VMware, Inc.', type: 'Virtuelna Mašina / Server' },
  '00:0c:29': { vendor: 'VMware, Inc.', type: 'Virtuelna Mašina / Server' },
  '00:05:69': { vendor: 'VMware, Inc.', type: 'Virtuelna Mašina / Server' },
  '34:8a:12': { vendor: 'HP Enterprise / Aruba', type: 'WiFi Pristupna Tačka (AP)' },
  'c0:74:ad': { vendor: 'Hikvision Digital Technology', type: 'IP Video Nadzor (Kamera)' },
  '6c:c4:9f': { vendor: 'Hikvision / Dahua', type: 'IP Video Nadzor (Kamera)' },
  '4c:cc:6a': { vendor: 'Hikvision Digital Technology', type: 'IP Video Nadzor (Kamera)' },
  '5c:60:ba': { vendor: 'Dell Inc.', type: 'Računar (PC / Laptop)' },
  '84:2a:fd': { vendor: 'Dell Inc.', type: 'Računar (PC / Laptop)' },
  '18:66:da': { vendor: 'Dell Inc.', type: 'Računar (PC / Laptop)' },
  'e4:b9:7a': { vendor: 'Dell Inc. / Intel', type: 'Radna Stanica / Server' },
  '2c:58:b9': { vendor: 'Cisco Systems / Hikvision', type: 'Mrežni Uređaj' },
  '74:fe:ce': { vendor: 'Apple Inc.', type: 'Mobilni Uređaj / Mac' },
  'ec:74:d7': { vendor: 'HP Inc.', type: 'Mrežni Štampač / PC' },
  'd8:5e:d3': { vendor: 'Ricoh Company Ltd.', type: 'Mrežni Štampač / MFP' },
  '70:8b:cd': { vendor: 'Ubiquiti Networks', type: 'UniFi Mrežna Oprema' },
  '48:8f:5a': { vendor: 'MikroTik', type: 'Ruter / Čvorište' },
  '6c:3b:6b': { vendor: 'MikroTik', type: 'Ruter / Čvorište' },
  'b8:69:f4': { vendor: 'MikroTik', type: 'Ruter / Čvorište' },
  '00:60:97': { vendor: 'Cisco Systems', type: 'Mrežni Ruter / Svič' },
  '00:26:0b': { vendor: 'Cisco Systems', type: 'Mrežni Ruter / Svič' },
  '00:08:9b': { vendor: 'QNAP Systems', type: 'NAS Skladište' },
  '00:11:32': { vendor: 'Synology Inc.', type: 'NAS Skladište' }
};

function formatUptime(uptimeHundredths: number): { minutes: number; text: string } {
  const totalSeconds = Math.floor(uptimeHundredths / 100);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  let text = '';
  if (days > 0) text += `${days}d `;
  if (hours > 0 || days > 0) text += `${hours}h `;
  text += `${minutes}m`;

  return { minutes: Math.floor(totalSeconds / 60), text };
}

/**
 * Builds an internal lookup map of known MAC addresses to IP, Hostname, Vendor, and Device Type
 * by checking local host interfaces, OS ARP cache, SQLite database, and LAN cache.
 * NO outbound network scans or sweeps are performed!
 */
function buildMacLookupMap(): Map<string, SwitchPortDevice> {
  const map = new Map<string, SwitchPortDevice>();

  // 1. Local Host interfaces (Server running Admin Panel)
  try {
    const hostname = os.hostname();
    const ifaces = os.networkInterfaces();
    for (const addrs of Object.values(ifaces)) {
      if (!addrs) continue;
      for (const a of addrs) {
        if (a.mac && a.mac !== '00:00:00:00:00:00') {
          const norm = a.mac.toLowerCase().replace(/-/g, ':');
          // Prefer IPv4
          const isIpv4 = a.family === 'IPv4' || (a as any).family === 4;
          if (!map.has(norm) || isIpv4) {
            map.set(norm, {
              mac: norm,
              ip: a.address,
              hostname,
              vendor: 'Lokalni Server / Admin Panel',
              deviceType: 'Server',
              isLocalHost: true
            });
          }
        }
      }
    }
  } catch {}

  // 2. OS ARP Cache (from standard OS arp -a command)
  for (const [ip, mac] of readArpTable()) {
    if (!map.has(mac)) {
      map.set(mac, { mac, ip, hostname: '', vendor: '', deviceType: '' });
    } else if (!map.get(mac)!.ip) {
      map.get(mac)!.ip = ip;
    }
  }

  // 3. SQLite Database tables (Printers, Cameras, RF Readers, WiFi APs, Network Equipment)
  try {
    const db = getDb();

    // Printers
    try {
      const printers = db.prepare('SELECT ip, mac, name, model FROM printers WHERE mac IS NOT NULL').all() as any[];
      for (const p of printers) {
        if (p.mac) {
          const mac = p.mac.toLowerCase().replace(/-/g, ':');
          const existing = map.get(mac) || { mac, ip: '', hostname: '', vendor: '', deviceType: '' };
          map.set(mac, {
            ...existing,
            ip: existing.ip || p.ip,
            hostname: existing.hostname || p.name,
            vendor: existing.vendor || p.model || 'Mrežni Štampač',
            deviceType: 'Štampač'
          });
        }
      }
    } catch {}

    // Cameras
    try {
      const cameras = db.prepare('SELECT ip, mac, name, location FROM camera_inventory WHERE mac IS NOT NULL').all() as any[];
      for (const c of cameras) {
        if (c.mac) {
          const mac = c.mac.toLowerCase().replace(/-/g, ':');
          const existing = map.get(mac) || { mac, ip: '', hostname: '', vendor: '', deviceType: '' };
          map.set(mac, {
            ...existing,
            ip: existing.ip || c.ip,
            hostname: existing.hostname || c.name,
            vendor: existing.vendor || 'IP Video Nadzor',
            deviceType: 'Kamera'
          });
        }
      }
    } catch {}

    // WiFi APs
    try {
      const aps = db.prepare('SELECT ip, mac, name, model FROM wifi_aps WHERE mac IS NOT NULL').all() as any[];
      for (const ap of aps) {
        if (ap.mac) {
          const mac = ap.mac.toLowerCase().replace(/-/g, ':');
          const existing = map.get(mac) || { mac, ip: '', hostname: '', vendor: '', deviceType: '' };
          map.set(mac, {
            ...existing,
            ip: existing.ip || ap.ip,
            hostname: existing.hostname || ap.name,
            vendor: existing.vendor || ap.model || 'Aruba Instant On',
            deviceType: 'WiFi AP'
          });
        }
      }
    } catch {}

    // RF Readers
    try {
      const readers = db.prepare('SELECT ip, mac, name, location FROM rf_readers WHERE mac IS NOT NULL').all() as any[];
      for (const r of readers) {
        if (r.mac) {
          const mac = r.mac.toLowerCase().replace(/-/g, ':');
          const existing = map.get(mac) || { mac, ip: '', hostname: '', vendor: '', deviceType: '' };
          map.set(mac, {
            ...existing,
            ip: existing.ip || r.ip,
            hostname: existing.hostname || r.name,
            vendor: existing.vendor || 'RFID Terminal',
            deviceType: 'RF Čitač'
          });
        }
      }
    } catch {}
  } catch {}

  // 4. LAN Devices Cache file (contains computers, hostnames, and IP mappings)
  try {
    const lanCachePath = path.join(process.cwd(), 'src', 'db', 'lan_devices_cache.json');
    if (fs.existsSync(lanCachePath)) {
      const raw = fs.readFileSync(lanCachePath, 'utf8');
      const data = JSON.parse(raw);
      const devices = data.devices || (Array.isArray(data) ? data : []);
      for (const d of devices) {
        if (d.mac) {
          const mac = d.mac.toLowerCase().replace(/-/g, ':');
          const existing = map.get(mac) || { mac, ip: '', hostname: '', vendor: '', deviceType: '' };
          map.set(mac, {
            ...existing,
            ip: existing.ip || d.ip,
            hostname: existing.hostname || d.hostname,
            vendor: existing.vendor || d.vendor,
            deviceType: existing.deviceType || d.categoryLabel || d.category || 'Računar'
          });
        }
      }
    }
  } catch {}

  return map;
}

/**
 * Resolves details for a single MAC address using our pre-built map and OUI database.
 */
function resolveMacDevice(mac: string, lookupMap: Map<string, SwitchPortDevice>): SwitchPortDevice {
  const norm = mac.toLowerCase().replace(/-/g, ':');
  const existing = lookupMap.get(norm);

  let ip = existing?.ip || '';
  let hostname = existing?.hostname || '';
  let vendor = existing?.vendor || '';
  let deviceType = existing?.deviceType || '';
  const isLocalHost = !!existing?.isLocalHost;

  // If vendor or deviceType still missing, check OUI prefix table
  if (!vendor || !deviceType) {
    const prefix = norm.substring(0, 8);
    const oui = OUI_MAP[prefix];
    if (oui) {
      if (!vendor) vendor = oui.vendor;
      if (!deviceType) deviceType = oui.type;
    }
  }

  return {
    mac: norm,
    ip,
    hostname,
    vendor,
    deviceType,
    isLocalHost
  };
}

/**
 * Queries the Allied Telesis switch at 192.168.120.25 via SNMP v2c
 * to retrieve full port status, link speeds, uptime, system info, traffic counters,
 * and FDB MAC mappings resolved against local asset and ARP tables.
 */
export async function fetchSwitchDetails(ip: string = SWITCH_IP, force: boolean = false): Promise<SwitchDetails> {
  const now = Date.now();
  if (!force && cachedSwitchDetails && (now - lastCacheTime < 15000)) {
    return cachedSwitchDetails;
  }

  if (inflightScanPromise) {
    return inflightScanPromise;
  }

  inflightScanPromise = (async () => {
    try {
      const session = snmp.createSession(ip, COMMUNITY, {
        version: snmp.Version2c,
        timeout: 3000,
        retries: 1
      });

      // 1. Fetch System OIDs
      const sysOids = [
        '1.3.6.1.2.1.1.1.0', // sysDescr
        '1.3.6.1.2.1.1.3.0', // sysUpTime
        '1.3.6.1.2.1.1.4.0', // sysContact
        '1.3.6.1.2.1.1.5.0', // sysName
        '1.3.6.1.2.1.1.6.0', // sysLocation
        '1.3.6.1.2.1.2.1.0'  // ifNumber
      ];

      const sysData: any = await new Promise((resolve) => {
        session.get(sysOids, (err, varbinds) => {
          if (err || !varbinds) return resolve(null);
          resolve(varbinds);
        });
      });

      if (!sysData || snmp.isVarbindError(sysData[0])) {
        session.close();
        const fallback: SwitchDetails = {
          id: 'sw-ca1-sw25',
          name: 'CA1-SW25',
          ip,
          model: 'Allied Telesis (AlliedWare Plus)',
          sysDescr: 'Nema SNMP odziva (Isključen ili blokiran)',
          sysLocation: 'IT Sektor',
          sysContact: 'IT Služba',
          uptimeMinutes: 0,
          uptimeText: 'Nije dostupno',
          community: COMMUNITY,
          isOnline: false,
          totalInterfaces: 0,
          physicalPortsCount: 28,
          activePortsCount: 0,
          inactivePortsCount: 28,
          disabledPortsCount: 0,
          ports: [],
          lastScannedAt: new Date().toISOString(),
          error: 'SNMP konekcija nije uspela'
        };
        cachedSwitchDetails = fallback;
        lastCacheTime = Date.now();
        return fallback;
      }

      const sysDescr = sysData[0]?.value ? sysData[0].value.toString() : 'Allied Telesis Switch';
      const sysUpTimeRaw = sysData[1]?.value ? Number(sysData[1].value) : 0;
      const sysContact = sysData[2]?.value ? sysData[2].value.toString() : '';
      const sysName = sysData[3]?.value ? sysData[3].value.toString() : 'CA1-SW25';
      const sysLocation = sysData[4]?.value ? sysData[4].value.toString() : 'IT Sektor';
      const ifNumber = sysData[5]?.value ? Number(sysData[5].value) : 0;

      const uptimeInfo = formatUptime(sysUpTimeRaw);

      // Parse model from sysDescr
      let model = 'Allied Telesis AT-FS708';
      if (sysDescr.includes('AlliedWare Plus')) {
        const match = sysDescr.match(/Software \([^)]+\) Version ([^\s,]+)/);
        const verStr = match ? `(AlliedWare Plus v${match[1]})` : '(AlliedWare Plus)';
        model = `Allied Telesis Switch ${verStr}`;
      }

      // 2. Fetch ifXTable (1.3.6.1.2.1.31.1.1.1) for Port Names, Speeds & Aliases
      const portsMap = new Map<string, Partial<SwitchPortInfo>>();

      await new Promise<void>((resolve) => {
        session.subtree('1.3.6.1.2.1.31.1.1.1', (vbs) => {
          for (const vb of vbs) {
            if (!vb || snmp.isVarbindError(vb)) continue;
            const parts = vb.oid.split('.');
            const col = parts[parts.length - 2];
            const idx = parts[parts.length - 1];

            if (!portsMap.has(idx)) {
              portsMap.set(idx, {
                index: idx,
                macAddresses: [],
                devices: [],
                inOctets: 0,
                outOctets: 0,
                inUcastPkts: 0,
                outUcastPkts: 0,
                inErrors: 0,
                outErrors: 0,
                inDiscards: 0,
                outDiscards: 0,
                isUplink: false
              });
            }
            const item = portsMap.get(idx)!;

            if (col === '1') item.name = Buffer.isBuffer(vb.value) ? vb.value.toString() : String(vb.value);
            if (col === '15') item.speedMbps = Number(vb.value);
            if (col === '18') item.alias = Buffer.isBuffer(vb.value) ? vb.value.toString() : String(vb.value);
          }
        }, () => resolve());
      });

      // 3. Fetch standard ifTable (1.3.6.1.2.1.2.2.1) for type, admin/oper status, and traffic counters
      await new Promise<void>((resolve) => {
        session.subtree('1.3.6.1.2.1.2.2.1', (vbs) => {
          for (const vb of vbs) {
            if (!vb || snmp.isVarbindError(vb)) continue;
            const parts = vb.oid.split('.');
            const col = parts[parts.length - 2];
            const idx = parts[parts.length - 1];

            if (portsMap.has(idx)) {
              const item = portsMap.get(idx)!;
              if (col === '2') item.descr = Buffer.isBuffer(vb.value) ? vb.value.toString() : String(vb.value);
              if (col === '3') item.type = Number(vb.value);
              if (col === '7') item.adminStatus = Number(vb.value);
              if (col === '8') item.operStatus = Number(vb.value);
              if (col === '10') item.inOctets = Number(vb.value);
              if (col === '11') item.inUcastPkts = Number(vb.value);
              if (col === '13') item.inDiscards = Number(vb.value);
              if (col === '14') item.inErrors = Number(vb.value);
              if (col === '16') item.outOctets = Number(vb.value);
              if (col === '17') item.outUcastPkts = Number(vb.value);
              if (col === '19') item.outDiscards = Number(vb.value);
              if (col === '20') item.outErrors = Number(vb.value);
            }
          }
        }, () => resolve());
      });

      // 4. Fetch FDB MAC Table (dot1dTpFdbPort 1.3.6.1.2.1.17.4.3.1.2)
      const bridgeToIfIndex = new Map<number, string>();
      await new Promise<void>((resolve) => {
        session.subtree('1.3.6.1.2.1.17.1.4.1.2', (vbs) => {
          for (const vb of vbs) {
            if (!vb || snmp.isVarbindError(vb)) continue;
            const parts = vb.oid.split('.');
            const bridgePortNum = Number(parts[parts.length - 1]);
            const ifIndexVal = String(vb.value);
            bridgeToIfIndex.set(bridgePortNum, ifIndexVal);
          }
        }, () => resolve());
      });

      await new Promise<void>((resolve) => {
        session.subtree('1.3.6.1.2.1.17.4.3.1.2', (vbs) => {
          for (const vb of vbs) {
            if (!vb || snmp.isVarbindError(vb)) continue;
            const parts = vb.oid.split('.');
            if (parts.length >= 6) {
              const macBytes = parts.slice(parts.length - 6);
              const macHex = macBytes.map(b => parseInt(b, 10).toString(16).padStart(2, '0')).join(':');
              const bridgePort = Number(vb.value);

              // Map bridgePort to ifIndex (or fallback to AlliedWare 5000 + bridgePort)
              let targetIfIndex = bridgeToIfIndex.get(bridgePort);
              if (!targetIfIndex) {
                targetIfIndex = String(5000 + bridgePort);
              }

              if (portsMap.has(targetIfIndex)) {
                const p = portsMap.get(targetIfIndex)!;
                if (!p.macAddresses) p.macAddresses = [];
                if (!p.macAddresses.includes(macHex)) {
                  p.macAddresses.push(macHex);
                }
              }
            }
          }
        }, () => resolve());
      });

      session.close();

      // Build MAC to Asset/IP lookup map from local system
      const macLookupMap = buildMacLookupMap();

      // Filter for physical Ethernet ports (type === 6)
      const physicalPorts: SwitchPortInfo[] = [];
      let activePortsCount = 0;
      let disabledPortsCount = 0;

      // Sort port entries by numerical index
      const sortedKeys = Array.from(portsMap.keys()).sort((a, b) => Number(a) - Number(b));
      let portSeq = 1;

      for (const k of sortedKeys) {
        const p = portsMap.get(k)!;
        if (p.type === 6) { // Ethernet
          const operUp = p.operStatus === 1;
          const adminUp = p.adminStatus === 1;

          if (operUp) activePortsCount++;
          if (!adminUp) disabledPortsCount++;

          const macList = p.macAddresses || [];
          const isUplink = macList.length > 2;

          // Resolve device info for each MAC address
          const devices: SwitchPortDevice[] = macList.map(mac => resolveMacDevice(mac, macLookupMap));

          physicalPorts.push({
            index: p.index || k,
            portNumber: portSeq++,
            name: p.name || p.descr || `Port ${k}`,
            descr: p.descr || p.name || '',
            type: p.type || 6,
            adminStatus: p.adminStatus || 1,
            operStatus: p.operStatus || 2,
            speedMbps: p.speedMbps || 0,
            alias: p.alias || '',
            macAddresses: macList,
            devices,
            isUplink,
            inOctets: p.inOctets || 0,
            outOctets: p.outOctets || 0,
            inUcastPkts: p.inUcastPkts || 0,
            outUcastPkts: p.outUcastPkts || 0,
            inErrors: p.inErrors || 0,
            outErrors: p.outErrors || 0,
            inDiscards: p.inDiscards || 0,
            outDiscards: p.outDiscards || 0
          });
        }
      }

      const totalPhysical = physicalPorts.length || 28;
      const inactivePortsCount = totalPhysical - activePortsCount;

      const result: SwitchDetails = {
        id: 'sw-ca1-sw25',
        name: sysName,
        ip,
        model,
        sysDescr,
        sysLocation,
        sysContact,
        uptimeMinutes: uptimeInfo.minutes,
        uptimeText: uptimeInfo.text,
        community: COMMUNITY,
        isOnline: true,
        totalInterfaces: ifNumber,
        physicalPortsCount: totalPhysical,
        activePortsCount,
        inactivePortsCount,
        disabledPortsCount,
        ports: physicalPorts,
        lastScannedAt: new Date().toISOString()
      };

      cachedSwitchDetails = result;
      lastCacheTime = Date.now();
      return result;

    } catch (err: any) {
      console.error('Error fetching switch SNMP details:', err);
      const fallback: SwitchDetails = {
        id: 'sw-ca1-sw25',
        name: 'CA1-SW25',
        ip,
        model: 'Allied Telesis (AlliedWare Plus)',
        sysDescr: 'Greška pri čitanju SNMP podataka',
        sysLocation: 'IT Sektor',
        sysContact: 'IT Služba',
        uptimeMinutes: 0,
        uptimeText: 'Nije dostupno',
        community: COMMUNITY,
        isOnline: false,
        totalInterfaces: 0,
        physicalPortsCount: 28,
        activePortsCount: 0,
        inactivePortsCount: 28,
        disabledPortsCount: 0,
        ports: [],
        lastScannedAt: new Date().toISOString(),
        error: err?.message || 'Greška'
      };
      cachedSwitchDetails = fallback;
      lastCacheTime = Date.now();
      return fallback;
    } finally {
      inflightScanPromise = null;
    }
  })();

  return inflightScanPromise;
}

/**
 * Returns a high-level list of managed switches.
 * Currently exclusively contains the single switch CA1-SW25 at 192.168.120.25 as requested.
 */
export async function getAllSwitches(force: boolean = false): Promise<{
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
  totalPhysicalPorts: number;
  activePortsCount: number;
  switches: Array<Omit<SwitchDetails, 'ports'> & { activePortsCount: number; totalPorts: number }>;
}> {
  const details = await fetchSwitchDetails(SWITCH_IP, force);

  const summaryItem = {
    id: details.id,
    name: details.name,
    ip: details.ip,
    model: details.model,
    sysDescr: details.sysDescr,
    sysLocation: details.sysLocation,
    sysContact: details.sysContact,
    uptimeMinutes: details.uptimeMinutes,
    uptimeText: details.uptimeText,
    community: details.community,
    isOnline: details.isOnline,
    totalInterfaces: details.totalInterfaces,
    physicalPortsCount: details.physicalPortsCount,
    totalPorts: details.physicalPortsCount,
    activePortsCount: details.activePortsCount,
    inactivePortsCount: details.inactivePortsCount,
    disabledPortsCount: details.disabledPortsCount,
    lastScannedAt: details.lastScannedAt,
    error: details.error
  };

  return {
    totalCount: 1,
    onlineCount: details.isOnline ? 1 : 0,
    offlineCount: details.isOnline ? 0 : 1,
    totalPhysicalPorts: details.physicalPortsCount,
    activePortsCount: details.activePortsCount,
    switches: [summaryItem]
  };
}
