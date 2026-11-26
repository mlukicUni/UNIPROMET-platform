import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { CameraOverview, OvRole, OvUser, OvCameraRow, cameraById } from './cameraAccessOverview';
import { publicUrl } from '../utils/appConfig';

/**
 * Izvoz pregleda dozvola za pristup kamerama u Excel (isti izgled kao izvoz evidencije kamera).
 * Prvi list je „Pregled“ (jedan red po stavci). Svaka izvezena rola / korisnik / kamera dobija svoj list sa
 * zasebnim tabelama (podaci, spiskovi), jedna stavka po redu. Ako je stavki više od MAX_TABS, umesto
 * pojedinačnih listova prave se zajedničke tabele (jedna stavka po redu, nadređena stavka ponovljena u redu).
 */
export type OverviewView = 'roles' | 'users' | 'cameras';

interface Col { header: string; width: number; center?: boolean }
type Cell = string | number | { text: string; link: string };
interface Section { title: string; cols: Col[]; rows: Cell[][] }

/** Najviše pojedinačnih listova u jednom izvozu (više listova je nepregledno) */
export const MAX_TABS = 80;

const clean = (v: unknown, max = 32000): string => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);
const yn = (v: boolean) => (v ? 'Da' : 'Ne');
const FONT = 'Segoe UI';
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = (argb: string): ExcelJS.Border => ({ style: 'thin', color: { argb } });

/* ---------------------------- zajednički izgled ---------------------------- */
function band(ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook, logoId: number | null, lastCol: number, title: string, subtitle: string) {
  void wb;
  const lastLetter = ws.getColumn(lastCol).letter;
  const titleRow = ws.addRow(new Array(lastCol).fill(''));
  titleRow.height = 46;
  for (let c = 1; c <= lastCol; c++) {
    const cell = titleRow.getCell(c);
    cell.fill = fill('FF0F172A');
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFF59E0B' } } };
  }
  if (logoId !== null) ws.addImage(logoId, { tl: { col: 0.03, row: 0.2 }, ext: { width: 178, height: 38 } });
  // Uske tabele (do 3 kolone) ne spajaju ćelije: naslov se prelije u susedne prazne ćelije
  const wide = lastCol >= 4;
  if (wide) ws.mergeCells(`C1:${lastLetter}1`);
  const titleCell = ws.getCell(wide ? 'C1' : 'B1');
  titleCell.value = clean(title, 250);
  titleCell.font = { name: FONT, size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  const subtitleRow = ws.addRow([clean(subtitle, 500)]);
  if (wide) ws.mergeCells(`A2:${lastLetter}2`);
  subtitleRow.height = 22;
  const subCell = subtitleRow.getCell(1);
  subCell.font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FFF59E0B' } };
  subCell.fill = fill('FF1E293B');
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
}

function headerRow(ws: ExcelJS.Worksheet, cols: Col[]): ExcelJS.Row {
  const row = ws.addRow(cols.map(c => c.header));
  row.height = 28;
  row.eachCell((cell, idx) => {
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill('FF1E293B');
    cell.border = { top: thin('FF334155'), bottom: { style: 'medium', color: { argb: 'FFF59E0B' } }, left: thin('FF334155'), right: thin('FF334155') };
    cell.alignment = { vertical: 'middle', horizontal: cols[idx - 1].center ? 'center' : 'left', indent: cols[idx - 1].center ? 0 : 1 };
  });
  return row;
}

function dataRows(ws: ExcelJS.Worksheet, cols: Col[], rows: Cell[][], widths: number[]) {
  rows.forEach((r, i) => {
    const row = ws.addRow(r.map(v => (typeof v === 'number' ? v : typeof v === 'object' ? { text: clean(v.text), hyperlink: v.link } : clean(v))));
    row.height = 22;
    const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
    row.eachCell({ includeEmpty: true }, (cell, idx) => {
      const col = cols[idx - 1];
      if (!col) return;
      cell.font = { name: FONT, size: 10, color: { argb: 'FF0F172A' } };
      cell.fill = fill(bg);
      cell.border = { top: thin('FFE2E8F0'), bottom: thin('FFE2E8F0'), left: thin('FFE2E8F0'), right: thin('FFE2E8F0') };
      cell.alignment = { vertical: 'middle', horizontal: col.center ? 'center' : 'left', indent: col.center ? 0 : 1 };
      if (cell.value === 'Da') cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF047857' } };
      if (cell.value === 'Ne') cell.font = { name: FONT, size: 10, color: { argb: 'FF94A3B8' } };
      if (cell.value && typeof cell.value === 'object' && 'hyperlink' in cell.value) {
        cell.font = { name: FONT, size: 10, bold: true, underline: true, color: { argb: 'FF1D4ED8' } };
      }
      const len = cell.text ? cell.text.length : 0;
      widths[idx - 1] = Math.max(widths[idx - 1] || 0, len);
    });
  });
}

function applyWidths(ws: ExcelJS.Worksheet, minWidths: number[], contentLens: number[]) {
  minWidths.forEach((w, i) => { ws.getColumn(i + 1).width = Math.min(Math.max((contentLens[i] || 0) + 4, w), 70); });
}

/** Jedna tabela po listu: pregled i zajedničke tabele */
function addSheet(wb: ExcelJS.Workbook, logoId: number | null, name: string, title: string, subtitle: string, cols: Col[], rows: Cell[][]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 0, ySplit: 4, showGridLines: true }] });
  band(ws, wb, logoId, cols.length, title, subtitle);
  ws.addRow([]).height = 8;
  headerRow(ws, cols);
  const lens: number[] = cols.map(c => c.header.length);
  dataRows(ws, cols, rows, lens);
  applyWidths(ws, cols.map(c => c.width), lens);
  ws.autoFilter = { from: 'A4', to: `${ws.getColumn(cols.length).letter}4` };
}

