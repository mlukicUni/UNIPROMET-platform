import crypto from 'crypto';
import { getDb } from './sqlite';
import { searchTokens } from '../utils/searchMatch';
import { initSchema } from './schema';
import {
  PermissionLevel,
  isValidPermissionKey,
  isValidActionKey,
  getAllItemKeys
} from '../services/permissionCatalog';

/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - ROLE, DOZVOLE I PRISTUP KAMERAMA (SQLite)
 * ==========================================================================
 */

export type PrincipalType = 'user' | 'ad_group';
export type CameraScope = 'all' | 'recorder' | 'group' | 'camera';

/** standard = dozvole za sekcije; camera = pristup kamerama (VIDEO NADZOR → Dozvole za pristup) */
export type RoleKind = 'standard' | 'camera';

export interface RoleRow {
  id: string;
  name: string;
  description: string;
  kind: RoleKind;
  isSuperAdmin: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface RolePermission {
  key: string;
  level: PermissionLevel;
  actions: string[];
}

export interface RoleAssignment {
  id: number;
  roleId: string;
  principalType: PrincipalType;
  principalId: string;
  displayName: string;
  email: string;
  createdAt: string;
  createdBy: string;
}

export interface RoleCameraAccess {
  id?: number;
  roleId?: string;
  scope: CameraScope;
  targetId: string;
  canLive: boolean;
  canPlayback: boolean;
}

export interface CameraGroup {
  id: string;
  name: string;
  description: string;
  members: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface KnownUser {
  id: string;
  name: string;
  email: string;
  groups: { id: string; name: string }[];
  lastLoginAt: string;
}

export interface AuditEntry {
  id: number;
  ts: string;
  userId: string;
  userName: string;
  userEmail: string;
  action: string;
  objectType: string;
  objectId: string;
  details: string;
  success: boolean;
}

/** Povećava se pri svakoj izmeni rola/dodela/grupa - poništava keš efektivnih prava */
let accessVersion = 1;
export function getAccessVersion(): number {
  return accessVersion;
}
export function bumpAccessVersion(): void {
  accessVersion++;
}

let schemaReady = false;

export function initRolesSchema(): void {
  if (schemaReady) return;
  initSchema();
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      is_super_admin INTEGER DEFAULT 0,
      is_system INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      kind TEXT NOT NULL DEFAULT 'standard'
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('view', 'edit')),
      actions TEXT DEFAULT '[]',
      PRIMARY KEY (role_id, permission_key)
    );

