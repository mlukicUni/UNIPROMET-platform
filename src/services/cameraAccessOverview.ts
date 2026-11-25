import { getDb } from '../db/sqlite';
import {
  initRolesSchema,
  listRoles,
  getAllAssignments,
  getAllCameraAccessRules,
  listKnownUsers,
  RoleAssignment
} from '../db/rolesDb';
import { cameraRights, computeAccess, EffectiveAccess } from './accessService';

/**
 * ==========================================================================
 * PREGLED DOZVOLA ZA PRISTUP KAMERAMA (VIDEO NADZOR → Dozvole za pristup)
 * Tri pogleda na iste podatke: po rolama, po korisnicima i po kamerama.
 * Korisnici iz AD grupa poznati su samo ako su se bar jednom prijavili na platformu
 * (grupe se pamte pri prijavi), pa se samo oni navode kao članovi AD grupe.
 * ==========================================================================
 */

export interface OvCamera {
  id: string;
  name: string;
  ip: string;
  position: string;
  location: string;
  recorder: string;
  type: string;
}

interface Rights { live: boolean; playback: boolean }
export interface OvCamRight extends Rights { id: string }
export interface OvUserCamRight extends OvCamRight { roles: string[] }

export interface OvRole {
  id: string;
  name: string;
  description: string;
  scope: string[];
  users: { name: string; email: string }[];
  groups: { name: string }[];
  groupMembers: { name: string; email: string; group: string }[];
  liveCount: number;
  playbackCount: number;
  cameras: OvCamRight[];
  /** Ugrađena „rola“ Super admin: vide sve kamere (uživo i snimci) */
  superAdmin?: boolean;
}

export interface OvUser {
  key: string;
  name: string;
  email: string;
  lastLoginAt: string;
  loggedIn: boolean;
  superAdmin: boolean;
  roles: { id: string; name: string; via: string[] }[];
  liveCount: number;
  playbackCount: number;
  /** Super admin vidi sve kamere; za njega se pojedinačna lista ne vodi */
  allCameras: boolean;
  cameras: OvUserCamRight[];
}

export interface OvCameraRow extends OvCamera {
  roles: { id: string; name: string; live: boolean; playback: boolean; superAdmin?: boolean }[];
  adGroups: string[];
  users: { name: string; email: string; live: boolean; playback: boolean; superAdmin?: boolean; roles?: string[] }[];
}

export interface CameraOverview {
  generatedAt: string;
  cameras: OvCamera[];
  roles: OvRole[];
  users: OvUser[];
  cameraRows: OvCameraRow[];
  superAdmins: { name: string; email: string }[];
}

const norm = (s: string | undefined | null) => (s || '').trim().toLowerCase();

/** Isto pravilo kao u accessService: grupa se poklapa po ID-ju, a po imenu kada je format ID-ja drugačiji */
function groupMatches(a: RoleAssignment, groups: { id: string; name: string }[]): boolean {
  const pid = norm(a.principalId);
  const name = norm(a.displayName);
  return groups.some(g => norm(g.id) === pid || (!!name && norm(g.name) === name));
}

