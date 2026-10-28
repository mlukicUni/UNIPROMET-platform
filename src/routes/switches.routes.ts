import { Router, Request, Response } from 'express';
import { fetchSwitchDetails, getAllSwitches } from '../services/switchService';

export const switchesRouter = Router();

// GET /api/switches - Get list of managed switches with key stats
switchesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const data = await getAllSwitches(force);
    res.json({ success: true, ...data });
  } catch (err: any) {
    console.error('Error in GET /api/switches:', err);
    res.status(500).json({ error: 'Greška pri učitavanju svičeva', details: err?.message });
  }
});

// GET /api/switches/:ip - Get detailed telemetry, all 28 ports and FDB MAC table for a single switch
switchesRouter.get('/:ip', async (req: Request, res: Response) => {
  try {
    const ip = req.params.ip || '192.168.120.25';
    const force = req.query.force === 'true';
    const details = await fetchSwitchDetails(ip, force);
    res.json({ success: true, switch: details });
  } catch (err: any) {
    console.error('Error in GET /api/switches/:ip:', err);
    res.status(500).json({ error: 'Greška pri učitavanju detalja sviča', details: err?.message });
  }
});

// POST /api/switches/:ip/refresh - Force re-scan of switch telemetry
switchesRouter.post('/:ip/refresh', async (req: Request, res: Response) => {
  try {
    const ip = req.params.ip || '192.168.120.25';
    const details = await fetchSwitchDetails(ip, true);
    res.json({ success: true, switch: details });
  } catch (err: any) {
    console.error('Error refreshing switch telemetry:', err);
    res.status(500).json({ error: 'Greška pri osvežavanju sviča', details: err?.message });
  }
});
