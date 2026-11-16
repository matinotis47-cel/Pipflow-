import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { loadDb, saveDb } from '../db/store.ts';
import { requireAdmin, requireUser, type AuthenticatedRequest } from '../middleware/auth.ts';
import { generateId } from '../security/crypto.ts';
import { sendBrevoEmail, sendPushToUser, type TransactionNotice } from '../services/notifications.ts';

const router = Router();
const DERIV_SCOPES = 'read trade';
const stateLifetimeMs = 10 * 60 * 1000;

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

router.get('/deriv/connect', requireUser, (req: AuthenticatedRequest, res) => {
  const { DERIV_CLIENT_ID, DERIV_REDIRECT_URI, DERIV_OAUTH_URL } = process.env;
  if (!DERIV_CLIENT_ID || !DERIV_REDIRECT_URI || !DERIV_OAUTH_URL) {
    res.status(503).json({ error: 'Deriv OAuth is not configured.' });
    return;
  }
  let authorizeUrl: URL;
  try {
    authorizeUrl = new URL(DERIV_OAUTH_URL);
  } catch {
    res.status(500).json({ error: 'Invalid Deriv OAuth URL configuration.' });
    return;
  }
  if (authorizeUrl.protocol !== 'https:') {
    res.status(500).json({ error: 'Deriv OAuth URL must use HTTPS.' });
    return;
  }

  const db = loadDb();
  const state = base64url(crypto.randomBytes(32));
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  db.derivOAuthStates ||= {};
  for (const [key, pending] of Object.entries(db.derivOAuthStates)) {
    if (pending.expiresAt <= Date.now()) delete db.derivOAuthStates[key];
  }
  db.derivOAuthStates[state] = { userId: req.userSession!.sub, verifier, expiresAt: Date.now() + stateLifetimeMs };
  saveDb(db);

  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', DERIV_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', DERIV_REDIRECT_URI);
  authorizeUrl.searchParams.set('scope', DERIV_SCOPES);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  res.redirect(authorizeUrl.toString());
});

router.get('/deriv/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const providerError = typeof req.query.error === 'string' ? req.query.error : '';
  const db = loadDb();
  const pending = state ? db.derivOAuthStates?.[state] : undefined;
  if (!pending || pending.expiresAt < Date.now()) {
    res.status(400).send('Deriv connection expired or could not be verified. Return to PIPFLOW and try again.');
    return;
  }
  delete db.derivOAuthStates![state];
  saveDb(db);
  if (providerError || !code) {
    res.status(400).send('Deriv authorization was not completed. You may close this window.');
    return;
  }

  const { DERIV_CLIENT_ID, DERIV_CLIENT_SECRET, DERIV_REDIRECT_URI, DERIV_TOKEN_URL } = process.env;
  if (!DERIV_CLIENT_ID || !DERIV_REDIRECT_URI || !DERIV_TOKEN_URL) {
    res.status(503).send('Deriv OAuth is not configured.');
    return;
  }
  let tokenUrl: URL;
  try {
    tokenUrl = new URL(DERIV_TOKEN_URL);
    if (tokenUrl.protocol !== 'https:') throw new Error('HTTPS required');
  } catch {
    res.status(500).send('Invalid Deriv token endpoint configuration.');
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: DERIV_CLIENT_ID,
      redirect_uri: DERIV_REDIRECT_URI,
      code_verifier: pending.verifier,
    });
    if (DERIV_CLIENT_SECRET) body.set('client_secret', DERIV_CLIENT_SECRET);
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.error('Deriv token exchange failed with status', response.status);
      res.status(502).send('Deriv authorization could not be completed. Please retry.');
      return;
    }
    const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!result.access_token) {
      res.status(502).send('Deriv did not return an access token. Please retry.');
      return;
    }
    // Do not request or retain money movement scopes. The provider access token is encrypted at rest.
    const latest = loadDb();
    latest.derivConnections ||= {};
    latest.derivConnections[pending.userId] = {
      accessToken: encryptSecret(result.access_token),
      refreshToken: result.refresh_token ? encryptSecret(result.refresh_token) : undefined,
      expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined,
      scopes: (result.scope || DERIV_SCOPES).split(/[ ,]+/).filter(Boolean).filter((scope) => !/withdraw|payment|deposit/i.test(scope)),
      connectedAt: new Date().toISOString(),
    };
    saveDb(latest);
    const appUrl = process.env.APP_URL || '/';
    const redirect = new URL(appUrl, 'https://localhost');
    redirect.searchParams.set('deriv', 'connected');
    res.redirect(redirect.toString());
  } catch (error) {
    console.error('Deriv OAuth exchange error:', error);
    res.status(502).send('Deriv authorization could not be completed. Please retry.');
  }
});

