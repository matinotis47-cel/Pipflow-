import { Router } from 'express';
import { z } from 'zod';
import { loadDb, saveDb, getUserAccounts } from '../db/store.ts';
import { generateId, verifyPassword, signSessionToken, verifySessionToken } from '../security/crypto.ts';
import { requireUser, type AuthenticatedRequest } from '../middleware/auth.ts';
import { broadcastEvent } from '../services/sse.ts';
import { generateAiBotStrategy, generateMarketInsight } from '../services/gemini.ts';
import { getDerivCommissionRate } from '../services/deriv.ts';
import { sendTransactionEmail } from '../services/brevo.ts';
import { sendPushToUser } from '../services/push.ts';
import type { MT5OrderType, TradeRecord } from '../../src/types/pipflow.ts';

const router = Router();
const ACCOUNT_ID_REGEX = /^[A-Za-z0-9_-]{4,24}$/;

router.get('/state', requireUser, (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const userId = req.userSession!.sub;
  const accounts = getUserAccounts(db, userId);
  const trades = db.trades.filter((t) => t.userId === userId).slice(0, 200);
  const transactions = db.transactions.filter((tx) => tx.userId === userId).slice(0, 200);
  const watchlist = db.watchlists[userId] || [...db.config.dashboard.defaultWatchlist];
  const notifications = db.notifications.filter((n) => n.userId === 'all' || n.userId === userId).slice(0, 50);

  res.json({
    accounts,
    trades,
    transactions,
    watchlist,
    notifications,
  });
});

function verifyAnalysisAutoRequest(req: AuthenticatedRequest, userId: string): { ok: boolean; error?: string } {
  const db = loadDb();
  if (db.analysisAutoTradeEnabled === false) {
    return { ok: false, error: 'Analysis Tool Auto-Trading has been disabled by an administrator.' };
  }
  if (!db.analysisAutoTradePasswordHash) {
    return { ok: false, error: 'Analysis Auto-Trade password has not been configured by an administrator.' };
  }
  const rawHeader = req.headers['x-analysis-auto-token'];
  const token =
    typeof rawHeader === 'string' && rawHeader.trim()
      ? rawHeader.trim()
      : typeof req.body?.autoTradeToken === 'string'
        ? req.body.autoTradeToken.trim()
        : undefined;
  const session = verifySessionToken(token, 'analysis_auto');
  if (!session || session.sub !== userId) {
    return { ok: false, error: 'Admin password unlock required before Analysis Tool can automatically place orders.' };
  }
  return { ok: true };
}

router.get('/analysis/auto-status', requireUser, (_req: AuthenticatedRequest, res) => {
  const db = loadDb();
  res.json({
    enabled: db.analysisAutoTradeEnabled !== false,
    passwordConfigured: Boolean(db.analysisAutoTradePasswordHash),
  });
});

