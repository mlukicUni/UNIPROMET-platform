/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - LEGACY SYNC BRIDGE
 * ==========================================================================
 *
 * [LEGACY_BRIDGE_START]
 * This module isolates ALL communication, dual-write operations, and fast
 * checksum synchronization with the legacy Dell R730 server (192.168.121.20,
 * database "Racunari").
 *
 * WHEN THE LEGACY SERVER IS RETIRED / DECOMMISSIONED:
 * 1. Simply delete this file (src/services/legacySyncBridge.ts).
 * 2. Remove any blocks marked with [LEGACY_BRIDGE_START] ... [LEGACY_BRIDGE_END].
 * 3. Remove DB_121_20_* from .env.
 * Zero dead code or lingering flags remain in the codebase.
 * ==========================================================================
 */

import sql from 'mssql';
import { equipmentDb, EquipmentInput, EquipmentDetails } from '../db/equipmentDb.js';
import { mtsDb, MtsNumberInput } from '../db/mtsDb.js';
import { linesDb, LineInput } from '../db/linesDb.js';
import { isEnabled } from '../utils/appConfig.js';

interface LegacyConfig {
  user: string;
  password: string;
  server: string;
  database: string;
  options: {
    encrypt: boolean;
    trustServerCertificate: boolean;
    connectTimeout: number;
    requestTimeout: number;
  };
}

class LegacySyncBridge {
  private pool: sql.ConnectionPool | null = null;
  private isConnecting = false;
  private isSyncing = false;
  private lastChecksum = '';
  private lastSyncTime: string | null = null;
  private isAvailable = true;
  private listeners: ((event: { type: string; timestamp: string }) => void)[] = [];

