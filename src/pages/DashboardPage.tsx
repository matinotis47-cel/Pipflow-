import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart2,
  Bell,
  Bot,
  Calculator,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  FileText,
  FolderUp,
  Globe,
  Layers,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Moon,
  Phone,
  Play,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Sun,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { PipflowLogo } from '../components/PipflowLogo';
import { AdminAuthModal } from '../components/AdminAuthModal';
import { TradingChart } from '../components/TradingChart';
import { AiProfitBotDrawer } from '../components/AiProfitBotDrawer';
import {
  AnalysisToolView,
  BotBuilderView,
  BulkTraderView,
  CopyTradingView,
  PTraderView,
  ProfileSettingsView,
  ReportsView,
  RiskCalculatorView,
  TradingBotsLibraryView,
} from '../components/workspace/WorkspaceViews';
import { useAuth } from '../context/AuthContext';
import { usePlatform } from '../context/PlatformContext';
import { formatCurrencyAmount, getInitialsFromEmail } from '../config/app.config';
import { apiFetch } from '../lib/sessionMemory';
import type { MarketAsset, TradeRecord } from '../types/pipflow';
import type { MarketTickState } from '../services/marketEngine';

type WorkspaceTabId =
  | 'dashboard'
  | 'bot_builder'
  | 'charts'
  | 'trading_bots'
  | 'bulk_trader'
  | 'analysis_tool'
  | 'reports'
  | 'risk_calculator'
  | 'copy_trading'
  | 'ptrader'
  | 'trading_view'
  | 'profile';

interface TabConfig {
  id: WorkspaceTabId;
  label: string;
  visible: boolean;
}

const DEFAULT_TABS: TabConfig[] = [
  { id: 'dashboard', label: 'Dashboard', visible: true },
  { id: 'bot_builder', label: 'Bot Builder', visible: true },
  { id: 'charts', label: 'Charts', visible: true },
  { id: 'trading_bots', label: 'Trading Bots', visible: true },
  { id: 'bulk_trader', label: 'Bulk Trader', visible: true },
  { id: 'analysis_tool', label: 'Analysis Tool', visible: true },
  { id: 'reports', label: 'Reports', visible: true },
  { id: 'risk_calculator', label: 'Risk Calculator', visible: true },
  { id: 'copy_trading', label: 'Copy Trading', visible: true },
  { id: 'ptrader', label: 'PTrader', visible: true },
  { id: 'trading_view', label: 'TradingView', visible: true },
  { id: 'profile', label: 'Profile', visible: false },
];

const TAB_ICON_MAP: Record<WorkspaceTabId, React.ElementType> = {
  dashboard: LayoutDashboard,
  bot_builder: Puzzle,
  charts: LineChart,
  trading_bots: Bot,
  bulk_trader: Layers,
  analysis_tool: BarChart2,
  reports: FileText,
  risk_calculator: Calculator,
  copy_trading: Copy,
  ptrader: TrendingUp,
  trading_view: LineChart,
  profile: Settings,
};

interface DashboardPageProps {
  navigate: (to: string) => void;
  markets: MarketAsset[];
  marketStates: Record<string, MarketTickState>;
  initialTab?: WorkspaceTabId;
}

