import tls from 'tls';
import fs from 'fs';
import path from 'path';

// Types
export interface ArubaAp {
  id: string;
  name: string;
  ip: string;
  mode: string;
  type: string;
  model: string;
  isOutdoor: boolean;
  serial: string;
  zone: string;
  clientsCount: number;
  radio0Channel: string;
  radio0Power: string;
  radio0Util: string;
  radio0Noise: string;
  radio1Channel: string;
  radio1Power: string;
  radio1Util: string;
  radio1Noise: string;
  uplinkPort: string;
  hierarchy: 'conductor' | 'member';
  status: 'online' | 'offline';
  lastSeen: string;
  updatedAt: string;
}

export interface ArubaClient {
  name: string;
  ip: string;
  mac: string;
  os: string;
  essid: string;
  apName: string;
  channel: string;
  type: string;
  role: string;
  signal: string;
  speed: string;
}

export interface ArubaClusterSummary {
  name: string;
  vcIp: string;
  domain: string;
  conductorIp?: string;
  totalAps: number;
  totalClients: number;
  lastSync: string;
}

// Configuration
const CONTROLLER_HOST = process.env.ARUBA_HOST || '212.69.21.140';
const CONTROLLER_PORT = parseInt(process.env.ARUBA_PORT || '4443', 10);
const CONTROLLER_USER = process.env.ARUBA_USER || 'admin';

function getArubaPassword(): string {
  if (process.env.ARUBA_PASS) {
    return process.env.ARUBA_PASS;
  }
  // Fallback to reading .env directly if process.env wasn't loaded yet
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/ARUBA_PASS=(.*)/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  } catch (err) {
    console.warn('[ArubaService] Could not read .env for password:', err);
  }
  return '';
}

// Session state
let activeSid: string | null = null;
let sidExpiresAt = 0;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Raw TLS request to handle Aruba Instant controller responses.
 * Aruba sends non-standard header endings (\n instead of \r\n), which causes
 * strict Node.js http parsers to fail. Using raw TLS avoids this issue.
 */
