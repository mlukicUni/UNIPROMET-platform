import { getDb } from './sqlite';
import { initSchema } from './schema';
import net from 'net';
import { pingHost } from '../utils/hostProbe';

export interface RfReaderItem {
  id: string;
  name: string;
  location: string;
  direction: 'Prijava' | 'Odjava' | 'Ručni unos' | string;
  ip: string;
  port: number;
  model: string;
  status: 'online' | 'offline' | 'warning';
  latencyMs?: number;
  latency_ms?: number;
  lastSeen?: string;
  last_seen?: string;
  lastPingAt?: string;
  last_ping_at?: string;
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

interface RfReaderRow {
  id: string;
  name: string;
  location: string;
  direction: string;
  ip: string;
  port: number;
  model: string;
  status: string;
  latency_ms: number | null;
  last_seen: string | null;
  last_ping_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string | null;
}

function rowToItem(row: RfReaderRow): RfReaderItem {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    direction: row.direction,
    ip: row.ip,
    port: row.port || 4370,
    model: row.model || 'ZKTeco / Secutime RFID',
    status: (row.status as 'online' | 'offline' | 'warning') || 'offline',
    latencyMs: row.latency_ms !== null ? row.latency_ms : undefined,
    latency_ms: row.latency_ms !== null ? row.latency_ms : undefined,
    lastSeen: row.last_seen || undefined,
    last_seen: row.last_seen || undefined,
    lastPingAt: row.last_ping_at || undefined,
    last_ping_at: row.last_ping_at || undefined,
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined
  };
}

const DEFAULT_READERS = [
  { ip: '192.168.121.244', name: 'ČA Prijavnica - ručni unos', location: 'Čačak (Prijavnica)', direction: 'Ručni unos', port: 4370, model: 'ZKTeco / Secutime RFID' },
  { ip: '192.168.121.245', name: 'ČA Prijavnica - odjava', location: 'Čačak (Prijavnica)', direction: 'Odjava', port: 4370, model: 'ZKTeco / Secutime RFID' },
  { ip: '192.168.121.246', name: 'Ljubić - odjava', location: 'Ljubić', direction: 'Odjava', port: 4370, model: 'ZKTeco / Secutime RFID' },
  { ip: '192.168.121.247', name: 'ČA Prijavnica - prijava', location: 'Čačak (Prijavnica)', direction: 'Prijava', port: 4370, model: 'ZKTeco / Secutime RFID' },
  { ip: '192.168.121.248', name: 'Konarevo - odjava', location: 'Konarevo (Kraljevo)', direction: 'Odjava', port: 4370, model: 'ZKTeco / Secutime RFID' },
  { ip: '192.168.121.249', name: 'Mojsinje - odjava', location: 'Mojsinje', direction: 'Odjava', port: 4370, model: 'ZKTeco / Secutime RFID' },
  { ip: '192.168.121.250', name: 'Mojsinje - prijava', location: 'Mojsinje', direction: 'Prijava', port: 4370, model: 'ZKTeco / Secutime RFID' },
  { ip: '192.168.121.251', name: 'Ljubić - prijava', location: 'Ljubić', direction: 'Prijava', port: 4370, model: 'ZKTeco / Secutime RFID' },
  { ip: '192.168.121.252', name: 'Konarevo - prijava', location: 'Konarevo (Kraljevo)', direction: 'Prijava', port: 4370, model: 'ZKTeco / Secutime RFID' }
];

export function seedRfReadersIfNeeded(): void {
  initSchema();
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) as c FROM rf_readers').get() as { c: number }).c;

  if (count === 0) {
    console.log('[RF Readers DB] Initializing seed data for 9 RF attendance terminals...');
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO rf_readers (id, name, location, direction, ip, port, model, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      DEFAULT_READERS.forEach((r, idx) => {
        insert.run(
          `rf-${idx + 1}`,
          r.name,
          r.location,
          r.direction,
          r.ip,
          r.port,
          r.model,
          'online',
          now,
          now
        );
      });
    });

    transaction();
    console.log('[RF Readers DB] ✓ Seeded 9 RF readers successfully.');
  }
}

export function getAllRfReaders(): RfReaderItem[] {
  seedRfReadersIfNeeded();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM rf_readers ORDER BY ip ASC').all() as RfReaderRow[];
  return rows.map(rowToItem);
}

export function getRfReaderById(id: string): RfReaderItem | undefined {
  seedRfReadersIfNeeded();
  const db = getDb();
  const row = db.prepare('SELECT * FROM rf_readers WHERE id = ?').get(id) as RfReaderRow | undefined;
  return row ? rowToItem(row) : undefined;
}

export function getRfReaderByIp(ip: string): RfReaderItem | undefined {
  seedRfReadersIfNeeded();
  const db = getDb();
  const row = db.prepare('SELECT * FROM rf_readers WHERE ip = ?').get(ip) as RfReaderRow | undefined;
  return row ? rowToItem(row) : undefined;
}

