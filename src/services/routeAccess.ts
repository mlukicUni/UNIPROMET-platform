import { Request, Response, NextFunction } from 'express';
import { SessionUser, getCurrentUser } from './authService';
import {
  EffectiveAccess,
  getAccess,
  hasLevel,
  hasAction,
  hasSectionAccess,
  hasAnyCameraRights,
  canAccessCameraIp,
  canAccessCamera,
  lookupCameraById,
  lookupCameraByIp,
  isDmsOnlyRole
} from './accessService';
import { writeAudit } from '../db/rolesDb';
import { PermissionLevel } from './permissionCatalog';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionUser?: SessionUser;
      access?: EffectiveAccess;
    }
  }
}

/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - MAPA RUTA I DOZVOLA
 * Svaka /api ruta mora biti navedena ovde. Ruta koja nije navedena je
 * zabranjena svima osim Super adminu (nova ruta ne može ostati nezaštićena).
 * ==========================================================================
 */

interface Ctx {
  req: Request;
  access: EffectiveAccess;
  user: SessionUser;
  params: Record<string, string>;
}

type Spec =
  | { noAuth: true }
  | { public: true }
  | { superOnly: true }
  | { key: string; level?: PermissionLevel }
  | { action: string }
  | { anyOf: string[] }
  | { custom: (ctx: Ctx) => boolean };

interface Rule {
  /** HTTP metode razdvojene zarezom ili '*' */
  m: string;
  /** Putanja relativno na /api; ':x' je jedan segment, '*' deo segmenta, '/**' ostatak putanje */
  p: string;
  spec: Spec;
  /** Ako je zadato, dozvoljen pristup se beleži u evidenciju sa ovom akcijom */
  audit?: string;
}

const PUBLIC: Spec = { public: true };

