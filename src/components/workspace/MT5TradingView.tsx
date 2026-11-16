import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  BarChart2,
  Bell,
  CandlestickChart,
  Check,
  Clock,
  Crosshair,
  FilePlus2,
  History,
  Menu,
  MessageSquare,
  Minus,
  MoreHorizontal,
  PenTool,
  Plus,
  Search,
  SlidersHorizontal,
  TrendingUp,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/sessionMemory';
import type {
  AppNotification,
  MT5OrderType,
  MarketAsset,
  TradeRecord,
  TradingAccount,
} from '../../types/pipflow';
import type { MarketTickState } from '../../services/marketEngine';

type Mt5Tab = 'quotes' | 'charts' | 'trade' | 'history' | 'messages';

interface MT5TradingViewProps {
  markets: MarketAsset[];
  marketStates: Record<string, MarketTickState>;
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  activeAccount: TradingAccount | null;
  trades: TradeRecord[];
  notifications: AppNotification[];
  onRefreshState: () => Promise<void> | void;
  onAccountUpdated: (account: TradingAccount) => void;
}

interface DrawnLine {
  x1Ratio: number;
  y1Price: number;
  x2Ratio: number;
  y2Price: number;
  type: 'trend' | 'hline';
}

const MT5_TIMEFRAMES: { value: string; label: string; seconds: number }[] = [
  { value: '1T', label: 'M1', seconds: 60 },
  { value: '1m', label: 'M1', seconds: 60 },
  { value: '5m', label: 'M5', seconds: 300 },
  { value: '15m', label: 'M15', seconds: 900 },
  { value: '1h', label: 'H1', seconds: 3600 },
  { value: '24h', label: 'D1', seconds: 86400 },
];