export function addRfReader(item: Omit<RfReaderItem, 'id' | 'createdAt'>): RfReaderItem {
  seedRfReadersIfNeeded();
  const db = getDb();

  // Generate next id: rf-N
  const all = db.prepare('SELECT id FROM rf_readers').all() as { id: string }[];
  let maxNum = 0;
  all.forEach(r => {
    const match = r.id.match(/^rf-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  const newId = `rf-${maxNum + 1}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO rf_readers (id, name, location, direction, ip, port, model, status, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId,
    item.name.trim(),
    item.location.trim(),
    item.direction.trim(),
    item.ip.trim(),
    item.port || 4370,
    item.model?.trim() || 'ZKTeco / Secutime RFID',
    item.status || 'online',
    item.note?.trim() || null,
    now,
    now
  );

  return getRfReaderById(newId)!;
}

export function updateRfReader(id: string, updates: Partial<RfReaderItem>): RfReaderItem | undefined {
  seedRfReadersIfNeeded();
  const db = getDb();
  const existing = getRfReaderById(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE rf_readers
    SET name = ?, location = ?, direction = ?, ip = ?, port = ?, model = ?, status = ?, note = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updates.name !== undefined ? updates.name.trim() : existing.name,
    updates.location !== undefined ? updates.location.trim() : existing.location,
    updates.direction !== undefined ? updates.direction.trim() : existing.direction,
    updates.ip !== undefined ? updates.ip.trim() : existing.ip,
    updates.port !== undefined ? updates.port : existing.port,
    updates.model !== undefined ? updates.model.trim() : existing.model,
    updates.status !== undefined ? updates.status : existing.status,
    updates.note !== undefined ? updates.note.trim() : existing.note || null,
    now,
    id
  );

  return getRfReaderById(id);
}

export function deleteRfReader(id: string): boolean {
  seedRfReadersIfNeeded();
  const db = getDb();
  const res = db.prepare('DELETE FROM rf_readers WHERE id = ?').run(id);
  return res.changes > 0;
}

export function updateRfReaderPingStatus(id: string, status: 'online' | 'offline', latencyMs?: number): RfReaderItem | null {
  seedRfReadersIfNeeded();
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE rf_readers
    SET status = ?,
        latency_ms = ?,
        last_seen = CASE WHEN ? = 'online' THEN ? ELSE last_seen END,
        last_ping_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(status, latencyMs ?? null, status, now, now, now, id);

  return getRfReaderById(id) || null;
}

/**
 * Pings an RF Reader using high-speed TCP socket connect to port 4370/80 with fallback to ICMP.
 */
export async function pingSingleRfReader(ip: string, port = 4370): Promise<{ online: boolean; latencyMs: number }> {
  const start = Date.now();

  // 1. Try TCP connect on primary RFID port (4370)
  const tcpPromise = new Promise<{ online: boolean; latencyMs: number }>((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(750);

    socket.once('connect', () => {
      if (!resolved) {
        resolved = true;
        const latencyMs = Math.max(1, Date.now() - start);
        try { socket.destroy(); } catch {}
        resolve({ online: true, latencyMs });
      }
    });

    socket.once('timeout', () => {
      if (!resolved) {
        resolved = true;
        try { socket.destroy(); } catch {}
        resolve({ online: false, latencyMs: 0 });
      }
    });

    socket.once('error', () => {
      if (!resolved) {
        resolved = true;
        try { socket.destroy(); } catch {}
        resolve({ online: false, latencyMs: 0 });
      }
    });

    try {
      socket.connect(port, ip);
    } catch {
      if (!resolved) {
        resolved = true;
        resolve({ online: false, latencyMs: 0 });
      }
    }
  });

  const tcpRes = await tcpPromise;
  if (tcpRes.online) return tcpRes;

  // 2. Try HTTP port 80 (since Secutime has web GUI)
  const httpPromise = new Promise<{ online: boolean; latencyMs: number }>((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(500);

    socket.once('connect', () => {
      if (!resolved) {
        resolved = true;
        const latencyMs = Math.max(1, Date.now() - start);
        try { socket.destroy(); } catch {}
        resolve({ online: true, latencyMs });
      }
    });

    socket.once('timeout', () => {
      if (!resolved) {
        resolved = true;
        try { socket.destroy(); } catch {}
        resolve({ online: false, latencyMs: 0 });
      }
    });

    socket.once('error', () => {
      if (!resolved) {
        resolved = true;
        try { socket.destroy(); } catch {}
        resolve({ online: false, latencyMs: 0 });
      }
    });

    try {
      socket.connect(80, ip);
    } catch {
      if (!resolved) {
        resolved = true;
        resolve({ online: false, latencyMs: 0 });
      }
    }
  });

  const httpRes = await httpPromise;
  if (httpRes.online) return httpRes;

  // 3. Fallback to OS ICMP ping (Windows i Linux)
  const icmp = await pingHost(ip, 500);
  if (icmp.ok) return { online: true, latencyMs: icmp.latencyMs ?? Math.max(1, Date.now() - start) };

  return { online: false, latencyMs: 0 };
}

/**
 * Pings all registered RF Readers in parallel and updates the database.
 */
export async function pingAllRfReaders(): Promise<RfReaderItem[]> {
  const readers = getAllRfReaders();

  await Promise.all(
    readers.map(async (r) => {
      const res = await pingSingleRfReader(r.ip, r.port || 4370);
      updateRfReaderPingStatus(r.id, res.online ? 'online' : 'offline', res.online ? res.latencyMs : undefined);
    })
  );

  return getAllRfReaders();
}