const RULES: Rule[] = [
  /* ---------- Sistem ---------- */
  { m: 'GET', p: '/status', spec: PUBLIC },
  { m: 'GET', p: '/stats', spec: PUBLIC },
  { m: 'GET', p: '/ping', spec: PUBLIC },
  { m: 'GET', p: '/scheduler/status', spec: PUBLIC },
  { m: 'GET', p: '/logs', spec: { key: 'server.logovi', level: 'view' } },
  { m: 'POST', p: '/logs', spec: PUBLIC },

  /* ---------- Prijava ---------- */
  { m: '*', p: '/auth/**', spec: { noAuth: true } },

  /* ---------- Upravljanje rolama ---------- */
  // Članovi AD grupe DMS-Admins: pravljenje, izmena, brisanje i dodela DMS rola (dozvole samo iz sekcije DMS,
  // proverava access.routes). Role van DMS-a za njih ne postoje.
  { m: 'GET', p: '/access/catalog', spec: { custom: ({ access }) => access.isDmsRoleAdmin } },
  { m: 'GET', p: '/access/known', spec: { custom: ({ access }) => access.isDmsRoleAdmin } },
  { m: 'GET', p: '/access/ad/search', spec: { custom: ({ access }) => access.isDmsRoleAdmin } },
  { m: 'GET,POST', p: '/access/roles', spec: { custom: ({ access }) => access.isDmsRoleAdmin } }, // lista: samo DMS role; kopija: samo od DMS role
  { m: 'GET,PUT,DELETE', p: '/access/roles/:id', spec: { custom: ({ access, params }) => access.isDmsRoleAdmin && isDmsOnlyRole(params.id) } },
  { m: 'PUT', p: '/access/roles/:id/permissions', spec: { custom: ({ access, params }) => access.isDmsRoleAdmin && isDmsOnlyRole(params.id) } },
  { m: 'POST', p: '/access/roles/:id/assignments', spec: { custom: ({ access, params }) => access.isDmsRoleAdmin && isDmsOnlyRole(params.id) } },
  { m: 'DELETE', p: '/access/roles/:id/assignments/:aid', spec: { custom: ({ access, params }) => access.isDmsRoleAdmin && isDmsOnlyRole(params.id) } },
  // Sve ostalo (pristup kamerama, grupe kamera, provera korisnika, evidencija) samo Super admin
  { m: '*', p: '/access/**', spec: { superOnly: true } },

  /* ---------- Video gateway (go2rtc proxy) ---------- */
  { m: '*', p: '/video-gateway/**', spec: { custom: ctx => checkVideoGatewayHttp(ctx) } },

  /* ---------- Kamere (pristup po kameri) ---------- */
  { m: 'GET', p: '/cameras/gateway/status', spec: { custom: ({ access }) => hasVideoContext(access) } },
  { m: 'GET', p: '/cameras/scheduler', spec: { key: 'mreza.kamere', level: 'view' } },
  { m: 'POST', p: '/cameras/scheduler/time', spec: { key: 'mreza.kamere', level: 'edit' } },
  { m: 'GET', p: '/cameras/offline', spec: { key: 'mreza.kamere', level: 'view' } },
  { m: 'POST', p: '/cameras/offline/email', spec: { key: 'mreza.kamere', level: 'edit' } },
  { m: 'POST', p: '/cameras/sync-nvr-channels', spec: { action: 'mreza.snimaci:sinhronizacija' } },
  {
    m: 'GET', p: '/cameras',
    spec: {
      custom: ({ req, access }) => {
        const wantsScan = req.query.force === 'true' || req.query.refresh === 'true' || req.query.deep === 'true';
        if (wantsScan) return hasAction(access, 'mreza.kamere:skeniranje');
        return hasVideoContext(access) || hasLevel(access, 'mreza.kamere', 'view');
      }
    }
  },
  {
    m: 'GET', p: '/cameras/:ip/ping',
    spec: { custom: ({ access, params }) => hasLevel(access, 'mreza.kamere', 'view') || canAccessCameraIp(access, params.ip, 'live') }
  },
  { m: 'GET', p: '/cameras/:ip/snapshot', spec: { custom: ({ access, params }) => canAccessCameraIp(access, params.ip, 'live') } },
  { m: 'GET', p: '/cameras/:ip/live-stream', spec: { custom: ({ access, params }) => canAccessCameraIp(access, params.ip, 'live') } },
  {
    m: 'GET', p: '/cameras/:ip/live-info', audit: 'camera.live',
    spec: { custom: ({ access, params }) => canAccessCameraIp(access, params.ip, 'live') }
  },
  {
    m: 'GET', p: '/cameras/:ip/playback-info',
    spec: { custom: ({ access, params }) => canAccessCameraIp(access, params.ip, 'live') || canAccessCameraIp(access, params.ip, 'playback') }
  },
  { m: 'GET', p: '/cameras/:ip/playback-timeline', spec: { custom: ({ access, params }) => canAccessCameraIp(access, params.ip, 'playback') } },
  {
    m: 'POST', p: '/cameras/:ip/playback-stream', audit: 'camera.playback',
    spec: { custom: ({ access, params }) => canAccessCameraIp(access, params.ip, 'playback') }
  },
  { m: 'POST', p: '/cameras/:ip/stop-playback', spec: { custom: ({ access, params }) => canAccessCameraIp(access, params.ip, 'playback') } },
  {
    m: 'GET', p: '/cameras/:ip/download-clip', audit: 'camera.clip',
    spec: { custom: ({ access, params }) => canAccessCameraIp(access, params.ip, 'playback') }
  },

  /* ---------- Monitoring (lični tabovi; pregled stranice je dovoljan i za izmenu sopstvenih tabova) ---------- */
  { m: '*', p: '/monitoring/**', spec: { key: 'video.monitoring', level: 'view' } },

  /* ---------- NOLEKO AI: agent prototip (lični razgovori; pregled stranice je dovoljan za chat) ---------- */
  { m: '*', p: '/ai-agent/**', spec: { key: 'noleko.agent_prototip', level: 'view' } },

  /* ---------- NOLEKO AI: dokumenti (AI razvojni plan) ---------- */
  { m: 'GET', p: '/noleko/docs/razvojni_plan/**', spec: { key: 'noleko.razvojni_plan', level: 'view' } },
  { m: 'GET', p: '/noleko/docs/razvojni_plan', spec: { key: 'noleko.razvojni_plan', level: 'view' } },
  { m: 'PUT', p: '/noleko/docs/razvojni_plan', spec: { key: 'noleko.razvojni_plan', level: 'edit' } },

  /* ---------- DMS Analiza podataka ---------- */
  { m: 'GET', p: '/dms/users', spec: { anyOf: ['dms.izvestaji', 'dms.korisnici', 'dms.podsetnik'] } },
  { m: 'POST', p: '/dms/users/sync', spec: { action: 'dms.izvestaji:ucitavanje' } },
  { m: '*', p: '/dms/users/**', spec: { key: 'dms.korisnici', level: 'edit' } },
  { m: 'POST', p: '/dms/users', spec: { key: 'dms.korisnici', level: 'edit' } },
  { m: 'GET', p: '/dms/reports', spec: { key: 'dms.izvestaji', level: 'view' } },
  { m: 'GET', p: '/dms/reports/**', spec: { key: 'dms.izvestaji', level: 'view' } },
  { m: 'POST', p: '/dms/reports/upload', spec: { action: 'dms.izvestaji:ucitavanje' } },
  { m: 'DELETE', p: '/dms/reports/:filename', spec: { action: 'dms.izvestaji:ucitavanje' } },
  { m: 'POST', p: '/dms/mail/send', spec: { action: 'dms.izvestaji:mejl' } },
  { m: 'GET', p: '/dms/reminders/**', spec: { key: 'dms.podsetnik', level: 'view' } },
  { m: 'POST', p: '/dms/reminders/send', spec: { action: 'dms.podsetnik:slanje' } },
  { m: '*', p: '/dms/scheduled-mails', spec: { key: 'dms.mailovi' } },
  { m: '*', p: '/dms/scheduled-mails/**', spec: { key: 'dms.mailovi' } },
  // Provera zipa i OCR su POST, ali samo čitaju: dovoljan je pregled; potvrde i izmene traže izmenu
  { m: 'POST', p: '/dms/signatures/bilateral', spec: { key: 'dms.potpisi', level: 'edit' } },
  { m: 'POST', p: '/dms/signatures/confirm', spec: { key: 'dms.potpisi', level: 'edit' } },
  { m: '*', p: '/dms/signatures/**', spec: { key: 'dms.potpisi', level: 'view' } },

  /* ---------- Inventar kamera i snimača ---------- */
  { m: 'GET,POST', p: '/inventory/cameras/scan-unrecorded', spec: { action: 'mreza.kamere:skeniranje' } },
  {
    m: 'GET', p: '/inventory/cameras',
    spec: { custom: ({ access }) => hasLevel(access, 'mreza.kamere', 'view') || hasVideoContext(access) }
  },
  {
    m: 'GET', p: '/inventory/cameras/:id',
    spec: {
      custom: ({ access, params }) =>
        hasLevel(access, 'mreza.kamere', 'view') ||
        canAccessCamera(access, lookupCameraById(params.id), 'live') ||
        canAccessCamera(access, lookupCameraById(params.id), 'playback')
    }
  },
  { m: 'POST,PUT,PATCH,DELETE', p: '/inventory/cameras/**', spec: { key: 'mreza.kamere', level: 'edit' } },
  { m: 'POST', p: '/inventory/recorders/check-status', spec: { key: 'mreza.snimaci', level: 'edit' } },
  { m: 'POST', p: '/inventory/recorders/:id/check-status', spec: { key: 'mreza.snimaci', level: 'edit' } },
  { m: 'GET', p: '/inventory/recorders/**', spec: { anyOf: ['mreza.snimaci', 'mreza.kamere', 'video'] } },
  { m: 'POST,PUT,PATCH,DELETE', p: '/inventory/recorders/**', spec: { key: 'mreza.snimaci', level: 'edit' } },
  { m: 'POST', p: '/inventory/rf-readers/**', spec: { key: 'mreza.rf_citaci', level: 'edit' } },
  { m: 'PUT,PATCH,DELETE', p: '/inventory/rf-readers/**', spec: { key: 'mreza.rf_citaci', level: 'edit' } },
  { m: 'GET', p: '/inventory/rf-readers/**', spec: { key: 'mreza.rf_citaci', level: 'view' } },
  { m: 'POST', p: '/inventory/wifi-aps/sync', spec: { action: 'mreza.wifi:sinhronizacija' } },
  { m: 'GET', p: '/inventory/wifi-aps/**', spec: { key: 'mreza.wifi', level: 'view' } },

  /* ---------- Mreža ---------- */
  { m: 'GET', p: '/network/**', spec: { anyOf: ['mreza.racunari', 'mreza.serveri', 'mreza.ostali'] } },
  { m: 'POST', p: '/switches/:ip/refresh', spec: { action: 'mreza.svicevi:skeniranje' } },
  { m: 'GET', p: '/switches/**', spec: { key: 'mreza.svicevi', level: 'view' } },

  /* ---------- Štampači, izveštaji, mejl ---------- */
  { m: 'POST,DELETE', p: '/reports/mail/**', spec: { action: 'mreza.stampaci:mejl' } },
  { m: 'POST', p: '/reports/generate', spec: { action: 'mreza.stampaci:izvestaji' } },
  { m: 'DELETE', p: '/reports/:id', spec: { action: 'mreza.stampaci:izvestaji' } },
  { m: 'GET', p: '/reports/**', spec: { key: 'mreza.stampaci', level: 'view' } },
  { m: '*', p: '/mail/**', spec: { action: 'mreza.stampaci:mejl' } },
  { m: '*', p: '/printers/**', spec: { key: 'mreza.stampaci' } },

  /* ---------- Evidencija: oprema ---------- */
  { m: '*', p: '/equipment/webhook/**', spec: { noAuth: true } },
  { m: 'GET', p: '/equipment/events', spec: { key: 'evidencija', level: 'view' } },
  { m: 'GET', p: '/equipment/sync-check', spec: { key: 'evidencija', level: 'view' } },
  { m: 'GET', p: '/equipment/export/excel', spec: { action: 'evidencija.oprema:izvoz' } },
  { m: 'GET', p: '/equipment/categories', spec: { key: 'evidencija', level: 'view' } },
  { m: 'GET', p: '/equipment/stats', spec: { key: 'evidencija', level: 'view' } },
  { m: 'GET', p: '/equipment/codebooks', spec: { key: 'evidencija', level: 'view' } },
  { m: 'GET', p: '/equipment/nav-employees', spec: { key: 'evidencija', level: 'view' } },
  { m: '*', p: '/equipment/software*', spec: { key: 'evidencija.software' } },
  { m: '*', p: '/equipment/software*/**', spec: { key: 'evidencija.software' } },
  { m: 'POST', p: '/equipment/dictionaries/sync', spec: { key: 'evidencija.sifarnici', level: 'edit' } },
  { m: 'GET', p: '/equipment/dictionaries/**', spec: { key: 'evidencija', level: 'view' } },
  { m: 'POST,PUT,PATCH,DELETE', p: '/equipment/dictionaries/**', spec: { key: 'evidencija.sifarnici', level: 'edit' } },
  { m: '*', p: '/equipment', spec: { key: 'evidencija.oprema' } },
  { m: '*', p: '/equipment/**', spec: { key: 'evidencija.oprema' } },

  /* ---------- Evidencija: mrežna oprema, čvorišta, linije, MTS ---------- */
  { m: 'GET', p: '/network-equipment/export/excel', spec: { action: 'evidencija.mrezna_oprema:izvoz' } },
  { m: '*', p: '/network-equipment', spec: { key: 'evidencija.mrezna_oprema' } },
  { m: '*', p: '/network-equipment/**', spec: { key: 'evidencija.mrezna_oprema' } },
  { m: 'GET', p: '/network-nodes/export/excel', spec: { action: 'evidencija.cvorista:izvoz' } },
  { m: '*', p: '/network-nodes', spec: { key: 'evidencija.cvorista' } },
  { m: '*', p: '/network-nodes/**', spec: { key: 'evidencija.cvorista' } },
  { m: 'GET', p: '/lines/export/excel', spec: { action: 'evidencija.linije:izvoz' } },
  { m: '*', p: '/lines', spec: { key: 'evidencija.linije' } },
  { m: '*', p: '/lines/**', spec: { key: 'evidencija.linije' } },
  { m: 'GET', p: '/mts/export/excel', spec: { action: 'evidencija.mts:izvoz' } },
  { m: '*', p: '/mts', spec: { key: 'evidencija.mts' } },
  { m: '*', p: '/mts/**', spec: { key: 'evidencija.mts' } },

  /* ---------- Server ---------- */
  { m: '*', p: '/scheduler/**', spec: { key: 'server.servisi' } }
];

