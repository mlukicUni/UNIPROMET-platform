import { Router, Request, Response } from 'express';
import {
  getAllCameraInventory,
  getCameraInventoryById,
  addCameraInventoryItem,
  updateCameraInventoryItem,
  deleteCameraInventoryItem
} from '../db/cameraInventoryDb';
import { getCameraCredentials } from '../services/cameraLiveService';
import {
  getRecordersInventory,
  addRecorder,
  updateRecorder,
  deleteRecorder
} from '../db/recorderInventoryDb';
import { checkAllRecordersStatus, checkSingleRecorder } from '../services/recorderScanner';
import {
  getAllRfReaders,
  getRfReaderById,
  addRfReader,
  updateRfReader,
  deleteRfReader,
  pingSingleRfReader,
  pingAllRfReaders,
  updateRfReaderPingStatus
} from '../db/rfReaderDb';
import {
  getAllWifiAps,
  getWifiApById,
  upsertWifiAps,
  getLiveWifiClients,
  setLiveWifiClients,
  getClusterSummary,
  setClusterSummary
} from '../db/wifiApDb';
import {
  fetchArubaAps,
  fetchArubaClients,
  fetchArubaSummary
} from '../services/arubaService';
import { addServerLog } from './system.routes';
import { hasLevel, filterCamerasByAccess, liveCameraIdSet, accessibleRecorderIds } from '../services/accessService';

export const inventoryRouter = Router();

// ============================================================================
// EVIDENCIJA KAMERA (CAMERAS INVENTORY)
// ============================================================================

// GET /api/inventory/cameras - List all registered cameras
inventoryRouter.get('/cameras', async (req: Request, res: Response) => {
  try {
    let rawItems = getAllCameraInventory();
    // Korisnici bez prava nad stranicom inventara vide samo kamere kojima imaju pristup po roli
    const restrictToAccess = !!req.access && !hasLevel(req.access, 'mreza.kamere', 'view');
    if (restrictToAccess) rawItems = filterCamerasByAccess(req.access!, rawItems);
    const total = rawItems.length;
    const active = rawItems.filter(c => !c.isReserved).length;
    const reserved = rawItems.filter(c => c.isReserved).length;
    const analog = rawItems.filter(c => c.type === 'Analogna').length;
    const ipCameras = rawItems.filter(c => c.type === 'IP Kamera').length;
    const recorders = [...new Set(rawItems.map(c => c.recorder).filter(Boolean))].sort();

    // Cross-reference live offline status
    let offlineCamerasList: any[] = [];
    let offlineIps = new Set<string>();
    let lastOfflineCheckTime: string | null = null;
    try {
      const { getCachedOfflineCamerasInfoSync } = await import('../services/cameraScanner');
      const offlineInfo = getCachedOfflineCamerasInfoSync();
      offlineCamerasList = offlineInfo.offlineCameras || [];
      if (restrictToAccess) {
        const allowedIps = new Set(rawItems.map(c => (c.ip || '').trim()));
        offlineCamerasList = offlineCamerasList.filter((c: any) => allowedIps.has((c.ip || '').trim()));
      }
      lastOfflineCheckTime = offlineInfo.lastScanTime || null;
      offlineIps = new Set(offlineCamerasList.map((c: any) => (c.ip || '').trim()));
    } catch (e) {
      console.warn('Could not fetch cached offline cameras:', e);
    }

    // Žive pločice u listi samo za kamere za koje korisnik ima pravo "uživo"
    const liveIds = req.access ? liveCameraIdSet(req.access) : null;

    const items = rawItems.map(c => {
      const ip = (c.ip || '').trim();
      const isOffline = !c.isReserved && c.type === 'IP Kamera' && offlineIps.has(ip);
      const isOnline = !c.isReserved && c.type === 'IP Kamera' && !isOffline;

      let streamWsSubUrl: string | undefined;
      if (c.ip && c.type === 'IP Kamera' && (!liveIds || liveIds.has(c.id))) {
        const streamKey = `cam_${ip.replace(/\./g, '_')}_sub`;
        streamWsSubUrl = `/api/video-gateway/ws?src=${streamKey}`;
      }

      return {
        ...c,
        isOffline,
        isOnline,
        streamWsSubUrl
      };
    });

    res.json({
      success: true,
      total,
      active,
      reserved,
      analog,
      ipCameras,
      recorders,
      offlineCount: offlineCamerasList.length,
      offlineCameras: offlineCamerasList,
      lastOfflineCheckTime,
      cameras: items
    });
  } catch (err: any) {
    console.error('Get camera inventory error:', err);
    res.status(500).json({ error: 'Failed to fetch camera inventory', details: err?.message });
  }
});

