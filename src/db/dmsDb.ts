import path from 'path';
import fs from 'fs';
import { getDb } from './sqlite';

/**
 * ==========================================================================
 * DMS ANALIZA PODATAKA - baza i fajlovi
 * Tabele: dms_users (korisnici/službe), dms_scheduled_mails (zakazani mailovi),
 * dms_kv (potvrde potpisa, potpis na obe strane, rezultati OCR analize).
 * Excel izveštaji i njihov JSON keš su na disku u data/files/dms/.
 * ==========================================================================
 */

export const DMS_DIR = path.join(process.cwd(), 'data', 'files', 'dms');
export const DMS_REPORTS_DIR = path.join(DMS_DIR, 'reports');
export const DMS_CACHE_DIR = path.join(DMS_DIR, 'cache');

export interface DmsUser {
  name: string;
  email: string;
  sector: string;
  location: string;
  isKeyUser: boolean;
}

export interface DmsSchedule {
  type: 'once' | 'daily' | 'weekly' | 'monthly';
  time: string;
  date?: string;
  weekday?: number;
  days?: number[];
  day?: number;
}

export interface DmsScheduledMail {
  id: string;
  name: string;
  subject: string;
  body: string;
  recipients: string[];
  schedule: DmsSchedule;
  enabled: boolean;
  createdAt: string;
  lastSentAt: string | null;
}

export type DmsKvStore = 'signature_confirmations' | 'signature_bilateral' | 'scan_analysis';

let initialized = false;

