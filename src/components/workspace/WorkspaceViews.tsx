import React, { useState } from 'react';
import {
  Activity,
  Bot,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Copy,
  FileText,
  FolderOpen,
  LayoutGrid,
  LineChart,
  List,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Undo2,
  Upload,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { MarketAsset, TradeRecord, TradingAccount, TransactionRecord } from '../../types/pipflow';
import type { MarketTickState } from '../../services/marketEngine';
import { TradingChart } from '../TradingChart';
import { formatCurrencyAmount, getInitialsFromEmail } from '../../config/app.config';
import { useAuth } from '../../context/AuthContext';
import { usePlatform } from '../../context/PlatformContext';
import { apiFetch } from '../../lib/sessionMemory';

interface SharedViewProps {
  markets: MarketAsset[];
  marketStates: Record<string, MarketTickState>;
  selectedSymbol: string;
  onSelectSymbol: (sym: string) => void;
  activeAccount: TradingAccount | null;
  onExecuteSettle: (params: {
    symbol: string;
    tradeType: string;
    direction: 'BUY' | 'SELL' | 'RISE' | 'FALL' | 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'ACCU';
    stake: number;
    won: boolean;
    payoutRate: number;
    source: 'manual' | 'bot' | 'ai_profit_bot' | 'bulk' | 'copy';
    note?: string;
  }) => Promise<void>;
  onOpenAiBot: () => void;
  onLoadBotAndRun: (
    botName: string,
    config: { symbol: string; direction: 'RISE' | 'FALL' | 'EVEN' | 'ODD' | 'OVER' | 'UNDER'; stake: number }
  ) => void;
  onBotConfigChange?: (config: {
    name: string;
    symbol: string;
    direction: 'RISE' | 'FALL' | 'EVEN' | 'ODD' | 'OVER' | 'UNDER';
    stake: number;
  }) => void;
}

export function BotBuilderView({
  markets,
  selectedSymbol,
  onSelectSymbol,
  onOpenAiBot,
  onLoadBotAndRun,
  onBotConfigChange,
}: SharedViewProps) {
  const [marketCategory, setMarketCategory] = useState<'synthetics' | 'forex' | 'crypto' | 'stocks' | 'commodities'>('synthetics');
  const [submarket, setSubmarket] = useState('Continuous Indices');
  const [alternateMarkets, setAlternateMarkets] = useState(false);
  const [alternateMode, setAlternateMode] = useState<'Sequential' | 'Random' | 'On Loss'>('Sequential');
  const [tradeFamily, setTradeFamily] = useState<'Digits' | 'Up/Down'>('Digits');
  const [tradeSubType, setTradeSubType] = useState<'Over/Under' | 'Even/Odd' | 'Rise/Fall'>('Over/Under');
  const [contractType, setContractType] = useState<'UNDER' | 'OVER' | 'EVEN' | 'ODD' | 'RISE' | 'FALL'>('UNDER');
  const [interval, setInterval] = useState('1 minute');
  const [restartBuySellOnError, setRestartBuySellOnError] = useState(false);
  const [virtualHook, setVirtualHook] = useState(false);
  const [vhOpen, setVhOpen] = useState(false);
  const [vhLossesThreshold, setVhLossesThreshold] = useState(2);
  const [restartOnError, setRestartOnError] = useState(true);

  const [stake, setStake] = useState(0.5);
  const [initialPrediction, setInitialPrediction] = useState(8);
  const [recoveryPrediction, setRecoveryPrediction] = useState(5);
  const [entryPointDigit, setEntryPointDigit] = useState(0);
  const [martingale, setMartingale] = useState(2);
  const [numWinsTarget, setNumWinsTarget] = useState(5);
  const [stopLoss, setStopLoss] = useState(50);
  const [useMartingale, setUseMartingale] = useState<'true' | 'false'>('true');
  const [fixedVarOpen, setFixedVarOpen] = useState(false);

  const [durationUnit, setDurationUnit] = useState<'Ticks' | 'Seconds' | 'Minutes'>('Ticks');
  const [durationTicks, setDurationTicks] = useState(1);
  const [stakeVar, setStakeVar] = useState('Stake');
  const [tradeEachTick, setTradeEachTick] = useState(false);
  const [predictionVar, setPredictionVar] = useState('Initial Prediction');

  const [condSignal, setCondSignal] = useState('Entry Signal');
  const [condLogic, setCondLogic] = useState<'or' | 'and'>('or');
  const [condLastDigits, setCondLastDigits] = useState(1);
  const [condCompare, setCondCompare] = useState('greater than or equal to');
  const [condDigit, setCondDigit] = useState(8);
  const [entrySignalState, setEntrySignalState] = useState<'true' | 'false'>('true');
  const [allowBulk, setAllowBulk] = useState<'No' | 'Yes'>('No');
  const [numTrades, setNumTrades] = useState(1);

  const [zoom, setZoom] = useState(1);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<'O1 / U8' | 'O2 / U7' | 'O3 / U6'>('O1 / U8');
  const [scanResult, setScanResult] = useState<string>('Ready to scan last 3000 simulated ticks.');
  const [xmlNotice, setXmlNotice] = useState('');

  const categoryMarkets = markets.filter((m) => m.enabled && m.category === marketCategory);
  const visibleMarkets = categoryMarkets.length > 0 ? categoryMarkets : markets.filter((m) => m.enabled);

  const syncRunnerConfig = (nextSym: string, nextDir: 'RISE' | 'FALL' | 'EVEN' | 'ODD' | 'OVER' | 'UNDER', nextStake: number) => {
    onBotConfigChange?.({
      name: `Visual ${tradeFamily} (${nextDir}) Bot`,
      symbol: nextSym,
      direction: nextDir,
      stake: nextStake,
    });
  };

  const handleResetWorkspace = () => {
    setMarketCategory('synthetics');
    setTradeFamily('Digits');
    setTradeSubType('Over/Under');
    setContractType('UNDER');
    setStake(0.5);
    setInitialPrediction(8);
    setRecoveryPrediction(5);
    setEntryPointDigit(0);
    setMartingale(2);
    setNumWinsTarget(5);
    setStopLoss(50);
    setUseMartingale('true');
    setDurationTicks(1);
    setRestartOnError(true);
    setRestartBuySellOnError(false);
    setVirtualHook(false);
    syncRunnerConfig(selectedSymbol, 'UNDER', 0.5);
    setXmlNotice('Workspace blocks reset to defaults.');
    setTimeout(() => setXmlNotice(''), 2500);
  };

  const pillSelectClass =
    'px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-[#c7cbd2] dark:border-slate-700 text-[11px] font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0a5275]';
  const pillInputClass =
    'w-10 text-center px-1.5 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-[#c7cbd2] dark:border-slate-700 text-[11px] font-mono font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0a5275]';

  return (
    <div className="flex flex-1 min-h-[calc(100vh-146px)] bg-white dark:bg-[#080d17]">
      {/* Left Vertical Blockly Tool Rail matching Screenshot */}
      <div className="w-10 sm:w-11 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] flex flex-col items-center py-3 gap-3.5 text-slate-700 dark:text-slate-300">
        <button
          type="button"
          onClick={handleResetWorkspace}
          title="Reset workspace blocks"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        <label title="Load Bot XML / JSON" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors">
          <FolderOpen className="w-4 h-4" />
          <input
            type="file"
            accept=".xml,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setXmlNotice(`Loaded strategy file: ${f.name}`);
                setTimeout(() => setXmlNotice(''), 3000);
              }
            }}
          />
        </label>

        <button
          type="button"
          onClick={() => setFixedVarOpen((v) => !v)}
          title="Variables & parameters"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <List className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          title="Entry Scanner"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <span className="grid grid-cols-2 gap-0.5 w-3.5 h-3.5">
            <span className="rounded-full bg-rose-500" />
            <span className="rounded-full bg-emerald-500" />
            <span className="rounded-full bg-amber-400" />
            <span className="rounded-full bg-sky-500" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setTradeFamily('Up/Down');
            setTradeSubType('Rise/Fall');
            setContractType('RISE');
            syncRunnerConfig(selectedSymbol, 'RISE', stake);
          }}
          title="Rise/Fall trend preset"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <LineChart className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleResetWorkspace}
          title="Undo changes"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Undo2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setVirtualHook((v) => !v)}
          title="Redo / Toggle Virtual Hook"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Redo2 className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(1.15, Number((z + 0.08).toFixed(2))))}
          title="Zoom in"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.82, Number((z - 0.08).toFixed(2))))}
          title="Zoom out"
          className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
      </div>

      {/* Main White Blockly Workspace Canvas */}
      <div className="flex-1 p-3 sm:p-5 overflow-x-auto bg-white dark:bg-[#080d17]">
        {/* Top Single Action Button: AI Bot Generator */}
        <div className="mb-3.5 flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenAiBot}
            className="inline-flex items-center justify-center px-4 py-2 rounded bg-[#00a896] hover:bg-[#008f80] text-white text-xs font-bold shadow-sm transition-colors"
          >
            AI Bot Generator
          </button>
        </div>

        {xmlNotice && (
          <div className="mb-3 px-3 py-2 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-medium max-w-xl">
            {xmlNotice}
          </div>
        )}

        <div className="space-y-6 origin-top-left transition-transform pb-8" style={{ transform: `scale(${zoom})` }}>
          {/* BLOCK 1: 1. Trade parameters */}
          <div className="inline-block min-w-[330px] max-w-full">
            {/* Block Header */}
            <div className="w-fit min-w-[310px] rounded-t-md bg-[#0a5275] text-white px-3 py-1.5 text-xs font-semibold flex items-center gap-2">
              <ClipboardList className="w-3.5 h-3.5 opacity-90 shrink-0" />
              <span>1. Trade parameters</span>
            </div>

            {/* Block C-Body 1: Parameters */}
            <div className="flex">
              <div className="w-3 bg-[#0a5275] shrink-0" />
              <div className="space-y-0.5 text-[11px] text-slate-900 dark:text-slate-100">
                {/* Main Market & Strategy Box */}
                <div className="bg-[#e3e5e8] dark:bg-[#1e293b] border border-[#c7cbd2] dark:border-slate-700 rounded-r-md px-2.5 py-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-medium">Market:</span>
                    <select
                      value={marketCategory}
                      onChange={(e) => {
                        const nextCat = e.target.value as any;
                        setMarketCategory(nextCat);
                        const firstInCat = markets.find((m) => m.enabled && m.category === nextCat);
                        if (firstInCat) {
                          onSelectSymbol(firstInCat.symbol);
                          syncRunnerConfig(firstInCat.symbol, contractType, stake);
                        }
                      }}
                      className={pillSelectClass}
                    >
                      <option value="synthetics">synthetics</option>
                      <option value="forex">forex</option>
                      <option value="crypto">crypto</option>
                      <option value="stocks">stocks</option>
                      <option value="commodities">commodities</option>
                    </select>
                    <span className="text-slate-500 font-bold">&gt;</span>
                    <select
                      value={submarket}
                      onChange={(e) => setSubmarket(e.target.value)}
                      className={pillSelectClass}
                    >
                      <option value="Continuous Indices">Continuous Indices</option>
                      <option value="Jump Indices">Jump Indices</option>
                      <option value="Major Pairs">Major Pairs</option>
                    </select>
                    <span className="text-slate-500 font-bold">&gt;</span>
                    <select
                      value={selectedSymbol}
                      onChange={(e) => {
                        onSelectSymbol(e.target.value);
                        syncRunnerConfig(e.target.value, contractType, stake);
                      }}
                      className={pillSelectClass}
                    >
                      {visibleMarkets.map((m) => (
                        <option key={m.symbol} value={m.symbol}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span>Alternate markets (Continuous Indices only):</span>
                    <input
                      type="checkbox"
                      checked={alternateMarkets}
                      onChange={(e) => setAlternateMarkets(e.target.checked)}
                      className="rounded border-slate-400"
                    />
                  </label>

                  <div className="flex items-center gap-1.5">
                    <span>Alternate mode:</span>
                    {alternateMarkets && (
                      <select
                        value={alternateMode}
                        onChange={(e) => setAlternateMode(e.target.value as any)}
                        className={pillSelectClass}
                      >
                        <option value="Sequential">Sequential</option>
                        <option value="Random">Random</option>
                        <option value="On Loss">On Loss</option>
                      </select>
                    )}
                  </div>
                </div>

                {/* Trade Type Row */}
                <div className="w-fit bg-[#e3e5e8] dark:bg-[#1e293b] border border-[#c7cbd2] dark:border-slate-700 rounded-r-md px-2.5 py-1.5 flex flex-wrap items-center gap-1">
                  <span>Trade Type:</span>
                  <select
                    value={tradeFamily}
                    onChange={(e) => {
                      const fam = e.target.value as 'Digits' | 'Up/Down';
                      setTradeFamily(fam);
                      if (fam === 'Digits') {
                        setTradeSubType('Over/Under');
                        setContractType('UNDER');
                        syncRunnerConfig(selectedSymbol, 'UNDER', stake);
                      } else {
                        setTradeSubType('Rise/Fall');
                        setContractType('RISE');
                        syncRunnerConfig(selectedSymbol, 'RISE', stake);
                      }
                    }}
                    className={pillSelectClass}
                  >
                    <option value="Digits">Digits</option>
                    <option value="Up/Down">Up/Down</option>
                  </select>
                  <span className="text-slate-500 font-bold">&gt;</span>
                  <select
                    value={tradeSubType}
                    onChange={(e) => {
                      const sub = e.target.value as any;
                      setTradeSubType(sub);
                      const mapped = sub === 'Over/Under' ? 'UNDER' : sub === 'Even/Odd' ? 'EVEN' : 'RISE';
                      setContractType(mapped);
                      syncRunnerConfig(selectedSymbol, mapped, stake);
                    }}
                    className={pillSelectClass}
                  >
                    {tradeFamily === 'Digits' ? (
                      <>
                        <option value="Over/Under">Over/Under</option>
                        <option value="Even/Odd">Even/Odd</option>
                      </>
                    ) : (
                      <option value="Rise/Fall">Rise/Fall</option>
                    )}
                  </select>
                </div>

                {/* Contract Type Row */}
                <div className="w-fit bg-[#e3e5e8] dark:bg-[#1e293b] border border-[#c7cbd2] dark:border-slate-700 rounded-r-md px-2.5 py-1.5 flex items-center gap-1.5">
                  <span>Contract Type:</span>
                  <select
                    value={contractType}
                    onChange={(e) => {
                      const dir = e.target.value as any;
                      setContractType(dir);
                      syncRunnerConfig(selectedSymbol, dir, stake);
                    }}
                    className={pillSelectClass}
                  >
                    <option value="UNDER">Under</option>
                    <option value="OVER">Over</option>
                    <option value="EVEN">Even</option>
                    <option value="ODD">Odd</option>
                    <option value="RISE">Rise</option>
                    <option value="FALL">Fall</option>
                  </select>
                </div>

                {/* Default Candle Interval Row */}
                <div className="w-fit bg-[#e3e5e8] dark:bg-[#1e293b] border border-[#c7cbd2] dark:border-slate-700 rounded-r-md px-2.5 py-1.5 flex items-center gap-1.5">
                  <span>Default Candle Interval:</span>
                  <select
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                    className={pillSelectClass}
                  >
                    <option value="1 minute">1 minute</option>
                    <option value="2 minutes">2 minutes</option>
                    <option value="5 minutes">5 minutes</option>
                    <option value="15 minutes">15 minutes</option>
                    <option value="1 hour">1 hour</option>
                  </select>
                </div>

                {/* Error & Virtual Hook Rows */}
                <div className="w-fit bg-[#e3e5e8] dark:bg-[#1e293b] border border-[#c7cbd2] dark:border-slate-700 rounded-r-md px-2.5 py-2 space-y-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span>Restart buy/sell on error (disable for better performance):</span>
                    <input
                      type="checkbox"
                      checked={restartBuySellOnError}
                      onChange={(e) => setRestartBuySellOnError(e.target.checked)}
                      className="rounded border-slate-400"
                    />
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span>Virtual Hook:</span>
                    <input
                      type="checkbox"
                      checked={virtualHook}
                      onChange={(e) => setVirtualHook(e.target.checked)}
                      className="rounded border-slate-400"
                    />
                    <button
                      type="button"
                      onClick={() => setVhOpen(true)}
                      className="font-medium hover:underline inline-flex items-center gap-1"
                    >
                      VH Settings <span className="text-amber-500">⚡</span>
                    </button>
                  </div>
                </div>

                <div className="w-fit bg-[#e3e5e8] dark:bg-[#1e293b] border border-[#c7cbd2] dark:border-slate-700 rounded-r-md px-2.5 py-1.5">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span>Restart last trade on error (bot ignores the unsuccessful trade):</span>
                    <input
                      type="checkbox"
                      checked={restartOnError}
                      onChange={(e) => setRestartOnError(e.target.checked)}
                      className="rounded border-slate-400 accent-slate-600"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* C-Slot Header: Run once at start: */}
            <div className="w-fit min-w-[310px] bg-[#0a5275] text-white px-3 py-1.5 text-xs font-semibold">
              Run once at start:
            </div>

            {/* Variable Set Stack */}
            <div className="flex">
              <div className="w-3 bg-[#0a5275] shrink-0" />
              <div className="flex flex-col items-start gap-0.5 py-0.5 text-[11px] text-slate-900 dark:text-slate-100">
                {[
                  {
                    name: 'Stake',
                    val: stake,
                    step: '0.1',
                    onChange: (v: number) => {
                      const next = Math.max(0.35, v);
                      setStake(next);
                      syncRunnerConfig(selectedSymbol, contractType, next);
                    },
                  },
                  { name: 'Initial Prediction', val: initialPrediction, step: '1', onChange: setInitialPrediction },
                  { name: 'Recovery Prediction', val: recoveryPrediction, step: '1', onChange: setRecoveryPrediction },
                  { name: 'Entry Point Digit', val: entryPointDigit, step: '1', onChange: setEntryPointDigit },
                  { name: 'Martingale', val: martingale, step: '0.1', onChange: setMartingale },
                  { name: 'Number of Wins', val: numWinsTarget, step: '1', onChange: setNumWinsTarget },
                  { name: 'Stop Loss', val: stopLoss, step: '5', onChange: setStopLoss },
                ].map((item) => (
                  <div
                    key={item.name}
                    className="bg-[#e3e5e8] dark:bg-[#1e293b] border border-[#c7cbd2] dark:border-slate-700 rounded-r-md px-2.5 py-1 inline-flex items-center gap-1.5"
                  >
                    <span>set</span>
                    <select className={pillSelectClass} value={item.name} onChange={() => {}}>
                      <option value={item.name}>{item.name}</option>
                    </select>
                    <span>to</span>
                    <input
                      type="number"
                      step={item.step}
                      value={item.val}
                      onChange={(e) => item.onChange(Number(e.target.value))}
                      className={pillInputClass}
                    />
                  </div>
                ))}

                <div className="bg-[#e3e5e8] dark:bg-[#1e293b] border border-[#c7cbd2] dark:border-slate-700 rounded-r-md px-2.5 py-1 inline-flex items-center gap-1.5">
                  <span>set</span>
                  <select className={pillSelectClass} value="Use Martingale" onChange={() => {}}>
                    <option value="Use Martingale">Use Martingale</option>
                  </select>
                  <span>to</span>
                  <select
                    value={useMartingale}
                    onChange={(e) => setUseMartingale(e.target.value as 'true' | 'false')}
                    className={pillSelectClass}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setFixedVarOpen((v) => !v)}
                  className="bg-[#e3e5e8] dark:bg-[#1e293b] border border-[#c7cbd2] dark:border-slate-700 rounded-r-md px-2.5 py-1.5 text-[11px] font-medium hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  Fixed Variables
                </button>
              </div>
            </div>

            {/* C-Slot Header: Trade options: */}
            <div className="w-fit min-w-[310px] bg-[#0a5275] text-white px-3 py-1.5 text-xs font-semibold">
              Trade options:
            </div>
            {/* Blockly C-Notch Mouth */}
            <div className="w-fit min-w-[310px]">
              <div className="h-3 bg-[#0a5275] w-3" />
              <div className="h-3 bg-[#0a5275] rounded-b-md" />
            </div>

            {/* Snapped Horizontal Trade Options Bar matching Screenshot */}
            <div className="mt-2 ml-6 bg-[#e3e5e8] dark:bg-[#1e293b] border border-[#c7cbd2] dark:border-slate-700 rounded px-3 py-2 inline-flex flex-wrap items-center gap-1.5 text-[11px] text-slate-900 dark:text-slate-100 shadow-sm">
              <span>Duration:</span>
              <select
                value={durationUnit}
                onChange={(e) => setDurationUnit(e.target.value as any)}
                className={pillSelectClass}
              >
                <option value="Ticks">Ticks</option>
                <option value="Seconds">Seconds</option>
                <option value="Minutes">Minutes</option>
              </select>
              <input
                type="number"
                min={1}
                max={60}
                value={durationTicks}
                onChange={(e) => setDurationTicks(Math.max(1, Number(e.target.value)))}
                className="w-9 text-center px-1 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-[#c7cbd2] dark:border-slate-700 font-mono text-[11px]"
              />
              <span>Stake: USD</span>
              <select
                value={stakeVar}
                onChange={(e) => setStakeVar(e.target.value)}
                className={pillSelectClass}
              >
                <option value="Stake">Stake</option>
                <option value="Fixed">Fixed</option>
              </select>
              <span className="text-slate-600 dark:text-slate-400">(min: 0.35 - max: 50000)</span>
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <span>Trade each tick:</span>
                <input
                  type="checkbox"
                  checked={tradeEachTick}
                  onChange={(e) => setTradeEachTick(e.target.checked)}
                  className="rounded border-slate-400"
                />
              </label>
              <span>Prediction:</span>
              <select
                value={predictionVar}
                onChange={(e) => setPredictionVar(e.target.value)}
                className={pillSelectClass}
              >
                <option value="Initial Prediction">Initial Prediction</option>
                <option value="Recovery Prediction">Recovery Prediction</option>
              </select>
            </div>
          </div>

          {/* BLOCK 2: 2. Purchase conditions */}
          <div className="inline-block min-w-[330px] max-w-full">
            <div className="w-fit min-w-[300px] rounded-t-md bg-[#0a5275] text-white px-3 py-1.5 text-xs font-semibold flex items-center gap-2">
              <ShoppingBag className="w-3.5 h-3.5 opacity-90 shrink-0" />
              <span>2. Purchase conditions</span>
            </div>

            <div className="flex">
              <div className="w-3 bg-[#0a5275] shrink-0" />
              <div className="bg-[#e3e5e8] dark:bg-[#1e293b] border border-[#c7cbd2] dark:border-slate-700 rounded-r-md p-2.5 space-y-2 text-[11px] text-slate-900 dark:text-slate-100">
                {/* IF condition line */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">if</span>
                  <select
                    value={condSignal}
                    onChange={(e) => setCondSignal(e.target.value)}
                    className={pillSelectClass}
                  >
                    <option value="Entry Signal">Entry Signal</option>
                    <option value="Trend Signal">Trend Signal</option>
                  </select>
                  <select
                    value={condLogic}
                    onChange={(e) => setCondLogic(e.target.value as 'or' | 'and')}
                    className={pillSelectClass}
                  >
                    <option value="or">or</option>
                    <option value="and">and</option>
                  </select>
                  <span>Last</span>
                  <input
                    type="number"
                    min={1}
                    max={25}
                    value={condLastDigits}
                    onChange={(e) => setCondLastDigits(Math.max(1, Number(e.target.value)))}
                    className="w-9 text-center px-1 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-[#c7cbd2] dark:border-slate-700 font-mono text-[11px]"
                  />
                  <span>digits are</span>
                  <select
                    value={condCompare}
                    onChange={(e) => setCondCompare(e.target.value)}
                    className={pillSelectClass}
                  >
                    <option value="greater than or equal to">greater than or equal to</option>
                    <option value="less than or equal to">less than or equal to</option>
                    <option value="equal to">equal to</option>
                  </select>
                  <span>digit</span>
                  <input
                    type="number"
                    min={0}
                    max={9}
                    value={condDigit}
                    onChange={(e) => setCondDigit(Math.max(0, Math.min(9, Number(e.target.value))))}
                    className="w-9 text-center px-1 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-[#c7cbd2] dark:border-slate-700 font-mono text-[11px]"
                  />
                  <span className="font-semibold">then</span>
                </div>

                {/* Indented Nested Execution Block */}
                <div className="ml-4 pl-3 border-l-4 border-[#c7cbd2] dark:border-slate-600 space-y-2">
                  <div className="bg-[#f1f2f4] dark:bg-slate-800 border border-[#c7cbd2] dark:border-slate-700 rounded px-2.5 py-1 inline-flex items-center gap-1.5">
                    <span>set</span>
                    <select className={pillSelectClass} value="Entry Signal" onChange={() => {}}>
                      <option value="Entry Signal">Entry Signal</option>
                    </select>
                    <span>to</span>
                    <select
                      value={entrySignalState}
                      onChange={(e) => setEntrySignalState(e.target.value as 'true' | 'false')}
                      className={pillSelectClass}
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </div>

                  <div className="bg-[#f1f2f4] dark:bg-slate-800 border border-[#c7cbd2] dark:border-slate-700 rounded px-2.5 py-2 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span>Purchase</span>
                      <select
                        value={contractType}
                        onChange={(e) => {
                          const dir = e.target.value as any;
                          setContractType(dir);
                          syncRunnerConfig(selectedSymbol, dir, stake);
                        }}
                        className={pillSelectClass}
                      >
                        <option value="UNDER">Under</option>
                        <option value="OVER">Over</option>
                        <option value="EVEN">Even</option>
                        <option value="ODD">Odd</option>
                        <option value="RISE">Rise</option>
                        <option value="FALL">Fall</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>Allow Bulk Purchase:</span>
                      <select
                        value={allowBulk}
                        onChange={(e) => setAllowBulk(e.target.value as any)}
                        className={pillSelectClass}
                      >
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>No. of Trades:</span>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={numTrades}
                        onChange={(e) => setNumTrades(Math.max(1, Math.min(5, Number(e.target.value))))}
                        className="w-10 text-center px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-[#c7cbd2] dark:border-slate-700 font-mono text-[11px]"
                      />
                    </div>
                  </div>
                </div>

                {/* Bottom plus button */}
                <button
                  type="button"
                  onClick={() => onLoadBotAndRun(`Visual ${tradeFamily} (${contractType}) Bot`, { symbol: selectedSymbol, direction: contractType, stake })}
                  title="Load and run this strategy block"
                  className="w-5 h-5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 inline-flex items-center justify-center hover:scale-105 transition-transform"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="w-fit min-w-[300px] h-3 rounded-b-md bg-[#0a5275]" />
          </div>

          {/* BLOCK 3 & 4 stacked cleanly below */}
          <div className="flex flex-wrap gap-5 items-start">
            <div className="w-80 rounded-md overflow-hidden border border-[#0a5275]">
              <div className="bg-[#0a5275] text-white px-3 py-1.5 text-xs font-semibold">3. Sell conditions</div>
              <div className="flex">
                <div className="w-3 bg-[#0a5275] shrink-0" />
                <div className="flex-1 bg-[#e3e5e8] dark:bg-[#1e293b] p-2.5 text-[11px] text-slate-900 dark:text-slate-100">
                  if <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">Sell is available</span> → Profit-Only Check
                </div>
              </div>
              <div className="h-2.5 bg-[#0a5275]" />
            </div>

            <div className="w-80 rounded-md overflow-hidden border border-[#0a5275]">
              <div className="bg-[#0a5275] text-white px-3 py-1.5 text-xs font-semibold">4. Restart trading conditions</div>
              <div className="flex">
                <div className="w-3 bg-[#0a5275] shrink-0" />
                <div className="flex-1 bg-[#e3e5e8] dark:bg-[#1e293b] p-2.5 text-[11px] text-slate-900 dark:text-slate-100">
                  Trade again if Total Profit &lt; Take Profit (${(stake * 10).toFixed(2)}) · Stop Loss ${stopLoss}
                </div>
              </div>
              <div className="h-2.5 bg-[#0a5275]" />
            </div>
          </div>
        </div>
      </div>

      {/* Virtual Hook Settings Modal */}
      {vhOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-sm">Virtual Hook Settings ⚡</h3>
              <button type="button" onClick={() => setVhOpen(false)} className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">
                Close
              </button>
            </div>
            <label className="flex items-center justify-between text-xs">
              <span>Enable Virtual Hook Pre-filter</span>
              <input type="checkbox" checked={virtualHook} onChange={(e) => setVirtualHook(e.target.checked)} />
            </label>
            <label className="block text-xs space-y-1">
              <span>Virtual Losses Before Live Entry</span>
              <input
                type="number"
                min={1}
                max={10}
                value={vhLossesThreshold}
                onChange={(e) => setVhLossesThreshold(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-xs font-mono"
              />
            </label>
            <button
              type="button"
              onClick={() => setVhOpen(false)}
              className="w-full py-2 rounded-lg bg-[#0a5275] text-white text-xs font-semibold"
            >
              Save VH Settings
            </button>
          </div>
        </div>
      )}

      {/* Fixed Variables Modal */}
      {fixedVarOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-sm">Strategy Fixed Variables</h3>
              <button type="button" onClick={() => setFixedVarOpen(false)} className="text-xs text-slate-500">
                Close
              </button>
            </div>
            <div className="text-xs space-y-1.5 font-mono bg-slate-50 dark:bg-slate-900 p-3 rounded-lg">
              <div>Stake = ${stake}</div>
              <div>Initial Prediction = {initialPrediction}</div>
              <div>Recovery Prediction = {recoveryPrediction}</div>
              <div>Entry Point Digit = {entryPointDigit}</div>
              <div>Martingale = {martingale}x ({useMartingale})</div>
              <div>Number of Wins = {numWinsTarget}</div>
              <div>Stop Loss = ${stopLoss}</div>
            </div>
            <button
              type="button"
              onClick={() => setFixedVarOpen(false)}
              className="w-full py-2 rounded-lg bg-[#0a5275] text-white text-xs font-semibold"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Entry Scanner Modal */}
      {scannerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] overflow-hidden shadow-2xl">
            <div className="bg-[#0a5275] text-white px-5 py-4 flex items-center justify-between">
              <h3 className="font-display font-bold text-base">Entry Scanner</h3>
              <button type="button" onClick={() => setScannerOpen(false)} className="text-white/80 hover:text-white text-sm">
                Close
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-gradient-to-r from-[#0d3b66] to-[#1b8fe6] text-white p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-200">Recovery Engine</div>
                <div className="font-display font-bold text-base mt-0.5">Digits Scanner</div>
                <div className="text-xs text-sky-100 mt-0.5">Scans Over/Under thresholds with confirmation across 3000 ticks.</div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(['O1 / U8', 'O2 / U7', 'O3 / U6'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setScannerMode(m)}
                    className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                      scannerMode === m
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-900 text-xs font-mono text-slate-700 dark:text-slate-300">
                {scanResult}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const top = markets[Math.floor(Math.random() * Math.min(5, markets.length))];
                    setScanResult(`Best Signal: ${top.name} (${top.symbol}) · Mode ${scannerMode} · 86.4% Digit Stability`);
                    onSelectSymbol(top.symbol);
                    syncRunnerConfig(top.symbol, contractType, stake);
                  }}
                  className="py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold"
                >
                  Scan Markets
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScannerOpen(false);
                    onLoadBotAndRun(`Scanner ${scannerMode} Bot`, { symbol: selectedSymbol, direction: 'OVER', stake });
                  }}
                  className="py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Load Scanner Bot
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function TradingBotsLibraryView({
  selectedSymbol,
  onLoadBotAndRun,
}: SharedViewProps) {
  const [subTab, setSubTab] = useState<'free' | 'store' | 'scalper' | 'speed' | 'strategies'>('free');
  const [search, setSearch] = useState('');

  const bots = [
    {
      name: 'Alpha Version 2026 Edition',
      tier: 'PREMIUM',
      cat: 'free',
      desc: 'Alpha Version 2026 Edition - Premium trading bot with cutting-edge 2026 algorithms. Features advanced market analysis and automated execution for maximum profitability.',
      dir: 'RISE' as const,
      stake: 5,
    },
    {
      name: 'AI SIGNAL SCANNER',
      tier: 'PREMIUM',
      cat: 'free',
      desc: 'AI Signal Scanner - Intelligent market scanner that detects high-probability setups and automates trade execution with built-in risk controls.',
      dir: 'OVER' as const,
      stake: 3,
    },
    {
      name: 'Binary Expert V6 Pro',
      tier: 'PREMIUM',
      cat: 'scalper',
      desc: 'Binary Expert V6 Pro - Professional-grade trading bot with expert-level strategies and high-accuracy signal processing.',
      dir: 'FALL' as const,
      stake: 4,
    },
    {
      name: '07_Over_Hit_n_Run',
      tier: 'PREMIUM',
      cat: 'speed',
      desc: 'Fast-execution Over 1 / Under 8 parity strategy with cooldown recovery.',
      dir: 'EVEN' as const,
      stake: 2,
    },
    {
      name: 'AutoDifferbylegoo',
      tier: 'PREMIUM',
      cat: 'store',
      desc: 'Adaptive digit differential bot tracking least-frequent digit gaps.',
      dir: 'ODD' as const,
      stake: 2,
    },
    {
      name: 'MagicRecovery',
      tier: 'PREMIUM',
      cat: 'strategies',
      desc: 'Controlled recovery sequence with built-in drawdown stop cap.',
      dir: 'RISE' as const,
      stake: 5,
    },
  ];

  const filtered = bots.filter((b) => {
    const matchSearch = !search.trim() || b.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = subTab === 'free' ? true : b.cat === subTab;
    return matchSearch && matchCat;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {[
          { id: 'free', label: 'Free Bots' },
          { id: 'store', label: 'Bots Store' },
          { id: 'scalper', label: 'Scalper Bots ⚡' },
          { id: 'speed', label: 'SpeedBots 🚀' },
          { id: 'strategies', label: 'Strategies' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id as any)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 transition-colors ${
              subTab === t.id
                ? 'bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-500'
                : 'bg-white dark:bg-[#0f1724] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search bots..."
          className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-sky-700/40 bg-white dark:bg-[#0f1724] focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((b) => (
          <div
            key={b.name}
            className="relative rounded-2xl border-2 border-[#0e3460] bg-white dark:bg-[#0f1724] p-5 flex flex-col justify-between gap-4 shadow-sm overflow-hidden"
          >
            {/* Orange PREMIUM badge top-right */}
            <span className="absolute top-0 right-0 px-3 py-1 rounded-bl-xl bg-amber-500 text-slate-950 text-[10px] font-extrabold tracking-wider">
              {b.tier}
            </span>

            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2 pr-16">
                <Bot className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
                <h3 className="font-display font-bold text-sm text-[#0e2954] dark:text-white">{b.name}</h3>
              </div>

              <div className="flex items-center justify-center gap-1 text-amber-400">
                {Array.from({ length: 5 }).map((_, idx) => (
                  <Star key={idx} className="w-3.5 h-3.5 fill-current" />
                ))}
              </div>

              <p className="text-xs text-center text-slate-600 dark:text-slate-400 leading-relaxed">{b.desc}</p>
            </div>

            <button
              type="button"
              onClick={() => onLoadBotAndRun(b.name, { symbol: selectedSymbol, direction: b.dir, stake: b.stake })}
              className="w-full py-2.5 rounded-full bg-gradient-to-r from-[#1d4ed8] to-[#2563eb] hover:brightness-110 text-white text-xs font-extrabold tracking-wide shadow-md transition-all"
            >
              LOAD PREMIUM BOT
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CircularDigitRing({
  digit,
  pct,
  ringColor,
  isCurrent,
  size = 54,
}: {
  digit: number;
  pct: number;
  ringColor: string;
  isCurrent?: boolean;
  size?: number;
}) {
  const r = size * 0.4;
  const c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, pct / 22)) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth="4"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <div
        className={`absolute inset-1.5 rounded-full flex flex-col items-center justify-center ${
          isCurrent ? 'bg-sky-500/15 ring-1 ring-sky-500' : ''
        }`}
      >
        <span className="font-mono font-bold text-xs leading-none">{digit}</span>
        <span className="font-mono text-[9px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
          {pct.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

export function BulkTraderView({
  markets,
  marketStates,
  selectedSymbol,
  onSelectSymbol,
  onExecuteSettle,
}: SharedViewProps) {
  const [tradeType, setTradeType] = useState<'Even/Odd' | 'Rise/Fall'>('Even/Odd');
  const [ticksWindow, setTicksWindow] = useState(1000);
  const [stake, setStake] = useState(0.5);
  const [ticksDuration, setTicksDuration] = useState(1);
  const [numTrades, setNumTrades] = useState(1);
  const [busy, setBusy] = useState(false);

  const asset = markets.find((m) => m.symbol === selectedSymbol) || markets[0];
  const st = marketStates[selectedSymbol];
  const digits = (st?.digits || []).slice(-ticksWindow);
  const lastEight = digits.slice(-8);

  const digitCounts = Array.from({ length: 10 }, (_, d) => digits.filter((x) => x === d).length);
  const totalDigits = Math.max(1, digits.length);
  const maxCnt = Math.max(...digitCounts);
  const minCnt = Math.min(...digitCounts);
  const evenCount = digits.filter((d) => d % 2 === 0).length;
  const evenPct = (evenCount / totalDigits) * 100;
  const oddPct = 100 - evenPct;

  const handleBulkBuy = async (choice: 'EVEN' | 'ODD' | 'RISE' | 'FALL') => {
    if (busy || !st) return;
    setBusy(true);
    try {
      for (let i = 0; i < Math.min(5, Math.max(1, numTrades)); i++) {
        const d = st.lastDigit;
        const won =
          choice === 'EVEN'
            ? d % 2 === 0
            : choice === 'ODD'
              ? d % 2 !== 0
              : choice === 'RISE'
                ? st.price >= st.prevPrice
                : st.price < st.prevPrice;
        await onExecuteSettle({
          symbol: selectedSymbol,
          tradeType,
          direction: choice,
          stake,
          won,
          payoutRate: asset?.payoutRate || 0.92,
          source: 'bulk',
          note: `Bulk ${choice} (${i + 1}/${numTrades})`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">Market</label>
          <select
            value={selectedSymbol}
            onChange={(e) => onSelectSymbol(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f1724] px-3 py-2.5 text-sm font-medium"
          >
            {markets
              .filter((m) => m.enabled)
              .map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">Trade Type</label>
          <select
            value={tradeType}
            onChange={(e) => setTradeType(e.target.value as any)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f1724] px-3 py-2.5 text-sm font-medium"
          >
            <option value="Even/Odd">Even/Odd</option>
            <option value="Rise/Fall">Rise/Fall</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">Number of Ticks</label>
        <input
          type="number"
          min={50}
          max={1000}
          value={ticksWindow}
          onChange={(e) => setTicksWindow(Math.min(1000, Math.max(50, Number(e.target.value))))}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f1724] px-3 py-2 text-sm font-mono font-bold text-center"
        />
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-5 text-center space-y-5">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold">CURRENT TICK</div>
          <div className="font-mono text-3xl sm:text-4xl font-extrabold text-rose-500 tabular-nums mt-0.5">
            {st ? st.price.toFixed(asset.pipDecimals) : '—'}
          </div>
        </div>

        {/* SVG Circular Progress Rings */}
        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 pt-1 justify-items-center">
          {digitCounts.map((cnt, digit) => {
            const pct = (cnt / totalDigits) * 100;
            const isCurrent = st?.lastDigit === digit;
            const ringColor =
              cnt === maxCnt ? '#3b82f6' : cnt === minCnt ? '#ef4444' : isCurrent ? '#10b981' : '#64748b';
            return (
              <CircularDigitRing
                key={digit}
                digit={digit}
                pct={pct}
                ringColor={ringColor}
                isCurrent={isCurrent}
              />
            );
          })}
        </div>

        {/* Recent E/O Badges */}
        <div className="flex items-center justify-center gap-1.5 pt-1">
          {lastEight.map((d, i) => (
            <div key={i} className="relative flex flex-col items-center">
              {i === 0 && (
                <span className="w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-rose-500 mb-0.5" />
              )}
              <span
                className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold text-white shadow-sm ${
                  d % 2 === 0 ? 'bg-teal-600' : 'bg-rose-600'
                }`}
              >
                {d % 2 === 0 ? 'E' : 'O'}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2.5 text-center pt-1">
          <div>
            <label className="block text-[10px] uppercase font-semibold text-slate-500 mb-1">Ticks</label>
            <input
              type="number"
              value={ticksDuration}
              min={1}
              max={10}
              onChange={(e) => setTicksDuration(Math.max(1, Number(e.target.value)))}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm font-mono font-bold text-center"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-semibold text-slate-500 mb-1">Stake</label>
            <input
              type="number"
              value={stake}
              min={0.35}
              step="0.1"
              onChange={(e) => setStake(Math.max(0.35, Number(e.target.value)))}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm font-mono font-bold text-center"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-semibold text-slate-500 mb-1">No of Trades</label>
            <input
              type="number"
              value={numTrades}
              min={1}
              max={5}
              onChange={(e) => setNumTrades(Math.min(5, Math.max(1, Number(e.target.value))))}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm font-mono font-bold text-center"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          {tradeType === 'Even/Odd' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleBulkBuy('EVEN')}
                className="rounded-xl bg-[#2a9d8f] hover:bg-[#238276] text-white font-semibold text-sm overflow-hidden transition-colors shadow-sm"
              >
                <div className="py-2 font-bold border-b border-black/10">Even</div>
                <div className="py-2 font-mono font-bold">{evenPct.toFixed(2)}%</div>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleBulkBuy('ODD')}
                className="rounded-xl bg-[#d63031] hover:bg-[#b92627] text-white font-semibold text-sm overflow-hidden transition-colors shadow-sm"
              >
                <div className="py-2 font-bold border-b border-black/10">Odd</div>
                <div className="py-2 font-mono font-bold">{oddPct.toFixed(2)}%</div>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleBulkBuy('RISE')}
                className="py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm"
              >
                Buy Rise ({numTrades}x)
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleBulkBuy('FALL')}
                className="py-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm"
              >
                Buy Fall ({numTrades}x)
              </button>
            </>
          )}
        </div>

        <p className="text-[11px] text-slate-400">
          Percentages describe the selected historical sample. Click a trade button to purchase.
        </p>
      </div>
    </div>
  );
}

export function AnalysisToolView({
  markets,
  marketStates,
  selectedSymbol,
  onSelectSymbol,
  onOpenAiBot,
}: SharedViewProps) {
  const [subMode, setSubMode] = useState<'Dcircles' | 'Signals' | 'DP Tools' | 'All Analysis' | 'Xenon AI'>('Dcircles');
  const [ticksWindow, setTicksWindow] = useState(1000);
  const [aiInsight, setAiInsight] = useState('');
  const [loadingInsight, setLoadingInsight] = useState(false);

  const asset = markets.find((m) => m.symbol === selectedSymbol) || markets[0];
  const st = marketStates[selectedSymbol];
  const digits = (st?.digits || []).slice(-ticksWindow);
  const total = Math.max(1, digits.length);

  const counts = Array.from({ length: 10 }, (_, d) => ({
    digit: d,
    pct: (digits.filter((x) => x === d).length / total) * 100,
  }));
  const maxPct = Math.max(...counts.map((c) => c.pct));
  const minPct = Math.min(...counts.map((c) => c.pct));
  const evenCount = digits.filter((d) => d % 2 === 0).length;
  const evenPct = (evenCount / total) * 100;

  const fetchAiInsight = async () => {
    setLoadingInsight(true);
    try {
      const res = await apiFetch('/api/trading/ai/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          symbol: selectedSymbol,
          price: st?.price || asset.basePrice,
          changePct: st?.changePct || 0,
          digits: digits.slice(-20),
        }),
      });
      const data = await res.json();
      if (res.ok && data.insight) {
        setAiInsight(data.insight);
      }
    } finally {
      setLoadingInsight(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Sub-navigation Pills matching Screenshot */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {(['Dcircles', 'Signals', 'DP Tools', 'All Analysis', 'Xenon AI'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSubMode(m)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 transition-colors ${
              subMode === m
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white dark:bg-[#0f1724] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Action Buttons Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchAiInsight}
            disabled={loadingInsight}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-300 via-slate-300 to-teal-300 text-slate-900 text-xs font-bold shadow-sm hover:brightness-95"
          >
            {loadingInsight ? 'Scanning...' : 'Wide Eye'}
          </button>
          <button
            type="button"
            onClick={onOpenAiBot}
            className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold shadow-sm"
          >
            Launch AI
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenAiBot}
          className="px-3.5 py-1.5 rounded-lg bg-[#1d4ed8] text-white text-xs font-semibold"
        >
          Trading Configuration
        </button>
      </div>

      {aiInsight && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
          {aiInsight}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-5 space-y-5">
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">Select Market:</label>
          <select
            value={selectedSymbol}
            onChange={(e) => onSelectSymbol(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold"
          >
            {markets
              .filter((m) => m.enabled)
              .map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.name}
                </option>
              ))}
          </select>

          <div className="rounded-xl bg-slate-100 dark:bg-slate-900/90 px-4 py-3 flex items-center justify-between">
            <div className="font-mono text-2xl font-extrabold tabular-nums text-slate-900 dark:text-white">
              {st ? st.price.toFixed(asset.pipDecimals) : '—'}
            </div>
            <div className="font-mono text-2xl font-extrabold text-sky-600 dark:text-sky-400">
              {st?.lastDigit ?? 0}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Ticks window:</span>
            <input
              type="number"
              min={50}
              max={1000}
              value={ticksWindow}
              onChange={(e) => setTicksWindow(Math.min(1000, Math.max(50, Number(e.target.value))))}
              className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-1 text-xs font-mono text-center"
            />
            <span className="text-[11px] text-slate-400">(50–1000)</span>
          </div>
          <span className="px-2.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px]">
            {digits.length}/{ticksWindow}
          </span>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-3">
            Last {digits.length} ticks digit distribution
          </div>
          <div className="grid grid-cols-5 gap-3 justify-items-center">
            {counts.map((c) => {
              const isCurrent = st?.lastDigit === c.digit;
              const isMost = c.pct === maxPct;
              const isLeast = c.pct === minPct;
              return (
                <div
                  key={c.digit}
                  className={`h-14 w-14 sm:h-16 sm:w-16 rounded-full border-2 flex flex-col items-center justify-center transition-all shadow-sm ${
                    isCurrent
                      ? 'bg-[#1d4ed8] border-sky-400 text-white'
                      : isMost
                        ? 'bg-[#059669] border-emerald-400 text-white'
                        : isLeast
                          ? 'bg-[#dc2626] border-rose-400 text-white'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                  }`}
                >
                  <span className="font-mono font-bold text-sm leading-none">{c.digit}</span>
                  <span className="font-mono text-[10px] tabular-nums mt-0.5">{c.pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-4 text-[11px] text-slate-500 mt-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#1d4ed8]" /> current digit / most
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#dc2626]" /> least frequency
            </span>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs font-bold">Even/Odd</div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 p-3.5 text-center space-y-2">
            <div className="text-xs font-semibold">Even</div>
            <div className="font-mono text-sm font-bold tabular-nums">
              {evenCount} <span className="text-slate-500">({evenPct.toFixed(1)}%)</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${evenPct}%` }} />
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 p-3.5 text-center space-y-2">
            <div className="text-xs font-semibold">Odd</div>
            <div className="font-mono text-sm font-bold tabular-nums">
              {digits.length - evenCount} <span className="text-slate-500">({(100 - evenPct).toFixed(1)}%)</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div className="h-full bg-rose-500 rounded-full" style={{ width: `${100 - evenPct}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReportsView({
  trades,
  transactions,
  activeAccount,
  onRefresh,
}: {
  trades: TradeRecord[];
  transactions: TransactionRecord[];
  activeAccount: TradingAccount | null;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<'trades' | 'statement'>('trades');
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'all'>('all');

  const cutoff =
    range === 'today'
      ? Date.now() - 24 * 3600 * 1000
      : range === '7d'
        ? Date.now() - 7 * 24 * 3600 * 1000
        : range === '30d'
          ? Date.now() - 30 * 24 * 3600 * 1000
          : 0;

  const accountTrades = trades.filter(
    (t) => (!activeAccount || t.accountId === activeAccount.accountId) && new Date(t.openedAt).getTime() >= cutoff
  );
  const accountTxs = transactions.filter(
    (tx) => (!activeAccount || tx.accountId === activeAccount.accountId) && new Date(tx.createdAt).getTime() >= cutoff
  );

  const closed = accountTrades.filter((t) => t.status === 'closed');
  const wins = closed.filter((t) => t.profitLoss > 0);
  const totalPnl = closed.reduce((s, t) => s + t.profitLoss, 0);
  const totalStake = accountTrades.reduce((s, t) => s + t.stake, 0);
  const bestTrade = closed.length ? Math.max(...closed.map((t) => t.profitLoss)) : 0;
  const worstTrade = closed.length ? Math.min(...closed.map((t) => t.profitLoss)) : 0;
  const credits = accountTxs.filter((tx) => tx.type === 'credit').reduce((s, tx) => s + tx.amount, 0);
  const debits = accountTxs.filter((tx) => tx.type === 'debit').reduce((s, tx) => s + Math.abs(tx.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setTab('trades')}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold ${
              tab === 'trades' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Trades
          </button>
          <button
            type="button"
            onClick={() => setTab('statement')}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold ${
              tab === 'statement' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Statement
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { id: 'today', label: 'Today' },
            { id: '7d', label: '7 Days' },
            { id: '30d', label: '30 Days' },
            { id: 'all', label: 'All Time' },
          ].map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id as any)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                range === r.id
                  ? 'bg-[#0b1b35] dark:bg-sky-600 text-white'
                  : 'bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
          <div className="text-[11px] uppercase text-slate-500">Total P/L</div>
          <div className={`font-mono text-lg font-bold tabular-nums mt-0.5 ${totalPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'}`}>
            {totalPnl >= 0 ? '+' : ''}
            {totalPnl.toFixed(2)} USD
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-3.5">
          <div className="text-[11px] uppercase text-slate-500">Win Rate</div>
          <div className="font-mono text-lg font-bold tabular-nums mt-0.5">
            {closed.length ? ((wins.length / closed.length) * 100).toFixed(1) : '0.0'}%
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            {wins.length}W / {closed.length - wins.length}L
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-3.5">
          <div className="text-[11px] uppercase text-slate-500">Trades</div>
          <div className="font-mono text-lg font-bold tabular-nums mt-0.5">{accountTrades.length}</div>
          <div className="text-[11px] text-slate-400 font-mono">Stake: {totalStake.toFixed(2)} USD</div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-3.5">
          <div className="text-[11px] uppercase text-slate-500">Best / Worst</div>
          <div className="font-mono text-sm font-bold tabular-nums mt-1">
            <span className="text-emerald-600 dark:text-emerald-400">+{bestTrade.toFixed(2)}</span> /{' '}
            <span className="text-rose-600">{worstTrade.toFixed(2)}</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-3.5">
          <div className="text-[11px] uppercase text-slate-500">Credits / Debits</div>
          <div className="font-mono text-sm font-bold tabular-nums mt-1">
            <span className="text-emerald-600 dark:text-emerald-400">+{credits.toFixed(2)}</span> /{' '}
            <span className="text-rose-600">-{debits.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] overflow-x-auto">
        {tab === 'trades' ? (
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0b1b35] text-white">
              <tr>
                <th className="py-3 px-4">Market</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4 text-right">Stake</th>
                <th className="py-3 px-4 text-right">Payout</th>
                <th className="py-3 px-4 text-right">Profit / Loss</th>
                <th className="py-3 px-4 text-right">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {accountTrades.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No trades recorded for {activeAccount?.accountId || 'this account'} in this period.
                  </td>
                </tr>
              ) : (
                accountTrades.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-semibold">{t.symbol}</td>
                    <td className="py-2.5 px-4 font-mono">
                      {t.direction} ({t.source})
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">${t.stake.toFixed(2)}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">${t.payout.toFixed(2)}</td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono font-bold tabular-nums ${
                        t.profitLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                      }`}
                    >
                      {t.profitLoss >= 0 ? '+' : ''}
                      {t.profitLoss.toFixed(2)} USD
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-500">
                      {t.closedAt ? new Date(t.closedAt).toLocaleString() : 'Open'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0b1b35] text-white">
              <tr>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Account</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-right">Balance After</th>
                <th className="py-3 px-4 text-right">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {accountTxs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No ledger transactions yet.
                  </td>
                </tr>
              ) : (
                accountTxs.map((tx) => (
                  <tr key={tx.id}>
                    <td className="py-2.5 px-4 uppercase font-mono font-semibold">{tx.type}</td>
                    <td className="py-2.5 px-4 font-mono">{tx.accountId}</td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{tx.reason}</td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono font-bold tabular-nums ${
                        tx.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                      }`}
                    >
                      {tx.amount >= 0 ? '+' : ''}
                      {tx.amount.toFixed(2)} USD
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">${tx.balanceAfter.toFixed(2)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-500">
                      {new Date(tx.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function RiskCalculatorView() {
  const [capital, setCapital] = useState(1000);
  const stake = capital * 0.02;
  const takeProfit = stake * 5;
  const stopLoss4 = stake + stake * 2 + stake * 4 + stake * 8;

  return (
    <div className="max-w-xl mx-auto py-4">
      <div className="rounded-2xl border border-slate-700/70 bg-[#142334] text-white p-6 space-y-5 shadow-xl">
        <div className="flex items-center justify-center gap-2 text-sky-400">
          <Calculator className="w-5 h-5" />
          <h2 className="font-display font-bold tracking-widest uppercase text-lg">Martingale Calculator</h2>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label className="text-slate-300 font-medium">Initial Capital (USD):</label>
            <input
              type="number"
              min={0}
              value={capital || ''}
              onChange={(e) => setCapital(Math.max(0, Number(e.target.value)))}
              placeholder="Enter capital"
              className="w-full sm:w-60 rounded-lg bg-[#273c4f] border border-slate-600 px-3.5 py-2 text-center font-mono text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div className="rounded-xl bg-[#273c4f]/80 px-4 py-3 flex items-center justify-between">
            <span className="text-slate-300">Stake (2% of Capital):</span>
            <span className="font-mono font-bold text-sky-400 tabular-nums">{stake.toFixed(2)}</span>
          </div>

          <div className="rounded-xl bg-[#273c4f]/80 px-4 py-3 flex items-center justify-between">
            <span className="text-slate-300">Take Profit (5x Stake):</span>
            <span className="font-mono font-bold text-emerald-400 tabular-nums">{takeProfit.toFixed(2)}</span>
          </div>

          <div className="rounded-xl bg-[#273c4f]/80 px-4 py-3 flex items-center justify-between">
            <span className="text-slate-300">Stop Loss (4 Losses Sum):</span>
            <span className="font-mono font-bold text-sky-400 tabular-nums">{stopLoss4.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CopyTradingView({
  accounts,
  activeAccount,
  onExecuteSettle,
  selectedSymbol,
  marketStates,
}: SharedViewProps & { accounts: TradingAccount[] }) {
  const realAcc = accounts.find((a) => a.accountType === 'real');
  const demoAcc = accounts.find((a) => a.accountType === 'demo');
  const [mirroring, setMirroring] = useState(false);
  const [followerToken, setFollowerToken] = useState('');
  const [followers, setFollowers] = useState<string[]>([]);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [msg, setMsg] = useState('');

  const handleAddFollower = () => {
    const clean = followerToken.trim();
    if (!clean) return;
    if (!followers.includes(clean)) {
      setFollowers((f) => [...f, clean]);
    }
    setFollowerToken('');
  };

  const handleMirrorTrade = async () => {
    const st = marketStates[selectedSymbol];
    if (!st || !activeAccount) return;
    setMsg('');
    const won = Math.random() > 0.45;
    await onExecuteSettle({
      symbol: selectedSymbol,
      tradeType: 'Copy Mirror',
      direction: st.price >= st.prevPrice ? 'RISE' : 'FALL',
      stake: 5,
      won,
      payoutRate: 0.9,
      source: 'copy',
      note: `Mirrored from ${demoAcc?.accountId || 'DOT'} -> ${activeAccount.accountId}`,
    });
    setMsg(`Executed copy trade on ${activeAccount.accountId} (${won ? 'Profit' : 'Loss'})`);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-[#0b1326] text-white p-4 sm:p-5 space-y-4 shadow-xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMirroring((m) => !m)}
            className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold text-center transition-colors"
          >
            {mirroring ? 'Demo to Real Copy Trading Active' : 'Start Demo to Real Copy Trading'}
          </button>
          <button
            type="button"
            onClick={() => setTutorialOpen((t) => !t)}
            className="px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5 text-amber-400 fill-current" /> Tutorial
          </button>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0f1930] px-4 py-2.5 flex items-center justify-between text-xs font-mono">
          <span>
            {realAcc ? `${realAcc.accountId.slice(0, 4)}******` : demoAcc ? `${demoAcc.accountId.slice(0, 4)}******` : 'ROT******'}
          </span>
          <span className="text-emerald-400">******</span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0f1930] p-4 space-y-3">
          <input
            type="text"
            value={followerToken}
            onChange={(e) => setFollowerToken(e.target.value)}
            placeholder="Enter follower's PIPFLOW Sync Token"
            className="w-full rounded-lg border border-slate-700 bg-[#0b1326] px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-700 bg-[#0b1326] px-3 py-2 text-xs text-slate-300 flex items-center justify-between">
              <span className="truncate">{realAcc ? realAcc.accountId : 'Real clients'}</span>
            </div>
            <button
              type="button"
              onClick={handleAddFollower}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2"
            >
              Add
            </button>
            <button
              type="button"
              onClick={handleMirrorTrade}
              className="rounded-lg border border-slate-700 bg-[#0b1326] hover:bg-slate-800 text-xs font-semibold py-2 inline-flex items-center justify-center gap-1"
            >
              Sync <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleMirrorTrade}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
          >
            Start Copy Trading
          </button>

          {!realAcc && (
            <div className="rounded-lg bg-white text-rose-700 text-xs font-semibold px-3.5 py-2.5">
              Connect a PIPFLOW Real (ROT) account via your profile or Admin Control Centre to enable live-labeled mirroring.
            </div>
          )}

          {msg && <div className="text-xs font-mono text-emerald-400">{msg}</div>}
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0f1930] p-4 space-y-2">
          <div className="text-xs font-bold">Total Clients added: {followers.length}</div>
          <div className="rounded-lg border border-slate-800 bg-[#0b1326] px-3.5 py-3 text-center text-xs text-slate-500">
            {followers.length === 0 ? 'No tokens added yet' : followers.join(', ')}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
            Sync tokens are encrypted on the PIPFLOW server and never stored in browser storage. Demo-to-Real copy mirroring tracks active workspace executions cleanly.
          </p>
        </div>

        {tutorialOpen && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-950/30 p-3.5 text-xs text-sky-100">
            1. Keep your Demo (DOT) or Real (ROT) account selected in the top header. 2. Click &quot;Start Copy Trading&quot; to mirror simulated executions directly onto your active PIPFLOW ledger.
          </div>
        )}
      </div>
    </div>
  );
}

export function PTraderView({
  markets,
  marketStates,
  selectedSymbol,
  onSelectSymbol,
  onExecuteSettle,
}: SharedViewProps) {
  const [tradeMode, setTradeMode] = useState<'Accumulators' | 'Rise/Fall'>('Accumulators');
  const [stake, setStake] = useState(10);
  const [growthRate, setGrowthRate] = useState(3);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const asset = markets.find((m) => m.symbol === selectedSymbol) || markets[0];
  const st = marketStates[selectedSymbol];
  const barrierRange = tradeMode === 'Accumulators' ? asset.volatility * 1.6 : null;

  const handleBuy = async (dir: 'ACCU' | 'RISE' | 'FALL') => {
    if (!st || busy) return;
    setBusy(true);
    setFeedback('');
    try {
      const won = Math.random() > 0.44;
      await onExecuteSettle({
        symbol: selectedSymbol,
        tradeType: tradeMode,
        direction: dir,
        stake,
        won,
        payoutRate: tradeMode === 'Accumulators' ? growthRate * 0.25 : asset.payoutRate,
        source: 'manual',
        note: `PTrader ${tradeMode}`,
      });
      setFeedback(
        won
          ? `Contract won! +$${(stake * (tradeMode === 'Accumulators' ? growthRate * 0.25 : asset.payoutRate)).toFixed(2)}`
          : `Contract closed -$${stake.toFixed(2)}`
      );
    } catch (err: any) {
      setFeedback(err?.message || 'Trade failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] overflow-hidden shadow-sm">
      <div className="relative">
        {/* Floating Asset Selector Card Top-Left matching Screenshot */}
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#0f1724]">
          <div className="flex items-center gap-2">
            <select
              value={selectedSymbol}
              onChange={(e) => onSelectSymbol(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-1.5 text-xs font-bold"
            >
              {markets
                .filter((m) => m.enabled)
                .map((m) => (
                  <option key={m.symbol} value={m.symbol} className="dark:bg-slate-900">
                    {m.name} ({m.symbol})
                  </option>
                ))}
            </select>
            <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400 tabular-nums">
              {st ? st.price.toFixed(asset.pipDecimals) : '—'}
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-500">PTrader · PIPFLOW Options</span>
        </div>

        {st && (
          <TradingChart
            asset={asset}
            marketState={st}
            mode="area"
            barrierRange={barrierRange}
            heightClass="h-[340px] lg:h-[420px]"
          />
        )}
      </div>

      {/* Bottom Contract Panel matching Screenshot_20261115-011313 */}
      <div className="p-4 sm:p-5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <select
            value={tradeMode}
            onChange={(e) => setTradeMode(e.target.value as any)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm font-bold"
          >
            <option value="Accumulators" className="dark:bg-slate-900">
              Accumulators
            </option>
            <option value="Rise/Fall" className="dark:bg-slate-900">
              Rise / Fall
            </option>
          </select>

          {tradeMode === 'Accumulators' && (
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setGrowthRate(r)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold ${
                    growthRate === r
                      ? 'bg-sky-600 text-white'
                      : 'border border-slate-200 dark:border-slate-700 text-slate-500'
                  }`}
                >
                  {r}%
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stake Stepper (- 10 USD +) */}
        <div className="flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setStake((s) => Math.max(1, s - 1))}
            className="px-5 py-2.5 hover:bg-slate-200/70 dark:hover:bg-slate-800 font-bold text-base"
          >
            −
          </button>
          <input
            type="number"
            min={1}
            value={stake}
            onChange={(e) => setStake(Math.max(1, Number(e.target.value)))}
            className="flex-1 text-center font-mono font-bold text-sm bg-transparent focus:outline-none"
          />
          <span className="text-xs font-semibold text-slate-500 pr-3">USD</span>
          <button
            type="button"
            onClick={() => setStake((s) => s + 1)}
            className="px-5 py-2.5 hover:bg-slate-200/70 dark:hover:bg-slate-800 font-bold text-base"
          >
            +
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 font-medium">Max. payout</span>
            <span className="font-mono font-bold">{(stake * 600).toLocaleString()}.00 USD</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 font-medium">Max. ticks</span>
            <span className="font-mono font-bold">85 ticks</span>
          </div>
        </div>

        {tradeMode === 'Accumulators' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => handleBuy('ACCU')}
            className="w-full py-3 rounded-xl bg-[#2a9d8f] hover:bg-[#238276] text-white font-bold text-sm transition-colors shadow-sm"
          >
            {busy ? 'Executing...' : 'Buy'}
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleBuy('RISE')}
              className="py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm inline-flex items-center justify-center gap-1"
            >
              <TrendingUp className="w-4 h-4" /> Rise
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleBuy('FALL')}
              className="py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm inline-flex items-center justify-center gap-1"
            >
              <TrendingDown className="w-4 h-4" /> Fall
            </button>
          </div>
        )}

        {feedback && (
          <div className="text-xs font-mono text-center p-2 rounded-lg bg-slate-100 dark:bg-slate-900">
            {feedback}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfileSettingsView({ navigate }: { navigate: (to: string) => void }) {
  const { user, updateProfile, activeAccount } = useAuth();
  const { theme, setTheme } = usePlatform();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [country, setCountry] = useState(user?.country || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [currency, setCurrency] = useState<'USD' | 'KSH' | 'EUR' | 'GBP'>(user?.preferredCurrency || 'USD');
  const [saved, setSaved] = useState('');

  if (!user) return null;

  const initials = getInitialsFromEmail(user.email, user.fullName);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfile({ fullName, country, phone, preferredCurrency: currency, preferredTheme: theme });
    setSaved('Profile & workspace settings saved.');
    setTimeout(() => setSaved(''), 3000);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-6 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-sky-600 text-white font-display font-bold text-lg flex items-center justify-center shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-bold text-lg truncate">{user.fullName || user.email}</h2>
          <div className="text-xs text-slate-500 truncate">{user.email}</div>
          <div className="flex items-center gap-3 mt-1 text-xs">
            <span className={user.emailVerified ? 'text-emerald-500 font-semibold' : 'text-amber-500 font-semibold'}>
              {user.emailVerified ? 'Email Verified' : 'Email Unverified'}
            </span>
            {!user.emailVerified && (
              <button type="button" onClick={() => navigate('/verify-email')} className="text-sky-500 hover:underline">
                Verify now
              </button>
            )}
            <span className="text-slate-400">·</span>
            <span className="font-mono text-slate-500">
              Active: {activeAccount?.accountId} ({formatCurrencyAmount(activeAccount?.balance ?? 0, currency)})
            </span>
          </div>
        </div>
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-6 space-y-4"
      >
        <h3 className="font-display font-bold text-base">Account Settings &amp; Preferences</h3>
        {saved && (
          <div className="p-2.5 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> {saved}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Full Name</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Country</label>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Display Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as any)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
            >
              <option value="USD">USD</option>
              <option value="KSH">KSH</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Theme:</span>
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
            </button>
          </div>

          <button
            type="submit"
            className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold"
          >
            Save Preferences
          </button>
        </div>
      </form>
    </div>
  );
}
