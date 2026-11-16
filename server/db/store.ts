import fs from 'fs';
import path from 'path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { DEFAULT_PLATFORM_CONFIG, OFFICIAL_LOGO_PATH } from '../../src/config/app.config.ts';
import type {
  AdminAuditLog,
  AppNotification,
  ContactSubmission,
  EmailLogRecord,
  PlatformConfig,
  PnlAdjustmentRecord,
  TradeRecord,
  TradingAccount,
  TransactionRecord,
  UserProfile,
} from '../../src/types/pipflow.ts';
import {
  decryptAtRest,
  encryptAtRest,
  generateAccountNumber,
  generateId,
  hashPassword,
  initAuthSecret,
} from '../security/crypto.ts';
import {
  consumeOAuthStateFromNeon,
  loadSnapshotFromNeon,
  saveOAuthStateToNeon,
  scheduleNeonSync,
} from './neon.ts';

export interface StoredUser extends UserProfile {
  passwordHash: string;
  derivToken?: string; // AES-256-GCM encrypted PAT / legacy API token
  derivAuthType?: 'oauth' | 'pat';
  derivAccessTokenEnc?: string; // AES-256-GCM encrypted OAuth2 access_token
  derivRefreshTokenEnc?: string; // AES-256-GCM encrypted OAuth2 refresh_token
  derivTokenExpiresAt?: number; // Epoch ms expiry for OAuth2 access_token
  verificationCode?: string;
  resetCode?: string;
  resetExpiresAt?: number;
}

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  subscription: {
    endpoint: string;
    expirationTime?: number | null;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
  userAgent?: string;
  createdAt: string;
}

export interface PersistedDatabase {
  authSecret: string;
  adminPasswordHash: string | null;
  adminSessionTtlHours: number;
  analysisAutoTradeEnabled: boolean;
  analysisAutoTradePasswordHash: string | null;
  vapidKeys?: {
    publicKey: string;
    privateKey: string;
  };
  config: PlatformConfig;
  users: Record<string, StoredUser>;
  accounts: Record<string, TradingAccount>; // keyed by accountId (ROT.../CR... or DOT.../VRTC...)
  trades: TradeRecord[];
  transactions: TransactionRecord[];
  pnlAdjustments: PnlAdjustmentRecord[];
  notifications: AppNotification[];
  pushSubscriptions: PushSubscriptionRecord[];
  watchlists: Record<string, string[]>; // userId -> symbols
  auditLogs: AdminAuditLog[];
  emailLogs: EmailLogRecord[];
  contactSubmissions: ContactSubmission[];
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'pipflow-store.json');

let firestoreDb: Firestore | null = null;
let firestoreAvailable: boolean | null = null;

function getFirestoreInstance(): Firestore | null {
  if (firestoreAvailable === false) return null;
  try {
    if (!getApps().length) {
      initializeApp({ projectId: firebaseConfig.projectId });
    }
    if (!firestoreDb) {
      firestoreDb = getFirestore(getApps()[0], firebaseConfig.firestoreDatabaseId);
    }
    return firestoreDb;
  } catch {
    firestoreAvailable = false;
    return null;
  }
}