router.post('/analysis/unlock-auto', requireUser, async (req: AuthenticatedRequest, res) => {
  const password = String(req.body?.password || '').trim();
  const db = loadDb();
  if (db.analysisAutoTradeEnabled === false) {
    res.status(403).json({ error: 'Analysis Tool Auto-Trading is disabled by the administrator.' });
    return;
  }
  if (!db.analysisAutoTradePasswordHash) {
    res.status(400).json({
      error: 'Administrator has not set an Analysis Auto-Trade password in Control Centre → Security.',
    });
    return;
  }
  const valid = await verifyPassword(password, db.analysisAutoTradePasswordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid Admin Auto-Trade password.' });
    return;
  }
  const ttlSeconds = 2 * 3600;
  const autoTradeToken = signSessionToken(
    {
      sub: req.userSession!.sub,
      role: 'analysis_auto',
      sid: generateId('aat'),
    },
    ttlSeconds
  );
  res.json({
    ok: true,
    autoTradeToken,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
});

const openTradeSchema = z.object({
  accountId: z.string().regex(ACCOUNT_ID_REGEX),
  symbol: z.string().min(1).max(40),
  tradeType: z.string().min(1).max(40),
  direction: z.enum(['BUY', 'SELL', 'RISE', 'FALL', 'EVEN', 'ODD', 'OVER', 'UNDER', 'ACCU']),
  orderType: z.enum(['MARKET', 'BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP']).optional().default('MARKET'),
  lotSize: z.number().positive().max(1000).optional(),
  stake: z.number().positive().max(100000),
  entryPrice: z.number().positive(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  source: z.enum(['manual', 'bot', 'ai_profit_bot', 'bulk', 'copy', 'analysis_auto']).default('manual'),
  note: z.string().max(240).optional(),
});

router.post('/open', requireUser, (req: AuthenticatedRequest, res) => {
  const parsed = openTradeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid trade parameters', details: parsed.error.flatten() });
    return;
  }

  const db = loadDb();
  const userId = req.userSession!.sub;
  if (parsed.data.source === 'analysis_auto') {
    const gate = verifyAnalysisAutoRequest(req, userId);
    if (!gate.ok) {
      res.status(403).json({ error: gate.error });
      return;
    }
  }

  const account = db.accounts[parsed.data.accountId];
  if (!account || account.userId !== userId) {
    res.status(404).json({ error: 'Selected account not found.' });
    return;
  }
  if (account.status === 'frozen') {
    res.status(403).json({ error: 'This account is currently frozen by an administrator.' });
    return;
  }
  if (account.balance < parsed.data.stake) {
    res.status(400).json({ error: `Insufficient balance on ${account.accountId}. Available: $${account.balance.toFixed(2)}` });
    return;
  }

  const now = new Date().toISOString();
  const isPending = parsed.data.orderType !== 'MARKET';
  if (!isPending) {
    account.balance = Number((account.balance - parsed.data.stake).toFixed(2));
    account.updatedAt = now;
  }

  const commissionRate = getDerivCommissionRate();
  const trade: TradeRecord = {
    id: generateId('trd'),
    userId,
    accountId: account.accountId,
    accountType: account.accountType,
    symbol: parsed.data.symbol,
    tradeType: parsed.data.tradeType,
    direction: parsed.data.direction,
    orderType: parsed.data.orderType as MT5OrderType,
    lotSize: parsed.data.lotSize ? Number(parsed.data.lotSize.toFixed(2)) : undefined,
    stake: Number(parsed.data.stake.toFixed(2)),
    entryPrice: parsed.data.entryPrice,
    stopLoss: parsed.data.stopLoss,
    takeProfit: parsed.data.takeProfit,
    payout: 0,
    profitLoss: 0,
    commissionEstimate: Number((parsed.data.stake * commissionRate).toFixed(4)),
    status: isPending ? 'pending' : 'open',
    source: parsed.data.source,
    note: parsed.data.note,
    openedAt: now,
  };

  db.trades.unshift(trade);
  saveDb(db);
  if (!isPending) {
    broadcastEvent('account:updated', { account }, userId);
  }
  res.status(201).json({ trade, account });
});

const modifySlTpSchema = z.object({
  stopLoss: z.number().positive().nullable().optional(),
  takeProfit: z.number().positive().nullable().optional(),
});

router.patch('/trades/:id/sl-tp', requireUser, (req: AuthenticatedRequest, res) => {
  const parsed = modifySlTpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Stop Loss / Take Profit values.' });
    return;
  }
  const db = loadDb();
  const userId = req.userSession!.sub;
  const trade = db.trades.find((t) => t.id === req.params.id && t.userId === userId);
  if (!trade) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (trade.status === 'closed') {
    res.status(400).json({ error: 'Cannot modify SL/TP on a closed order.' });
    return;
  }
  if (parsed.data.stopLoss !== undefined) {
    trade.stopLoss = parsed.data.stopLoss === null ? undefined : parsed.data.stopLoss;
  }
  if (parsed.data.takeProfit !== undefined) {
    trade.takeProfit = parsed.data.takeProfit === null ? undefined : parsed.data.takeProfit;
  }
  saveDb(db);
  res.json({ trade });
});

router.post('/trades/:id/activate', requireUser, (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const userId = req.userSession!.sub;
  const trade = db.trades.find((t) => t.id === req.params.id && t.userId === userId);
  if (!trade) {
    res.status(404).json({ error: 'Pending order not found.' });
    return;
  }
  if (trade.status !== 'pending') {
    res.status(400).json({ error: 'Order is not pending activation.' });
    return;
  }
  const account = db.accounts[trade.accountId];
  if (!account || account.status === 'frozen') {
    res.status(403).json({ error: 'Trading account unavailable or frozen.' });
    return;
  }
  if (account.balance < trade.stake) {
    res.status(400).json({ error: `Insufficient free margin to fill pending order ${trade.id}.` });
    return;
  }
  const now = new Date().toISOString();
  account.balance = Number((account.balance - trade.stake).toFixed(2));
  account.updatedAt = now;
  trade.status = 'open';
  if (typeof req.body?.fillPrice === 'number' && req.body.fillPrice > 0) {
    trade.entryPrice = req.body.fillPrice;
  }
  trade.openedAt = now;
  saveDb(db);
  broadcastEvent('account:updated', { account }, userId);
  res.json({ trade, account });
});

router.post('/trades/:id/cancel', requireUser, (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const userId = req.userSession!.sub;
  const idx = db.trades.findIndex((t) => t.id === req.params.id && t.userId === userId);
  if (idx === -1) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  const trade = db.trades[idx];
  if (trade.status !== 'pending') {
    res.status(400).json({ error: 'Only pending orders can be cancelled.' });
    return;
  }
  db.trades.splice(idx, 1);
  saveDb(db);
  res.json({ ok: true, id: trade.id });
});

const closeTradeSchema = z.object({
  tradeId: z.string().min(4),
  exitPrice: z.number().positive(),
  profitLoss: z.number(),
  enforceProfitOnly: z.boolean().optional(),
  closeReason: z.enum(['manual', 'sl', 'tp', 'expired']).optional().default('manual'),
});

router.post('/close', requireUser, (req: AuthenticatedRequest, res) => {
  const parsed = closeTradeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid close request' });
    return;
  }

  const db = loadDb();
  const userId = req.userSession!.sub;
  const trade = db.trades.find((t) => t.id === parsed.data.tradeId && t.userId === userId);
  if (!trade) {
    res.status(404).json({ error: 'Trade not found.' });
    return;
  }
  if (trade.status === 'closed') {
    res.status(400).json({ error: 'Trade is already closed.' });
    return;
  }
  if (trade.status === 'pending') {
    res.status(400).json({ error: 'Pending order cannot be closed before activation; cancel it instead.' });
    return;
  }

  // Enforce AI Profit-Only Bot invariant when requested
  if ((trade.source === 'ai_profit_bot' || parsed.data.enforceProfitOnly) && parsed.data.profitLoss <= 0) {
    res.status(409).json({
      error: 'Profit-Only Exit Guard active: AI bot trades only close in positive profit.',
    });
    return;
  }

  const account = db.accounts[trade.accountId];
  if (!account) {
    res.status(404).json({ error: 'Trading account missing.' });
    return;
  }

  const now = new Date().toISOString();
  const clampedPnl = Number(Math.max(-trade.stake, parsed.data.profitLoss).toFixed(2));
  const payout = Number(Math.max(0, trade.stake + clampedPnl).toFixed(2));

  trade.exitPrice = parsed.data.exitPrice;
  trade.profitLoss = clampedPnl;
  trade.payout = payout;
  trade.status = 'closed';
  trade.closeReason = parsed.data.closeReason;
  trade.closedAt = now;

  account.balance = Number((account.balance + payout).toFixed(2));
  account.updatedAt = now;

  const reasonSuffix =
    parsed.data.closeReason === 'tp'
      ? ' [TP Hit]'
      : parsed.data.closeReason === 'sl'
        ? ' [SL Hit]'
        : '';

  db.transactions.unshift({
    id: generateId('tx'),
    userId,
    accountId: account.accountId,
    accountType: account.accountType,
    type: clampedPnl >= 0 ? 'trade_win' : 'trade_loss',
    amount: clampedPnl,
    balanceAfter: account.balance,
    reason: `${trade.symbol} (${trade.direction}) ${trade.source === 'ai_profit_bot' ? 'AI Profit Bot' : 'Trade'} closed${reasonSuffix}`,
    createdAt: now,
  });

  saveDb(db);
  broadcastEvent('account:updated', { account }, userId);
  res.json({ trade, account });
});

