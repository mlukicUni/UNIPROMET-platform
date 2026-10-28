import { Router, Request, Response } from 'express';
import { scanLanDevices, getDeviceDeepDetails } from '../services/networkDeviceScanner';
import net from 'net';

export const networkRouter = Router();

// GET /api/network/devices - List all discovered non-printer LAN devices
networkRouter.get('/devices', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true' || req.query.refresh === 'true';
    const result = await scanLanDevices(force);

    res.json({
      success: true,
      totalDevices: result.devices.length,
      scanDurationMs: result.scanDurationMs,
      cached: result.cached,
      devices: result.devices,
      categories: {
        server: result.devices.filter(d => d.category === 'server').length,
        router: result.devices.filter(d => d.category === 'router').length,
        workstation: result.devices.filter(d => d.category === 'workstation').length,
        camera: result.devices.filter(d => d.category === 'camera').length,
        wifi: result.devices.filter(d => d.category === 'wifi').length,
        voip: result.devices.filter(d => d.category === 'voip').length,
        other: result.devices.filter(d => d.category === 'other').length
      }
    });
  } catch (err: any) {
    console.error('LAN scan error:', err);
    res.status(500).json({ error: 'Failed to scan LAN devices', details: err?.message });
  }
});

// GET /api/network/devices/:ip/details - Deep port inspection & banner grab
networkRouter.get('/devices/:ip/details', async (req: Request, res: Response) => {
  try {
    const { ip } = req.params;
    const details = await getDeviceDeepDetails(ip);
    res.json({ success: true, details });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get device details', details: err?.message });
  }
});

// GET /api/network/devices/:ip/ping - Single device latency check
networkRouter.get('/devices/:ip/ping', async (req: Request, res: Response) => {
  const { ip } = req.params;
  const start = Date.now();
  try {
    const socket = new net.Socket();
    socket.setTimeout(800);

    const isAlive = await new Promise<boolean>((resolve) => {
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.connect(445, ip);
    });

    const elapsed = Date.now() - start;
    res.json({ success: true, ip, isAlive, latencyMs: elapsed });
  } catch (err: any) {
    res.json({ success: false, ip, isAlive: false, error: err?.message });
  }
});
