/**
 * Analogni kanali na hibridnim snimačima (Hikvision DVR).
 *
 * Analogna kamera nema svoju IP adresu, pa se u evidenciji kamera vodi pod oznakom
 * "<IP snimača>~ch<kanal>" (npr. 192.168.124.238~ch1). Živi tok i slika se uzimaju
 * sa samog snimača: rtsp://<snimač>:554/Streaming/Channels/<kanal>01 (glavni) ili
 * <kanal>02 (pomoćni), a lozinka je lozinka snimača.
 */
import http from 'http';
import crypto from 'crypto';
import { getDb } from '../db/sqlite';
import { initSchema } from '../db/schema';
import { addCameraInventoryItem, CameraInventoryItem } from '../db/cameraInventoryDb';

const ANALOG_IP_RE = /^(\d{1,3}(?:\.\d{1,3}){3})~ch(\d{1,3})$/;
const MAX_ANALOG_CHANNELS = 64;

export interface AnalogRef {
  recorderIp: string;
  channel: number;
}

export function parseAnalogIp(ip: string | undefined | null): AnalogRef | null {
  const m = ANALOG_IP_RE.exec(String(ip || '').trim());
  if (!m) return null;
  const channel = parseInt(m[2], 10);
  if (channel < 1 || channel > MAX_ANALOG_CHANNELS) return null;
  return { recorderIp: m[1], channel };
}

export function makeAnalogIp(recorderIp: string, channel: number): string {
  return `${recorderIp}~ch${channel}`;
}

/** Putanja RTSP toka kanala na snimaču: glavni = <kanal>01, pomoćni = <kanal>02 */
export function analogRtspPath(channel: number, quality: 'main' | 'sub'): string {
  return `/Streaming/Channels/${channel}0${quality === 'main' ? 1 : 2}`;
}

export function analogSnapshotPath(channel: number, quality: 'main' | 'sub'): string {
  return `/ISAPI/Streaming/channels/${channel}0${quality === 'main' ? 1 : 2}/picture`;
}

export interface RecorderEndpoint {
  id: string;
  name: string;
  ip: string;
  httpPort: number;
  rtspPort: number;
  credProfile: number;
}

interface RecorderEndpointRow {
  id: string;
  name: string;
  ip: string;
  http_port: number | null;
  rtsp_port: number | null;
  cred_profile: number | null;
}

function toEndpoint(row: RecorderEndpointRow | undefined): RecorderEndpoint | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    ip: row.ip,
    httpPort: row.http_port || 80,
    rtspPort: row.rtsp_port || 554,
    credProfile: row.cred_profile === 2 ? 2 : 1
  };
}

export function getRecorderEndpointByIp(ip: string): RecorderEndpoint | undefined {
  initSchema();
  return toEndpoint(
    getDb().prepare('SELECT id, name, ip, http_port, rtsp_port, cred_profile FROM recorders WHERE ip = ? ORDER BY id ASC LIMIT 1')
      .get(ip.trim()) as RecorderEndpointRow | undefined
  );
}

export function getRecorderEndpointById(id: string): RecorderEndpoint | undefined {
  initSchema();
  return toEndpoint(
    getDb().prepare('SELECT id, name, ip, http_port, rtsp_port, cred_profile FROM recorders WHERE id = ?')
      .get(id) as RecorderEndpointRow | undefined
  );
}

export function recorderCredentials(credProfile: number): { user: string; pass: string } {
  const user = process.env.CAMERA_USER || 'admin';
  const pass1 = process.env.CAMERA_PASS_1 || process.env.CAMERA_PASS || '';
  const pass2 = process.env.CAMERA_PASS_2 || '';
  return { user, pass: credProfile === 2 ? pass2 : pass1 };
}

/* ---------------------------------------------------------------------------
   ISAPI upit na snimač (samo čitanje), jedan pokušaj, Digest ili Basic
   --------------------------------------------------------------------------- */
function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}

function rawGet(
  host: string,
  port: number,
  path: string,
  authorization: string | null,
  timeoutMs: number
): Promise<{ status: number; www: string; body: Buffer }> {
  return new Promise(resolve => {
    const req = http.request(
      {
        host,
        port,
        path,
        method: 'GET',
        timeout: timeoutMs,
        headers: { Connection: 'close', 'User-Agent': 'UniprometAdminCCTV/2.0', ...(authorization ? { Authorization: authorization } : {}) }
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode || 0, www: String(res.headers['www-authenticate'] || ''), body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', () => resolve({ status: 0, www: '', body: Buffer.alloc(0) }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, www: '', body: Buffer.alloc(0) });
    });
    req.end();
  });
}

export async function isapiGet(
  ep: RecorderEndpoint,
  path: string,
  timeoutMs = 8000
): Promise<{ status: number; body: Buffer }> {
  const { user, pass } = recorderCredentials(ep.credProfile);
  const first = await rawGet(ep.ip, ep.httpPort, path, null, timeoutMs);
  if (first.status !== 401) return { status: first.status, body: first.body };

  if (/digest/i.test(first.www)) {
    const realm = /realm="([^"]*)"/.exec(first.www)?.[1];
    const nonce = /nonce="([^"]*)"/.exec(first.www)?.[1];
    const qop = /qop="?([^",]*)/.exec(first.www)?.[1];
    if (!realm || !nonce) return { status: 401, body: Buffer.alloc(0) };
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = md5(`${user}:${realm}:${pass}`);
    const ha2 = md5(`GET:${path}`);
    const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
    const header =
      `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${path}", ` +
      (qop ? `qop=auth, nc=${nc}, cnonce="${cnonce}", ` : '') +
      `response="${response}"`;
    const second = await rawGet(ep.ip, ep.httpPort, path, header, timeoutMs);
    return { status: second.status, body: second.body };
  }

  const basic = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  const second = await rawGet(ep.ip, ep.httpPort, path, basic, timeoutMs);
  return { status: second.status, body: second.body };
}

