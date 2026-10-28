import http from 'http';
import snmp from 'net-snmp';
import net from 'net';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { getAllPrinters, DbPrinter } from '../db/printerDb';
import { ConsumptionReport, DeviceReportEntry, saveReport, getExportDirectory } from '../db/reportDb';
import { checkPrinterOnline, wakePrintersInBatches } from './printerService';
import { isLargeCopier } from './printerClass';
import { getPrinterAlertsStatus, decodeHrPrinterDetectedErrorState, normalizePrinterErrors } from './snmpService';

/**
 * Format month-year label in Serbian Latin (e.g. "sep.26")
 */
function getMonthYearLabel(date: Date = new Date()): string {
  const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
  const m = months[date.getMonth()];
  const y = String(date.getFullYear()).slice(-2);
  return `${m}.${y}`;
}

/**
 * Clean device model string extracted from web or SNMP
 */
function cleanModelHint(raw: string): string {
  if (!raw) return 'Mrežni Štampač';
  const cMatch = raw.match(/\b(iR[- ]?ADV\s+[A-Za-z0-9]+|iR\s+[A-Za-z0-9]+|LBP[- ]?[A-Za-z0-9]+|imageRUNNER\s+[A-Za-z0-9]+)/i);
  if (cMatch) {
    return `Canon ${cMatch[1].trim()}`;
  }
  if (raw.includes(':')) {
    const parts = raw.split(':').map(p => p.trim()).filter(Boolean);
    return parts[parts.length - 1];
  }
  return raw.slice(0, 40);
}

/**
 * Ultra-fast, gentle SNMP query helper for a single printer device.
 * Never floods or sends aggressive wake packets to small desktop printers.
 */
