import path from 'path';
import fs from 'fs';
import selfsigned from 'selfsigned';
import { publicHost } from '../utils/appConfig';

interface SslCertificates {
  key: string;
  cert: string;
}

const SSL_DIR = path.resolve(process.cwd(), 'config', 'ssl');
const KEY_PATH = path.join(SSL_DIR, 'key.pem');
const CERT_PATH = path.join(SSL_DIR, 'cert.pem');

/**
 * Loads existing SSL certificates or automatically generates a persistent
 * local certificate for Unipromet intranet / LAN HTTPS.
 */
export async function getOrCreateSslCertificate(): Promise<SslCertificates> {
  try {
    if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
      const key = fs.readFileSync(KEY_PATH, 'utf8');
      const cert = fs.readFileSync(CERT_PATH, 'utf8');
      if (key && cert) {
        return { key, cert };
      }
    }
  } catch (err) {
    console.warn('[SSL] Failed to read existing certs, generating new ones...', err);
  }

  if (!fs.existsSync(SSL_DIR)) {
    fs.mkdirSync(SSL_DIR, { recursive: true });
  }

  console.log('[SSL] Generating persistent local SSL certificate for Unipromet HTTPS...');

  // CN = host iz PUBLIC_URL (.env). Postojeći sertifikat se ne menja; novi se pravi tek kad se config/ssl obriše.
  const attrs = [
    { name: 'commonName', value: publicHost() }
  ];

  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    notBeforeDate: new Date(Date.now() - 24 * 3600 * 1000),
    notAfterDate: new Date(Date.now() + 3650 * 24 * 3600 * 1000),
    algorithm: 'sha256'
  });

  fs.writeFileSync(KEY_PATH, pems.private, 'utf8');
  fs.writeFileSync(CERT_PATH, pems.cert, 'utf8');

  console.log('[SSL] ✓ Certificate saved to config/ssl/cert.pem');
  return {
    key: pems.private,
    cert: pems.cert
  };
}

export const generateSslCertificate = getOrCreateSslCertificate;
