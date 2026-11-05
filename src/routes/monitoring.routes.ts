import { Router, Request, Response } from 'express';
import { getDb } from '../db/sqlite';
import {
  ownerKey,
  listTabs,
  getTab,
  createTab,
  updateTab,
  deleteTab,
  duplicateTab,
  reorderTabs,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getSettings,
  saveSettings,
  listSharesForOwner,
  setTabShares,
  listSharedTabsForRoles,
  getSharedTab,
  MonitoringTab,
  MAX_CELLS,
  MAX_GRID,
  MAX_TABS
} from '../db/monitoringDb';
import { listRoles, getRolePermissions, getRoleCameraAccess, getCameraGroupMembersMap, writeAudit } from '../db/rolesDb';
import { cameraRights, hasAction, levelFor, lookupCameraById, EffectiveAccess } from '../services/accessService';
import { getCachedOfflineCamerasInfoSync } from '../services/cameraScanner';

/**
 * Monitoring - lični tabovi sa gridovima kamera.
 * Montirano na /api/monitoring; routeAccess traži pregled stranice 'video.monitoring'.
 * Svaki korisnik vidi i menja isključivo svoje tabove i šablone.
 * Tabovi se mogu podeliti sa rolama (akcija 'video.monitoring:deljenje'); članovi rola
 * ih vide samo za gledanje, mogu da prave svoju kopiju ili da ih sakriju za sebe.
 */
export const monitoringRouter = Router();

function fail(res: Response, err: any, status = 400) {
  res.status(status).json({ success: false, error: err?.message || String(err) });
}

function owner(req: Request): string {
  const key = req.sessionUser ? ownerKey(req.sessionUser) : '';
  if (!key) throw new Error('Korisnik nije prepoznat.');
  return key;
}

interface MonitoringCamera {
  id: string;
  ip: string;
  name: string;
  position: string;
  recorder: string;
  recorderId: string;
  isOffline: boolean;
  canPlayback: boolean;
}

const SHARE_ACTION = 'video.monitoring:deljenje';

function canShare(req: Request): boolean {
  return !!req.access && hasAction(req.access, SHARE_ACTION);
}

/** Role koje imaju pristup stranici Monitoring (Super admin rola ili bar nivo „Pregled“); samo sa njima se tab može deliti */
function rolesWithMonitoringAccess() {
  return listRoles().filter(role => {
    if (role.isSuperAdmin) return true;
    const grants = new Map(getRolePermissions(role.id).map(p => [p.key, { level: p.level, actions: new Set(p.actions) }]));
    const fake = { isSuperAdmin: false, grants } as unknown as EffectiveAccess;
    return levelFor(fake, 'video.monitoring') !== 'none';
  });
}

/** Role korisnika (bez ugrađene Super admin oznake, koja nije prava rola u bazi) */
function userRoleIds(req: Request): string[] {
  return (req.access?.roles || []).filter(r => r.id !== 'builtin').map(r => r.id);
}

function sharedTabsFor(req: Request, key: string): MonitoringTab[] {
  const hidden = new Set(getSettings(key).hiddenShared);
  return listSharedTabsForRoles(userRoleIds(req), key).map(t => ({ ...t, hidden: hidden.has(t.id) }));
}

/** Kamere koje korisnik sme da gleda uživo (samo IP kamere koje nisu rezervisane) */
function liveCameras(access: EffectiveAccess): MonitoringCamera[] {
  const rows = getDb()
    .prepare(`SELECT id, ip, name, position, recorder, recorder_id FROM cameras
              WHERE COALESCE(is_reserved, 0) = 0 AND type = 'IP Kamera' AND TRIM(COALESCE(ip, '')) <> ''
              ORDER BY recorder, position, name`)
    .all() as { id: string; ip: string; name: string; position: string | null; recorder: string | null; recorder_id: string | null }[];

  let offlineIps = new Set<string>();
  try {
    offlineIps = new Set(getCachedOfflineCamerasInfoSync().offlineCameras.map((c: any) => String(c.ip || '').trim()));
  } catch {
    // keš statusa još nije spreman
  }

  const out: MonitoringCamera[] = [];
  for (const r of rows) {
    const rights = cameraRights(access, { id: r.id, recorderId: r.recorder_id });
    if (!rights.live) continue;
    const ip = r.ip.trim();
    out.push({
      id: r.id,
      ip,
      name: r.name || '',
      position: r.position || '',
      recorder: r.recorder || '',
      recorderId: r.recorder_id || '',
      isOffline: offlineIps.has(ip),
      canPlayback: rights.playback
    });
  }
  return out;
}

