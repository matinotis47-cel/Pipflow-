import React, { useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Bot,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Crosshair,
  Globe,
  HelpCircle,
  LineChart,
  Mail,
  MapPin,
  Menu,
  Moon,
  Phone,
  Search,
  Shield,
  Sun,
  Trophy,
  X,
} from 'lucide-react';
import { PipflowLogo } from '../components/PipflowLogo';
import { usePlatform } from '../context/PlatformContext';
import { useAuth } from '../context/AuthContext';
import type { MarketAsset, MarketCategory } from '../types/pipflow';
import type { MarketTickState } from '../services/marketEngine';

export type PublicRoute =
  | '/'
  | '/markets'
  | '/markets/forex'
  | '/markets/stocks'
  | '/markets/commodities'
  | '/markets/crypto'
  | '/markets/synthetics'
  | '/platforms'
  | '/education'
  | '/about'
  | '/contact'
  | '/help'
  | '/faqs'
  | '/terms'
  | '/privacy';

interface PublicPagesProps {
  route: PublicRoute;
  navigate: (to: string) => void;
  markets: MarketAsset[];
  marketStates: Record<string, MarketTickState>;
}

export function PublicPages({ route, navigate, markets, marketStates }: PublicPagesProps) {
  const { config, theme, toggleTheme } = usePlatform();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: { label: string; to: PublicRoute }[] = [
    { label: config.website.navLabels.markets || 'Markets', to: '/markets' },
    { label: config.website.navLabels.platforms || 'Platforms', to: '/platforms' },
    { label: config.website.navLabels.education || 'Education', to: '/education' },
    { label: config.website.navLabels.about || 'About', to: '/about' },
    { label: config.website.navLabels.support || 'Support', to: '/help' },
  ];

  const handleNav = (to: string) => {
    setMobileMenuOpen(false);
    navigate(to);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#080d17] text-slate-900 dark:text-slate-100">
      {/* Announcement Strip */}
      {config.branding.announcementEnabled && config.branding.announcementText && (
        <div className="bg-slate-900 dark:bg-sky-950/70 text-slate-100 text-xs py-2 px-4 text-center border-b border-slate-800">
          <span className="font-medium tracking-wide">{config.branding.announcementText}</span>
        </div>
      )}

      {/* Clean 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-[#0b1220]/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <PipflowLogo variant="main" onClick={() => handleNav('/')} />

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            {navItems.map((item) => {
              const active = route === item.to || (item.to === '/markets' && route.startsWith('/markets'));
              return (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => handleNav(item.to)}
                  className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                    active
                      ? 'border-sky-500 text-slate-900 dark:text-white font-semibold'
                      : 'border-transparent hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => handleNav(user ? '/dashboard' : '/login')}
              className="px-4 py-2 text-xs sm:text-sm font-semibold text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              style={{ backgroundColor: 'var(--pf-button, #1b8fe6)' }}
            >
              {user ? 'Open Workspace' : 'Sign In'}
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Toggle Menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220] px-4 py-3 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.to}
                type="button"
                onClick={() => handleNav(item.to)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {item.label}
              </button>
            ))}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between px-3 py-2">
              <span className="text-xs text-slate-500">Theme</span>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700"
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                {theme === 'dark' ? 'Light' : 'Dark'}
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {route === '/' && <HomePage navigate={handleNav} markets={markets} marketStates={marketStates} />}
        {route.startsWith('/markets') && (
          <MarketsPage route={route} navigate={handleNav} markets={markets} marketStates={marketStates} />
        )}
        {route === '/platforms' && <PlatformsPage navigate={handleNav} />}
        {route === '/education' && <EducationPage navigate={handleNav} />}
        {route === '/about' && <AboutPage navigate={handleNav} />}
        {route === '/contact' && <ContactPage />}
        {route === '/help' && <HelpPage navigate={handleNav} />}
        {route === '/faqs' && <FaqsPage />}
        {route === '/terms' && <LegalPage type="terms" />}
        {route === '/privacy' && <LegalPage type="privacy" />}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0b1220]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-slate-200 dark:border-slate-800">
            <div className="space-y-3">
              <PipflowLogo variant="footer" onClick={() => handleNav('/')} />
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {config.branding.description}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {config.branding.supportEmail} · {config.branding.supportPhone}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-white mb-3">
                Markets
              </h4>
              <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                <li><button type="button" onClick={() => handleNav('/markets/synthetics')} className="hover:text-sky-500">Synthetic Indices</button></li>
                <li><button type="button" onClick={() => handleNav('/markets/forex')} className="hover:text-sky-500">Forex</button></li>
                <li><button type="button" onClick={() => handleNav('/markets/stocks')} className="hover:text-sky-500">Stocks & Indices</button></li>
                <li><button type="button" onClick={() => handleNav('/markets/commodities')} className="hover:text-sky-500">Commodities</button></li>
                <li><button type="button" onClick={() => handleNav('/markets/crypto')} className="hover:text-sky-500">Cryptocurrencies</button></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-white mb-3">
                Platform & Learning
              </h4>
              <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                <li><button type="button" onClick={() => handleNav('/platforms')} className="hover:text-sky-500">Trading Platforms</button></li>
                <li><button type="button" onClick={() => handleNav('/education')} className="hover:text-sky-500">Education Academy</button></li>
                <li><button type="button" onClick={() => handleNav('/register')} className="hover:text-sky-500">Create Demo Account</button></li>
                <li><button type="button" onClick={() => handleNav('/login')} className="hover:text-sky-500">Trader Login</button></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900 dark:text-white mb-3">
                Company & Support
              </h4>
              <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                <li><button type="button" onClick={() => handleNav('/about')} className="hover:text-sky-500">About PIPFLOW</button></li>
                <li><button type="button" onClick={() => handleNav('/contact')} className="hover:text-sky-500">Contact Us</button></li>
                <li><button type="button" onClick={() => handleNav('/help')} className="hover:text-sky-500">Help Centre</button></li>
                <li><button type="button" onClick={() => handleNav('/faqs')} className="hover:text-sky-500">FAQs</button></li>
                <li><button type="button" onClick={() => handleNav('/terms')} className="hover:text-sky-500">Terms & Conditions</button></li>
                <li><button type="button" onClick={() => handleNav('/privacy')} className="hover:text-sky-500">Privacy Policy</button></li>
              </ul>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
            <p>{config.branding.footerText}</p>
            <div className="flex items-center gap-4">
              {config.features.darkModeEnabled && (
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white"
                >
                  {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                  {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
                </button>
              )}
              <span>{config.branding.websiteUrl}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function HomePage({
  navigate,
  markets,
  marketStates,
}: {
  navigate: (to: string) => void;
  markets: MarketAsset[];
  marketStates: Record<string, MarketTickState>;
}) {
  const { config, theme } = usePlatform();
  const { user } = useAuth();
  const featured = markets.filter((m) => m.enabled).slice(0, 6);
  const domainLabel = config.branding.websiteUrl?.replace(/^https?:\/\//, '') || 'pipflow.site';
  const pillarIcons = [BarChart3, Crosshair, Trophy];
  const pillars = config.website.pillars?.length
    ? config.website.pillars
    : [
        { title: 'Proven Trading Rules', subtitle: 'Disciplined risk sizing & profit-guard exits' },
        { title: 'Smart Strategies', subtitle: 'Automated bot builder & tick scanners' },
        { title: 'Consistent Results', subtitle: 'Transparent ROT & DOT account analytics' },
      ];

  return (
    <div>
      {/* Hero Section matching official pipflow.site emblem & dark-grid terminal aesthetic */}
      <section
        className="relative border-b border-slate-200 dark:border-slate-800/80"
        style={
          theme === 'dark'
            ? {
                backgroundColor: '#060a14',
                backgroundImage:
                  'linear-gradient(to right, rgba(34, 197, 94, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(34, 197, 94, 0.06) 1px, transparent 1px)',
                backgroundSize: '36px 36px',
              }
            : undefined
        }
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
            <div className="text-xs font-mono font-semibold tracking-[0.2em] uppercase text-emerald-600 dark:text-emerald-400">
              {config.website.heroEyebrow || `${domainLabel} · ANALYTICS • BOTS • SIGNALS`}
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.08] text-balance">
              {config.website.heroTitle}
            </h1>
            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
              {config.website.heroDescription}
            </p>

            {/* 3 Core Trading Rule Pillars from Official PIPFLOW Emblem */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              {pillars.slice(0, 3).map((pillar, idx) => {
                const Icon = pillarIcons[idx % pillarIcons.length];
                return (
                  <div
                    key={pillar.title}
                    className="rounded-xl border border-slate-200 dark:border-emerald-500/20 bg-white/80 dark:bg-[#0b1120]/90 p-3.5 space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <span className="font-display font-bold text-xs text-slate-900 dark:text-white">
                        {pillar.title}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                      {pillar.subtitle}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3.5 pt-2">
              <button
                type="button"
                onClick={() => navigate(user ? '/dashboard' : '/register')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-bold text-white transition-transform active:scale-[0.99] shadow-lg shadow-emerald-600/20 whitespace-nowrap"
                style={{ backgroundColor: 'var(--pf-button, #16a34a)' }}
              >
                {user
                  ? config.website.heroPrimaryCta || 'Launch Trading Workspace'
                  : config.website.bannerCtaText || `Start with $${config.dashboard.defaultDemoBalance.toLocaleString()} Demo`}
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/markets')}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors whitespace-nowrap"
              >
                {config.website.heroSecondaryCta || 'Explore Live Markets'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-6 pt-5 border-t border-slate-200 dark:border-slate-800 max-w-xl">
              <div>
                <div className="font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                  {markets.filter((m) => m.enabled).length}+
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Simulated Instruments</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">ROT / DOT</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Real & Demo Accounts</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">AI Bot</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Profit-Only Exit Guard</div>
              </div>
            </div>
          </div>

          {/* Right Branded Showcase + Live Simulated Telemetry Panel */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-emerald-500/25 bg-white dark:bg-[#0b1120]/95 p-5 flex flex-col justify-between gap-4 shadow-xl">
            {/* Official Bull Emblem + Sparkline Header */}
            <div className="space-y-4">
              <div className="flex items-center gap-3.5 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="w-16 h-16 rounded-full border-2 border-emerald-500/60 bg-[#050b12] overflow-hidden shrink-0 shadow-md">
                  <img
                    src={config.branding.mainLogoUrl}
                    alt={`${config.branding.appName} Official Emblem`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display font-extrabold text-lg text-slate-900 dark:text-white truncate">
                    {domainLabel}
                  </div>
                  <div className="text-[10px] font-mono tracking-[0.2em] text-emerald-600 dark:text-emerald-400 uppercase truncate">
                    {config.website.heroBadgeText || 'ANALYZE, TRADE, GROW'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {config.website.bannerCtaText || 'Trade Smart. Trade with Rules.'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/markets')}
                  className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline shrink-0"
                >
                  View All
                </button>
              </div>

              {/* Signature Dark-Grid Upward Curve Strip */}
              <div
                className="h-20 rounded-xl border border-slate-200 dark:border-slate-800 bg-[#070b14] overflow-hidden relative flex items-center"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, rgba(51, 65, 85, 0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(51, 65, 85, 0.25) 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                }}
              >
                <svg viewBox="0 0 360 80" className="w-full h-full" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="heroRedCurveGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(239, 68, 68, 0.28)" />
                      <stop offset="100%" stopColor="rgba(239, 68, 68, 0)" />
                    </linearGradient>
                  </defs>
                  <path d="M0 64 Q 90 54, 180 42 T 360 16 L 360 80 L 0 80 Z" fill="url(#heroRedCurveGlow)" />
                  <path d="M0 64 Q 90 54, 180 42 T 360 16" stroke="#ef4444" strokeWidth="2.2" fill="none" />
                </svg>
                <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>Live Simulated Feed</span>
                  <span className="text-emerald-400">Multi-Asset Telemetry</span>
                </div>
              </div>

              {/* Live Market Rows */}
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {featured.map((asset) => {
                  const st = marketStates[asset.symbol];
                  const price = st ? st.price.toFixed(asset.pipDecimals) : asset.basePrice.toFixed(asset.pipDecimals);
                  const chg = st ? st.changePct : 0;
                  return (
                    <div key={asset.symbol} className="py-2.5 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{asset.name}</div>
                        <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                          {asset.symbol} · {asset.category}
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{price}</div>
                        <div className={`text-xs ${chg >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {chg >= 0 ? '+' : ''}
                          {chg.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-emerald-500" />
                {domainLabel}
              </span>
              <button
                type="button"
                onClick={() => navigate(user ? '/dashboard' : '/register')}
                className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                {user ? 'Open Terminal →' : 'Create Free Account →'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Promo Banner (Configurable by Admin) */}
      {config.website.promoBannerEnabled && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-white">
                  {config.website.promoBannerTitle}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                  {config.website.promoBannerSubtitle}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate(user ? '/dashboard' : '/register')}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 whitespace-nowrap shrink-0"
            >
              Open Bot Studio
            </button>
          </div>
        </section>
      )}

      {/* Core Capabilities */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-2xl mb-10">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            {config.website.capabilitiesTitle || 'Built for Disciplined Multi-Asset Simulation'}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
            {config.website.capabilitiesSubtitle ||
              'Every workspace module runs against persistent Real-labeled (ROT) and Demo-labeled (DOT) accounts with transparent analytics.'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              icon: LineChart,
              title: '01. Candlestick & Tick Charts',
              desc: 'Multi-timeframe canvas charting with SMA/EMA overlays, support/resistance drawing tools, and Accumulator barrier boxes.',
            },
            {
              icon: Bot,
              title: '02. Visual Bot Builder & AI',
              desc: 'Assemble Rise/Fall, Over/Under, or Even/Odd bots visually or let PIPFLOW AI tune Profit-Only exit thresholds.',
            },
            {
              icon: BarChart3,
              title: '03. Digit & Bulk Analytics',
              desc: 'Live 1000-tick digit distribution gauges, parity percentages, entry scanners, and instant bulk execution.',
            },
            {
              icon: Shield,
              title: '04. Full Risk & Reports Ledger',
              desc: 'Martingale sizing calculator, real-time P&L statements, and audited transaction history across ROT and DOT accounts.',
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-6 space-y-3"
            >
              <card.icon className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              <h3 className="font-display font-bold text-base text-slate-900 dark:text-white">{card.title}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{card.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MarketsPage({
  route,
  navigate,
  markets,
  marketStates,
}: {
  route: PublicRoute;
  navigate: (to: string) => void;
  markets: MarketAsset[];
  marketStates: Record<string, MarketTickState>;
}) {
  const [search, setSearch] = useState('');
  const categoryFromRoute: MarketCategory | 'all' =
    route === '/markets/forex'
      ? 'forex'
      : route === '/markets/stocks'
        ? 'stocks'
        : route === '/markets/commodities'
          ? 'commodities'
          : route === '/markets/crypto'
            ? 'crypto'
            : route === '/markets/synthetics'
              ? 'synthetics'
              : 'all';

  const filtered = markets.filter((m) => {
    if (!m.enabled) return false;
    if (categoryFromRoute !== 'all' && m.category !== categoryFromRoute) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return m.name.toLowerCase().includes(q) || m.symbol.toLowerCase().includes(q);
    }
    return true;
  });

  const tabs: { label: string; to: PublicRoute; cat: MarketCategory | 'all' }[] = [
    { label: 'All Markets', to: '/markets', cat: 'all' },
    { label: 'Synthetics', to: '/markets/synthetics', cat: 'synthetics' },
    { label: 'Forex', to: '/markets/forex', cat: 'forex' },
    { label: 'Stocks & Indices', to: '/markets/stocks', cat: 'stocks' },
    { label: 'Commodities', to: '/markets/commodities', cat: 'commodities' },
    { label: 'Cryptocurrencies', to: '/markets/crypto', cat: 'crypto' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white">PIPFLOW Markets</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Explore real-time simulated quotes, spreads, and payout specifications across five asset classes.
          </p>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol or market..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0f1724]"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {tabs.map((t) => (
          <button
            key={t.to}
            type="button"
            onClick={() => navigate(t.to)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              categoryFromRoute === t.cat
                ? 'bg-sky-600 text-white'
                : 'bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs uppercase text-slate-500">
            <tr>
              <th className="py-3 px-4">Instrument</th>
              <th className="py-3 px-4">Category</th>
              <th className="py-3 px-4 text-right">Simulated Price</th>
              <th className="py-3 px-4 text-right">24h Move</th>
              <th className="py-3 px-4 text-right">Payout</th>
              <th className="py-3 px-4 text-right">Spread</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {filtered.map((m) => {
              const st = marketStates[m.symbol];
              const price = st ? st.price.toFixed(m.pipDecimals) : m.basePrice.toFixed(m.pipDecimals);
              const chg = st ? st.changePct : 0;
              return (
                <tr key={m.symbol} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900 dark:text-white">{m.name}</div>
                    <div className="text-xs font-mono text-slate-500">{m.symbol}</div>
                  </td>
                  <td className="py-3 px-4 capitalize text-xs text-slate-600 dark:text-slate-400">{m.category}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">{price}</td>
                  <td
                    className={`py-3 px-4 text-right font-mono tabular-nums ${
                      chg >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {chg >= 0 ? '+' : ''}
                    {chg.toFixed(2)}%
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">{(m.payoutRate * 100).toFixed(0)}%</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500">{m.spread}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => navigate('/dashboard')}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700"
                    >
                      Trade
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlatformsPage({ navigate }: { navigate: (to: string) => void }) {
  const platforms = [
    {
      name: 'PIPFLOW Terminal & Charts',
      desc: 'Full candlestick and area charting workspace with multi-timeframe switching, SMA/EMA indicators, and interactive trendline tools.',
      bullets: ['1T to 24h timeframes', 'Crosshair & price-level drawing', 'Watchlist & quick order execution'],
    },
    {
      name: 'PIPFLOW Bot Builder & Trading Bots',
      desc: 'Assemble visual block-based strategies or launch pre-configured Momentum, Recovery, and Over/Under bots.',
      bullets: ['1-click Free & Premium Bot library', 'Martingale & Stop-Loss variable blocks', 'FAST / SLOW execution toggle'],
    },
    {
      name: 'PIPFLOW AI Profit-Only Bot',
      desc: 'Gemini-assisted strategy calibration paired with a strict Profit-Only Exit Guard that holds open trades until unrealized P&L turns green.',
      bullets: ['AI-tuned stake & target profit %', 'Live 10-digit telemetry stream', 'Zero loss-closing under Profit Guard'],
    },
    {
      name: 'PTrader & Bulk Trader',
      desc: 'Streamlined options and accumulator contracts alongside 1000-tick digit parity analysis and instant bulk execution.',
      bullets: ['Accumulators with live barrier box', 'Even/Odd & Over/Under digit gauges', 'Synced ROT & DOT account balances'],
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-10">
      <div className="max-w-2xl">
        <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white">PIPFLOW Trading Platforms</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
          Every platform inside PIPFLOW connects to a unified account engine supporting Real-labeled (ROT) and Demo-labeled (DOT) simulation accounts.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {platforms.map((p) => (
          <div key={p.name} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-6 space-y-4">
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">{p.name}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{p.desc}</p>
            <ul className="space-y-2 pt-2">
              {p.bullets.map((b) => (
                <li key={b} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline pt-2"
            >
              Launch in Workspace <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EducationPage({ navigate }: { navigate: (to: string) => void }) {
  const modules = [
    {
      level: 'Beginner',
      title: 'Reading Candlestick Structure & Volatility',
      summary: 'Learn how open, high, low, and close wicks reveal buyer/seller exhaustion across synthetic and forex pairs.',
    },
    {
      level: 'Intermediate',
      title: 'Position Sizing & Martingale Risk Limits',
      summary: 'Use the PIPFLOW Martingale Calculator to cap drawdown across consecutive losses and protect account equity.',
    },
    {
      level: 'Quantitative',
      title: 'Digit Distribution & Mean Reversion',
      summary: 'Analyze 1000-tick frequency windows in the Analysis Tool to detect statistical deviations in last-digit occurrences.',
    },
    {
      level: 'Automation',
      title: 'Designing Profit-Guarded Bot Rules',
      summary: 'Configure entry triggers, trailing profit targets, and maximum concurrent exposure inside Bot Builder.',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="max-w-2xl">
        <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400 mb-2">
          <BookOpen className="w-4 h-4" /> PIPFLOW Academy
        </div>
        <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white">Trading Education</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
          Practical courses designed to pair directly with your DOT demo practice account.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {modules.map((m) => (
          <div key={m.title} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-6 space-y-3">
            <div className="text-xs font-semibold text-sky-600 dark:text-sky-400">{m.level} Module</div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">{m.title}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{m.summary}</p>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="text-xs font-semibold text-slate-900 dark:text-white hover:text-sky-500 inline-flex items-center gap-1"
            >
              Practice in Terminal <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AboutPage({ navigate }: { navigate: (to: string) => void }) {
  const { config } = usePlatform();
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-6">
      <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white">About {config.branding.appName}</h1>
      <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed">{config.website.aboutSummary}</p>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="flex items-start gap-3">
          <Globe className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-white">Domain</div>
            <div className="text-xs text-slate-500 mt-0.5">{config.branding.websiteUrl}</div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Mail className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-white">Support</div>
            <div className="text-xs text-slate-500 mt-0.5">{config.branding.supportEmail}</div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <MapPin className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-white">Headquarters</div>
            <div className="text-xs text-slate-500 mt-0.5">{config.branding.address}</div>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate('/contact')}
        className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700"
      >
        Contact PIPFLOW Team
      </button>
    </div>
  );
}

function ContactPage() {
  const { config } = usePlatform();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setErrorMsg('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus('error');
        setErrorMsg(data.error || 'Submission failed.');
        return;
      }
      setStatus('sent');
      setName('');
      setEmail('');
      setSubject('');
      setMessage('');
    } catch {
      setStatus('error');
      setErrorMsg('Network error submitting inquiry.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 md:grid-cols-12 gap-8">
      <div className="md:col-span-5 space-y-4">
        <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white">Contact PIPFLOW</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Have a question about simulated accounts, bot builder logic, or platform settings? Send our support desk a message.
        </p>
        <div className="space-y-3 pt-2 text-sm text-slate-700 dark:text-slate-300">
          <div className="flex items-center gap-2.5"><Mail className="w-4 h-4 text-sky-500" /> {config.branding.supportEmail}</div>
          <div className="flex items-center gap-2.5"><Phone className="w-4 h-4 text-sky-500" /> {config.branding.supportPhone}</div>
          <div className="flex items-center gap-2.5"><MapPin className="w-4 h-4 text-sky-500" /> {config.branding.address}</div>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="md:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-6 space-y-4"
      >
        {status === 'sent' && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            Your message has been logged with PIPFLOW Support.
          </div>
        )}
        {status === 'error' && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs font-medium text-rose-700 dark:text-rose-300">
            {errorMsg}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <input
            required
            placeholder="Your Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
          />
          <input
            required
            type="email"
            placeholder="Email Address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
          />
        </div>
        <input
          required
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
        />
        <textarea
          required
          rows={4}
          placeholder="How can we help?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending...' : 'Send Message'}
        </button>
      </form>
    </div>
  );
}

function HelpPage({ navigate }: { navigate: (to: string) => void }) {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white">PIPFLOW Help Centre</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Guides for account setup, ROT/DOT accounts, and automated bots.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/faqs')}
          className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Browse FAQs
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { title: 'Real (ROT) & Demo (DOT) Accounts', text: 'Switch between your green R (ROT) account and D (DOT) practice account anytime from the workspace header.' },
          { title: 'AI Profit-Only Bot Guard', text: 'Learn how the Profit-Only Exit engine holds simulated trades until live unrealized P&L exceeds your target threshold.' },
          { title: 'Reports & Statement Exports', text: 'Audit every manual, bulk, and bot-settled contract inside Reports -> Trades & Statement.' },
        ].map((item) => (
          <div key={item.title} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-5 space-y-2">
            <HelpCircle className="w-5 h-5 text-sky-500" />
            <h2 className="font-display font-bold text-sm">{item.title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FaqsPage() {
  const { config } = usePlatform();
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const faqs = config.website.faqs?.length
    ? config.website.faqs
    : [
        {
          q: 'What is the difference between ROT and DOT accounts on PIPFLOW?',
          a: 'Every user is provisioned a Real-labeled training account (prefixed ROT) with a green R balance badge, and a Demo-labeled training account (prefixed DOT) with a D balance badge. Both operate inside PIPFLOW’s educational simulation environment with independent persisted balances.',
        },
        {
          q: 'How does the PIPFLOW AI Profit-Only Bot work?',
          a: 'When enabled, the AI Profit-Only Bot opens simulated trades based on short-term tick momentum and Gemini strategy parameters, and enforces a Profit-Only Exit Guard that keeps positions open until unrealized P&L crosses into positive profit.',
        },
      ];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 space-y-6">
      <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white">Frequently Asked Questions</h1>
      <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724]">
        {faqs.map((f, i) => (
          <div key={`${f.q}-${i}`} className="p-5">
            <button
              type="button"
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              className="w-full flex items-center justify-between text-left gap-4"
            >
              <span className="font-semibold text-sm text-slate-900 dark:text-white">{f.q}</span>
              <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${openIdx === i ? 'rotate-180' : ''}`} />
            </button>
            {openIdx === i && <p className="text-xs text-slate-600 dark:text-slate-400 mt-3 leading-relaxed">{f.a}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function LegalPage({ type }: { type: 'terms' | 'privacy' }) {
  const { config } = usePlatform();
  const body = type === 'terms' ? config.website.termsText : config.website.privacyText;
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 space-y-4">
      <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white">
        {type === 'terms' ? 'Terms & Conditions' : 'Privacy Policy'}
      </h1>
      <p className="text-xs text-slate-500">Effective Date: November 2026 · {config.branding.appName} ({config.branding.websiteUrl})</p>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1724] p-6 space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
        {body ||
          (type === 'terms'
            ? 'PIPFLOW provides educational financial charting, automated bot simulation, and demo market analytics exclusively for training purposes.'
            : `For data inquiries, contact ${config.branding.supportEmail}.`)}
      </div>
    </div>
  );
}
