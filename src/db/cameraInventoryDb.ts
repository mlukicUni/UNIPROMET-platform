import { getDb } from './sqlite';
import { initSchema } from './schema';

export interface CameraInventoryItem {
  id: string;
  ip: string;
  name: string;
  recorder: string;
  /** Lokacija kamere (odvojeno od snimača); ako nije upisana, uzima se naziv snimača */
  location?: string;
  position: string;
  type: 'IP Kamera' | 'Analogna';
  subnet: string;
  note?: string;
  isReserved: boolean;
  credProfile?: number;
  authStatus?: 'profile_1' | 'profile_2' | 'auth_failed' | 'offline' | 'untested';
  lastAuthCheck?: string;
  createdAt: string;
  updatedAt?: string;
}

interface CameraRow {
  id: string;
  ip: string;
  name: string;
  recorder: string | null;
  location: string | null;
  position: string | null;
  type: string | null;
  subnet: string | null;
  note: string | null;
  is_reserved: number;
  cred_profile: number | null;
  auth_status: string | null;
  last_auth_check: string | null;
  created_at: string;
  updated_at: string | null;
}

function rowToItem(row: CameraRow): CameraInventoryItem {
  return {
    id: row.id,
    ip: row.ip,
    name: row.name,
    recorder: row.recorder || 'Nedodeljeno',
    location: row.location || row.recorder || 'Nedodeljeno',
    position: row.position || '',
    type: (row.type as 'IP Kamera' | 'Analogna') || 'IP Kamera',
    subnet: row.subnet || '',
    note: row.note || '',
    isReserved: row.is_reserved === 1,
    credProfile: row.cred_profile || 1,
    authStatus: (row.auth_status as any) || 'untested',
    lastAuthCheck: row.last_auth_check || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined
  };
}

export function getAllCameraInventory(): CameraInventoryItem[] {
  initSchema();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM cameras ORDER BY id ASC').all() as CameraRow[];
  return rows.map(rowToItem);
}

export function getCameraInventoryById(id: string): CameraInventoryItem | undefined {
  initSchema();
  const db = getDb();
  const row = db.prepare('SELECT * FROM cameras WHERE id = ?').get(id) as CameraRow | undefined;
  return row ? rowToItem(row) : undefined;
}

export function getCameraInventoryByIp(ip: string): CameraInventoryItem | undefined {
  initSchema();
  const db = getDb();
  const row = db.prepare('SELECT * FROM cameras WHERE ip = ?').get(ip.trim()) as CameraRow | undefined;
  return row ? rowToItem(row) : undefined;
}

/**
 * Druga kamera sa istom IP adresom (ili oznakom slota), bez obzira na razmake i velika/mala slova.
 * excludeId: zapis koji se upravo menja (ne računa se kao duplikat samog sebe).
 */
export function findCameraWithSameIp(ip: string, excludeId?: string): CameraInventoryItem | undefined {
  initSchema();
  const row = getDb()
    .prepare('SELECT * FROM cameras WHERE LOWER(TRIM(ip)) = LOWER(TRIM(?)) AND id <> ? LIMIT 1')
    .get(ip || '', excludeId || '') as CameraRow | undefined;
  return row ? rowToItem(row) : undefined;
}

export class DuplicateCameraIpError extends Error {
  constructor(public existing: CameraInventoryItem) {
    super(`Kamera sa IP adresom ${existing.ip} je već u evidenciji: ${existing.position || existing.name} (snimač: ${existing.recorder || 'nedodeljeno'}). Ista kamera ne može biti upisana dva puta.`);
    this.name = 'DuplicateCameraIpError';
  }
}

export function updateCameraAuthProfile(
  ip: string,
  credProfile: number,
  authStatus: 'profile_1' | 'profile_2' | 'auth_failed' | 'offline' | 'untested'
): boolean {
  initSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const res = db.prepare(`
    UPDATE cameras SET
      cred_profile = ?,
      auth_status = ?,
      last_auth_check = ?,
      updated_at = ?
    WHERE ip = ?
  `).run(credProfile, authStatus, now, now, ip.trim());
  return res.changes > 0;
}

