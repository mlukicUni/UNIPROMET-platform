import crypto from 'crypto';
import fs from 'fs';
import express, { Router, Request, Response } from 'express';
import {
  listDmsUsers, getDmsUser, upsertDmsUser, deleteDmsUser, DmsUser, syncDmsUsersFromReport, DmsReportUser
} from '../db/dmsDb';
import {
  listReports, ensureReportCache, saveReport, deleteReport, reportFileFor
} from '../services/dms/reportFiles';
import * as reminder from '../services/dms/reminderService';
import * as scheduledMails from '../services/dms/scheduledMailService';
import * as signatureService from '../services/dms/signatureService';
import * as scanService from '../services/dms/scanService';
import { sendDmsMail, cleanRecipients } from '../services/dms/dmsMail';

/**
 * DMS ANALIZA PODATAKA - API (/api/dms/*). Dozvole su u routeAccess.ts.
 * Excel izveštaji i zip sa PDF-ovima šalju se kao sirovi sadržaj (application/octet-stream),
 * a ime fajla kao ?filename=, bez base64 pretvaranja.
 */
export const dmsRouter = Router();

const rawReport = express.raw({ type: 'application/octet-stream', limit: '60mb' });
const rawZip = express.raw({ type: 'application/octet-stream', limit: '150mb' });

const fail = (res: Response, err: unknown, status = 500) =>
  res.status(status).json({ success: false, error: (err as Error)?.message || String(err) });

/* ---------- Izveštaji (Excel) ---------- */

dmsRouter.get('/reports', (_req, res) => {
  try {
    res.json({ success: true, files: listReports() });
  } catch (err) { fail(res, err); }
});

// Parsirani listovi jednog izveštaja (klijent učitava izveštaje pojedinačno, sa ETag keširanjem).
// Keš fajl se šalje direktno iz fajla (bez učitavanja i ponovnog pretvaranja 6+ MB JSON-a u memoriji).
dmsRouter.get('/reports/:filename/parsed', (req: Request, res: Response) => {
  try {
    const info = ensureReportCache(req.params.filename);
    if (!info) return res.status(404).json({ success: false, error: 'Izveštaj nije pronađen' });
    const etag = `"${info.mtimeMs}-${info.size}"`;
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.setHeader('Cache-Control', 'private, no-cache');
    res.type('application/json');
    res.write('{"success":true,"file":');
    const stream = fs.createReadStream(info.cacheFile);
    stream.on('error', () => res.end('null}'));
    stream.on('end', () => res.end('}'));
    stream.pipe(res, { end: false });
  } catch (err) { fail(res, err, 400); }
});

dmsRouter.get('/reports/:filename', (req: Request, res: Response) => {
  try {
    const file = reportFileFor(req.params.filename);
    if (!file) return res.status(404).json({ success: false, error: 'Izveštaj nije pronađen' });
    res.download(file);
  } catch (err) { fail(res, err, 400); }
});

dmsRouter.post('/reports/upload', rawReport, (req: Request, res: Response) => {
  try {
    const filename = String(req.query.filename || '');
    if (!Buffer.isBuffer(req.body)) return fail(res, new Error('Sadržaj fajla nije poslat'), 400);
    const info = saveReport(filename, req.body);
    res.json({ success: true, file: info, message: `Izveštaj ${info.filename} je sačuvan.` });
  } catch (err) { fail(res, err, 400); }
});

dmsRouter.delete('/reports/:filename', (req: Request, res: Response) => {
  try {
    if (!deleteReport(req.params.filename)) return res.status(404).json({ success: false, error: 'Izveštaj nije pronađen' });
    res.json({ success: true });
  } catch (err) { fail(res, err, 400); }
});

/* ---------- Korisnici, ključna lica, službe ---------- */

const cleanText = (v: unknown, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);

function userFromBody(body: any, current?: DmsUser | null): DmsUser {
  const name = cleanText(body.name, current?.name || '');
  if (!name) throw new Error('Ime korisnika je obavezno');
  const email = body.email !== undefined ? cleanText(body.email) : (current?.email || '');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail adresa nije ispravna');
  return {
    name,
    email,
    sector: body.sector !== undefined ? (cleanText(body.sector) || 'Nepoznat Sektor') : (current?.sector || 'Nepoznat Sektor'),
    location: body.location !== undefined ? cleanText(body.location) : (current?.location || ''),
    isKeyUser: body.isKeyUser !== undefined ? Boolean(body.isKeyUser) : Boolean(current?.isKeyUser)
  };
}

