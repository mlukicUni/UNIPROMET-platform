import { Router, Request, Response } from 'express';
import {
  buildAuthorizeUrl,
  exchangeCodeForUser,
  createSessionCookie,
  destroySession,
  getCurrentUser,
  getOrRefreshCurrentUser,
  refreshUserGroups,
  getRedirectUri,
  sessionCookieOptions,
  COOKIE_NAME,
  SessionUser
} from '../services/authService';
import { addServerLog } from './system.routes';
import { getAccess, isUserAllowed, buildClientAccess } from '../services/accessService';
import { recordKnownUser, writeAudit } from '../db/rolesDb';

export const authRouter = Router();

/**
 * Initiates Microsoft 365 OAuth 2.0 login.
 */
authRouter.get('/login', (req: Request, res: Response) => {
  try {
    const authUrl = buildAuthorizeUrl(req);
    res.redirect(authUrl);
  } catch (err: any) {
    console.error('[AuthRoute] Failed to initiate login:', err);
    addServerLog('error', `Neuspelo pokretanje Microsoft prijave: ${err?.message || err}`, 'Auth');
    res.redirect('/?auth_error=init_failed');
  }
});

/**
 * Microsoft 365 OAuth 2.0 callback endpoint.
 */
authRouter.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const error = req.query.error as string;
  const errorDescription = req.query.error_description as string;

  if (error) {
    console.error('[AuthRoute] Microsoft returned error:', error, errorDescription);
    addServerLog('error', `Microsoft SSO greška: ${errorDescription || error}`, 'Auth');
    return res.redirect(`/?auth_error=${encodeURIComponent(errorDescription || error)}`);
  }

  if (!code) {
    console.warn('[AuthRoute] Callback missing authorization code');
    addServerLog('warn', 'Prijava prekinuta: nedostaje autorizacioni kod od Microsoft-a', 'Auth');
    return res.redirect('/?auth_error=missing_code');
  }

  const redirectUri = getRedirectUri(req);
  console.log(`[AuthRoute] Processing OAuth callback with redirectUri: ${redirectUri}`);

  const user = await exchangeCodeForUser(code, redirectUri);
  if (!user) {
    console.error('[AuthRoute] Failed to exchange code for user session');
    addServerLog('error', 'Neuspešna razmena koda za korisničku sesiju (Microsoft Graph / Token)', 'Auth');
    return res.redirect('/?auth_error=exchange_failed');
  }

  const cookieVal = createSessionCookie(user);

  // HTTP-only cookie; važi 7 dana od poslednjeg korišćenja platforme
  res.cookie(COOKIE_NAME, cookieVal, sessionCookieOptions(req));

  try {
    recordKnownUser({ id: user.id, name: user.name, email: user.email, groups: user.groups });
  } catch (err: any) {
    console.warn('[AuthRoute] recordKnownUser failed:', err?.message || err);
  }

  const access = getAccess(user);
  if (access.hasAnyAccess) {
    const roleNames = access.roles.map(r => r.name).join(', ') || '-';
    addServerLog('success', `✓ Uspešna prijava: ${user.name} (${user.email}) - Role: ${roleNames}`, 'Auth');
    writeAudit(user, 'auth.login', 'user', user.email || user.id, `Prijava; role: ${roleNames}`);
    res.redirect('/?login=success');
  } else {
    const groupNames = (user.groups || []).map(g => g.name).join(', ') || 'Nema grupa';
    addServerLog('warn', `⚠️ Odbijen pristup: ${user.name} (${user.email}) - Nema dodeljenu rolu (Članstvo: ${groupNames})`, 'Auth');
    writeAudit(user, 'auth.denied', 'user', user.email || user.id, `Prijava bez dodeljene role; grupe: ${groupNames}`, false);
    res.redirect('/access-denied');
  }
});

/**
 * Clears session and logs user out.
 */
authRouter.get('/logout', (req: Request, res: Response) => {
  const cookieVal = req.cookies?.[COOKIE_NAME];
  const user = getCurrentUser(req);
  if (cookieVal) {
    destroySession(cookieVal);
  }
  if (user) {
    addServerLog('info', `Odjava korisnika: ${user.name} (${user.email})`, 'Auth');
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.redirect('/login?logout=success');
});

/**
 * Returns current authenticated user and groups (auto-refreshes from Active Directory if stale).
 */
authRouter.get('/me', async (req: Request, res: Response) => {
  const force = req.query.force === 'true' || req.query.force === '1';
  const user = await getOrRefreshCurrentUser(req, force);
  if (!user) {
    return res.json({
      isAuthenticated: false,
      isAuthorized: false,
      user: null
    });
  }

  const allowed = isUserAllowed(user);
  res.json({
    isAuthenticated: true,
    isAuthorized: allowed,
    user: { ...user, isAuthorized: allowed },
    access: buildClientAccess(getAccess(user))
  });
});

/**
 * Forces an instant refresh of user groups and permissions from Active Directory.
 */
authRouter.all('/refresh', async (req: Request, res: Response) => {
  const user = await getOrRefreshCurrentUser(req, true);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Niste prijavljeni'
    });
  }

  addServerLog('info', `Osvežene Active Directory grupe za: ${user.name} (${user.groups.length} grupa)`, 'Auth');

  const allowed = isUserAllowed(user);
  res.json({
    success: true,
    user: { ...user, isAuthorized: allowed },
    access: buildClientAccess(getAccess(user)),
    groupsCount: user.groups.length,
    groups: user.groups
  });
});

/**
 * Authentication configuration status.
 */
authRouter.get('/status', (req: Request, res: Response) => {
  res.json({
    enabled: true,
    provider: 'Microsoft Entra ID (Azure AD)',
    redirectUri: getRedirectUri(req)
  });
});

/**
 * Local development login endpoint for quick session testing.
 * Dostupan SAMO ako je ENABLE_DEV_LOGIN=true u .env i samo sa same mašine (localhost).
 * Inače vraća 404, da ne bi neko iz mreže dobio Super admin sesiju.
 */
authRouter.get('/dev-login', (req: Request, res: Response) => {
  const ip = req.socket.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (process.env.ENABLE_DEV_LOGIN !== 'true' || !isLocal) {
    return res.status(404).send('Not found');
  }

  const devUser: SessionUser = {
    id: 'dev-admin',
    name: 'Marko Lukić',
    email: 'mlukic@unipromet.rs',
    groups: [{ id: '1', name: 'ITadmin' }],
    rawGroupIds: ['1'],
    isAdmin: true,
    isAuthorized: true,
    loggedInAt: new Date().toISOString()
  };

  const cookieVal = createSessionCookie(devUser);
  res.cookie(COOKIE_NAME, cookieVal, sessionCookieOptions(req));

  res.redirect('/#wifi_aps');
});

export default authRouter;