    CREATE TABLE IF NOT EXISTS role_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'ad_group')),
      principal_id TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      created_by TEXT DEFAULT '',
      UNIQUE (role_id, principal_type, principal_id)
    );

    CREATE TABLE IF NOT EXISTS camera_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS camera_group_members (
      group_id TEXT NOT NULL REFERENCES camera_groups(id) ON DELETE CASCADE,
      camera_id TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, camera_id)
    );

    CREATE TABLE IF NOT EXISTS role_camera_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (scope IN ('all', 'recorder', 'group', 'camera')),
      target_id TEXT NOT NULL DEFAULT '',
      can_live INTEGER DEFAULT 1,
      can_playback INTEGER DEFAULT 0,
      UNIQUE (role_id, scope, target_id)
    );

    CREATE TABLE IF NOT EXISTS known_users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      groups_json TEXT DEFAULT '[]',
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      user_email TEXT,
      action TEXT NOT NULL,
      object_type TEXT,
      object_id TEXT,
      details TEXT,
      success INTEGER DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_role_assign_principal ON role_assignments(principal_type, principal_id);
    CREATE INDEX IF NOT EXISTS idx_role_assign_role ON role_assignments(role_id);
    CREATE INDEX IF NOT EXISTS idx_role_cam_role ON role_camera_access(role_id);
    CREATE INDEX IF NOT EXISTS idx_cam_group_members_cam ON camera_group_members(camera_id);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_known_users_email ON known_users(email);
  `);

  schemaReady = true;
  ensureRoleKind();
  getDb().exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name_kind ON roles(name COLLATE NOCASE, kind)');
  migrateCameraGroupRules();
  seedDefaultRoles();
  migrateDmsRoleAction();
}

/**
 * Role su podeljene na dve vrste: standardne (dozvole za sekcije) i kamerne (pristup kamerama).
 * Kolona se dodaje jednom; tada se svaka standardna rola koja ima pravila za kamere deli na dve:
 * standardna zadržava dozvole za sekcije, a nova kamerna rola „<naziv> (kamere)“ preuzima pravila za kamere
 * i dodele, pa niko ne dobija niti gubi pristup.
 */
function ensureRoleKind(): void {
  const db = getDb();
  const cols = db.prepare('PRAGMA table_info(roles)').all() as { name: string }[];
  const hadKind = cols.some(c => c.name === 'kind');
  // Stara šema ima UNIQUE na samom nazivu: tada se rola i kamerna dozvola ne bi mogle zvati isto
  const oldUniqueName = (db.prepare('PRAGMA index_list(roles)').all() as { unique: number; origin: string }[])
    .some(ix => ix.unique === 1 && ix.origin === 'u');
  if (hadKind && !oldUniqueName) return;

  db.exec('CREATE TABLE IF NOT EXISTS role_split_map (standard_id TEXT PRIMARY KEY, camera_id TEXT NOT NULL, shares_done INTEGER DEFAULT 0)');
  // Tabela se pravi ponovo (SQLite ne može da ukloni UNIQUE); strani ključevi se isključuju da brisanje stare tabele ne obriše zavisne redove
  const fkWas = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE roles_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          is_super_admin INTEGER DEFAULT 0,
          is_system INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          kind TEXT NOT NULL DEFAULT 'standard'
        );
        INSERT INTO roles_new (id, name, description, is_super_admin, is_system, created_at, updated_at, kind)
          SELECT id, name, description, is_super_admin, is_system, created_at, updated_at, ${hadKind ? "COALESCE(kind, 'standard')" : "'standard'"} FROM roles;
        DROP TABLE roles;
        ALTER TABLE roles_new RENAME TO roles;
      `);

      if (!hadKind) {
        // Svaka rola koja ima pravila za kamere deli se na rolu (dozvole za sekcije) i kamernu dozvolu istog naziva
        const roles = db.prepare('SELECT * FROM roles WHERE is_super_admin = 0').all() as RoleDbRow[];
        const now = new Date().toISOString();
        for (const r of roles) {
          const rules = db.prepare('SELECT COUNT(*) AS c FROM role_camera_access WHERE role_id = ?').get(r.id) as { c: number };
          if (rules.c === 0) continue;
          const camId = newId('role');
          db.prepare(
            "INSERT INTO roles (id, name, description, is_super_admin, is_system, created_at, updated_at, kind) VALUES (?, ?, ?, 0, 0, ?, ?, 'camera')"
          ).run(camId, r.name, r.description || '', now, now);
          db.prepare('UPDATE role_camera_access SET role_id = ? WHERE role_id = ?').run(camId, r.id);
          db.prepare(`
            INSERT INTO role_assignments (role_id, principal_type, principal_id, display_name, email, created_at, created_by)
            SELECT ?, principal_type, principal_id, display_name, email, created_at, 'migracija' FROM role_assignments WHERE role_id = ?
          `).run(camId, r.id);
          db.prepare('INSERT OR REPLACE INTO role_split_map (standard_id, camera_id, shares_done) VALUES (?, ?, 0)').run(r.id, camId);
          console.log(`[Roles] Rola „${r.name}“ podeljena: rola i kamerna dozvola istog naziva`);
        }
      }
    })();
  } finally {
    db.pragma(`foreign_keys = ${fkWas ? 'ON' : 'OFF'}`);
  }
  const broken = db.pragma('foreign_key_check') as unknown[];
  if (broken.length) console.warn(`[Roles] Upozorenje: ${broken.length} zapisa sa neispravnim stranim ključem posle obnove tabele rola`);
  bumpAccessVersion();
}

/**
 * Verzija 1.3.6 je „Upravljanje DMS rolama“ čuvala kao akciju `dms.korisnici:role`; od tada je to
 * poseban red `dms.role`. Stara akcija se prebacuje u novi red (inače čuvanje te role javlja „Nepoznata akcija“).
 */
