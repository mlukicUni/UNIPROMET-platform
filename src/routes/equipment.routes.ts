import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { equipmentDb, EquipmentInput, EquipmentDetails } from '../db/equipmentDb';
import { navisionService } from '../services/navisionService';
import { addServerLog } from './system.routes';
// [LEGACY_BRIDGE_START]
import { legacySyncBridge } from '../services/legacySyncBridge';
// [LEGACY_BRIDGE_END]

export const equipmentRouter = Router();

// Track SSE connected clients for real-time live table updates
const sseClients: Set<Response> = new Set();

export function broadcastEquipmentEvent(type: string, data?: any) {
  const payload = `data: ${JSON.stringify({ type, timestamp: new Date().toISOString(), ...data })}\n\n`;
  console.log(`[Equipment SSE] 📡 Broadcasting live event "${type}" to ${sseClients.size} client(s)`);
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// [LEGACY_BRIDGE_START]
// Forward events from legacy sync bridge to web clients
legacySyncBridge.onSyncEvent((event) => {
  broadcastEquipmentEvent(event.type);
});

// Periodic background check of legacy database (every 3 seconds for instant real-time sync)
setInterval(async () => {
  try {
    await legacySyncBridge.checkAndSync(false);
  } catch (err) {
    // Ignore background check errors
  }
}, 3000);
// [LEGACY_BRIDGE_END]

// Keep-alive heartbeat every 15 seconds to prevent browser SSE timeout
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': keepalive\n\n');
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 15000);

// ============================================================================
// REAL-TIME SSE STREAM & FAST CHECKSUM
// ============================================================================

/**
 * GET /api/equipment/events
 * Real-time Server-Sent Events stream to trigger silent UI auto-refresh.
 */
equipmentRouter.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

/**
 * GET /api/equipment/sync-check
 * Fast 17ms checksum check endpoint triggered on sidebar clicks.
 */
equipmentRouter.get('/sync-check', async (_req: Request, res: Response) => {
  try {
    // [LEGACY_BRIDGE_START]
    const result = await legacySyncBridge.checkAndSync(false);
    return res.json({
      success: true,
      changed: result.changed,
      durationMs: result.durationMs,
      status: legacySyncBridge.getStatus()
    });
    // [LEGACY_BRIDGE_END]
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/equipment/webhook/legacy-change
 * GET  /api/equipment/webhook/legacy-change
 * Fast webhook called by legacy 121.20 server to trigger instant sync & live SSE push.
 */
equipmentRouter.all('/webhook/legacy-change', async (_req: Request, res: Response) => {
  try {
    // [LEGACY_BRIDGE_START]
    const result = await legacySyncBridge.checkAndSync(true); // Force sync check
    broadcastEquipmentEvent('legacy_webhook_sync', { changed: result.changed });
    res.json({
      success: true,
      message: 'Legacy webhook obrađen i sinhronizacija izvršena',
      changed: result.changed,
      durationMs: result.durationMs
    });
    // [LEGACY_BRIDGE_END]
  } catch (err: any) {
    console.warn('[Equipment] Webhook legacy-change greška:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 1. STATS & CATEGORIES (For Dynamic Sidebar & KPI Cards)
// ============================================================================

/**
 * GET /api/equipment/categories
 * Returns categories with active count and icon for the dynamic sidebar.
 */
equipmentRouter.get('/categories', async (_req: Request, res: Response) => {
  try {
    const categories = equipmentDb.getCategoriesWithCounts();
    const totalCount = categories.reduce((sum, c) => sum + (c.count || 0), 0);

    res.json({
      success: true,
      totalCount,
      categories
    });
  } catch (err: any) {
    console.error('[Equipment] Error fetching categories:', err);
    res.status(500).json({ success: false, error: 'Greška pri preuzimanju kategorija opreme' });
  }
});

/**
 * GET /api/equipment/stats
 * Returns KPI counters (Ukupno, U upotrebi, Rezerva, Servis/Kvar, Računari, Štampači, Ostalo).
 */
equipmentRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const categoryId = req.query.category_id ? parseInt(req.query.category_id as string, 10) : undefined;
    if (categoryId) {
      const s = equipmentDb.getStats(categoryId);
      return res.json({
        success: true,
        stats: {
          total: s.total,
          inUse: s.in_use,
          inReserve: s.in_reserve,
          inService: s.in_service
        }
      });
    }

    const stats = equipmentDb.getKPIStats();
    res.json({
      success: true,
      stats
    });
  } catch (err: any) {
    console.error('[Equipment] Error fetching stats:', err);
    res.status(500).json({ success: false, error: 'Greška pri preuzimanju statistike opreme' });
  }
});


/**
 * GET /api/equipment/codebooks
 * Returns lookup tables for select dropdowns (statuses, locations, rooms, categories).
 */
equipmentRouter.get('/codebooks', async (_req: Request, res: Response) => {
  try {
    const codebooks = equipmentDb.getCodebooks();
    res.json({
      success: true,
      data: codebooks
    });
  } catch (err: any) {
    console.error('[Equipment] Error fetching codebooks:', err);
    res.status(500).json({ success: false, error: 'Greška pri preuzimanju šifarnika' });
  }
});

// ============================================================================
// 2. NAVISION LIVE EMPLOYEE SEARCH (Debounced Autocomplete)
// ============================================================================

/**
 * GET /api/equipment/nav-employees?q=term
 * Live search against Navision 2016 (Unipromet & Noleko) with debounced input.
 */
equipmentRouter.get('/nav-employees', async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query || query.length < 2) {
      return res.json({ success: true, employees: [] });
    }

    const employees = await navisionService.searchEmployees(query, 25);
    res.json({
      success: true,
      employees
    });
  } catch (err: any) {
    console.error('[Equipment] Error searching Navision employees:', err);
    res.status(500).json({ success: false, error: 'Greška pri pretrazi zaposlenih u Navision bazi' });
  }
});

// ============================================================================
// 3. EQUIPMENT CRUD OPERATIONS
// ============================================================================

/**
 * GET /api/equipment
 * Paginated and filtered list of equipment with attached live Navision employee data.
 */
equipmentRouter.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(10000, Math.max(1, parseInt(req.query.pageSize as string, 10) || 50));

    const categoryId = req.query.category_id ? parseInt(req.query.category_id as string, 10) : undefined;
    const statusId = req.query.status_id ? parseInt(req.query.status_id as string, 10) : undefined;
    const statusGroup = typeof req.query.status_group === 'string' ? (req.query.status_group as any) : undefined;
    const locationId = req.query.location_id ? parseInt(req.query.location_id as string, 10) : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    let matchedEmpNos: string[] = [];
    if (search && search.trim()) {
      try {
        const empResults = await navisionService.searchEmployees(search.trim(), 1000);
        if (empResults && empResults.length > 0) {
          matchedEmpNos = empResults.map(e => e.employee_no).filter((no): no is string => Boolean(no));
        }
      } catch (e) {
        // Fallback if Navision DB unreachable
      }
    }

    const result = equipmentDb.getEquipmentList(
      {
        categoryId,
        statusId,
        statusGroup,
        locationId,
        search,
        employeeNos: matchedEmpNos
      },
      {
        page,
        pageSize
      }
    );

    // Collect all employee numbers on this page
    const employeeNos = result.items.map(item => item.employee_no).filter(Boolean);

    // Fetch Navision live info (from cache or live query)
    if (employeeNos.length > 0) {
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
    }

    res.json({
      success: true,
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages
    });
  } catch (err: any) {
    console.error('[Equipment] Error fetching equipment list:', err);
    res.status(500).json({ success: false, error: 'Greška pri preuzimanju liste opreme' });
  }
});