export function buildOverview(): CameraOverview {
  initRolesSchema();
  const db = getDb();

  const cameras = db.prepare(`
    SELECT id, name, ip, COALESCE(position, '') AS position, COALESCE(location, '') AS location,
           COALESCE(recorder, '') AS recorder, recorder_id AS recorderId, COALESCE(type, '') AS type
    FROM cameras WHERE COALESCE(is_reserved, 0) = 0
    ORDER BY location COLLATE NOCASE, recorder COLLATE NOCASE, name COLLATE NOCASE
  `).all() as (OvCamera & { recorderId: string | null })[];
  const camById = new Map(cameras.map(c => [c.id, c]));
  const recorderNames = new Map(
    (db.prepare('SELECT id, name FROM recorders').all() as { id: string; name: string }[]).map(r => [r.id, r.name])
  );

  const camRoles = listRoles('camera');
  const allRules = getAllCameraAccessRules();
  const assignments = getAllAssignments();
  const known = listKnownUsers();

  /* ---------- Role ---------- */
  const roleRights = new Map<string, Map<string, Rights>>();
  const roleAssign = new Map<string, RoleAssignment[]>();
  for (const a of assignments) {
    if (!roleAssign.has(a.roleId)) roleAssign.set(a.roleId, []);
    roleAssign.get(a.roleId)!.push(a);
  }

  const roles: OvRole[] = camRoles.map(role => {
    const rules = allRules.filter(r => r.roleId === role.id);
    const camRules = rules.map(r => ({ roleName: role.name, scope: r.scope, targetId: r.targetId, canLive: r.canLive, canPlayback: r.canPlayback }));
    const fake = { isSuperAdmin: false, camRules, groupMembers: new Map() } as unknown as EffectiveAccess;
    const rights = new Map<string, Rights>();
    for (const c of cameras) {
      const r = cameraRights(fake, { id: c.id, recorderId: c.recorderId });
      if (r.live || r.playback) rights.set(c.id, { live: r.live, playback: r.playback });
    }
    roleRights.set(role.id, rights);

    const scope: string[] = [];
    const flag = (live: boolean, pb: boolean) => (live && pb ? 'uživo i snimci' : live ? 'samo uživo' : 'samo snimci');
    const allRule = rules.find(r => r.scope === 'all');
    if (allRule) scope.push(`Sve kamere (${flag(allRule.canLive, allRule.canPlayback)})`);
    for (const r of rules.filter(x => x.scope === 'recorder')) {
      scope.push(`Snimač ${recorderNames.get(r.targetId) || r.targetId} (${flag(r.canLive, r.canPlayback)})`);
    }
    const single = rules.filter(x => x.scope === 'camera').length;
    if (single) scope.push(`${single} ${single === 1 ? 'pojedinačna kamera' : 'pojedinačnih kamera'}`);

    const list = roleAssign.get(role.id) || [];
    const users = list.filter(a => a.principalType === 'user').map(a => ({ name: a.displayName || a.principalId, email: a.email || a.principalId }));
    const groups = list.filter(a => a.principalType === 'ad_group').map(a => ({ name: a.displayName || a.principalId }));
    const groupMembers: { name: string; email: string; group: string }[] = [];
    for (const a of list.filter(x => x.principalType === 'ad_group')) {
      for (const k of known) {
        if (groupMatches(a, k.groups)) groupMembers.push({ name: k.name || k.email, email: k.email, group: a.displayName || a.principalId });
      }
    }

    const camList: OvCamRight[] = [...rights.entries()].map(([id, r]) => ({ id, live: r.live, playback: r.playback }));
    return {
      id: role.id,
      name: role.name,
      description: role.description || '',
      scope,
      users,
      groups,
      groupMembers,
      liveCount: camList.filter(c => c.live).length,
      playbackCount: camList.filter(c => c.playback).length,
      cameras: camList
    };
  });

  /* ---------- Korisnici ---------- */
  const userMap = new Map<string, OvUser & { rightMap: Map<string, OvUserCamRight> }>();
  const touch = (key: string, name: string, email: string) => {
    let u = userMap.get(key);
    if (!u) {
      u = {
        key, name, email, lastLoginAt: '', loggedIn: false, superAdmin: false, roles: [],
        liveCount: 0, playbackCount: 0, allCameras: false, cameras: [], rightMap: new Map()
      };
      userMap.set(key, u);
    }
    return u;
  };
  const addRole = (u: OvUser, roleId: string, roleName: string, via: string) => {
    let r = u.roles.find(x => x.id === roleId);
    if (!r) { r = { id: roleId, name: roleName, via: [] }; u.roles.push(r); }
    if (!r.via.includes(via)) r.via.push(via);
  };
  const applyKnown = (u: OvUser, email: string) => {
    const k = known.find(x => norm(x.email) === norm(email));
    if (k) { u.loggedIn = true; u.lastLoginAt = k.lastLoginAt; if (!u.name || u.name === u.email) u.name = k.name || u.name; }
  };

  for (const role of camRoles) {
    for (const a of roleAssign.get(role.id) || []) {
      if (a.principalType === 'user') {
        const email = a.email || a.principalId;
        const u = touch(norm(email), a.displayName || email, email);
        applyKnown(u, email);
        addRole(u, role.id, role.name, 'direktno');
      } else {
        for (const k of known) {
          if (!groupMatches(a, k.groups)) continue;
          const u = touch(norm(k.email) || norm(k.id), k.name || k.email, k.email);
          u.loggedIn = true;
          u.lastLoginAt = k.lastLoginAt;
          addRole(u, role.id, role.name, `AD grupa ${a.displayName || a.principalId}`);
        }
      }
    }
  }

  for (const u of userMap.values()) {
    for (const r of u.roles) {
      const rights = roleRights.get(r.id);
      if (!rights) continue;
      for (const [camId, rt] of rights) {
        let cur = u.rightMap.get(camId);
        if (!cur) { cur = { id: camId, live: false, playback: false, roles: [] }; u.rightMap.set(camId, cur); }
        cur.live = cur.live || rt.live;
        cur.playback = cur.playback || rt.playback;
        if (!cur.roles.includes(r.name)) cur.roles.push(r.name);
      }
    }
  }

  /* Super admini: ugrađeno pravilo (ITadmin) ili rola Super admin; vide sve kamere */
  const superRoleIds = new Set(listRoles().filter(r => r.isSuperAdmin).map(r => r.id));
  const superCandidates = new Map<string, { id: string; name: string; email: string; groups: { id: string; name: string }[] }>();
  for (const k of known) superCandidates.set(norm(k.email) || norm(k.id), { id: k.id, name: k.name, email: k.email, groups: k.groups });
  for (const a of assignments.filter(x => superRoleIds.has(x.roleId) && x.principalType === 'user')) {
    const email = a.email || a.principalId;
    if (!superCandidates.has(norm(email))) superCandidates.set(norm(email), { id: a.principalId, name: a.displayName, email, groups: [] });
  }
  const superAdmins: { name: string; email: string }[] = [];
  for (const [key, c] of superCandidates) {
    let isSuper = false;
    try { isSuper = computeAccess({ id: c.id, name: c.name, email: c.email, groups: c.groups }).isSuperAdmin; } catch { isSuper = false; }
    if (!isSuper) continue;
    superAdmins.push({ name: c.name || c.email, email: c.email });
    const u = touch(key, c.name || c.email, c.email);
    applyKnown(u, c.email);
    u.superAdmin = true;
    u.allCameras = true;
  }

  const users: OvUser[] = [...userMap.values()].map(u => {
    const cams = [...u.rightMap.values()];
    const { rightMap: _unused, ...rest } = u;
    void _unused;
    return {
      ...rest,
      cameras: u.allCameras ? [] : cams,
      liveCount: u.allCameras ? cameras.length : cams.filter(c => c.live).length,
      playbackCount: u.allCameras ? cameras.length : cams.filter(c => c.playback).length
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'sr'));

  /* Super admini su uračunati u sve preglede kao ugrađena rola koja vidi sve kamere */
  const superRole: OvRole = {
    id: '__super',
    name: 'Super admin',
    description: 'Ugrađeno: Super admini vide sve kamere (uživo i snimci)',
    scope: ['Sve kamere (uživo i snimci)'],
    users: superAdmins.map(s => ({ name: s.name, email: s.email })),
    groups: [],
    groupMembers: [],
    liveCount: cameras.length,
    playbackCount: cameras.length,
    cameras: cameras.map(c => ({ id: c.id, live: true, playback: true })),
    superAdmin: true
  };

  /* ---------- Kamere ---------- */
  const cameraRows: OvCameraRow[] = cameras.map(c => {
    const rolesFor = roles
      .map(r => ({ r, rt: roleRights.get(r.id)?.get(c.id) }))
      .filter(x => !!x.rt)
      .map(x => ({ id: x.r.id, name: x.r.name, live: x.rt!.live, playback: x.rt!.playback }));
    const adGroups = new Set<string>();
    for (const r of rolesFor) for (const g of roles.find(x => x.id === r.id)!.groups) adGroups.add(g.name);
    const usersFor = users
      .filter(u => !u.allCameras)
      .map(u => ({ u, rt: u.cameras.find(x => x.id === c.id) }))
      .filter(x => !!x.rt)
      .map(x => ({ name: x.u.name, email: x.u.email, live: x.rt!.live, playback: x.rt!.playback, roles: x.rt!.roles }) as OvCameraRow['users'][number]);
    rolesFor.push({ id: superRole.id, name: superRole.name, live: true, playback: true, superAdmin: true } as (typeof rolesFor)[number] & { superAdmin: boolean });
    for (const s of superAdmins) usersFor.push({ name: s.name, email: s.email, live: true, playback: true, superAdmin: true, roles: ['Super admin'] });
    return {
      id: c.id, name: c.name, ip: c.ip, position: c.position, location: c.location, recorder: c.recorder, type: c.type,
      roles: rolesFor, adGroups: [...adGroups].sort((a, b) => a.localeCompare(b, 'sr')), users: usersFor
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    cameras: cameras.map(c => ({ id: c.id, name: c.name, ip: c.ip, position: c.position, location: c.location, recorder: c.recorder, type: c.type })),
    roles: [superRole, ...roles],
    users,
    cameraRows,
    superAdmins
  };
}

export function cameraById(overview: CameraOverview): Map<string, OvCamera> {
  return new Map(overview.cameras.map(c => [c.id, c]));
}
