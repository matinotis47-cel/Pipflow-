import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Crosshair,
  Minus,
  PenTool,
  RefreshCw,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type { MarketAsset } from '../types/pipflow';
import type { MarketTickState } from '../services/marketEngine';
import { usePlatform } from '../context/PlatformContext';

interface TradingChartProps {
  asset: MarketAsset;
  marketState: MarketTickState;
  mode?: 'area' | 'candles';
  timeframe?: string;
  onTimeframeChange?: (tf: string) => void;
  showDrawingTools?: boolean;
  barrierRange?: number | null; // Used by PTrader Accumulators
  heightClass?: string;
}

interface DrawnLine {
  x1Ratio: number;
  y1Price: number;
  x2Ratio: number;
  y2Price: number;
  type: 'trend' | 'hline';
}

export function TradingChart({
  asset,
  marketState,
  mode = 'candles',
  timeframe = '1m',
  onTimeframeChange,
  showDrawingTools = false,
  barrierRange = null,
  heightClass = 'h-[400px] lg:h-[480px]',
}: TradingChartProps) {
  const { theme } = usePlatform();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [chartType, setChartType] = useState<'area' | 'candles'>(mode);
  const [showSma, setShowSma] = useState(true);
  const [showEma, setShowEma] = useState(false);
  const [activeTool, setActiveTool] = useState<'crosshair' | 'trend' | 'hline'>('crosshair');
  const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
  const [draftStart, setDraftStart] = useState<{ xRatio: number; price: number } | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredInfo, setHoveredInfo] = useState<{ price: number; time: string } | null>(null);

  useEffect(() => {
    setChartType(mode);
  }, [mode]);

  useEffect(() => {
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

    const isDark = theme === 'dark';
    const bgColor = isDark ? '#0b1220' : '#ffffff';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.06)';
    const axisText = isDark ? '#94a3b8' : '#64748b';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    const padRight = 76;
    const padBottom = 26;
    const padTop = 18;
    const padLeft = 10;
    const plotW = Math.max(80, width - padRight - padLeft);
    const plotH = Math.max(80, height - padBottom - padTop);

    const candles = marketState.candles.slice(-75);
    const ticks = marketState.ticks.slice(-90);

    let minPrice = Infinity;
    let maxPrice = -Infinity;

    if (chartType === 'candles') {
      for (const c of candles) {
        if (c.low < minPrice) minPrice = c.low;
        if (c.high > maxPrice) maxPrice = c.high;
      }
    } else {
      for (const t of ticks) {
        if (t.price < minPrice) minPrice = t.price;
        if (t.price > maxPrice) maxPrice = t.price;
      }
    }

    if (barrierRange && marketState.price) {
      minPrice = Math.min(minPrice, marketState.price - barrierRange * 1.35);
      maxPrice = Math.max(maxPrice, marketState.price + barrierRange * 1.35);
    }

    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice === maxPrice) {
      minPrice = marketState.price * 0.995;
      maxPrice = marketState.price * 1.005;
    }

    const paddingSpan = (maxPrice - minPrice) * 0.14;
    minPrice -= paddingSpan;
    maxPrice += paddingSpan;

    const priceToY = (p: number) =>
      padTop + ((maxPrice - p) / (maxPrice - minPrice)) * plotH;

    const yToPrice = (y: number) =>
      maxPrice - ((y - padTop) / plotH) * (maxPrice - minPrice);

    // Draw horizontal gridlines & right Y-axis labels
    const rows = 6;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i <= rows; i++) {
      const y = padTop + (plotH / rows) * i;
      const p = yToPrice(y);
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillStyle = axisText;
      ctx.fillText(p.toFixed(asset.pipDecimals), padLeft + plotW + 8, y + 4);
    }

    // Vertical gridlines
    const cols = 6;
    for (let i = 1; i < cols; i++) {
      const x = padLeft + (plotW / cols) * i;
      ctx.strokeStyle = gridColor;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
    }

    if (chartType === 'area' && ticks.length > 1) {
      const futurePad = barrierRange ? plotW * 0.28 : plotW * 0.08;
      const activeW = plotW - futurePad;

      // Barrier box for PTrader Accumulators
      if (barrierRange) {
        const yHigh = priceToY(marketState.price + barrierRange);
        const yLow = priceToY(marketState.price - barrierRange);
        const boxX = padLeft + activeW;
        const boxW = futurePad - 4;
        ctx.fillStyle = isDark ? 'rgba(27, 143, 230, 0.14)' : 'rgba(27, 143, 230, 0.09)';
        ctx.fillRect(boxX, yHigh, boxW, Math.max(4, yLow - yHigh));
        ctx.strokeStyle = '#1b8fe6';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(boxX, yHigh);
        ctx.lineTo(boxX + boxW, yHigh);
        ctx.moveTo(boxX, yLow);
        ctx.lineTo(boxX + boxW, yLow);
        ctx.stroke();

        ctx.fillStyle = '#1b8fe6';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(`+${barrierRange.toFixed(asset.pipDecimals)}`, boxX + 4, yHigh - 4);
        ctx.fillText(`-${barrierRange.toFixed(asset.pipDecimals)}`, boxX + 4, yLow + 11);
      }

      ctx.beginPath();
      ticks.forEach((t, idx) => {
        const x = padLeft + (idx / (ticks.length - 1)) * activeW;
        const y = priceToY(t.price);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = isDark ? '#e2e8f0' : '#0f172a';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Gradient fill under line
      const lastX = padLeft + activeW;
      ctx.lineTo(lastX, padTop + plotH);
      ctx.lineTo(padLeft, padTop + plotH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
      grad.addColorStop(0, isDark ? 'rgba(27, 143, 230, 0.24)' : 'rgba(15, 23, 42, 0.12)');
      grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = grad;
      ctx.fill();

      // Current price dot
      const lastY = priceToY(marketState.price);
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#1b8fe6';
      ctx.fill();
    } else if (candles.length > 0) {
      const stepX = plotW / candles.length;
      const bodyW = Math.max(3, Math.min(10, stepX * 0.65));

      candles.forEach((c, idx) => {
        const cx = padLeft + idx * stepX + stepX / 2;
        const isBull = c.close >= c.open;
        const color = isBull ? '#10b981' : '#ef4444';

        // Wick
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, priceToY(c.high));
        ctx.lineTo(cx, priceToY(c.low));
        ctx.stroke();

        // Body
        const yOpen = priceToY(c.open);
        const yClose = priceToY(c.close);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
        ctx.fillStyle = color;
        ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
      });

      // SMA 20 Overlay
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
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // EMA 9 Overlay
      if (showEma && candles.length >= 5) {
        const k = 2 / (9 + 1);
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
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    // Drawn lines (trendlines & horizontal lines)
    for (const line of drawnLines) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.6;
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

    // Live Price Horizontal Dotted Line + Right Axis Pill
    const curY = priceToY(marketState.price);
    const isUp = marketState.price >= marketState.prevPrice;
    const priceBadgeColor = isUp ? '#10b981' : '#ef4444';
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = priceBadgeColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, curY);
    ctx.lineTo(padLeft + plotW, curY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = priceBadgeColor;
    ctx.fillRect(padLeft + plotW + 2, curY - 10, padRight - 6, 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(marketState.price.toFixed(asset.pipDecimals), padLeft + plotW + 7, curY + 4);

    // Crosshair hover
    if (hoverPos && hoverPos.x >= padLeft && hoverPos.x <= padLeft + plotW && hoverPos.y >= padTop && hoverPos.y <= padTop + plotH) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isDark ? 'rgba(226, 232, 240, 0.35)' : 'rgba(15, 23, 42, 0.35)';
      ctx.beginPath();
      ctx.moveTo(hoverPos.x, padTop);
      ctx.lineTo(hoverPos.x, padTop + plotH);
      ctx.moveTo(padLeft, hoverPos.y);
      ctx.lineTo(padLeft + plotW, hoverPos.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Time labels along bottom
    const timeSeries = chartType === 'area' ? ticks : candles;
    if (timeSeries.length > 4) {
      ctx.fillStyle = axisText;
      ctx.font = '10px "JetBrains Mono", monospace';
      for (let i = 0; i < 5; i++) {
        const idx = Math.floor((i / 4) * (timeSeries.length - 1));
        const item = timeSeries[idx];
        const x = padLeft + (idx / Math.max(1, timeSeries.length - 1)) * plotW;
        const d = new Date(item.time);
        const label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: chartType === 'area' ? '2-digit' : undefined });
        ctx.fillText(label, Math.min(padLeft + plotW - 48, x), height - 8);
      }
    }
  }, [asset, marketState, chartType, theme, showSma, showEma, drawnLines, hoverPos, barrierRange]);

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setHoverPos({ x, y });

    const padTop = 18;
    const padBottom = 26;
    const plotH = Math.max(80, rect.height - padBottom - padTop);
    const candles = marketState.candles.slice(-75);
    let minP = Infinity;
    let maxP = -Infinity;
    candles.forEach((c) => {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    });
    if (!Number.isFinite(minP)) {
      minP = marketState.price * 0.995;
      maxP = marketState.price * 1.005;
    }
    const span = (maxP - minP) * 0.14;
    minP -= span;
    maxP += span;
    const p = maxP - ((y - padTop) / plotH) * (maxP - minP);
    setHoveredInfo({
      price: Number(p.toFixed(asset.pipDecimals)),
      time: new Date().toLocaleTimeString(),
    });
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === 'crosshair') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const plotW = Math.max(80, rect.width - 86);
    const plotH = Math.max(80, rect.height - 44);
    const xRatio = Math.max(0, Math.min(1, (x - 10) / plotW));

    const candles = marketState.candles.slice(-75);
    let minP = Infinity;
    let maxP = -Infinity;
    candles.forEach((c) => {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    });
    const span = (maxP - minP) * 0.14;
    minP -= span;
    maxP += span;
    const price = maxP - ((y - 18) / plotH) * (maxP - minP);

    if (activeTool === 'hline') {
      setDrawnLines((prev) => [...prev, { x1Ratio: 0, y1Price: price, x2Ratio: 1, y2Price: price, type: 'hline' }]);
      return;
    }

    if (activeTool === 'trend') {
      if (!draftStart) {
        setDraftStart({ xRatio, price });
      } else {
        setDrawnLines((prev) => [
          ...prev,
          { x1Ratio: draftStart.xRatio, y1Price: draftStart.price, x2Ratio: xRatio, y2Price: price, type: 'trend' },
        ]);
        setDraftStart(null);
      }
    }
  };

  const isPositive = marketState.changePct >= 0;

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] overflow-hidden">
      {/* Top Chart Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0f1724]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{asset.name}</span>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{asset.symbol}</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
            <span className="font-semibold text-slate-900 dark:text-white">
              {marketState.price.toFixed(asset.pipDecimals)}
            </span>
            <span className={isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
              {isPositive ? '+' : ''}
              {marketState.changePct.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {['1T', '1m', '5m', '15m', '1h', '24h'].map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onTimeframeChange?.(tf)}
              className={`px-2 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap ${
                timeframe === tf
                  ? 'bg-sky-600 text-white font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800'
              }`}
            >
              {tf}
            </button>
          ))}

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

          <button
            type="button"
            onClick={() => setChartType((t) => (t === 'candles' ? 'area' : 'candles'))}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Activity className="w-3.5 h-3.5 text-sky-500" />
            {chartType === 'candles' ? 'Candles' : 'Area'}
          </button>

          <button
            type="button"
            onClick={() => setShowSma((s) => !s)}
            className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
              showSma
                ? 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                : 'border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
          >
            SMA 20
          </button>
          <button
            type="button"
            onClick={() => setShowEma((s) => !s)}
            className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
              showEma
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
          >
            EMA 9
          </button>
        </div>
      </div>

      {/* Main Chart Body */}
      <div className={`relative flex w-full ${heightClass}`}>
        {showDrawingTools && (
          <div className="w-10 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f1724] flex flex-col items-center py-2.5 gap-2">
            <button
              type="button"
              onClick={() => setActiveTool('crosshair')}
              title="Crosshair"
              className={`p-1.5 rounded-md ${activeTool === 'crosshair' ? 'bg-sky-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
            >
              <Crosshair className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTool('trend');
                setDraftStart(null);
              }}
              title="Trend Line (click 2 points)"
              className={`p-1.5 rounded-md ${activeTool === 'trend' ? 'bg-sky-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
            >
              <TrendingUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setActiveTool('hline')}
              title="Horizontal Support/Resistance"
              className={`p-1.5 rounded-md ${activeTool === 'hline' ? 'bg-sky-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setChartType((t) => (t === 'candles' ? 'area' : 'candles'))}
              title="Toggle Chart Mode"
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white"
            >
              <PenTool className="w-4 h-4" />
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => {
                setDrawnLines([]);
                setDraftStart(null);
              }}
              title="Clear Drawings"
              className="p-1.5 rounded-md text-slate-400 hover:text-rose-500"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}

        <div ref={containerRef} className="relative flex-1 h-full overflow-hidden">
          <canvas
            ref={canvasRef}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => {
              setHoverPos(null);
              setHoveredInfo(null);
            }}
            onClick={handleCanvasClick}
            className="w-full h-full block cursor-crosshair"
          />

          {hoveredInfo && (
            <div className="pointer-events-none absolute top-2.5 left-3 px-2.5 py-1 rounded bg-slate-900/75 text-white text-[11px] font-mono tabular-nums">
              {asset.symbol} · {hoveredInfo.price.toFixed(asset.pipDecimals)}
              {draftStart ? ' · Click end point' : ''}
            </div>
          )}

          {activeTool !== 'crosshair' && (
            <div className="pointer-events-none absolute bottom-8 left-3 px-2 py-0.5 rounded bg-amber-500/90 text-slate-950 text-[10px] font-semibold">
              {activeTool === 'trend'
                ? draftStart
                  ? 'Click second point on chart'
                  : 'Trendline tool: Click start point'
                : 'Horizontal line: Click price level'}
            </div>
          )}

          {!marketState.ticks.length && (
            <div className="absolute inset-0 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 animate-spin text-sky-500" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