function migrateDmsRoleAction(): void {
  const legacy = 'dms.korisnici:role';
  const db = getDb();
  const rows = db.prepare(`SELECT role_id, actions FROM role_permissions WHERE permission_key = 'dms.korisnici' AND actions LIKE ?`)
    .all(`%${legacy}%`) as { role_id: string; actions: string }[];
  if (rows.length === 0) return;

  const tx = db.transaction(() => {
    for (const r of rows) {
      let actions: string[] = [];
      try { actions = JSON.parse(r.actions || '[]'); } catch { actions = []; }
      db.prepare(`UPDATE role_permissions SET actions = ? WHERE role_id = ? AND permission_key = 'dms.korisnici'`)
        .run(JSON.stringify(actions.filter(a => a !== legacy)), r.role_id);
      db.prepare(`DELETE FROM role_permissions WHERE role_id = ? AND permission_key = 'dms.role'`).run(r.role_id);
      db.prepare(`INSERT INTO role_permissions (role_id, permission_key, level, actions) VALUES (?, 'dms.role', 'edit', '[]')`)
        .run(r.role_id);
    }
  });
  tx();
  console.log(`[Roles] „Upravljanje DMS rolama“ prebačeno sa akcije na poseban red za ${rows.length} rola`);
}

/**
 * Ručne grupe kamera su ukinute (ista stvar se radi kopiranjem role). Pravila pristupa po grupi
 * pretvaraju se u pravila po kameri za sve članove grupe, pa niko ne gubi pristup; grupe se brišu.
 */
function migrateCameraGroupRules(): void {
  const db = getDb();
  const rules = db.prepare("SELECT id, role_id, target_id, can_live, can_playback FROM role_camera_access WHERE scope = 'group'")
    .all() as { id: number; role_id: string; target_id: string; can_live: number; can_playback: number }[];
  const groups = (db.prepare('SELECT COUNT(*) AS c FROM camera_groups').get() as { c: number }).c;
  if (rules.length === 0 && groups === 0) return;
  db.transaction(() => {
    for (const r of rules) {
      const members = db.prepare('SELECT camera_id FROM camera_group_members WHERE group_id = ?').all(r.target_id) as { camera_id: string }[];
      for (const m of members) {
        db.prepare(`
          INSERT INTO role_camera_access (role_id, scope, target_id, can_live, can_playback) VALUES (?, 'camera', ?, ?, ?)
          ON CONFLICT(role_id, scope, target_id) DO UPDATE SET
            can_live = MAX(can_live, excluded.can_live), can_playback = MAX(can_playback, excluded.can_playback)
        `).run(r.role_id, m.camera_id, r.can_live, r.can_playback);
      }
      db.prepare('DELETE FROM role_camera_access WHERE id = ?').run(r.id);
    }
    db.exec('DELETE FROM camera_group_members; DELETE FROM camera_groups;');
  })();
  console.log(`[Roles] Grupe kamera ukinute: ${rules.length} pravila pretvoreno u pravila po kameri`);
  bumpAccessVersion();
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

/** Pravi početne role samo kada tabela rola još nema nijedan red */
function seedDefaultRoles(): void {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM roles').get() as { c: number }).c;
  if (count > 0) return;

  const now = new Date().toISOString();
  const insertRole = db.prepare(
    'INSERT INTO roles (id, name, description, is_super_admin, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertPerm = db.prepare(
    'INSERT INTO role_permissions (role_id, permission_key, level, actions) VALUES (?, ?, ?, ?)'
  );
  const insertCam = db.prepare(
    'INSERT INTO role_camera_access (role_id, scope, target_id, can_live, can_playback) VALUES (?, ?, ?, ?, ?)'
  );

  const tx = db.transaction(() => {
    insertRole.run('super-admin', 'Super admin', 'Pun pristup svim sekcijama i kamerama, upravljanje rolama.', 1, 1, now, now);

    insertRole.run('video-nadzor-pregled', 'Video nadzor – pregled', 'Pregled stranica sekcije VIDEO NADZOR.', 0, 0, now, now);
    insertPerm.run('video-nadzor-pregled', 'video', 'view', '[]');
    insertRole.run('kamere-sve', 'Sve kamere – uživo i snimci', 'Kamerna dozvola: sve kamere uživo i snimci.', 0, 0, now, now);
    db.prepare("UPDATE roles SET kind = 'camera' WHERE id = 'kamere-sve'").run();
    insertCam.run('kamere-sve', 'all', '', 1, 1);

    insertRole.run('evidencija-pregled', 'Evidencija – pregled', 'Samo pregled svih stranica sekcije EVIDENCIJA.', 0, 0, now, now);
    insertPerm.run('evidencija-pregled', 'evidencija', 'view', '[]');

    insertRole.run('mreza-tehnicar', 'Mreža – tehničar', 'Izmena svih stranica sekcije MREŽA bez posebnih akcija, bez pristupa kamerama.', 0, 0, now, now);
    insertPerm.run('mreza-tehnicar', 'mreza', 'edit', '[]');
  });
  tx();
}

/* ==========================================================================
   ROLES
   ========================================================================== */
interface RoleDbRow {
  id: string;
  name: string;
  description: string | null;
  kind?: string | null;
  is_super_admin: number;
  is_system: number;
  created_at: string;
  updated_at: string | null;
}

function rowToRole(r: RoleDbRow): RoleRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    kind: r.kind === 'camera' ? 'camera' : 'standard',
    isSuperAdmin: r.is_super_admin === 1,
    isSystem: r.is_system === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at || undefined
  };
}

