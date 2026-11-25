import { Router, Request, Response } from 'express';
import { getDb } from '../db/sqlite';
import {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  duplicateRole,
  getRolePermissions,
  setRolePermissions,
  getRoleAssignments,
  addRoleAssignment,
  removeRoleAssignment,
  getRoleCameraAccess,
  setRoleCameraAccess,
  listKnownUsers,
  findKnownUserByEmail,
  listAudit,
  writeAudit
} from '../db/rolesDb';
import { PERMISSION_CATALOG, ROLES_TAB } from '../services/permissionCatalog';
import { computeAccess, describeAccess, searchAdPrincipals, isDmsOnlyRole, permissionsAreDmsOnly, canManageRole } from '../services/accessService';
import { UserGroup } from '../services/authService';
import { buildOverview } from '../services/cameraAccessOverview';
import { buildOverviewWorkbook, OverviewView } from '../services/cameraAccessExport';
import { fetchUserGroupsFromGraph } from '../services/graphService';

/**
 * Upravljanje rolama, dodelama, grupama kamera i evidencijom.
 * Montirano na /api/access - routeAccess dozvoljava Super adminu, a članovima grupe DMS-Admins
 * pravljenje, izmenu, brisanje i dodelu DMS rola (dozvole samo iz sekcije DMS).
 */
export const accessRouter = Router();

function fail(res: Response, err: any, status = 400) {
  res.status(status).json({ success: false, error: err?.message || String(err) });
}

/* ---------- Katalog ---------- */
accessRouter.get('/catalog', (_req: Request, res: Response) => {
  res.json({ success: true, sections: PERMISSION_CATALOG, rolesTab: ROLES_TAB });
});

/* ---------- Role ---------- */
accessRouter.get('/roles', (req: Request, res: Response) => {
  try {
    const kind = req.query.kind === 'camera' ? 'camera' : req.query.kind === 'standard' ? 'standard' : undefined;
    const roles = listRoles(kind);
    // DMS administrator vidi samo DMS role, a upravljač kamernih rola samo kamerne role
    res.json({ success: true, roles: req.access?.isSuperAdmin ? roles : roles.filter(r => req.access && canManageRole(req.access, r.id)) });
  } catch (err) {
    fail(res, err, 500);
  }
});

accessRouter.get('/roles/:id', (req: Request, res: Response) => {
  const role = getRole(req.params.id);
  if (!role) return fail(res, new Error('Rola nije pronađena'), 404);
  res.json({
    success: true,
    role,
    permissions: getRolePermissions(role.id),
    assignments: getRoleAssignments(role.id),
    cameraAccess: getRoleCameraAccess(role.id)
  });
});

accessRouter.post('/roles', (req: Request, res: Response) => {
  try {
    const { name, description, copyFrom } = req.body || {};
    const kind = req.body?.kind === 'camera' ? 'camera' : 'standard';
    // Ograničeni upravljači: samo role kojima sme da upravlja (kopija) i samo vrsta role koju sme da pravi
    if (!req.access?.isSuperAdmin) {
      if (copyFrom && !canManageRole(req.access!, String(copyFrom))) {
        return fail(res, new Error('Možete da kopirate samo role kojima upravljate.'), 403);
      }
      if (!copyFrom && kind === 'camera' && !req.access?.isCameraRoleAdmin) {
        return fail(res, new Error('Nemate pravo da pravite kamerne role.'), 403);
      }
      if (!copyFrom && kind === 'standard' && !req.access?.isDmsRoleAdmin) {
        return fail(res, new Error('Standardne role pravi samo Super admin (ili DMS administrator za DMS role).'), 403);
      }
    }
    const role = copyFrom ? duplicateRole(String(copyFrom), name) : createRole(name, description, kind);
    writeAudit(
      req.sessionUser || null, 'role.create', 'role', role.id,
      `Napravljena ${role.kind === 'camera' ? 'kamerna ' : ''}rola „${role.name}“${copyFrom ? ' (kopija)' : ''}`
    );
    res.status(201).json({ success: true, role });
  } catch (err) {
    fail(res, err);
  }
});

accessRouter.put('/roles/:id', (req: Request, res: Response) => {
  try {
    const { name, description } = req.body || {};
    const role = updateRole(req.params.id, name, description);
    if (!role) return fail(res, new Error('Rola nije pronađena'), 404);
    writeAudit(req.sessionUser || null, 'role.update', 'role', role.id, `Izmenjena rola „${role.name}“`);
    res.json({ success: true, role });
  } catch (err) {
    fail(res, err);
  }
});

