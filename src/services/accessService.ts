import crypto from 'crypto';
import { getDb } from '../db/sqlite';
import {
  getAccessVersion,
  initRolesSchema,
  getAllAssignments,
  getRolePermissions,
  getAllCameraAccessRules,
  getCameraGroupMembersMap,
  getRole,
  getRoleCameraAccess,
  listRoles,
  RoleAssignment,
  CameraScope
} from '../db/rolesDb';
import {
  PERMISSION_CATALOG,
  PermissionLevel,
  getSectionOfItem,
  getItemsOfSection,
  getAllItemKeys,
  isItemKey,
  isExplicitOnlyItem,
  ROLES_TAB
} from './permissionCatalog';
import { SessionUser, UserGroup, isUserAuthorized } from './authService';
import { graphGet } from './graphService';

/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - EFEKTIVNA PRAVA (ROLE) I PRISTUP KAMERAMA
 * Korisnik dobija uniju svih rola koje ima, lično ili preko AD grupa.
 * Zabrane (deny) ne postoje - najviši nivo pobeđuje.
 * ==========================================================================
 */

export type Level = 'none' | PermissionLevel;
export type CameraKind = 'live' | 'playback';

interface AppliedRole {
  id: string;
  name: string;
  isSuperAdmin: boolean;
  via: 'user' | 'ad_group' | 'builtin';
  viaName: string;
}

interface PermDetail {
  roleName: string;
  key: string;
  level: PermissionLevel;
  actions: string[];
}

interface CamRuleDetail {
  roleName: string;
  scope: CameraScope;
  targetId: string;
  canLive: boolean;
  canPlayback: boolean;
}

export interface EffectiveAccess {
  isSuperAdmin: boolean;
  /** Član AD grupe DMS-Admins (a nije Super admin): u „Korisnici i role“ vidi i dodeljuje samo DMS role */
  isDmsRoleAdmin: boolean;
  hasAnyAccess: boolean;
  roles: AppliedRole[];
  perms: PermDetail[];
  camRules: CamRuleDetail[];
  grants: Map<string, { level: PermissionLevel; actions: Set<string> }>;
  allActions: Set<string>;
  groupMembers: Map<string, Set<string>>;
}

const norm = (s: string | undefined | null) => (s || '').trim().toLowerCase();

/** AD grupa čiji članovi dodeljuju DMS role (poređenje po imenu, bez obzira na velika/mala slova) */
export const DMS_ROLE_ADMIN_GROUP = 'DMS-Admins';

/** Stavka u rolama koja daje isto što i članstvo u DMS-Admins (upravljanje DMS rolama); ne nasleđuje se sa sekcije */
export const DMS_ROLE_ADMIN_ITEM = 'dms.role';

/** Sekcije u kojima nivo "Izmena" na celoj sekciji uključuje sve posebne akcije */
export const FULL_ACCESS_SECTIONS = new Set(['dms']);

const inDmsSection = (key: string) => key === 'dms' || key.startsWith('dms.');

/** Da li su sve dozvole (i posebne akcije) iz sekcije DMS */
export function permissionsAreDmsOnly(perms: { key: string; actions?: string[] }[]): boolean {
  return perms.every(p => inDmsSection(String(p?.key || '')) && (p.actions || []).every(a => inDmsSection(String(a))));
}

/**
 * DMS rola = obična (ne sistemska) rola bez ijedne dozvole van sekcije DMS i bez pristupa kamerama.
 * Nova prazna rola se računa kao DMS rola, da DMS administrator može da je napravi pa joj da dozvole.
 * Proverava se pri svakom zahtevu: ako Super admin roli doda nešto van DMS-a, DMS administrator je više ne vidi.
 */
export function isDmsOnlyRole(roleId: string): boolean {
  const role = getRole(roleId);
  if (!role || role.isSuperAdmin || role.isSystem) return false;
  if (!permissionsAreDmsOnly(getRolePermissions(role.id))) return false;
  return getRoleCameraAccess(role.id).length === 0;
}

