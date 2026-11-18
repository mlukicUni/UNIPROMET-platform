import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/sqlite';
import { initSchema } from '../db/schema';
import { initMonitoringSchema, validateLayout, MAX_TABS, ownerKey } from '../db/monitoringDb';
import { instanceRole, publicHost, isEnabled, InstanceRole } from '../utils/appConfig';
import { requestPeer, syncStatus, SyncError } from './cameraSyncService';

/**
 * ==========================================================================
 * PRIVREMENO: povlačenje Monitoring tabova sa drugog servera (produkcija <-> dev).
 * Uključuje se samo ako je u .env MONITORING_SYNC_ENABLED=true (na oba servera).
 * Tab čuva ID-jeve kamera, a ID-jevi se na dva servera razlikuju, zato se izvoz nosi
 * sa IP adresom po polju, a uvoz ih mapira na lokalne kamere po IP adresi.
 * Kamere kojih nema lokalno ostaju prazna polja (upozorenje u pregledu).
 * Deljenja sa rolama se ne prenose. Šabloni se ne prenose (raspored je u samom tabu).
 * Lokalni tabovi se ne brišu: tab istog vlasnika i naziva se preskače ili zamenjuje.
 * ==========================================================================
 */

export function monitoringSyncEnabled(): boolean {
  return isEnabled('MONITORING_SYNC_ENABLED', false);
}

const MAX_REMOTE_TABS = 500;

/** Izbor vlasnika na ovom serveru: ključ = vlasnik na izvoru, vrednost = vlasnik ovde (e-mail, malim slovima) */
export type OwnerMap = Record<string, string>;

export function normalizeOwnerMap(raw: unknown): OwnerMap {
  const out: OwnerMap = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new SyncError('Izbor vlasnika nije ispravan.', 400);
  for (const [source, target] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof target !== 'string' || source.length > 120) throw new SyncError('Izbor vlasnika nije ispravan.', 400);
    const value = target.trim().toLowerCase();
    if (!value || value.length > 120) throw new SyncError('Vlasnik na ovom serveru mora imati ispravan ključ (e-mail).', 400);
    out[source] = value;
  }
  return out;
}

interface TabRow {
  id: string;
  owner: string;
  name: string;
  position: number;
  template_id: string | null;
  layout: string;
  cameras: string;
  created_at: string;
  updated_at: string | null;
}

export interface RemoteTab {
  id: string;
  owner: string;
  name: string;
  position: number;
  templateId: string;
  layout: { cols: number; rows: number; cells: { x: number; y: number; w: number; h: number }[] };
  /** IP adresa kamere po polju (null = prazno polje) */
  slots: (string | null)[];
  createdAt: string;
}

