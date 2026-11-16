import http from 'http';
import https from 'https';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/sqlite';
import { initSchema } from '../db/schema';
import { instanceRole, syncPeerUrl, syncApiToken, syncPeerInsecureTls, publicHost, InstanceRole } from '../utils/appConfig';
import { resetCameraScanCache } from './cameraScanner';

/**
 * ==========================================================================
 * SINHRONIZACIJA EVIDENCIJE KAMERA I SNIMAČA IZMEĐU DVA SERVERA (produkcija <-> dev)
 * Server preuzima izvoz sa drugog servera (zaštićen zajedničkim tokenom) i kada korisnik potvrdi,
 * njegove tabele `cameras` i `recorders` postaju preslika tabela sa drugog servera.
 * Lozinke kamera se NE prenose (u bazi je samo oznaka profila 1/2); Monitoring tabovi i prava se ne diraju.
 * ==========================================================================
 */

export type Row = Record<string, string | number | null>;

export interface CameraSyncExport {
  schema: 1;
  source: { role: InstanceRole; host: string; exportedAt: string };
  cameras: Row[];
  recorders: Row[];
}

interface TableSpec {
  table: 'cameras' | 'recorders';
  required: string[];
  /** Kolone koje se stalno menjaju (status provere i sl.): ne računaju se kao „izmena“, ali se prepisuju */
  volatile: string[];
  /** Kolone za kratak prikaz u pregledu */
  label: (r: Row) => string;
}

const SPECS: Record<'cameras' | 'recorders', TableSpec> = {
  cameras: {
    table: 'cameras',
    required: ['id', 'ip', 'name', 'created_at'],
    volatile: ['updated_at', 'last_auth_check'],
    label: r => `${r.position || r.name || ''} · ${r.ip}`
  },
  recorders: {
    table: 'recorders',
    required: ['id', 'name', 'ip', 'created_at'],
    volatile: ['updated_at', 'last_checked_at', 'webui_status', 'ping_status', 'latency_ms', 'status'],
    label: r => `${r.name || ''} · ${r.ip}`
  }
};

const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
const MAX_LISTED = 200;
let syncRunning = false;

/* ==========================================================================
   IZVOZ
   ========================================================================== */
export function buildExport(): CameraSyncExport {
  initSchema();
  const db = getDb();
  return {
    schema: 1,
    source: { role: instanceRole(), host: publicHost(), exportedAt: new Date().toISOString() },
    cameras: db.prepare('SELECT * FROM cameras ORDER BY id').all() as Row[],
    recorders: db.prepare('SELECT * FROM recorders ORDER BY id').all() as Row[]
  };
}

/** Poređenje tokena bez curenja informacije o dužini ili sadržaju */
export function tokenMatches(given: string): boolean {
  const expected = syncApiToken();
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ==========================================================================
   PREUZIMANJE SA DRUGOG SERVERA
   ========================================================================== */
export class SyncError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
    this.name = 'SyncError';
  }
}

export function syncStatus() {
  const role = instanceRole();
  const peerUrl = syncPeerUrl();
  let peerHost = '';
  try { peerHost = new URL(peerUrl).host; } catch { /* nije podešeno */ }
  return {
    role,
    configured: !!peerUrl && !!syncApiToken() && !!peerHost,
    peerRole: role === 'production' ? 'dev' : 'production',
    peerHost,
    buttonLabel: role === 'production' ? 'Sinhronizuj podatke sa dev serverom' : 'Sinhronizuj podatke sa main serverom',
    peerLabel: role === 'production' ? 'dev serverom' : 'main serverom'
  };
}

