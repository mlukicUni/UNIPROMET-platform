import crypto from 'crypto';
import { getDb } from './sqlite';

/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - MONITORING (lični tabovi sa gridovima kamera)
 * Svaki korisnik ima svoje tabove, custom šablone i podešavanja rotacije.
 * Vlasnik je ključ korisnika (email/UPN malim slovima, inače ID sesije).
 * ==========================================================================
 */

export const MAX_CELLS = 25;
export const MAX_GRID = 8;
export const MAX_TABS = 30;
export const MAX_TEMPLATES = 50;

export interface GridCell {
  x: number; // kolona, od 1
  y: number; // red, od 1
  w: number; // broj kolona
  h: number; // broj redova
}

export interface GridLayout {
  cols: number;
  rows: number;
  cells: GridCell[];
}

export interface MonitoringTab {
  id: string;
  name: string;
  position: number;
  templateId: string;
  layout: GridLayout;
  /** ID kamere po polju (isti redosled kao layout.cells), null = prazno polje */
  cameras: (string | null)[];
  createdAt: string;
  updatedAt?: string;
}

export interface MonitoringTemplate {
  id: string;
  name: string;
  layout: GridLayout;
  createdAt: string;
  updatedAt?: string;
}

export type VideoFit = 'fill' | 'cover' | 'contain';
const FIT_MODES: VideoFit[] = ['fill', 'cover', 'contain'];

export interface MonitoringSettings {
  rotation: { enabled: boolean; intervalSec: number; tabIds: string[] };
  lastTabId: string;
  /** Kako video popunjava polje grida */
  fit: VideoFit;
}

const DEFAULT_SETTINGS: MonitoringSettings = {
  rotation: { enabled: false, intervalSec: 30, tabIds: [] },
  lastTabId: '',
  fit: 'fill'
};

/**
 * Šabloni 3 i 5 su prepravljeni tako da svako polje bude u razmeri kamere (16:9).
 * Tabovi napravljeni od starih verzija dobijaju novi raspored; broj polja i redosled kamera ostaju isti.
 */
const PRESET_LAYOUT_FIXES: { templateId: string; oldLayout: string; newLayout: GridLayout }[] = [
  {
    templateId: 'preset-3',
    oldLayout: JSON.stringify({ cols: 2, rows: 2, cells: [{ x: 1, y: 1, w: 1, h: 2 }, { x: 2, y: 1, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 }] }),
    newLayout: { cols: 3, rows: 2, cells: [{ x: 1, y: 1, w: 2, h: 2 }, { x: 3, y: 1, w: 1, h: 1 }, { x: 3, y: 2, w: 1, h: 1 }] }
  },
  {
    templateId: 'preset-5',
    oldLayout: JSON.stringify({ cols: 6, rows: 2, cells: [{ x: 1, y: 1, w: 3, h: 1 }, { x: 4, y: 1, w: 3, h: 1 }, { x: 1, y: 2, w: 2, h: 1 }, { x: 3, y: 2, w: 2, h: 1 }, { x: 5, y: 2, w: 2, h: 1 }] }),
    newLayout: { cols: 6, rows: 5, cells: [{ x: 1, y: 1, w: 3, h: 3 }, { x: 4, y: 1, w: 3, h: 3 }, { x: 1, y: 4, w: 2, h: 2 }, { x: 3, y: 4, w: 2, h: 2 }, { x: 5, y: 4, w: 2, h: 2 }] }
  }
];

function migratePresetLayouts(): void {
  const db = getDb();
  const update = db.prepare('UPDATE monitoring_tabs SET layout = ? WHERE template_id = ? AND layout = ?');
  for (const fix of PRESET_LAYOUT_FIXES) {
    const info = update.run(JSON.stringify(fix.newLayout), fix.templateId, fix.oldLayout);
    if (info.changes > 0) console.log(`[Monitoring] Ažuriran raspored ${fix.templateId} u ${info.changes} tab(ova)`);
  }
}

let schemaReady = false;

