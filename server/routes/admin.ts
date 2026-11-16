import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { z } from 'zod';
import {
  loadDb,
  saveDb,
  sanitizeUser,
  getUserAccounts,
  appendAuditLog,
} from '../db/store.ts';
import { OFFICIAL_LOGO_PATH } from '../../src/config/app.config.ts';
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  generateId,
  generateAccountNumber,
  checkRateLimit,
  recordRateLimitAttempt,
  clearRateLimit,
} from '../security/crypto.ts';
import { requireAdmin, extractAdminToken, ADMIN_COOKIE_NAME, type AuthenticatedRequest } from '../middleware/auth.ts';
import { broadcastEvent } from '../services/sse.ts';
import {
  sendTransactionEmail,
  sendAnnouncementEmail,
  sendSecurityAlertEmail,
  isBrevoConfigured,
} from '../services/brevo.ts';
import { sendPushToAll, sendPushToUser } from '../services/push.ts';
import { getDerivConfigStatus } from '../services/deriv.ts';
import { derivMarketFeed } from '../services/derivMarketFeed.ts';
import { getNeonStatus } from '../db/neon.ts';

const router = Router();

const UPLOADS_DIR = path.resolve(process.cwd(), 'public', 'uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported logo file format. Allowed: PNG, SVG, WebP, JPG, ICO.'));
    }
  },
});

function getConfiguredAdminHash(): string | null {
  const db = loadDb();
  if (db.adminPasswordHash && db.adminPasswordHash.trim().length > 8) {
    return db.adminPasswordHash.trim();
  }
  const envHash = process.env.PIPFLOW_ADMIN_PASSWORD_HASH;
  if (envHash && envHash.trim().length > 8) {
    return envHash.trim();
  }
  return null;
}

function isHttpsRequest(req: any): boolean {
  const proto = String(req.headers?.['x-forwarded-proto'] || req.protocol || '');
  return Boolean(req.secure || proto.includes('https'));
}

function setAdminCookie(req: any, res: any, ttlHours: number): string {
  const token = signSessionToken(
    { sub: 'pipflow_admin', role: 'admin', sid: generateId('asid') },
    ttlHours * 3600
  );
  const https = isHttpsRequest(req);
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: https ? 'none' : 'lax',
    secure: https,
    partitioned: https,
    maxAge: ttlHours * 3600 * 1000,
    path: '/',
  });
  return token;
}

router.get('/session', (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const configuredHash = getConfiguredAdminHash();
  const token = extractAdminToken(req);
  const hasCookie = Boolean(token);
  const session = verifySessionToken(token, 'admin');
  res.json({
    authenticated: Boolean(session),
    needsBootstrap: !configuredHash,
    usingEnvHash: !db.adminPasswordHash && Boolean(process.env.PIPFLOW_ADMIN_PASSWORD_HASH),
    ttlHours: db.adminSessionTtlHours,
    analysisAutoTradeEnabled: db.analysisAutoTradeEnabled !== false,
    analysisAutoPasswordConfigured: Boolean(db.analysisAutoTradePasswordHash),
    expiresAt: session ? new Date(session.exp * 1000).toISOString() : null,
    hasCookie,
  });
});