function userMatches(a: RoleAssignment, user: { id?: string; email?: string }): boolean {
  const pid = norm(a.principalId);
  if (user.id && pid === norm(user.id)) return true;
  const email = norm(user.email);
  if (!email) return false;
  return pid === email || norm(a.email) === email;
}

/** Poklapanje grupe: prvenstveno po ID-ju; po imenu samo kada je format ID-ja drugačiji (npr. DN vs Entra GUID) */
function groupMatches(a: RoleAssignment, groups: UserGroup[]): boolean {
  const pid = norm(a.principalId);
  const name = norm(a.displayName);
  return groups.some(g => norm(g.id) === pid || (!!name && norm(g.name) === name));
}

const levelRank = (l: Level) => (l === 'edit' ? 2 : l === 'view' ? 1 : 0);

/* ==========================================================================
   COMPUTE
   ========================================================================== */
export function computeAccess(user: { id?: string; name?: string; email?: string; groups?: UserGroup[] }): EffectiveAccess {
  initRolesSchema();
  const groups = user.groups || [];

  const roles: AppliedRole[] = [];
  const roleIds = new Set<string>();

  // Ugrađeno pravilo (ITadmin / IT administrator) - ostaje Super admin kao i do sada
  const builtinSuper = isUserAuthorized({ groups, email: user.email });
  if (builtinSuper) {
    roles.push({ id: 'builtin', name: 'Super admin', isSuperAdmin: true, via: 'builtin', viaName: 'ITadmin / IT administrator' });
  }

  const roleList = listRoles();
  const roleById = new Map(roleList.map(r => [r.id, r]));

  for (const a of getAllAssignments()) {
    const role = roleById.get(a.roleId);
    if (!role) continue;
    let matched = false;
    if (a.principalType === 'user') matched = userMatches(a, user);
    else matched = groupMatches(a, groups);
    if (matched && !roleIds.has(role.id)) {
      roleIds.add(role.id);
      roles.push({
        id: role.id,
        name: role.name,
        isSuperAdmin: role.isSuperAdmin,
        via: a.principalType,
        viaName: a.displayName || a.principalId
      });
    }
  }

  const isSuperAdmin = roles.some(r => r.isSuperAdmin);

  const perms: PermDetail[] = [];
  const camRules: CamRuleDetail[] = [];
  const allRules = getAllCameraAccessRules();
  for (const r of roles) {
    if (r.id === 'builtin') continue;
    for (const p of getRolePermissions(r.id)) {
      perms.push({ roleName: r.name, key: p.key, level: p.level, actions: p.actions });
    }
    for (const c of allRules.filter(x => x.roleId === r.id)) {
      camRules.push({ roleName: r.name, scope: c.scope, targetId: c.targetId, canLive: c.canLive, canPlayback: c.canPlayback });
    }
  }

  const grants = new Map<string, { level: PermissionLevel; actions: Set<string> }>();
  const allActions = new Set<string>();
  for (const p of perms) {
    const cur = grants.get(p.key);
    if (!cur) {
      grants.set(p.key, { level: p.level, actions: new Set(p.actions) });
    } else {
      if (levelRank(p.level) > levelRank(cur.level)) cur.level = p.level;
      p.actions.forEach(a => cur.actions.add(a));
    }
    p.actions.forEach(a => allActions.add(a));
  }

  // DMS: nivo "Izmena" na celoj sekciji znači punu kontrolu, pa uključuje i sve posebne akcije sekcije
  // (učitavanje izveštaja, slanje mejlova, slanje podsetnika) bez posebnog štikliranja
  for (const sec of PERMISSION_CATALOG.filter(x => FULL_ACCESS_SECTIONS.has(x.key))) {
    if (levelRank(grants.get(sec.key)?.level || 'none') < levelRank('edit')) continue;
    for (const item of sec.items) for (const act of item.actions) allActions.add(`${item.key}:${act.key}`);
  }

  // Upravljanje DMS rolama: članstvo u AD grupi DMS-Admins ili stavka „Upravljanje DMS rolama“ u nekoj roli
  // (samo izričito podešena na stavci; nivo cele DMS sekcije je ne uključuje)
  const isDmsRoleAdmin = !isSuperAdmin && (
    groups.some(g => norm(g.name) === norm(DMS_ROLE_ADMIN_GROUP)) || grants.has(DMS_ROLE_ADMIN_ITEM)
  );

  const groupIds = [...new Set(camRules.filter(c => c.scope === 'group').map(c => c.targetId))];
  const groupMembers = getCameraGroupMembersMap(groupIds);

  return {
    isSuperAdmin,
    isDmsRoleAdmin,
    // DMS administrator bez ijedne role i dalje ulazi na platformu (stranica „Korisnici i role“)
    hasAnyAccess: isSuperAdmin || isDmsRoleAdmin || grants.size > 0,
    roles,
    perms,
    camRules,
    grants,
    allActions,
    groupMembers
  };
}