function formatMt5SpaceNumber(value: number, decimals = 2): string {
  const neg = value < 0;
  const abs = Math.abs(value);
  const fixed = abs.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const spaced = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${spaced}${decPart !== undefined ? `.${decPart}` : ''}`;
}

function getMt5TfLabel(tf: string): string {
  const found = MT5_TIMEFRAMES.find((t) => t.value === tf);
  return found ? found.label : tf.toUpperCase();
}

function getMt5TfSeconds(tf: string): number {
  const found = MT5_TIMEFRAMES.find((t) => t.value === tf);
  return found ? found.seconds : 60;
}

function computeFloatingPnl(
  trade: TradeRecord,
  currentPrice: number,
  asset: MarketAsset | undefined
): number {
  const vol = Math.max(0.0001, asset?.volatility || 0.5);
  const diff = currentPrice - trade.entryPrice;
  const dirSign = trade.direction === 'BUY' || trade.direction === 'RISE' ? 1 : -1;
  const raw = ((diff * dirSign) / vol) * trade.stake * 0.45;
  return Number(Math.max(-trade.stake, raw).toFixed(2));
}

export function MT5TradingView({
  markets,
  marketStates,
  selectedSymbol,
  onSelectSymbol,
  timeframe,
  onTimeframeChange,
  activeAccount,
  trades,
  notifications,
  onRefreshState,
  onAccountUpdated,
}: MT5TradingViewProps) {
  const [mt5Tab, setMt5Tab] = useState<Mt5Tab>('charts');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quoteSearch, setQuoteSearch] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'today' | 'week'>('all');

  // Chart Toolbar & Indicators
  const [crosshairActive, setCrosshairActive] = useState(false);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [tfMenuOpen, setTfMenuOpen] = useState(false);
  const [slTpQuickBarOpen, setSlTpQuickBarOpen] = useState(true);
  const [showSma, setShowSma] = useState(false);
  const [showEma, setShowEma] = useState(false);
  const [drawTool, setDrawTool] = useState<'none' | 'trend' | 'hline'>('none');
  const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
  const [draftStart, setDraftStart] = useState<{ xRatio: number; price: number } | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const [countdownText, setCountdownText] = useState('00:45');

  // Order Modal (New Order with enabled Stop Loss & Take Profit)
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderSymbol, setOrderSymbol] = useState<string>(selectedSymbol);
  const [orderType, setOrderType] = useState<MT5OrderType>('MARKET');
  const [orderLots, setOrderLots] = useState<number>(0.1);
  const [orderStake, setOrderStake] = useState<number>(25);
  const [orderEntryPrice, setOrderEntryPrice] = useState<string>('');
  const [orderSl, setOrderSl] = useState<string>('');
  const [orderTp, setOrderTp] = useState<string>('');
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState('');

  // Modify SL/TP & Position Sheet
  const [selectedTrade, setSelectedTrade] = useState<TradeRecord | null>(null);
  const [modifyModalTrade, setModifyModalTrade] = useState<TradeRecord | null>(null);
  const [modifySl, setModifySl] = useState('');
  const [modifyTp, setModifyTp] = useState('');
  const [modifyBusy, setModifyBusy] = useState(false);

  // Menus & Toasts
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [quoteActionAsset, setQuoteActionAsset] = useState<MarketAsset | null>(null);
  const [mt5Messages, setMt5Messages] = useState<{ id: string; title: string; body: string; time: string }[]>([]);
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: 'info' | 'profit' | 'loss' } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const settlingRef = useRef<Set<string>>(new Set());
  const activatingRef = useRef<Set<string>>(new Set());

  const enabledMarkets = useMemo(() => markets.filter((m) => m.enabled), [markets]);
  const selectedAsset =
    enabledMarkets.find((m) => m.symbol === selectedSymbol) || enabledMarkets[0] || markets[0];
  const currentMarketState = marketStates[selectedAsset?.symbol] || marketStates[selectedSymbol];

  const showToast = (text: string, tone: 'info' | 'profit' | 'loss' = 'info') => {
    setToastMsg({ text, tone });
    window.setTimeout(() => {
      setToastMsg((prev) => (prev?.text === text ? null : prev));
    }, 3600);
  };

  // Candle countdown timer matching MT5 right-axis timer under live price pill
  useEffect(() => {
    const updateCountdown = () => {
      const period = getMt5TfSeconds(timeframe);
      const secNow = Math.floor(Date.now() / 1000);
      const rem = period - (secNow % period);
      const mm = String(Math.floor(rem / 60)).padStart(2, '0');
      const ss = String(rem % 60).padStart(2, '0');
      setCountdownText(`${mm}:${ss}`);
    };
    updateCountdown();
    const id = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(id);
  }, [timeframe]);

  // Keep order modal defaults synced when opened
  const openNewOrderModal = (sym?: string, presetDir?: 'BUY' | 'SELL') => {
    const targetSym = sym || selectedAsset.symbol;
    const asset = enabledMarkets.find((m) => m.symbol === targetSym) || selectedAsset;
    const st = marketStates[targetSym];
    const price = st?.price || asset.basePrice;
    const dec = asset.pipDecimals;
    const step = Math.max(Math.pow(10, -dec) * 25, asset.volatility * 1.4);

    setOrderSymbol(targetSym);
    setOrderType('MARKET');
    setOrderEntryPrice(price.toFixed(dec));
    if (presetDir === 'SELL') {
      setOrderSl((price + step).toFixed(dec));
      setOrderTp((price - step * 2).toFixed(dec));
    } else if (presetDir === 'BUY') {
      setOrderSl((price - step).toFixed(dec));
      setOrderTp((price + step * 2).toFixed(dec));
    } else {
      setOrderSl('');
      setOrderTp('');
    }
    setOrderError('');
    setOrderModalOpen(true);
  };

  const openPositions = useMemo(
    () => trades.filter((t) => t.status === 'open'),
    [trades]
  );
  const pendingOrders = useMemo(
    () => trades.filter((t) => t.status === 'pending'),
    [trades]
  );
  const closedHistory = useMemo(
    () => trades.filter((t) => t.status === 'closed'),
    [trades]
  );

  // Auto-execution watcher: closes open positions on SL / TP hit and fills pending orders
  useEffect(() => {
    if (!activeAccount) return;

    for (const trade of openPositions) {
      if (settlingRef.current.has(trade.id)) continue;
      const st = marketStates[trade.symbol];
      const asset = markets.find((m) => m.symbol === trade.symbol);
      if (!st || !asset) continue;

      const cur = st.price;
      const isBuy = trade.direction === 'BUY' || trade.direction === 'RISE';
      let reason: 'tp' | 'sl' | null = null;

      if (isBuy) {
        if (typeof trade.takeProfit === 'number' && cur >= trade.takeProfit) reason = 'tp';
        else if (typeof trade.stopLoss === 'number' && cur <= trade.stopLoss) reason = 'sl';
      } else {
        if (typeof trade.takeProfit === 'number' && cur <= trade.takeProfit) reason = 'tp';
        else if (typeof trade.stopLoss === 'number' && cur >= trade.stopLoss) reason = 'sl';
      }

      if (reason) {
        settlingRef.current.add(trade.id);
        const exitPrice =
          reason === 'tp' ? Number(trade.takeProfit) : Number(trade.stopLoss);
        const pnl = computeFloatingPnl(trade, exitPrice, asset);
        void apiFetch('/api/trading/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            tradeId: trade.id,
            exitPrice,
            profitLoss: pnl,
            closeReason: reason,
          }),
        })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              if (data.account) onAccountUpdated(data.account);
              const tag = reason === 'tp' ? 'Take Profit Hit' : 'Stop Loss Hit';
              const signed = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
              showToast(`${tag}: ${trade.symbol} (${signed})`, pnl >= 0 ? 'profit' : 'loss');
              setMt5Messages((prev) => [
                {
                  id: `msg_${Date.now()}_${trade.id}`,
                  title: `${tag} · ${trade.symbol}`,
                  body: `${trade.direction} closed @ ${exitPrice.toFixed(asset.pipDecimals)} (${signed})`,
                  time: new Date().toLocaleTimeString(),
                },
                ...prev.slice(0, 29),
              ]);
              void onRefreshState();
            }
          })
          .finally(() => {
            settlingRef.current.delete(trade.id);
          });
      }
    }

    for (const order of pendingOrders) {
      if (activatingRef.current.has(order.id)) continue;
      const st = marketStates[order.symbol];
      if (!st) continue;
      const cur = st.price;
      const ot = order.orderType;
      let triggered = false;
      if (ot === 'BUY_LIMIT' && cur <= order.entryPrice) triggered = true;
      if (ot === 'SELL_LIMIT' && cur >= order.entryPrice) triggered = true;
      if (ot === 'BUY_STOP' && cur >= order.entryPrice) triggered = true;
      if (ot === 'SELL_STOP' && cur <= order.entryPrice) triggered = true;

      if (triggered) {
        activatingRef.current.add(order.id);
        void apiFetch(`/api/trading/trades/${order.id}/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ fillPrice: cur }),
        })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              if (data.account) onAccountUpdated(data.account);
              showToast(`Pending ${ot?.replace('_', ' ')} filled on ${order.symbol} @ ${cur}`, 'info');
              void onRefreshState();
            }
          })
          .finally(() => {
            activatingRef.current.delete(order.id);
          });
      }
    }
  }, [marketStates, openPositions, pendingOrders, activeAccount?.accountId]);

  const floatingPnlById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of openPositions) {
      const st = marketStates[t.symbol];
      const asset = markets.find((m) => m.symbol === t.symbol);
      map[t.id] = computeFloatingPnl(t, st?.price || t.entryPrice, asset);
    }
    return map;
  }, [openPositions, marketStates, markets]);

  const totalFloatingPnl = useMemo(
    () => Object.values(floatingPnlById).reduce((acc, v) => acc + v, 0),
    [floatingPnlById]
  );

  const usedMargin = useMemo(
    () => openPositions.reduce((acc, t) => acc + t.stake, 0),
    [openPositions]
  );

  const balance = activeAccount?.balance ?? 0;
  const equity = balance + usedMargin + totalFloatingPnl;
  const freeMargin = Math.max(0, equity - usedMargin);
  const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : 0;

  // Render Pitch-Black MT5 Chart Canvas (with Entry, SL, TP, Bid/Ask, Countdown)
  useEffect(() => {
    if (mt5Tab !== 'charts' || !currentMarketState || !selectedAsset) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    // Pure MT5 Pitch Black Canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const padRight = 66;
    const padBottom = 24;
    const padTop = 14;
    const padLeft = 8;
    const plotW = Math.max(80, width - padRight - padLeft);
    const plotH = Math.max(80, height - padBottom - padTop);

    const candles = currentMarketState.candles.slice(-78);
    const activeSymbolTrades = [...openPositions, ...pendingOrders].filter(
      (t) => t.symbol === selectedAsset.symbol
    );

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    for (const c of candles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    }

    // Ensure SL/TP levels stay visible inside price viewport when close to price
    for (const t of activeSymbolTrades) {
      if (typeof t.entryPrice === 'number') {
        minPrice = Math.min(minPrice, t.entryPrice);
        maxPrice = Math.max(maxPrice, t.entryPrice);
      }
      if (typeof t.stopLoss === 'number') {
        minPrice = Math.min(minPrice, t.stopLoss);
        maxPrice = Math.max(maxPrice, t.stopLoss);
      }
      if (typeof t.takeProfit === 'number') {
        minPrice = Math.min(minPrice, t.takeProfit);
        maxPrice = Math.max(maxPrice, t.takeProfit);
      }
    }

    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice === maxPrice) {
      minPrice = currentMarketState.price * 0.996;
      maxPrice = currentMarketState.price * 1.004;
    }

    const spanPadding = (maxPrice - minPrice) * 0.12;
    minPrice -= spanPadding;
    maxPrice += spanPadding;

    const priceToY = (p: number) =>
      padTop + ((maxPrice - p) / (maxPrice - minPrice)) * plotH;
    const yToPrice = (y: number) =>
      maxPrice - ((y - padTop) / plotH) * (maxPrice - minPrice);

    // Subtle MT5 dashed horizontal gridlines + price axis labels
    const rows = 14;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i <= rows; i++) {
      const y = padTop + (plotH / rows) * i;
      const p = yToPrice(y);
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#9ca3af';
      ctx.fillText(p.toFixed(selectedAsset.pipDecimals), padLeft + plotW + 6, y + 3);
    }

    // Vertical dashed gridlines
    const cols = 5;
    for (let i = 1; i < cols; i++) {
      const x = padLeft + (plotW / cols) * i;
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Candles (MT5 teal bull / crimson bear)
    if (candles.length > 0) {
      const stepX = (plotW * 0.92) / candles.length;
      const bodyW = Math.max(2.5, Math.min(8, stepX * 0.62));

      candles.forEach((c, idx) => {
        const cx = padLeft + idx * stepX + stepX / 2;
        const isBull = c.close >= c.open;
        const color = isBull ? '#16a38a' : '#ef5350';

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(cx, priceToY(c.high));
        ctx.lineTo(cx, priceToY(c.low));
        ctx.stroke();

        const yOpen = priceToY(c.open);
        const yClose = priceToY(c.close);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(1.2, Math.abs(yClose - yOpen));
        ctx.fillStyle = color;
        ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
      });

      if (showSma && candles.length >= 10) {
        ctx.beginPath();
        candles.forEach((_, idx) => {
          const slice = candles.slice(Math.max(0, idx - 19), idx + 1);
          const avg = slice.reduce((s, b) => s + b.close, 0) / slice.length;
          const x = padLeft + idx * stepX + stepX / 2;
          const y = priceToY(avg);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      if (showEma && candles.length >= 5) {
        const k = 2 / 10;
        let ema = candles[0].close;
        ctx.beginPath();
        candles.forEach((c, idx) => {
          ema = c.close * k + ema * (1 - k);
          const x = padLeft + idx * stepX + stepX / 2;
          const y = priceToY(ema);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
    }

    // User drawn trendlines & horizontal lines
    for (const line of drawnLines) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (line.type === 'hline') {
        const y = priceToY(line.y1Price);
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
      } else {
        ctx.moveTo(padLeft + line.x1Ratio * plotW, priceToY(line.y1Price));
        ctx.lineTo(padLeft + line.x2Ratio * plotW, priceToY(line.y2Price));
      }
      ctx.stroke();
    }

    // Active Position Lines: Entry + Stop Loss (Red) + Take Profit (Green)
    for (const t of activeSymbolTrades) {
      const lots = (t.lotSize ?? Math.max(0.01, t.stake / 100)).toFixed(2);
      const isBuy = t.direction === 'BUY' || t.direction === 'RISE';
      const pnl = floatingPnlById[t.id] ?? 0;

      // Entry Price Line
      const yEntry = priceToY(t.entryPrice);
      if (yEntry >= padTop && yEntry <= padTop + plotH) {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(padLeft, yEntry);
        ctx.lineTo(padLeft + plotW, yEntry);
        ctx.stroke();
        ctx.setLineDash([]);

        const entryLabel = `${t.status === 'pending' ? t.orderType?.replace('_', ' ').toLowerCase() : isBuy ? 'buy' : 'sell'} ${lots}${t.status === 'open' ? ` (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)})` : ''}`;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(padLeft + 4, yEntry - 13, ctx.measureText(entryLabel).width + 10, 14);
        ctx.fillStyle = '#60a5fa';
        ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
        ctx.fillText(entryLabel, padLeft + 8, yEntry - 3);
      }

      // Stop Loss Line (Red)
      if (typeof t.stopLoss === 'number') {
        const ySl = priceToY(t.stopLoss);
        if (ySl >= padTop && ySl <= padTop + plotH) {
          ctx.setLineDash([5, 3]);
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(padLeft, ySl);
          ctx.lineTo(padLeft + plotW, ySl);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
          ctx.fillText('sl', padLeft + 6, ySl - 4);
          ctx.fillRect(padLeft + plotW + 2, ySl - 8, padRight - 4, 16);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(t.stopLoss.toFixed(selectedAsset.pipDecimals), padLeft + plotW + 5, ySl + 3);
        }
      }

      // Take Profit Line (Emerald)
      if (typeof t.takeProfit === 'number') {
        const yTp = priceToY(t.takeProfit);
        if (yTp >= padTop && yTp <= padTop + plotH) {
          ctx.setLineDash([5, 3]);
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(padLeft, yTp);
          ctx.lineTo(padLeft + plotW, yTp);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#22c55e';
          ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
          ctx.fillText('tp', padLeft + 6, yTp - 4);
          ctx.fillRect(padLeft + plotW + 2, yTp - 8, padRight - 4, 16);
          ctx.fillStyle = '#052e16';
          ctx.fillText(t.takeProfit.toFixed(selectedAsset.pipDecimals), padLeft + plotW + 5, yTp + 3);
        }
      }
    }

    // Current Ask & Bid horizontal lines + Solid Teal Right-Axis Tag with Countdown (Screenshot 1)
    const bidPrice = currentMarketState.price;
    const spreadStep = Math.max(Math.pow(10, -selectedAsset.pipDecimals) * 3, selectedAsset.volatility * 0.04);
    const askPrice = bidPrice + spreadStep;
    const yBid = priceToY(bidPrice);
    const yAsk = priceToY(askPrice);

    // Ask line (crimson/red above bid, matching MT5 screenshot 1)
    ctx.strokeStyle = '#ef5350';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(padLeft, yAsk);
    ctx.lineTo(padLeft + plotW, yAsk);
    ctx.stroke();

    // Bid line (teal/green)
    ctx.strokeStyle = '#16a38a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, yBid);
    ctx.lineTo(padLeft + plotW, yBid);
    ctx.stroke();

    // Two-line Teal Price + Candle Countdown Badge on Right Axis
    ctx.fillStyle = '#16a38a';
    ctx.fillRect(padLeft + plotW + 2, yBid - 12, padRight - 4, 24);
    ctx.fillStyle = '#e2fdf7';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillText(bidPrice.toFixed(selectedAsset.pipDecimals), padLeft + plotW + 5, yBid - 1);
    ctx.font = '9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#ccf5ec';
    ctx.fillText(countdownText, padLeft + plotW + 5, yBid + 9);

    // Crosshair lines when enabled
    if (crosshairActive && hoverPos && hoverPos.x <= padLeft + plotW && hoverPos.y <= padTop + plotH) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
      ctx.beginPath();
      ctx.moveTo(hoverPos.x, padTop);
      ctx.lineTo(hoverPos.x, padTop + plotH);
      ctx.moveTo(padLeft, hoverPos.y);
      ctx.lineTo(padLeft + plotW, hoverPos.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const pAtY = yToPrice(hoverPos.y);
      ctx.fillStyle = '#334155';
      ctx.fillRect(padLeft + plotW + 2, hoverPos.y - 8, padRight - 4, 16);
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(pAtY.toFixed(selectedAsset.pipDecimals), padLeft + plotW + 5, hoverPos.y + 3);
    }

    // Bottom Time Axis Labels (MT5 format: "16 Nov 05:00")
    if (candles.length > 4) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '9.5px "JetBrains Mono", monospace';
      for (let i = 0; i < 5; i++) {
        const idx = Math.floor((i / 4) * (candles.length - 1));
        const d = new Date(candles[idx].time);
        const day = d.getDate();
        const mon = d.toLocaleString('en-US', { month: 'short' });
        const hhmm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        const label = `${day} ${mon} ${hhmm}`;
        const x = padLeft + (idx / Math.max(1, candles.length - 1)) * (plotW * 0.92);
        ctx.fillText(label, Math.min(padLeft + plotW - 64, x), height - 6);
      }
    }
  }, [
    mt5Tab,
    currentMarketState,
    selectedAsset,
    openPositions,
    pendingOrders,
    floatingPnlById,
    showSma,
    showEma,
    drawnLines,
    crosshairActive,
    hoverPos,
    countdownText,
  ]);

  const handleCanvasPointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!currentMarketState || !selectedAsset) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setHoverPos({ x, y });

    const candles = currentMarketState.candles.slice(-78);
    let minP = Infinity;
    let maxP = -Infinity;
    candles.forEach((c) => {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    });
    if (!Number.isFinite(minP)) {
      minP = currentMarketState.price * 0.996;
      maxP = currentMarketState.price * 1.004;
    }
    const span = (maxP - minP) * 0.12;
    minP -= span;
    maxP += span;
    const plotH = Math.max(80, rect.height - 38);
    const p = maxP - ((y - 14) / plotH) * (maxP - minP);
    setHoverPrice(Number(p.toFixed(selectedAsset.pipDecimals)));
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawTool === 'none' || !currentMarketState || !selectedAsset) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const plotW = Math.max(80, rect.width - 74);
    const plotH = Math.max(80, rect.height - 38);
    const xRatio = Math.max(0, Math.min(1, (x - 8) / plotW));

    const candles = currentMarketState.candles.slice(-78);
    let minP = Infinity;
    let maxP = -Infinity;
    candles.forEach((c) => {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    });
    if (!Number.isFinite(minP)) {
      minP = currentMarketState.price * 0.996;
      maxP = currentMarketState.price * 1.004;
    }
    const span = (maxP - minP) * 0.12;
    minP -= span;
    maxP += span;
    const price = maxP - ((y - 14) / plotH) * (maxP - minP);

    if (drawTool === 'hline') {
      setDrawnLines((prev) => [...prev, { x1Ratio: 0, y1Price: price, x2Ratio: 1, y2Price: price, type: 'hline' }]);
      setDrawTool('none');
      return;
    }

    if (drawTool === 'trend') {
      if (!draftStart) {
        setDraftStart({ xRatio, price });
      } else {
        setDrawnLines((prev) => [
          ...prev,
          { x1Ratio: draftStart.xRatio, y1Price: draftStart.price, x2Ratio: xRatio, y2Price: price, type: 'trend' },
        ]);
        setDraftStart(null);
        setDrawTool('none');
      }
    }
  };

  const submitNewMt5Order = async (direction: 'BUY' | 'SELL') => {
    if (!activeAccount) {
      setOrderError('No active trading account selected.');
      return;
    }
    const asset = enabledMarkets.find((m) => m.symbol === orderSymbol) || selectedAsset;
    const st = marketStates[asset.symbol];
    const marketPrice = st?.price || asset.basePrice;
    const entry = orderType === 'MARKET' ? marketPrice : Number(orderEntryPrice || marketPrice);
    const slVal = orderSl.trim() ? Number(orderSl) : undefined;
    const tpVal = orderTp.trim() ? Number(orderTp) : undefined;

    if (!Number.isFinite(entry) || entry <= 0) {
      setOrderError('Enter a valid execution price.');
      return;
    }
    if (slVal !== undefined) {
      if (!Number.isFinite(slVal) || slVal <= 0) {
        setOrderError('Stop Loss must be a positive price.');
        return;
      }
      if (direction === 'BUY' && slVal >= entry) {
        setOrderError('For a BUY order, Stop Loss must be below entry price.');
        return;
      }
      if (direction === 'SELL' && slVal <= entry) {
        setOrderError('For a SELL order, Stop Loss must be above entry price.');
        return;
      }
    }
    if (tpVal !== undefined) {
      if (!Number.isFinite(tpVal) || tpVal <= 0) {
        setOrderError('Take Profit must be a positive price.');
        return;
      }
      if (direction === 'BUY' && tpVal <= entry) {
        setOrderError('For a BUY order, Take Profit must be above entry price.');
        return;
      }
      if (direction === 'SELL' && tpVal >= entry) {
        setOrderError('For a SELL order, Take Profit must be below entry price.');
        return;
      }
    }

    setOrderBusy(true);
    setOrderError('');
    try {
      const res = await apiFetch('/api/trading/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accountId: activeAccount.accountId,
          symbol: asset.symbol,
          tradeType: orderType === 'MARKET' ? 'MT5 Market' : orderType.replace('_', ' '),
          direction,
          orderType,
          lotSize: orderLots,
          stake: orderStake,
          entryPrice: entry,
          stopLoss: slVal,
          takeProfit: tpVal,
          source: 'manual',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOrderError(data.error || 'Failed to place order.');
        return;
      }
      if (data.account) onAccountUpdated(data.account);
      setOrderModalOpen(false);
      onSelectSymbol(asset.symbol);
      showToast(
        `${direction} ${orderLots.toFixed(2)} ${asset.symbol} opened${slVal ? ` · SL ${slVal}` : ''}${tpVal ? ` · TP ${tpVal}` : ''}`,
        'info'
      );
      setMt5Messages((prev) => [
        {
          id: `msg_${Date.now()}`,
          title: `Order Placed · ${asset.symbol}`,
          body: `${orderType} ${direction} ${orderLots.toFixed(2)} lots ($${orderStake}) @ ${entry.toFixed(asset.pipDecimals)}${slVal ? ` | SL: ${slVal}` : ''}${tpVal ? ` | TP: ${tpVal}` : ''}`,
          time: new Date().toLocaleTimeString(),
        },
        ...prev.slice(0, 29),
      ]);
      void onRefreshState();
    } catch {
      setOrderError('Network error placing order.');
    } finally {
      setOrderBusy(false);
    }
  };

  const openModifyDialog = (trade: TradeRecord) => {
    const asset = markets.find((m) => m.symbol === trade.symbol);
    const dec = asset?.pipDecimals ?? 2;
    setModifyModalTrade(trade);
    setModifySl(typeof trade.stopLoss === 'number' ? trade.stopLoss.toFixed(dec) : '');
    setModifyTp(typeof trade.takeProfit === 'number' ? trade.takeProfit.toFixed(dec) : '');
    setSelectedTrade(null);
  };

  const saveModifiedSlTp = async () => {
    if (!modifyModalTrade) return;
    const slVal = modifySl.trim() ? Number(modifySl) : null;
    const tpVal = modifyTp.trim() ? Number(modifyTp) : null;
    if (slVal !== null && (!Number.isFinite(slVal) || slVal <= 0)) {
      showToast('Invalid Stop Loss price.', 'loss');
      return;
    }
    if (tpVal !== null && (!Number.isFinite(tpVal) || tpVal <= 0)) {
      showToast('Invalid Take Profit price.', 'loss');
      return;
    }
    setModifyBusy(true);
    try {
      const res = await apiFetch(`/api/trading/trades/${modifyModalTrade.id}/sl-tp`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stopLoss: slVal, takeProfit: tpVal }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || 'Could not update SL/TP.', 'loss');
        return;
      }
      setModifyModalTrade(null);
      showToast(
        `Modified ${modifyModalTrade.symbol} · SL: ${slVal ?? 'None'} · TP: ${tpVal ?? 'None'}`,
        'info'
      );
      void onRefreshState();
    } finally {
      setModifyBusy(false);
    }
  };

  const closeSinglePosition = async (trade: TradeRecord) => {
    const st = marketStates[trade.symbol];
    const asset = markets.find((m) => m.symbol === trade.symbol);
    const curPrice = st?.price || trade.entryPrice;
    const pnl = computeFloatingPnl(trade, curPrice, asset);

    const res = await apiFetch('/api/trading/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        tradeId: trade.id,
        exitPrice: curPrice,
        profitLoss: pnl,
        closeReason: 'manual',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.account) onAccountUpdated(data.account);
      setSelectedTrade(null);
      showToast(
        `Closed ${trade.symbol} (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`,
        pnl >= 0 ? 'profit' : 'loss'
      );
      void onRefreshState();
    }
  };

  const bulkClosePositions = async (mode: 'all' | 'profit' | 'loss') => {
    setBulkMenuOpen(false);
    const targets = openPositions.filter((t) => {
      const p = floatingPnlById[t.id] ?? 0;
      if (mode === 'profit') return p > 0;
      if (mode === 'loss') return p < 0;
      return true;
    });
    for (const t of targets) {
      await closeSinglePosition(t);
    }
  };

  const cancelPendingOrder = async (tradeId: string) => {
    const res = await apiFetch(`/api/trading/trades/${tradeId}/cancel`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) {
      setSelectedTrade(null);
      showToast('Pending order cancelled.', 'info');
      void onRefreshState();
    }
  };

  const currentSymbolOpenTrades = openPositions.filter((t) => t.symbol === selectedAsset?.symbol);

  const filteredQuotes = enabledMarkets.filter(
    (m) =>
      !quoteSearch.trim() ||
      m.symbol.toLowerCase().includes(quoteSearch.toLowerCase()) ||
      m.name.toLowerCase().includes(quoteSearch.toLowerCase())
  );

  const filteredHistory = useMemo(() => {
    const now = Date.now();
    return closedHistory.filter((t) => {
      if (historyFilter === 'all') return true;
      const ts = new Date(t.closedAt || t.openedAt).getTime();
      if (historyFilter === 'today') return now - ts <= 86400_000;
      return now - ts <= 7 * 86400_000;
    });
  }, [closedHistory, historyFilter]);

  const historyTotals = useMemo(() => {
    const profit = filteredHistory.reduce((s, t) => s + t.profitLoss, 0);
    return { profit, count: filteredHistory.length };
  }, [filteredHistory]);

  return (
    <div className="relative rounded-xl border border-[#1a2232] bg-[#000000] text-white overflow-hidden shadow-2xl flex flex-col min-h-[640px] lg:min-h-[700px] select-none">
      {/* Live Execution / SL-TP Notification Toast */}
      {toastMsg && (
        <div
          className={`fixed sm:absolute top-14 right-3 z-50 px-3 py-2 rounded-lg border text-xs font-mono shadow-xl ${
            toastMsg.tone === 'profit'
              ? 'bg-emerald-950/95 border-emerald-500/60 text-emerald-300'
              : toastMsg.tone === 'loss'
                ? 'bg-rose-950/95 border-rose-500/60 text-rose-300'
                : 'bg-[#0d1628]/95 border-[#2b8cff]/60 text-sky-200'
          }`}
        >
          {toastMsg.text}
        </div>
      )}

      {/* Slide-out MT5 Hamburger Drawer */}
      {drawerOpen && (
        <div className="absolute inset-0 z-40 flex">
          <div className="w-72 max-w-[82%] bg-[#0c1017] border-r border-[#1c2331] h-full flex flex-col p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-[#1c2331] pb-3">
              <div>
                <div className="text-sm font-bold text-white">MetaTrader 5 View</div>
                <div className="text-[11px] font-mono text-[#2b8cff]">
                  {activeAccount ? `${activeAccount.accountId} (${activeAccount.accountType.toUpperCase()})` : 'Paper Terminal'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded hover:bg-[#1a2232] text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1 text-xs">
              {(
                [
                  { id: 'quotes', label: 'Quotes', icon: ArrowUpDown },
                  { id: 'charts', label: 'Charts', icon: CandlestickChart },
                  { id: 'trade', label: 'Trade', icon: TrendingUp },
                  { id: 'history', label: 'History', icon: History },
                  { id: 'messages', label: 'Messages', icon: MessageSquare },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setMt5Tab(item.id);
                      setDrawerOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left ${
                      mt5Tab === item.id ? 'bg-[#2b8cff]/15 text-[#2b8cff] font-semibold' : 'text-slate-300 hover:bg-[#151b26]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-[#1c2331] pt-3 space-y-2 flex-1 overflow-y-auto">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Quick Switch Symbol
              </div>
              {enabledMarkets.slice(0, 12).map((m) => (
                <button
                  key={m.symbol}
                  type="button"
                  onClick={() => {
                    onSelectSymbol(m.symbol);
                    setMt5Tab('charts');
                    setDrawerOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs ${
                    m.symbol === selectedAsset?.symbol ? 'bg-[#1a2436] text-[#2b8cff]' : 'text-slate-300 hover:bg-[#141923]'
                  }`}
                >
                  <span className="font-mono font-semibold">{m.symbol}</span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {(marketStates[m.symbol]?.price || m.basePrice).toFixed(m.pipDecimals)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 bg-black/60" onClick={() => setDrawerOpen(false)} />
        </div>
      )}

      {/* ==================== TAB 1: QUOTES ==================== */}
      {mt5Tab === 'quotes' && (
        <div className="flex-1 flex flex-col bg-[#000000]">
          <div className="h-12 px-3 border-b border-[#161b24] flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="p-1.5 text-slate-300 hover:text-white"
              >
                <Menu className="w-5 h-5" />
              </button>
              <span className="font-semibold text-[15px]">Quotes</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={quoteSearch}
                  onChange={(e) => setQuoteSearch(e.target.value)}
                  placeholder="Find symbol..."
                  className="w-36 sm:w-48 pl-8 pr-2.5 py-1 rounded bg-[#0d1118] border border-[#1d2534] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#2b8cff]"
                />
              </div>
              <button
                type="button"
                onClick={() => openNewOrderModal(selectedAsset.symbol)}
                title="New Order (SL/TP)"
                className="p-1.5 rounded text-[#2b8cff] hover:bg-[#131b29]"
              >
                <FilePlus2 className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#11161f]">
            {filteredQuotes.map((m) => {
              const st = marketStates[m.symbol];
              const bid = st?.price || m.basePrice;
              const prev = st?.prevPrice || bid;
              const up = bid >= prev;
              const spreadPts = Math.max(2, Math.round(m.volatility * 12));
              const ask = bid + Math.max(Math.pow(10, -m.pipDecimals) * 3, m.volatility * 0.04);
              const candlesArr = st?.candles || [];
              const low = candlesArr.length ? Math.min(...candlesArr.map((c) => c.low)) : bid * 0.992;
              const high = candlesArr.length ? Math.max(...candlesArr.map((c) => c.high)) : bid * 1.008;

              return (
                <button
                  key={m.symbol}
                  type="button"
                  onClick={() => setQuoteActionAsset(m)}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between hover:bg-[#0a0e16] text-left transition-colors"
                >
                  <div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {new Date().toLocaleTimeString([], { hour12: false })} · Spread {spreadPts}
                    </div>
                    <div className="text-[15px] font-bold text-white tracking-tight">
                      {m.symbol}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      L: {low.toFixed(m.pipDecimals)} &nbsp; H: {high.toFixed(m.pipDecimals)}
                    </div>
                  </div>
                  <div className="flex items-baseline gap-4 font-mono tabular-nums">
                    <span className={`text-[15px] font-semibold ${up ? 'text-[#2b8cff]' : 'text-[#ef5350]'}`}>
                      {bid.toFixed(m.pipDecimals)}
                    </span>
                    <span className={`text-[15px] font-semibold ${up ? 'text-[#2b8cff]' : 'text-[#ef5350]'}`}>
                      {ask.toFixed(m.pipDecimals)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================== TAB 2: CHARTS (Exact Screenshot 1 Match) ==================== */}
      {mt5Tab === 'charts' && selectedAsset && currentMarketState && (
        <div className="flex-1 flex flex-col bg-[#000000]">
          {/* MT5 Top Chart Bar */}
          <div className="h-12 px-3 bg-[#000000] border-b border-[#141923] flex items-center justify-between gap-2 relative z-20">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="p-1.5 text-slate-200 hover:text-white"
                title="MT5 Menu & Symbols"
              >
                <Menu className="w-5 h-5" />
              </button>
              <select
                value={selectedAsset.symbol}
                onChange={(e) => onSelectSymbol(e.target.value)}
                className="bg-transparent text-xs font-mono font-bold text-slate-300 focus:outline-none cursor-pointer"
              >
                {enabledMarkets.map((m) => (
                  <option key={m.symbol} value={m.symbol} className="bg-[#0b111c] text-white">
                    {m.symbol} — {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Right Icon Cluster matching Screenshot 1 */}
            <div className="flex items-center gap-3 sm:gap-4">
              <button
                type="button"
                onClick={() => setCrosshairActive((v) => !v)}
                title="Crosshair"
                className={`p-1.5 rounded ${crosshairActive ? 'text-[#2b8cff] bg-[#131d2e]' : 'text-slate-200 hover:text-white'}`}
              >
                <Crosshair className="w-[18px] h-[18px]" />
              </button>

              {/* Indicators 'f' */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIndicatorsOpen((v) => !v);
                    setTfMenuOpen(false);
                  }}
                  title="Indicators & Drawing Tools"
                  className={`px-1.5 py-1 rounded font-serif italic font-bold text-[15px] ${
                    showSma || showEma || drawTool !== 'none'
                      ? 'text-[#2b8cff] bg-[#131d2e]'
                      : 'text-slate-200 hover:text-white'
                  }`}
                >
                  f<span className="text-[10px] not-italic ml-0.5">+</span>
                </button>
                {indicatorsOpen && (
                  <div className="absolute right-0 mt-2 w-48 rounded-lg bg-[#0e141f] border border-[#222c3e] shadow-2xl p-2 space-y-1 text-xs z-30">
                    <button
                      type="button"
                      onClick={() => setShowSma((s) => !s)}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-[#192335]"
                    >
                      <span>Moving Average (SMA 20)</span>
                      {showSma && <Check className="w-3.5 h-3.5 text-[#2b8cff]" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowEma((s) => !s)}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-[#192335]"
                    >
                      <span>EMA (9)</span>
                      {showEma && <Check className="w-3.5 h-3.5 text-amber-400" />}
                    </button>
                    <div className="border-t border-[#1e2738] my-1" />
                    <button
                      type="button"
                      onClick={() => {
                        setDrawTool('hline');
                        setIndicatorsOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[#192335]"
                    >
                      <Minus className="w-3.5 h-3.5 text-sky-400" />
                      <span>Horizontal Line</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrawTool('trend');
                        setDraftStart(null);
                        setIndicatorsOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[#192335]"
                    >
                      <PenTool className="w-3.5 h-3.5 text-sky-400" />
                      <span>Trendline</span>
                    </button>
                    {drawnLines.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setDrawnLines([]);
                          setIndicatorsOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded text-rose-400 hover:bg-[#192335]"
                      >
                        Clear All Drawings ({drawnLines.length})
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Timeframe Selector (M1, M5, M15, H1, D1) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setTfMenuOpen((v) => !v);
                    setIndicatorsOpen(false);
                  }}
                  className="px-1.5 py-1 text-[13px] font-bold tracking-wide text-white hover:text-[#2b8cff]"
                >
                  {getMt5TfLabel(timeframe)}
                </button>
                {tfMenuOpen && (
                  <div className="absolute right-0 mt-2 w-28 rounded-lg bg-[#0e141f] border border-[#222c3e] shadow-2xl p-1.5 grid grid-cols-1 gap-0.5 text-xs z-30">
                    {MT5_TIMEFRAMES.slice(1).map((tf) => (
                      <button
                        key={tf.value}
                        type="button"
                        onClick={() => {
                          onTimeframeChange(tf.value);
                          setTfMenuOpen(false);
                        }}
                        className={`px-2.5 py-1.5 rounded text-left font-mono ${
                          timeframe === tf.value ? 'bg-[#2b8cff] text-white font-bold' : 'text-slate-300 hover:bg-[#192335]'
                        }`}
                      >
                        {tf.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Toggle SL/TP & Quick Trade Bar */}
              <button
                type="button"
                onClick={() => setSlTpQuickBarOpen((v) => !v)}
                title="Toggle Chart SL/TP Bar"
                className={`p-1.5 rounded ${slTpQuickBarOpen ? 'text-[#2b8cff]' : 'text-slate-300 hover:text-white'}`}
              >
                <Clock className="w-[18px] h-[18px]" />
              </button>

              {/* New Order [+] Icon (Blue/Red MT5 Box) */}
              <button
                type="button"
                onClick={() => openNewOrderModal(selectedAsset.symbol)}
                title="New Order (with Stop Loss & Take Profit)"
                className="p-1.5 rounded text-[#3b82f6] hover:bg-[#131d2e]"
              >
                <FilePlus2 className="w-[19px] h-[19px]" />
              </button>
            </div>
          </div>

          {/* Chart Canvas Area */}
          <div ref={containerRef} className="relative flex-1 min-h-[420px] bg-[#000000] overflow-hidden">
            <canvas
              ref={canvasRef}
              onMouseMove={handleCanvasPointerMove}
              onMouseLeave={() => {
                setHoverPos(null);
                setHoverPrice(null);
              }}
              onClick={handleCanvasClick}
              className="w-full h-full block cursor-crosshair"
            />

            {/* Top-left Overlay matching Screenshot 1 */}
            <div className="pointer-events-none absolute top-2.5 left-3 space-y-0.5">
              <div className="text-[12px] font-bold tracking-tight">
                <span className="text-[#3b82f6]">{selectedAsset.symbol}</span>
                <span className="text-slate-300"> • {getMt5TfLabel(timeframe)}</span>
              </div>
              <div className="text-[11px] text-slate-300">{selectedAsset.name}</div>
              {crosshairActive && hoverPrice !== null && (
                <div className="text-[10.5px] font-mono text-sky-300 bg-black/70 px-1.5 py-0.5 rounded inline-block mt-1">
                  Cursor: {hoverPrice.toFixed(selectedAsset.pipDecimals)}
                </div>
              )}
              {drawTool !== 'none' && (
                <div className="text-[10.5px] font-mono text-amber-300 bg-black/80 px-2 py-0.5 rounded inline-block mt-1">
                  {drawTool === 'hline' ? 'Tap price level for H-Line' : draftStart ? 'Tap end point' : 'Tap start point'}
                </div>
              )}
            </div>

            {/* Bottom-right '•••' Shortcut matching Screenshot 1 */}
            <button
              type="button"
              onClick={() => openNewOrderModal(selectedAsset.symbol)}
              title="Open Order Ticket"
              className="absolute bottom-2 right-2 p-1 text-slate-300 hover:text-white"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>

          {/* Enabled Chart SL / TP & Instant Market Execution Bar */}
          {slTpQuickBarOpen && (
            <div className="bg-[#070a10] border-t border-[#151c28] px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => openNewOrderModal(selectedAsset.symbol, 'SELL')}
                  className="px-3 py-1.5 rounded bg-[#ef5350]/15 border border-[#ef5350]/50 text-[#ef5350] hover:bg-[#ef5350]/25 font-mono font-bold"
                >
                  SELL + SL/TP
                </button>
                <button
                  type="button"
                  onClick={() => openNewOrderModal(selectedAsset.symbol, 'BUY')}
                  className="px-3 py-1.5 rounded bg-[#2b8cff]/15 border border-[#2b8cff]/50 text-[#2b8cff] hover:bg-[#2b8cff]/25 font-mono font-bold"
                >
                  BUY + SL/TP
                </button>
              </div>

              {currentSymbolOpenTrades.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {currentSymbolOpenTrades.slice(0, 2).map((t) => {
                    const pnl = floatingPnlById[t.id] ?? 0;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => openModifyDialog(t)}
                        className="px-2.5 py-1 rounded bg-[#101724] border border-[#243044] hover:border-[#2b8cff] flex items-center gap-2 font-mono text-[11px]"
                      >
                        <span className={t.direction === 'BUY' || t.direction === 'RISE' ? 'text-[#2b8cff]' : 'text-[#ef5350]'}>
                          {t.direction}
                        </span>
                        <span className={pnl >= 0 ? 'text-[#2b8cff]' : 'text-[#ef5350]'}>
                          {pnl >= 0 ? '+' : ''}
                          {pnl.toFixed(2)}
                        </span>
                        <span className="text-rose-400">SL:{t.stopLoss ?? '—'}</span>
                        <span className="text-emerald-400">TP:{t.takeProfit ?? '—'}</span>
                        <span className="text-slate-400 underline">Edit</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span className="text-[11px] font-mono text-slate-400">
                  SL & TP enabled · Tap BUY/SELL or [+] to set Stop Loss & Take Profit
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 3: TRADE (Exact Screenshot 2 Match) ==================== */}
      {mt5Tab === 'trade' && (
        <div className="flex-1 flex flex-col bg-[#000000]">
          {/* MT5 Trade Top Bar */}
          <div className="h-14 px-3.5 border-b border-[#141923] flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="p-1.5 text-slate-200 hover:text-white"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div>
                <div className="text-[12px] text-slate-300 font-medium leading-tight">Trade</div>
                <div
                  className={`text-[15px] font-bold font-mono tabular-nums ${
                    totalFloatingPnl >= 0 ? 'text-[#2b8cff]' : 'text-[#ef5350]'
                  }`}
                >
                  {totalFloatingPnl >= 0 ? '+' : ''}
                  {formatMt5SpaceNumber(totalFloatingPnl, 2)} {activeAccount?.currency || 'USD'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setBulkMenuOpen((v) => !v)}
                title="Bulk Position Operations"
                className="p-1.5 text-slate-200 hover:text-white"
              >
                <ArrowUpDown className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => openNewOrderModal(selectedAsset?.symbol)}
                title="New Order (SL/TP)"
                className="p-1.5 text-[#2b8cff] hover:text-sky-300"
              >
                <FilePlus2 className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* MT5 Account Summary with Dotted Leader Lines (Exact Screenshot 2 layout) */}
          <div className="px-3.5 py-2.5 border-b border-[#141923] space-y-1 text-[12.5px] font-mono">
            {[
              { label: 'Balance:', val: formatMt5SpaceNumber(balance, 2) },
              { label: 'Equity:', val: formatMt5SpaceNumber(equity, 2) },
              { label: 'Margin:', val: formatMt5SpaceNumber(usedMargin, 2) },
              { label: 'Free margin:', val: formatMt5SpaceNumber(freeMargin, 2) },
              { label: 'Margin Level (%):', val: usedMargin > 0 ? formatMt5SpaceNumber(marginLevel, 2) : '0.00' },
            ].map((row) => (
              <div key={row.label} className="flex items-baseline gap-1.5">
                <span className="font-sans font-semibold text-white shrink-0">{row.label}</span>
                <span className="flex-1 border-b border-dotted border-slate-700/80 mb-1" />
                <span className="font-bold text-white tabular-nums shrink-0">{row.val}</span>
              </div>
            ))}
          </div>

          {/* Positions Section Header */}
          <div className="relative px-3.5 py-1.5 bg-[#0b0e14] border-b border-[#161b24] flex items-center justify-between">
            <span className="text-[12px] font-semibold text-slate-300">
              Positions ({openPositions.length})
            </span>
            <button
              type="button"
              onClick={() => setBulkMenuOpen((v) => !v)}
              className="p-1 text-slate-400 hover:text-white"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {bulkMenuOpen && (
              <div className="absolute right-3 top-8 z-30 w-48 rounded-lg bg-[#0f1522] border border-[#243044] shadow-2xl p-1.5 text-xs space-y-1">
                <button
                  type="button"
                  onClick={() => void bulkClosePositions('all')}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[#192335] text-white"
                >
                  Close All Positions
                </button>
                <button
                  type="button"
                  onClick={() => void bulkClosePositions('profit')}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[#192335] text-[#2b8cff]"
                >
                  Close Profitable Positions
                </button>
                <button
                  type="button"
                  onClick={() => void bulkClosePositions('loss')}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[#192335] text-[#ef5350]"
                >
                  Close Losing Positions
                </button>
              </div>
            )}
          </div>

          {/* Open Positions List matching Screenshot 2 */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#121721]">
            {openPositions.length === 0 ? (
              <div className="px-4 py-10 text-center space-y-3">
                <div className="text-sm text-slate-400">No open positions right now.</div>
                <button
                  type="button"
                  onClick={() => openNewOrderModal(selectedAsset?.symbol)}
                  className="px-4 py-2 rounded-lg bg-[#2b8cff] hover:bg-sky-500 text-white text-xs font-bold"
                >
                  + New Order with SL / TP
                </button>
              </div>
            ) : (
              openPositions.map((t) => {
                const asset = markets.find((m) => m.symbol === t.symbol);
                const dec = asset?.pipDecimals ?? 2;
                const cur = marketStates[t.symbol]?.price || t.entryPrice;
                const pnl = floatingPnlById[t.id] ?? 0;
                const isBuy = t.direction === 'BUY' || t.direction === 'RISE';
                const lots = (t.lotSize ?? Math.max(0.01, t.stake / 100)).toFixed(2);

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTrade(t)}
                    className="w-full px-3.5 py-2.5 flex items-center justify-between hover:bg-[#090d14] text-left transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="text-[13.5px] leading-tight">
                        <span className="font-bold text-white">{t.symbol}, </span>
                        <span className={`font-semibold ${isBuy ? 'text-[#2b8cff]' : 'text-[#ef5350]'}`}>
                          {isBuy ? 'buy' : 'sell'} {lots}
                        </span>
                      </div>
                      <div className="text-[12px] font-mono text-slate-400 tabular-nums">
                        {formatMt5SpaceNumber(t.entryPrice, dec)} → {formatMt5SpaceNumber(cur, dec)}
                      </div>
                      <div className="text-[10.5px] font-mono flex items-center gap-3">
                        <span className={t.stopLoss ? 'text-rose-400' : 'text-slate-500'}>
                          S/L: {t.stopLoss ? t.stopLoss.toFixed(dec) : '—'}
                        </span>
                        <span className={t.takeProfit ? 'text-emerald-400' : 'text-slate-500'}>
                          T/P: {t.takeProfit ? t.takeProfit.toFixed(dec) : '—'}
                        </span>
                      </div>
                    </div>

                    <div
                      className={`text-[15px] font-bold font-mono tabular-nums ${
                        pnl >= 0 ? 'text-[#2b8cff]' : 'text-[#ef5350]'
                      }`}
                    >
                      {pnl >= 0 ? '+' : ''}
                      {formatMt5SpaceNumber(pnl, 2)}
                    </div>
                  </button>
                );
              })
            )}

            {/* Pending Orders Section (Limit / Stop Orders with SL & TP) */}
            {pendingOrders.length > 0 && (
              <div>
                <div className="px-3.5 py-1.5 bg-[#0b0e14] border-y border-[#161b24] text-[12px] font-semibold text-slate-300">
                  Orders ({pendingOrders.length})
                </div>
                {pendingOrders.map((o) => {
                  const asset = markets.find((m) => m.symbol === o.symbol);
                  const dec = asset?.pipDecimals ?? 2;
                  const isBuy = o.direction === 'BUY' || o.direction === 'RISE';
                  const lots = (o.lotSize ?? Math.max(0.01, o.stake / 100)).toFixed(2);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setSelectedTrade(o)}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between border-b border-[#121721] hover:bg-[#090d14] text-left"
                    >
                      <div>
                        <div className="text-[13px]">
                          <span className="font-bold text-white">{o.symbol}, </span>
                          <span className={isBuy ? 'text-[#2b8cff]' : 'text-[#ef5350]'}>
                            {(o.orderType || 'LIMIT').toLowerCase().replace('_', ' ')} {lots}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          @ {o.entryPrice.toFixed(dec)} · SL: {o.stopLoss?.toFixed(dec) || '—'} · TP:{' '}
                          {o.takeProfit?.toFixed(dec) || '—'}
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-amber-400">placed</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 4: HISTORY ==================== */}
      {mt5Tab === 'history' && (
        <div className="flex-1 flex flex-col bg-[#000000]">
          <div className="h-12 px-3.5 border-b border-[#141923] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="p-1.5 text-slate-200 hover:text-white"
              >
                <Menu className="w-5 h-5" />
              </button>
              <span className="font-semibold text-[15px]">History</span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              {(['all', 'today', 'week'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setHistoryFilter(f)}
                  className={`px-2.5 py-1 rounded font-mono capitalize ${
                    historyFilter === f ? 'bg-[#2b8cff] text-white font-bold' : 'text-slate-400 hover:bg-[#111722]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="px-3.5 py-2.5 border-b border-[#141923] space-y-1 text-xs font-mono">
            <div className="flex items-baseline gap-1.5">
              <span className="font-sans font-semibold text-white">Profit:</span>
              <span className="flex-1 border-b border-dotted border-slate-700" />
              <span className={`font-bold ${historyTotals.profit >= 0 ? 'text-[#2b8cff]' : 'text-[#ef5350]'}`}>
                {historyTotals.profit >= 0 ? '+' : ''}
                {formatMt5SpaceNumber(historyTotals.profit, 2)}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-sans font-semibold text-white">Closed Deals:</span>
              <span className="flex-1 border-b border-dotted border-slate-700" />
              <span className="font-bold text-white">{historyTotals.count}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-sans font-semibold text-white">Balance:</span>
              <span className="flex-1 border-b border-dotted border-slate-700" />
              <span className="font-bold text-white">{formatMt5SpaceNumber(balance, 2)}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#11161f]">
            {filteredHistory.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No closed positions in this period.</div>
            ) : (
              filteredHistory.slice(0, 60).map((t) => {
                const asset = markets.find((m) => m.symbol === t.symbol);
                const dec = asset?.pipDecimals ?? 2;
                const isBuy = t.direction === 'BUY' || t.direction === 'RISE';
                const lots = (t.lotSize ?? Math.max(0.01, t.stake / 100)).toFixed(2);
                return (
                  <div key={t.id} className="px-3.5 py-2.5 flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="text-[13px]">
                        <span className="font-bold text-white">{t.symbol}, </span>
                        <span className={isBuy ? 'text-[#2b8cff]' : 'text-[#ef5350]'}>
                          {isBuy ? 'buy' : 'sell'} {lots}
                        </span>
                        {t.closeReason === 'tp' && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-mono">
                            TP
                          </span>
                        )}
                        {t.closeReason === 'sl' && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 text-[10px] font-mono">
                            SL
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {t.entryPrice.toFixed(dec)} → {(t.exitPrice || t.entryPrice).toFixed(dec)} ·{' '}
                        {new Date(t.closedAt || t.openedAt).toLocaleString()}
                      </div>
                    </div>
                    <div
                      className={`text-[14px] font-bold font-mono tabular-nums ${
                        t.profitLoss >= 0 ? 'text-[#2b8cff]' : 'text-[#ef5350]'
                      }`}
                    >
                      {t.profitLoss >= 0 ? '+' : ''}
                      {formatMt5SpaceNumber(t.profitLoss, 2)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 5: MESSAGES ==================== */}
      {mt5Tab === 'messages' && (
        <div className="flex-1 flex flex-col bg-[#000000]">
          <div className="h-12 px-3.5 border-b border-[#141923] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="p-1.5 text-slate-200 hover:text-white"
              >
                <Menu className="w-5 h-5" />
              </button>
              <span className="font-semibold text-[15px]">Messages</span>
            </div>
            <Bell className="w-4 h-4 text-slate-400" />
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-[#11161f]">
            {[
              ...mt5Messages,
              ...notifications.map((n) => ({
                id: n.id,
                title: n.title,
                body: n.message,
                time: new Date(n.createdAt).toLocaleString(),
              })),
            ].length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">No MT5 alerts or messages yet.</div>
            ) : (
              [
                ...mt5Messages,
                ...notifications.map((n) => ({
                  id: n.id,
                  title: n.title,
                  body: n.message,
                  time: new Date(n.createdAt).toLocaleString(),
                })),
              ].map((m) => (
                <div key={m.id} className="px-3.5 py-3 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">{m.title}</span>
                    <span className="font-mono text-[10px] text-slate-500">{m.time}</span>
                  </div>
                  <div className="text-xs text-slate-400">{m.body}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ==================== MT5 BOTTOM 5-TAB BAR (Exact Screenshots 1 & 2) ==================== */}
      <div className="h-14 bg-[#07090e] border-t border-[#171d28] grid grid-cols-5 items-center px-1 shrink-0">
        {(
          [
            { id: 'quotes', label: 'Quotes', icon: ArrowUpDown },
            { id: 'charts', label: 'Charts', icon: CandlestickChart },
            {
              id: 'trade',
              label:
                openPositions.length > 0
                  ? `${totalFloatingPnl.toFixed(2)}`
                  : 'Trade',
              icon: TrendingUp,
              isTrade: true,
            },
            { id: 'history', label: 'History', icon: History },
            { id: 'messages', label: 'Messages', icon: MessageSquare },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = mt5Tab === tab.id;
          const tradeColor =
            'isTrade' in tab && tab.isTrade && openPositions.length > 0
              ? totalFloatingPnl >= 0
                ? 'text-[#2b8cff]'
                : 'text-[#ef5350]'
              : active
                ? 'text-[#2b8cff]'
                : 'text-slate-400';

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMt5Tab(tab.id)}
              className="flex flex-col items-center justify-center gap-0.5 py-1 hover:bg-[#0e131d] rounded transition-colors"
            >
              <Icon className={`w-[18px] h-[18px] ${active ? 'text-[#2b8cff]' : 'text-slate-300'}`} />
              <span className={`text-[10.5px] font-medium font-mono truncate max-w-full px-1 ${tradeColor}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ==================== MODAL: QUOTE ACTION SHEET ==================== */}
      {quoteActionAsset && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-3">
          <div className="w-full max-w-sm rounded-2xl bg-[#0e131d] border border-[#222c3e] p-4 space-y-2.5 text-sm">
            <div className="flex items-center justify-between pb-2 border-b border-[#1c2434]">
              <div>
                <div className="font-bold text-white">{quoteActionAsset.symbol}</div>
                <div className="text-xs text-slate-400">{quoteActionAsset.name}</div>
              </div>
              <button
                type="button"
                onClick={() => setQuoteActionAsset(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                const sym = quoteActionAsset.symbol;
                setQuoteActionAsset(null);
                openNewOrderModal(sym);
              }}
              className="w-full py-2.5 rounded-lg bg-[#2b8cff] text-white font-semibold text-xs"
            >
              New Order (with SL / TP)
            </button>
            <button
              type="button"
              onClick={() => {
                onSelectSymbol(quoteActionAsset.symbol);
                setQuoteActionAsset(null);
                setMt5Tab('charts');
              }}
              className="w-full py-2.5 rounded-lg bg-[#161e2e] hover:bg-[#1e2940] text-white font-semibold text-xs"
            >
              Open Chart
            </button>
          </div>
        </div>
      )}

      {/* ==================== MODAL: MT5 NEW ORDER WITH ENABLED SL & TP ==================== */}
      {orderModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
          <div className="w-full max-w-md rounded-2xl bg-[#0b1019] border border-[#222d40] shadow-2xl overflow-hidden text-white">
            <div className="px-4 py-3 bg-[#101724] border-b border-[#1d2738] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold">New Order · {orderSymbol}</div>
                <div className="text-[11px] font-mono text-slate-400">
                  {activeAccount ? `${activeAccount.accountId} · Balance $${balance.toFixed(2)}` : 'Paper Trading'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOrderModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5 text-xs">
              {/* Symbol & Execution Mode */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Symbol</label>
                  <select
                    value={orderSymbol}
                    onChange={(e) => {
                      const nextSym = e.target.value;
                      setOrderSymbol(nextSym);
                      const ast = enabledMarkets.find((m) => m.symbol === nextSym);
                      const p = marketStates[nextSym]?.price || ast?.basePrice || 100;
                      setOrderEntryPrice(p.toFixed(ast?.pipDecimals ?? 2));
                    }}
                    className="w-full rounded-lg bg-[#121a28] border border-[#243147] px-2.5 py-2 font-mono text-white"
                  >
                    {enabledMarkets.map((m) => (
                      <option key={m.symbol} value={m.symbol}>
                        {m.symbol}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Order Type</label>
                  <select
                    value={orderType}
                    onChange={(e) => setOrderType(e.target.value as MT5OrderType)}
                    className="w-full rounded-lg bg-[#121a28] border border-[#243147] px-2.5 py-2 text-white"
                  >
                    <option value="MARKET">Market Execution</option>
                    <option value="BUY_LIMIT">Buy Limit</option>
                    <option value="SELL_LIMIT">Sell Limit</option>
                    <option value="BUY_STOP">Buy Stop</option>
                    <option value="SELL_STOP">Sell Stop</option>
                  </select>
                </div>
              </div>

              {/* Volume (Lots) & Margin Stake */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Volume (Lots)</label>
                  <div className="flex items-center rounded-lg bg-[#121a28] border border-[#243147] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOrderLots((l) => Math.max(0.01, Number((l - 0.05).toFixed(2))))}
                      className="px-2.5 py-2 hover:bg-[#1b273b] text-slate-300"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={orderLots}
                      onChange={(e) => setOrderLots(Math.max(0.01, Number(e.target.value) || 0.01))}
                      className="w-full bg-transparent text-center font-mono font-bold text-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setOrderLots((l) => Number((l + 0.05).toFixed(2)))}
                      className="px-2.5 py-2 hover:bg-[#1b273b] text-slate-300"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Stake / Margin (USD)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={orderStake}
                    onChange={(e) => setOrderStake(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-lg bg-[#121a28] border border-[#243147] px-3 py-2 font-mono font-bold text-white"
                  />
                </div>
              </div>

              {orderType !== 'MARKET' && (
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Pending Trigger Price</label>
                  <input
                    type="number"
                    step="any"
                    value={orderEntryPrice}
                    onChange={(e) => setOrderEntryPrice(e.target.value)}
                    className="w-full rounded-lg bg-[#121a28] border border-[#243147] px-3 py-2 font-mono text-white"
                  />
                </div>
              )}

              {/* Enabled Stop Loss & Take Profit Inputs */}
              {(() => {
                const asset = enabledMarkets.find((m) => m.symbol === orderSymbol) || selectedAsset;
                const price =
                  orderType === 'MARKET'
                    ? marketStates[asset.symbol]?.price || asset.basePrice
                    : Number(orderEntryPrice || asset.basePrice);
                const dec = asset.pipDecimals;
                const pipStep = Math.max(Math.pow(10, -dec) * 10, asset.volatility * 0.5);

                return (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    {/* Stop Loss */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-rose-400">Stop Loss (S/L)</label>
                        {orderSl && (
                          <button
                            type="button"
                            onClick={() => setOrderSl('')}
                            className="text-[10px] text-slate-400 hover:text-white"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <div className="flex items-center rounded-lg bg-[#121a28] border-b-2 border-rose-500 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => {
                            const base = orderSl ? Number(orderSl) : price;
                            setOrderSl(Math.max(0.0001, base - pipStep).toFixed(dec));
                          }}
                          className="px-2 py-2 hover:bg-[#1b273b] text-rose-400"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          step="any"
                          placeholder="Not set"
                          value={orderSl}
                          onChange={(e) => setOrderSl(e.target.value)}
                          className="w-full bg-transparent text-center font-mono text-white placeholder-slate-500 focus:outline-none py-1.5"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const base = orderSl ? Number(orderSl) : price;
                            setOrderSl((base + pipStep).toFixed(dec));
                          }}
                          className="px-2 py-2 hover:bg-[#1b273b] text-rose-400"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Take Profit */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-emerald-400">Take Profit (T/P)</label>
                        {orderTp && (
                          <button
                            type="button"
                            onClick={() => setOrderTp('')}
                            className="text-[10px] text-slate-400 hover:text-white"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <div className="flex items-center rounded-lg bg-[#121a28] border-b-2 border-emerald-500 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => {
                            const base = orderTp ? Number(orderTp) : price;
                            setOrderTp(Math.max(0.0001, base - pipStep).toFixed(dec));
                          }}
                          className="px-2 py-2 hover:bg-[#1b273b] text-emerald-400"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          step="any"
                          placeholder="Not set"
                          value={orderTp}
                          onChange={(e) => setOrderTp(e.target.value)}
                          className="w-full bg-transparent text-center font-mono text-white placeholder-slate-500 focus:outline-none py-1.5"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const base = orderTp ? Number(orderTp) : price;
                            setOrderTp((base + pipStep).toFixed(dec));
                          }}
                          className="px-2 py-2 hover:bg-[#1b273b] text-emerald-400"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Quick 1:2 Risk/Reward Presets */}
              <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px]">
                <span className="text-slate-400">Auto-Fill SL/TP (1:2 R:R):</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const asset = enabledMarkets.find((m) => m.symbol === orderSymbol) || selectedAsset;
                      const p = marketStates[asset.symbol]?.price || asset.basePrice;
                      const d = Math.max(Math.pow(10, -asset.pipDecimals) * 20, asset.volatility * 1.3);
                      setOrderSl((p - d).toFixed(asset.pipDecimals));
                      setOrderTp((p + d * 2).toFixed(asset.pipDecimals));
                    }}
                    className="px-2 py-1 rounded bg-[#2b8cff]/15 text-[#2b8cff] hover:bg-[#2b8cff]/25 font-mono"
                  >
                    BUY Setup
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const asset = enabledMarkets.find((m) => m.symbol === orderSymbol) || selectedAsset;
                      const p = marketStates[asset.symbol]?.price || asset.basePrice;
                      const d = Math.max(Math.pow(10, -asset.pipDecimals) * 20, asset.volatility * 1.3);
                      setOrderSl((p + d).toFixed(asset.pipDecimals));
                      setOrderTp((p - d * 2).toFixed(asset.pipDecimals));
                    }}
                    className="px-2 py-1 rounded bg-[#ef5350]/15 text-[#ef5350] hover:bg-[#ef5350]/25 font-mono"
                  >
                    SELL Setup
                  </button>
                </div>
              </div>

              {/* Live Bid / Ask Display */}
              {(() => {
                const asset = enabledMarkets.find((m) => m.symbol === orderSymbol) || selectedAsset;
                const bid = marketStates[asset.symbol]?.price || asset.basePrice;
                const ask = bid + Math.max(Math.pow(10, -asset.pipDecimals) * 3, asset.volatility * 0.04);
                return (
                  <div className="flex items-center justify-around py-2 rounded-lg bg-[#070a10] border border-[#192233] font-mono">
                    <span className="text-base font-bold text-[#ef5350]">{bid.toFixed(asset.pipDecimals)}</span>
                    <span className="text-[11px] text-slate-500">BID / ASK</span>
                    <span className="text-base font-bold text-[#2b8cff]">{ask.toFixed(asset.pipDecimals)}</span>
                  </div>
                );
              })()}

              {orderError && (
                <div className="p-2 rounded bg-rose-500/15 border border-rose-500/40 text-rose-300 text-[11px]">
                  {orderError}
                </div>
              )}

              {/* Execution Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  disabled={orderBusy}
                  onClick={() => void submitNewMt5Order('SELL')}
                  className="py-3 rounded-lg bg-[#ef5350] hover:bg-rose-500 disabled:opacity-50 text-white font-bold tracking-wide"
                >
                  {orderType === 'MARKET' ? 'SELL BY MARKET' : 'PLACE SELL'}
                </button>
                <button
                  type="button"
                  disabled={orderBusy}
                  onClick={() => void submitNewMt5Order('BUY')}
                  className="py-3 rounded-lg bg-[#2b8cff] hover:bg-sky-500 disabled:opacity-50 text-white font-bold tracking-wide"
                >
                  {orderType === 'MARKET' ? 'BUY BY MARKET' : 'PLACE BUY'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: TAP POSITION SHEET ==================== */}
      {selectedTrade && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-3">
          <div className="w-full max-w-sm rounded-2xl bg-[#0e131d] border border-[#222c3e] p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between border-b border-[#1c2434] pb-2">
              <div>
                <div className="font-bold text-sm text-white">
                  {selectedTrade.symbol}, {selectedTrade.direction.toLowerCase()}
                </div>
                <div className="font-mono text-slate-400">
                  SL: {selectedTrade.stopLoss ?? 'Not set'} · TP: {selectedTrade.takeProfit ?? 'Not set'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTrade(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => openModifyDialog(selectedTrade)}
              className="w-full py-2.5 rounded-lg bg-[#182336] hover:bg-[#22314b] text-[#2b8cff] font-semibold flex items-center justify-center gap-2"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Modify Stop Loss / Take Profit
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectSymbol(selectedTrade.symbol);
                setSelectedTrade(null);
                setMt5Tab('charts');
              }}
              className="w-full py-2.5 rounded-lg bg-[#161e2e] hover:bg-[#1e2940] text-white font-semibold"
            >
              Chart
            </button>

            {selectedTrade.status === 'open' ? (
              <button
                type="button"
                onClick={() => void closeSinglePosition(selectedTrade)}
                className="w-full py-2.5 rounded-lg bg-[#ef5350] hover:bg-rose-500 text-white font-bold"
              >
                Close Position ({(floatingPnlById[selectedTrade.id] ?? 0) >= 0 ? '+' : ''}
                {(floatingPnlById[selectedTrade.id] ?? 0).toFixed(2)} USD)
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void cancelPendingOrder(selectedTrade.id)}
                className="w-full py-2.5 rounded-lg bg-[#ef5350] hover:bg-rose-500 text-white font-bold"
              >
                Delete Pending Order
              </button>
            )}
          </div>
        </div>
      )}

      {/* ==================== MODAL: MODIFY SL / TP ==================== */}
      {modifyModalTrade && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
          <div className="w-full max-w-sm rounded-2xl bg-[#0b1019] border border-[#222d40] p-4 space-y-3.5 text-xs">
            <div className="flex items-center justify-between border-b border-[#1c2434] pb-2">
              <div>
                <div className="font-bold text-sm text-white">
                  Modify Position · {modifyModalTrade.symbol}
                </div>
                <div className="font-mono text-[11px] text-slate-400">
                  Entry {modifyModalTrade.entryPrice} · Live{' '}
                  {(marketStates[modifyModalTrade.symbol]?.price || modifyModalTrade.entryPrice).toFixed(
                    markets.find((m) => m.symbol === modifyModalTrade.symbol)?.pipDecimals ?? 2
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModifyModalTrade(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const asset = markets.find((m) => m.symbol === modifyModalTrade.symbol);
              const dec = asset?.pipDecimals ?? 2;
              const live = marketStates[modifyModalTrade.symbol]?.price || modifyModalTrade.entryPrice;
              const step = Math.max(Math.pow(10, -dec) * 10, (asset?.volatility || 0.5) * 0.4);
              return (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-rose-400 font-semibold">Stop Loss (S/L)</label>
                      <button
                        type="button"
                        onClick={() => setModifySl('')}
                        className="text-[10px] text-slate-400 hover:text-white"
                      >
                        Remove SL
                      </button>
                    </div>
                    <div className="flex items-center rounded-lg bg-[#121a28] border-b-2 border-rose-500 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          const base = modifySl ? Number(modifySl) : live;
                          setModifySl(Math.max(0.0001, base - step).toFixed(dec));
                        }}
                        className="px-3 py-2 text-rose-400 hover:bg-[#1a2436]"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        step="any"
                        placeholder="Not set"
                        value={modifySl}
                        onChange={(e) => setModifySl(e.target.value)}
                        className="w-full bg-transparent text-center font-mono text-white py-2 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const base = modifySl ? Number(modifySl) : live;
                          setModifySl((base + step).toFixed(dec));
                        }}
                        className="px-3 py-2 text-rose-400 hover:bg-[#1a2436]"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-emerald-400 font-semibold">Take Profit (T/P)</label>
                      <button
                        type="button"
                        onClick={() => setModifyTp('')}
                        className="text-[10px] text-slate-400 hover:text-white"
                      >
                        Remove TP
                      </button>
                    </div>
                    <div className="flex items-center rounded-lg bg-[#121a28] border-b-2 border-emerald-500 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          const base = modifyTp ? Number(modifyTp) : live;
                          setModifyTp(Math.max(0.0001, base - step).toFixed(dec));
                        }}
                        className="px-3 py-2 text-emerald-400 hover:bg-[#1a2436]"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        step="any"
                        placeholder="Not set"
                        value={modifyTp}
                        onChange={(e) => setModifyTp(e.target.value)}
                        className="w-full bg-transparent text-center font-mono text-white py-2 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const base = modifyTp ? Number(modifyTp) : live;
                          setModifyTp((base + step).toFixed(dec));
                        }}
                        className="px-3 py-2 text-emerald-400 hover:bg-[#1a2436]"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            <button
              type="button"
              disabled={modifyBusy}
              onClick={() => void saveModifiedSlTp()}
              className="w-full py-2.5 rounded-lg bg-[#2b8cff] hover:bg-sky-500 disabled:opacity-50 text-white font-bold"
            >
              {modifyBusy ? 'Modifying...' : 'MODIFY'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
