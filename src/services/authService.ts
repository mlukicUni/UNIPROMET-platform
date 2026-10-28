import crypto from 'crypto';
import express from 'express';
import { getDb } from '../db/sqlite';
import { fetchUserGroupsFromGraph } from './graphService';

export interface UserGroup {
  id: string;
  name: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  groups: UserGroup[];
  rawGroupIds: string[];
  isAdmin: boolean;
  isAuthorized: boolean;
  loggedInAt: string;
  lastAdSyncAt?: string;
}

export const REQUIRED_GROUP_NAME = 'ITadmin';

/**
 * Mejlovi koji su uvek Super admin (pored članstva u grupi ITadmin), npr. "mlukic@unipromet.rs,marko.lukic@unipromet.co.rs".
 * Podešava se u .env fajlu kao SUPER_ADMIN_EMAILS.
 */
function superAdminEmails(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Super admin je član grupe ITadmin ili korisnik čiji je mejl u SUPER_ADMIN_EMAILS.
 * Nema više provere po delu imena ili mejla (ranije: "lukic", "admin" u mejlu/imenu).
 */
export function isUserAuthorized(user: { groups?: UserGroup[]; email?: string } | null): boolean {
  if (!user) return false;

  const email = (user.email || '').toLowerCase().trim();
  if (email && superAdminEmails().includes(email)) return true;

  return (user.groups || []).some((g) => {
    const clean = (g.name || '').toLowerCase().replace(/[-_.\s]/g, '');
    return clean === 'itadmin';
  });
}

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || '062bb2bd-105f-4d7b-807e-d6a7e8ca5929';
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '627b08f1-19b9-46c9-8448-0bf4bf10c409';
// Tajne se NISU podrazumevano upisuju u kod: uzimaju se samo iz .env fajla
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET nije podešen u .env fajlu - server ne može bezbedno da potpisuje sesije.');
}

export const COOKIE_NAME = 'unipromet_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * Determines the proper redirect URI for the incoming request,
 * matching what is registered in Microsoft Entra ID.
 */
export function getRedirectUri(req: express.Request): string {
  const host = req.headers.host || 'localhost:3000';
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const isEncrypted = (req.socket as any).encrypted || req.headers['x-forwarded-proto'] === 'https';

  const protocol = isEncrypted || !isLocal ? 'https' : 'http';
  return `${protocol}://${host}/auth/callback`;
}

/**
 * Builds the Microsoft Entra ID OAuth 2.0 authorization URL.
 */