/* ==========================================================================
   CACHE (poništava se pri svakoj izmeni rola/dodela/grupa i posle 60 s)
   ========================================================================== */
interface CacheEntry {
  version: number;
  expires: number;
  access: EffectiveAccess;
}
const accessCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

function cacheKey(user: { id?: string; email?: string; name?: string; groups?: UserGroup[] }): string {
  const sig = (user.groups || []).map(g => `${g.id}|${g.name}`).sort().join(';');
  const hash = crypto.createHash('sha1').update(sig).digest('hex');
  return `${user.id || ''}|${norm(user.email)}|${hash}`;
}

export function getAccess(user: SessionUser | { id?: string; name?: string; email?: string; groups?: UserGroup[] }): EffectiveAccess {
  const key = cacheKey(user);
  const version = getAccessVersion();
  const now = Date.now();
  const hit = accessCache.get(key);
  if (hit && hit.version === version && hit.expires > now) return hit.access;

  const access = computeAccess(user);
  accessCache.set(key, { version, expires: now + CACHE_TTL_MS, access });
  if (accessCache.size > 500) {
    for (const [k, v] of accessCache.entries()) {
      if (v.expires <= now) accessCache.delete(k);
    }
  }
  return access;
}

/** Da li korisnik sme uopšte da koristi platformu (Super admin ili makar jedna dozvola) */
export function isUserAllowed(user: SessionUser | null): boolean {
  if (!user) return false;
  return getAccess(user).hasAnyAccess;
}

/* ==========================================================================
   PAGE / ACTION CHECKS
   ========================================================================== */
export function levelFor(access: EffectiveAccess, itemKey: string): Level {
  if (access.isSuperAdmin) return 'edit';
  const own = access.grants.get(itemKey)?.level;
  if (isExplicitOnlyItem(itemKey)) return own || 'none'; // posebno pravo, bez nasleđivanja sa sekcije
  const sectionKey = getSectionOfItem(itemKey) || (PERMISSION_CATALOG.some(s => s.key === itemKey) ? itemKey : '');
  const inherited = sectionKey ? access.grants.get(sectionKey)?.level : undefined;
  const best = levelRank(own || 'none') >= levelRank(inherited || 'none') ? own : inherited;
  return best || 'none';
}

/** Da li korisnik ima makar `min` nivo na bilo kojoj podsekciji sekcije (ili na sekciji) */
export function hasSectionAccess(access: EffectiveAccess, sectionKey: string, min: PermissionLevel = 'view'): boolean {
  if (access.isSuperAdmin) return true;
  if (levelRank(access.grants.get(sectionKey)?.level || 'none') >= levelRank(min)) return true;
  // Posebna prava (npr. Upravljanje DMS rolama) ne otvaraju stranice sekcije
  return getItemsOfSection(sectionKey).some(i => !i.explicitOnly && levelRank(levelFor(access, i.key)) >= levelRank(min));
}