export function listRoles(kind?: RoleKind): (RoleRow & { assignmentCount: number; permissionCount: number; cameraRuleCount: number })[] {
  initRolesSchema();
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM role_assignments a WHERE a.role_id = r.id) AS assignment_count,
      (SELECT COUNT(*) FROM role_permissions p WHERE p.role_id = r.id) AS permission_count,
      (SELECT COUNT(*) FROM role_camera_access c WHERE c.role_id = r.id) AS camera_rule_count
    FROM roles r
    ORDER BY r.is_super_admin DESC, r.name COLLATE NOCASE ASC
  `).all() as (RoleDbRow & { assignment_count: number; permission_count: number; camera_rule_count: number })[];
  return rows
    .map(r => ({
      ...rowToRole(r),
      assignmentCount: r.assignment_count,
      permissionCount: r.permission_count,
      cameraRuleCount: r.camera_rule_count
    }))
    .filter(r => !kind || r.kind === kind);
}

export function getRole(id: string): RoleRow | undefined {
  initRolesSchema();
  const row = getDb().prepare('SELECT * FROM roles WHERE id = ?').get(id) as RoleDbRow | undefined;
  return row ? rowToRole(row) : undefined;
}

export function createRole(name: string, description: string, kind: RoleKind = 'standard'): RoleRow {
  initRolesSchema();
  const cleanName = (name || '').trim();
  if (!cleanName) throw new Error(kind === 'camera' ? 'Naziv dozvole je obavezan' : 'Naziv role je obavezan');
  const db = getDb();
  const dup = db.prepare('SELECT 1 FROM roles WHERE name = ? COLLATE NOCASE AND kind = ?').get(cleanName, kind === 'camera' ? 'camera' : 'standard');
  if (dup) throw new Error(kind === 'camera' ? 'Dozvola sa tim nazivom već postoji' : 'Rola sa tim nazivom već postoji');
  const id = newId('role');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO roles (id, name, description, is_super_admin, is_system, created_at, updated_at, kind) VALUES (?, ?, ?, 0, 0, ?, ?, ?)'
  ).run(id, cleanName, (description || '').trim(), now, now, kind === 'camera' ? 'camera' : 'standard');
  bumpAccessVersion();
  return getRole(id)!;
}

export function updateRole(id: string, name: string, description: string): RoleRow | null {
  initRolesSchema();
  const existing = getRole(id);
  if (!existing) return null;
  const cleanName = (name || '').trim();
  if (!cleanName) throw new Error('Naziv role je obavezan');
  const db = getDb();
  const dup = db.prepare('SELECT 1 FROM roles WHERE name = ? COLLATE NOCASE AND id <> ? AND kind = ?').get(cleanName, id, existing.kind);
  if (dup) throw new Error(existing.kind === 'camera' ? 'Dozvola sa tim nazivom već postoji' : 'Rola sa tim nazivom već postoji');
  db.prepare('UPDATE roles SET name = ?, description = ?, updated_at = ? WHERE id = ?')
    .run(existing.isSystem ? existing.name : cleanName, (description || '').trim(), new Date().toISOString(), id);
  bumpAccessVersion();
  return getRole(id)!;
}

export function deleteRole(id: string): boolean {
  initRolesSchema();
  const existing = getRole(id);
  if (!existing) return false;
  if (existing.isSystem) throw new Error('Sistemska rola se ne može obrisati');
  const res = getDb().prepare('DELETE FROM roles WHERE id = ?').run(id);
  bumpAccessVersion();
  return res.changes > 0;
}

export function duplicateRole(id: string, newName: string): RoleRow {
  initRolesSchema();
  const src = getRole(id);
  if (!src) throw new Error('Rola nije pronađena');
  const created = createRole(newName, src.description, src.kind);
  if (src.kind === 'camera') setRoleCameraAccess(created.id, getRoleCameraAccess(id));
  else setRolePermissions(created.id, getRolePermissions(id));
  return created;
}

/* ==========================================================================
   PERMISSIONS
   ========================================================================== */
export function getRolePermissions(roleId: string): RolePermission[] {
  initRolesSchema();
  const rows = getDb().prepare(
    'SELECT permission_key, level, actions FROM role_permissions WHERE role_id = ? ORDER BY permission_key'
  ).all(roleId) as { permission_key: string; level: PermissionLevel; actions: string | null }[];
  return rows.map(r => {
    let actions: string[] = [];
    try { actions = JSON.parse(r.actions || '[]'); } catch { actions = []; }
    return { key: r.permission_key, level: r.level, actions };
  });
}

export function setRolePermissions(roleId: string, perms: RolePermission[]): void {
  initRolesSchema();
  const role = getRole(roleId);
  if (!role) throw new Error('Rola nije pronađena');
  if (role.isSuperAdmin) throw new Error('Dozvole Super admin role se ne menjaju (ima sve dozvole)');
  if (role.kind === 'camera') throw new Error('Kamerna dozvola nema dozvole za sekcije; ona određuje samo pristup kamerama');

  const clean: RolePermission[] = [];
  const seen = new Set<string>();
  for (const p of perms || []) {
    if (!p || !isValidPermissionKey(p.key)) throw new Error(`Nepoznata dozvola: ${p?.key}`);
    if (p.level !== 'view' && p.level !== 'edit') throw new Error(`Nevažeći nivo za ${p.key}`);
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    const actions = (p.actions || []).filter(a => {
      if (!isValidActionKey(a)) throw new Error(`Nepoznata akcija: ${a}`);
      return true;
    });
    clean.push({ key: p.key, level: p.level, actions: [...new Set(actions)] });
  }

  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    const ins = db.prepare('INSERT INTO role_permissions (role_id, permission_key, level, actions) VALUES (?, ?, ?, ?)');
    for (const p of clean) ins.run(roleId, p.key, p.level, JSON.stringify(p.actions));
    db.prepare('UPDATE roles SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), roleId);
  });
  tx();
  bumpAccessVersion();
}

/* ==========================================================================
   ASSIGNMENTS
   ========================================================================== */
interface AssignmentDbRow {
  id: number;
  role_id: string;
  principal_type: PrincipalType;
  principal_id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
  created_by: string | null;
}

function rowToAssignment(r: AssignmentDbRow): RoleAssignment {
  return {
    id: r.id,
    roleId: r.role_id,
    principalType: r.principal_type,
    principalId: r.principal_id,
    displayName: r.display_name || '',
    email: r.email || '',
    createdAt: r.created_at,
    createdBy: r.created_by || ''
  };
}

export function getRoleAssignments(roleId: string): RoleAssignment[] {
  initRolesSchema();
  const rows = getDb().prepare(
    'SELECT * FROM role_assignments WHERE role_id = ? ORDER BY principal_type, display_name COLLATE NOCASE'
  ).all(roleId) as AssignmentDbRow[];
  return rows.map(rowToAssignment);
}

export function getAllAssignments(): RoleAssignment[] {
  initRolesSchema();
  const rows = getDb().prepare('SELECT * FROM role_assignments').all() as AssignmentDbRow[];
  return rows.map(rowToAssignment);
}

export function addRoleAssignment(
  roleId: string,
  principalType: PrincipalType,
  principalId: string,
  displayName: string,
  email: string,
  createdBy: string
): RoleAssignment {
  initRolesSchema();
  if (!getRole(roleId)) throw new Error('Rola nije pronađena');
  if (principalType !== 'user' && principalType !== 'ad_group') throw new Error('Nevažeći tip dodele');
  const cleanId = (principalType === 'user' ? (principalId || email || '').trim().toLowerCase() : (principalId || '').trim());
  if (!cleanId) throw new Error('Nedostaje identifikator korisnika ili grupe');
  const db = getDb();
  const dup = db.prepare('SELECT 1 FROM role_assignments WHERE role_id = ? AND principal_type = ? AND principal_id = ?')
    .get(roleId, principalType, cleanId);
  if (dup) throw new Error('Ova dodela već postoji');
  const info = db.prepare(`
    INSERT INTO role_assignments (role_id, principal_type, principal_id, display_name, email, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    roleId, principalType, cleanId,
    (displayName || '').trim(),
    (email || (principalType === 'user' ? cleanId : '')).trim().toLowerCase(),
    new Date().toISOString(),
    createdBy || ''
  );
  bumpAccessVersion();
  const row = db.prepare('SELECT * FROM role_assignments WHERE id = ?').get(info.lastInsertRowid) as AssignmentDbRow;
  return rowToAssignment(row);
}