export function buildAuthorizeUrl(req: express.Request, state: string = 'login'): string {
  const redirectUri = getRedirectUri(req);
  const params = new URLSearchParams({
    client_id: AZURE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile email User.Read GroupMember.Read.All',
    state
  });

  return `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Decodes a JWT payload without verification (verification is implicitly done via TLS direct backchannel to Microsoft token endpoint).
 */
function decodeJwtPayload(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    console.error('[AuthService] Failed to decode JWT payload:', err);
    return null;
  }
}

/**
 * Exchanges authorization code for tokens and loads user & groups profile from Microsoft Entra / Graph API.
 */
export async function exchangeCodeForUser(code: string, redirectUri: string): Promise<SessionUser | null> {
  try {
    if (!AZURE_CLIENT_SECRET) {
      console.error('[AuthService] AZURE_CLIENT_SECRET nije podešen u .env fajlu');
      return null;
    }

    const tokenUrl = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;

    const bodyParams = new URLSearchParams({
      client_id: AZURE_CLIENT_ID,
      client_secret: AZURE_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: bodyParams.toString()
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[AuthService] Token exchange failed with status', tokenRes.status, errText);
      return null;
    }

    const tokenData = await tokenRes.json();
    const idToken = tokenData.id_token;
    const accessToken = tokenData.access_token;

    if (!idToken) {
      console.error('[AuthService] No id_token returned from Microsoft');
      return null;
    }

    const payload = decodeJwtPayload(idToken);
    if (!payload) {
      console.error('[AuthService] Unable to parse id_token payload');
      return null;
    }

    const userId = payload.oid || payload.sub || 'unknown';
    const userName = payload.name || payload.preferred_username || 'Korisnik';
    const userEmail = payload.preferred_username || payload.email || payload.upn || '';
    const rawGroupIds: string[] = Array.isArray(payload.groups) ? payload.groups : [];

    // Query Microsoft Graph API to resolve friendly group names (transitiveMemberOf includes nested groups)
    let groups: UserGroup[] = [];
    if (accessToken) {
      try {
        const graphRes = await fetch('https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$select=id,displayName', {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });

        if (graphRes.ok) {
          const graphData = await graphRes.json();
          if (Array.isArray(graphData.value)) {
            groups = graphData.value
              .filter((g: any) => g['@odata.type'] === '#microsoft.graph.group' && g.displayName)
              .map((g: any) => ({
                id: g.id,
                name: g.displayName
              }));
          }
        } else {
          console.warn('[AuthService] Graph API transitiveMemberOf returned status', graphRes.status, '- Falling back to token group IDs');
        }
      } catch (graphErr: any) {
        console.warn('[AuthService] Could not reach Microsoft Graph for group names:', graphErr?.message);
      }
    }

    // If Graph API didn't return groups but JWT had group IDs, include them
    if (groups.length === 0 && rawGroupIds.length > 0) {
      groups = rawGroupIds.map((id) => ({ id, name: `Grupa ${id.slice(0, 8)}...` }));
    }

    const authorized = isUserAuthorized({ groups, email: userEmail });

    const sessionUser: SessionUser = {
      id: userId,
      name: userName,
      email: userEmail,
      groups,
      rawGroupIds,
      isAdmin: authorized,
      isAuthorized: authorized,
      loggedInAt: new Date().toISOString(),
      lastAdSyncAt: new Date().toISOString()
    };

    console.log(`[AuthService] ✓ User authenticated: ${userName} (${userEmail}) | Super admin: ${authorized} | Groups: ${groups.map(g => g.name).join(', ') || 'none'}`);
    return sessionUser;
  } catch (err: any) {
    console.error('[AuthService] Authentication error:', err?.message || err);
    return null;
  }
}

/* ==========================================================================
   SESIJE - čuvaju se u SQLite bazi (preživljavaju restart servera).
   Cookie sadrži samo sid i rok, potpisane HMAC-om. Korisnik sa svim grupama
   je u bazi, pa nema skraćivanja grupa ni ponovnog računanja prava iz cookie-ja.
   ========================================================================== */
let sessionTableReady = false;

function sessionDb() {
  const db = getDb();
  if (!sessionTableReady) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        user_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
    `);
    sessionTableReady = true;
  }
  return db;
}

function saveSession(sid: string, user: SessionUser, expiresAt: number): void {
  sessionDb().prepare(`
    INSERT INTO sessions (sid, user_json, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET user_json = excluded.user_json, expires_at = excluded.expires_at
  `).run(sid, JSON.stringify(user), expiresAt);
}

function loadSession(sid: string): SessionUser | null {
  const db = sessionDb();
  const row = db.prepare('SELECT user_json, expires_at FROM sessions WHERE sid = ?').get(sid) as
    { user_json: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    return null;
  }
  try {
    return JSON.parse(row.user_json) as SessionUser;
  } catch {
    return null;
  }
}

// Čisti istekle sesije jednom na sat
setInterval(() => {
  try {
    sessionDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  } catch {}
}, 3600 * 1000).unref();

function signPayload(base64: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(base64).digest('hex');
}

/** Proverava potpis cookie-ja i vraća sid i rok, ili null */
function parseCookie(cookieValue?: string): { sid: string; exp: number } | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;

  const [base64, signature] = parts;
  const expectedSignature = signPayload(base64);

  // Constant-time comparison to prevent timing attacks
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(base64, 'base64url').toString('utf8'));
    if (typeof payload?.sid !== 'string' || typeof payload?.exp !== 'number') return null;
    return { sid: payload.sid, exp: payload.exp };
  } catch {
    return null;
  }
}

