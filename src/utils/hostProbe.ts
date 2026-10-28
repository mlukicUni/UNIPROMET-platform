import { spawn, execSync } from 'child_process';
import dgram from 'dgram';
import fs from 'fs';

/**
 * Zajedničke mrežne provere za Windows i Linux:
 * - ICMP ping jednog hosta (bez shell-a, argumenti idu direktno)
 * - ARP tabela (IP → MAC) iz operativnog sistema
 */

export interface PingResult {
  ok: boolean;
  latencyMs: number | null;
}

/** MAC u obliku aa:bb:cc:dd:ee:ff (mala slova). */
export function normalizeMac(mac: string): string {
  return mac.replace(/-/g, ':').toLowerCase();
}

/**
 * Jedan ICMP echo zahtev. Windows: ping.exe -n 1 -w <ms>. Linux: ping -c 1 -W <sekunde>.
 * Na Linuxu -W radi u celim sekundama, pa je najmanji rok 1 s.
 */
export function pingHost(ip: string, timeoutMs: number = 1000): Promise<PingResult> {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'ping.exe' : 'ping';
    const args = isWindows
      ? ['-n', '1', '-w', String(timeoutMs), ip]
      : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), ip];

    const t0 = performance.now();
    let stdout = '';
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', () => resolve({ ok: false, latencyMs: null }));
    child.on('close', (code) => {
      const replied = code === 0 && /ttl=|time[=<]|vreme[=<]|bytes from|bajtova/i.test(stdout);
      if (!replied) return resolve({ ok: false, latencyMs: null });
      const parsed = stdout.match(/(?:time|vreme)[=<]\s*([0-9.]+)\s*ms/i);
      const latencyMs = parsed
        ? Math.max(1, Math.round(parseFloat(parsed[1])))
        : Math.max(1, Math.round(performance.now() - t0));
      resolve({ ok: true, latencyMs });
    });
  });
}

export interface NetbiosName {
  name: string;
  suffix: string;
  group: boolean;
}

/**
 * NetBIOS node status (UDP 137), isti podaci koje ispisuje `nbtstat -A`.
 * Čist Node, bez spoljnih alata, pa radi i na Windows-u i na Linuxu.
 */
export function netbiosNodeStatus(ip: string, timeoutMs: number = 700): Promise<NetbiosName[] | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const finish = (value: NetbiosName[] | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.close(); } catch { /* već zatvoren */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    // NBSTAT upit za "*" (wildcard), sa enkodovanim imenom po NetBIOS pravilu
    const query = Buffer.alloc(50);
    query.writeUInt16BE(0x1234, 0);   // transaction id
    query.writeUInt16BE(0x0000, 2);   // flags: standardni upit
    query.writeUInt16BE(1, 4);        // qdcount
    query[12] = 32;
    query.write('CK' + 'AA'.repeat(15), 13, 'ascii');
    query[45] = 0;
    query.writeUInt16BE(0x0021, 46);  // type NBSTAT
    query.writeUInt16BE(0x0001, 48);  // class IN

    sock.on('message', (msg) => {
      try {
        const qdcount = msg.readUInt16BE(4);
        const ancount = msg.readUInt16BE(6);
        if (ancount < 1) return finish(null);
        let off = 12;
        for (let i = 0; i < qdcount; i++) {
          while (msg[off] !== 0) off += msg[off] + 1;
          off += 1 + 4;
        }
        while (msg[off] !== 0) off += msg[off] + 1; // ime odgovora
        off += 1 + 2 + 2 + 4;                      // terminator, type, class, ttl
        off += 2;                                  // rdlength
        const count = msg[off];
        off += 1;
        const names: NetbiosName[] = [];
        for (let i = 0; i < count; i++) {
          names.push({
            name: msg.toString('ascii', off, off + 15).trim(),
            suffix: msg[off + 15].toString(16).padStart(2, '0'),
            group: (msg.readUInt16BE(off + 16) & 0x8000) !== 0
          });
          off += 18;
        }
        finish(names);
      } catch {
        finish(null);
      }
    });
    sock.on('error', () => finish(null));
    sock.send(query, 137, ip, (err) => { if (err) finish(null); });
  });
}

/**
 * ARP keš: IP → MAC. Linux čita /proc/net/arp (ne treba arp program).
 * Windows parsira izlaz `arp -a`. Nepotpuni unosi se preskaču.
 */
export function readArpTable(): Map<string, string> {
  const table = new Map<string, string>();
  try {
    if (process.platform === 'win32') {
      const out = execSync('arp -a', { encoding: 'utf8', timeout: 2000 });
      for (const line of out.split(/\r?\n/)) {
        const m = line.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})\s+\S+/);
        if (m) table.set(m[1], normalizeMac(m[2]));
      }
    } else if (fs.existsSync('/proc/net/arp')) {
      const lines = fs.readFileSync('/proc/net/arp', 'utf8').split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        const [ip, , flags, mac] = parts;
        if (flags === '0x0' || mac === '00:00:00:00:00:00') continue;
        table.set(ip, normalizeMac(mac));
      }
    }
  } catch {
    // ARP nije dostupan (npr. nema alata) - vraća se prazna tabela
  }
  return table;
}
