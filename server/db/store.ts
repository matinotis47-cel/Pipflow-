import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
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
import { generateAccountNumber, generateId, initAuthSecret } from '../security/crypto.ts';

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
  accounts: Record<string, TradingAccount>;
  trades: TradeRecord[];
  transactions: TransactionRecord[];
  pnlAdjustments: PnlAdjustmentRecord[];
  notifications: AppNotification[];
  watchlists: Record<string, string[]>;
  auditLogs: AdminAuditLog[];
  contactSubmissions: ContactSubmission[];
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'pipflow-store.json');
const DATABASE_URL = process.env.DATABASE_URL;
let pool: Pool | null = null;
let dbCache: PersistedDatabase | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function createInitialDb(): PersistedDatabase {
  return {
    authSecret: initAuthSecret(),
    // Admin credentials must be configured explicitly; no seeded password exists.
    adminPasswordHash: null,
    adminSessionTtlHours: 8,
    config: structuredClone(DEFAULT_PLATFORM_CONFIG),
    users: {},
    accounts: {},
    trades: [],
    transactions: [],
    pnlAdjustments: [],
    notifications: [],
    watchlists: {},
    auditLogs: [],
    contactSubmissions: [],
  };
}

function normalizeDb(input: PersistedDatabase): PersistedDatabase {
  const b = (input.config?.branding || {}) as Record<string, unknown>;
  const oldLogo = '/assets/aistudio/1794764098234_a3ccecdd.jpg';
  for (const slot of ['mainLogoUrl', 'dashboardLogoUrl', 'footerLogoUrl', 'faviconUrl', 'mobileLogoUrl']) {
    if (!b[slot] || b[slot] === oldLogo) b[slot] = OFFICIAL_LOGO_PATH;
  }
  const config = input.config || DEFAULT_PLATFORM_CONFIG;
  return {
    ...createInitialDb(),
    ...input,
    adminPasswordHash: input.adminPasswordHash || null,
    config: {
      ...DEFAULT_PLATFORM_CONFIG,
      ...config,
      branding: { ...DEFAULT_PLATFORM_CONFIG.branding, ...(config.branding || {}) },
      theme: { ...DEFAULT_PLATFORM_CONFIG.theme, ...(config.theme || {}) },
      dashboard: { ...DEFAULT_PLATFORM_CONFIG.dashboard, ...(config.dashboard || {}) },
      website: {
        ...DEFAULT_PLATFORM_CONFIG.website,
        ...(config.website || {}),
        pillars: config.website?.pillars?.length ? config.website.pillars : DEFAULT_PLATFORM_CONFIG.website.pillars,
        faqs: config.website?.faqs?.length ? config.website.faqs : DEFAULT_PLATFORM_CONFIG.website.faqs,
        navLabels: { ...DEFAULT_PLATFORM_CONFIG.website.navLabels, ...(config.website?.navLabels || {}) },
      },
      features: { ...DEFAULT_PLATFORM_CONFIG.features, ...(config.features || {}) },
      markets: config.markets?.length ? config.markets : DEFAULT_PLATFORM_CONFIG.markets,
    },
  };
}

function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Initialize PostgreSQL and load the persistent state before serving requests.
 * Production never imports the committed/local JSON snapshot; that file may contain old credentials.
 */