/* ==========================================================================
   KOMPAJLIRANJE PRAVILA
   ========================================================================== */
interface CompiledRule {
  methods: Set<string> | null;
  regex: RegExp;
  names: string[];
  spec: Spec;
  audit?: string;
}

function compilePattern(p: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  let rest = p;
  let tail = '';
  if (rest.endsWith('/**')) {
    rest = rest.slice(0, -3);
    tail = '(?:/.*)?';
  }
  const re = rest
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, (_m, n: string) => {
      names.push(n);
      return '([^/]+)';
    })
    .replace(/\*/g, '[^/]*');
  return { regex: new RegExp(`^${re}${tail}/?$`), names };
}

const COMPILED: CompiledRule[] = RULES.map(r => {
  const { regex, names } = compilePattern(r.p);
  return {
    methods: r.m === '*' ? null : new Set(r.m.split(',').map(s => s.trim().toUpperCase())),
    regex,
    names,
    spec: r.spec,
    audit: r.audit
  };
});

function findRule(method: string, path: string): { rule: CompiledRule; params: Record<string, string> } | null {
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  for (const rule of COMPILED) {
    if (rule.methods && !rule.methods.has(m)) continue;
    const match = rule.regex.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    rule.names.forEach((n, i) => {
      try {
        params[n] = decodeURIComponent(match[i + 1]);
      } catch {
        params[n] = match[i + 1];
      }
    });
    return { rule, params };
  }
  return null;
}

