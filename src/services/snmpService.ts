import snmp from 'net-snmp';
import { wakePrinter, wakePrintersInBatches } from './printerService';
import { getPrinterByIp, updatePrinterModelFromSnmp } from '../db/printerDb';
import { isLargeCopier } from './printerClass';
import { acquireScanLock } from './scanLockManager';

/**
 * Poznate greške koje se privremeno ne prijavljuju mejlom (štampač ih i dalje prikazuje na stranici).
 * Ukloniti stavku kada serviser otkloni kvar.
 */
const IGNORED_PRINTER_ERRORS: Array<{ printerId: string; note: string; match: string[] }> = [
  {
    // Canon iR C5235i (KV uprava), 192.168.121.40 - lažna dojava prepunjene izlazne fioke, čeka servisera (2026-10-29)
    printerId: 'prn-1788334747843-221',
    note: 'KV uprava: izlazna fioka prepunjena (kvar senzora)',
    match: ['prepunjena', 'output tray is full', 'output tray full']
  }
];

function isIgnoredPrinterError(printerId: string, error: string): boolean {
  const lower = error.toLowerCase();
  return IGNORED_PRINTER_ERRORS.some(r => r.printerId === printerId && r.match.some(m => lower.includes(m)));
}

export interface TonerItem {
  color: 'black' | 'cyan' | 'magenta' | 'yellow' | 'other';
  name: string;
  level: number; // 0..100%
  maxCapacity: number;
  status: 'good' | 'low' | 'critical' | 'unknown';
}

export interface PaperTrayItem {
  trayNumber: number;
  name: string;
  level: string;
  maxCapacity: number;
}

export interface PrinterConsumablesData {
  ip: string;
  isSnmpAvailable: boolean;
  model: string;
  deviceName: string;
  serialNumber: string;
  location: string;
  uptimeText: string | null;
  totalPageCount: number | null;
  scanCount: number | null;
  hasScanner: boolean;
  printerStatus: 'idle' | 'printing' | 'warmup' | 'warning' | 'error' | 'offline';
  printerStatusText: string;
  toners: TonerItem[];
  wasteToner: {
    name: string;
    status: 'normal' | 'near_full' | 'full' | 'unknown';
    statusText: string;
  };
  trays: PaperTrayItem[];
  fetchedAt: string;
  error?: string;
  errors: string[];
  hasError: boolean;
}

export interface PrinterAlertsResult {
  isWasteFull: boolean;
  isWasteNear: boolean;
  wasteDesc: string;
  allAlerts: string[];
  hardwareErrors: string[];
  hasHardwareError: boolean;
}

/**
 * Decodes standard RFC 2790 Host Resources MIB hrPrinterDetectedErrorState (1.3.6.1.2.1.25.3.5.1.2.1)
 * Bitmask of printer error states.
 */
export function decodeHrPrinterDetectedErrorState(val: any): string[] {
  if (!val) return [];
  const buf = Buffer.isBuffer(val) ? val : (typeof val === 'string' ? Buffer.from(val, 'hex') : null);
  if (!buf || buf.length === 0) return [];

  const errors: string[] = [];
  const b0 = buf[0];
  const b1 = buf.length > 1 ? buf[1] : 0;

  // Ignore out-of-paper: b0 & 0x40 (Out of paper) and b1 & 0x04 (Tray Empty)
  // Refilling paper trays is handled locally by employees, not IT/maintenance.
  if (b0 & 0x08) errors.push('Otvorena vrata ili poklopac štampača (Cover/Door Open)');
  if (b0 & 0x04) errors.push('Zaglavljen papir u mehanizmu (Paper Jam)');
  if (b0 & 0x01) errors.push('Kvar uređaja / Zahteva se servis (Service Call)');

  if (b1 & 0x80) errors.push('Nedostaje ulazna fioka za papir (Input Tray Missing)');
  if (b1 & 0x40) errors.push('Nedostaje izlazna fioka (Output Tray Missing)');
  if (b1 & 0x08) errors.push('Izlazna fioka je prepunjena (Output Tray Full)');
  if (b1 & 0x02) errors.push('Prekoračen rok za preventivni servis / održavanje');

  return errors;
}

/**
 * Normalizes and deduplicates printer error messages into clear, non-redundant Serbian strings.
 */
export function normalizePrinterErrors(errors: string[]): string[] {
  if (!errors || errors.length === 0) return [];
  const normalized: string[] = [];

  for (const err of errors) {
    const trimmed = err.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();

    // Ignore out-of-paper / empty tray completely
    const isPaperOut = lower.includes('nema papira') || lower.includes('paper is out') || lower.includes('out of paper') || lower.includes('load paper') || lower.includes('tray empty') || lower.includes('prazna fioka') || lower.includes('feed paper') || lower.includes('insert paper');
    if (isPaperOut) {
      continue;
    }

    const isPaperJam = lower.includes('zaglav') || lower.includes('paper jam');
    const isDoorOpen = lower.includes('otvorena vrata') || lower.includes('poklopac') || lower.includes('cover open') || lower.includes('door open');
    const isBinFull = lower.includes('prepunjena') || lower.includes('izlazna fioka') || lower.includes('output bin full');

    if (isPaperJam) {
      const idx = normalized.findIndex(e => e.toLowerCase().includes('zaglav'));
      if (idx !== -1) {
        if (trimmed.length > normalized[idx].length) normalized[idx] = trimmed;
        continue;
      }
    } else if (isDoorOpen) {
      const idx = normalized.findIndex(e => e.toLowerCase().includes('otvorena') || e.toLowerCase().includes('poklopac'));
      if (idx !== -1) {
        if (trimmed.length > normalized[idx].length) normalized[idx] = trimmed;
        continue;
      }
    } else if (isBinFull) {
      const idx = normalized.findIndex(e => e.toLowerCase().includes('prepunjena') || e.toLowerCase().includes('izlazna'));
      if (idx !== -1) {
        if (trimmed.length > normalized[idx].length) normalized[idx] = trimmed;
        continue;
      }
    } else {
      if (normalized.includes(trimmed)) continue;
    }

    normalized.push(trimmed);
  }

  return normalized;
}

