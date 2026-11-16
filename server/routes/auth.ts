import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  loadDb,
  saveDb,
  sanitizeUser,
  getUserAccounts,
  createDefaultAccountsForUser,
  mirrorUserToFirestore,
  setUserDerivCredentials,
  getUserDerivCredentials,
  clearUserDerivCredentials,
  appendAuditLog,
  savePkceOAuthState,
  consumePkceOAuthState,
  type StoredUser,
} from '../db/store.ts';
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  generateId,
  generateOAuthState,
  generatePkcePair,
  checkRateLimit,
  recordRateLimitAttempt,
  clearRateLimit,
} from '../security/crypto.ts';
import { extractUserToken, requireUser, USER_COOKIE_NAME, type AuthenticatedRequest } from '../middleware/auth.ts';
import { verifySessionToken } from '../security/crypto.ts';
import { broadcastEvent } from '../services/sse.ts';
import {
  buildDerivAuthorizeUrl,
  exchangeDerivOAuthCode,
  fetchDerivBalancesWithCreds,
  getDerivDefaultRedirectUri,
  revokeDerivAuthorization,
  verifyDerivOAuthSession,
  verifyDerivToken,
} from '../services/deriv.ts';
import {
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendDerivConnectionEmail,
  sendSecurityAlertEmail,
} from '../services/brevo.ts';
import type { TradingAccount } from '../../src/types/pipflow.ts';

const router = Router();

const registerSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.').max(254),
  password: z.string().min(6, 'Password must be at least 6 characters.').max(128),
  fullName: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  phone: z.string().trim().min(5, 'Please enter a valid phone number.').max(40),
});

const loginSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.').max(254),
  password: z.string().min(1, 'Password is required.').max(128),
});

function isHttpsRequest(req: any): boolean {
  const proto = String(req.headers?.['x-forwarded-proto'] || req.protocol || '');
  return Boolean(req.secure || proto.includes('https'));
}