const settleInstantSchema = z.object({
  accountId: z.string().regex(ACCOUNT_ID_REGEX),
  symbol: z.string().min(1).max(40),
  tradeType: z.string().min(1).max(40),
  direction: z.enum(['BUY', 'SELL', 'RISE', 'FALL', 'EVEN', 'ODD', 'OVER', 'UNDER', 'ACCU']),
  stake: z.number().positive().max(100000),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  won: z.boolean(),
  payoutRate: z.number().min(0.1).max(5).default(0.92),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  source: z.enum(['manual', 'bot', 'ai_profit_bot', 'bulk', 'copy', 'analysis_auto']).default('manual'),
  note: z.string().max(240).optional(),
});

router.post('/settle', requireUser, (req: AuthenticatedRequest, res) => {
  const parsed = settleInstantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid trade settlement payload' });
    return;
  }

  const db = loadDb();
  const userId = req.userSession!.sub;
  if (parsed.data.source === 'analysis_auto') {
    const gate = verifyAnalysisAutoRequest(req, userId);
    if (!gate.ok) {
      res.status(403).json({ error: gate.error });
      return;
    }
  }
  const account = db.accounts[parsed.data.accountId];
  if (!account || account.userId !== userId) {
    res.status(404).json({ error: 'Selected account not found.' });
    return;
  }
  if (account.status === 'frozen') {
    res.status(403).json({ error: 'This account is frozen.' });
    return;
  }
  if (account.balance < parsed.data.stake) {
    res.status(400).json({ error: `Insufficient balance on ${account.accountId}.` });
    return;
  }

  if (parsed.data.source === 'ai_profit_bot' && !parsed.data.won) {
    res.status(409).json({ error: 'AI Profit-Only Bot cannot settle losing trades.' });
    return;
  }

  const now = new Date().toISOString();
  const profitLoss = parsed.data.won
    ? Number((parsed.data.stake * parsed.data.payoutRate).toFixed(2))
    : Number((-parsed.data.stake).toFixed(2));
  const payout = parsed.data.won ? Number((parsed.data.stake + profitLoss).toFixed(2)) : 0;

  account.balance = Number(Math.max(0, account.balance - parsed.data.stake + payout).toFixed(2));
  account.updatedAt = now;

  const trade = {
    id: generateId('trd'),
    userId,
    accountId: account.accountId,
    accountType: account.accountType,
    symbol: parsed.data.symbol,
    tradeType: parsed.data.tradeType,
    direction: parsed.data.direction,
    stake: Number(parsed.data.stake.toFixed(2)),
    entryPrice: parsed.data.entryPrice,
    stopLoss: parsed.data.stopLoss,
    takeProfit: parsed.data.takeProfit,
    exitPrice: parsed.data.exitPrice,
    payout,
    profitLoss,
    status: 'closed' as const,
    source: parsed.data.source,
    note: parsed.data.note,
    openedAt: now,
    closedAt: now,
  };

  db.trades.unshift(trade);
  db.transactions.unshift({
    id: generateId('tx'),
    userId,
    accountId: account.accountId,
    accountType: account.accountType,
    type: profitLoss >= 0 ? 'trade_win' : 'trade_loss',
    amount: profitLoss,
    balanceAfter: account.balance,
    reason: `${trade.symbol} ${trade.direction} (${trade.source})`,
    createdAt: now,
  });

  saveDb(db);
  broadcastEvent('account:updated', { account }, userId);
  res.json({ trade, account });
});

