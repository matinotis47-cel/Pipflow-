export type AccountType = 'real' | 'demo';

export type MarketCategory = 'synthetics' | 'forex' | 'crypto' | 'stocks' | 'commodities';

export interface MarketAsset {
  symbol: string;
  name: string;
  category: MarketCategory;
  basePrice: number;
  volatility: number;
  payoutRate: number;
  spread: number;
  pipDecimals: number;
  enabled: boolean;
}

export interface BrandingConfig {
  appName: string;
  dashboardName: string;
  tagline: string;
  websiteUrl: string;
  description: string;
  supportEmail: string;
  supportPhone: string;
  address: string;
  footerText: string;
  announcementText: string;
  announcementEnabled: boolean;
  mainLogoUrl: string;
  dashboardLogoUrl: string;
  footerLogoUrl: string;
  faviconUrl: string;
  mobileLogoUrl: string;
  socialLinks: {
    twitter: string;
    telegram: string;
    youtube: string;
    github: string;
  };
}

export interface ThemeConfig {
  defaultTheme: 'light' | 'dark';
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  cardColor: string;
  buttonColor: string;
  fontFamily: 'Plus Jakarta Sans' | 'DM Sans' | 'Outfit' | 'Manrope';
  borderRadius: 'sharp' | 'rounded' | 'soft';
  sidebarStyle: 'compact' | 'expanded';
  headerStyle: 'solid' | 'glass';
}

export interface DashboardConfig {
  welcomeMessage: string;
  defaultDemoBalance: number;
  defaultChartTimeframe: '1T' | '1m' | '5m' | '15m' | '1h' | '4h' | '24h';
  defaultWatchlist: string[];
  defaultCurrency: 'USD' | 'KSH' | 'EUR' | 'GBP';
  defaultLanguage: string;
  defaultTimezone: string;
  defaultWidgets: string[];
}

export interface WebsitePillar {
  title: string;
  subtitle: string;
}

export interface WebsiteFaqItem {
  q: string;
  a: string;
}

export interface WebsiteConfig {
  heroEyebrow: string;
  heroBadgeText: string;
  heroTitle: string;
  heroDescription: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  bannerCtaText: string;
  pillars: WebsitePillar[];
  capabilitiesTitle: string;
  capabilitiesSubtitle: string;
  promoBannerTitle: string;
  promoBannerSubtitle: string;
  promoBannerEnabled: boolean;
  aboutSummary: string;
  termsText: string;
  privacyText: string;
  faqs: WebsiteFaqItem[];
  navLabels: {
    markets: string;
    platforms: string;
    education: string;
    about: string;
    support: string;
  };
}

export interface FeatureFlags {
  darkModeEnabled: boolean;
  watchlistsEnabled: boolean;
  notificationsEnabled: boolean;
  demoTradingEnabled: boolean;
  marketSearchEnabled: boolean;
  aiProfitBotEnabled: boolean;
  copyTradingEnabled: boolean;
  bulkTraderEnabled: boolean;
  botBuilderEnabled: boolean;
  analysisToolEnabled: boolean;
  riskCalculatorEnabled: boolean;
  pTraderEnabled: boolean;
}

export interface PlatformConfig {
  branding: BrandingConfig;
  theme: ThemeConfig;
  dashboard: DashboardConfig;
  website: WebsiteConfig;
  features: FeatureFlags;
  markets: MarketAsset[];
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  country: string;
  phone: string;
  emailVerified: boolean;
  status: 'active' | 'suspended';
  preferredTheme: 'light' | 'dark';
  preferredCurrency: 'USD' | 'KSH' | 'EUR' | 'GBP';
  preferredLanguage: string;
  activeAccountId: string;
  derivConnected?: boolean;
  derivLoginId?: string;
  derivConnectionStatus?: 'connected' | 'disconnected' | 'revoked';
  derivAuthMode?: 'oauth' | 'pat' | 'token';
  derivAuthorizedScopes?: string;
  derivConnectedAt?: string;
  derivRevokedAt?: string;
  pushEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailLogRecord {
  id: string;
  recipientEmail: string;
  emailType: string;
  subject: string;
  status: 'sent' | 'failed' | 'skipped';
  providerMessageId?: string;
  errorReason?: string;
  createdAt: string;
}

export interface TradingAccount {
  accountId: string; // ROT... / CR... for real, DOT... / VRTC... for demo
  userId: string;
  accountType: AccountType;
  currency: 'USD' | 'KSH' | 'EUR' | 'GBP';
  balance: number;
  startingBalance: number;
  status: 'active' | 'frozen';
  externalAccountId?: string;
  isLiveSynced?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MT5OrderType = 'MARKET' | 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP';

export interface TradeRecord {
  id: string;
  userId: string;
  accountId: string;
  accountType: AccountType;
  symbol: string;
  tradeType: string;
  direction: 'BUY' | 'SELL' | 'RISE' | 'FALL' | 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'ACCU';
  orderType?: MT5OrderType;
  lotSize?: number;
  stake: number;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  exitPrice?: number;
  payout: number;
  profitLoss: number;
  commission?: number;
  swap?: number;
  closeReason?: 'manual' | 'sl' | 'tp' | 'expired';
  status: 'open' | 'pending' | 'closed';
  source: 'manual' | 'bot' | 'ai_profit_bot' | 'bulk' | 'copy' | 'analysis_auto';
  externalContractId?: string;
  commissionEstimate?: number;
  liveExecution?: boolean;
  note?: string;
  openedAt: string;
  closedAt?: string;
}

export interface TransactionRecord {
  id: string;
  userId: string;
  accountId: string;
  accountType: AccountType;
  type: 'credit' | 'debit' | 'reset' | 'trade_win' | 'trade_loss' | 'pnl_adjustment' | 'transfer' | 'deposit' | 'withdrawal';
  amount: number;
  balanceAfter: number;
  reason: string;
  adminActor?: string;
  createdAt: string;
}

export interface PnlAdjustmentRecord {
  id: string;
  tradeId: string;
  userId: string;
  accountId: string;
  originalPnl: number;
  adjustmentDelta: number;
  newPnl: number;
  reason: string;
  adminActor: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  userId: string | 'all';
  title: string;
  message: string;
  category: 'system' | 'trade' | 'account' | 'announcement';
  read: boolean;
  createdAt: string;
}

export interface WatchlistItem {
  symbol: string;
  addedAt: string;
}

export interface AdminAuditLog {
  id: string;
  action: string;
  actor: string;
  targetType:
    | 'auth'
    | 'user'
    | 'account'
    | 'balance'
    | 'pnl'
    | 'branding'
    | 'logo'
    | 'settings'
    | 'features'
    | 'markets'
    | 'notification'
    | 'push'
    | 'email'
    | 'broker';
  targetId?: string;
  details: string;
  ip?: string;
  status: 'success' | 'failure';
  createdAt: string;
}

export interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
}