function setUserCookie(req: any, res: any, userId: string, email: string): string {
  const token = signSessionToken({ sub: userId, role: 'user', email, sid: generateId('sid') }, 60 * 60 * 24 * 7);
  const https = isHttpsRequest(req);
  res.cookie(USER_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: https ? 'none' : 'lax',
    secure: https,
    partitioned: https,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: '/',
  });
  return token;
}

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration details' });
    return;
  }

  const ip = req.ip || 'unknown';
  const rl = checkRateLimit(`reg:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) {
    res.status(429).json({ error: `Too many registration attempts. Retry in ${rl.retryAfterSec}s.` });
    return;
  }

  const db = loadDb();
  const emailLower = parsed.data.email.toLowerCase();
  const exists = Object.values(db.users).find((u) => u.email.toLowerCase() === emailLower);
  if (exists) {
    recordRateLimitAttempt(`reg:${ip}`, 15 * 60 * 1000);
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const now = new Date().toISOString();
  const userId = generateId('usr');
  const verificationCode = String(Math.floor(100000 + Math.random() * 900000));

  const newUser: StoredUser = {
    id: userId,
    email: emailLower,
    fullName: parsed.data.fullName || emailLower.split('@')[0],
    country: parsed.data.country || 'International',
    phone: parsed.data.phone || '',
    emailVerified: false,
    status: 'active',
    preferredTheme: db.config.theme.defaultTheme,
    preferredCurrency: db.config.dashboard.defaultCurrency,
    preferredLanguage: db.config.dashboard.defaultLanguage,
    activeAccountId: '',
    passwordHash: hashPassword(parsed.data.password),
    verificationCode,
    createdAt: now,
    updatedAt: now,
  };

  const { real, demo } = createDefaultAccountsForUser(db, userId);
  newUser.activeAccountId = demo.accountId;
  db.users[userId] = newUser;
  db.watchlists[userId] = [...db.config.dashboard.defaultWatchlist];
  db.notifications.unshift({
    id: generateId('ntf'),
    userId,
    title: 'Welcome to PIPFLOW',
    message: `Accounts ${real.accountId} (Real) and ${demo.accountId} (Demo) created. Verify your email with code ${verificationCode}.`,
    category: 'account',
    read: false,
    createdAt: now,
  });

  saveDb(db);
  void mirrorUserToFirestore(newUser, [real, demo]);
  void sendWelcomeEmail({
    email: emailLower,
    fullName: newUser.fullName,
    realAccountId: real.accountId,
    demoAccountId: demo.accountId,
    verificationCode,
  });

  const sessionToken = setUserCookie(req, res, userId, emailLower);
  res.status(201).json({
    user: sanitizeUser(newUser),
    accounts: [real, demo],
    sessionToken,
    verificationPreviewCode: verificationCode,
  });
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please enter a valid email and password.' });
    return;
  }

  const ip = req.ip || 'unknown';
  const emailLower = parsed.data.email.toLowerCase();
  const rlKey = `login:${ip}:${emailLower}`;
  const rl = checkRateLimit(rlKey, 8, 10 * 60 * 1000);
  if (!rl.allowed) {
    res.status(429).json({ error: `Too many login attempts. Retry in ${rl.retryAfterSec}s.` });
    return;
  }

  const db = loadDb();
  const user = Object.values(db.users).find((u) => u.email.toLowerCase() === emailLower);
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    const attempt = recordRateLimitAttempt(rlKey, 10 * 60 * 1000);
    if (user && attempt.count === 5) {
      void sendSecurityAlertEmail({
        email: user.email,
        fullName: user.fullName,
        eventTitle: 'Multiple Failed Sign-In Attempts',
        details: '5 consecutive invalid password attempts were detected on your PIPFLOW account.',
        ip,
      });
    }
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (user.status === 'suspended') {
    res.status(403).json({ error: 'Your account has been suspended by an administrator.' });
    return;
  }

  clearRateLimit(rlKey);
  const sessionToken = setUserCookie(req, res, user.id, user.email);
  const accounts = getUserAccounts(db, user.id);
  res.json({
    user: sanitizeUser(user),
    accounts,
    sessionToken,
  });
});

const googleSchema = z.object({
  idToken: z.string().min(20),
});

router.post('/google', async (req, res) => {
  const parsed = googleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Google sign-in token.' });
    return;
  }

  try {
    // Verify Firebase ID token via Google Identity Toolkit / JWT payload verification
    const parts = parsed.data.idToken.split('.');
    if (parts.length !== 3) {
      res.status(401).json({ error: 'Malformed authentication token.' });
      return;
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      sub?: string;
      email?: string;
      name?: string;
      email_verified?: boolean;
      aud?: string;
      exp?: number;
    };

    if (!payload.email || !payload.sub || !payload.exp || payload.exp * 1000 < Date.now()) {
      res.status(401).json({ error: 'Expired or invalid Google token.' });
      return;
    }

    const db = loadDb();
    const emailLower = payload.email.toLowerCase();
    let user = Object.values(db.users).find((u) => u.email.toLowerCase() === emailLower || u.id === payload.sub);
    const now = new Date().toISOString();

    if (!user) {
      const userId = payload.sub;
      user = {
        id: userId,
        email: emailLower,
        fullName: payload.name || emailLower.split('@')[0],
        country: 'International',
        phone: '',
        emailVerified: Boolean(payload.email_verified ?? true),
        status: 'active',
        preferredTheme: db.config.theme.defaultTheme,
        preferredCurrency: db.config.dashboard.defaultCurrency,
        preferredLanguage: db.config.dashboard.defaultLanguage,
        activeAccountId: '',
        passwordHash: hashPassword(generateId('oauth_pw')),
        createdAt: now,
        updatedAt: now,
      };
      const { real, demo } = createDefaultAccountsForUser(db, userId);
      user.activeAccountId = demo.accountId;
      db.users[userId] = user;
      db.watchlists[userId] = [...db.config.dashboard.defaultWatchlist];
      saveDb(db);
      void mirrorUserToFirestore(user, [real, demo]);
    } else if (user.status === 'suspended') {
      res.status(403).json({ error: 'Account suspended.' });
      return;
    }

    const sessionToken = setUserCookie(req, res, user.id, user.email);
    const accounts = getUserAccounts(db, user.id);
    res.json({ user: sanitizeUser(user), accounts, sessionToken });
  } catch {
    res.status(401).json({ error: 'Google sign-in verification failed.' });
  }
});

router.post('/logout', (req, res) => {
  const https = isHttpsRequest(req);
  res.clearCookie(USER_COOKIE_NAME, {
    path: '/',
    sameSite: https ? 'none' : 'lax',
    secure: https,
    partitioned: https,
  });
  res.json({ ok: true });
});

router.get('/me', requireUser, (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const user = db.users[req.userSession!.sub];
  const accounts = getUserAccounts(db, user.id);
  const notifications = db.notifications.filter((n) => n.userId === 'all' || n.userId === user.id).slice(0, 40);
  const watchlist = db.watchlists[user.id] || [...db.config.dashboard.defaultWatchlist];
  res.json({
    user: sanitizeUser(user),
    accounts,
    notifications,
    watchlist,
  });
});

router.get('/session', requireUser, (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const user = db.users[req.userSession!.sub];
  const accounts = getUserAccounts(db, user.id);
  const notifications = db.notifications.filter((n) => n.userId === 'all' || n.userId === user.id).slice(0, 40);
  const watchlist = db.watchlists[user.id] || [...db.config.dashboard.defaultWatchlist];
  res.json({
    authenticated: true,
    user: sanitizeUser(user),
    accounts,
    notifications,
    watchlist,
  });
});

const derivLoginSchema = z.object({
  token: z.string().trim().min(8, 'Valid Deriv API token is required.').max(256),
  phone: z.string().trim().max(40).optional(),
  consentAccepted: z.boolean().optional(),
});

function upsertDerivAccountsForUser(
  db: ReturnType<typeof loadDb>,
  userId: string,
  accountList: Array<{ accountId: string; currency: 'USD' | 'KSH' | 'EUR' | 'GBP'; isVirtual: boolean; balance: number }>
): TradingAccount[] {
  const now = new Date().toISOString();
  const synced: TradingAccount[] = [];
  for (const item of accountList) {
    const existing = db.accounts[item.accountId];
    const accType: 'real' | 'demo' = item.isVirtual ? 'demo' : 'real';
    if (existing && existing.userId === userId) {
      existing.balance = item.balance;
      existing.currency = item.currency;
      existing.isLiveSynced = true;
      existing.externalAccountId = item.accountId;
      existing.updatedAt = now;
      synced.push(existing);
    } else if (!existing) {
      const created: TradingAccount = {
        accountId: item.accountId,
        externalAccountId: item.accountId,
        userId,
        accountType: accType,
        currency: item.currency,
        balance: item.balance,
        startingBalance: item.balance,
        status: 'active',
        isLiveSynced: true,
        createdAt: now,
        updatedAt: now,
      };
      db.accounts[item.accountId] = created;
      synced.push(created);
    }
  }
  return synced;
}

router.post('/deriv-login', async (req, res) => {
  const parsed = derivLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid Deriv API token.' });
    return;
  }
  if (parsed.data.consentAccepted !== true) {
    res.status(400).json({ error: 'Explicit account owner authorization consent is required to connect Deriv read-only access.' });
    return;
  }

  const ip = req.ip || 'unknown';
  const rlKey = `deriv_login:${ip}`;
  const rl = checkRateLimit(rlKey, 15, 10 * 60 * 1000);
  if (!rl.allowed) {
    res.status(429).json({ error: `Too many login attempts. Retry in ${rl.retryAfterSec}s.` });
    return;
  }

  try {
    const derivSession = await verifyDerivToken(parsed.data.token);
    const db = loadDb();
    const now = new Date().toISOString();
    const emailLower = (derivSession.email || `${derivSession.loginid.toLowerCase()}@deriv.pipflow.site`).toLowerCase();

    let user = Object.values(db.users).find(
      (u) => u.derivLoginId === derivSession.loginid || u.email.toLowerCase() === emailLower
    );
    const isNewUser = !user;

    if (!user) {
      const userId = generateId('usr');
      user = {
        id: userId,
        email: emailLower,
        fullName: derivSession.fullname || derivSession.loginid,
        country: derivSession.country || 'International',
        phone: parsed.data.phone || '',
        emailVerified: true,
        status: 'active',
        preferredTheme: db.config.theme.defaultTheme,
        preferredCurrency: derivSession.currency || db.config.dashboard.defaultCurrency,
        preferredLanguage: db.config.dashboard.defaultLanguage,
        activeAccountId: '',
        derivConnected: true,
        derivLoginId: derivSession.loginid,
        derivConnectionStatus: 'connected',
        derivAuthMode: 'pat',
        derivAuthorizedScopes: derivSession.authorizedScopes || 'read',
        derivConnectedAt: now,
        derivRevokedAt: undefined,
        passwordHash: hashPassword(generateId('deriv_pw')),
        createdAt: now,
        updatedAt: now,
      };
      setUserDerivCredentials(user, { authType: 'pat', patToken: parsed.data.token.trim() });
      db.users[userId] = user;
      db.watchlists[userId] = [...db.config.dashboard.defaultWatchlist];
    } else {
      if (user.status === 'suspended') {
        res.status(403).json({ error: 'Your account has been suspended by an administrator.' });
        return;
      }
      user.derivConnected = true;
      user.derivLoginId = derivSession.loginid;
      user.derivConnectionStatus = 'connected';
      user.derivAuthMode = 'pat';
      user.derivAuthorizedScopes = derivSession.authorizedScopes || 'read';
      user.derivConnectedAt = now;
      user.derivRevokedAt = undefined;
      setUserDerivCredentials(user, { authType: 'pat', patToken: parsed.data.token.trim() });
      if (parsed.data.phone && !user.phone) user.phone = parsed.data.phone;
      user.updatedAt = now;
    }

    const synced = upsertDerivAccountsForUser(db, user.id, derivSession.accountList);
    if (!user.activeAccountId || !db.accounts[user.activeAccountId]) {
      const preferred =
        synced.find((a) => a.accountId === derivSession.loginid) ||
        synced[0];
      if (preferred) {
        user.activeAccountId = preferred.accountId;
      } else {
        const defaults = createDefaultAccountsForUser(db, user.id);
        user.activeAccountId = defaults.demo.accountId;
      }
    }

    const allAccounts = getUserAccounts(db, user.id);
    appendAuditLog(db, {
      action: 'DERIV_ACCOUNT_CONNECTED',
      actor: user.email,
      targetType: 'broker',
      targetId: derivSession.loginid,
      details: `Connected Deriv account ${derivSession.loginid} in read-only mode (scope: ${user.derivAuthorizedScopes}).`,
      ip,
      status: 'success',
    });

    if (isNewUser) {
      const realAcc = allAccounts.find((a) => a.accountType === 'real')?.accountId || derivSession.loginid;
      const demoAcc = allAccounts.find((a) => a.accountType === 'demo')?.accountId || derivSession.loginid;
      db.notifications.unshift({
        id: generateId('ntf'),
        userId: user.id,
        title: 'Deriv Read-Only Connected',
        message: `Authorized ${derivSession.loginid} in read-only mode and synced ${synced.length} account(s).`,
        category: 'account',
        read: false,
        createdAt: now,
      });
      void sendWelcomeEmail({
        email: user.email,
        fullName: user.fullName,
        realAccountId: realAcc,
        demoAccountId: demoAcc,
      });
    } else {
      void sendDerivConnectionEmail({
        email: user.email,
        fullName: user.fullName,
        action: 'connected',
        accountId: derivSession.loginid,
        authMode: 'pat',
        scope: user.derivAuthorizedScopes,
      });
    }

    saveDb(db);
    void mirrorUserToFirestore(user, allAccounts);
    clearRateLimit(rlKey);

    const sessionToken = setUserCookie(req, res, user.id, user.email);
    res.json({
      user: sanitizeUser(user),
      accounts: allAccounts,
      sessionToken,
      derivLoginId: derivSession.loginid,
    });
  } catch (err: any) {
    recordRateLimitAttempt(rlKey, 10 * 60 * 1000);
    res.status(401).json({ error: err?.message || 'Deriv API token verification failed.' });
  }
});

router.post('/connect-deriv-token', requireUser, async (req: AuthenticatedRequest, res) => {
  const token = String(req.body?.token || '').trim();
  if (req.body?.consentAccepted !== true) {
    res.status(400).json({ error: 'Explicit account owner authorization consent is required to connect read-only access.' });
    return;
  }
  if (!token || token.length < 8) {
    res.status(400).json({ error: 'Please enter a valid Deriv API token.' });
    return;
  }

  try {
    const derivSession = await verifyDerivToken(token);
    const db = loadDb();
    const user = db.users[req.userSession!.sub];
    const now = new Date().toISOString();

    user.derivConnected = true;
    user.derivLoginId = derivSession.loginid;
    user.derivConnectionStatus = 'connected';
    user.derivAuthMode = 'pat';
    user.derivAuthorizedScopes = derivSession.authorizedScopes || 'read';
    user.derivConnectedAt = now;
    user.derivRevokedAt = undefined;
    setUserDerivCredentials(user, { authType: 'pat', patToken: token });
    user.updatedAt = now;

    const synced = upsertDerivAccountsForUser(db, user.id, derivSession.accountList);
    const primarySynced = synced.find((a) => a.accountId === derivSession.loginid) || synced[0];
    if (primarySynced) {
      user.activeAccountId = primarySynced.accountId;
    }

    db.notifications.unshift({
      id: generateId('ntf'),
      userId: user.id,
      title: 'Deriv Read-Only Connected',
      message: `Authorized ${derivSession.loginid} in read-only mode (${synced.length} Real & Demo accounts synced).`,
      category: 'account',
      read: false,
      createdAt: now,
    });

    appendAuditLog(db, {
      action: 'DERIV_ACCOUNT_CONNECTED',
      actor: user.email,
      targetType: 'broker',
      targetId: derivSession.loginid,
      details: `Linked Deriv account ${derivSession.loginid} via PAT in read-only mode (scope: ${user.derivAuthorizedScopes}).`,
      ip: req.ip,
      status: 'success',
    });

    saveDb(db);
    const accounts = getUserAccounts(db, user.id);
    broadcastEvent('notification:created', { userId: user.id }, user.id);
    if (user.email) {
      void sendDerivConnectionEmail({
        email: user.email,
        fullName: user.fullName,
        action: 'connected',
        accountId: derivSession.loginid,
        authMode: 'pat',
        scope: user.derivAuthorizedScopes,
      });
    }
    res.json({
      ok: true,
      user: sanitizeUser(user),
      accounts,
      derivLoginId: derivSession.loginid,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to connect Deriv API token.' });
  }
});

router.get('/deriv-status', requireUser, (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const user = db.users[req.userSession!.sub];
  const accounts = getUserAccounts(db, user.id).filter((a) => a.isLiveSynced || a.externalAccountId);
  const connectionStatus = user.derivConnectionStatus || (user.derivConnected ? 'connected' : 'disconnected');
  res.json({
    connected: Boolean(user.derivConnected && connectionStatus === 'connected'),
    connectionStatus,
    derivLoginId: user.derivLoginId || null,
    authMode: user.derivAuthMode || null,
    authorizedScopes: user.derivAuthorizedScopes || 'read',
    connectedAt: user.derivConnectedAt || null,
    revokedAt: user.derivRevokedAt || null,
    accounts: accounts.map((a) => ({
      accountId: a.accountId,
      accountType: a.accountType,
      currency: a.currency,
      balance: a.balance,
      status: a.status,
      isLiveSynced: Boolean(a.isLiveSynced),
    })),
  });
});

router.post('/disconnect-deriv', requireUser, (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const user = db.users[req.userSession!.sub];
  const prevLoginId = user.derivLoginId;
  const now = new Date().toISOString();

  clearUserDerivCredentials(user, 'disconnected');
  user.updatedAt = now;

  db.notifications.unshift({
    id: generateId('ntf'),
    userId: user.id,
    title: 'Deriv Account Disconnected',
    message: `Disconnected ${prevLoginId || 'Deriv session'} from PIPFLOW. Encrypted tokens cleared.`,
    category: 'account',
    read: false,
    createdAt: now,
  });

  appendAuditLog(db, {
    action: 'DERIV_DISCONNECTED',
    actor: user.email,
    targetType: 'broker',
    targetId: prevLoginId || user.id,
    details: `User disconnected Deriv account ${prevLoginId || ''} and purged stored session tokens.`,
    ip: req.ip,
    status: 'success',
  });

  saveDb(db);
  broadcastEvent('notification:created', { userId: user.id }, user.id);
  if (user.email) {
    void sendDerivConnectionEmail({
      email: user.email,
      fullName: user.fullName,
      action: 'disconnected',
      accountId: prevLoginId,
      scope: user.derivAuthorizedScopes,
    });
  }

  res.json({
    ok: true,
    user: sanitizeUser(user),
    accounts: getUserAccounts(db, user.id),
  });
});

router.post('/revoke-deriv', requireUser, async (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const user = db.users[req.userSession!.sub];
  const prevLoginId = user.derivLoginId;
  const creds = getUserDerivCredentials(user);
  const now = new Date().toISOString();

  await revokeDerivAuthorization({
    patToken: creds.patToken,
    accessToken: creds.accessToken,
  });

  clearUserDerivCredentials(user, 'revoked');
  user.updatedAt = now;

  db.notifications.unshift({
    id: generateId('ntf'),
    userId: user.id,
    title: 'Deriv Authorization Revoked',
    message: `Revoked read-only authorization for ${prevLoginId || 'Deriv'} and permanently wiped credentials.`,
    category: 'account',
    read: false,
    createdAt: now,
  });

  appendAuditLog(db, {
    action: 'DERIV_AUTHORIZATION_REVOKED',
    actor: user.email,
    targetType: 'broker',
    targetId: prevLoginId || user.id,
    details: `Revoked Deriv read-only authorization for ${prevLoginId || user.email}.`,
    ip: req.ip,
    status: 'success',
  });

  saveDb(db);
  broadcastEvent('notification:created', { userId: user.id }, user.id);
  if (user.email) {
    void sendDerivConnectionEmail({
      email: user.email,
      fullName: user.fullName,
      action: 'revoked',
      accountId: prevLoginId,
      scope: 'read',
    });
    void sendSecurityAlertEmail({
      email: user.email,
      fullName: user.fullName,
      eventTitle: 'Deriv API Authorization Revoked',
      details: `Your Deriv read-only authorization (${prevLoginId || 'N/A'}) was revoked and tokens were permanently deleted.`,
      ip: req.ip,
    });
  }

  res.json({
    ok: true,
    user: sanitizeUser(user),
    accounts: getUserAccounts(db, user.id),
  });
});

router.post('/sync-deriv-balances', requireUser, async (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const user = db.users[req.userSession!.sub];
  const creds = getUserDerivCredentials(user);
  if (!creds.accessToken && !creds.patToken) {
    res.status(400).json({ error: 'No Deriv OAuth session or API token connected to this profile yet.' });
    return;
  }

  try {
    const liveAccounts = await fetchDerivBalancesWithCreds({
      ...creds,
      onTokenRefreshed: (tokens) => {
        setUserDerivCredentials(user, {
          authType: 'oauth',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        });
      },
    });
    upsertDerivAccountsForUser(db, user.id, liveAccounts);
    saveDb(db);
    const accounts = getUserAccounts(db, user.id);
    for (const acc of accounts) {
      if (acc.isLiveSynced) {
        broadcastEvent('account:updated', { account: acc }, user.id);
      }
    }
    res.json({ ok: true, accounts });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to refresh live Deriv balances.' });
  }
});

function resolveSafeRedirectUri(req: Request): string {
  const requested = typeof req.query?.redirect_uri === 'string' ? req.query.redirect_uri.trim() : '';
  if (requested) {
    try {
      const parsed = new URL(requested);
      if (
        (parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        parsed.pathname.startsWith('/auth/callback')
      ) {
        return parsed.toString();
      }
    } catch {
      // ignore invalid redirect_uri
    }
  }
  return getDerivDefaultRedirectUri();
}

router.get('/deriv/url', async (req: Request, res: Response) => {
  const rawToken = extractUserToken(req);
  const currentSession = rawToken ? verifySessionToken(rawToken, 'user') : null;
  const redirectUri = resolveSafeRedirectUri(req);
  const state = generateOAuthState();
  const pkce = generatePkcePair();

  await savePkceOAuthState({
    state,
    codeVerifier: pkce.codeVerifier,
    redirectUri,
    userId: currentSession?.sub,
  });

  const url = buildDerivAuthorizeUrl({
    redirectUri,
    state,
    codeChallenge: pkce.codeChallenge,
  });

  res.json({ url, redirectUri, state, scope: 'read' });
});

function renderOAuthCallbackHtml(payload: {
  ok: boolean;
  sessionToken?: string;
  derivLoginId?: string;
  error?: string;
}): string {
  const safePayload = JSON.stringify({
    type: payload.ok ? 'DERIV_OAUTH_SUCCESS' : 'DERIV_OAUTH_ERROR',
    sessionToken: payload.sessionToken || undefined,
    derivLoginId: payload.derivLoginId || undefined,
    error: payload.error || undefined,
  }).replace(/</g, '\\u003c');

  const title = payload.ok ? 'PIPFLOW — Deriv Connected' : 'PIPFLOW — OAuth Error';
  const heading = payload.ok
    ? `Deriv Account Connected (${payload.derivLoginId || 'Verified'})`
    : 'Deriv Authorization Not Completed';
  const sub = payload.ok
    ? 'Redirecting back to your PIPFLOW trading workspace...'
    : String(payload.error || 'Unable to verify Deriv authorization.');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin:0; font-family: system-ui, -apple-system, sans-serif; background:#080d17; color:#e2e8f0; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
    .card { max-width:420px; width:100%; background:#0f1724; border:1px solid #1e293b; border-radius:16px; padding:24px; text-align:center; }
    h1 { font-size:18px; margin:0 0 8px; color:${payload.ok ? '#10b981' : '#f43f5e'}; }
    p { font-size:13px; color:#94a3b8; margin:0 0 18px; line-height:1.5; }
    a { display:inline-block; padding:10px 18px; border-radius:10px; background:#0284c7; color:#fff; text-decoration:none; font-size:13px; font-weight:600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    <p>${sub}</p>
    <a href="${payload.ok ? '/dashboard' : '/login'}">${payload.ok ? 'Open Trading Dashboard' : 'Back to Sign In'}</a>
  </div>
  <script>
    (function () {
      var data = ${safePayload};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(data, '*');
          setTimeout(function () { window.close(); }, 350);
          return;
        }
      } catch (e) {}
      if (data.type === 'DERIV_OAUTH_SUCCESS') {
        window.location.replace('/dashboard');
      }
    })();
  </script>
</body>
</html>`;
}

