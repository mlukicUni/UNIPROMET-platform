import http from 'http';
import crypto from 'crypto';
import { getDb } from '../db/sqlite';

const PASS_1 = process.env.CAMERA_PASS_1 || process.env.CAMERA_PASS || '';
const PASS_2 = process.env.CAMERA_PASS_2 || '';

export interface PlaybackSegment {
  startTime: string; // ISO string
  endTime: string;   // ISO string
  startHour: number; // 0..24
  endHour: number;   // 0..24
  durationSeconds: number;
}

export interface CameraPlaybackInfo {
  supported: boolean;
  cameraIp: string;
  cameraName: string;
  recorderName?: string;
  recorderIp?: string;
  nvrChannel?: number;
  nvrTrackId?: string;
  credProfile?: number;
  error?: string;
}

/**
 * Executes a Digest authentication request against Hikvision NVR ISAPI.
 */
function nvrDigestRequest(
  host: string,
  port: number,
  path: string,
  user: string,
  pass: string,
  method: string = 'GET',
  body: string = '',
  timeout: number = 5000
): Promise<{ status: number; headers: Record<string, any>; body: string; error?: string }> {
  return new Promise((resolve) => {
    const bodyBuf = body ? Buffer.from(body, 'utf-8') : undefined;

    const req1Headers: Record<string, string | number> = {};
    if (bodyBuf) {
      req1Headers['Content-Length'] = bodyBuf.byteLength;
      req1Headers['Content-Type'] = 'application/xml';
    }

    const req1 = http.request(
      {
        hostname: host,
        port: port || 80,
        path,
        method,
        timeout,
        headers: req1Headers
      },
      (res1) => {
        const authHeader = res1.headers['www-authenticate'];
        if (res1.statusCode !== 401 || !authHeader) {
          let d = '';
          res1.on('data', (c) => (d += c));
          res1.on('end', () => resolve({ status: res1.statusCode || 200, headers: res1.headers, body: d }));
          return;
        }

        const getField = (name: string) => {
          const regex = new RegExp(name + '="?([^",\\s]+)"?');
          const match = authHeader.match(regex);
          return match ? match[1] : '';
        };

        const realm = getField('realm');
        const nonce = getField('nonce');
        const qop = getField('qop');
        const nc = '00000001';
        const cnonce = crypto.randomBytes(8).toString('hex');

        const ha1 = crypto.createHash('md5').update(`${user}:${realm}:${pass}`).digest('hex');
        const ha2 = crypto.createHash('md5').update(`${method}:${path}`).digest('hex');

        let response: string;
        if (qop && qop.includes('auth')) {
          response = crypto
            .createHash('md5')
            .update(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`)
            .digest('hex');
        } else {
          response = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
        }

        let auth = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${path}", response="${response}"`;
        if (qop && qop.includes('auth')) {
          auth += `, qop=auth, nc=${nc}, cnonce="${cnonce}"`;
        }

        const req2Headers: Record<string, string | number> = {
          Authorization: auth,
          'Content-Type': 'application/xml'
        };
        if (bodyBuf) {
          req2Headers['Content-Length'] = bodyBuf.byteLength;
        }

        const req2 = http.request(
          {
            hostname: host,
            port: port || 80,
            path,
            method,
            timeout,
            headers: req2Headers
          },
          (res2) => {
            let d = '';
            res2.on('data', (c) => (d += c));
            res2.on('end', () => resolve({ status: res2.statusCode || 200, headers: res2.headers, body: d }));
          }
        );

        req2.on('error', (err) => resolve({ status: 500, headers: {}, body: '', error: err.message }));
        req2.on('timeout', () => {
          req2.destroy();
          resolve({ status: 504, headers: {}, body: '', error: 'Request timeout' });
        });

        if (bodyBuf) req2.write(bodyBuf);
        req2.end();
      }
    );

    req1.on('error', (err) => resolve({ status: 500, headers: {}, body: '', error: err.message }));
    req1.on('timeout', () => {
      req1.destroy();
      resolve({ status: 504, headers: {}, body: '', error: 'Request timeout' });
    });

    if (bodyBuf) req1.write(bodyBuf);
    req1.end();
  });
}

/**
 * Returns NVR and channel mapping info for a given camera.
 */
export function getCameraPlaybackInfo(cameraIp: string): CameraPlaybackInfo {
  const db = getDb();
  const cam = db
    .prepare(
      `
    SELECT c.ip, c.name, c.recorder, c.recorder_id, c.nvr_channel, c.nvr_track_id,
           r.ip as r_ip, r.http_port as r_http_port, r.rtsp_port as r_rtsp_port, r.cred_profile as r_cred_profile
    FROM cameras c
    LEFT JOIN recorders r ON c.recorder_id = r.id OR c.recorder = r.name
    WHERE c.ip = ?
  `
    )
    .get(cameraIp) as any;

  if (!cam || !cam.r_ip || !cam.nvr_channel) {
    return {
      supported: false,
      cameraIp,
      cameraName: cam?.name || 'IP Kamera',
      error: 'Kamera nema mapiran NVR snimač ili kanal arhive'
    };
  }

  return {
    supported: true,
    cameraIp: cam.ip,
    cameraName: cam.name,
    recorderName: cam.recorder,
    recorderIp: cam.r_ip,
    nvrChannel: cam.nvr_channel,
    nvrTrackId: cam.nvr_track_id || `${cam.nvr_channel}01`,
    credProfile: cam.r_cred_profile || 1
  };
}

/**
 * Searches recorded segments on the NVR for a specific camera and date (YYYY-MM-DD).
 */
export async function searchCameraRecordings(
  cameraIp: string,
  dateStr: string
): Promise<{ success: boolean; date: string; segments: PlaybackSegment[]; error?: string }> {
  const info = getCameraPlaybackInfo(cameraIp);
  if (!info.supported || !info.recorderIp || !info.nvrTrackId) {
    return { success: false, date: dateStr, segments: [], error: info.error || 'NVR nije konfigurisan' };
  }

  const pass = info.credProfile === 2 ? PASS_2 : PASS_1;
  const startTime = `${dateStr}T00:00:00Z`;
  const endTime = `${dateStr}T23:59:59Z`;

  const searchXml = `<?xml version="1.0" encoding="utf-8"?>
<CMSearchDescription>
  <searchID>${crypto.randomUUID()}</searchID>
  <trackList>
    <trackID>${info.nvrTrackId}</trackID>
  </trackList>
  <timeSpanList>
    <timeSpan>
      <startTime>${startTime}</startTime>
      <endTime>${endTime}</endTime>
    </timeSpan>
  </timeSpanList>
  <maxResults>2000</maxResults>
  <searchResultPostion>0</searchResultPostion>
</CMSearchDescription>`;

  const res = await nvrDigestRequest(
    info.recorderIp,
    80,
    '/ISAPI/ContentMgmt/search',
    'admin',
    pass,
    'POST',
    searchXml,
    5000
  );

  if (res.status !== 200 || !res.body) {
    return {
      success: false,
      date: dateStr,
      segments: [],
      error: res.error || `NVR search failed with status ${res.status}`
    };
  }

  const segments: PlaybackSegment[] = [];
  const timeSpans = [...res.body.matchAll(/<timeSpan>[\s\S]*?<startTime>([^<]+)<\/startTime>[\s\S]*?<endTime>([^<]+)<\/endTime>[\s\S]*?<\/timeSpan>/g)];

  for (const m of timeSpans) {
    const sIso = m[1].trim();
    const eIso = m[2].trim();

    const dStart = new Date(sIso);
    const dEnd = new Date(eIso);

    if (!isNaN(dStart.getTime()) && !isNaN(dEnd.getTime())) {
      const durSec = Math.max(0, Math.round((dEnd.getTime() - dStart.getTime()) / 1000));
      const sHour = dStart.getUTCHours() + dStart.getUTCMinutes() / 60 + dStart.getUTCSeconds() / 3600;
      const eHour = dEnd.getUTCHours() + dEnd.getUTCMinutes() / 60 + dEnd.getUTCSeconds() / 3600;

      segments.push({
        startTime: sIso,
        endTime: eIso,
        startHour: Math.round(sHour * 1000) / 1000,
        endHour: Math.round(eHour * 1000) / 1000,
        durationSeconds: durSec
      });
    }
  }

  // Merge contiguous / overlapping segments within 30s of each other for cleaner UI
  const merged: PlaybackSegment[] = [];
  for (const seg of segments) {
    if (merged.length === 0) {
      merged.push({ ...seg });
      continue;
    }
    const last = merged[merged.length - 1];
    const gap = (new Date(seg.startTime).getTime() - new Date(last.endTime).getTime()) / 1000;
    if (gap <= 30) {
      last.endTime = seg.endTime;
      last.endHour = seg.endHour;
      last.durationSeconds = Math.round((new Date(last.endTime).getTime() - new Date(last.startTime).getTime()) / 1000);
    } else {
      merged.push({ ...seg });
    }
  }

  return {
    success: true,
    date: dateStr,
    segments: merged
  };
}

/**
 * Formats an ISO date string or Date object into Hikvision RTSP timestamp format: YYYYMMDDTHHmmssZ
 */
export function formatHikvisionTime(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

/**
 * Stops / removes a playback stream in go2rtc to release NVR playback bandwidth.
 */
export async function stopPlaybackStream(cameraIp: string): Promise<void> {
  const safeIp = cameraIp.replace(/\./g, '_');
  const streamName = `playback_${safeIp}`;
  try {
    await new Promise<void>((resolve) => {
      const req = http.request(
        `http://127.0.0.1:1984/api/streams?src=${encodeURIComponent(streamName)}`,
        { method: 'DELETE', timeout: 2500 },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on('error', () => resolve());
      req.on('timeout', () => {
        req.destroy();
        resolve();
      });
      req.end();
    });
  } catch (err: any) {
    console.warn('[PlaybackService] go2rtc DELETE stream error:', err?.message);
  }
}

/**
 * Creates / registers a dynamic playback RTSP stream in go2rtc for the specified time window.
 */
export async function startPlaybackStream(
  cameraIp: string,
  startTimeIso: string,
  endTimeIso?: string
): Promise<{
  success: boolean;
  streamName: string;
  rtspUrl: string;
  streamWsUrl: string;
  streamMp4Url: string;
  error?: string;
}> {
  const info = getCameraPlaybackInfo(cameraIp);
  if (!info.supported || !info.recorderIp || !info.nvrTrackId) {
    return {
      success: false,
      streamName: '',
      rtspUrl: '',
      streamWsUrl: '',
      streamMp4Url: '',
      error: info.error || 'NVR nije podržan'
    };
  }

  const pass = info.credProfile === 2 ? PASS_2 : PASS_1;
  const startHik = formatHikvisionTime(startTimeIso);

  // Ensure at least a 2-hour window so short motion segments don't cut off abruptly
  const minEndEpoch = new Date(startTimeIso).getTime() + 2 * 3600 * 1000;
  const passedEndEpoch = endTimeIso ? new Date(endTimeIso).getTime() : 0;
  const dEnd = new Date(Math.max(minEndEpoch, passedEndEpoch));
  const endHik = formatHikvisionTime(dEnd);

  let channelId = info.nvrTrackId || (info.nvrChannel ? `${info.nvrChannel}01` : '101');
  if (!channelId.endsWith('01')) {
    channelId = `${channelId}01`;
  }

  // Hikvision requires /Streaming/tracks/ for playback archive (Streaming/Channels is live stream only!)
  const rtspUrl = `rtsp://admin:${encodeURIComponent(pass)}@${info.recorderIp}:554/Streaming/tracks/${channelId}?starttime=${startHik}&endtime=${endHik}`;

  // Unique stream identifier per camera so multiple tabs don't collide
  const safeIp = cameraIp.replace(/\./g, '_');
  const streamName = `playback_${safeIp}`;

  // 1. First teardown any existing playback session on NVR for this camera to avoid 453 Not Enough Bandwidth
  await stopPlaybackStream(cameraIp);
  // Short pause to allow NVR socket to finalize TEARDOWN
  await new Promise((r) => setTimeout(r, 150));

  // 2. Register new playback stream in go2rtc via PUT /api/streams
  const putUrl = `http://127.0.0.1:1984/api/streams?name=${encodeURIComponent(streamName)}&src=${encodeURIComponent(rtspUrl)}`;

  try {
    await new Promise<void>((resolve, reject) => {
      const req = http.request(putUrl, { method: 'PUT', timeout: 3000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        resolve();
      });
      req.end();
    });
  } catch (err: any) {
    console.warn('[PlaybackService] go2rtc PUT stream error:', err?.message);
  }

  return {
    success: true,
    streamName,
    rtspUrl,
    streamWsUrl: `/api/video-gateway/ws?src=${encodeURIComponent(streamName)}`,
    streamMp4Url: `/api/video-gateway/stream.mp4?src=${encodeURIComponent(streamName)}`
  };
}

/**
 * Registers a dedicated temporary clip export stream in go2rtc for the specified time span.
 */
export async function createClipExportStream(
  cameraIp: string,
  startTimeIso: string,
  endTimeIso: string
): Promise<{
  success: boolean;
  streamName: string;
  error?: string;
  filename: string;
}> {
  const info = getCameraPlaybackInfo(cameraIp);
  if (!info.supported || !info.recorderIp || !info.nvrTrackId) {
    return {
      success: false,
      streamName: '',
      filename: '',
      error: info.error || 'NVR nije podržan'
    };
  }

  const pass = info.credProfile === 2 ? PASS_2 : PASS_1;
  const startHik = formatHikvisionTime(startTimeIso);
  const endHik = formatHikvisionTime(endTimeIso);

  let channelId = info.nvrTrackId || (info.nvrChannel ? `${info.nvrChannel}01` : '101');
  if (!channelId.endsWith('01')) {
    channelId = `${channelId}01`;
  }

  const rtspUrl = `rtsp://admin:${encodeURIComponent(pass)}@${info.recorderIp}:554/Streaming/tracks/${channelId}?starttime=${startHik}&endtime=${endHik}`;

  const safeIp = cameraIp.replace(/\./g, '_');
  const streamName = `export_${safeIp}_${Date.now()}`;

  // Register export stream in go2rtc via PUT /api/streams
  const putUrl = `http://127.0.0.1:1984/api/streams?name=${encodeURIComponent(streamName)}&src=${encodeURIComponent(rtspUrl)}`;

  try {
    await new Promise<void>((resolve, reject) => {
      const req = http.request(putUrl, { method: 'PUT', timeout: 3000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        resolve();
      });
      req.end();
    });
  } catch (err: any) {
    return {
      success: false,
      streamName: '',
      filename: '',
      error: `Greška pri registraciji strima: ${err.message}`
    };
  }

  const sDate = startTimeIso.slice(0, 10);
  const sFrom = startTimeIso.slice(11, 19).replace(/:/g, '-');
  const sTo = endTimeIso.slice(11, 19).replace(/:/g, '-');
  const safeName = (info.cameraName || 'Kamera').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `UNIPROMET_${safeName}_${sDate}_${sFrom}_do_${sTo}.mp4`;

  return {
    success: true,
    streamName,
    filename
  };
}

/**
 * Removes a clip export stream from go2rtc.
 */
export async function deleteClipExportStream(streamName: string): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const req = http.request(
        `http://127.0.0.1:1984/api/streams?src=${encodeURIComponent(streamName)}`,
        { method: 'DELETE', timeout: 2500 },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on('error', () => resolve());
      req.on('timeout', () => {
        req.destroy();
        resolve();
      });
      req.end();
    });
  } catch {}
}

/**
 * Auto-discovers and syncs all camera channel mappings across all 15 NVRs.
 */
export async function syncAllNvrChannels(): Promise<{ totalNvr: number; totalMapped: number }> {
  const db = getDb();
  const nvrs = db.prepare('SELECT id, name, ip, http_port, cred_profile FROM recorders').all() as any[];

  let totalMapped = 0;

  for (const nvr of nvrs) {
    const pass = nvr.cred_profile === 2 ? PASS_2 : PASS_1;
    const res = await nvrDigestRequest(
      nvr.ip,
      nvr.http_port || 80,
      '/ISAPI/ContentMgmt/InputProxy/channels',
      'admin',
      pass,
      'GET',
      '',
      3000
    );

    if (res.status === 200 && res.body) {
      const matches = [...res.body.matchAll(/<id>(\d+)<\/id>[\s\S]*?<ipAddress>([^<]+)<\/ipAddress>/g)];
      const updateStmt = db.prepare(`
        UPDATE cameras 
        SET recorder = ?, recorder_id = ?, nvr_channel = ?, nvr_track_id = ?, updated_at = ?
        WHERE ip = ?
      `);

      for (const m of matches) {
        const channelNum = parseInt(m[1], 10);
        const camIp = m[2].trim();
        const trackId = `${channelNum}01`;

        const info = updateStmt.run(nvr.name, nvr.id, channelNum, trackId, new Date().toISOString(), camIp);
        if (info.changes > 0) totalMapped++;
      }
    }
  }

  return { totalNvr: nvrs.length, totalMapped };
}
