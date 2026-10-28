import { Router, Request, Response } from 'express';
import { linesDb, LineInput } from '../db/linesDb.js';
import { legacySyncBridge } from '../services/legacySyncBridge.js';
import { addServerLog } from './system.routes.js';
import { broadcastEquipmentEvent } from './equipment.routes.js';
import ExcelJS from 'exceljs';
import { navisionService } from '../services/navisionService.js';

export const linesRouter = Router();

/**
 * GET /api/lines/stats
 * Summary KPI cards for Lines tab.
 */
linesRouter.get('/stats', (req: Request, res: Response) => {
  try {
    const stats = linesDb.getStats();
    res.json({ success: true, data: stats });
  } catch (err: any) {
    console.error('[Lines] Error fetching stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/lines/cvorovi
 * Helper for filter and modal dropdowns (all network nodes / racks).
 */
linesRouter.get('/cvorovi', (req: Request, res: Response) => {
  try {
    const cvorovi = linesDb.getAllCvorovi();
    res.json({ success: true, data: cvorovi });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/lines/rooms
 * Helper for filter and modal dropdowns (all offices / rooms).
 */
linesRouter.get('/rooms', (req: Request, res: Response) => {
  try {
    const rooms = linesDb.getAllRooms();
    res.json({ success: true, data: rooms });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/lines/export/excel
 * Exports lines to a styled Excel (.xlsx) file.
 */
linesRouter.get('/export/excel', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const cvorId = req.query.cvorId ? parseInt(req.query.cvorId as string, 10) : undefined;
    const roomId = req.query.roomId ? parseInt(req.query.roomId as string, 10) : undefined;
    const buildingId = req.query.buildingId ? parseInt(req.query.buildingId as string, 10) : undefined;
    const locationId = req.query.locationId ? parseInt(req.query.locationId as string, 10) : undefined;

    const { items } = linesDb.getLines({
      page: 1,
      limit: 10000,
      search,
      cvorId,
      roomId,
      buildingId,
      locationId,
      sortBy: 'id',
      sortOrder: 'ASC'
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Unipromet IT Admin';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Mrežne i Tel Linije', {
      views: [{ state: 'frozen', ySplit: 4 }]
    });

    // Title & Metadata
    sheet.mergeCells('A1:K1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'UNIPROMET - EVIDENCIJA MREŽNIH I TELEFONSKIH LINIJA';
    titleCell.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    sheet.getRow(1).height = 34;

    sheet.mergeCells('A2:K2');
    const metaCell = sheet.getCell('A2');
    metaCell.value = `Izveštaj generisan: ${new Date().toLocaleString('sr-RS')} | Ukupno linija: ${items.length}`;
    metaCell.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
    metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
    metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    sheet.getRow(2).height = 20;

    sheet.getRow(3).height = 10; // Empty spacer

    // Header Row
    const headers = [
      'ID',
      'Zidna Utičnica #',
      'Patch Panel Port',
      'Kancelarija / Prostorija',
      'Sprat',
      'Objekat / Zgrada',
      'Lokacija / Fabrika',
      'Povezano Čvorište / Orman',
      'Dimenzije Ormana',
      'Trasa Kabla',
      'Pozicija / Detalji'
    ];

    const headerRow = sheet.getRow(4);
    headerRow.values = headers;
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF475569' } },
        bottom: { style: 'medium', color: { argb: 'FF1E293B' } },
        left: { style: 'thin', color: { argb: 'FF475569' } },
        right: { style: 'thin', color: { argb: 'FF475569' } }
      };
    });

    // Populate Data
    items.forEach((item, idx) => {
      const rowNum = idx + 5;
      const row = sheet.getRow(rowNum);

      row.values = [
        item.id,
        item.wall_socket_no || '-',
        item.patch_panel_code || '-',
        item.room_name || (item.room_code ? `Kanc ${item.room_code}` : '-'),
        item.room_floor !== null && item.room_floor !== undefined ? item.room_floor : '-',
        item.building_name || '-',
        item.location_name || '-',
        item.cvor_name || (item.cvor_id ? `Čvor #${item.cvor_id}` : '-'),
        item.cvor_rack_dims || '-',
        item.route_description || '-',
        item.description || '-'
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

        if ([1, 2, 3, 5].includes(colNum)) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });
    });

    // Auto fit column widths
    sheet.columns = [
      { width: 8 },  // ID
      { width: 18 }, // Zidna uticnica
      { width: 18 }, // Patch panel port
      { width: 32 }, // Kancelarija
      { width: 10 }, // Sprat
      { width: 26 }, // Objekat
      { width: 22 }, // Lokacija
      { width: 34 }, // Cvor
      { width: 20 }, // Dimenzije ormana
      { width: 45 }, // Trasa
      { width: 45 }  // Opis
    ];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Unipromet_Linije_${new Date().toISOString().split('T')[0]}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error('[Lines] Excel export error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/lines
 * Paginated and filtered lines listing.
 */
linesRouter.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = req.query.search as string | undefined;
    const cvorId = req.query.cvorId ? parseInt(req.query.cvorId as string, 10) : undefined;
    const roomId = req.query.roomId ? parseInt(req.query.roomId as string, 10) : undefined;
    const buildingId = req.query.buildingId ? parseInt(req.query.buildingId as string, 10) : undefined;
    const locationId = req.query.locationId ? parseInt(req.query.locationId as string, 10) : undefined;
    const sortBy = req.query.sortBy as string | undefined;
    const sortOrder = (req.query.sortOrder as string)?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const result = linesDb.getLines({
      page,
      limit,
      search,
      cvorId,
      roomId,
      buildingId,
      locationId,
      sortBy,
      sortOrder
    });

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
    console.error('[Lines] Error listing lines:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/lines/:id
 * Single line details with enriched equipment and employees.
 */
linesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID linije' });

    const item = linesDb.getLineById(id);
    if (!item) return res.status(404).json({ success: false, error: 'Mrežna linija nije pronađena' });

    // Enrich room equipment with Navision employees
    if (item.room_equipment_list && item.room_equipment_list.length > 0) {
      const empCodes = item.room_equipment_list.map(e => e.employee_no).filter(Boolean) as string[];
      if (empCodes.length > 0) {
        try {
          const empMap = await navisionService.getEmployeesMap(empCodes);
          for (const eq of item.room_equipment_list) {
            if (eq.employee_no && empMap[eq.employee_no]) {
              eq.employee_name = empMap[eq.employee_no].full_name;
            }
          }
        } catch (e) {
          // Ignore
        }
      }
    }

    res.json({ success: true, data: item });
  } catch (err: any) {
    console.error('[Lines] Error getting line details:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/lines
 * Creates new line with dual-write to 121.20.
 */
linesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      wall_socket_no,
      patch_panel_code,
      room_id,
      cvor_id,
      route_description,
      description
    } = req.body;

    const input: LineInput = {
      wall_socket_no: wall_socket_no !== undefined && wall_socket_no !== null && wall_socket_no !== '' ? parseInt(String(wall_socket_no), 10) : null,
      patch_panel_code: patch_panel_code ? String(patch_panel_code).trim() : null,
      room_id: room_id ? parseInt(String(room_id), 10) : null,
      cvor_id: cvor_id ? parseInt(String(cvor_id), 10) : null,
      route_description: route_description ? String(route_description).trim() : null,
      description: description ? String(description).trim() : null
    };

    const created = linesDb.createLine(input);
    const newId = created.id;

    // Dual-write to 121.20
    legacySyncBridge.dualWriteCreateLine({
      ...input,
      id: newId
    }).catch((err: any) => {
      console.warn('[Lines] Dual-write create line error:', err.message);
    });

    addServerLog('info', `Kreirana nova mrežna linija #${newId} (Zid: ${input.wall_socket_no || '-'}, Panel: ${input.patch_panel_code || '-'})`, 'Linije');
    broadcastEquipmentEvent('line_created', { id: newId });

    res.status(201).json({ success: true, id: newId, message: 'Mrežna linija je uspešno dodata' });
  } catch (err: any) {
    console.error('[Lines] Error creating line:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/lines/:id
 * Updates line with dual-write to 121.20.
 */
linesRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID linije' });

    const existing = linesDb.getLineById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Mrežna linija nije pronađena' });

    const {
      wall_socket_no,
      patch_panel_code,
      room_id,
      cvor_id,
      route_description,
      description
    } = req.body;

    const input: LineInput = {
      wall_socket_no: wall_socket_no !== undefined ? (wall_socket_no !== null && wall_socket_no !== '' ? parseInt(String(wall_socket_no), 10) : null) : existing.wall_socket_no,
      patch_panel_code: patch_panel_code !== undefined ? (patch_panel_code ? String(patch_panel_code).trim() : null) : existing.patch_panel_code,
      room_id: room_id !== undefined ? (room_id ? parseInt(String(room_id), 10) : null) : existing.room_id,
      cvor_id: cvor_id !== undefined ? (cvor_id ? parseInt(String(cvor_id), 10) : null) : existing.cvor_id,
      route_description: route_description !== undefined ? (route_description ? String(route_description).trim() : null) : existing.route_description,
      description: description !== undefined ? (description ? String(description).trim() : null) : existing.description
    };

    linesDb.updateLine(id, input);

    // Dual-write to 121.20
    legacySyncBridge.dualWriteUpdateLine(id, input).catch((err: any) => {
      console.warn('[Lines] Dual-write update line error:', err.message);
    });

    addServerLog('info', `Ažurirana mrežna linija #${id}`, 'Linije');
    broadcastEquipmentEvent('line_updated', { id });

    res.json({ success: true, message: 'Mrežna linija je uspešno izmenjena' });
  } catch (err: any) {
    console.error('[Lines] Error updating line:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/lines/:id
 * Deletes line with dual-write to 121.20.
 */
linesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID linije' });

    const existing = linesDb.getLineById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Mrežna linija nije pronađena' });

    linesDb.deleteLine(id);

    // Dual-write to 121.20
    legacySyncBridge.dualWriteDeleteLine(id).catch((err: any) => {
      console.warn('[Lines] Dual-write delete line error:', err.message);
    });

    addServerLog('warn', `Obrisana mrežna linija #${id} (Zid: ${existing.wall_socket_no || '-'}, Panel: ${existing.patch_panel_code || '-'})`, 'Linije');
    broadcastEquipmentEvent('line_deleted', { id });

    res.json({ success: true, message: 'Mrežna linija je uspešno obrisana' });
  } catch (err: any) {
    console.error('[Lines] Error deleting line:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