router.post('/demo/reset', requireUser, (req: AuthenticatedRequest, res) => {
  const accountId = String(req.body?.accountId || '');
  const db = loadDb();
  const userId = req.userSession!.sub;
  const account = db.accounts[accountId];
  if (!account || account.userId !== userId) {
    res.status(404).json({ error: 'Demo account not found.' });
    return;
  }
  if (account.accountType !== 'demo') {
    res.status(400).json({ error: 'Only DOT demo accounts can be self-reset.' });
    return;
  }
  const resetTo = db.config.dashboard.defaultDemoBalance || 10000;
  const delta = Number((resetTo - account.balance).toFixed(2));
  const now = new Date().toISOString();
  account.balance = resetTo;
  account.startingBalance = resetTo;
  account.updatedAt = now;

  db.transactions.unshift({
    id: generateId('tx'),
    userId,
    accountId: account.accountId,
    accountType: 'demo',
    type: 'reset',
    amount: delta,
    balanceAfter: resetTo,
    reason: 'User reset simulated demo balance',
    createdAt: now,
  });

  saveDb(db);
  broadcastEvent('account:updated', { account }, userId);
  res.json({ account });
});

router.post('/watchlist/toggle', requireUser, (req: AuthenticatedRequest, res) => {
  const symbol = String(req.body?.symbol || '').trim();
  if (!symbol) {
    res.status(400).json({ error: 'Symbol required' });
    return;
  }
  const db = loadDb();
  const userId = req.userSession!.sub;
  const current = db.watchlists[userId] || [...db.config.dashboard.defaultWatchlist];
  const exists = current.includes(symbol);
  const next = exists ? current.filter((s) => s !== symbol) : [symbol, ...current].slice(0, 30);
  db.watchlists[userId] = next;
  saveDb(db);
  res.json({ watchlist: next });
});