/* ---------------------------------------------------------------------------
   Otkrivanje analognih kanala
   --------------------------------------------------------------------------- */
export interface AnalogChannelInfo {
  channel: number;
  /** Naziv kanala podešen na samom snimaču (npr. "CI-magacin" ili podrazumevano "Camera 06") */
  dvrName: string;
  /** Snimač vraća sliku sa kanala (kamera je priključena i daje signal) */
  hasSignal: boolean;
  /** Kanal je već u evidenciji kamera */
  existingCameraId?: string;
  existingCameraName?: string;
}

export interface AnalogDiscoveryResult {
  supported: boolean;
  recorder: { id: string; name: string; ip: string };
  channels: AnalogChannelInfo[];
  note?: string;
}

function isJpeg(buf: Buffer): boolean {
  return buf.length > 1000 && buf[0] === 0xff && buf[1] === 0xd8;
}

function parseVideoInputs(xml: string): { channel: number; name: string }[] {
  const out: { channel: number; name: string }[] = [];
  for (const m of xml.matchAll(/<VideoInputChannel\b[\s\S]*?<\/VideoInputChannel>/g)) {
    const id = /<id>(\d+)<\/id>/.exec(m[0]);
    if (!id) continue;
    const name = /<name>([^<]*)<\/name>/.exec(m[0]);
    const channel = parseInt(id[1], 10);
    if (channel >= 1 && channel <= MAX_ANALOG_CHANNELS) out.push({ channel, name: (name?.[1] || '').trim() });
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Čita sa snimača listu video ulaza (analognih kanala) i za svaki proverava da li daje sliku.
 * Samo čitanje; jedan upit po kanalu, sa kratkom pauzom između upita.
 */
export async function discoverAnalogChannels(recorderId: string): Promise<AnalogDiscoveryResult | null> {
  const ep = getRecorderEndpointById(recorderId);
  if (!ep) return null;
  const recorder = { id: ep.id, name: ep.name, ip: ep.ip };

  const list = await isapiGet(ep, '/ISAPI/System/Video/inputs/channels');
  if (list.status === 0) {
    return { supported: false, recorder, channels: [], note: 'Snimač ne odgovara na mreži.' };
  }
  if (list.status !== 200) {
    return { supported: false, recorder, channels: [], note: 'Ovaj snimač nema analogne kanale (samo IP kamere) ili ne dozvoljava čitanje.' };
  }
  const inputs = parseVideoInputs(list.body.toString('utf8'));
  if (inputs.length === 0) {
    return { supported: false, recorder, channels: [], note: 'Snimač nema analogne kanale.' };
  }

  const existing = getDb()
    .prepare('SELECT id, name, position, nvr_channel FROM cameras WHERE recorder_id = ? AND nvr_channel IS NOT NULL')
    .all(ep.id) as { id: string; name: string; position: string | null; nvr_channel: number }[];
  const byChannel = new Map(existing.map(c => [c.nvr_channel, c]));

  const channels: AnalogChannelInfo[] = [];
  for (const input of inputs) {
    const pic = await isapiGet(ep, analogSnapshotPath(input.channel, 'sub'), 8000);
    const found = byChannel.get(input.channel);
    channels.push({
      channel: input.channel,
      dvrName: input.name,
      hasSignal: pic.status === 200 && isJpeg(pic.body),
      existingCameraId: found?.id,
      existingCameraName: found ? (found.position || found.name) : undefined
    });
    await sleep(250);
  }
  return { supported: true, recorder, channels };
}

/* ---------------------------------------------------------------------------
   Upis analognih kanala u evidenciju kamera
   --------------------------------------------------------------------------- */
export interface AnalogImportItem {
  channel: number;
  name: string;
  location?: string;
}

export interface AnalogImportResult {
  added: CameraInventoryItem[];
  skipped: { channel: number; reason: string }[];
}

export function importAnalogChannels(recorderId: string, items: AnalogImportItem[]): AnalogImportResult | null {
  const ep = getRecorderEndpointById(recorderId);
  if (!ep) return null;
  const db = getDb();
  const subnetPrefix = ep.ip.split('.').slice(0, 3).join('.');
  const added: CameraInventoryItem[] = [];
  const skipped: { channel: number; reason: string }[] = [];

  const run = db.transaction(() => {
    for (const item of items) {
      const channel = Number(item.channel);
      if (!Number.isInteger(channel) || channel < 1 || channel > MAX_ANALOG_CHANNELS) {
        skipped.push({ channel, reason: 'Neispravan broj kanala' });
        continue;
      }
      const ip = makeAnalogIp(ep.ip, channel);
      const taken = db
        .prepare('SELECT id FROM cameras WHERE ip = ? OR (recorder_id = ? AND nvr_channel = ?) LIMIT 1')
        .get(ip, ep.id, channel);
      if (taken) {
        skipped.push({ channel, reason: 'Kanal je već u evidenciji' });
        continue;
      }
      const name = (item.name || '').trim() || `${ep.name} - analog ${channel}`;
      const created = addCameraInventoryItem({
        ip,
        name,
        recorder: ep.name,
        location: (item.location || '').trim() || ep.name,
        position: name,
        type: 'Analogna',
        subnet: `${subnetPrefix}.x`,
        note: '',
        isReserved: false,
        credProfile: ep.credProfile
      });
      db.prepare('UPDATE cameras SET recorder_id = ?, nvr_channel = ?, nvr_track_id = ? WHERE id = ?')
        .run(ep.id, channel, `${channel}01`, created.id);
      added.push(created);
    }
  });
  run();
  return { added, skipped };
}
