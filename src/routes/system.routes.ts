import { Router, Request, Response } from 'express';
import { getLocalIpAddresses, getSystemInfo } from '../utils/network';
import { getSchedulerStatus } from '../services/schedulerService';
import { publicUrl } from '../utils/appConfig';

export const systemRouter = Router();

// In-memory server activity logs for monitoring
export const serverLogs: Array<{ id: number; timestamp: string; level: 'info' | 'warn' | 'success' | 'error'; message: string; source: string }> = [
  {
    id: 1,
    timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    level: 'info',
    message: 'Node.js TypeScript server pokrenut sa SQLite bazom podataka',
    source: 'System'
  },
  {
    id: 2,
    timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    level: 'success',
    message: 'SQLite baza (unipromet.db) uspešno povezana sa WAL režimom',
    source: 'Database'
  },
  {
    id: 3,
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    level: 'info',
    message: 'Inicijalizovan Unipromet Admin Dashboard',
    source: 'Dashboard'
  }
];

export function addServerLog(level: 'info' | 'warn' | 'success' | 'error', message: string, source: string): void {
  serverLogs.push({
    id: serverLogs.length + 1,
    timestamp: new Date().toISOString(),
    level,
    message,
    source
  });
}

// GET /api/status - Complete server & system telemetry
systemRouter.get('/status', (req: Request, res: Response) => {
  const sysInfo = getSystemInfo();
  const localIps = getLocalIpAddresses();

  res.json({
    status: 'ONLINE',
    serverTime: new Date().toISOString(),
    system: sysInfo,
    network: {
      clientIp: req.ip || req.socket.remoteAddress,
      localIps: localIps,
      publicUrl: publicUrl()
    }
  });
});

// GET /api/stats - Dashboard metrics and indicators
systemRouter.get('/stats', (req: Request, res: Response) => {
  const sys = getSystemInfo();
  res.json({
    activeConnections: Math.floor(Math.random() * 4) + 1,
    serverUptimeSeconds: sys.nodeUptimeSeconds,
    memoryUsageMB: sys.memory.usedMB,
    memoryTotalMB: sys.memory.totalMB,
    memoryPercent: sys.memory.usagePercent,
    cpuCores: sys.cpus,
    systemPlatform: `${sys.platform} (${sys.arch})`,
    operations: {
      activeModules: 6,
      inspectedItemsToday: 1420,
      systemHealth: '100%',
      networkStatus: 'Optimizovano (LAN)'
    }
  });
});

// GET /api/logs - Server activity log
systemRouter.get('/logs', (_req: Request, res: Response) => {
  res.json({
    total: serverLogs.length,
    logs: [...serverLogs].reverse()
  });
});

// POST /api/logs - Custom log entry from frontend
systemRouter.post('/logs', (req: Request, res: Response) => {
  const { message, level = 'info', source = 'Admin UI' } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const newLog = {
    id: serverLogs.length + 1,
    timestamp: new Date().toISOString(),
    level: level as 'info' | 'warn' | 'success' | 'error',
    message,
    source
  };

  serverLogs.push(newLog);
  res.status(201).json({ success: true, log: newLog });
});

// GET /api/ping - Latency test
systemRouter.get('/ping', (_req: Request, res: Response) => {
  res.json({ pong: true, timestamp: Date.now() });
});

// GET /api/scheduler/status - Cron scheduler status
systemRouter.get('/scheduler/status', (_req: Request, res: Response) => {
  try {
    res.json(getSchedulerStatus());
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get scheduler status', details: err?.message });
  }
});
