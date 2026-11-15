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
