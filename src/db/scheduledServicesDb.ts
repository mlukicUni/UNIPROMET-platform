import { getDb } from './sqlite';

export interface ScheduledServiceRecord {
  id: string;
  service_key: string;
  name: string;
  description: string;
  target_type: 'printers' | 'cameras' | 'rf_readers' | 'wifi_aps' | 'recorders' | 'custom';
  cron_times: string[];
  weekdays_only: boolean;
  is_enabled: boolean;
  recipients: string[];
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_message: string | null;
  created_at: string;
  updated_at: string;
}

interface RawServiceRow {
  id: string;
  service_key: string;
  name: string;
  description: string | null;
  target_type: string;
  cron_times: string;
  weekdays_only: number;
  is_enabled: number;
  recipients: string;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_message: string | null;
  created_at: string;
  updated_at: string;
}

function parseRow(row: RawServiceRow): ScheduledServiceRecord {
  let cron_times: string[] = [];
  try {
    cron_times = JSON.parse(row.cron_times);
    if (!Array.isArray(cron_times)) cron_times = [];
  } catch {
    cron_times = [];
  }

  let recipients: string[] = [];
  try {
    recipients = JSON.parse(row.recipients);
    if (!Array.isArray(recipients)) recipients = [];
  } catch {
    recipients = [];
  }

  return {
    id: row.id,
    service_key: row.service_key,
    name: row.name,
    description: row.description || '',
    target_type: row.target_type as 'printers' | 'cameras' | 'rf_readers' | 'wifi_aps' | 'recorders' | 'custom',
    cron_times,
    weekdays_only: row.weekdays_only === 1,
    is_enabled: row.is_enabled === 1,
    recipients,
    last_run_at: row.last_run_at,
    last_run_status: row.last_run_status,
    last_run_message: row.last_run_message,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/**
 * Ensures initial default scheduled services exist in the database
 */
export function seedDefaultScheduledServices(): void {
  const db = getDb();
  const countRow = db.prepare('SELECT COUNT(*) as count FROM scheduled_services').get() as { count: number };

  if (countRow.count === 0) {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO scheduled_services (
        id, service_key, name, description, target_type, cron_times,
        weekdays_only, is_enabled, recipients, last_run_at, last_run_status,
        last_run_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 1. Toner alerts service
    insert.run(
      'sched-toners',
      'toner_alerts',
      'Izveštaj o kritičnim tonerima (Štampači)',
      'Automatsko očitavanje nivoa tonera i slanje email upozorenja administratorima za tonere ≤ 5% i stanje otpadnih kontejnera velikih fotokopira',
      'printers',
      JSON.stringify(['07:00']),
      1,
      1,
      JSON.stringify(['marko.lukic@unipromet.co.rs', 'andrija.borovnjak@unipromet.co.rs']),
      null,
      'Spremno',
      'Čeka zakazano vreme aktivacije',
      now,
      now
    );

    // 2. Camera offline alerts service
    insert.run(
      'sched-cameras',
      'camera_offline_alerts',
      'Nadzor i alarm nedostupnih kamera (Video Nadzor)',
      'Poređenje baze evidencije i mreže sa automatskim slanjem email upozorenja ako postoje nedostupne kamere',
      'cameras',
      JSON.stringify(['07:00', '09:00', '11:00', '13:00', '15:00']),
      1,
      1,
      JSON.stringify(['marko.lukic@unipromet.co.rs', 'andrija.borovnjak@unipromet.co.rs']),
      now,
      'Uspešno',
      'Poslednja provera u 09:38 - 3 offline kamere evidentirane',
      now,
      now
    );

    console.log('[SQLite] Inicijalizovane podrazumevane automatske usluge u tabeli scheduled_services.');
  }

  // 3. RF Readers monitoring service (14:00 weekdays)
  const rfService = db.prepare("SELECT id FROM scheduled_services WHERE id = 'sched-rf-readers' OR service_key = 'rf_reader_alerts'").get();
  if (!rfService) {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO scheduled_services (
        id, service_key, name, description, target_type, cron_times,
        weekdays_only, is_enabled, recipients, last_run_at, last_run_status,
        last_run_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      'sched-rf-readers',
      'rf_reader_alerts',
      'Nadzor i alarm RF čitača (Evidencija radnika)',
      'Automatsko ispitivanje mrežne dostupnosti svih 9 RFID terminala za evidenciju radnog vremena i slanje email upozorenja administratorima u slučaju prekida veze',
      'rf_readers',
      JSON.stringify(['14:00']),
      1,
      1,
      JSON.stringify(['marko.lukic@unipromet.co.rs', 'andrija.borovnjak@unipromet.co.rs']),
      null,
      'Spremno',
      'Čeka zakazano vreme aktivacije u 14:00 (Radni dani: Pon - Pet)',
      now,
      now
    );

    console.log('[SQLite] Inicijalizovan podrazumevani servis za RF čitače (14:00) u tabeli scheduled_services.');
  }

  // 4. WiFi APs monitoring service (07:00 weekdays)
  const wifiService = db.prepare("SELECT id FROM scheduled_services WHERE id = 'sched-wifi-aps' OR service_key = 'wifi_ap_alerts'").get();
  if (!wifiService) {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO scheduled_services (
        id, service_key, name, description, target_type, cron_times,
        weekdays_only, is_enabled, recipients, last_run_at, last_run_status,
        last_run_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      'sched-wifi-aps',
      'wifi_ap_alerts',
      'Nadzor i alarm WiFi Pristupnih Tačaka (Aruba AP)',
      'Automatsko ispitivanje mrežne dostupnosti svih 34 Aruba WiFi AP uređaja i slanje email upozorenja administratorima u slučaju prekida veze',
      'wifi_aps',
      JSON.stringify(['07:00']),
      1,
      1,
      JSON.stringify(['marko.lukic@unipromet.co.rs', 'andrija.borovnjak@unipromet.co.rs']),
      null,
      'Spremno',
      'Čeka zakazano vreme aktivacije u 07:00 (Radni dani: Pon - Pet)',
      now,
      now
    );

    console.log('[SQLite] Inicijalizovan podrazumevani servis za WiFi AP uređaje (07:00) u tabeli scheduled_services.');
  }

  // 5. Recorders monitoring service (07:00, 09:00, 11:00, 13:00, 15:00 weekdays - same as cameras)
  const recService = db.prepare("SELECT id FROM scheduled_services WHERE id = 'sched-recorders' OR service_key = 'recorder_offline_alerts'").get();
  if (!recService) {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO scheduled_services (
        id, service_key, name, description, target_type, cron_times,
        weekdays_only, is_enabled, recipients, last_run_at, last_run_status,
        last_run_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      'sched-recorders',
      'recorder_offline_alerts',
      'Nadzor i alarm NVR snimača (Video Nadzor)',
      'Automatska provera mrežne dostupnosti (ping i web interfejs) svih video snimača i slanje email upozorenja ako je jedan ili više snimača offline',
      'recorders',
      JSON.stringify(['07:00', '09:00', '11:00', '13:00', '15:00']),
      1,
      1,
      JSON.stringify(['marko.lukic@unipromet.co.rs', 'andrija.borovnjak@unipromet.co.rs']),
      null,
      'Spremno',
      'Čeka zakazano vreme aktivacije (Radni dani: Pon - Pet u 07:00, 09:00, 11:00, 13:00, 15:00)',
      now,
      now
    );

    console.log('[SQLite] Inicijalizovan podrazumevani servis za NVR snimače u tabeli scheduled_services.');
  }

  // 6. Urgent Toners & Waste monitoring service (08:00 - 15:00 weekdays hourly)
  const urgentTonerService = db.prepare("SELECT id FROM scheduled_services WHERE id = 'sched-urgent-toners' OR service_key = 'urgent_toner_alerts'").get();
  if (!urgentTonerService) {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO scheduled_services (
        id, service_key, name, description, target_type, cron_times,
        weekdays_only, is_enabled, recipients, last_run_at, last_run_status,
        last_run_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      'sched-urgent-toners',
      'urgent_toner_alerts',
      'Hitna upozorenja: Puni waste kontejneri i color toneri na 0% (Štampači)',
      'Automatska provera stanja štampača na svakih sat vremena od 08:00h do 15:00h (samo radnim danima). Šalje email obaveštenje isključivo ukoliko je neki waste (otpadni) toner pun ili je neki od color tonera potpuno potrošen (0%).',
      'printers',
      JSON.stringify(['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00']),
      1,
      1,
      JSON.stringify(['marko.lukic@unipromet.co.rs', 'andrija.borovnjak@unipromet.co.rs']),
      null,
      'Spremno',
      'Čeka zakazano vreme aktivacije (Radni dani: Pon - Pet od 08:00 do 15:00 na svakih sat vremena)',
      now,
      now
    );

    console.log('[SQLite] Inicijalizovan podrazumevani servis za hitna toner upozorenja (08:00-15:00) u tabeli scheduled_services.');
  }

  // 7. Azure client secret expiry warning (07:00 every day - day before expiry may fall on a weekend)
  const azureSecretService = db.prepare("SELECT id FROM scheduled_services WHERE id = 'sched-azure-secret' OR service_key = 'azure_secret_expiry'").get();
  if (!azureSecretService) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO scheduled_services (
        id, service_key, name, description, target_type, cron_times,
        weekdays_only, is_enabled, recipients, last_run_at, last_run_status,
        last_run_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sched-azure-secret',
      'azure_secret_expiry',
      'Upozorenje: istek Azure ključa za Microsoft 365 prijavu',
      'Svakog dana u 07:00 proverava datum isteka ključa AZURE_CLIENT_SECRET (AZURE_CLIENT_SECRET_EXPIRES u .env). Dan pre isteka šalje email upozorenje administratorima da ključ zamene novim; ako je ključ istekao, upozorenje se šalje svakog jutra dok se ne zameni.',
      'custom',
      JSON.stringify(['07:00']),
      0,
      1,
      JSON.stringify(['marko.lukic@unipromet.co.rs', 'andrija.borovnjak@unipromet.co.rs']),
      null,
      'Spremno',
      'Čeka zakazano vreme aktivacije u 07:00 (svakog dana)',
      now,
      now
    );

    console.log('[SQLite] Inicijalizovan servis za upozorenje o isteku Azure ključa (07:00) u tabeli scheduled_services.');
  }
}

/**
 * Returns all scheduled services from SQLite
 */
export function getAllScheduledServices(): ScheduledServiceRecord[] {
  seedDefaultScheduledServices();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM scheduled_services ORDER BY created_at ASC').all() as RawServiceRow[];
  return rows.map(parseRow);
}

/**
 * Returns a single scheduled service by ID
 */
export function getScheduledServiceById(id: string): ScheduledServiceRecord | null {
  seedDefaultScheduledServices();
  const db = getDb();
  const row = db.prepare('SELECT * FROM scheduled_services WHERE id = ?').get(id) as RawServiceRow | undefined;
  return row ? parseRow(row) : null;
}

/**
 * Returns a single scheduled service by key
 */
export function getScheduledServiceByKey(service_key: string): ScheduledServiceRecord | null {
  seedDefaultScheduledServices();
  const db = getDb();
  const row = db.prepare('SELECT * FROM scheduled_services WHERE service_key = ?').get(service_key) as RawServiceRow | undefined;
  return row ? parseRow(row) : null;
}

/**
 * Creates a new scheduled service in SQLite
 */
export function createScheduledService(data: {
  name: string;
  description?: string;
  service_key?: string;
  target_type: 'printers' | 'cameras' | 'rf_readers' | 'wifi_aps' | 'custom';
  cron_times?: string[];
  weekdays_only?: boolean;
  is_enabled?: boolean;
  recipients?: string[];
}): ScheduledServiceRecord {
  const db = getDb();
  const now = new Date().toISOString();
  const id = `sched-${Date.now()}`;
  const service_key = data.service_key || `custom_${Date.now()}`;
  const cron_times = data.cron_times || ['08:00'];
  const recipients = data.recipients && data.recipients.length > 0 
    ? data.recipients 
    : ['marko.lukic@unipromet.co.rs', 'andrija.borovnjak@unipromet.co.rs'];

  db.prepare(`
    INSERT INTO scheduled_services (
      id, service_key, name, description, target_type, cron_times,
      weekdays_only, is_enabled, recipients, last_run_at, last_run_status,
      last_run_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    service_key,
    data.name.trim(),
    data.description ? data.description.trim() : '',
    data.target_type,
    JSON.stringify(cron_times),
    data.weekdays_only !== false ? 1 : 0,
    data.is_enabled !== false ? 1 : 0,
    JSON.stringify(recipients),
    null,
    'Novo kreirano',
    'Čeka prvo izvršenje',
    now,
    now
  );

  return getScheduledServiceById(id)!;
}

/**
 * Updates an existing scheduled service
 */
export function updateScheduledService(id: string, data: {
  name?: string;
  description?: string;
  target_type?: 'printers' | 'cameras' | 'rf_readers' | 'wifi_aps' | 'custom';
  cron_times?: string[];
  weekdays_only?: boolean;
  is_enabled?: boolean;
  recipients?: string[];
}): ScheduledServiceRecord | null {
  const existing = getScheduledServiceById(id);
  if (!existing) return null;

  const db = getDb();
  const now = new Date().toISOString();

  const name = data.name !== undefined ? data.name.trim() : existing.name;
  const description = data.description !== undefined ? data.description.trim() : existing.description;
  const target_type = data.target_type !== undefined ? data.target_type : existing.target_type;
  const cron_times = data.cron_times !== undefined ? data.cron_times : existing.cron_times;
  const weekdays_only = data.weekdays_only !== undefined ? (data.weekdays_only ? 1 : 0) : (existing.weekdays_only ? 1 : 0);
  const is_enabled = data.is_enabled !== undefined ? (data.is_enabled ? 1 : 0) : (existing.is_enabled ? 1 : 0);
  const recipients = data.recipients !== undefined ? data.recipients : existing.recipients;

  db.prepare(`
    UPDATE scheduled_services
    SET name = ?, description = ?, target_type = ?, cron_times = ?,
        weekdays_only = ?, is_enabled = ?, recipients = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    description,
    target_type,
    JSON.stringify(cron_times),
    weekdays_only,
    is_enabled,
    JSON.stringify(recipients),
    now,
    id
  );

  return getScheduledServiceById(id);
}

/**
 * Updates only the activation times for a scheduled service
 */
export function updateServiceTimes(id: string, cron_times: string[]): ScheduledServiceRecord | null {
  const existing = getScheduledServiceById(id);
  if (!existing) return null;

  // Clean, validate and sort times
  const cleanTimes = Array.from(new Set(
    cron_times
      .map(t => t.trim())
      .filter(t => /^\d{1,2}:\d{2}$/.test(t))
      .map(t => {
        const parts = t.split(':');
        return `${parts[0].padStart(2, '0')}:${parts[1]}`;
      })
  )).sort();

  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE scheduled_services
    SET cron_times = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(cleanTimes), now, id);

  return getScheduledServiceById(id);
}

/**
 * Updates only the email recipients for a scheduled service
 */
export function updateServiceRecipients(id: string, recipients: string[]): ScheduledServiceRecord | null {
  const existing = getScheduledServiceById(id);
  if (!existing) return null;

  // Clean, validate and deduplicate recipients
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const cleanRecipients = Array.from(new Set(
    recipients
      .map(r => r.trim().toLowerCase())
      .filter(r => emailRegex.test(r))
  ));

  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE scheduled_services
    SET recipients = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(cleanRecipients), now, id);

  return getScheduledServiceById(id);
}

/**
 * Toggles enable/disable state of a service
 */
export function toggleServiceEnabled(id: string, is_enabled: boolean): ScheduledServiceRecord | null {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE scheduled_services
    SET is_enabled = ?, updated_at = ?
    WHERE id = ?
  `).run(is_enabled ? 1 : 0, now, id);

  return getScheduledServiceById(id);
}

/**
 * Updates last run execution status
 */
export function updateServiceLastRun(id: string, status: string, message: string): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE scheduled_services
    SET last_run_at = ?, last_run_status = ?, last_run_message = ?, updated_at = ?
    WHERE id = ?
  `).run(now, status, message, now, id);
}

/**
 * Deletes a scheduled service from SQLite
 */
export function deleteScheduledService(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM scheduled_services WHERE id = ?').run(id);
  return result.changes > 0;
}
