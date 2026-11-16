/**
 * Podešavanja koja se razlikuju po mašini (dev na Windows-u, produkcija na Linux serveru).
 * Sve se čita iz .env. Podrazumevane vrednosti zadržavaju ponašanje od pre uvođenja ovih ključeva.
 *
 *   PUBLIC_URL           adresa portala u mejlovima i CN sertifikata
 *   SCHEDULER_ENABLED    zakazane provere i mejlovi (false na dev-u)
 *   LEGACY_SYNC_ENABLED  dvosmerna sinhronizacija sa 192.168.121.20 (false na dev-u)
 *   MAIL_REDIRECT_TO     ako je podešen, svaki mejl ide samo na ovu adresu (dev)
 *
 * Sinhronizacija evidencije kamera između servera (Mreža → Kamere):
 *   INSTANCE_ROLE            production | dev (ako nije podešeno: dev kada je SCHEDULER_ENABLED=false, inače production)
 *   SYNC_PEER_URL            adresa drugog servera, npr. https://192.168.120.98:3000
 *   SYNC_API_TOKEN           zajednička tajna, ista na oba servera (bez nje izvoz ne postoji)
 *   SYNC_PEER_INSECURE_TLS   true = ne proverava sertifikat drugog servera (samozapisani sertifikat)
 */

const DEFAULT_PUBLIC_URL = 'http://192.168.120.98:3000';

/** Adresa portala bez završne kose crte, npr. https://192.168.121.26:3000 */
export function publicUrl(): string {
  return (process.env.PUBLIC_URL || DEFAULT_PUBLIC_URL).trim().replace(/\/+$/, '');
}

/** Samo host iz PUBLIC_URL (IP ili DNS ime), za prikaz i sertifikat */
export function publicHost(): string {
  try {
    return new URL(publicUrl()).hostname;
  } catch {
    return new URL(DEFAULT_PUBLIC_URL).hostname;
  }
}

/** Prekidač iz .env: prazno znači podrazumevano; false/0/no/off isključuje */
export function isEnabled(name: string, defaultValue = true): boolean {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return !['false', '0', 'no', 'off'].includes(raw);
}

export type InstanceRole = 'production' | 'dev';

/** Uloga ovog servera u sinhronizaciji kamera */
export function instanceRole(): InstanceRole {
  const raw = (process.env.INSTANCE_ROLE || '').trim().toLowerCase();
  if (raw === 'production' || raw === 'prod' || raw === 'main') return 'production';
  if (raw === 'dev' || raw === 'development') return 'dev';
  return isEnabled('SCHEDULER_ENABLED', true) ? 'production' : 'dev';
}

export function syncPeerUrl(): string {
  return (process.env.SYNC_PEER_URL || '').trim().replace(/\/+$/, '');
}

export function syncApiToken(): string {
  return (process.env.SYNC_API_TOKEN || '').trim();
}

export function syncPeerInsecureTls(): boolean {
  return isEnabled('SYNC_PEER_INSECURE_TLS', false);
}

/** Adresa na koju se preusmeravaju svi mejlovi (dev), ili prazno */
export function mailRedirectTo(): string {
  return (process.env.MAIL_REDIRECT_TO || '').trim();
}