router.post('/bootstrap', (req, res) => {
  const db = loadDb();
  if (getConfiguredAdminHash()) {
    res.status(403).json({ error: 'Administrator credential is already configured.' });
    return;
  }
  const password = String(req.body?.password || '');
  if (password.length < 8) {
    res.status(400).json({ error: 'Administrator password must be at least 8 characters.' });
    return;
  }
  db.adminPasswordHash = hashPassword(password);
  appendAuditLog(db, {
    action: 'ADMIN_BOOTSTRAP',
    actor: 'admin',
    targetType: 'auth',
    details: 'Initial administrator credential configured via hidden entry modal.',
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  const adminToken = setAdminCookie(req, res, db.adminSessionTtlHours || 8);
  res.json({ ok: true, authenticated: true, adminToken });
});

router.post('/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  const rlKey = `admin_login:${ip}`;
  const rl = checkRateLimit(rlKey, 25, 15 * 60 * 1000);
  if (!rl.allowed) {
    res.status(429).json({ error: `Too many failed administrator attempts. Locked for ${rl.retryAfterSec}s.` });
    return;
  }

  const password = String(req.body?.password || '');
  const db = loadDb();
  const storedHash = getConfiguredAdminHash();

  if (!storedHash) {
    res.status(400).json({ error: 'Administrator password not initialized yet.', needsBootstrap: true });
    return;
  }

  const valid = await verifyPassword(password, storedHash);
  if (!valid) {
    const attempt = recordRateLimitAttempt(rlKey, 15 * 60 * 1000);
    appendAuditLog(db, {
      action: 'ADMIN_LOGIN_FAILED',
      actor: 'unknown',
      targetType: 'auth',
      details: 'Invalid administrator password attempt.',
      ip,
      status: 'failure',
    });
    saveDb(db);
    if (attempt.count >= 5 && db.config.branding.supportEmail) {
      void sendSecurityAlertEmail({
        email: db.config.branding.supportEmail,
        fullName: 'PIPFLOW Administrator',
        eventTitle: 'Failed Admin Control Centre Login Attempts',
        details: `Detected ${attempt.count} failed administrator login attempts from IP ${ip}.`,
        ip,
      });
    }
    res.status(401).json({ error: 'Invalid administrator password.' });
    return;
  }

  clearRateLimit(rlKey);
  appendAuditLog(db, {
    action: 'ADMIN_LOGIN',
    actor: 'admin',
    targetType: 'auth',
    details: 'Administrator authenticated into PIPFLOW Control Centre.',
    ip,
    status: 'success',
  });
  saveDb(db);
  const adminToken = setAdminCookie(req, res, db.adminSessionTtlHours || 8);
  res.json({ ok: true, authenticated: true, adminToken });
});

router.post('/logout', (req, res) => {
  const db = loadDb();
  appendAuditLog(db, {
    action: 'ADMIN_LOGOUT',
    actor: 'admin',
    targetType: 'auth',
    details: 'Administrator session closed.',
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  const https = isHttpsRequest(req);
  res.clearCookie(ADMIN_COOKIE_NAME, {
    path: '/',
    sameSite: https ? 'none' : 'lax',
    secure: https,
    partitioned: https,
  });
  res.json({ ok: true });
});

// All routes below strictly require valid Admin session
router.use(requireAdmin);

router.get('/overview', (_req, res) => {
  const db = loadDb();
  const users = Object.values(db.users);
  const accounts = Object.values(db.accounts);
  const realAccounts = accounts.filter((a) => a.accountType === 'real');
  const demoAccounts = accounts.filter((a) => a.accountType === 'demo');
  const trades = db.trades;
  const openTrades = trades.filter((t) => t.status === 'open');
  const closedTrades = trades.filter((t) => t.status === 'closed');

  const totalVolume = trades.reduce((acc, t) => acc + t.stake, 0);
  const aggregateProfits = closedTrades.filter((t) => t.profitLoss > 0).reduce((acc, t) => acc + t.profitLoss, 0);
  const aggregateLosses = closedTrades.filter((t) => t.profitLoss < 0).reduce((acc, t) => acc + Math.abs(t.profitLoss), 0);

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newRegistrations = users.filter((u) => new Date(u.createdAt).getTime() >= sevenDaysAgo).length;

  res.json({
    stats: {
      totalUsers: users.length,
      activeUsers: users.filter((u) => u.status === 'active').length,
      suspendedUsers: users.filter((u) => u.status === 'suspended').length,
      newRegistrations,
      totalRealAccounts: realAccounts.length,
      totalDemoAccounts: demoAccounts.length,
      totalRealBalance: Number(realAccounts.reduce((s, a) => s + a.balance, 0).toFixed(2)),
      totalDemoBalance: Number(demoAccounts.reduce((s, a) => s + a.balance, 0).toFixed(2)),
      totalTrades: trades.length,
      openPositions: openTrades.length,
      closedPositions: closedTrades.length,
      totalVolume: Number(totalVolume.toFixed(2)),
      aggregateProfits: Number(aggregateProfits.toFixed(2)),
      aggregateLosses: Number(aggregateLosses.toFixed(2)),
      netPlatformPnl: Number((aggregateProfits - aggregateLosses).toFixed(2)),
    },
    recentRegistrations: users.slice(-8).reverse().map(sanitizeUser),
    recentTrades: trades.slice(0, 12),
    recentAuditLogs: db.auditLogs.slice(0, 12),
    recentContacts: db.contactSubmissions.slice(0, 10),
  });
});

router.get('/stats', (_req, res) => {
  const db = loadDb();
  const users = Object.values(db.users);
  const trades = db.trades;
  const totalTradeVolume = Number(trades.reduce((acc, t) => acc + t.stake, 0).toFixed(2));
  const derivConfig = getDerivConfigStatus();
  const estimatedCommissions = Number(
    trades.reduce((acc, t) => acc + (t.commissionEstimate ?? t.stake * derivConfig.commissionRate), 0).toFixed(4)
  );
  const liveDerivUsers = users.filter((u) => u.derivConnected).length;
  const totalActiveUsers = users.filter((u) => u.status === 'active').length;

  res.json({
    totalActiveUsers,
    totalUsers: users.length,
    totalTradeVolume,
    estimatedCommissions,
    liveDerivUsers,
    derivAppId: derivConfig.appId,
    derivConfig,
    derivFeed: derivMarketFeed.getDiagnostics(),
    neonStatus: getNeonStatus(),
    brevoConfigured: isBrevoConfigured(),
    emailLogCount: db.emailLogs.length,
    pushSubscribers: db.pushSubscriptions.length,
  });
});

// AUTHORIZED DERIV CONNECTIONS MONITORING (Strict Zero-Credential View)
router.get('/connections', (_req, res) => {
  const db = loadDb();
  const connections = Object.values(db.users)
    .filter((u) => u.derivLoginId || u.derivConnected || u.derivConnectionStatus)
    .map((u) => {
      const userAccs = getUserAccounts(db, u.id);
      const syncedAccs = userAccs.filter((a) => a.isLiveSynced || a.externalAccountId);
      return {
        userId: u.id,
        email: u.email,
        fullName: u.fullName,
        derivLoginId: u.derivLoginId || 'N/A',
        connectionStatus: u.derivConnectionStatus || (u.derivConnected ? 'connected' : 'disconnected'),
        authMode: u.derivAuthMode || 'oauth',
        authorizedScopes: u.derivAuthorizedScopes || 'read',
        connectedAt: u.derivConnectedAt || u.updatedAt,
        revokedAt: u.derivRevokedAt || null,
        realAccountsCount: syncedAccs.filter((a) => a.accountType === 'real').length,
        demoAccountsCount: syncedAccs.filter((a) => a.accountType === 'demo').length,
      };
    });
  res.json({ connections });
});

// DERIV PUBLIC MARKET FEED DIAGNOSTICS
router.post('/diagnostics/deriv', async (req, res) => {
  const db = loadDb();
  const report = await derivMarketFeed.runDiagnosticCheck();
  appendAuditLog(db, {
    action: 'DERIV_DIAGNOSTIC_CHECK',
    actor: 'admin',
    targetType: 'broker',
    details: report.ok
      ? `Deriv WS feed healthy (${report.latencyMs}ms latency, ${report.instrumentCount} instruments cached).`
      : `Deriv WS diagnostic issue: ${report.error || 'Disconnected'}`,
    ip: req.ip,
    status: report.ok ? 'success' : 'failure',
  });
  saveDb(db);
  res.json(report);
});

// EMAIL DELIVERY LOGS & TEST EMAIL
router.get('/email-logs', (_req, res) => {
  const db = loadDb();
  res.json({
    brevoConfigured: isBrevoConfigured(),
    logs: (db.emailLogs || []).slice(0, 200),
  });
});

router.post('/email/test', async (req, res) => {
  const db = loadDb();
  const toEmail = String(req.body?.toEmail || db.config.branding.supportEmail || '').trim();
  if (!toEmail || !toEmail.includes('@')) {
    res.status(400).json({ error: 'Valid recipient email address is required.' });
    return;
  }
  const result = await sendAnnouncementEmail({
    email: toEmail,
    fullName: 'PIPFLOW Administrator',
    title: 'Brevo Transactional Email Diagnostic',
    message: `This diagnostic email confirms PIPFLOW Brevo delivery is operational (${new Date().toISOString()}).`,
  });
  appendAuditLog(db, {
    action: 'EMAIL_TEST_DISPATCHED',
    actor: 'admin',
    targetType: 'email',
    targetId: toEmail,
    details: result.sent
      ? `Test email delivered via Brevo to ${toEmail} (${result.messageId || 'ok'}).`
      : `Test email to ${toEmail} status: ${result.reason || 'failed'}.`,
    ip: req.ip,
    status: result.sent ? 'success' : 'failure',
  });
  saveDb(db);
  res.json({
    ...result,
    logs: loadDb().emailLogs.slice(0, 50),
  });
});

// USER MANAGEMENT
router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const db = loadDb();
  let users = Object.values(db.users).map((u) => ({
    ...sanitizeUser(u),
    accounts: getUserAccounts(db, u.id),
    tradeCount: db.trades.filter((t) => t.userId === u.id).length,
  }));

  if (q) {
    users = users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q) ||
        u.accounts.some((a) => a.accountId.toLowerCase().includes(q))
    );
  }
  res.json({ users });
});

