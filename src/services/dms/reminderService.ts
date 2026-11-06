import { getLatestParsedReport, ParsedReport } from './reportFiles';
import { sendDmsMail, cleanRecipients } from './dmsMail';
import { DEFAULT_ADMIN_RECIPIENTS } from '../mailService';

/**
 * Podsetnik za overu računa: iz liste "Podaci" najnovijeg izveštaja broji račune sa statusom
 * "Dodeljeno ..." po službi i osobi. Automatski zadatak (8., 9. i 10. u mesecu u 08h) podseća
 * administratora da učita nove podatke i pošalje podsetnik korisnicima.
 */

export const REMIND_DAYS = [8, 9, 10];
export const REMIND_HOUR = 8;

// Vrste dokumenata koje čekaju overu menadžera službe (računi finansija)
const VRSTE_ZA_OVERU = [
  'Ulazni račun (Finansije)',
  'Ulazni račun Papir (Finansije)',
  'Ulazno zaduženje (Finansije)',
  'Ulazno odobrenje (Finansije)'
];
const KRATKE_VRSTE = ['Ulazni', 'Papir', 'Zaduženje', 'Odobrenje'];
// Reči koje označavaju službu, a ne osobu (npr. "Sektor transporta", "Računovodstvo")
const SLUZBA_RECI = /sektor|služb|sluzb|računovodstv|finansij|pisarnica|sekretarsk|zaposleni|rukovodilac|kontrola|odeljenj/i;
// Službe koje se ne prikazuju u podsetniku (i njihovi zaposleni)
const ISKLJUCENE_SLUZBE = ['Računovodstvo'];
const NEPOZNATA_SLUZBA = 'Nepoznata služba';

type Counts = Record<string, number>;

interface Recipient { name: string; type: 'osoba' | 'služba'; counts: Counts; total: number }
interface SectorRow { label: string; isService: boolean; counts: Counts; total: number }
interface Sector { name: string; total: number; counts: Counts; rows: SectorRow[] }

export function getRecipients(): string[] {
  return [...DEFAULT_ADMIN_RECIPIENTS];
}

function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emptyCounts(): Counts {
  const counts: Counts = {};
  VRSTE_ZA_OVERU.forEach(v => { counts[v] = 0; });
  return counts;
}

/**
 * Da li je dodeljeni primalac osoba ili služba: osoba je ime i prezime (ili više imena odvojenih zarezom),
 * a služba je naziv koji sadrži reč tipa "Sektor", "Služba", "Računovodstvo"...
 */
function assigneeType(name: string): 'osoba' | 'služba' {
  if (name.includes(',')) return 'osoba';
  if (SLUZBA_RECI.test(name)) return 'služba';
  return name.trim().split(/\s+/).length >= 2 ? 'osoba' : 'služba';
}

/** Mapa osoba → služba iz lista "Korisnici" (kolone: Korisnici, Služba) u najnovijem izveštaju */
function loadUserSectors(parsed: ParsedReport | null): Record<string, string> {
  const map: Record<string, string> = {};
  if (!parsed || !parsed.sheets) return map;

  const sheetName = parsed.sheetNames.find(s => /korisnic|zaposlen/i.test(s.trim()));
  if (!sheetName) return map;

  const rows = parsed.sheets[sheetName];
  const header = rows[0] || [];
  const sektorIdx = header.indexOf('Služba');
  if (sektorIdx === -1) return map;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = String(row[0] || '').trim();
    const sektor = String(row[sektorIdx] || '').trim();
    if (name && sektor && name !== sektor) map[name] = sektor;
  }
  return map;
}

/**
 * Računi koji čekaju overu: status "Dodeljeno ..." i vrsta iz VRSTE_ZA_OVERU, u listi Podaci najnovijeg fajla.
 * Vraća listu primalaca (osoba ili služba) sa brojem po vrsti.
 */
