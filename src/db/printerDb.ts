import { getDb } from './sqlite';
import { initSchema } from './schema';

export interface DbPrinter {
  id: string;
  name: string;
  model: string;
  ip: string;
  location: string;
  category: string;
  shareName: string;
  driverName: string;
  customTag?: string;
  notes?: string;
  isDecommissioned: boolean;
  decommissionReason?: string;
  isOnline: boolean;
  latencyMs: number | null;
  lastSeen?: string;
  createdAt: string;
  updatedAt: string;
}

interface PrinterRow {
  id: string;
  name: string;
  model: string | null;
  ip: string;
  location: string | null;
  category: string | null;
  share_name: string | null;
  driver_name: string | null;
  custom_tag: string | null;
  notes: string | null;
  is_decommissioned: number;
  decommission_reason: string | null;
  is_online: number;
  latency_ms: number | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPrinter(row: PrinterRow): DbPrinter {
  return {
    id: row.id,
    name: row.name,
    model: row.model || 'Mrežni Štampač',
    ip: row.ip,
    location: row.location || 'UNIPROMET',
    category: row.category || 'Ostale Lokacije',
    shareName: row.share_name || '',
    driverName: row.driver_name || 'Generic Network Printer',
    customTag: row.custom_tag || 'U funkciji',
    notes: row.notes || '',
    isDecommissioned: row.is_decommissioned === 1,
    decommissionReason: row.decommission_reason || undefined,
    isOnline: row.is_online === 1,
    latencyMs: row.latency_ms,
    lastSeen: row.last_seen || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getAllPrinters(includeDecommissioned: boolean = true): DbPrinter[] {
  initSchema();
  const db = getDb();
  let query = 'SELECT * FROM printers ORDER BY name ASC';
  if (!includeDecommissioned) {
    query = 'SELECT * FROM printers WHERE is_decommissioned = 0 ORDER BY name ASC';
  }
  const rows = db.prepare(query).all() as PrinterRow[];
  return rows.map(rowToPrinter);
}

export function getPrinterById(id: string): DbPrinter | undefined {
  initSchema();
  const db = getDb();
  const row = db.prepare('SELECT * FROM printers WHERE id = ?').get(id) as PrinterRow | undefined;
  return row ? rowToPrinter(row) : undefined;
}

export function getPrinterByIp(ip: string): DbPrinter | undefined {
  initSchema();
  const db = getDb();
  const cleanIp = ip.replace(/_1$/, '').trim();
  const row = db.prepare('SELECT * FROM printers WHERE ip = ?').get(cleanIp) as PrinterRow | undefined;
  return row ? rowToPrinter(row) : undefined;
}

export function syncPrintersFromNetwork(networkPrinters: Array<Partial<DbPrinter> & { ip: string; name: string }>): DbPrinter[] {
  initSchema();
  const db = getDb();
  const now = new Date().toISOString();

  const syncTx = db.transaction(() => {
    for (const netPrn of networkPrinters) {
      const cleanIp = netPrn.ip.replace(/_1$/, '').trim();
      const existing = getPrinterByIp(cleanIp);

      if (existing) {
        db.prepare(`
          UPDATE printers SET
            name = COALESCE(name, ?),
            model = COALESCE(model, ?),
            location = COALESCE(location, ?),
            category = COALESCE(category, ?),
            share_name = COALESCE(?, share_name),
            driver_name = COALESCE(?, driver_name),
            is_online = ?,
            latency_ms = ?,
            last_seen = CASE WHEN ? = 1 THEN ? ELSE last_seen END,
            updated_at = ?
          WHERE id = ?
        `).run(
          netPrn.name || null,
          netPrn.model || null,
          netPrn.location || 'UNIPROMET',
          netPrn.category || 'Ostale Lokacije',
          netPrn.shareName || null,
          netPrn.driverName || null,
          netPrn.isOnline ? 1 : 0,
          netPrn.latencyMs ?? null,
          netPrn.isOnline ? 1 : 0,
          now,
          now,
          existing.id
        );
      } else {
        const newId = `prn-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        db.prepare(`
          INSERT INTO printers (
            id, name, model, ip, location, category, share_name, driver_name,
            custom_tag, notes, is_decommissioned, decommission_reason,
            is_online, latency_ms, last_seen, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newId,
          netPrn.name,
          netPrn.model || 'Mrežni Štampač',
          cleanIp,
          netPrn.location || 'UNIPROMET',
          netPrn.category || 'Ostale Lokacije',
          netPrn.shareName || '',
          netPrn.driverName || 'Generic Network Printer',
          'U funkciji',
          '',
          0,
          null,
          netPrn.isOnline ? 1 : 0,
          netPrn.latencyMs ?? null,
          netPrn.isOnline ? now : null,
          now,
          now
        );
      }
    }
  });

  syncTx();
  return getAllPrinters(true);
}

export function updatePrinter(id: string, updates: Partial<DbPrinter>): DbPrinter | null {
  initSchema();
  const db = getDb();
  const existing = getPrinterById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged: DbPrinter = {
    ...existing,
    ...updates,
    id: existing.id,
    updatedAt: now
  };

  db.prepare(`
    UPDATE printers SET
      name = ?, model = ?, location = ?, category = ?, share_name = ?,
      driver_name = ?, custom_tag = ?, notes = ?, is_decommissioned = ?,
      decommission_reason = ?, is_online = ?, latency_ms = ?, last_seen = ?, updated_at = ?
    WHERE id = ?
  `).run(
    merged.name,
    merged.model,
    merged.location,
    merged.category,
    merged.shareName,
    merged.driverName,
    merged.customTag || 'U funkciji',
    merged.notes || '',
    merged.isDecommissioned ? 1 : 0,
    merged.decommissionReason || null,
    merged.isOnline ? 1 : 0,
    merged.latencyMs ?? null,
    merged.lastSeen || null,
    now,
    id
  );

  return getPrinterById(id) || null;
}

export function decommissionPrinter(id: string, reason: string = 'Sklonjen iz upotrebe'): DbPrinter | null {
  return updatePrinter(id, {
    isDecommissioned: true,
    decommissionReason: reason,
    customTag: 'Sklonjen'
  });
}

export function restorePrinter(id: string): DbPrinter | null {
  return updatePrinter(id, {
    isDecommissioned: false,
    decommissionReason: undefined,
    customTag: 'U funkciji'
  });
}

export function createCustomPrinter(data: { name: string; ip: string; location: string; model?: string; customTag?: string; notes?: string }): DbPrinter {
  initSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const cleanIp = data.ip.replace(/_1$/, '').trim();
  const newId = `prn-custom-${Date.now()}`;
  const category = data.location.toLowerCase().includes('pogon') ? 'Pogon & Proizvodnja' :
                   data.location.toLowerCase().includes('cinkar') ? 'Cinkara' :
                   data.location.toLowerCase().includes('magacin') ? 'Logistika & Magacin' : 'Uprava & Kancelarije';

  db.prepare(`
    INSERT INTO printers (
      id, name, model, ip, location, category, share_name, driver_name,
      custom_tag, notes, is_decommissioned, decommission_reason,
      is_online, latency_ms, last_seen, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId,
    data.name.trim(),
    data.model?.trim() || 'Mrežni Štampač',
    cleanIp,
    data.location?.trim() || 'UNIPROMET',
    category,
    '',
    'Generic Printer',
    data.customTag?.trim() || 'U funkciji',
    data.notes?.trim() || '',
    0,
    null,
    0,
    null,
    null,
    now,
    now
  );

  return getPrinterById(newId)!;
}

export function deletePrinterPermanently(id: string): boolean {
  initSchema();
  const db = getDb();
  const res = db.prepare('DELETE FROM printers WHERE id = ?').run(id);
  return res.changes > 0;
}

/**
 * Updates printer model (and syncs name if old model was part of it)
 * directly from live SNMP discovery (RFC 3805 / RFC 2790 sysDescr).
 * Only executes SQLite disk write if model or name actually changed (dirty check).
 */
export function updatePrinterModelFromSnmp(ip: string, rawSnmpModel: string): boolean {
  if (!rawSnmpModel || rawSnmpModel === 'Nepoznato' || rawSnmpModel === 'Mrežni Štampač' || rawSnmpModel.trim().length < 2) {
    return false;
  }
  const cleanIp = ip.replace(/_1$/, '').trim();
  const existing = getPrinterByIp(cleanIp);
  if (!existing) return false;

  // 1. Clean and normalize SNMP model string
  let cleanModel = rawSnmpModel.replace(/\s*\/[A-Za-z0-9]+\s*$/, '').trim();
  if (cleanModel.toLowerCase().includes('lbp312')) {
    cleanModel = 'Canon LBP312x';
  } else if (cleanModel.toLowerCase().includes('lbp6780')) {
    cleanModel = 'Canon i-SENSYS LBP6780x';
  } else if (cleanModel.toLowerCase().includes('c5235')) {
    cleanModel = 'Canon imageRUNNER ADVANCE C5235i';
  }

  // 2. If existing name had the old model string (e.g. "Canon LBP 6780x (61)" but model is now LBP312x),
  // adapt the name cleanly to match the new hardware: "Canon LBP 312x (61)"
  let newName = existing.name;
  if (cleanModel.includes('312') && existing.name.includes('6780')) {
    newName = existing.name.replace(/6780[a-zA-Z]*/gi, '312x');
  }

  // 3. Dirty check: if neither model nor name changed, skip SQLite disk write
  if (existing.model === cleanModel && existing.name === newName) {
    return false;
  }

  const now = new Date().toISOString();
  initSchema();
  const db = getDb();
  db.prepare(`
    UPDATE printers SET
      model = ?,
      name = ?,
      updated_at = ?
    WHERE id = ?
  `).run(cleanModel, newName, now, existing.id);

  console.log(`[PrinterDB] 🔄 Automatski ažuriran štampač ${cleanIp}: Model="${cleanModel}", Naziv="${newName}" (SNMP detekcija)`);
  return true;
}