router.post('/notifications/read', requireUser, (req: AuthenticatedRequest, res) => {
  const id = req.body?.id ? String(req.body.id) : null;
  const db = loadDb();
  const userId = req.userSession!.sub;
  for (const n of db.notifications) {
    if ((n.userId === userId || n.userId === 'all') && (!id || n.id === id)) {
      n.read = true;
    }
  }
  saveDb(db);
  res.json({ ok: true });
});

router.get('/history', requireUser, (req: AuthenticatedRequest, res) => {
  const db = loadDb();
  const userId = req.userSession!.sub;
  const trades = db.trades.filter((t) => t.userId === userId).slice(0, 250);
  const transactions = db.transactions.filter((tx) => tx.userId === userId).slice(0, 250);
  res.json({ trades, transactions });
});

const executeSchema = z.object({
  accountId: z.string().regex(ACCOUNT_ID_REGEX).optional(),
  symbol: z.string().min(1).max(40),
  tradeType: z.string().min(1).max(40).default('rise_fall'),
  direction: z.enum(['BUY', 'SELL', 'RISE', 'FALL', 'EVEN', 'ODD', 'OVER', 'UNDER']),
  stake: z.number().positive().max(100000),
  duration: z.number().int().min(1).max(365).default(5),
  durationUnit: z.enum(['t', 's', 'm', 'h']).default('t'),
  barrier: z.string().max(16).optional(),
  entryPrice: z.number().positive().default(100),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  source: z.enum(['manual', 'bot', 'ai_profit_bot', 'bulk', 'copy', 'analysis_auto']).default('manual'),
  note: z.string().max(240).optional(),
});