/**
 * Inspects standard RFC 3805 Printer-MIB prtAlertTable (1.3.6.1.2.1.43.18.1.1)
 * to detect hardware alerts, including:
 * - Waste Toner Full / Near Full (Code 1109, 1108, 1107, 1112 / Descriptions)
 * - Paper Jam (Code 801 / Descriptions)
 * - Door/Cover Open (Code 501, 503 / Descriptions)
 * - Out of Paper / Load Paper (Code 802, 808 / Descriptions)
 * - Output Bin Full (Code 902, 903 / Descriptions)
 * - Service Call / Hardware Errors (Code 1800+ / Descriptions)
 * - Any other hardware trouble state
 */
export function getPrinterAlertsStatus(session: snmp.Session): Promise<PrinterAlertsResult> {
  return new Promise((resolve) => {
    const alertsMap = new Map<string, { severity?: number; group?: number; code?: number; description?: string }>();

    session.subtree('1.3.6.1.2.1.43.18.1.1', (vbs) => {
      for (const vb of vbs) {
        if (!vb || snmp.isVarbindError(vb)) continue;
        const parts = vb.oid.split('.');
        if (parts.length < 3) continue;
        const col = parts[parts.length - 3];
        const alertIdx = parts[parts.length - 1];

        if (!alertsMap.has(alertIdx)) {
          alertsMap.set(alertIdx, {});
        }
        const item = alertsMap.get(alertIdx)!;

        if (col === '2') item.severity = Number(vb.value);
        if (col === '4') item.group = Number(vb.value);
        if (col === '7') item.code = Number(vb.value);
        if (col === '8') {
          item.description = Buffer.isBuffer(vb.value) ? vb.value.toString('utf-8').trim() : String(vb.value).trim();
        }
      }
    }, () => {
      let isWasteFull = false;
      let isWasteNear = false;
      let wasteDesc = '';
      const allAlerts: string[] = [];
      const hardwareErrors: string[] = [];

      for (const alert of alertsMap.values()) {
        const desc = (alert.description || '').trim();
        const code = alert.code || 0;
        const group = alert.group || 0;
        const lowerDesc = desc.toLowerCase();

        if (desc) allAlerts.push(desc);

        // 1. Waste Toner detection
        // Code 1109 = markerWasteTonerReceptacleFull (RFC 3805)
        // Code 1108 = markerWasteTonerReceptacleAlmostFull
        // Code 1107 = markerWasteTonerReceptacleCheck
        // Code 1112 = markerWasteTonerReceptacleMissing
        const isWasteCodeFull = code === 1109 || code === 1112;
        const isWasteCodeNear = code === 1107 || code === 1108;
        const hasWasteText = lowerDesc.includes('waste') || lowerDesc.includes('otpad');
        const hasFullText = lowerDesc.includes('full') || lowerDesc.includes('pun') || lowerDesc.includes('receptacle full');
        const hasNearText = lowerDesc.includes('near') || lowerDesc.includes('almost') || lowerDesc.includes('skoro') || lowerDesc.includes('check') || lowerDesc.includes('needs');

        if (isWasteCodeFull || (hasWasteText && hasFullText)) {
          isWasteFull = true;
          wasteDesc = desc || 'Kontejner otpadnog tonera je PUN (zameniti)';
          continue;
        } else if (isWasteCodeNear || (hasWasteText && hasNearText)) {
          isWasteNear = true;
          if (!wasteDesc) wasteDesc = desc || 'Kontejner otpadnog tonera je skoro pun / proveriti';
          continue;
        }

        // 2. Ignore pure toner level alerts since toners are tracked separately by percentage
        if (group === 11 || lowerDesc.includes('toner is low') || lowerDesc.includes('toner is out') || lowerDesc.includes('cartridge')) {
          continue;
        }

        // 3. Hardware Error Categorization
        // Paper Jam
        if (code === 801 || lowerDesc.includes('jam') || lowerDesc.includes('zaglav')) {
          hardwareErrors.push(`Zaglavljen papir u mehanizmu (${desc || 'Paper Jam'})`);
          continue;
        }

        // Door / Cover Open
        if ((code === 501 || code === 503 || lowerDesc.includes('cover') || lowerDesc.includes('door') || lowerDesc.includes('poklopac') || lowerDesc.includes('vrata')) && !lowerDesc.includes('close') && !lowerDesc.includes('zatvor')) {
          hardwareErrors.push(`Otvorena vrata / poklopac štampača (${desc || 'Cover Open'})`);
          continue;
        }

        // Ignore Out of Paper / Load Paper / Tray Empty - users manage paper refills themselves
        if (code === 802 || code === 808 || lowerDesc.includes('paper is out') || lowerDesc.includes('out of paper') || lowerDesc.includes('load paper') || lowerDesc.includes('nema papira') || lowerDesc.includes('tray empty') || lowerDesc.includes('prazna fioka') || lowerDesc.includes('feed paper') || lowerDesc.includes('insert paper')) {
          continue;
        }

        // Output Bin Full
        if (code === 902 || code === 903 || lowerDesc.includes('output full') || lowerDesc.includes('bin full') || lowerDesc.includes('prepunjena')) {
          hardwareErrors.push(`Izlazna fioka je prepunjena (${desc || 'Output Bin Full'})`);
          continue;
        }

        // Service Call / Hardware Fault
        if ((code >= 1800 && code < 1900) || lowerDesc.includes('service') || lowerDesc.includes('servis') || lowerDesc.includes('kvar') || lowerDesc.includes('error code') || lowerDesc.includes('e00')) {
          hardwareErrors.push(`Servisni kvar štampača (${desc || 'Service Call'})`);
          continue;
        }

        // Any other non-informational error (ignore ready/idle/sleep)
        if (desc && !lowerDesc.includes('sleep') && !lowerDesc.includes('ready') && !lowerDesc.includes('idle') && !lowerDesc.includes('standby') && !lowerDesc.includes('energy') && !lowerDesc.includes('printing') && !lowerDesc.includes('warm')) {
          hardwareErrors.push(`Greška štampača: ${desc}`);
        }
      }

      const uniqueHwErrors = normalizePrinterErrors(hardwareErrors);

      resolve({
        isWasteFull,
        isWasteNear,
        wasteDesc,
        allAlerts,
        hardwareErrors: uniqueHwErrors,
        hasHardwareError: uniqueHwErrors.length > 0
      });
    });
  });
}

// Memory cache for consumables (cache for 15s to reduce SNMP network traffic)
const consumablesCache = new Map<string, { data: PrinterConsumablesData; timestamp: number }>();

