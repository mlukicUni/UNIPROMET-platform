import { Router, Request, Response } from 'express';
import {
  discoverAndSyncPrinters,
  getAllPrinters,
  updatePrinter,
  decommissionPrinter,
  restorePrinter,
  createCustomPrinter,
  deletePrinterPermanently,
  checkPrinterOnline,
  wakePrinter,
  wakeAllPrinters
} from '../services/printerService';
import { getFleetLowToners, getPrinterConsumables } from '../services/snmpService';
import { addServerLog } from './system.routes';

export const printerRouter = Router();

// GET /api/printers - List all printers with live status and DB custom data
printerRouter.get('/', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    let printers = force ? await discoverAndSyncPrinters(true, false) : await discoverAndSyncPrinters(false, false);

    if (req.query.includeDecommissioned === 'false') {
      printers = printers.filter(p => !p.isDecommissioned);
    }

    const activePrinters = printers.filter(p => !p.isDecommissioned);
    const onlineCount = activePrinters.filter(p => p.isOnline).length;
    const offlineCount = activePrinters.length - onlineCount;
    const decommissionedCount = printers.filter(p => p.isDecommissioned).length;

    res.json({
      total: printers.length,
      active: activePrinters.length,
      online: onlineCount,
      offline: offlineCount,
      decommissioned: decommissionedCount,
      printers
    });
  } catch (err: any) {
    console.error('Error fetching printers:', err);
    res.status(500).json({ error: 'Failed to retrieve printers', details: err?.message });
  }
});

// POST /api/printers/scan - Force fresh network scan & sync with SQLite database
printerRouter.post('/scan', async (_req: Request, res: Response) => {
  try {
    const printers = await discoverAndSyncPrinters(true, false);
    const activePrinters = printers.filter(p => !p.isDecommissioned);
    const onlineCount = activePrinters.filter(p => p.isOnline).length;

    addServerLog('info', `Sinhronizacija baze štampača: evidentirano ${printers.length} štampača (${onlineCount} online)`, 'Printer DB');

    res.json({
      success: true,
      total: printers.length,
      active: activePrinters.length,
      online: onlineCount,
      decommissioned: printers.filter(p => p.isDecommissioned).length,
      printers
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Printer scan failed', details: err?.message });
  }
});

// POST /api/printers - Add custom printer to SQLite database
printerRouter.post('/', (req: Request, res: Response) => {
  try {
    const { name, ip, location, model, customTag, notes } = req.body;
    if (!name || !ip) {
      return res.status(400).json({ error: 'Name and IP are required' });
    }

    const newPrinter = createCustomPrinter({ name, ip, location, model, customTag, notes });
    addServerLog('success', `Ručno dodat štampač u bazu: ${name} (${ip})`, 'Printer DB');

    res.status(201).json({ success: true, printer: newPrinter });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to add printer', details: err?.message });
  }
});

// GET /api/printers/low-toners - Scan fleet and return toners <= threshold%
printerRouter.get('/low-toners', async (req: Request, res: Response) => {
  try {
    const threshold = parseInt(req.query.threshold as string || '5', 10);
    const force = req.query.force === 'true';
    const result = await getFleetLowToners(isNaN(threshold) ? 5 : threshold, force);

    addServerLog(
      result.affectedPrintersCount > 0 ? 'warn' : 'info',
      `Skeniranje tonera (≤${result.threshold}%): pronađeno ${result.totalLowTonerItems} tonera za zamenu na ${result.affectedPrintersCount} štampača`,
      'Toner Monitor'
    );

    res.json(result);
  } catch (err: any) {
    console.error('Low toners scan error:', err);
    res.status(500).json({ error: 'Failed to scan low toners', details: err?.message });
  }
});

// POST /api/printers/wake-all - Send wake pulse to all printers
printerRouter.post('/wake-all', async (_req: Request, res: Response) => {
  try {
    const result = await wakeAllPrinters();
    addServerLog('success', `Poslat signal za buđenje na celokupnu fabričku flotu (${result.woken}/${result.total} aktivirano)`, 'Wake Engine');
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to wake all printers', details: err?.message });
  }
});

// PUT /api/printers/:id - Update printer custom tag, notes, name, location
printerRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = updatePrinter(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Printer not found in database' });
    }

    addServerLog('info', `Ažurirani podaci za štampač ${updated.name} (Oznaka: ${updated.customTag || '-'})`, 'Printer DB');
    res.json({ success: true, printer: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update printer', details: err?.message });
  }
});

// POST /api/printers/:id/decommission - Mark printer as decommissioned
printerRouter.post('/:id/decommission', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason = 'Sklonjen iz upotrebe' } = req.body;
    const decommissioned = decommissionPrinter(id, reason);
    if (!decommissioned) {
      return res.status(404).json({ error: 'Printer not found in database' });
    }

    addServerLog('warn', `Štampač sklonjen iz upotrebe: ${decommissioned.name} (Razlog: ${reason})`, 'Printer DB');
    res.json({ success: true, printer: decommissioned });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to decommission printer', details: err?.message });
  }
});

// POST /api/printers/:id/restore - Restore decommissioned printer
printerRouter.post('/:id/restore', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const restored = restorePrinter(id);
    if (!restored) {
      return res.status(404).json({ error: 'Printer not found in database' });
    }

    addServerLog('success', `Štampač vraćen u rad: ${restored.name}`, 'Printer DB');
    res.json({ success: true, printer: restored });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to restore printer', details: err?.message });
  }
});

// DELETE /api/printers/:id - Permanently delete printer
printerRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = deletePrinterPermanently(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Printer not found in database' });
    }

    addServerLog('warn', `Štampač trajno obrisan iz baze (ID: ${id})`, 'Printer DB');
    res.json({ success: true, message: 'Printer permanently deleted' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete printer', details: err?.message });
  }
});

// GET /api/printers/:ip/ping - Live latency probe and database status sync
printerRouter.get('/:ip/ping', async (req: Request, res: Response) => {
  const { ip } = req.params;
  const result = await checkPrinterOnline(ip, 500);
  if (result.isOnline) {
    const existing = getAllPrinters(true).find(p => p.ip === ip || p.ip === ip.replace(/_1$/, ''));
    if (existing) {
      updatePrinter(existing.id, {
        isOnline: true,
        latencyMs: result.latencyMs,
        lastSeen: new Date().toISOString()
      });
    }
  }
  res.json(result);
});

// POST /api/printers/:ip/wake - Send network wake pulse to printer
printerRouter.post('/:ip/wake', async (req: Request, res: Response) => {
  try {
    const { ip } = req.params;
    const { mac } = req.body || {};
    const result = await wakePrinter(ip, mac);

    addServerLog(result.success ? 'info' : 'warn', `Poslat signal za buđenje štampača ${ip}`, 'Wake Engine');
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to wake printer', details: err?.message });
  }
});

// GET /api/printers/:ip/consumables - Live SNMP telemetry, toners, counters & paper trays
printerRouter.get('/:ip/consumables', async (req: Request, res: Response) => {
  try {
    const { ip } = req.params;
    const force = req.query.force === 'true';
    const data = await getPrinterConsumables(ip, 'public', force);
    res.json(data);
  } catch (err: any) {
    console.error('Consumables fetch error:', err);
    res.status(500).json({ error: 'Failed to retrieve consumables', details: err?.message });
  }
});