/**
 * Nova dodela kamere se dozvoljava samo za kamere sa pravom "uživo".
 * Kamere koje su već bile u tabu ostaju (i kad pravo istekne) da preimenovanje ne bi palo;
 * takvo polje se u prikazu vidi kao "Nema pristupa".
 */
function assertCameraRights(req: Request, cameras: unknown, previous: (string | null)[] = []): void {
  if (!Array.isArray(cameras) || !req.access) return;
  const allowed = new Set(liveCameras(req.access).map(c => c.id));
  const before = new Set(previous.filter(Boolean) as string[]);
  for (const v of cameras) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const id = v.trim();
    if (!allowed.has(id) && !before.has(id)) {
      throw new Error('Jedna od izabranih kamera nije dostupna ili nemate pravo da je gledate uživo.');
    }
  }
}

/* ---------- Kompletno stanje za stranicu ---------- */
monitoringRouter.get('/state', (req: Request, res: Response) => {
  try {
    const key = owner(req);
    const shares = listSharesForOwner(key);
    res.json({
      success: true,
      tabs: listTabs(key).map(t => ({ ...t, sharedWith: shares.get(t.id) || [] })),
      sharedTabs: sharedTabsFor(req, key),
      canShare: canShare(req),
      templates: listTemplates(key),
      settings: getSettings(key),
      cameras: liveCameras(req.access!),
      limits: { maxCells: MAX_CELLS, maxGrid: MAX_GRID, maxTabs: MAX_TABS, warnStreams: 16 }
    });
  } catch (err) {
    fail(res, err, 500);
  }
});

/* ---------- Tabovi ---------- */
monitoringRouter.get('/tabs/:id', (req: Request, res: Response) => {
  try {
    const key = owner(req);
    const tab = getTab(key, req.params.id) || getSharedTab(userRoleIds(req), key, req.params.id);
    if (!tab) return fail(res, new Error('Tab nije pronađen.'), 404);
    res.json({ success: true, tab, cameras: liveCameras(req.access!), settings: getSettings(key) });
  } catch (err) {
    fail(res, err, 500);
  }
});

monitoringRouter.post('/tabs', (req: Request, res: Response) => {
  try {
    assertCameraRights(req, req.body?.cameras);
    const tab = createTab(owner(req), req.body || {});
    res.status(201).json({ success: true, tab });
  } catch (err) {
    fail(res, err);
  }
});

monitoringRouter.put('/tabs/order', (req: Request, res: Response) => {
  try {
    res.json({ success: true, tabs: reorderTabs(owner(req), req.body?.ids) });
  } catch (err) {
    fail(res, err);
  }
});

monitoringRouter.put('/tabs/:id', (req: Request, res: Response) => {
  try {
    const key = owner(req);
    const current = getTab(key, req.params.id);
    if (!current) {
      if (getSharedTab(userRoleIds(req), key, req.params.id)) {
        return fail(res, new Error('Deljeni tab ne možete menjati. Napravite svoju kopiju.'), 403);
      }
      return fail(res, new Error('Tab nije pronađen.'), 404);
    }
    assertCameraRights(req, req.body?.cameras, current.cameras);
    res.json({ success: true, tab: updateTab(key, req.params.id, req.body || {}) });
  } catch (err) {
    fail(res, err);
  }
});

monitoringRouter.post('/tabs/:id/duplicate', (req: Request, res: Response) => {
  try {
    const key = owner(req);
    if (getTab(key, req.params.id)) {
      return res.status(201).json({ success: true, tab: duplicateTab(key, req.params.id) });
    }
    // Kopija deljenog taba: postaje običan lični tab; kamere bez prava "uživo" ostaju prazna polja
    const src = getSharedTab(userRoleIds(req), key, req.params.id);
    if (!src) return fail(res, new Error('Tab nije pronađen.'), 404);
    const allowed = new Set(liveCameras(req.access!).map(c => c.id));
    const cameras = src.cameras.map(id => (id && allowed.has(id) ? id : null));
    const name = `${src.name} (moja kopija)`.slice(0, 60);
    res.status(201).json({ success: true, tab: createTab(key, { name, templateId: src.templateId, layout: src.layout, cameras }) });
  } catch (err) {
    fail(res, err);
  }
});