function createInitialDb(): PersistedDatabase {
  const now = new Date().toISOString();
  const demoUserId = 'usr_pipflow_demo';
  const demoRealId = 'ROT92925799';
  const demoPracticeId = 'DOT94249715';

  const initialUser: StoredUser = {
    id: demoUserId,
    email: 'trader@pipflow.site',
    fullName: 'Alex Mercer',
    country: 'United Kingdom',
    phone: '+44 7700 900123',
    emailVerified: true,
    status: 'active',
    preferredTheme: 'dark',
    preferredCurrency: 'USD',
    preferredLanguage: 'EN',
    activeAccountId: demoPracticeId,
    passwordHash: hashPassword('PipflowDemo!2026'),
    createdAt: now,
    updatedAt: now,
  };

  const realAcc: TradingAccount = {
    accountId: demoRealId,
    userId: demoUserId,
    accountType: 'real',
    currency: 'USD',
    balance: 0,
    startingBalance: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  const demoAcc: TradingAccount = {
    accountId: demoPracticeId,
    userId: demoUserId,
    accountType: 'demo',
    currency: 'USD',
    balance: DEFAULT_PLATFORM_CONFIG.dashboard.defaultDemoBalance,
    startingBalance: DEFAULT_PLATFORM_CONFIG.dashboard.defaultDemoBalance,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  const authSecret = initAuthSecret();

  return {
    authSecret,
    adminPasswordHash: hashPassword('170Pip21218'),
    adminSessionTtlHours: 8,
    analysisAutoTradeEnabled: true,
    analysisAutoTradePasswordHash: null,
    config: structuredClone(DEFAULT_PLATFORM_CONFIG),
    users: { [demoUserId]: initialUser },
    accounts: {
      [demoRealId]: realAcc,
      [demoPracticeId]: demoAcc,
    },
    trades: [],
    transactions: [
      {
        id: generateId('tx'),
        userId: demoUserId,
        accountId: demoPracticeId,
        accountType: 'demo',
        type: 'credit',
        amount: DEFAULT_PLATFORM_CONFIG.dashboard.defaultDemoBalance,
        balanceAfter: DEFAULT_PLATFORM_CONFIG.dashboard.defaultDemoBalance,
        reason: 'Initial PIPFLOW educational demo balance',
        createdAt: now,
      },
    ],
    pnlAdjustments: [],
    notifications: [
      {
        id: generateId('ntf'),
        userId: 'all',
        title: 'Welcome to PIPFLOW',
        message: 'Your Real (ROT) and Demo (DOT) simulated trading accounts are ready. Explore Charts, Bot Builder, and the AI Profit-Only Bot.',
        category: 'announcement',
        read: false,
        createdAt: now,
      },
    ],
    pushSubscriptions: [],
    watchlists: {
      [demoUserId]: [...DEFAULT_PLATFORM_CONFIG.dashboard.defaultWatchlist],
    },
    auditLogs: [],
    emailLogs: [],
    contactSubmissions: [],
  };
}

let dbCache: PersistedDatabase | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeParsedDb(parsed: PersistedDatabase): { db: PersistedDatabase; changed: boolean } {
  initAuthSecret(parsed.authSecret);
  let changed = false;

  if (!parsed.adminPasswordHash) {
    parsed.adminPasswordHash = hashPassword('170Pip21218');
    changed = true;
  }

  if (typeof parsed.analysisAutoTradeEnabled !== 'boolean') {
    parsed.analysisAutoTradeEnabled = true;
    changed = true;
  }

  if (parsed.analysisAutoTradePasswordHash === undefined) {
    parsed.analysisAutoTradePasswordHash = null;
    changed = true;
  }

  if (!Array.isArray(parsed.pushSubscriptions)) {
    parsed.pushSubscriptions = [];
    changed = true;
  }

  if (!Array.isArray(parsed.emailLogs)) {
    parsed.emailLogs = [];
    changed = true;
  }

  const oldLogo = '/assets/aistudio/1794764098234_a3ccecdd.jpg';
  const b = (parsed.config?.branding || {}) as any;
  for (const slot of ['mainLogoUrl', 'dashboardLogoUrl', 'footerLogoUrl', 'faviconUrl', 'mobileLogoUrl'] as const) {
    if (!b[slot] || b[slot] === oldLogo) {
      b[slot] = OFFICIAL_LOGO_PATH;
      changed = true;
    }
  }

  parsed.config = {
    ...DEFAULT_PLATFORM_CONFIG,
    ...parsed.config,
    branding: { ...DEFAULT_PLATFORM_CONFIG.branding, ...(parsed.config?.branding || {}) },
    theme: { ...DEFAULT_PLATFORM_CONFIG.theme, ...(parsed.config?.theme || {}) },
    dashboard: { ...DEFAULT_PLATFORM_CONFIG.dashboard, ...(parsed.config?.dashboard || {}) },
    website: {
      ...DEFAULT_PLATFORM_CONFIG.website,
      ...(parsed.config?.website || {}),
      pillars: parsed.config?.website?.pillars?.length
        ? parsed.config.website.pillars
        : DEFAULT_PLATFORM_CONFIG.website.pillars,
      faqs: parsed.config?.website?.faqs?.length
        ? parsed.config.website.faqs
        : DEFAULT_PLATFORM_CONFIG.website.faqs,
      navLabels: {
        ...DEFAULT_PLATFORM_CONFIG.website.navLabels,
        ...(parsed.config?.website?.navLabels || {}),
      },
    },
    features: { ...DEFAULT_PLATFORM_CONFIG.features, ...(parsed.config?.features || {}) },
    markets: parsed.config?.markets?.length ? parsed.config.markets : DEFAULT_PLATFORM_CONFIG.markets,
  };

  // Ensure any legacy plaintext Deriv tokens are upgraded to AES-256-GCM encrypted at rest
  for (const u of Object.values(parsed.users || {})) {
    if (u.derivToken && !u.derivToken.startsWith('enc:v1:')) {
      u.derivToken = encryptAtRest(u.derivToken);
      changed = true;
    }
    if (u.derivAccessTokenEnc && !u.derivAccessTokenEnc.startsWith('enc:v1:')) {
      u.derivAccessTokenEnc = encryptAtRest(u.derivAccessTokenEnc);
      changed = true;
    }
    if (u.derivRefreshTokenEnc && !u.derivRefreshTokenEnc.startsWith('enc:v1:')) {
      u.derivRefreshTokenEnc = encryptAtRest(u.derivRefreshTokenEnc);
      changed = true;
    }
  }

  return { db: parsed, changed };
}

export async function hydrateDbFromNeon(): Promise<void> {
  const neonSnapshot = await loadSnapshotFromNeon();
  if (neonSnapshot) {
    const { db, changed } = normalizeParsedDb(neonSnapshot);
    dbCache = db;
    ensureDataDir();
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmpFile, DATA_FILE);
    if (changed) {
      scheduleNeonSync(db);
    }
    return;
  }

  // If Neon is configured but empty, push initial/local DB up to Neon
  const current = loadDb();
  scheduleNeonSync(current);
}

export function loadDb(): PersistedDatabase {
  if (dbCache) return dbCache;
  ensureDataDir();
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw) as PersistedDatabase;
      const { db, changed } = normalizeParsedDb(parsed);
      dbCache = db;
      if (changed) {
        saveDb(dbCache);
      }
      return dbCache;
    } catch (err) {
      console.error('Failed to parse local store, reinitializing:', err);
    }
  }
  dbCache = createInitialDb();
  saveDb(dbCache);
  return dbCache;
}