function encryptSecret(value: string): string {
  const keyMaterial = process.env.AUTH_SECRET;
  if (!keyMaterial || keyMaterial.length < 32) throw new Error('AUTH_SECRET must be configured before Deriv linking.');
  const key = crypto.createHash('sha256').update(keyMaterial).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

router.get('/deriv/status', requireUser, (req: AuthenticatedRequest, res) => {
  const connection = loadDb().derivConnections?.[req.userSession!.sub];
  res.json({ connected: Boolean(connection), connectedAt: connection?.connectedAt || null, scopes: connection?.scopes || [] });
});

router.delete('/deriv/connection', requireUser, (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  if (db.derivConnections) delete db.derivConnections[req.userSession!.sub];
  saveDb(db);
  res.json({ ok: true });
});

const deviceSchema = z.object({ token: z.string().trim().min(20).max(4096), platform: z.enum(['android', 'ios', 'web']).default('android') });
router.post('/notifications/devices', requireUser, (req: AuthenticatedRequest, res) => {
  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid FCM device token and platform are required.' });
    return;
  }
  const db = loadDb();
  db.pushDevices ||= {};
  const userId = req.userSession!.sub;
  const devices = db.pushDevices[userId] || [];
  db.pushDevices[userId] = [...devices.filter((device) => device.token !== parsed.data.token), { ...parsed.data, addedAt: new Date().toISOString() }].slice(-10);
  saveDb(db);
  res.status(201).json({ ok: true });
});

router.delete('/notifications/devices', requireUser, (req: AuthenticatedRequest, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token) {
    res.status(400).json({ error: 'Device token is required.' });
    return;
  }
  const db = loadDb();
  const userId = req.userSession!.sub;
  if (db.pushDevices?.[userId]) db.pushDevices[userId] = db.pushDevices[userId].filter((device) => device.token !== token);
  saveDb(db);
  res.json({ ok: true });
});

router.post('/email/verification', requireUser, async (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const user = db.users[req.userSession!.sub];
  if (!user || user.emailVerified || !user.verificationCode) {
    res.status(400).json({ error: 'No pending email verification is available.' });
    return;
  }
  try {
    await sendBrevoEmail(user.email, 'Verify your PIPFLOW email', `Your verification code is ${user.verificationCode}. It expires when you complete verification.`);
    res.json({ ok: true });
  } catch (error) {
    console.error('Verification email delivery failed:', error);
    res.status(503).json({ error: 'Email delivery is temporarily unavailable.' });
  }
});

const transactionNoticeSchema = z.object({
  eventId: z.string().trim().min(8).max(128),
  userId: z.string().min(1),
  type: z.enum(['deposit', 'withdrawal']),
  amount: z.number().positive().max(100000000),
  currency: z.string().trim().min(3).max(8),
  status: z.enum(['pending', 'completed', 'failed']),
});
// Called by a trusted payment/provider event handler. It does NOT initiate or approve money movement.
router.post('/events/transaction', async (req, res) => {
  const secret = process.env.TRANSACTION_EVENTS_SECRET;
  const supplied = req.get('x-transaction-event-secret') || '';
  if (!secret || supplied.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) {
    res.status(401).json({ error: 'Invalid event authorization.' });
    return;
  }
  const parsed = transactionNoticeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid transaction event.' });
    return;
  }
  const db = loadDb();
  const user = db.users[parsed.data.userId];
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  db.deliveredTransactionEvents ||= {};
  if (db.deliveredTransactionEvents[parsed.data.eventId]) {
    res.json({ ok: true, duplicate: true });
    return;
  }
  db.deliveredTransactionEvents[parsed.data.eventId] = new Date().toISOString();
  const notice: TransactionNotice = parsed.data;
  saveDb(db);
  try {
    const title = `${notice.type === 'deposit' ? 'Deposit' : 'Withdrawal'} ${notice.status}`;
    const message = `Your ${notice.type} of ${notice.amount.toFixed(2)} ${notice.currency} is ${notice.status}. Reference: ${notice.eventId}`;
    await sendPushToUser(user.id, title, message);
    await sendBrevoEmail(user.email, title, message);
    res.status(202).json({ ok: true });
  } catch (error) {
    console.error('Transaction notification delivery failed:', error);
    res.status(503).json({ error: 'Notification delivery failed. Retry with the same eventId.' });
  }
});

router.post('/notifications/send', requireAdmin, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ userId: z.string().min(1), title: z.string().trim().min(1).max(120), message: z.string().trim().min(1).max(1000), email: z.boolean().default(true), push: z.boolean().default(true) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid notification payload.' });
    return;
  }
  const db = loadDb();
  const user = db.users[parsed.data.userId];
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  const notif = { id: generateId('ntf'), userId: user.id, title: parsed.data.title, message: parsed.data.message, category: 'system' as const, read: false, createdAt: new Date().toISOString() };
  db.notifications.unshift(notif);
  saveDb(db);
  const results = await Promise.allSettled([
    parsed.data.push ? sendPushToUser(user.id, notif.title, notif.message) : Promise.resolve(),
    parsed.data.email ? sendBrevoEmail(user.email, notif.title, notif.message) : Promise.resolve(),
  ]);
  res.status(201).json({ notification: notif, delivery: results.map((item) => item.status) });
});

export default router;
