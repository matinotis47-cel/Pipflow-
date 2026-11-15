import type { PlatformConfig } from '../types/pipflow';

export const OFFICIAL_LOGO_PATH = '/assets/aistudio/IMG-20261115-WA0009_aca2a037.jpg';

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  branding: {
    appName: 'PIPFLOW',
    dashboardName: 'PIPFLOW Terminal',
    tagline: 'ANALYZE, TRADE, GROW — Trade Smart. Trade with Rules.',
    websiteUrl: 'https://pipflow.site',
    description:
      'PIPFLOW (pipflow.site) is a multi-asset trading interface and educational demo trading platform engineered for chart analysis, algorithmic bot simulation, and disciplined risk management.',
    supportEmail: 'support@pipflow.site',
    supportPhone: '+44 20 7946 0821',
    address: 'Level 18, 40 Bank Street, Canary Wharf, London E14 5NR',
    footerText: '© 2026 pipflow.site — Educational multi-asset trading simulator. Simulated balances and AI bot results are for educational training only.',
    announcementText: 'WELCOME TO PIPFLOW.SITE — ANALYZE, TRADE, GROW · TRADE SMART. TRADE WITH RULES.',
    announcementEnabled: true,
    mainLogoUrl: OFFICIAL_LOGO_PATH,
    dashboardLogoUrl: OFFICIAL_LOGO_PATH,
    footerLogoUrl: OFFICIAL_LOGO_PATH,
    faviconUrl: OFFICIAL_LOGO_PATH,
    mobileLogoUrl: OFFICIAL_LOGO_PATH,
    socialLinks: {
      twitter: 'https://x.com/pipflowsite',
      telegram: 'https://t.me/pipflowsite',
      youtube: 'https://youtube.com/@pipflowsite',
      github: 'https://github.com/pipflow-site',
    },
  },
  theme: {
    defaultTheme: 'dark',
    primaryColor: '#22c55e',
    secondaryColor: '#0f172a',
    backgroundColor: '#060a14',
    cardColor: '#0b1120',
    buttonColor: '#16a34a',
    fontFamily: 'Plus Jakarta Sans',
    borderRadius: 'rounded',
    sidebarStyle: 'expanded',
    headerStyle: 'solid',
  },
  dashboard: {
    welcomeMessage: 'The trend is your friend — manage your risk before every execution.',
    defaultDemoBalance: 10000,
    defaultChartTimeframe: '1m',
    defaultWatchlist: ['R_100', 'R_25', 'EUR/USD', 'BTC/USD', 'XAU/USD'],
    defaultCurrency: 'USD',
    defaultLanguage: 'EN',
    defaultTimezone: 'UTC',
    defaultWidgets: ['quick_actions', 'live_chart', 'watchlist', 'ai_bot', 'recent_trades'],
  },
  website: {
    heroEyebrow: 'PIPFLOW.SITE · ANALYTICS • BOTS • SIGNALS',
    heroBadgeText: 'ANALYZE, TRADE, GROW',
    heroTitle: 'Trade Smart. Trade with Rules Across Every Market.',
    heroDescription:
      'Analyze synthetic indices, global forex, equities, commodities, and crypto inside a unified multi-asset workspace featuring live candlestick telemetry, proven trading rules, and an AI profit-guard bot engine.',
    heroPrimaryCta: 'Start Trading Workspace',
    heroSecondaryCta: 'Explore Live Markets',
    bannerCtaText: 'Trade Smart. Trade with Rules.',
    pillars: [
      { title: 'Proven Trading Rules', subtitle: 'Disciplined risk sizing & profit-guard exits' },
      { title: 'Smart Strategies', subtitle: 'Automated bot builder & tick scanners' },
      { title: 'Consistent Results', subtitle: 'Transparent ROT & DOT account analytics' },
    ],
    capabilitiesTitle: 'Built for Disciplined Multi-Asset Simulation',
    capabilitiesSubtitle:
      'Every workspace module runs against persistent Real-labeled (ROT) and Demo-labeled (DOT) accounts with transparent analytics.',
    promoBannerTitle: 'PIPFLOW AI Profit-Only Bot Engine',
    promoBannerSubtitle: 'Automatically monitors tick structure and holds simulated positions until unrealized P&L crosses into profit.',
    promoBannerEnabled: true,
    aboutSummary:
      'Built for aspiring systematic traders and strategy researchers, PIPFLOW combines institutional-grade charting with deterministic and AI-assisted simulation across Real-labeled (ROT) and Demo-labeled (DOT) training accounts.',
    termsText:
      'PIPFLOW provides educational financial charting, automated bot simulation, and demo market analytics exclusively for training purposes. Real-labeled (ROT) and Demo-labeled (DOT) accounts within PIPFLOW represent simulated trading environments and do not constitute regulated brokerage custody, live order execution, or withdrawable cash deposits. Users are responsible for safeguarding account credentials and adhering to acceptable usage limits across automated strategy testing.',
    privacyText:
      'PIPFLOW collects only the profile details required to operate your authenticated workspace (email address, phone number, display name, preferred currency, and simulated trading activity). Passwords are cryptographically salted and hashed on the server and are never stored in browser LocalStorage or returned via API responses. Sessions use secure HTTP-only cookies.',
    faqs: [
      {
        q: 'What is the difference between ROT and DOT accounts on PIPFLOW?',
        a: 'Every user is provisioned a Real-labeled training account (prefixed ROT) with a green R balance badge, and a Demo-labeled training account (prefixed DOT) with a D balance badge. Both operate inside PIPFLOW’s educational simulation environment with independent persisted balances.',
      },
      {
        q: 'How does the PIPFLOW AI Profit-Only Bot work?',
        a: 'When enabled, the AI Profit-Only Bot opens simulated trades based on short-term tick momentum and Gemini strategy parameters, and enforces a Profit-Only Exit Guard that keeps positions open until unrealized P&L crosses into positive profit.',
      },
      {
        q: 'Can I reset my DOT demo balance?',
        a: 'Yes. Open the account switcher dropdown in the dashboard header, switch to the Demo tab, and click Reset balance to restore your DOT account to the platform’s configured starting balance.',
      },
      {
        q: 'Are PIPFLOW balances withdrawable real brokerage funds?',
        a: 'No. PIPFLOW (pipflow.site) is an educational multi-asset trading interface and market simulation platform. All balances, trades, and P&L records are simulated for training and strategy analysis.',
      },
    ],
    navLabels: {
      markets: 'Markets',
      platforms: 'Platforms',
      education: 'Education',
      about: 'About',
      support: 'Support',
    },
  },
  features: {
    darkModeEnabled: true,
    watchlistsEnabled: true,
    notificationsEnabled: true,
    demoTradingEnabled: true,
    marketSearchEnabled: true,
    aiProfitBotEnabled: true,
    copyTradingEnabled: true,
    bulkTraderEnabled: true,
    botBuilderEnabled: true,
    analysisToolEnabled: true,
    riskCalculatorEnabled: true,
    pTraderEnabled: true,
  },
  markets: [
    { symbol: 'R_100_1S', name: 'Volatility 100 (1s) Index', category: 'synthetics', basePrice: 1375.85, volatility: 0.42, payoutRate: 0.95, spread: 0.08, pipDecimals: 2, enabled: true },
    { symbol: 'R_100', name: 'Volatility 100 Index', category: 'synthetics', basePrice: 572.30, volatility: 0.36, payoutRate: 0.95, spread: 0.05, pipDecimals: 2, enabled: true },
    { symbol: 'R_75', name: 'Volatility 75 Index', category: 'synthetics', basePrice: 28450.10, volatility: 4.5, payoutRate: 0.94, spread: 1.2, pipDecimals: 2, enabled: true },
    { symbol: 'R_50', name: 'Volatility 50 Index', category: 'synthetics', basePrice: 194.42, volatility: 0.18, payoutRate: 0.95, spread: 0.03, pipDecimals: 4, enabled: true },
    { symbol: 'R_25', name: 'Volatility 25 Index', category: 'synthetics', basePrice: 2924.53, volatility: 0.65, payoutRate: 0.95, spread: 0.12, pipDecimals: 4, enabled: true },
    { symbol: 'R_10', name: 'Volatility 10 Index', category: 'synthetics', basePrice: 6412.18, volatility: 0.25, payoutRate: 0.95, spread: 0.1, pipDecimals: 3, enabled: true },
    { symbol: 'EUR/USD', name: 'Euro / US Dollar', category: 'forex', basePrice: 1.0842, volatility: 0.0004, payoutRate: 0.90, spread: 0.0001, pipDecimals: 5, enabled: true },
    { symbol: 'GBP/USD', name: 'British Pound / US Dollar', category: 'forex', basePrice: 1.2715, volatility: 0.0005, payoutRate: 0.90, spread: 0.00015, pipDecimals: 5, enabled: true },
    { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen', category: 'forex', basePrice: 153.42, volatility: 0.04, payoutRate: 0.89, spread: 0.02, pipDecimals: 3, enabled: true },
    { symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar', category: 'forex', basePrice: 0.6584, volatility: 0.0004, payoutRate: 0.88, spread: 0.00012, pipDecimals: 5, enabled: true },
    { symbol: 'BTC/USD', name: 'Bitcoin / US Dollar', category: 'crypto', basePrice: 91240.00, volatility: 45.0, payoutRate: 0.92, spread: 18.0, pipDecimals: 2, enabled: true },
    { symbol: 'ETH/USD', name: 'Ethereum / US Dollar', category: 'crypto', basePrice: 3185.40, volatility: 3.2, payoutRate: 0.91, spread: 1.4, pipDecimals: 2, enabled: true },
    { symbol: 'SOL/USD', name: 'Solana / US Dollar', category: 'crypto', basePrice: 214.80, volatility: 0.45, payoutRate: 0.90, spread: 0.15, pipDecimals: 2, enabled: true },
    { symbol: 'US500', name: 'S&P 500 Index', category: 'stocks', basePrice: 5984.50, volatility: 1.8, payoutRate: 0.88, spread: 0.5, pipDecimals: 2, enabled: true },
    { symbol: 'US100', name: 'Nasdaq 100 Tech Index', category: 'stocks', basePrice: 21045.20, volatility: 6.4, payoutRate: 0.89, spread: 1.8, pipDecimals: 2, enabled: true },
    { symbol: 'AAPL', name: 'Apple Inc.', category: 'stocks', basePrice: 228.45, volatility: 0.22, payoutRate: 0.86, spread: 0.06, pipDecimals: 2, enabled: true },
    { symbol: 'XAU/USD', name: 'Gold Spot / US Dollar', category: 'commodities', basePrice: 2684.30, volatility: 0.95, payoutRate: 0.91, spread: 0.35, pipDecimals: 2, enabled: true },
    { symbol: 'XAG/USD', name: 'Silver Spot / US Dollar', category: 'commodities', basePrice: 31.42, volatility: 0.04, payoutRate: 0.89, spread: 0.02, pipDecimals: 3, enabled: true },
    { symbol: 'WTI/USD', name: 'Crude Oil WTI', category: 'commodities', basePrice: 70.65, volatility: 0.08, payoutRate: 0.88, spread: 0.03, pipDecimals: 2, enabled: true },
  ],
  updatedAt: new Date().toISOString(),
};

export const CURRENCY_RATES: Record<'USD' | 'KSH' | 'EUR' | 'GBP', number> = {
  USD: 1,
  KSH: 129.98,
  EUR: 0.92,
  GBP: 0.79,
};

export function formatCurrencyAmount(
  amountUsd: number,
  currency: 'USD' | 'KSH' | 'EUR' | 'GBP' = 'USD',
  compact = false
): string {
  const rate = CURRENCY_RATES[currency] ?? 1;
  const converted = amountUsd * rate;
  const formatted = converted.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (compact) {
    return `${currency} ${formatted}`;
  }
  return currency === 'KSH' ? `KSH ${formatted}` : `${formatted} ${currency}`;
}

export function getInitialsFromEmail(email?: string | null, fullName?: string | null): string {
  if (fullName && fullName.trim().length > 0) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (!email) return 'PF';
  const local = email.split('@')[0] || 'PF';
  const cleaned = local.replace(/[^a-zA-Z0-9]/g, '');
  if (cleaned.length >= 2) {
    return cleaned.slice(0, 2).toUpperCase();
  }
  return (cleaned[0] || 'P').toUpperCase();
}
