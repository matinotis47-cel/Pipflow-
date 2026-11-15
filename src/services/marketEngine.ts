import type { MarketAsset } from '../types/pipflow';

export interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketTickState {
  symbol: string;
  price: number;
  prevPrice: number;
  changePct: number;
  lastDigit: number;
  digits: number[]; // last 1000 digits
  candles: CandleBar[];
  ticks: { time: number; price: number }[];
}

export function extractLastDigit(price: number, decimals: number): number {
  const formatted = price.toFixed(decimals);
  const lastChar = formatted[formatted.length - 1];
  const digit = parseInt(lastChar, 10);
  return Number.isNaN(digit) ? 0 : digit;
}

export function buildInitialMarketState(asset: MarketAsset): MarketTickState {
  const now = Date.now();
  const candles: CandleBar[] = [];
  const ticks: { time: number; price: number }[] = [];
  const digits: number[] = [];

  let price = asset.basePrice * (1 - 0.008);
  const candleCount = 90;
  const stepMs = 60_000;

  for (let i = candleCount; i >= 0; i--) {
    const t = now - i * stepMs;
    const drift = (Math.random() - 0.485) * asset.volatility * 2.2;
    const open = price;
    const close = Math.max(asset.basePrice * 0.5, open + drift);
    const wickUp = Math.random() * asset.volatility * 1.4;
    const wickDown = Math.random() * asset.volatility * 1.4;
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDown;
    candles.push({
      time: t,
      open: Number(open.toFixed(asset.pipDecimals)),
      high: Number(high.toFixed(asset.pipDecimals)),
      low: Number(low.toFixed(asset.pipDecimals)),
      close: Number(close.toFixed(asset.pipDecimals)),
      volume: Math.round(80 + Math.random() * 420),
    });
    price = close;
  }

  for (let j = 250; j >= 0; j--) {
    const t = now - j * 1000;
    const delta = (Math.random() - 0.495) * asset.volatility;
    price = Math.max(asset.basePrice * 0.5, price + delta);
    const rounded = Number(price.toFixed(asset.pipDecimals));
    ticks.push({ time: t, price: rounded });
    digits.push(extractLastDigit(rounded, asset.pipDecimals));
  }

  const first = candles[0]?.open || price;
  const changePct = ((price - first) / first) * 100;

  return {
    symbol: asset.symbol,
    price: Number(price.toFixed(asset.pipDecimals)),
    prevPrice: Number(price.toFixed(asset.pipDecimals)),
    changePct,
    lastDigit: digits[digits.length - 1] ?? 0,
    digits,
    candles,
    ticks,
  };
}

export function advanceMarketTick(state: MarketTickState, asset: MarketAsset): MarketTickState {
  const now = Date.now();
  const prevPrice = state.price;
  // Smooth mean-reverting random walk with momentum bursts
  const meanReversion = ((asset.basePrice - prevPrice) / asset.basePrice) * asset.volatility * 0.15;
  const shock = (Math.random() - 0.5) * asset.volatility * 1.65;
  const nextRaw = Math.max(asset.basePrice * 0.4, prevPrice + meanReversion + shock);
  const price = Number(nextRaw.toFixed(asset.pipDecimals));
  const lastDigit = extractLastDigit(price, asset.pipDecimals);

  const digits = [...state.digits.slice(-999), lastDigit];
  const ticks = [...state.ticks.slice(-240), { time: now, price }];

  const candles = [...state.candles];
  const lastCandle = candles[candles.length - 1];
  if (lastCandle && now - lastCandle.time < 60_000) {
    candles[candles.length - 1] = {
      ...lastCandle,
      high: Math.max(lastCandle.high, price),
      low: Math.min(lastCandle.low, price),
      close: price,
      volume: lastCandle.volume + Math.round(1 + Math.random() * 8),
    };
  } else {
    candles.push({
      time: now,
      open: prevPrice,
      high: Math.max(prevPrice, price),
      low: Math.min(prevPrice, price),
      close: price,
      volume: 12,
    });
    if (candles.length > 140) candles.shift();
  }

  const base = candles[0]?.open || asset.basePrice;
  const changePct = ((price - base) / base) * 100;

  return {
    symbol: asset.symbol,
    price,
    prevPrice,
    changePct,
    lastDigit,
    digits,
    candles,
    ticks,
  };
}