monitoringRouter.delete('/tabs/:id', (req: Request, res: Response) => {
  try {
    deleteTab(owner(req), req.params.id);
    res.json({ success: true });
  } catch (err) {
    fail(res, err, 404);
  }
});

/* ---------- Deljenje tabova sa rolama ---------- */
/** Role koje se mogu izabrati; uz tab: koliko njegovih kamera članovi role ne smeju da gledaju uživo */
monitoringRouter.get('/share-roles', (req: Request, res: Response) => {
  try {
    if (!canShare(req)) return fail(res, new Error('Nemate pravo da delite tabove.'), 403);
    const key = owner(req);
    const tab = req.query.tabId ? getTab(key, String(req.query.tabId)) : null;
    const camIds = tab ? [...new Set(tab.cameras.filter((c): c is string => !!c))] : [];
    const cams = camIds.map(id => lookupCameraById(id)).filter((c): c is NonNullable<typeof c> => !!c);

    const roles = rolesWithMonitoringAccess().map(role => {
      let missing = 0;
      if (cams.length && !role.isSuperAdmin) {
        const camRules = getRoleCameraAccess(role.id).map(r => ({
          roleName: role.name, scope: r.scope, targetId: r.targetId, canLive: r.canLive, canPlayback: r.canPlayback
        }));
        const groupIds = [...new Set(camRules.filter(r => r.scope === 'group').map(r => r.targetId))];
        const fake = { isSuperAdmin: false, camRules, groupMembers: getCameraGroupMembersMap(groupIds) } as unknown as EffectiveAccess;
        missing = cams.filter(c => !cameraRights(fake, c).live).length;
      }
      return {
        id: role.id,
        name: role.name,
        description: role.description || '',
        isSuperAdmin: role.isSuperAdmin,
        assignmentCount: role.assignmentCount,
        missingCameras: missing
      };
    });
    res.json({ success: true, roles, cameraCount: cams.length });
  } catch (err) {
    fail(res, err);
  }
});

monitoringRouter.put('/tabs/:id/shares', (req: Request, res: Response) => {
  try {
    if (!canShare(req)) return fail(res, new Error('Nemate pravo da delite tabove.'), 403);
    const key = owner(req);
    const before = (listSharesForOwner(key).get(req.params.id) || []).map(s => s.roleName);
    if (Array.isArray(req.body?.roleIds)) {
      const eligible = new Set(rolesWithMonitoringAccess().map(r => r.id));
      if (req.body.roleIds.some((id: unknown) => !eligible.has(String(id)))) {
        return fail(res, new Error('Tab se može podeliti samo sa rolama koje imaju pristup Monitoringu.'));
      }
    }
    const shares = setTabShares(key, req.params.id, req.body?.roleIds, key);
    const tab = getTab(key, req.params.id);
    writeAudit(
      req.sessionUser || null, 'monitoring.share', 'monitoring_tab', req.params.id,
      `Tab „${tab?.name || ''}“: podeljen sa [${shares.map(s => s.roleName).join(', ') || 'nijednom ulogom'}] (ranije: [${before.join(', ') || '-'}])`
    );
    res.json({ success: true, sharedWith: shares });
  } catch (err) {
    fail(res, err);
  }
});

/* ---------- Custom šabloni ---------- */
monitoringRouter.post('/templates', (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, template: createTemplate(owner(req), req.body || {}) });
  } catch (err) {
    fail(res, err);
  }
});

monitoringRouter.put('/templates/:id', (req: Request, res: Response) => {
  try {
    res.json({ success: true, template: updateTemplate(owner(req), req.params.id, req.body || {}) });
  } catch (err) {
    fail(res, err);
  }
});

monitoringRouter.delete('/templates/:id', (req: Request, res: Response) => {
  try {
    deleteTemplate(owner(req), req.params.id);
    res.json({ success: true });
  } catch (err) {
    fail(res, err, 404);
  }
});

/* ---------- Podešavanja (rotacija, poslednji tab) ---------- */
monitoringRouter.put('/settings', (req: Request, res: Response) => {
  try {
    res.json({ success: true, settings: saveSettings(owner(req), req.body || {}) });
  } catch (err) {
    fail(res, err);
  }
});