export function removeRoleAssignment(roleId: string, assignmentId: number): RoleAssignment | null {
  initRolesSchema();
  const db = getDb();
  const row = db.prepare('SELECT * FROM role_assignments WHERE id = ? AND role_id = ?').get(assignmentId, roleId) as AssignmentDbRow | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM role_assignments WHERE id = ?').run(assignmentId);
  bumpAccessVersion();
  return rowToAssignment(row);
}

/* ==========================================================================
   CAMERA ACCESS PER ROLE
   ========================================================================== */
export function getRoleCameraAccess(roleId: string): RoleCameraAccess[] {
  initRolesSchema();
  const rows = getDb().prepare(
    'SELECT id, role_id, scope, target_id, can_live, can_playback FROM role_camera_access WHERE role_id = ? ORDER BY scope, target_id'
  ).all(roleId) as { id: number; role_id: string; scope: CameraScope; target_id: string; can_live: number; can_playback: number }[];
  return rows.map(r => ({
    id: r.id,
    roleId: r.role_id,
    scope: r.scope,
    targetId: r.target_id || '',
    canLive: r.can_live === 1,
    canPlayback: r.can_playback === 1
  }));
}

export function getAllCameraAccessRules(): RoleCameraAccess[] {
  initRolesSchema();
  const rows = getDb().prepare(
    'SELECT id, role_id, scope, target_id, can_live, can_playback FROM role_camera_access'
  ).all() as { id: number; role_id: string; scope: CameraScope; target_id: string; can_live: number; can_playback: number }[];
  return rows.map(r => ({
    id: r.id,
    roleId: r.role_id,
    scope: r.scope,
    targetId: r.target_id || '',
    canLive: r.can_live === 1,
    canPlayback: r.can_playback === 1
  }));
}