/**
 * GET /api/equipment/export/excel
 * Generates and streams a luxury styled Microsoft Excel (.xlsx) workbook
 * containing all equipment matching active filters across all pages.
 */
equipmentRouter.get('/export/excel', async (req: Request, res: Response) => {
  try {
    const categoryId = req.query.category_id ? parseInt(req.query.category_id as string, 10) : undefined;
    const statusId = req.query.status_id ? parseInt(req.query.status_id as string, 10) : undefined;
    const statusGroup = typeof req.query.status_group === 'string' ? (req.query.status_group as any) : undefined;
    const locationId = req.query.location_id ? parseInt(req.query.location_id as string, 10) : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    let matchedEmpNos: string[] = [];
    if (search && search.trim()) {
      try {
        const empResults = await navisionService.searchEmployees(search.trim(), 1000);
        if (empResults && empResults.length > 0) {
          matchedEmpNos = empResults.map(e => e.employee_no).filter((no): no is string => Boolean(no));
        }
      } catch (e) {
        // Fallback if Navision DB unreachable
      }
    }

    // Fetch all records (up to 10000) matching current filters
    const result = equipmentDb.getEquipmentList(
      {
        categoryId,
        statusId,
        statusGroup,
        locationId,
        search,
        employeeNos: matchedEmpNos
      },
      {
        page: 1,
        pageSize: 10000
      }
    );

    // Fetch Navision live employee info
    const employeeNos = result.items.map(item => item.employee_no).filter(Boolean);
    if (employeeNos.length > 0) {
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
    }

    const items = result.items;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeFormatted = now.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
    const dateFormatted = now.toLocaleDateString('sr-RS');

    // Create ExcelJS Workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = 'UNIPROMET DOO ČAČAK';
    wb.lastModifiedBy = 'UNIPROMET Centralni IT Admin Panel';
    wb.created = now;

    const ws = wb.addWorksheet('Evidencija IT Opreme', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 4, showGridLines: true }]
    });

    // Determine filter summary description for subtitle
    const filterParts: string[] = [];
    if (categoryId) {
      const cat = equipmentDb.getCategoryById(categoryId);
      if (cat) filterParts.push(`Kategorija: ${cat.name}`);
    } else {
      filterParts.push('Kategorija: Sva IT oprema');
    }
    if (statusId) {
      const st = equipmentDb.getStatusById(statusId);
      if (st) filterParts.push(`Status: ${st.name}`);
    } else if (statusGroup) {
      const groupLabels: Record<string, string> = {
        in_use: 'U upotrebi (Zaduženo)',
        in_reserve: 'Rezerva (Slobodno)',
        service: 'Servis / Neispravno'
      };
      filterParts.push(`Statusna grupa: ${groupLabels[statusGroup] || statusGroup}`);
    }
    if (locationId) {
      const loc = equipmentDb.getLocationById(locationId);
      if (loc) filterParts.push(`Lokacija: ${loc.name}`);
    }
    if (search && search.trim()) {
      filterParts.push(`Pretraga: "${search.trim()}"`);
    }
    const filterDesc = filterParts.join('   |   ');

    // Header Columns Definition
    const headers = [
      'ID',
      'Naziv Opreme',
      'Kategorija',
      'Status',
      'Lokacija',
      'Kancelarija',
      'Zaduženi Radnik',
      'Kadrovski Broj',
      'Radno Mesto',
      'Sektor / Odeljenje',
      'HR Status',
      'Inventarski Broj',
      'Šifra',
      'Komentar',
      'Opis',
      'IP Adresa',
      'MAC Adresa',
      'Operativni Sistem',
      'Procesor',
      'RAM Memorija',
      'Hard Disk / SSD',
      'Matična Ploča',
      'Dobavljač',
      'Datum Dospeća'
    ];

    // ROW 1: Luxury Title Banner
    const titleRow = ws.addRow(['UNIPROMET DOO ČAČAK — EVIDENCIJA IT I RAČUNARSKE OPREME']);
    ws.mergeCells('A1:X1');
    titleRow.height = 34;
    const titleCell = titleRow.getCell(1);
    titleCell.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; // Deep Navy Slate
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    // ROW 2: Subtitle with filters, timestamp and total count
    const subtitleRow = ws.addRow([
      `Datum izvoza: ${dateFormatted} u ${timeFormatted}   |   Ukupno stavki: ${items.length}   |   ${filterDesc}`
    ]);
    ws.mergeCells('A2:X2');
    subtitleRow.height = 22;
    const subCell = subtitleRow.getCell(1);
    subCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFF59E0B' } }; // Unipromet Gold/Yellow
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; // Dark Slate
    subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    // ROW 3: Blank separator
    const sepRow = ws.addRow([]);
    sepRow.height = 8;

    // ROW 4: Table Headers
    const headerRow = ws.addRow(headers);
    headerRow.height = 28;
    headerRow.eachCell((cell, colIdx) => {
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF334155' } },
        bottom: { style: 'medium', color: { argb: 'FFF59E0B' } }, // Golden accent bottom line
        left: { style: 'thin', color: { argb: 'FF334155' } },
        right: { style: 'thin', color: { argb: 'FF334155' } }
      };
      // Center code & status headers, left-align text headers
      if ([1, 4, 8, 11, 13, 16, 17, 24].includes(colIdx)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      }
    });

    // Populate Data Rows with Zebra Striping and Status Styling
    items.forEach((item, index) => {
      const isEven = index % 2 === 0;
      const rowBg = isEven ? 'FFFFFFFF' : 'FFF8FAFC'; // Alternating clean white and soft slate

      const diskStr = item.details?.disk_capacity
        ? `${item.details.disk_capacity} ${item.details.disk_type || ''}`.trim()
        : (item.details?.disk_type || '');

      const isUnassigned = !item.employee_no || item.employee_no.trim().toUpperCase() === 'BEZ';
      const empName = isUnassigned ? '' : (item.employee_name || '');
      const empNo = isUnassigned ? '' : (item.employee_no || '');
      const empJob = isUnassigned ? '' : (item.employee_job || '');
      const empDept = isUnassigned ? '' : (item.employee_dept || '');
      const empStatus = isUnassigned ? '' : (item.employee_status || 'Aktivan');

      const rowValues = [
        `#${item.id}`,
        item.name || '',
        item.category_name || '',
        item.status_name || '',
        item.location_name || '',
        item.room_name || '',
        empName,
        empNo,
        empJob,
        empDept,
        empStatus,
        item.inventory_no || '',
        item.custom_code !== undefined && item.custom_code !== null ? String(item.custom_code) : '',
        item.comment || '',
        item.description || '',
        item.details?.ip_address || '',
        item.details?.mac_address || '',
        item.details?.os || '',
        item.details?.processor || '',
        item.details?.ram || '',
        diskStr,
        item.details?.motherboard || '',
        item.date_purchased || '',
        item.date_arrived || ''
      ];

      const dataRow = ws.addRow(rowValues);
      dataRow.height = 23;

      dataRow.eachCell({ includeEmpty: true }, (cell, colIdx) => {
        // Base Font & Fill
        cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF1E293B' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        // Alignments
        if ([1, 8, 11, 13, 24].includes(colIdx)) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if ([16, 17].includes(colIdx)) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.font = { name: 'Consolas', size: 9, color: { argb: 'FF334155' } };
        } else if (colIdx === 4) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        }

        // Col 1: ID
        if (colIdx === 1) {
          cell.font = { name: 'Consolas', size: 9.5, bold: true, color: { argb: 'FF475569' } };
        }

        // Col 2: Equipment Name
        if (colIdx === 2) {
          cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
        }

        // Col 4: Status Badge Coloring
        if (colIdx === 4) {
          const sName = (item.status_name || '').toUpperCase();
          if (sName.includes('SERVIS') || sName.includes('NEISPRAV') || sName.includes('KVAR')) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }; // Soft red
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFB91C1C' } };
          } else if (sName.includes('REZERVA') || sName.includes('MAGACIN') || sName.includes('SLOBOD')) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } }; // Soft blue
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF0369A1' } };
          } else if (sName.includes('RASHOD') || sName.includes('OTPIS')) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; // Soft slate
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF64748B' } };
          } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } }; // Soft green
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF15803D' } };
          }
        }

        // Col 11: HR Status Coloring
        if (colIdx === 11) {
          const hr = (empStatus || '').toLowerCase();
          if (hr.includes('neaktivan') || hr.includes('napustio')) {
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFDC2626' } };
          } else if (hr) {
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF16A34A' } };
          }
        }
      });
    });

    // Auto-calculate dynamic column widths with safety minimums and padding
    const minWidths: number[] = [
      10, // 1: ID
      32, // 2: Naziv Opreme
      20, // 3: Kategorija
      22, // 4: Status
      24, // 5: Lokacija
      22, // 6: Kancelarija
      26, // 7: Zaduženi Radnik
      16, // 8: Kadrovski Broj
      28, // 9: Radno Mesto
      28, // 10: Sektor / Odeljenje
      16, // 11: HR Status
      20, // 12: Inventarski Broj
      14, // 13: Šifra
      30, // 14: Komentar
      30, // 15: Opis
      18, // 16: IP Adresa
      20, // 17: MAC Adresa
      24, // 18: Operativni Sistem
      26, // 19: Procesor
      18, // 20: RAM Memorija
      22, // 21: Hard Disk / SSD
      24, // 22: Matična Ploča
      22, // 23: Dobavljač
      16  // 24: Datum Dospeća
    ];

    ws.columns.forEach((col, idx) => {
      let maxContentLength = 0;
      col.eachCell?.({ includeEmpty: false }, (cell, rowNumber) => {
        if (rowNumber >= 4) { // Only calculate based on header and data cells
          const text = cell.value ? String(cell.value) : '';
          maxContentLength = Math.max(maxContentLength, text.length);
        }
      });
      const fallbackMin = minWidths[idx] || 16;
      // Provide comfortable padding (+4 characters) so nothing is truncated
      const calculatedWidth = Math.max(maxContentLength + 4, fallbackMin);
      col.width = Math.min(Math.max(calculatedWidth, fallbackMin), 55);
    });

    // Enable Excel Auto-Filter on table headers
    ws.autoFilter = { from: 'A4', to: 'X4' };

    // Set Response Headers and Stream XLSX Binary
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Unipromet_IT_Oprema_${dateStr}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();

  } catch (err: any) {
    console.error('[Equipment Export] Error generating Excel export:', err);
    res.status(500).json({ success: false, error: 'Greška pri generisanju Excel datoteke: ' + err.message });
  }
});