/** Podsekcija ili sekcija - ključ bilo kog tipa */
export function hasLevel(access: EffectiveAccess, key: string, min: PermissionLevel): boolean {
  if (access.isSuperAdmin) return true;
  if (isItemKey(key)) return levelRank(levelFor(access, key)) >= levelRank(min);
  return hasSectionAccess(access, key, min);
}

/** Posebna akcija se mora izričito dodeliti i traži bar pregled podsekcije */
export function hasAction(access: EffectiveAccess, fullActionKey: string): boolean {
  if (access.isSuperAdmin) return true;
  const itemKey = fullActionKey.split(':')[0];
  return levelFor(access, itemKey) !== 'none' && access.allActions.has(fullActionKey);
}

/* ==========================================================================
   CAMERA ACCESS
   ========================================================================== */
export interface CameraRef {
  id: string;
  recorderId?: string | null;
}

export function cameraRights(access: EffectiveAccess, cam: CameraRef | null): { live: boolean; playback: boolean } {
  if (access.isSuperAdmin) return { live: true, playback: true };
  let live = false;
  let playback = false;
  for (const r of access.camRules) {
    let match = false;
    if (r.scope === 'all') match = true;
    else if (!cam) match = false;
    else if (r.scope === 'recorder') match = !!cam.recorderId && cam.recorderId === r.targetId;
    else if (r.scope === 'camera') match = cam.id === r.targetId;
    else if (r.scope === 'group') match = access.groupMembers.get(r.targetId)?.has(cam.id) === true;
    if (match) {
      live = live || r.canLive;
      playback = playback || r.canPlayback;
      if (live && playback) break;
    }
  }
  return { live, playback };
}

export function canAccessCamera(access: EffectiveAccess, cam: CameraRef | null, kind: CameraKind): boolean {
  const rights = cameraRights(access, cam);
  return kind === 'live' ? rights.live : rights.playback;
}

export function lookupCameraByIp(ip: string): CameraRef | null {
  const row = getDb().prepare('SELECT id, recorder_id FROM cameras WHERE ip = ?').get((ip || '').trim()) as
    { id: string; recorder_id: string | null } | undefined;
  return row ? { id: row.id, recorderId: row.recorder_id } : null;
}

export function lookupCameraById(id: string): CameraRef | null {
  const row = getDb().prepare('SELECT id, recorder_id FROM cameras WHERE id = ?').get(id) as
    { id: string; recorder_id: string | null } | undefined;
  return row ? { id: row.id, recorderId: row.recorder_id } : null;
}

/** Kamera IP -> pristup po IP adresi (nepoznata IP adresa = samo pravila 'sve kamere') */
export function canAccessCameraIp(access: EffectiveAccess, ip: string, kind: CameraKind): boolean {
  if (access.isSuperAdmin) return true;
  return canAccessCamera(access, lookupCameraByIp(ip), kind);
}

/** Da li korisnik ima bilo koje pravo nad bar jednom kamerom (za otvaranje video stranica) */
export function hasAnyCameraRights(access: EffectiveAccess): boolean {
  return access.isSuperAdmin || access.camRules.some(r => r.canLive || r.canPlayback);
}

function allCamerasRef(): (CameraRef & { ip: string })[] {
  const rows = getDb().prepare('SELECT id, ip, recorder_id FROM cameras').all() as { id: string; ip: string; recorder_id: string | null }[];
  return rows.map(r => ({ id: r.id, ip: r.ip, recorderId: r.recorder_id }));
}

/** ID-jevi snimača koji imaju bar jednu kameru dostupnu korisniku (null = svi, Super admin) */
export function accessibleRecorderIds(access: EffectiveAccess): Set<string> | null {
  if (access.isSuperAdmin) return null;
  const ids = new Set<string>();
  for (const ref of allCamerasRef()) {
    const rights = cameraRights(access, ref);
    if ((rights.live || rights.playback) && ref.recorderId) ids.add(ref.recorderId);
  }
  return ids;
}