/* ==========================================================================
   POMOĆNE PROVERE
   ========================================================================== */
/** Korisnik koristi video stranice ili ima pravo nad bar jednom kamerom */
function hasVideoContext(access: EffectiveAccess): boolean {
  return access.isSuperAdmin || hasSectionAccess(access, 'video', 'view') || hasAnyCameraRights(access);
}

const GATEWAY_ALLOWED_PATHS = new Set(['/ws', '/stream.mp4', '/frame.jpeg', '/frame.mp4', '/webrtc', '/stream.m3u8']);
const STREAM_NAME_RE = /^(cam|playback|export)_(\d{1,3}(?:_\d{1,3}){3})(?:_(?:sub|main))?(?:_\d+)?$/;

/**
 * Proverava da li korisnik sme da otvori stream kroz go2rtc gateway.
 * `subPath` je putanja posle /video-gateway (npr. '/ws'), `srcList` vrednosti parametra `src`.
 */
export function checkVideoGatewayAccess(access: EffectiveAccess, subPath: string, srcList: string[]): boolean {
  if (access.isSuperAdmin) return true;
  const clean = subPath.replace(/\/+$/, '') || '/';
  if (!GATEWAY_ALLOWED_PATHS.has(clean)) return false;
  if (srcList.length === 0) return false;
  for (const src of srcList) {
    const m = STREAM_NAME_RE.exec(src);
    if (!m) return false;
    const ip = m[2].replace(/_/g, '.');
    const kind = m[1] === 'cam' ? 'live' : 'playback';
    if (!canAccessCameraIp(access, ip, kind)) return false;
  }
  return true;
}