// POST /api/inventory/cameras/scan-unrecorded - Scan camera ranges skipping known inventory
inventoryRouter.post('/cameras/scan-unrecorded', async (_req: Request, res: Response) => {
  try {
    const { scanUnrecordedCameras } = await import('../services/cameraScanner');
    const result = await scanUnrecordedCameras();
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Scan unrecorded cameras error:', err);
    res.status(500).json({ error: 'Failed to scan for unrecorded cameras', details: err?.message });
  }
});

// GET /api/inventory/cameras/scan-unrecorded (Fallback)
inventoryRouter.get('/cameras/scan-unrecorded', async (_req: Request, res: Response) => {
  try {
    const { scanUnrecordedCameras } = await import('../services/cameraScanner');
    const result = await scanUnrecordedCameras();
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Scan unrecorded cameras error:', err);
    res.status(500).json({ error: 'Failed to scan for unrecorded cameras', details: err?.message });
  }
});

// GET /api/inventory/cameras/:id - Get single camera record
inventoryRouter.get('/cameras/:id', (req: Request, res: Response) => {
  try {
    const item = getCameraInventoryById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Camera record not found' });
    }
    res.json({ success: true, camera: item });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch camera', details: err?.message });
  }
});

/** IPv4 iz privatnih opsega (10.x, 172.16-31.x, 192.168.x); server ne sme da proverava proizvoljne spoljne adrese */
function isPrivateIpv4(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const o = ip.split('.').map(Number);
  if (o.some(n => n > 255)) return false;
  if (o[3] === 0 || o[3] === 255) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

// POST /api/inventory/cameras/probe - Provera jedne IP adrese (ručno dodavanje), bez skeniranja opsega
// Odgovor: status 'in_inventory' | 'found' | 'not_found'
inventoryRouter.post('/cameras/probe', async (req: Request, res: Response) => {
  try {
    const ip = String(req.body?.ip ?? '').trim();
    if (!isPrivateIpv4(ip)) {
      return res.status(400).json({ error: 'Unesite ispravnu IP adresu iz lokalne mreže (npr. 192.168.125.106).' });
    }

    const existing = getAllCameraInventory().find(c => (c.ip || '').trim() === ip);
    if (existing) {
      return res.json({
        success: true,
        status: 'in_inventory',
        ip,
        camera: { id: existing.id, name: existing.name, position: existing.position, recorder: existing.recorder }
      });
    }

    const { probeCameraByIp } = await import('../services/cameraScanner');
    const found = await probeCameraByIp(ip);
    addServerLog('info', `Ručna provera kamere na adresi ${ip}: ${found ? 'pronađena (' + found.vendor + ')' : 'nije pronađena'}`, 'Inventory DB');
    if (!found) return res.json({ success: true, status: 'not_found', ip });

    res.json({
      success: true,
      status: 'found',
      ip,
      camera: { ip: found.ip, vendor: found.vendor, openPorts: found.openPorts, webUrl: found.webUrl, pingMs: found.pingMs, serverBanner: found.serverBanner || '' }
    });
  } catch (err: any) {
    console.error('Probe camera error:', err);
    res.status(500).json({ error: 'Provera adrese nije uspela', details: err?.message });
  }
});

// POST /api/inventory/cameras - Add new camera to SQLite inventory
inventoryRouter.post('/cameras', (req: Request, res: Response) => {
  try {
    const { ip, name, recorder, position, type, subnet, note, isReserved, credProfile } = req.body;
    if (!ip || !ip.trim()) {
      return res.status(400).json({ error: 'IP adresa ili oznaka slota je obavezna' });
    }
    if (credProfile !== undefined && credProfile !== 1 && credProfile !== 2) {
      return res.status(400).json({ error: 'Lozinka kamere mora biti 1 ili 2' });
    }

    const newItem = addCameraInventoryItem({
      ip: ip.trim(),
      name: name?.trim() || position?.trim() || `Kamera ${ip.trim()}`,
      recorder: recorder?.trim() || 'Nedodeljeno',
      position: position?.trim() || 'Pozicija kamere',
      type: type || (ip.toLowerCase().includes('analog') ? 'Analogna' : 'IP Kamera'),
      subnet: subnet || (ip.includes('124.') ? '192.168.124.x' : ip.includes('125.') ? '192.168.125.x' : 'Ostalo'),
      note: note?.trim() || '',
      isReserved: !!isReserved,
      credProfile: credProfile === 2 ? 2 : 1
    });

    addServerLog('success', `Dodata nova kamera u SQLite bazu: ${newItem.name} (${newItem.ip})`, 'Inventory DB');
    res.status(201).json({ success: true, message: 'Kamera uspešno dodata u evidenciju', camera: newItem });
  } catch (err: any) {
    console.error('Add camera error:', err);
    res.status(500).json({ error: 'Failed to add camera', details: err?.message });
  }
});

// PUT /api/inventory/cameras/:id - Update camera in SQLite inventory
inventoryRouter.put('/cameras/:id', (req: Request, res: Response) => {
  try {
    const credProfile = req.body?.credProfile;
    if (credProfile !== undefined && credProfile !== 1 && credProfile !== 2) {
      return res.status(400).json({ error: 'Lozinka kamere mora biti 1 ili 2' });
    }
    const updated = updateCameraInventoryItem(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Camera record not found' });
    }

    addServerLog('info', `Ažurirani podaci o kameri: ${updated.name} (${updated.ip})`, 'Inventory DB');
    res.json({ success: true, message: 'Podaci o kameri uspešno ažurirani', camera: updated });
  } catch (err: any) {
    console.error('Update camera error:', err);
    res.status(500).json({ error: 'Failed to update camera', details: err?.message });
  }
});

// DELETE /api/inventory/cameras/:id - Delete camera from SQLite inventory
inventoryRouter.delete('/cameras/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteCameraInventoryItem(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Camera record not found' });
    }

    addServerLog('warn', `Obrisana kamera iz baze (ID: ${req.params.id})`, 'Inventory DB');
    res.json({ success: true, message: 'Kamera uspešno obrisana iz evidencije' });
  } catch (err: any) {
    console.error('Delete camera error:', err);
    res.status(500).json({ error: 'Failed to delete camera', details: err?.message });
  }
});