  private getConfig(): LegacyConfig | null {
    // LEGACY_SYNC_ENABLED=false (dev mašina): bez ikakve veze sa 121.20, ni čitanja ni dual-write
    if (!isEnabled('LEGACY_SYNC_ENABLED')) return null;

    const server = process.env.DB_121_20_HOST || '192.168.121.20';
    const user = process.env.DB_121_20_USER || 'itservices';
    const password = process.env.DB_121_20_PASS || ''; // lozinka samo iz .env
    const database = process.env.DB_121_20_NAME || 'Racunari';

    if (!server || !user || !password) return null;

    return {
      server,
      user,
      password,
      database,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        connectTimeout: 4000,
        requestTimeout: 8000
      }
    };
  }

  /**
   * Returns active connection pool or connects if needed.
   */
  private async getPool(): Promise<sql.ConnectionPool | null> {
    if (this.pool && this.pool.connected) return this.pool;
    if (this.isConnecting) return null;

    const config = this.getConfig();
    if (!config) return null;

    this.isConnecting = true;
    try {
      this.pool = new sql.ConnectionPool(config);
      await this.pool.connect();
      this.isAvailable = true;
      return this.pool;
    } catch (err: any) {
      console.warn('[LegacySyncBridge] Neuspešno povezivanje sa 121.20 bazom:', err.message);
      this.isAvailable = false;
      return null;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Registers a callback for SSE notifications when legacy changes are detected.
   */
  public onSyncEvent(listener: (event: { type: string; timestamp: string }) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(type: string) {
    const ev = { type, timestamp: new Date().toISOString() };
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch (err) {
        // Ignore listener errors
      }
    }
  }

  /**
   * Ultra-fast checksum query (takes ~15-20ms).
   * Computes an aggregate hash of pc1, pc_detalji, software, evidencije, status, tip_opreme, lokacija, objekat, and kancelarija from 192.168.121.20.
   */
  public async getFastChecksum(): Promise<{ hash: string; durationMs: number; count: number } | null> {
    const pool = await this.getPool();
    if (!pool) return null;

    const t0 = Date.now();
    try {
      const q = `
        SELECT 
          (SELECT COUNT(*) FROM pc1 WITH (NOLOCK)) as pc_cnt,
          (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(id, ISNULL(ime, ''), ISNULL(katid, 0), ISNULL(statid, 0), ISNULL(zap, ''))) FROM pc1 WITH (NOLOCK)) as pc_hash,
          (SELECT MAX(id) FROM pc1 WITH (NOLOCK)) as pc_max,
          (SELECT COUNT(*) FROM software WITH (NOLOCK)) as sw_cnt,
          (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(id_lic, ISNULL(id2opreme, 0), ISNULL(naziv_soft, ''))) FROM software WITH (NOLOCK)) as sw_hash,
          (SELECT COUNT(*) FROM evidencije WITH (NOLOCK)) as ev_cnt,
          (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(id2, ISNULL(idopreme, 0), ISNULL(text, ''))) FROM evidencije WITH (NOLOCK)) as ev_hash,
          (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(status_id, ISNULL(status, ''))) FROM status WITH (NOLOCK)) as stat_hash,
          (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(tip_id, ISNULL(tip_naziv, ''), ISNULL(tip, ''))) FROM tip_opreme WITH (NOLOCK)) as tip_hash,
          (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(lok, ISNULL(opis, ''))) FROM lokacija WITH (NOLOCK)) as lok_hash,
          (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(id, ISNULL(objekat, ''), ISNULL(lokacija, 0), ISNULL(opis, ''))) FROM objekat WITH (NOLOCK)) as obj_hash,
          (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(idkanc, ISNULL(kanc_oznaka, 0), ISNULL(objekat, 0), ISNULL(sprat, 0), ISNULL(opis_skracen, ''), ISNULL(opis, ''))) FROM kancelarija WITH (NOLOCK)) as kanc_hash,
          (SELECT COUNT(*) FROM Telefoni WITH (NOLOCK)) as tel_cnt,
          (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(Id, ISNULL(telefon, ''), ISNULL(kategorija, ''), ISNULL(status, ''), ISNULL(paket, ''), ISNULL(dodatak_internet, ''), ISNULL(dodatak1, ''))) FROM Telefoni WITH (NOLOCK)) as tel_hash,
          (SELECT COUNT(*) FROM evidencije_telefona WITH (NOLOCK)) as ev_tel_cnt,
          (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(id2, ISNULL(telefon, ''), ISNULL(text, ''))) FROM evidencije_telefona WITH (NOLOCK)) as ev_tel_hash,
          (SELECT COUNT(*) FROM Paket_dodatak WITH (NOLOCK)) as pkg_cnt,
          (SELECT COUNT(*) FROM linija WITH (NOLOCK)) as lin_cnt,
          (SELECT CHECKSUM_AGG(BINARY_CHECKSUM(id, ISNULL(oznaka_zid, 0), ISNULL(kancelarija, 0), ISNULL(cvor, 0), ISNULL(oznaka_panel, ''))) FROM linija WITH (NOLOCK)) as lin_hash;
      `;
      const res = await pool.request().query(q);
      const row = res.recordset[0];
      const durationMs = Date.now() - t0;
      const hash = `${row.pc_cnt}_${row.pc_hash}_${row.pc_max}__${row.sw_cnt}_${row.sw_hash}__${row.ev_cnt}_${row.ev_hash}__${row.stat_hash}_${row.tip_hash}_${row.lok_hash}_${row.obj_hash}_${row.kanc_hash}__${row.tel_cnt}_${row.tel_hash}__${row.ev_tel_cnt}_${row.ev_tel_hash}_${row.pkg_cnt}__${row.lin_cnt}_${row.lin_hash}`;
      return { hash, durationMs, count: (row.pc_cnt || 0) + (row.tel_cnt || 0) + (row.lin_cnt || 0) };
    } catch (err: any) {
      console.warn('[LegacySyncBridge] Greška pri računanju otiska (checksum):', err.message);
      return null;
    }
  }

  /**
   * Checks if legacy database has changed and pulls new/modified records into SQLite.
   */
  public async checkAndSync(force = false): Promise<{ changed: boolean; durationMs: number }> {
    if (this.isSyncing) return { changed: false, durationMs: 0 };
    this.isSyncing = true;
    const t0 = Date.now();

    try {
      const checksumResult = await this.getFastChecksum();
      if (!checksumResult) {
        return { changed: false, durationMs: Date.now() - t0 };
      }

      if (!force && this.lastChecksum && this.lastChecksum === checksumResult.hash) {
        // No changes on legacy server
        return { changed: false, durationMs: Date.now() - t0 };
      }

      const isFirst = !this.lastChecksum;
      this.lastChecksum = checksumResult.hash;
      this.lastSyncTime = new Date().toISOString();

      if (!isFirst || force) {
        console.log(`[LegacySyncBridge] ⚡ Otkrivena promena na 121.20 (Checksum: ${checksumResult.hash}), sinhronizacija...`);
        await this.pullFromLegacy();
        this.notifyListeners('legacy_sync');
      }

      return { changed: true, durationMs: Date.now() - t0 };
    } catch (err: any) {
      console.warn('[LegacySyncBridge] Greška pri proveri i sinhronizaciji:', err.message);
      return { changed: false, durationMs: Date.now() - t0 };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Pulls all records from pc1, pc_detalji, software, evidencije and all 5 dictionaries on 121.20 into local SQLite.
   */
  public async pullFromLegacy(): Promise<void> {
    const pool = await this.getPool();
    if (!pool) return;

    try {
      const { getDb } = await import('../db/sqlite.js');
      const db = getDb();

      // 0. Pull Dictionaries (Statuses, Categories, Locations, Buildings, Rooms)
      try {
        // A. Statuses
        const statRes = await pool.request().query(`SELECT status_id, status FROM status WITH (NOLOCK) ORDER BY status_id ASC;`);
        if (statRes.recordset && statRes.recordset.length > 0) {
          const insertStat = db.prepare(`
            INSERT OR REPLACE INTO equipment_statuses (id, name, color)
            VALUES (@id, @name, COALESCE((SELECT color FROM equipment_statuses WHERE id = @id), @color))
          `);
          const statTx = db.transaction((rows: any[]) => {
            for (const s of rows) {
              const name = (s.status || '').trim();
              let color = 'gray';
              const upper = name.toUpperCase();
              if (upper.includes('ISPRAVNO') && !upper.includes('NEISPRAVNO')) color = 'green';
              else if (upper.includes('NEISPRAVNO') || upper.includes('KVAR')) color = 'red';
              else if (upper.includes('RC') || upper.includes('REZERVA')) color = 'blue';
              else if (upper.includes('SERVIS') || upper.includes('POPRAV')) color = 'yellow';

              insertStat.run({ id: s.status_id, name: name || `Status #${s.status_id}`, color });
            }
          });
          statTx(statRes.recordset);
        }

        // B. Categories (tip_opreme)
        const catRes = await pool.request().query(`SELECT tip_id, tip_naziv, tip FROM tip_opreme WITH (NOLOCK) ORDER BY tip_id ASC;`);
        if (catRes.recordset && catRes.recordset.length > 0) {
          const insertCat = db.prepare(`
            INSERT OR REPLACE INTO equipment_categories (id, name, is_network, icon)
            VALUES (@id, @name, @is_network, COALESCE((SELECT icon FROM equipment_categories WHERE id = @id), @icon))
          `);
          const catTx = db.transaction((rows: any[]) => {
            for (const c of rows) {
              const name = (c.tip_naziv || '').trim();
              const tip = (c.tip || '').trim().toUpperCase();
              const isNetwork = (tip === 'M' || name.toUpperCase().includes('SWITCH') || name.toUpperCase().includes('ROUTER') || name.toUpperCase().includes('ACCESS POINT') || name.toUpperCase().includes('AP')) ? 1 : 0;
              
              let icon = 'package';
              const u = name.toUpperCase();
              if (u.includes('RACUNAR') || u.includes('RAČUNAR') || u.includes('PC')) icon = 'monitor';
              else if (u.includes('LAPTOP') || u.includes('NOTEBOOK')) icon = 'laptop';
              else if (u.includes('STAMP') || u.includes('ŠTAMP')) icon = 'printer';
              else if (u.includes('SWITCH') || u.includes('SVIC')) icon = 'network';
              else if (u.includes('ROUTER') || u.includes('RUTER')) icon = 'router';
              else if (u.includes('AP') || u.includes('WIFI') || u.includes('ACCESS POINT')) icon = 'wifi';
              else if (u.includes('SERVER')) icon = 'server';
              else if (u.includes('KAMER')) icon = 'video';
              else if (u.includes('SKENER')) icon = 'scan';
              else if (u.includes('TELEFON')) icon = 'phone';
              else if (u.includes('UPS')) icon = 'zap';
              else if (u.includes('TABLET')) icon = 'tablet';

              insertCat.run({ id: c.tip_id, name: name || `Kategorija #${c.tip_id}`, is_network: isNetwork, icon });
            }
          });
          catTx(catRes.recordset);
        }

        // C. Locations (lokacija)
        const locRes = await pool.request().query(`SELECT lok, opis, adresa, telefon FROM lokacija WITH (NOLOCK) ORDER BY lok ASC;`);
        if (locRes.recordset && locRes.recordset.length > 0) {
          const insertLoc = db.prepare(`
            INSERT OR REPLACE INTO equipment_locations (id, name)
            VALUES (@id, @name)
          `);
          const locTx = db.transaction((rows: any[]) => {
            for (const l of rows) {
              const name = (l.opis || '').trim();
              insertLoc.run({ id: l.lok, name: name || `Lokacija #${l.lok}` });
            }
          });
          locTx(locRes.recordset);
        }

        // D. Buildings (objekat)
        const objRes = await pool.request().query(`SELECT id, objekat, lokacija, opis FROM objekat WITH (NOLOCK) ORDER BY id ASC;`);
        if (objRes.recordset && objRes.recordset.length > 0) {
          const insertBld = db.prepare(`
            INSERT OR REPLACE INTO equipment_buildings (id, name, location_id, code, description)
            VALUES (@id, @name, @location_id, @code, @description)
          `);
          const objTx = db.transaction((rows: any[]) => {
            for (const b of rows) {
              const name = (b.objekat || '').trim();
              insertBld.run({
                id: b.id,
                name: name || `Objekat #${b.id}`,
                location_id: b.lokacija || null,
                code: String(b.id),
                description: b.opis ? String(b.opis).trim() : null
              });
            }
          });
          objTx(objRes.recordset);
        }

        // E. Rooms (kancelarija)
        const roomRes = await pool.request().query(`SELECT idkanc, kanc_oznaka, objekat, sprat, opis_skracen, opis FROM kancelarija WITH (NOLOCK) ORDER BY idkanc ASC;`);
        if (roomRes.recordset && roomRes.recordset.length > 0) {
          const insertRoom = db.prepare(`
            INSERT OR REPLACE INTO equipment_rooms (id, code, building, floor, short_desc, name)
            VALUES (@id, @code, @building, @floor, @short_desc, @name)
          `);
          const roomTx = db.transaction((rows: any[]) => {
            for (const r of rows) {
              insertRoom.run({
                id: r.idkanc,
                code: r.kanc_oznaka ? String(r.kanc_oznaka).trim() : null,
                building: r.objekat || null,
                floor: r.sprat != null ? String(r.sprat).trim() : null,
                short_desc: r.opis_skracen ? String(r.opis_skracen).trim() : null,
                name: r.opis ? String(r.opis).trim() : null
              });
            }
          });
          roomTx(roomRes.recordset);
        }
      } catch (dictErr: any) {
        console.warn('[LegacySyncBridge] Upozorenje pri sinhronizaciji šifarnika sa 121.20:', dictErr.message);
      }

      // 1. Pull equipment & hardware details
      const res = await pool.request().query(`
        SELECT 
          p.id, p.ime, p.katid, p.statid, p.lokacija, p.objekat, p.kancelarija,
          p.zap, p.si_os, p.koment, p.opis, p.doslo, p.kupljeno, p.r_oznaka,
          p.dimenzije_ormana, p.trasa_opis, p.broj_linija_izvedenih,
          d.operativni, d.adresa, d.mrezna, d.ram, d.procesor, d.hdd_vrsta, d.hdd_kapac,
          d.ploca, d.monitor, d.graficka, d.gateway
        FROM pc1 p WITH (NOLOCK)
        LEFT JOIN pc_detalji d WITH (NOLOCK) ON p.id = d.id1opreme
        ORDER BY p.id DESC;
      `);

      const rows = res.recordset;
      if (!rows || rows.length === 0) return;

      const existingEqIds = new Set<number>();

      for (const r of rows) {
        existingEqIds.add(r.id);
        const input: EquipmentInput = {
          id: r.id,
          name: (r.ime || '').trim(),
          category_id: r.katid || null,
          status_id: r.statid || 1,
          location_id: r.lokacija || null,
          building_id: r.objekat || null,
          room_id: r.kancelarija || null,
          employee_no: r.zap ? String(r.zap).trim() : null,
          inventory_no: r.si_os ? String(r.si_os).trim() : null,
          comment: r.koment ? String(r.koment).trim() : null,
          description: r.opis ? String(r.opis).trim() : null,
          date_arrived: r.doslo ? new Date(r.doslo).toISOString().split('T')[0] : null,
          date_purchased: r.kupljeno ? String(r.kupljeno).trim() : null,
          custom_code: r.r_oznaka || null,
          rack_dims: r.dimenzije_ormana ? String(r.dimenzije_ormana).trim() : null,
          route_desc: r.trasa_opis ? String(r.trasa_opis).trim() : null,
          lines_count: r.broj_linija_izvedenih != null ? Number(r.broj_linija_izvedenih) : null
        };


        let details: EquipmentDetails | undefined;
        if (r.operativni || r.adresa || r.ram || r.procesor || r.hdd_vrsta || r.hdd_kapac || r.ploca || r.gateway || r.graficka) {
          details = {
            equipment_id: r.id,
            os: r.operativni || null,
            ip_address: r.adresa || null,
            mac_address: r.mrezna || null,
            ram: r.ram || null,
            processor: r.procesor || null,
            disk_type: r.hdd_vrsta || null,
            disk_capacity: r.hdd_kapac || null,
            motherboard: r.ploca || null,
            monitor: r.monitor || null,
            gpu: r.graficka || null,
            gateway: r.gateway || null
          };
        }

        const existing = equipmentDb.getEquipmentById(r.id);
        if (existing) {
          equipmentDb.updateEquipment(r.id, input, details);
        } else {
          equipmentDb.createEquipment(input, details);
        }
      }

      // 2. Pull software & licenses
      try {
        const swRes = await pool.request().query(`
          SELECT id_lic, id2opreme, vendor, naziv_soft, licenciran, kljuc, napomena 
          FROM software WITH (NOLOCK)
          ORDER BY id_lic ASC;
        `);
        if (swRes.recordset && swRes.recordset.length > 0) {
          const { getDb } = await import('../db/sqlite.js');
          const db = getDb();
          const insertSw = db.prepare(`
            INSERT OR REPLACE INTO equipment_software (id, equipment_id, vendor, name, is_licensed, license_key, note)
            VALUES (@id, @equipment_id, @vendor, @name, @is_licensed, @license_key, @note)
          `);
          const syncSwTx = db.transaction((swRows: any[]) => {
            for (const s of swRows) {
              if (!existingEqIds.has(s.id2opreme)) continue;
              insertSw.run({
                id: s.id_lic,
                equipment_id: s.id2opreme,
                vendor: s.vendor ? String(s.vendor).trim() : null,
                name: s.naziv_soft ? String(s.naziv_soft).trim() : 'Softver',
                is_licensed: s.licenciran ? 1 : 0,
                license_key: s.kljuc ? String(s.kljuc).trim() : null,
                note: s.napomena ? String(s.napomena).trim() : null
              });
            }
          });
          syncSwTx(swRes.recordset);
        }
      } catch (swErr: any) {
        console.warn('[LegacySyncBridge] Upozorenje pri sinhronizaciji software tabele:', swErr.message);
      }

      // 3. Pull history & service notes (evidencije)
      try {
        const evRes = await pool.request().query(`
          SELECT id2, idopreme, datum, text, telefon 
          FROM evidencije WITH (NOLOCK)
          ORDER BY id2 ASC;
        `);
        if (evRes.recordset && evRes.recordset.length > 0) {
          const { getDb } = await import('../db/sqlite.js');
          const db = getDb();
          const insertHist = db.prepare(`
            INSERT OR REPLACE INTO equipment_history (id, equipment_id, date, note, phone)
            VALUES (@id, @equipment_id, @date, @note, @phone)
          `);
          const syncHistTx = db.transaction((evRows: any[]) => {
            for (const h of evRows) {
              if (!existingEqIds.has(h.idopreme)) continue;
              insertHist.run({
                id: h.id2,
                equipment_id: h.idopreme,
                date: h.datum ? new Date(h.datum).toISOString().split('T')[0] : null,
                note: h.text ? String(h.text).trim() : '',
                phone: h.telefon ? String(h.telefon).trim() : null
              });
            }
          });
          syncHistTx(evRes.recordset);
        }
      } catch (evErr: any) {
        console.warn('[LegacySyncBridge] Upozorenje pri sinhronizaciji evidencije tabele:', evErr.message);
      }

      // 4. Pull MTS Packages (Paket_dodatak)
      try {
        const pkgRes = await pool.request().query(`
          SELECT Id, Tip, Sifra, Opis, JM 
          FROM Paket_dodatak WITH (NOLOCK)
          ORDER BY Id ASC;
        `);
        if (pkgRes.recordset && pkgRes.recordset.length > 0) {
          mtsDb.syncPackages(pkgRes.recordset.map((p: any) => ({
            id: p.Id,
            tip: p.Tip ? String(p.Tip).trim() : '',
            sifra: p.Sifra ? String(p.Sifra).trim() : null,
            opis: p.Opis ? String(p.Opis).trim() : '',
            jm: p.JM ? String(p.JM).trim() : null
          })));
        }
      } catch (pkgErr: any) {
        console.warn('[LegacySyncBridge] Upozorenje pri sinhronizaciji Paket_dodatak tabele:', pkgErr.message);
      }

      // 5. Pull MTS Numbers (Telefoni)
      try {
        const telRes = await pool.request().query(`
          SELECT Id, telefon, kategorija, status, provajder, paket, doslo, dodatak_internet, dodatak1, dodatak2, dodatak3
          FROM Telefoni WITH (NOLOCK)
          ORDER BY Id ASC;
        `);
        if (telRes.recordset && telRes.recordset.length > 0) {
          const { getDb } = await import('../db/sqlite.js');
          const db = getDb();
          const insertTel = db.prepare(`
            INSERT OR REPLACE INTO mts_numbers (
              id, telefon, kategorija, status, provajder, paket, doslo, dodatak_internet, dodatak1, dodatak2, dodatak3, updated_at
            ) VALUES (
              @id, @telefon, @kategorija, @status, @provajder, @paket, @doslo, @dodatak_internet, @dodatak1, @dodatak2, @dodatak3, CURRENT_TIMESTAMP
            )
          `);
          const telTx = db.transaction((telRows: any[]) => {
            for (const t of telRows) {
              insertTel.run({
                id: t.Id,
                telefon: t.telefon ? String(t.telefon).trim() : '',
                kategorija: t.kategorija ? String(t.kategorija).trim() : 'Mobilni',
                status: t.status ? String(t.status).trim() : 'Aktivan',
                provajder: t.provajder ? String(t.provajder).trim() : 'MTS',
                paket: t.paket ? String(t.paket).trim() : null,
                doslo: t.doslo ? String(t.doslo).trim() : null,
                dodatak_internet: t.dodatak_internet ? String(t.dodatak_internet).trim() : null,
                dodatak1: t.dodatak1 ? String(t.dodatak1).trim() : null,
                dodatak2: t.dodatak2 ? String(t.dodatak2).trim() : null,
                dodatak3: t.dodatak3 ? String(t.dodatak3).trim() : null
              });
            }
          });
          telTx(telRes.recordset);
        }
      } catch (telErr: any) {
        console.warn('[LegacySyncBridge] Upozorenje pri sinhronizaciji Telefoni tabele:', telErr.message);
      }

      // 6. Pull MTS Phone Logs (evidencije_telefona)
      try {
        const evTelRes = await pool.request().query(`
          SELECT id2, telefon, datum, text
          FROM evidencije_telefona WITH (NOLOCK)
          ORDER BY id2 ASC;
        `);
        if (evTelRes.recordset && evTelRes.recordset.length > 0) {
          const { getDb } = await import('../db/sqlite.js');
          const db = getDb();
          const insertEvTel = db.prepare(`
            INSERT OR REPLACE INTO mts_phone_logs (id, telefon, datum, text)
            VALUES (@id, @telefon, @datum, @text)
          `);
          const evTelTx = db.transaction((logs: any[]) => {
            for (const l of logs) {
              insertEvTel.run({
                id: l.id2,
                telefon: l.telefon ? String(l.telefon).trim() : '',
                datum: l.datum ? new Date(l.datum).toISOString().split('T')[0] : null,
                text: l.text ? String(l.text).trim() : ''
              });
            }
          });
          evTelTx(evTelRes.recordset);
        }
      } catch (evTelErr: any) {
        console.warn('[LegacySyncBridge] Upozorenje pri sinhronizaciji evidencije_telefona tabele:', evTelErr.message);
      }

      // 7. Pull Lines (linija)
      try {
        const linRes = await pool.request().query(`
          SELECT id, oznaka_zid, oznaka_panel, kancelarija, cvor, opis_trase, opis
          FROM linija WITH (NOLOCK)
          ORDER BY id ASC;
        `);
        if (linRes.recordset && linRes.recordset.length > 0) {
          linesDb.syncLegacyLines(linRes.recordset);
        }
      } catch (linErr: any) {
        console.warn('[LegacySyncBridge] Upozorenje pri sinhronizaciji linija tabele:', linErr.message);
      }

      console.log(`[LegacySyncBridge] ✓ Uspešno sinhronizovano ${rows.length} zapisa opreme, linija i MTS brojeva sa 121.20 u SQLite.`);
    } catch (err: any) {
      console.error('[LegacySyncBridge] Greška pri preuzimanju zapisa sa 121.20:', err);
    }
  }

  /**
   * Dual-Write: Writes a newly created equipment item to legacy MSSQL 121.20.
   */
  public async dualWriteCreate(id: number, input: EquipmentInput, details?: EquipmentDetails, softwareList?: any[], historyList?: any[]): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      const q = `
        SET IDENTITY_INSERT pc1 ON;
        INSERT INTO pc1 (id, ime, katid, statid, lokacija, objekat, kancelarija, zap, si_os, koment, opis, doslo, kupljeno, r_oznaka, dimenzije_ormana, trasa_opis, broj_linija_izvedenih)
        VALUES (@id, @ime, @katid, @statid, @lokacija, @objekat, @kancelarija, @zap, @si_os, @koment, @opis, @doslo, @kupljeno, @r_oznaka, @dimenzije_ormana, @trasa_opis, @broj_linija_izvedenih);
        SET IDENTITY_INSERT pc1 OFF;
      `;

      const req = pool.request()
        .input('id', sql.Int, id)
        .input('ime', sql.NVarChar(255), input.name)
        .input('katid', sql.Int, input.category_id || null)
        .input('statid', sql.Int, input.status_id || 1)
        .input('lokacija', sql.Int, input.location_id || null)
        .input('objekat', sql.Int, input.building_id || null)
        .input('kancelarija', sql.Int, input.room_id || null)
        .input('zap', sql.NVarChar(50), input.employee_no || null)
        .input('si_os', sql.NVarChar(100), input.inventory_no || null)
        .input('koment', sql.NVarChar(sql.MAX), input.comment || null)
        .input('opis', sql.NVarChar(sql.MAX), input.description || null)
        .input('doslo', sql.NVarChar(50), input.date_arrived || null)
        .input('kupljeno', sql.NVarChar(50), input.date_purchased || null)
        .input('r_oznaka', sql.Int, input.custom_code || null)
        .input('dimenzije_ormana', sql.Char(50), input.rack_dims || null)
        .input('trasa_opis', sql.NVarChar(sql.MAX), input.route_desc || null)
        .input('broj_linija_izvedenih', sql.Int, input.lines_count !== undefined && input.lines_count !== null ? Number(input.lines_count) : null);

      await req.query(q);


      // Also write details if provided
      if (details) {
        const dq = `
          INSERT INTO pc_detalji (id1opreme, operativni, adresa, mrezna, ram, procesor, hdd_vrsta, hdd_kapac, ploca, monitor, graficka, gateway)
          VALUES (@id, @operativni, @adresa, @mrezna, @ram, @procesor, @hdd_vrsta, @hdd_kapac, @ploca, @monitor, @graficka, @gateway);
        `;
        await pool.request()
          .input('id', sql.Int, id)
          .input('operativni', sql.NVarChar(100), details.os || null)
          .input('adresa', sql.NVarChar(50), details.ip_address || null)
          .input('mrezna', sql.NVarChar(50), details.mac_address || null)
          .input('ram', sql.NVarChar(50), details.ram || null)
          .input('procesor', sql.NVarChar(150), details.processor || null)
          .input('hdd_vrsta', sql.NVarChar(50), details.disk_type || null)
          .input('hdd_kapac', sql.NVarChar(50), details.disk_capacity || null)
          .input('ploca', sql.NVarChar(100), details.motherboard || null)
          .input('monitor', sql.NVarChar(100), details.monitor || null)
          .input('graficka', sql.NVarChar(100), details.gpu || null)
          .input('gateway', sql.NVarChar(50), details.gateway || null)
          .query(dq);
      }

      // Also write software items if provided
      if (softwareList && Array.isArray(softwareList) && softwareList.length > 0) {
        for (const s of softwareList) {
          if (s.name && s.name.trim()) {
            await pool.request()
              .input('id2opreme', sql.Int, id)
              .input('vendor', sql.NVarChar(100), s.vendor || null)
              .input('naziv_soft', sql.NVarChar(255), s.name.trim())
              .input('licenciran', sql.Int, s.is_licensed !== 0 ? 1 : 0)
              .input('kljuc', sql.NVarChar(255), s.license_key || null)
              .input('napomena', sql.NVarChar(sql.MAX), s.note || null)
              .query(`
                INSERT INTO software (id2opreme, vendor, naziv_soft, licenciran, kljuc, napomena)
                VALUES (@id2opreme, @vendor, @naziv_soft, @licenciran, @kljuc, @napomena);
              `);
          }
        }
      }

      // Also write history items if provided
      if (historyList && Array.isArray(historyList) && historyList.length > 0) {
        for (const h of historyList) {
          if (h.note && h.note.trim()) {
            await pool.request()
              .input('idopreme', sql.Int, id)
              .input('datum', sql.NVarChar(50), h.date || new Date().toISOString().split('T')[0])
              .input('text', sql.NVarChar(sql.MAX), h.note.trim())
              .input('telefon', sql.NVarChar(50), h.phone || null)
              .query(`
                INSERT INTO evidencije (idopreme, datum, text, telefon)
                VALUES (@idopreme, @datum, @text, @telefon);
              `);
          }
        }
      }

      console.log(`[LegacySyncBridge] ✓ Dual-Write: Sačuvana nova oprema ID #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Upozorenje: Dual-write (create) na 121.20 nije uspeo:`, err.message);
      return false;
    }
  }

  /**
   * Dual-Write: Updates existing equipment on legacy MSSQL 121.20.
   */
  public async dualWriteUpdate(id: number, input: Partial<EquipmentInput>, details?: Partial<EquipmentDetails>, softwareList?: any[], historyList?: any[]): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      const sets: string[] = [];
      const req = pool.request().input('id', sql.Int, id);

      if (input.name !== undefined) { sets.push('ime = @ime'); req.input('ime', sql.NVarChar(255), input.name); }
      if (input.category_id !== undefined) { sets.push('katid = @katid'); req.input('katid', sql.Int, input.category_id); }
      if (input.status_id !== undefined) { sets.push('statid = @statid'); req.input('statid', sql.Int, input.status_id); }
      if (input.location_id !== undefined) { sets.push('lokacija = @lokacija'); req.input('lokacija', sql.Int, input.location_id); }
      if (input.building_id !== undefined) { sets.push('objekat = @objekat'); req.input('objekat', sql.Int, input.building_id); }
      if (input.room_id !== undefined) { sets.push('kancelarija = @kancelarija'); req.input('kancelarija', sql.Int, input.room_id); }
      if (input.employee_no !== undefined) { sets.push('zap = @zap'); req.input('zap', sql.NVarChar(50), input.employee_no); }
      if (input.inventory_no !== undefined) { sets.push('si_os = @si_os'); req.input('si_os', sql.NVarChar(100), input.inventory_no); }
      if (input.comment !== undefined) { sets.push('koment = @koment'); req.input('koment', sql.NVarChar(sql.MAX), input.comment); }
      if (input.description !== undefined) { sets.push('opis = @opis'); req.input('opis', sql.NVarChar(sql.MAX), input.description); }
      if (input.date_arrived !== undefined) { sets.push('doslo = @doslo'); req.input('doslo', sql.NVarChar(50), input.date_arrived); }
      if (input.date_purchased !== undefined) { sets.push('kupljeno = @kupljeno'); req.input('kupljeno', sql.NVarChar(50), input.date_purchased); }
      if (input.custom_code !== undefined) { sets.push('r_oznaka = @r_oznaka'); req.input('r_oznaka', sql.Int, input.custom_code); }
      if (input.rack_dims !== undefined) { sets.push('dimenzije_ormana = @dimenzije_ormana'); req.input('dimenzije_ormana', sql.Char(50), input.rack_dims); }
      if (input.route_desc !== undefined) { sets.push('trasa_opis = @trasa_opis'); req.input('trasa_opis', sql.NVarChar(sql.MAX), input.route_desc); }
      if (input.lines_count !== undefined) { sets.push('broj_linija_izvedenih = @broj_linija_izvedenih'); req.input('broj_linija_izvedenih', sql.Int, input.lines_count !== null ? Number(input.lines_count) : null); }

      if (sets.length > 0) {
        await req.query(`UPDATE pc1 SET ${sets.join(', ')} WHERE id = @id;`);
      }

      if (details && Object.keys(details).length > 0) {
        const dSets: string[] = [];
        const dReq = pool.request().input('id', sql.Int, id);

        if (details.os !== undefined) { dSets.push('operativni = @operativni'); dReq.input('operativni', sql.NVarChar(100), details.os); }
        if (details.ip_address !== undefined) { dSets.push('adresa = @adresa'); dReq.input('adresa', sql.NVarChar(50), details.ip_address); }
        if (details.mac_address !== undefined) { dSets.push('mrezna = @mrezna'); dReq.input('mrezna', sql.NVarChar(50), details.mac_address); }
        if (details.ram !== undefined) { dSets.push('ram = @ram'); dReq.input('ram', sql.NVarChar(50), details.ram); }
        if (details.processor !== undefined) { dSets.push('procesor = @procesor'); dReq.input('procesor', sql.NVarChar(150), details.processor); }
        if (details.disk_type !== undefined) { dSets.push('hdd_vrsta = @hdd_vrsta'); dReq.input('hdd_vrsta', sql.NVarChar(50), details.disk_type); }
        if (details.disk_capacity !== undefined) { dSets.push('hdd_kapac = @hdd_kapac'); dReq.input('hdd_kapac', sql.NVarChar(50), details.disk_capacity); }
        if (details.motherboard !== undefined) { dSets.push('ploca = @ploca'); dReq.input('ploca', sql.NVarChar(100), details.motherboard); }
        if (details.gpu !== undefined) { dSets.push('graficka = @graficka'); dReq.input('graficka', sql.NVarChar(100), details.gpu); }
        if (details.gateway !== undefined) { dSets.push('gateway = @gateway'); dReq.input('gateway', sql.NVarChar(50), details.gateway); }

        if (dSets.length > 0) {
          const checkExists = await pool.request().input('id', sql.Int, id).query(`SELECT id1 FROM pc_detalji WHERE id1opreme = @id;`);
          if (checkExists.recordset.length > 0) {
            await dReq.query(`UPDATE pc_detalji SET ${dSets.join(', ')} WHERE id1opreme = @id;`);
          } else {
            await pool.request()
              .input('id', sql.Int, id)
              .input('operativni', sql.NVarChar(100), details.os || null)
              .input('adresa', sql.NVarChar(50), details.ip_address || null)
              .input('mrezna', sql.NVarChar(50), details.mac_address || null)
              .input('ram', sql.NVarChar(50), details.ram || null)
              .input('procesor', sql.NVarChar(150), details.processor || null)
              .input('hdd_vrsta', sql.NVarChar(50), details.disk_type || null)
              .input('hdd_kapac', sql.NVarChar(50), details.disk_capacity || null)
              .input('ploca', sql.NVarChar(100), details.motherboard || null)
              .input('graficka', sql.NVarChar(100), details.gpu || null)
              .input('gateway', sql.NVarChar(50), details.gateway || null)
              .query(`
                INSERT INTO pc_detalji (id1opreme, operativni, adresa, mrezna, ram, procesor, hdd_vrsta, hdd_kapac, ploca, graficka, gateway)
                VALUES (@id, @operativni, @adresa, @mrezna, @ram, @procesor, @hdd_vrsta, @hdd_kapac, @ploca, @graficka, @gateway);
              `);
          }
        }
      }

      // Sync software on legacy server if softwareList was provided
      if (softwareList !== undefined && Array.isArray(softwareList)) {
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM software WHERE id2opreme = @id;`);
        for (const s of softwareList) {
          if (s.name && s.name.trim()) {
            await pool.request()
              .input('id2opreme', sql.Int, id)
              .input('vendor', sql.NVarChar(100), s.vendor || null)
              .input('naziv_soft', sql.NVarChar(255), s.name.trim())
              .input('licenciran', sql.Int, s.is_licensed !== 0 ? 1 : 0)
              .input('kljuc', sql.NVarChar(255), s.license_key || null)
              .input('napomena', sql.NVarChar(sql.MAX), s.note || null)
              .query(`
                INSERT INTO software (id2opreme, vendor, naziv_soft, licenciran, kljuc, napomena)
                VALUES (@id2opreme, @vendor, @naziv_soft, @licenciran, @kljuc, @napomena);
              `);
          }
        }
      }

      // Sync history on legacy server if historyList was provided
      if (historyList !== undefined && Array.isArray(historyList)) {
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM evidencije WHERE idopreme = @id;`);
        for (const h of historyList) {
          if (h.note && h.note.trim()) {
            await pool.request()
              .input('idopreme', sql.Int, id)
              .input('datum', sql.NVarChar(50), h.date || new Date().toISOString().split('T')[0])
              .input('text', sql.NVarChar(sql.MAX), h.note.trim())
              .input('telefon', sql.NVarChar(50), h.phone || null)
              .query(`
                INSERT INTO evidencije (idopreme, datum, text, telefon)
                VALUES (@idopreme, @datum, @text, @telefon);
              `);
          }
        }
      }

      console.log(`[LegacySyncBridge] ✓ Dual-Write: Ažurirana oprema ID #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Upozorenje: Dual-write (update) na 121.20 nije uspeo:`, err.message);
      return false;
    }
  }

  /**
   * Dual-Write: Adds a single history / service note to legacy 121.20.
   */
  public async dualWriteAddHistory(equipmentId: number, note: string, date?: string | null, phone?: string | null): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      await pool.request()
        .input('idopreme', sql.Int, equipmentId)
        .input('datum', sql.NVarChar(50), date || new Date().toISOString().split('T')[0])
        .input('text', sql.NVarChar(sql.MAX), note.trim())
        .input('telefon', sql.NVarChar(50), phone ? phone.trim() : null)
        .query(`
          INSERT INTO evidencije (idopreme, datum, text, telefon)
          VALUES (@idopreme, @datum, @text, @telefon);
        `);
      return true;
    } catch (err: any) {
      console.warn('[LegacySyncBridge] Dual-write add history error:', err.message);
      return false;
    }
  }

  /**
   * Dual-Write: Updates a single history / service note on legacy 121.20.
   */
  public async dualWriteUpdateHistory(historyId: number, note: string, date?: string | null, phone?: string | null): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      await pool.request()
        .input('id', sql.Int, historyId)
        .input('datum', sql.NVarChar(50), date || null)
        .input('text', sql.NVarChar(sql.MAX), note.trim())
        .input('telefon', sql.NVarChar(50), phone ? phone.trim() : null)
        .query(`
          UPDATE evidencije 
          SET text = @text, 
              datum = COALESCE(@datum, datum), 
              telefon = @telefon 
          WHERE id2 = @id;
        `);
      return true;
    } catch (err: any) {
      console.warn('[LegacySyncBridge] Dual-write update history error:', err.message);
      return false;
    }
  }

  /**
   * Dual-Write: Deletes a single history note on legacy 121.20.
   */
  public async dualWriteDeleteHistory(historyId: number): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      await pool.request()
        .input('id', sql.Int, historyId)
        .query('DELETE FROM evidencije WHERE id2 = @id;');
      return true;
    } catch (err: any) {
      console.warn('[LegacySyncBridge] Dual-write delete history error:', err.message);
      return false;
    }
  }

  /**
   * Dual-Write: Adds a single software license on legacy 121.20.
   */
  public async dualWriteAddSoftware(equipmentId: number, software: any): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      await pool.request()
        .input('id2opreme', sql.Int, equipmentId)
        .input('vendor', sql.NVarChar(100), software.vendor || null)
        .input('naziv_soft', sql.NVarChar(255), (software.name || '').trim())
        .input('licenciran', sql.Int, software.is_licensed !== 0 ? 1 : 0)
        .input('kljuc', sql.NVarChar(255), software.license_key || null)
        .input('napomena', sql.NVarChar(sql.MAX), software.note || null)
        .query(`
          INSERT INTO software (id2opreme, vendor, naziv_soft, licenciran, kljuc, napomena)
          VALUES (@id2opreme, @vendor, @naziv_soft, @licenciran, @kljuc, @napomena);
        `);
      return true;
    } catch (err: any) {
      console.warn('[LegacySyncBridge] Dual-write add software error:', err.message);
      return false;
    }
  }

  /**
   * Dual-Write: Updates a single software license on legacy 121.20.
   */
  public async dualWriteUpdateSoftware(softwareId: number, equipmentId: number, software: any): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      await pool.request()
        .input('id', sql.Int, softwareId)
        .input('id2opreme', sql.Int, equipmentId)
        .input('vendor', sql.NVarChar(100), software.vendor || null)
        .input('naziv_soft', sql.NVarChar(255), (software.name || '').trim())
        .input('licenciran', sql.Int, software.is_licensed !== 0 ? 1 : 0)
        .input('kljuc', sql.NVarChar(255), software.license_key || null)
        .input('napomena', sql.NVarChar(sql.MAX), software.note || null)
        .query(`
          UPDATE software SET
            id2opreme = @id2opreme,
            vendor = @vendor,
            naziv_soft = @naziv_soft,
            licenciran = @licenciran,
            kljuc = @kljuc,
            napomena = @napomena
          WHERE id_lic = @id;
        `);
      return true;
    } catch (err: any) {
      console.warn('[LegacySyncBridge] Dual-write update software error:', err.message);
      return false;
    }
  }

  /**
   * Dual-Write: Deletes a single software license on legacy 121.20.
   */
  public async dualWriteDeleteSoftware(softwareId: number): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      await pool.request()
        .input('id', sql.Int, softwareId)
        .query('DELETE FROM software WHERE id_lic = @id;');
      return true;
    } catch (err: any) {
      console.warn('[LegacySyncBridge] Dual-write delete software error:', err.message);
      return false;
    }
  }

  /**
   * Dual-Write: Deletes equipment on legacy MSSQL 121.20.
   */
  public async dualWriteDelete(id: number): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      await pool.request().input('id', sql.Int, id).query(`
        DELETE FROM software WHERE id2opreme = @id;
        DELETE FROM evidencije WHERE idopreme = @id;
        DELETE FROM pc_detalji WHERE id1opreme = @id;
        DELETE FROM pc1 WHERE id = @id;
      `);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Obrisana oprema ID #${id} sa 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Upozorenje: Dual-write (delete) na 121.20 nije uspeo:`, err.message);
      return false;
    }
  }

  // =========================================================================
  // DICTIONARIES (ŠIFARNICI) DUAL-WRITE METHODS
  // =========================================================================

  // 1. Statuses
  public async dualWriteCreateStatus(id: number, name: string): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .input('status', sql.VarChar(100), name.trim())
        .query(`
          SET IDENTITY_INSERT status ON;
          INSERT INTO status (status_id, status) VALUES (@id, @status);
          SET IDENTITY_INSERT status OFF;
        `);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Sačuvan status #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write create status error:`, err.message);
      return false;
    }
  }

  public async dualWriteUpdateStatus(id: number, name: string): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .input('status', sql.VarChar(100), name.trim())
        .query(`UPDATE status SET status = @status WHERE status_id = @id;`);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Ažuriran status #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write update status error:`, err.message);
      return false;
    }
  }

  public async dualWriteDeleteStatus(id: number): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM status WHERE status_id = @id;`);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Obrisan status #${id} sa 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write delete status error:`, err.message);
      return false;
    }
  }

  // 2. Categories (tip_opreme)
  public async dualWriteCreateCategory(id: number, name: string, isNetwork?: number | boolean): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      const tipCode = isNetwork ? 'M' : 'R';
      await pool.request()
        .input('id', sql.Int, id)
        .input('tip_naziv', sql.VarChar(100), name.trim())
        .input('tip', sql.VarChar(10), tipCode)
        .query(`
          SET IDENTITY_INSERT tip_opreme ON;
          INSERT INTO tip_opreme (tip_id, tip_naziv, tip) VALUES (@id, @tip_naziv, @tip);
          SET IDENTITY_INSERT tip_opreme OFF;
        `);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Sačuvana kategorija #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write create category error:`, err.message);
      return false;
    }
  }

  public async dualWriteUpdateCategory(id: number, name: string, isNetwork?: number | boolean): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      const tipCode = isNetwork ? 'M' : 'R';
      await pool.request()
        .input('id', sql.Int, id)
        .input('tip_naziv', sql.VarChar(100), name.trim())
        .input('tip', sql.VarChar(10), tipCode)
        .query(`UPDATE tip_opreme SET tip_naziv = @tip_naziv, tip = @tip WHERE tip_id = @id;`);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Ažurirana kategorija #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write update category error:`, err.message);
      return false;
    }
  }

  public async dualWriteDeleteCategory(id: number): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM tip_opreme WHERE tip_id = @id;`);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Obrisana kategorija #${id} sa 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write delete category error:`, err.message);
      return false;
    }
  }

  // 3. Locations (lokacija)
  public async dualWriteCreateLocation(id: number, name: string): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .input('opis', sql.NVarChar(100), name.trim())
        .query(`
          SET IDENTITY_INSERT lokacija ON;
          INSERT INTO lokacija (lok, opis) VALUES (@id, @opis);
          SET IDENTITY_INSERT lokacija OFF;
        `);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Sačuvana lokacija #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write create location error:`, err.message);
      return false;
    }
  }

  public async dualWriteUpdateLocation(id: number, name: string): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .input('opis', sql.NVarChar(100), name.trim())
        .query(`UPDATE lokacija SET opis = @opis WHERE lok = @id;`);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Ažurirana lokacija #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write update location error:`, err.message);
      return false;
    }
  }

  public async dualWriteDeleteLocation(id: number): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM lokacija WHERE lok = @id;`);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Obrisana lokacija #${id} sa 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write delete location error:`, err.message);
      return false;
    }
  }

  // 4. Buildings (objekat)
  public async dualWriteCreateBuilding(id: number, building: { name: string; location_id?: number | null; description?: string | null }): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .input('objekat', sql.NVarChar(100), building.name.trim())
        .input('lokacija', sql.Int, building.location_id || null)
        .input('opis', sql.VarChar(sql.MAX), building.description || null)
        .query(`
          SET IDENTITY_INSERT objekat ON;
          INSERT INTO objekat (id, objekat, lokacija, opis) VALUES (@id, @objekat, @lokacija, @opis);
          SET IDENTITY_INSERT objekat OFF;
        `);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Sačuvan objekat #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write create building error:`, err.message);
      return false;
    }
  }

  public async dualWriteUpdateBuilding(id: number, building: { name: string; location_id?: number | null; description?: string | null }): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .input('objekat', sql.NVarChar(100), building.name.trim())
        .input('lokacija', sql.Int, building.location_id || null)
        .input('opis', sql.VarChar(sql.MAX), building.description || null)
        .query(`
          UPDATE objekat SET 
            objekat = @objekat,
            lokacija = @lokacija,
            opis = @opis
          WHERE id = @id;
        `);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Ažuriran objekat #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write update building error:`, err.message);
      return false;
    }
  }

  public async dualWriteDeleteBuilding(id: number): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM objekat WHERE id = @id;`);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Obrisan objekat #${id} sa 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write delete building error:`, err.message);
      return false;
    }
  }

  // 5. Rooms (kancelarija)
  public async dualWriteCreateRoom(id: number, room: { code?: string | null; building?: number | null; floor?: string | null; short_desc?: string | null; name?: string | null }): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      const codeNum = room.code ? parseInt(room.code, 10) : null;
      const floorNum = room.floor != null ? parseInt(room.floor, 10) : null;
      await pool.request()
        .input('id', sql.Int, id)
        .input('kanc_oznaka', sql.Int, isNaN(codeNum as number) ? null : codeNum)
        .input('objekat', sql.Int, room.building || null)
        .input('sprat', sql.Int, isNaN(floorNum as number) ? null : floorNum)
        .input('opis_skracen', sql.VarChar(100), room.short_desc || null)
        .input('opis', sql.VarChar(sql.MAX), room.name || null)
        .query(`
          SET IDENTITY_INSERT kancelarija ON;
          INSERT INTO kancelarija (idkanc, kanc_oznaka, objekat, sprat, opis_skracen, opis)
          VALUES (@id, @kanc_oznaka, @objekat, @sprat, @opis_skracen, @opis);
          SET IDENTITY_INSERT kancelarija OFF;
        `);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Sačuvana kancelarija #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write create room error:`, err.message);
      return false;
    }
  }

  public async dualWriteUpdateRoom(id: number, room: { code?: string | null; building?: number | null; floor?: string | null; short_desc?: string | null; name?: string | null }): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      const codeNum = room.code ? parseInt(room.code, 10) : null;
      const floorNum = room.floor != null ? parseInt(room.floor, 10) : null;
      await pool.request()
        .input('id', sql.Int, id)
        .input('kanc_oznaka', sql.Int, isNaN(codeNum as number) ? null : codeNum)
        .input('objekat', sql.Int, room.building || null)
        .input('sprat', sql.Int, isNaN(floorNum as number) ? null : floorNum)
        .input('opis_skracen', sql.VarChar(100), room.short_desc || null)
        .input('opis', sql.VarChar(sql.MAX), room.name || null)
        .query(`
          UPDATE kancelarija SET
            kanc_oznaka = @kanc_oznaka,
            objekat = @objekat,
            sprat = @sprat,
            opis_skracen = @opis_skracen,
            opis = @opis
          WHERE idkanc = @id;
        `);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Ažurirana kancelarija #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write update room error:`, err.message);
      return false;
    }
  }

  public async dualWriteDeleteRoom(id: number): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM kancelarija WHERE idkanc = @id;`);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Obrisana kancelarija #${id} sa 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write delete room error:`, err.message);
      return false;
    }
  }

  // 6. MTS Numbers (Telefoni)
  public async dualWriteCreateMtsNumber(input: MtsNumberInput & { id?: number }): Promise<number | null> {
    const pool = await this.getPool();
    if (!pool) return null;
    try {
      if (input.id) {
        await pool.request()
          .input('id', sql.Int, input.id)
          .input('telefon', sql.NVarChar(50), input.telefon.trim())
          .input('kategorija', sql.NVarChar(50), input.kategorija || 'Mobilni')
          .input('status', sql.NVarChar(50), input.status || 'Aktivan')
          .input('provajder', sql.NVarChar(50), input.provajder || 'MTS')
          .input('paket', sql.NVarChar(100), input.paket || null)
          .input('doslo', sql.NVarChar(50), input.doslo || null)
          .input('dodatak_internet', sql.NVarChar(50), input.dodatak_internet || null)
          .input('dodatak1', sql.NVarChar(100), input.dodatak1 || null)
          .input('dodatak2', sql.NVarChar(100), input.dodatak2 || null)
          .input('dodatak3', sql.NVarChar(100), input.dodatak3 || null)
          .query(`
            SET IDENTITY_INSERT Telefoni ON;
            INSERT INTO Telefoni (Id, telefon, kategorija, status, provajder, paket, doslo, dodatak_internet, dodatak1, dodatak2, dodatak3)
            VALUES (@id, @telefon, @kategorija, @status, @provajder, @paket, @doslo, @dodatak_internet, @dodatak1, @dodatak2, @dodatak3);
            SET IDENTITY_INSERT Telefoni OFF;
          `);
        console.log(`[LegacySyncBridge] ✓ Dual-Write: Sačuvan MTS broj #${input.id} (${input.telefon}) na 121.20`);
        return input.id;
      } else {
        const res = await pool.request()
          .input('telefon', sql.NVarChar(50), input.telefon.trim())
          .input('kategorija', sql.NVarChar(50), input.kategorija || 'Mobilni')
          .input('status', sql.NVarChar(50), input.status || 'Aktivan')
          .input('provajder', sql.NVarChar(50), input.provajder || 'MTS')
          .input('paket', sql.NVarChar(100), input.paket || null)
          .input('doslo', sql.NVarChar(50), input.doslo || null)
          .input('dodatak_internet', sql.NVarChar(50), input.dodatak_internet || null)
          .input('dodatak1', sql.NVarChar(100), input.dodatak1 || null)
          .input('dodatak2', sql.NVarChar(100), input.dodatak2 || null)
          .input('dodatak3', sql.NVarChar(100), input.dodatak3 || null)
          .query(`
            INSERT INTO Telefoni (telefon, kategorija, status, provajder, paket, doslo, dodatak_internet, dodatak1, dodatak2, dodatak3)
            VALUES (@telefon, @kategorija, @status, @provajder, @paket, @doslo, @dodatak_internet, @dodatak1, @dodatak2, @dodatak3);
            SELECT SCOPE_IDENTITY() as newId;
          `);
        const newId = res.recordset[0]?.newId;
        console.log(`[LegacySyncBridge] ✓ Dual-Write: Kreiran MTS broj #${newId} (${input.telefon}) na 121.20`);
        return newId || null;
      }
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write create MTS number error:`, err.message);
      return null;
    }
  }

  public async dualWriteUpdateMtsNumber(id: number, input: MtsNumberInput): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .input('telefon', sql.NVarChar(50), input.telefon.trim())
        .input('kategorija', sql.NVarChar(50), input.kategorija || 'Mobilni')
        .input('status', sql.NVarChar(50), input.status || 'Aktivan')
        .input('provajder', sql.NVarChar(50), input.provajder || 'MTS')
        .input('paket', sql.NVarChar(100), input.paket || null)
        .input('doslo', sql.NVarChar(50), input.doslo || null)
        .input('dodatak_internet', sql.NVarChar(50), input.dodatak_internet || null)
        .input('dodatak1', sql.NVarChar(100), input.dodatak1 || null)
        .input('dodatak2', sql.NVarChar(100), input.dodatak2 || null)
        .input('dodatak3', sql.NVarChar(100), input.dodatak3 || null)
        .query(`
          UPDATE Telefoni SET
            telefon = @telefon,
            kategorija = @kategorija,
            status = @status,
            provajder = @provajder,
            paket = @paket,
            doslo = @doslo,
            dodatak_internet = @dodatak_internet,
            dodatak1 = @dodatak1,
            dodatak2 = @dodatak2,
            dodatak3 = @dodatak3
          WHERE Id = @id;
        `);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Ažuriran MTS broj #${id} (${input.telefon}) na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write update MTS number error:`, err.message);
      return false;
    }
  }

  public async dualWriteDeleteMtsNumber(id: number): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM Telefoni WHERE Id = @id;`);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Obrisan MTS broj #${id} sa 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write delete MTS number error:`, err.message);
      return false;
    }
  }

  // 7. MTS Phone Logs (evidencije_telefona)
  public async dualWriteCreateMtsLog(log: { phone: string; date?: string | null; text: string }): Promise<number | null> {
    const pool = await this.getPool();
    if (!pool) return null;
    try {
      const res = await pool.request()
        .input('telefon', sql.NVarChar(50), log.phone.trim())
        .input('datum', sql.DateTime, log.date ? new Date(log.date) : new Date())
        .input('text', sql.NVarChar(sql.MAX), log.text.trim())
        .query(`
          INSERT INTO evidencije_telefona (telefon, datum, text)
          VALUES (@telefon, @datum, @text);
          SELECT SCOPE_IDENTITY() as newId;
        `);
      const newId = res.recordset[0]?.newId;
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Dodata zabeleška za telefon ${log.phone} na 121.20`);
      return newId || null;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write create MTS log error:`, err.message);
      return null;
    }
  }

  public async dualWriteDeleteMtsLog(id: number): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM evidencije_telefona WHERE id2 = @id;`);
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Obrisana zabeleška #${id} sa 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write delete MTS log error:`, err.message);
      return false;
    }
  }

  /**
   * Dual-Write: Creates a new line in legacy table "linija"
   */
  public async dualWriteCreateLine(input: LineInput & { id?: number }): Promise<number | null> {
    const pool = await this.getPool();
    if (!pool) return null;

    try {
      const q = input.id ? `
        SET IDENTITY_INSERT linija ON;
        INSERT INTO linija (id, oznaka_zid, kancelarija, cvor, opis_trase, opis, oznaka_panel)
        VALUES (@id, @oznaka_zid, @kancelarija, @cvor, @opis_trase, @opis, @oznaka_panel);
        SET IDENTITY_INSERT linija OFF;
        SELECT @id as newId;
      ` : `
        INSERT INTO linija (oznaka_zid, kancelarija, cvor, opis_trase, opis, oznaka_panel)
        VALUES (@oznaka_zid, @kancelarija, @cvor, @opis_trase, @opis, @oznaka_panel);
        SELECT SCOPE_IDENTITY() as newId;
      `;

      const req = pool.request()
        .input('oznaka_zid', sql.Int, input.wall_socket_no || null)
        .input('kancelarija', sql.Int, input.room_id || null)
        .input('cvor', sql.Int, input.cvor_id || null)
        .input('opis_trase', sql.VarChar, input.route_description || null)
        .input('opis', sql.VarChar, input.description || null)
        .input('oznaka_panel', sql.NChar(10), input.patch_panel_code || null);

      if (input.id) {
        req.input('id', sql.Int, input.id);
      }

      const res = await req.query(q);
      const newId = res.recordset[0]?.newId;
      console.log(`[LegacySyncBridge] ✓ Dual-Write: Kreirana linija #${newId || input.id} na 121.20`);
      return newId || input.id || null;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write create line error:`, err.message);
      return null;
    }
  }

  /**
   * Dual-Write: Updates existing line in legacy table "linija"
   */
  public async dualWriteUpdateLine(id: number, input: LineInput): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      await pool.request()
        .input('id', sql.Int, id)
        .input('oznaka_zid', sql.Int, input.wall_socket_no || null)
        .input('kancelarija', sql.Int, input.room_id || null)
        .input('cvor', sql.Int, input.cvor_id || null)
        .input('opis_trase', sql.VarChar, input.route_description || null)
        .input('opis', sql.VarChar, input.description || null)
        .input('oznaka_panel', sql.NChar(10), input.patch_panel_code || null)
        .query(`
          UPDATE linija
          SET 
            oznaka_zid = @oznaka_zid,
            kancelarija = @kancelarija,
            cvor = @cvor,
            opis_trase = @opis_trase,
            opis = @opis,
            oznaka_panel = @oznaka_panel
          WHERE id = @id;
        `);

      console.log(`[LegacySyncBridge] ✓ Dual-Write: Ažurirana linija #${id} na 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write update line error:`, err.message);
      return false;
    }
  }

  /**
   * Dual-Write: Deletes line from legacy table "linija"
   */
  public async dualWriteDeleteLine(id: number): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) return false;

    try {
      await pool.request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM linija WHERE id = @id;`);

      console.log(`[LegacySyncBridge] ✓ Dual-Write: Obrisana linija #${id} sa 121.20`);
      return true;
    } catch (err: any) {
      console.warn(`[LegacySyncBridge] Dual-write delete line error:`, err.message);
      return false;
    }
  }

  /**
   * Status information for diagnostics.
   */
  public getStatus() {
    return {
      isAvailable: this.isAvailable,
      lastChecksum: this.lastChecksum,
      lastSyncTime: this.lastSyncTime
    };
  }
}

export const legacySyncBridge = new LegacySyncBridge();
// [LEGACY_BRIDGE_END]