router.post('/execute', requireUser, async (req: AuthenticatedRequest, res) => {
  const parsed = executeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid trade execution payload', details: parsed.error.flatten() });
    return;
  }

  const db = loadDb();
  const userId = req.userSession!.sub;
  if (parsed.data.source === 'analysis_auto') {
    const gate = verifyAnalysisAutoRequest(req, userId);
    if (!gate.ok) {
      res.status(403).json({ error: gate.error });
      return;
    }
  }
  const user = db.users[userId];
  const targetAccountId = parsed.data.accountId || user.activeAccountId;
  const account = db.accounts[targetAccountId];

  if (!account || account.userId !== userId) {
    res.status(404).json({ error: 'Trading account not found.' });
    return;
  }
  if (account.status === 'frozen') {
    res.status(403).json({ error: 'This account is frozen.' });
    return;
  }
  if (account.balance < parsed.data.stake) {
    res.status(400).json({ error: `Insufficient balance on ${account.accountId}.` });
    return;
  }

  const now = new Date().toISOString();
  const commissionRate = getDerivCommissionRate();

  // Strictly execute inside PIPFLOW simulated ledger (zero real-money execution on external Deriv accounts)
  account.balance = Number((account.balance - parsed.data.stake).toFixed(2));
  account.updatedAt = now;
  const trade = {
    id: generateId('trd'),
    userId,
    accountId: account.accountId,
    accountType: account.accountType,
    symbol: parsed.data.symbol,
    tradeType: parsed.data.tradeType,
    direction: parsed.data.direction,
    stake: Number(parsed.data.stake.toFixed(2)),
    entryPrice: parsed.data.entryPrice,
    stopLoss: parsed.data.stopLoss,
    takeProfit: parsed.data.takeProfit,
    payout: 0,
    profitLoss: 0,
    commissionEstimate: Number((parsed.data.stake * commissionRate).toFixed(4)),
    liveExecution: false,
    status: 'open' as const,
    source: parsed.data.source,
    note: parsed.data.note,
    openedAt: now,
  };
  db.trades.unshift(trade);
  saveDb(db);
  broadcastEvent('account:updated', { account }, userId);
  res.status(201).json({ trade, account, liveExecution: false });
});

const fundsSchema = z.object({
  accountId: z.string().regex(ACCOUNT_ID_REGEX),
  amount: z.number().positive().max(1000000),
  note: z.string().trim().max(240).optional(),
});

router.post('/deposit', requireUser, async (req: AuthenticatedRequest, res) => {
  const parsed = fundsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a valid account ID and positive deposit amount.' });
    return;
  }

  const db = loadDb();
  const userId = req.userSession!.sub;
  const user = db.users[userId];
  const account = db.accounts[parsed.data.accountId];
  if (!account || account.userId !== userId) {
    res.status(404).json({ error: 'Target account not found.' });
    return;
  }
  if (account.status === 'frozen') {
    res.status(403).json({ error: 'This account is currently frozen.' });
    return;
  }

  const amount = Number(parsed.data.amount.toFixed(2));
  const now = new Date().toISOString();
  account.balance = Number((account.balance + amount).toFixed(2));
  account.updatedAt = now;

  const reason = parsed.data.note || `Cashier deposit to ${account.accountId}`;
  const transaction = {
    id: generateId('tx'),
    userId,
    accountId: account.accountId,
    accountType: account.accountType,
    type: 'deposit' as const,
    amount,
    balanceAfter: account.balance,
    reason,
    createdAt: now,
  };
  db.transactions.unshift(transaction);

  const notifTitle = `Deposit Confirmed: +${amount.toFixed(2)} ${account.currency}`;
  const notifBody = `${account.accountId} credited. New balance: ${account.balance.toFixed(2)} ${account.currency}.`;
  db.notifications.unshift({
    id: generateId('ntf'),
    userId,
    title: notifTitle,
    message: notifBody,
    category: 'account',
    read: false,
    createdAt: now,
  });

  saveDb(db);
  broadcastEvent('account:updated', { account }, userId);
  broadcastEvent('notification:created', { userId }, userId);

  const pushResult = await sendPushToUser(userId, {
    title: notifTitle,
    body: notifBody,
    url: '/dashboard',
    tag: `deposit-${transaction.id}`,
  });

  const emailResult = user?.email
    ? await sendTransactionEmail({
        email: user.email,
        fullName: user.fullName,
        type: 'deposit',
        amount,
        currency: account.currency,
        accountId: account.accountId,
        balanceAfter: account.balance,
        reason,
      })
    : { sent: false };

  res.status(201).json({ account, transaction, pushResult, emailSent: emailResult.sent });
});