/**
 * Universal SNMP collector: Works on ALL printer models and brands
 * (Canon imageRUNNER ADVANCE, Canon LBP, HP LaserJet, Kyocera, Xerox, Brother, Zebra, etc.)
 * based on standard RFC 3805 (Printer-MIB) and RFC 2790 (Host Resources MIB).
 * 
 * FIRST sends a network wake pulse to the target printer so its controller/SNMP engine
 * wakes up from Sleep / Energy Saver mode, then queries telemetry.
 */
export async function getPrinterConsumables(ip: string, community = 'public', forceFresh = false): Promise<PrinterConsumablesData> {
  const cleanIp = ip.replace(/_1$/, '').trim();
  const now = Date.now();

  if (!forceFresh && consumablesCache.has(cleanIp)) {
    const cached = consumablesCache.get(cleanIp)!;
    if (now - cached.timestamp < 15000) {
      return cached.data;
    }
  }

  // 1. First attempt: Query SNMP directly (fast, no TCP pulse needed if device is active)
  let result = await queryUniversalPrinterSnmp(cleanIp, community);

  // 2. If SNMP failed and device is a large copier (Deep Sleep), send a single gentle wake and retry once.
  // Small desktop printers (Canon LBP) are NEVER woken to prevent NIC lockups.
  if (!result.isSnmpAvailable) {
    const prn = getPrinterByIp(cleanIp);

    if (isLargeCopier(prn)) {
      try {
        await wakePrinter(cleanIp);
        await new Promise(r => setTimeout(r, 1800));
        const retry = await queryUniversalPrinterSnmp(cleanIp, community);
        if (retry.isSnmpAvailable) {
          result = retry;
        }
      } catch {}
    }
  }

  consumablesCache.set(cleanIp, { data: result, timestamp: now });
  return result;
}

