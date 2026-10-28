import { getDb } from './sqlite';

export interface MtsNumberItem {
  id: number;
  telefon: string;
  kategorija: string;
  status: string;
  provajder: string;
  paket?: string | null;
  doslo?: string | null;
  dodatak_internet?: string | null;
  dodatak1?: string | null;
  dodatak2?: string | null;
  dodatak3?: string | null;
  created_at?: string;
  updated_at?: string;
  // Attached live Navision data
  employee_no?: string | null;
  employee_name?: string | null;
  employee_status?: string | null;
  employee_job?: string | null;
  employee_dept?: string | null;
  sl_type?: string | null;
  // Attached logs count & history
  logs_count?: number;
  logs?: MtsPhoneLog[];
}

export interface MtsNumberInput {
  id?: number;
  telefon: string;
  kategorija?: string | null;
  status?: string | null;
  provajder?: string | null;
  paket?: string | null;
  doslo?: string | null;
  dodatak_internet?: string | null;
  dodatak1?: string | null;
  dodatak2?: string | null;
  dodatak3?: string | null;
  employee_no?: string | null;
}

export interface MtsPhoneLog {
  id: number;
  telefon: string;
  datum: string;
  text: string;
  created_at?: string;
}

export interface MtsPackageItem {
  id: number;
  tip: 'Paket' | 'Dodatak' | string;
  sifra?: string | null;
  opis: string;
  jm?: string | null;
}

export interface MtsStats {
  total: number;
  active: number;
  inactive: number;
  mobile: number;
  gps: number;
  withInternetAddon: number;
  withRoamingAddon: number;
}

