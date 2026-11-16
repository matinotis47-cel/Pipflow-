import WebSocket from 'ws';
import { getDerivAppId, mapMarketSymbolForDeriv } from './deriv.ts';
import { broadcastEvent } from './sse.ts';
import { loadDb } from '../db/store.ts';
import { saveMarketDataCacheInNeon, upsertMarketInstrumentsInNeon } from '../db/neon.ts';
import type { MarketAsset } from '../../src/types/pipflow.ts';

export interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DerivMarketDiagnostics {
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  wsEndpoint: string;
  appId: string;
  reconnectCount: number;
  lastError: string | null;
  connectedAt: string | null;
  lastTickAt: string | null;
  instrumentCount: number;
  subscribedSymbols: string[];
  activeSubscriptions: number;
}

const REVERSE_SYMBOL_ALIASES: Record<string, string[]> = {
  '1HZ100V': ['R_100_1S'],
  R_100: ['R_100'],
  R_75: ['R_75'],
  R_50: ['R_50'],
  R_25: ['R_25'],
  R_10: ['R_10'],
  frxEURUSD: ['EUR/USD'],
  frxGBPUSD: ['GBP/USD'],
  frxUSDJPY: ['USD/JPY'],
  frxAUDUSD: ['AUD/USD'],
  cryBTCUSD: ['BTC/USD'],
  cryETHUSD: ['ETH/USD'],
  frxXAUUSD: ['XAU/USD'],
};

const CORE_WATCH_DERIV_SYMBOLS = [
  '1HZ100V',
  'R_100',
  'R_75',
  'R_50',
  'R_25',
  'R_10',
  'frxEURUSD',
  'frxGBPUSD',
  'cryBTCUSD',
  'frxXAUUSD',
];

function timeframeToGranularity(tf: string): { style: 'ticks' | 'candles'; granularity?: number } {
  switch (tf) {
    case '1T':
      return { style: 'ticks' };
    case '1m':
      return { style: 'candles', granularity: 60 };
    case '5m':
      return { style: 'candles', granularity: 300 };
    case '15m':
      return { style: 'candles', granularity: 900 };
    case '1h':
      return { style: 'candles', granularity: 3600 };
    case '4h':
      return { style: 'candles', granularity: 14400 };
    case '24h':
      return { style: 'candles', granularity: 86400 };
    default:
      return { style: 'candles', granularity: 60 };
  }
}

function mapDerivCategory(market?: string): MarketAsset['category'] {
  const m = String(market || '').toLowerCase();
  if (m.includes('forex')) return 'forex';
  if (m.includes('cryptocurrency') || m.includes('crypto')) return 'crypto';
  if (m.includes('commodit')) return 'commodities';
  if (m.includes('indices') || m.includes('stock')) return 'stocks';
  return 'synthetics';
}

