import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlatformProvider, usePlatform } from './context/PlatformContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PublicPages, type PublicRoute } from './pages/PublicPages';
import { AuthPages, type AuthRoute } from './pages/AuthPages';
import { DashboardPage } from './pages/DashboardPage';
import { AdminPage } from './pages/AdminPage';
import {
  advanceMarketTick,
  applyLivePriceTick,
  buildInitialMarketState,
  type MarketTickState,
} from './services/marketEngine';

const PUBLIC_ROUTES: PublicRoute[] = [
  '/',
  '/markets',
  '/markets/forex',
  '/markets/stocks',
  '/markets/commodities',
  '/markets/crypto',
  '/markets/synthetics',
  '/platforms',
  '/education',
  '/about',
  '/contact',
  '/help',
  '/faqs',
  '/terms',
  '/privacy',
];

const AUTH_ROUTES: AuthRoute[] = [
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
];

function AppRouter() {
  const { config, onMarketTick } = usePlatform();
  const { user, loading } = useAuth();
  const [route, setRoute] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname || '/';
    }
    return '/';
  });

  const navigate = useCallback((to: string) => {
    const clean = to.startsWith('/') ? to : `/${to}`;
    if (typeof window !== 'undefined' && window.location.pathname !== clean) {
      window.history.pushState({}, '', clean);
    }
    setRoute(clean);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(window.location.pathname || '/');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const enabledMarkets = useMemo(
    () => config.markets.filter((m) => m.enabled),
    [config.markets]
  );

  const [marketStates, setMarketStates] = useState<Record<string, MarketTickState>>(() => {
    const initial: Record<string, MarketTickState> = {};
    for (const m of config.markets) {
      initial[m.symbol] = buildInitialMarketState(m);
    }
    return initial;
  });

  const lastLiveTickAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    setMarketStates((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const m of config.markets) {
        if (!next[m.symbol]) {
          next[m.symbol] = buildInitialMarketState(m);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [config.markets]);

  useEffect(() => {
    const unsub = onMarketTick((tick) => {
      const asset = config.markets.find((m) => m.symbol === tick.symbol);
      if (!asset) return;
      lastLiveTickAtRef.current[tick.symbol] = Date.now();
      setMarketStates((prev) => {
        const current = prev[tick.symbol] || buildInitialMarketState(asset);
        return {
          ...prev,
          [tick.symbol]: applyLivePriceTick(current, asset, tick.price, tick.time),
        };
      });
    });
    return unsub;
  }, [config.markets, onMarketTick]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setMarketStates((prev) => {
        const next: Record<string, MarketTickState> = {};
        for (const m of config.markets) {
          const current = prev[m.symbol] || buildInitialMarketState(m);
          const lastLive = lastLiveTickAtRef.current[m.symbol] || 0;
          next[m.symbol] = now - lastLive < 3500 ? current : advanceMarketTick(current, m);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [config.markets]);

  const normalized = route.split('?')[0].replace(/\/+$/, '') || '/';

  if (normalized === '/admin') {
    return <AdminPage navigate={navigate} />;
  }

  if (normalized === '/dashboard' || normalized === '/profile' || normalized === '/settings') {
    if (loading) {
      return (
        <div
          className="min-h-screen flex items-center justify-center bg-[#060a14] text-white p-4"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(30, 41, 59, 0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(30, 41, 59, 0.35) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-800/90 bg-[#0b1120]/95 shadow-2xl p-6 sm:p-7 space-y-5">
            <div className="flex items-center gap-3.5 justify-center">
              <div className="w-14 h-14 rounded-full border border-emerald-500/40 bg-[#060a14] overflow-hidden flex items-center justify-center shadow-inner shrink-0">
                <img
                  src={config.branding.mainLogoUrl}
                  alt={config.branding.appName || 'PIPFLOW'}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="text-left">
                <div className="font-display font-bold text-lg text-sky-400 tracking-tight">
                  {config.branding.websiteUrl?.replace(/^https?:\/\//, '') || 'pipflow.site'}
                </div>
                <div className="text-[10px] font-mono tracking-[0.22em] text-slate-400 uppercase">
                  ANALYTICS • BOTS • SIGNALS
                </div>
              </div>
            </div>

            <div className="h-24 rounded-xl border border-slate-800 bg-[#070b14] overflow-hidden relative flex items-center">
              <svg viewBox="0 0 360 80" className="w-full h-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="splashGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(239, 68, 68, 0.28)" />
                    <stop offset="100%" stopColor="rgba(239, 68, 68, 0)" />
                  </linearGradient>
                </defs>
                <path d="M0 64 Q 90 54, 180 42 T 360 18 L 360 80 L 0 80 Z" fill="url(#splashGlow)" />
                <path d="M0 64 Q 90 54, 180 42 T 360 18" stroke="#ef4444" strokeWidth="2" fill="none" />
              </svg>
            </div>

            <div className="space-y-2 text-center">
              <div className="inline-flex items-center gap-2 text-xs text-slate-300">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                <span>Initializing {config.branding.websiteUrl?.replace(/^https?:\/\//, '') || 'pipflow.site'} session...</span>
              </div>
              <div className="text-[11px] font-medium text-emerald-400">Preparing workspace</div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500 animate-pulse" />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 text-center text-[11px] text-slate-500">
              © 2026 {config.branding.websiteUrl?.replace(/^https?:\/\//, '') || 'pipflow.site'}. All rights reserved.
            </div>
          </div>
        </div>
      );
    }
    if (!user) {
      return <AuthPages route="/login" navigate={navigate} />;
    }
    return (
      <DashboardPage
        navigate={navigate}
        markets={enabledMarkets}
        marketStates={marketStates}
        initialTab={normalized === '/profile' || normalized === '/settings' ? 'profile' : 'dashboard'}
      />
    );
  }

  if ((AUTH_ROUTES as string[]).includes(normalized)) {
    return <AuthPages route={normalized as AuthRoute} navigate={navigate} />;
  }

  const publicRoute: PublicRoute = (PUBLIC_ROUTES as string[]).includes(normalized)
    ? (normalized as PublicRoute)
    : '/';

  return (
    <PublicPages
      route={publicRoute}
      navigate={navigate}
      markets={enabledMarkets}
      marketStates={marketStates}
    />
  );
}

export default function App() {
  return (
    <PlatformProvider>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </PlatformProvider>
  );
}
