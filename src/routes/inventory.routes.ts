import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import {
  getAllCameraInventory,
  getCameraInventoryById,
  addCameraInventoryItem,
  updateCameraInventoryItem,
  deleteCameraInventoryItem,
  DuplicateCameraIpError,
  UnknownRecorderError
} from '../db/cameraInventoryDb';
import { getCameraCredentials } from '../services/cameraLiveService';
import { parseAnalogIp, discoverAnalogChannels, importAnalogChannels } from '../services/analogChannels';
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
import { getAllCameraStatuses } from '../services/cameraStatusService';
import { getSnapshotInfoMap } from '../services/cameraSnapshotService';

export const inventoryRouter = Router();

// ============================================================================
// EVIDENCIJA KAMERA (CAMERAS INVENTORY)
// ============================================================================

/* ==========================================================================
   IZVOZ TRENUTNOG PRIKAZA LISTE KAMERA (Excel, stil platforme)
   Klijent šalje redove koje trenutno prikazuje (filtri i pretraga primenjeni) i opis filtera.
   ========================================================================== */
const cleanCell = (v: unknown, max = 300): string => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);

const CAMERA_EXPORT_COLUMNS = [
  { header: '#', width: 6 },
  { header: 'IP / Mrežni slot', width: 20 },
  { header: 'Položaj / Naziv kamere', width: 34 },
  { header: 'Lokacija', width: 24 },
  { header: 'Snimač', width: 26 },
  { header: 'Tip kamere', width: 16 },
  { header: 'Mrežni opseg', width: 18 },
  { header: 'Status', width: 16 },
  { header: 'Napomena', width: 36 }
];

const STATUS_COLORS: Record<string, string> = {
  Online: 'FF047857',
  Offline: 'FFB91C1C',
  Analogna: 'FF1D4ED8',
  Rezervisano: 'FF64748B'
};