// Isti oblik odgovora kao u staroj aplikaciji: { users: { "Ime Prezime": {...} } }
dmsRouter.get('/users', (_req, res) => {
  try {
    const users: Record<string, DmsUser> = {};
    listDmsUsers().forEach(u => { users[u.name] = u; });
    res.json({ success: true, count: Object.keys(users).length, users });
  } catch (err) { fail(res, err); }
});

dmsRouter.post('/users', (req, res) => {
  try {
    const user = userFromBody(req.body || {});
    if (getDmsUser(user.name)) return fail(res, new Error('Korisnik sa tim imenom već postoji'), 409);
    res.json({ success: true, user: upsertDmsUser(user) });
  } catch (err) { fail(res, err, 400); }
});

// Lista zaposlenih iz DMS izveštaja (učitavanje izveštaja): služba, lokacija i e-mail u bazi
dmsRouter.post('/users/sync', (req, res) => {
  try {
    const raw = req.body?.users;
    if (!Array.isArray(raw)) return fail(res, new Error('Lista korisnika nije ispravna'), 400);
    if (raw.length > 5000) return fail(res, new Error('Previše zapisa u jednom izveštaju'), 400);
    const clean: DmsReportUser[] = [];
    for (const u of raw) {
      const name = cleanText(u?.name);
      if (!name || name.length > 200) continue;
      const email = cleanText(u?.email);
      clean.push({
        name,
        email: /^[^s@]+@[^s@]+.[^s@]+$/.test(email) ? email.slice(0, 200) : '',
        sector: (cleanText(u?.sector) || 'Nepoznat Sektor').slice(0, 200),
        location: cleanText(u?.location).slice(0, 100)
      });
    }
    res.json({ success: true, ...syncDmsUsersFromReport(clean), count: clean.length });
  } catch (err) { fail(res, err, 400); }
});

dmsRouter.put('/users/:name', (req, res) => {
  try {
    const current = getDmsUser(req.params.name);
    if (!current) return fail(res, new Error('Korisnik nije pronađen'), 404);
    const user = userFromBody(req.body || {}, current);
    const clash = getDmsUser(user.name);
    if (clash && clash.name.toLowerCase() !== current.name.toLowerCase()) {
      return fail(res, new Error('Korisnik sa tim imenom već postoji'), 409);
    }
    res.json({ success: true, user: upsertDmsUser(user, current.name) });
  } catch (err) { fail(res, err, 400); }
});

dmsRouter.delete('/users/:name', (req, res) => {
  if (!deleteDmsUser(req.params.name)) return fail(res, new Error('Korisnik nije pronađen'), 404);
  res.json({ success: true });
});

/* ---------- Slanje mejla (pošiljalac je uvek adresa platforme) ---------- */

dmsRouter.post('/mail/send', async (req, res) => {
  try {
    const { to, subject, body } = req.body || {};
    const list = Array.isArray(to) ? to : String(to || '').split(/[;,]/);
    const recipients = cleanRecipients(list);
    const title = cleanText(subject, 'DMS Analitika obaveštenje').slice(0, 200);
    const text = String(body || '');
    if (!text.trim()) return fail(res, new Error('Sadržaj poruke je obavezan'), 400);
    if (text.length > 50000) return fail(res, new Error('Poruka je predugačka'), 400);
    await sendDmsMail(title, text, recipients);
    res.json({ success: true, recipients });
  } catch (err) { fail(res, err, 400); }
});

/* ---------- Podsetnik za overu računa ---------- */

dmsRouter.get('/reminders/status', (_req, res) => {
  res.json({ success: true, due: reminder.isReminderDay() });
});

dmsRouter.get('/reminders/preview', (_req, res) => {
  try {
    res.json({ success: true, ...reminder.buildReminder() });
  } catch (err) { fail(res, err); }
});

dmsRouter.post('/reminders/send', async (req, res) => {
  try {
    res.json(await reminder.sendReminder(req.body?.recipients || null));
  } catch (err) { fail(res, err, 400); }
});

/* ---------- Zakazani mailovi ---------- */

