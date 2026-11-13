import { getDb } from './sqlite';

/**
 * Initializes all required database tables and indexes if they do not exist.
 */
export function initSchema(): void {
  const db = getDb();

  db.exec(`
    -- Recorders inventory table
    CREATE TABLE IF NOT EXISTS recorders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      ip TEXT NOT NULL,
      model TEXT,
      type TEXT DEFAULT 'NVR',
      subnet TEXT,
      cameras_count INTEGER DEFAULT 0,
      channels INTEGER DEFAULT 32,
      status TEXT DEFAULT 'online',
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    -- Cameras inventory table
    CREATE TABLE IF NOT EXISTS cameras (
      id TEXT PRIMARY KEY,
      ip TEXT NOT NULL,
      name TEXT NOT NULL,
      recorder TEXT,
      position TEXT,
      type TEXT DEFAULT 'IP Kamera',
      subnet TEXT,
      note TEXT,
      is_reserved INTEGER DEFAULT 0,
      cred_profile INTEGER DEFAULT 1,
      auth_status TEXT DEFAULT 'untested',
      last_auth_check TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    -- Printers inventory and monitoring table
    CREATE TABLE IF NOT EXISTS printers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT,
      ip TEXT NOT NULL UNIQUE,
      location TEXT,
      category TEXT,
      share_name TEXT,
      driver_name TEXT,
      custom_tag TEXT DEFAULT 'U funkciji',
      notes TEXT,
      is_decommissioned INTEGER DEFAULT 0,
      decommission_reason TEXT,
      is_online INTEGER DEFAULT 0,
      latency_ms INTEGER,
      last_seen TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Consumption audit reports table
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      month_year TEXT,
      created_at TEXT NOT NULL,
      device_count INTEGER DEFAULT 0,
      online_count INTEGER DEFAULT 0,
      total_impressions INTEGER DEFAULT 0,
      excel_file_name TEXT,
      entries_json TEXT
    );

    -- Automated background scheduled services table
    CREATE TABLE IF NOT EXISTS scheduled_services (
      id TEXT PRIMARY KEY,
      service_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      target_type TEXT NOT NULL,
      cron_times TEXT NOT NULL,
      weekdays_only INTEGER DEFAULT 1,
      is_enabled INTEGER DEFAULT 1,
      recipients TEXT NOT NULL,
      last_run_at TEXT,
      last_run_status TEXT,
      last_run_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- RF Readers (Time & Attendance RFID readers) table
    CREATE TABLE IF NOT EXISTS rf_readers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      direction TEXT NOT NULL,
      ip TEXT NOT NULL UNIQUE,
      port INTEGER DEFAULT 4370,
      model TEXT DEFAULT 'ZKTeco / Secutime RFID',
      status TEXT DEFAULT 'online',
      latency_ms INTEGER,
      last_seen TEXT,
      last_ping_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    -- WiFi Access Points (Aruba Instant On / Swarm) table
    CREATE TABLE IF NOT EXISTS wifi_access_points (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ip TEXT NOT NULL UNIQUE,
      model TEXT,
      type TEXT,
      is_outdoor INTEGER DEFAULT 0,
      serial TEXT,
      zone TEXT,
      mode TEXT DEFAULT 'access',
      clients_count INTEGER DEFAULT 0,
      radio0_channel TEXT,
      radio0_power TEXT,
      radio0_util TEXT,
      radio0_noise TEXT,
      radio1_channel TEXT,
      radio1_power TEXT,
      radio1_util TEXT,
      radio1_noise TEXT,
      uplink_port TEXT DEFAULT 'eth0',
      hierarchy TEXT DEFAULT 'member',
      status TEXT DEFAULT 'online',
      last_seen TEXT,
      updated_at TEXT
    );

    -- Indexes for high-speed lookups and filtering
    CREATE INDEX IF NOT EXISTS idx_cameras_ip ON cameras(ip);
    CREATE INDEX IF NOT EXISTS idx_cameras_recorder ON cameras(recorder);
    CREATE INDEX IF NOT EXISTS idx_cameras_subnet ON cameras(subnet);
    CREATE INDEX IF NOT EXISTS idx_recorders_ip ON recorders(ip);
    CREATE INDEX IF NOT EXISTS idx_printers_ip ON printers(ip);
    CREATE INDEX IF NOT EXISTS idx_printers_location ON printers(location);
    CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sched_key ON scheduled_services(service_key);
    CREATE INDEX IF NOT EXISTS idx_sched_enabled ON scheduled_services(is_enabled);
    CREATE INDEX IF NOT EXISTS idx_rf_readers_ip ON rf_readers(ip);
    CREATE INDEX IF NOT EXISTS idx_rf_readers_location ON rf_readers(location);
    CREATE INDEX IF NOT EXISTS idx_wifi_aps_ip ON wifi_access_points(ip);
    CREATE INDEX IF NOT EXISTS idx_wifi_aps_model ON wifi_access_points(model);
    CREATE INDEX IF NOT EXISTS idx_wifi_aps_hierarchy ON wifi_access_points(hierarchy);
  `);

  // Ensure new camera auth and playback columns exist on existing databases
  try {
    const columns = db.prepare("PRAGMA table_info(cameras)").all() as { name: string }[];
    const colNames = new Set(columns.map(c => c.name));
    if (!colNames.has('cred_profile')) {
      db.exec("ALTER TABLE cameras ADD COLUMN cred_profile INTEGER DEFAULT 1;");
    }
    if (!colNames.has('auth_status')) {
      db.exec("ALTER TABLE cameras ADD COLUMN auth_status TEXT DEFAULT 'untested';");
    }
    if (!colNames.has('last_auth_check')) {
      db.exec("ALTER TABLE cameras ADD COLUMN last_auth_check TEXT;");
    }
    if (!colNames.has('recorder_id')) {
      db.exec("ALTER TABLE cameras ADD COLUMN recorder_id TEXT;");
    }
    if (!colNames.has('nvr_channel')) {
      db.exec("ALTER TABLE cameras ADD COLUMN nvr_channel INTEGER;");
    }
    if (!colNames.has('nvr_track_id')) {
      db.exec("ALTER TABLE cameras ADD COLUMN nvr_track_id TEXT;");
    }
    // Lokacija kamere je odvojena od snimača (kamera može biti na jednoj lokaciji, a vezana za snimač druge).
    // Pri dodavanju kolone lokacija se jednom popunjava nazivom snimača; posle se menja nezavisno.
    if (!colNames.has('location')) {
      db.exec("ALTER TABLE cameras ADD COLUMN location TEXT;");
      db.exec("UPDATE cameras SET location = recorder WHERE location IS NULL;");
    }
  } catch (err) {
    console.warn('[DB Migration Warning] cameras schema update:', err);
  }

  // Ensure recorders have cred_profile, ports, and check status columns
  try {
    const recCols = db.prepare("PRAGMA table_info(recorders)").all() as { name: string }[];
    const recColNames = new Set(recCols.map(c => c.name));
    if (!recColNames.has('http_port')) {
      db.exec("ALTER TABLE recorders ADD COLUMN http_port INTEGER DEFAULT 80;");
    }
    if (!recColNames.has('rtsp_port')) {
      db.exec("ALTER TABLE recorders ADD COLUMN rtsp_port INTEGER DEFAULT 554;");
    }
    if (!recColNames.has('sdk_port')) {
      db.exec("ALTER TABLE recorders ADD COLUMN sdk_port INTEGER DEFAULT 8000;");
    }
    if (!recColNames.has('cred_profile')) {
      db.exec("ALTER TABLE recorders ADD COLUMN cred_profile INTEGER DEFAULT 1;");
    }
    if (!recColNames.has('last_checked_at')) {
      db.exec("ALTER TABLE recorders ADD COLUMN last_checked_at TEXT;");
    }
    if (!recColNames.has('webui_status')) {
      db.exec("ALTER TABLE recorders ADD COLUMN webui_status TEXT DEFAULT 'untested';");
    }
    if (!recColNames.has('ping_status')) {
      db.exec("ALTER TABLE recorders ADD COLUMN ping_status TEXT DEFAULT 'untested';");
    }
    if (!recColNames.has('latency_ms')) {
      db.exec("ALTER TABLE recorders ADD COLUMN latency_ms INTEGER;");
    }
  } catch (err) {
    console.warn('[DB Migration Warning] recorders schema update:', err);
  }

  // Ensure rf_readers last_ping_at column exists on existing databases
  try {
    const rfCols = db.prepare("PRAGMA table_info(rf_readers)").all() as { name: string }[];
    const rfColNames = new Set(rfCols.map(c => c.name));
    if (!rfColNames.has('last_ping_at')) {
      db.exec("ALTER TABLE rf_readers ADD COLUMN last_ping_at TEXT;");
    }
  } catch (err) {
    console.warn('[DB Migration Warning] rf_readers schema update:', err);
  }

  // =========================================================================
  // EQUIPMENT INVENTORY SCHEMA (EVIDENCIJA OPREME - MIGRACIJA SA 192.168.121.20)
  // =========================================================================
  db.exec(`
    -- Equipment categories (from tip_opreme)
    CREATE TABLE IF NOT EXISTS equipment_categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      is_network INTEGER DEFAULT 0,
      icon TEXT DEFAULT 'package'
    );

    -- Equipment statuses (from status)
    CREATE TABLE IF NOT EXISTS equipment_statuses (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT 'gray'
    );

    -- Equipment locations (from lokacija)
    CREATE TABLE IF NOT EXISTS equipment_locations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );

    -- Equipment buildings / facilities (from objekat)
    CREATE TABLE IF NOT EXISTS equipment_buildings (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      location_id INTEGER,
      code TEXT,
      description TEXT,
      FOREIGN KEY (location_id) REFERENCES equipment_locations(id)
    );

    -- Equipment rooms / offices (from kancelarija)
    CREATE TABLE IF NOT EXISTS equipment_rooms (
      id INTEGER PRIMARY KEY,
      code TEXT,
      building INTEGER,
      floor TEXT,
      short_desc TEXT,
      name TEXT,
      FOREIGN KEY (building) REFERENCES equipment_buildings(id)
    );

    -- Equipment main table (from pc1)
    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY,
      category_id INTEGER,
      status_id INTEGER,
      name TEXT NOT NULL,
      date_arrived TEXT,
      date_purchased TEXT,
      comment TEXT,
      group_name TEXT,
      description TEXT,
      location_id INTEGER,
      custom_code INTEGER,
      building_id INTEGER,
      room_id INTEGER,
      rack_dims TEXT,
      route_desc TEXT,
      lines_count INTEGER,
      employee_no TEXT,
      inventory_no TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES equipment_categories(id),
      FOREIGN KEY (status_id) REFERENCES equipment_statuses(id)
    );

    CREATE INDEX IF NOT EXISTS idx_equipment_cat ON equipment(category_id);
    CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status_id);
    CREATE INDEX IF NOT EXISTS idx_equipment_employee ON equipment(employee_no);
    CREATE INDEX IF NOT EXISTS idx_equipment_name ON equipment(name);

    -- Equipment hardware configuration details (from pc_detalji - only for computers/laptops)
    CREATE TABLE IF NOT EXISTS equipment_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL UNIQUE,
      os TEXT,
      ip_address TEXT,
      mac_address TEXT,
      ram TEXT,
      processor TEXT,
      disk_type TEXT,
      disk_capacity TEXT,
      cd TEXT,
      modem TEXT,
      monitor TEXT,
      speakers TEXT,
      radio TEXT,
      gpu TEXT,
      tv_card TEXT,
      gateway TEXT,
      motherboard TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_equipment_details_eq_id ON equipment_details(equipment_id);

    -- Equipment history / service notes (from evidencije)
    CREATE TABLE IF NOT EXISTS equipment_history (
      id INTEGER PRIMARY KEY,
      equipment_id INTEGER NOT NULL,
      date TEXT,
      note TEXT,
      phone TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_equipment_history_eq_id ON equipment_history(equipment_id);

    -- Equipment software & licenses (from software)
    CREATE TABLE IF NOT EXISTS equipment_software (
      id INTEGER PRIMARY KEY,
      equipment_id INTEGER NOT NULL,
      vendor TEXT,
      name TEXT,
      is_licensed INTEGER DEFAULT 1,
      license_key TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_equipment_software_eq_id ON equipment_software(equipment_id);

    -- MTS Brojevi (Mobile & GPS SIM phone numbers from legacy Telefoni)
    CREATE TABLE IF NOT EXISTS mts_numbers (
      id INTEGER PRIMARY KEY,
      telefon TEXT NOT NULL UNIQUE,
      kategorija TEXT DEFAULT 'Mobilni',
      status TEXT DEFAULT 'Aktivan',
      provajder TEXT DEFAULT 'MTS',
      paket TEXT,
      doslo TEXT,
      dodatak_internet TEXT,
      dodatak1 TEXT,
      dodatak2 TEXT,
      dodatak3 TEXT,
      employee_no TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mts_numbers_telefon ON mts_numbers(telefon);
    CREATE INDEX IF NOT EXISTS idx_mts_numbers_kategorija ON mts_numbers(kategorija);
    CREATE INDEX IF NOT EXISTS idx_mts_numbers_status ON mts_numbers(status);

    -- MTS Phone Logs / Notes (from legacy evidencije_telefona)
    CREATE TABLE IF NOT EXISTS mts_phone_logs (
      id INTEGER PRIMARY KEY,
      telefon TEXT NOT NULL,
      datum TEXT DEFAULT (datetime('now')),
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mts_phone_logs_telefon ON mts_phone_logs(telefon);

    -- MTS Packages & Add-ons (from legacy Paket_dodatak)
    CREATE TABLE IF NOT EXISTS mts_packages (
      id INTEGER PRIMARY KEY,
      tip TEXT NOT NULL,
      sifra TEXT NOT NULL,
      opis TEXT NOT NULL,
      jm TEXT
    );

    -- Network / Telecommunication Lines (from legacy linija)
    CREATE TABLE IF NOT EXISTS equipment_lines (
      id INTEGER PRIMARY KEY,
      wall_socket_no INTEGER,
      patch_panel_code TEXT,
      room_id INTEGER,
      cvor_id INTEGER,
      route_description TEXT,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_equipment_lines_cvor ON equipment_lines(cvor_id);
    CREATE INDEX IF NOT EXISTS idx_equipment_lines_room ON equipment_lines(room_id);
    CREATE INDEX IF NOT EXISTS idx_equipment_lines_wall ON equipment_lines(wall_socket_no);
    CREATE INDEX IF NOT EXISTS idx_equipment_lines_panel ON equipment_lines(patch_panel_code);
  `);

  // Ensure mts_numbers has employee_no column on existing database
  try {
    const mtsCols = db.prepare("PRAGMA table_info(mts_numbers)").all() as { name: string }[];
    const mtsColNames = new Set(mtsCols.map(c => c.name));
    if (!mtsColNames.has('employee_no')) {
      db.exec("ALTER TABLE mts_numbers ADD COLUMN employee_no TEXT;");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_mts_numbers_employee ON mts_numbers(employee_no);");
  } catch (err) {
    console.warn('[DB Migration Warning] mts_numbers employee_no schema update:', err);
  }

  // Ensure equipment_lines table exists on existing db
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS equipment_lines (
        id INTEGER PRIMARY KEY,
        wall_socket_no INTEGER,
        patch_panel_code TEXT,
        room_id INTEGER,
        cvor_id INTEGER,
        route_description TEXT,
        description TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_equipment_lines_cvor ON equipment_lines(cvor_id);
      CREATE INDEX IF NOT EXISTS idx_equipment_lines_room ON equipment_lines(room_id);
      CREATE INDEX IF NOT EXISTS idx_equipment_lines_wall ON equipment_lines(wall_socket_no);
      CREATE INDEX IF NOT EXISTS idx_equipment_lines_panel ON equipment_lines(patch_panel_code);
    `);
  } catch (err) {
    console.warn('[DB Migration Warning] equipment_lines schema update:', err);
  }

  // Seed default equipment buildings if table is empty
  try {
    const countRow = db.prepare('SELECT COUNT(*) as count FROM equipment_buildings').get() as { count: number };
    if (countRow && countRow.count === 0) {
      const initialBuildings = [
        { id: 1, name: 'Nova upravna zgrada', code: 'UZ-NOVA', description: 'Glavna upravna zgrada, prizemlje i sprat' },
        { id: 2, name: 'Pogon 1', code: 'P1', description: 'Glavni proizvodni pogon 1' },
        { id: 3, name: 'Pogon 2', code: 'P2', description: 'Proizvodni pogon 2' },
        { id: 4, name: 'Pogon 3', code: 'P3', description: 'Proizvodni pogon 3' },
        { id: 5, name: 'Cinkara', code: 'CINK', description: 'Pogon za toplo cinkovanje' },
        { id: 6, name: 'Upravna zgrada - Aneks', code: 'UZ-ANEKS', description: 'Aneks upravne zgrade i spratni deo' },
        { id: 7, name: 'Hala Coca-Cola', code: 'CC-HALA', description: 'Objekat bivše Coca-Cola hale' },
        { id: 8, name: 'Stara upravna zgrada', code: 'UZ-STARA', description: 'Stara upravna zgrada' },
        { id: 9, name: 'Motoremont', code: 'MR', description: 'Kompleks Motoremont' },
        { id: 10, name: 'Kuća', code: 'KUCA', description: 'Stambeno-poslovni objekat' },
        { id: 11, name: 'Konarevo', code: 'KON', description: 'Lokacija Konarevo (Komercijala / Finansije)' },
        { id: 12, name: 'Pogon 1 KV', code: 'P1-KV', description: 'Kraljevo - Pogon 1' },
        { id: 13, name: 'Proizvodnja KV', code: 'P-KV', description: 'Kraljevo - Proizvodna hala' },
        { id: 14, name: 'Vaga KV', code: 'VAGA-KV', description: 'Kraljevo - Kolska vaga i kapija' },
        { id: 15, name: 'Portirnica / Kućica', code: 'PORT', description: 'Portirnica na glavnoj kapiji' },
        { id: 17, name: 'Magacin / Blagajna', code: 'MAG-BLAG', description: 'Objekat magacina i blagajne' },
        { id: 19, name: 'Plava hala', code: 'PLAVA-HALA', description: 'Objekat Plava hala i inženjering' },
        { id: 20, name: 'Održavanje', code: 'ODRZ', description: 'Radionica i objekat tehničkog održavanja' },
        { id: 21, name: 'Laser centar', code: 'LASER', description: 'Hala za lasersko sečenje i obradu' },
        { id: 22, name: 'Farbara', code: 'FARB', description: 'Objekat farbare i površinske zaštite' },
        { id: 23, name: 'BBC centar', code: 'BBC', description: 'BBC poslovni prostor' }
      ];

      const insertStmt = db.prepare('INSERT OR IGNORE INTO equipment_buildings (id, name, code, description) VALUES (@id, @name, @code, @description)');
      const seedTransaction = db.transaction(() => {
        for (const b of initialBuildings) {
          insertStmt.run(b);
        }
      });
      seedTransaction();
    }
  } catch (err) {
    console.warn('[Schema] Inicijalizacija objekata upozorenje:', err);
  }
}