inventoryRouter.post('/cameras/export/excel', async (req: Request, res: Response) => {
  try {
    const raw = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (raw.length === 0) return res.status(400).json({ success: false, error: 'Nema kamera za izvoz u trenutnom prikazu.' });

    const rows = raw.slice(0, 5000).map((r: any) => ({
      address: cleanCell(r?.address, 120),
      name: cleanCell(r?.name),
      location: cleanCell(r?.location),
      recorder: cleanCell(r?.recorder),
      type: cleanCell(r?.type, 60),
      subnet: cleanCell(r?.subnet, 60),
      status: cleanCell(r?.status, 40),
      note: cleanCell(r?.note)
    }));
    const filterText = (Array.isArray(req.body?.filters) ? req.body.filters : [])
      .slice(0, 10)
      .map((f: unknown) => cleanCell(f, 160))
      .filter(Boolean)
      .join('   |   ');

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const dateFormatted = now.toLocaleDateString('sr-RS');
    const timeFormatted = now.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'UNIPROMET DOO ČAČAK';
    wb.lastModifiedBy = 'UNIPROMET Centralni IT Admin Panel';
    wb.created = now;
    const ws = wb.addWorksheet('Kamere', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 4, showGridLines: true }]
    });
    const lastCol = CAMERA_EXPORT_COLUMNS.length;
    const lastLetter = String.fromCharCode(64 + lastCol);

    // Red 1: tamna traka (kao na platformi) sa belim logotipom levo i naslovom desno; zlatna linija ispod
    const titleRow = ws.addRow(new Array(lastCol).fill(''));
    titleRow.height = 46;
    for (let c = 1; c <= lastCol; c++) {
      const bandCell = titleRow.getCell(c);
      bandCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      bandCell.border = { bottom: { style: 'medium', color: { argb: 'FFF59E0B' } } };
    }
    const logoPath = path.join(process.cwd(), 'public', 'assets', 'unipromet_logo.png');
    if (fs.existsSync(logoPath)) {
      const imageId = wb.addImage({ buffer: fs.readFileSync(logoPath) as any, extension: 'png' });
      ws.addImage(imageId, { tl: { col: 0.03, row: 0.2 }, ext: { width: 178, height: 38 } });
    }

    // Naslov u istoj traci, desno od logotipa
    ws.mergeCells(`C1:${lastLetter}1`);
    const titleCell = ws.getCell('C1');
    titleCell.value = 'UNIPROMET DOO ČAČAK — EVIDENCIJA KAMERA (VIDEO NADZOR)';
    titleCell.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    // Red 2: podnaslov sa datumom, brojem stavki i filterima
    const subtitleRow = ws.addRow([
      `Datum izvoza: ${dateFormatted} u ${timeFormatted}   |   Ukupno kamera: ${rows.length}${filterText ? `   |   ${filterText}` : ''}`
    ]);
    ws.mergeCells(`A2:${lastLetter}2`);
    subtitleRow.height = 22;
    const subCell = subtitleRow.getCell(1);
    subCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFF59E0B' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    // Red 4: razmak
    const sepRow = ws.addRow([]);
    sepRow.height = 8;

    // Red 5: zaglavlja
    const headerRow = ws.addRow(CAMERA_EXPORT_COLUMNS.map(c => c.header));
    headerRow.height = 28;
    headerRow.eachCell((cell, colIdx) => {
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF334155' } },
        bottom: { style: 'medium', color: { argb: 'FFF59E0B' } },
        left: { style: 'thin', color: { argb: 'FF334155' } },
        right: { style: 'thin', color: { argb: 'FF334155' } }
      };
      cell.alignment = { vertical: 'middle', horizontal: colIdx === 1 || colIdx === 6 || colIdx === 8 ? 'center' : 'left', indent: colIdx === 1 || colIdx === 6 || colIdx === 8 ? 0 : 1 };
    });

    // Podaci sa zebra prikazom
    rows.forEach((r: any, index: number) => {
      const isOnline = r.status === 'Online';
      const dataRow = ws.addRow([
        index + 1,
        r.address,
        r.name,
        r.location,
        r.recorder,
        r.type,
        r.subnet,
        r.status,
        r.note
      ]);
      dataRow.height = 22;
      const bg = index % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
      dataRow.eachCell((cell, colIdx) => {
        cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
        cell.alignment = { vertical: 'middle', horizontal: colIdx === 1 || colIdx === 6 || colIdx === 8 ? 'center' : 'left', indent: colIdx === 1 || colIdx === 6 || colIdx === 8 ? 0 : 1 };
        if (colIdx === 8 && STATUS_COLORS[r.status]) {
          cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: STATUS_COLORS[r.status] } };
        }
        if (colIdx === 2 && !isOnline) cell.font = { name: 'Consolas', size: 10, color: { argb: 'FF0F172A' } };
      });
    });

    // Širine kolona: najmanje zadate, a dovoljno za najduži tekst
    ws.columns.forEach((col, idx) => {
      let maxLen = 0;
      col.eachCell?.({ includeEmpty: false }, (cell, rowNumber) => {
        if (rowNumber >= 4) maxLen = Math.max(maxLen, cell.value ? String(cell.value).length : 0);
      });
      const min = CAMERA_EXPORT_COLUMNS[idx]?.width || 16;
      col.width = Math.min(Math.max(maxLen + 4, min), 55);
    });

    ws.autoFilter = { from: 'A4', to: `${lastLetter}4` };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Unipromet_Kamere_${dateStr}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error('[Inventory] Greška pri izvozu kamera u Excel:', err);
    res.status(500).json({ success: false, error: 'Greška pri generisanju Excel datoteke: ' + err.message });
  }
});

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

    // Poslednji poznat status iz tabele (provera na zahtev i zakazana provera); bez zapisa važi keš zakazane provere
    const statusMap = getAllCameraStatuses();
    const snapshotMap = getSnapshotInfoMap();

    const items = rawItems.map(c => {
      const ip = (c.ip || '').trim();
      const st = statusMap.get(ip);
      const checkable = !c.isReserved && (c.type === 'IP Kamera' || (c.type === 'Analogna' && !!parseAnalogIp(c.ip)));
      const isOffline = checkable && (st ? !st.online : (c.type === 'IP Kamera' && offlineIps.has(ip)));
      const isOnline = !c.isReserved && c.type === 'IP Kamera' && !isOffline;

      let streamWsSubUrl: string | undefined;
      const hasLiveSource = c.type === 'IP Kamera' || (c.type === 'Analogna' && !!parseAnalogIp(c.ip));
      if (c.ip && hasLiveSource && (!liveIds || liveIds.has(c.id))) {
        const streamKey = `cam_${ip.replace(/\./g, '_')}_sub`;
        streamWsSubUrl = `/api/video-gateway/ws?src=${streamKey}`;
      }

      return {
        ...c,
        isOffline,
        isOnline,
        offlineSince: isOffline && st ? st.since : null,
        statusCheckedAt: st ? st.checkedAt : null,
        snapshotAt: snapshotMap.get(c.id)?.takenAt || null,
        streamWsSubUrl
      };
    });

    // Spisak offline kamera prati isti status kao i lista
    if (statusMap.size > 0) {
      const now = new Date().toISOString();
      offlineCamerasList = items.filter(c => c.isOffline).map(c => ({
        id: c.id,
        ip: (c.ip || '').trim(),
        name: c.name || c.position || `Kamera ${c.ip}`,
        recorder: c.recorder || 'Nedodeljeno',
        position: c.position || 'Pozicija nepoznata',
        subnet: c.subnet || '',
        type: c.type || 'IP Kamera',
        note: c.note || '',
        isOnline: false,
        statusLabel: 'Nedostupna na mreži',
        reason: c.type === 'Analogna' ? 'Snimač ovog kanala ne odgovara' : 'Kamera ne odgovara ni na HTTP (port 80) ni na RTSP (port 554)',
        lastChecked: c.statusCheckedAt || now,
        offlineSince: c.offlineSince
      }));
    }

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
    const { ip, name, recorder, recorderId, location, position, type, subnet, note, isReserved, credProfile } = req.body;
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
      recorderId: typeof recorderId === 'string' && recorderId ? recorderId : (recorderId === null ? null : undefined),
      location: location?.trim() || recorder?.trim() || 'Nedodeljeno',
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
    if (err instanceof DuplicateCameraIpError) {
      return res.status(409).json({ error: err.message, existingId: err.existing.id });
    }
    if (err instanceof UnknownRecorderError) return res.status(400).json({ error: err.message });
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
    if (err instanceof DuplicateCameraIpError) {
      return res.status(409).json({ error: err.message, existingId: err.existing.id });
    }
    if (err instanceof UnknownRecorderError) return res.status(400).json({ error: err.message });
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
// ANALOGNI KANALI NA SNIMAČIMA
// ============================================================================

