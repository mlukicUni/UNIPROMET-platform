import fs from 'fs';
import path from 'path';
import { getDb } from './sqlite';
import { initSchema } from './schema';

export interface DeviceReportEntry {
  printerId?: string;
  ip: string;
  name: string;
  model: string;
  location: string;
  serialNumber: string;
  status: 'success' | 'offline' | 'unreachable' | 'online_no_snmp';
  pageCounters: {
    total1?: number | null;
    total2?: number | null;
    blackLarge?: number | null;
    blackSmall?: number | null;
    colorLarge?: number | null;
    colorSmall?: number | null;
    colorTotal1?: number | null;
    printTotal?: number | null;
    scanTotal?: number | null;
  };
  toners: Array<{
    color: string;
    name: string;
    level: number;
  }>;
  wasteToner?: string;
  errors?: string[];
}

export interface ConsumptionReport {
  id: string;
  title: string;
  monthYear: string;
  createdAt: string;
  deviceCount: number;
  onlineCount: number;
  totalImpressionsAcrossFleet: number;
  entries: DeviceReportEntry[];
  excelFileName?: string;
}

interface ReportRow {
  id: string;
  title: string;
  month_year: string | null;
  created_at: string;
  device_count: number;
  online_count: number;
  total_impressions: number;
  excel_file_name: string | null;
  entries_json: string | null;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const REPORTS_EXPORT_DIR = path.join(DATA_DIR, 'exports');

function ensureExportDir(): void {
  if (!fs.existsSync(REPORTS_EXPORT_DIR)) {
    fs.mkdirSync(REPORTS_EXPORT_DIR, { recursive: true });
  }
}

function rowToReport(row: ReportRow): ConsumptionReport {
  let entries: DeviceReportEntry[] = [];
  if (row.entries_json) {
    try {
      entries = JSON.parse(row.entries_json);
    } catch (e) {
      entries = [];
    }
  }

  return {
    id: row.id,
    title: row.title,
    monthYear: row.month_year || '',
    createdAt: row.created_at,
    deviceCount: row.device_count || 0,
    onlineCount: row.online_count || 0,
    totalImpressionsAcrossFleet: row.total_impressions || 0,
    excelFileName: row.excel_file_name || undefined,
    entries
  };
}

export function getAllReports(): ConsumptionReport[] {
  initSchema();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all() as ReportRow[];
  return rows.map(rowToReport);
}

export function getReportById(id: string): ConsumptionReport | undefined {
  initSchema();
  const db = getDb();
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as ReportRow | undefined;
  return row ? rowToReport(row) : undefined;
}

export function saveReport(report: ConsumptionReport): ConsumptionReport {
  initSchema();
  const db = getDb();

  db.prepare(`
    INSERT OR REPLACE INTO reports (
      id, title, month_year, created_at, device_count, online_count,
      total_impressions, excel_file_name, entries_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    report.id,
    report.title,
    report.monthYear || '',
    report.createdAt,
    report.deviceCount,
    report.onlineCount,
    report.totalImpressionsAcrossFleet,
    report.excelFileName || null,
    report.entries ? JSON.stringify(report.entries) : '[]'
  );

  return report;
}

export function deleteReport(id: string): boolean {
  initSchema();
  const db = getDb();
  const report = getReportById(id);
  if (!report) return false;

  if (report.excelFileName) {
    ensureExportDir();
    const filePath = path.join(REPORTS_EXPORT_DIR, report.excelFileName);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.warn('Could not remove excel file:', e);
      }
    }
  }

  const res = db.prepare('DELETE FROM reports WHERE id = ?').run(id);
  return res.changes > 0;
}

export function getExportDirectory(): string {
  ensureExportDir();
  return REPORTS_EXPORT_DIR;
}