function rawTlsRequest(
  method: 'GET' | 'POST',
  requestPath: string,
  body: string = '',
  headers: Record<string, string> = {},
  timeoutMs: number = 10000
): Promise<{ headers: string; body: string }> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;

    const socket = tls.connect(
      {
        host: CONTROLLER_HOST,
        port: CONTROLLER_PORT,
        rejectUnauthorized: false
      },
      () => {
        let req = `${method} ${requestPath} HTTP/1.1\r\n`;
        req += `Host: ${CONTROLLER_HOST}:${CONTROLLER_PORT}\r\n`;
        req += `Connection: close\r\n`;
        req += `User-Agent: UniprometAdminPanel/1.0\r\n`;

        for (const [k, v] of Object.entries(headers)) {
          req += `${k}: ${v}\r\n`;
        }

        if (body) {
          req += `Content-Length: ${Buffer.byteLength(body)}\r\n`;
          req += `\r\n${body}`;
        } else {
          req += `\r\n`;
        }

        socket.write(req);
      }
    );

    timer = setTimeout(() => {
      socket.destroy(new Error(`Timeout connecting to Aruba controller at ${CONTROLLER_HOST}:${CONTROLLER_PORT}`));
    }, timeoutMs);

    const chunks: Buffer[] = [];

    socket.on('data', chunk => {
      chunks.push(chunk);
    });

    socket.on('end', () => {
      if (timer) clearTimeout(timer);
      const full = Buffer.concat(chunks).toString('utf-8');

      // Aruba controller uses either \r\n\r\n or \n\n to end headers
      let splitIdx = full.indexOf('\r\n\r\n');
      let sepLength = 4;
      if (splitIdx === -1) {
        splitIdx = full.indexOf('\n\n');
        sepLength = 2;
      }

      if (splitIdx === -1) {
        return resolve({ headers: '', body: full });
      }

      const headersStr = full.slice(0, splitIdx);
      const bodyStr = full.slice(splitIdx + sepLength);
      resolve({ headers: headersStr, body: bodyStr });
    });

    socket.on('error', err => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Authenticate with Aruba Virtual Controller and retrieve a valid session ID (sid).
 */
export async function loginToAruba(): Promise<string> {
  const password = getArubaPassword();
  if (!password) {
    throw new Error('ARUBA_PASS nije definisana u .env fajlu!');
  }

  const loginBody = `opcode=login&user=${encodeURIComponent(CONTROLLER_USER)}&passwd=${encodeURIComponent(password)}`;
  const res = await rawTlsRequest('POST', '/swarm.cgi', loginBody, {
    'Content-Type': 'application/x-www-form-urlencoded'
  });

  const sidMatch = res.body.match(/<data name="sid"[^>]*>([^<]+)<\/data>/);
  if (!sidMatch || !sidMatch[1]) {
    throw new Error(`Neuspešna prijava na Aruba kontroler: ${res.body.slice(0, 300)}`);
  }

  activeSid = sidMatch[1].trim();
  sidExpiresAt = Date.now() + SESSION_TTL_MS;
  return activeSid;
}

/**
 * Ensures an active session, executing the query with auto-retry on expired session.
 */
async function executeSwarmCommand(cmd: string): Promise<string> {
  if (!activeSid || Date.now() >= sidExpiresAt) {
    await loginToAruba();
  }

  const path = `/swarm.cgi?opcode=show&cmd=${encodeURIComponent(cmd)}&sid=${activeSid}`;
  let res = await rawTlsRequest('GET', path, '', {
    'Cookie': `sid=${activeSid}`
  });

  // Check if session expired or rejected
  if (res.body.includes('<error') || res.body.includes('Session timeout') || res.body.includes('Invalid session')) {
    console.warn('[ArubaService] Sesija istekla ili nevažeća, ponavljam prijavu...');
    await loginToAruba();
    const retryPath = `/swarm.cgi?opcode=show&cmd=${encodeURIComponent(cmd)}&sid=${activeSid}`;
    res = await rawTlsRequest('GET', retryPath, '', {
      'Cookie': `sid=${activeSid}`
    });
  }

  return res.body;
}

/**
 * Helper to parse Aruba tabular XML output into array of key-value objects.
 * Format: <t tn="..."><th><h>Col1</h><h>Col2</h></th><r><c>Val1</c><c>Val2</c></r></t>
 */
export function parseArubaTable(xml: string): Record<string, string>[] {
  const tableMatch = xml.match(/<t[^>]*>([\s\S]*?)<\/t>/);
  if (!tableMatch) return [];
  const content = tableMatch[1];

  const headerMatch = content.match(/<th>([\s\S]*?)<\/th>/);
  if (!headerMatch) return [];
  const headers: string[] = [];
  const hRegex = /<h>([\s\S]*?)<\/h>/g;
  let hMatch;
  while ((hMatch = hRegex.exec(headerMatch[1])) !== null) {
    headers.push(hMatch[1].trim());
  }

  const rows: Record<string, string>[] = [];
  const rRegex = /<r>([\s\S]*?)<\/r>/g;
  let rMatch;
  while ((rMatch = rRegex.exec(content)) !== null) {
    const rowContent = rMatch[1];
    const cRegex = /<c>([\s\S]*?)<\/c>/g;
    let cMatch;
    const rowObj: Record<string, string> = {};
    let colIdx = 0;
    while ((cMatch = cRegex.exec(rowContent)) !== null) {
      const colName = headers[colIdx] || `col_${colIdx}`;
      rowObj[colName] = cMatch[1].trim();
      colIdx++;
    }
    rows.push(rowObj);
  }
  return rows;
}

/**
 * Fetch all 34 Access Points from the Aruba Virtual Controller.
 */
export async function fetchArubaAps(): Promise<ArubaAp[]> {
  const xml = await executeSwarmCommand('show aps');
  const rows = parseArubaTable(xml);
  const now = new Date().toISOString();

  return rows.map((r, idx) => {
    const rawType = r['Type'] || '';
    const isOutdoor = rawType.toLowerCase().includes('outdoor') || rawType.includes('565');
    const model = rawType.includes('505')
      ? (isOutdoor ? 'AP-505 (Outdoor)' : 'AP-505 (Indoor)')
      : rawType.includes('565')
      ? 'AP-565 (Outdoor)'
      : rawType || 'Aruba AP';

    const hierarchy = (r['Hierarchy Mode'] || '').toLowerCase() === 'conductor' ? 'conductor' : 'member';
    const id = `ap-${(r['IP Address'] || '').replace(/\./g, '-') || idx + 1}`;

    return {
      id,
      name: r['Name'] || `AP-${r['IP Address']}`,
      ip: r['IP Address'] || '',
      mode: r['Mode'] || 'access',
      type: rawType,
      model,
      isOutdoor,
      serial: r['Serial #'] || '',
      zone: r['Zone'] === '-' ? '' : r['Zone'] || '',
      clientsCount: parseInt(r['Clients'] || '0', 10) || 0,
      radio0Channel: r['radio0 Channel'] || '',
      radio0Power: r['radio0 Power (dBm)'] ? `${r['radio0 Power (dBm)']} dBm` : '',
      radio0Util: r['radio0 Utilization (%)'] || '',
      radio0Noise: r['radio0 Noise Floor (dBm)'] ? `${r['radio0 Noise Floor (dBm)']} dBm` : '',
      radio1Channel: r['radio1 Channel'] || '',
      radio1Power: r['radio1 Power (dBm)'] ? `${r['radio1 Power (dBm)']} dBm` : '',
      radio1Util: r['radio1 Utilization (%)'] || '',
      radio1Noise: r['radio1 Noise Floor (dBm)'] ? `${r['radio1 Noise Floor (dBm)']} dBm` : '',
      uplinkPort: r['Uplink Port'] || 'eth0',
      hierarchy,
      status: 'online',
      lastSeen: now,
      updatedAt: now
    };
  });
}

/**
 * Fetch all connected wireless clients from the Aruba Virtual Controller.
 */
export async function fetchArubaClients(): Promise<ArubaClient[]> {
  const xml = await executeSwarmCommand('show clients');
  const rows = parseArubaTable(xml);

  return rows.map(r => ({
    name: r['Name'] || '',
    ip: r['IP Address'] || '',
    mac: r['MAC Address'] || '',
    os: r['OS'] || 'Unknown',
    essid: r['ESSID'] || '',
    apName: r['Access Point'] || '',
    channel: r['Channel'] || '',
    type: r['Type'] || '',
    role: r['Role'] || '',
    signal: r['Signal'] || '',
    speed: r['Speed (mbps)'] || ''
  }));
}

/**
 * Fetch cluster summary from the Aruba Virtual Controller.
 */
export async function fetchArubaSummary(): Promise<ArubaClusterSummary> {
  const xml = await executeSwarmCommand('show summary');
  const now = new Date().toISOString();

  const nameMatch = xml.match(/<data name="Name\s*"[^>]*>([^<]+)<\/data>/);
  const vcIpMatch = xml.match(/<data name="VC IP Address\s*"[^>]*>([^<]+)<\/data>/);
  const domainMatch = xml.match(/<data name="Domain\s*"[^>]*>([^<]+)<\/data>/);

  return {
    name: (nameMatch ? nameMatch[1] : 'Uni Promet').replace(/&#32;/g, ' ').trim(),
    vcIp: vcIpMatch ? vcIpMatch[1].trim() : '192.168.6.200',
    domain: domainMatch ? domainMatch[1].trim() : 'CA',
    totalAps: 0,
    totalClients: 0,
    lastSync: now
  };
}
