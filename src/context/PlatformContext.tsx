import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { DEFAULT_PLATFORM_CONFIG } from '../config/app.config';
import type { PlatformConfig, TradingAccount, AppNotification } from '../types/pipflow';

export interface LiveMarketTickEvent {
  symbol: string;
  derivSymbol?: string;
  price: number;
  quote?: number;
  time: number;
}

interface PlatformContextValue {
  config: PlatformConfig;
  theme: 'light' | 'dark';
  setTheme: (next: 'light' | 'dark') => void;
  toggleTheme: () => void;
  refreshConfig: () => Promise<void>;
  setConfigLocal: (next: PlatformConfig) => void;
  onAccountEvent: (cb: (account: TradingAccount) => void) => () => void;
  onNotificationEvent: (cb: (notif: AppNotification) => void) => () => void;
  onMarketTick: (cb: (tick: LiveMarketTickEvent) => void) => () => void;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PlatformConfig>(DEFAULT_PLATFORM_CONFIG);
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('pf_theme_pref');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return DEFAULT_PLATFORM_CONFIG.theme.defaultTheme;
  });

  const [accountListeners] = useState(() => new Set<(acc: TradingAccount) => void>());
  const [notifListeners] = useState(() => new Set<(n: AppNotification) => void>());
  const [marketTickListeners] = useState(() => new Set<(tick: LiveMarketTickEvent) => void>());

  const applyConfigToDocument = useCallback((cfg: PlatformConfig, activeTheme: 'light' | 'dark') => {
    const root = document.documentElement;
    if (activeTheme === 'dark' && cfg.features.darkModeEnabled) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    root.style.setProperty('--pf-primary', cfg.theme.primaryColor || '#22c55e');
    root.style.setProperty('--pf-secondary', cfg.theme.secondaryColor || '#0f172a');
    root.style.setProperty('--pf-button', cfg.theme.buttonColor || '#16a34a');
    const radiusMap = { sharp: '4px', rounded: '10px', soft: '16px' };
    root.style.setProperty('--pf-radius', radiusMap[cfg.theme.borderRadius] || '10px');

    if (cfg.theme.fontFamily) {
      const fontStack = `'${cfg.theme.fontFamily}', system-ui, sans-serif`;
      root.style.setProperty('--pf-font-display', fontStack);
      root.style.setProperty('--pf-font-body', fontStack);
    }

    if (activeTheme === 'light') {
      root.style.setProperty('--pf-bg', '#f8fafc');
      root.style.setProperty('--pf-card', '#ffffff');
    } else {
      root.style.setProperty('--pf-bg', cfg.theme.backgroundColor || '#060a14');
      root.style.setProperty('--pf-card', cfg.theme.cardColor || '#0b1120');
    }

    if (cfg.branding.appName) {
      document.title = `${cfg.branding.appName} — Multi-Asset Trading Platform & Market Workspace`;
    }
    if (cfg.branding.faviconUrl) {
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (link && link.href !== cfg.branding.faviconUrl) {
        link.href = cfg.branding.faviconUrl;
      }
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setConfig(data.config);
        }
      }
    } catch {
      // keep existing config
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  useEffect(() => {
    applyConfigToDocument(config, theme);
  }, [config, theme, applyConfigToDocument]);

  useEffect(() => {
    const es = new EventSource('/api/events/stream');
    es.addEventListener('config:updated', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data);
        if (parsed.config) {
          setConfig(parsed.config);
        }
      } catch {
        // ignore parse error
      }
    });
    es.addEventListener('account:updated', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data);
        if (parsed.account) {
          accountListeners.forEach((cb) => cb(parsed.account));
        }
      } catch {
        // ignore
      }
    });
    es.addEventListener('notification:created', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data);
        if (parsed.notification) {
          notifListeners.forEach((cb) => cb(parsed.notification));
        }
      } catch {
        // ignore
      }
    });
    es.addEventListener('market:tick', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data);
        if (parsed?.symbol && typeof parsed?.price === 'number') {
          marketTickListeners.forEach((cb) => cb(parsed));
        }
      } catch {
        // ignore
      }
    });
    return () => {
      es.close();
    };
  }, [accountListeners, notifListeners, marketTickListeners]);

  const setTheme = useCallback((next: 'light' | 'dark') => {
    setThemeState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('pf_theme_pref', next);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const onAccountEvent = useCallback(
    (cb: (account: TradingAccount) => void) => {
      accountListeners.add(cb);
      return () => {
        accountListeners.delete(cb);
      };
    },
    [accountListeners]
  );

  const onNotificationEvent = useCallback(
    (cb: (notif: AppNotification) => void) => {
      notifListeners.add(cb);
      return () => {
        notifListeners.delete(cb);
      };
    },
    [notifListeners]
  );

  const onMarketTick = useCallback(
    (cb: (tick: LiveMarketTickEvent) => void) => {
      marketTickListeners.add(cb);
      return () => {
        marketTickListeners.delete(cb);
      };
    },
    [marketTickListeners]
  );

  return (
    <PlatformContext.Provider
      value={{
        config,
        theme,
        setTheme,
        toggleTheme,
        refreshConfig,
        setConfigLocal: setConfig,
        onAccountEvent,
        onNotificationEvent,
        onMarketTick,
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform must be used within PlatformProvider');
  return ctx;
}