dmsRouter.get('/scheduled-mails', (_req, res) => {
  try {
    res.json({ success: true, items: scheduledMails.list() });
  } catch (err) { fail(res, err); }
});

dmsRouter.post('/scheduled-mails', (req, res) => {
  try {
    res.json({ success: true, item: scheduledMails.save(req.body || {}) });
  } catch (err) { fail(res, err, 400); }
});

dmsRouter.delete('/scheduled-mails/:id', (req, res) => {
  try {
    res.json(scheduledMails.remove(req.params.id));
  } catch (err) { fail(res, err, 404); }
});

dmsRouter.post('/scheduled-mails/:id/send', async (req, res) => {
  try {
    res.json(await scheduledMails.sendNow(req.params.id));
  } catch (err) { fail(res, err); }
});

/* ---------- Provera potpisa (zip sa PDF dokumentima) ---------- */

// Zip poslednje provere ostaje u memoriji, pa se OCR pokreće po dokumentu bez ponovnog slanja zipa
const jobs = new Map<string, Buffer>();
const sha1 = (buf: Buffer) => crypto.createHash('sha1').update(buf).digest('hex');

// PDF sa slikom (sken, elektronski potpisan ili ne): radi se OCR analiza za potpis na obe strane
const needsScan = (d: any) => d.type === 'pdf' && d.hasImages;

/**
 * Potpis na obe strane: { value: automatski predlog, sure: je li predlog pouzdan }
 * Elektronski potpisi su pouzdani (dva = obostrano, jedan = jedna strana, ako nema skena).
 * Sken je pouzdan samo kada su pronađene bar dve oznake "potpis", inače je predlog nesiguran.
 */
function bilateralFor(d: any, scan: any) {
  const eSides = Math.min((d.signatures || []).filter((s: any) => s.valid && !s.isTimestamp).length, 2);
  if (eSides >= 2) return { value: true, sure: true };
  if (!d.hasImages) return { value: eSides === 1 ? false : null, sure: eSides === 1 };
  if (!scan) return { value: null, sure: false };
  // Strane po potpisnicima: e-potpis je jedna od tih strana, pa se ne broji dvaput
  if (scan.labelBased) {
    const sides = Math.max(eSides, scan.signedSides || 0);
    return { value: sides >= 2 ? true : (sides === 1 ? false : null), sure: sides > 0 };
  }
  const sides = eSides + (scan.signedSides || 0);
  const value = sides >= 2 ? true : scanService.decideBilateral({ labels: scan.labels, stamps: scan.stamps || 0, sides });
  return { value, sure: (scan.labels || 0) >= 2 };
}

// Potvrda, Da/Ne izmena i rezultat analize se spajaju u dokument
function mergeDoc(d: any, { confirmations, bilateral, analysis }: { confirmations: any; bilateral: any; analysis: any }) {
  d.confirmed = d.type === 'pdf' && signatureService.isConfirmed(d.name, confirmations);
  const key = signatureService.confirmKey(d.name);
  const scan = analysis[key];
  if (d.type === 'pdf') {
    const auto = bilateralFor(d, scan);
    d.bilateralAuto = auto.value;
    d.bilateralSure = auto.sure;
  }
  if (scan) {
    d.analysis = { labels: scan.labels, withInk: scan.withInk, inkMarks: scan.inkMarks, stamps: scan.stamps || 0, skippedPages: scan.skippedPages || 0 };
  }
  // Korisnikova izmena ima prednost nad automatskom naznakom
  const saved = bilateral[key] || { override: null };
  d.bilateralOverride = saved.override;
  const override = saved.override === null || saved.override === undefined ? null : saved.override;
  d.bilateral = override !== null ? override : (d.bilateralAuto === undefined ? null : d.bilateralAuto);
}

