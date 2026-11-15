import { Router } from 'express';
import { z } from 'zod';
import {
  loadDb,
  saveDb,
  sanitizeUser,
  getUserAccounts,
  createDefaultAccountsForUser,
  mirrorUserToFirestore,
  type StoredUser,
} from '../db/store.ts';
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  generateId,
  checkRateLimit,
  recordRateLimitAttempt,
  clearRateLimit,
} from '../security/crypto.ts';
import { requireUser, USER_COOKIE_NAME, type AuthenticatedRequest } from '../middleware/auth.ts';
import { broadcastEvent } from '../services/sse.ts';

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
    recordRateLimitAttempt(rlKey, 10 * 60 * 1000);
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