router.get('/users/:id', (req, res) => {
  const db = loadDb();
  const user = db.users[req.params.id];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({
    user: sanitizeUser(user),
    accounts: getUserAccounts(db, user.id),
    trades: db.trades.filter((t) => t.userId === user.id).slice(0, 100),
    transactions: db.transactions.filter((t) => t.userId === user.id).slice(0, 100),
  });
});

const adminUserPatchSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  fullName: z.string().trim().min(1).max(120).optional(),
  country: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  emailVerified: z.boolean().optional(),
  status: z.enum(['active', 'suspended']).optional(),
  preferredCurrency: z.enum(['USD', 'KSH', 'EUR', 'GBP']).optional(),
  preferredTheme: z.enum(['light', 'dark']).optional(),
  preferredLanguage: z.string().trim().max(16).optional(),
  newPassword: z.string().min(6).max(128).optional(),
});

router.patch('/users/:id', (req, res) => {
  const parsed = adminUserPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user update fields' });
    return;
  }
  const db = loadDb();
  const user = db.users[req.params.id];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const { newPassword, email, ...rest } = parsed.data;
  if (email && email.toLowerCase() !== user.email.toLowerCase()) {
    const duplicate = Object.values(db.users).find((u) => u.email.toLowerCase() === email.toLowerCase() && u.id !== user.id);
    if (duplicate) {
      res.status(409).json({ error: 'Another user already uses that email address.' });
      return;
    }
    user.email = email.toLowerCase();
  }
  if (newPassword) {
    user.passwordHash = hashPassword(newPassword);
  }
  Object.assign(user, rest, { updatedAt: new Date().toISOString() });
  appendAuditLog(db, {
    action: 'USER_UPDATED',
    actor: 'admin',
    targetType: 'user',
    targetId: user.id,
    details: `Updated profile fields for ${user.email}: ${Object.keys(parsed.data).join(', ')}`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  res.json({ user: sanitizeUser(user) });
});

router.post('/users/:id/suspend', (req, res) => {
  const db = loadDb();
  const user = db.users[req.params.id];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  user.status = 'suspended';
  user.updatedAt = new Date().toISOString();
  appendAuditLog(db, {
    action: 'USER_SUSPENDED',
    actor: 'admin',
    targetType: 'user',
    targetId: user.id,
    details: `Suspended user ${user.email}. Reason: ${String(req.body?.reason || 'Policy review')}`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  res.json({ user: sanitizeUser(user) });
});

router.post('/users/:id/reactivate', (req, res) => {
  const db = loadDb();
  const user = db.users[req.params.id];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  user.status = 'active';
  user.updatedAt = new Date().toISOString();
  appendAuditLog(db, {
    action: 'USER_REACTIVATED',
    actor: 'admin',
    targetType: 'user',
    targetId: user.id,
    details: `Reactivated user ${user.email}.`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  res.json({ user: sanitizeUser(user) });
});

router.delete('/users/:id', (req, res) => {
  const db = loadDb();
  const user = db.users[req.params.id];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const email = user.email;
  delete db.users[user.id];
  for (const [accId, acc] of Object.entries(db.accounts)) {
    if (acc.userId === user.id) delete db.accounts[accId];
  }
  delete db.watchlists[user.id];
  appendAuditLog(db, {
    action: 'USER_DELETED',
    actor: 'admin',
    targetType: 'user',
    targetId: req.params.id,
    details: `Deleted user ${email} and associated trading accounts.`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  res.json({ ok: true });
});

// ACCOUNTS & BALANCE MANAGEMENT (Real ROT... & Demo DOT...)
router.get('/demo-accounts', (_req, res) => {
  const db = loadDb();
  const accounts = Object.values(db.accounts).map((acc) => {
    const owner = db.users[acc.userId];
    return {
      ...acc,
      userEmail: owner?.email || 'unknown',
      userFullName: owner?.fullName || 'Unknown User',
    };
  });
  res.json({ accounts });
});

const createAccountSchema = z.object({
  userId: z.string().min(1),
  accountType: z.enum(['real', 'demo']),
  currency: z.enum(['USD', 'KSH', 'EUR', 'GBP']).default('USD'),
  initialBalance: z.number().min(0).max(10000000).default(0),
});

router.post('/accounts', (req, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid account creation payload' });
    return;
  }
  const db = loadDb();
  const user = db.users[parsed.data.userId];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  let accountId = generateAccountNumber(parsed.data.accountType);
  while (db.accounts[accountId]) accountId = generateAccountNumber(parsed.data.accountType);

  const now = new Date().toISOString();
  const account = {
    accountId,
    userId: user.id,
    accountType: parsed.data.accountType,
    currency: parsed.data.currency,
    balance: Number(parsed.data.initialBalance.toFixed(2)),
    startingBalance: Number(parsed.data.initialBalance.toFixed(2)),
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  };
  db.accounts[accountId] = account;
  if (account.balance > 0) {
    db.transactions.unshift({
      id: generateId('tx'),
      userId: user.id,
      accountId,
      accountType: account.accountType,
      type: 'credit',
      amount: account.balance,
      balanceAfter: account.balance,
      reason: `Admin provisioned ${account.accountType.toUpperCase()} account`,
      adminActor: 'admin',
      createdAt: now,
    });
  }
  appendAuditLog(db, {
    action: 'ACCOUNT_CREATED',
    actor: 'admin',
    targetType: 'account',
    targetId: accountId,
    details: `Created ${account.accountType.toUpperCase()} account ${accountId} for ${user.email} with $${account.balance.toFixed(2)}`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  broadcastEvent('account:updated', { account }, user.id);
  res.status(201).json({ account });
});

router.patch('/accounts/:id/status', (req, res) => {
  const status = req.body?.status === 'frozen' ? 'frozen' : 'active';
  const db = loadDb();
  const account = db.accounts[req.params.id];
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  account.status = status;
  account.updatedAt = new Date().toISOString();
  appendAuditLog(db, {
    action: 'ACCOUNT_STATUS_CHANGED',
    actor: 'admin',
    targetType: 'account',
    targetId: account.accountId,
    details: `Set ${account.accountId} status to ${status}`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  broadcastEvent('account:updated', { account }, account.userId);
  res.json({ account });
});

router.patch('/accounts/:id', (req, res) => {
  const db = loadDb();
  const account = db.accounts[req.params.id];
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const currency = req.body?.currency;
  if (currency && ['USD', 'KSH', 'EUR', 'GBP'].includes(currency)) {
    account.currency = currency;
  }
  if (req.body?.status === 'active' || req.body?.status === 'frozen') {
    account.status = req.body.status;
  }
  account.updatedAt = new Date().toISOString();
  appendAuditLog(db, {
    action: 'ACCOUNT_UPDATED',
    actor: 'admin',
    targetType: 'account',
    targetId: account.accountId,
    details: `Updated ${account.accountId} (${account.currency}, ${account.status})`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  broadcastEvent('account:updated', { account }, account.userId);
  res.json({ account });
});

router.delete('/accounts/:id', (req, res) => {
  const db = loadDb();
  const account = db.accounts[req.params.id];
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const userAccounts = getUserAccounts(db, account.userId);
  if (userAccounts.length <= 1) {
    res.status(400).json({ error: 'Cannot delete the only remaining account for a user.' });
    return;
  }
  delete db.accounts[account.accountId];
  const owner = db.users[account.userId];
  if (owner && owner.activeAccountId === account.accountId) {
    const nextAcc = getUserAccounts(db, owner.id)[0];
    if (nextAcc) owner.activeAccountId = nextAcc.accountId;
  }
  appendAuditLog(db, {
    action: 'ACCOUNT_DELETED',
    actor: 'admin',
    targetType: 'account',
    targetId: account.accountId,
    details: `Deleted account ${account.accountId} owned by ${owner?.email || account.userId}`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  res.json({ ok: true });
});

const adjustBalanceSchema = z.object({
  mode: z.enum(['credit', 'debit', 'set']),
  amount: z.number().min(0).max(50000000),
  reason: z.string().trim().min(2).max(400),
});

router.post('/demo-accounts/:id/adjust', (req, res) => {
  const parsed = adjustBalanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid adjustment amount and reason are required.' });
    return;
  }
  const db = loadDb();
  const account = db.accounts[req.params.id];
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const prev = account.balance;
  let nextBalance = prev;
  let delta = 0;

  if (parsed.data.mode === 'credit') {
    delta = parsed.data.amount;
    nextBalance = Number((prev + delta).toFixed(2));
  } else if (parsed.data.mode === 'debit') {
    delta = -parsed.data.amount;
    nextBalance = Number((prev - parsed.data.amount).toFixed(2));
  } else {
    nextBalance = Number(parsed.data.amount.toFixed(2));
    delta = Number((nextBalance - prev).toFixed(2));
  }

  if (nextBalance < 0) {
    res.status(400).json({ error: 'Resulting balance cannot be negative.' });
    return;
  }

  const now = new Date().toISOString();
  account.balance = nextBalance;
  account.updatedAt = now;

  const txType = delta >= 0 ? 'credit' : 'debit';
  db.transactions.unshift({
    id: generateId('tx'),
    userId: account.userId,
    accountId: account.accountId,
    accountType: account.accountType,
    type: txType,
    amount: delta,
    balanceAfter: nextBalance,
    reason: parsed.data.reason,
    adminActor: 'admin',
    createdAt: now,
  });

  appendAuditLog(db, {
    action: 'BALANCE_ADJUSTED',
    actor: 'admin',
    targetType: 'balance',
    targetId: account.accountId,
    details: `${account.accountId} (${account.accountType.toUpperCase()}): ${prev.toFixed(2)} -> ${nextBalance.toFixed(2)} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)}). Reason: ${parsed.data.reason}`,
    ip: req.ip,
    status: 'success',
  });

  saveDb(db);
  broadcastEvent('account:updated', { account }, account.userId);

  const owner = db.users[account.userId];
  const isCredit = delta >= 0;
  const absAmount = Math.abs(delta);
  if (absAmount > 0) {
    const pushTitle = isCredit
      ? `Deposit / Credit: +${absAmount.toFixed(2)} ${account.currency}`
      : `Withdrawal / Debit: -${absAmount.toFixed(2)} ${account.currency}`;
    const pushBody = `${account.accountId}: ${parsed.data.reason}. New balance: ${nextBalance.toFixed(2)} ${account.currency}.`;

    db.notifications.unshift({
      id: generateId('ntf'),
      userId: account.userId,
      title: pushTitle,
      message: pushBody,
      category: 'account',
      read: false,
      createdAt: now,
    });
    saveDb(db);
    broadcastEvent('notification:created', { userId: account.userId }, account.userId);

    void sendPushToUser(account.userId, {
      title: pushTitle,
      body: pushBody,
      url: '/dashboard',
      tag: `adj-${account.accountId}`,
    });
    if (owner?.email) {
      void sendTransactionEmail({
        email: owner.email,
        fullName: owner.fullName,
        type: isCredit ? 'deposit' : 'withdrawal',
        amount: absAmount,
        currency: account.currency,
        accountId: account.accountId,
        balanceAfter: nextBalance,
        reason: parsed.data.reason,
      });
    }
  }

  res.json({ account });
});

router.post('/demo-accounts/:id/reset', (req, res) => {
  const db = loadDb();
  const account = db.accounts[req.params.id];
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const targetBalance =
    typeof req.body?.startingBalance === 'number' && req.body.startingBalance >= 0
      ? Number(req.body.startingBalance.toFixed(2))
      : account.accountType === 'demo'
        ? db.config.dashboard.defaultDemoBalance
        : 0;

  const prev = account.balance;
  const delta = Number((targetBalance - prev).toFixed(2));
  const now = new Date().toISOString();
  account.balance = targetBalance;
  account.startingBalance = targetBalance;
  account.updatedAt = now;

  db.transactions.unshift({
    id: generateId('tx'),
    userId: account.userId,
    accountId: account.accountId,
    accountType: account.accountType,
    type: 'reset',
    amount: delta,
    balanceAfter: targetBalance,
    reason: String(req.body?.reason || 'Administrator balance reset'),
    adminActor: 'admin',
    createdAt: now,
  });

  appendAuditLog(db, {
    action: 'BALANCE_RESET',
    actor: 'admin',
    targetType: 'balance',
    targetId: account.accountId,
    details: `Reset ${account.accountId} from $${prev.toFixed(2)} to $${targetBalance.toFixed(2)}`,
    ip: req.ip,
    status: 'success',
  });

  saveDb(db);
  broadcastEvent('account:updated', { account }, account.userId);
  res.json({ account });
});

// TRADING & P&L MANAGEMENT
router.get('/trading-activity', (_req, res) => {
  const db = loadDb();
  const trades = db.trades.slice(0, 300).map((t) => ({
    ...t,
    userEmail: db.users[t.userId]?.email || 'unknown',
  }));
  res.json({ trades });
});

router.post('/trades/:id/force-close', (req, res) => {
  const db = loadDb();
  const trade = db.trades.find((t) => t.id === req.params.id);
  if (!trade) {
    res.status(404).json({ error: 'Trade not found' });
    return;
  }
  if (trade.status === 'closed') {
    res.status(400).json({ error: 'Trade is already closed' });
    return;
  }
  const account = db.accounts[trade.accountId];
  const pnl = typeof req.body?.profitLoss === 'number' ? Number(req.body.profitLoss.toFixed(2)) : 0;
  const now = new Date().toISOString();
  trade.status = 'closed';
  trade.exitPrice = trade.entryPrice;
  trade.profitLoss = pnl;
  trade.payout = Number(Math.max(0, trade.stake + pnl).toFixed(2));
  trade.closedAt = now;

  if (account) {
    account.balance = Number(Math.max(0, account.balance + trade.payout).toFixed(2));
    account.updatedAt = now;
    db.transactions.unshift({
      id: generateId('tx'),
      userId: trade.userId,
      accountId: account.accountId,
      accountType: account.accountType,
      type: pnl >= 0 ? 'trade_win' : 'trade_loss',
      amount: trade.payout,
      balanceAfter: account.balance,
      reason: `Admin force-closed trade ${trade.id} (${trade.symbol})`,
      adminActor: 'admin',
      createdAt: now,
    });
    broadcastEvent('account:updated', { account }, account.userId);
  }
  appendAuditLog(db, {
    action: 'TRADE_FORCE_CLOSED',
    actor: 'admin',
    targetType: 'pnl',
    targetId: trade.id,
    details: `Force-closed open trade ${trade.id} (${trade.symbol}) with P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  res.json({ trade, account });
});

router.get('/demo-transactions', (_req, res) => {
  const db = loadDb();
  const transactions = db.transactions.slice(0, 300).map((tx) => ({
    ...tx,
    userEmail: db.users[tx.userId]?.email || 'unknown',
  }));
  res.json({ transactions });
});

router.get('/demo-performance', (_req, res) => {
  const db = loadDb();
  const closed = db.trades.filter((t) => t.status === 'closed');
  const open = db.trades.filter((t) => t.status === 'open');
  const realisedPnl = closed.reduce((s, t) => s + t.profitLoss, 0);
  const wins = closed.filter((t) => t.profitLoss > 0);
  const losses = closed.filter((t) => t.profitLoss < 0);

  res.json({
    summary: {
      realisedPnl: Number(realisedPnl.toFixed(2)),
      grossProfit: Number(wins.reduce((s, t) => s + t.profitLoss, 0).toFixed(2)),
      grossLoss: Number(losses.reduce((s, t) => s + Math.abs(t.profitLoss), 0).toFixed(2)),
      openCount: open.length,
      closedCount: closed.length,
      winRate: closed.length ? Number(((wins.length / closed.length) * 100).toFixed(1)) : 0,
    },
    adjustments: db.pnlAdjustments.slice(0, 100),
  });
});

const pnlAdjustSchema = z.object({
  tradeId: z.string().min(1),
  adjustmentDelta: z.number(),
  reason: z.string().trim().min(3).max(400),
});

router.post('/pnl-adjust', (req, res) => {
  const parsed = pnlAdjustSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid P&L adjustment payload' });
    return;
  }
  const db = loadDb();
  const trade = db.trades.find((t) => t.id === parsed.data.tradeId);
  if (!trade) {
    res.status(404).json({ error: 'Original trade record not found' });
    return;
  }
  const account = db.accounts[trade.accountId];
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const now = new Date().toISOString();
  const delta = Number(parsed.data.adjustmentDelta.toFixed(2));
  const nextBalance = Number(Math.max(0, account.balance + delta).toFixed(2));
  account.balance = nextBalance;
  account.updatedAt = now;

  // Preserve original trade record untouched and store separate adjustment record
  const adj = {
    id: generateId('padj'),
    tradeId: trade.id,
    userId: trade.userId,
    accountId: trade.accountId,
    originalPnl: trade.profitLoss,
    adjustmentDelta: delta,
    newPnl: Number((trade.profitLoss + delta).toFixed(2)),
    reason: parsed.data.reason,
    adminActor: 'admin',
    createdAt: now,
  };
  db.pnlAdjustments.unshift(adj);
  db.transactions.unshift({
    id: generateId('tx'),
    userId: trade.userId,
    accountId: trade.accountId,
    accountType: trade.accountType,
    type: 'pnl_adjustment',
    amount: delta,
    balanceAfter: nextBalance,
    reason: `Audited P&L adjustment for trade ${trade.id}: ${parsed.data.reason}`,
    adminActor: 'admin',
    createdAt: now,
  });

  appendAuditLog(db, {
    action: 'PNL_ADJUSTED',
    actor: 'admin',
    targetType: 'pnl',
    targetId: trade.id,
    details: `Added audited P&L adjustment ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} on ${trade.accountId}. Reason: ${parsed.data.reason}`,
    ip: req.ip,
    status: 'success',
  });

  saveDb(db);
  broadcastEvent('account:updated', { account }, account.userId);
  res.json({ adjustment: adj, account });
});

// BRANDING, LOGOS, SETTINGS, FEATURES, MARKETS
router.get('/branding', (_req, res) => {
  res.json({ branding: loadDb().config.branding });
});

router.patch('/branding', (req, res) => {
  const db = loadDb();
  const body = req.body || {};
  db.config.branding = {
    ...db.config.branding,
    ...body,
    socialLinks: {
      ...db.config.branding.socialLinks,
      ...(body.socialLinks || {}),
    },
  };
  db.config.updatedAt = new Date().toISOString();
  appendAuditLog(db, {
    action: 'BRANDING_UPDATED',
    actor: 'admin',
    targetType: 'branding',
    details: `Updated platform branding (${Object.keys(body).join(', ')})`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  broadcastEvent('config:updated', { config: db.config });
  res.json({ branding: db.config.branding, config: db.config });
});

router.get('/settings', (_req, res) => {
  const { theme, dashboard, website, markets } = loadDb().config;
  res.json({ theme, dashboard, website, markets });
});

function applyAdminSettingsPatch(req: any, res: any) {
  const db = loadDb();
  const body = req.body || {};
  if (body.theme) {
    db.config.theme = { ...db.config.theme, ...body.theme };
  }
  if (body.dashboard) {
    db.config.dashboard = { ...db.config.dashboard, ...body.dashboard };
  }
  if (body.website) {
    db.config.website = {
      ...db.config.website,
      ...body.website,
      navLabels: { ...db.config.website.navLabels, ...(body.website.navLabels || {}) },
    };
  }
  if (Array.isArray(body.markets)) {
    db.config.markets = body.markets;
  }
  db.config.updatedAt = new Date().toISOString();
  appendAuditLog(db, {
    action: 'PLATFORM_SETTINGS_UPDATED',
    actor: 'admin',
    targetType: 'settings',
    details: `Updated platform sections: ${Object.keys(body).join(', ')}`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  broadcastEvent('config:updated', { config: db.config });
  res.json({ config: db.config });
}

router.patch('/settings', applyAdminSettingsPatch);
router.post('/settings', applyAdminSettingsPatch);

router.get('/features', (_req, res) => {
  res.json({ features: loadDb().config.features });
});

router.patch('/features', (req, res) => {
  const db = loadDb();
  db.config.features = { ...db.config.features, ...(req.body || {}) };
  db.config.updatedAt = new Date().toISOString();
  appendAuditLog(db, {
    action: 'FEATURES_UPDATED',
    actor: 'admin',
    targetType: 'features',
    details: `Updated feature flags: ${JSON.stringify(req.body || {})}`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  broadcastEvent('config:updated', { config: db.config });
  res.json({ features: db.config.features, config: db.config });
});

router.post('/upload-logo', upload.single('logo'), (req, res) => {
  const slot = String(req.body?.slot || 'mainLogoUrl');
  const validSlots = ['mainLogoUrl', 'dashboardLogoUrl', 'footerLogoUrl', 'faviconUrl', 'mobileLogoUrl'] as const;
  if (!validSlots.includes(slot as any)) {
    res.status(400).json({ error: 'Invalid logo slot' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'Logo file is required' });
    return;
  }

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const extMap: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/x-icon': '.ico',
  };
  const ext = extMap[req.file.mimetype] || '.png';
  const filename = `${slot}_${Date.now()}${ext}`;
  const fullPath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(fullPath, req.file.buffer);
  const publicUrl = `/uploads/${filename}`;

  const db = loadDb();
  (db.config.branding as any)[slot] = publicUrl;
  db.config.updatedAt = new Date().toISOString();
  appendAuditLog(db, {
    action: 'LOGO_UPLOADED',
    actor: 'admin',
    targetType: 'logo',
    targetId: slot,
    details: `Uploaded persistent logo for ${slot} -> ${publicUrl}`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  broadcastEvent('config:updated', { config: db.config });
  res.json({ slot, url: publicUrl, branding: db.config.branding });
});

router.post('/logos/apply-url', (req, res) => {
  const slot = String(req.body?.slot || 'all');
  const url = String(req.body?.url || OFFICIAL_LOGO_PATH).trim() || OFFICIAL_LOGO_PATH;
  const validSlots = ['mainLogoUrl', 'dashboardLogoUrl', 'footerLogoUrl', 'faviconUrl', 'mobileLogoUrl'] as const;
  const db = loadDb();

  if (slot === 'all') {
    for (const s of validSlots) {
      db.config.branding[s] = url;
    }
  } else if (validSlots.includes(slot as any)) {
    (db.config.branding as any)[slot] = url;
  } else {
    res.status(400).json({ error: 'Invalid logo slot' });
    return;
  }

  db.config.updatedAt = new Date().toISOString();
  appendAuditLog(db, {
    action: 'LOGO_URL_UPDATED',
    actor: 'admin',
    targetType: 'logo',
    targetId: slot,
    details: `Applied logo URL (${url}) to ${slot}`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  broadcastEvent('config:updated', { config: db.config });
  res.json({ branding: db.config.branding, config: db.config });
});

router.get('/notifications', (_req, res) => {
  const db = loadDb();
  res.json({ notifications: db.notifications.slice(0, 100) });
});

router.post('/notifications', (req, res) => {
  const title = String(req.body?.title || '').trim();
  const message = String(req.body?.message || '').trim();
  const userId = String(req.body?.userId || 'all');
  const sendEmail = Boolean(req.body?.sendEmail);
  if (!title || !message) {
    res.status(400).json({ error: 'Title and message are required.' });
    return;
  }
  const db = loadDb();
  const notif = {
    id: generateId('ntf'),
    userId,
    title,
    message,
    category: 'announcement' as const,
    read: false,
    createdAt: new Date().toISOString(),
  };
  db.notifications.unshift(notif);
  appendAuditLog(db, {
    action: 'NOTIFICATION_SENT',
    actor: 'admin',
    targetType: 'notification',
    targetId: userId,
    details: `Sent notification "${title}" to ${userId}${sendEmail ? ' (+ Brevo Email)' : ''}`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  broadcastEvent('notification:created', { notification: notif }, userId === 'all' ? undefined : userId);
  if (userId === 'all') {
    void sendPushToAll({ title, body: message, url: '/dashboard', tag: `notif-${notif.id}` });
    if (sendEmail) {
      for (const u of Object.values(db.users).filter((u) => u.status === 'active').slice(0, 50)) {
        void sendAnnouncementEmail({ email: u.email, fullName: u.fullName, title, message });
      }
    }
  } else {
    void sendPushToUser(userId, { title, body: message, url: '/dashboard', tag: `notif-${notif.id}` });
    if (sendEmail && db.users[userId]?.email) {
      void sendAnnouncementEmail({
        email: db.users[userId].email,
        fullName: db.users[userId].fullName,
        title,
        message,
      });
    }
  }
  res.status(201).json({ notification: notif });
});

router.delete('/notifications/:id', (req, res) => {
  const db = loadDb();
  const idx = db.notifications.findIndex((n) => n.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }
  const removed = db.notifications.splice(idx, 1)[0];
  appendAuditLog(db, {
    action: 'NOTIFICATION_DELETED',
    actor: 'admin',
    targetType: 'notification',
    targetId: removed.id,
    details: `Deleted notification "${removed.title}"`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  res.json({ ok: true });
});

router.get('/audit-logs', (req, res) => {
  const type = String(req.query.type || '');
  const db = loadDb();
  const logs = type ? db.auditLogs.filter((l) => l.targetType === type) : db.auditLogs;
  res.json({ logs: logs.slice(0, 300) });
});

router.get('/security', (_req, res) => {
  const db = loadDb();
  res.json({
    ttlHours: db.adminSessionTtlHours,
    analysisAutoTradeEnabled: db.analysisAutoTradeEnabled !== false,
    analysisAutoPasswordConfigured: Boolean(db.analysisAutoTradePasswordHash),
  });
});

router.patch('/security', (req, res) => {
  const db = loadDb();
  const changedFields: string[] = [];

  if (typeof req.body?.ttlHours === 'number' && req.body.ttlHours >= 1 && req.body.ttlHours <= 72) {
    db.adminSessionTtlHours = req.body.ttlHours;
    changedFields.push('ttlHours');
  }
  if (typeof req.body?.newPassword === 'string' && req.body.newPassword.length >= 8) {
    db.adminPasswordHash = hashPassword(req.body.newPassword);
    changedFields.push('adminPassword');
  }
  if (typeof req.body?.analysisAutoTradeEnabled === 'boolean') {
    db.analysisAutoTradeEnabled = req.body.analysisAutoTradeEnabled;
    changedFields.push('analysisAutoTradeEnabled');
  }
  if (req.body?.clearAnalysisAutoPassword === true) {
    db.analysisAutoTradePasswordHash = null;
    changedFields.push('clearAnalysisAutoPassword');
  } else if (typeof req.body?.analysisAutoTradePassword === 'string' && req.body.analysisAutoTradePassword.trim().length > 0) {
    const pw = req.body.analysisAutoTradePassword.trim();
    if (pw.length < 4) {
      res.status(400).json({ error: 'Analysis Auto-Trade password must be at least 4 characters.' });
      return;
    }
    db.analysisAutoTradePasswordHash = hashPassword(pw);
    changedFields.push('analysisAutoTradePassword');
  }

  appendAuditLog(db, {
    action: 'SECURITY_SETTINGS_UPDATED',
    actor: 'admin',
    targetType: 'auth',
    details: `Updated security settings (${changedFields.join(', ') || 'policy'}).`,
    ip: req.ip,
    status: 'success',
  });
  saveDb(db);
  if (changedFields.includes('adminPassword') && db.config.branding.supportEmail) {
    void sendSecurityAlertEmail({
      email: db.config.branding.supportEmail,
      fullName: 'PIPFLOW Administrator',
      eventTitle: 'Admin Control Centre Password Updated',
      details: 'The administrator access password for PIPFLOW Control Centre was rotated.',
      ip: req.ip,
    });
  }
  res.json({
    ok: true,
    ttlHours: db.adminSessionTtlHours,
    analysisAutoTradeEnabled: db.analysisAutoTradeEnabled !== false,
    analysisAutoPasswordConfigured: Boolean(db.analysisAutoTradePasswordHash),
  });
});

export default router;
