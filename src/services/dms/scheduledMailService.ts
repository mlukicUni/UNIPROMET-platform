import crypto from 'crypto';
import {
  DmsSchedule, DmsScheduledMail,
  listScheduledMails, getScheduledMail, saveScheduledMail, deleteScheduledMail
} from '../../db/dmsDb';
import { sendDmsMail, cleanRecipients } from './dmsMail';

/**
 * Zakazani mailovi koje korisnik sam podešava (vreme, naslov, sadržaj, primaoci).
 * Provera termina ide svakog minuta; propušteni termin (server ugašen) šalje se jednom po pokretanju.
 */

const TYPES = ['once', 'daily', 'weekly', 'monthly'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CHECK_EVERY_MS = 60 * 1000;

const busy = new Set<string>();
let timer: NodeJS.Timeout | null = null;

const daysInMonth = (year: number, monthIndex: number) => new Date(year, monthIndex + 1, 0).getDate();
const monthlyDays = (s: DmsSchedule): number[] => s.days || [s.day as number];

/** Sledeći termin strogo posle `from` (lokalno vreme servera), ili null ako više nema termina */
export function nextRunAfter(schedule: DmsSchedule, from: Date): Date | null {
  const [hh, mm] = schedule.time.split(':').map(Number);

  if (schedule.type === 'once') {
    const [y, mo, d] = (schedule.date as string).split('-').map(Number);
    const at = new Date(y, mo - 1, d, hh, mm, 0, 0);
    return at > from ? at : null;
  }

  // Kandidati su po danu; za mesečni termin dan se svodi na poslednji dan meseca kada mesec nema toliko dana
  for (let offset = 0; offset < 400; offset++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    if (schedule.type === 'weekly' && day.getDay() !== schedule.weekday) continue;
    if (schedule.type === 'monthly') {
      const last = daysInMonth(day.getFullYear(), day.getMonth());
      const wanted = monthlyDays(schedule).map(d => Math.min(d, last));
      if (!wanted.includes(day.getDate())) continue;
    }
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0);
    if (at > from) return at;
  }
  return null;
}

function validateSchedule(s: any): DmsSchedule {
  if (!s || !TYPES.includes(s.type)) throw new Error('Učestalost nije ispravna');
  if (!TIME_RE.test(s.time || '')) throw new Error('Vreme nije ispravno (HH:MM)');

  if (s.type === 'once') {
    if (!DATE_RE.test(s.date || '') || isNaN(new Date(`${s.date}T00:00:00`).getTime())) {
      throw new Error('Datum nije ispravan');
    }
    const at = nextRunAfter({ type: 'once', date: s.date, time: s.time }, new Date(0));
    if (!at || at <= new Date()) throw new Error('Izabrano vreme je u prošlosti');
    return { type: 'once', date: s.date, time: s.time };
  }
  if (s.type === 'weekly') {
    const weekday = Number(s.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('Dan u nedelji nije ispravan');
    return { type: 'weekly', weekday, time: s.time };
  }
  if (s.type === 'monthly') {
    const raw: unknown[] = Array.isArray(s.days) ? s.days : [s.day];
    const days = [...new Set(raw.map(Number))].sort((a, b) => a - b);
    if (days.length === 0 || days.some(d => !Number.isInteger(d) || d < 1 || d > 31)) {
      throw new Error('Dani u mesecu nisu ispravni (1–31)');
    }
    return { type: 'monthly', days, time: s.time };
  }
  return { type: 'daily', time: s.time };
}

function requireText(value: unknown, label: string, max: number): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} je obavezan`);
  if (text.length > max) throw new Error(`${label} može imati najviše ${max} znakova`);
  return text;
}

function withNextRun(item: DmsScheduledMail, from = new Date()) {
  const next = item.enabled ? nextRunAfter(item.schedule, from) : null;
  return { ...item, nextRunAt: next ? next.toISOString() : null };
}

/** Lista svih zakazanih mailova sa sledećim terminom */
export function list() {
  return listScheduledMails().map(item => withNextRun(item));
}

/** Dodaje novi ili menja postojeći (po id-u). Ostavlja datum poslednjeg slanja. */
export function save(input: any) {
  const existing = input.id ? getScheduledMail(String(input.id)) : null;
  if (input.id && !existing) throw new Error('Zakazani mail nije pronađen');

  // Naslov je i naziv u listi (jedno polje)
  const subject = requireText(input.subject || input.name, 'Naslov', 200);
  const item: DmsScheduledMail = {
    id: existing ? existing.id : crypto.randomUUID(),
    name: subject,
    subject,
    body: requireText(input.body, 'Sadržaj', 20000),
    recipients: cleanRecipients(input.recipients),
    schedule: validateSchedule(input.schedule),
    enabled: input.enabled !== false,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    lastSentAt: existing ? existing.lastSentAt : null
  };
  saveScheduledMail(item);
  return withNextRun(item);
}

export function remove(id: string) {
  if (!deleteScheduledMail(id)) throw new Error('Zakazani mail nije pronađen');
  return { success: true };
}

async function sendItem(item: DmsScheduledMail) {
  await sendDmsMail(item.subject, item.body, item.recipients);
  console.log(`[DMS Zakazani mail] "${item.name}" poslat na: ${item.recipients.join(', ')}`);
}

/**
 * Ručno slanje odmah. Ne menja zakazani termin ni datum poslednjeg automatskog slanja,
 * pa ručno slanje ne preskače sledeći automatski termin.
 */
export async function sendNow(id: string) {
  const item = getScheduledMail(id);
  if (!item) throw new Error('Zakazani mail nije pronađen');
  await sendItem(item);
  return { success: true, recipients: item.recipients };
}

/** Šalje sve zakazane mailove čiji je termin prošao */
export async function runDue(): Promise<void> {
  const now = new Date();
  for (const item of listScheduledMails()) {
    if (!item.enabled || busy.has(item.id)) continue;
    // Termin je "pao" ako je posle poslednjeg slanja (ili kreiranja), a već je prošao
    const from = new Date(item.lastSentAt || item.createdAt);
    const due = nextRunAfter(item.schedule, from);
    if (!due || due > now) continue;

    busy.add(item.id);
    try {
      await sendItem(item);
      item.lastSentAt = now.toISOString();
      if (item.schedule.type === 'once') item.enabled = false;
      saveScheduledMail(item);
    } catch (err: any) {
      console.error(`[DMS Zakazani mail] Greška za "${item.name}":`, err.message);
    } finally {
      busy.delete(item.id);
    }
  }
}

export function startScheduler(): void {
  if (timer) clearInterval(timer);
  runDue().catch(err => console.error('[DMS Zakazani mail] Greška:', err));
  timer = setInterval(() => {
    runDue().catch(err => console.error('[DMS Zakazani mail] Greška:', err));
  }, CHECK_EVERY_MS);
  console.log('[DMS Zakazani mail] Provera zakazanih mailova uključena (svakog minuta)');
}