async function queryDeviceDetailedCounters(ip: string, modelHint?: string): Promise<{
  ok: boolean;
  snmpSupported?: boolean;
  descr: string;
  serialNumber: string;
  totalPageCount: number | null;
  counters: DeviceReportEntry['pageCounters'];
  toners: Array<{ color: string; name: string; level: number }>;
  wasteToner: string;
  errors: string[];
}> {
  const cleanIp = ip.replace(/_1$/, '').trim();

  return new Promise((resolve) => {
    const session = snmp.createSession(cleanIp, 'public', {
      timeout: 1500,
      retries: 1,
      version: snmp.Version1
    });

    const baseOids = [
      '1.3.6.1.2.1.1.1.0',             // 0: Model / sysDescr
      '1.3.6.1.2.1.43.5.1.1.17.1',      // 1: Serial Number
      '1.3.6.1.2.1.43.10.2.1.4.1.1',    // 2: Standard Total Life Count
      '1.3.6.1.2.1.25.3.5.1.2.1'        // 3: hrPrinterDetectedErrorState
    ];

    session.get(baseOids, async (err, baseVbs) => {
      if (err || !baseVbs) {
        session.close();
        // Safe check on Port 80 only (clean FIN, zero payload bytes)
        const aliveCheck = await checkPrinterOnline(cleanIp, 800);
        if (aliveCheck.isOnline) {
          return resolve({
            ok: true,
            snmpSupported: false,
            descr: modelHint || 'Mrežni Štampač (Zaštićen SNMP)',
            serialNumber: '-',
            totalPageCount: null,
            counters: {},
            toners: [],
            wasteToner: 'Aktivan',
            errors: []
          });
        }
        return resolve({
          ok: false,
          snmpSupported: false,
          descr: 'Nema mrežnog odziva',
          serialNumber: '-',
          totalPageCount: null,
          counters: {},
          toners: [],
          wasteToner: '-',
          errors: []
        });
      }

      const getVal = (i: number): any => {
        const vb = baseVbs[i];
        if (!vb || snmp.isVarbindError(vb)) return null;
        return Buffer.isBuffer(vb.value) ? vb.value.toString('utf-8').trim() : vb.value;
      };

      const descr = getVal(0) || 'Mrežni Štampač';
      const serialNumber = getVal(1) || '-';
      const standardPageCount = typeof getVal(2) === 'number' ? getVal(2) : null;
      const isCanonIr = descr.toLowerCase().includes('ir') || descr.toLowerCase().includes('c52');

      const counters: DeviceReportEntry['pageCounters'] = {};

      if (isCanonIr) {
        // Query Canon specific counters in parallel
        const counterDefinitions = [
          { key: 'total1', oid: '1.3.6.1.4.1.1602.1.11.1.3.1.4.101' },
          { key: 'total2', oid: '1.3.6.1.4.1.1602.1.11.1.3.1.4.102' },
          { key: 'blackLarge', oid: '1.3.6.1.4.1.1602.1.11.1.3.1.4.112' },
          { key: 'blackSmall', oid: '1.3.6.1.4.1.1602.1.11.1.3.1.4.113' },
          { key: 'colorLarge', oid: '1.3.6.1.4.1.1602.1.11.1.3.1.4.122' },
          { key: 'colorSmall', oid: '1.3.6.1.4.1.1602.1.11.1.3.1.4.123' },
          { key: 'colorTotal1', oid: '1.3.6.1.4.1.1602.1.11.1.3.1.4.125' },
          { key: 'printTotal', oid: '1.3.6.1.4.1.1602.1.11.1.3.1.4.301' },
          { key: 'scanTotal', oid: '1.3.6.1.4.1.1602.1.11.1.4.1.4.501', fallbackOid: '1.3.6.1.4.1.1602.1.11.1.3.1.4.501' }
        ];

        await Promise.all(counterDefinitions.map(async (cDef: any) => {
          return new Promise<void>((res) => {
            session.get([cDef.oid], (errC, vbsC) => {
              if (!errC && vbsC && vbsC[0] && !snmp.isVarbindError(vbsC[0])) {
                const num = Number(vbsC[0].value);
                if (!isNaN(num)) {
                  (counters as any)[cDef.key] = num;
                  return res();
                }
              }
              if (cDef.fallbackOid) {
                session.get([cDef.fallbackOid], (errF, vbsF) => {
                  if (!errF && vbsF && vbsF[0] && !snmp.isVarbindError(vbsF[0])) {
                    const numF = Number(vbsF[0].value);
                    if (!isNaN(numF)) (counters as any)[cDef.key] = numF;
                  }
                  res();
                });
              } else {
                res();
              }
            });
          });
        }));
      }

      if (counters.total1 === undefined && standardPageCount !== null) {
        counters.total1 = standardPageCount;
      }

      // Query supplies in parallel
      const toners: Array<{ color: string; name: string; level: number }> = [];
      let wasteToner = 'U redu';

      const slotLimit = isCanonIr ? 5 : 1;
      await Promise.all(Array.from({ length: slotLimit }, (_, idx) => idx + 1).map(async (slot) => {
        const slotOids = [
          `1.3.6.1.2.1.43.11.1.1.6.1.${slot}`,
          `1.3.6.1.2.1.43.11.1.1.9.1.${slot}`,
          `1.3.6.1.2.1.43.11.1.1.8.1.${slot}`
        ];

        return new Promise<void>((res) => {
          session.get(slotOids, (errS, slotVbs) => {
            if (!errS && slotVbs && slotVbs[0] && !snmp.isVarbindError(slotVbs[0])) {
              const rawName = Buffer.isBuffer(slotVbs[0].value) ? slotVbs[0].value.toString('utf-8').trim() : String(slotVbs[0].value);
              const levelVal = slotVbs[1] && !snmp.isVarbindError(slotVbs[1]) ? Number(slotVbs[1].value) : -1;
              const maxVal = slotVbs[2] && !snmp.isVarbindError(slotVbs[2]) ? Number(slotVbs[2].value) : 100;

              if (rawName.toLowerCase().includes('waste') || rawName.toLowerCase().includes('otpad')) {
                wasteToner = levelVal === -3 || levelVal >= 90 ? 'Skoro pun' : 'U redu';
              } else if (rawName) {
                let color = 'other';
                const lower = rawName.toLowerCase();
                if (lower.includes('black') || lower.includes('crn')) color = 'black';
                else if (lower.includes('cyan') || lower.includes('plav')) color = 'cyan';
                else if (lower.includes('magenta') || lower.includes('crven')) color = 'magenta';
                else if (lower.includes('yellow') || lower.includes('žut') || lower.includes('zut')) color = 'yellow';
                else color = 'black';

                let percent = levelVal;
                if (maxVal > 0 && levelVal >= 0 && maxVal !== 100) {
                  percent = Math.round((levelVal / maxVal) * 100);
                }
                if (percent < 0) percent = 0;
                if (percent > 100) percent = 100;

                toners.push({ color, name: rawName, level: percent });
              }
            }
            res();
          });
        });
      }));

      // Collect hardware errors from RFC 2790 hrPrinterDetectedErrorState
      const errStateVal = getVal(3);
      const errors: string[] = decodeHrPrinterDetectedErrorState(errStateVal);

      // Check prtAlertTable for active hardware alerts (e.g. Waste Toner Full and device jams/doors)
      try {
        const alertData = await getPrinterAlertsStatus(session);
        if (alertData.isWasteFull) {
          wasteToner = 'PUN - zameniti';
        } else if (alertData.isWasteNear && wasteToner !== 'PUN - zameniti') {
          wasteToner = 'Skoro pun';
        }
        if (alertData.hardwareErrors && alertData.hardwareErrors.length > 0) {
          for (const de of alertData.hardwareErrors) {
            if (!errors.includes(de)) errors.push(de);
          }
        }
      } catch {}

      session.close();

      resolve({
        ok: true,
        snmpSupported: true,
        descr,
        serialNumber,
        totalPageCount: counters.total1 ?? standardPageCount,
        counters,
        toners,
        wasteToner,
        errors: normalizePrinterErrors(errors)
      });
    });
  });
}

