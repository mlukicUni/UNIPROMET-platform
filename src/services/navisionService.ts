import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';
import { matchesSearch } from '../utils/searchMatch';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const NAV_HOST = process.env.NAV_DB_HOST || '192.168.121.18';
const NAV_DB = process.env.NAV_DB_NAME || 'unipromet_nav2016';
const NAV_USER = process.env.DB_121_20_USER || 'itservices';
const NAV_PASS = process.env.DB_121_20_PASS || ''; // lozinka samo iz .env

export interface NavEmployee {
  employee_no: string;
  first_name: string;
  last_name: string;
  full_name: string;
  hr_status: 'Aktivan' | 'Neaktivan' | 'Napustio preduzeće';
  job_title: string;
  department: string;
  company: 'Unipromet' | 'Noleko';
}

export interface NavPhoneEmployee extends NavEmployee {
  sl_type: string;
  matched_phone: string;
}

const sqlConfig: sql.config = {
  server: NAV_HOST,
  database: NAV_DB,
  user: NAV_USER,
  password: NAV_PASS,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 5000,
    requestTimeout: 10000
  },
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let pool: sql.ConnectionPool | null = null;
let isConnecting = false;

// Cache: employee_no -> { data, cachedAt }
const employeeCache = new Map<string, { data: NavEmployee; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let phoneEmployeesCache: { data: any[]; cachedAt: number; index: Map<string, any> } | null = null;
let phoneRefillPromise: Promise<void> | null = null; // single-flight punjenja phoneEmployeesCache

// Kratak kes rezultata searchEmployees (kljuc: limit + tacan izraz) sa single-flight-om
const SEARCH_CACHE_TTL_MS = 45 * 1000;
const SEARCH_CACHE_MAX = 200;
const searchCache = new Map<string, { data: NavEmployee[]; cachedAt: number }>();
const searchInflight = new Map<string, Promise<{ rows: NavEmployee[]; cacheable: boolean }>>();

function cloneEmployees(list: NavEmployee[]): NavEmployee[] {
  return list.map(e => ({ ...e }));
}

// Circuit breaker: posle neuspele konekcije 30 s ne pokusavamo ponovo (getPool odmah vraca null, kao i ranije pri neuspehu)
const CONNECT_RETRY_COOLDOWN_MS = 30 * 1000;
let lastConnectFailureAt = 0;

function connectBreakerOpen(): boolean {
  return lastConnectFailureAt > 0 && Date.now() - lastConnectFailureAt < CONNECT_RETRY_COOLDOWN_MS;
}

async function getPool(): Promise<sql.ConnectionPool | null> {
  if (pool && pool.connected) {
    return pool;
  }
  if (connectBreakerOpen()) return null;
  if (isConnecting) {
    // Wait for active attempt
    let waited = 0;
    while (isConnecting && waited < 4000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    if (pool && pool.connected) return pool;
    if (connectBreakerOpen()) return null;
  }

  try {
    isConnecting = true;
    pool = new sql.ConnectionPool(sqlConfig);
    await pool.connect();
    pool.on('error', err => {
      console.warn('[NavisionService] Pool error:', err.message);
      pool = null;
    });
    lastConnectFailureAt = 0; // uspeh resetuje breaker
    return pool;
  } catch (err: any) {
    console.warn(`[NavisionService] Failed to connect to Navision DB (${NAV_HOST}):`, err.message);
    pool = null;
    lastConnectFailureAt = Date.now();
    return null;
  } finally {
    isConnecting = false;
  }
}

function cleanStr(val: any): string {
  if (!val) return '';
  return String(val).trim();
}

function mapRowToEmployee(row: any): NavEmployee {
  const fName = cleanStr(row.first_name);
  const lName = cleanStr(row.last_name);
  const empNo = cleanStr(row.employee_no);
  const fullName = `${fName} ${lName}`.trim() + (empNo ? ` (${empNo})` : '');

  return {
    employee_no: empNo,
    first_name: fName,
    last_name: lName,
    full_name: fullName,
    hr_status: row.hr_status || 'Aktivan',
    job_title: cleanStr(row.job_title),
    department: cleanStr(row.department),
    company: row.company === 'Noleko' ? 'Noleko' : 'Unipromet'
  };
}

/**
 * Zivi upit u Navision (bez kesa). cacheable=false za sve neuspele/offline ishode,
 * da se prazan rezultat zbog greske nikad ne zadrzi u kesu.
 */
async function searchEmployeesLive(trimmed: string, limit: number): Promise<{ rows: NavEmployee[]; cacheable: boolean }> {
  const activePool = await getPool();
  if (!activePool) {
    console.warn('[NavisionService] Offline mode: Navision DB unreachable');
    return { rows: [], cacheable: false };
  }

  try {
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return { rows: [], cacheable: false };

    const request = activePool.request();
    request.input('limit', sql.Int, limit);

    const conditions: string[] = [];
    tokens.forEach((tok, idx) => {
      const paramName = `t${idx}`;
      request.input(paramName, sql.NVarChar, `%${tok}%`);

      // If token contains 'dj', also check variant with 'd' or 'đ'
      if (/dj/i.test(tok)) {
        const djAlt = tok.replace(/dj/gi, 'd');
        const altParamName = `t_dj_${idx}`;
        request.input(altParamName, sql.NVarChar, `%${djAlt}%`);
        conditions.push(`(
          (RTRIM(e.[First Name]) + ' ' + RTRIM(e.[Last Name]) + ' ' + RTRIM(e.[No_])) COLLATE Latin1_General_CI_AI LIKE @${paramName}
          OR
          (RTRIM(e.[First Name]) + ' ' + RTRIM(e.[Last Name]) + ' ' + RTRIM(e.[No_])) COLLATE Latin1_General_CI_AI LIKE @${altParamName}
        )`);
      } else {
        conditions.push(`((RTRIM(e.[First Name]) + ' ' + RTRIM(e.[Last Name]) + ' ' + RTRIM(e.[No_])) COLLATE Latin1_General_CI_AI LIKE @${paramName})`);
      }
    });

    const whereClause = conditions.join(' AND ');

    const query = `
      SELECT TOP (@limit) * FROM (
        SELECT 
          e.[No_] AS employee_no,
          RTRIM(e.[First Name]) AS first_name,
          RTRIM(e.[Last Name]) AS last_name,
          CASE 
            WHEN e.[Status] = 1 THEN 'Neaktivan' 
            WHEN e.[Status] = 2 THEN 'Napustio preduzeće' 
            ELSE 'Aktivan' 
          END AS hr_status,
          e.[Status] AS raw_status,
          RTRIM(j.[Description]) AS job_title,
          RTRIM(o.[Description]) AS department,
          'Unipromet' AS company
        FROM dbo.[Unipromet d_o_o$HR Employee] e
        LEFT JOIN dbo.[Unipromet d_o_o$Position] p ON e.[No_] = p.[Employee No_] AND p.[Primary position] = 1
        LEFT JOIN dbo.[Unipromet d_o_o$Job Title] j ON p.[Job Title] = j.[Code]
        LEFT JOIN dbo.[Unipromet d_o_o$HR Organization] o ON j.[Organization] = o.[Code]
        WHERE ${whereClause}

        UNION ALL

        SELECT 
          e.[No_] AS employee_no,
          RTRIM(e.[First Name]) AS first_name,
          RTRIM(e.[Last Name]) AS last_name,
          CASE 
            WHEN e.[Status] = 1 THEN 'Neaktivan' 
            WHEN e.[Status] = 2 THEN 'Napustio preduzeće' 
            ELSE 'Aktivan' 
          END AS hr_status,
          e.[Status] AS raw_status,
          RTRIM(j.[Description]) AS job_title,
          RTRIM(o.[Description]) AS department,
          'Noleko' AS company
        FROM dbo.[Noleko$HR Employee] e
        LEFT JOIN dbo.[Noleko$Position] p ON e.[No_] = p.[Employee No_] AND p.[Primary position] = 1
        LEFT JOIN dbo.[Noleko$Job Title] j ON p.[Job Title] = j.[Code]
        LEFT JOIN dbo.[Noleko$HR Organization] o ON j.[Organization] = o.[Code]
        WHERE ${whereClause}
      ) combined
      ORDER BY combined.raw_status ASC, combined.last_name ASC;
    `;

    const result = await request.query(query);
    const employees = result.recordset.map(mapRowToEmployee);

    // Cache returned employees
    const now = Date.now();
    for (const emp of employees) {
      if (emp.employee_no) {
        employeeCache.set(emp.employee_no, { data: emp, cachedAt: now });
      }
    }

    return { rows: employees, cacheable: true };
  } catch (err: any) {
    console.warn('[NavisionService] Error during employee search:', err.message);
    return { rows: [], cacheable: false };
  }
}

/**
 * Gradi indeks cifara telefona. Pravilo je isto kao raniji find(): prvi red (po redosledu recordset-a)
 * ciji je bilo koji od sl1/sl2/sl3/priv_mob (samo ako je truthy) po ciframa jednak trazenom broju.
 */
function buildPhoneIndex(rows: any[]): Map<string, any> {
  const index = new Map<string, any>();
  for (const r of rows) {
    for (const field of [r.sl1, r.sl2, r.sl3, r.priv_mob]) {
      if (!field) continue;
      const digits = field.replace(/\D/g, '');
      if (!index.has(digits)) index.set(digits, r);
    }
  }
  return index;
}

/**
 * Osvezava phoneEmployeesCache ako je istekao/prazan. Istovremeni pozivaoci dele jedan upit.
 * Pri gresci ostaje stari kes (ako postoji), kao i ranije.
 */
async function ensurePhoneCache(now: number): Promise<void> {
  if (phoneEmployeesCache && now - phoneEmployeesCache.cachedAt <= CACHE_TTL_MS) return;
  if (!phoneRefillPromise) {
    phoneRefillPromise = refillPhoneCache(now).finally(() => {
      phoneRefillPromise = null;
    });
  }
  await phoneRefillPromise;
}

async function refillPhoneCache(now: number): Promise<void> {
  const activePool = await getPool();
  if (!activePool) return;
  try {
    const query = `
          SELECT 
            e.[No_] AS employee_no,
            RTRIM(e.[First Name]) AS first_name,
            RTRIM(e.[Last Name]) AS last_name,
            CASE 
              WHEN e.[Status] = 1 THEN 'Neaktivan' 
              WHEN e.[Status] = 2 THEN 'Napustio preduzeće' 
              ELSE 'Aktivan' 
            END AS hr_status,
            RTRIM(j.[Description]) AS job_title,
            RTRIM(o.[Description]) AS department,
            'Unipromet' AS company,
            RTRIM(e.[Company Mobile Phone No_]) AS sl1,
            RTRIM(e.[Company Mobile Phone No_ 2]) AS sl2,
            RTRIM(e.[Company Phone No_]) AS sl3,
            RTRIM(e.[Mobile Phone No_]) AS priv_mob
          FROM dbo.[Unipromet d_o_o$HR Employee] e
          LEFT JOIN dbo.[Unipromet d_o_o$Position] p ON e.[No_] = p.[Employee No_] AND p.[Primary position] = 1
          LEFT JOIN dbo.[Unipromet d_o_o$Job Title] j ON p.[Job Title] = j.[Code]
          LEFT JOIN dbo.[Unipromet d_o_o$HR Organization] o ON j.[Organization] = o.[Code]
          WHERE e.[Company Mobile Phone No_] != '' OR e.[Company Mobile Phone No_ 2] != '' OR e.[Company Phone No_] != '' OR e.[Mobile Phone No_] != ''
  
          UNION ALL
  
          SELECT 
            e.[No_] AS employee_no,
            RTRIM(e.[First Name]) AS first_name,
            RTRIM(e.[Last Name]) AS last_name,
            CASE 
              WHEN e.[Status] = 1 THEN 'Neaktivan' 
              WHEN e.[Status] = 2 THEN 'Napustio preduzeće' 
              ELSE 'Aktivan' 
            END AS hr_status,
            RTRIM(j.[Description]) AS job_title,
            RTRIM(o.[Description]) AS department,
            'Noleko' AS company,
            RTRIM(e.[Company Mobile Phone No_]) AS sl1,
            RTRIM(e.[Company Mobile Phone No_ 2]) AS sl2,
            RTRIM(e.[Company Phone No_]) AS sl3,
            RTRIM(e.[Mobile Phone No_]) AS priv_mob
          FROM dbo.[Noleko$HR Employee] e
          LEFT JOIN dbo.[Noleko$Position] p ON e.[No_] = p.[Employee No_] AND p.[Primary position] = 1
          LEFT JOIN dbo.[Noleko$Job Title] j ON p.[Job Title] = j.[Code]
          LEFT JOIN dbo.[Noleko$HR Organization] o ON j.[Organization] = o.[Code]
          WHERE e.[Company Mobile Phone No_] != '' OR e.[Company Mobile Phone No_ 2] != '' OR e.[Company Phone No_] != '' OR e.[Mobile Phone No_] != ''
    `;

    const res = await activePool.request().query(query);
    phoneEmployeesCache = {
      data: res.recordset,
      cachedAt: now,
      index: buildPhoneIndex(res.recordset)
    };
  } catch (err: any) {
    console.warn('[NavisionService] Error caching phone employees:', err.message);
  }
}

export const navisionService = {
  /**
   * Search employees live in Navision by name, surname, or kadrovski broj.
   * Supports multi-word matching (e.g. "marko lu"), diacritic-insensitive matching (c->ć/č, s->š, z->ž),
   * and handles trailing whitespace in Navision fields.
   */
  async searchEmployees(searchTerm: string, limit = 200): Promise<NavEmployee[]> {
    const trimmed = searchTerm.trim();
    if (!trimmed) return [];

    // Kljuc: tacan normalizovan izraz (reci razdvojene jednim razmakom) + limit, jer limit menja rezultat.
    const key = `${limit}|${trimmed.split(/\s+/).filter(Boolean).join(' ')}`;
    const now = Date.now();

    const hit = searchCache.get(key);
    if (hit) {
      if (now - hit.cachedAt < SEARCH_CACHE_TTL_MS) return cloneEmployees(hit.data);
      searchCache.delete(key);
    }

    // Single-flight: istovremeni identicni upiti dele isti promise
    let pending = searchInflight.get(key);
    if (!pending) {
      pending = searchEmployeesLive(trimmed, limit)
        .then(res => {
          if (res.cacheable) {
            searchCache.delete(key);
            while (searchCache.size >= SEARCH_CACHE_MAX) {
              const oldest = searchCache.keys().next().value;
              if (oldest === undefined) break;
              searchCache.delete(oldest);
            }
            searchCache.set(key, { data: res.rows, cachedAt: Date.now() });
          }
          return res;
        })
        .finally(() => {
          searchInflight.delete(key);
        });
      searchInflight.set(key, pending);
    }
    const res = await pending;
    return cloneEmployees(res.rows);
  },

  /**
   * Batch lookup of employee information for a list of employee numbers.
   * Leverages 5-minute memory cache to ensure high-speed equipment table renders.
   */
  async getEmployeesMap(employeeNos: (string | null | undefined)[]): Promise<Record<string, NavEmployee>> {
    const uniqueNos = Array.from(
      new Set(
        employeeNos
          .filter((no): no is string => typeof no === 'string' && no.trim().length > 0)
          .map(no => no.trim())
      )
    );

    if (uniqueNos.length === 0) {
      return {};
    }

    const resultMap: Record<string, NavEmployee> = {};
    const now = Date.now();
    const missingNos: string[] = [];

    // Check cache first
    for (const no of uniqueNos) {
      const cached = employeeCache.get(no);
      if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
        resultMap[no] = cached.data;
      } else {
        missingNos.push(no);
      }
    }

    if (missingNos.length === 0) {
      return resultMap;
    }

    const activePool = await getPool();
    if (!activePool) {
      return resultMap;
    }

    try {
      // Chunk missing numbers to prevent overly large SQL IN statements (max 100 per chunk)
      const chunkSize = 100;
      for (let i = 0; i < missingNos.length; i += chunkSize) {
        const chunk = missingNos.slice(i, i + chunkSize);
        const req = activePool.request();
        const paramNames: string[] = [];
        chunk.forEach((no, idx) => {
          const param = `no_${idx}`;
          paramNames.push(`@${param}`);
          req.input(param, sql.NVarChar, no);
        });

        const inClause = paramNames.join(', ');
        const query = `
          SELECT 
            e.[No_] AS employee_no,
            RTRIM(e.[First Name]) AS first_name,
            RTRIM(e.[Last Name]) AS last_name,
            CASE 
              WHEN e.[Status] = 1 THEN 'Neaktivan' 
              WHEN e.[Status] = 2 THEN 'Napustio preduzeće' 
              ELSE 'Aktivan' 
            END AS hr_status,
            RTRIM(j.[Description]) AS job_title,
            RTRIM(o.[Description]) AS department,
            'Unipromet' AS company
          FROM dbo.[Unipromet d_o_o$HR Employee] e
          LEFT JOIN dbo.[Unipromet d_o_o$Position] p ON e.[No_] = p.[Employee No_] AND p.[Primary position] = 1
          LEFT JOIN dbo.[Unipromet d_o_o$Job Title] j ON p.[Job Title] = j.[Code]
          LEFT JOIN dbo.[Unipromet d_o_o$HR Organization] o ON j.[Organization] = o.[Code]
          WHERE e.[No_] IN (${inClause})

          UNION ALL

          SELECT 
            e.[No_] AS employee_no,
            RTRIM(e.[First Name]) AS first_name,
            RTRIM(e.[Last Name]) AS last_name,
            CASE 
              WHEN e.[Status] = 1 THEN 'Neaktivan' 
              WHEN e.[Status] = 2 THEN 'Napustio preduzeće' 
              ELSE 'Aktivan' 
            END AS hr_status,
            RTRIM(j.[Description]) AS job_title,
            RTRIM(o.[Description]) AS department,
            'Noleko' AS company
          FROM dbo.[Noleko$HR Employee] e
          LEFT JOIN dbo.[Noleko$Position] p ON e.[No_] = p.[Employee No_] AND p.[Primary position] = 1
          LEFT JOIN dbo.[Noleko$Job Title] j ON p.[Job Title] = j.[Code]
          LEFT JOIN dbo.[Noleko$HR Organization] o ON j.[Organization] = o.[Code]
          WHERE e.[No_] IN (${inClause});
        `;

        const res = await req.query(query);
        for (const row of res.recordset) {
          const emp = mapRowToEmployee(row);
          if (emp.employee_no) {
            resultMap[emp.employee_no] = emp;
            employeeCache.set(emp.employee_no, { data: emp, cachedAt: now });
          }
        }
      }
    } catch (err: any) {
      console.warn('[NavisionService] Error during batch employee lookup:', err.message);
    }

    return resultMap;
  },

  /**
   * Batch lookup of employee assignments for phone numbers.
   * Matches Company Mobile Phone No_ (SL1), Company Mobile Phone No_ 2 (SL2),
   * Company Phone No_ (SL3), or Mobile Phone No_.
   */
  async getEmployeesByPhoneMap(phoneNumbers: (string | null | undefined)[]): Promise<Record<string, NavPhoneEmployee>> {
    const cleanPhones = Array.from(
      new Set(
        phoneNumbers
          .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
          .map(p => p.replace(/\D/g, '').trim())
      )
    );

    if (cleanPhones.length === 0) return {};

    const resultMap: Record<string, NavPhoneEmployee> = {};
    const now = Date.now();

    // Refresh phone employees cache if expired or null (single-flight)
    await ensurePhoneCache(now);

    if (!phoneEmployeesCache || !phoneEmployeesCache.data) return {};

    // Indeks (cifre telefona -> prvi red po redosledu recordset-a koji ga ima u sl1/sl2/sl3/priv_mob)
    // zamenjuje raniji allEmps.find(...) za svaki broj; rezultat je isti.
    const phoneIndex = phoneEmployeesCache.index;

    for (const phone of cleanPhones) {
      const match = phoneIndex.get(phone);

      if (match) {
        let slPrefix = 'SL1';
        if (match.sl2 && match.sl2.replace(/\D/g, '') === phone) slPrefix = 'SL2';
        else if (match.sl3 && match.sl3.replace(/\D/g, '') === phone) slPrefix = 'SL3';
        else if (match.sl1 && match.sl1.replace(/\D/g, '') === phone) slPrefix = 'SL1';
        else slPrefix = 'MOB';

        const fullName = `${match.first_name} ${match.last_name}`.trim();
        const slType = `${slPrefix} / ${match.employee_no}`;

        resultMap[phone] = {
          employee_no: match.employee_no,
          first_name: match.first_name,
          last_name: match.last_name,
          full_name: fullName,
          hr_status: match.hr_status,
          job_title: match.job_title,
          department: match.department,
          company: match.company,
          sl_type: slType,
          matched_phone: phone
        };
      }
    }

    return resultMap;
  },

  /**
   * Searches phone numbers assigned to employees matching a keyword.
   */
  async searchPhonesByEmployeeName(keyword: string): Promise<string[]> {
    if (!keyword || !keyword.trim()) return [];
    const now = Date.now();

    if (!phoneEmployeesCache || now - phoneEmployeesCache.cachedAt > CACHE_TTL_MS) {
      await this.getEmployeesByPhoneMap(['dummy']);
    }

    if (!phoneEmployeesCache || !phoneEmployeesCache.data) return [];

    const matchedPhones: string[] = [];
    for (const r of phoneEmployeesCache.data) {
      // Zajedničko pravilo pretrage (src/utils/searchMatch.ts): svaka reč u bar jednom polju, bez kvačica
      if (matchesSearch(keyword, r.employee_no, r.first_name, r.last_name, r.job_title, r.department)) {
        if (r.sl1) matchedPhones.push(r.sl1.replace(/\D/g, ''));
        if (r.sl2) matchedPhones.push(r.sl2.replace(/\D/g, ''));
        if (r.sl3) matchedPhones.push(r.sl3.replace(/\D/g, ''));
        if (r.priv_mob) matchedPhones.push(r.priv_mob.replace(/\D/g, ''));
      }
    }

    return Array.from(new Set(matchedPhones.filter(Boolean)));
  },

  /**
   * Helper to look up a single employee by employee_no.
   */
  async getEmployeeByNo(employeeNo: string): Promise<NavEmployee | null> {
    if (!employeeNo) return null;
    const map = await this.getEmployeesMap([employeeNo]);
    return map[employeeNo] || null;
  }
};