function countPendingApproval() {
  const parsed = getLatestParsedReport();
  const empty = { recipients: [] as Recipient[], fileName: parsed ? parsed.filename : null, parsed };

  if (!parsed || !parsed.sheets || !parsed.sheets['Podaci']) return empty;

  const rows = parsed.sheets['Podaci'];
  const header = rows[0] || [];
  const statusIdx = header.indexOf('Status');
  const vrstaIdx = header.indexOf('Vrsta');
  if (statusIdx === -1 || vrstaIdx === -1) return empty;

  const groups: Record<string, Recipient> = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const status = String(row[statusIdx] || '');
    const vrsta = String(row[vrstaIdx] || '').trim();
    if (!status.startsWith('Dodeljeno') || !VRSTE_ZA_OVERU.includes(vrsta)) continue;

    const raw = status.replace(/^Dodeljeno\s*/, '').trim() || NEPOZNATA_SLUZBA;
    // Isti skup osoba u drugačijem redosledu je jedna grupa
    const name = raw.includes(',')
      ? raw.split(',').map(s => s.trim()).sort((a, b) => a.localeCompare(b, 'sr')).join(', ')
      : raw;
    if (!groups[name]) groups[name] = { name, type: assigneeType(name), counts: emptyCounts(), total: 0 };
    groups[name].counts[vrsta]++;
    groups[name].total++;
  }

  return { ...empty, recipients: Object.values(groups) };
}

/**
 * Naziv službe iz dodele ("Sektor transporta") svodi na naziv iz lista Korisnici ("Transport"),
 * poređenjem prvih pet slova bez prefiksa "Sektor"
 */
function resolveSectorName(name: string, knownSectors: Set<string>): string {
  const base = name.replace(/^sektor\s+/i, '').trim().toLowerCase();
  if (!base) return name;

  // Tačno poklapanje ima prednost; inače samo ako postoji tačno jedna služba sa istim početkom
  const exact = [...knownSectors].find(s => s.toLowerCase() === base);
  if (exact) return exact;

  const candidates = [...knownSectors].filter(s => s.slice(0, 5).toLowerCase() === base.slice(0, 5));
  return candidates.length === 1 ? candidates[0] : name;
}

/**
 * Grupiše primaoce po službi: osobe idu pod službu kojoj pripadaju (iz lista Korisnici),
 * a dokumenti dodeljeni direktno službi idu pod samu službu.
 * Službe iz ISKLJUCENE_SLUZBE se ne prikazuju.
 */
function groupBySector() {
  const { recipients, fileName, parsed } = countPendingApproval();
  const userSectors = loadUserSectors(parsed);
  const knownSectors = new Set(Object.values(userSectors));
  const sectors: Record<string, Sector> = {};

  const addTo = (sectorName: string, row: SectorRow) => {
    if (ISKLJUCENE_SLUZBE.includes(sectorName)) return;
    if (!sectors[sectorName]) sectors[sectorName] = { name: sectorName, total: 0, counts: emptyCounts(), rows: [] };
    const s = sectors[sectorName];
    s.rows.push(row);
    VRSTE_ZA_OVERU.forEach(v => { s.counts[v] += row.counts[v]; });
    s.total += row.total;
  };

  recipients.forEach(rec => {
    if (rec.type === 'služba') {
      addTo(resolveSectorName(rec.name, knownSectors), { label: rec.name, isService: true, counts: rec.counts, total: rec.total });
      return;
    }
    // Za više primalaca u jednom dokumentu uzimamo prvog koji se nalazi u listi Korisnici
    const firstKnown = rec.name.split(',').map(n => n.trim()).find(n => userSectors[n]);
    const sector = firstKnown ? userSectors[firstKnown] : NEPOZNATA_SLUZBA;
    addTo(sector, { label: rec.name, isService: false, counts: rec.counts, total: rec.total });
  });

  const list = Object.values(sectors).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'sr'));
  list.forEach(s => s.rows.sort((a, b) =>
    (Number(b.isService) - Number(a.isService)) || b.total - a.total || a.label.localeCompare(b.label, 'sr')));

  const totals = emptyCounts();
  list.forEach(s => VRSTE_ZA_OVERU.forEach(v => { totals[v] += s.counts[v]; }));
  const total = list.reduce((sum, s) => sum + s.total, 0);
  return { sectors: list, totals, total, fileName };
}