/** List jedne stavke: više zasebnih tabela jedna ispod druge */
function addEntitySheet(wb: ExcelJS.Workbook, logoId: number | null, name: string, title: string, subtitle: string, sections: Section[]) {
  const maxCols = Math.max(...sections.map(s => s.cols.length));
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 0, ySplit: 3, showGridLines: true }] });
  band(ws, wb, logoId, maxCols, title, subtitle);
  ws.addRow([]).height = 8;

  const mins: number[] = new Array(maxCols).fill(12);
  const lens: number[] = new Array(maxCols).fill(0);
  let filter: string | null = null;
  const endCol = ws.getColumn(maxCols).letter;

  sections.forEach((s, si) => {
    s.cols.forEach((c, i) => { mins[i] = Math.max(mins[i], c.width); lens[i] = Math.max(lens[i], c.header.length); });

    const t = ws.addRow([clean(s.title, 200)]);
    t.height = 26;
    for (let c = 1; c <= maxCols; c++) {
      const cell = t.getCell(c);
      cell.fill = fill('FF0F172A');
      cell.border = { bottom: { style: 'medium', color: { argb: 'FFF59E0B' } } };
    }
    t.getCell(1).font = { name: FONT, size: 11, bold: true, color: { argb: 'FFF59E0B' } };
    t.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    const h = headerRow(ws, s.cols);
    const rows = s.rows.length ? s.rows : [['—']];
    dataRows(ws, s.cols, rows, lens);
    const lastRow = ws.lastRow ? ws.lastRow.number : h.number;
    // Filter na poslednjoj tabeli sa više redova (obično spisak kamera)
    if (si === sections.length - 1 && s.rows.length > 1) filter = `A${h.number}:${ws.getColumn(s.cols.length).letter}${lastRow}`;
    ws.addRow([]).height = 12;
  });

  applyWidths(ws, mins, lens);
  if (filter) ws.autoFilter = filter;
  void endCol;
}