export function DashboardPage({ navigate, markets, marketStates, initialTab = 'dashboard' }: DashboardPageProps) {
  const { config, theme, toggleTheme } = usePlatform();
  const {
    user,
    accounts,
    activeAccount,
    trades,
    transactions,
    watchlist,
    notifications,
    switchAccount,
    updateProfile,
    resetDemoBalance,
    toggleWatchlist,
    markNotificationsRead,
    setAccountBalanceLocal,
    refreshUserState,
    logout,
    adminAuthenticated,
  } = useAuth();

  const [activeTab, setActiveTabState] = useState<WorkspaceTabId>(() => {
    if (typeof window !== 'undefined') {
      const h = window.location.hash.replace(/^#/, '') as WorkspaceTabId;
      if (DEFAULT_TABS.some((t) => t.id === h)) return h;
    }
    return initialTab;
  });
  const setActiveTab = (tab: WorkspaceTabId) => {
    setActiveTabState(tab);
    if (typeof window !== 'undefined' && window.location.hash !== `#${tab}`) {
      window.history.replaceState({}, '', `${window.location.pathname}#${tab}`);
    }
  };
  const [selectedSymbol, setSelectedSymbol] = useState<string>(markets[0]?.symbol || 'R_100_1S');
  const [timeframe, setTimeframe] = useState<string>(config.dashboard.defaultChartTimeframe || '1m');

  // Header Menus & Modals
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [accountAccordionOpen, setAccountAccordionOpen] = useState(true);
  const [accountTab, setAccountTab] = useState<'real' | 'demo'>(activeAccount?.accountType || 'demo');
  const [notifOpen, setNotifOpen] = useState(false);
  const [contactPopoverOpen, setContactPopoverOpen] = useState(false);
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [aiBotOpen, setAiBotOpen] = useState(false);
  const [runnerDrawerOpen, setRunnerDrawerOpen] = useState(false);
  const [marketSearch, setMarketSearch] = useState('');
  const [gmtNow, setGmtNow] = useState(() => new Date().toISOString().slice(0, 19).replace('T', ' '));

  // Hidden 10-click Admin Trigger State
  const clickCountRef = useRef(0);
  const lastClickTimeRef = useRef(0);
  const [adminModalOpen, setAdminModalOpen] = useState(false);

  // Bot Execution Bar State
  const [botRunning, setBotRunning] = useState(false);
  const [executionSpeed, setExecutionSpeed] = useState<'FAST' | 'SLOW'>('FAST');
  const [botStatusText, setBotStatusText] = useState('Bot is not running');
  const [botLogs, setBotLogs] = useState<string[]>([]);
  const [activeBotConfig, setActiveBotConfig] = useState<{
    name: string;
    symbol: string;
    direction: 'RISE' | 'FALL' | 'EVEN' | 'ODD' | 'OVER' | 'UNDER';
    stake: number;
  }>({
    name: 'PIPFLOW Momentum Bot',
    symbol: 'R_100_1S',
    direction: 'RISE',
    stake: 2,
  });

  // Manual Trade Ticket State
  const [manualStake, setManualStake] = useState(10);
  const [tradeFeedback, setTradeFeedback] = useState('');

  // Tab Customization State
  const [tabs, setTabs] = useState<TabConfig[]>(() => {
    try {
      const saved = localStorage.getItem('pf_workspace_tabs');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return DEFAULT_TABS;
  });

  useEffect(() => {
    if (activeAccount) {
      setAccountTab(activeAccount.accountType);
    }
  }, [activeAccount?.accountId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setGmtNow(new Date().toISOString().slice(0, 19).replace('T', ' '));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const handleHeaderLogoClick = () => {
    const now = Date.now();
    if (now - lastClickTimeRef.current > 2000) {
      clickCountRef.current = 1;
    } else {
      clickCountRef.current += 1;
    }
    lastClickTimeRef.current = now;

    if (clickCountRef.current === 10) {
      clickCountRef.current = 0;
      if (adminAuthenticated) {
        navigate('/admin');
      } else {
        setAdminModalOpen(true);
      }
      return;
    }

    // Normal click behavior remains uninterrupted
    setActiveTab('dashboard');
  };

  const executeSettleTrade = async (params: {
    symbol: string;
    tradeType: string;
    direction: 'BUY' | 'SELL' | 'RISE' | 'FALL' | 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'ACCU';
    stake: number;
    won: boolean;
    payoutRate: number;
    source: 'manual' | 'bot' | 'ai_profit_bot' | 'bulk' | 'copy';
    note?: string;
  }) => {
    if (!activeAccount) throw new Error('No active account selected.');
    const st = marketStates[params.symbol];
    const asset = markets.find((m) => m.symbol === params.symbol) || markets[0];
    const entryPrice = st?.price || asset.basePrice;
    const exitPrice = Number(
      (entryPrice + (params.won ? asset.volatility * 0.4 : -asset.volatility * 0.4)).toFixed(asset.pipDecimals)
    );

    const res = await apiFetch('/api/trading/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        accountId: activeAccount.accountId,
        symbol: params.symbol,
        tradeType: params.tradeType,
        direction: params.direction,
        stake: params.stake,
        entryPrice,
        exitPrice,
        won: params.won,
        payoutRate: params.payoutRate,
        source: params.source,
        note: params.note,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Trade execution failed');
    setAccountBalanceLocal(data.account);
    void refreshUserState();
  };

  const openManualPosition = async (direction: 'BUY' | 'SELL') => {
    if (!activeAccount) return;
    setTradeFeedback('');
    const st = marketStates[selectedSymbol];
    const asset = markets.find((m) => m.symbol === selectedSymbol) || markets[0];
    try {
      const res = await apiFetch('/api/trading/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accountId: activeAccount.accountId,
          symbol: selectedSymbol,
          tradeType: 'Spot Position',
          direction,
          stake: manualStake,
          entryPrice: st?.price || asset.basePrice,
          source: 'manual',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTradeFeedback(data.error || 'Failed to open position');
        return;
      }
      setAccountBalanceLocal(data.account);
      setTradeFeedback(`Opened ${direction} $${manualStake} on ${selectedSymbol}`);
      void refreshUserState();
    } catch {
      setTradeFeedback('Network error opening position.');
    }
  };

  const closeOpenPosition = async (trade: TradeRecord) => {
    const st = marketStates[trade.symbol];
    const asset = markets.find((m) => m.symbol === trade.symbol) || markets[0];
    const curPrice = st?.price || trade.entryPrice;
    const diff = curPrice - trade.entryPrice;
    const dirSign = trade.direction === 'BUY' || trade.direction === 'RISE' ? 1 : -1;
    const pnl = Number(((diff * dirSign) / Math.max(0.0001, asset.volatility) * trade.stake * 0.45).toFixed(2));

    const res = await apiFetch('/api/trading/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        tradeId: trade.id,
        exitPrice: curPrice,
        profitLoss: pnl,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setAccountBalanceLocal(data.account);
      void refreshUserState();
    } else {
      setTradeFeedback(data.error || 'Could not close trade.');
    }
  };

  // Bottom bar background bot runner
  useEffect(() => {
    if (!botRunning || !activeAccount) return;
    const intervalMs = executionSpeed === 'FAST' ? 1800 : 3800;
    const timer = setInterval(() => {
      const sym = activeBotConfig.symbol;
      const st = marketStates[sym];
      const asset = markets.find((m) => m.symbol === sym) || markets[0];
      if (!st || !asset) return;
      if (activeAccount.balance < activeBotConfig.stake) {
        const msg = `Stopped: insufficient balance on ${activeAccount.accountId}`;
        setBotStatusText(msg);
        setBotLogs((l) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...l.slice(0, 19)]);
        setBotRunning(false);
        return;
      }
      const won =
        activeBotConfig.direction === 'EVEN'
          ? st.lastDigit % 2 === 0
          : activeBotConfig.direction === 'ODD'
            ? st.lastDigit % 2 !== 0
            : Math.random() > 0.42;
      void executeSettleTrade({
        symbol: sym,
        tradeType: activeBotConfig.name,
        direction: activeBotConfig.direction,
        stake: activeBotConfig.stake,
        won,
        payoutRate: asset.payoutRate,
        source: 'bot',
        note: activeBotConfig.name,
      })
        .then(() => {
          const msg = `${activeBotConfig.name}: ${
            won ? `Won +$${(activeBotConfig.stake * asset.payoutRate).toFixed(2)}` : `Lost -$${activeBotConfig.stake.toFixed(2)}`
          } on ${sym}`;
          setBotStatusText(msg);
          setBotLogs((l) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...l.slice(0, 19)]);
        })
        .catch((err) => {
          setBotStatusText(err.message || 'Bot stopped');
          setBotRunning(false);
        });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [botRunning, executionSpeed, activeBotConfig, activeAccount?.accountId, activeAccount?.balance]);

  if (!user) return null;

  const displayCurrency = user.preferredCurrency || config.dashboard.defaultCurrency || 'USD';
  const unreadCount = notifications.filter((n) => !n.read).length;
  const userInitials = getInitialsFromEmail(user.email, user.fullName);
  const currentAsset = markets.find((m) => m.symbol === selectedSymbol) || markets[0];
  const currentMarketState = marketStates[selectedSymbol];
  const openPositions = trades.filter((t) => t.status === 'open');
  const realAccounts = accounts.filter((a) => a.accountType === 'real');
  const demoAccounts = accounts.filter((a) => a.accountType === 'demo');

  const isFeatureTabEnabled = (id: WorkspaceTabId): boolean => {
    if (id === 'bot_builder') return config.features.botBuilderEnabled;
    if (id === 'bulk_trader') return config.features.bulkTraderEnabled;
    if (id === 'analysis_tool') return config.features.analysisToolEnabled;
    if (id === 'risk_calculator') return config.features.riskCalculatorEnabled;
    if (id === 'copy_trading') return config.features.copyTradingEnabled;
    if (id === 'ptrader') return config.features.pTraderEnabled;
    return true;
  };

  const visibleTabs = tabs.filter((t) => t.visible && isFeatureTabEnabled(t.id));

  const moveTab = (idx: number, dir: -1 | 1) => {
    const next = [...tabs];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setTabs(next);
  };

  const saveTabs = () => {
    localStorage.setItem('pf_workspace_tabs', JSON.stringify(tabs));
    setArrangeOpen(false);
  };

  const resetTabs = () => {
    setTabs(DEFAULT_TABS);
    localStorage.removeItem('pf_workspace_tabs');
  };

  const filteredMarkets = markets.filter(
    (m) =>
      m.enabled &&
      (!marketSearch.trim() ||
        m.name.toLowerCase().includes(marketSearch.toLowerCase()) ||
        m.symbol.toLowerCase().includes(marketSearch.toLowerCase()))
  );

  const isRealActive = activeAccount?.accountType === 'real';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#080d17] text-slate-900 dark:text-slate-100 pb-12">
      {/* Top Workspace Bar matching Screenshot */}
      <header className="sticky top-0 z-30 h-12 sm:h-13 px-2.5 sm:px-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setSideMenuOpen(true)}
            className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Hidden 10-Click Admin Trigger Logo (compact so header stays uncluttered) */}
          <PipflowLogo variant="dashboard" showWordmark={false} size="sm" onClick={handleHeaderLogoClick} />

          {/* Split KSH | USD Angled Card Toggle matching Screenshot */}
          <button
            type="button"
            onClick={() => {
              const nextCurr = displayCurrency === 'USD' ? 'KSH' : 'USD';
              void updateProfile({ preferredCurrency: nextCurr });
            }}
            className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-1 py-0.5 text-[10px] font-mono font-extrabold shadow-sm"
            title="Toggle KSH / USD currency display"
          >
            <span
              className={`px-1.5 py-0.5 rounded-sm transition-colors ${
                displayCurrency === 'KSH'
                  ? 'bg-[#0284c7] text-white'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              KSH
            </span>
            <span
              className={`px-1.5 py-0.5 rounded-sm transition-colors ${
                displayCurrency === 'USD'
                  ? 'bg-[#b91c1c] text-white'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              USD
            </span>
            <ChevronDown className="w-3 h-3 text-slate-500 mx-0.5" />
          </button>

          {/* Phone Contact Ticket Popover Trigger */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setContactPopoverOpen((o) => !o);
                setAccountDropdownOpen(false);
                setNotifOpen(false);
              }}
              className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Platform Contact Card"
            >
              <Phone className="w-4 h-4 fill-current" />
            </button>

            {contactPopoverOpen && (
              <div className="absolute left-0 mt-2 w-72 rounded-xl border border-slate-300 dark:border-slate-700 bg-gradient-to-b from-slate-50 via-teal-50/70 to-emerald-50 dark:from-[#0f1724] dark:to-[#0b1220] text-slate-900 dark:text-white shadow-2xl overflow-hidden z-50">
                <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-200 dark:border-slate-800">
                  <span className="font-mono text-[10px] font-bold tracking-widest uppercase text-slate-500">
                    {(config.branding.websiteUrl || 'https://pipflow.site').replace(/^https?:\/\//, '').toUpperCase()}
                  </span>
                  <div className="flex gap-0.5 h-4 items-center opacity-70" aria-hidden="true">
                    {[2, 1, 3, 1, 2, 1, 2, 3, 1, 2, 1, 2].map((w, idx) => (
                      <span key={idx} className="bg-slate-900 dark:bg-white h-full inline-block" style={{ width: w }} />
                    ))}
                  </div>
                </div>
                <div className="p-4 text-center space-y-2">
                  <div className="font-display font-bold text-base">
                    {config.branding.websiteUrl?.replace(/^https?:\/\//, '') || 'pipflow.site'}
                  </div>
                  <div className="text-[10px] font-mono tracking-[0.2em] text-slate-500 uppercase">
                    ANALYTICS • BOTS • SIGNALS
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1 pt-1">
                    {config.branding.supportEmail && (
                      <div>
                        Email: <span className="font-mono font-semibold">{config.branding.supportEmail}</span>
                      </div>
                    )}
                    {config.branding.supportPhone && (
                      <div>
                        Phone: <span className="font-mono font-semibold">{config.branding.supportPhone}</span>
                      </div>
                    )}
                    {!config.branding.supportEmail && !config.branding.supportPhone && (
                      <p className="text-slate-500">Official PIPFLOW support channels are active.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setContactPopoverOpen(false);
                      navigate('/contact');
                    }}
                    className="mt-2 w-full py-1.5 rounded-lg bg-[#0e2954] text-white text-xs font-semibold"
                  >
                    Open Contact Centre
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Controls: Account Switcher, Notifications, Profile Avatar */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Active Balance Pill & Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setAccountDropdownOpen((o) => !o);
                setNotifOpen(false);
                setContactPopoverOpen(false);
              }}
              className="inline-flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {/* Matching Balance Icon: Green 'R' for Real (ROT...), Teal 'D' for Demo (DOT...) */}
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold text-white shrink-0 shadow-sm ${
                  isRealActive ? 'bg-emerald-600' : 'bg-[#4f7f78]'
                }`}
              >
                {isRealActive ? 'R' : 'D'}
              </span>
              <span
                className={`font-mono text-xs sm:text-sm font-bold tabular-nums whitespace-nowrap ${
                  isRealActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#2a9d8f] dark:text-emerald-400'
                }`}
              >
                {activeAccount ? formatCurrencyAmount(activeAccount.balance, displayCurrency) : '0.00 USD'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            </button>

            {accountDropdownOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] shadow-2xl overflow-hidden z-50">
                <div className="grid grid-cols-2 border-b border-slate-200 dark:border-slate-800 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setAccountTab('real')}
                    className={`py-3 border-b-2 transition-colors ${
                      accountTab === 'real'
                        ? 'border-rose-500 text-slate-900 dark:text-white'
                        : 'border-transparent text-slate-500'
                    }`}
                  >
                    Real
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountTab('demo')}
                    className={`py-3 border-b-2 transition-colors ${
                      accountTab === 'demo'
                        ? 'border-rose-500 text-slate-900 dark:text-white'
                        : 'border-transparent text-slate-500'
                    }`}
                  >
                    Demo
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  <button
                    type="button"
                    onClick={() => setAccountAccordionOpen((o) => !o)}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-100"
                  >
                    <span>{config.branding.appName || 'PIPFLOW'} account</span>
                    {accountAccordionOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {accountAccordionOpen && (
                    <div className="space-y-2.5">
                      {(accountTab === 'real' ? realAccounts : demoAccounts).length === 0 ? (
                        <div className="p-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center text-xs text-slate-500">
                          No {accountTab} account provisioned yet. Contact Admin Control Centre to add one.
                        </div>
                      ) : (
                        (accountTab === 'real' ? realAccounts : demoAccounts).map((acc) => {
                          const isSelected = acc.accountId === activeAccount?.accountId;
                          const isReal = acc.accountType === 'real';
                          const atDefault = !isReal && Math.abs(acc.balance - config.dashboard.defaultDemoBalance) < 0.01;
                          return (
                            <div key={acc.accountId} className="space-y-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  await switchAccount(acc.accountId);
                                  setAccountDropdownOpen(false);
                                }}
                                className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-colors ${
                                  isSelected
                                    ? 'bg-slate-200/75 dark:bg-slate-800'
                                    : 'border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <span
                                    className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 ${
                                      isReal ? 'bg-emerald-600' : 'bg-[#4f7f78]'
                                    }`}
                                  >
                                    {isReal ? 'R' : 'D'}
                                  </span>
                                  <div>
                                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                                      {isReal ? 'Real' : 'Demo'}
                                    </div>
                                    <div className="text-[11px] font-mono text-slate-500">{acc.accountId}</div>
                                  </div>
                                </div>
                                <div className="font-mono text-xs font-bold tabular-nums text-slate-900 dark:text-white">
                                  {formatCurrencyAmount(acc.balance, displayCurrency)}
                                </div>
                              </button>

                              {!isReal && (
                                <div className="space-y-1 text-center">
                                  <button
                                    type="button"
                                    onClick={() => void resetDemoBalance(acc.accountId)}
                                    disabled={atDefault}
                                    className="w-full py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" /> Reset balance
                                  </button>
                                  <div className="text-[11px] text-slate-400">
                                    {atDefault
                                      ? 'Already at the starting balance'
                                      : `Resets to ${config.dashboard.defaultDemoBalance.toLocaleString()}.00 USD`}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  <div className="py-2 border-y border-slate-200 dark:border-slate-800 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setAccountDropdownOpen(false);
                        navigate('/markets');
                      }}
                      className="text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      Looking for CFD accounts? Open PIPFLOW Markets
                    </button>
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setAccountDropdownOpen(false);
                        void logout().then(() => navigate('/'));
                      }}
                      className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200 hover:text-rose-500 font-semibold"
                    >
                      Logout <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Notifications Bell */}
          {config.features.notificationsEnabled && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((o) => !o);
                  setAccountDropdownOpen(false);
                  setContactPopoverOpen(false);
                  if (!notifOpen && unreadCount > 0) void markNotificationsRead();
                }}
                className="relative p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] shadow-2xl p-3 space-y-2 z-50 max-h-80 overflow-y-auto">
                  <div className="flex items-center justify-between px-1 pb-1 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-xs font-bold">Notifications</span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Close
                    </button>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">No notifications yet.</p>
                  ) : (
                    notifications.slice(0, 12).map((n) => (
                      <div key={n.id} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/70 space-y-0.5">
                        <div className="text-xs font-semibold">{n.title}</div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* Email-Initials Profile Avatar Button */}
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            title={`${user.email} — Profile & Settings`}
            className="w-7 h-7 rounded-full bg-[#0e2954] dark:bg-sky-600 hover:brightness-110 text-white font-display font-bold text-[11px] flex items-center justify-center shrink-0 transition-all"
          >
            {userInitials}
          </button>
        </div>
      </header>

      {/* Crimson Announcement Banner */}
      {config.branding.announcementEnabled && config.branding.announcementText && (
        <div className="bg-[#dc2626] text-white text-[10px] sm:text-[11px] font-bold tracking-wide py-1 px-4 text-center truncate uppercase">
          {config.branding.announcementText}
        </div>
      )}

      {/* Navy Workspace Navigation Tab Bar */}
      <div className="bg-[#0b2a5b] text-white flex items-center">
        <button
          type="button"
          onClick={() => setArrangeOpen(true)}
          title="Arrange navigation tabs"
          className="px-3.5 py-2.5 border-r border-white/10 hover:bg-white/10 shrink-0"
        >
          <SlidersHorizontal className="w-4 h-4 text-[#f97316]" />
        </button>

        <div className="flex items-center overflow-x-auto no-scrollbar">
          {visibleTabs.map((t) => {
            const active = activeTab === t.id;
            const Icon = TAB_ICON_MAP[t.id] || LayoutDashboard;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-[#163d82] text-white'
                    : 'text-slate-200 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 text-[#f97316] shrink-0" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Workspace Content (full-bleed for Bot Builder to match exact Blockly layout) */}
      <main
        className={
          activeTab === 'bot_builder'
            ? 'flex-1 w-full flex flex-col'
            : 'flex-1 max-w-[1440px] w-full mx-auto p-3 sm:p-5 space-y-5'
        }
      >
        {activeTab === 'dashboard' && (
          <div className="space-y-5">
            {/* Dark Hero Quick Actions Card matching Screenshot_20261115-200435 */}
            <div className="rounded-2xl border border-slate-800 bg-[#0b1326] text-white p-5 sm:p-7 shadow-lg">
              <div className="text-center space-y-1.5 max-w-2xl mx-auto">
                <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight">
                  Hello {activeAccount?.accountId || user.fullName} 👋
                </h1>
                <p className="text-xs sm:text-sm text-slate-400 italic">{config.dashboard.welcomeMessage}</p>
                <div className="pt-3 text-xs sm:text-sm font-bold text-slate-200">Quick Actions</div>
              </div>

              {/* Quick Actions 2x2 Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-4">
                {[
                  {
                    icon: FolderUp,
                    title: 'Upload Bot',
                    desc: 'Import an XML bot or load a custom workspace file.',
                    border: 'border-sky-500/40 hover:border-sky-400',
                    iconColor: 'text-amber-400',
                    action: () => setActiveTab('bot_builder'),
                  },
                  {
                    icon: Bot,
                    title: 'Free Bots',
                    desc: 'Browse ready-made automated trading strategies.',
                    border: 'border-emerald-500/40 hover:border-emerald-400',
                    iconColor: 'text-slate-200',
                    action: () => setActiveTab('trading_bots'),
                  },
                  {
                    icon: Puzzle,
                    title: 'Bot Editor',
                    desc: 'Build a custom bot with the visual block editor.',
                    border: 'border-violet-500/40 hover:border-violet-400',
                    iconColor: 'text-emerald-400',
                    action: () => setActiveTab('bot_builder'),
                  },
                  {
                    icon: Zap,
                    title: 'Quick Strategy',
                    desc: 'Launch Gemini AI Profit-Only Bot or fast strategy template.',
                    border: 'border-amber-500/40 hover:border-amber-400',
                    iconColor: 'text-amber-400',
                    action: () => setAiBotOpen(true),
                  },
                ].map((qa) => (
                  <button
                    key={qa.title}
                    type="button"
                    onClick={qa.action}
                    className={`text-left rounded-xl border ${qa.border} bg-[#0f172a]/90 hover:bg-[#15203b] p-4 transition-all space-y-2`}
                  >
                    <qa.icon className={`w-5 h-5 ${qa.iconColor}`} />
                    <div className="font-display font-bold text-sm text-white">{qa.title}</div>
                    <p className="text-xs text-slate-400">{qa.desc}</p>
                    <div className="text-xs font-semibold text-sky-400 pt-1">Open →</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Watchlist + Quick Trade & Open Positions */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {config.features.watchlistsEnabled && (
                <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display font-bold text-base">Watchlist &amp; Live Markets</h2>
                    {config.features.marketSearchEnabled && (
                      <div className="relative w-full sm:w-56">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          value={marketSearch}
                          onChange={(e) => setMarketSearch(e.target.value)}
                          placeholder="Search asset..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
                        />
                      </div>
                    )}
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80 max-h-80 overflow-y-auto">
                    {filteredMarkets.map((m) => {
                      const st = marketStates[m.symbol];
                      const isWatched = watchlist.includes(m.symbol);
                      const isSel = m.symbol === selectedSymbol;
                      return (
                        <div
                          key={m.symbol}
                          className={`py-2.5 px-2 rounded-lg flex items-center justify-between gap-3 ${
                            isSel ? 'bg-sky-500/10' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <button
                              type="button"
                              onClick={() => void toggleWatchlist(m.symbol)}
                              className={`p-1 rounded ${isWatched ? 'text-amber-400' : 'text-slate-400 hover:text-amber-400'}`}
                              title="Toggle watchlist"
                            >
                              <Star className={`w-4 h-4 ${isWatched ? 'fill-current' : ''}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSymbol(m.symbol);
                                setActiveTab('trading_view');
                              }}
                              className="text-left min-w-0"
                            >
                              <div className="text-xs font-semibold truncate">{m.name}</div>
                              <div className="text-[11px] font-mono text-slate-500">
                                {m.symbol} · {m.category}
                              </div>
                            </button>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                            <div className="text-right">
                              <div className="text-xs font-bold">
                                {st ? st.price.toFixed(m.pipDecimals) : m.basePrice.toFixed(m.pipDecimals)}
                              </div>
                              <div className={`text-[11px] ${(st?.changePct ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {(st?.changePct ?? 0) >= 0 ? '+' : ''}
                                {(st?.changePct ?? 0).toFixed(2)}%
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSymbol(m.symbol);
                                setActiveTab('ptrader');
                              }}
                              className="px-2.5 py-1 rounded-md bg-sky-600 text-white text-[11px] font-semibold"
                            >
                              Trade
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quick Execution & Open Positions */}
              <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-bold text-base">Quick Trade &amp; Positions</h2>
                  <span className="text-xs font-mono text-slate-500">{selectedSymbol}</span>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedSymbol}
                    onChange={(e) => setSelectedSymbol(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
                  >
                    {markets
                      .filter((m) => m.enabled)
                      .map((m) => (
                        <option key={m.symbol} value={m.symbol} className="dark:bg-slate-900">
                          {m.name}
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={manualStake}
                    onChange={(e) => setManualStake(Math.max(1, Number(e.target.value)))}
                    className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-2 text-xs font-mono text-center"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => void openManualPosition('BUY')}
                    className="py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    <TrendingUp className="w-4 h-4" /> Buy Long
                  </button>
                  <button
                    type="button"
                    onClick={() => void openManualPosition('SELL')}
                    className="py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    <TrendingDown className="w-4 h-4" /> Sell Short
                  </button>
                </div>

                {tradeFeedback && <div className="text-xs font-mono text-sky-600 dark:text-sky-400">{tradeFeedback}</div>}

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-xs font-semibold text-slate-500">
                    Open Simulated Positions ({openPositions.length})
                  </div>
                  {openPositions.length === 0 ? (
                    <p className="text-xs text-slate-400 py-3 text-center">No open positions on this account.</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {openPositions.map((pos) => {
                        const st = marketStates[pos.symbol];
                        const asset = markets.find((m) => m.symbol === pos.symbol) || currentAsset;
                        const curPrice = st?.price || pos.entryPrice;
                        const diff = curPrice - pos.entryPrice;
                        const sign = pos.direction === 'BUY' || pos.direction === 'RISE' ? 1 : -1;
                        const livePnl = Number(((diff * sign) / Math.max(0.0001, asset.volatility) * pos.stake * 0.45).toFixed(2));
                        return (
                          <div
                            key={pos.id}
                            className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <div className="font-semibold">
                                {pos.symbol} · {pos.direction}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500">
                                Stake ${pos.stake} · Entry {pos.entryPrice.toFixed(asset.pipDecimals)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`font-mono font-bold tabular-nums ${livePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {livePnl >= 0 ? '+' : ''}
                                {livePnl.toFixed(2)}
                              </span>
                              <button
                                type="button"
                                onClick={() => void closeOpenPosition(pos)}
                                className="px-2.5 py-1 rounded bg-slate-900 dark:bg-sky-600 text-white text-[11px] font-semibold"
                              >
                                Close
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {(activeTab === 'charts' || activeTab === 'trading_view') && currentMarketState && (
          <div className="space-y-3">
            {activeTab === 'trading_view' && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] px-3.5 py-2 text-xs text-slate-500 flex items-center justify-between gap-2">
                <span>Load an Up/Down or Only Ups/Downs bot to enable chart contract sync</span>
                <button
                  type="button"
                  onClick={() => setActiveTab('bot_builder')}
                  className="text-sky-600 dark:text-sky-400 font-semibold whitespace-nowrap hover:underline"
                >
                  Open Bot Builder →
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <select
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0f1724] px-3 py-2 text-xs font-bold shadow-sm"
                >
                  {markets
                    .filter((m) => m.enabled)
                    .map((m) => (
                      <option key={m.symbol} value={m.symbol}>
                        {m.name} ({m.symbol})
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                {activeTab === 'charts' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('trading_view')}
                    className="px-3.5 py-2 rounded-lg bg-[#0b5ed7] hover:bg-[#094db3] text-white text-xs font-bold shadow-sm"
                  >
                    Trading View
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void openManualPosition('BUY')}
                  className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                >
                  Buy ${manualStake}
                </button>
                <button
                  type="button"
                  onClick={() => void openManualPosition('SELL')}
                  className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
                >
                  Sell ${manualStake}
                </button>
              </div>
            </div>

            <TradingChart
              asset={currentAsset}
              marketState={currentMarketState}
              mode={activeTab === 'trading_view' ? 'candles' : 'area'}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              showDrawingTools={activeTab === 'trading_view'}
              heightClass="h-[460px] lg:h-[560px]"
            />
          </div>
        )}

        {activeTab === 'bot_builder' && (
          <BotBuilderView
            markets={markets}
            marketStates={marketStates}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            activeAccount={activeAccount}
            onExecuteSettle={executeSettleTrade}
            onOpenAiBot={() => setAiBotOpen(true)}
            onBotConfigChange={(cfg) => setActiveBotConfig(cfg)}
            onLoadBotAndRun={(name, cfg) => {
              setActiveBotConfig({ name, ...cfg });
              setBotRunning(true);
              setBotStatusText(`Running ${name} on ${cfg.symbol}...`);
            }}
          />
        )}

        {activeTab === 'trading_bots' && (
          <TradingBotsLibraryView
            markets={markets}
            marketStates={marketStates}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            activeAccount={activeAccount}
            onExecuteSettle={executeSettleTrade}
            onOpenAiBot={() => setAiBotOpen(true)}
            onLoadBotAndRun={(name, cfg) => {
              setActiveBotConfig({ name, ...cfg });
              setBotRunning(true);
              setBotStatusText(`Loaded & running ${name}...`);
            }}
          />
        )}

        {activeTab === 'bulk_trader' && (
          <BulkTraderView
            markets={markets}
            marketStates={marketStates}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            activeAccount={activeAccount}
            onExecuteSettle={executeSettleTrade}
            onOpenAiBot={() => setAiBotOpen(true)}
            onLoadBotAndRun={() => {}}
          />
        )}

        {activeTab === 'analysis_tool' && (
          <AnalysisToolView
            markets={markets}
            marketStates={marketStates}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            activeAccount={activeAccount}
            onExecuteSettle={executeSettleTrade}
            onOpenAiBot={() => setAiBotOpen(true)}
            onLoadBotAndRun={() => {}}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsView
            trades={trades}
            transactions={transactions}
            activeAccount={activeAccount}
            onRefresh={() => void refreshUserState()}
          />
        )}

        {activeTab === 'risk_calculator' && <RiskCalculatorView />}

        {activeTab === 'copy_trading' && (
          <CopyTradingView
            accounts={accounts}
            markets={markets}
            marketStates={marketStates}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            activeAccount={activeAccount}
            onExecuteSettle={executeSettleTrade}
            onOpenAiBot={() => setAiBotOpen(true)}
            onLoadBotAndRun={() => {}}
          />
        )}

        {activeTab === 'ptrader' && (
          <PTraderView
            markets={markets}
            marketStates={marketStates}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            activeAccount={activeAccount}
            onExecuteSettle={executeSettleTrade}
            onOpenAiBot={() => setAiBotOpen(true)}
            onLoadBotAndRun={() => {}}
          />
        )}

        {activeTab === 'profile' && <ProfileSettingsView navigate={navigate} />}
      </main>

      {/* Bottom-left Glowing GEMINI Circular Orb + Bottom-right Glowing AI Circular Orb matching Screenshot */}
      {config.features.aiProfitBotEnabled && (
        <>
          <button
            type="button"
            onClick={() => setAiBotOpen(true)}
            title="Open Gemini AI Profit Bot"
            className="fixed left-2.5 bottom-20 z-30 w-12 h-12 rounded-full bg-gradient-to-br from-rose-300 via-rose-500 to-red-700 text-white shadow-xl shadow-rose-600/40 ring-4 ring-rose-400/30 flex items-center justify-center hover:scale-105 transition-transform"
          >
            <span className="text-[10px] font-extrabold tracking-tight">GEMINI</span>
            <span className="absolute -top-0.5 right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white dark:border-[#0b1220]" />
          </button>

          <button
            type="button"
            onClick={() => setAiBotOpen(true)}
            title="AI Profit-Only Trading Assistant"
            className="fixed right-3 bottom-16 z-30 w-12 h-12 rounded-full bg-gradient-to-br from-violet-400 via-purple-600 to-indigo-800 text-white shadow-xl shadow-purple-600/40 ring-4 ring-purple-400/25 flex items-center justify-center hover:scale-105 transition-transform"
          >
            <span className="text-xs font-extrabold">AI</span>
            <span className="absolute top-0 right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white" />
          </button>
        </>
      )}

      {/* Expandable Bot Tape Drawer above Runner Bar */}
      {runnerDrawerOpen && (
        <div className="fixed bottom-14 inset-x-0 z-30 bg-white dark:bg-[#0f1724] border-t border-slate-200 dark:border-slate-800 shadow-2xl px-4 py-3 max-h-52 overflow-y-auto">
          <div className="max-w-4xl mx-auto space-y-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span>Live Bot Execution Tape ({activeBotConfig.name})</span>
              <button type="button" onClick={() => setRunnerDrawerOpen(false)} className="text-slate-400 hover:text-slate-600">
                Close
              </button>
            </div>
            {botLogs.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">Press ▶ Run below to begin simulated execution ticks.</p>
            ) : (
              <div className="space-y-1 font-mono text-[11px]">
                {botLogs.map((line, i) => (
                  <div key={i} className="text-slate-600 dark:text-slate-300">
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fixed Bottom Bot Runner Bar matching Screenshot */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-white dark:bg-[#0b1220] border-t border-slate-200 dark:border-slate-800">
        <div className="flex justify-center border-b border-slate-100 dark:border-slate-800/80 py-0.5">
          <button
            type="button"
            onClick={() => setRunnerDrawerOpen((o) => !o)}
            className="px-4 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            title="Toggle bot tape"
          >
            {runnerDrawerOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>

        <div className="h-11 px-2.5 sm:px-4 flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => {
              setBotRunning((r) => {
                const next = !r;
                setBotStatusText(next ? `Running ${activeBotConfig.name}...` : 'Bot is not running');
                return next;
              });
            }}
            className={`h-8 px-3.5 rounded text-xs font-bold text-white inline-flex items-center gap-1.5 shrink-0 ${
              botRunning ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#64c5bc] hover:bg-[#49b3a9]'
            }`}
          >
            {botRunning ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            {botRunning ? 'Stop' : 'Run'}
          </button>

          <div className="flex-1 flex flex-col items-center justify-center min-w-0 px-2">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
              {botStatusText}
            </div>
            <div className="w-full max-w-md flex items-center gap-1 mt-1">
              <span className="w-1 h-1 rounded-full bg-slate-800 dark:bg-slate-300 shrink-0" />
              <div className="flex-1 h-0.5 bg-slate-300 dark:bg-slate-700 overflow-hidden rounded-full">
                {botRunning && <div className="h-full w-1/2 bg-[#0d9488] animate-pulse rounded-full" />}
              </div>
              <span className="w-1 h-1 rounded-full bg-slate-800 dark:bg-slate-300 shrink-0" />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setExecutionSpeed((s) => (s === 'FAST' ? 'SLOW' : 'FAST'))}
            className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-[#f7f0d8] dark:bg-amber-950/50 text-slate-900 dark:text-amber-200 shrink-0"
          >
            <div className="text-left leading-tight">
              <div className="text-[9px] text-slate-600 dark:text-amber-300/70">Execution</div>
              <div className="text-[11px] font-extrabold font-mono">{executionSpeed}</div>
            </div>
            <span
              className={`w-10 h-5 rounded-full p-0.5 transition-colors flex items-center ${
                executionSpeed === 'FAST' ? 'bg-[#3db3a9] justify-end' : 'bg-slate-400 justify-start'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white shadow" />
            </span>
          </button>
        </div>
      </div>

      {/* Left Hamburger Side Drawer matching Screenshot_20261115-200419 */}
      {sideMenuOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[85vw] bg-white dark:bg-[#0f1724] border-r border-slate-200 dark:border-slate-800 h-full flex flex-col p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSideMenuOpen(false)}
                  className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
                <span className="font-display font-bold text-base">Menu</span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-bold">
                <Globe className="w-3.5 h-3.5 text-sky-600" /> EN
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setSideMenuOpen(false);
                navigate('/about');
              }}
              className="text-left text-xs font-medium text-sky-700 dark:text-sky-400 underline underline-offset-2"
            >
              About this platform
            </button>

            <div className="space-y-1 text-sm pt-2 border-t border-slate-100 dark:border-slate-800">
              {config.features.darkModeEnabled && (
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2.5 text-xs font-medium">
                    {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    Dark theme
                  </span>
                  <span
                    className={`w-9 h-5 rounded-full p-0.5 flex items-center transition-colors ${
                      theme === 'dark' ? 'bg-sky-600 justify-end' : 'bg-slate-300 justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white shadow" />
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const next = displayCurrency === 'USD' ? 'KSH' : 'USD';
                  void updateProfile({ preferredCurrency: next });
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
              >
                <span>Currency display</span>
                <span className="font-mono font-bold">
                  <span className={displayCurrency === 'USD' ? 'text-slate-900 dark:text-white' : 'text-slate-400'}>USD</span>
                  {' | '}
                  <span className={displayCurrency === 'KSH' ? 'text-slate-900 dark:text-white' : 'text-slate-400'}>KSH</span>
                </span>
              </button>

              <div className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium">
                <span>Local currency</span>
                <span className="font-mono font-bold text-slate-600 dark:text-slate-300">KES &gt;</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSideMenuOpen(false);
                  setActiveTab('reports');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
              >
                <FileText className="w-4 h-4" /> Reports
              </button>

              <button
                type="button"
                onClick={() => {
                  setSideMenuOpen(false);
                  setActiveTab('profile');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
              >
                <Settings className="w-4 h-4" /> Profile &amp; Settings
              </button>

              <button
                type="button"
                onClick={() => {
                  setSideMenuOpen(false);
                  setRiskModalOpen(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-amber-600 dark:text-amber-400"
              >
                <AlertTriangle className="w-4 h-4" /> Risk Disclaimer
              </button>

              <button
                type="button"
                onClick={() => {
                  setSideMenuOpen(false);
                  navigate('/');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
              >
                <LayoutDashboard className="w-4 h-4" /> Public Website
              </button>

              <button
                type="button"
                onClick={() => {
                  setSideMenuOpen(false);
                  void logout().then(() => navigate('/'));
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-medium"
              >
                <LogOut className="w-4 h-4" /> Log out
              </button>
            </div>

            <div className="mt-auto pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-2 text-[11px] font-mono text-slate-500">
              <span>{gmtNow} GMT</span>
              <span className="w-2.5 h-2.5 rounded-full bg-teal-500 inline-block" />
            </div>
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setSideMenuOpen(false)} />
        </div>
      )}

      {/* Risk Disclaimer Modal */}
      {riskModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-white dark:bg-[#0f1724] p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-500 font-display font-bold text-base">
                <AlertTriangle className="w-5 h-5" /> Risk Disclaimer
              </div>
              <button type="button" onClick={() => setRiskModalOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              PIPFLOW ({config.branding.websiteUrl || 'https://pipflow.site'}) provides simulated multi-asset market analytics, automated strategy builders, and educational trading accounts. Leverage and automated bots carry substantial risk when applied to real capital. Always validate risk rules using your Demo (DOT) balance before trading.
            </p>
            <button
              type="button"
              onClick={() => setRiskModalOpen(false)}
              className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold"
            >
              I Understand
            </button>
          </div>
        </div>
      )}

      {/* Arrange Navigation Tabs Modal */}
      {arrangeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-5 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base">Arrange navigation tabs</h3>
                <p className="text-xs text-slate-500">Reorder, rename, or hide workspace tabs.</p>
              </div>
              <button type="button" onClick={() => setArrangeOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              {tabs.map((t, i) => (
                <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-800">
                  <input
                    value={t.label}
                    onChange={(e) => {
                      const next = [...tabs];
                      next[i] = { ...next[i], label: e.target.value };
                      setTabs(next);
                    }}
                    className="flex-1 text-xs font-medium bg-transparent focus:outline-none"
                  />
                  <button type="button" onClick={() => moveTab(i, -1)} className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => moveTab(i, 1)} className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...tabs];
                      next[i] = { ...next[i], visible: !next[i].visible };
                      setTabs(next);
                    }}
                    className={`p-1 ${t.visible ? 'text-emerald-500' : 'text-slate-400'}`}
                  >
                    {t.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button type="button" onClick={resetTabs} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                Reset
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setArrangeOpen(false)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                  Cancel
                </button>
                <button type="button" onClick={saveTabs} className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">
                  Save arrangement
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Profit-Only Bot Drawer */}
      <AiProfitBotDrawer
        open={aiBotOpen}
        onClose={() => setAiBotOpen(false)}
        markets={markets}
        marketStates={marketStates}
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setSelectedSymbol}
      />

      {/* Hidden 10-Click Admin Authentication Modal */}
      <AdminAuthModal
        open={adminModalOpen}
        onClose={() => setAdminModalOpen(false)}
        onSuccess={() => {
          setAdminModalOpen(false);
          navigate('/admin');
        }}
      />
    </div>
  );
}