export function setRoleCameraAccess(roleId: string, rules: RoleCameraAccess[]): void {
  initRolesSchema();
  const role = getRole(roleId);
  if (!role) throw new Error('Rola nije pronađena');
  if (role.isSuperAdmin) throw new Error('Super admin ima pristup svim kamerama');
  if (role.kind !== 'camera') throw new Error('Pristup kamerama se podešava samo u kamernim dozvolama (VIDEO NADZOR → Dozvole za pristup)');

  const merged = new Map<string, RoleCameraAccess>();
  for (const r of rules || []) {
    if (!['all', 'recorder', 'camera'].includes(r.scope)) throw new Error(`Nevažeći opseg: ${r.scope}`);
    const target = r.scope === 'all' ? '' : String(r.targetId || '').trim();
    if (r.scope !== 'all' && !target) throw new Error('Nedostaje cilj za pravilo pristupa kamerama');
    if (!r.canLive && !r.canPlayback) continue;
    const key = `${r.scope}|${target}`;
    const prev = merged.get(key);
    merged.set(key, {
      scope: r.scope,
      targetId: target,
      canLive: !!r.canLive || !!prev?.canLive,
      canPlayback: !!r.canPlayback || !!prev?.canPlayback
    });
  }

  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM role_camera_access WHERE role_id = ?').run(roleId);
    const ins = db.prepare(
      'INSERT INTO role_camera_access (role_id, scope, target_id, can_live, can_playback) VALUES (?, ?, ?, ?, ?)'
    );
    for (const r of merged.values()) ins.run(roleId, r.scope, r.targetId, r.canLive ? 1 : 0, r.canPlayback ? 1 : 0);
    db.prepare('UPDATE roles SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), roleId);
  });
  tx();
  bumpAccessVersion();
}