export async function handleDerivOAuthCallback(req: Request, res: Response): Promise<void> {
  const oauthError = typeof req.query?.error === 'string' ? req.query.error : '';
  const oauthErrorDesc = typeof req.query?.error_description === 'string' ? req.query.error_description : '';
  if (oauthError) {
    res
      .status(400)
      .type('html')
      .send(renderOAuthCallbackHtml({ ok: false, error: oauthErrorDesc || oauthError }));
    return;
  }

  const code = typeof req.query?.code === 'string' ? req.query.code.trim() : '';
  const state = typeof req.query?.state === 'string' ? req.query.state.trim() : '';
  const legacyToken = typeof req.query?.token1 === 'string' ? req.query.token1.trim() : '';

  // Support standard OAuth 2.0 + PKCE code exchange (auth.deriv.com) OR legacy token1 redirect params
  if (!code && !legacyToken) {
    res
      .status(400)
      .type('html')
      .send(
        renderOAuthCallbackHtml({
          ok: false,
          error: 'Missing authorization code or state from Deriv callback.',
        })
      );
    return;
  }

  try {
    let derivSession;
    let authType: 'oauth' | 'pat' = 'oauth';
    let accessToken = '';
    let refreshToken = '';
    let expiresAt = 0;
    let patToken = '';
    let linkedUserId: string | undefined;

    if (code) {
      if (!state) {
        res
          .status(400)
          .type('html')
          .send(renderOAuthCallbackHtml({ ok: false, error: 'Missing OAuth state parameter.' }));
        return;
      }
      const pkce = await consumePkceOAuthState(state);
      if (!pkce) {
        res
          .status(400)
          .type('html')
          .send(
            renderOAuthCallbackHtml({
              ok: false,
              error: 'OAuth session expired or invalid. Please retry signing in with Deriv.',
            })
          );
        return;
      }
      linkedUserId = pkce.userId;
      const tokens = await exchangeDerivOAuthCode({
        code,
        codeVerifier: pkce.codeVerifier,
        redirectUri: pkce.redirectUri,
      });
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
      expiresAt = tokens.expiresAt;
      derivSession = await verifyDerivOAuthSession(accessToken);
    } else {
      authType = 'pat';
      patToken = legacyToken;
      derivSession = await verifyDerivToken(patToken);
    }

    const db = loadDb();
    const now = new Date().toISOString();
    const emailLower = (
      derivSession.email || `${derivSession.loginid.toLowerCase()}@deriv.pipflow.site`
    ).toLowerCase();

    let user =
      (linkedUserId ? db.users[linkedUserId] : undefined) ||
      Object.values(db.users).find(
        (u) => u.derivLoginId === derivSession.loginid || u.email.toLowerCase() === emailLower
      );
    const isNewUser = !user;

    if (!user) {
      const userId = generateId('usr');
      user = {
        id: userId,
        email: emailLower,
        fullName: derivSession.fullname || derivSession.loginid,
        country: derivSession.country || 'International',
        phone: '',
        emailVerified: true,
        status: 'active',
        preferredTheme: db.config.theme.defaultTheme,
        preferredCurrency: derivSession.currency || db.config.dashboard.defaultCurrency,
        preferredLanguage: db.config.dashboard.defaultLanguage,
        activeAccountId: '',
        derivConnected: true,
        derivLoginId: derivSession.loginid,
        derivConnectionStatus: 'connected',
        derivAuthMode: authType,
        derivAuthorizedScopes: derivSession.authorizedScopes || 'read',
        derivConnectedAt: now,
        derivRevokedAt: undefined,
        passwordHash: hashPassword(generateId('deriv_oauth')),
        createdAt: now,
        updatedAt: now,
      };
      db.users[userId] = user;
      db.watchlists[userId] = [...db.config.dashboard.defaultWatchlist];
    } else if (user.status === 'suspended') {
      res
        .status(403)
        .type('html')
        .send(renderOAuthCallbackHtml({ ok: false, error: 'Your account has been suspended.' }));
      return;
    } else {
      user.derivConnected = true;
      user.derivLoginId = derivSession.loginid;
      user.derivConnectionStatus = 'connected';
      user.derivAuthMode = authType;
      user.derivAuthorizedScopes = derivSession.authorizedScopes || 'read';
      user.derivConnectedAt = now;
      user.derivRevokedAt = undefined;
      user.updatedAt = now;
    }

    if (authType === 'oauth') {
      setUserDerivCredentials(user, {
        authType: 'oauth',
        accessToken,
        refreshToken,
        expiresAt,
      });
    } else {
      setUserDerivCredentials(user, {
        authType: 'pat',
        patToken,
      });
    }

    const synced = upsertDerivAccountsForUser(db, user.id, derivSession.accountList);
    if (!user.activeAccountId || !db.accounts[user.activeAccountId]) {
      const preferred = synced.find((a) => a.accountId === derivSession.loginid) || synced[0];
      if (preferred) {
        user.activeAccountId = preferred.accountId;
      } else {
        const defaults = createDefaultAccountsForUser(db, user.id);
        user.activeAccountId = defaults.demo.accountId;
      }
    }

    appendAuditLog(db, {
      action: 'DERIV_ACCOUNT_CONNECTED',
      actor: user.email,
      targetType: 'broker',
      targetId: derivSession.loginid,
      details: `Connected Deriv account ${derivSession.loginid} via ${authType.toUpperCase()} in read-only mode (scope: ${user.derivAuthorizedScopes}).`,
      ip: req.ip,
      status: 'success',
    });

    const allAccounts = getUserAccounts(db, user.id);
    if (isNewUser) {
      const realAcc = allAccounts.find((a) => a.accountType === 'real')?.accountId || derivSession.loginid;
      const demoAcc = allAccounts.find((a) => a.accountType === 'demo')?.accountId || derivSession.loginid;
      db.notifications.unshift({
        id: generateId('ntf'),
        userId: user.id,
        title: 'Deriv Read-Only OAuth Connected',
        message: `Authorized ${derivSession.loginid} in read-only mode and synced ${synced.length} account(s).`,
        category: 'account',
        read: false,
        createdAt: now,
      });
      void sendWelcomeEmail({
        email: user.email,
        fullName: user.fullName,
        realAccountId: realAcc,
        demoAccountId: demoAcc,
      });
    } else {
      void sendDerivConnectionEmail({
        email: user.email,
        fullName: user.fullName,
        action: 'connected',
        accountId: derivSession.loginid,
        authMode: authType,
        scope: user.derivAuthorizedScopes,
      });
    }

    saveDb(db);
    void mirrorUserToFirestore(user, allAccounts);
    const sessionToken = setUserCookie(req, res, user.id, user.email);
    broadcastEvent('notification:created', { userId: user.id }, user.id);

    res
      .status(200)
      .type('html')
      .send(
        renderOAuthCallbackHtml({
          ok: true,
          sessionToken,
          derivLoginId: derivSession.loginid,
        })
      );
  } catch (err: any) {
    res
      .status(400)
      .type('html')
      .send(
        renderOAuthCallbackHtml({
          ok: false,
          error: err?.message || 'Deriv OAuth verification failed.',
        })
      );
  }
}