// ============================================================================
// EVIDENCIJA SNIMAČA (RECORDERS INVENTORY)
// ============================================================================

// GET /api/inventory/recorders - List all video recorders
inventoryRouter.get('/recorders', (req: Request, res: Response) => {
  try {
    let recorders = getRecordersInventory();
    // Korisnici samo sa video pravima vide samo snimače svojih kamera
    if (req.access && !hasLevel(req.access, 'mreza.snimaci', 'view') && !hasLevel(req.access, 'mreza.kamere', 'view')) {
      const ids = accessibleRecorderIds(req.access);
      if (ids) recorders = recorders.filter(r => ids.has(r.id));
    }
    const total = recorders.length;
    const subnet124 = recorders.filter(r => r.subnet && r.subnet.includes('124.')).length;
    const subnet125 = recorders.filter(r => r.subnet && r.subnet.includes('125.')).length;
    const totalCameras = recorders.reduce((acc, r) => acc + (r.camerasCount || 0), 0);
    const offlineCount = recorders.filter(r => r.status === 'offline').length;
    const onlineCount = recorders.filter(r => r.status === 'online').length;

    // Determine latest check timestamp
    let lastCheckedAt: string | null = null;
    recorders.forEach(r => {
      if (r.lastCheckedAt) {
        if (!lastCheckedAt || new Date(r.lastCheckedAt).getTime() > new Date(lastCheckedAt).getTime()) {
          lastCheckedAt = r.lastCheckedAt;
        }
      }
    });

    res.json({
      success: true,
      total,
      subnet124,
      subnet125,
      totalCameras,
      offlineCount,
      onlineCount,
      lastCheckedAt,
      recorders
    });
  } catch (err: any) {
    console.error('Fetch recorders error:', err);
    res.status(500).json({ error: 'Failed to fetch recorders inventory', details: err?.message });
  }
});

