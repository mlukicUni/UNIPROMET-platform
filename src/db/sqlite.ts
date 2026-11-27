import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { normSearchText } from '../utils/searchMatch';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'unipromet.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

let dbInstance: Database.Database | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;

/**
 * Ensures the data directory exists and returns the singleton SQLite database instance.
 * Enables WAL mode (Write-Ahead Logging) and Foreign Keys.
 */
export function getDb(): Database.Database {
  if (!dbInstance) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    dbInstance = new Database(DB_PATH);
    // Performance and safety pragmas
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.pragma('synchronous = NORMAL');
    dbInstance.pragma('cache_size = -32768');      // ~32 MB keša stranica (podrazumevano ~2 MB); baza je mala, pa staje cela
    dbInstance.pragma('temp_store = MEMORY');      // privremene tabele/sortiranja u memoriji
    dbInstance.pragma('mmap_size = 134217728');    // čitanje preko memorijskog mapiranja (do 128 MB)
    dbInstance.pragma('journal_size_limit = 16777216'); // WAL fajl se posle kontrolne tačke skuplja na najviše 16 MB
    // Povremeno vraćanje WAL fajla na malu veličinu i ažuriranje statistike za planer upita
    maintenanceTimer = setInterval(() => {
      try {
        dbInstance?.pragma('wal_checkpoint(TRUNCATE)');
        dbInstance?.pragma('optimize');
      } catch { /* baza je zauzeta ili zatvorena: pokušaće se ponovo sledeći put */ }
    }, 6 * 60 * 60 * 1000);
    maintenanceTimer.unref();
    // Pretraga bez razlike u kvačicama i velikim slovima (src/utils/searchMatch.ts → sqlSearch)
    dbInstance.function('unorm', { deterministic: true }, (v: unknown) => normSearchText(v));
  }
  return dbInstance;
}

/**
 * Pripremljena naredba, pamti se po tekstu upita (po otvorenoj vezi). Za upite koji se izvršavaju pri svakom
 * zahtevu (sesija, provera prava, kamere): kompajliranje SQL-a se plaća jednom, a ne svaki put.
 * Samo za naredbe koje se izvršavaju do kraja (get/run/all), ne za iteratore.
 */
const preparedCache = new Map<string, Database.Statement>();
export function prepCached(sql: string): Database.Statement {
  const db = getDb();
  let stmt = preparedCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    preparedCache.set(sql, stmt);
  }
  return stmt;
}

export function closeDb(): void {
  preparedCache.clear();
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
