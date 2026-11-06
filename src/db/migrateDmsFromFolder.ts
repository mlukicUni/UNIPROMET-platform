import fs from 'fs';
import path from 'path';
import {
  DMS_REPORTS_DIR, initDmsDb, getDmsUser, upsertDmsUser, getScheduledMail, saveScheduledMail,
  kvLoadAll, kvSet, DmsScheduledMail
} from './dmsDb';

/**
 * Jednokratni prenos podataka iz samostalne aplikacije "DMS - analiza podataka".
 *
 *   npx tsx src/db/migrateDmsFromFolder.ts "<putanja do foldera stare aplikacije>"
 *
 * Prenosi: Excel izveštaje (uploads/*.xlsx), korisnike (src/data/users.json), zakazane mailove,
 * potvrde potpisa, izmene "potpis na obe strane" i rezultate OCR analize (data/*.json).
 * Bezbedno je pokrenuti više puta: postojeći zapisi se ne prepisuju.
 * Zakazani mailovi se prenose ISKLJUČENI da stara i nova aplikacija ne bi slale iste mejlove; uključuju se u UI-ju.
 */

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Navedite putanju do foldera stare DMS aplikacije.');
  process.exit(1);
}

const readJson = <T>(rel: string, fallback: T): T => {
  const file = path.join(src, rel);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as T;
};

initDmsDb();

// Izveštaji
const uploads = path.join(src, 'uploads');
let reports = 0;
if (fs.existsSync(uploads)) {
  for (const f of fs.readdirSync(uploads).filter(n => /\.xlsx?$/i.test(n))) {
    const dest = path.join(DMS_REPORTS_DIR, f);
    if (fs.existsSync(dest)) continue;
    fs.copyFileSync(path.join(uploads, f), dest);
    reports++;
  }
}

// Korisnici
let users = 0;
const oldUsers = readJson<Record<string, any>>('src/data/users.json', {});
for (const u of Object.values(oldUsers)) {
  if (!u?.name || getDmsUser(u.name)) continue;
  upsertDmsUser({
    name: String(u.name).trim(),
    email: String(u.email || '').trim(),
    sector: String(u.sector || 'Nepoznat Sektor').trim(),
    location: String(u.location || '').trim(),
    isKeyUser: !!u.isKeyUser
  });
  users++;
}

// Zakazani mailovi (isključeni)
let mails = 0;
for (const m of readJson<any[]>('data/scheduled-mails.json', [])) {
  if (!m?.id || getScheduledMail(m.id)) continue;
  const item: DmsScheduledMail = {
    id: m.id,
    name: m.subject || m.name,
    subject: m.subject || m.name,
    body: m.body,
    recipients: m.recipients,
    schedule: m.schedule,
    enabled: false,
    createdAt: m.createdAt || new Date().toISOString(),
    lastSentAt: m.lastSentAt || null
  };
  saveScheduledMail(item);
  mails++;
}

// Potpisi
const kvImport = (store: 'signature_confirmations' | 'signature_bilateral' | 'scan_analysis', rel: string) => {
  const existing = kvLoadAll(store);
  let n = 0;
  for (const [key, value] of Object.entries(readJson<Record<string, unknown>>(rel, {}))) {
    if (key in existing) continue;
    kvSet(store, key, value);
    n++;
  }
  return n;
};
const confirmations = kvImport('signature_confirmations', 'data/signature-confirmations.json');
const bilateral = kvImport('signature_bilateral', 'data/signature-bilateral.json');
const analysis = kvImport('scan_analysis', 'data/scan-analysis.json');

console.log(`[DMS migracija] izveštaja: ${reports}, korisnika: ${users}, zakazanih mailova: ${mails} (isključeni), ` +
  `potvrda potpisa: ${confirmations}, izmena "obe strane": ${bilateral}, OCR analiza: ${analysis}`);