export interface MonitoringSyncExport {
  schema: 1;
  source: { role: InstanceRole; host: string; exportedAt: string };
  tabs: RemoteTab[];
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

/* ==========================================================================
   IZVOZ
   ========================================================================== */
export function buildMonitoringExport(): MonitoringSyncExport {
  initSchema();
  initMonitoringSchema();
  const db = getDb();
  const ipById = new Map(
    (db.prepare('SELECT id, ip FROM cameras').all() as { id: string; ip: string }[]).map(r => [r.id, r.ip])
  );
  const rows = db.prepare('SELECT * FROM monitoring_tabs ORDER BY owner, position, created_at').all() as TabRow[];
  const tabs: RemoteTab[] = rows.map(r => {
    const layout = parseJson<RemoteTab['layout']>(r.layout, { cols: 1, rows: 1, cells: [{ x: 1, y: 1, w: 1, h: 1 }] });
    const ids = parseJson<unknown[]>(r.cameras, []);
    const slots = layout.cells.map((_, i) => {
      const id = ids[i];
      return typeof id === 'string' && ipById.has(id) ? ipById.get(id) || null : null;
    });
    return {
      id: r.id,
      owner: r.owner,
      name: r.name,
      position: r.position,
      templateId: r.template_id || '',
      layout,
      slots,
      createdAt: r.created_at
    };
  });
  return {
    schema: 1,
    source: { role: instanceRole(), host: publicHost(), exportedAt: new Date().toISOString() },
    tabs
  };
}

/** Otisak sadržaja izvoza: ako se promeni između pregleda i primene, primena se odbija */
export function monitoringFingerprint(data: MonitoringSyncExport): string {
  const sorted = [...data.tabs]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(t => [t.id, t.owner, t.name, t.templateId, t.layout, t.slots]);
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

/* ==========================================================================
   PREUZIMANJE I PROVERA
   ========================================================================== */
function validateMonitoringExport(data: MonitoringSyncExport): void {
  if (!data || data.schema !== 1 || !data.source || !Array.isArray(data.tabs)) {
    throw new SyncError('Izvoz tabova sa drugog servera nije u očekivanom obliku (verzije platforme se razlikuju?).');
  }
  if (data.tabs.length > MAX_REMOTE_TABS) throw new SyncError('Drugi server šalje previše tabova.');
  const ids = new Set<string>();
  for (const t of data.tabs) {
    if (!t || typeof t !== 'object') throw new SyncError('Neispravan tab u izvozu.');
    if (!t.id || !t.owner || !t.name || String(t.name).length > 60) throw new SyncError('Tab u izvozu nema ispravan vlasnika ili naziv.');
    if (ids.has(t.id)) throw new SyncError(`Izvoz ima dupli ID taba ${t.id}.`);
    ids.add(t.id);
    try {
      validateLayout(t.layout);
    } catch (e) {
      throw new SyncError(`Raspored taba „${t.name}“ nije ispravan: ${(e as Error).message}`);
    }
    const cells = t.layout.cells.length;
    if (!Array.isArray(t.slots) || t.slots.length !== cells) throw new SyncError(`Tab „${t.name}“ nema ispravan broj polja za kamere.`);
    if (t.slots.some(s => s !== null && typeof s !== 'string')) throw new SyncError(`Tab „${t.name}“ ima neispravnu kameru.`);
  }
}

export async function fetchMonitoringPeer(): Promise<MonitoringSyncExport> {
  const st = syncStatus();
  if (!st.configured) {
    throw new SyncError('Sinhronizacija nije podešena. U .env treba upisati SYNC_PEER_URL i SYNC_API_TOKEN (i INSTANCE_ROLE).', 400);
  }
  const data = await requestPeer<MonitoringSyncExport>('/api/sync/monitoring/export');
  validateMonitoringExport(data);
  if (data.source.role === instanceRole()) {
    throw new SyncError(`Oba servera imaju istu ulogu (${instanceRole()}). Proverite INSTANCE_ROLE u .env na oba servera.`, 400);
  }
  return data;
}

/* ==========================================================================
   PREGLED
   ========================================================================== */
export interface MonitoringTabPreview {
  id: string;
  /** Vlasnik na drugom serveru */
  sourceOwner: string;
  /** Vlasnik na ovom serveru (posle izbora) */
  owner: string;
  name: string;
  cells: number;
  cameras: number;
  /** IP adrese kamera koje na ovom serveru ne postoje (polja ostaju prazna) */
  missing: string[];
  status: 'new' | 'exists';
  localId?: string;
  tooManyTabs: boolean;
}

export interface MonitoringSyncPreview {
  peer: { role: InstanceRole; host: string; exportedAt: string; tabCount: number };
  local: { role: InstanceRole; tabCount: number };
  /** Vlasnici koji već imaju tabove ovde, plus korisnik koji je pokrenuo pregled */
  localOwners: string[];
  tabs: MonitoringTabPreview[];
  fingerprint: string;
}

export function buildMonitoringPreview(remote: MonitoringSyncExport, ownerMap: OwnerMap = {}, currentOwner = ''): MonitoringSyncPreview {
  initSchema();
  initMonitoringSchema();
  const db = getDb();
  const localIpIds = new Map(
    (db.prepare('SELECT id, ip FROM cameras').all() as { id: string; ip: string }[]).map(r => [r.ip, r.id])
  );
  const localTabs = db.prepare('SELECT id, owner, name FROM monitoring_tabs').all() as { id: string; owner: string; name: string }[];
  const localByKey = new Map(localTabs.map(t => [`${t.owner}\u0000${t.name}`, t.id]));
  const perOwner = new Map<string, number>();
  for (const t of localTabs) perOwner.set(t.owner, (perOwner.get(t.owner) || 0) + 1);

  const tabs: MonitoringTabPreview[] = remote.tabs.map(t => {
    const owner = ownerMap[t.owner] || t.owner;
    const filled = t.slots.filter((s): s is string => !!s);
    const missing = [...new Set(filled.filter(ip => !localIpIds.has(ip)))];
    // polje sa nepostojećom kamerom ostaje prazno, pa se broji kao nedostajuće
    const localId = localByKey.get(`${owner}\u0000${t.name}`);
    return {
      id: t.id,
      sourceOwner: t.owner,
      owner,
      name: t.name,
      cells: t.slots.length,
      cameras: filled.filter(ip => localIpIds.has(ip)).length,
      missing,
      status: localId ? 'exists' : 'new',
      localId,
      tooManyTabs: !localId && (perOwner.get(owner) || 0) >= MAX_TABS
    };
  });

  return {
    peer: {
      role: remote.source.role,
      host: String(remote.source.host || ''),
      exportedAt: String(remote.source.exportedAt || ''),
      tabCount: remote.tabs.length
    },
    local: { role: instanceRole(), tabCount: localTabs.length },
    localOwners: Array.from(new Set([...localTabs.map(t => t.owner), currentOwner].filter(Boolean))).sort(),
    tabs,
    fingerprint: monitoringFingerprint(remote)
  };
}

export async function previewMonitoringFromPeer(ownerMap: OwnerMap, currentOwner: string): Promise<MonitoringSyncPreview> {
  return buildMonitoringPreview(await fetchMonitoringPeer(), ownerMap, currentOwner);
}

/* ==========================================================================
   PRIMENA
   ========================================================================== */
export interface MonitoringApplyInput {
  selected: unknown;
  mode: unknown;
  ownerMap?: unknown;
  fingerprint: string;
  actor: { id?: string; name?: string; email?: string } | null;
}

export interface MonitoringApplyResult {
  backupPath: string;
  added: number;
  replaced: number;
  skipped: { name: string; reason: string }[];
  missingCameras: number;
  peerHost: string;
}

let monitoringSyncRunning = false;

export async function applyMonitoringFromPeer(input: MonitoringApplyInput): Promise<MonitoringApplyResult> {
  if (!Array.isArray(input.selected) || input.selected.some(v => typeof v !== 'string')) {
    throw new SyncError('Spisak izabranih tabova nije ispravan.', 400);
  }
  const mode = input.mode === 'replace' ? 'replace' : 'skip';
  const ownerMap = normalizeOwnerMap(input.ownerMap);
  if (monitoringSyncRunning) throw new SyncError('Sinhronizacija tabova je već u toku.', 409);
  monitoringSyncRunning = true;
  try {
    const remote = await fetchMonitoringPeer();
    if (!input.fingerprint || monitoringFingerprint(remote) !== input.fingerprint) {
      throw new SyncError('Tabovi na drugom serveru su se u međuvremenu promenili. Ponovite pregled, pa potvrdite.', 409);
    }
    const selected = new Set(input.selected as string[]);
    const remoteById = new Map(remote.tabs.map(t => [t.id, t]));
    for (const id of selected) {
      if (!remoteById.has(id)) throw new SyncError('Izabran je tab koji nije na drugom serveru. Ponovite pregled.', 409);
    }

    initSchema();
    initMonitoringSchema();
    const db = getDb();

    const snapDir = path.join(process.cwd(), 'data', 'backups', 'snapshots');
    fs.mkdirSync(snapDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(snapDir, `unipromet_${stamp}_pre_sinhronizacija_tabova.db`);
    await db.backup(backupPath);

    const ipToId = new Map(
      (db.prepare('SELECT id, ip FROM cameras').all() as { id: string; ip: string }[]).map(r => [r.ip, r.id])
    );
    const localTabs = db.prepare('SELECT id, owner, name FROM monitoring_tabs').all() as { id: string; owner: string; name: string }[];
    const localByKey = new Map(localTabs.map(t => [`${t.owner}\u0000${t.name}`, t.id]));
    const perOwner = new Map<string, number>();
    for (const t of localTabs) perOwner.set(t.owner, (perOwner.get(t.owner) || 0) + 1);
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM monitoring_tabs WHERE owner = ?');
    const insert = db.prepare(
      'INSERT INTO monitoring_tabs (id, owner, name, position, template_id, layout, cameras, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const update = db.prepare('UPDATE monitoring_tabs SET template_id = ?, layout = ?, cameras = ?, updated_at = ? WHERE id = ?');

    const now = new Date().toISOString();
    let added = 0;
    let replaced = 0;
    let missingCameras = 0;
    const skipped: { name: string; reason: string }[] = [];

    db.transaction(() => {
      for (const id of selected) {
        const t = remoteById.get(id)!;
        const owner = ownerMap[t.owner] || t.owner;
        const layout = validateLayout(t.layout);
        const cameras = t.slots.map(ip => {
          if (!ip) return null;
          const local = ipToId.get(ip);
          if (!local) missingCameras++;
          return local || null;
        });
        const key = `${owner}\u0000${t.name}`;
        const localId = localByKey.get(key);
        if (localId) {
          if (mode === 'skip') {
            skipped.push({ name: t.name, reason: 'Tab istog vlasnika i naziva već postoji (preskočen)' });
            continue;
          }
          update.run(t.templateId || '', JSON.stringify(layout), JSON.stringify(cameras), now, localId);
          replaced++;
          continue;
        }
        if ((perOwner.get(owner) || 0) >= MAX_TABS) {
          skipped.push({ name: t.name, reason: `Vlasnik ${owner} već ima najviše ${MAX_TABS} tabova` });
          continue;
        }
        const newId = `mtab-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
        const position = (maxPos.get(owner) as { p: number }).p + 1;
        insert.run(newId, owner, t.name, position, t.templateId || '', JSON.stringify(layout), JSON.stringify(cameras), t.createdAt || now, null);
        perOwner.set(owner, (perOwner.get(owner) || 0) + 1);
        localByKey.set(key, newId);
        added++;
      }
    })();

    return { backupPath, added, replaced, skipped, missingCameras, peerHost: String(remote.source.host || '') };
  } finally {
    monitoringSyncRunning = false;
  }
}
