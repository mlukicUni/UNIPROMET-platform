import fs from 'fs';
import path from 'path';
import { getDb } from './sqlite';
import { initSchema } from './schema';

const DATA_DIR = path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups', 'legacy_json_backup');

/**
 * Automatically imports records from legacy JSON files into SQLite on initial setup.
 * Safely preserves all data and copies the original JSON files to data/backups/legacy_json_backup/.
 */
export function migrateLegacyJsonToSqlite(): { migrated: boolean; stats: Record<string, number> } {
  initSchema();
  const db = getDb();

  const stats = {
    recorders: 0,
    cameras: 0,
    printers: 0,
    reports: 0
  };

  // Check if recorders or cameras table is already populated
  const recorderCount = (db.prepare('SELECT COUNT(*) as count FROM recorders').get() as { count: number }).count;
  const cameraCount = (db.prepare('SELECT COUNT(*) as count FROM cameras').get() as { count: number }).count;
  const printerCount = (db.prepare('SELECT COUNT(*) as count FROM printers').get() as { count: number }).count;

  // If all tables have records, migration is already completed
  if (recorderCount > 0 && cameraCount > 0 && printerCount > 0) {
    return { migrated: false, stats: { recorders: recorderCount, cameras: cameraCount, printers: printerCount, reports: 0 } };
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Backup files timestamp
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  const runMigration = db.transaction(() => {
    // 1. Recorders Migration
    const recordersFile = path.join(DATA_DIR, 'recorders_inventory.json');
    if (recorderCount === 0 && fs.existsSync(recordersFile)) {
      try {
        const raw = fs.readFileSync(recordersFile, 'utf-8');
        const recorders = JSON.parse(raw);
        if (Array.isArray(recorders)) {
          const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO recorders (
              id, name, location, ip, model, type, subnet, cameras_count, channels, status, note, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const r of recorders) {
            insertStmt.run(
              r.id,
              r.name || 'Neimenovan Snimač',
              r.location || '',
              r.ip || '',
              r.model || '',
              r.type || 'NVR',
              r.subnet || '',
              r.camerasCount || 0,
              r.channels || 32,
              r.status || 'online',
              r.note || '',
              r.createdAt || new Date().toISOString(),
              r.updatedAt || null
            );
            stats.recorders++;
          }
          // Backup file
          fs.copyFileSync(recordersFile, path.join(BACKUP_DIR, `recorders_inventory_${ts}.json`));
        }
      } catch (err) {
        console.error('Greška pri migraciji snimača:', err);
      }
    }

    // 2. Cameras Migration
    const camerasFile = path.join(DATA_DIR, 'cameras_inventory.json');
    if (cameraCount === 0 && fs.existsSync(camerasFile)) {
      try {
        const raw = fs.readFileSync(camerasFile, 'utf-8');
        const cameras = JSON.parse(raw);
        if (Array.isArray(cameras)) {
          const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO cameras (
              id, ip, name, recorder, position, type, subnet, note, is_reserved, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const c of cameras) {
            insertStmt.run(
              c.id,
              c.ip || '',
              c.name || '',
              c.recorder || '',
              c.position || '',
              c.type || 'IP Kamera',
              c.subnet || '',
              c.note || '',
              c.isReserved ? 1 : 0,
              c.createdAt || new Date().toISOString(),
              c.updatedAt || null
            );
            stats.cameras++;
          }
          // Backup file
          fs.copyFileSync(camerasFile, path.join(BACKUP_DIR, `cameras_inventory_${ts}.json`));
        }
      } catch (err) {
        console.error('Greška pri migraciji kamera:', err);
      }
    }

    // 3. Printers Migration
    const printersFile = path.join(DATA_DIR, 'printers.json');
    if (printerCount === 0 && fs.existsSync(printersFile)) {
      try {
        const raw = fs.readFileSync(printersFile, 'utf-8');
        const printers = JSON.parse(raw);
        if (Array.isArray(printers)) {
          const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO printers (
              id, name, model, ip, location, category, share_name, driver_name,
              custom_tag, notes, is_decommissioned, decommission_reason,
              is_online, latency_ms, last_seen, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const p of printers) {
            insertStmt.run(
              p.id,
              p.name || 'Štampač',
              p.model || '',
              p.ip || '',
              p.location || 'UNIPROMET',
              p.category || 'Ostale Lokacije',
              p.shareName || '',
              p.driverName || '',
              p.customTag || 'U funkciji',
              p.notes || '',
              p.isDecommissioned ? 1 : 0,
              p.decommissionReason || null,
              p.isOnline ? 1 : 0,
              p.latencyMs ?? null,
              p.lastSeen || null,
              p.createdAt || new Date().toISOString(),
              p.updatedAt || new Date().toISOString()
            );
            stats.printers++;
          }
          // Backup file
          fs.copyFileSync(printersFile, path.join(BACKUP_DIR, `printers_${ts}.json`));
        }
      } catch (err) {
        console.error('Greška pri migraciji štampača:', err);
      }
    }

    // 4. Reports Migration
    const reportsFile = path.join(DATA_DIR, 'reports.json');
    const reportCount = (db.prepare('SELECT COUNT(*) as count FROM reports').get() as { count: number }).count;
    if (reportCount === 0 && fs.existsSync(reportsFile)) {
      try {
        const raw = fs.readFileSync(reportsFile, 'utf-8');
        const reports = JSON.parse(raw);
        if (Array.isArray(reports)) {
          const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO reports (
              id, title, month_year, created_at, device_count, online_count,
              total_impressions, excel_file_name, entries_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const rep of reports) {
            insertStmt.run(
              rep.id,
              rep.title || 'Izveštaj o potrošnji',
              rep.monthYear || '',
              rep.createdAt || new Date().toISOString(),
              rep.deviceCount || 0,
              rep.onlineCount || 0,
              rep.totalImpressionsAcrossFleet || 0,
              rep.excelFileName || '',
              rep.entries ? JSON.stringify(rep.entries) : '[]'
            );
            stats.reports++;
          }
          // Backup file
          fs.copyFileSync(reportsFile, path.join(BACKUP_DIR, `reports_${ts}.json`));
        }
      } catch (err) {
        console.error('Greška pri migraciji izveštaja:', err);
      }
    }
  });

  runMigration();
  console.log(`[SQLite Migration] Uspešno migrirano: ${stats.recorders} snimača, ${stats.cameras} kamera, ${stats.printers} štampača, ${stats.reports} izveštaja.`);
  return { migrated: true, stats };
}
