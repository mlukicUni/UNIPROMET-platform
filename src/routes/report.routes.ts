import { Router, Request, Response } from 'express';
import { generateFullFleetReport } from '../services/reportService';
import { getAllReports, getReportById, deleteReport, getExportDirectory } from '../db/reportDb';
import { sendWelcomeTestEmail, sendLowTonersAlertEmail, sendSinglePrinterReportEmail, DEFAULT_ADMIN_RECIPIENTS } from '../services/mailService';
import { addServerLog } from './system.routes';
import path from 'path';
import fs from 'fs';

export const reportRouter = Router();

// POST /api/reports/generate - Run full fleet scan and generate Excel report
reportRouter.post('/generate', async (req: Request, res: Response) => {
  try {
    const { title } = req.body;
    const report = await generateFullFleetReport(title);

    addServerLog('success', `Generisan novi izveštaj potrošnje: ${report.title} (${report.onlineCount}/${report.deviceCount} štampača online)`, 'Report Engine');
    res.status(201).json({ success: true, report });
  } catch (err: any) {
    console.error('Report generation error:', err);
    res.status(500).json({ error: 'Failed to generate consumption report', details: err?.message });
  }
});

// GET /api/reports - Get all historical reports from database
reportRouter.get('/', (_req: Request, res: Response) => {
  try {
    const reports = getAllReports();
    res.json({ total: reports.length, reports });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch reports', details: err?.message });
  }
});

// GET /api/reports/:id - Get single report details
reportRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const report = getReportById(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch report', details: err?.message });
  }
});

// GET /api/reports/:id/download - Download Excel file (.xlsx)
reportRouter.get('/:id/download', (req: Request, res: Response) => {
  try {
    const report = getReportById(req.params.id);
    if (!report || !report.excelFileName) {
      return res.status(404).json({ error: 'Report or file not found' });
    }

    const filePath = path.join(getExportDirectory(), report.excelFileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Excel file not found on server' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${report.excelFileName}"`);
    res.download(filePath, report.excelFileName);
  } catch (err: any) {
    res.status(500).json({ error: 'Download failed', details: err?.message });
  }
});

// DELETE /api/reports/:id - Delete historical report
reportRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteReport(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json({ success: true, message: 'Report deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Delete failed', details: err?.message });
  }
});

// Dedicated Mail Router for /api/mail/* and /api/reports/mail/*
export const mailRouter = Router();

// POST /test-welcome - Send branded test welcome email
mailRouter.post('/test-welcome', async (req: Request, res: Response) => {
  try {
    const recipient = req.body.to || 'marko.lukic@unipromet.co.rs';
    const result = await sendWelcomeTestEmail(recipient);

    addServerLog('success', `Poslat testni welcome email na adresu: ${recipient}`, 'Mail Engine');
    res.json({
      success: true,
      message: `Testni welcome email uspešno poslat na ${recipient}`,
      details: result
    });
  } catch (err: any) {
    console.error('Test email sending error:', err);
    addServerLog('error', `Neuspešno slanje testnog emaila: ${err?.message}`, 'Mail Engine');
    res.status(500).json({ error: 'Failed to send test email', details: err?.message });
  }
});

// POST /send-low-toners-report - Send HTML low toner alert report to administrators
mailRouter.post('/send-low-toners-report', async (req: Request, res: Response) => {
  try {
    const recipient = req.body.to || DEFAULT_ADMIN_RECIPIENTS;
    const reportData = req.body.reportData;
    const result = await sendLowTonersAlertEmail(recipient, reportData);

    addServerLog('success', `Poslat email izveštaj o tonerima (≤5%) na adrese: ${result.recipient} (${result.criticalCount} tonera, ${result.printersCount} štampača)`, 'Mail Engine');
    res.json({
      success: true,
      message: `Izveštaj o kritičnim tonerima uspešno poslat na ${result.recipient}`,
      details: result
    });
  } catch (err: any) {
    console.error('Low toners email sending error:', err);
    addServerLog('error', `Neuspešno slanje email izveštaja o tonerima: ${err?.message}`, 'Mail Engine');
    res.status(500).json({ error: 'Failed to send low toners report email', details: err?.message });
  }
});

// POST /send-single-printer-report - Send HTML telemetry and status report for a single printer
mailRouter.post('/send-single-printer-report', async (req: Request, res: Response) => {
  try {
    const { ip, to, customData } = req.body;
    if (!ip) {
      return res.status(400).json({ error: 'Printer IP address is required' });
    }
    const recipient = to || DEFAULT_ADMIN_RECIPIENTS;
    const result = await sendSinglePrinterReportEmail(recipient, ip, customData);

    addServerLog('success', `Poslat email izveštaj za štampač ${result.printerName} (${ip}) na ${result.recipient}`, 'Mail Engine');
    res.json({
      success: true,
      message: `Izveštaj za štampač ${result.printerName} (${ip}) uspešno poslat na ${result.recipient}`,
      details: result
    });
  } catch (err: any) {
    console.error('Single printer report email error:', err);
    addServerLog('error', `Neuspešno slanje izveštaja za štampač: ${err?.message}`, 'Mail Engine');
    res.status(500).json({ error: 'Failed to send single printer report', details: err?.message });
  }
});

// Mount mailRouter under reportRouter for backward compatibility with /api/reports/mail/*
reportRouter.use('/mail', mailRouter);
