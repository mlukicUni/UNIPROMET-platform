import net from 'net';
import http from 'http';
import { parseAnalogIp, getRecorderEndpointByIp } from './analogChannels';

/**
 * ==========================================================================
 * PROVERA DA LI KAMERA STVARNO ODGOVARA
 * Kamera je živa samo ako pošalje odgovor aplikacije: bilo kakav HTTP odgovor
 * na portu 80 ili RTSP odgovor na portu 554. Samo otvorena TCP veza nije dovoljna,
 * jer je nešto na putu (npr. Sophos) može prihvatiti i za ugašenu kameru.
 * Ne šalje se lozinka, pa nema rizika od zaključavanja kamere.
 * ==========================================================================
 */

/** Bilo kakav HTTP odgovor (i 401/404) znači da uređaj radi */
export function httpAnswers(host: string, port = 80, timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    const req = http.request({ host, port, path: '/', method: 'GET', timeout: timeoutMs, agent: false, headers: { Connection: 'close' } }, res => {
      finish(true);
      res.resume();
      req.destroy();
    });
    req.on('timeout', () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
    req.end();
  });
}

/** RTSP OPTIONS bez lozinke: kamera odgovara linijom "RTSP/1.0 ..." */
export function rtspAnswers(host: string, port = 554, timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    const socket = new net.Socket();
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { /* ignorisano */ }
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.write(`OPTIONS rtsp://${host}:${port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: UNIPROMET-Admin\r\n\r\n`);
    });
    socket.once('data', (buf: Buffer) => finish(buf.toString('latin1', 0, 8).startsWith('RTSP/')));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

/** Jedan pokušaj: prvo HTTP, pa RTSP */
async function answersOnce(host: string, httpPort: number, timeoutMs: number): Promise<boolean> {
  if (await httpAnswers(host, httpPort, timeoutMs)) return true;
  return rtspAnswers(host, 554, timeoutMs);
}

/**
 * Da li kamera (ili snimač analognog kanala) odgovara. Kada ne odgovori, posle kratke pauze
 * proverava se još jednom sa dužim čekanjem, da jedan izgubljen paket ne proglasi kameru offline.
 * Kraljevo (125.x) ide preko WAN-a, pa ima duže čekanje.
 */
export async function cameraAnswers(ip: string): Promise<boolean> {
  const analog = parseAnalogIp(ip);
  const host = analog ? analog.recorderIp : ip.trim();
  const httpPort = analog ? (getRecorderEndpointByIp(analog.recorderIp)?.httpPort || 80) : 80;
  const wan = host.includes('.125.');
  if (await answersOnce(host, httpPort, wan ? 2000 : 1200)) return true;
  await new Promise(r => setTimeout(r, 700));
  return answersOnce(host, httpPort, wan ? 3500 : 2500);
}