// POST /api/inventory/recorders/check-status - Trigger full availability check of all recorders
inventoryRouter.post('/recorders/check-status', async (_req: Request, res: Response) => {
  try {
    const result = await checkAllRecordersStatus();
    addServerLog(
      result.offlineCount > 0 ? 'warn' : 'info',
      `Završena provera snimača: ${result.onlineCount}/${result.total} online (${result.offlineCount} offline)`,
      'RecorderCheck'
    );
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Check all recorders error:', err);
    res.status(500).json({ error: 'Failed to check recorders status', details: err?.message });
  }
});

// POST /api/inventory/recorders/:id/check-status - Check single recorder availability
inventoryRouter.post('/recorders/:id/check-status', async (req: Request, res: Response) => {
  try {
    const list = getRecordersInventory();
    const item = list.find(r => r.id === req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Recorder not found' });
    }
    const result = await checkSingleRecorder(item);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to check recorder', details: err?.message });
  }
});

// GET /api/inventory/recorders/:id - Get single recorder
inventoryRouter.get('/recorders/:id', (req: Request, res: Response) => {
  try {
    const list = getRecordersInventory();
    const item = list.find(r => r.id === req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Recorder not found' });
    }
    if (req.access && !hasLevel(req.access, 'mreza.snimaci', 'view') && !hasLevel(req.access, 'mreza.kamere', 'view')) {
      const ids = accessibleRecorderIds(req.access);
      if (ids && !ids.has(item.id)) {
        return res.status(403).json({ success: false, forbidden: true, error: 'Nemate dozvolu za ovu akciju.' });
      }
    }
    res.json({ success: true, recorder: item });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch recorder', details: err?.message });
  }
});

// POST /api/inventory/recorders - Add new recorder
inventoryRouter.post('/recorders', (req: Request, res: Response) => {
  try {
    const { name, location, ip, model, type, subnet, camerasCount, channels, status, note } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Naziv snimača je obavezan' });
    }

    const newRecorder = addRecorder({
      name: name.trim(),
      location: location?.trim() || name.trim(),
      ip: ip?.trim() || '',
      model: model?.trim() || 'Hikvision NVR',
      type: type || 'NVR',
      subnet: subnet || (ip && ip.includes('124.') ? '192.168.124.x' : '192.168.125.x'),
      camerasCount: Number(camerasCount) || 0,
      channels: Number(channels) || 32,
      status: status || 'online',
      note: note?.trim() || ''
    });

    addServerLog('success', `Dodat novi snimač u SQLite bazu: ${newRecorder.name} (${newRecorder.ip})`, 'Inventory DB');
    res.status(201).json({ success: true, message: 'Snimač uspešno dodat u evidenciju', recorder: newRecorder });
  } catch (err: any) {
    console.error('Add recorder error:', err);
    res.status(500).json({ error: 'Failed to add recorder', details: err?.message });
  }
});