/**
 * Generate full fleet consumption report with ultra-fast parallel batches
 */
export async function generateFullFleetReport(customTitle?: string): Promise<ConsumptionReport> {
  const activePrinters = getAllPrinters(false); // only active printers
  const now = new Date();
  const monthYear = getMonthYearLabel(now);
  const reportId = `rep-${Date.now()}`;
  const title = customTitle || `Mesečni Izveštaj Potrošnje Štampača - ${now.toLocaleString('sr-RS', { month: 'long', year: 'numeric' })}`;

  // Large enterprise MFPs (Canon imageRUNNER ADVANCE) that have Deep Sleep Mode 3 - one shared rule
  const largePrinters = activePrinters.filter(p => isLargeCopier(p));
  const smallPrinters = activePrinters.filter(p => !isLargeCopier(p));

  // 1. Step 1: GENTLE PRE-WAKE ONLY FOR LARGE ENTERPRISE MFPs (Canon imageRUNNER ADVANCE), in batches of 4
  // Small desktop printers (Canon LBP 6780x / LBP312x) are NEVER sent wake packets
  // to guarantee their embedded network cards never freeze!
  if (largePrinters.length > 0) {
    console.log(`[Izveštaj] Blago buđenje velikih fotokopira (${largePrinters.length} Canon imageRUNNER)...`);
    await wakePrintersInBatches(largePrinters.map(p => p.ip));
  }

  const entries: DeviceReportEntry[] = [];
  let onlineCount = 0;
  let totalImpressions = 0;

  // 2. Step 2: Query all small desktop printers FIRST!
  // Small printers answer SNMP instantly (15-30ms) without needing wake-up time.
  // While small printers are being queried, large copiers wake up peacefully in the background.
  console.log(`[Izveštaj] Očitavanje malih štampača (${smallPrinters.length} Canon LBP)...`);
  const smallBatchSize = 5;
  for (let i = 0; i < smallPrinters.length; i += smallBatchSize) {
    const batch = smallPrinters.slice(i, i + smallBatchSize);
    const batchResults = await Promise.all(batch.map(async (prn) => {
      const snmpData = await queryDeviceDetailedCounters(prn.ip, prn.model);
      return { prn, snmpData };
    }));

    for (const { prn, snmpData } of batchResults) {
      if (snmpData.ok) {
        onlineCount++;
        const deviceTotal = snmpData.totalPageCount || 0;
        totalImpressions += deviceTotal;
        const isProtectedSnmp = snmpData.snmpSupported === false;

        entries.push({
          printerId: prn.id,
          ip: prn.ip,
          name: prn.name,
          model: (snmpData.descr && !snmpData.descr.includes('Nema mrežnog odziva')) ? snmpData.descr : prn.model,
          location: prn.location,
          serialNumber: snmpData.serialNumber !== '-' 
            ? snmpData.serialNumber 
            : (prn.notes?.match(/[A-Za-z0-9]{7,10}/)?.[0] || prn.name.match(/[A-Z0-9]{8,}/)?.[0] || '-'),
          status: isProtectedSnmp ? 'online_no_snmp' : 'success',
          pageCounters: snmpData.counters,
          toners: snmpData.toners,
          wasteToner: snmpData.wasteToner,
          errors: snmpData.errors || []
        });
      } else {
        entries.push({
          printerId: prn.id,
          ip: prn.ip,
          name: prn.name,
          model: prn.model,
          location: prn.location,
          serialNumber: prn.notes?.match(/[A-Za-z0-9]{7,10}/)?.[0] || prn.name.match(/[A-Z0-9]{8,}/)?.[0] || '-',
          status: 'offline',
          pageCounters: {},
          toners: [],
          wasteToner: '-',
          errors: []
        });
      }
    }

    if (i + smallBatchSize < smallPrinters.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // 3. Step 3: Settlement pause (gives large copiers a full 5-7s wake window from step 1)
  console.log(`[Izveštaj] Pauza za stabilizaciju velikih fotokopira (1.5s)...`);
  await new Promise(r => setTimeout(r, 1500));

  // 4. Step 4: Query large copiers for SNMP counters
  console.log(`[Izveštaj] Očitavanje velikih fotokopira (${largePrinters.length} Canon imageRUNNER)...`);
  const largeResults: Array<{ prn: DbPrinter; snmpData: Awaited<ReturnType<typeof queryDeviceDetailedCounters>> }> = [];
  const largeBatchSize = 4;
  for (let i = 0; i < largePrinters.length; i += largeBatchSize) {
    const batch = largePrinters.slice(i, i + largeBatchSize);
    const batchResults = await Promise.all(batch.map(async (prn) => {
      const snmpData = await queryDeviceDetailedCounters(prn.ip, prn.model);
      return { prn, snmpData };
    }));
    largeResults.push(...batchResults);

    if (i + largeBatchSize < largePrinters.length) {
      await new Promise(r => setTimeout(r, 120));
    }
  }

  // 5. Step 5: Smart Retry for any large copier that took extra time to initialize its SNMP daemon
  const pendingLarge = largeResults.filter(r => !r.snmpData.ok || r.snmpData.snmpSupported === false);
  if (pendingLarge.length > 0) {
    console.log(`[Izveštaj] Ponovni pokušaj za ${pendingLarge.length} fotokopira koji su se sporije budili...`);
    await new Promise(r => setTimeout(r, 2500));

    for (const item of pendingLarge) {
      const retryData = await queryDeviceDetailedCounters(item.prn.ip, item.prn.model);
      if (retryData.ok && retryData.snmpSupported !== false) {
        item.snmpData = retryData;
        console.log(`[Izveštaj] ✓ Uspešno očitani brojači na ponovljenom upitu za ${item.prn.name} (${item.prn.ip})`);
      }
    }
  }

  // Assemble large copier entries
  for (const { prn, snmpData } of largeResults) {
    if (snmpData.ok) {
      onlineCount++;
      const deviceTotal = snmpData.totalPageCount || 0;
      totalImpressions += deviceTotal;
      const isProtectedSnmp = snmpData.snmpSupported === false;

      entries.push({
        printerId: prn.id,
        ip: prn.ip,
        name: prn.name,
        model: (snmpData.descr && !snmpData.descr.includes('Nema mrežnog odziva')) ? snmpData.descr : prn.model,
        location: prn.location,
        serialNumber: snmpData.serialNumber !== '-' 
          ? snmpData.serialNumber 
          : (prn.notes?.match(/[A-Za-z0-9]{7,10}/)?.[0] || prn.name.match(/[A-Z0-9]{8,}/)?.[0] || '-'),
        status: isProtectedSnmp ? 'online_no_snmp' : 'success',
        pageCounters: snmpData.counters,
        toners: snmpData.toners,
        wasteToner: snmpData.wasteToner,
        errors: snmpData.errors || []
      });
    } else {
      entries.push({
        printerId: prn.id,
        ip: prn.ip,
        name: prn.name,
        model: prn.model,
        location: prn.location,
        serialNumber: prn.notes?.match(/[A-Za-z0-9]{7,10}/)?.[0] || prn.name.match(/[A-Z0-9]{8,}/)?.[0] || '-',
        status: 'offline',
        pageCounters: {},
        toners: [],
        wasteToner: '-',
        errors: []
      });
    }
  }

  // Sort entries alphabetically by printer name for consistent, beautiful Excel output
  entries.sort((a, b) => a.name.localeCompare(b.name, 'sr'));

  // Create Excel Workbook with rich visual styling via ExcelJS
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UNIPROMET DOO ČAČAK';
  wb.lastModifiedBy = 'UNIPROMET Centralni Admin Panel';
  wb.created = now;

  // ==========================================
  // SHEET 1: Mesečni Izveštaj Brojača (Kartice uređaja)
  // ==========================================
  const wsTemplate = wb.addWorksheet('Mesečni Izveštaj Brojača', {
    views: [{ showGridLines: true }]
  });

  wsTemplate.columns = [
    { key: 'colA', width: 46 },
    { key: 'colB', width: 24 },
    { key: 'colC', width: 22 },
    { key: 'colD', width: 34 }
  ];

  // Title Banner
  const titleRow1 = wsTemplate.addRow(['UNIPROMET DOO ČAČAK — Mesečni Izveštaj Potrošnje Štampača']);
  wsTemplate.mergeCells('A1:D1');
  titleRow1.height = 32;
  titleRow1.getCell(1).font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleRow1.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  titleRow1.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  const titleRow2 = wsTemplate.addRow([
    `Period: ${monthYear}   |   Datum očitavanja: ${now.toLocaleDateString('sr-RS')}   |   Ukupno štampača: ${activePrinters.length}   |   Online: ${onlineCount}   |   Ukupno otisaka: ${totalImpressions.toLocaleString('sr-RS')}`
  ]);
  wsTemplate.mergeCells('A2:D2');
  titleRow2.height = 22;
  titleRow2.getCell(1).font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFFFB800' } };
  titleRow2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  titleRow2.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  const sSpace1 = wsTemplate.addRow([]);
  sSpace1.height = 10;

  let deviceIndex = 1;
  for (const entry of entries) {
    const isOnlineWithCounters = entry.status === 'success';
    const isOnlineNoSnmp = entry.status === 'online_no_snmp';
    const isTrulyOnline = isOnlineWithCounters || isOnlineNoSnmp;

    // Header line prominently displaying full printer name, IP address, location and serial number
    let headerText = `${deviceIndex}. ${entry.name}   |   IP: ${entry.ip}   |   ${entry.location}   |   SN: ${entry.serialNumber}`;
    if (isOnlineNoSnmp) {
      headerText += '   [ONLINE — ZAŠTIĆEN SNMP / WEB INTERFEJS]';
    } else if (!isTrulyOnline) {
      headerText += '   [VAN MREŽE / OFFLINE]';
    }

    const devHeaderRow = wsTemplate.addRow([headerText]);
    const devHeaderRowNum = devHeaderRow.number;
    wsTemplate.mergeCells(`A${devHeaderRowNum}:D${devHeaderRowNum}`);
    devHeaderRow.height = 26;

    const hCell = devHeaderRow.getCell(1);
    hCell.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
    hCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb: isOnlineWithCounters
          ? 'FF1E293B' // Dark Slate
          : isOnlineNoSnmp
          ? 'FF0E7490' // Deep Teal / Cyan
          : 'FF881337' // Crimson
      }
    };
    hCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    hCell.border = {
      top: { style: 'thin', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FF0F172A' } },
      right: { style: 'thin', color: { argb: 'FF0F172A' } }
    };

    if (entry.errors && entry.errors.length > 0) {
      const errRow = wsTemplate.addRow([`⚠️ GREŠKA / UPOZORENJE ŠTAMPAČA: ${entry.errors.join('; ')}`]);
      const errRowNum = errRow.number;
      wsTemplate.mergeCells(`A${errRowNum}:D${errRowNum}`);
      errRow.height = 22;
      const errCell = errRow.getCell(1);
      errCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFB91C1C' } };
      errCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      errCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      errCell.border = {
        left: { style: 'medium', color: { argb: 'FFEF4444' } },
        right: { style: 'thin', color: { argb: 'FFEF4444' } },
        bottom: { style: 'thin', color: { argb: 'FFEF4444' } }
      };
    }

    if (!isTrulyOnline) {
      const offRow = wsTemplate.addRow(['Status uređaja:', 'UREĐAJ VAN MREŽE', 'Nema SNMP/mrežnog odziva', 'Proveriti napajanje / mrežni kabl']);
      offRow.height = 20;
      offRow.eachCell((cell, colIdx) => {
        cell.font = { name: 'Segoe UI', size: 9.5, italic: true, color: { argb: 'FF9F1239' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFFECDD3' } },
          left: { style: 'thin', color: { argb: 'FFFECDD3' } },
          right: { style: 'thin', color: { argb: 'FFFECDD3' } }
        };
        if (colIdx === 1) cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        else if (colIdx === 2) cell.alignment = { vertical: 'middle', horizontal: 'center' };
        else cell.alignment = { vertical: 'middle', horizontal: 'left' };
      });

      const sp = wsTemplate.addRow([]);
      sp.height = 10;
      deviceIndex++;
      continue;
    }

    if (isOnlineNoSnmp) {
      const infoRow = wsTemplate.addRow([
        'Status uređaja:',
        'UREĐAJ JE AKTIVAN (ONLINE)',
        'SNMP očitavanje zaštićeno / isključeno',
        `Web UI: http://${entry.ip}:8000/`
      ]);
      infoRow.height = 22;
      infoRow.eachCell((cell, colIdx) => {
        cell.font = { name: 'Segoe UI', size: 9.5, bold: colIdx === 2, color: { argb: colIdx === 2 ? 'FF166534' : 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFBBF7D0' } },
          left: { style: 'thin', color: { argb: 'FFBBF7D0' } },
          right: { style: 'thin', color: { argb: 'FFBBF7D0' } }
        };
        if (colIdx === 1) cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        else if (colIdx === 2) cell.alignment = { vertical: 'middle', horizontal: 'center' };
        else cell.alignment = { vertical: 'middle', horizontal: 'left' };
      });

      const noteRow = wsTemplate.addRow([
        'Napomena:',
        'Štampač je u funkciji na mreži. Za fizičko stanje brojača i nivo tonera pogledati ekran uređaja ili web panel.',
        '',
        `Model: ${entry.model}`
      ]);
      noteRow.height = 20;
      noteRow.eachCell((cell, colIdx) => {
        cell.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: 'FF475569' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
        if (colIdx === 1) cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        else cell.alignment = { vertical: 'middle', horizontal: 'left' };
      });

      const sp = wsTemplate.addRow([]);
      sp.height = 10;
      deviceIndex++;
      continue;
    }

    // Sub-header for counters
    const subHeadRow = wsTemplate.addRow(['Oznaka i Naziv Brojača', 'Broj Kopija (Otisci)', 'Kategorija', 'Model Uređaja']);
    subHeadRow.height = 20;
    subHeadRow.eachCell((cell, colIdx) => {
      cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF475569' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
      };
      if (colIdx === 1) cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      else if (colIdx === 2) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      else if (colIdx === 3) cell.alignment = { vertical: 'middle', horizontal: 'center' };
      else cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });

    // Counters to list
    const c = entry.pageCounters;
    const counterItems: Array<{ label: string; val?: number | null; cat: string }> = [];

    if (c.blackLarge !== undefined && c.blackLarge !== null) counterItems.push({ label: '112 : Total (Black/Large)', val: c.blackLarge, cat: 'Crno-belo (Veliki)' });
    if (c.blackSmall !== undefined && c.blackSmall !== null) counterItems.push({ label: '113 : Total (Black/Small)', val: c.blackSmall, cat: 'Crno-belo (Mali)' });
    if (c.colorLarge !== undefined && c.colorLarge !== null) counterItems.push({ label: '122 : Total (Full Color + Single Color/Large)', val: c.colorLarge, cat: 'Kolor (Veliki)' });
    if (c.colorSmall !== undefined && c.colorSmall !== null) counterItems.push({ label: '123 : Total (Full Color + Single Color/Small)', val: c.colorSmall, cat: 'Kolor (Mali)' });
    if (c.colorTotal1 !== undefined && c.colorTotal1 !== null) counterItems.push({ label: '125 : Total (Full Color + Single Color 1)', val: c.colorTotal1, cat: 'Kolor Ukupno' });
    if (c.printTotal !== undefined && c.printTotal !== null) counterItems.push({ label: '301 : Print (Total 1)', val: c.printTotal, cat: 'Štampa' });
    if (c.scanTotal !== undefined && c.scanTotal !== null) counterItems.push({ label: '501 : Scan (Total 1)', val: c.scanTotal, cat: 'Skeniranje' });
    if (c.total2 !== undefined && c.total2 !== null) counterItems.push({ label: '102 : Total 2', val: c.total2, cat: 'Međuukupno' });
    if (c.total1 !== undefined && c.total1 !== null) counterItems.push({ label: '101 : Total 1 (Glavni Brojač)', val: c.total1, cat: 'Ukupan Brojač' });

    for (let ci = 0; ci < counterItems.length; ci++) {
      const item = counterItems[ci];
      const isTotal1 = item.label.startsWith('101 :');
      const isEven = ci % 2 === 0;

      const cRow = wsTemplate.addRow([item.label, item.val, item.cat, entry.model]);
      cRow.height = isTotal1 ? 22 : 19;

      cRow.eachCell((cell, colIdx) => {
        if (isTotal1) {
          cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }; // Soft gold highlight
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFF59E0B' } },
            bottom: { style: 'medium', color: { argb: 'FFF59E0B' } },
            left: { style: 'thin', color: { argb: 'FFF59E0B' } },
            right: { style: 'thin', color: { argb: 'FFF59E0B' } }
          };
        } else {
          cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF1E293B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF8FAFC' } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };
        }

        if (colIdx === 1) cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        else if (colIdx === 2) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
        }
        else if (colIdx === 3) cell.alignment = { vertical: 'middle', horizontal: 'center' };
        else cell.alignment = { vertical: 'middle', horizontal: 'left' };
      });
    }

    const sp = wsTemplate.addRow([]);
    sp.height = 10;
    deviceIndex++;
  }

  // ==========================================
  // SHEET 2: Zbirna Tabela Tonera i Flote
  // ==========================================
  const wsSummary = wb.addWorksheet('Zbirna Tabela Tonera', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: true }]
  });

  wsSummary.columns = [
    { key: 'rIndex', width: 8 },
    { key: 'name', width: 34 },
    { key: 'ip', width: 17 },
    { key: 'location', width: 24 },
    { key: 'model', width: 28 },
    { key: 'serial', width: 18 },
    { key: 'status', width: 24 },
    { key: 'total1', width: 20 },
    { key: 'scanTotal', width: 20 },
    { key: 'black', width: 15 },
    { key: 'cyan', width: 15 },
    { key: 'magenta', width: 15 },
    { key: 'yellow', width: 15 },
    { key: 'waste', width: 16 },
    { key: 'errors', width: 34 }
  ];

  // Header 1: Title Banner
  const sTitleRow1 = wsSummary.addRow(['UNIPROMET DOO ČAČAK — Zbirna Tabela Potrošnje i Tonera Svih Štampača']);
  wsSummary.mergeCells('A1:O1');
  sTitleRow1.height = 32;
  sTitleRow1.getCell(1).font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  sTitleRow1.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  sTitleRow1.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  // Header 2: Metrics Banner
  const sTitleRow2 = wsSummary.addRow([
    `Period: ${monthYear}   |   Datum očitavanja: ${now.toLocaleDateString('sr-RS')}   |   Ukupno štampača: ${activePrinters.length}   |   Online: ${onlineCount}   |   Offline: ${activePrinters.length - onlineCount}   |   Ukupan broj otisaka: ${totalImpressions.toLocaleString('sr-RS')}`
  ]);
  wsSummary.mergeCells('A2:O2');
  sTitleRow2.height = 22;
  sTitleRow2.getCell(1).font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFFFB800' } };
  sTitleRow2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  sTitleRow2.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  // Spacing
  const sSpaceRow = wsSummary.addRow([]);
  sSpaceRow.height = 8;

  // Table Column Headers (Row 4)
  const headers = [
    'Red. br.', 'Naziv Štampača', 'IP Adresa', 'Lokacija / Sektor', 'Model Uređaja',
    'Serijski Broj', 'Status', 'Ukupno Strana (101)', 'Broj Skeniranja (501)',
    'Crni Toner (%)', 'Plavi Toner (%)', 'Crveni Toner (%)', 'Žuti Toner (%)', 'Otpadni Toner',
    'Aktivne Greške / Upozorenja'
  ];
  const tableHeaderRow = wsSummary.addRow(headers);
  tableHeaderRow.height = 28;
  wsSummary.autoFilter = 'A4:O4';

  tableHeaderRow.eachCell((cell, colIdx) => {
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0F172A' } },
      bottom: { style: 'medium', color: { argb: 'FF334155' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } }
    };
    if (colIdx === 2 || colIdx === 4 || colIdx === 5) {
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    } else if (colIdx === 8 || colIdx === 9) {
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    } else {
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
  });

  let rIndex = 1;
  const firstDataRow = 5;
  for (const entry of entries) {
    const isOnlineWithCounters = entry.status === 'success';
    const isOnlineNoSnmp = entry.status === 'online_no_snmp';
    const isTrulyOnline = isOnlineWithCounters || isOnlineNoSnmp;
    const isEven = rIndex % 2 === 0;

    const blackToner = entry.toners.find(t => t.color === 'black')?.level;
    const cyanToner = entry.toners.find(t => t.color === 'cyan')?.level;
    const magentaToner = entry.toners.find(t => t.color === 'magenta')?.level;
    const yellowToner = entry.toners.find(t => t.color === 'yellow')?.level;

    const total1Val = entry.pageCounters.total1 !== undefined && entry.pageCounters.total1 !== null
      ? entry.pageCounters.total1
      : null;

    const scanTotalVal = entry.pageCounters.scanTotal !== undefined && entry.pageCounters.scanTotal !== null
      ? entry.pageCounters.scanTotal
      : null;

    let statusText = 'Offline';
    if (isOnlineWithCounters) statusText = 'Online';
    else if (isOnlineNoSnmp) statusText = 'Online (Zaštićen SNMP)';

    const rowData = [
      rIndex,
      entry.name,
      entry.ip,
      entry.location,
      entry.model,
      entry.serialNumber,
      statusText,
      total1Val !== null ? total1Val : (isOnlineNoSnmp ? 'Zaštićen SNMP' : (isTrulyOnline ? 0 : 'Offline')),
      scanTotalVal !== null ? scanTotalVal : (entry.model.toLowerCase().includes('lbp') ? 'N/A' : (isOnlineNoSnmp ? 'Zaštićen SNMP' : (isTrulyOnline ? 0 : 'Offline'))),
      blackToner !== undefined ? blackToner / 100 : (isTrulyOnline ? 'N/A' : '--'),
      cyanToner !== undefined ? cyanToner / 100 : (isTrulyOnline ? 'N/A' : '--'),
      magentaToner !== undefined ? magentaToner / 100 : (isTrulyOnline ? 'N/A' : '--'),
      yellowToner !== undefined ? yellowToner / 100 : (isTrulyOnline ? 'N/A' : '--'),
      entry.wasteToner || (isTrulyOnline ? 'U redu' : '--'),
      entry.errors && entry.errors.length > 0 ? entry.errors.join('; ') : 'Nema grešaka'
    ];

    const dataRow = wsSummary.addRow(rowData);
    dataRow.height = 21;

    dataRow.eachCell({ includeEmpty: true }, (cell, colIdx) => {
      cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF1E293B' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF8FAFC' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      if (colIdx === 1) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { name: 'Segoe UI', size: 9, color: { argb: 'FF64748B' } };
      } else if (colIdx === 2) {
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
      } else if (colIdx === 3) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { name: 'Consolas', size: 9.5, bold: true, color: { argb: 'FF0284C7' } };
      } else if (colIdx === 4 || colIdx === 5) {
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      } else if (colIdx === 6) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { name: 'Consolas', size: 9, color: { argb: 'FF475569' } };
      } else if (colIdx === 7) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (isTrulyOnline) {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF166534' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
        } else {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF9F1239' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E6' } };
        }
      } else if (colIdx === 8) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0';
          cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: isOnlineNoSnmp ? 'FF0369A1' : 'FF94A3B8' } };
        }
      } else if (colIdx === 9) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0';
          cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF0369A1' } };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
        }
      } else if (colIdx >= 10 && colIdx <= 13) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (typeof cell.value === 'number') {
          cell.numFmt = '0%';
          const pct = cell.value * 100;
          if (pct <= 10) {
            cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF991B1B' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
          } else if (pct <= 25) {
            cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF92400E' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
          } else {
            cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: 'FF166534' } };
          }
        } else {
          cell.font = { name: 'Segoe UI', size: 9, color: { argb: 'FF94A3B8' } };
        }
      } else if (colIdx === 14) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (String(cell.value).toLowerCase().includes('pun')) {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF991B1B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        } else {
          cell.font = { name: 'Segoe UI', size: 9, color: { argb: 'FF166534' } };
        }
      } else if (colIdx === 15) {
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        if (cell.value && cell.value !== 'Nema grešaka') {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF991B1B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        } else {
          cell.font = { name: 'Segoe UI', size: 9, color: { argb: 'FF94A3B8' } };
        }
      }
    });

    rIndex++;
  }

  const lastDataRow = firstDataRow + entries.length - 1;

  // Summary Total Row
  const totalRow = wsSummary.addRow([
    '',
    'UKUPNO CELA FLOTA',
    '', '', '', '',
    `${onlineCount} Online`,
    { formula: `SUM(H${firstDataRow}:H${lastDataRow})` },
    { formula: `SUM(I${firstDataRow}:I${lastDataRow})` },
    '', '', '', '', '', ''
  ]);
  totalRow.height = 28;
  wsSummary.mergeCells(`B${totalRow.number}:F${totalRow.number}`);

  totalRow.eachCell({ includeEmpty: true }, (cell, colIdx) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF94A3B8' } },
      bottom: { style: 'double', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };

    if (colIdx === 2) {
      cell.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    } else if (colIdx === 7) {
      cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF166534' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    } else if (colIdx === 8) {
      cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.numFmt = '#,##0';
    } else if (colIdx === 9) {
      cell.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FF0369A1' } };
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.numFmt = '#,##0';
    }
  });

  // Save Excel file to exports directory
  const exportDir = getExportDirectory();
  const safeTitle = `izvestaj_potrosnje_${monthYear.replace('.', '_')}_${Date.now()}.xlsx`;
  const exportFilePath = path.join(exportDir, safeTitle);

  await wb.xlsx.writeFile(exportFilePath);

  const newReport: ConsumptionReport = {
    id: reportId,
    title,
    monthYear,
    createdAt: now.toISOString(),
    deviceCount: activePrinters.length,
    onlineCount,
    totalImpressionsAcrossFleet: totalImpressions,
    entries,
    excelFileName: safeTitle
  };

  saveReport(newReport);
  return newReport;
}