function checkVideoGatewayHttp({ req, access }: Ctx): boolean {
  // req.path je relativan na /api, npr. '/video-gateway/stream.mp4'
  const sub = req.path.replace(/^\/video-gateway/, '') || '/';
  const raw = req.query.src;
  const srcList = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
  return checkVideoGatewayAccess(access, sub, srcList);
}

/* ==========================================================================
   EVALUACIJA
   ========================================================================== */
function evaluate(spec: Spec, ctx: Ctx): { allowed: boolean; need?: string } {
  const { req, access } = ctx;
  if ('noAuth' in spec || 'public' in spec) return { allowed: true };
  if (access.isSuperAdmin) return { allowed: true };
  if ('superOnly' in spec) return { allowed: false, need: 'Super admin' };

  const defaultLevel: PermissionLevel = req.method === 'GET' || req.method === 'HEAD' ? 'view' : 'edit';

  if ('key' in spec) {
    const level = spec.level || defaultLevel;
    return { allowed: hasLevel(access, spec.key, level), need: `${spec.key} (${level})` };
  }
  if ('action' in spec) return { allowed: hasAction(access, spec.action), need: spec.action };
  if ('anyOf' in spec) {
    const level = defaultLevel;
    return { allowed: spec.anyOf.some(k => hasLevel(access, k, level)), need: spec.anyOf.join(' | ') };
  }
  if ('custom' in spec) return { allowed: spec.custom(ctx), need: 'kamera / stranica' };
  return { allowed: false };
}

