// Mejl o rezultatu automatskog azuriranja i backup-a (pozivaju ga deploy/update.sh i deploy/backup-db.js).
// Primalac: DEPLOY_NOTIFY_TO u .env (prazno = bez mejla). Upotreba: node notify-deploy.js ok|fail "poruka" ["naslov"]
const path = require('path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'node_modules', 'dotenv')).config({ path: path.join(root, '.env'), quiet: true });
const nodemailer = require(path.join(root, 'node_modules', 'nodemailer'));

const to = (process.env.DEPLOY_NOTIFY_TO || '').trim();
const [status, message, subject] = process.argv.slice(2);
// Ishod slanja se ispisuje (update.sh ga upisuje u deploy.log), da se vidi da li je mejl otišao
if (!message) process.exit(0);
if (!to) {
  console.log('[notify-deploy] mejl nije poslat: DEPLOY_NOTIFY_TO nije podešen u .env');
  process.exit(0);
}

let version = '';
try { version = require(path.join(root, 'package.json')).version || ''; } catch (e) { /* bez verzije */ }

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '192.168.121.1',
  port: parseInt(process.env.SMTP_PORT || '25', 10),
  secure: false,
  connectionTimeout: 5000,
  tls: { rejectUnauthorized: false }
});

transport.sendMail({
  from: '"UNIPROMET IT Služba" <it@unipromet.co.rs>',
  to,
  subject: subject || (status === 'ok' ? '[UNIPROMET Admin] Server ažuriran' : '[UNIPROMET Admin] Ažuriranje NIJE uspelo'),
  text: `${message}\n\n${version ? `Verzija platforme na serveru: ${version}\n` : ''}Server: ${process.env.PUBLIC_URL || ''}\n`
}).then((info) => {
  console.log(`[notify-deploy] mejl poslat na ${to} preko ${process.env.SMTP_HOST || '192.168.121.1'} (${info.response || 'bez odgovora'}; ${info.messageId || ''})`);
  process.exit(0);
}).catch((err) => {
  console.error('[notify-deploy] mejl nije poslat:', err.message);
  process.exit(0);
});