/** ID-jevi kamera za koje korisnik ima pravo "uživo" (null = sve kamere, Super admin) */
export function liveCameraIdSet(access: EffectiveAccess): Set<string> | null {
  if (access.isSuperAdmin) return null;
  const ids = new Set<string>();
  for (const ref of allCamerasRef()) {
    if (cameraRights(access, ref).live) ids.add(ref.id);
  }
  return ids;
}

/** Filtrira listu kamera (po `id` ili `ip`) na one koje korisnik sme da vidi (uživo ILI snimci) */
export function filterCamerasByAccess<T extends { id?: string; ip?: string }>(access: EffectiveAccess, cameras: T[]): T[] {
  if (access.isSuperAdmin) return cameras;
  const refs = allCamerasRef();
  const byId = new Map(refs.map(r => [r.id, r]));
  const byIp = new Map(refs.map(r => [r.ip, r]));
  return cameras.filter(c => {
    const ref = (c.id && byId.get(c.id)) || (c.ip && byIp.get(c.ip)) || null;
    const rights = cameraRights(access, ref);
    return rights.live || rights.playback;
  });
}

/* ==========================================================================
   CLIENT SUMMARY (za /api/auth/me)
   ========================================================================== */
export interface ClientAccess {
  isSuperAdmin: boolean;
  roles: string[];
  items: Record<string, Level>;
  sections: Record<string, boolean>;
  actions: string[];
  canManageRoles: boolean;
  /** 'all' = Super admin (sve role), 'dms' = DMS-Admins (samo dodela DMS rola), 'none' */
  rolesScope: 'all' | 'dms' | 'none';
  cameras: {
    all: { live: boolean; playback: boolean };
    byId: Record<string, { live: boolean; playback: boolean }>;
    byIp: Record<string, { live: boolean; playback: boolean }>;
  };
}

export function buildClientAccess(access: EffectiveAccess): ClientAccess {
  const items: Record<string, Level> = {};
  for (const key of getAllItemKeys()) items[key] = levelFor(access, key);

  const sections: Record<string, boolean> = {};
  for (const s of PERMISSION_CATALOG) sections[s.key] = hasSectionAccess(access, s.key, 'view');

  const byId: Record<string, { live: boolean; playback: boolean }> = {};
  const byIp: Record<string, { live: boolean; playback: boolean }> = {};
  let all = { live: access.isSuperAdmin, playback: access.isSuperAdmin };
  if (!access.isSuperAdmin) {
    const allRule = access.camRules.filter(r => r.scope === 'all');
    all = { live: allRule.some(r => r.canLive), playback: allRule.some(r => r.canPlayback) };
    for (const ref of allCamerasRef()) {
      const rights = cameraRights(access, ref);
      if (rights.live || rights.playback) {
        byId[ref.id] = rights;
        byIp[ref.ip] = rights;
      }
    }
  }

  return {
    isSuperAdmin: access.isSuperAdmin,
    roles: access.roles.map(r => r.name),
    items,
    sections,
    actions: access.isSuperAdmin ? ['*'] : [...access.allActions],
    canManageRoles: access.isSuperAdmin || access.isDmsRoleAdmin,
    rolesScope: access.isSuperAdmin ? 'all' : access.isDmsRoleAdmin ? 'dms' : 'none',
    cameras: { all, byId, byIp }
  };
}

/* ==========================================================================
   OBJAŠNJENJE PRAVA ("Proveri korisnika")
   ========================================================================== */