export function initMonitoringSchema(): void {
  if (schemaReady) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS monitoring_tabs (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      template_id TEXT DEFAULT '',
      layout TEXT NOT NULL,
      cameras TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS monitoring_templates (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      layout TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS monitoring_settings (
      owner TEXT PRIMARY KEY,
      settings TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_monitoring_tabs_owner ON monitoring_tabs(owner, position);
    CREATE INDEX IF NOT EXISTS idx_monitoring_templates_owner ON monitoring_templates(owner);
  `);
  migratePresetLayouts();
  schemaReady = true;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

/** Ključ vlasnika podataka monitoringa */
export function ownerKey(user: { id?: string; email?: string }): string {
  const email = (user.email || '').trim().toLowerCase();
  return email || (user.id || '').trim();
}

/* ==========================================================================
   VALIDACIJA
   ========================================================================== */
function cleanName(name: unknown, what: string): string {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!n) throw new Error(`Naziv ${what} je obavezan.`);
  if (n.length > 60) throw new Error(`Naziv ${what} može imati najviše 60 znakova.`);
  return n;
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/** Proverava raspored: dimenzije mreže, granice polja i preklapanje */
export function validateLayout(raw: any): GridLayout {
  if (!raw || typeof raw !== 'object') throw new Error('Raspored grida nije ispravan.');
  const cols = raw.cols;
  const rows = raw.rows;
  if (!isInt(cols, 1, MAX_GRID) || !isInt(rows, 1, MAX_GRID)) {
    throw new Error(`Mreža šablona mora biti od 1×1 do ${MAX_GRID}×${MAX_GRID}.`);
  }
  if (!Array.isArray(raw.cells) || raw.cells.length === 0) throw new Error('Šablon mora imati bar jedno polje.');
  if (raw.cells.length > MAX_CELLS) throw new Error(`Šablon može imati najviše ${MAX_CELLS} polja.`);

  const occupied = new Set<string>();
  const cells: GridCell[] = raw.cells.map((c: any, i: number) => {
    const { x, y, w, h } = c || {};
    if (!isInt(x, 1, cols) || !isInt(y, 1, rows) || !isInt(w, 1, cols) || !isInt(h, 1, rows) || x + w - 1 > cols || y + h - 1 > rows) {
      throw new Error(`Polje ${i + 1} izlazi van mreže šablona.`);
    }
    for (let cx = x; cx < x + w; cx++) {
      for (let cy = y; cy < y + h; cy++) {
        const key = `${cx}:${cy}`;
        if (occupied.has(key)) throw new Error(`Polje ${i + 1} se preklapa sa drugim poljem.`);
        occupied.add(key);
      }
    }
    return { x, y, w, h };
  });
  return { cols, rows, cells };
}

/** Dodela kamera mora da prati broj polja; nepostojeće vrednosti postaju prazna polja */
function normalizeCameras(raw: unknown, cellCount: number): (string | null)[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: (string | null)[] = [];
  for (let i = 0; i < cellCount; i++) {
    const v = list[i];
    out.push(typeof v === 'string' && v.trim() ? v.trim() : null);
  }
  return out;
}

/* ==========================================================================
   TABOVI
   ========================================================================== */
interface TabRow {
  id: string;
  name: string;
  position: number;
  template_id: string | null;
  layout: string;
  cameras: string;
  created_at: string;
  updated_at: string | null;
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function rowToTab(r: TabRow): MonitoringTab {
  const layout = parseJson<GridLayout>(r.layout, { cols: 1, rows: 1, cells: [{ x: 1, y: 1, w: 1, h: 1 }] });
  return {
    id: r.id,
    name: r.name,
    position: r.position,
    templateId: r.template_id || '',
    layout,
    cameras: normalizeCameras(parseJson<unknown[]>(r.cameras, []), layout.cells.length),
    createdAt: r.created_at,
    updatedAt: r.updated_at || undefined
  };
}

export function listTabs(owner: string): MonitoringTab[] {
  const rows = getDb()
    .prepare('SELECT * FROM monitoring_tabs WHERE owner = ? ORDER BY position, created_at')
    .all(owner) as TabRow[];
  return rows.map(rowToTab);
}

export function getTab(owner: string, id: string): MonitoringTab | null {
  const row = getDb().prepare('SELECT * FROM monitoring_tabs WHERE owner = ? AND id = ?').get(owner, id) as TabRow | undefined;
  return row ? rowToTab(row) : null;
}

export interface TabInput {
  name?: unknown;
  templateId?: unknown;
  layout?: unknown;
  cameras?: unknown;
}

export function createTab(owner: string, input: TabInput): MonitoringTab {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM monitoring_tabs WHERE owner = ?').get(owner) as { c: number }).c;
  if (count >= MAX_TABS) throw new Error(`Možete imati najviše ${MAX_TABS} tabova.`);

  const name = cleanName(input.name, 'taba');
  const layout = validateLayout(input.layout);
  const cameras = normalizeCameras(input.cameras, layout.cells.length);
  const maxPos = (db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM monitoring_tabs WHERE owner = ?').get(owner) as { p: number }).p;
  const id = newId('mtab');
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO monitoring_tabs (id, owner, name, position, template_id, layout, cameras, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, owner, name, maxPos + 1, String(input.templateId || ''), JSON.stringify(layout), JSON.stringify(cameras), now, now);
  return getTab(owner, id)!;
}

export function updateTab(owner: string, id: string, input: TabInput): MonitoringTab {
  const current = getTab(owner, id);
  if (!current) throw new Error('Tab nije pronađen.');

  const name = input.name !== undefined ? cleanName(input.name, 'taba') : current.name;
  const layout = input.layout !== undefined ? validateLayout(input.layout) : current.layout;
  const cameras = normalizeCameras(input.cameras !== undefined ? input.cameras : current.cameras, layout.cells.length);
  const templateId = input.templateId !== undefined ? String(input.templateId || '') : current.templateId;

  getDb()
    .prepare('UPDATE monitoring_tabs SET name = ?, template_id = ?, layout = ?, cameras = ?, updated_at = ? WHERE owner = ? AND id = ?')
    .run(name, templateId, JSON.stringify(layout), JSON.stringify(cameras), new Date().toISOString(), owner, id);
  return getTab(owner, id)!;
}

export function deleteTab(owner: string, id: string): void {
  const info = getDb().prepare('DELETE FROM monitoring_tabs WHERE owner = ? AND id = ?').run(owner, id);
  if (info.changes === 0) throw new Error('Tab nije pronađen.');
}

export function duplicateTab(owner: string, id: string): MonitoringTab {
  const src = getTab(owner, id);
  if (!src) throw new Error('Tab nije pronađen.');
  const name = `${src.name} (kopija)`.slice(0, 60);
  return createTab(owner, { name, templateId: src.templateId, layout: src.layout, cameras: src.cameras });
}

export function reorderTabs(owner: string, ids: unknown): MonitoringTab[] {
  if (!Array.isArray(ids)) throw new Error('Redosled tabova nije ispravan.');
  const db = getDb();
  const update = db.prepare('UPDATE monitoring_tabs SET position = ? WHERE owner = ? AND id = ?');
  db.transaction(() => {
    ids.forEach((id, i) => update.run(i, owner, String(id)));
  })();
  return listTabs(owner);
}

/* ==========================================================================
   CUSTOM ŠABLONI
   ========================================================================== */
interface TemplateRow {
  id: string;
  name: string;
  layout: string;
  created_at: string;
  updated_at: string | null;
}

function rowToTemplate(r: TemplateRow): MonitoringTemplate {
  return {
    id: r.id,
    name: r.name,
    layout: parseJson<GridLayout>(r.layout, { cols: 1, rows: 1, cells: [{ x: 1, y: 1, w: 1, h: 1 }] }),
    createdAt: r.created_at,
    updatedAt: r.updated_at || undefined
  };
}

export function listTemplates(owner: string): MonitoringTemplate[] {
  const rows = getDb()
    .prepare('SELECT * FROM monitoring_templates WHERE owner = ? ORDER BY created_at')
    .all(owner) as TemplateRow[];
  return rows.map(rowToTemplate);
}

export function createTemplate(owner: string, input: { name?: unknown; layout?: unknown }): MonitoringTemplate {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM monitoring_templates WHERE owner = ?').get(owner) as { c: number }).c;
  if (count >= MAX_TEMPLATES) throw new Error(`Možete imati najviše ${MAX_TEMPLATES} custom šablona.`);

  const name = cleanName(input.name, 'šablona');
  const layout = validateLayout(input.layout);
  const id = newId('mtpl');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO monitoring_templates (id, owner, name, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, owner, name, JSON.stringify(layout), now, now);
  return rowToTemplate(db.prepare('SELECT * FROM monitoring_templates WHERE id = ?').get(id) as TemplateRow);
}

export function updateTemplate(owner: string, id: string, input: { name?: unknown; layout?: unknown }): MonitoringTemplate {
  const db = getDb();
  const row = db.prepare('SELECT * FROM monitoring_templates WHERE owner = ? AND id = ?').get(owner, id) as TemplateRow | undefined;
  if (!row) throw new Error('Šablon nije pronađen.');
  const current = rowToTemplate(row);
  const name = input.name !== undefined ? cleanName(input.name, 'šablona') : current.name;
  const layout = input.layout !== undefined ? validateLayout(input.layout) : current.layout;
  db.prepare('UPDATE monitoring_templates SET name = ?, layout = ?, updated_at = ? WHERE owner = ? AND id = ?')
    .run(name, JSON.stringify(layout), new Date().toISOString(), owner, id);
  return rowToTemplate(db.prepare('SELECT * FROM monitoring_templates WHERE id = ?').get(id) as TemplateRow);
}

/** Tabovi čuvaju kopiju rasporeda, pa brisanje šablona ne menja postojeće tabove */
export function deleteTemplate(owner: string, id: string): void {
  const info = getDb().prepare('DELETE FROM monitoring_templates WHERE owner = ? AND id = ?').run(owner, id);
  if (info.changes === 0) throw new Error('Šablon nije pronađen.');
}

/* ==========================================================================
   PODEŠAVANJA (rotacija, poslednji tab)
   ========================================================================== */
export function getSettings(owner: string): MonitoringSettings {
  const row = getDb().prepare('SELECT settings FROM monitoring_settings WHERE owner = ?').get(owner) as { settings: string } | undefined;
  const saved = parseJson<Partial<MonitoringSettings>>(row?.settings, {});
  return {
    rotation: { ...DEFAULT_SETTINGS.rotation, ...(saved.rotation || {}) },
    lastTabId: saved.lastTabId || '',
    fit: saved.fit && FIT_MODES.includes(saved.fit) ? saved.fit : DEFAULT_SETTINGS.fit
  };
}

export function saveSettings(owner: string, input: any): MonitoringSettings {
  const current = getSettings(owner);
  const next: MonitoringSettings = { ...current, rotation: { ...current.rotation } };

  if (input && typeof input.lastTabId === 'string') next.lastTabId = input.lastTabId.slice(0, 80);
  if (input && input.fit !== undefined) {
    if (!FIT_MODES.includes(input.fit)) throw new Error('Nepoznat način prikaza videa.');
    next.fit = input.fit;
  }
  if (input && input.rotation && typeof input.rotation === 'object') {
    const r = input.rotation;
    if (typeof r.enabled === 'boolean') next.rotation.enabled = r.enabled;
    if (r.intervalSec !== undefined) {
      const sec = Number(r.intervalSec);
      if (!Number.isInteger(sec) || sec < 5 || sec > 3600) throw new Error('Interval rotacije mora biti od 5 do 3600 sekundi.');
      next.rotation.intervalSec = sec;
    }
    if (Array.isArray(r.tabIds)) next.rotation.tabIds = r.tabIds.map(String).slice(0, MAX_TABS);
  }

  getDb()
    .prepare(`INSERT INTO monitoring_settings (owner, settings, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(owner) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`)
    .run(owner, JSON.stringify(next), new Date().toISOString());
  return next;
}
