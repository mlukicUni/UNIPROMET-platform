import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';

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

let phoneEmployeesCache: { data: any[]; cachedAt: number } | null = null;

async function getPool(): Promise<sql.ConnectionPool | null> {
  if (pool && pool.connected) {
    return pool;
  }
  if (isConnecting) {
    // Wait for active attempt
    let waited = 0;
    while (isConnecting && waited < 4000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    if (pool && pool.connected) return pool;
  }

  try {
    isConnecting = true;
    pool = new sql.ConnectionPool(sqlConfig);
    await pool.connect();
    pool.on('error', err => {
      console.warn('[NavisionService] Pool error:', err.message);
      pool = null;
    });
    return pool;
  } catch (err: any) {
    console.warn(`[NavisionService] Failed to connect to Navision DB (${NAV_HOST}):`, err.message);
    pool = null;
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

export const navisionService = {
  /**
   * Search employees live in Navision by name, surname, or kadrovski broj.
   * Supports multi-word matching (e.g. "marko lu"), diacritic-insensitive matching (c->ć/č, s->š, z->ž),
   * and handles trailing whitespace in Navision fields.
   */
  async searchEmployees(searchTerm: string, limit = 200): Promise<NavEmployee[]> {
    const trimmed = searchTerm.trim();
    if (!trimmed) return [];

    const activePool = await getPool();
    if (!activePool) {
      console.warn('[NavisionService] Offline mode: Navision DB unreachable');
      return [];
    }

    try {
      const tokens = trimmed.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return [];

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

      return employees;
    } catch (err: any) {
      console.warn('[NavisionService] Error during employee search:', err.message);
      return [];
    }
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

    // Refresh phone employees cache if expired or null
    if (!phoneEmployeesCache || now - phoneEmployeesCache.cachedAt > CACHE_TTL_MS) {
      const activePool = await getPool();
      if (activePool) {
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
            cachedAt: now
          };
        } catch (err: any) {
          console.warn('[NavisionService] Error caching phone employees:', err.message);
        }
      }
    }

    if (!phoneEmployeesCache || !phoneEmployeesCache.data) return {};

    const allEmps = phoneEmployeesCache.data;

    for (const phone of cleanPhones) {
      const match = allEmps.find(r => 
        (r.sl1 && r.sl1.replace(/\D/g, '') === phone) ||
        (r.sl2 && r.sl2.replace(/\D/g, '') === phone) ||
        (r.sl3 && r.sl3.replace(/\D/g, '') === phone) ||
        (r.priv_mob && r.priv_mob.replace(/\D/g, '') === phone)
      );

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

    const trimmed = keyword.toLowerCase().trim();
    const tokens = trimmed.split(/\s+/).filter(Boolean);

    const matchedPhones: string[] = [];
    for (const r of phoneEmployeesCache.data) {
      const fullText = `${r.employee_no} ${r.first_name} ${r.last_name} ${r.job_title || ''} ${r.department || ''}`.toLowerCase();
      const allTokensMatch = tokens.every(tok => fullText.includes(tok));
      if (allTokensMatch) {
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
