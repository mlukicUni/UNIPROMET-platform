import http from 'http';
import { Router, Request, Response } from 'express';
import { scanCameras, pingCamera, checkOfflineCamerasLocked } from '../services/cameraScanner';
import { getCameraSchedulerStatus, addCameraScheduledTime } from '../services/cameraSchedulerService';
import { sendOfflineCamerasAlertEmail } from '../services/mailService';
import { fetchCameraSnapshot, getCameraCredentials } from '../services/cameraLiveService';
import { checkGatewayHealth, startVideoGateway } from '../services/videoGatewayService';
import { getCameraInventoryByIp } from '../db/cameraInventoryDb';
import { hasLevel, filterCamerasByAccess } from '../services/accessService';
import {
  getCameraPlaybackInfo,
  searchCameraRecordings,
  startPlaybackStream,
  stopPlaybackStream,
  createClipExportStream,
  deleteClipExportStream,
  syncAllNvrChannels
} from '../services/playbackService';

export const cameraRouter = Router();

// GET /api/cameras - Scan and list all discovered IP cameras (including verified offline cameras)
cameraRouter.get('/', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true' || req.query.refresh === 'true';
    const deep = req.query.deep === 'true';
    const result = await scanCameras(force, deep);
    // Korisnici bez prava nad inventarom kamera vide samo kamere kojima imaju pristup po roli
    if (req.access && !hasLevel(req.access, 'mreza.kamere', 'view')) {
      const allowed = filterCamerasByAccess(req.access, result.cameras || []);
      return res.json({ success: true, ...result, cameras: allowed, totalCameras: allowed.length });
    }
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Camera scan error:', err);
    res.status(500).json({ error: 'Failed to scan cameras', details: err?.message });
  }
});

// GET /api/cameras/offline - Cross-reference database inventory and return verified offline cameras
cameraRouter.get('/offline', async (_req: Request, res: Response) => {
  try {
    const result = await checkOfflineCamerasLocked();
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Offline cameras check error:', err);
    res.status(500).json({ error: 'Failed to check offline cameras', details: err?.message });
  }
});

// GET /api/cameras/scheduler - Status of camera background scheduler
cameraRouter.get('/scheduler', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...getCameraSchedulerStatus() });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get camera scheduler status', details: err?.message });
  }
});

