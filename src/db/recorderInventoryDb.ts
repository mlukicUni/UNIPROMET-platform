import { getDb } from './sqlite';
import { initSchema } from './schema';

export interface RecorderItem {
  id: string;
  name: string;
  location: string;
  ip: string;
  model: string;
  type: string;
  subnet: string;
  camerasCount: number;
  channels: number;
  status: 'online' | 'offline' | 'warning';
  note?: string;
  httpPort?: number;
  rtspPort?: number;
  sdkPort?: number;
  lastCheckedAt?: string;
  webuiStatus?: 'online' | 'offline' | 'untested';
  pingStatus?: 'online' | 'offline' | 'untested';
  latencyMs?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface RecorderRow {
  id: string;
  name: string;
  location: string | null;
  ip: string;
  model: string | null;
  type: string | null;
  subnet: string | null;
  cameras_count: number;
  channels: number;
  status: string;
  note: string | null;
  http_port?: number | null;
  rtsp_port?: number | null;
  sdk_port?: number | null;
  last_checked_at?: string | null;
  webui_status?: string | null;
  ping_status?: string | null;
  latency_ms?: number | null;
  created_at: string;
  updated_at: string | null;
}

function rowToItem(row: RecorderRow): RecorderItem {
  return {
    id: row.id,
    name: row.name,
    location: row.location || '',
    ip: row.ip,
    model: row.model || '',
    type: row.type || 'NVR',
    subnet: row.subnet || '',
    camerasCount: row.cameras_count || 0,
    channels: row.channels || 32,
    status: (row.status as 'online' | 'offline' | 'warning') || 'online',
    note: row.note || '',
    httpPort: row.http_port || 80,
    rtspPort: row.rtsp_port || 554,
    sdkPort: row.sdk_port || 8000,
    lastCheckedAt: row.last_checked_at || undefined,
    webuiStatus: (row.webui_status as 'online' | 'offline' | 'untested') || 'untested',
    pingStatus: (row.ping_status as 'online' | 'offline' | 'untested') || 'untested',
    latencyMs: typeof row.latency_ms === 'number' ? row.latency_ms : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined
  };
}

export function getRecordersInventory(): RecorderItem[] {
  initSchema();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM recorders ORDER BY id ASC').all() as RecorderRow[];
  return rows.map(rowToItem);
}

export function getRecorderById(id: string): RecorderItem | undefined {
  initSchema();
  const db = getDb();
  const row = db.prepare('SELECT * FROM recorders WHERE id = ?').get(id) as RecorderRow | undefined;
  return row ? rowToItem(row) : undefined;
}

export function addRecorder(item: Omit<RecorderItem, 'id' | 'createdAt'>): RecorderItem {
  initSchema();
  const db = getDb();

  // Generate next ID
  const allIds = db.prepare('SELECT id FROM recorders').all() as { id: string }[];
  let maxNum = 0;
  allIds.forEach(r => {
    const match = r.id.match(/^rec-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  const newId = `rec-${String(maxNum + 1).padStart(3, '0')}`;
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO recorders (
      id, name, location, ip, model, type, subnet, cameras_count, channels, status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    newId,
    item.name.trim(),
    item.location?.trim() || '',
    item.ip.trim(),
    item.model?.trim() || 'Hikvision NVR',
    item.type?.trim() || 'NVR',
    item.subnet?.trim() || '',
    item.camerasCount || 0,
    item.channels || 32,
    item.status || 'online',
    item.note?.trim() || '',
    now,
    now
  );

  return {
    id: newId,
    name: item.name.trim(),
    location: item.location?.trim() || '',
    ip: item.ip.trim(),
    model: item.model?.trim() || 'Hikvision NVR',
    type: item.type?.trim() || 'NVR',
    subnet: item.subnet?.trim() || '',
    camerasCount: item.camerasCount || 0,
    channels: item.channels || 32,
    status: item.status || 'online',
    note: item.note?.trim() || '',
    createdAt: now,
    updatedAt: now
  };
}

export function updateRecorder(id: string, updates: Partial<RecorderItem>): RecorderItem | null {
  initSchema();
  const db = getDb();
  const existing = getRecorderById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged: RecorderItem = {
    ...existing,
    ...updates,
    id: existing.id,
    updatedAt: now
  };

  const stmt = db.prepare(`
    UPDATE recorders SET
      name = ?, location = ?, ip = ?, model = ?, type = ?, subnet = ?,
      cameras_count = ?, channels = ?, status = ?, note = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    merged.name.trim(),
    merged.location.trim(),
    merged.ip.trim(),
    merged.model.trim(),
    merged.type.trim(),
    merged.subnet.trim(),
    merged.camerasCount,
    merged.channels,
    merged.status,
    merged.note || '',
    now,
    id
  );

  return merged;
}

export function deleteRecorder(id: string): boolean {
  initSchema();
  const db = getDb();
  const res = db.prepare('DELETE FROM recorders WHERE id = ?').run(id);
  return res.changes > 0;
}

/**
 * Updates status, ping, webui, latency and last check timestamp for a recorder.
 */
export function updateRecorderCheckStatus(
  id: string,
  checkData: {
    status: 'online' | 'offline';
    webuiStatus: 'online' | 'offline';
    pingStatus: 'online' | 'offline';
    latencyMs?: number;
    lastCheckedAt: string;
  }
): boolean {
  initSchema();
  const db = getDb();
  const res = db.prepare(`
    UPDATE recorders SET
      status = ?,
      webui_status = ?,
      ping_status = ?,
      latency_ms = ?,
      last_checked_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    checkData.status,
    checkData.webuiStatus,
    checkData.pingStatus,
    checkData.latencyMs !== undefined ? checkData.latencyMs : null,
    checkData.lastCheckedAt,
    checkData.lastCheckedAt,
    id
  );
  return res.changes > 0;
}