export function saveDb(db: PersistedDatabase): void {
  dbCache = db;
  ensureDataDir();
  const tmpFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpFile, DATA_FILE);

  // Best-effort async mirror to Neon PostgreSQL & Firestore
  scheduleNeonSync(db);
  void syncConfigToFirestore(db.config);
}

async function syncConfigToFirestore(config: PlatformConfig): Promise<void> {
  if (firestoreAvailable === false) return;
  const fsDb = getFirestoreInstance();
  if (!fsDb) return;
  try {
    await fsDb.collection('platform_config').doc('live').set(
      {
        section: 'live',
        branding: config.branding,
        theme: config.theme,
        dashboard: config.dashboard,
        website: config.website,
        features: config.features,
        updatedAt: config.updatedAt,
      },
      { merge: true }
    );
    firestoreAvailable = true;
  } catch {
    // Server environment lacks ADC; local atomic persistence remains authoritative
    firestoreAvailable = false;
  }
}

export async function mirrorUserToFirestore(user: StoredUser, accounts: TradingAccount[]): Promise<void> {
  if (firestoreAvailable === false) return;
  const fsDb = getFirestoreInstance();
  if (!fsDb) return;
  try {
    const clean = sanitizeUser(user);
    await fsDb.collection('users').doc(user.id).set(clean, { merge: true });
    for (const acc of accounts) {
      await fsDb.collection('users').doc(user.id).collection('accounts').doc(acc.accountId).set(acc, { merge: true });
    }
    firestoreAvailable = true;
  } catch {
    firestoreAvailable = false;
  }
}

export function sanitizeUser(user: StoredUser): UserProfile {
  const {
    passwordHash: _ph,
    derivToken: _dt,
    derivAuthType: _dat,
    derivAccessTokenEnc: _date,
    derivRefreshTokenEnc: _drte,
    derivTokenExpiresAt: _dtea,
    verificationCode: _vc,
    resetCode: _rc,
    resetExpiresAt: _re,
    ...safe
  } = user;
  return safe;
}

export interface DecryptedDerivCredentials {
  authType: 'oauth' | 'pat';
  patToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
}

export function setUserDerivCredentials(
  user: StoredUser,
  creds: {
    authType?: 'oauth' | 'pat';
    patToken?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }
): void {
  if (creds.authType) {
    user.derivAuthType = creds.authType;
  }
  if (creds.patToken !== undefined) {
    user.derivToken = creds.patToken ? encryptAtRest(creds.patToken.trim()) : undefined;
  }
  if (creds.accessToken !== undefined) {
    user.derivAccessTokenEnc = creds.accessToken ? encryptAtRest(creds.accessToken.trim()) : undefined;
  }
  if (creds.refreshToken !== undefined) {
    user.derivRefreshTokenEnc = creds.refreshToken ? encryptAtRest(creds.refreshToken.trim()) : undefined;
  }
  if (creds.expiresAt !== undefined) {
    user.derivTokenExpiresAt = creds.expiresAt;
  }
}