// PUT /api/inventory/recorders/:id - Update recorder
inventoryRouter.put('/recorders/:id', (req: Request, res: Response) => {
  try {
    const updated = updateRecorder(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Recorder not found' });
    }

    addServerLog('info', `Ažuriran snimač: ${updated.name} (${updated.ip})`, 'Inventory DB');
    res.json({ success: true, message: 'Podaci o snimaču uspešno ažurirani', recorder: updated });
  } catch (err: any) {
    console.error('Update recorder error:', err);
    res.status(500).json({ error: 'Failed to update recorder', details: err?.message });
  }
});

// DELETE /api/inventory/recorders/:id - Delete recorder
inventoryRouter.delete('/recorders/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteRecorder(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Recorder not found' });
    }

    addServerLog('warn', `Obrisan snimač iz baze (ID: ${req.params.id})`, 'Inventory DB');
    res.json({ success: true, message: 'Snimač uspešno obrisan iz evidencije' });
  } catch (err: any) {
    console.error('Delete recorder error:', err);
    res.status(500).json({ error: 'Failed to delete recorder', details: err?.message });
  }
});

// ============================================================================
// EVIDENCIJA RF ČITAČA (TIME & ATTENDANCE RFID READERS)
// ============================================================================

// GET /api/inventory/rf-readers - List all registered RF Readers
inventoryRouter.get('/rf-readers', (_req: Request, res: Response) => {
  try {
    const readers = getAllRfReaders();
    const total = readers.length;
    const online = readers.filter(r => r.status === 'online').length;
    const offline = readers.filter(r => r.status === 'offline').length;
    const locations = [...new Set(readers.map(r => r.location))].sort();
    const directions = [...new Set(readers.map(r => r.direction))].sort();

    res.json({
      success: true,
      total,
      online,
      offline,
      locations,
      directions,
      readers
    });
  } catch (err: any) {
    console.error('Get RF readers error:', err);
    res.status(500).json({ error: 'Failed to fetch RF readers', details: err?.message });
  }
});

// GET /api/inventory/rf-readers/:id - Get single RF reader
inventoryRouter.get('/rf-readers/:id', (req: Request, res: Response) => {
  try {
    const reader = getRfReaderById(req.params.id);
    if (!reader) {
      return res.status(404).json({ error: 'RF čitač nije pronađen' });
    }
    res.json({ success: true, reader });
  } catch (err: any) {
    console.error('Get single RF reader error:', err);
    res.status(500).json({ error: 'Failed to get RF reader', details: err?.message });
  }
});

// POST /api/inventory/rf-readers - Add new RF Reader
inventoryRouter.post('/rf-readers', (req: Request, res: Response) => {
  try {
    const { name, location, direction, ip, port, model, status, note } = req.body;

    if (!name || !ip || !location || !direction) {
      return res.status(400).json({ error: 'Polja naziv, IP adresa, lokacija i smer su obavezna.' });
    }

    const newReader = addRfReader({
      name: name.trim(),
      location: location.trim(),
      direction: direction.trim(),
      ip: ip.trim(),
      port: Number(port) || 4370,
      model: model?.trim() || 'ZKTeco / Secutime RFID',
      status: status || 'online',
      note: note?.trim() || ''
    });

    addServerLog('success', `Dodat novi RF čitač: ${newReader.name} (${newReader.ip})`, 'Inventory DB');
    res.status(201).json({ success: true, message: 'RF čitač uspešno evidentiran', reader: newReader });
  } catch (err: any) {
    console.error('Add RF reader error:', err);
    res.status(500).json({ error: 'Failed to add RF reader', details: err?.message });
  }
});

