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
  PlatformConfig,
  PnlAdjustmentRecord,
  TradeRecord,
  TradingAccount,
  TransactionRecord,
  UserProfile,
} from '../../src/types/pipflow.ts';
import {
  generateAccountNumber,
  generateId,
  hashPassword,
  initAuthSecret,
} from '../security/crypto.ts';

export interface StoredUser extends UserProfile {
  passwordHash: string;
  verificationCode?: string;
  resetCode?: string;
  resetExpiresAt?: number;
}

export interface PersistedDatabase {
  authSecret: string;
  adminPasswordHash: string | null;
  adminSessionTtlHours: number;
  config: PlatformConfig;
  users: Record<string, StoredUser>;
  accounts: Record<string, TradingAccount>; // keyed by accountId (ROT... or DOT...)
  trades: TradeRecord[];
  transactions: TransactionRecord[];
  pnlAdjustments: PnlAdjustmentRecord[];
  notifications: AppNotification[];
  watchlists: Record<string, string[]>; // userId -> symbols
  auditLogs: AdminAuditLog[];
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
    watchlists: {
      [demoUserId]: [...DEFAULT_PLATFORM_CONFIG.dashboard.defaultWatchlist],
    },
    auditLogs: [],
    contactSubmissions: [],
  };
}

let dbCache: PersistedDatabase | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadDb(): PersistedDatabase {
  if (dbCache) return dbCache;
  ensureDataDir();
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw) as PersistedDatabase;
      initAuthSecret(parsed.authSecret);
      let needsSave = false;

      if (!parsed.adminPasswordHash) {
        parsed.adminPasswordHash = hashPassword('170Pip21218');
        needsSave = true;
      }

      const oldLogo = '/assets/aistudio/1794764098234_a3ccecdd.jpg';
      const b = (parsed.config?.branding || {}) as any;
      for (const slot of ['mainLogoUrl', 'dashboardLogoUrl', 'footerLogoUrl', 'faviconUrl', 'mobileLogoUrl'] as const) {
        if (!b[slot] || b[slot] === oldLogo) {
          b[slot] = OFFICIAL_LOGO_PATH;
          needsSave = true;
        }
      }

      // Merge defaults cleanly in case new config fields were added
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
      dbCache = parsed;
      if (needsSave) {
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

  // Best-effort async mirror to Firestore when server ADC is available
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
  const { passwordHash: _ph, verificationCode: _vc, resetCode: _rc, resetExpiresAt: _re, ...safe } = user;
  return safe;
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