// Brza provera zipa (bez OCR-a): vraća dokumente i listu skenova koje treba analizirati
dmsRouter.post('/signatures/check', rawZip, (req: Request, res: Response) => {
  try {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return fail(res, new Error('Zip fajl nije poslat'), 400);
    }
    const report = signatureService.checkZipBuffer(buf);
    const jobId = crypto.randomUUID();
    jobs.clear();
    jobs.set(jobId, buf);

    const confirmations = signatureService.loadConfirmations();
    const bilateral = signatureService.loadBilateral();
    const analysis = scanService.loadAnalysis();
    const pending: { name: string; container: string }[] = [];
    let cached = 0;
    report.documents.forEach((d: any) => {
      // Keš se koristi samo ako je ista verzija analize i isti PDF (heš); stari rezultat se ne prikazuje
      let fresh: Record<string, any> = {};
      let isFresh = false;
      if (needsScan(d)) {
        const key = signatureService.confirmKey(d.name);
        const current = analysis[key];
        isFresh = !!current && current.version === scanService.ANALYSIS_VERSION
          && current.hash === sha1(signatureService.extractPdf(buf, d.container || '', d.name));
        if (isFresh) fresh = { [key]: current };
      }
      mergeDoc(d, { confirmations, bilateral, analysis: fresh });
      if (!needsScan(d)) return;
      if (isFresh) { cached++; return; }
      pending.push({ name: d.name, container: d.container || '' });
    });
    res.json({
      success: true,
      fileName: String(req.query.name || '') || null,
      ...report,
      jobId,
      scan: { total: cached + pending.length, done: cached, pending }
    });
  } catch (err) {
    fail(res, new Error('Zip nije moguće pročitati: ' + (err as Error).message), 400);
  }
});

// OCR analiza jednog skeniranog dokumenta iz provere (zip je u memoriji po jobId)
dmsRouter.post('/signatures/scan', async (req, res) => {
  try {
    const { jobId, name, container } = req.body || {};
    const buf = jobs.get(jobId);
    if (!buf || !name) return fail(res, new Error('Provera je istekla, izaberi zip ponovo'), 404);
    const pdf = signatureService.extractPdf(buf, container || '', name);
    const result = await scanService.analyzeScan(pdf);
    if (!result.ok) return fail(res, new Error(result.error), 400);
    scanService.saveAnalysis(name, { ...result, hash: sha1(pdf) });
    const d: any = signatureService.checkPdf(name, pdf);
    mergeDoc(d, {
      confirmations: signatureService.loadConfirmations(),
      bilateral: signatureService.loadBilateral(),
      analysis: scanService.loadAnalysis()
    });
    res.json({
      success: true,
      doc: { analysis: d.analysis, bilateralAuto: d.bilateralAuto, bilateralSure: d.bilateralSure, bilateral: d.bilateral, bilateralOverride: d.bilateralOverride, confirmed: d.confirmed }
    });
  } catch (err) {
    fail(res, new Error('Analiza nije uspela: ' + (err as Error).message));
  }
});

// Pregled jednog PDF-a iz poslednje proverenog zipa (po jobId)
dmsRouter.post('/signatures/pdf', (req, res) => {
  try {
    const { jobId, container, name } = req.body || {};
    const buf = jobs.get(jobId);
    if (!buf || !name) return fail(res, new Error('Provera je istekla, izaberi zip ponovo'), 404);
    const pdf = signatureService.extractPdf(buf, container || '', name);
    res.type('application/pdf');
    res.set('Content-Disposition', 'inline');
    res.send(pdf);
  } catch (err) { fail(res, err, 404); }
});

// Izmena korisnika: potpis sa obe strane (true/false/'single'/'none', null = automatska naznaka)
dmsRouter.post('/signatures/bilateral', (req, res) => {
  try {
    const { name, override } = req.body || {};
    if (!name || typeof name !== 'string') return fail(res, new Error('Naziv dokumenta nije poslat'), 400);
    const patch: Record<string, unknown> = {};
    // 'single': jedna ugovorna strana; 'none': dokument nije potpisan
    if ([true, false, null, 'single', 'none'].includes(override)) patch.override = override;
    const saved = signatureService.setBilateral(name, patch);
    res.json({ success: true, override: saved.override });
  } catch (err) { fail(res, err); }
});

// Ručna potvrda da je skenirani dokument elektronski potpisan (ili njeno poništavanje)
dmsRouter.post('/signatures/confirm', (req, res) => {
  try {
    const { name, confirmed } = req.body || {};
    if (!name || typeof name !== 'string') return fail(res, new Error('Naziv dokumenta nije poslat'), 400);
    res.json({ success: true, ...signatureService.setConfirmation(name, confirmed === true) });
  } catch (err) { fail(res, err); }
});
