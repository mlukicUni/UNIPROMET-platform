import fs from 'fs';
import path from 'path';
import { getDb } from '../db/sqlite';
import { getAllCameraInventory } from '../db/cameraInventoryDb';
import { fetchCameraSnapshot } from './cameraLiveService';

/**
 * ==========================================================================
 * POSLEDNJA SLIKA SVAKE KAMERE
 * Po jedna slika po kameri (data/snapshots/<id>.jpg), nova zamenjuje staru, istorije nema.
 * Slike se uzimaju jednom mesečno (prvog radnog dana u mesecu od 10:30; ako server tada
 * ne radi, prvog sledećeg radnog dana) i ručno iz Mreža → Kamere.
 * Kamere se snimaju jedna po jedna, sa pauzom, samo sa sačuvanim lozinkama i bez ponavljanja.
 * Neuspela slika nikad ne briše dobru, pa offline kamera zadržava poslednju uspešnu sliku.
 * Slike se ne prenose sinhronizacijom ni gitom (data/ je van gita).
 * ==========================================================================
 */

const SNAP_DIR = path.join(process.cwd(), 'data', 'snapshots');
const PAUSE_MS = 1500;
const MONTHLY_TIME = '10:30';

let schemaReady = false;
function initSchema(): void {
  if (schemaReady) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS camera_snapshots (
      camera_id TEXT PRIMARY KEY,
      ip TEXT,
      taken_at TEXT NOT NULL,
      size INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS camera_snapshot_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      trigger TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      ok INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0
    );
  `);
  schemaReady = true;
}

function fileFor(cameraId: string): string {
  return path.join(SNAP_DIR, `${cameraId.replace(/[^A-Za-z0-9_-]/g, '_')}.jpg`);
}

export interface SnapshotInfo { takenAt: string; size: number }

export function getSnapshotInfoMap(): Map<string, SnapshotInfo> {
  initSchema();
  const rows = getDb().prepare('SELECT camera_id, taken_at, size FROM camera_snapshots').all() as { camera_id: string; taken_at: string; size: number }[];
  return new Map(rows.map(r => [r.camera_id, { takenAt: r.taken_at, size: r.size }]));
}

/** Putanja do slike kamere ako postoji */
export function getSnapshotFile(cameraId: string): { file: string; takenAt: string } | null {
  initSchema();
  const row = getDb().prepare('SELECT taken_at FROM camera_snapshots WHERE camera_id = ?').get(cameraId) as { taken_at: string } | undefined;
  const file = fileFor(cameraId);
  if (!row || !fs.existsSync(file)) return null;
  return { file, takenAt: row.taken_at };
}

function isJpeg(buf: Buffer): boolean {
  return buf.length > 1024 && buf[0] === 0xff && buf[1] === 0xd8;
}

/** Jedna kamera: jedan pokušaj; čuva se samo ispravna slika (preko privremenog fajla) */
async function captureOne(cam: { id: string; ip: string }): Promise<boolean> {
  try {
    const frame = await fetchCameraSnapshot(cam.ip.trim(), 'sub');
    if (!frame || !isJpeg(frame.data)) return false;
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    const file = fileFor(cam.id);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, frame.data);
    fs.renameSync(tmp, file);
    const takenAt = new Date().toISOString();
    getDb().prepare(`INSERT INTO camera_snapshots (camera_id, ip, taken_at, size) VALUES (?, ?, ?, ?)
                     ON CONFLICT(camera_id) DO UPDATE SET ip = excluded.ip, taken_at = excluded.taken_at, size = excluded.size`)
      .run(cam.id, cam.ip.trim(), takenAt, frame.data.length);
    return true;
  } catch {
    return false;
  }
}

/* ---------- Pokretanje (jedno u isto vreme) ---------- */
interface RunState { running: boolean; trigger: string; total: number; done: number; ok: number; failed: number; startedAt: string | null; finishedAt: string | null }
const state: RunState = { running: false, trigger: '', total: 0, done: 0, ok: 0, failed: 0, startedAt: null, finishedAt: null };

export function getSnapshotRunState(): RunState & { lastRun: any } {
  initSchema();
  const lastRun = getDb().prepare('SELECT * FROM camera_snapshot_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1').get() || null;
  return { ...state, lastRun };
}

function snapshotTargets(ids?: string[]): { id: string; ip: string }[] {
  const all = getAllCameraInventory().filter(c =>
    c.ip && !c.isReserved && (c.type === 'IP Kamera' || (c.type === 'Analogna' && c.ip.includes('~ch'))));
  if (!ids) return all.map(c => ({ id: c.id, ip: c.ip }));
  const want = new Set(ids);
  return all.filter(c => want.has(c.id)).map(c => ({ id: c.id, ip: c.ip }));
}

/** Slika jedne kamere odmah (ručno, iz liste) */
export async function captureCameraNow(cameraId: string): Promise<{ ok: boolean; takenAt?: string }> {
  initSchema();
  const [cam] = snapshotTargets([cameraId]);
  if (!cam) throw new Error('Kamera nije pronađena ili nema adresu.');
  const ok = await captureOne(cam);
  const info = ok ? getSnapshotInfoMap().get(cameraId) : undefined;
  return { ok, takenAt: info?.takenAt };
}

/** Sve kamere (ili zadate), redom, u pozadini. Vraća false ako je snimanje već u toku. */
export function startSnapshotRun(trigger: 'monthly' | 'manual', ids?: string[]): boolean {
  initSchema();
  if (state.running) return false;
  const targets = snapshotTargets(ids);
  const startedAt = new Date().toISOString();
  Object.assign(state, { running: true, trigger, total: targets.length, done: 0, ok: 0, failed: 0, startedAt, finishedAt: null });
  const runId = Number(getDb().prepare('INSERT INTO camera_snapshot_runs (started_at, trigger, total) VALUES (?, ?, ?)')
    .run(startedAt, trigger, targets.length).lastInsertRowid);
  console.log(`[CameraSnapshots] Počinje uzimanje slika (${trigger}) za ${targets.length} kamera...`);

  (async () => {
    // Analogni kanali istog snimača idu jedan za drugim kao i ostale kamere (sve je redom)
    for (const cam of targets) {
      const ok = await captureOne(cam);
      state.done++;
      if (ok) state.ok++; else state.failed++;
      await new Promise(r => setTimeout(r, PAUSE_MS));
    }
  })()
    .catch(err => console.error('[CameraSnapshots] Greška:', err))
    .finally(() => {
      state.running = false;
      state.finishedAt = new Date().toISOString();
      try {
        getDb().prepare('UPDATE camera_snapshot_runs SET finished_at = ?, ok = ?, failed = ? WHERE id = ?')
          .run(state.finishedAt, state.ok, state.failed, runId);
      } catch { /* ignorisano */ }
      console.log(`[CameraSnapshots] Završeno: ${state.ok} slika sačuvano, ${state.failed} kamera bez slike (stara slika ostaje).`);
    });
  return true;
}

/* ---------- Mesečno ---------- */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Prvi radni dan meseca ili kasnije (ako tada nije urađeno), radnim danom posle 10:30, jednom mesečno */
function monthlyDue(now: Date): boolean {
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hhmm < MONTHLY_TIME) return false;
  const key = monthKey(now);
  const done = getDb().prepare("SELECT 1 FROM camera_snapshot_runs WHERE trigger = 'monthly' AND substr(started_at, 1, 7) = ? LIMIT 1")
    .get(key);
  return !done;
}

let monthlyTimer: NodeJS.Timeout | null = null;
export function initMonthlySnapshots(): void {
  initSchema();
  if (monthlyTimer) clearInterval(monthlyTimer);
  console.log(`[CameraSnapshots] Mesečne slike kamera: prvog radnog dana u mesecu od ${MONTHLY_TIME}h`);
  monthlyTimer = setInterval(() => {
    try {
      if (!state.running && monthlyDue(new Date())) startSnapshotRun('monthly');
    } catch (err) {
      console.error('[CameraSnapshots] Greška u mesečnom rasporedu:', err);
    }
  }, 60_000);
}