const denyLogThrottle = new Map<string, number>();
const auditThrottle = new Map<string, number>();

function throttled(map: Map<string, number>, key: string, ms: number): boolean {
  const now = Date.now();
  const last = map.get(key) || 0;
  if (now - last < ms) return true;
  map.set(key, now);
  if (map.size > 2000) {
    for (const [k, t] of map.entries()) if (now - t > ms) map.delete(k);
  }
  return false;
}

function forbidden(res: Response, need?: string) {
  res.status(403).json({
    success: false,
    forbidden: true,
    error: 'Nemate dozvolu za ovu akciju.',
    message: 'Nemate dozvolu za ovu akciju. Obratite se administratoru za dodelu role.',
    permission: need
  });
}

/**
 * Middleware koji se montira na /api posle provere prijave.
 * Dodaje req.sessionUser i req.access, pa proverava mapu ruta.
 */
export function enforceRouteAccess(req: Request, res: Response, next: NextFunction) {
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  const found = findRule(req.method, path);

  if (found && 'noAuth' in found.rule.spec) return next();

  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Prijava je obavezna za pristup podacima.',
      requiresLogin: true
    });
  }

  const access = getAccess(user);
  req.sessionUser = user;
  req.access = access;

  if (!found) {
    if (access.isSuperAdmin) return next();
    console.warn(`[Access] Ruta nije u mapi dozvola, zabranjeno: ${req.method} /api${path}`);
    return forbidden(res, 'nemapirana ruta');
  }

  const params = found.params;
  const result = evaluate(found.rule.spec, { req, access, user, params });

  if (!result.allowed) {
    const isCameraPath = path.startsWith('/cameras') || path.startsWith('/video-gateway');
    if ((req.method !== 'GET' || isCameraPath) && !throttled(denyLogThrottle, `${user.id}|${req.method}|${path}`, 60_000)) {
      writeAudit(user, 'access.denied', 'route', `${req.method} /api${path}`, `Potrebno: ${result.need || '-'}`, false);
    }
    return forbidden(res, result.need);
  }

  if (found.rule.audit && !throttled(auditThrottle, `${user.id}|${found.rule.audit}|${params.ip || ''}`, 60_000)) {
    const cam = params.ip ? lookupCameraByIp(params.ip) : null;
    const extra = req.method === 'GET' && req.query.startTime ? ` ${String(req.query.startTime)} → ${String(req.query.endTime || '')}` : '';
    const body = req.body && req.body.startTime ? ` ${String(req.body.startTime)}` : '';
    writeAudit(user, found.rule.audit, 'camera', cam?.id || params.ip || '', `IP ${params.ip || '-'}${extra}${body}`);
  }

  next();
}