// ============================================================================
// SOFTWARE & LICENSES ROUTES (Placed before /:id to prevent route shadowing)
// ============================================================================

/**
 * GET /api/equipment/software-stats
 * Retrieves software stats for KPI cards.
 */
equipmentRouter.get('/software-stats', (_req: Request, res: Response) => {
  try {
    const stats = equipmentDb.getSoftwareStats();
    res.json({ success: true, data: stats });
  } catch (err: any) {
    console.error('[Equipment] Error getting software stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/equipment/software-vendors
 * Retrieves unique vendors for filtering.
 */
equipmentRouter.get('/software-vendors', (_req: Request, res: Response) => {
  try {
    const vendors = equipmentDb.getSoftwareVendors();
    res.json({ success: true, data: vendors });
  } catch (err: any) {
    console.error('[Equipment] Error getting software vendors:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/equipment/software-licenses
 * GET /api/equipment/software
 * Lists all software licenses across all equipment with live Navision employee enrichment.
 */
const handleGetAllSoftware = async (req: Request, res: Response) => {
  try {
    const { search, vendor, is_licensed, page, pageSize, sortBy, sortOrder } = req.query;

    let isLicensedVal: number | null = null;
    if (is_licensed !== undefined && is_licensed !== '' && is_licensed !== 'all') {
      isLicensedVal = is_licensed === '1' || is_licensed === 'true' ? 1 : 0;
    }

    const result = equipmentDb.getAllSoftware({
      search: typeof search === 'string' ? search : undefined,
      vendor: typeof vendor === 'string' ? vendor : undefined,
      is_licensed: isLicensedVal,
      page: page ? parseInt(String(page), 10) : 1,
      pageSize: pageSize ? parseInt(String(pageSize), 10) : 50,
      sortBy: typeof sortBy === 'string' ? sortBy : undefined,
      sortOrder: (sortOrder === 'ASC' || sortOrder === 'asc') ? 'ASC' : 'DESC'
    });

    // Extract employee numbers and enrich with Navision 2016 details
    const employeeNos = result.items
      .map(i => i.equipment_employee_no)
      .filter((no): no is string => Boolean(no && typeof no === 'string' && no.trim().length > 0 && no.trim().toUpperCase() !== 'BEZ'));

    let empMap: Record<string, any> = {};
    if (employeeNos.length > 0) {
      try {
        empMap = await navisionService.getEmployeesMap(employeeNos);
      } catch (err: any) {
        console.warn('[Equipment] Navision enrichment error for software list:', err.message);
      }
    }

    const enrichedItems = result.items.map(i => {
      const empNo = i.equipment_employee_no ? i.equipment_employee_no.trim() : null;
      const emp = empNo && empMap[empNo] ? empMap[empNo] : null;
      return {
        ...i,
        employee_name: emp ? (emp.full_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim()) : (i.equipment_employee_no || null),
        employee_dept: emp ? emp.department : null,
        employee_job: emp ? emp.job_title : null,
        employee_status: emp ? emp.hr_status : null,
        employee_avatar: emp ? (emp.avatar_url || null) : null
      };
    });

    res.json({
      success: true,
      data: enrichedItems,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages
    });
  } catch (err: any) {
    console.error('[Equipment] Error fetching software licenses:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

equipmentRouter.get('/software-licenses', handleGetAllSoftware);
equipmentRouter.get('/software', handleGetAllSoftware);

/**
 * GET /api/equipment/software-licenses/:id
 * Retrieves single software license details.
 */
equipmentRouter.get('/software-licenses/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID softvera' });

    const item = equipmentDb.getSoftwareById(id);
    if (!item) return res.status(404).json({ success: false, error: 'Softverska licenca nije pronađena' });

    res.json({ success: true, data: item });
  } catch (err: any) {
    console.error('[Equipment] Error fetching single software:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/equipment/software-licenses
 * Creates a new software license.
 */
equipmentRouter.post('/software-licenses', async (req: Request, res: Response) => {
  try {
    const { equipment_id, vendor, name, is_licensed, license_key, note } = req.body;
    const eqId = parseInt(equipment_id, 10);
    if (isNaN(eqId)) return res.status(400).json({ success: false, error: 'Nevažeći ID računara / opreme' });
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Naziv softvera je obavezan' });

    const softId = equipmentDb.addEquipmentSoftware(eqId, {
      vendor,
      name: name.trim(),
      is_licensed: is_licensed !== undefined ? (is_licensed === 1 || is_licensed === true ? 1 : 0) : 1,
      license_key,
      note
    });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteAddSoftware(eqId, { vendor, name, is_licensed, license_key, note }).catch(err => {
      console.warn('[Equipment] Background dual-write add software error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('equipment_software_added', { equipmentId: eqId, softwareId: softId });
    res.status(201).json({ success: true, id: softId, message: 'Softverska licenca je uspešno dodata' });
  } catch (err: any) {
    console.error('[Equipment] Error creating software license:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/equipment/software-licenses/:id
 * Updates an existing software license.
 */
equipmentRouter.put('/software-licenses/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID softvera' });

    const { equipment_id, vendor, name, is_licensed, license_key, note } = req.body;
    const eqId = equipment_id !== undefined ? parseInt(equipment_id, 10) : undefined;

    const updated = equipmentDb.updateEquipmentSoftware(id, {
      equipment_id: eqId,
      vendor,
      name,
      is_licensed: is_licensed !== undefined ? (is_licensed === 1 || is_licensed === true ? 1 : 0) : undefined,
      license_key,
      note
    });

    if (!updated) return res.status(404).json({ success: false, error: 'Softverska licenca nije pronađena' });

    // [LEGACY_BRIDGE_START]
    if (eqId) {
      legacySyncBridge.dualWriteUpdateSoftware(id, eqId, { vendor, name, is_licensed, license_key, note }).catch(err => {
        console.warn('[Equipment] Background dual-write update software error:', err.message);
      });
    }
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('equipment_software_updated', { softwareId: id });
    res.json({ success: true, message: 'Softverska licenca je ažurirana' });
  } catch (err: any) {
    console.error('[Equipment] Error updating software license:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/equipment/software/:id
 * DELETE /api/equipment/software-licenses/:id
 * Deletes a software license entry.
 */
const handleDeleteSoftware = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID softvera' });

    equipmentDb.deleteEquipmentSoftware(id);

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteDeleteSoftware(id).catch(err => {
      console.warn('[Equipment] Background dual-write delete software error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('equipment_software_deleted', { softwareId: id });
    res.json({ success: true, message: 'Softverska licenca je uklonjena' });
  } catch (err: any) {
    console.error('[Equipment] Error deleting software:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

equipmentRouter.delete('/software/:id', handleDeleteSoftware);
equipmentRouter.delete('/software-licenses/:id', handleDeleteSoftware);

// ============================================================================
// 4. DICTIONARIES / ŠIFARNICI CRUD ROUTES (Placed before /:id)
// ============================================================================

/**
 * POST /api/equipment/dictionaries/sync
 * Forces immediate synchronization of all codebooks / dictionaries with 192.168.121.20
 */
equipmentRouter.post('/dictionaries/sync', async (_req: Request, res: Response) => {
  try {
    // [LEGACY_BRIDGE_START]
    const result = await legacySyncBridge.checkAndSync(true);
    // [LEGACY_BRIDGE_END]
    broadcastEquipmentEvent('dictionaries_synced', { durationMs: result.durationMs });
    res.json({
      success: true,
      message: 'Šifarnici su uspešno sinhronizovani sa serverom 192.168.121.20',
      durationMs: result.durationMs
    });
  } catch (err: any) {
    console.error('[Equipment] Greška pri sinhronizaciji šifarnika sa 121.20:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- A. STATUSES (Statusi opreme) ---
equipmentRouter.get('/dictionaries/statuses', (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const statuses = equipmentDb.getStatuses(search);
    res.json({ success: true, data: statuses });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.get('/dictionaries/statuses/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID statusa' });
    const status = equipmentDb.getStatusById(id);
    if (!status) return res.status(404).json({ success: false, error: 'Status nije pronađen' });
    res.json({ success: true, data: status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.post('/dictionaries/statuses', (req: Request, res: Response) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Naziv statusa je obavezan' });
    const status = equipmentDb.createStatus({ name, color });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteCreateStatus(status.id, status.name).catch(err => {
      console.warn('[Equipment] Background dual-write create status error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Kreiran status opreme: ${status.name} (#${status.id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'statuses', id: status.id });
    res.status(201).json({ success: true, data: status, message: 'Status je uspešno kreiran' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.put('/dictionaries/statuses/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID statusa' });
    const { name, color } = req.body;
    const updated = equipmentDb.updateStatus(id, { name, color });
    if (!updated) return res.status(404).json({ success: false, error: 'Status nije pronađen' });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteUpdateStatus(id, updated.name).catch(err => {
      console.warn('[Equipment] Background dual-write update status error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Ažuriran status opreme: ${updated.name} (#${id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'statuses', id });
    res.json({ success: true, data: updated, message: 'Status je uspešno ažuriran' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.delete('/dictionaries/statuses/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID statusa' });
    const status = equipmentDb.getStatusById(id);
    const success = equipmentDb.deleteStatus(id);
    if (!success) return res.status(404).json({ success: false, error: 'Status nije pronađen ili je u upotrebi' });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteDeleteStatus(id).catch(err => {
      console.warn('[Equipment] Background dual-write delete status error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('warn', `Obrisan status opreme: ${status?.name || id} (#${id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'statuses', id });
    res.json({ success: true, message: 'Status je uspešno obrisan' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- B. CATEGORIES (Kategorije opreme) ---
equipmentRouter.get('/dictionaries/categories', (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const categories = equipmentDb.getAllCategories(search);
    res.json({ success: true, data: categories });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.get('/dictionaries/categories/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID kategorije' });
    const cat = equipmentDb.getCategoryById(id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategorija nije pronađena' });
    res.json({ success: true, data: cat });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.post('/dictionaries/categories', (req: Request, res: Response) => {
  try {
    const { name, is_network, icon } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Naziv kategorije je obavezan' });
    const cat = equipmentDb.createCategory({ name, is_network, icon });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteCreateCategory(cat.id, cat.name, cat.is_network).catch(err => {
      console.warn('[Equipment] Background dual-write create category error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Kreirana kategorija opreme: ${cat.name} (#${cat.id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'categories', id: cat.id });
    res.status(201).json({ success: true, data: cat, message: 'Kategorija je uspešno kreirana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.put('/dictionaries/categories/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID kategorije' });
    const { name, is_network, icon } = req.body;
    const updated = equipmentDb.updateCategory(id, { name, is_network, icon });
    if (!updated) return res.status(404).json({ success: false, error: 'Kategorija nije pronađena' });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteUpdateCategory(id, updated.name, updated.is_network).catch(err => {
      console.warn('[Equipment] Background dual-write update category error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Ažurirana kategorija opreme: ${updated.name} (#${id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'categories', id });
    res.json({ success: true, data: updated, message: 'Kategorija je uspešno ažurirana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.delete('/dictionaries/categories/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID kategorije' });
    const cat = equipmentDb.getCategoryById(id);
    const success = equipmentDb.deleteCategory(id);
    if (!success) return res.status(404).json({ success: false, error: 'Kategorija nije pronađena' });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteDeleteCategory(id).catch(err => {
      console.warn('[Equipment] Background dual-write delete category error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('warn', `Obrisana kategorija opreme: ${cat?.name || id} (#${id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'categories', id });
    res.json({ success: true, message: 'Kategorija je uspešno obrisana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- C. LOCATIONS (Lokacije) ---
equipmentRouter.get('/dictionaries/locations', (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const locations = equipmentDb.getLocations(search);
    res.json({ success: true, data: locations });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.get('/dictionaries/locations/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID lokacije' });
    const loc = equipmentDb.getLocationById(id);
    if (!loc) return res.status(404).json({ success: false, error: 'Lokacija nije pronađena' });
    res.json({ success: true, data: loc });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.post('/dictionaries/locations', (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Naziv lokacije je obavezan' });
    const loc = equipmentDb.createLocation({ name });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteCreateLocation(loc.id, loc.name).catch(err => {
      console.warn('[Equipment] Background dual-write create location error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Kreirana lokacija: ${loc.name} (#${loc.id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'locations', id: loc.id });
    res.status(201).json({ success: true, data: loc, message: 'Lokacija je uspešno kreirana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.put('/dictionaries/locations/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID lokacije' });
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Naziv lokacije je obavezan' });
    const updated = equipmentDb.updateLocation(id, { name });
    if (!updated) return res.status(404).json({ success: false, error: 'Lokacija nije pronađena' });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteUpdateLocation(id, updated.name).catch(err => {
      console.warn('[Equipment] Background dual-write update location error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Ažurirana lokacija: ${updated.name} (#${id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'locations', id });
    res.json({ success: true, data: updated, message: 'Lokacija je uspešno ažurirana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.delete('/dictionaries/locations/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID lokacije' });
    const loc = equipmentDb.getLocationById(id);
    const success = equipmentDb.deleteLocation(id);
    if (!success) return res.status(404).json({ success: false, error: 'Lokacija nije pronađena' });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteDeleteLocation(id).catch(err => {
      console.warn('[Equipment] Background dual-write delete location error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('warn', `Obrisana lokacija: ${loc?.name || id} (#${id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'locations', id });
    res.json({ success: true, message: 'Lokacija je uspešno obrisana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- D. BUILDINGS (Objekti) ---
equipmentRouter.get('/dictionaries/buildings', (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const buildings = equipmentDb.getBuildings(search);
    res.json({ success: true, data: buildings });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.get('/dictionaries/buildings/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID objekta' });
    const building = equipmentDb.getBuildingById(id);
    if (!building) return res.status(404).json({ success: false, error: 'Objekat nije pronađen' });
    res.json({ success: true, data: building });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.post('/dictionaries/buildings', (req: Request, res: Response) => {
  try {
    const { name, location_id, code, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Naziv objekta je obavezan' });
    const building = equipmentDb.createBuilding({
      name,
      location_id: location_id ? parseInt(location_id, 10) : null,
      code,
      description
    });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteCreateBuilding(building.id, {
      name: building.name,
      location_id: building.location_id,
      description: building.description
    }).catch(err => {
      console.warn('[Equipment] Background dual-write create building error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Kreiran objekat: ${building.name} (#${building.id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'buildings', id: building.id });
    res.status(201).json({ success: true, data: building, message: 'Objekat je uspešno kreiran' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.put('/dictionaries/buildings/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID objekta' });
    const { name, location_id, code, description } = req.body;
    const updated = equipmentDb.updateBuilding(id, {
      name,
      location_id: location_id !== undefined ? (location_id ? parseInt(location_id, 10) : null) : undefined,
      code,
      description
    });
    if (!updated) return res.status(404).json({ success: false, error: 'Objekat nije pronađen' });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteUpdateBuilding(id, {
      name: updated.name,
      location_id: updated.location_id,
      description: updated.description
    }).catch(err => {
      console.warn('[Equipment] Background dual-write update building error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Ažuriran objekat: ${updated.name} (#${id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'buildings', id });
    res.json({ success: true, data: updated, message: 'Objekat je uspešno ažuriran' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.delete('/dictionaries/buildings/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID objekta' });
    const b = equipmentDb.getBuildingById(id);
    const success = equipmentDb.deleteBuilding(id);
    if (!success) return res.status(404).json({ success: false, error: 'Objekat nije pronađen' });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteDeleteBuilding(id).catch(err => {
      console.warn('[Equipment] Background dual-write delete building error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('warn', `Obrisan objekat: ${b?.name || id} (#${id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'buildings', id });
    res.json({ success: true, message: 'Objekat je uspešno obrisan' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- E. ROOMS (Kancelarije / Prostorije) ---
equipmentRouter.get('/dictionaries/rooms', (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const buildingId = req.query.building_id ? parseInt(req.query.building_id as string, 10) : undefined;
    const rooms = equipmentDb.getRooms(search, buildingId);
    res.json({ success: true, data: rooms });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.get('/dictionaries/rooms/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID kancelarije' });
    const room = equipmentDb.getRoomById(id);
    if (!room) return res.status(404).json({ success: false, error: 'Kancelarija nije pronađena' });
    res.json({ success: true, data: room });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.post('/dictionaries/rooms', (req: Request, res: Response) => {
  try {
    const { code, building, floor, short_desc, name } = req.body;
    if (!short_desc && !name && !code) {
      return res.status(400).json({ success: false, error: 'Oznaka ili naziv kancelarije je obavezno polje' });
    }
    const room = equipmentDb.createRoom({
      code,
      building: building ? parseInt(building, 10) : null,
      floor,
      short_desc,
      name
    });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteCreateRoom(room.id, {
      code: room.code,
      building: room.building,
      floor: room.floor,
      short_desc: room.short_desc,
      name: room.name
    }).catch(err => {
      console.warn('[Equipment] Background dual-write create room error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Kreirana kancelarija: ${room.short_desc || room.name || room.code} (#${room.id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'rooms', id: room.id });
    res.status(201).json({ success: true, data: room, message: 'Kancelarija je uspešno kreirana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.put('/dictionaries/rooms/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID kancelarije' });
    const { code, building, floor, short_desc, name } = req.body;
    const updated = equipmentDb.updateRoom(id, {
      code,
      building: building !== undefined ? (building ? parseInt(building, 10) : null) : undefined,
      floor,
      short_desc,
      name
    });
    if (!updated) return res.status(404).json({ success: false, error: 'Kancelarija nije pronađena' });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteUpdateRoom(id, {
      code: updated.code,
      building: updated.building,
      floor: updated.floor,
      short_desc: updated.short_desc,
      name: updated.name
    }).catch(err => {
      console.warn('[Equipment] Background dual-write update room error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Ažurirana kancelarija: ${updated.short_desc || updated.name || id} (#${id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'rooms', id });
    res.json({ success: true, data: updated, message: 'Kancelarija je uspešno ažurirana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

equipmentRouter.delete('/dictionaries/rooms/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID kancelarije' });
    const room = equipmentDb.getRoomById(id);
    const success = equipmentDb.deleteRoom(id);
    if (!success) return res.status(404).json({ success: false, error: 'Kancelarija nije pronađena' });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteDeleteRoom(id).catch(err => {
      console.warn('[Equipment] Background dual-write delete room error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('warn', `Obrisana kancelarija: ${room?.short_desc || room?.name || id} (#${id})`, 'Šifarnici');
    broadcastEquipmentEvent('dictionary_updated', { type: 'rooms', id });
    res.json({ success: true, message: 'Kancelarija je uspešno obrisana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/equipment/:id
 * Detailed view of single equipment item (with hardware specs, history timeline, software).
 */
equipmentRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Nevažeći ID opreme' });
    }

    const item = equipmentDb.getEquipmentById(id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Stavka opreme nije pronađena' });
    }

    // Attach Navision employee details if assigned
    if (item.employee_no && item.employee_no.trim().toUpperCase() !== 'BEZ') {
      try {
        const emp = await Promise.race([
          navisionService.getEmployeeByNo(item.employee_no.trim()),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 800))
        ]);
        if (emp) {
          item.employee_name = emp.full_name;
          item.employee_job = emp.job_title;
          item.employee_dept = emp.department;
          item.employee_status = emp.hr_status;
        }
      } catch (e) {
        // Continue gracefully without blocking response
      }
    }

    res.json({
      success: true,
      data: item
    });
  } catch (err: any) {
    console.error('[Equipment] Error fetching equipment details:', err);
    res.status(500).json({ success: false, error: 'Greška pri preuzimanju detalja opreme' });
  }
});

/**
 * POST /api/equipment
 * Creates a new equipment item, optional hardware details and software licenses.
 */
equipmentRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { name, category_id, status_id, location_id, room_id, employee_no, inventory_no, comment, description, date_arrived, date_purchased, custom_code, details, software, history } = req.body;

    const equipmentName = name ? String(name).trim() : '';

    const input: EquipmentInput = {
      name: equipmentName,
      category_id: category_id ? parseInt(category_id, 10) : null,
      status_id: status_id ? parseInt(status_id, 10) : 1, // Default "U upotrebi"
      location_id: location_id ? parseInt(location_id, 10) : null,
      room_id: room_id ? parseInt(room_id, 10) : null,
      employee_no: employee_no ? String(employee_no).trim() : null,
      inventory_no: inventory_no ? String(inventory_no).trim() : null,
      comment: comment ? String(comment).trim() : null,
      description: description ? String(description).trim() : null,
      date_arrived: date_arrived ? String(date_arrived).trim() : null,
      date_purchased: date_purchased ? String(date_purchased).trim() : null,
      custom_code: custom_code ? parseInt(custom_code, 10) : null
    };

    // Hardware specifications (Laptop / Računar only)
    let detailsInput: EquipmentDetails | undefined;
    if (details && typeof details === 'object') {
      detailsInput = {
        equipment_id: 0,
        os: details.os || null,
        ip_address: details.ip_address || null,
        mac_address: details.mac_address || null,
        ram: details.ram || null,
        processor: details.processor || null,
        disk_type: details.disk_type || null,
        disk_capacity: details.disk_capacity || null,
        motherboard: details.motherboard || null,
        monitor: details.monitor || null,
        gpu: details.gpu || null,
        gateway: details.gateway || null
      };
    }

    const softwareList = Array.isArray(software) ? software : undefined;
    const historyList = Array.isArray(history) ? history : undefined;
    const newId = equipmentDb.createEquipment(input, detailsInput, undefined, softwareList, historyList);

    // Add initial history entry if none was provided (prazni redovi istorije se ne računaju)
    if (!historyList || !historyList.some((h: any) => h && h.note && String(h.note).trim())) {
      equipmentDb.addEquipmentHistory(
        newId,
        `Oprema je uneta u sistem (${input.name})${input.employee_no ? ` - Zaduženo: ${input.employee_no}` : ''}`,
        new Date().toISOString().split('T')[0]
      );
    }

    addServerLog('info', `Dodata nova oprema ID #${newId}: "${input.name}"`, 'Equipment DB');

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteCreate(newId, input, detailsInput, softwareList, historyList).catch(err => {
      console.warn('[Equipment] Background dual-write create error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('equipment_created', { id: newId, category_id: input.category_id });

    res.status(201).json({
      success: true,
      id: newId,
      message: 'Oprema je uspešno evidentirana'
    });
  } catch (err: any) {
    console.error('[Equipment] Error creating equipment:', err);
    res.status(500).json({ success: false, error: 'Greška pri kreiranju opreme: ' + err.message });
  }
});

/**
 * PUT /api/equipment/:id
 * Updates an existing equipment item, its hardware details, software list and history notes.
 */
equipmentRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Nevažeći ID opreme' });
    }

    const { name, category_id, status_id, location_id, room_id, employee_no, inventory_no, comment, description, date_arrived, date_purchased, custom_code, details, software, history } = req.body;

    const input: Partial<EquipmentInput> = {};
    if (name !== undefined) input.name = name ? String(name).trim() : '';
    if (category_id !== undefined) input.category_id = category_id ? parseInt(category_id, 10) : null;
    if (status_id !== undefined) input.status_id = status_id ? parseInt(status_id, 10) : null;
    if (location_id !== undefined) input.location_id = location_id ? parseInt(location_id, 10) : null;
    if (room_id !== undefined) input.room_id = room_id ? parseInt(room_id, 10) : null;
    if (employee_no !== undefined) input.employee_no = employee_no ? String(employee_no).trim() : null;
    if (inventory_no !== undefined) input.inventory_no = inventory_no ? String(inventory_no).trim() : null;
    if (comment !== undefined) input.comment = comment ? String(comment).trim() : null;
    if (description !== undefined) input.description = description ? String(description).trim() : null;
    if (date_arrived !== undefined) input.date_arrived = date_arrived ? String(date_arrived).trim() : null;
    if (date_purchased !== undefined) input.date_purchased = date_purchased ? String(date_purchased).trim() : null;
    if (custom_code !== undefined) input.custom_code = custom_code ? parseInt(custom_code, 10) : null;

    let detailsInput: Partial<EquipmentDetails> | undefined;
    if (details && typeof details === 'object') {
      detailsInput = {
        os: details.os !== undefined ? details.os : undefined,
        ip_address: details.ip_address !== undefined ? details.ip_address : undefined,
        mac_address: details.mac_address !== undefined ? details.mac_address : undefined,
        ram: details.ram !== undefined ? details.ram : undefined,
        processor: details.processor !== undefined ? details.processor : undefined,
        disk_type: details.disk_type !== undefined ? details.disk_type : undefined,
        disk_capacity: details.disk_capacity !== undefined ? details.disk_capacity : undefined,
        motherboard: details.motherboard !== undefined ? details.motherboard : undefined,
        gpu: details.gpu !== undefined ? details.gpu : undefined,
        gateway: details.gateway !== undefined ? details.gateway : undefined
      };
    }

    const softwareList = Array.isArray(software) ? software : undefined;
    const historyList = Array.isArray(history) ? history : undefined;
    const updated = equipmentDb.updateEquipment(id, input, detailsInput, softwareList, historyList);
    addServerLog('info', `Ažurirana oprema ID #${id}: "${updated?.name || id}"`, 'Equipment DB');

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteUpdate(id, input, detailsInput, softwareList, historyList).catch(err => {
      console.warn('[Equipment] Background dual-write update error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('equipment_updated', { id, category_id: updated?.category_id });

    res.json({
      success: true,
      data: updated,
      message: 'Podaci o opremi su uspešno ažurirani'
    });
  } catch (err: any) {
    console.error('[Equipment] Error updating equipment:', err);
    res.status(500).json({ success: false, error: 'Greška pri izmeni opreme: ' + err.message });
  }
});

/**
 * PUT /api/equipment/history/:historyId
 * Updates an individual history / service note.
 */
equipmentRouter.put('/history/:historyId', async (req: Request, res: Response) => {
  try {
    const historyId = parseInt(req.params.historyId, 10);
    if (isNaN(historyId)) return res.status(400).json({ success: false, error: 'Nevažeći ID zabeleške' });

    const { note, date, phone } = req.body;
    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, error: 'Tekst zabeleške je obavezan' });
    }

    equipmentDb.updateEquipmentHistory(historyId, note, date, phone);

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteUpdateHistory(historyId, note, date, phone).catch(err => {
      console.warn('[Equipment] Background dual-write update history error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('equipment_history_updated', { historyId });
    res.json({ success: true, message: 'Zabeleška je uspešno izmenjena' });
  } catch (err: any) {
    console.error('[Equipment] Error updating history note:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/equipment/history/:historyId
 * Deletes an individual history / service note.
 */
equipmentRouter.delete('/history/:historyId', async (req: Request, res: Response) => {
  try {
    const historyId = parseInt(req.params.historyId, 10);
    if (isNaN(historyId)) return res.status(400).json({ success: false, error: 'Nevažeći ID zabeleške' });

    equipmentDb.deleteEquipmentHistory(historyId);

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteDeleteHistory(historyId).catch(err => {
      console.warn('[Equipment] Background dual-write delete history error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('equipment_history_deleted', { historyId });
    res.json({ success: true, message: 'Zabeleška je obrisana' });
  } catch (err: any) {
    console.error('[Equipment] Error deleting history note:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/equipment/:id/software
 * Adds a new software license to equipment.
 */
equipmentRouter.post('/:id/software', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID opreme' });

    const { vendor, name, is_licensed, license_key, note } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Naziv softvera je obavezan' });
    }

    const softId = equipmentDb.addEquipmentSoftware(id, {
      vendor,
      name: name.trim(),
      is_licensed: is_licensed !== undefined ? is_licensed : 1,
      license_key,
      note
    });

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteAddSoftware(id, { vendor, name, is_licensed, license_key, note }).catch(err => {
      console.warn('[Equipment] Background dual-write add software error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('equipment_software_added', { id, softwareId: softId });
    res.status(201).json({ success: true, id: softId, message: 'Softver je uspešno dodat' });
  } catch (err: any) {
    console.error('[Equipment] Error adding software:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/equipment/:id
 * Deletes an equipment item.
 */
equipmentRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Nevažeći ID opreme' });
    }

    const existing = equipmentDb.getEquipmentById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Stavka opreme nije pronađena' });
    }

    equipmentDb.deleteEquipment(id);
    addServerLog('warn', `Obrisana oprema ID #${id}: "${existing.name}"`, 'Equipment DB');

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteDelete(id).catch(err => {
      console.warn('[Equipment] Background dual-write delete error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('equipment_deleted', { id, category_id: existing.category_id });

    res.json({
      success: true,
      message: `Oprema #${id} je uspešno obrisana`
    });
  } catch (err: any) {
    console.error('[Equipment] Error deleting equipment:', err);
    res.status(500).json({ success: false, error: 'Greška pri brisanju opreme: ' + err.message });
  }
});

/**
 * POST /api/equipment/:id/history
 * Adds a service note / handover / status change note to equipment history timeline.
 */
equipmentRouter.post('/:id/history', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Nevažeći ID opreme' });
    }

    const { note, date, phone } = req.body;
    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, error: 'Opis intervencije/napomene je obavezan' });
    }

    const historyId = equipmentDb.addEquipmentHistory(id, note, date, phone);
    addServerLog('info', `Dodata zabeleška u istorijat za opremu #${id}`, 'Equipment DB');

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteAddHistory(id, note, date, phone).catch(err => {
      console.warn('[Equipment] Background dual-write add history error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('equipment_history_added', { id, historyId });

    res.status(201).json({
      success: true,
      historyId,
      message: 'Zabeleška je uspešno sačuvana'
    });
  } catch (err: any) {
    console.error('[Equipment] Error adding equipment history:', err);
    res.status(500).json({ success: false, error: 'Greška pri čuvanju zabeleške' });
  }
});