export function getUserDerivCredentials(user: StoredUser): DecryptedDerivCredentials {
  const patToken = decryptAtRest(user.derivToken);
  const accessToken = decryptAtRest(user.derivAccessTokenEnc);
  const refreshToken = decryptAtRest(user.derivRefreshTokenEnc);
  const authType: 'oauth' | 'pat' =
    user.derivAuthType || (accessToken ? 'oauth' : 'pat');
  return {
    authType,
    patToken,
    accessToken,
    refreshToken,
    expiresAt: user.derivTokenExpiresAt,
  };
}

export function clearUserDerivCredentials(user: StoredUser, status: 'disconnected' | 'revoked'): void {
  user.derivConnected = false;
  user.derivConnectionStatus = status;
  user.derivToken = undefined;
  user.derivAccessTokenEnc = undefined;
  user.derivRefreshTokenEnc = undefined;
  user.derivTokenExpiresAt = undefined;
  user.derivAuthType = undefined;
  if (status === 'revoked') {
    user.derivRevokedAt = new Date().toISOString();
  }
}

interface PkceMemoryEntry {
  codeVerifier: string;
  redirectUri: string;
  userId?: string;
  createdAt: number;
}

const pkceStateMemory = new Map<string, PkceMemoryEntry>();

export async function savePkceOAuthState(entry: {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  userId?: string;
}): Promise<void> {
  const now = Date.now();
  for (const [k, v] of pkceStateMemory.entries()) {
    if (now - v.createdAt > 15 * 60 * 1000) {
      pkceStateMemory.delete(k);
    }
  }
  pkceStateMemory.set(entry.state, {
    codeVerifier: entry.codeVerifier,
    redirectUri: entry.redirectUri,
    userId: entry.userId,
    createdAt: now,
  });
  await saveOAuthStateToNeon(entry.state, entry.codeVerifier, entry.redirectUri, entry.userId);
}

export async function consumePkceOAuthState(state: string): Promise<{
  codeVerifier: string;
  redirectUri: string;
  userId?: string;
} | null> {
  const mem = pkceStateMemory.get(state);
  if (mem) {
    pkceStateMemory.delete(state);
    if (Date.now() - mem.createdAt <= 15 * 60 * 1000) {
      // Also delete from Neon if mirrored
      void consumeOAuthStateFromNeon(state);
      return {
        codeVerifier: mem.codeVerifier,
        redirectUri: mem.redirectUri,
        userId: mem.userId,
      };
    }
  }
  return consumeOAuthStateFromNeon(state);
}

export function getUserAccounts(db: PersistedDatabase, userId: string): TradingAccount[] {
  return Object.values(db.accounts)
    .filter((a) => a.userId === userId)
    .sort((a, b) => (a.accountType === 'real' && b.accountType === 'demo' ? -1 : 1));
}

export function createDefaultAccountsForUser(db: PersistedDatabase, userId: string): { real: TradingAccount; demo: TradingAccount } {
  const now = new Date().toISOString();
  let realId = generateAccountNumber('real');
  while (db.accounts[realId]) realId = generateAccountNumber('real');
  let demoId = generateAccountNumber('demo');
  while (db.accounts[demoId]) demoId = generateAccountNumber('demo');

  const defaultDemoBalance = db.config.dashboard.defaultDemoBalance || 10000;

  const real: TradingAccount = {
    accountId: realId,
    userId,
    accountType: 'real',
    currency: db.config.dashboard.defaultCurrency || 'USD',
    balance: 0,
    startingBalance: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  const demo: TradingAccount = {
    accountId: demoId,
    userId,
    accountType: 'demo',
    currency: db.config.dashboard.defaultCurrency || 'USD',
    balance: defaultDemoBalance,
    startingBalance: defaultDemoBalance,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  db.accounts[realId] = real;
  db.accounts[demoId] = demo;
  db.transactions.unshift({
    id: generateId('tx'),
    userId,
    accountId: demoId,
    accountType: 'demo',
    type: 'credit',
    amount: defaultDemoBalance,
    balanceAfter: defaultDemoBalance,
    reason: 'Initial PIPFLOW educational demo balance',
    createdAt: now,
  });

  return { real, demo };
}

export function appendAuditLog(
  db: PersistedDatabase,
  entry: Omit<AdminAuditLog, 'id' | 'createdAt'>
): AdminAuditLog {
  const log: AdminAuditLog = {
    ...entry,
    id: generateId('aud'),
    createdAt: new Date().toISOString(),
  };
  db.auditLogs.unshift(log);
  if (db.auditLogs.length > 2000) {
    db.auditLogs.length = 2000;
  }
  return log;
}