function requestPeer(): Promise<CameraSyncExport> {
  const base = syncPeerUrl();
  let url: URL;
  try {
    url = new URL('/api/sync/cameras/export', base);
  } catch {
    throw new SyncError('Adresa drugog servera (SYNC_PEER_URL) nije ispravna.', 500);
  }
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const agent = isHttps && syncPeerInsecureTls() ? new https.Agent({ rejectUnauthorized: false }) : undefined;

  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method: 'GET',
      timeout: 20000,
      agent,
      headers: { 'X-Sync-Token': syncApiToken(), Accept: 'application/json' }
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (d: Buffer) => {
        size += d.length;
        if (size > MAX_EXPORT_BYTES) {
          req.destroy();
          return reject(new SyncError('Odgovor drugog servera je prevelik.'));
        }
        chunks.push(d);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 401) return reject(new SyncError('Drugi server je odbio token (SYNC_API_TOKEN mora biti isti na oba servera).', 502));
        if (res.statusCode === 404) return reject(new SyncError('Drugi server nema uključen izvoz (nema SYNC_API_TOKEN ili ima stariju verziju platforme).', 502));
        if (res.statusCode !== 200) return reject(new SyncError(`Drugi server je vratio grešku ${res.statusCode}.`, 502));
        try {
          resolve(JSON.parse(text) as CameraSyncExport);
        } catch {
          reject(new SyncError('Drugi server nije vratio ispravan odgovor.'));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new SyncError('Drugi server ne odgovara (isteklo vreme).')); });
    req.on('error', (e: NodeJS.ErrnoException) => {
      const why = e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || e.code === 'SELF_SIGNED_CERT_IN_CHAIN'
        ? 'sertifikat drugog servera nije poznat (podesite SYNC_PEER_INSECURE_TLS=true)'
        : (e.code || e.message);
      reject(new SyncError(`Nije moguće povezati se sa drugim serverom: ${why}.`));
    });
    req.end();
  });
}

/** Proverava oblik i sadržaj izvoza pre bilo kakve upotrebe */
function validateExport(data: CameraSyncExport): void {
  if (!data || data.schema !== 1 || !data.source || !Array.isArray(data.cameras) || !Array.isArray(data.recorders)) {
    throw new SyncError('Izvoz sa drugog servera nije u očekivanom obliku (verzije platforme se razlikuju?).');
  }
  if (data.cameras.length === 0) {
    throw new SyncError('Drugi server nema nijednu kameru u evidenciji; prepisivanje je odbijeno da se evidencija ne bi obrisala.');
  }
  for (const spec of Object.values(SPECS)) {
    const rows = data[spec.table] as Row[];
    const ids = new Set<string>();
    for (const r of rows) {
      if (!r || typeof r !== 'object') throw new SyncError(`Neispravan zapis u tabeli ${spec.table}.`);
      for (const k of spec.required) {
        if (r[k] === null || r[k] === undefined || String(r[k]).trim() === '') {
          throw new SyncError(`Zapis u tabeli ${spec.table} nema obavezno polje „${k}“.`);
        }
      }
      for (const [k, v] of Object.entries(r)) {
        if (v !== null && typeof v !== 'string' && typeof v !== 'number') {
          throw new SyncError(`Neispravna vrednost polja „${k}“ u tabeli ${spec.table}.`);
        }
      }
      const id = String(r.id);
      if (ids.has(id)) throw new SyncError(`Tabela ${spec.table} ima dupli ID ${id}.`);
      ids.add(id);
    }
  }
}

export async function fetchPeerExport(): Promise<CameraSyncExport> {
  const st = syncStatus();
  if (!st.configured) {
    throw new SyncError('Sinhronizacija nije podešena. U .env treba upisati SYNC_PEER_URL i SYNC_API_TOKEN (i INSTANCE_ROLE).', 400);
  }
  const data = await requestPeer();
  validateExport(data);
  if (data.source.role === instanceRole()) {
    throw new SyncError(`Oba servera imaju istu ulogu (${instanceRole()}). Proverite INSTANCE_ROLE u .env na oba servera.`, 400);
  }
  return data;
}

/* ==========================================================================
   RAZLIKE
   ========================================================================== */
function localColumns(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
}

const norm = (v: unknown) => (v === undefined || v === null ? null : v);

/** Kolone koje se porede: i na izvoru i lokalno postoje, bez nestalnih */
function comparableColumns(spec: TableSpec, remoteRows: Row[]): string[] {
  const remoteCols = new Set(remoteRows.length ? Object.keys(remoteRows[0]) : []);
  return localColumns(spec.table).filter(c => remoteCols.has(c) && !spec.volatile.includes(c));
}

export interface RowSummary { id: string; label: string; recorder?: string; location?: string }
export interface RowChange extends RowSummary { changes: { field: string; before: unknown; after: unknown }[] }

export interface TableDiff {
  added: RowSummary[];
  removed: RowSummary[];
  changed: RowChange[];
  unchanged: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
}

function summarize(spec: TableSpec, r: Row): RowSummary {
  return { id: String(r.id), label: spec.label(r), recorder: r.recorder as string | undefined, location: r.location as string | undefined };
}