export function addCameraInventoryItem(item: Omit<CameraInventoryItem, 'id' | 'createdAt' | 'updatedAt'>): CameraInventoryItem {
  initSchema();
  const db = getDb();

  // Find max cam-XXXX number + 1
  const allIds = db.prepare('SELECT id FROM cameras').all() as { id: string }[];
  let maxNum = 0;
  allIds.forEach(c => {
    const match = c.id.match(/^cam-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });

  const now = new Date().toISOString();
  const newId = `cam-${String(maxNum + 1).padStart(4, '0')}`;
  const cleanIp = item.ip.trim();
  const duplicate = findCameraWithSameIp(cleanIp);
  if (duplicate) throw new DuplicateCameraIpError(duplicate);
  const cleanName = item.name?.trim() || item.position?.trim() || `Kamera ${cleanIp}`;
  const cleanRecorder = item.recorder?.trim() || 'Nedodeljeno';
  const cleanLocation = item.location?.trim() || cleanRecorder;
  const cleanPosition = item.position?.trim() || 'Pozicija kamere';
  const cleanType = item.type || (cleanIp.toLowerCase().includes('analog') ? 'Analogna' : 'IP Kamera');
  const cleanSubnet = item.subnet || (cleanIp.includes('124.') ? '192.168.124.x' : cleanIp.includes('125.') ? '192.168.125.x' : 'Ostalo');
  const cleanNote = item.note?.trim() || '';
  const isReserved = item.isReserved ? 1 : 0;
  // Koja od dve lozinke za kamere važi za ovu kameru (1 ili 2)
  const credProfile = item.credProfile === 2 ? 2 : 1;

  const stmt = db.prepare(`
    INSERT INTO cameras (
      id, ip, name, recorder, location, position, type, subnet, note, is_reserved, cred_profile, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    newId,
    cleanIp,
    cleanName,
    cleanRecorder,
    cleanLocation,
    cleanPosition,
    cleanType,
    cleanSubnet,
    cleanNote,
    isReserved,
    credProfile,
    now,
    now
  );

  return {
    id: newId,
    ip: cleanIp,
    name: cleanName,
    recorder: cleanRecorder,
    location: cleanLocation,
    position: cleanPosition,
    type: cleanType as 'IP Kamera' | 'Analogna',
    subnet: cleanSubnet,
    note: cleanNote,
    isReserved: !!item.isReserved,
    credProfile,
    createdAt: now,
    updatedAt: now
  };
}

export function updateCameraInventoryItem(id: string, updates: Partial<CameraInventoryItem>): CameraInventoryItem | null {
  initSchema();
  const db = getDb();
  const existing = getCameraInventoryById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged: CameraInventoryItem = {
    ...existing,
    ...updates,
    id: existing.id,
    updatedAt: now
  };
  merged.credProfile = merged.credProfile === 2 ? 2 : 1;
  const duplicate = findCameraWithSameIp(merged.ip, existing.id);
  if (duplicate) throw new DuplicateCameraIpError(duplicate);
  // Ručno promenjena lozinka: ranije zabeležen rezultat provere više ne važi
  const profileChanged = merged.credProfile !== (existing.credProfile || 1);
  if (profileChanged) merged.authStatus = 'untested';

  const stmt = db.prepare(`
    UPDATE cameras SET
      ip = ?, name = ?, recorder = ?, location = ?, position = ?, type = ?,
      subnet = ?, note = ?, is_reserved = ?, cred_profile = ?, auth_status = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    merged.ip.trim(),
    merged.name.trim(),
    merged.recorder.trim(),
    (merged.location || '').trim() || merged.recorder.trim(),
    merged.position.trim(),
    merged.type,
    merged.subnet.trim(),
    merged.note || '',
    merged.isReserved ? 1 : 0,
    merged.credProfile,
    merged.authStatus || 'untested',
    now,
    id
  );

  return merged;
}

export function deleteCameraInventoryItem(id: string): boolean {
  initSchema();
  const db = getDb();
  const res = db.prepare('DELETE FROM cameras WHERE id = ?').run(id);
  return res.changes > 0;
}