accessRouter.delete('/roles/:id', (req: Request, res: Response) => {
  try {
    const role = getRole(req.params.id);
    if (!role) return fail(res, new Error('Rola nije pronađena'), 404);
    deleteRole(role.id);
    writeAudit(req.sessionUser || null, 'role.delete', 'role', role.id, `Obrisana rola „${role.name}“`);
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
});

accessRouter.put('/roles/:id/permissions', (req: Request, res: Response) => {
  try {
    const role = getRole(req.params.id);
    if (!role) return fail(res, new Error('Rola nije pronađena'), 404);
    const requested = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    if (!req.access?.isSuperAdmin && !permissionsAreDmsOnly(requested)) {
      return fail(res, new Error('DMS administrator može da daje samo dozvole iz sekcije DMS Analiza podataka.'), 403);
    }
    const before = getRolePermissions(role.id);
    setRolePermissions(role.id, requested);
    const after = getRolePermissions(role.id);
    writeAudit(
      req.sessionUser || null, 'role.permissions', 'role', role.id,
      `Rola „${role.name}“: dozvole ${before.length} → ${after.length} stavki`
    );
    res.json({ success: true, permissions: after });
  } catch (err) {
    fail(res, err);
  }
});

accessRouter.put('/roles/:id/cameras', (req: Request, res: Response) => {
  try {
    const role = getRole(req.params.id);
    if (!role) return fail(res, new Error('Rola nije pronađena'), 404);
    setRoleCameraAccess(role.id, req.body?.rules || []);
    const after = getRoleCameraAccess(role.id);
    writeAudit(req.sessionUser || null, 'role.cameras', 'role', role.id, `Rola „${role.name}“: ${after.length} pravila pristupa kamerama`);
    res.json({ success: true, cameraAccess: after });
  } catch (err) {
    fail(res, err);
  }
});

/* ---------- Dodele ---------- */
accessRouter.post('/roles/:id/assignments', (req: Request, res: Response) => {
  try {
    const role = getRole(req.params.id);
    if (!role) return fail(res, new Error('Rola nije pronađena'), 404);
    const { principalType, principalId, displayName, email } = req.body || {};
    const a = addRoleAssignment(
      role.id, principalType, principalId, displayName, email,
      req.sessionUser?.email || req.sessionUser?.name || ''
    );
    writeAudit(
      req.sessionUser || null, 'role.assign', 'role', role.id,
      `Rola „${role.name}“ dodeljena: ${a.principalType === 'user' ? 'korisnik' : 'AD grupa'} ${a.displayName || a.principalId}`
    );
    res.status(201).json({ success: true, assignment: a });
  } catch (err) {
    fail(res, err);
  }
});

accessRouter.delete('/roles/:id/assignments/:aid', (req: Request, res: Response) => {
  try {
    const role = getRole(req.params.id);
    if (!role) return fail(res, new Error('Rola nije pronađena'), 404);
    const removed = removeRoleAssignment(role.id, parseInt(req.params.aid, 10));
    if (!removed) return fail(res, new Error('Dodela nije pronađena'), 404);
    writeAudit(
      req.sessionUser || null, 'role.unassign', 'role', role.id,
      `Rola „${role.name}“ oduzeta: ${removed.principalType === 'user' ? 'korisnik' : 'AD grupa'} ${removed.displayName || removed.principalId}`
    );
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
});

/* ---------- Kamere: stablo i grupe ---------- */
accessRouter.get('/camera-tree', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const recorders = db.prepare('SELECT id, name, location, ip FROM recorders ORDER BY name COLLATE NOCASE').all() as
      { id: string; name: string; location: string | null; ip: string }[];
    const cams = db.prepare('SELECT id, name, ip, position, recorder, recorder_id FROM cameras ORDER BY recorder, name').all() as
      { id: string; name: string; ip: string; position: string | null; recorder: string | null; recorder_id: string | null }[];

    const byRecorder = new Map<string, any[]>();
    const unassigned: any[] = [];
    for (const c of cams) {
      const item = { id: c.id, name: c.name, ip: c.ip, position: c.position || '' };
      if (c.recorder_id && recorders.some(r => r.id === c.recorder_id)) {
        if (!byRecorder.has(c.recorder_id)) byRecorder.set(c.recorder_id, []);
        byRecorder.get(c.recorder_id)!.push(item);
      } else {
        unassigned.push({ ...item, recorderName: c.recorder || '' });
      }
    }

    res.json({
      success: true,
      recorders: recorders
        .filter(r => byRecorder.has(r.id))
        .map(r => ({ id: r.id, name: r.name, location: r.location || '', ip: r.ip, cameras: byRecorder.get(r.id)! })),
      unassigned,
      groups: [],
      totalCameras: cams.length
    });
  } catch (err) {
    fail(res, err, 500);
  }
});