// POST /api/inventory/recorders/:id/analog-channels/scan - Pročita analogne kanale sa snimača (samo čitanje)
inventoryRouter.post('/recorders/:id/analog-channels/scan', async (req: Request, res: Response) => {
  try {
    const result = await discoverAnalogChannels(req.params.id);
    if (!result) return res.status(404).json({ error: 'Snimač nije pronađen u evidenciji' });
    addServerLog(
      'info',
      `Provera analognih kanala na snimaču ${result.recorder.name}: ${result.supported ? result.channels.filter(c => c.hasSignal).length + ' sa signalom od ' + result.channels.length : 'nema analognih kanala'}`,
      'Inventory DB'
    );
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Analog channel scan error:', err);
    res.status(500).json({ error: 'Provera analognih kanala nije uspela', details: err?.message });
  }
});

// POST /api/inventory/recorders/:id/analog-channels/import - Upis izabranih analognih kanala u evidenciju kamera
inventoryRouter.post('/recorders/:id/analog-channels/import', (req: Request, res: Response) => {
  try {
    const raw = req.body?.channels;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) {
      return res.status(400).json({ error: 'Izaberite bar jedan analogni kanal.' });
    }
    const items = raw.map((c: any) => ({
      channel: Number(c?.channel),
      name: typeof c?.name === 'string' ? c.name.slice(0, 120) : '',
      location: typeof c?.location === 'string' ? c.location.slice(0, 120) : ''
    }));
    const result = importAnalogChannels(req.params.id, items);
    if (!result) return res.status(404).json({ error: 'Snimač nije pronađen u evidenciji' });
    addServerLog('success', `Dodato analognih kanala u evidenciju: ${result.added.length} (preskočeno ${result.skipped.length})`, 'Inventory DB');
    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    if (err instanceof DuplicateCameraIpError) {
      return res.status(409).json({ error: err.message, existingId: err.existing.id });
    }
    console.error('Analog channel import error:', err);
    res.status(500).json({ error: 'Upis analognih kanala nije uspeo', details: err?.message });
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