/* ==========================================================================
   CAMERA GROUPS (ručne grupe; automatske grupe su po snimaču)
   ========================================================================== */
export function listCameraGroups(): CameraGroup[] {
  initRolesSchema();
  const db = getDb();
  const groups = db.prepare('SELECT * FROM camera_groups ORDER BY name COLLATE NOCASE').all() as {
    id: string; name: string; description: string | null; created_at: string; updated_at: string | null;
  }[];
  const members = db.prepare('SELECT group_id, camera_id FROM camera_group_members').all() as { group_id: string; camera_id: string }[];
  const byGroup = new Map<string, string[]>();
  for (const m of members) {
    if (!byGroup.has(m.group_id)) byGroup.set(m.group_id, []);
    byGroup.get(m.group_id)!.push(m.camera_id);
  }
  return groups.map(g => ({
    id: g.id,
    name: g.name,
    description: g.description || '',
    members: (byGroup.get(g.id) || []).sort(),
    createdAt: g.created_at,
    updatedAt: g.updated_at || undefined
  }));
}

export function getCameraGroupMembersMap(groupIds: string[]): Map<string, Set<string>> {
  initRolesSchema();
  const map = new Map<string, Set<string>>();
  if (groupIds.length === 0) return map;
  const db = getDb();
  const ph = groupIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT group_id, camera_id FROM camera_group_members WHERE group_id IN (${ph})`)
    .all(...groupIds) as { group_id: string; camera_id: string }[];
  for (const r of rows) {
    if (!map.has(r.group_id)) map.set(r.group_id, new Set());
    map.get(r.group_id)!.add(r.camera_id);
  }
  return map;
}

export function createCameraGroup(name: string, description: string, members: string[]): CameraGroup {
  initRolesSchema();
  const cleanName = (name || '').trim();
  if (!cleanName) throw new Error('Naziv grupe je obavezan');
  const db = getDb();
  if (db.prepare('SELECT 1 FROM camera_groups WHERE name = ? COLLATE NOCASE').get(cleanName)) {
    throw new Error('Grupa kamera sa tim nazivom već postoji');
  }
  const id = newId('grp');
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO camera_groups (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, cleanName, (description || '').trim(), now, now);
    writeGroupMembers(id, members || []);
  });
  tx();
  bumpAccessVersion();
  return listCameraGroups().find(g => g.id === id)!;
}

function writeGroupMembers(groupId: string, members: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM camera_group_members WHERE group_id = ?').run(groupId);
  const exists = db.prepare('SELECT 1 FROM cameras WHERE id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO camera_group_members (group_id, camera_id) VALUES (?, ?)');
  for (const camId of [...new Set(members)]) {
    if (exists.get(camId)) ins.run(groupId, camId);
  }
}

export function updateCameraGroup(id: string, name: string, description: string, members: string[]): CameraGroup | null {
  initRolesSchema();
  const db = getDb();
  const existing = db.prepare('SELECT * FROM camera_groups WHERE id = ?').get(id);
  if (!existing) return null;
  const cleanName = (name || '').trim();
  if (!cleanName) throw new Error('Naziv grupe je obavezan');
  if (db.prepare('SELECT 1 FROM camera_groups WHERE name = ? COLLATE NOCASE AND id <> ?').get(cleanName, id)) {
    throw new Error('Grupa kamera sa tim nazivom već postoji');
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE camera_groups SET name = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(cleanName, (description || '').trim(), new Date().toISOString(), id);
    writeGroupMembers(id, members || []);
  });
  tx();
  bumpAccessVersion();
  return listCameraGroups().find(g => g.id === id) || null;
}

export function deleteCameraGroup(id: string): boolean {
  initRolesSchema();
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM role_camera_access WHERE scope = 'group' AND target_id = ?").run(id);
    return db.prepare('DELETE FROM camera_groups WHERE id = ?').run(id).changes > 0;
  });
  const ok = tx();
  bumpAccessVersion();
  return ok;
}

/* ==========================================================================
   KNOWN USERS (ko se prijavio - za izbor u ekranu rola)
   ========================================================================== */
export function recordKnownUser(u: { id: string; name: string; email: string; groups: { id: string; name: string }[] }): void {
  initRolesSchema();
  getDb().prepare(`
    INSERT INTO known_users (id, name, email, groups_json, last_login_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, email = excluded.email,
      groups_json = excluded.groups_json, last_login_at = excluded.last_login_at
  `).run(u.id, u.name, (u.email || '').toLowerCase(), JSON.stringify(u.groups || []), new Date().toISOString());
}

export function listKnownUsers(): KnownUser[] {
  initRolesSchema();
  const rows = getDb().prepare('SELECT * FROM known_users ORDER BY name COLLATE NOCASE').all() as {
    id: string; name: string | null; email: string | null; groups_json: string | null; last_login_at: string | null;
  }[];
  return rows.map(r => {
    let groups: { id: string; name: string }[] = [];
    try { groups = JSON.parse(r.groups_json || '[]'); } catch { groups = []; }
    return { id: r.id, name: r.name || '', email: r.email || '', groups, lastLoginAt: r.last_login_at || '' };
  });
}

export function findKnownUserByEmail(email: string): KnownUser | undefined {
  const e = (email || '').trim().toLowerCase();
  if (!e) return undefined;
  return listKnownUsers().find(u => u.email === e);
}

/* ==========================================================================
   AUDIT
   ========================================================================== */
export function writeAudit(
  user: { id?: string; name?: string; email?: string } | null,
  action: string,
  objectType: string,
  objectId: string,
  details: string,
  success = true
): void {
  try {
    initRolesSchema();
    getDb().prepare(`
      INSERT INTO audit_log (ts, user_id, user_name, user_email, action, object_type, object_id, details, success)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      user?.id || '', user?.name || '', user?.email || '',
      action, objectType || '', objectId || '', details || '', success ? 1 : 0
    );
  } catch (err) {
    console.warn('[Audit] Upis u evidenciju nije uspeo:', (err as Error)?.message);
  }
}