/**
 * Creates a signed session cookie. The full user (with all groups) is stored server-side.
 */
export function createSessionCookie(user: SessionUser): string {
  const sid = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  saveSession(sid, user, expiresAt);

  const base64 = Buffer.from(JSON.stringify({ sid, exp: expiresAt })).toString('base64url');
  return `${base64}.${signPayload(base64)}`;
}

/**
 * Destroys session from the database upon logout.
 */
export function destroySession(cookieValue?: string): void {
  const parsed = parseCookie(cookieValue);
  if (!parsed) return;
  sessionDb().prepare('DELETE FROM sessions WHERE sid = ?').run(parsed.sid);
}

/**
 * Verifies a session cookie and returns the stored user.
 * Super admin status is recomputed from the stored groups and current SUPER_ADMIN_EMAILS.
 */
export function verifySessionCookie(cookieValue?: string): SessionUser | null {
  const parsed = parseCookie(cookieValue);
  if (!parsed || parsed.exp < Date.now()) return null;

  const user = loadSession(parsed.sid);
  if (!user) return null;

  user.isAuthorized = isUserAuthorized(user);
  user.isAdmin = user.isAuthorized;
  return user;
}

/**
 * Extracts current logged-in user from request cookies.
 */
export function getCurrentUser(req: express.Request): SessionUser | null {
  const cookieValue = req.cookies?.[COOKIE_NAME];
  return verifySessionCookie(cookieValue);
}

/**
 * Refreshes user group memberships from Active Directory and recomputes roles/authorization.
 */
export async function refreshUserGroups(user: SessionUser): Promise<SessionUser> {
  const identifier = user.email || user.name || user.id;
  if (!identifier) return user;

  try {
    const graphGroups = await fetchUserGroupsFromGraph(user.email || user.id || identifier);
    if (graphGroups.length > 0) {
      const existingNames = new Set((user.groups || []).map((g) => g.name.toLowerCase()));
      const mergedGroups = [...(user.groups || [])];

      for (const group of graphGroups) {
        if (!existingNames.has(group.name.toLowerCase())) {
          mergedGroups.push(group);
          existingNames.add(group.name.toLowerCase());
        }
      }

      user.groups = mergedGroups;
      user.isAuthorized = isUserAuthorized(user);
      user.isAdmin = user.isAuthorized;
    }
  } catch (e: any) {
    console.warn('[AuthService] Refresh user groups failed:', e?.message || e);
  } finally {
    user.lastAdSyncAt = new Date().toISOString();
  }

  return user;
}

const syncInProgress = new Map<string, Promise<SessionUser>>();

/**
 * Retrieves current logged-in user and refreshes their groups from Active Directory
 * if last sync was > 30s ago or if forceRefresh is true.
 */
export async function getOrRefreshCurrentUser(req: express.Request, forceRefresh = false): Promise<SessionUser | null> {
  const user = getCurrentUser(req);
  if (!user) return null;

  const now = Date.now();
  const lastSync = user.lastAdSyncAt ? new Date(user.lastAdSyncAt).getTime() : 0;
  const isStale = (now - lastSync) > 30000; // 30s freshness window

  if (forceRefresh || isStale) {
    const syncKey = user.email || user.id;
    if (!syncInProgress.has(syncKey)) {
      const syncPromise = refreshUserGroups(user)
        .then((updated) => {
          // Keep the stored session up to date with the refreshed groups
          const parsed = parseCookie(req.cookies?.[COOKIE_NAME]);
          if (parsed) saveSession(parsed.sid, updated, parsed.exp);
          return updated;
        })
        .finally(() => {
          syncInProgress.delete(syncKey);
        });

      syncInProgress.set(syncKey, syncPromise);
    }

    if (forceRefresh) {
      await syncInProgress.get(syncKey);
    }
  }

  return user;
}
