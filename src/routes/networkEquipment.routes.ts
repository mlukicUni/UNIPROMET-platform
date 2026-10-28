import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { networkEquipmentDb, NetworkEquipmentInput } from '../db/networkEquipmentDb.js';
import { equipmentDb } from '../db/equipmentDb.js';
import { navisionService } from '../services/navisionService.js';
import { addServerLog } from './system.routes.js';
import { broadcastEquipmentEvent } from './equipment.routes.js';
// [LEGACY_BRIDGE_START]
import { legacySyncBridge } from '../services/legacySyncBridge.js';
// [LEGACY_BRIDGE_END]

export const networkEquipmentRouter = Router();

/**
 * GET /api/network-equipment/stats
 * Quick KPI summary metrics for cards.
 */
networkEquipmentRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = networkEquipmentDb.getNetworkStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (err: any) {
    console.error('[NetworkEquipment] Error fetching stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/network-equipment/cvorovi
 * List of all rack cabinets / nodes (čvorišta) for parent node dropdown.
 */
networkEquipmentRouter.get('/cvorovi', async (_req: Request, res: Response) => {
  try {
    const cvorovi = networkEquipmentDb.getAllCvorovi();
    res.json({ success: true, data: cvorovi });
  } catch (err: any) {
    console.error('[NetworkEquipment] Error fetching cvorovi:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/network-equipment/dictionaries
 * Returns codebooks (categories, locations, buildings, rooms, statuses) for network equipment.
 */
networkEquipmentRouter.get('/dictionaries', async (_req: Request, res: Response) => {
  try {
    const categories = equipmentDb.getCategoriesWithCounts();
    const locations = equipmentDb.getLocations();
    const buildings = equipmentDb.getBuildings();
    const rooms = equipmentDb.getRooms();
    const statuses = equipmentDb.getStatuses();
    const cvorovi = networkEquipmentDb.getAllCvorovi();

    res.json({
      success: true,
      data: {
        categories,
        locations,
        buildings,
        rooms,
        statuses,
        cvorovi
      }
    });
  } catch (err: any) {
    console.error('[NetworkEquipment] Error fetching dictionaries:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/network-equipment/export/excel
 * Rich, styled Excel export of filtered Network equipment list.
 */
networkEquipmentRouter.get('/export/excel', async (req: Request, res: Response) => {
  try {
    const search = req.query.search ? String(req.query.search).trim() : undefined;
    const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId), 10) : undefined;
    const locationId = req.query.locationId ? parseInt(String(req.query.locationId), 10) : undefined;
    const buildingId = req.query.buildingId ? parseInt(String(req.query.buildingId), 10) : undefined;
    const roomId = req.query.roomId ? parseInt(String(req.query.roomId), 10) : undefined;
    const statusId = req.query.statusId ? parseInt(String(req.query.statusId), 10) : undefined;
    const cvorId = req.query.cvorId ? parseInt(String(req.query.cvorId), 10) : undefined;

    let matchedEmployeeNos: string[] | null = null;
    if (search) {
      try {
        const empResults = await navisionService.searchEmployees(search);
        matchedEmployeeNos = empResults.map(e => e.employee_no);
      } catch (e) {
        // Ignore
      }
    }

    const result = networkEquipmentDb.getNetworkEquipment({
      categoryId: isNaN(categoryId as any) ? undefined : categoryId,
      locationId: isNaN(locationId as any) ? undefined : locationId,
      buildingId: isNaN(buildingId as any) ? undefined : buildingId,
      roomId: isNaN(roomId as any) ? undefined : roomId,
      statusId: isNaN(statusId as any) ? undefined : statusId,
      cvorId: isNaN(cvorId as any) ? undefined : cvorId,
      search,
      matchedEmployeeNos,
      limit: 100000,
      offset: 0
    });

    // Enrich items with Navision employee names
    try {
      const employeeNos = result.items.map(i => i.employee_no).filter(Boolean) as string[];
      const empMap = await navisionService.getEmployeesMap(employeeNos);
      for (const item of result.items) {
        if (item.employee_no && empMap[item.employee_no]) {
          const emp = empMap[item.employee_no];
          item.employee_name = emp.full_name;
          item.employee_job = emp.job_title;
          item.employee_dept = emp.department;
          item.employee_status = emp.hr_status;
        }
      }
    } catch (e) {
      console.warn('[NetworkEquipment] Navision employee enrichment warning for excel:', e);
    }

    const items = result.items;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeFormatted = now.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
    const dateFormatted = now.toLocaleDateString('sr-RS');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'UNIPROMET DOO ČAČAK';
    wb.lastModifiedBy = 'UNIPROMET Centralni IT Admin Panel';
    wb.created = now;

    const ws = wb.addWorksheet('Mrežna Oprema i Čvorišta', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 4, showGridLines: true }]
    });

    const filterDesc = [
      `Pretraga: "${search || 'Sve'}"`,
      `Datum izvoza: ${dateFormatted} u ${timeFormatted}`,
      `Ukupno stavki: ${items.length}`
    ].join('   |   ');

    const headers = [
      'ID',
      'Kategorija',
      'Naziv / Model Uređaja',
      'Status',
      'Lokacija',
      'Objekat / Zgrada',
      'Kancelarija / Prostorija',
      'Pripadajući Čvor / Rack',
      'Broj Portova / Linija',
      'Brzina / Tehnički Opis',
      'Dimenzije Ormana',
      'Opis Trase Kablova & Optike',
      'Zaduženo Lice (Navision)',
      'Kadrovski Broj',
      'Radno Mesto',
      'Sektor / Služba',
      'Inventarski Broj (SI/OS)',
      'Datum Nabavke / Dodele',
      'Dobavljač / Ugovor',
      'Broj Zabeleški'
    ];

    // Title Block
    ws.mergeCells('A1:T1');
    const titleCell = ws.getCell('A1');
    titleCell.value = 'UNIPROMET DOO ČAČAK  |  EVIDENCIJA MREŽNE OPREME, SWITCHEVА I ČVORIŠTA';
    titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 36;

    // Subtitle Block
    ws.mergeCells('A2:T2');
    const subCell = ws.getCell('A2');
    subCell.value = filterDesc;
    subCell.font = { name: 'Segoe UI', size: 9.5, italic: true, color: { argb: 'FF94A3B8' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(2).height = 24;

    ws.getRow(3).height = 8;

    // Table Header Row
    const headerRow = ws.getRow(4);
    headerRow.values = headers;
    headerRow.height = 30;

    headerRow.eachCell((cell) => {
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF334155' } },
        left: { style: 'thin', color: { argb: 'FF334155' } },
        bottom: { style: 'medium', color: { argb: 'FFF59E0B' } },
        right: { style: 'thin', color: { argb: 'FF334155' } }
      };
    });

    // Populate Data Rows
    items.forEach((item, idx) => {
      const rowNumber = idx + 5;
      const row = ws.getRow(rowNumber);
      row.height = 24;

      const isEven = idx % 2 === 0;
      const bgArgb = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

      row.values = [
        item.id,
        item.category_name || 'Ostalo',
        item.name || '—',
        item.status_name || 'ISPRAVNO',
        item.location_name || '—',
        item.building_name || '—',
        item.room_name || '—',
        item.parent_cvor || (item.custom_code ? `#${item.custom_code}` : '—'),
        item.lines_count !== null && item.lines_count !== undefined ? `${item.lines_count} portova` : '—',
        item.comment || item.description || '—',
        item.rack_dims || '—',
        item.route_desc || '—',
        item.employee_name || '—',
        item.employee_no || '—',
        item.employee_job || '—',
        item.employee_dept || '—',
        item.inventory_no || '—',
        item.date_arrived ? new Date(item.date_arrived).toLocaleDateString('sr-RS') : '—',
        item.date_purchased || '—',
        item.history_count || 0
      ];

      row.eachCell({ includeEmpty: true }, (cell, colIdx) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
        cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF334155' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        if (colIdx === 1) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF64748B' } };
        } else if (colIdx === 2) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF0284C7' } };
        } else if (colIdx === 3) {
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
        } else if (colIdx === 4) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          const s = String(cell.value || '').toUpperCase();
          if (s.includes('ISPRAVNO')) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF065F46' } };
          } else if (s.includes('NEISPRAVNO') || s.includes('RASHOD')) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF991B1B' } };
          }
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        }
      });
    });

    // Auto-fit Column Widths
    const minWidths = [10, 16, 26, 16, 16, 22, 22, 28, 16, 24, 18, 30, 24, 14, 20, 20, 16, 16, 16, 14];
    ws.columns.forEach((col, idx) => {
      let maxLen = minWidths[idx] || 15;
      col.eachCell?.({ includeEmpty: false }, (c, rowNumber) => {
        if (rowNumber > 3) {
          const val = c.value ? String(c.value) : '';
          if (val.length > maxLen) {
            maxLen = Math.min(val.length + 3, 50);
          }
        }
      });
      col.width = Math.max(maxLen, minWidths[idx] || 15);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="UNIPROMET_Mrezna_Oprema_${dateStr}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error('[NetworkEquipment] Excel Export error:', err);
    res.status(500).json({ success: false, error: 'Greška pri izvozu u Excel: ' + err.message });
  }
});