export function listAudit(opts: { limit?: number; offset?: number; action?: string; q?: string }): { total: number; items: AuditEntry[] } {
  initRolesSchema();
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.action) {
    where.push('action LIKE ?');
    params.push(`${opts.action}%`);
  }
  // Zajedničko pravilo pretrage (src/utils/searchMatch.ts): svaka reč u bar jednom polju, bez kvačica.
  // Pozicioni parametri (?) jer ostatak upita koristi njih - zato ne sqlSearch(), već isti uslov ručno.
  const searchCols = ['user_name', 'user_email', 'details', 'object_id'];
  for (const word of searchTokens(opts.q)) {
    where.push('(' + searchCols.map(c => `unorm(${c}) LIKE ? ESCAPE '\\'`).join(' OR ') + ')');
    const like = `%${word.replace(/[\\%_]/g, ch => '\\' + ch)}%`;
    for (let i = 0; i < searchCols.length; i++) params.push(like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_log ${whereSql}`).get(...params) as { c: number }).c;
  const limit = Math.min(Math.max(opts.limit || 100, 1), 500);
  const offset = Math.max(opts.offset || 0, 0);
  const rows = db.prepare(`SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as any[];
  return {
    total,
    items: rows.map(r => ({
      id: r.id,
      ts: r.ts,
      userId: r.user_id || '',
      userName: r.user_name || '',
      userEmail: r.user_email || '',
      action: r.action,
      objectType: r.object_type || '',
      objectId: r.object_id || '',
      details: r.details || '',
      success: r.success === 1
    }))
  };
}

/** Pomoćno: svi ključevi stavki (za validaciju u rutama) */
export function knownItemKeys(): string[] {
  return getAllItemKeys();
}