export async function initializeStorage(): Promise<void> {
  if (!DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is required in production. Configure a Neon PostgreSQL connection in Render.');
    }
    loadDb();
    return;
  }

  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: /sslmode=require/i.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  await pool.query(`CREATE TABLE IF NOT EXISTS pipflow_app_state (
    state_key TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const result = await pool.query<{ state: PersistedDatabase }>(
    'SELECT state FROM pipflow_app_state WHERE state_key = $1', ['primary']
  );
  if (result.rows[0]) {
    dbCache = normalizeDb(result.rows[0].state);
    if (process.env.AUTH_SECRET) initAuthSecret(process.env.AUTH_SECRET);
  } else {
    // Never seed the demo login/admin credentials or import the repository's .data file.
    dbCache = createInitialDb();
    await pool.query(
      'INSERT INTO pipflow_app_state (state_key, state) VALUES ($1, $2::jsonb) ON CONFLICT (state_key) DO NOTHING',
      ['primary', JSON.stringify(dbCache)]
    );
    const persisted = await pool.query<{ state: PersistedDatabase }>(
      'SELECT state FROM pipflow_app_state WHERE state_key = $1', ['primary']
    );
    if (persisted.rows[0]) dbCache = normalizeDb(persisted.rows[0].state);
  }
}

export function loadDb(): PersistedDatabase {
  if (dbCache) return dbCache;
  if (process.env.NODE_ENV === 'production' && DATABASE_URL) {
    throw new Error('Storage has not been initialized. Await initializeStorage() before handling requests.');
  }
  ensureDataDir();
  if (fs.existsSync(DATA_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as PersistedDatabase;
      if (process.env.AUTH_SECRET) initAuthSecret(process.env.AUTH_SECRET);
      dbCache = normalizeDb(parsed);
      return dbCache;
    } catch (error) {
      console.error('Unable to read local development store:', error);
    }
  }
  dbCache = createInitialDb();
  saveDb(dbCache);
  return dbCache;
}

export function saveDb(db: PersistedDatabase): void {
  dbCache = db;
  if (pool) {
    const snapshot = JSON.stringify(db);
    writeQueue = writeQueue.then(async () => {
      await pool!.query(
        `INSERT INTO pipflow_app_state (state_key, state, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (state_key) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
        ['primary', snapshot]
      );
    });
    void writeQueue.catch((error) => console.error('Failed to persist application state to PostgreSQL:', error));
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to persist production application state without DATABASE_URL.');
  }
  ensureDataDir();
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tempFile, DATA_FILE);
}

export async function flushDb(): Promise<void> {
  await writeQueue;
}

export async function closeStorage(): Promise<void> {
  await flushDb();
  await pool?.end();
}

export async function mirrorUserToFirestore(_user: StoredUser, _accounts: TradingAccount[]): Promise<void> {
  // Neon is the source of truth. Kept as a no-op for compatibility with existing route imports.
}

export function sanitizeUser(user: StoredUser): UserProfile {
  const { passwordHash: _ph, verificationCode: _vc, resetCode: _rc, resetExpiresAt: _re, ...safe } = user;
  return safe;
}

export function getUserAccounts(db: PersistedDatabase, userId: string): TradingAccount[] {
  return Object.values(db.accounts)
    .filter((account) => account.userId === userId)
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
    accountId: realId, userId, accountType: 'real', currency: db.config.dashboard.defaultCurrency || 'USD',
    balance: 0, startingBalance: 0, status: 'active', createdAt: now, updatedAt: now,
  };
  const demo: TradingAccount = {
    accountId: demoId, userId, accountType: 'demo', currency: db.config.dashboard.defaultCurrency || 'USD',
    balance: defaultDemoBalance, startingBalance: defaultDemoBalance, status: 'active', createdAt: now, updatedAt: now,
  };
  db.accounts[realId] = real;
  db.accounts[demoId] = demo;
  db.transactions.unshift({
    id: generateId('tx'), userId, accountId: demoId, accountType: 'demo', type: 'credit',
    amount: defaultDemoBalance, balanceAfter: defaultDemoBalance,
    reason: 'Initial PIPFLOW educational demo balance', createdAt: now,
  });
  return { real, demo };
}

export function appendAuditLog(
  db: PersistedDatabase,
  entry: Omit<AdminAuditLog, 'id' | 'createdAt'>
): AdminAuditLog {
  const log: AdminAuditLog = { ...entry, id: generateId('aud'), createdAt: new Date().toISOString() };
  db.auditLogs.unshift(log);
  if (db.auditLogs.length > 2000) db.auditLogs.length = 2000;
  return log;
}
