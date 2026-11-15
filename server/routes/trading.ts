import { Router } from 'express';
import { z } from 'zod';
import { loadDb, saveDb, getUserAccounts } from '../db/store.ts';
import { generateId } from '../security/crypto.ts';
import { requireUser, type AuthenticatedRequest } from '../middleware/auth.ts';
import { broadcastEvent } from '../services/sse.ts';
import { generateAiBotStrategy, generateMarketInsight } from '../services/gemini.ts';

const router = Router();

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

const openTradeSchema = z.object({
  accountId: z.string().regex(/^(ROT|DOT)[0-9]{6,12}$/),
  symbol: z.string().min(1).max(40),
  tradeType: z.string().min(1).max(40),
  direction: z.enum(['BUY', 'SELL', 'RISE', 'FALL', 'EVEN', 'ODD', 'OVER', 'UNDER', 'ACCU']),
  stake: z.number().positive().max(100000),
  entryPrice: z.number().positive(),
  source: z.enum(['manual', 'bot', 'ai_profit_bot', 'bulk', 'copy']).default('manual'),
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
    payout: 0,
    profitLoss: 0,
    status: 'open' as const,
    source: parsed.data.source,
    note: parsed.data.note,
    openedAt: now,
  };

  db.trades.unshift(trade);
  saveDb(db);
  broadcastEvent('account:updated', { account }, userId);
  res.status(201).json({ trade, account });
});

const closeTradeSchema = z.object({
  tradeId: z.string().min(4),
  exitPrice: z.number().positive(),
  profitLoss: z.number(),
  enforceProfitOnly: z.boolean().optional(),
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
  trade.closedAt = now;

  account.balance = Number((account.balance + payout).toFixed(2));
  account.updatedAt = now;

  db.transactions.unshift({
    id: generateId('tx'),
    userId,
    accountId: account.accountId,
    accountType: account.accountType,
    type: clampedPnl >= 0 ? 'trade_win' : 'trade_loss',
    amount: clampedPnl,
    balanceAfter: account.balance,
    reason: `${trade.symbol} (${trade.direction}) ${trade.source === 'ai_profit_bot' ? 'AI Profit Bot' : 'Trade'} closed`,
    createdAt: now,
  });

  saveDb(db);
  broadcastEvent('account:updated', { account }, userId);
  res.json({ trade, account });
});

const settleInstantSchema = z.object({
  accountId: z.string().regex(/^(ROT|DOT)[0-9]{6,12}$/),
  symbol: z.string().min(1).max(40),
  tradeType: z.string().min(1).max(40),
  direction: z.enum(['BUY', 'SELL', 'RISE', 'FALL', 'EVEN', 'ODD', 'OVER', 'UNDER', 'ACCU']),
  stake: z.number().positive().max(100000),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  won: z.boolean(),
  payoutRate: z.number().min(0.1).max(5).default(0.92),
  source: z.enum(['manual', 'bot', 'ai_profit_bot', 'bulk', 'copy']).default('manual'),
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
