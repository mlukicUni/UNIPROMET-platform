import { Router, Request, Response } from 'express';
import {
  buildExport,
  tokenMatches,
  syncStatus,
  previewFromPeer,
  applyFromPeer,
  SyncError
} from '../services/cameraSyncService';
import { syncApiToken } from '../utils/appConfig';
import { writeAudit } from '../db/rolesDb';
import { addServerLog } from './system.routes';

/**
 * Sinhronizacija evidencije kamera i snimača između dva servera.
 *  - GET  /api/sync/cameras/export   za drugi server; bez prijave korisnika, štiti ga zajednički token (X-Sync-Token)
 *  - GET  /api/sync/cameras/status   Super admin: uloga ovog servera, da li je podešeno, naziv dugmeta
 *  - POST /api/sync/cameras/preview  Super admin: preuzima podatke sa drugog servera i vraća razlike
 *  - POST /api/sync/cameras/apply    Super admin: prepisuje lokalne kamere i snimače podacima sa drugog servera
 */
export const syncRouter = Router();

const deniedLogAt = new Map<string, number>();

syncRouter.get('/cameras/export', (req: Request, res: Response) => {
  // Bez podešenog tokena izvoz ne postoji
  if (!syncApiToken()) return res.status(404).json({ error: 'Not found' });

  const given = String(req.header('x-sync-token') || '');
  if (!tokenMatches(given)) {
    const ip = req.ip || req.socket.remoteAddress || '';
    const now = Date.now();
    if (now - (deniedLogAt.get(ip) || 0) > 60_000) {
      deniedLogAt.set(ip, now);
      writeAudit(null, 'sync.export.denied', 'cameras', ip, `Pokušaj preuzimanja evidencije kamera sa pogrešnim tokenom (adresa ${ip})`, false);
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const data = buildExport();
  addServerLog('info', `Izvoz evidencije kamera za sinhronizaciju: ${data.cameras.length} kamera, ${data.recorders.length} snimača`, 'Sync');
  res.setHeader('Cache-Control', 'no-store');
  res.json(data);
});

/** Ostalo: samo Super admin (routeAccess to već traži; ovde je dodatna provera) */
function requireSuperAdmin(req: Request, res: Response): boolean {
  if (!req.access?.isSuperAdmin) {
    res.status(403).json({ error: 'Samo Super admin može da sinhronizuje podatke.' });
    return false;
  }
  return true;
}

function fail(res: Response, err: unknown) {
  if (err instanceof SyncError) return res.status(err.status).json({ success: false, error: err.message });
  console.error('Sync error:', err);
  res.status(500).json({ success: false, error: (err as Error)?.message || 'Greška pri sinhronizaciji' });
}

syncRouter.get('/cameras/status', (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  res.json({ success: true, ...syncStatus() });
});

syncRouter.post('/cameras/preview', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    res.json({ success: true, preview: await previewFromPeer() });
  } catch (err) {
    fail(res, err);
  }
});

syncRouter.post('/cameras/apply', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ success: false, error: 'Prepisivanje mora biti potvrđeno.' });
    }
    const result = await applyFromPeer(String(req.body?.fingerprint || ''), req.sessionUser || null);
    const c = result.cameras, r = result.recorders;
    const details = `Evidencija kamera i snimača prepisana podacima sa servera ${result.peerHost}: kamere +${c.added} ~${c.changed} -${c.removed} (ukupno ${c.total}), snimači +${r.added} ~${r.changed} -${r.removed} (ukupno ${r.total}). Rezervna kopija: ${result.backupPath}`;
    writeAudit(req.sessionUser || null, 'sync.cameras.apply', 'cameras', result.peerHost, details);
    addServerLog('success', details, 'Sync');
    res.json({ success: true, result });
  } catch (err) {
    fail(res, err);
  }
});