export function describeAccess(access: EffectiveAccess) {
  const pages: { section: string; sectionLabel: string; key: string; label: string; tab: string; level: Level; sources: string[]; actions: string[] }[] = [];
  for (const s of PERMISSION_CATALOG) {
    for (const item of s.items) {
      const level = levelFor(access, item.key);
      const sources = access.isSuperAdmin
        ? access.roles.filter(r => r.isSuperAdmin).map(r => r.name)
        : access.perms
            .filter(p => (p.key === item.key || p.key === s.key) && levelRank(p.level) > 0)
            .map(p => `${p.roleName}${p.key === s.key ? ' (cela sekcija)' : ''}`);
      const actions = item.actions
        .map(a => `${item.key}:${a.key}`)
        .filter(k => hasAction(access, k));
      pages.push({
        section: s.key, sectionLabel: s.label, key: item.key, label: item.label, tab: item.tab,
        level, sources: [...new Set(sources)], actions
      });
    }
  }

  const camRows = getDb().prepare('SELECT id, name, ip, position, recorder, recorder_id FROM cameras ORDER BY recorder, name').all() as
    { id: string; name: string; ip: string; position: string | null; recorder: string | null; recorder_id: string | null }[];
  const cameras: { id: string; name: string; ip: string; position: string; recorder: string; live: boolean; playback: boolean; sources: string[] }[] = [];
  for (const c of camRows) {
    const ref = { id: c.id, recorderId: c.recorder_id };
    const rights = cameraRights(access, ref);
    if (!rights.live && !rights.playback) continue;
    const sources = access.isSuperAdmin
      ? ['Super admin']
      : access.camRules.filter(r => {
          if (r.scope === 'all') return true;
          if (r.scope === 'recorder') return r.targetId === c.recorder_id;
          if (r.scope === 'camera') return r.targetId === c.id;
          if (r.scope === 'group') return access.groupMembers.get(r.targetId)?.has(c.id) === true;
          return false;
        }).map(r => r.roleName);
    cameras.push({
      id: c.id, name: c.name, ip: c.ip, position: c.position || '', recorder: c.recorder || '',
      live: rights.live, playback: rights.playback, sources: [...new Set(sources)]
    });
  }

  return {
    isSuperAdmin: access.isSuperAdmin,
    roles: access.roles,
    pages,
    cameras,
    totalCameras: camRows.length
  };
}

/* ==========================================================================
   PRETRAGA KORISNIKA I GRUPA (Microsoft Graph / Entra ID)
   ========================================================================== */
export interface AdPrincipal {
  type: 'user' | 'ad_group';
  id: string;
  name: string;
  email: string;
  description: string;
}

/** Apostrof u Graph $filter vrednosti se duplira, a ulaz se čisti od specijalnih znakova. */
function graphFilterValue(query: string): string {
  return (query || '').replace(/[^\p{L}\p{N} ._@-]/gu, '').trim().slice(0, 60).replace(/'/g, "''");
}

export async function searchAdPrincipals(kind: 'user' | 'ad_group', query: string): Promise<AdPrincipal[]> {
  const q = graphFilterValue(query);
  if (q.length < 2) return [];

  if (kind === 'user') {
    const filter = `startswith(displayName,'${q}') or startswith(userPrincipalName,'${q}') or startswith(mail,'${q}')`;
    const data = await graphGet<{ value: { id: string; displayName?: string; userPrincipalName?: string; mail?: string }[] }>(
      `/users?$filter=${encodeURIComponent(filter)}&$select=id,displayName,userPrincipalName,mail&$top=25`
    );
    return data.value.map(u => {
      const email = (u.userPrincipalName || u.mail || '').toLowerCase();
      return { type: 'user' as const, id: email || u.id, name: u.displayName || email, email, description: u.userPrincipalName || '' };
    }).filter(p => p.id);
  }

  const filter = `startswith(displayName,'${q}')`;
  const data = await graphGet<{ value: { id: string; displayName?: string; mailEnabled?: boolean; securityEnabled?: boolean }[] }>(
    `/groups?$filter=${encodeURIComponent(filter)}&$select=id,displayName,securityEnabled,mailEnabled&$top=25`
  );
  return data.value.map(g => ({
    type: 'ad_group' as const,
    id: g.id,
    name: g.displayName || g.id,
    email: '',
    description: g.securityEnabled ? 'Bezbednosna grupa' : 'Distribuciona grupa'
  })).filter(p => p.name);
}

export { ROLES_TAB };
