import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { DMS_REPORTS_DIR, DMS_CACHE_DIR, initDmsDb } from '../../db/dmsDb';

/**
 * DMS izveštaji (Excel): čuvanje, JSON keš parsiranih listova i izbor najnovijeg izveštaja.
 * Imena fajlova počinju datumom (npr. "20261030 DMS_Statistika-Unipromet.xlsx").
 */

const CACHE_VERSION = 2;
const EXCEL_RE = /\.xlsx?$/i;
const MAX_REPORT_BYTES = 60 * 1024 * 1024;

export interface ParsedReport {
  filename: string;
  cacheVersion: number;
  mtimeMs: number;
  mtime: string;
  size: number;
  sheetNames: string[];
  sheets: Record<string, any[][]>;
}

export interface ReportInfo {
  filename: string;
  size: number;
  mtime: string;
  mtimeMs: number;
}

/** Ime fajla bez putanje; prihvata samo Excel fajlove i ne dozvoljava izlazak iz foldera */
export function safeReportName(raw: string): string {
  const name = path.basename(String(raw || '').replace(/\\/g, '/')).trim();
  if (!name || name.startsWith('.') || !EXCEL_RE.test(name)) {
    throw new Error('Dozvoljeni su samo Excel fajlovi (.xlsx, .xls)');
  }
  return name;
}

function reportPath(name: string): string {
  const full = path.join(DMS_REPORTS_DIR, name);
  if (path.dirname(full) !== DMS_REPORTS_DIR) throw new Error('Neispravan naziv fajla');
  return full;
}

export function listReports(): ReportInfo[] {
  initDmsDb();
  return fs.readdirSync(DMS_REPORTS_DIR)
    .filter(f => EXCEL_RE.test(f))
    .map(filename => {
      const st = fs.statSync(path.join(DMS_REPORTS_DIR, filename));
      return { filename, size: st.size, mtime: st.mtime.toISOString(), mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

/** Parsirani listovi jednog izveštaja (iz keša dok se fajl ne promeni) */
export function getParsedReport(filename: string): ParsedReport | null {
  initDmsDb();
  const name = safeReportName(filename);
  const file = reportPath(name);
  if (!fs.existsSync(file)) return null;

  const st = fs.statSync(file);
  const cacheFile = path.join(DMS_CACHE_DIR, `${name}.json`);

  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as ParsedReport;
      if (cached.cacheVersion === CACHE_VERSION && cached.mtimeMs === st.mtimeMs && cached.sheets) return cached;
    } catch {
      // oštećen keš: parsira se ponovo
    }
  }

  const workbook = XLSX.readFile(file);
  const sheets: Record<string, any[][]> = {};
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    if (sheet) sheets[sheetName] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
  });

  const parsed: ParsedReport = {
    filename: name,
    cacheVersion: CACHE_VERSION,
    mtimeMs: st.mtimeMs,
    mtime: st.mtime.toISOString(),
    size: st.size,
    sheetNames: workbook.SheetNames,
    sheets
  };
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(parsed));
  } catch (err) {
    console.warn('[DMS] Greška pri upisu keša:', err);
  }
  return parsed;
}

/**
 * Putanja do keš fajla izveštaja, bez učitavanja i parsiranja njegovog sadržaja (server ga šalje direktno).
 * Keš je važeći ako je verzija i vreme izmene u zaglavlju isto kao kod Excel fajla; inače se pravi ponovo.
 */
export function ensureReportCache(filename: string): { cacheFile: string; mtimeMs: number; size: number } | null {
  initDmsDb();
  const name = safeReportName(filename);
  const file = reportPath(name);
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  const cacheFile = path.join(DMS_CACHE_DIR, `${name}.json`);
  let valid = false;
  if (fs.existsSync(cacheFile)) {
    try {
      // Zaglavlje keša: {"filename":...,"cacheVersion":N,"mtimeMs":N,...}
      const fd = fs.openSync(cacheFile, 'r');
      const buf = Buffer.alloc(512);
      const n = fs.readSync(fd, buf, 0, 512, 0);
      fs.closeSync(fd);
      const head = buf.toString('utf8', 0, n);
      const ver = head.match(/"cacheVersion":(d+)/);
      const mt = head.match(/"mtimeMs":([d.]+)/);
      valid = !!ver && !!mt && Number(ver[1]) === CACHE_VERSION && Number(mt[1]) === st.mtimeMs;
    } catch {
      valid = false;
    }
  }
  if (!valid) getParsedReport(name); // pravi keš (Excel se parsira samo ovde)
  return fs.existsSync(cacheFile) ? { cacheFile, mtimeMs: st.mtimeMs, size: st.size } : null;
}

/** Parsirani podaci najnovijeg izveštaja (po datumu u imenu fajla) */
export function getLatestParsedReport(): ParsedReport | null {
  const latest = listReports().filter(r => /^\d{8}/.test(r.filename)).pop();
  return latest ? getParsedReport(latest.filename) : null;
}

export function saveReport(filename: string, content: Buffer): ReportInfo {
  initDmsDb();
  const name = safeReportName(filename);
  if (content.length === 0) throw new Error('Fajl je prazan');
  if (content.length > MAX_REPORT_BYTES) throw new Error('Fajl je prevelik (najviše 60 MB)');
  fs.writeFileSync(reportPath(name), content);
  // Keš se pravi odmah, da prvo otvaranje ne čeka parsiranje
  getParsedReport(name);
  const st = fs.statSync(reportPath(name));
  return { filename: name, size: st.size, mtime: st.mtime.toISOString(), mtimeMs: st.mtimeMs };
}

export function deleteReport(filename: string): boolean {
  initDmsDb();
  const name = safeReportName(filename);
  const file = reportPath(name);
  const cache = path.join(DMS_CACHE_DIR, `${name}.json`);
  const existed = fs.existsSync(file);
  if (existed) fs.unlinkSync(file);
  if (fs.existsSync(cache)) fs.unlinkSync(cache);
  return existed;
}

export function reportFileFor(filename: string): string | null {
  const file = reportPath(safeReportName(filename));
  return fs.existsSync(file) ? file : null;
}
