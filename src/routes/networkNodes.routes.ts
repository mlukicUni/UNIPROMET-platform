import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { networkNodesDb, NetworkNodeInput } from '../db/networkNodesDb.js';
import { equipmentDb } from '../db/equipmentDb.js';
import { navisionService } from '../services/navisionService.js';
import { addServerLog } from './system.routes.js';
import { broadcastEquipmentEvent } from './equipment.routes.js';
import { legacySyncBridge } from '../services/legacySyncBridge.js';

export const networkNodesRouter = Router();

/**
 * GET /api/network-nodes/stats
 * Returns summary KPI metrics for Čvorišta cards.
 */
networkNodesRouter.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = networkNodesDb.getStats();
    res.json({ success: true, data: stats });
  } catch (err: any) {
    console.error('[NetworkNodes] Error fetching stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/network-nodes/dictionaries
 * Dropdowns for locations, buildings, rooms, categories, statuses.
 */
networkNodesRouter.get('/dictionaries', (_req: Request, res: Response) => {
  try {
    const codebooks = equipmentDb.getCodebooks();
    res.json({
      success: true,
      data: {
        locations: codebooks.locations || [],
        buildings: codebooks.buildings || [],
        rooms: codebooks.rooms || [],
        statuses: codebooks.statuses || [],
        categories: [
          { id: 16, name: 'ČVORIŠTE / CVOR' },
          { id: 33, name: 'RACK ORMAN' }
        ]
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/network-nodes/export/excel
 * Exports nodes to a styled Excel workbook.
 */
networkNodesRouter.get('/export/excel', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const locationId = req.query.locationId ? parseInt(req.query.locationId as string, 10) : undefined;
    const buildingId = req.query.buildingId ? parseInt(req.query.buildingId as string, 10) : undefined;
    const roomId = req.query.roomId ? parseInt(req.query.roomId as string, 10) : undefined;
    const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string, 10) : undefined;
    const statusId = req.query.statusId ? parseInt(req.query.statusId as string, 10) : undefined;

    const { items } = networkNodesDb.getNodes({
      page: 1,
      limit: 10000,
      search,
      locationId,
      buildingId,
      roomId,
      categoryId,
      statusId,
      sortBy: 'id',
      sortOrder: 'ASC'
    });

    // Enrich employee names
    const empCodes = items.map(i => i.employee_no).filter(Boolean) as string[];
    let empMap: Record<string, any> = {};
    if (empCodes.length > 0) {
      try {
        empMap = await navisionService.getEmployeesMap(empCodes);
      } catch (e) {}
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Unipromet IT Admin';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Mrežna Čvorišta i Ormani', {
      views: [{ state: 'frozen', ySplit: 4 }]
    });

    sheet.mergeCells('A1:K1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'UNIPROMET - EVIDENCIJA MREŽNIH ČVORIŠTA I RACK ORMANA';
    titleCell.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    sheet.getRow(1).height = 34;

    sheet.mergeCells('A2:K2');
    const metaCell = sheet.getCell('A2');
    metaCell.value = `Izveštaj generisan: ${new Date().toLocaleString('sr-RS')} | Ukupno čvorišta: ${items.length}`;
    metaCell.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
    metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
    metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    sheet.getRow(2).height = 20;

    sheet.getRow(3).height = 10;

    const headers = [
      'ID',
      'Kategorija',
      'Naziv / Identifikator Čvorišta',
      'Status',
      'Lokacija / Fabrika',
      'Objekat / Zgrada',
      'Prostorija / Kancelarija',
      'Dimenzije Ormana',
      'Izvedene Linije',
      'Povezani Uređaji',
      'Zaduženo Lice'
    ];

    const headerRow = sheet.getRow(4);
    headerRow.values = headers;
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5CF6' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF475569' } },
        bottom: { style: 'medium', color: { argb: 'FF1E293B' } },
        left: { style: 'thin', color: { argb: 'FF475569' } },
        right: { style: 'thin', color: { argb: 'FF475569' } }
      };
    });

    items.forEach((item, idx) => {
      const rowNum = idx + 5;
      const row = sheet.getRow(rowNum);
      const emp = item.employee_no ? empMap[item.employee_no] : null;

      row.values = [
        item.id,
        item.category_name || 'ČVOR',
        item.name || `Čvor #${item.id}`,
        item.status_name || 'ISPRAVNO',
        item.location_name || '-',
        item.building_name || '-',
        item.room_name || '-',
        item.rack_dims || '-',
        item.lines_count ? `${item.lines_count} linija` : '-',
        item.connected_devices_count || 0,
        emp ? `${emp.full_name} (${emp.job_title || ''})` : (item.employee_no || '-')
      ];

      row.height = 22;
      const isEven = idx % 2 === 0;
      const bgColor = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        if ([1, 2, 4, 9, 10].includes(colNum)) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });
    });

    sheet.columns = [
      { width: 8 },  // ID
      { width: 16 }, // Kategorija
      { width: 34 }, // Naziv
      { width: 14 }, // Status
      { width: 22 }, // Lokacija
      { width: 26 }, // Objekat
      { width: 34 }, // Prostorija
      { width: 20 }, // Dimenzije ormana
      { width: 16 }, // Linije
      { width: 18 }, // Povezani uredjaji
      { width: 32 }  // Zaposleni
    ];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Unipromet_Cvorista_${new Date().toISOString().split('T')[0]}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error('[NetworkNodes] Excel export error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/network-nodes
 * Paginated and filtered network nodes listing.
 */
networkNodesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string | undefined;
    const locationId = req.query.locationId ? parseInt(req.query.locationId as string, 10) : undefined;
    const buildingId = req.query.buildingId ? parseInt(req.query.buildingId as string, 10) : undefined;
    const roomId = req.query.roomId ? parseInt(req.query.roomId as string, 10) : undefined;
    const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string, 10) : undefined;
    const statusId = req.query.statusId ? parseInt(req.query.statusId as string, 10) : undefined;
    const sortBy = req.query.sortBy as string | undefined;
    const sortOrder = (req.query.sortOrder as string)?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const result = networkNodesDb.getNodes({
      page,
      limit,
      search,
      locationId,
      buildingId,
      roomId,
      categoryId,
      statusId,
      sortBy,
      sortOrder
    });

    // Enrich Navision HR employee names
    const empCodes = result.items.map(i => i.employee_no).filter(Boolean) as string[];
    if (empCodes.length > 0) {
      try {
        const empMap = await navisionService.getEmployeesMap(empCodes);
        for (const item of result.items) {
          if (item.employee_no && empMap[item.employee_no]) {
            const emp = empMap[item.employee_no];
            item.employee_name = emp.full_name;
            item.employee_job = emp.job_title;
            item.employee_dept = emp.department;
            item.employee_status = emp.hr_status;
          }
        }
      } catch (e) {}
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
    console.error('[NetworkNodes] Error listing nodes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/network-nodes/:id
 * Single node details + connected devices + lines + service history.
 */
networkNodesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const item = networkNodesDb.getNodeById(id);
    if (!item) return res.status(404).json({ success: false, error: 'Čvorište nije pronađeno' });

    // Enrich Navision HR employee
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
      } catch (e) {}
    }

    res.json({ success: true, data: item });
  } catch (err: any) {
    console.error('[NetworkNodes] Error getting node details:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/network-nodes
 * Creates new Čvorište / Rack item with dual-write to 121.20.
 */
networkNodesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      category_id,
      status_id,
      location_id,
      building_id,
      room_id,
      rack_dims,
      route_desc,
      lines_count,
      custom_code,
      comment,
      description,
      employee_no,
      inventory_no,
      date_arrived,
      date_purchased
    } = req.body;

    const input: NetworkNodeInput = {
      name: name ? String(name).trim() : undefined,
      category_id: category_id ? parseInt(String(category_id), 10) : 16,
      status_id: status_id ? parseInt(String(status_id), 10) : 1,
      location_id: location_id ? parseInt(String(location_id), 10) : null,
      building_id: building_id ? parseInt(String(building_id), 10) : null,
      room_id: room_id ? parseInt(String(room_id), 10) : null,
      rack_dims: rack_dims ? String(rack_dims).trim() : null,
      route_desc: route_desc ? String(route_desc).trim() : null,
      lines_count: lines_count !== undefined && lines_count !== null && lines_count !== '' ? parseInt(String(lines_count), 10) : null,
      custom_code: custom_code ? parseInt(String(custom_code), 10) : null,
      comment: comment ? String(comment).trim() : null,
      description: description ? String(description).trim() : null,
      employee_no: employee_no ? String(employee_no).trim() : null,
      inventory_no: inventory_no ? String(inventory_no).trim() : null,
      date_arrived: date_arrived ? String(date_arrived).trim() : null,
      date_purchased: date_purchased ? String(date_purchased).trim() : null
    };

    const created = networkNodesDb.createNode(input);
    const newId = created.id;

    // Dual-write to 121.20 legacy database
    legacySyncBridge.dualWriteCreate(newId, input as any).catch((err: any) => {
      console.warn('[NetworkNodes] Dual-write create error:', err.message);
    });

    addServerLog('info', `Kreirano novo mrežno čvorište #${newId}: ${created.name}`, 'Čvorišta');
    broadcastEquipmentEvent('node_created', { id: newId, name: created.name });

    res.status(201).json({ success: true, id: newId, message: 'Čvorište je uspešno dodato' });
  } catch (err: any) {
    console.error('[NetworkNodes] Error creating node:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/network-nodes/:id
 * Updates existing Čvorište / Rack item with dual-write to 121.20.
 */
networkNodesRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const existing = networkNodesDb.getNodeById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Čvorište nije pronađeno' });

    const {
      name,
      category_id,
      status_id,
      location_id,
      building_id,
      room_id,
      rack_dims,
      route_desc,
      lines_count,
      custom_code,
      comment,
      description,
      employee_no,
      inventory_no,
      date_arrived,
      date_purchased
    } = req.body;

    const input: NetworkNodeInput = {
      name: name !== undefined ? (name ? String(name).trim() : `Čvor #${id}`) : existing.name,
      category_id: category_id ? parseInt(String(category_id), 10) : (existing.category_id || 16),
      status_id: status_id ? parseInt(String(status_id), 10) : (existing.status_id || 1),
      location_id: location_id !== undefined ? (location_id ? parseInt(String(location_id), 10) : null) : existing.location_id,
      building_id: building_id !== undefined ? (building_id ? parseInt(String(building_id), 10) : null) : existing.building_id,
      room_id: room_id !== undefined ? (room_id ? parseInt(String(room_id), 10) : null) : existing.room_id,
      rack_dims: rack_dims !== undefined ? (rack_dims ? String(rack_dims).trim() : null) : existing.rack_dims,
      route_desc: route_desc !== undefined ? (route_desc ? String(route_desc).trim() : null) : existing.route_desc,
      lines_count: lines_count !== undefined ? (lines_count !== null && lines_count !== '' ? parseInt(String(lines_count), 10) : null) : existing.lines_count,
      custom_code: custom_code !== undefined ? (custom_code ? parseInt(String(custom_code), 10) : null) : existing.custom_code,
      comment: comment !== undefined ? (comment ? String(comment).trim() : null) : existing.comment,
      description: description !== undefined ? (description ? String(description).trim() : null) : existing.description,
      employee_no: employee_no !== undefined ? (employee_no ? String(employee_no).trim() : null) : existing.employee_no,
      inventory_no: inventory_no !== undefined ? (inventory_no ? String(inventory_no).trim() : null) : existing.inventory_no,
      date_arrived: date_arrived !== undefined ? (date_arrived ? String(date_arrived).trim() : null) : existing.date_arrived,
      date_purchased: date_purchased !== undefined ? (date_purchased ? String(date_purchased).trim() : null) : existing.date_purchased
    };

    networkNodesDb.updateNode(id, input);

    // Dual-write to 121.20
    legacySyncBridge.dualWriteUpdate(id, input as any).catch((err: any) => {
      console.warn('[NetworkNodes] Dual-write update error:', err.message);
    });

    addServerLog('info', `Ažurirano mrežno čvorište #${id}: ${input.name}`, 'Čvorišta');
    broadcastEquipmentEvent('node_updated', { id, name: input.name });

    res.json({ success: true, message: 'Čvorište je uspešno ažurirano' });
  } catch (err: any) {
    console.error('[NetworkNodes] Error updating node:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/network-nodes/:id
 * Deletes Čvorište / Rack item with dual-write to 121.20.
 */
networkNodesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const existing = networkNodesDb.getNodeById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Čvorište nije pronađeno' });

    networkNodesDb.deleteNode(id);

    // Dual-write to 121.20
    legacySyncBridge.dualWriteDelete(id).catch((err: any) => {
      console.warn('[NetworkNodes] Dual-write delete error:', err.message);
    });

    addServerLog('warn', `Obrisano mrežno čvorište #${id}: ${existing.name}`, 'Čvorišta');
    broadcastEquipmentEvent('node_deleted', { id, name: existing.name });

    res.json({ success: true, message: 'Čvorište je uspešno obrisano' });
  } catch (err: any) {
    console.error('[NetworkNodes] Error deleting node:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/network-nodes/:id/history
 * Returns service history / notes for node.
 */
networkNodesRouter.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const item = networkNodesDb.getNodeById(id);
    if (!item) return res.status(404).json({ success: false, error: 'Čvorište nije pronađeno' });

    res.json({ success: true, data: item.history || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/network-nodes/:id/history
 * Adds a new note / history record.
 */
networkNodesRouter.post('/:id/history', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const { note, date, phone } = req.body;
    if (!note || !String(note).trim()) {
      return res.status(400).json({ success: false, error: 'Tekst zabeleške je obavezan' });
    }

    const created = networkNodesDb.addHistory({
      equipment_id: id,
      note: String(note).trim(),
      date: date ? String(date).trim() : null,
      phone: phone ? String(phone).trim() : null
    });

    legacySyncBridge.dualWriteAddHistory(id, created.note, created.date || null, created.phone || null).catch((err: any) => {
      console.warn('[NetworkNodes] Dual-write history error:', err.message);
    });

    broadcastEquipmentEvent('history_added', { equipment_id: id, history_id: created.id });
    res.status(201).json({ success: true, id: created.id, message: 'Zabeleška je uspešno dodata' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/network-nodes/history/:historyId
 * Deletes a note / history record.
 */
networkNodesRouter.delete('/history/:historyId', async (req: Request, res: Response) => {
  try {
    const historyId = parseInt(req.params.historyId, 10);
    if (isNaN(historyId)) return res.status(400).json({ success: false, error: 'Nevažeći ID zabeleške' });

    networkNodesDb.deleteHistory(historyId);

    legacySyncBridge.dualWriteDeleteHistory(historyId).catch((err: any) => {
      console.warn('[NetworkNodes] Dual-write delete history error:', err.message);
    });

    broadcastEquipmentEvent('history_deleted', { history_id: historyId });
    res.json({ success: true, message: 'Zabeleška je obrisana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

