import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type {
  AppNotification,
  TradeRecord,
  TradingAccount,
  TransactionRecord,
  UserProfile,
} from '../types/pipflow';
import { signInWithGoogleIdToken } from '../lib/firebase';
import { apiFetch, setMemoryAdminToken, setMemoryUserToken } from '../lib/sessionMemory';
import { usePlatform } from './PlatformContext';

interface AuthContextValue {
  user: UserProfile | null;
  accounts: TradingAccount[];
  activeAccount: TradingAccount | null;
  trades: TradeRecord[];
  transactions: TransactionRecord[];
  watchlist: string[];
  notifications: AppNotification[];
  loading: boolean;
  adminAuthenticated: boolean;
  adminNeedsBootstrap: boolean;
  refreshUserState: () => Promise<void>;
  refreshAdminSession: () => Promise<{ authenticated: boolean; needsBootstrap: boolean }>;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: { email: string; password: string; fullName?: string; country?: string; phone?: string }) => Promise<{ verificationPreviewCode?: string }>;
  loginWithGoogle: () => Promise<void>;
  loginWithDerivOAuth: () => Promise<{ derivLoginId?: string }>;
  loginWithDerivToken: (token: string, phone?: string) => Promise<void>;
  connectDerivToken: (token: string) => Promise<{ derivLoginId: string }>;
  disconnectDeriv: () => Promise<void>;
  revokeDeriv: () => Promise<void>;
  syncDerivBalances: () => Promise<void>;
  depositFunds: (accountId: string, amount: number, note?: string) => Promise<void>;
  withdrawFunds: (accountId: string, amount: number, note?: string) => Promise<void>;
  logout: () => Promise<void>;
  switchAccount: (accountId: string) => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
  resetDemoBalance: (accountId: string) => Promise<void>;
  toggleWatchlist: (symbol: string) => Promise<void>;
  markNotificationsRead: (id?: string) => Promise<void>;
  setAccountBalanceLocal: (account: TradingAccount) => void;
  setTradesLocal: React.Dispatch<React.SetStateAction<TradeRecord[]>>;
  setTransactionsLocal: React.Dispatch<React.SetStateAction<TransactionRecord[]>>;
  adminLogout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { onAccountEvent, onNotificationEvent } = usePlatform();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminNeedsBootstrap, setAdminNeedsBootstrap] = useState(false);

  const refreshAdminSession = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/session');
      if (res.ok) {
        const data = await res.json();
        setAdminAuthenticated(Boolean(data.authenticated));
        setAdminNeedsBootstrap(Boolean(data.needsBootstrap));
        return { authenticated: Boolean(data.authenticated), needsBootstrap: Boolean(data.needsBootstrap) };
      }
    } catch {
      // ignore
    }
    return { authenticated: false, needsBootstrap: false };
  }, []);

  const fetchTradingWorkspaceState = useCallback(async () => {
    try {
      const stRes = await apiFetch('/api/trading/state');
      if (stRes.ok) {
        const st = await stRes.json();
        setAccounts(st.accounts || []);
        setTrades(st.trades || []);
        setTransactions(st.transactions || []);
        setWatchlist(st.watchlist || []);
        setNotifications(st.notifications || []);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshUserState = useCallback(async () => {
    try {
      const meRes = await apiFetch('/api/auth/me');
      if (!meRes.ok) {
        if (meRes.status === 401) {
          setUser(null);
          setAccounts([]);
          setTrades([]);
          setTransactions([]);
        }
        setLoading(false);
        return;
      }
      const meData = await meRes.json();
      setUser(meData.user);
      setAccounts(meData.accounts || []);
      setWatchlist(meData.watchlist || []);
      setNotifications(meData.notifications || []);
      await fetchTradingWorkspaceState();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [fetchTradingWorkspaceState]);

  useEffect(() => {
    void refreshUserState();
    void refreshAdminSession();
  }, [refreshUserState, refreshAdminSession]);

  const setAccountBalanceLocal = useCallback((updated: TradingAccount) => {
    setAccounts((prev) => {
      const exists = prev.some((a) => a.accountId === updated.accountId);
      if (!exists) return [...prev, updated];
      return prev.map((a) => (a.accountId === updated.accountId ? updated : a));
    });
  }, []);

  useEffect(() => {
    const unsubAcc = onAccountEvent((acc) => {
      setAccountBalanceLocal(acc);
    });
    const unsubNotif = onNotificationEvent((n) => {
      setNotifications((prev) => [n, ...prev]);
    });
    return () => {
      unsubAcc();
      unsubNotif();
    };
  }, [onAccountEvent, onNotificationEvent, setAccountBalanceLocal]);

  const login = async (email: string, password: string) => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    if (data.sessionToken) setMemoryUserToken(data.sessionToken);
    if (data.user) setUser(data.user);
    if (data.accounts) setAccounts(data.accounts);
    await fetchTradingWorkspaceState();
  };

  const register = async (payload: { email: string; password: string; fullName?: string; country?: string; phone?: string }) => {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    if (data.sessionToken) setMemoryUserToken(data.sessionToken);
    if (data.user) setUser(data.user);
    if (data.accounts) setAccounts(data.accounts);
    await fetchTradingWorkspaceState();
    return { verificationPreviewCode: data.verificationPreviewCode };
  };

  const loginWithGoogle = async () => {
    const idToken = await signInWithGoogleIdToken();
    const res = await apiFetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Google sign-in failed');
    if (data.sessionToken) setMemoryUserToken(data.sessionToken);
    if (data.user) setUser(data.user);
    if (data.accounts) setAccounts(data.accounts);
    await fetchTradingWorkspaceState();
  };

  const loginWithDerivToken = async (token: string, phone?: string) => {
    const res = await apiFetch('/api/auth/deriv-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, phone, consentAccepted: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Deriv API key login failed');
    if (data.sessionToken) setMemoryUserToken(data.sessionToken);
    if (data.user) setUser(data.user);
    if (data.accounts) setAccounts(data.accounts);
    await fetchTradingWorkspaceState();
  };

  const loginWithDerivOAuth = async (): Promise<{ derivLoginId?: string }> => {
    const redirectUri = `${window.location.origin}/auth/callback`;
    const res = await apiFetch(`/api/auth/deriv/url?redirect_uri=${encodeURIComponent(redirectUri)}`);
    const data = await res.json();
    if (!res.ok || !data?.url) {
      throw new Error(data?.error || 'Could not initialize Deriv OAuth URL.');
    }

    const popup = window.open(
      data.url,
      'pipflow_deriv_oauth',
      'width=540,height=700,noopener=false,noreferrer=false'
    );

    if (!popup) {
      // Mobile / strict popup blocker fallback: full-page redirect
      window.location.href = data.url;
      return {};
    }

    return new Promise<{ derivLoginId?: string }>((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        clearInterval(closeWatch);
      };

      const onMessage = async (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'DERIV_OAUTH_SUCCESS') {
          if (finished) return;
          finished = true;
          cleanup();
          if (msg.sessionToken) {
            setMemoryUserToken(String(msg.sessionToken));
          }
          await refreshUserState();
          resolve({ derivLoginId: msg.derivLoginId });
        } else if (msg.type === 'DERIV_OAUTH_ERROR') {
          if (finished) return;
          finished = true;
          cleanup();
          reject(new Error(String(msg.error || 'Deriv OAuth authorization failed.')));
        }
      };

      window.addEventListener('message', onMessage);

      const closeWatch = window.setInterval(() => {
        if (popup.closed && !finished) {
          finished = true;
          cleanup();
          reject(new Error('Deriv authorization window was closed before completion.'));
        }
      }, 600);
    });
  };

  const connectDerivToken = async (token: string) => {
    const res = await apiFetch('/api/auth/connect-deriv-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, consentAccepted: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not link Deriv API token');
    if (data.user) setUser(data.user);
    if (data.accounts) setAccounts(data.accounts);
    await fetchTradingWorkspaceState();
    return { derivLoginId: data.derivLoginId };
  };

  const disconnectDeriv = async () => {
    const res = await apiFetch('/api/auth/disconnect-deriv', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not disconnect Deriv account');
    if (data.user) setUser(data.user);
    if (data.accounts) setAccounts(data.accounts);
  };

  const revokeDeriv = async () => {
    const res = await apiFetch('/api/auth/revoke-deriv', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not revoke Deriv authorization');
    if (data.user) setUser(data.user);
    if (data.accounts) setAccounts(data.accounts);
  };

  const syncDerivBalances = async () => {
    const res = await apiFetch('/api/auth/sync-deriv-balances', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Balance sync failed');
    if (data.accounts) setAccounts(data.accounts);
  };

  const depositFunds = async (accountId: string, amount: number, note?: string) => {
    const res = await apiFetch('/api/trading/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, amount, note }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Deposit failed');
    if (data.account) setAccountBalanceLocal(data.account);
    await fetchTradingWorkspaceState();
  };

  const withdrawFunds = async (accountId: string, amount: number, note?: string) => {
    const res = await apiFetch('/api/trading/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, amount, note }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Withdrawal failed');
    if (data.account) setAccountBalanceLocal(data.account);
    await fetchTradingWorkspaceState();
  };

  const logout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setMemoryUserToken(null);
    setUser(null);
    setAccounts([]);
    setTrades([]);
    setTransactions([]);
  };

  const switchAccount = async (accountId: string) => {
    const res = await apiFetch('/api/auth/switch-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not switch account');
    setUser(data.user);
  };

  const updateProfile = async (data: Partial<UserProfile>) => {
    const res = await apiFetch('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Profile update failed');
    setUser(json.user);
  };

  const resetDemoBalance = async (accountId: string) => {
    const res = await apiFetch('/api/trading/demo/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Reset failed');
    setAccountBalanceLocal(data.account);
    await fetchTradingWorkspaceState();
  };

  const toggleWatchlist = async (symbol: string) => {
    const res = await apiFetch('/api/trading/watchlist/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });
    const data = await res.json();
    if (res.ok) {
      setWatchlist(data.watchlist);
    }
  };

  const markNotificationsRead = async (id?: string) => {
    await apiFetch('/api/trading/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setNotifications((prev) => prev.map((n) => (!id || n.id === id ? { ...n, read: true } : n)));
  };

  const adminLogout = async () => {
    await apiFetch('/api/admin/logout', { method: 'POST' });
    setMemoryAdminToken(null);
    setAdminAuthenticated(false);
  };

  const activeAccount =
    accounts.find((a) => a.accountId === user?.activeAccountId) ||
    accounts.find((a) => a.accountType === 'demo') ||
    accounts[0] ||
    null;

  return (
    <AuthContext.Provider
      value={{
        user,
        accounts,
        activeAccount,
        trades,
        transactions,
        watchlist,
        notifications,
        loading,
        adminAuthenticated,
        adminNeedsBootstrap,
        refreshUserState,
        refreshAdminSession,
        login,
        register,
        loginWithGoogle,
        loginWithDerivOAuth,
        loginWithDerivToken,
        connectDerivToken,
        disconnectDeriv,
        revokeDeriv,
        syncDerivBalances,
        depositFunds,
        withdrawFunds,
        logout,
        switchAccount,
        updateProfile,
        resetDemoBalance,
        toggleWatchlist,
        markNotificationsRead,
        setAccountBalanceLocal,
        setTradesLocal: setTrades,
        setTransactionsLocal: setTransactions,
        adminLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
