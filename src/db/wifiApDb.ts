import { getDb } from './sqlite';
import { initSchema } from './schema';
import { ArubaAp, ArubaClient, ArubaClusterSummary } from '../services/arubaService';

// In-memory cache for live clients connected to the WiFi APs
let cachedClients: ArubaClient[] = [];
let cachedSummary: ArubaClusterSummary = {
  name: 'Uni Promet',
  vcIp: '192.168.6.200',
  domain: 'CA',
  conductorIp: '192.168.6.129',
  totalAps: 34,
  totalClients: 0,
  lastSync: ''
};

interface WifiApRow {
  id: string;
  name: string;
  ip: string;
  model: string | null;
  type: string | null;
  is_outdoor: number;
  serial: string | null;
  zone: string | null;
  mode: string | null;
  clients_count: number;
  radio0_channel: string | null;
  radio0_power: string | null;
  radio0_util: string | null;
  radio0_noise: string | null;
  radio1_channel: string | null;
  radio1_power: string | null;
  radio1_util: string | null;
  radio1_noise: string | null;
  uplink_port: string | null;
  hierarchy: string | null;
  status: string | null;
  last_seen: string | null;
  updated_at: string | null;
}

function rowToAp(r: WifiApRow): ArubaAp {
  return {
    id: r.id,
    name: r.name,
    ip: r.ip,
    model: r.model || 'AP-505 (Indoor)',
    type: r.type || '',
    isOutdoor: Boolean(r.is_outdoor),
    serial: r.serial || '',
    zone: r.zone || '',
    mode: r.mode || 'access',
    clientsCount: r.clients_count || 0,
    radio0Channel: r.radio0_channel || '',
    radio0Power: r.radio0_power || '',
    radio0Util: r.radio0_util || '',
    radio0Noise: r.radio0_noise || '',
    radio1Channel: r.radio1_channel || '',
    radio1Power: r.radio1_power || '',
    radio1Util: r.radio1_util || '',
    radio1Noise: r.radio1_noise || '',
    uplinkPort: r.uplink_port || 'eth0',
    hierarchy: (r.hierarchy as 'conductor' | 'member') || 'member',
    status: (r.status as 'online' | 'offline') || 'online',
    lastSeen: r.last_seen || '',
    updatedAt: r.updated_at || ''
  };
}

/**
 * Fetch all Access Points stored in SQLite.
 */
export function getAllWifiAps(): ArubaAp[] {
  initSchema();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM wifi_access_points ORDER BY hierarchy DESC, name ASC').all() as WifiApRow[];
  return rows.map(rowToAp);
}

/**
 * Fetch single Access Point by ID or IP.
 */
export function getWifiApById(id: string): ArubaAp | null {
  initSchema();
  const db = getDb();
  const row = db.prepare('SELECT * FROM wifi_access_points WHERE id = ? OR ip = ?').get(id, id) as WifiApRow | undefined;
  return row ? rowToAp(row) : null;
}

/**
 * Insert or update Access Points batch.
 */
