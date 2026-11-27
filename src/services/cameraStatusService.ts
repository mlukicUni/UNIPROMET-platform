import type { Statement } from 'better-sqlite3';
import { getDb } from '../db/sqlite';
import { parseAnalogIp } from './analogChannels';
import { cameraAnswers } from './cameraProbe';

/**
 * ==========================================================================
 * STATUS KAMERA NA ZAHTEV
 * Nema stalne provere u pozadini: kamere se proveravaju kad ih neko gleda
 * (lista u Mreža → Kamere, Video nadzor, Monitoring), a stranica ponavlja upit
 * na ~30 s dok je otvorena. Rezultat se pamti 25 s, pa više ljudi koji gledaju
 * iste kamere ne pravi duple upite. Analogni kanali se proveravaju preko svog
 * snimača (jedan upit za sve kanale istog snimača).
 * Tabela camera_status čuva poslednji status i od kada traje; u nju upisuje
 * i zakazana provera kamera (5 puta dnevno).
 * ==========================================================================
 */

export interface CameraStatus {
  ip: string;
  online: boolean;
  since: string;       // od kada je kamera u ovom stanju
  checkedAt: string;   // vreme poslednje provere
}

const CACHE_TTL_MS = 25_000;
// Tempo: najviše 4 provere istovremeno u Čačku i 2 preko WAN-a (Kraljevo), sa razmakom između početaka
const LIMITS = { local: { max: 4, gapMs: 40 }, wan: { max: 2, gapMs: 120 } };

let schemaReady = false;
function initSchema(): void {
  if (schemaReady) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS camera_status (
      ip TEXT PRIMARY KEY,
      online INTEGER NOT NULL,
      since TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      source TEXT
    )
  `);
  schemaReady = true;
}

interface StatusRow { ip: string; online: number; since: string; checked_at: string }

function rowToStatus(r: StatusRow): CameraStatus {
  return { ip: r.ip, online: r.online === 1, since: r.since, checkedAt: r.checked_at };
}

/** Upis rezultata; "since" se menja samo kad se stanje promeni */
export function recordCameraStatus(ip: string, online: boolean, at: string, source: string): CameraStatus {
  initSchema();
  const stmts = statements();
  const key = ip.trim();
  const prev = stmts.select.get(key) as StatusRow | undefined;
  // Isti rezultat provere (isto stanje i isto vreme provere, npr. iz keša od 25 s) ne upisuje se ponovo
  if (prev && (prev.online === 1) === online && prev.checked_at === at) {
    return { ip: key, online, since: prev.since, checkedAt: at };
  }
  const since = prev && (prev.online === 1) === online ? prev.since : at;
  stmts.upsert.run(key, online ? 1 : 0, since, at, source);
  return { ip: key, online, since, checkedAt: at };
}

// Pripremljene naredbe se prave jednom po otvorenoj vezi (ranije se kompajlirale pri svakom upisu)
let cachedStatements: { db: unknown; select: Statement; upsert: Statement } | null = null;
function statements() {
  const db = getDb();
  if (!cachedStatements || cachedStatements.db !== db) {
    cachedStatements = {
      db,
      select: db.prepare('SELECT * FROM camera_status WHERE ip = ?'),
      upsert: db.prepare(`INSERT INTO camera_status (ip, online, since, checked_at, source) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(ip) DO UPDATE SET online = excluded.online, since = excluded.since,
                checked_at = excluded.checked_at, source = excluded.source`)
    };
  }
  return cachedStatements;
}

/** Upis rezultata zakazane provere za sve proverene kamere odjednom */
export function recordScheduledResults(ips: string[], offlineIps: Set<string>): void {
  initSchema();
  const at = new Date().toISOString();
  const tx = getDb().transaction(() => {
    for (const ip of ips) recordCameraStatus(ip, !offlineIps.has(ip.trim()), at, 'scheduled');
  });
  tx();
}

/** Svi sačuvani statusi (za listu kamera pri učitavanju, bez nove provere) */
export function getAllCameraStatuses(): Map<string, CameraStatus> {
  initSchema();
  const rows = getDb().prepare('SELECT * FROM camera_status').all() as StatusRow[];
  return new Map(rows.map(r => [r.ip, rowToStatus(r)]));
}

/* ---------- Provera na zahtev ---------- */
const cache = new Map<string, { online: boolean; at: number }>(); // ključ = uređaj koji se proverava (kamera ili snimač)
const inFlight = new Map<string, Promise<{ online: boolean; at: number }>>();

function probeHost(ip: string): string {
  const analog = parseAnalogIp(ip);
  return analog ? analog.recorderIp : ip.trim();
}

class Pacer {
  private running = 0;
  private lastStart = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number, private gapMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.running++;
        this.lastStart = Date.now();
        fn().then(resolve, reject).finally(() => {
          this.running--;
          this.pump();
        });
      });
      this.pump();
    });
  }

  private pump(): void {
    if (!this.queue.length || this.running >= this.max) return;
    const wait = this.lastStart + this.gapMs - Date.now();
    if (wait > 0) {
      setTimeout(() => this.pump(), wait);
      return;
    }
    const next = this.queue.shift()!;
    next();
    if (this.queue.length) this.pump();
  }
}

const pacers = { local: new Pacer(LIMITS.local.max, LIMITS.local.gapMs), wan: new Pacer(LIMITS.wan.max, LIMITS.wan.gapMs) };

function checkHost(host: string, sampleIp: string): Promise<{ online: boolean; at: number }> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit);
  const running = inFlight.get(host);
  if (running) return running;
  const pacer = host.includes('.125.') ? pacers.wan : pacers.local;
  const p = pacer.run(() => cameraAnswers(sampleIp))
    .catch(() => false)
    .then(online => {
      const r = { online, at: Date.now() };
      cache.set(host, r);
      return r;
    })
    .finally(() => inFlight.delete(host));
  inFlight.set(host, p);
  return p;
}

/**
 * Proverava zadate kamere (po IP adresi; analogni kanal "<snimač>~chN") i vraća status za svaku.
 * Rezervisane/prazne adrese pozivalac ne šalje.
 */
export async function checkCameraStatuses(ips: string[]): Promise<CameraStatus[]> {
  const unique = [...new Set(ips.map(i => String(i || '').trim()).filter(Boolean))];
  const probed = await Promise.all(unique.map(async ip => ({ ip, r: await checkHost(probeHost(ip), ip) })));
  // Upis svih rezultata u jednoj transakciji (ranije jedna po kameri)
  const results: CameraStatus[] = [];
  getDb().transaction(() => {
    for (const { ip, r } of probed) {
      results.push(recordCameraStatus(ip, r.online, new Date(r.at).toISOString(), 'on-demand'));
    }
  })();
  return results;
}