class DerivPublicMarketFeed {
  private ws: WebSocket | null = null;
  private status: DerivMarketDiagnostics['status'] = 'disconnected';
  private reconnectCount = 0;
  private lastError: string | null = null;
  private connectedAt: string | null = null;
  private lastTickAt: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private reqCounter = 10;
  private pending = new Map<number, { resolve: (d: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private subscribedDerivSymbols = new Set<string>();
  private cachedInstruments: MarketAsset[] = [];
  private latestQuotes = new Map<string, { price: number; epoch: number }>();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  private getWsUrl(): string {
    return `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(getDerivAppId())}`;
  }

  private connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.status = 'connecting';
    const wsUrl = this.getWsUrl();

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.on('open', () => {
        this.status = 'connected';
        this.lastError = null;
        this.connectedAt = new Date().toISOString();
        this.startKeepAlive();

        // Hydrate active instruments and subscribe to core live market streams
        void this.refreshInstruments().catch(() => {});
        const targets = new Set<string>([...CORE_WATCH_DERIV_SYMBOLS, ...this.subscribedDerivSymbols]);
        for (const sym of targets) {
          this.subscribeSymbol(sym);
        }
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          const reqId = typeof msg?.req_id === 'number' ? msg.req_id : null;
          if (reqId !== null && this.pending.has(reqId)) {
            const waiter = this.pending.get(reqId)!;
            clearTimeout(waiter.timer);
            this.pending.delete(reqId);
            if (msg.error) {
              waiter.reject(new Error(msg.error.message || 'Deriv public market API error'));
            } else {
              waiter.resolve(msg);
            }
          }

          if (msg?.msg_type === 'tick' && msg?.tick?.symbol && typeof msg?.tick?.quote === 'number') {
            this.handleIncomingTick(msg.tick.symbol, Number(msg.tick.quote), Number(msg.tick.epoch || Math.floor(Date.now() / 1000)));
          }
        } catch {
          // ignore malformed WS frames
        }
      });

      ws.on('error', (err) => {
        this.status = 'error';
        this.lastError = err?.message || 'Deriv market WebSocket error';
      });

      ws.on('close', () => {
        this.stopKeepAlive();
        this.flushPending('Deriv public market feed closed');
        if (this.status !== 'error') {
          this.status = 'disconnected';
        }
        this.scheduleReconnect();
      });
    } catch (err: any) {
      this.status = 'error';
      this.lastError = err?.message || 'Unable to open Deriv market WebSocket';
      this.scheduleReconnect();
    }
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ ping: 1 }));
        } catch {
          // ignore
        }
      }
    }, 25000);
  }

  private stopKeepAlive(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private flushPending(reason: string): void {
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectCount += 1;
    const delayMs = Math.min(30000, 1500 * Math.pow(1.6, Math.min(this.reconnectCount, 6)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private handleIncomingTick(derivSymbol: string, quote: number, epoch: number): void {
    this.lastTickAt = new Date().toISOString();
    this.latestQuotes.set(derivSymbol, { price: quote, epoch });
    const aliases = REVERSE_SYMBOL_ALIASES[derivSymbol] || [derivSymbol];
    for (const sym of aliases) {
      broadcastEvent('market:tick', {
        symbol: sym,
        derivSymbol,
        price: quote,
        quote,
        time: epoch * 1000,
      });
    }
  }

  subscribeSymbol(pipflowOrDerivSymbol: string): void {
    const derivSymbol = mapMarketSymbolForDeriv(pipflowOrDerivSymbol);
    this.subscribedDerivSymbols.add(derivSymbol);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ ticks: derivSymbol, subscribe: 1 }));
      } catch {
        // ignore
      }
    }
  }

  private sendRequest(payload: Record<string, unknown>, timeoutMs = 9000): Promise<any> {
    if (!this.started) {
      this.start();
    }
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Deriv public market WebSocket is currently reconnecting.'));
        return;
      }
      const reqId = this.reqCounter++;
      const timer = setTimeout(() => {
        if (this.pending.has(reqId)) {
          this.pending.delete(reqId);
          reject(new Error('Deriv public market API request timed out.'));
        }
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ ...payload, req_id: reqId }));
      } catch (err: any) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async refreshInstruments(): Promise<MarketAsset[]> {
    const db = loadDb();
    try {
      const resp = await this.sendRequest({ active_symbols: 'brief', product_type: 'basic' }, 10000);
      const rawList = Array.isArray(resp?.active_symbols) ? resp.active_symbols : [];
      if (rawList.length > 0) {
        const mapped: MarketAsset[] = rawList.slice(0, 120).map((s: any) => {
          const pip = Number(s.pip || 0.01);
          const pipDecimals = pip > 0 && pip < 1 ? Math.max(0, Math.min(6, Math.round(-Math.log10(pip)))) : 2;
          return {
            symbol: String(s.symbol),
            name: String(s.display_name || s.symbol),
            category: mapDerivCategory(s.market_display_name || s.market),
            basePrice: Number(s.spot || this.latestQuotes.get(String(s.symbol))?.price || 100),
            volatility: 0.45,
            payoutRate: 0.92,
            spread: Number((pip * 2).toFixed(pipDecimals)),
            pipDecimals,
            enabled: !s.is_trading_suspended,
          };
        });
        this.cachedInstruments = mapped;
        void upsertMarketInstrumentsInNeon(
          mapped.map((m) => ({
            symbol: m.symbol,
            displayName: m.name,
            category: m.category,
            pipDecimals: m.pipDecimals,
            suspended: !m.enabled,
            source: 'deriv',
          }))
        );
        return mapped;
      }
    } catch {
      // Fall back to cached or configured instruments cleanly
    }
    return this.cachedInstruments.length > 0 ? this.cachedInstruments : db.config.markets;
  }

  async getInstruments(): Promise<MarketAsset[]> {
    if (this.cachedInstruments.length > 0) {
      return this.cachedInstruments;
    }
    return this.refreshInstruments();
  }

  async fetchHistoricalData(
    symbol: string,
    timeframe: string = '1m',
    count: number = 90
  ): Promise<{
    symbol: string;
    derivSymbol: string;
    timeframe: string;
    source: 'deriv_ws' | 'fallback';
    candles: CandleBar[];
    latestPrice: number | null;
  }> {
    const derivSymbol = mapMarketSymbolForDeriv(symbol);
    this.subscribeSymbol(derivSymbol);
    const { style, granularity } = timeframeToGranularity(timeframe);
    const safeCount = Math.max(20, Math.min(300, count));

    try {
      const payload: Record<string, unknown> = {
        ticks_history: derivSymbol,
        end: 'latest',
        count: safeCount,
        style,
      };
      if (granularity) {
        payload.granularity = granularity;
      }

      const resp = await this.sendRequest(payload, 9000);
      let candles: CandleBar[] = [];

      if (style === 'candles' && Array.isArray(resp?.candles)) {
        candles = resp.candles.map((c: any) => ({
          time: Number(c.epoch) * 1000,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: 100 + Math.round(Math.abs(Number(c.high) - Number(c.low)) * 500),
        }));
      } else if (style === 'ticks' && Array.isArray(resp?.history?.prices) && Array.isArray(resp?.history?.times)) {
        const prices = resp.history.prices as number[];
        const times = resp.history.times as number[];
        candles = prices.map((p, idx) => {
          const prev = idx > 0 ? Number(prices[idx - 1]) : Number(p);
          const price = Number(p);
          return {
            time: Number(times[idx] || Date.now() / 1000) * 1000,
            open: prev,
            high: Math.max(prev, price),
            low: Math.min(prev, price),
            close: price,
            volume: 100,
          };
        });
      }

      if (candles.length > 0) {
        const lastPrice = candles[candles.length - 1].close;
        this.latestQuotes.set(derivSymbol, { price: lastPrice, epoch: Math.floor(Date.now() / 1000) });
        void saveMarketDataCacheInNeon(symbol, timeframe, candles, lastPrice);
        return {
          symbol,
          derivSymbol,
          timeframe,
          source: 'deriv_ws',
          candles,
          latestPrice: lastPrice,
        };
      }
    } catch {
      // Graceful fallback handled below
    }

    const db = loadDb();
    const configured = db.config.markets.find((m) => m.symbol === symbol);
    const liveSpot = this.latestQuotes.get(derivSymbol)?.price;
    return {
      symbol,
      derivSymbol,
      timeframe,
      source: 'fallback',
      candles: [],
      latestPrice: liveSpot ?? configured?.basePrice ?? null,
    };
  }

  async runDiagnosticCheck(): Promise<{
    ok: boolean;
    latencyMs: number;
    instrumentCount: number;
    diagnostics: DerivMarketDiagnostics;
    error?: string;
  }> {
    const start = Date.now();
    try {
      await this.sendRequest({ ping: 1 }, 6000);
      const list = await this.refreshInstruments();
      return {
        ok: true,
        latencyMs: Date.now() - start,
        instrumentCount: list.length,
        diagnostics: this.getDiagnostics(),
      };
    } catch (err: any) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        instrumentCount: this.cachedInstruments.length,
        diagnostics: this.getDiagnostics(),
        error: err?.message || 'Deriv diagnostic ping failed',
      };
    }
  }

  getDiagnostics(): DerivMarketDiagnostics {
    const db = loadDb();
    return {
      status: this.status,
      wsEndpoint: `wss://ws.derivws.com/websockets/v3?app_id=${getDerivAppId()}`,
      appId: getDerivAppId(),
      reconnectCount: this.reconnectCount,
      lastError: this.lastError,
      connectedAt: this.connectedAt,
      lastTickAt: this.lastTickAt,
      instrumentCount: this.cachedInstruments.length || db.config.markets.length,
      subscribedSymbols: Array.from(this.subscribedDerivSymbols),
      activeSubscriptions: this.subscribedDerivSymbols.size,
    };
  }
}

export const derivMarketFeed = new DerivPublicMarketFeed();