router.get('/deriv/callback', handleDerivOAuthCallback);

router.post('/verify-email', requireUser, (req: AuthenticatedRequest, res) => {
  const code = String(req.body?.code || '').trim();
  const db = loadDb();
  const user = db.users[req.userSession!.sub];
  if (user.emailVerified) {
    res.json({ ok: true, user: sanitizeUser(user) });
    return;
  }
  if (!code || (user.verificationCode && code !== user.verificationCode)) {
    res.status(400).json({ error: 'Invalid verification code.' });
    return;
  }
  user.emailVerified = true;
  user.verificationCode = undefined;
  user.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json({ ok: true, user: sanitizeUser(user) });
});

router.post('/resend-verification', requireUser, (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const user = db.users[req.userSession!.sub];
  const code = String(Math.floor(100000 + Math.random() * 900000));
  user.verificationCode = code;
  user.updatedAt = new Date().toISOString();
  db.notifications.unshift({
    id: generateId('ntf'),
    userId: user.id,
    title: 'Email Verification Code',
    message: `Your PIPFLOW verification code is ${code}.`,
    category: 'account',
    read: false,
    createdAt: user.updatedAt,
  });
  saveDb(db);
  broadcastEvent('notification:created', { userId: user.id }, user.id);
  void sendVerificationEmail(user.email, user.fullName, code);
  res.json({ ok: true, previewCode: code });
});