/* ---------------------------- izvoz ---------------------------- */
export function buildOverviewWorkbook(overview: CameraOverview, view: OverviewView, keys: string[] | null, filters: string[]): ExcelJS.Workbook {
  const now = new Date();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UNIPROMET DOO ČAČAK';
  wb.lastModifiedBy = 'UNIPROMET Centralni IT Admin Panel';
  wb.created = now;

  let logoId: number | null = null;
  const logoPath = path.join(process.cwd(), 'public', 'assets', 'unipromet_logo.png');
  if (fs.existsSync(logoPath)) logoId = wb.addImage({ buffer: fs.readFileSync(logoPath) as any, extension: 'png' });

  const cams = cameraById(overview);
  const order = new Map(overview.cameras.map((c, i) => [c.id, i]));
  const byOrder = <T extends { id: string }>(list: T[]): T[] => list.slice().sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const pick = (key: string) => !keys || keys.includes(key);
  const filterText = filters.map(f => clean(f, 160)).filter(Boolean).join('   |   ');
  const stamp = `Datum izvoza: ${now.toLocaleDateString('sr-RS')} u ${now.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })}`;
  const tail = filterText ? `   |   ${filterText}` : '';

  const CAM_COLS: Col[] = [
    { header: 'Kamera', width: 30 }, { header: 'IP / Mrežni slot', width: 20 }, { header: 'Lokacija', width: 20 },
    { header: 'Snimač', width: 22 }, { header: 'Tip', width: 14 }, { header: 'Otvori u platformi', width: 20 }
  ];
  /** Veza ka kameri: prikazuje je u Video nadzoru ako korisnik ima pristup platformi i dozvolu za tu kameru */
  const camLink = (id: string): Cell => ({ text: 'Otvori kameru', link: `${publicUrl()}/kamera/${encodeURIComponent(id)}` });
  const camInfo = (id: string): Cell[] => {
    const c = cams.get(id);
    return c ? [c.position || c.name, c.ip, c.location, c.recorder, c.type, camLink(id)] : [id, '', '', '', '', camLink(id)];
  };
  const UZ: Col = { header: 'Uživo', width: 10, center: true };
  const SN: Col = { header: 'Snimci', width: 10, center: true };
  const KV: Col[] = [{ header: 'Polje', width: 26 }, { header: 'Vrednost', width: 60 }];

  /* imena listova: jedinstvena, do 31 znak, bez zabranjenih znakova */
  const used = new Set<string>(['pregled']);
  const sheetName = (base: string, alt?: string): string => {
    const fit = (s: string) => s.replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'List';
    for (const candidate of [fit(base), alt ? fit(alt) : '']) {
      if (candidate && !used.has(candidate.toLowerCase())) { used.add(candidate.toLowerCase()); return candidate; }
    }
    const root = fit(base);
    for (let i = 2; ; i++) {
      const suf = ` (${i})`;
      const cand = root.slice(0, 31 - suf.length) + suf;
      if (!used.has(cand.toLowerCase())) { used.add(cand.toLowerCase()); return cand; }
    }
  };
  const link = (name: string): string => `#'${name.replace(/'/g, "''")}'!A1`;

  /** Pregled + (po stavci) poseban list; više od MAX_TABS stavki → zajedničke tabele */
  const withTabs = <T>(items: T[], names: (t: T) => string[], build: (t: T) => { title: string; sections: Section[] }) => {
    if (items.length > MAX_TABS) return null;
    return items.map(item => {
      const [base, alt] = names(item);
      const name = sheetName(base, alt);
      return { name, item, make: () => { const b = build(item); addEntitySheet(wb, logoId, name, b.title, `${stamp}${tail}`, b.sections); } };
    });
  };
  const note = (n: number) => (n > MAX_TABS
    ? `   |   Zbog broja stavki (${n} > ${MAX_TABS}) nisu pravljeni pojedinačni listovi, već zajedničke tabele`
    : '   |   Svaka stavka ima poseban list (klik na naziv u prvoj koloni)');

  if (view === 'roles') {
    const roles = overview.roles.filter(r => pick(r.id));
    const tabs = withTabs<OvRole>(roles, r => [r.name], r => ({
      title: `UNIPROMET DOO ČAČAK — DOZVOLA: ${r.name}`,
      sections: [
        { title: 'Podaci o dozvoli', cols: KV, rows: [['Dozvola', r.name], ['Opis', r.description], ['Pristup kamerama', r.scope.join('; ')], ['Kamera uživo', r.liveCount], ['Kamera snimci', r.playbackCount]] },
        { title: `Korisnici (direktno): ${r.users.length}`, cols: [{ header: 'Korisnik', width: 30 }, { header: 'E-pošta', width: 38 }], rows: r.users.map(u => [u.name, u.email]) },
        { title: `AD grupe: ${r.groups.length}`, cols: [{ header: 'AD grupa', width: 36 }], rows: r.groups.map(g => [g.name]) },
        { title: `Poznati članovi AD grupa: ${r.groupMembers.length}`, cols: [{ header: 'AD grupa', width: 36 }, { header: 'Član', width: 30 }, { header: 'E-pošta', width: 38 }], rows: r.groupMembers.map(m => [m.group, m.name, m.email]) },
        { title: `Kamere: ${r.cameras.length}`, cols: [...CAM_COLS, UZ, SN], rows: byOrder(r.cameras).map(c => [...camInfo(c.id), yn(c.live), yn(c.playback)]) }
      ]
    }));
    const sum: Col[] = [
      { header: 'Dozvola', width: 32 }, { header: 'Opis', width: 40 }, { header: 'Pristup kamerama', width: 44 },
      { header: 'Korisnika (direktno)', width: 18, center: true }, { header: 'AD grupa', width: 12, center: true },
      { header: 'Poznatih članova AD grupa', width: 22, center: true }, { header: 'Kamera uživo', width: 14, center: true }, { header: 'Kamera snimci', width: 14, center: true }
    ];
    const nameOf = new Map((tabs || []).map(t => [t.item.id, t.name]));
    addSheet(wb, logoId, 'Pregled', 'UNIPROMET DOO ČAČAK — KAMERNE ROLE', `${stamp}   |   Broj dozvola: ${roles.length}${tail}${note(roles.length)}`, sum,
      roles.map(r => [nameOf.has(r.id) ? { text: r.name, link: link(nameOf.get(r.id)!) } : r.name, r.description, r.scope.join('; '), r.users.length, r.groups.length, r.groupMembers.length, r.liveCount, r.playbackCount]));
    if (tabs) tabs.forEach(t => t.make());
    else {
      const n = roles.length;
      const tbl = (name: string, title: string, cols: Col[], rows: Cell[][]) => addSheet(wb, logoId, name, `UNIPROMET DOO ČAČAK — ${title}`, `${stamp}   |   Broj dozvola: ${n}   |   Redova u tabeli: ${rows.length}${tail}`, cols, rows);
      tbl('Korisnici dozvole', 'KAMERNE DOZVOLE: KORISNICI (DIREKTNO)', [{ header: 'Dozvola', width: 30 }, { header: 'Korisnik', width: 30 }, { header: 'E-pošta', width: 38 }], roles.flatMap(r => r.users.map(u => [r.name, u.name, u.email] as Cell[])));
      tbl('AD grupe dozvole', 'KAMERNE DOZVOLE: AD GRUPE', [{ header: 'Dozvola', width: 30 }, { header: 'AD grupa', width: 36 }], roles.flatMap(r => r.groups.map(g => [r.name, g.name] as Cell[])));
      tbl('Članovi AD grupa', 'KAMERNE DOZVOLE: POZNATI ČLANOVI AD GRUPA', [{ header: 'Dozvola', width: 30 }, { header: 'AD grupa', width: 36 }, { header: 'Član', width: 30 }, { header: 'E-pošta', width: 38 }], roles.flatMap(r => r.groupMembers.map(m => [r.name, m.group, m.name, m.email] as Cell[])));
      tbl('Kamere dozvole', 'KAMERNE DOZVOLE: KAMERE', [{ header: 'Dozvola', width: 30 }, ...CAM_COLS, UZ, SN], roles.flatMap(r => byOrder(r.cameras).map(c => [r.name, ...camInfo(c.id), yn(c.live), yn(c.playback)] as Cell[])));
    }
  } else if (view === 'users') {
    const users = overview.users.filter(u => pick(u.key));
    const tabs = withTabs<OvUser>(users, u => [u.name, u.email], u => ({
      title: `UNIPROMET DOO ČAČAK — KORISNIK: ${u.name}`,
      sections: [
        {
          title: 'Podaci o korisniku', cols: KV, rows: [
            ['Korisnik', u.name], ['E-pošta', u.email], ['Super admin', yn(u.superAdmin)], ['Prijavljen na platformu', yn(u.loggedIn)],
            ['Poslednja prijava', u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('sr-RS') : ''], ['Kamera uživo', u.liveCount], ['Kamera snimci', u.playbackCount]
          ]
        },
        {
          title: `Dozvole: ${u.roles.length + (u.superAdmin ? 1 : 0)}`, cols: [{ header: 'Dozvola', width: 34 }, { header: 'Dobija je', width: 44 }],
          rows: [...u.roles.flatMap(r => r.via.map(v => [r.name, v] as Cell[])), ...(u.superAdmin ? [['Super admin', 'ugrađeno pravilo (sve kamere)']] : [])]
        },
        {
          title: `Kamere: ${u.allCameras ? overview.cameras.length : u.cameras.length}`, cols: [...CAM_COLS, UZ, SN, { header: 'Preko dozvola', width: 40 }],
          rows: u.allCameras
            ? overview.cameras.map(c => [...camInfo(c.id), 'Da', 'Da', 'Super admin'] as Cell[])
            : byOrder(u.cameras).map(c => [...camInfo(c.id), yn(c.live), yn(c.playback), c.roles.join(', ')] as Cell[])
        }
      ]
    }));
    const sum: Col[] = [
      { header: 'Korisnik', width: 30 }, { header: 'E-pošta', width: 38 }, { header: 'Super admin', width: 14, center: true },
      { header: 'Prijavljen na platformu', width: 22, center: true }, { header: 'Poslednja prijava', width: 22 },
      { header: 'Broj dozvola', width: 12, center: true }, { header: 'Kamera uživo', width: 14, center: true }, { header: 'Kamera snimci', width: 14, center: true }
    ];
    const nameOf = new Map((tabs || []).map(t => [t.item.key, t.name]));
    addSheet(wb, logoId, 'Pregled', 'UNIPROMET DOO ČAČAK — KORISNICI KAMERA', `${stamp}   |   Broj korisnika: ${users.length}${tail}${note(users.length)}`, sum,
      users.map(u => [nameOf.has(u.key) ? { text: u.name, link: link(nameOf.get(u.key)!) } : u.name, u.email, yn(u.superAdmin), yn(u.loggedIn),
        u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('sr-RS') : '', u.roles.length, u.liveCount, u.playbackCount]));
    if (tabs) tabs.forEach(t => t.make());
    else {
      const n = users.length;
      const tbl = (name: string, title: string, cols: Col[], rows: Cell[][]) => addSheet(wb, logoId, name, `UNIPROMET DOO ČAČAK — ${title}`, `${stamp}   |   Broj korisnika: ${n}   |   Redova u tabeli: ${rows.length}${tail}`, cols, rows);
      tbl('Dozvole korisnika', 'KORISNICI KAMERA: DOZVOLE', [{ header: 'Korisnik', width: 30 }, { header: 'E-pošta', width: 38 }, { header: 'Dozvola', width: 32 }, { header: 'Dobija je', width: 40 }],
        users.flatMap(u => {
          const rows = u.roles.flatMap(r => r.via.map(v => [u.name, u.email, r.name, v] as Cell[]));
          if (u.superAdmin) rows.push([u.name, u.email, 'Super admin', 'ugrađeno pravilo (sve kamere)']);
          return rows;
        }));
      tbl('Kamere korisnika', 'KORISNICI KAMERA: KAMERE', [{ header: 'Korisnik', width: 30 }, { header: 'E-pošta', width: 38 }, ...CAM_COLS, UZ, SN, { header: 'Preko dozvola', width: 40 }],
        users.flatMap(u => u.allCameras
          ? overview.cameras.map(c => [u.name, u.email, ...camInfo(c.id), 'Da', 'Da', 'Super admin'] as Cell[])
          : byOrder(u.cameras).map(c => [u.name, u.email, ...camInfo(c.id), yn(c.live), yn(c.playback), c.roles.join(', ')] as Cell[])));
    }
  } else {
    const rows = overview.cameraRows.filter(c => pick(c.id));
    const tabs = withTabs<OvCameraRow>(rows, c => [c.position || c.name, `${c.position || c.name} ${c.ip}`], c => ({
      title: `UNIPROMET DOO ČAČAK — KAMERA: ${c.position || c.name}`,
      sections: [
        { title: 'Podaci o kameri', cols: KV, rows: [['Kamera', c.position || c.name], ['IP / Mrežni slot', c.ip], ['Lokacija', c.location], ['Snimač', c.recorder], ['Tip', c.type], ['Otvori u platformi', camLink(c.id)]] },
        { title: `Dozvole: ${c.roles.length}`, cols: [{ header: 'Dozvola', width: 34 }, UZ, SN], rows: c.roles.map(r => [r.name, yn(r.live), yn(r.playback)]) },
        {
          title: `AD grupe: ${c.adGroups.length}`, cols: [{ header: 'AD grupa', width: 36 }, { header: 'Preko dozvole', width: 34 }],
          rows: c.roles.flatMap(r => (overview.roles.find(x => x.id === r.id)?.groups || []).map(g => [g.name, r.name] as Cell[]))
        },
        {
          title: `Korisnici: ${c.users.length}`, cols: [{ header: 'Korisnik', width: 30 }, { header: 'E-pošta', width: 38 }, UZ, SN, { header: 'Preko dozvola', width: 40 }, { header: 'Super admin', width: 14, center: true }],
          rows: c.users.map(u => [u.name, u.email, yn(u.live), yn(u.playback), (u.roles || []).join(', '), yn(!!u.superAdmin)])
        }
      ]
    }));
    const sum: Col[] = [
      ...CAM_COLS, { header: 'Kamernih dozvola', width: 14, center: true }, { header: 'AD grupa', width: 12, center: true },
      { header: 'Korisnika uživo', width: 16, center: true }, { header: 'Korisnika snimci', width: 16, center: true }
    ];
    const nameOf = new Map((tabs || []).map(t => [t.item.id, t.name]));
    addSheet(wb, logoId, 'Pregled', 'UNIPROMET DOO ČAČAK — PRISTUP PO KAMERAMA', `${stamp}   |   Broj kamera: ${rows.length}${tail}${note(rows.length)}`, sum,
      rows.map(c => {
        const info = camInfo(c.id);
        if (nameOf.has(c.id)) info[0] = { text: String(info[0]), link: link(nameOf.get(c.id)!) };
        return [...info, c.roles.filter(r => !r.superAdmin).length, c.adGroups.length, c.users.filter(u => u.live).length, c.users.filter(u => u.playback).length];
      }));
    if (tabs) tabs.forEach(t => t.make());
    else {
      const n = rows.length;
      const tbl = (name: string, title: string, cols: Col[], r: Cell[][]) => addSheet(wb, logoId, name, `UNIPROMET DOO ČAČAK — ${title}`, `${stamp}   |   Broj kamera: ${n}   |   Redova u tabeli: ${r.length}${tail}`, cols, r);
      tbl('Dozvole kamere', 'PRISTUP PO KAMERAMA: DOZVOLE', [...CAM_COLS, { header: 'Dozvola', width: 32 }, UZ, SN], rows.flatMap(c => c.roles.map(r => [...camInfo(c.id), r.name, yn(r.live), yn(r.playback)] as Cell[])));
      tbl('AD grupe kamera', 'PRISTUP PO KAMERAMA: AD GRUPE', [...CAM_COLS, { header: 'AD grupa', width: 36 }, { header: 'Preko dozvole', width: 32 }],
        rows.flatMap(c => c.roles.flatMap(r => (overview.roles.find(x => x.id === r.id)?.groups || []).map(g => [...camInfo(c.id), g.name, r.name] as Cell[]))));
      tbl('Korisnici kamera', 'PRISTUP PO KAMERAMA: KORISNICI', [...CAM_COLS, { header: 'Korisnik', width: 30 }, { header: 'E-pošta', width: 38 }, UZ, SN, { header: 'Preko dozvola', width: 40 }, { header: 'Super admin', width: 14, center: true }],
        rows.flatMap(c => c.users.map(u => [...camInfo(c.id), u.name, u.email, yn(u.live), yn(u.playback), (u.roles || []).join(', '), yn(!!u.superAdmin)] as Cell[])));
    }
  }
  return wb;
}