/**
 * GET /api/network-equipment
 * Paginated list with search, category, location, building, status, and cvor filters.
 */
networkEquipmentRouter.get('/', async (req: Request, res: Response) => {
  try {
    const search = req.query.search ? String(req.query.search).trim() : undefined;
    const categoryId = req.query.categoryId ? parseInt(String(req.query.categoryId), 10) : undefined;
    const locationId = req.query.locationId ? parseInt(String(req.query.locationId), 10) : undefined;
    const buildingId = req.query.buildingId ? parseInt(String(req.query.buildingId), 10) : undefined;
    const roomId = req.query.roomId ? parseInt(String(req.query.roomId), 10) : undefined;
    const statusId = req.query.statusId ? parseInt(String(req.query.statusId), 10) : undefined;
    const cvorId = req.query.cvorId ? parseInt(String(req.query.cvorId), 10) : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const offset = (page - 1) * limit;

    let matchedEmployeeNos: string[] | null = null;
    if (search) {
      try {
        const empResults = await navisionService.searchEmployees(search);
        matchedEmployeeNos = empResults.map(e => e.employee_no);
      } catch (e) {
        // Ignore
      }
    }

    const result = networkEquipmentDb.getNetworkEquipment({
      categoryId: isNaN(categoryId as any) ? undefined : categoryId,
      locationId: isNaN(locationId as any) ? undefined : locationId,
      buildingId: isNaN(buildingId as any) ? undefined : buildingId,
      roomId: isNaN(roomId as any) ? undefined : roomId,
      statusId: isNaN(statusId as any) ? undefined : statusId,
      cvorId: isNaN(cvorId as any) ? undefined : cvorId,
      search,
      matchedEmployeeNos,
      limit,
      offset
    });

    // Enrich with Navision employees
    try {
      const employeeNos = result.items.map(i => i.employee_no).filter(Boolean) as string[];
      const empMap = await navisionService.getEmployeesMap(employeeNos);
      for (const item of result.items) {
        if (item.employee_no && empMap[item.employee_no]) {
          const emp = empMap[item.employee_no];
          item.employee_name = emp.full_name;
          item.employee_job = emp.job_title;
          item.employee_dept = emp.department;
          item.employee_status = emp.hr_status;
        }
      }
    } catch (e) {
      console.warn('[NetworkEquipment] Navision employee enrichment warning:', e);
    }

    const totalPages = Math.ceil(result.total / limit) || 1;

    res.json({
      success: true,
      data: result.items,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages
      }
    });
  } catch (err: any) {
    console.error('[NetworkEquipment] Error listing items:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/network-equipment/:id
 * Single network equipment item details + history.
 */
networkEquipmentRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const item = networkEquipmentDb.getNetworkEquipmentById(id);
    if (!item) return res.status(404).json({ success: false, error: 'Mrežni uređaj nije pronađen' });

    if (item.employee_no) {
      try {
        const empMap = await navisionService.getEmployeesMap([item.employee_no]);
        if (empMap[item.employee_no]) {
          const emp = empMap[item.employee_no];
          item.employee_name = emp.full_name;
          item.employee_job = emp.job_title;
          item.employee_dept = emp.department;
          item.employee_status = emp.hr_status;
        }
      } catch (e) {
        // Ignore
      }
    }

    res.json({ success: true, data: item });
  } catch (err: any) {
    console.error('[NetworkEquipment] Error getting item:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/network-equipment
 * Creates new network equipment or čvorište.
 */
networkEquipmentRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      category_id,
      status_id,
      description,
      comment,
      date_arrived,
      date_purchased,
      location_id,
      building_id,
      room_id,
      custom_code,
      rack_dims,
      route_desc,
      lines_count,
      employee_no,
      inventory_no
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Naziv / Model uređaja je obavezan' });
    }

    const input: NetworkEquipmentInput = {
      name: String(name).trim(),
      category_id: category_id ? parseInt(String(category_id), 10) : 6,
      status_id: status_id ? parseInt(String(status_id), 10) : 1,
      description: description ? String(description).trim() : null,
      comment: comment ? String(comment).trim() : null,
      date_arrived: date_arrived ? String(date_arrived).trim() : null,
      date_purchased: date_purchased ? String(date_purchased).trim() : null,
      location_id: location_id ? parseInt(String(location_id), 10) : null,
      building_id: building_id ? parseInt(String(building_id), 10) : null,
      room_id: room_id ? parseInt(String(room_id), 10) : null,
      custom_code: custom_code ? parseInt(String(custom_code), 10) : null,
      rack_dims: rack_dims ? String(rack_dims).trim() : null,
      route_desc: route_desc ? String(route_desc).trim() : null,
      lines_count: lines_count !== undefined && lines_count !== null && lines_count !== '' ? parseInt(String(lines_count), 10) : null,
      employee_no: employee_no ? String(employee_no).trim() : null,
      inventory_no: inventory_no ? String(inventory_no).trim() : null
    };

    const created = networkEquipmentDb.createNetworkEquipment(input);
    const newId = created.id;

    // Dual-write to 121.20 legacy database
    legacySyncBridge.dualWriteCreate(newId, input as any).catch((err: any) => {
      console.warn('[NetworkEquipment] Dual-write create error:', err.message);
    });

    addServerLog('info', `Kreiran novi mrežni uređaj #${newId}: ${input.name}`, 'Mrežna Oprema');
    broadcastEquipmentEvent('equipment_created', { id: newId, name: input.name });

    res.status(201).json({ success: true, id: newId, message: 'Mrežni uređaj je uspešno dodat' });
  } catch (err: any) {
    console.error('[NetworkEquipment] Error creating item:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/network-equipment/:id
 * Updates existing network equipment.
 */
networkEquipmentRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const existing = networkEquipmentDb.getNetworkEquipmentById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Mrežni uređaj nije pronađen' });

    const {
      name,
      category_id,
      status_id,
      description,
      comment,
      date_arrived,
      date_purchased,
      location_id,
      building_id,
      room_id,
      custom_code,
      rack_dims,
      route_desc,
      lines_count,
      employee_no,
      inventory_no
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Naziv / Model uređaja je obavezan' });
    }

    const input: NetworkEquipmentInput = {
      name: String(name).trim(),
      category_id: category_id ? parseInt(String(category_id), 10) : (existing.category_id || 6),
      status_id: status_id ? parseInt(String(status_id), 10) : (existing.status_id || 1),
      description: description !== undefined ? (description ? String(description).trim() : null) : existing.description,
      comment: comment !== undefined ? (comment ? String(comment).trim() : null) : existing.comment,
      date_arrived: date_arrived !== undefined ? (date_arrived ? String(date_arrived).trim() : null) : existing.date_arrived,
      date_purchased: date_purchased !== undefined ? (date_purchased ? String(date_purchased).trim() : null) : existing.date_purchased,
      location_id: location_id !== undefined ? (location_id ? parseInt(String(location_id), 10) : null) : existing.location_id,
      building_id: building_id !== undefined ? (building_id ? parseInt(String(building_id), 10) : null) : existing.building_id,
      room_id: room_id !== undefined ? (room_id ? parseInt(String(room_id), 10) : null) : existing.room_id,
      custom_code: custom_code !== undefined ? (custom_code ? parseInt(String(custom_code), 10) : null) : existing.custom_code,
      rack_dims: rack_dims !== undefined ? (rack_dims ? String(rack_dims).trim() : null) : existing.rack_dims,
      route_desc: route_desc !== undefined ? (route_desc ? String(route_desc).trim() : null) : existing.route_desc,
      lines_count: lines_count !== undefined ? (lines_count !== null && lines_count !== '' ? parseInt(String(lines_count), 10) : null) : existing.lines_count,
      employee_no: employee_no !== undefined ? (employee_no ? String(employee_no).trim() : null) : existing.employee_no,
      inventory_no: inventory_no !== undefined ? (inventory_no ? String(inventory_no).trim() : null) : existing.inventory_no
    };

    networkEquipmentDb.updateNetworkEquipment(id, input);

    // Dual-write to 121.20 legacy database
    legacySyncBridge.dualWriteUpdate(id, input as any).catch((err: any) => {
      console.warn('[NetworkEquipment] Dual-write update error:', err.message);
    });

    addServerLog('info', `Ažuriran mrežni uređaj #${id}: ${input.name}`, 'Mrežna Oprema');
    broadcastEquipmentEvent('equipment_updated', { id, name: input.name });

    res.json({ success: true, message: 'Mrežni uređaj je uspešno ažuriran' });
  } catch (err: any) {
    console.error('[NetworkEquipment] Error updating item:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/network-equipment/:id
 * Deletes a network equipment item.
 */
networkEquipmentRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const existing = networkEquipmentDb.getNetworkEquipmentById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Mrežni uređaj nije pronađen' });

    networkEquipmentDb.deleteNetworkEquipment(id);

    // Dual-write to 121.20 legacy database
    legacySyncBridge.dualWriteDelete(id).catch((err: any) => {
      console.warn('[NetworkEquipment] Dual-write delete error:', err.message);
    });

    addServerLog('warn', `Obrisan mrežni uređaj #${id}: ${existing.name}`, 'Mrežna Oprema');
    broadcastEquipmentEvent('equipment_deleted', { id, name: existing.name });

    res.json({ success: true, message: 'Mrežni uređaj je uspešno obrisan' });
  } catch (err: any) {
    console.error('[NetworkEquipment] Error deleting item:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/network-equipment/:id/history
 * Returns service history / notes for network equipment.
 */
networkEquipmentRouter.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const item = networkEquipmentDb.getNetworkEquipmentById(id);
    if (!item) return res.status(404).json({ success: false, error: 'Mrežni uređaj nije pronađen' });

    res.json({ success: true, data: item.history || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/network-equipment/:id/history
 * Adds a new note / history record.
 */
networkEquipmentRouter.post('/:id/history', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const { note, date, phone } = req.body;
    if (!note || !String(note).trim()) {
      return res.status(400).json({ success: false, error: 'Tekst zabeleške je obavezan' });
    }

    const created = networkEquipmentDb.addHistory({
      equipment_id: id,
      note: String(note).trim(),
      date: date ? String(date).trim() : null,
      phone: phone ? String(phone).trim() : null
    });

    legacySyncBridge.dualWriteAddHistory(id, created.note, created.date || null, created.phone || null).catch((err: any) => {
      console.warn('[NetworkEquipment] Dual-write history error:', err.message);
    });

    broadcastEquipmentEvent('history_added', { equipment_id: id, history_id: created.id });
    res.status(201).json({ success: true, id: created.id, message: 'Zabeleška je uspešno dodata' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/network-equipment/history/:historyId
 * Deletes a note / history record.
 */
networkEquipmentRouter.delete('/history/:historyId', async (req: Request, res: Response) => {
  try {
    const historyId = parseInt(req.params.historyId, 10);
    if (isNaN(historyId)) return res.status(400).json({ success: false, error: 'Nevažeći ID zabeleške' });

    networkEquipmentDb.deleteHistory(historyId);

    legacySyncBridge.dualWriteDeleteHistory(historyId).catch((err: any) => {
      console.warn('[NetworkEquipment] Dual-write delete history error:', err.message);
    });

    broadcastEquipmentEvent('history_deleted', { history_id: historyId });
    res.json({ success: true, message: 'Zabeleška je obrisana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