/** Sastavlja podsetnik: naslov, primaoci, tekst i HTML (službe, pa osobe unutar službe) */
export function buildReminder() {
  const { sectors, totals, total, fileName } = groupBySector();
  // Datum je datum izveštaja (najsvežije unetog dokumenta, iz imena fajla: 20261016 ...), ne danas
  const match = fileName && fileName.match(/^(\d{4})(\d{2})(\d{2})/);
  const today = match ? `${Number(match[3])}.${Number(match[2])}.${match[1]}.` : new Date().toLocaleDateString('sr-RS');
  const subject = `Podsetnik: računi za overu (${total})`;

  const textLines = sectors.flatMap(s => [
    `Služba: ${s.name} (${s.total})`,
    ...s.rows.map(r => `  - ${r.label} (${r.total}): ` +
      VRSTE_ZA_OVERU.map((v, i) => `${KRATKE_VRSTE[i]} ${r.counts[v]}`).join(', '))
  ]);

  const text = [
    'Poštovani,',
    '',
    'Molimo sve korisnike da u što kraćem roku pregledaju račune dodeljene njima ili njihovim službama u DMS-u i izvrše potrebno postupanje – odobre, odbiju ili preduzmu narednu aktivnost.',
    '',
    'Pravovremeno rešavanje računa neophodno je za nesmetan rad računovodstva i blagovremen obračun PDV-a. Molimo vas da ovu aktivnost shvatite kao prioritet i ne ostavljate račune na čekanju.',
    '',
    `Potrebno je overiti sledeće dokumente (ukupno ${total}, na dan ${today}):`,
    '',
    ...textLines,
    '',
    'Ukupno po vrstama:',
    ...VRSTE_ZA_OVERU.map(v => `- ${v}: ${totals[v]}`),
    '',
    'Hvala na saradnji.',
    '',
    `Podaci su iz izveštaja: ${fileName || 'nije pronađen'}`
  ].join('\n');

  const th = 'padding:6px 8px;border:1px solid #cbd5e1;background:#f1f5f9;text-align:right;font-size:12px;';
  const td = 'padding:6px 8px;border:1px solid #cbd5e1;text-align:right;';
  const headerCells = VRSTE_ZA_OVERU.map(v => `<th style="${th}">${escapeHtml(v)}</th>`).join('');
  const bodyRows = sectors.map(s => {
    const sectorRow = `
        <tr style="background:#f8fafc;">
            <td style="padding:6px 8px;border:1px solid #cbd5e1;text-align:left;font-weight:bold;width:240px;max-width:240px;word-wrap:break-word;">${escapeHtml(s.name)}</td>
            ${VRSTE_ZA_OVERU.map(v => `<td style="${td}font-weight:bold;">${s.counts[v]}</td>`).join('')}
            <td style="${td}font-weight:bold;">${s.total}</td>
        </tr>`;
    const personRows = s.rows.map(r => `
        <tr>
            <td style="padding:6px 8px 6px 22px;border:1px solid #cbd5e1;text-align:left;width:240px;max-width:240px;word-wrap:break-word;">${escapeHtml(r.label)}</td>
            ${VRSTE_ZA_OVERU.map(v => `<td style="${td}">${r.counts[v]}</td>`).join('')}
            <td style="${td}">${r.total}</td>
        </tr>`).join('');
    return sectorRow + personRows;
  }).join('');
  const footCells = VRSTE_ZA_OVERU.map(v => `<td style="${td}font-weight:bold;">${totals[v]}</td>`).join('');

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;">
    <p>Poštovani,</p>
    <p>Molimo sve korisnike da u što kraćem roku pregledaju račune dodeljene njima ili njihovim službama u DMS-u i izvrše potrebno postupanje – odobre, odbiju ili preduzmu narednu aktivnost.</p>
    <p>Pravovremeno rešavanje računa neophodno je za nesmetan rad računovodstva i blagovremen obračun PDV-a. Molimo vas da ovu aktivnost shvatite kao prioritet i ne ostavljate račune na čekanju.</p>
    <p>Potrebno je overiti sledeće dokumente (ukupno <b>${total}</b>, na dan <b>${escapeHtml(today)}</b>):</p>
    <table style="border-collapse:collapse;font-size:13px;">
        <thead>
            <tr>
                <th style="padding:6px 8px;border:1px solid #cbd5e1;background:#f1f5f9;text-align:left;font-size:12px;width:240px;max-width:240px;">Služba / osoba</th>
                ${headerCells}
                <th style="${th}font-weight:bold;">Ukupno</th>
            </tr>
        </thead>
        <tbody>${bodyRows}
        </tbody>
        <tfoot>
            <tr>
                <td style="padding:6px 8px;border:1px solid #cbd5e1;font-weight:bold;">Ukupno</td>
                ${footCells}
                <td style="${td}font-weight:bold;">${total}</td>
            </tr>
        </tfoot>
    </table>
    <p>Hvala na saradnji.</p>
    <p style="color:#64748b;font-size:12px;">Podaci su iz izveštaja: ${escapeHtml(fileName || 'nije pronađen')}</p>
</div>`;

  // Imena osoba koje imaju dokumente za overu (njihove adrese se u aplikaciji automatski štikliraju)
  const peopleNames = [...new Set(sectors.flatMap(s =>
    s.rows.filter(r => !r.isService).flatMap(r => r.label.split(',').map(n => n.trim()))
  ))].filter(Boolean);

  // Službe iz tabele (njihovi ključni korisnici se u aplikaciji automatski štikliraju)
  const sectorNames = sectors.map(s => s.name);

  return { subject, recipients: getRecipients(), peopleNames, sectorNames, text, html, total, totals, sectors, fileName, today };
}

/** Šalje podsetnik izabranim primaocima; ako lista nije prosleđena, koriste se administratori */
export async function sendReminder(recipientsOverride: unknown = null) {
  const reminder = buildReminder();
  const recipients = recipientsOverride ? cleanRecipients(recipientsOverride) : reminder.recipients;
  await sendDmsMail(reminder.subject, reminder.html, recipients);
  console.log(`[DMS Podsetnik] Poslat na: ${recipients.join(', ')} (ukupno ${reminder.total})`);
  return { success: true, recipients, subject: reminder.subject, total: reminder.total };
}

/** Kratki zadatak za administratora (ne sadrži listu): učitaj nove podatke i pošalji podsetnik korisnicima */
export async function sendTaskReminder(recipients: string[] = getRecipients()) {
  const subject = 'Podsetnik: učitaj nove podatke i pošalji podsetnik za overu';
  const text = [
    'Poštovani,',
    '',
    'Učitaj nove podatke (najnoviji izveštaj) u sekciju DMS Analiza podataka i pošalji podsetnik za overu računa korisnicima.',
    '',
    'Ovo je automatski podsetnik iz UNIPROMET Admin platforme.'
  ].join('\n');
  await sendDmsMail(subject, text, recipients);
  console.log(`[DMS Podsetnik] Zadatak poslat na: ${recipients.join(', ')}`);
  return { success: true, recipients, subject };
}

/** Da li je danas dan za podsetnik (8., 9. ili 10. u mesecu) */
export function isReminderDay(now: Date = new Date()): boolean {
  return REMIND_DAYS.includes(now.getDate());
}