// PUT /api/inventory/rf-readers/:id - Update RF Reader
inventoryRouter.put('/rf-readers/:id', (req: Request, res: Response) => {
  try {
    const updated = updateRfReader(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'RF čitač nije pronađen' });
    }

    addServerLog('info', `Ažuriran RF čitač: ${updated.name} (${updated.ip})`, 'Inventory DB');
    res.json({ success: true, message: 'RF čitač uspešno ažuriran', reader: updated });
  } catch (err: any) {
    console.error('Update RF reader error:', err);
    res.status(500).json({ error: 'Failed to update RF reader', details: err?.message });
  }
});

// DELETE /api/inventory/rf-readers/:id - Delete RF Reader
inventoryRouter.delete('/rf-readers/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteRfReader(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'RF čitač nije pronađen' });
    }

    addServerLog('warn', `Obrisan RF čitač (ID: ${req.params.id})`, 'Inventory DB');
    res.json({ success: true, message: 'RF čitač uspešno obrisan iz evidencije' });
  } catch (err: any) {
    console.error('Delete RF reader error:', err);
    res.status(500).json({ error: 'Failed to delete RF reader', details: err?.message });
  }
});

// POST /api/inventory/rf-readers/ping - Live ping test for all RF readers
inventoryRouter.post('/rf-readers/ping', async (_req: Request, res: Response) => {
  try {
    const updatedReaders = await pingAllRfReaders();
    const online = updatedReaders.filter(r => r.status === 'online').length;
    const offline = updatedReaders.filter(r => r.status === 'offline').length;

    addServerLog('info', `Izvršen brzi ping test svih RF čitača (Online: ${online}, Offline: ${offline})`, 'RF Monitor');
    res.json({
      success: true,
      message: `Pingovano ${updatedReaders.length} RF čitača (${online} online, ${offline} offline)`,
      total: updatedReaders.length,
      online,
      offline,
      readers: updatedReaders
    });
  } catch (err: any) {
    console.error('Ping RF readers error:', err);
    res.status(500).json({ error: 'Failed to ping RF readers', details: err?.message });
  }
});

// POST /api/inventory/rf-readers/:id/ping - Ping single RF reader
inventoryRouter.post('/rf-readers/:id/ping', async (req: Request, res: Response) => {
  try {
    const reader = getRfReaderById(req.params.id);
    if (!reader) {
      return res.status(404).json({ error: 'RF čitač nije pronađen' });
    }

    const pingRes = await pingSingleRfReader(reader.ip, reader.port || 4370);
    updateRfReaderPingStatus(reader.id, pingRes.online ? 'online' : 'offline', pingRes.online ? pingRes.latencyMs : undefined);
    const updated = getRfReaderById(req.params.id);

    res.json({
      success: true,
      online: pingRes.online,
      latencyMs: pingRes.latencyMs,
      reader: updated
    });
  } catch (err: any) {
    console.error('Ping single RF reader error:', err);
    res.status(500).json({ error: 'Failed to ping RF reader', details: err?.message });
  }
});

// ============================================================================
// EVIDENCIJA WIFI ACCESS POINTS (ARUBA INSTANT ON / SWARM)
// ============================================================================