// POST /api/cameras/scheduler/time - Add scheduled check time
cameraRouter.post('/scheduler/time', (req: Request, res: Response) => {
  try {
    const { time } = req.body;
    if (!time || !/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({ error: 'Valid HH:MM format required' });
    }
    const updated = addCameraScheduledTime(time);
    res.json({ success: true, activeTimes: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to add scheduled time', details: err?.message });
  }
});

// POST /api/cameras/offline/email - Manually trigger offline camera alert email
cameraRouter.post('/offline/email', async (req: Request, res: Response) => {
  try {
    const recipient = req.body?.recipient || undefined;
    const result = await sendOfflineCamerasAlertEmail(recipient);
    res.json(result);
  } catch (err: any) {
    console.error('Offline camera alert email error:', err);
    res.status(500).json({ error: 'Failed to send offline camera email', details: err?.message });
  }
});

// GET /api/cameras/:ip/ping - Ping single camera
cameraRouter.get('/:ip/ping', async (req: Request, res: Response) => {
  try {
    const { ip } = req.params;
    const result = await pingCamera(ip);
    res.json({ success: true, ip, ...result });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to ping camera', details: err?.message });
  }
});

// GET /api/cameras/:ip/snapshot - Fetch single live frame (sub or main stream)
cameraRouter.get('/:ip/snapshot', async (req: Request, res: Response) => {
  try {
    const { ip } = req.params;
    const streamType = (req.query.stream === 'main') ? 'main' : 'sub';
    const frame = await fetchCameraSnapshot(ip, streamType);
    
    if (!frame) {
      return res.status(502).json({ error: 'Kamera nije dostupna ili je video signal u prekidu' });
    }

    res.setHeader('Content-Type', frame.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(frame.data);
  } catch (err: any) {
    res.status(500).json({ error: 'Greška pri očitavanju video frejma', details: err?.message });
  }
});

// GET /api/cameras/:ip/live-stream - Continuous MJPEG multipart stream for in-browser video
cameraRouter.get('/:ip/live-stream', async (req: Request, res: Response) => {
  const { ip } = req.params;
  const streamType = (req.query.stream === 'main') ? 'main' : 'sub';

  res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=--unipromet_frame');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Connection', 'close');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  let isClosed = false;
  req.on('close', () => { isClosed = true; });

  const intervalMs = streamType === 'main' ? 650 : 350;

  const timer = setInterval(async () => {
    if (isClosed) {
      clearInterval(timer);
      return;
    }

    try {
      const frame = await fetchCameraSnapshot(ip, streamType);
      if (frame && !isClosed) {
        res.write(`--unipromet_frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.data.length}\r\n\r\n`);
        res.write(frame.data);
        res.write('\r\n');
      }
    } catch {
      // client or camera disconnected
    }
  }, intervalMs);
});

// GET /api/cameras/gateway/status - Check if 25 FPS video gateway is active
cameraRouter.get('/gateway/status', async (_req: Request, res: Response) => {
  let isHealthy = await checkGatewayHealth();
  if (!isHealthy) {
    await startVideoGateway();
    isHealthy = await checkGatewayHealth();
  }
  res.json({ success: true, running: isHealthy, port: 1984 });
});

// GET /api/cameras/:ip/live-info - Return camera live playback metadata and RTSP URLs
cameraRouter.get('/:ip/live-info', async (req: Request, res: Response) => {
  const { ip } = req.params;
  const { user, pass } = getCameraCredentials(ip);
  const cam = getCameraInventoryByIp(ip);
  const credProfile = cam?.credProfile || 1;
  const authStatus = cam?.authStatus || 'untested';

  const rtspMain = `rtsp://${user}:${encodeURIComponent(pass)}@${ip}:554/Streaming/Channels/101`;
  const rtspSub = `rtsp://${user}:${encodeURIComponent(pass)}@${ip}:554/Streaming/Channels/102`;

  const host = req.hostname || 'localhost';
  let gatewayHealthy = await checkGatewayHealth();
  if (!gatewayHealthy) {
    await startVideoGateway();
    gatewayHealthy = await checkGatewayHealth();
  }

  res.json({
    success: true,
    ip,
    credProfile,
    authStatus,
    gatewayRunning: gatewayHealthy,
    gatewayPort: 1984,
    // 25 FPS WebRTC / MSE streams via secure reverse proxy (No credentials exposed to browser!)
    streamWsSubUrl: `/api/video-gateway/ws?src=cam_${ip.replace(/\./g, '_')}_sub`,
    streamWsMainUrl: `/api/video-gateway/ws?src=cam_${ip.replace(/\./g, '_')}_main`,
    streamMp4SubUrl: `/api/video-gateway/stream.mp4?src=cam_${ip.replace(/\./g, '_')}_sub`,
    streamMp4MainUrl: `/api/video-gateway/stream.mp4?src=cam_${ip.replace(/\./g, '_')}_main`,
    // Snapshots & RTSP (Sanitized without credentials)
    snapshotSubUrl: `/api/cameras/${ip}/snapshot?stream=sub`,
    snapshotMainUrl: `/api/cameras/${ip}/snapshot?stream=main`,
    liveStreamSubUrl: `/api/cameras/${ip}/live-stream?stream=sub`,
    liveStreamMainUrl: `/api/cameras/${ip}/live-stream?stream=main`,
    rtspMain: `rtsp://${ip}:554/Streaming/Channels/101`,
    rtspSub: `rtsp://${ip}:554/Streaming/Channels/102`,
    webUrl: `http://${ip}/`
  });
});

// GET /api/cameras/:ip/playback-info - Check if camera has mapped NVR and return channel info
cameraRouter.get('/:ip/playback-info', (req: Request, res: Response) => {
  try {
    const { ip } = req.params;
    const info = getCameraPlaybackInfo(ip);
    res.json({ success: true, ...info });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// GET /api/cameras/:ip/playback-timeline?date=YYYY-MM-DD - Get recorded time spans for 24h timeline
cameraRouter.get('/:ip/playback-timeline', async (req: Request, res: Response) => {
  try {
    const { ip } = req.params;
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const result = await searchCameraRecordings(ip, dateStr);
    res.json(result);
  } catch (err: any) {
    console.error('Playback timeline error:', err);
    res.status(500).json({ success: false, error: err?.message, segments: [] });
  }
});

// POST /api/cameras/:ip/playback-stream - Start or seek dynamic playback stream in go2rtc
cameraRouter.post('/:ip/playback-stream', async (req: Request, res: Response) => {
  try {
    const { ip } = req.params;
    const { startTime, endTime } = req.body || {};

    if (!startTime) {
      return res.status(400).json({ success: false, error: 'Nedostaje startTime parametar' });
    }

    let gatewayHealthy = await checkGatewayHealth();
    if (!gatewayHealthy) {
      await startVideoGateway();
    }

    const streamResult = await startPlaybackStream(ip, startTime, endTime);

    res.json({
      success: streamResult.success,
      streamName: streamResult.streamName,
      rtspUrl: streamResult.rtspUrl,
      streamWsUrl: `/api/video-gateway/ws?src=${encodeURIComponent(streamResult.streamName)}`,
      streamMp4Url: `/api/video-gateway/stream.mp4?src=${encodeURIComponent(streamResult.streamName)}`,
      error: streamResult.error
    });
  } catch (err: any) {
    console.error('Playback stream error:', err);
    res.status(500).json({ success: false, error: err?.message });
  }
});

// POST /api/cameras/:ip/stop-playback - Explicitly release NVR playback session
cameraRouter.post('/:ip/stop-playback', async (req: Request, res: Response) => {
  try {
    const { ip } = req.params;
    await stopPlaybackStream(ip);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});

// GET /api/cameras/:ip/download-clip - Download time frame clip as MP4
cameraRouter.get('/:ip/download-clip', async (req: Request, res: Response) => {
  try {
    const { ip } = req.params;
    const { startTime, endTime } = req.query as { startTime?: string; endTime?: string };

    if (!startTime || !endTime) {
      return res.status(400).send('Nedostaju startTime ili endTime parametri.');
    }

    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
      return res.status(400).send('Nevažeći vremenski raspon (endTime mora biti veći od startTime).');
    }

    const clipDurationMs = endMs - startMs;
    // Cap at 30 minutes to prevent accidental giant runaway sessions
    const maxClipMs = 30 * 60 * 1000;
    if (clipDurationMs > maxClipMs) {
      return res.status(400).send('Maksimalna dužina jednog isečka je 30 minuta.');
    }

    const clipResult = await createClipExportStream(ip, startTime, endTime);
    if (!clipResult.success || !clipResult.streamName) {
      return res.status(500).send(clipResult.error || 'Nije moguće kreirati isečak snimka sa NVR-a.');
    }

    const streamName = clipResult.streamName;
    let isFinished = false;
    let durationTimer: NodeJS.Timeout | null = null;
    let initialTimeout: NodeJS.Timeout | null = null;
    let mp4ResRef: http.IncomingMessage | null = null;
    let mp4Req: http.ClientRequest | null = null;

    const cleanup = () => {
      deleteClipExportStream(streamName).catch(() => {});
    };

    const finalize = () => {
      if (isFinished) return;
      isFinished = true;
      if (durationTimer) clearTimeout(durationTimer);
      if (initialTimeout) clearTimeout(initialTimeout);
      try {
        if (mp4ResRef) mp4ResRef.unpipe(res);
      } catch {}
      try {
        res.end();
      } catch {}
      try {
        mp4Req?.destroy();
      } catch {}
      cleanup();
    };

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${clipResult.filename}"`);
    res.setHeader('X-Clip-Duration-Seconds', Math.round(clipDurationMs / 1000).toString());

    // Safety timeout in case no data ever arrives from go2rtc/NVR within 15 seconds:
    initialTimeout = setTimeout(() => {
      if (!isFinished) {
        finalize();
      }
    }, 15000);

    mp4Req = http.get(`http://127.0.0.1:1984/api/stream.mp4?src=${encodeURIComponent(streamName)}`, (mp4Res) => {
      mp4ResRef = mp4Res;
      if (mp4Res.statusCode !== 200) {
        finalize();
        if (!res.headersSent) res.status(502).send('Greška pri dohvatanju video toka sa NVR-a.');
        return;
      }

      let started = false;

      mp4Res.on('data', () => {
        if (!started) {
          started = true;
          if (initialTimeout) clearTimeout(initialTimeout);
          // Start precise countdown the moment real video frames start streaming!
          // Add 1.5s margin to allow complete keyframe closure
          durationTimer = setTimeout(() => {
            finalize();
          }, clipDurationMs + 1500);
        }
      });

      mp4Res.pipe(res);
      mp4Res.on('end', finalize);
      mp4Res.on('close', finalize);
      mp4Res.on('error', finalize);
    });

    mp4Req.on('error', () => {
      finalize();
      if (!res.headersSent) res.status(500).send('Greška mrežnog prenosa.');
    });

    res.on('close', () => {
      finalize();
    });
  } catch (err: any) {
    res.status(500).send(err?.message || 'Greška na serveru');
  }
});

// POST /api/cameras/sync-nvr-channels - Trigger auto-discovery of camera channels across all 15 NVRs
cameraRouter.post('/sync-nvr-channels', async (_req: Request, res: Response) => {
  try {
    const result = await syncAllNvrChannels();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message });
  }
});