export function upsertWifiAps(aps: ArubaAp[]): void {
  initSchema();
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO wifi_access_points (
      id, name, ip, model, type, is_outdoor, serial, zone, mode,
      clients_count, radio0_channel, radio0_power, radio0_util, radio0_noise,
      radio1_channel, radio1_power, radio1_util, radio1_noise,
      uplink_port, hierarchy, status, last_seen, updated_at
    ) VALUES (
      @id, @name, @ip, @model, @type, @isOutdoor, @serial, @zone, @mode,
      @clientsCount, @radio0Channel, @radio0Power, @radio0Util, @radio0Noise,
      @radio1Channel, @radio1Power, @radio1Util, @radio1Noise,
      @uplinkPort, @hierarchy, @status, @lastSeen, @updatedAt
    )
    ON CONFLICT(ip) DO UPDATE SET
      name = excluded.name,
      model = excluded.model,
      type = excluded.type,
      is_outdoor = excluded.is_outdoor,
      serial = excluded.serial,
      zone = excluded.zone,
      mode = excluded.mode,
      clients_count = excluded.clients_count,
      radio0_channel = excluded.radio0_channel,
      radio0_power = excluded.radio0_power,
      radio0_util = excluded.radio0_util,
      radio0_noise = excluded.radio0_noise,
      radio1_channel = excluded.radio1_channel,
      radio1_power = excluded.radio1_power,
      radio1_util = excluded.radio1_util,
      radio1_noise = excluded.radio1_noise,
      uplink_port = excluded.uplink_port,
      hierarchy = excluded.hierarchy,
      status = excluded.status,
      last_seen = excluded.last_seen,
      updated_at = excluded.updated_at
  `);

  const runBatch = db.transaction((items: ArubaAp[]) => {
    // 1. Mark existing APs that are not in the new active list as offline
    const activeIps = new Set(items.map(i => i.ip));
    const allExisting = db.prepare('SELECT ip FROM wifi_access_points').all() as { ip: string }[];
    for (const ex of allExisting) {
      if (!activeIps.has(ex.ip)) {
        db.prepare("UPDATE wifi_access_points SET status = 'offline', clients_count = 0, updated_at = ? WHERE ip = ?").run(
          new Date().toISOString(),
          ex.ip
        );
      }
    }

    // 2. Upsert currently active APs
    for (const item of items) {
      stmt.run({
        id: item.id,
        name: item.name,
        ip: item.ip,
        model: item.model,
        type: item.type,
        isOutdoor: item.isOutdoor ? 1 : 0,
        serial: item.serial,
        zone: item.zone,
        mode: item.mode,
        clientsCount: item.clientsCount,
        radio0Channel: item.radio0Channel,
        radio0Power: item.radio0Power,
        radio0Util: item.radio0Util,
        radio0Noise: item.radio0Noise,
        radio1Channel: item.radio1Channel,
        radio1Power: item.radio1Power,
        radio1Util: item.radio1Util,
        radio1Noise: item.radio1Noise,
        uplinkPort: item.uplinkPort,
        hierarchy: item.hierarchy,
        status: item.status,
        lastSeen: item.lastSeen,
        updatedAt: item.updatedAt
      });
    }
  });

  runBatch(aps);
}

/**
 * In-memory client cache operations.
 */
export function setLiveWifiClients(clients: ArubaClient[]): void {
  cachedClients = clients;
}

export function getLiveWifiClients(apName?: string): ArubaClient[] {
  if (!apName) return cachedClients;
  const target = apName.trim().toLowerCase();
  return cachedClients.filter(c => (c.apName || '').trim().toLowerCase() === target);
}

/**
 * Cluster summary cache operations.
 */
export function setClusterSummary(summary: ArubaClusterSummary): void {
  cachedSummary = { ...cachedSummary, ...summary };
}

export function getClusterSummary(): ArubaClusterSummary {
  return cachedSummary;
}

/**
 * Syncs live AP data from Aruba Virtual Controller, updates SQLite, and returns online/offline breakdown.
 */
export async function syncAndCheckWifiAps(): Promise<{
  allAps: ArubaAp[];
  offlineAps: ArubaAp[];
  totalAps: number;
  onlineCount: number;
  offlineCount: number;
}> {
  const { fetchArubaAps, fetchArubaClients, fetchArubaSummary } = await import('../services/arubaService');
  try {
    const liveAps = await fetchArubaAps();
    if (liveAps && liveAps.length > 0) {
      upsertWifiAps(liveAps);
      fetchArubaClients().then(setLiveWifiClients).catch(() => {});
      fetchArubaSummary().then(setClusterSummary).catch(() => {});
    }
  } catch (err: any) {
    console.warn('[WiFi APs] Sync error during scheduled check:', err?.message);
  }

  const allAps = getAllWifiAps();
  const offlineAps = allAps.filter(a => a.status === 'offline');
  return {
    allAps,
    offlineAps,
    totalAps: allAps.length,
    onlineCount: allAps.length - offlineAps.length,
    offlineCount: offlineAps.length
  };
}