export function initDmsDb(): void {
  if (initialized) return;
  fs.mkdirSync(DMS_REPORTS_DIR, { recursive: true });
  fs.mkdirSync(DMS_CACHE_DIR, { recursive: true });

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS dms_users (
      name TEXT PRIMARY KEY,
      email TEXT NOT NULL DEFAULT '',
      sector TEXT NOT NULL DEFAULT 'Nepoznat Sektor',
      location TEXT NOT NULL DEFAULT '',
      is_key_user INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dms_scheduled_mails (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      recipients TEXT NOT NULL,
      schedule TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dms_kv (
      store TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (store, key)
    );
  `);
  initialized = true;
}

/* ---------- Korisnici ---------- */

interface UserRow { name: string; email: string; sector: string; location: string; is_key_user: number }

const toUser = (r: UserRow): DmsUser => ({
  name: r.name, email: r.email, sector: r.sector, location: r.location, isKeyUser: !!r.is_key_user
});

export function listDmsUsers(): DmsUser[] {
  initDmsDb();
  return (getDb().prepare('SELECT * FROM dms_users ORDER BY name COLLATE NOCASE').all() as UserRow[]).map(toUser);
}

export function getDmsUser(name: string): DmsUser | null {
  initDmsDb();
  const row = getDb().prepare('SELECT * FROM dms_users WHERE name = ? COLLATE NOCASE').get(name) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function upsertDmsUser(user: DmsUser, replacesName?: string): DmsUser {
  initDmsDb();
  const db = getDb();
  db.transaction(() => {
    if (replacesName && replacesName.toLowerCase() !== user.name.toLowerCase()) {
      db.prepare('DELETE FROM dms_users WHERE name = ? COLLATE NOCASE').run(replacesName);
    }
    db.prepare(`
      INSERT INTO dms_users (name, email, sector, location, is_key_user) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET email = excluded.email, sector = excluded.sector,
        location = excluded.location, is_key_user = excluded.is_key_user
    `).run(user.name, user.email, user.sector, user.location, user.isKeyUser ? 1 : 0);
  })();
  return user;
}

export interface DmsReportUser { name: string; email: string; sector: string; location: string }

/**
 * Upisuje zaposlene iz liste "Korisnici" DMS izveštaja. Služba i lokacija se prepisuju;
 * e-mail se prepisuje samo kad izveštaj ima adresu (prazna ne briše postojeću).
 * Ručna oznaka "ključni korisnik" se nikad ne menja. Zaposleni koji nisu u izveštaju ostaju u bazi.
 */
export function syncDmsUsersFromReport(list: DmsReportUser[]): { added: number; updated: number } {
  initDmsDb();
  const db = getDb();
  const find = db.prepare('SELECT name, email, sector, location FROM dms_users WHERE name = ? COLLATE NOCASE');
  const ins = db.prepare('INSERT INTO dms_users (name, email, sector, location, is_key_user) VALUES (?, ?, ?, ?, 0)');
  const upd = db.prepare('UPDATE dms_users SET email = ?, sector = ?, location = ? WHERE name = ? COLLATE NOCASE');
  let added = 0;
  let updated = 0;
  db.transaction(() => {
    for (const u of list) {
      const cur = find.get(u.name) as { name: string; email: string; sector: string; location: string } | undefined;
      if (!cur) {
        ins.run(u.name, u.email, u.sector, u.location);
        added++;
        continue;
      }
      const email = u.email || cur.email;
      if (email !== cur.email || u.sector !== cur.sector || u.location !== cur.location) {
        upd.run(email, u.sector, u.location, u.name);
        updated++;
      }
    }
  })();
  return { added, updated };
}

export function deleteDmsUser(name: string): boolean {
  initDmsDb();
  return getDb().prepare('DELETE FROM dms_users WHERE name = ? COLLATE NOCASE').run(name).changes > 0;
}

export function findDmsUserByEmail(email: string): DmsUser | null {
  initDmsDb();
  const row = getDb().prepare('SELECT * FROM dms_users WHERE lower(email) = ?').get(email.toLowerCase().trim()) as UserRow | undefined;
  return row ? toUser(row) : null;
}

/* ---------- Zakazani mailovi ---------- */

interface MailRow {
  id: string; subject: string; body: string; recipients: string; schedule: string;
  enabled: number; created_at: string; last_sent_at: string | null;
}

const toMail = (r: MailRow): DmsScheduledMail => ({
  id: r.id, name: r.subject, subject: r.subject, body: r.body,
  recipients: JSON.parse(r.recipients), schedule: JSON.parse(r.schedule),
  enabled: !!r.enabled, createdAt: r.created_at, lastSentAt: r.last_sent_at
});

export function listScheduledMails(): DmsScheduledMail[] {
  initDmsDb();
  return (getDb().prepare('SELECT * FROM dms_scheduled_mails ORDER BY created_at').all() as MailRow[]).map(toMail);
}

export function getScheduledMail(id: string): DmsScheduledMail | null {
  initDmsDb();
  const row = getDb().prepare('SELECT * FROM dms_scheduled_mails WHERE id = ?').get(id) as MailRow | undefined;
  return row ? toMail(row) : null;
}

export function saveScheduledMail(m: DmsScheduledMail): void {
  initDmsDb();
  getDb().prepare(`
    INSERT INTO dms_scheduled_mails (id, subject, body, recipients, schedule, enabled, created_at, last_sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, body = excluded.body, recipients = excluded.recipients,
      schedule = excluded.schedule, enabled = excluded.enabled, last_sent_at = excluded.last_sent_at
  `).run(m.id, m.subject, m.body, JSON.stringify(m.recipients), JSON.stringify(m.schedule),
    m.enabled ? 1 : 0, m.createdAt, m.lastSentAt);
}

export function deleteScheduledMail(id: string): boolean {
  initDmsDb();
  return getDb().prepare('DELETE FROM dms_scheduled_mails WHERE id = ?').run(id).changes > 0;
}

/* ---------- Opšti ključ/vrednost (potpisi) ---------- */

export function kvLoadAll<T = any>(store: DmsKvStore): Record<string, T> {
  initDmsDb();
  const rows = getDb().prepare('SELECT key, value FROM dms_kv WHERE store = ?').all(store) as { key: string; value: string }[];
  const out: Record<string, T> = {};
  rows.forEach(r => { out[r.key] = JSON.parse(r.value); });
  return out;
}

export function kvSet(store: DmsKvStore, key: string, value: unknown): void {
  initDmsDb();
  getDb().prepare(`
    INSERT INTO dms_kv (store, key, value) VALUES (?, ?, ?)
    ON CONFLICT(store, key) DO UPDATE SET value = excluded.value
  `).run(store, key, JSON.stringify(value));
}

export function kvDelete(store: DmsKvStore, key: string): void {
  initDmsDb();
  getDb().prepare('DELETE FROM dms_kv WHERE store = ? AND key = ?').run(store, key);
}
