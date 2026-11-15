import React, { useEffect, useRef, useState } from 'react';
import { Bot, Play, ShieldCheck, Sparkles, Square, X } from 'lucide-react';
import type { MarketAsset, TradeRecord } from '../types/pipflow';
import type { MarketTickState } from '../services/marketEngine';
import { useAuth } from '../context/AuthContext';
import { formatCurrencyAmount } from '../config/app.config';
import { apiFetch } from '../lib/sessionMemory';

interface AiProfitBotDrawerProps {
  open: boolean;
  onClose: () => void;
  markets: MarketAsset[];
  marketStates: Record<string, MarketTickState>;
  selectedSymbol: string;
  onSelectSymbol: (sym: string) => void;
}

interface FloatingBotPosition {
  tradeId: string;
  symbol: string;
  direction: 'RISE' | 'FALL';
  stake: number;
  entryPrice: number;
  targetProfitUsd: number;
  unrealizedPnl: number;
  ticksHeld: number;
}

export function AiProfitBotDrawer({
  open,
  onClose,
  markets,
  marketStates,
  selectedSymbol,
  onSelectSymbol,
}: AiProfitBotDrawerProps) {
  const { activeAccount, setAccountBalanceLocal, refreshUserState, trades } = useAuth();

  const [tradeType, setTradeType] = useState<'RISE_FALL' | 'DIGITS_OVER' | 'EVEN_ODD'>('RISE_FALL');
  const [stake, setStake] = useState(10);
  const [targetProfitPct, setTargetProfitPct] = useState(18);
  const [strategyPrompt, setStrategyPrompt] = useState('High-precision profit-only momentum scalping');
  const [aiRationale, setAiRationale] = useState(
    'Profit-Only Exit Guard armed: open AI bot trades stay active until live unrealized P&L crosses your target profit.'
  );
  const [generatingAi, setGeneratingAi] = useState(false);

  const [botRunning, setBotRunning] = useState(false);
  const [floatingPos, setFloatingPos] = useState<FloatingBotPosition | null>(null);
  const [statusMessage, setStatusMessage] = useState('AI Profit-Only Bot is idle.');
  const [errorMsg, setErrorMsg] = useState('');
  const [ticksProcessed, setTicksProcessed] = useState(0);

  const closingRef = useRef(false);
  const openingRef = useRef(false);

  const currentMarket = marketStates[selectedSymbol];
  const currentAsset = markets.find((m) => m.symbol === selectedSymbol) || markets[0];
  const botClosedTrades = trades.filter((t) => t.source === 'ai_profit_bot' && t.status === 'closed');
  const botWins = botClosedTrades.filter((t) => t.profitLoss > 0).length;
  const botTotalPnl = botClosedTrades.reduce((s, t) => s + t.profitLoss, 0);

  const handleGenerateAiStrategy = async () => {
    setGeneratingAi(true);
    setErrorMsg('');
    try {
      const res = await apiFetch('/api/trading/ai/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: strategyPrompt,
          symbol: selectedSymbol,
          currentPrice: currentMarket?.price || currentAsset?.basePrice || 1000,
          recentDigits: currentMarket?.digits.slice(-15) || [1, 4, 7, 2, 8],
        }),
      });
      const data = await res.json();
      if (res.ok && data.strategy) {
        setStake(Math.min(500, Math.max(1, data.strategy.stakeUsd)));
        setTargetProfitPct(Math.min(95, Math.max(5, data.strategy.profitOnlyTargetPct)));
        setAiRationale(`${data.strategy.botName}: ${data.strategy.rationale}`);
      } else {
        setErrorMsg(data.error || 'Could not generate AI parameters.');
      }
    } catch {
      setErrorMsg('Failed to reach PIPFLOW AI strategy engine.');
    } finally {
      setGeneratingAi(false);
    }
  };

  // Monitor live ticks when AI Profit-Only Bot is running
  useEffect(() => {
    if (!botRunning || !activeAccount || !currentMarket || !currentAsset) return;

    setTicksProcessed((n) => n + 1);

    const runCycle = async () => {
      // 1. If there's an active open position, evaluate unrealized P&L strictly
      if (floatingPos) {
        const diff = currentMarket.price - floatingPos.entryPrice;
        const directionalMove = floatingPos.direction === 'RISE' ? diff : -diff;
        // Scale tick movement relative to asset volatility
        const normalizedReturn = (directionalMove / Math.max(0.0001, currentAsset.volatility)) * floatingPos.stake * 0.35;
        const unrealized = Number(Math.max(-floatingPos.stake * 0.9, normalizedReturn).toFixed(2));

        const updatedPos: FloatingBotPosition = {
          ...floatingPos,
          unrealizedPnl: unrealized,
          ticksHeld: floatingPos.ticksHeld + 1,
        };
        setFloatingPos(updatedPos);

        // PROFIT-ONLY GUARD: Only close when unrealized P&L > 0 and meets target (or positive after holding)
        const profitTarget = Math.max(0.15, floatingPos.targetProfitUsd);
        if (unrealized >= profitTarget && !closingRef.current) {
          closingRef.current = true;
          setStatusMessage(`Profit target reached (+$${unrealized.toFixed(2)}). Closing in profit...`);
          try {
            const res = await apiFetch('/api/trading/close', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                tradeId: floatingPos.tradeId,
                exitPrice: currentMarket.price,
                profitLoss: unrealized,
                enforceProfitOnly: true,
              }),
            });
            const data = await res.json();
            if (res.ok) {
              setAccountBalanceLocal(data.account);
              setFloatingPos(null);
              setStatusMessage(`Closed trade on profit: +$${unrealized.toFixed(2)}! Scanning next setup...`);
              void refreshUserState();
            }
          } finally {
            closingRef.current = false;
          }
        } else if (unrealized <= 0) {
          setStatusMessage(
            `Profit-Only Guard holding ${floatingPos.symbol} (${unrealized.toFixed(2)} USD) — waiting for profitable recovery`
          );
        } else {
          setStatusMessage(
            `In profit (+$${unrealized.toFixed(2)}) — aiming for +$${profitTarget.toFixed(2)} target...`
          );
        }
        return;
      }

      // 2. No open position: open a new AI-guided trade if account has balance
      if (!openingRef.current && activeAccount.balance >= stake) {
        openingRef.current = true;
        try {
          const recent = currentMarket.ticks.slice(-4);
          const momentumUp = recent.length >= 2 ? recent[recent.length - 1].price >= recent[0].price : true;
          const direction: 'RISE' | 'FALL' = momentumUp ? 'RISE' : 'FALL';

          const res = await apiFetch('/api/trading/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              accountId: activeAccount.accountId,
              symbol: selectedSymbol,
              tradeType,
              direction,
              stake,
              entryPrice: currentMarket.price,
              source: 'ai_profit_bot',
              note: `AI Profit-Only Guard (${targetProfitPct}% target)`,
            }),
          });
          const data = await res.json();
          if (res.ok && data.trade) {
            setAccountBalanceLocal(data.account);
            setFloatingPos({
              tradeId: (data.trade as TradeRecord).id,
              symbol: selectedSymbol,
              direction,
              stake,
              entryPrice: currentMarket.price,
              targetProfitUsd: Number(((stake * targetProfitPct) / 100).toFixed(2)),
              unrealizedPnl: 0,
              ticksHeld: 0,
            });
            setStatusMessage(`Opened ${direction} position on ${selectedSymbol} @ ${currentMarket.price.toFixed(currentAsset.pipDecimals)}`);
          } else if (!res.ok) {
            setErrorMsg(data.error || 'Could not open AI bot trade.');
            setBotRunning(false);
          }
        } finally {
          openingRef.current = false;
        }
      } else if (activeAccount.balance < stake) {
        setErrorMsg(`Insufficient balance on ${activeAccount.accountId} for $${stake} stake.`);
        setBotRunning(false);
      }
    };

    void runCycle();
  }, [currentMarket?.price, botRunning]);

  const toggleBot = () => {
    setErrorMsg('');
    if (!activeAccount) {
      setErrorMsg('Please select a Real (ROT) or Demo (DOT) account.');
      return;
    }
    if (!botRunning && activeAccount.balance < stake) {
      setErrorMsg(`Insufficient balance on ${activeAccount.accountId}. Available: $${activeAccount.balance.toFixed(2)}`);
      return;
    }
    setBotRunning((r) => {
      const next = !r;
      if (next) {
        setStatusMessage(`AI Profit-Only Bot active on ${activeAccount.accountId}...`);
      } else {
        setStatusMessage(
          floatingPos
            ? 'Bot paused. Open position remains monitored in Positions tab (only profit closes allowed via AI Guard).'
            : 'AI Profit-Only Bot stopped.'
        );
      }
      return next;
    });
  };

  if (!open) return null;

  const recentTenDigits = currentMarket?.digits.slice(-10) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl border border-rose-500/35 bg-gradient-to-b from-[#2b090d] via-[#1c070a] to-[#120608] text-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rose-500/20 bg-black/25">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-300 via-rose-500 to-red-700 shadow-lg shadow-rose-600/40 ring-2 ring-rose-400/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold text-sm sm:text-base tracking-tight">Gemini</h3>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                  <ShieldCheck className="w-3 h-3" /> Profit-Only Exit
                </span>
              </div>
              <p className="text-[10px] font-mono tracking-[0.18em] text-rose-200/70 uppercase">
                AI TRADING ASSISTANT · {activeAccount?.accountId || 'NO ACCOUNT'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline font-mono text-[11px] text-emerald-400">
              {activeAccount ? formatCurrencyAmount(activeAccount.balance, activeAccount.currency) : '$0.00'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-rose-950/60 border border-rose-500/25 text-rose-200 hover:text-white hover:bg-rose-900/60 transition-colors"
              aria-label="Close AI Bot"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Trading Configuration */}
          <div className="rounded-xl border border-rose-500/20 bg-black/35 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-100">Trading Configuration</span>
              <button
                type="button"
                onClick={handleGenerateAiStrategy}
                disabled={generatingAi}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/20 border border-rose-400/30 text-rose-200 text-[11px] font-medium hover:bg-rose-500/30 transition-colors"
              >
                <Sparkles className="w-3 h-3" />
                {generatingAi ? 'Tuning AI...' : 'AI Auto-Tune'}
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-rose-200/60 mb-1">Symbol</label>
                <select
                  value={selectedSymbol}
                  onChange={(e) => onSelectSymbol(e.target.value)}
                  className="w-full rounded-lg border border-rose-500/20 bg-[#140709] px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  {markets.filter((m) => m.enabled).map((m) => (
                    <option key={m.symbol} value={m.symbol}>
                      {m.name} ({m.symbol})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-rose-200/60 mb-1">Trade Type</label>
                <select
                  value={tradeType}
                  onChange={(e) => setTradeType(e.target.value as any)}
                  className="w-full rounded-lg border border-rose-500/20 bg-[#140709] px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  <option value="DIGITS_OVER">Digits Over (OVER 2 / UNDER 7)</option>
                  <option value="RISE_FALL">Rise / Fall (Momentum)</option>
                  <option value="EVEN_ODD">Even / Odd Volatility</option>
                </select>
                <p className="text-[11px] text-rose-200/55 mt-1">
                  Bot auto-selects optimal entry &amp; holds until unrealized P&amp;L is positive ({targetProfitPct}% target).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-rose-200/60 mb-1">Stake</label>
                  <input
                    type="number"
                    min={0.5}
                    max={5000}
                    step="0.5"
                    value={stake}
                    onChange={(e) => setStake(Math.max(0.5, Number(e.target.value)))}
                    className="w-full rounded-lg border border-rose-500/20 bg-[#140709] px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-rose-200/60 mb-1">
                    Profit Target (%)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={95}
                    value={targetProfitPct}
                    onChange={(e) => setTargetProfitPct(Math.min(95, Math.max(5, Number(e.target.value))))}
                    className="w-full rounded-lg border border-rose-500/20 bg-[#140709] px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              <div>
                <input
                  type="text"
                  value={strategyPrompt}
                  onChange={(e) => setStrategyPrompt(e.target.value)}
                  placeholder="Describe AI strategy bias..."
                  className="w-full rounded-lg border border-rose-500/15 bg-[#140709]/80 px-3 py-1.5 text-[11px] text-rose-100/80 focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
                <p className="text-[11px] text-rose-100/70 mt-1.5 leading-relaxed">{aiRationale}</p>
              </div>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-rose-500/25 border border-rose-400/50 text-xs text-rose-100">
                {errorMsg}
              </div>
            )}

            <button
              type="button"
              onClick={toggleBot}
              className={`w-full py-2.5 px-4 rounded-xl font-display font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all ${
                botRunning
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : 'bg-gradient-to-r from-rose-600 via-red-500 to-rose-600 hover:brightness-110 text-white shadow-lg shadow-rose-900/50'
              }`}
            >
              {botRunning ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" /> STOP GEMINI PROFIT BOT
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" /> LAUNCH GEMINI
                </>
              )}
            </button>

            <div className="text-center text-xs font-mono text-rose-100/80 py-2 rounded-lg bg-[#140709] border border-rose-500/15">
              {botRunning ? statusMessage : 'Trading is off.'}
            </div>
          </div>

          {/* Live Market Data */}
          <div className="rounded-xl border border-rose-500/20 bg-black/35 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-100">Live Market Data</span>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold text-rose-400">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" /> LIVE ·{' '}
                {currentMarket ? currentMarket.price.toFixed(currentAsset?.pipDecimals || 2) : '—'}
              </span>
            </div>

            <div className="rounded-xl border border-rose-500/15 bg-[#120608]/90 p-3.5">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {recentTenDigits.map((d, idx) => {
                  const isLatest = idx === recentTenDigits.length - 1;
                  const isGood = d >= 3 && d <= 8;
                  return (
                    <div
                      key={`${idx}-${d}`}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center font-mono text-sm font-bold transition-all ${
                        isLatest
                          ? 'bg-[#2a0c10] text-white border-2 border-rose-500 shadow-lg shadow-rose-600/40 scale-105'
                          : isGood
                            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-600/30'
                            : 'bg-rose-500 text-white shadow-md shadow-rose-600/30'
                      }`}
                    >
                      {d}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-lg bg-[#140709] border border-rose-500/15 p-2.5 text-center">
                <div className="text-[10px] uppercase tracking-wider text-rose-200/55">Last Digit</div>
                <div className="text-sm font-mono font-bold text-white mt-0.5">{currentMarket?.lastDigit ?? 0}</div>
              </div>
              <div className="rounded-lg bg-[#140709] border border-rose-500/15 p-2.5 text-center">
                <div className="text-[10px] uppercase tracking-wider text-rose-200/55">Wins</div>
                <div className="text-sm font-mono font-bold text-emerald-400 mt-0.5">{botWins}</div>
              </div>
              <div className="rounded-lg bg-[#140709] border border-rose-500/15 p-2.5 text-center">
                <div className="text-[10px] uppercase tracking-wider text-rose-200/55">Profit-Only P&amp;L</div>
                <div className="text-sm font-mono font-bold text-emerald-400 mt-0.5">+${botTotalPnl.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-[#140709] border border-rose-500/15 p-2.5 text-center">
                <div className="text-[10px] uppercase tracking-wider text-rose-200/55">Ticks Processed</div>
                <div className="text-sm font-mono font-bold text-white mt-0.5">{ticksProcessed}</div>
              </div>
            </div>
          </div>

          {floatingPos && (
            <div className="rounded-xl border border-amber-500/35 bg-amber-950/25 p-3.5 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-amber-300">
                  Profit-Only Guard Holding ({floatingPos.symbol} · {floatingPos.direction})
                </div>
                <div className="text-[11px] text-slate-300 font-mono mt-0.5">
                  Entry {floatingPos.entryPrice.toFixed(currentAsset?.pipDecimals || 2)} · Stake ${floatingPos.stake.toFixed(2)} · Target +${floatingPos.targetProfitUsd.toFixed(2)}
                </div>
              </div>
              <div
                className={`text-sm font-mono font-bold tabular-nums ${
                  floatingPos.unrealizedPnl > 0 ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {floatingPos.unrealizedPnl >= 0 ? '+' : ''}
                {floatingPos.unrealizedPnl.toFixed(2)} USD
              </div>
            </div>
          )}

          {/* Recent Contracts */}
          <div className="rounded-xl border border-rose-500/20 bg-black/35 p-4">
            <div className="text-xs font-semibold text-rose-100 mb-2.5">Recent Contracts</div>
            {botClosedTrades.length === 0 ? (
              <div className="text-center py-4 space-y-0.5">
                <p className="text-xs text-rose-200/60">No contracts yet</p>
                <p className="text-[11px] text-rose-200/40">Start trading to see your profit-only contracts here</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {botClosedTrades.slice(0, 8).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-[#140709] border border-rose-500/15"
                  >
                    <div className="flex items-center gap-2 font-mono">
                      <span className="font-semibold text-white">{t.symbol}</span>
                      <span className="text-rose-200/60">{t.direction}</span>
                      <span className="text-rose-200/45">${t.stake.toFixed(2)}</span>
                    </div>
                    <span className="font-mono font-bold text-emerald-400 tabular-nums">
                      +${t.profitLoss.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