function diffTable(spec: TableSpec, remoteRows: Row[]): { diff: TableDiff; removedIds: string[]; changedIds: Set<string>; addedIds: string[] } {
  const local = getDb().prepare(`SELECT * FROM ${spec.table}`).all() as Row[];
  const cols = comparableColumns(spec, remoteRows);
  const localById = new Map(local.map(r => [String(r.id), r]));
  const remoteById = new Map(remoteRows.map(r => [String(r.id), r]));

  const added = remoteRows.filter(r => !localById.has(String(r.id)));
  const removed = local.filter(r => !remoteById.has(String(r.id)));
  const changed: RowChange[] = [];
  let unchanged = 0;
  for (const r of remoteRows) {
    const l = localById.get(String(r.id));
    if (!l) continue;
    const changes = cols.filter(c => c !== 'id' && norm(l[c]) !== norm(r[c])).map(c => ({ field: c, before: norm(l[c]), after: norm(r[c]) }));
    if (changes.length) changed.push({ ...summarize(spec, r), changes });
    else unchanged++;
  }
  return {
    diff: {
      added: added.slice(0, MAX_LISTED).map(r => summarize(spec, r)),
      removed: removed.slice(0, MAX_LISTED).map(r => summarize(spec, r)),
      changed: changed.slice(0, MAX_LISTED),
      unchanged,
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length
    },
    removedIds: removed.map(r => String(r.id)),
    changedIds: new Set(changed.map(c => c.id)),
    addedIds: added.map(r => String(r.id))
  };
}

