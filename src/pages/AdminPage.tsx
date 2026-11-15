import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Bell,
  CheckCircle2,
  Coins,
  Cpu,
  DollarSign,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Layers,
  LayoutDashboard,
  Lock,
  LogOut,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sun,
  Trash2,
  TrendingUp,
  Upload,
  UserCheck,
  UserMinus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePlatform } from '../context/PlatformContext';
import { apiFetch } from '../lib/sessionMemory';
import { PipflowLogo } from '../components/PipflowLogo';
import { AdminAuthModal } from '../components/AdminAuthModal';
import { getInitialsFromEmail, OFFICIAL_LOGO_PATH } from '../config/app.config';
import type {
  AdminAuditLog,
  AppNotification,
  ContactSubmission,
  FeatureFlags,
  MarketAsset,
  MarketCategory,
  PlatformConfig,
  PnlAdjustmentRecord,
  TradeRecord,
  TradingAccount,
  TransactionRecord,
  UserProfile,
} from '../types/pipflow';

type AdminSection =
  | 'overview'
  | 'users'
  | 'accounts'
  | 'balances'
  | 'trading'
  | 'pnl'
  | 'branding'
  | 'logos'
  | 'customisation'
  | 'markets'
  | 'notifications'
  | 'features'
  | 'settings'
  | 'audit'
  | 'security';

interface AdminOverviewData {
  stats: {
    totalUsers: number;
    activeUsers: number;
    suspendedUsers: number;
    newRegistrations: number;
    totalRealAccounts: number;
    totalDemoAccounts: number;
    totalRealBalance: number;
    totalDemoBalance: number;
    totalTrades: number;
    openPositions: number;
    closedPositions: number;
    totalVolume: number;
    aggregateProfits: number;
    aggregateLosses: number;
    netPlatformPnl: number;
  };
  recentRegistrations: UserProfile[];
  recentTrades: TradeRecord[];
  recentAuditLogs: AdminAuditLog[];
  recentContacts: ContactSubmission[];
}

interface AdminUserRow extends UserProfile {
  accounts: TradingAccount[];
  tradeCount: number;
}

interface AdminAccountRow extends TradingAccount {
  userEmail: string;
  userFullName: string;
}

interface AdminTradeRow extends TradeRecord {
  userEmail: string;
}

interface AdminPageProps {
  navigate: (to: string) => void;
}

const SECTIONS: { id: AdminSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'User Management', icon: Users },
  { id: 'accounts', label: 'Account Management', icon: Wallet },
  { id: 'balances', label: 'Balance Management', icon: Coins },
  { id: 'trading', label: 'Trading Activity', icon: Activity },
  { id: 'pnl', label: 'Profit & Loss', icon: TrendingUp },
  { id: 'branding', label: 'Branding', icon: Layers },
  { id: 'logos', label: 'Logo Management', icon: ImageIcon },
  { id: 'customisation', label: 'Website Customisation', icon: Palette },
  { id: 'markets', label: 'Market Config', icon: DollarSign },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'features', label: 'Feature Management', icon: Cpu },
  { id: 'settings', label: 'Platform Settings', icon: Settings },
  { id: 'audit', label: 'Audit Logs', icon: FileText },
  { id: 'security', label: 'Security Settings', icon: Lock },
];

