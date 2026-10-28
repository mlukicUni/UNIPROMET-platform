import type { UserGroup } from './authService';

/**
 * Microsoft Graph pomoćne funkcije za članstvo i pretragu (zamena za lokalni Active Directory).
 * Token za aplikaciju (client credentials) koristi AZURE_CLIENT_SECRET iz .env fajla.
 * Dozvole: User.Read.All, Group.Read.All, GroupMember.Read.All (Application, uz admin consent).
 */

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getGraphAppToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60 * 1000) return cachedToken.value;

  const tenant = process.env.AZURE_TENANT_ID || '062bb2bd-105f-4d7b-807e-d6a7e8ca5929';
  const clientId = process.env.AZURE_CLIENT_ID || '627b08f1-19b9-46c9-8448-0bf4bf10c409';
  const clientSecret = process.env.AZURE_CLIENT_SECRET || '';
  if (!clientSecret) throw new Error('AZURE_CLIENT_SECRET nije podešen u .env fajlu');

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    }).toString()
  });
  if (!res.ok) throw new Error(`Graph token zahtev nije uspeo (HTTP ${res.status})`);

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return cachedToken.value;
}

/** GET nad Graph v1.0 putanjom (putanja mora biti već enkodirana gde treba). */
export async function graphGet<T>(path: string): Promise<T> {
  const token = await getGraphAppToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Graph ${res.status} za ${path.split('?')[0]}`);
  return (await res.json()) as T;
}

/** Sve grupe (bezbednosne i distribucione) u kojima je korisnik, uključujući ugnježdene. */
export async function fetchUserGroupsFromGraph(userIdOrUpn: string): Promise<UserGroup[]> {
  const target = (userIdOrUpn || '').trim();
  if (!target) return [];
  try {
    const data = await graphGet<{ value: { id: string; displayName?: string }[] }>(
      `/users/${encodeURIComponent(target)}/transitiveMemberOf/microsoft.graph.group?$select=id,displayName`
    );
    return data.value
      .filter((g) => g.displayName)
      .map((g) => ({ id: g.id, name: g.displayName as string }));
  } catch (err: any) {
    console.warn('[GraphService] Could not read group membership:', err?.message || err);
    return [];
  }
}
