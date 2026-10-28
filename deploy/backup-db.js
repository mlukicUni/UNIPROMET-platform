// Dnevni backup SQLite baze (poziva ga unipromet-backup.timer).
// Pravi konzistentnu kopiju dok aplikacija radi, proverava integritet i brise kopije starije od BACKUP_KEEP_DAYS (podrazumevano 14).
// Kopije: data/backups/daily/unipromet_YYYY-MM-DD_HHMM.db
process.env.TZ = process.env.TZ || 'Europe/Belgrade'; // ime fajla po lokalnom vremenu i kad se pokrene rucno
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'node_modules', 'dotenv')).config({ path: path.join(root, '.env'), quiet: true });
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'));

const src = path.join(root, 'data', 'unipromet.db');
const dir = path.join(root, 'data', 'backups', 'daily');
const keepDays = parseInt(process.env.BACKUP_KEEP_DAYS || '14', 10);

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
const out = path.join(dir, `unipromet_${stamp}.db`);

async function main() {
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(src, { readonly: true, fileMustExist: true });
  await db.backup(out);
  db.close();

  // Kopija nasledjuje WAL rezim; prebacujemo je u jedan samostalan fajl (bez -wal/-shm pored)
  const check = new Database(out);
  check.pragma('journal_mode = DELETE');
  const integrity = check.pragma('integrity_check', { simple: true });
  check.close();
  if (integrity !== 'ok') throw new Error(`integrity_check: ${integrity}`);
  console.log(`[backup] ${path.basename(out)} (${Math.round(fs.statSync(out).size / 1024)} KB) integrity ok`);

  const cutoff = Date.now() - keepDays * 24 * 3600 * 1000;
  for (const f of fs.readdirSync(dir)) {
    if (!/^unipromet_.*\.db$/.test(f)) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs < cutoff) {
      fs.unlinkSync(p);
      console.log(`[backup] obrisana stara kopija ${f}`);
    }
  }
}

main().catch((err) => {
  console.error('[backup] NIJE USPEO:', err.message);
  require('child_process').spawnSync(process.execPath, [
    path.join(__dirname, 'notify-deploy.js'), 'fail',
    `Dnevni backup baze nije uspeo: ${err.message}`, '[UNIPROMET Admin] Backup baze NIJE uspeo'
  ], { stdio: 'inherit', timeout: 15000 });
  process.exit(1);
});