// GET /api/inventory/wifi-aps - List all WiFi Access Points
inventoryRouter.get('/wifi-aps', async (_req: Request, res: Response) => {
  try {
    let aps = getAllWifiAps();

    // Auto-sync from Aruba controller on first run if database table is empty
    if (aps.length === 0) {
      try {
        const liveAps = await fetchArubaAps();
        if (liveAps.length > 0) {
          upsertWifiAps(liveAps);
          aps = getAllWifiAps();
          // Also fetch clients and summary in background
          fetchArubaClients().then(setLiveWifiClients).catch(() => {});
          fetchArubaSummary().then(setClusterSummary).catch(() => {});
        }
      } catch (syncErr: any) {
        console.warn('[WiFi APs] Initial auto-sync from controller failed:', syncErr?.message);
      }
    }

    const total = aps.length;
    const online = aps.filter(a => a.status === 'online').length;
    const offline = aps.filter(a => a.status === 'offline').length;
    const indoor = aps.filter(a => !a.isOutdoor).length;
    const outdoor = aps.filter(a => a.isOutdoor).length;
    const conductor = aps.find(a => a.hierarchy === 'conductor');
    const totalClients = aps.reduce((acc, a) => acc + (a.clientsCount || 0), 0);
    const clusterSummary = getClusterSummary();

    res.json({
      success: true,
      total,
      online,
      offline,
      indoor,
      outdoor,
      totalClients,
      conductor: conductor ? { ip: conductor.ip, name: conductor.name } : { ip: '192.168.6.129', name: 'Server soba' },
      clusterSummary: {
        ...clusterSummary,
        totalAps: total,
        totalClients
      },
      aps
    });
  } catch (err: any) {
    console.error('Get WiFi APs error:', err);
    res.status(500).json({ error: 'Failed to fetch WiFi Access Points', details: err?.message });
  }
});

// POST /api/inventory/wifi-aps/sync - Force live refresh from Aruba controller
inventoryRouter.post('/wifi-aps/sync', async (_req: Request, res: Response) => {
  try {
    const liveAps = await fetchArubaAps();
    if (!liveAps || liveAps.length === 0) {
      throw new Error('Aruba kontroler nije vratio nijednu pristupnu tačku.');
    }

    upsertWifiAps(liveAps);
    const clients = await fetchArubaClients().catch(() => []);
    setLiveWifiClients(clients);

    const summary = await fetchArubaSummary().catch(() => null);
    if (summary) {
      setClusterSummary(summary);
    }

    const storedAps = getAllWifiAps();
    const total = storedAps.length;
    const online = storedAps.filter(a => a.status === 'online').length;
    const offline = storedAps.filter(a => a.status === 'offline').length;
    const indoor = storedAps.filter(a => !a.isOutdoor).length;
    const outdoor = storedAps.filter(a => a.isOutdoor).length;
    const conductor = storedAps.find(a => a.hierarchy === 'conductor');
    const totalClients = storedAps.reduce((acc, a) => acc + (a.clientsCount || 0), 0);

    addServerLog(
      'info',
      `Uspešna sinhronizacija sa Aruba Virtual Controller-om (${total} AP-ova, ${clients.length} aktivnih klijenata)`,
      'WiFi Swarm'
    );

    res.json({
      success: true,
      message: `Sinhronizovano ${total} pristupnih tačaka i ${clients.length} povezanih klijenata`,
      total,
      online,
      offline,
      indoor,
      outdoor,
      totalClients,
      conductor: conductor ? { ip: conductor.ip, name: conductor.name } : undefined,
      clusterSummary: getClusterSummary(),
      aps: storedAps
    });
  } catch (err: any) {
    console.error('Sync WiFi APs error:', err);
    addServerLog('error', `Greška pri sinhronizaciji WiFi AP-ova: ${err?.message}`, 'WiFi Swarm');
    res.status(500).json({ error: 'Failed to sync WiFi Access Points', details: err?.message });
  }
});

// GET /api/inventory/wifi-aps/clients - Get connected clients (optionally filtered by AP)
inventoryRouter.get('/wifi-aps/clients', async (req: Request, res: Response) => {
  try {
    const apName = typeof req.query.ap === 'string' ? req.query.ap : undefined;
    let clients = getLiveWifiClients(apName);

    // If cache is empty, fetch on demand
    if (clients.length === 0) {
      const freshClients = await fetchArubaClients().catch(() => []);
      setLiveWifiClients(freshClients);
      clients = getLiveWifiClients(apName);
    }

    res.json({
      success: true,
      total: clients.length,
      apFilter: apName || null,
      clients
    });
  } catch (err: any) {
    console.error('Get WiFi clients error:', err);
    res.status(500).json({ error: 'Failed to fetch WiFi clients', details: err?.message });
  }
});