export const mtsDb = {
  /**
   * Retrieves paginated, filtered list of MTS numbers.
   */
  getMtsNumbers(options: {
    kategorija?: string | null;
    status?: string | null;
    paket?: string | null;
    dodatakInternet?: string | null;
    dodatakRoming?: string | null;
    search?: string | null;
    matchedPhoneNumbers?: string[] | null;
    limit?: number;
    offset?: number;
  }): { items: MtsNumberItem[]; total: number } {
    const db = getDb();
    const conditions: string[] = [];
    const params: any = {};

    if (options.kategorija && options.kategorija !== 'ALL') {
      conditions.push('m.kategorija = @kategorija');
      params.kategorija = options.kategorija.trim();
    }

    if (options.status && options.status !== 'ALL') {
      conditions.push('m.status = @status');
      params.status = options.status.trim();
    }

    if (options.paket && options.paket !== 'ALL') {
      conditions.push('m.paket = @paket');
      params.paket = options.paket.trim();
    }

    if (options.dodatakInternet && options.dodatakInternet !== 'ALL') {
      if (options.dodatakInternet === 'YES') {
        conditions.push("(m.dodatak_internet IS NOT NULL AND TRIM(m.dodatak_internet) != '' AND m.dodatak_internet != '-')");
      } else if (options.dodatakInternet === 'NO') {
        conditions.push("(m.dodatak_internet IS NULL OR TRIM(m.dodatak_internet) = '' OR m.dodatak_internet = '-')");
      } else {
        conditions.push('TRIM(m.dodatak_internet) = @dodatakInternet');
        params.dodatakInternet = options.dodatakInternet.trim();
      }
    }

    if (options.dodatakRoming && options.dodatakRoming !== 'ALL') {
      conditions.push(`(
        (m.dodatak1 IS NOT NULL AND TRIM(m.dodatak1) = @dodatakRoming) OR 
        (m.dodatak2 IS NOT NULL AND TRIM(m.dodatak2) = @dodatakRoming) OR 
        (m.dodatak3 IS NOT NULL AND TRIM(m.dodatak3) = @dodatakRoming)
      )`);
      params.dodatakRoming = options.dodatakRoming.trim();
    }

    if (options.search && options.search.trim()) {
      const trimmedSearch = options.search.trim();
      const tokens = trimmedSearch.toLowerCase().split(/\s+/).filter(Boolean);

      const tokenConditions: string[] = [];
      tokens.forEach((tok, i) => {
        const paramKey = `tok_${i}`;
        params[paramKey] = `%${tok}%`;
        tokenConditions.push(`(
          LOWER(
            '#' || CAST(m.id AS TEXT) || ' ' || 
            COALESCE(m.telefon, '') || ' ' || 
            COALESCE(m.kategorija, '') || ' ' || 
            COALESCE(m.status, '') || ' ' || 
            COALESCE(m.provajder, '') || ' ' || 
            COALESCE(m.paket, '') || ' ' || 
            COALESCE(m.doslo, '') || ' ' || 
            COALESCE(m.dodatak_internet, '') || ' ' || 
            COALESCE(m.dodatak1, '') || ' ' || 
            COALESCE(m.dodatak2, '') || ' ' || 
            COALESCE(m.dodatak3, '')
          ) LIKE @${paramKey}
        )`);
      });

      const allTokensMatch = tokenConditions.length > 0 ? tokenConditions.join(' AND ') : '1=1';

      if (options.matchedPhoneNumbers && options.matchedPhoneNumbers.length > 0) {
        const phoneListStr = options.matchedPhoneNumbers.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
        conditions.push(`((${allTokensMatch}) OR m.telefon IN (${phoneListStr}))`);
      } else {
        conditions.push(`(${allTokensMatch})`);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = db.prepare(`
      SELECT COUNT(DISTINCT m.id) as total
      FROM mts_numbers m
      ${where}
    `).get(params) as { total: number };

    const limit = options.limit || 50;
    const offset = options.offset || 0;
    params.limit = limit;
    params.offset = offset;

    const rows = db.prepare(`
      SELECT 
        m.id,
        m.telefon,
        m.kategorija,
        m.status,
        m.provajder,
        m.paket,
        m.doslo,
        m.dodatak_internet,
        m.dodatak1,
        m.dodatak2,
        m.dodatak3,
        m.employee_no,
        m.created_at,
        m.updated_at,
        (SELECT COUNT(*) FROM mts_phone_logs l WHERE l.telefon = m.telefon) AS logs_count
      FROM mts_numbers m
      ${where}
      ORDER BY m.id ASC
      LIMIT @limit OFFSET @offset;
    `).all(params) as any[];

    return {
      items: rows.map(r => ({
        ...r,
        dodatak_internet: r.dodatak_internet ? r.dodatak_internet.trim() : null,
        dodatak1: r.dodatak1 ? r.dodatak1.trim() : null,
        dodatak2: r.dodatak2 ? r.dodatak2.trim() : null,
        dodatak3: r.dodatak3 ? r.dodatak3.trim() : null,
        employee_no: r.employee_no ? r.employee_no.trim() : null
      })),
      total: countRow.total
    };
  },

  /**
   * Retrieves single MTS number by ID.
   */
  getMtsNumberById(id: number): MtsNumberItem | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT 
        m.id,
        m.telefon,
        m.kategorija,
        m.status,
        m.provajder,
        m.paket,
        m.doslo,
        m.dodatak_internet,
        m.dodatak1,
        m.dodatak2,
        m.dodatak3,
        m.employee_no,
        m.created_at,
        m.updated_at,
        (SELECT COUNT(*) FROM mts_phone_logs l WHERE l.telefon = m.telefon) AS logs_count
      FROM mts_numbers m
      WHERE m.id = ?
    `).get(id) as any;

    if (!row) return null;
    return {
      ...row,
      dodatak_internet: row.dodatak_internet ? row.dodatak_internet.trim() : null,
      dodatak1: row.dodatak1 ? row.dodatak1.trim() : null,
      dodatak2: row.dodatak2 ? row.dodatak2.trim() : null,
      dodatak3: row.dodatak3 ? row.dodatak3.trim() : null,
      employee_no: row.employee_no ? row.employee_no.trim() : null
    };
  },

  /**
   * Retrieves single MTS number by Phone string.
   */
  getMtsNumberByPhone(telefon: string): MtsNumberItem | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT 
        m.id,
        m.telefon,
        m.kategorija,
        m.status,
        m.provajder,
        m.paket,
        m.doslo,
        m.dodatak_internet,
        m.dodatak1,
        m.dodatak2,
        m.dodatak3,
        m.employee_no,
        m.created_at,
        m.updated_at,
        (SELECT COUNT(*) FROM mts_phone_logs l WHERE l.telefon = m.telefon) AS logs_count
      FROM mts_numbers m
      WHERE m.telefon = ?
    `).get(telefon.trim()) as any;

    if (!row) return null;
    return {
      ...row,
      dodatak_internet: row.dodatak_internet ? row.dodatak_internet.trim() : null,
      dodatak1: row.dodatak1 ? row.dodatak1.trim() : null,
      dodatak2: row.dodatak2 ? row.dodatak2.trim() : null,
      dodatak3: row.dodatak3 ? row.dodatak3.trim() : null,
      employee_no: row.employee_no ? row.employee_no.trim() : null
    };
  },

  /**
   * Inserts or replaces MTS number.
   */
  createMtsNumber(data: MtsNumberInput): MtsNumberItem {
    const db = getDb();
    const id = data.id || undefined;
    const cleanPhone = data.telefon.replace(/\D/g, '').trim();

    if (id) {
      db.prepare(`
        INSERT OR REPLACE INTO mts_numbers (
          id, telefon, kategorija, status, provajder, paket, doslo, 
          dodatak_internet, dodatak1, dodatak2, dodatak3, employee_no, updated_at
        ) VALUES (
          @id, @telefon, @kategorija, @status, @provajder, @paket, @doslo,
          @dodatak_internet, @dodatak1, @dodatak2, @dodatak3, @employee_no, datetime('now')
        )
      `).run({
        id,
        telefon: cleanPhone,
        kategorija: (data.kategorija || 'Mobilni').trim(),
        status: (data.status || 'Aktivan').trim(),
        provajder: (data.provajder || 'MTS').trim(),
        paket: data.paket ? data.paket.trim() : null,
        doslo: data.doslo ? data.doslo.trim() : String(new Date().getFullYear()),
        dodatak_internet: data.dodatak_internet ? data.dodatak_internet.trim() : null,
        dodatak1: data.dodatak1 ? data.dodatak1.trim() : null,
        dodatak2: data.dodatak2 ? data.dodatak2.trim() : null,
        dodatak3: data.dodatak3 ? data.dodatak3.trim() : null,
        employee_no: data.employee_no ? data.employee_no.trim() : null
      });
      return this.getMtsNumberById(id)!;
    } else {
      const res = db.prepare(`
        INSERT INTO mts_numbers (
          telefon, kategorija, status, provajder, paket, doslo, 
          dodatak_internet, dodatak1, dodatak2, dodatak3, employee_no, created_at, updated_at
        ) VALUES (
          @telefon, @kategorija, @status, @provajder, @paket, @doslo,
          @dodatak_internet, @dodatak1, @dodatak2, @dodatak3, @employee_no, datetime('now'), datetime('now')
        )
      `).run({
        telefon: cleanPhone,
        kategorija: (data.kategorija || 'Mobilni').trim(),
        status: (data.status || 'Aktivan').trim(),
        provajder: (data.provajder || 'MTS').trim(),
        paket: data.paket ? data.paket.trim() : null,
        doslo: data.doslo ? data.doslo.trim() : String(new Date().getFullYear()),
        dodatak_internet: data.dodatak_internet ? data.dodatak_internet.trim() : null,
        dodatak1: data.dodatak1 ? data.dodatak1.trim() : null,
        dodatak2: data.dodatak2 ? data.dodatak2.trim() : null,
        dodatak3: data.dodatak3 ? data.dodatak3.trim() : null,
        employee_no: data.employee_no ? data.employee_no.trim() : null
      });
      return this.getMtsNumberById(Number(res.lastInsertRowid))!;
    }
  },

  /**
   * Updates existing MTS number.
   */
  updateMtsNumber(id: number, data: Partial<MtsNumberInput>): MtsNumberItem | null {
    const db = getDb();
    const current = this.getMtsNumberById(id);
    if (!current) return null;

    const sets: string[] = ['updated_at = datetime(\'now\')'];
    const params: any = { id };

    if (data.telefon !== undefined) {
      sets.push('telefon = @telefon');
      params.telefon = data.telefon.replace(/\D/g, '').trim();
    }
    if (data.kategorija !== undefined) {
      sets.push('kategorija = @kategorija');
      params.kategorija = data.kategorija ? data.kategorija.trim() : 'Mobilni';
    }
    if (data.status !== undefined) {
      sets.push('status = @status');
      params.status = data.status ? data.status.trim() : 'Aktivan';
    }
    if (data.provajder !== undefined) {
      sets.push('provajder = @provajder');
      params.provajder = data.provajder ? data.provajder.trim() : 'MTS';
    }
    if (data.paket !== undefined) {
      sets.push('paket = @paket');
      params.paket = data.paket ? data.paket.trim() : null;
    }
    if (data.doslo !== undefined) {
      sets.push('doslo = @doslo');
      params.doslo = data.doslo ? data.doslo.trim() : null;
    }
    if (data.dodatak_internet !== undefined) {
      sets.push('dodatak_internet = @dodatak_internet');
      params.dodatak_internet = data.dodatak_internet ? data.dodatak_internet.trim() : null;
    }
    if (data.dodatak1 !== undefined) {
      sets.push('dodatak1 = @dodatak1');
      params.dodatak1 = data.dodatak1 ? data.dodatak1.trim() : null;
    }
    if (data.dodatak2 !== undefined) {
      sets.push('dodatak2 = @dodatak2');
      params.dodatak2 = data.dodatak2 ? data.dodatak2.trim() : null;
    }
    if (data.dodatak3 !== undefined) {
      sets.push('dodatak3 = @dodatak3');
      params.dodatak3 = data.dodatak3 ? data.dodatak3.trim() : null;
    }
    if (data.employee_no !== undefined) {
      sets.push('employee_no = @employee_no');
      params.employee_no = data.employee_no ? data.employee_no.trim() : null;
    }

    db.prepare(`UPDATE mts_numbers SET ${sets.join(', ')} WHERE id = @id`).run(params);
    return this.getMtsNumberById(id);
  },

  /**
   * Deletes MTS number by ID.
   */
  deleteMtsNumber(id: number): boolean {
    const db = getDb();
    const current = this.getMtsNumberById(id);
    if (!current) return false;

    // Also delete logs for this phone
    db.prepare('DELETE FROM mts_phone_logs WHERE telefon = ?').run(current.telefon);
    const res = db.prepare('DELETE FROM mts_numbers WHERE id = ?').run(id);
    return res.changes > 0;
  },

  /**
   * KPI Stats calculation.
   */
  getMtsStats(): MtsStats {
    const db = getDb();
    const row = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN LOWER(status) LIKE '%aktiv%' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN LOWER(status) NOT LIKE '%aktiv%' THEN 1 ELSE 0 END) AS inactive,
        SUM(CASE WHEN LOWER(kategorija) LIKE '%mobil%' THEN 1 ELSE 0 END) AS mobile,
        SUM(CASE WHEN LOWER(kategorija) LIKE '%gps%' THEN 1 ELSE 0 END) AS gps,
        SUM(CASE WHEN (dodatak_internet IS NOT NULL AND TRIM(dodatak_internet) != '' AND dodatak_internet != '-') THEN 1 ELSE 0 END) AS withInternetAddon,
        SUM(CASE WHEN (
          (dodatak1 IS NOT NULL AND TRIM(dodatak1) != '' AND dodatak1 != '-') OR
          (dodatak2 IS NOT NULL AND TRIM(dodatak2) != '' AND dodatak2 != '-') OR
          (dodatak3 IS NOT NULL AND TRIM(dodatak3) != '' AND dodatak3 != '-')
        ) THEN 1 ELSE 0 END) AS withRoamingAddon
      FROM mts_numbers
    `).get() as any;

    return {
      total: row?.total || 0,
      active: row?.active || 0,
      inactive: row?.inactive || 0,
      mobile: row?.mobile || 0,
      gps: row?.gps || 0,
      withInternetAddon: row?.withInternetAddon || 0,
      withRoamingAddon: row?.withRoamingAddon || 0
    };
  },

  /**
   * Logs / Notes for a phone number.
   */
  getPhoneLogs(telefon: string): MtsPhoneLog[] {
    const db = getDb();
    return db.prepare('SELECT * FROM mts_phone_logs WHERE telefon = ? ORDER BY id DESC').all(telefon.trim()) as MtsPhoneLog[];
  },

  createPhoneLog(data: { id?: number; telefon: string; text: string; datum?: string }): MtsPhoneLog {
    const db = getDb();
    const cleanPhone = data.telefon.replace(/\D/g, '').trim();
    const datum = data.datum || new Date().toISOString();

    if (data.id) {
      db.prepare('INSERT OR REPLACE INTO mts_phone_logs (id, telefon, datum, text, created_at) VALUES (@id, @telefon, @datum, @text, datetime(\'now\'))')
        .run({ id: data.id, telefon: cleanPhone, datum, text: data.text.trim() });
      return { id: data.id, telefon: cleanPhone, datum, text: data.text.trim() };
    } else {
      const res = db.prepare('INSERT INTO mts_phone_logs (telefon, datum, text, created_at) VALUES (@telefon, @datum, @text, datetime(\'now\'))')
        .run({ telefon: cleanPhone, datum, text: data.text.trim() });
      return { id: Number(res.lastInsertRowid), telefon: cleanPhone, datum, text: data.text.trim() };
    }
  },

  deletePhoneLog(id: number): boolean {
    const db = getDb();
    const res = db.prepare('DELETE FROM mts_phone_logs WHERE id = ?').run(id);
    return res.changes > 0;
  },

  /**
   * Packages & Addons from Paket_dodatak.
   */
  getAllPackages(): MtsPackageItem[] {
    const db = getDb();
    return db.prepare('SELECT * FROM mts_packages ORDER BY tip ASC, sifra ASC').all() as MtsPackageItem[];
  },

  syncPackages(packages: MtsPackageItem[]): void {
    const db = getDb();
    const deleteStmt = db.prepare('DELETE FROM mts_packages');
    const insertStmt = db.prepare('INSERT INTO mts_packages (id, tip, sifra, opis, jm) VALUES (@id, @tip, @sifra, @opis, @jm)');

    const tx = db.transaction((list: MtsPackageItem[]) => {
      deleteStmt.run();
      for (const p of list) {
        insertStmt.run({
          id: p.id,
          tip: p.tip ? p.tip.trim() : 'Paket',
          sifra: p.sifra ? p.sifra.trim() : '',
          opis: p.opis ? p.opis.trim() : '',
          jm: p.jm ? p.jm.trim() : null
        });
      }
    });

    tx(packages);
  }
};
