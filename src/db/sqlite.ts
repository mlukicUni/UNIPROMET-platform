import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'unipromet.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

let dbInstance: Database.Database | null = null;

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
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