export function AdminPage({ navigate }: AdminPageProps) {
  const { adminAuthenticated, adminLogout, refreshUserState } = useAuth();
  const { config, theme, toggleTheme, setConfigLocal, refreshConfig } = usePlatform();

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [section, setSection] = useState<AdminSection>('overview');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Admin datasets
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [accounts, setAccounts] = useState<AdminAccountRow[]>([]);
  const [trades, setTrades] = useState<AdminTradeRow[]>([]);
  const [transactions, setTransactions] = useState<(TransactionRecord & { userEmail?: string })[]>([]);
  const [pnlSummary, setPnlSummary] = useState<{
    summary: { realisedPnl: number; grossProfit: number; grossLoss: number; openCount: number; closedCount: number; winRate: number };
    adjustments: PnlAdjustmentRecord[];
  } | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [auditFilter, setAuditFilter] = useState('');
  const [adminNotifications, setAdminNotifications] = useState<AppNotification[]>([]);

  // Editable config drafts
  const [brandingDraft, setBrandingDraft] = useState(config.branding);
  const [themeDraft, setThemeDraft] = useState(config.theme);
  const [websiteDraft, setWebsiteDraft] = useState(config.website);
  const [dashboardDraft, setDashboardDraft] = useState(config.dashboard);
  const [featuresDraft, setFeaturesDraft] = useState<FeatureFlags>(config.features);
  const [marketsDraft, setMarketsDraft] = useState<MarketAsset[]>(config.markets);
  const [logoUrlDrafts, setLogoUrlDrafts] = useState<Record<string, string>>({
    mainLogoUrl: config.branding.mainLogoUrl,
    dashboardLogoUrl: config.branding.dashboardLogoUrl,
    footerLogoUrl: config.branding.footerLogoUrl,
    faviconUrl: config.branding.faviconUrl,
    mobileLogoUrl: config.branding.mobileLogoUrl,
  });
  const [newMarket, setNewMarket] = useState<MarketAsset>({
    symbol: '',
    name: '',
    category: 'forex',
    basePrice: 1.1,
    volatility: 0.001,
    payoutRate: 0.9,
    spread: 0.0002,
    pipDecimals: 4,
    enabled: true,
  });

  // Interactive modals / forms state
  const [inspectedUser, setInspectedUser] = useState<{
    user: UserProfile;
    accounts: TradingAccount[];
    trades: TradeRecord[];
    transactions: TransactionRecord[];
  } | null>(null);
  const [editUserDraft, setEditUserDraft] = useState<(UserProfile & { newPassword?: string }) | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => Promise<void>;
  } | null>(null);

  // Account creation form
  const [newAccUserId, setNewAccUserId] = useState('');
  const [newAccType, setNewAccType] = useState<'real' | 'demo'>('real');
  const [newAccCurrency, setNewAccCurrency] = useState<'USD' | 'KSH' | 'EUR' | 'GBP'>('USD');
  const [newAccInitial, setNewAccInitial] = useState('0');

  // Balance adjustment form
  const [balUserId, setBalUserId] = useState('');
  const [balAccountId, setBalAccountId] = useState('');
  const [balMode, setBalMode] = useState<'credit' | 'debit' | 'set'>('credit');
  const [balAmount, setBalAmount] = useState('1000');
  const [balReason, setBalReason] = useState('');

  // Audited P&L Adjustment form
  const [pnlTradeId, setPnlTradeId] = useState('');
  const [pnlDelta, setPnlDelta] = useState('0');
  const [pnlReason, setPnlReason] = useState('');

  // Notification sender
  const [notifTarget, setNotifTarget] = useState('all');
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');

  // Security
  const [ttlHours, setTtlHours] = useState(8);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('');
  const [showAdminSecPw, setShowAdminSecPw] = useState(false);

  useEffect(() => {
    setBrandingDraft(config.branding);
    setThemeDraft(config.theme);
    setWebsiteDraft(config.website);
    setDashboardDraft(config.dashboard);
    setFeaturesDraft(config.features);
    setMarketsDraft(config.markets);
    setLogoUrlDrafts({
      mainLogoUrl: config.branding.mainLogoUrl,
      dashboardLogoUrl: config.branding.dashboardLogoUrl,
      footerLogoUrl: config.branding.footerLogoUrl,
      faviconUrl: config.branding.faviconUrl,
      mobileLogoUrl: config.branding.mobileLogoUrl,
    });
  }, [config]);

  const notify = (type: 'success' | 'error', text: string) => {
    setBanner({ type, text });
    window.setTimeout(() => setBanner(null), 5000);
  };

  const fetchAllAdminData = useCallback(async () => {
    if (!adminAuthenticated) return;
    try {
      const [ovRes, uRes, accRes, trRes, txRes, pnlRes, logRes, secRes, ntfRes] = await Promise.all([
        apiFetch('/api/admin/overview', { credentials: 'include' }),
        apiFetch('/api/admin/users', { credentials: 'include' }),
        apiFetch('/api/admin/demo-accounts', { credentials: 'include' }),
        apiFetch('/api/admin/trading-activity', { credentials: 'include' }),
        apiFetch('/api/admin/demo-transactions', { credentials: 'include' }),
        apiFetch('/api/admin/demo-performance', { credentials: 'include' }),
        apiFetch('/api/admin/audit-logs', { credentials: 'include' }),
        apiFetch('/api/admin/session', { credentials: 'include' }),
        apiFetch('/api/admin/notifications', { credentials: 'include' }),
      ]);

      if (ovRes.ok) setOverview(await ovRes.json());
      if (uRes.ok) {
        const uData = await uRes.json();
        setUsers(uData.users || []);
        if (!newAccUserId && uData.users?.[0]) setNewAccUserId(uData.users[0].id);
        if (!balUserId && uData.users?.[0]) setBalUserId(uData.users[0].id);
      }
      if (accRes.ok) {
        const aData = await accRes.json();
        setAccounts(aData.accounts || []);
      }
      if (trRes.ok) {
        const tData = await trRes.json();
        setTrades(tData.trades || []);
        if (!pnlTradeId && tData.trades?.[0]) setPnlTradeId(tData.trades[0].id);
      }
      if (txRes.ok) {
        const xData = await txRes.json();
        setTransactions(xData.transactions || []);
      }
      if (pnlRes.ok) setPnlSummary(await pnlRes.json());
      if (logRes.ok) {
        const lData = await logRes.json();
        setAuditLogs(lData.logs || []);
      }
      if (secRes.ok) {
        const sData = await secRes.json();
        if (sData.ttlHours) setTtlHours(sData.ttlHours);
      }
      if (ntfRes.ok) {
        const nData = await ntfRes.json();
        setAdminNotifications(nData.notifications || []);
      }
    } catch {
      notify('error', 'Failed to refresh administrator data.');
    }
  }, [adminAuthenticated, balUserId, newAccUserId, pnlTradeId]);

  useEffect(() => {
    if (adminAuthenticated) {
      void fetchAllAdminData();
    }
  }, [adminAuthenticated, fetchAllAdminData]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q) ||
        u.accounts.some((a) => a.accountId.toLowerCase().includes(q))
    );
  }, [users, userSearch]);

  const selectedBalUserAccounts = useMemo(() => {
    return accounts.filter((a) => a.userId === balUserId);
  }, [accounts, balUserId]);

  useEffect(() => {
    if (selectedBalUserAccounts.length > 0 && !selectedBalUserAccounts.some((a) => a.accountId === balAccountId)) {
      setBalAccountId(selectedBalUserAccounts[0].accountId);
    }
  }, [selectedBalUserAccounts, balAccountId]);

  // Unauthenticated gate matching screenshot reference
  if (!adminAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080d17] text-slate-100 p-4">
        <div className="w-full max-w-md rounded-2xl bg-[#0f1724] border border-slate-800/90 p-8 text-center shadow-2xl">
          <div className="mx-auto w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-5">
            <ShieldAlert className="w-6 h-6 text-rose-500" />
          </div>
          <h1 className="text-xl font-display font-bold text-white tracking-tight">Administrator Session Required</h1>
          <p className="text-sm text-slate-400 mt-2.5 leading-relaxed">
            Access to the {config.branding.appName || 'PIPFLOW'} Control Centre is restricted. Authenticate via the
            Administrator credential to continue.
          </p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Back to Workspace
            </button>
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="px-5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 transition-colors"
            >
              Authenticate Admin
            </button>
          </div>
        </div>

        <AdminAuthModal
          open={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={() => {
            setAuthModalOpen(false);
            void fetchAllAdminData();
          }}
        />
      </div>
    );
  }

  // Action handlers
  const handleInspectUser = async (userId: string) => {
    const res = await apiFetch(`/api/admin/users/${userId}`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      setInspectedUser(data);
      setEditUserDraft(data.user);
    }
  };

  const handleSaveUserEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUserDraft) return;
    setBusy(true);
    try {
      const payload: Record<string, any> = {
        email: editUserDraft.email,
        fullName: editUserDraft.fullName,
        country: editUserDraft.country,
        phone: editUserDraft.phone,
        emailVerified: editUserDraft.emailVerified,
        status: editUserDraft.status,
        preferredCurrency: editUserDraft.preferredCurrency,
        preferredTheme: editUserDraft.preferredTheme,
      };
      if (editUserDraft.newPassword && editUserDraft.newPassword.trim().length >= 6) {
        payload.newPassword = editUserDraft.newPassword.trim();
      }
      const res = await apiFetch(`/api/admin/users/${editUserDraft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      notify('success', `Updated user profile for ${data.user.email}.`);
      setInspectedUser(null);
      await fetchAllAdminData();
    } catch (err: any) {
      notify('error', err?.message || 'Failed to update user details.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: newAccUserId,
          accountType: newAccType,
          currency: newAccCurrency,
          initialBalance: Number(newAccInitial) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create account');
      notify('success', `Provisioned ${data.account.accountType.toUpperCase()} account ${data.account.accountId}.`);
      await fetchAllAdminData();
      await refreshUserState();
    } catch (err: any) {
      notify('error', err?.message || 'Account creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleAccountStatus = async (acc: AdminAccountRow) => {
    const nextStatus = acc.status === 'frozen' ? 'active' : 'frozen';
    const res = await apiFetch(`/api/admin/accounts/${acc.accountId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      notify('success', `Account ${acc.accountId} is now ${nextStatus}.`);
      await fetchAllAdminData();
    }
  };

  const submitBalanceAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    const acc = accounts.find((a) => a.accountId === balAccountId);
    if (!acc) return notify('error', 'Select a target account.');
    const num = Number(balAmount);
    if (Number.isNaN(num) || num < 0) return notify('error', 'Enter a valid non-negative amount.');
    if (balReason.trim().length < 2) return notify('error', 'Provide an audit reason.');

    const actionWord = balMode === 'credit' ? `Credit +$${num.toFixed(2)} to` : balMode === 'debit' ? `Debit -$${num.toFixed(2)} from` : `Set exact balance $${num.toFixed(2)} on`;

    setConfirmAction({
      title: 'Confirm Balance Adjustment',
      description: `${actionWord} ${acc.accountType.toUpperCase()} account ${acc.accountId} (${acc.userEmail}). Current balance: $${acc.balance.toFixed(2)}. Reason: "${balReason}"`,
      confirmLabel: 'Apply Adjustment',
      onConfirm: async () => {
        const res = await apiFetch(`/api/admin/demo-accounts/${acc.accountId}/adjust`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ mode: balMode, amount: num, reason: balReason.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Adjustment failed');
        notify('success', `Updated ${acc.accountId} balance to $${data.account.balance.toFixed(2)}. Live dashboard synced.`);
        setBalReason('');
        await fetchAllAdminData();
        await refreshUserState();
      },
    });
  };

  const handleResetAccountBalance = (acc: AdminAccountRow) => {
    const defaultTarget = acc.accountType === 'demo' ? config.dashboard.defaultDemoBalance : 0;
    setConfirmAction({
      title: 'Confirm Account Reset',
      description: `Reset ${acc.accountType.toUpperCase()} account ${acc.accountId} (${acc.userEmail}) from $${acc.balance.toFixed(2)} to $${defaultTarget.toFixed(2)}?`,
      confirmLabel: 'Reset Balance',
      danger: true,
      onConfirm: async () => {
        const res = await apiFetch(`/api/admin/demo-accounts/${acc.accountId}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ startingBalance: defaultTarget, reason: 'Admin Control Centre balance reset' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Reset failed');
        notify('success', `Reset ${acc.accountId} to $${data.account.balance.toFixed(2)}.`);
        await fetchAllAdminData();
        await refreshUserState();
      },
    });
  };

  const handleApplyPnlAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    const delta = Number(pnlDelta);
    if (!pnlTradeId || Number.isNaN(delta) || pnlReason.trim().length < 3) {
      return notify('error', 'Select a trade, enter a valid P&L delta, and provide an audit reason.');
    }
    setBusy(true);
    try {
      const res = await apiFetch('/api/admin/pnl-adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tradeId: pnlTradeId, adjustmentDelta: delta, reason: pnlReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'P&L adjustment failed');
      notify('success', `Audited P&L adjustment applied to ${data.account.accountId}. Original trade record preserved.`);
      setPnlReason('');
      await fetchAllAdminData();
      await refreshUserState();
    } catch (err: any) {
      notify('error', err?.message || 'Failed to adjust P&L.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch('/api/admin/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(brandingDraft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save branding');
      setConfigLocal(data.config);
      notify('success', 'Branding settings persisted and applied across PIPFLOW.');
    } catch {
      notify('error', 'Error saving branding configuration.');
    } finally {
      setBusy(false);
    }
  };

  const handleUploadLogo = async (
    slot: 'mainLogoUrl' | 'dashboardLogoUrl' | 'footerLogoUrl' | 'faviconUrl' | 'mobileLogoUrl',
    file: File
  ) => {
    const fd = new FormData();
    fd.append('slot', slot);
    fd.append('logo', file);
    setBusy(true);
    try {
      const res = await apiFetch('/api/admin/upload-logo', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Logo upload failed');
      notify('success', `Updated ${slot} successfully.`);
      await refreshConfig();
    } catch (err: any) {
      notify('error', err?.message || 'Logo upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettingsPatch = async (patch: Partial<Pick<PlatformConfig, 'theme' | 'dashboard' | 'website' | 'markets'>>, msg: string) => {
    setBusy(true);
    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setConfigLocal(data.config);
      notify('success', msg);
    } catch {
      notify('error', 'Failed to persist platform settings.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleFeature = async (key: keyof FeatureFlags) => {
    const next = { ...featuresDraft, [key]: !featuresDraft[key] };
    setFeaturesDraft(next);
    try {
      const res = await apiFetch('/api/admin/features', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [key]: next[key] }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfigLocal(data.config);
        notify('success', `${key} set to ${next[key] ? 'Enabled' : 'Disabled'}.`);
      }
    } catch {
      notify('error', 'Failed to toggle feature flag.');
    }
  };

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifTitle.trim() || !notifMessage.trim()) return notify('error', 'Title and message are required.');
    setBusy(true);
    try {
      const res = await apiFetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: notifTarget, title: notifTitle.trim(), message: notifMessage.trim() }),
      });
      if (!res.ok) throw new Error('Failed to send alert');
      notify('success', `Notification broadcasted to ${notifTarget === 'all' ? 'all traders' : notifTarget}.`);
      setNotifTitle('');
      setNotifMessage('');
      await fetchAllAdminData();
    } catch {
      notify('error', 'Could not deliver notification.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newAdminPassword && newAdminPassword !== confirmAdminPassword) {
      return notify('error', 'New administrator passwords do not match.');
    }
    if (newAdminPassword && newAdminPassword.length < 8) {
      return notify('error', 'Administrator password must be at least 8 characters.');
    }
    setBusy(true);
    try {
      const res = await apiFetch('/api/admin/security', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ttlHours: Number(ttlHours),
          ...(newAdminPassword ? { newPassword: newAdminPassword } : {}),
        }),
      });
      if (!res.ok) throw new Error('Security update failed');
      notify('success', 'Administrator security policy updated.');
      setNewAdminPassword('');
      setConfirmAdminPassword('');
      await fetchAllAdminData();
    } catch {
      notify('error', 'Failed to update security settings.');
    } finally {
      setBusy(false);
    }
  };

  const activeSectionMeta = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#080d17] text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Admin Header */}
      <header className="sticky top-0 z-30 bg-white dark:bg-[#0c1322] border-b border-slate-200 dark:border-slate-800">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <PipflowLogo variant="dashboard" size="sm" onClick={() => setSection('overview')} />
            <span className="text-[11px] font-bold tracking-wider uppercase text-rose-600 dark:text-rose-400">
              ADMIN
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void fetchAllAdminData()}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Refresh Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Workspace
            </button>
            <button
              type="button"
              onClick={() => void adminLogout()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Lock Admin</span>
            </button>
          </div>
        </div>

        {/* Scrollable 15-section navigation strip (works great on both desktop and mobile) */}
        <div className="px-4 sm:px-6 border-t border-slate-200/80 dark:border-slate-800/80 overflow-x-auto no-scrollbar">
          <nav className="flex items-center gap-1.5 py-2 min-w-max">
            {SECTIONS.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-slate-900 dark:text-white">
              {activeSectionMeta.label}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {config.branding.appName || 'PIPFLOW'} Control Centre
            </p>
          </div>
        </div>

        {banner && (
          <div
            className={`px-4 py-3 rounded-xl border text-xs sm:text-sm font-medium flex items-center justify-between gap-3 ${
              banner.type === 'success'
                ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200'
                : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
            }`}
          >
            <span>{banner.text}</span>
            <button type="button" onClick={() => setBanner(null)} className="p-1 opacity-70 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 1. OVERVIEW */}
        {section === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Total Traders', value: overview?.stats.totalUsers ?? 0, sub: `${overview?.stats.activeUsers ?? 0} active · ${overview?.stats.newRegistrations ?? 0} new (7d)` },
                { label: 'Accounts (ROT / DOT)', value: `${overview?.stats.totalRealAccounts ?? 0} / ${overview?.stats.totalDemoAccounts ?? 0}`, sub: `Real $${(overview?.stats.totalRealBalance ?? 0).toLocaleString()} · Demo $${(overview?.stats.totalDemoBalance ?? 0).toLocaleString()}` },
                { label: 'Trading Volume', value: `$${(overview?.stats.totalVolume ?? 0).toLocaleString()}`, sub: `${overview?.stats.totalTrades ?? 0} trades · ${overview?.stats.openPositions ?? 0} open` },
                { label: 'Net Platform P&L', value: `${(overview?.stats.netPlatformPnl ?? 0) >= 0 ? '+' : ''}$${(overview?.stats.netPlatformPnl ?? 0).toFixed(2)}`, sub: `Profits +$${(overview?.stats.aggregateProfits ?? 0).toFixed(2)} · Losses -$${(overview?.stats.aggregateLosses ?? 0).toFixed(2)}` },
              ].map((card) => (
                <div key={card.label} className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-4">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{card.label}</div>
                  <div className="text-xl sm:text-2xl font-display font-bold tabular-nums mt-1 text-slate-900 dark:text-white">
                    {card.value}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">{card.sub}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-5">
                <h2 className="text-sm font-semibold mb-3">Recent Registrations</h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(overview?.recentRegistrations || []).map((u) => (
                    <div key={u.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-8 h-8 rounded-lg bg-sky-600/15 text-sky-600 dark:text-sky-400 font-bold text-xs flex items-center justify-center shrink-0">
                          {getInitialsFromEmail(u.email)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{u.fullName}</div>
                          <div className="text-[11px] text-slate-500 truncate">{u.email}</div>
                        </div>
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${u.status === 'active' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600'}`}>
                        {u.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-5">
                <h2 className="text-sm font-semibold mb-3">Recent Audit Activity</h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(overview?.recentAuditLogs || []).slice(0, 6).map((log) => (
                    <div key={log.id} className="py-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-sky-600 dark:text-sky-400">{log.action}</span>
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-1">{log.details}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {overview?.recentContacts && overview.recentContacts.length > 0 && (
              <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-5">
                <h2 className="text-sm font-semibold mb-3">Recent Contact Submissions</h2>
                <div className="space-y-2">
                  {overview.recentContacts.map((c) => (
                    <div key={c.id} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 text-xs">
                      <div className="flex justify-between font-semibold">
                        <span>{c.subject} — {c.name} ({c.email})</span>
                        <span className="text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 mt-1">{c.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. USER MANAGEMENT */}
        {section === 'users' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search by email, name, user ID, ROT... or DOT... account ID"
                  className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0f1724]"
                />
              </div>
            </div>

            <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-3 px-4 font-semibold">User</th>
                    <th className="py-3 px-4 font-semibold">Accounts</th>
                    <th className="py-3 px-4 font-semibold">Trades</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <span className="w-8 h-8 rounded-lg bg-sky-600/15 text-sky-600 dark:text-sky-400 font-bold text-xs flex items-center justify-center shrink-0">
                            {getInitialsFromEmail(u.email)}
                          </span>
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white">{u.fullName}</div>
                            <div className="text-[11px] text-slate-500">{u.email} · {u.country}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1.5">
                          {u.accounts.map((acc) => (
                            <span
                              key={acc.accountId}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px] tabular-nums"
                            >
                              <span
                                className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${
                                  acc.accountType === 'real' ? 'bg-emerald-500' : 'bg-sky-600'
                                }`}
                              >
                                {acc.accountType === 'real' ? 'R' : 'D'}
                              </span>
                              {acc.accountId}: ${acc.balance.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4 tabular-nums">{u.tradeCount}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded font-semibold ${u.status === 'active' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600'}`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                        <button
                          type="button"
                          onClick={() => void handleInspectUser(u.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Eye className="w-3.5 h-3.5" /> Inspect
                        </button>
                        {u.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmAction({
                                title: 'Suspend Trader Account',
                                description: `Suspend ${u.email}? They will no longer be able to place trades or sign in.`,
                                confirmLabel: 'Suspend User',
                                danger: true,
                                onConfirm: async () => {
                                  await apiFetch(`/api/admin/users/${u.id}/suspend`, { method: 'POST', credentials: 'include' });
                                  notify('success', `Suspended ${u.email}.`);
                                  await fetchAllAdminData();
                                },
                              })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                          >
                            <UserMinus className="w-3.5 h-3.5" /> Suspend
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/admin/users/${u.id}/reactivate`, { method: 'POST', credentials: 'include' });
                              notify('success', `Reactivated ${u.email}.`);
                              await fetchAllAdminData();
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                          >
                            <UserCheck className="w-3.5 h-3.5" /> Reactivate
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmAction({
                              title: 'Delete User Permanently',
                              description: `Delete ${u.email} and all associated ROT/DOT accounts? This cannot be undone.`,
                              confirmLabel: 'Delete User',
                              danger: true,
                              onConfirm: async () => {
                                await apiFetch(`/api/admin/users/${u.id}`, { method: 'DELETE', credentials: 'include' });
                                notify('success', `Deleted ${u.email}.`);
                                await fetchAllAdminData();
                              },
                            })
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          title="Delete User"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. ACCOUNT MANAGEMENT */}
        {section === 'accounts' && (
          <div className="space-y-6">
            <form onSubmit={handleCreateAccount} className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-5 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Trader</label>
                <select
                  value={newAccUserId}
                  onChange={(e) => setNewAccUserId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} ({u.fullName})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Account Type</label>
                <select
                  value={newAccType}
                  onChange={(e) => setNewAccType(e.target.value as 'real' | 'demo')}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="real">Real Account (ROT...)</option>
                  <option value="demo">Demo Account (DOT...)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Initial Balance ({newAccCurrency})</label>
                <div className="flex gap-2">
                  <select
                    value={newAccCurrency}
                    onChange={(e) => setNewAccCurrency(e.target.value as any)}
                    className="px-2 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value="USD">USD</option>
                    <option value="KSH">KSH</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newAccInitial}
                    onChange={(e) => setNewAccInitial(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold"
              >
                <Plus className="w-4 h-4" /> Provision Account
              </button>
            </form>

            <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Account ID</th>
                    <th className="py-3 px-4 font-semibold">Owner</th>
                    <th className="py-3 px-4 font-semibold">Type</th>
                    <th className="py-3 px-4 font-semibold">Balance</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {accounts.map((acc) => (
                    <tr key={acc.accountId}>
                      <td className="py-3 px-4 font-mono font-semibold">
                        <span className="inline-flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center text-white ${acc.accountType === 'real' ? 'bg-emerald-500' : 'bg-sky-600'}`}>
                            {acc.accountType === 'real' ? 'R' : 'D'}
                          </span>
                          {acc.accountId}
                        </span>
                      </td>
                      <td className="py-3 px-4">{acc.userEmail}</td>
                      <td className="py-3 px-4 uppercase font-semibold">{acc.accountType}</td>
                      <td className="py-3 px-4 font-mono tabular-nums">${acc.balance.toFixed(2)} {acc.currency}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded font-semibold ${acc.status === 'active' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600'}`}>
                          {acc.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                        <select
                          value={acc.currency}
                          onChange={async (e) => {
                            const res = await apiFetch(`/api/admin/accounts/${acc.accountId}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ currency: e.target.value }),
                            });
                            if (res.ok) {
                              notify('success', `Updated ${acc.accountId} currency to ${e.target.value}.`);
                              await fetchAllAdminData();
                            }
                          }}
                          className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        >
                          {(['USD', 'KSH', 'EUR', 'GBP'] as const).map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setBalUserId(acc.userId);
                            setBalAccountId(acc.accountId);
                            setSection('balances');
                          }}
                          className="px-2.5 py-1 rounded bg-sky-600/10 text-sky-600 dark:text-sky-400 font-semibold hover:bg-sky-600/20"
                        >
                          Edit Balance
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleAccountStatus(acc)}
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          {acc.status === 'frozen' ? 'Unfreeze' : 'Freeze'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmAction({
                              title: 'Delete Trading Account',
                              description: `Delete ${acc.accountId} (${acc.accountType.toUpperCase()}) owned by ${acc.userEmail}?`,
                              confirmLabel: 'Delete Account',
                              danger: true,
                              onConfirm: async () => {
                                const res = await apiFetch(`/api/admin/accounts/${acc.accountId}`, { method: 'DELETE' });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data.error || 'Could not delete account');
                                notify('success', `Deleted account ${acc.accountId}.`);
                                await fetchAllAdminData();
                              },
                            })
                          }
                          className="p-1.5 rounded text-rose-500 hover:bg-rose-500/10"
                          title="Delete Account"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. BALANCE MANAGEMENT (ROT... Real & DOT... Demo) */}
        {section === 'balances' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <form onSubmit={submitBalanceAdjustment} className="lg:col-span-2 rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
              <h2 className="text-sm font-semibold">Adjust User Account Balance</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Supports both Real (<code className="font-mono">ROT...</code>) and Demo (<code className="font-mono">DOT...</code>) accounts with instant SSE dashboard updates.
              </p>

              <div>
                <label className="block text-xs font-medium mb-1">Select User</label>
                <select
                  value={balUserId}
                  onChange={(e) => setBalUserId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} ({u.fullName})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Select Account (ROT Real / DOT Demo)</label>
                <div className="space-y-2">
                  {selectedBalUserAccounts.map((acc) => {
                    const selected = acc.accountId === balAccountId;
                    return (
                      <button
                        key={acc.accountId}
                        type="button"
                        onClick={() => setBalAccountId(acc.accountId)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                          selected
                            ? 'border-sky-500 bg-sky-500/10'
                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900'
                        }`}
                      >
                        <span className="flex items-center gap-2 font-mono font-semibold">
                          <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center text-white ${acc.accountType === 'real' ? 'bg-emerald-500' : 'bg-sky-600'}`}>
                            {acc.accountType === 'real' ? 'R' : 'D'}
                          </span>
                          {acc.accountId} ({acc.accountType.toUpperCase()})
                        </span>
                        <span className="font-mono font-bold tabular-nums">${acc.balance.toFixed(2)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(['credit', 'debit', 'set'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setBalMode(m)}
                    className={`py-2 rounded-lg text-xs font-semibold border capitalize ${
                      balMode === m
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {m === 'set' ? 'Set Exact' : m}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Amount (USD)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={balAmount}
                  onChange={(e) => setBalAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Audit Reason (Required)</label>
                <input
                  type="text"
                  value={balReason}
                  onChange={(e) => setBalReason(e.target.value)}
                  placeholder="e.g., Bonus credit, Real deposit verification, Balance correction"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold"
                >
                  Review & Apply
                </button>
                {balAccountId && (
                  <button
                    type="button"
                    onClick={() => {
                      const acc = accounts.find((a) => a.accountId === balAccountId);
                      if (acc) handleResetAccountBalance(acc);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Reset
                  </button>
                )}
              </div>
            </form>

            <div className="lg:col-span-3 rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-5 overflow-x-auto">
              <h2 className="text-sm font-semibold mb-3">Recent Balance Ledger Transactions</h2>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Account</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Balance After</th>
                    <th className="py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {transactions.slice(0, 20).map((tx) => (
                    <tr key={tx.id}>
                      <td className="py-2 pr-3 font-mono font-semibold">{tx.accountId}</td>
                      <td className="py-2 pr-3 uppercase text-[11px]">{tx.type}</td>
                      <td className={`py-2 pr-3 font-mono tabular-nums ${tx.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                        {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums">${tx.balanceAfter.toFixed(2)}</td>
                      <td className="py-2 text-slate-500 dark:text-slate-400 max-w-xs truncate">{tx.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 5. TRADING ACTIVITY */}
        {section === 'trading' && (
          <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="py-3 px-4">Trade ID</th>
                  <th className="py-3 px-4">Trader / Account</th>
                  <th className="py-3 px-4">Market</th>
                  <th className="py-3 px-4">Direction</th>
                  <th className="py-3 px-4">Stake</th>
                  <th className="py-3 px-4">P&L</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td className="py-3 px-4 font-mono text-[11px]">{t.id}</td>
                    <td className="py-3 px-4">
                      <div className="font-semibold">{t.userEmail}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{t.accountId}</div>
                    </td>
                    <td className="py-3 px-4 font-semibold">{t.symbol}</td>
                    <td className="py-3 px-4 font-mono">{t.direction}</td>
                    <td className="py-3 px-4 font-mono tabular-nums">${t.stake.toFixed(2)}</td>
                    <td className={`py-3 px-4 font-mono font-semibold tabular-nums ${t.profitLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                      {t.profitLoss >= 0 ? '+' : ''}${t.profitLoss.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 uppercase text-[11px]">{t.source}</td>
                    <td className="py-3 px-4 uppercase text-[11px]">{t.status}</td>
                    <td className="py-3 px-4 text-right">
                      {t.status === 'open' ? (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await apiFetch(`/api/admin/trades/${t.id}/force-close`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ profitLoss: 0 }),
                            });
                            if (res.ok) {
                              notify('success', `Force-closed open trade ${t.id}.`);
                              await fetchAllAdminData();
                              await refreshUserState();
                            }
                          }}
                          className="px-2.5 py-1 rounded bg-rose-600/15 text-rose-600 dark:text-rose-400 font-semibold hover:bg-rose-600/25"
                        >
                          Force Close
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setPnlTradeId(t.id);
                            setSection('pnl');
                          }}
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          Adjust P&L
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 6. PROFIT & LOSS MANAGEMENT */}
        {section === 'pnl' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-4">
                <div className="text-xs text-slate-500">Realised P&L</div>
                <div className="text-xl font-bold font-mono tabular-nums mt-1">${(pnlSummary?.summary.realisedPnl ?? 0).toFixed(2)}</div>
              </div>
              <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-4">
                <div className="text-xs text-slate-500">Gross Profit</div>
                <div className="text-xl font-bold font-mono text-emerald-500 tabular-nums mt-1">+${(pnlSummary?.summary.grossProfit ?? 0).toFixed(2)}</div>
              </div>
              <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-4">
                <div className="text-xs text-slate-500">Gross Loss</div>
                <div className="text-xl font-bold font-mono text-rose-500 tabular-nums mt-1">-${(pnlSummary?.summary.grossLoss ?? 0).toFixed(2)}</div>
              </div>
              <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-4">
                <div className="text-xs text-slate-500">Platform Win Rate</div>
                <div className="text-xl font-bold font-mono tabular-nums mt-1">{pnlSummary?.summary.winRate ?? 0}%</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <form onSubmit={handleApplyPnlAdjustment} className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                <h2 className="text-sm font-semibold">Audited P&L Adjustment</h2>
                <p className="text-xs text-slate-500">Original trade history remains immutable; creates a linked adjustment record and updates the account balance.</p>
                <div>
                  <label className="block text-xs font-medium mb-1">Trade Record</label>
                  <select
                    value={pnlTradeId}
                    onChange={(e) => setPnlTradeId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    {trades.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id} · {t.symbol} ({t.profitLoss >= 0 ? '+' : ''}${t.profitLoss.toFixed(2)}) · {t.accountId}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Adjustment Delta (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={pnlDelta}
                    onChange={(e) => setPnlDelta(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Reason</label>
                  <input
                    type="text"
                    value={pnlReason}
                    onChange={(e) => setPnlReason(e.target.value)}
                    placeholder="e.g., Slippage compensation / Feed audit"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <button type="submit" disabled={busy} className="w-full py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold">
                  Record Audited P&L Adjustment
                </button>
              </form>

              <div className="lg:col-span-2 rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-5 overflow-x-auto">
                <h2 className="text-sm font-semibold mb-3">Audited Adjustment Ledger</h2>
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Trade</th>
                      <th className="py-2 pr-3">Account</th>
                      <th className="py-2 pr-3">Original</th>
                      <th className="py-2 pr-3">Delta</th>
                      <th className="py-2 pr-3">Adjusted</th>
                      <th className="py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(pnlSummary?.adjustments || []).map((adj) => (
                      <tr key={adj.id}>
                        <td className="py-2 pr-3 font-mono">{adj.tradeId}</td>
                        <td className="py-2 pr-3 font-mono">{adj.accountId}</td>
                        <td className="py-2 pr-3 font-mono">${adj.originalPnl.toFixed(2)}</td>
                        <td className="py-2 pr-3 font-mono text-sky-500">{adj.adjustmentDelta >= 0 ? '+' : ''}{adj.adjustmentDelta.toFixed(2)}</td>
                        <td className="py-2 pr-3 font-mono font-semibold">${adj.newPnl.toFixed(2)}</td>
                        <td className="py-2 text-slate-500">{adj.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 7. BRANDING MANAGEMENT */}
        {section === 'branding' && (
          <form onSubmit={handleSaveBranding} className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Application Name</label>
                <input
                  type="text"
                  value={brandingDraft.appName}
                  onChange={(e) => setBrandingDraft({ ...brandingDraft, appName: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Dashboard Title</label>
                <input
                  type="text"
                  value={brandingDraft.dashboardName}
                  onChange={(e) => setBrandingDraft({ ...brandingDraft, dashboardName: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Tagline</label>
                <input
                  type="text"
                  value={brandingDraft.tagline}
                  onChange={(e) => setBrandingDraft({ ...brandingDraft, tagline: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Website URL</label>
                <input
                  type="text"
                  value={brandingDraft.websiteUrl}
                  onChange={(e) => setBrandingDraft({ ...brandingDraft, websiteUrl: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Support Email</label>
                <input
                  type="email"
                  value={brandingDraft.supportEmail}
                  onChange={(e) => setBrandingDraft({ ...brandingDraft, supportEmail: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Support Phone</label>
                <input
                  type="text"
                  value={brandingDraft.supportPhone}
                  onChange={(e) => setBrandingDraft({ ...brandingDraft, supportPhone: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium mb-1">Office / Headquarters Address</label>
                <input
                  type="text"
                  value={brandingDraft.address}
                  onChange={(e) => setBrandingDraft({ ...brandingDraft, address: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium mb-1">Site Description (Footer & Meta)</label>
                <textarea
                  rows={2}
                  value={brandingDraft.description}
                  onChange={(e) => setBrandingDraft({ ...brandingDraft, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium mb-1">Footer Copyright Text</label>
                <input
                  type="text"
                  value={brandingDraft.footerText}
                  onChange={(e) => setBrandingDraft({ ...brandingDraft, footerText: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium">Top Announcement Banner</label>
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={brandingDraft.announcementEnabled}
                      onChange={(e) => setBrandingDraft({ ...brandingDraft, announcementEnabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                </div>
                <input
                  type="text"
                  value={brandingDraft.announcementText}
                  onChange={(e) => setBrandingDraft({ ...brandingDraft, announcementText: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Social Links</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['twitter', 'telegram', 'youtube', 'github'] as const).map((net) => (
                  <div key={net}>
                    <label className="block text-xs font-medium mb-1 capitalize">{net} URL</label>
                    <input
                      type="text"
                      value={brandingDraft.socialLinks?.[net] || ''}
                      onChange={(e) =>
                        setBrandingDraft({
                          ...brandingDraft,
                          socialLinks: { ...brandingDraft.socialLinks, [net]: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                ))}
              </div>
            </div>

            <button type="submit" disabled={busy} className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold">
              Save Branding Configuration
            </button>
          </form>
        )}

        {/* 8. LOGO MANAGEMENT */}
        {section === 'logos' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Official Bull Emblem & Logo Controls</h2>
                <p className="text-xs text-slate-500">Upload a custom file, paste an image URL, or reset all 5 slots to the official PIPFLOW emblem.</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await apiFetch('/api/admin/logos/apply-url', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ slot: 'all', url: OFFICIAL_LOGO_PATH }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                      setConfigLocal(data.config);
                      notify('success', 'All 5 logo slots reset to the official PIPFLOW emblem.');
                    }
                  } finally {
                    setBusy(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/10"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset All to Official PIPFLOW Logo
              </button>
            </div>

            {(
              [
                { slot: 'mainLogoUrl', title: 'Main Website Header Logo', url: config.branding.mainLogoUrl },
                { slot: 'dashboardLogoUrl', title: 'Authenticated Dashboard Logo', url: config.branding.dashboardLogoUrl },
                { slot: 'footerLogoUrl', title: 'Footer Logo', url: config.branding.footerLogoUrl },
                { slot: 'faviconUrl', title: 'Browser Favicon', url: config.branding.faviconUrl },
                { slot: 'mobileLogoUrl', title: 'Mobile Header Logo', url: config.branding.mobileLogoUrl },
              ] as const
            ).map((item) => (
              <div key={item.slot} className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-5 space-y-3">
                <h2 className="text-sm font-semibold">{item.title}</h2>
                <div className="h-24 rounded-xl bg-[#060a14] border border-slate-800 flex items-center justify-center p-3">
                  <img
                    src={item.url}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    className="max-h-16 object-contain rounded-lg"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={logoUrlDrafts[item.slot] || ''}
                    onChange={(e) => setLogoUrlDrafts({ ...logoUrlDrafts, [item.slot]: e.target.value })}
                    placeholder="Image URL or /uploads/..."
                    className="flex-1 min-w-[200px] px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const res = await apiFetch('/api/admin/logos/apply-url', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ slot: item.slot, url: logoUrlDrafts[item.slot] }),
                      });
                      const data = await res.json();
                      if (res.ok) {
                        setConfigLocal(data.config);
                        notify('success', `Saved URL for ${item.slot}.`);
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700"
                  >
                    Save URL
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const res = await apiFetch('/api/admin/logos/apply-url', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ slot: 'all', url: item.url }),
                      });
                      const data = await res.json();
                      if (res.ok) {
                        setConfigLocal(data.config);
                        notify('success', `Applied ${item.title} across all 5 logo slots.`);
                      }
                    }}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Apply to All Slots
                  </button>
                </div>
                <label className="w-full cursor-pointer flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <Upload className="w-4 h-4" />
                  Upload PNG / SVG / WebP / JPG (≤2MB)
                  <input
                    type="file"
                    accept="image/png,image/svg+xml,image/webp,image/jpeg,image/x-icon"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadLogo(item.slot, f);
                    }}
                  />
                </label>
              </div>
            ))}
          </div>
        )}

        {/* 9. WEBSITE CUSTOMISATION (FULL CMS & THEME) */}
        {section === 'customisation' && (
          <div className="space-y-6">
            <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-6 space-y-5">
              <h2 className="text-sm font-bold">Theme, Colours & Typography</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {(
                  [
                    ['primaryColor', 'Primary Accent'],
                    ['secondaryColor', 'Secondary Surface'],
                    ['backgroundColor', 'Dark Background'],
                    ['cardColor', 'Dark Card'],
                    ['buttonColor', 'Button Colour'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium mb-1">{label}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={themeDraft[key]}
                        onChange={(e) => setThemeDraft({ ...themeDraft, [key]: e.target.value })}
                        className="w-9 h-9 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <span className="text-xs font-mono">{themeDraft[key]}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Default Theme</label>
                  <select
                    value={themeDraft.defaultTheme}
                    onChange={(e) => setThemeDraft({ ...themeDraft, defaultTheme: e.target.value as 'light' | 'dark' })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Typography</label>
                  <select
                    value={themeDraft.fontFamily}
                    onChange={(e) => setThemeDraft({ ...themeDraft, fontFamily: e.target.value as any })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                    <option value="DM Sans">DM Sans</option>
                    <option value="Outfit">Outfit</option>
                    <option value="Manrope">Manrope</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Border Radius</label>
                  <select
                    value={themeDraft.borderRadius}
                    onChange={(e) => setThemeDraft({ ...themeDraft, borderRadius: e.target.value as any })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value="sharp">Sharp (4px)</option>
                    <option value="rounded">Rounded (10px)</option>
                    <option value="soft">Soft (16px)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Sidebar Style</label>
                  <select
                    value={themeDraft.sidebarStyle}
                    onChange={(e) => setThemeDraft({ ...themeDraft, sidebarStyle: e.target.value as any })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value="expanded">Expanded</option>
                    <option value="compact">Compact</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Header Style</label>
                  <select
                    value={themeDraft.headerStyle}
                    onChange={(e) => setThemeDraft({ ...themeDraft, headerStyle: e.target.value as any })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value="solid">Solid</option>
                    <option value="glass">Glass</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-6 space-y-5">
              <h2 className="text-sm font-bold">Landing Page, Navigation & All Public Website Content</h2>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                {(['markets', 'platforms', 'education', 'about', 'support'] as const).map((k) => (
                  <div key={k}>
                    <label className="block text-xs font-medium mb-1 capitalize">Nav: {k}</label>
                    <input
                      type="text"
                      value={websiteDraft.navLabels?.[k] || ''}
                      onChange={(e) =>
                        setWebsiteDraft({
                          ...websiteDraft,
                          navLabels: { ...websiteDraft.navLabels, [k]: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Hero Eyebrow Label</label>
                  <input
                    type="text"
                    value={websiteDraft.heroEyebrow || ''}
                    onChange={(e) => setWebsiteDraft({ ...websiteDraft, heroEyebrow: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Emblem Card Subtitle (e.g. ANALYZE, TRADE, GROW)</label>
                  <input
                    type="text"
                    value={websiteDraft.heroBadgeText || ''}
                    onChange={(e) => setWebsiteDraft({ ...websiteDraft, heroBadgeText: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Homepage Hero Title</label>
                <input
                  type="text"
                  value={websiteDraft.heroTitle}
                  onChange={(e) => setWebsiteDraft({ ...websiteDraft, heroTitle: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Homepage Hero Description</label>
                <textarea
                  rows={2}
                  value={websiteDraft.heroDescription}
                  onChange={(e) => setWebsiteDraft({ ...websiteDraft, heroDescription: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Banner CTA (Logged Out)</label>
                  <input
                    type="text"
                    value={websiteDraft.bannerCtaText || ''}
                    onChange={(e) => setWebsiteDraft({ ...websiteDraft, bannerCtaText: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Primary CTA (Logged In)</label>
                  <input
                    type="text"
                    value={websiteDraft.heroPrimaryCta || ''}
                    onChange={(e) => setWebsiteDraft({ ...websiteDraft, heroPrimaryCta: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Secondary Button Label</label>
                  <input
                    type="text"
                    value={websiteDraft.heroSecondaryCta || ''}
                    onChange={(e) => setWebsiteDraft({ ...websiteDraft, heroSecondaryCta: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              </div>

              {/* 3 Rule Pillars */}
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <label className="block text-xs font-semibold">3 Landing Pillars (Trading Rules / Smart Strategies / Consistent Results)</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(websiteDraft.pillars || []).map((p, idx) => (
                    <div key={idx} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2">
                      <input
                        type="text"
                        value={p.title}
                        onChange={(e) => {
                          const next = [...(websiteDraft.pillars || [])];
                          next[idx] = { ...p, title: e.target.value };
                          setWebsiteDraft({ ...websiteDraft, pillars: next });
                        }}
                        placeholder="Pillar title"
                        className="w-full px-2.5 py-1.5 text-xs font-semibold rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                      <input
                        type="text"
                        value={p.subtitle}
                        onChange={(e) => {
                          const next = [...(websiteDraft.pillars || [])];
                          next[idx] = { ...p, subtitle: e.target.value };
                          setWebsiteDraft({ ...websiteDraft, pillars: next });
                        }}
                        placeholder="Pillar subtitle"
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Promo Banner & Capabilities */}
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold">Promo Banner Section</label>
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={websiteDraft.promoBannerEnabled}
                      onChange={(e) => setWebsiteDraft({ ...websiteDraft, promoBannerEnabled: e.target.checked })}
                    />
                    Show Banner
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={websiteDraft.promoBannerTitle}
                    onChange={(e) => setWebsiteDraft({ ...websiteDraft, promoBannerTitle: e.target.value })}
                    placeholder="Promo Banner Title"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                  <input
                    type="text"
                    value={websiteDraft.promoBannerSubtitle}
                    onChange={(e) => setWebsiteDraft({ ...websiteDraft, promoBannerSubtitle: e.target.value })}
                    placeholder="Promo Banner Subtitle"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={websiteDraft.capabilitiesTitle || ''}
                    onChange={(e) => setWebsiteDraft({ ...websiteDraft, capabilitiesTitle: e.target.value })}
                    placeholder="Capabilities Section Heading"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                  <input
                    type="text"
                    value={websiteDraft.capabilitiesSubtitle || ''}
                    onChange={(e) => setWebsiteDraft({ ...websiteDraft, capabilitiesSubtitle: e.target.value })}
                    placeholder="Capabilities Section Subtitle"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              </div>

              {/* About, Terms, Privacy */}
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-medium mb-1">About Page Summary</label>
                  <textarea
                    rows={2}
                    value={websiteDraft.aboutSummary}
                    onChange={(e) => setWebsiteDraft({ ...websiteDraft, aboutSummary: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Terms & Conditions Content</label>
                    <textarea
                      rows={4}
                      value={websiteDraft.termsText || ''}
                      onChange={(e) => setWebsiteDraft({ ...websiteDraft, termsText: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Privacy Policy Content</label>
                    <textarea
                      rows={4}
                      value={websiteDraft.privacyText || ''}
                      onChange={(e) => setWebsiteDraft({ ...websiteDraft, privacyText: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Editable FAQs */}
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold">FAQs Editor ({(websiteDraft.faqs || []).length})</label>
                  <button
                    type="button"
                    onClick={() =>
                      setWebsiteDraft({
                        ...websiteDraft,
                        faqs: [...(websiteDraft.faqs || []), { q: 'New Question', a: 'Answer details...' }],
                      })
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-sky-600/15 text-sky-600 dark:text-sky-400 text-xs font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add FAQ
                  </button>
                </div>
                <div className="space-y-2">
                  {(websiteDraft.faqs || []).map((faq, idx) => (
                    <div key={idx} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={faq.q}
                          onChange={(e) => {
                            const next = [...(websiteDraft.faqs || [])];
                            next[idx] = { ...faq, q: e.target.value };
                            setWebsiteDraft({ ...websiteDraft, faqs: next });
                          }}
                          className="flex-1 px-2.5 py-1.5 text-xs font-semibold rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = (websiteDraft.faqs || []).filter((_, i) => i !== idx);
                            setWebsiteDraft({ ...websiteDraft, faqs: next });
                          }}
                          className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        value={faq.a}
                        onChange={(e) => {
                          const next = [...(websiteDraft.faqs || [])];
                          next[idx] = { ...faq, a: e.target.value };
                          setWebsiteDraft({ ...websiteDraft, faqs: next });
                        }}
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSaveSettingsPatch({ theme: themeDraft, website: websiteDraft }, 'All website content, theme, and legal copy saved.')}
                className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold"
              >
                Save Website Customisation
              </button>
            </div>
          </div>
        )}

        {/* 10. MARKET CONFIGURATION */}
        {section === 'markets' && (
          <div className="space-y-4">
            {/* Add New Instrument */}
            <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-4 grid grid-cols-2 sm:grid-cols-7 gap-2 items-end">
              <div>
                <label className="block text-[11px] font-medium mb-1">Symbol</label>
                <input
                  type="text"
                  value={newMarket.symbol}
                  onChange={(e) => setNewMarket({ ...newMarket, symbol: e.target.value.toUpperCase() })}
                  placeholder="USD/KES"
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium mb-1">Instrument Name</label>
                <input
                  type="text"
                  value={newMarket.name}
                  onChange={(e) => setNewMarket({ ...newMarket, name: e.target.value })}
                  placeholder="US Dollar / Kenyan Shilling"
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1">Category</label>
                <select
                  value={newMarket.category}
                  onChange={(e) => setNewMarket({ ...newMarket, category: e.target.value as MarketCategory })}
                  className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="synthetics">Synthetics</option>
                  <option value="forex">Forex</option>
                  <option value="crypto">Crypto</option>
                  <option value="stocks">Stocks</option>
                  <option value="commodities">Commodities</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1">Base Price</label>
                <input
                  type="number"
                  step="0.0001"
                  value={newMarket.basePrice}
                  onChange={(e) => setNewMarket({ ...newMarket, basePrice: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1">Payout (0-1)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newMarket.payoutRate}
                  onChange={(e) => setNewMarket({ ...newMarket, payoutRate: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!newMarket.symbol.trim() || !newMarket.name.trim()) {
                    return notify('error', 'Symbol and name are required to add a market.');
                  }
                  if (marketsDraft.some((m) => m.symbol === newMarket.symbol.trim())) {
                    return notify('error', 'That symbol already exists.');
                  }
                  const updated = [...marketsDraft, { ...newMarket, symbol: newMarket.symbol.trim() }];
                  setMarketsDraft(updated);
                  setNewMarket({ ...newMarket, symbol: '', name: '' });
                  notify('success', `Added ${newMarket.symbol.trim()}. Click Save Market Configuration to persist.`);
                }}
                className="inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-3 px-4">Instrument Name</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Base Price</th>
                    <th className="py-3 px-4">Payout</th>
                    <th className="py-3 px-4">Spread</th>
                    <th className="py-3 px-4">Volatility</th>
                    <th className="py-3 px-4 text-right">Enabled</th>
                    <th className="py-3 px-4 text-right">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {marketsDraft.map((m, idx) => (
                    <tr key={m.symbol}>
                      <td className="py-2 px-4">
                        <input
                          type="text"
                          value={m.name}
                          onChange={(e) => {
                            const copy = [...marketsDraft];
                            copy[idx] = { ...m, name: e.target.value };
                            setMarketsDraft(copy);
                          }}
                          className="w-44 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                        />
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">{m.symbol}</div>
                      </td>
                      <td className="py-2 px-4">
                        <select
                          value={m.category}
                          onChange={(e) => {
                            const copy = [...marketsDraft];
                            copy[idx] = { ...m, category: e.target.value as MarketCategory };
                            setMarketsDraft(copy);
                          }}
                          className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs capitalize"
                        >
                          <option value="synthetics">synthetics</option>
                          <option value="forex">forex</option>
                          <option value="crypto">crypto</option>
                          <option value="stocks">stocks</option>
                          <option value="commodities">commodities</option>
                        </select>
                      </td>
                      <td className="py-2 px-4">
                        <input
                          type="number"
                          step="0.0001"
                          value={m.basePrice}
                          onChange={(e) => {
                            const copy = [...marketsDraft];
                            copy[idx] = { ...m, basePrice: Number(e.target.value) };
                            setMarketsDraft(copy);
                          }}
                          className="w-24 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        />
                      </td>
                      <td className="py-2 px-4">
                        <input
                          type="number"
                          step="0.01"
                          value={m.payoutRate}
                          onChange={(e) => {
                            const copy = [...marketsDraft];
                            copy[idx] = { ...m, payoutRate: Number(e.target.value) };
                            setMarketsDraft(copy);
                          }}
                          className="w-20 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        />
                      </td>
                      <td className="py-2 px-4">
                        <input
                          type="number"
                          step="0.0001"
                          value={m.spread}
                          onChange={(e) => {
                            const copy = [...marketsDraft];
                            copy[idx] = { ...m, spread: Number(e.target.value) };
                            setMarketsDraft(copy);
                          }}
                          className="w-20 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        />
                      </td>
                      <td className="py-2 px-4">
                        <input
                          type="number"
                          step="0.0001"
                          value={m.volatility}
                          onChange={(e) => {
                            const copy = [...marketsDraft];
                            copy[idx] = { ...m, volatility: Number(e.target.value) };
                            setMarketsDraft(copy);
                          }}
                          className="w-20 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        />
                      </td>
                      <td className="py-2 px-4 text-right">
                        <input
                          type="checkbox"
                          checked={m.enabled}
                          onChange={(e) => {
                            const copy = [...marketsDraft];
                            copy[idx] = { ...m, enabled: e.target.checked };
                            setMarketsDraft(copy);
                          }}
                        />
                      </td>
                      <td className="py-2 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setMarketsDraft(marketsDraft.filter((_, i) => i !== idx))}
                          className="p-1.5 rounded text-rose-500 hover:bg-rose-500/10"
                          title="Delete market"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSaveSettingsPatch({ markets: marketsDraft }, 'Market configuration updated across workspace.')}
              className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold"
            >
              Save Market Configuration
            </button>
          </div>
        )}

        {/* 11. NOTIFICATIONS */}
        {section === 'notifications' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <form onSubmit={handleSendNotification} className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
              <h2 className="text-sm font-bold">Send Broadcast or Direct Alert</h2>
              <div>
                <label className="block text-xs font-medium mb-1">Recipient</label>
                <select
                  value={notifTarget}
                  onChange={(e) => setNotifTarget(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="all">All Traders (Platform Broadcast)</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} ({u.fullName})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Notification Title</label>
                <input
                  type="text"
                  value={notifTitle}
                  onChange={(e) => setNotifTitle(e.target.value)}
                  placeholder="e.g., Synthetic Volatility Schedule Update"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Message</label>
                <textarea
                  rows={4}
                  value={notifMessage}
                  onChange={(e) => setNotifMessage(e.target.value)}
                  placeholder="Write a clear notice for traders..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <button type="submit" disabled={busy} className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold">
                Broadcast Notification
              </button>
            </form>

            <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-6 space-y-3">
              <h2 className="text-sm font-bold">Notification History ({adminNotifications.length})</h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
                {adminNotifications.map((n) => (
                  <div key={n.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white">{n.title}</div>
                      <p className="text-slate-500 dark:text-slate-400 mt-0.5">{n.message}</p>
                      <div className="text-[10px] font-mono text-slate-400 mt-1">
                        Target: {n.userId} · {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await apiFetch(`/api/admin/notifications/${n.id}`, { method: 'DELETE' });
                        if (res.ok) {
                          notify('success', 'Notification deleted.');
                          await fetchAllAdminData();
                        }
                      }}
                      className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 12. FEATURE MANAGEMENT */}
        {section === 'features' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(Object.keys(featuresDraft) as (keyof FeatureFlags)[]).map((key) => {
              const enabled = featuresDraft[key];
              return (
                <div key={key} className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</div>
                    <div className="text-xs text-slate-500">{enabled ? 'Active in workspace' : 'Disabled platform-wide'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleToggleFeature(key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      enabled ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                    }`}
                  >
                    {enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* 13. PLATFORM SETTINGS */}
        {section === 'settings' && (
          <div className="max-w-2xl rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Default Demo Starting Balance (USD)</label>
                <input
                  type="number"
                  value={dashboardDraft.defaultDemoBalance}
                  onChange={(e) => setDashboardDraft({ ...dashboardDraft, defaultDemoBalance: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Default Chart Timeframe</label>
                <select
                  value={dashboardDraft.defaultChartTimeframe}
                  onChange={(e) => setDashboardDraft({ ...dashboardDraft, defaultChartTimeframe: e.target.value as any })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  {['1T', '1m', '5m', '15m', '1h', '4h', '24h'].map((tf) => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Default Currency</label>
                <select
                  value={dashboardDraft.defaultCurrency}
                  onChange={(e) => setDashboardDraft({ ...dashboardDraft, defaultCurrency: e.target.value as any })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="USD">USD</option>
                  <option value="KSH">KSH</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Default Language</label>
                <input
                  type="text"
                  value={dashboardDraft.defaultLanguage}
                  onChange={(e) => setDashboardDraft({ ...dashboardDraft, defaultLanguage: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Default Timezone</label>
                <input
                  type="text"
                  value={dashboardDraft.defaultTimezone}
                  onChange={(e) => setDashboardDraft({ ...dashboardDraft, defaultTimezone: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Default Watchlist Symbols (comma-separated)</label>
                <input
                  type="text"
                  value={(dashboardDraft.defaultWatchlist || []).join(', ')}
                  onChange={(e) =>
                    setDashboardDraft({
                      ...dashboardDraft,
                      defaultWatchlist: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Dashboard Welcome Ticker</label>
              <input
                type="text"
                value={dashboardDraft.welcomeMessage}
                onChange={(e) => setDashboardDraft({ ...dashboardDraft, welcomeMessage: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSaveSettingsPatch({ dashboard: dashboardDraft }, 'Default platform settings persisted.')}
              className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold"
            >
              Save Platform Settings
            </button>
          </div>
        )}

        {/* 14. AUDIT LOGS */}
        {section === 'audit' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {['', 'auth', 'user', 'account', 'balance', 'pnl', 'branding', 'logo', 'settings', 'features', 'notification'].map((t) => (
                <button
                  key={t || 'all'}
                  type="button"
                  onClick={() => setAuditFilter(t)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize ${
                    auditFilter === t ? 'bg-sky-600 text-white' : 'bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {t || 'All Events'}
                </button>
              ))}
            </div>
            <div className="rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Scope</th>
                    <th className="py-3 px-4">Details</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {auditLogs
                    .filter((l) => !auditFilter || l.targetType === auditFilter)
                    .map((l) => (
                      <tr key={l.id}>
                        <td className="py-2.5 px-4 font-mono text-[11px] whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                        <td className="py-2.5 px-4 font-semibold">{l.action}</td>
                        <td className="py-2.5 px-4 uppercase text-[11px]">{l.targetType}</td>
                        <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{l.details}</td>
                        <td className="py-2.5 px-4">
                          <span className={`px-2 py-0.5 rounded font-semibold ${l.status === 'success' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600'}`}>
                            {l.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 15. SECURITY SETTINGS */}
        {section === 'security' && (
          <form onSubmit={handleSaveSecurity} className="max-w-lg rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="w-4 h-4 text-sky-500" />
              Administrator Credential & Session Policy
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Admin Session Duration (Hours, 1–72)</label>
              <input
                type="number"
                min={1}
                max={72}
                value={ttlHours}
                onChange={(e) => setTtlHours(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Rotate Administrator Password (Optional)</label>
              <div className="relative">
                <input
                  type={showAdminSecPw ? 'text' : 'password'}
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full px-3 pr-10 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setShowAdminSecPw((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400"
                >
                  {showAdminSecPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Confirm New Administrator Password</label>
              <input
                type={showAdminSecPw ? 'text' : 'password'}
                value={confirmAdminPassword}
                onChange={(e) => setConfirmAdminPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <button type="submit" disabled={busy} className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold">
              Update Security Settings
            </button>
          </form>
        )}
      </main>

      {/* User Inspection & Full Edit Modal */}
      {inspectedUser && editUserDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">Inspect & Edit Trader: {inspectedUser.user.email}</h3>
              <button type="button" onClick={() => setInspectedUser(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveUserEdit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium mb-1">Email Address</label>
                <input
                  type="email"
                  value={editUserDraft.email}
                  onChange={(e) => setEditUserDraft({ ...editUserDraft, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Full Name</label>
                <input
                  type="text"
                  value={editUserDraft.fullName}
                  onChange={(e) => setEditUserDraft({ ...editUserDraft, fullName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Phone</label>
                <input
                  type="text"
                  value={editUserDraft.phone}
                  onChange={(e) => setEditUserDraft({ ...editUserDraft, phone: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Country</label>
                <input
                  type="text"
                  value={editUserDraft.country}
                  onChange={(e) => setEditUserDraft({ ...editUserDraft, country: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Preferred Currency</label>
                <select
                  value={editUserDraft.preferredCurrency}
                  onChange={(e) => setEditUserDraft({ ...editUserDraft, preferredCurrency: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="USD">USD</option>
                  <option value="KSH">KSH</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Account Status</label>
                <select
                  value={editUserDraft.status}
                  onChange={(e) => setEditUserDraft({ ...editUserDraft, status: e.target.value as 'active' | 'suspended' })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium mb-1">Reset User Password (Optional, min 6 chars)</label>
                <input
                  type="text"
                  value={editUserDraft.newPassword || ''}
                  onChange={(e) => setEditUserDraft({ ...editUserDraft, newPassword: e.target.value })}
                  placeholder="Leave blank to keep existing password"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={editUserDraft.emailVerified}
                  onChange={(e) => setEditUserDraft({ ...editUserDraft, emailVerified: e.target.checked })}
                />
                Email Verified
              </label>
              <div className="sm:col-span-2 flex justify-end">
                <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-sky-600 text-white font-semibold">
                  Save User Updates
                </button>
              </div>
            </form>
            <div>
              <h4 className="text-xs font-semibold mb-2">User Accounts ({inspectedUser.accounts.length})</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {inspectedUser.accounts.map((a) => (
                  <div key={a.accountId} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex justify-between">
                    <span className="font-mono font-semibold">{a.accountId} ({a.accountType.toUpperCase()})</span>
                    <span className="font-mono font-bold">${a.balance.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-[#0f1724] border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold">{confirmAction.title}</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{confirmAction.description}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await confirmAction.onConfirm();
                    setConfirmAction(null);
                  } catch (err: any) {
                    notify('error', err?.message || 'Action failed.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className={`px-4 py-2 rounded-lg text-white text-xs font-semibold ${
                  confirmAction.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-sky-600 hover:bg-sky-700'
                }`}
              >
                {busy ? 'Applying...' : confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
