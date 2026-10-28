/**
 * Podešavanja koja se razlikuju po mašini (dev na Windows-u, produkcija na Linux serveru).
 * Sve se čita iz .env. Podrazumevane vrednosti zadržavaju ponašanje od pre uvođenja ovih ključeva.
 *
 *   PUBLIC_URL           adresa portala u mejlovima i CN sertifikata
 *   SCHEDULER_ENABLED    zakazane provere i mejlovi (false na dev-u)
 *   LEGACY_SYNC_ENABLED  dvosmerna sinhronizacija sa 192.168.121.20 (false na dev-u)
 *   MAIL_REDIRECT_TO     ako je podešen, svaki mejl ide samo na ovu adresu (dev)
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

/** Adresa na koju se preusmeravaju svi mejlovi (dev), ili prazno */
export function mailRedirectTo(): string {
  return (process.env.MAIL_REDIRECT_TO || '').trim();
}