/** Otisak „značajnog“ sadržaja izvoza: ako se promeni između pregleda i primene, primena se odbija */
export function fingerprint(data: CameraSyncExport): string {
  const parts: string[] = [];
  for (const spec of Object.values(SPECS)) {
    const rows = [...(data[spec.table] as Row[])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const cols = comparableColumns(spec, rows);
    parts.push(spec.table + ':' + JSON.stringify(rows.map(r => cols.map(c => norm(r[c])))));
  }
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

export interface SyncPreview {
  peer: { role: InstanceRole; host: string; exportedAt: string; cameraCount: number; recorderCount: number };
  local: { role: InstanceRole; cameraCount: number; recorderCount: number };
  cameras: TableDiff;
  recorders: TableDiff;
  warnings: {
    /** Isti ID na oba servera, a iza njega je druga kamera (druga IP adresa) */
    identityChanged: { id: string; localLabel: string; remoteLabel: string }[];
    affectedTabs: { count: number; examples: string[] };
    affectedCameraRules: number;
    affectedRecorderRules: number;
    affectedGroupMemberships: number;
  };
  totalChanges: number;
  fingerprint: string;
}

export function buildPreview(remote: CameraSyncExport): SyncPreview {
  initSchema();
  const db = getDb();
  const cam = diffTable(SPECS.cameras, remote.cameras);
  const rec = diffTable(SPECS.recorders, remote.recorders);

  // ID-jevi kod kojih je iza istog ID-ja druga kamera
  const localCams = new Map((db.prepare('SELECT id, ip, position, name FROM cameras').all() as Row[]).map(r => [String(r.id), r]));
  const identityChanged: SyncPreview['warnings']['identityChanged'] = [];
  for (const r of remote.cameras) {
    const l = localCams.get(String(r.id));
    if (l && String(l.ip).trim() !== String(r.ip).trim()) {
      identityChanged.push({
        id: String(r.id),
        localLabel: `${l.position || l.name} · ${l.ip}`,
        remoteLabel: `${r.position || r.name} · ${r.ip}`
      });
    }
  }

  const atRisk = new Set<string>([...cam.removedIds, ...identityChanged.map(i => i.id)]);
  let tabCount = 0;
  const tabExamples: string[] = [];
  if (atRisk.size) {
    const tabs = db.prepare('SELECT name, owner, cameras FROM monitoring_tabs').all() as { name: string; owner: string; cameras: string }[];
    for (const t of tabs) {
      let ids: unknown[] = [];
      try { ids = JSON.parse(t.cameras || '[]'); } catch { /* neispravan zapis */ }
      if (ids.some(id => typeof id === 'string' && atRisk.has(id))) {
        tabCount++;
        if (tabExamples.length < 8) tabExamples.push(`${t.name} (${t.owner})`);
      }
    }
  }
  const countIn = (sql: string, ids: string[]): number => {
    if (!ids.length) return 0;
    return (db.prepare(sql.replace('(?)', `(${ids.map(() => '?').join(',')})`)).get(...ids) as { c: number }).c;
  };
  const riskIds = [...atRisk];

  const totalChanges = cam.diff.addedCount + cam.diff.removedCount + cam.diff.changedCount
    + rec.diff.addedCount + rec.diff.removedCount + rec.diff.changedCount;

  return {
    peer: {
      role: remote.source.role,
      host: String(remote.source.host || ''),
      exportedAt: String(remote.source.exportedAt || ''),
      cameraCount: remote.cameras.length,
      recorderCount: remote.recorders.length
    },
    local: {
      role: instanceRole(),
      cameraCount: (db.prepare('SELECT COUNT(*) c FROM cameras').get() as { c: number }).c,
      recorderCount: (db.prepare('SELECT COUNT(*) c FROM recorders').get() as { c: number }).c
    },
    cameras: cam.diff,
    recorders: rec.diff,
    warnings: {
      identityChanged: identityChanged.slice(0, MAX_LISTED),
      affectedTabs: { count: tabCount, examples: tabExamples },
      affectedCameraRules: countIn("SELECT COUNT(*) c FROM role_camera_access WHERE scope = 'camera' AND target_id IN (?)", riskIds),
      affectedRecorderRules: countIn("SELECT COUNT(*) c FROM role_camera_access WHERE scope = 'recorder' AND target_id IN (?)", rec.removedIds),
      affectedGroupMemberships: countIn('SELECT COUNT(*) c FROM camera_group_members WHERE camera_id IN (?)', cam.removedIds)
    },
    totalChanges,
    fingerprint: fingerprint(remote)
  };
}

export async function previewFromPeer(): Promise<SyncPreview> {
  return buildPreview(await fetchPeerExport());
}

/* ==========================================================================
   PRIMENA
   ========================================================================== */
export interface SyncResult {
  backupPath: string;
  cameras: { added: number; changed: number; removed: number; total: number };
  recorders: { added: number; changed: number; removed: number; total: number };
  peerHost: string;
}

function applyTable(spec: TableSpec, remoteRows: Row[]): { added: number; changed: number; removed: number; total: number } {
  const db = getDb();
  const { diff, removedIds } = diffTable(spec, remoteRows);
  const cols = localColumns(spec.table).filter(c => remoteRows.length && c in remoteRows[0]);
  const updates = cols.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ');
  const upsert = db.prepare(
    `INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')}) ON CONFLICT(id) DO UPDATE SET ${updates}`
  );
  const del = db.prepare(`DELETE FROM ${spec.table} WHERE id = ?`);
  // Brišu se samo kamere/snimači kojih nema na izvoru; ostali se prepisuju (ne briše se sve, da veze ostanu)
  for (const id of removedIds) del.run(id);
  for (const r of remoteRows) {
    const params: Record<string, unknown> = {};
    for (const c of cols) params[c] = norm(r[c]);
    upsert.run(params);
  }
  return { added: diff.addedCount, changed: diff.changedCount, removed: diff.removedCount, total: remoteRows.length };
}

export async function applyFromPeer(expectedFingerprint: string, actor: { id?: string; name?: string; email?: string } | null): Promise<SyncResult> {
  if (syncRunning) throw new SyncError('Sinhronizacija je već u toku.', 409);
  syncRunning = true;
  try {
    const remote = await fetchPeerExport();
    if (!expectedFingerprint || fingerprint(remote) !== expectedFingerprint) {
      throw new SyncError('Podaci na drugom serveru su se u međuvremenu promenili. Ponovite pregled, pa potvrdite.', 409);
    }
    initSchema();
    const db = getDb();

    // Rezervna kopija cele baze pre izmene
    const snapDir = path.join(process.cwd(), 'data', 'backups', 'snapshots');
    fs.mkdirSync(snapDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(snapDir, `unipromet_${stamp}_pre_sinhronizacija_kamera.db`);
    await db.backup(backupPath);

    let result!: SyncResult;
    db.transaction(() => {
      const recorders = applyTable(SPECS.recorders, remote.recorders);
      const cameras = applyTable(SPECS.cameras, remote.cameras);
      result = { backupPath, cameras, recorders, peerHost: String(remote.source.host || '') };
    })();

    resetCameraScanCache();
    return result;
  } finally {
    syncRunning = false;
  }
}