router.post('/withdraw', requireUser, async (req: AuthenticatedRequest, res) => {
  const parsed = fundsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a valid account ID and positive withdrawal amount.' });
    return;
  }

  const db = loadDb();
  const userId = req.userSession!.sub;
  const user = db.users[userId];
  const account = db.accounts[parsed.data.accountId];
  if (!account || account.userId !== userId) {
    res.status(404).json({ error: 'Source account not found.' });
    return;
  }
  if (account.status === 'frozen') {
    res.status(403).json({ error: 'This account is currently frozen.' });
    return;
  }

  const amount = Number(parsed.data.amount.toFixed(2));
  if (account.balance < amount) {
    res.status(400).json({ error: `Insufficient balance on ${account.accountId}. Available: ${account.balance.toFixed(2)} ${account.currency}` });
    return;
  }

  const now = new Date().toISOString();
  account.balance = Number((account.balance - amount).toFixed(2));
  account.updatedAt = now;

  const reason = parsed.data.note || `Cashier withdrawal from ${account.accountId}`;
  const transaction = {
    id: generateId('tx'),
    userId,
    accountId: account.accountId,
    accountType: account.accountType,
    type: 'withdrawal' as const,
    amount: -amount,
    balanceAfter: account.balance,
    reason,
    createdAt: now,
  };
  db.transactions.unshift(transaction);

  const notifTitle = `Withdrawal Processed: -${amount.toFixed(2)} ${account.currency}`;
  const notifBody = `${account.accountId} debited. Remaining balance: ${account.balance.toFixed(2)} ${account.currency}.`;
  db.notifications.unshift({
    id: generateId('ntf'),
    userId,
    title: notifTitle,
    message: notifBody,
    category: 'account',
    read: false,
    createdAt: now,
  });

  saveDb(db);
  broadcastEvent('account:updated', { account }, userId);
  broadcastEvent('notification:created', { userId }, userId);

  const pushResult = await sendPushToUser(userId, {
    title: notifTitle,
    body: notifBody,
    url: '/dashboard',
    tag: `withdraw-${transaction.id}`,
  });

  const emailResult = user?.email
    ? await sendTransactionEmail({
        email: user.email,
        fullName: user.fullName,
        type: 'withdrawal',
        amount,
        currency: account.currency,
        accountId: account.accountId,
        balanceAfter: account.balance,
        reason,
      })
    : { sent: false };

  res.status(201).json({ account, transaction, pushResult, emailSent: emailResult.sent });
});

router.post('/ai/strategy', requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const prompt = String(req.body?.prompt || 'High probability profit-only scalping bot');
    const symbol = String(req.body?.symbol || 'R_100_1S');
    const currentPrice = Number(req.body?.currentPrice || 1375.85);
    const recentDigits = Array.isArray(req.body?.recentDigits) ? req.body.recentDigits.map(Number).slice(-20) : [2, 5, 8, 1, 4, 7];
    const strategy = await generateAiBotStrategy({ prompt, symbol, currentPrice, recentDigits });
    res.json({ strategy });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to generate AI strategy' });
  }
});

router.post('/ai/insight', requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const symbol = String(req.body?.symbol || 'R_100_1S');
    const price = Number(req.body?.price || 1375.85);
    const changePct = Number(req.body?.changePct || 0.12);
    const digits = Array.isArray(req.body?.digits) ? req.body.digits.map(Number).slice(-20) : [1, 4, 6, 3, 8];
    const insight = await generateMarketInsight({ symbol, price, changePct, digits });
    res.json({ insight });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to generate market insight' });
  }
});

export default router;