function queryUniversalPrinterSnmp(ip: string, community: string): Promise<PrinterConsumablesData> {
  return new Promise((resolve) => {
    const nowIso = new Date().toISOString();

    const session = snmp.createSession(ip, community, {
      timeout: 2000,
      retries: 1,
      version: snmp.Version1
    });

    // Step 1: Base Global Printer-MIB OIDs
    const baseOids = [
      '1.3.6.1.2.1.1.1.0',             // 0: sysDescr / Exact Model Name
      '1.3.6.1.2.1.1.3.0',             // 1: sysUpTime (Ticks)
      '1.3.6.1.2.1.1.5.0',             // 2: sysName
      '1.3.6.1.2.1.1.6.0',             // 3: sysLocation
      '1.3.6.1.2.1.43.5.1.1.17.1',      // 4: Serial Number (prtGeneralSerialNumber)
      '1.3.6.1.2.1.43.10.2.1.4.1.1',    // 5: Total Lifetime Page Count (prtMarkerLifeCount)
      '1.3.6.1.2.1.25.3.5.1.1.1',       // 6: hrPrinterStatus (1=other, 2=unknown, 3=idle, 4=printing, 5=warmup)
      '1.3.6.1.2.1.25.3.5.1.2.1'        // 7: hrPrinterDetectedErrorState (BITS)
    ];

    session.get(baseOids, async (err, baseVarbinds) => {
      if (err || !baseVarbinds) {
        session.close();
        return resolve({
          ip,
          isSnmpAvailable: false,
          model: 'Nepoznato',
          deviceName: 'Štampač',
          serialNumber: '-',
          location: '-',
          uptimeText: null,
          totalPageCount: null,
          scanCount: null,
          hasScanner: false,
          printerStatus: 'offline',
          printerStatusText: 'Nema SNMP odziva (Port 161)',
          toners: [],
          wasteToner: { name: 'Otpadni toner', status: 'unknown', statusText: 'Nema podataka' },
          trays: [],
          fetchedAt: nowIso,
          error: err?.message || 'SNMP timeout',
          errors: [],
          hasError: false
        });
      }

      // Parse base info safely
      const getVal = (idx: number): any => {
        if (!baseVarbinds) return null;
        const vb = baseVarbinds[idx];
        if (!vb || snmp.isVarbindError(vb)) return null;
        return Buffer.isBuffer(vb.value) ? vb.value.toString('utf-8').trim() : vb.value;
      };

      const sysDescr = getVal(0) || 'Mrežni Štampač';
      if (sysDescr && sysDescr !== 'Mrežni Štampač') {
        try { updatePrinterModelFromSnmp(ip.replace(/_1$/, '').trim(), sysDescr); } catch {}
      }
      const upTimeTicks = getVal(1);
      const sysName = getVal(2) || ip;
      const location = getVal(3) || '-';
      const serialNumber = getVal(4) || '-';
      const totalPageCount = typeof getVal(5) === 'number' ? getVal(5) : null;
      const statusCode = getVal(6);
      const detectedErrors = decodeHrPrinterDetectedErrorState(baseVarbinds[7]?.value);

      let printerStatus: PrinterConsumablesData['printerStatus'] = 'idle';
      let printerStatusText = 'Spreman za rad (Pripravan)';

      if (statusCode === 4) {
        printerStatus = 'printing';
        printerStatusText = 'Štampanje u toku...';
      } else if (statusCode === 5) {
        printerStatus = 'warmup';
        printerStatusText = 'Zagrevanje uređaja...';
      }

      let uptimeText: string | null = null;
      if (typeof upTimeTicks === 'number') {
        const totalSecs = Math.floor(upTimeTicks / 100);
        const days = Math.floor(totalSecs / 86400);
        const hours = Math.floor((totalSecs % 86400) / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        uptimeText = days > 0 ? `${days}d ${hours}h ${mins}m` : `${hours}h ${mins}m`;
      }

      // Step 2: Slot-by-Slot Query for Toner Supplies (Works for 1 toner up to 5 toners)
      const toners: TonerItem[] = [];
      let wasteToner: { name: string; status: 'normal' | 'near_full' | 'full' | 'unknown'; statusText: string } = {
        name: 'Kontejner otpadnog tonera',
        status: 'normal',
        statusText: 'U redu (Ispravno stanje)'
      };

      for (let slot = 1; slot <= 6; slot++) {
        const slotOids = [
          `1.3.6.1.2.1.43.11.1.1.6.1.${slot}`, // Name / Description
          `1.3.6.1.2.1.43.11.1.1.9.1.${slot}`, // Current Level
          `1.3.6.1.2.1.43.11.1.1.8.1.${slot}`  // Max Capacity
        ];

        const slotVbs = await new Promise<any[] | null>((resSlot) => {
          session.get(slotOids, (errS, vbs) => {
            if (errS || !vbs) return resSlot(null);
            resSlot(vbs);
          });
        });

        if (slotVbs && slotVbs[0] && !snmp.isVarbindError(slotVbs[0])) {
          const rawName = Buffer.isBuffer(slotVbs[0].value) ? slotVbs[0].value.toString('utf-8').trim() : String(slotVbs[0].value);
          const levelVal = slotVbs[1] && !snmp.isVarbindError(slotVbs[1]) ? Number(slotVbs[1].value) : -1;
          const maxVal = slotVbs[2] && !snmp.isVarbindError(slotVbs[2]) ? Number(slotVbs[2].value) : 100;

          if (rawName.toLowerCase().includes('waste') || rawName.toLowerCase().includes('otpad')) {
            const isFull = levelVal === 0 || (maxVal > 0 && levelVal >= maxVal);
            const isNear = levelVal === -3 || (maxVal > 0 && levelVal / maxVal >= 0.85) || levelVal >= 90;
            wasteToner = {
              name: rawName,
              status: isFull ? 'full' : (isNear ? 'near_full' : 'normal'),
              statusText: isFull ? 'PUN - zameniti' : (isNear ? 'Skoro pun' : 'U redu (Ispravno)')
            };
            continue;
          }

          if (!rawName) continue;

          let color: TonerItem['color'] = 'other';
          const lowerName = rawName.toLowerCase();
          if (lowerName.includes('black') || lowerName.includes('crn')) color = 'black';
          else if (lowerName.includes('cyan') || lowerName.includes('plav')) color = 'cyan';
          else if (lowerName.includes('magenta') || lowerName.includes('crven')) color = 'magenta';
          else if (lowerName.includes('yellow') || lowerName.includes('žut') || lowerName.includes('zut')) color = 'yellow';
          else color = 'black'; // Default single monochrome toner (e.g. "Canon Cartridge 724", "HP LaserJet Q2612A")

          // Calculate percentage
          let percent = levelVal;
          if (maxVal > 0 && levelVal >= 0 && maxVal !== 100) {
            percent = Math.round((levelVal / maxVal) * 100);
          }
          if (percent < 0) percent = 0;
          if (percent > 100) percent = 100;

          let status: TonerItem['status'] = 'good';
          if (percent <= 10) status = 'critical';
          else if (percent <= 25) status = 'low';

          toners.push({
            color,
            name: rawName,
            level: percent,
            maxCapacity: maxVal,
            status
          });
        }
      }

      // Step 2.5: Inspect prtAlertTable (1.3.6.1.2.1.43.18.1.1) for hardware alerts (e.g. Waste Toner Full, Paper Jam, Door Open)
      let alertData: PrinterAlertsResult = {
        isWasteFull: false,
        isWasteNear: false,
        wasteDesc: '',
        allAlerts: [],
        hardwareErrors: [],
        hasHardwareError: false
      };

      try {
        alertData = await getPrinterAlertsStatus(session);
        if (alertData.isWasteFull) {
          wasteToner.status = 'full';
          wasteToner.statusText = 'PUN - zameniti';
          if (alertData.wasteDesc) wasteToner.name = alertData.wasteDesc;
        } else if (alertData.isWasteNear && wasteToner.status !== 'full') {
          wasteToner.status = 'near_full';
          wasteToner.statusText = 'Skoro pun';
          if (alertData.wasteDesc) wasteToner.name = alertData.wasteDesc;
        }
      } catch {}

      // Step 3: Slot-by-Slot Query for Paper Trays / Cassettes
      const trays: PaperTrayItem[] = [];
      for (let traySlot = 1; traySlot <= 6; traySlot++) {
        const trayOids = [
          `1.3.6.1.2.1.43.8.2.1.13.1.${traySlot}`, // Tray Name / Type
          `1.3.6.1.2.1.43.8.2.1.9.1.${traySlot}`   // Max Capacity
        ];

        const trayVbs = await new Promise<any[] | null>((resTray) => {
          session.get(trayOids, (errT, vbs) => {
            if (errT || !vbs) return resTray(null);
            resTray(vbs);
          });
        });

        if (trayVbs && trayVbs[0] && !snmp.isVarbindError(trayVbs[0])) {
          const rawName = Buffer.isBuffer(trayVbs[0].value) ? trayVbs[0].value.toString('utf-8').trim() : String(trayVbs[0].value);
          const maxVal = trayVbs[1] && !snmp.isVarbindError(trayVbs[1]) ? Number(trayVbs[1].value) : 550;

          if (rawName) {
            trays.push({
              trayNumber: traySlot,
              name: rawName,
              level: 'Dovoljno papira',
              maxCapacity: maxVal
            });
          }
        }
      }

      // Step 4: Scan Counter Query (Canon Counter 501, HP, Kyocera)
      let scanCount: number | null = null;
      let hasScanner = false;

      // Query Canon Scan Total 1: Try Primary Canon iR ADVANCE OID (.4.1.4.501), then fallback (.3.1.4.501)
      const canonScanOids = [
        '1.3.6.1.4.1.1602.1.11.1.4.1.4.501',
        '1.3.6.1.4.1.1602.1.11.1.3.1.4.501'
      ];
      for (const cOid of canonScanOids) {
        const scVal = await new Promise<number | null>((resSc) => {
          session.get([cOid], (errSc, vbsSc) => {
            if (errSc || !vbsSc || snmp.isVarbindError(vbsSc[0])) return resSc(null);
            const num = Number(vbsSc[0].value);
            resSc(!isNaN(num) && num >= 0 ? num : null);
          });
        });
        if (scVal !== null) {
          scanCount = scVal;
          hasScanner = true;
          break;
        }
      }

      if (!hasScanner) {
        // Fallback: HP MFP Total Scans (1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.6.0)
        const scanVbHp = await new Promise<any[] | null>((resScan) => {
          session.get(['1.3.6.1.4.1.11.2.3.9.4.2.1.4.1.2.6.0'], (errSc, vbsSc) => {
            if (errSc || !vbsSc) return resScan(null);
            resScan(vbsSc);
          });
        });
        if (scanVbHp && scanVbHp[0] && !snmp.isVarbindError(scanVbHp[0])) {
          const scVal = Number(scanVbHp[0].value);
          if (!isNaN(scVal) && scVal >= 0) {
            scanCount = scVal;
            hasScanner = true;
          }
        } else {
          // Fallback: Kyocera Scan Count (1.3.6.1.4.1.1347.42.2.1.1.1)
          const scanVbKyo = await new Promise<any[] | null>((resScan) => {
            session.get(['1.3.6.1.4.1.1347.42.2.1.1.1'], (errSc, vbsSc) => {
              if (errSc || !vbsSc) return resScan(null);
              resScan(vbsSc);
            });
          });
          if (scanVbKyo && scanVbKyo[0] && !snmp.isVarbindError(scanVbKyo[0])) {
            const scVal = Number(scanVbKyo[0].value);
            if (!isNaN(scVal) && scVal >= 0) {
              scanCount = scVal;
              hasScanner = true;
            }
          }
        }
      }

      const lowerModel = sysDescr.toLowerCase();
      if (!hasScanner && (lowerModel.includes('ir-adv') || lowerModel.includes('imagerunner') || lowerModel.includes('c5235') || lowerModel.includes('c3530') || lowerModel.includes('c3320') || lowerModel.includes('mfp') || lowerModel.includes('dsm'))) {
        hasScanner = true;
      }

      const combinedErrors = normalizePrinterErrors([...detectedErrors, ...alertData.hardwareErrors]);
      const hasError = combinedErrors.length > 0;

      if (hasError) {
        printerStatus = 'error';
        printerStatusText = `Greška: ${combinedErrors[0]}`;
      } else if (wasteToner.status === 'full') {
        printerStatus = 'warning';
        printerStatusText = 'Greška: Otpadni toner je pun (zameniti)';
      } else if (wasteToner.status === 'near_full') {
        printerStatus = 'warning';
        printerStatusText = 'Upozorenje: Otpadni toner je skoro pun';
      } else if (statusCode === 4) {
        printerStatus = 'printing';
        printerStatusText = 'Štampanje u toku...';
      } else if (statusCode === 5) {
        printerStatus = 'warmup';
        printerStatusText = 'Zagrevanje uređaja...';
      } else {
        printerStatus = 'idle';
        printerStatusText = statusCode === 1 ? 'Spreman za rad (Režim mirovanja)' : 'Spreman za rad (Pripravan)';
      }

      session.close();

      resolve({
        ip,
        isSnmpAvailable: true,
        model: sysDescr,
        deviceName: sysName,
        serialNumber,
        location,
        uptimeText,
        totalPageCount,
        scanCount,
        hasScanner,
        printerStatus,
        printerStatusText,
        toners,
        wasteToner,
        trays,
        fetchedAt: nowIso,
        errors: combinedErrors,
        hasError
      });
    });
  });
}

export interface LowTonerDeviceItem {
  printerId: string;
  printerName: string;
  location: string;
  ip: string;
  model: string;
  customTag: string;
  isOnline: boolean;
  isLargeCopier: boolean;
  lowToners: TonerItem[];
  allToners: TonerItem[];
  wasteTonerStatus: string;
  isWasteTonerFull: boolean;
  isWasteTonerNearFull: boolean;
  onlyWasteToner: boolean;
  wasteTonerNeedsReplacement: boolean;
  errors: string[];
  hasHardwareError: boolean;
  onlyHardwareError: boolean;
}

export interface LargeCopierWasteStatus {
  printerId: string;
  printerName: string;
  location: string;
  ip: string;
  model: string;
  wasteTonerStatus: string;
  status: 'normal' | 'near_full' | 'full' | 'unknown';
  isFull: boolean;
  isNearFull: boolean;
}

export interface FleetLowTonersResult {
  threshold: number;
  totalPrinters: number;
  onlinePrinters: number;
  totalLowTonerItems: number;
  totalWasteAlerts: number;
  totalHardwareErrors: number;
  printersWithOnlyWasteCount: number;
  printersWithHardwareErrorsCount: number;
  affectedPrintersCount: number;
  criticalPrinters: LowTonerDeviceItem[];
  largeCopiersWasteToner: LargeCopierWasteStatus[];
  scannedAt: string;
}

// In-memory cache & concurrency control for fleet low toner scans
let cachedFleetLowToners: FleetLowTonersResult | null = null;
let cachedFleetLowTonersTime: number = 0;
let inflightFleetScanPromise: Promise<FleetLowTonersResult> | null = null;

/**
 * Ultra-fast single-PDU SNMP query for printer consumables (toner levels + waste toner).
 * Queries base model and supplies table in 1 single SNMP GET packet:
 * - Monochrome desktop (Canon LBP): Slot 1 (toner name, current level, max capacity) -> 10-15ms
 * - Multi-color copier (Canon imageRUNNER ADVANCE): Slots 1-5 (K, C, M, Y toners + Waste Container) -> 15-20ms
 * Completes in 1 network round-trip instead of 16 sequential round-trips!
 */
export function queryPrinterConsumablesFast(
  ip: string,
  isLarge: boolean,
  defaultName?: string,
  defaultModel?: string,
  community: string = 'public',
  timeout: number = 1200,
  retries: number = 1
): Promise<PrinterConsumablesData> {
  return new Promise((resolve) => {
    const cleanIp = ip.replace(/_1$/, '').trim();
    const nowIso = new Date().toISOString();

    const session = snmp.createSession(cleanIp, community, {
      timeout,
      retries,
      version: snmp.Version1
    });

    // Single PDU GET: Base OIDs + Supplies OIDs in 1 packet
    const oids = [
      '1.3.6.1.2.1.1.1.0',        // 0: Model / sysDescr
      '1.3.6.1.2.1.1.5.0',        // 1: sysName
      '1.3.6.1.2.1.43.5.1.1.17.1', // 2: Serial Number
      '1.3.6.1.2.1.25.3.5.1.2.1'  // 3: hrPrinterDetectedErrorState (BITS)
    ];

    const maxSlots = isLarge ? 5 : 1;
    for (let s = 1; s <= maxSlots; s++) {
      oids.push(`1.3.6.1.2.1.43.11.1.1.6.1.${s}`); // Name
      oids.push(`1.3.6.1.2.1.43.11.1.1.9.1.${s}`); // Level
      oids.push(`1.3.6.1.2.1.43.11.1.1.8.1.${s}`); // Max Capacity
    }

    session.get(oids, async (err, vbs) => {
      if (err || !vbs) {
        session.close();
        return resolve({
          ip: cleanIp,
          isSnmpAvailable: false,
          model: defaultModel || 'Nepoznato',
          deviceName: defaultName || 'Štampač',
          serialNumber: '-',
          location: '-',
          uptimeText: null,
          totalPageCount: null,
          scanCount: null,
          hasScanner: isLarge,
          printerStatus: 'offline',
          printerStatusText: 'Nema SNMP odziva (Port 161)',
          toners: [],
          wasteToner: { name: 'Otpadni toner', status: 'unknown', statusText: 'Nema podataka' },
          trays: [],
          fetchedAt: nowIso,
          error: err?.message || 'SNMP timeout',
          errors: [],
          hasError: false
        });
      }

      const rawModel = vbs[0] && !snmp.isVarbindError(vbs[0]) ? (Buffer.isBuffer(vbs[0].value) ? vbs[0].value.toString('utf-8').trim() : String(vbs[0].value)) : (defaultModel || 'Nepoznato');
      if (rawModel && rawModel !== 'Nepoznato') {
        try { updatePrinterModelFromSnmp(cleanIp, rawModel); } catch {}
      }
      const rawSysName = vbs[1] && !snmp.isVarbindError(vbs[1]) ? (Buffer.isBuffer(vbs[1].value) ? vbs[1].value.toString('utf-8').trim() : String(vbs[1].value)) : (defaultName || cleanIp);
      const rawSerial = vbs[2] && !snmp.isVarbindError(vbs[2]) ? (Buffer.isBuffer(vbs[2].value) ? vbs[2].value.toString('utf-8').trim() : String(vbs[2].value)) : '-';
      const detectedErrors = decodeHrPrinterDetectedErrorState(vbs[3]?.value);

      let printerStatus: PrinterConsumablesData['printerStatus'] = 'idle';
      let printerStatusText = 'Spreman za rad (Pripravan)';

      const toners: TonerItem[] = [];
      let wasteToner: { name: string; status: 'normal' | 'near_full' | 'full' | 'unknown'; statusText: string } = {
        name: 'Kontejner otpadnog tonera',
        status: 'normal',
        statusText: 'U redu (Ispravno stanje)'
      };

      for (let s = 1; s <= maxSlots; s++) {
        const nameIdx = 4 + (s - 1) * 3;
        const lvlIdx = nameIdx + 1;
        const maxIdx = nameIdx + 2;

        const vbName = vbs[nameIdx];
        const vbLvl = vbs[lvlIdx];
        const vbMax = vbs[maxIdx];

        if (vbName && !snmp.isVarbindError(vbName)) {
          const rawName = Buffer.isBuffer(vbName.value) ? vbName.value.toString('utf-8').trim() : String(vbName.value);
          const lvlVal = vbLvl && !snmp.isVarbindError(vbLvl) ? Number(vbLvl.value) : -1;
          const maxVal = vbMax && !snmp.isVarbindError(vbMax) ? Number(vbMax.value) : 100;

          if (!rawName) continue;

          if (rawName.toLowerCase().includes('waste') || rawName.toLowerCase().includes('otpad')) {
            const isFull = lvlVal === 0 || (maxVal > 0 && lvlVal >= maxVal);
            const isNear = lvlVal === -3 || (maxVal > 0 && lvlVal / maxVal >= 0.85) || lvlVal >= 90;
            wasteToner = {
              name: rawName,
              status: isFull ? 'full' : (isNear ? 'near_full' : 'normal'),
              statusText: isFull ? 'PUN - zameniti' : (isNear ? 'Skoro pun' : 'U redu (Ispravno)')
            };
            continue;
          }

          let color: TonerItem['color'] = 'other';
          const lowerName = rawName.toLowerCase();
          if (lowerName.includes('black') || lowerName.includes('crn')) color = 'black';
          else if (lowerName.includes('cyan') || lowerName.includes('plav')) color = 'cyan';
          else if (lowerName.includes('magenta') || lowerName.includes('crven')) color = 'magenta';
          else if (lowerName.includes('yellow') || lowerName.includes('žut') || lowerName.includes('zut')) color = 'yellow';
          else color = 'black';

          let percent = lvlVal;
          if (maxVal > 0 && lvlVal >= 0 && maxVal !== 100) {
            percent = Math.round((lvlVal / maxVal) * 100);
          }
          if (percent < 0) percent = 0;
          if (percent > 100) percent = 100;

          let status: TonerItem['status'] = 'good';
          if (percent <= 5) status = 'critical';
          else if (percent <= 25) status = 'low';

          toners.push({
            color,
            name: rawName,
            level: percent,
            maxCapacity: maxVal,
            status
          });
        }
      }

      // Check prtAlertTable for active waste toner and hardware alerts
      let alertData: PrinterAlertsResult | null = null;
      try {
        alertData = await getPrinterAlertsStatus(session);
        if (alertData.isWasteFull) {
          wasteToner.status = 'full';
          wasteToner.statusText = 'PUN - zameniti';
          if (alertData.wasteDesc) wasteToner.name = alertData.wasteDesc;
        } else if (alertData.isWasteNear && wasteToner.status !== 'full') {
          wasteToner.status = 'near_full';
          wasteToner.statusText = 'Skoro pun';
          if (alertData.wasteDesc) wasteToner.name = alertData.wasteDesc;
        }
      } catch {}

      session.close();

      const combinedErrors = normalizePrinterErrors([...detectedErrors, ...(alertData?.hardwareErrors || [])]);
      const hasError = combinedErrors.length > 0;

      if (hasError) {
        printerStatus = 'error';
        printerStatusText = `Greška: ${combinedErrors[0]}`;
      } else if (wasteToner.status === 'full') {
        printerStatus = 'warning';
        printerStatusText = 'Greška: Otpadni toner je pun (zameniti)';
      } else if (wasteToner.status === 'near_full') {
        printerStatus = 'warning';
        printerStatusText = 'Upozorenje: Otpadni toner je skoro pun';
      }

      resolve({
        ip: cleanIp,
        isSnmpAvailable: true,
        model: rawModel,
        deviceName: rawSysName,
        serialNumber: rawSerial,
        location: '-',
        uptimeText: null,
        totalPageCount: null,
        scanCount: null,
        hasScanner: isLarge,
        printerStatus,
        printerStatusText,
        toners,
        wasteToner,
        trays: [],
        fetchedAt: nowIso,
        errors: combinedErrors,
        hasError
      });
    });
  });
}

/**
 * Ultra-fast parallel scan of all active network printers to find toners <= threshold%
 * (default 5%) and monitor waste toner container status for large enterprise copiers.
 *
 * Performance Architecture:
 * - Single PDU SNMP queries for all supplies (1 round-trip vs 16 sequential).
 * - Fully parallel async execution across all 39 printers (~2.4s total vs 24.3s).
 * - Pre-wakes ONLY large copiers (Canon imageRUNNER ADVANCE) concurrently.
 * - Small desktop printers (Canon LBP) receive ZERO wake packets / TCP probes (100% safe).
 * - 60s in-memory caching for instant UI modal load (< 5ms).
 * - Request deduping so parallel UI clicks share the same scan promise.
 */
export async function getFleetLowToners(threshold: number = 5, force: boolean = false): Promise<FleetLowTonersResult> {
  const now = Date.now();
  // Return cached result if fresh (< 60s), threshold matches, and not forcing rescan
  if (!force && cachedFleetLowToners && cachedFleetLowToners.threshold === threshold && (now - cachedFleetLowTonersTime < 60000)) {
    return cachedFleetLowToners;
  }

  // Dedup in-flight scan so multiple clicks join the same ongoing scan
  if (inflightFleetScanPromise) {
    return inflightFleetScanPromise;
  }

  // Global scan lock: never runs at the same time as camera, recorder or LAN scans
  inflightFleetScanPromise = acquireScanLock('printer-fleet', async () => {
    try {
      const { getAllPrinters } = await import('../db/printerDb');
      const activePrinters = getAllPrinters(false);

      const largePrinters = activePrinters.filter(p => isLargeCopier(p));
      const smallPrinters = activePrinters.filter(p => !isLargeCopier(p));

      // 1. Step 1: Gentle pre-wake ONLY for large enterprise copiers (Canon imageRUNNER ADVANCE), in batches of 4
      // Small desktop printers (Canon LBP 6780x / 312x) NEVER receive wake packets to prevent network card freeze!
      if (largePrinters.length > 0) {
        await wakePrintersInBatches(largePrinters.map(p => p.ip));
      }

      // 2. Step 2: Query small desktop printers FIRST in parallel
      // Small printers answer in 10-15ms. While small printers are being queried, large copiers wake up in the background.
      const smallResults = await Promise.all(
        smallPrinters.map(p => queryPrinterConsumablesFast(p.ip, false, p.name, p.model))
      );

      // 3. Step 3: Settlement pause (1200ms) to ensure large copier SNMP stack is fully initialized
      await new Promise(r => setTimeout(r, 1200));

      // 4. Step 4: Query large copiers in parallel using single-PDU SNMP GET (1800ms timeout)
      const largeResults = await Promise.all(
        largePrinters.map(p => queryPrinterConsumablesFast(p.ip, true, p.name, p.model, 'public', 1800, 1))
      );

      // 5. Step 5: Smart Retry for any large copier that took extra time to wake from Deep Sleep
      const pendingLarge: Array<{ p: any; idx: number }> = [];
      largeResults.forEach((res, idx) => {
        if (!res.isSnmpAvailable) pendingLarge.push({ p: largePrinters[idx], idx });
      });

      if (pendingLarge.length > 0) {
        // Re-send wake signal (directed WOL + HTTP) and allow 1500ms settlement for late-waking copiers
        await wakePrintersInBatches(pendingLarge.map(({ p }) => p.ip));
        await new Promise(r => setTimeout(r, 1500));
        await Promise.all(
          pendingLarge.map(async ({ p, idx }) => {
            const retryData = await queryPrinterConsumablesFast(p.ip, true, p.name, p.model, 'public', 2000, 1);
            if (retryData.isSnmpAvailable) {
              largeResults[idx] = retryData;
            }
          })
        );
      }

      // Combine scan results and update consumablesCache with fresh data
      const scanMap = new Map<string, PrinterConsumablesData>();
      smallResults.forEach(res => scanMap.set(res.ip, res));
      largeResults.forEach(res => scanMap.set(res.ip, res));

      scanMap.forEach((data) => {
        if (data && data.isSnmpAvailable) {
          consumablesCache.set(data.ip, { data, timestamp: Date.now() });
        }
      });

      const criticalPrinters: LowTonerDeviceItem[] = [];
      const largeCopiersWasteToner: LargeCopierWasteStatus[] = [];
      let onlineCount = 0;
      let totalLowTonerCount = 0;
      let totalWasteAlerts = 0;
      let totalHardwareErrors = 0;
      let printersWithOnlyWaste = 0;
      let printersWithHardwareErrors = 0;

      for (let i = 0; i < activePrinters.length; i++) {
        const p = activePrinters[i];
        const cleanIp = p.ip.replace(/_1$/, '').trim();
        const data = scanMap.get(cleanIp) || { isSnmpAvailable: false, errors: [], hasError: false } as unknown as PrinterConsumablesData;
        const isLarge = isLargeCopier(p);

        if (data && data.isSnmpAvailable) {
          onlineCount++;

          const isWasteFull = data.wasteToner.status === 'full';
          const isWasteNear = data.wasteToner.status === 'near_full';
          const wasteNeedsReplace = isWasteFull || isWasteNear;

          if (isLarge) {
            largeCopiersWasteToner.push({
              printerId: p.id,
              printerName: p.name,
              location: p.location,
              ip: p.ip,
              model: data.model !== 'Nepoznato' ? data.model : p.model,
              wasteTonerStatus: data.wasteToner.statusText,
              status: data.wasteToner.status,
              isFull: isWasteFull,
              isNearFull: isWasteNear
            });
          }

          const matchingToners = (data.toners || []).filter(t => t.level >= 0 && t.level <= threshold);
          // Greške sa spiska poznatih kvarova ne ulaze u upozorenja (IGNORED_PRINTER_ERRORS)
          const alertErrors = (data.errors || []).filter(e => !isIgnoredPrinterError(p.id, e));
          const hasHwError = alertErrors.length > 0;
          const onlyWaste = matchingToners.length === 0 && !hasHwError && wasteNeedsReplace;
          const onlyHardwareError = matchingToners.length === 0 && !wasteNeedsReplace && hasHwError;

          if (matchingToners.length > 0 || wasteNeedsReplace || hasHwError) {
            totalLowTonerCount += matchingToners.length;
            if (wasteNeedsReplace) totalWasteAlerts++;
            if (onlyWaste) printersWithOnlyWaste++;
            if (hasHwError) {
              totalHardwareErrors += alertErrors.length;
              printersWithHardwareErrors++;
            }

            criticalPrinters.push({
              printerId: p.id,
              printerName: p.name,
              location: p.location,
              ip: p.ip,
              model: data.model !== 'Nepoznato' ? data.model : p.model,
              customTag: p.customTag || 'U funkciji',
              isOnline: true,
              isLargeCopier: isLarge,
              lowToners: matchingToners,
              allToners: data.toners || [],
              wasteTonerStatus: data.wasteToner.statusText,
              isWasteTonerFull: isWasteFull,
              isWasteTonerNearFull: isWasteNear,
              onlyWasteToner: onlyWaste,
              wasteTonerNeedsReplacement: wasteNeedsReplace,
              errors: alertErrors,
              hasHardwareError: hasHwError,
              onlyHardwareError
            });
          }
        } else if (isLarge) {
          largeCopiersWasteToner.push({
            printerId: p.id,
            printerName: p.name,
            location: p.location,
            ip: p.ip,
            model: p.model,
            wasteTonerStatus: 'Nema odziva (Isključen/Spava)',
            status: 'unknown',
            isFull: false,
            isNearFull: false
          });
        }
      }

      const result: FleetLowTonersResult = {
        threshold,
        totalPrinters: activePrinters.length,
        onlinePrinters: onlineCount,
        totalLowTonerItems: totalLowTonerCount,
        totalWasteAlerts,
        totalHardwareErrors,
        printersWithOnlyWasteCount: printersWithOnlyWaste,
        printersWithHardwareErrorsCount: printersWithHardwareErrors,
        affectedPrintersCount: criticalPrinters.length,
        criticalPrinters,
        largeCopiersWasteToner,
        scannedAt: new Date().toISOString()
      };

      cachedFleetLowToners = result;
      cachedFleetLowTonersTime = Date.now();
      return result;
    } finally {
      inflightFleetScanPromise = null;
    }
  });

  return inflightFleetScanPromise;
}

export interface UrgentZeroColorToner {
  color: string;
  colorName: string;
  colorDot: string;
  name: string;
  level: number;
}

export interface UrgentPrinterIssue {
  printerId: string;
  printerName: string;
  location: string;
  ip: string;
  model: string;
  isWasteFull: boolean;
  wasteStatusText: string;
  zeroColorToners: UrgentZeroColorToner[];
  allToners: TonerItem[];
  errors: string[];
  hasHardwareError: boolean;
  reasons: string[];
}

export interface UrgentTonersCheckResult {
  totalPrinters: number;
  onlinePrinters: number;
  urgentPrintersCount: number;
  totalWasteFullCount: number;
  totalZeroColorTonersCount: number;
  totalHardwareErrorsCount: number;
  urgentPrinters: UrgentPrinterIssue[];
  scannedAt: string;
}

/**
 * Hourly urgent check for printers:
 * Specifically targets printers where:
 * - Waste toner box is FULL
 * - OR any color toner (Cyan, Magenta, Yellow) is at 0%
 * - OR any active hardware error is reported (Paper Jam, Cover Open, Service Call, etc.)
 */
export async function checkUrgentTonersAndWaste(force: boolean = true): Promise<UrgentTonersCheckResult> {
  const fleetData = await getFleetLowToners(5, force);
  const urgentPrinters: UrgentPrinterIssue[] = [];
  let totalWasteFullCount = 0;
  let totalZeroColorTonersCount = 0;
  let totalHardwareErrorsCount = 0;

  for (const p of (fleetData.criticalPrinters || [])) {
    const isWasteFull = !!p.isWasteTonerFull;
    const hasHwError = !!p.hasHardwareError && p.errors && p.errors.length > 0;

    // Filter specifically for color toners that are at 0%
    const zeroColorToners: UrgentZeroColorToner[] = (p.allToners || []).filter((t: any) => {
      const col = (t.color || '').toLowerCase();
      const name = (t.name || '').toLowerCase();
      const isColor = col === 'cyan' || col === 'magenta' || col === 'yellow'
        || name.includes('cyan') || name.includes('magenta') || name.includes('yellow')
        || name.includes('plav') || name.includes('crven') || name.includes('žut') || name.includes('zut');
      return isColor && t.level === 0;
    }).map((t: any) => {
      let colorName = 'Kolor Toner';
      let colorDot = '#3b82f6';
      const col = (t.color || '').toLowerCase();
      const name = (t.name || '').toLowerCase();
      if (col === 'cyan' || name.includes('cyan')) { colorName = 'Plavi (Cyan)'; colorDot = '#06b6d4'; }
      else if (col === 'magenta' || name.includes('magenta')) { colorName = 'Crveni (Magenta)'; colorDot = '#ec4899'; }
      else if (col === 'yellow' || name.includes('yellow')) { colorName = 'Žuti (Yellow)'; colorDot = '#eab308'; }

      return {
        color: t.color || 'color',
        colorName,
        colorDot,
        name: t.name || 'Toner',
        level: t.level
      };
    });

    const reasons: string[] = [];
    if (isWasteFull) {
      totalWasteFullCount++;
      reasons.push('Otpadni kontejner je PUN (hitna zamena)');
    }
    if (zeroColorToners.length > 0) {
      totalZeroColorTonersCount += zeroColorToners.length;
      const names = zeroColorToners.map(c => c.colorName).join(', ');
      reasons.push(`Kolor toner je na 0% (${names})`);
    }
    if (hasHwError) {
      totalHardwareErrorsCount += p.errors.length;
      p.errors.forEach(err => reasons.push(`Greška štampača: ${err}`));
    }

    if (isWasteFull || zeroColorToners.length > 0 || hasHwError) {
      urgentPrinters.push({
        printerId: p.printerId,
        printerName: p.printerName,
        location: p.location,
        ip: p.ip,
        model: p.model,
        isWasteFull,
        wasteStatusText: p.wasteTonerStatus || (isWasteFull ? 'Pun kontejner' : 'U redu'),
        zeroColorToners,
        allToners: p.allToners || [],
        errors: p.errors || [],
        hasHardwareError: hasHwError,
        reasons
      });
    }
  }

  return {
    totalPrinters: fleetData.totalPrinters,
    onlinePrinters: fleetData.onlinePrinters,
    urgentPrintersCount: urgentPrinters.length,
    totalWasteFullCount,
    totalZeroColorTonersCount,
    totalHardwareErrorsCount,
    urgentPrinters,
    scannedAt: new Date().toISOString()
  };
}


