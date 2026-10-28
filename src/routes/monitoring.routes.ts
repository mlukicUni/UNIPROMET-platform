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
  MAX_CELLS,
  MAX_GRID,
  MAX_TABS
} from '../db/monitoringDb';
import { cameraRights, EffectiveAccess } from '../services/accessService';
import { getCachedOfflineCamerasInfoSync } from '../services/cameraScanner';

/**
 * Monitoring - lični tabovi sa gridovima kamera.
 * Montirano na /api/monitoring; routeAccess traži pregled stranice 'video.monitoring'.
 * Svaki korisnik vidi i menja isključivo svoje tabove i šablone.
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
    res.json({
      success: true,
      tabs: listTabs(key),
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
    const tab = getTab(key, req.params.id);
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
    if (!current) return fail(res, new Error('Tab nije pronađen.'), 404);
    assertCameraRights(req, req.body?.cameras, current.cameras);
    res.json({ success: true, tab: updateTab(key, req.params.id, req.body || {}) });
  } catch (err) {
    fail(res, err);
  }
});

monitoringRouter.post('/tabs/:id/duplicate', (req: Request, res: Response) => {
  try {
    res.status(201).json({ success: true, tab: duplicateTab(owner(req), req.params.id) });
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