/* ---------- Pregledi dozvola za kamere (po rolama, korisnicima i kamerama) ---------- */
accessRouter.get('/camera-overview', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...buildOverview() });
  } catch (err) {
    fail(res, err, 500);
  }
});

/** Izvoz u Excel: klijent šalje pregled i ključeve prikazanih stavki; podaci se uvek računaju ponovo na serveru */
accessRouter.post('/camera-overview/export', async (req: Request, res: Response) => {
  try {
    const view = String(req.body?.view || '') as OverviewView;
    if (!['roles', 'users', 'cameras'].includes(view)) return fail(res, new Error('Nepoznat pregled'));
    const keys = Array.isArray(req.body?.keys) ? req.body.keys.slice(0, 5000).map((k: unknown) => String(k)) : null;
    const filters = Array.isArray(req.body?.filters) ? req.body.filters.slice(0, 12).map((f: unknown) => String(f)) : [];
    if (keys && keys.length === 0) return fail(res, new Error('Nema stavki za izvoz u trenutnom prikazu.'));
    const wb = buildOverviewWorkbook(buildOverview(), view, keys, filters);
    const names: Record<string, string> = { roles: 'Role', users: 'Korisnici', cameras: 'Kamere' };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Unipromet_Pristup_kamerama_${names[view]}_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    fail(res, err, 500);
  }
});

/* ---------- Korisnici i AD grupe ---------- */
accessRouter.get('/known', (_req: Request, res: Response) => {
  const users = listKnownUsers();
  const groupMap = new Map<string, { id: string; name: string }>();
  for (const u of users) for (const g of u.groups) if (g.name && !groupMap.has(g.id || g.name)) groupMap.set(g.id || g.name, g);
  res.json({
    success: true,
    users: users.map(u => ({ id: u.id, name: u.name, email: u.email, lastLoginAt: u.lastLoginAt })),
    groups: [...groupMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'sr'))
  });
});

accessRouter.get('/ad/search', async (req: Request, res: Response) => {
  const type = req.query.type === 'group' ? 'ad_group' : 'user';
  try {
    const results = await searchAdPrincipals(type, String(req.query.q || ''));
    res.json({ success: true, results });
  } catch (err: any) {
    res.json({
      success: false,
      results: [],
      error: 'Pretraga Entra ID-ja nije uspela. ' + (err?.message ? String(err.message).split('\n')[0] : '')
    });
  }
});

/* ---------- Proveri korisnika ---------- */
accessRouter.get('/check-user', async (req: Request, res: Response) => {
  const identifier = String(req.query.user || '').trim();
  if (!identifier) return fail(res, new Error('Unesite mejl ili korisničko ime'));

  const known = findKnownUserByEmail(identifier)
    || listKnownUsers().find(u => u.name.toLowerCase() === identifier.toLowerCase());

  const groups: UserGroup[] = [...(known?.groups || [])];
  let liveGroups = 0;
  const live = await fetchUserGroupsFromGraph(known?.email || identifier);
  const seen = new Set(groups.map(g => g.name.toLowerCase()));
  for (const g of live) {
    if (!seen.has(g.name.toLowerCase())) {
      groups.push(g);
      seen.add(g.name.toLowerCase());
    }
  }
  liveGroups = live.length;

  if (!known && groups.length === 0) {
    return fail(res, new Error('Korisnik nije pronađen (nije se prijavljivao, a Entra ID ne vraća grupe).'), 404);
  }

  const email = known?.email || (identifier.includes('@') ? identifier.toLowerCase() : '');
  const access = computeAccess({ id: known?.id || '', name: known?.name || identifier, email, groups });
  res.json({
    success: true,
    user: { name: known?.name || identifier, email, lastLoginAt: known?.lastLoginAt || '' },
    groups: groups.map(g => g.name).sort((a, b) => a.localeCompare(b, 'sr')),
    groupsSource: liveGroups > 0 ? 'Active Directory (uživo) + poslednja prijava' : known ? 'poslednja prijava' : 'nepoznato',
    ...describeAccess(access)
  });
});

/* ---------- Evidencija ---------- */
accessRouter.get('/audit', (req: Request, res: Response) => {
  try {
    const data = listAudit({
      limit: parseInt(String(req.query.limit || '100'), 10),
      offset: parseInt(String(req.query.offset || '0'), 10),
      action: req.query.action ? String(req.query.action) : undefined,
      q: req.query.q ? String(req.query.q) : undefined
    });
    res.json({ success: true, ...data });
  } catch (err) {
    fail(res, err, 500);
  }
});
