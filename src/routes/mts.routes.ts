import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { mtsDb, MtsNumberInput } from '../db/mtsDb.js';
import { navisionService } from '../services/navisionService.js';
import { addServerLog } from './system.routes.js';
import { broadcastEquipmentEvent } from './equipment.routes.js';
// [LEGACY_BRIDGE_START]
import { legacySyncBridge } from '../services/legacySyncBridge.js';
// [LEGACY_BRIDGE_END]

export const mtsRouter = Router();

/**
 * GET /api/mts/stats
 * Quick KPI summary metrics for cards.
 */
mtsRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = mtsDb.getMtsStats();
    res.json({
      success: true,
      data: {
        total: stats.total,
        mobileActive: stats.mobile,
        gpsTotal: stats.gps,
        withAddons: stats.withInternetAddon + stats.withRoamingAddon,
        inactive: stats.inactive
      }
    });
  } catch (err: any) {
    console.error('[MTS] Error fetching stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/mts/packages
 * Dictionary of packages and add-ons (Paket_dodatak).
 */
mtsRouter.get('/packages', async (_req: Request, res: Response) => {
  try {
    const packages = mtsDb.getAllPackages();
    res.json({ success: true, data: packages });
  } catch (err: any) {
    console.error('[MTS] Error fetching packages:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/mts/export/excel
 * Rich, styled Excel export of filtered MTS phone numbers list.
 */
mtsRouter.get('/export/excel', async (req: Request, res: Response) => {
  try {
    const search = req.query.search ? String(req.query.search).trim() : undefined;
    const category = req.query.category ? String(req.query.category).trim() : undefined;
    const status = req.query.status ? String(req.query.status).trim() : undefined;
    const packageFilter = req.query.package ? String(req.query.package).trim() : undefined;
    const dodatak = req.query.dodatak ? String(req.query.dodatak).trim() : undefined;

    let matchedPhoneNumbers: string[] | null = null;
    if (search) {
      try {
        matchedPhoneNumbers = await navisionService.searchPhonesByEmployeeName(search);
      } catch (e) {
        // Ignore
      }
    }

    // Fetch all matching records without pagination
    const result = mtsDb.getMtsNumbers({
      search,
      kategorija: category,
      status,
      paket: packageFilter,
      dodatakInternet: dodatak === '1' ? 'YES' : undefined,
      matchedPhoneNumbers,
      limit: 100000,
      offset: 0
    });

    // Enrich all phone numbers with live Navision employee data
    try {
      const allPhones = result.items.map(i => i.telefon).filter(Boolean);
      const phoneEmpMap = await navisionService.getEmployeesByPhoneMap(allPhones);
      const explicitEmpNos = result.items.map(i => i.employee_no).filter(Boolean) as string[];
      const empMap = explicitEmpNos.length > 0 ? await navisionService.getEmployeesMap(explicitEmpNos) : {};

      for (const item of result.items) {
        let matchedEmp: any = null;
        if (item.employee_no && empMap[item.employee_no]) {
          matchedEmp = empMap[item.employee_no];
          item.sl_type = 'KADROVSKI';
        } else if (item.telefon) {
          const rawDigits = item.telefon.replace(/\D/g, '');
          const emp = phoneEmpMap[item.telefon] ||
                      phoneEmpMap[rawDigits] ||
                      (rawDigits.startsWith('381') ? phoneEmpMap['0' + rawDigits.slice(3)] : null) ||
                      (rawDigits.startsWith('0') ? phoneEmpMap['381' + rawDigits.slice(1)] : null);
          if (emp) {
            matchedEmp = emp;
            item.sl_type = emp.sl_type;
          }
        }
        if (matchedEmp) {
          item.employee_no = matchedEmp.employee_no;
          item.employee_name = matchedEmp.full_name;
          item.employee_job = matchedEmp.job_title;
          item.employee_dept = matchedEmp.department;
          item.employee_status = matchedEmp.hr_status;
        }
      }
    } catch (e) {
      console.warn('[MTS] Navision employee enrichment warning for excel:', e);
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

    const ws = wb.addWorksheet('MTS Brojevi i Kartice', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 4, showGridLines: true }]
    });

    // Filter subtitle info
    const filterParts: string[] = [];
    filterParts.push(`Kategorija: ${category || 'Sve'}`);
    filterParts.push(`Status: ${status || 'Svi'}`);
    if (packageFilter) filterParts.push(`Paket: ${packageFilter}`);
    if (search) filterParts.push(`Pretraga: "${search}"`);
    const filterDesc = filterParts.join('   |   ');

    // Headers
    const headers = [
      'ID',
      'Broj Telefona',
      'Kategorija',
      'Status',
      'Provajder',
      'Tarifni Paket',
      'Internet Dodatak',
      'Dodatak 1',
      'Dodatak 2',
      'Dodatak 3',
      'Zaduženi Radnik',
      'Kadrovski Broj',
      'Sektor / Odeljenje',
      'Radno Mesto',
      'HR Status',
      'Tip Zaduženja (Navision)',
      'Godina / Datum',
      'Broj Zabeleški'
    ];

    // ROW 1: Luxury Title Banner
    const titleRow = ws.addRow(['UNIPROMET DOO ČAČAK — EVIDENCIJA MTS SLUŽBENIH BROJEVA I SIM KARTICA']);
    ws.mergeCells('A1:R1');
    titleRow.height = 34;
    const titleCell = titleRow.getCell(1);
    titleCell.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    // ROW 2: Subtitle
    const subtitleRow = ws.addRow([
      `Datum izvoza: ${dateFormatted} u ${timeFormatted}   |   Ukupno stavki: ${items.length}   |   ${filterDesc}`
    ]);
    ws.mergeCells('A2:R2');
    subtitleRow.height = 22;
    const subCell = subtitleRow.getCell(1);
    subCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFF59E0B' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
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
        bottom: { style: 'medium', color: { argb: 'FFF59E0B' } },
        left: { style: 'thin', color: { argb: 'FF334155' } },
        right: { style: 'thin', color: { argb: 'FF334155' } }
      };
      if ([1, 3, 4, 5, 7, 12, 15, 16, 17, 18].includes(colIdx)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      }
    });

    // Data rows
    items.forEach((item, index) => {
      const isEven = index % 2 === 0;
      const rowBg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

      const rowValues = [
        `#${item.id}`,
        item.telefon || '',
        item.kategorija || 'Mobilni',
        item.status || 'Aktivan',
        item.provajder || 'MTS',
        item.paket || '',
        item.dodatak_internet ? `${item.dodatak_internet} GB` : '',
        item.dodatak1 || '',
        item.dodatak2 || '',
        item.dodatak3 || '',
        item.employee_name || '',
        item.employee_no || '',
        item.employee_dept || '',
        item.employee_job || '',
        item.employee_status || (item.employee_name ? 'Aktivan' : ''),
        item.sl_type || '',
        item.doslo || '',
        item.logs_count || 0
      ];

      const dataRow = ws.addRow(rowValues);
      dataRow.height = 23;

      dataRow.eachCell({ includeEmpty: true }, (cell, colIdx) => {
        cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF1E293B' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        // Alignments & Special Stylings
        if ([1, 12, 16, 17, 18].includes(colIdx)) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (colIdx === 2) {
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
        } else if (colIdx === 3) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          if (cell.value === 'GPS') {
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF0284C7' } };
          } else {
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF10B981' } };
          }
        } else if (colIdx === 4) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          const s = String(cell.value || '').toUpperCase();
          if (s.includes('AKTIVAN')) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF065F46' } };
          } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
            cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF991B1B' } };
          }
        } else if (colIdx === 11) {
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          if (cell.value) {
            cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF1E293B' } };
          } else {
            cell.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
            cell.value = 'Nije zaduženo';
          }
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        }
      });
    });

    // Auto-fit Column Widths
    const minWidths = [10, 18, 14, 14, 12, 18, 18, 16, 16, 16, 26, 16, 24, 24, 14, 24, 16, 16];
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
    res.setHeader('Content-Disposition', `attachment; filename="UNIPROMET_MTS_Brojevi_${dateStr}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error('[MTS] Excel Export error:', err);
    res.status(500).json({ success: false, error: 'Greška pri izvozu u Excel: ' + err.message });
  }
});

/**
 * GET /api/mts
 * Paginated list of MTS numbers with search & filters, enriched with Navision employees.
 */
mtsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const search = req.query.search ? String(req.query.search).trim() : undefined;
    const category = req.query.category ? String(req.query.category).trim() : undefined;
    const status = req.query.status ? String(req.query.status).trim() : undefined;
    const packageFilter = req.query.package ? String(req.query.package).trim() : undefined;
    const dodatak = req.query.dodatak ? String(req.query.dodatak).trim() : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const offset = (page - 1) * limit;

    let matchedPhoneNumbers: string[] | null = null;
    if (search) {
      try {
        matchedPhoneNumbers = await navisionService.searchPhonesByEmployeeName(search);
      } catch (e) {
        // Ignore
      }
    }

    const result = mtsDb.getMtsNumbers({
      search,
      kategorija: category,
      status,
      paket: packageFilter,
      dodatakInternet: dodatak === '1' ? 'YES' : undefined,
      matchedPhoneNumbers,
      limit,
      offset
    });

    // Enrich with Navision employee names and departments
    try {
      const allPhones = result.items.map(i => i.telefon).filter(Boolean);
      const phoneEmpMap = await navisionService.getEmployeesByPhoneMap(allPhones);
      const explicitEmpNos = result.items.map(i => i.employee_no).filter(Boolean) as string[];
      const empMap = explicitEmpNos.length > 0 ? await navisionService.getEmployeesMap(explicitEmpNos) : {};

      for (const item of result.items) {
        let matchedEmp: any = null;
        if (item.employee_no && empMap[item.employee_no]) {
          matchedEmp = empMap[item.employee_no];
          item.sl_type = 'KADROVSKI';
        } else if (item.telefon) {
          const rawDigits = item.telefon.replace(/\D/g, '');
          const emp = phoneEmpMap[item.telefon] ||
                      phoneEmpMap[rawDigits] ||
                      (rawDigits.startsWith('381') ? phoneEmpMap['0' + rawDigits.slice(3)] : null) ||
                      (rawDigits.startsWith('0') ? phoneEmpMap['381' + rawDigits.slice(1)] : null);
          if (emp) {
            matchedEmp = emp;
            item.sl_type = emp.sl_type;
          }
        }
        if (matchedEmp) {
          item.employee_no = matchedEmp.employee_no;
          item.employee_name = matchedEmp.full_name;
          item.employee_job = matchedEmp.job_title;
          item.employee_dept = matchedEmp.department;
          item.employee_status = matchedEmp.hr_status;
        }
      }
    } catch (e) {
      console.warn('[MTS] Navision employee enrichment warning:', e);
    }

    const totalPages = Math.ceil(result.total / limit) || 1;

    res.json({
      success: true,
      data: result.items.map(item => ({
        id: item.id,
        phone: item.telefon,
        category: item.kategorija,
        status: item.status,
        provider: item.provajder,
        package: item.paket,
        dodatak_internet: item.dodatak_internet,
        dodatak1: item.dodatak1,
        dodatak2: item.dodatak2,
        dodatak3: item.dodatak3,
        date_received: item.doslo,
        employee_no: item.employee_no,
        employee_name: item.employee_name,
        employee_job: item.employee_job,
        employee_dept: item.employee_dept,
        employee_status: item.employee_status,
        phone_type_badge: item.sl_type,
        logs_count: item.logs_count
      })),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages
      }
    });
  } catch (err: any) {
    console.error('[MTS] Error listing MTS numbers:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/mts/:id
 * Single MTS number details + logs + Navision employee.
 */
mtsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const item = mtsDb.getMtsNumberById(id);
    if (!item) return res.status(404).json({ success: false, error: 'MTS broj nije pronađen' });

    // Attach logs
    item.logs = mtsDb.getPhoneLogs(item.telefon);

    // Attach Navision employee
    try {
      let matchedEmp: any = null;
      if (item.employee_no) {
        const empMap = await navisionService.getEmployeesMap([item.employee_no]);
        matchedEmp = empMap[item.employee_no];
        if (matchedEmp) item.sl_type = 'KADROVSKI';
      }
      if (!matchedEmp && item.telefon) {
        const phoneEmpMap = await navisionService.getEmployeesByPhoneMap([item.telefon]);
        const rawDigits = item.telefon.replace(/\D/g, '');
        const emp = phoneEmpMap[item.telefon] ||
                    phoneEmpMap[rawDigits] ||
                    (rawDigits.startsWith('381') ? phoneEmpMap['0' + rawDigits.slice(3)] : null) ||
                    (rawDigits.startsWith('0') ? phoneEmpMap['381' + rawDigits.slice(1)] : null);
        if (emp) {
          matchedEmp = emp;
          item.sl_type = emp.sl_type;
        }
      }
      if (matchedEmp) {
        item.employee_no = matchedEmp.employee_no;
        item.employee_name = matchedEmp.full_name;
        item.employee_job = matchedEmp.job_title;
        item.employee_dept = matchedEmp.department;
        item.employee_status = matchedEmp.hr_status;
      }
    } catch (e) {
      // Ignore
    }

    res.json({
      success: true,
      data: {
        id: item.id,
        phone: item.telefon,
        category: item.kategorija,
        status: item.status,
        provider: item.provajder,
        package: item.paket,
        dodatak_internet: item.dodatak_internet,
        dodatak1: item.dodatak1,
        dodatak2: item.dodatak2,
        dodatak3: item.dodatak3,
        date_received: item.doslo,
        employee_no: item.employee_no,
        employee_name: item.employee_name,
        employee_job: item.employee_job,
        employee_dept: item.employee_dept,
        employee_status: item.employee_status,
        phone_type_badge: item.sl_type,
        logs: item.logs
      }
    });
  } catch (err: any) {
    console.error('[MTS] Error getting MTS number details:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/mts
 * Creates a new MTS number.
 */
mtsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { phone, category, status, provider, package: pkg, date_received, dodatak_internet, dodatak1, dodatak2, dodatak3, employee_no } = req.body;
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ success: false, error: 'Broj telefona je obavezan' });
    }

    const input: MtsNumberInput = {
      telefon: String(phone).trim(),
      kategorija: category ? String(category).trim() : 'Mobilni',
      status: status ? String(status).trim() : 'Aktivan',
      provajder: provider ? String(provider).trim() : 'MTS',
      paket: pkg ? String(pkg).trim() : null,
      doslo: date_received ? String(date_received).trim() : null,
      dodatak_internet: dodatak_internet ? String(dodatak_internet).trim() : null,
      dodatak1: dodatak1 ? String(dodatak1).trim() : null,
      dodatak2: dodatak2 ? String(dodatak2).trim() : null,
      dodatak3: dodatak3 ? String(dodatak3).trim() : null,
      employee_no: employee_no ? String(employee_no).trim() : null
    };

    const created = mtsDb.createMtsNumber(input);
    const newId = created.id;

    // If employee was assigned upon creation, log it
    if (input.employee_no) {
      try {
        const empMap = await navisionService.getEmployeesMap([input.employee_no]);
        const emp = empMap[input.employee_no];
        const empLabel = emp ? emp.full_name : input.employee_no;
        mtsDb.createPhoneLog({
          telefon: input.telefon,
          datum: new Date().toISOString().split('T')[0],
          text: `Inicijalno zaduženje: Radnik ${empLabel}`
        });
      } catch (e) {
        // Ignore
      }
    }

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteCreateMtsNumber({ ...input, id: newId }).catch(err => {
      console.warn('[MTS] Background dual-write create error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Kreiran novi MTS broj: ${input.telefon} (${input.kategorija})`, 'MTS Evidencija');
    broadcastEquipmentEvent('mts_created', { id: newId, phone: input.telefon });

    res.status(201).json({ success: true, id: newId, message: 'MTS broj je uspešno dodat' });
  } catch (err: any) {
    console.error('[MTS] Error creating MTS number:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/mts/:id
 * Updates an existing MTS number.
 */
mtsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const existing = mtsDb.getMtsNumberById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'MTS broj nije pronađen' });

    const { phone, category, status, provider, package: pkg, date_received, dodatak_internet, dodatak1, dodatak2, dodatak3, employee_no } = req.body;
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ success: false, error: 'Broj telefona je obavezan' });
    }

    const newEmpNo = employee_no !== undefined ? (employee_no ? String(employee_no).trim() : null) : undefined;

    const input: MtsNumberInput = {
      telefon: String(phone).trim(),
      kategorija: category ? String(category).trim() : 'Mobilni',
      status: status ? String(status).trim() : 'Aktivan',
      provajder: provider ? String(provider).trim() : 'MTS',
      paket: pkg ? String(pkg).trim() : null,
      doslo: date_received ? String(date_received).trim() : null,
      dodatak_internet: dodatak_internet ? String(dodatak_internet).trim() : null,
      dodatak1: dodatak1 ? String(dodatak1).trim() : null,
      dodatak2: dodatak2 ? String(dodatak2).trim() : null,
      dodatak3: dodatak3 ? String(dodatak3).trim() : null,
      employee_no: newEmpNo
    };

    mtsDb.updateMtsNumber(id, input);

    // If employee assignment changed, auto-create a log entry
    if (newEmpNo !== undefined && (existing.employee_no || null) !== (newEmpNo || null)) {
      try {
        if (newEmpNo) {
          const empMap = await navisionService.getEmployeesMap([newEmpNo]);
          const emp = empMap[newEmpNo];
          const empLabel = emp ? emp.full_name : newEmpNo;
          mtsDb.createPhoneLog({
            telefon: input.telefon,
            datum: new Date().toISOString().split('T')[0],
            text: `Promena zaduženja: Radnik ${empLabel}`
          });
        } else if (existing.employee_no) {
          mtsDb.createPhoneLog({
            telefon: input.telefon,
            datum: new Date().toISOString().split('T')[0],
            text: `Razdužen broj (prethodno zadužen: ${existing.employee_no})`
          });
        }
      } catch (e) {
        // Ignore
      }
    }

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteUpdateMtsNumber(id, input).catch(err => {
      console.warn('[MTS] Background dual-write update error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('info', `Ažuriran MTS broj #${id}: ${input.telefon}`, 'MTS Evidencija');
    broadcastEquipmentEvent('mts_updated', { id, phone: input.telefon });

    res.json({ success: true, message: 'MTS broj je uspešno ažuriran' });
  } catch (err: any) {
    console.error('[MTS] Error updating MTS number:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/mts/:id
 * Deletes an MTS number.
 */
mtsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'Nevažeći ID' });

    const existing = mtsDb.getMtsNumberById(id);
    if (!existing) return res.status(404).json({ success: false, error: 'MTS broj nije pronađen' });

    mtsDb.deleteMtsNumber(id);

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteDeleteMtsNumber(id).catch(err => {
      console.warn('[MTS] Background dual-write delete error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    addServerLog('warn', `Obrisan MTS broj #${id}: ${existing.telefon}`, 'MTS Evidencija');
    broadcastEquipmentEvent('mts_deleted', { id, phone: existing.telefon });

    res.json({ success: true, message: 'MTS broj je obrisan' });
  } catch (err: any) {
    console.error('[MTS] Error deleting MTS number:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/mts/phone/:phone/logs
 * Returns history logs for given phone number.
 */
mtsRouter.get('/phone/:phone/logs', async (req: Request, res: Response) => {
  try {
    const phone = req.params.phone;
    const logs = mtsDb.getPhoneLogs(phone);
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/mts/phone/:phone/logs
 * Adds a new note / history record for phone.
 */
mtsRouter.post('/phone/:phone/logs', async (req: Request, res: Response) => {
  try {
    const phone = req.params.phone;
    const { text, date } = req.body;
    if (!text || !String(text).trim()) {
      return res.status(400).json({ success: false, error: 'Tekst napomene je obavezan' });
    }

    const log = mtsDb.createPhoneLog({
      telefon: String(phone).trim(),
      datum: date ? String(date).trim() : new Date().toISOString().split('T')[0],
      text: String(text).trim()
    });

    const logId = log.id;

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteCreateMtsLog({
      phone: String(phone).trim(),
      date: date ? String(date).trim() : null,
      text: String(text).trim()
    }).catch(err => {
      console.warn('[MTS] Background dual-write log error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('mts_log_added', { phone, logId });
    res.status(201).json({ success: true, id: logId, message: 'Zabeleška je uspešno sačuvana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/mts/logs/:logId
 * Deletes a note / history record.
 */
mtsRouter.delete('/logs/:logId', async (req: Request, res: Response) => {
  try {
    const logId = parseInt(req.params.logId, 10);
    if (isNaN(logId)) return res.status(400).json({ success: false, error: 'Nevažeći ID zabeleške' });

    mtsDb.deletePhoneLog(logId);

    // [LEGACY_BRIDGE_START]
    legacySyncBridge.dualWriteDeleteMtsLog(logId).catch(err => {
      console.warn('[MTS] Background dual-write delete log error:', err.message);
    });
    // [LEGACY_BRIDGE_END]

    broadcastEquipmentEvent('mts_log_deleted', { logId });
    res.json({ success: true, message: 'Zabeleška je obrisana' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