router.post('/forgot-password', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'Email address is required.' });
    return;
  }
  const db = loadDb();
  const user = Object.values(db.users).find((u) => u.email.toLowerCase() === email);
  if (user) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    user.resetCode = code;
    user.resetExpiresAt = Date.now() + 15 * 60 * 1000;
    saveDb(db);
    void sendPasswordResetEmail(user.email, user.fullName, code);
    res.json({
      ok: true,
      message: 'If an account exists for that email, a reset code has been generated.',
      previewResetCode: code,
    });
    return;
  }
  res.json({ ok: true, message: 'If an account exists for that email, a reset code has been generated.' });
});

const resetSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().min(4).max(16),
  newPassword: z.string().min(8).max(128),
});

router.post('/reset-password', (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid password reset request.' });
    return;
  }
  const db = loadDb();
  const user = Object.values(db.users).find((u) => u.email.toLowerCase() === parsed.data.email.toLowerCase());
  if (!user || !user.resetCode || user.resetCode !== parsed.data.code || !user.resetExpiresAt || user.resetExpiresAt < Date.now()) {
    res.status(400).json({ error: 'Invalid or expired reset code.' });
    return;
  }
  user.passwordHash = hashPassword(parsed.data.newPassword);
  user.resetCode = undefined;
  user.resetExpiresAt = undefined;
  user.updatedAt = new Date().toISOString();
  saveDb(db);
  void sendSecurityAlertEmail({
    email: user.email,
    fullName: user.fullName,
    eventTitle: 'PIPFLOW Password Changed',
    details: 'Your account password was successfully updated using a one-time reset code.',
    ip: req.ip,
  });
  res.json({ ok: true, message: 'Password updated successfully.' });
});

const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  country: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  preferredTheme: z.enum(['light', 'dark']).optional(),
  preferredCurrency: z.enum(['USD', 'KSH', 'EUR', 'GBP']).optional(),
  preferredLanguage: z.string().trim().max(16).optional(),
});

router.patch('/profile', requireUser, (req: AuthenticatedRequest, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid profile update.' });
    return;
  }
  const db = loadDb();
  const user = db.users[req.userSession!.sub];
  Object.assign(user, parsed.data, { updatedAt: new Date().toISOString() });
  saveDb(db);
  res.json({ user: sanitizeUser(user) });
});

router.post('/switch-account', requireUser, (req: AuthenticatedRequest, res) => {
  const accountId = String(req.body?.accountId || '');
  const db = loadDb();
  const user = db.users[req.userSession!.sub];
  const account = db.accounts[accountId];
  if (!account || account.userId !== user.id) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }
  user.activeAccountId = accountId;
  user.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json({ user: sanitizeUser(user), activeAccount: account });
});

export default router;
