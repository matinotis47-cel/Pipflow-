import { Pool } from 'pg';
import type { PersistedDatabase } from './store.ts';

let pool: Pool | null = null;
let neonReady = false;
let neonLastError: string | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function getNeonPool(): Pool | null {
  const connStr = (process.env.DATABASE_URL || '').trim();
  if (!connStr) return null;
  if (!pool) {
    const needsSsl = connStr.includes('neon.tech') || connStr.includes('sslmode=require') || process.env.NODE_ENV === 'production';
    pool = new Pool({
      connectionString: connStr,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (err) => {
      neonLastError = err.message;
    });
  }
  return pool;
}

export function isNeonConnected(): boolean {
  return neonReady;
}

export function getNeonStatus(): { configured: boolean; connected: boolean; lastError: string | null } {
  return {
    configured: Boolean((process.env.DATABASE_URL || '').trim()),
    connected: neonReady,
    lastError: neonLastError,
  };
}

export async function ensureNeonSchema(): Promise<boolean> {
  const p = getNeonPool();
  if (!p) return false;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS pf_platform_kv (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pf_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT 'International',
        status TEXT NOT NULL DEFAULT 'active',
        deriv_login_id TEXT,
        deriv_connected BOOLEAN NOT NULL DEFAULT FALSE,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pf_accounts (
        account_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        account_type TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        is_live_synced BOOLEAN NOT NULL DEFAULT FALSE,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pf_trades (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        stake NUMERIC(18, 2) NOT NULL,
        profit_loss NUMERIC(18, 2) NOT NULL DEFAULT 0,
        commission_estimate NUMERIC(18, 4) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'closed',
        live_execution BOOLEAN NOT NULL DEFAULT FALSE,
        payload JSONB NOT NULL,
        opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pf_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount NUMERIC(18, 2) NOT NULL,
        balance_after NUMERIC(18, 2) NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pf_push_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        endpoint TEXT UNIQUE NOT NULL,
        subscription JSONB NOT NULL,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pf_deriv_tokens (
        user_id TEXT PRIMARY KEY,
        auth_type TEXT NOT NULL DEFAULT 'pat',
        encrypted_access_token TEXT,
        encrypted_refresh_token TEXT,
        encrypted_pat TEXT,
        expires_at BIGINT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pf_oauth_states (
        state TEXT PRIMARY KEY,
        code_verifier TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        user_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- 11 Normalized Domain Tables Required by Specification
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      INSERT INTO roles (id, name, description) VALUES
        ('role_user', 'user', 'Standard PIPFLOW trader with read-only Deriv integration access'),
        ('role_admin', 'admin', 'Platform administrator without access to raw user broker credentials'),
        ('role_auditor', 'auditor', 'Read-only compliance and diagnostic viewer')
      ON CONFLICT (id) DO NOTHING;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT 'International',
        role_id TEXT NOT NULL DEFAULT 'role_user',
        status TEXT NOT NULL DEFAULT 'active',
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS connected_accounts (
        account_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'deriv',
        account_type TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        is_live_synced BOOLEAN NOT NULL DEFAULT FALSE,
        last_synced_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS account_authorizations (
        user_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'deriv',
        deriv_login_id TEXT,
        auth_mode TEXT NOT NULL DEFAULT 'oauth',
        scopes TEXT NOT NULL DEFAULT 'read',
        status TEXT NOT NULL DEFAULT 'disconnected',
        granted_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS market_instruments (
        symbol TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        market_category TEXT NOT NULL,
        pip_decimals INTEGER NOT NULL DEFAULT 2,
        is_trading_suspended BOOLEAN NOT NULL DEFAULT FALSE,
        source TEXT NOT NULL DEFAULT 'deriv',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS market_data_cache (
        cache_key TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        candles_json JSONB NOT NULL,
        last_price NUMERIC(18, 6),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS watchlists (
        user_id TEXT PRIMARY KEY,
        symbols JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'system',
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        recipient_email TEXT NOT NULL,
        email_type TEXT NOT NULL DEFAULT 'transactional',
        subject TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_message_id TEXT,
        error_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS application_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS administrator_audit_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        details TEXT NOT NULL,
        ip_address TEXT,
        status TEXT NOT NULL DEFAULT 'success',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    neonReady = true;
    neonLastError = null;
    return true;
  } catch (err: any) {
    neonReady = false;
    neonLastError = err?.message || 'Neon connection failed';
    console.error('Neon schema init warning:', neonLastError);
    return false;
  }
}

export async function loadSnapshotFromNeon(): Promise<PersistedDatabase | null> {
  const p = getNeonPool();
  if (!p) return null;
  const ok = await ensureNeonSchema();
  if (!ok) return null;
  try {
    const res = await p.query<{ value: PersistedDatabase }>(
      `SELECT value FROM pf_platform_kv WHERE key = 'pipflow_store_snapshot' LIMIT 1`
    );
    if (res.rows[0]?.value) {
      return res.rows[0].value;
    }
    return null;
  } catch (err: any) {
    neonLastError = err?.message || 'Failed to read snapshot from Neon';
    return null;
  }
}

export async function syncSnapshotToNeon(db: PersistedDatabase): Promise<void> {
  const p = getNeonPool();
  if (!p) return;
  try {
    if (!neonReady) {
      const ok = await ensureNeonSchema();
      if (!ok) return;
    }

    // Store full snapshot for fast atomic Render boot recovery
    await p.query(
      `INSERT INTO pf_platform_kv (key, value, updated_at)
       VALUES ('pipflow_store_snapshot', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(db)]
    );

    // Also upsert normalized relational tables for Neon SQL queries & inspection
    for (const u of Object.values(db.users)) {
      await p.query(
        `INSERT INTO pf_users (id, email, full_name, phone, country, status, deriv_login_id, deriv_connected, payload, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           full_name = EXCLUDED.full_name,
           phone = EXCLUDED.phone,
           country = EXCLUDED.country,
           status = EXCLUDED.status,
           deriv_login_id = EXCLUDED.deriv_login_id,
           deriv_connected = EXCLUDED.deriv_connected,
           payload = EXCLUDED.payload,
           updated_at = NOW()`,
        [
          u.id,
          u.email,
          u.fullName,
          u.phone || '',
          u.country || 'International',
          u.status,
          u.derivLoginId || null,
          Boolean(u.derivConnected),
          JSON.stringify({
            ...u,
            passwordHash: undefined,
            derivToken: undefined,
            derivAccessTokenEnc: undefined,
            derivRefreshTokenEnc: undefined,
          }),
        ]
      );

      if (u.derivToken || u.derivAccessTokenEnc || u.derivRefreshTokenEnc) {
        await p.query(
          `INSERT INTO pf_deriv_tokens (user_id, auth_type, encrypted_access_token, encrypted_refresh_token, encrypted_pat, expires_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             auth_type = EXCLUDED.auth_type,
             encrypted_access_token = EXCLUDED.encrypted_access_token,
             encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
             encrypted_pat = EXCLUDED.encrypted_pat,
             expires_at = EXCLUDED.expires_at,
             updated_at = NOW()`,
          [
            u.id,
            u.derivAuthType || (u.derivAccessTokenEnc ? 'oauth' : 'pat'),
            u.derivAccessTokenEnc || null,
            u.derivRefreshTokenEnc || null,
            u.derivToken || null,
            u.derivTokenExpiresAt || null,
          ]
        );
      }
    }

    for (const acc of Object.values(db.accounts)) {
      await p.query(
        `INSERT INTO pf_accounts (account_id, user_id, account_type, currency, balance, status, is_live_synced, payload, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
         ON CONFLICT (account_id) DO UPDATE SET
           balance = EXCLUDED.balance,
           status = EXCLUDED.status,
           currency = EXCLUDED.currency,
           is_live_synced = EXCLUDED.is_live_synced,
           payload = EXCLUDED.payload,
           updated_at = NOW()`,
        [
          acc.accountId,
          acc.userId,
          acc.accountType,
          acc.currency,
          acc.balance,
          acc.status,
          Boolean(acc.isLiveSynced),
          JSON.stringify(acc),
        ]
      );
    }

    for (const tr of db.trades.slice(0, 100)) {
      await p.query(
        `INSERT INTO pf_trades (id, user_id, account_id, symbol, direction, stake, profit_loss, commission_estimate, status, live_execution, payload, opened_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           profit_loss = EXCLUDED.profit_loss,
           status = EXCLUDED.status,
           payload = EXCLUDED.payload`,
        [
          tr.id,
          tr.userId,
          tr.accountId,
          tr.symbol,
          tr.direction,
          tr.stake,
          tr.profitLoss,
          tr.commissionEstimate || 0,
          tr.status,
          Boolean(tr.liveExecution),
          JSON.stringify(tr),
          tr.openedAt,
        ]
      );
    }

    for (const tx of db.transactions.slice(0, 100)) {
      await p.query(
        `INSERT INTO pf_transactions (id, user_id, account_id, type, amount, balance_after, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [tx.id, tx.userId, tx.accountId, tx.type, tx.amount, tx.balanceAfter, tx.reason, tx.createdAt]
      );
    }

    // Sync the 11 normalized domain tables (zero raw tokens stored here!)
    for (const u of Object.values(db.users)) {
      await p.query(
        `INSERT INTO users (id, email, full_name, phone, country, role_id, status, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'role_user', $6, $7, $8::timestamptz, $9::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           full_name = EXCLUDED.full_name,
           phone = EXCLUDED.phone,
           country = EXCLUDED.country,
           status = EXCLUDED.status,
           email_verified = EXCLUDED.email_verified,
           updated_at = EXCLUDED.updated_at`,
        [u.id, u.email, u.fullName, u.phone || '', u.country || 'International', u.status, Boolean(u.emailVerified), u.createdAt, u.updatedAt]
      );

      const authStatus = u.derivConnectionStatus || (u.derivConnected ? 'connected' : 'disconnected');
      const mappedAuthStatus = authStatus === 'connected' ? 'active' : authStatus;
      if (u.derivLoginId || u.derivConnected || u.derivConnectionStatus) {
        await p.query(
          `INSERT INTO account_authorizations (user_id, provider, deriv_login_id, auth_mode, scopes, status, granted_at, revoked_at, updated_at)
           VALUES ($1, 'deriv', $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             deriv_login_id = EXCLUDED.deriv_login_id,
             auth_mode = EXCLUDED.auth_mode,
             scopes = EXCLUDED.scopes,
             status = EXCLUDED.status,
             granted_at = COALESCE(EXCLUDED.granted_at, account_authorizations.granted_at),
             revoked_at = EXCLUDED.revoked_at,
             updated_at = NOW()`,
          [
            u.id,
            u.derivLoginId || null,
            u.derivAuthMode || u.derivAuthType || 'oauth',
            u.derivAuthorizedScopes || 'read',
            mappedAuthStatus,
            u.derivConnectedAt || null,
            u.derivRevokedAt || null,
          ]
        );
      }
    }

    for (const acc of Object.values(db.accounts)) {
      await p.query(
        `INSERT INTO connected_accounts (account_id, user_id, provider, account_type, currency, balance, status, is_live_synced, last_synced_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, NOW())
         ON CONFLICT (account_id) DO UPDATE SET
           balance = EXCLUDED.balance,
           currency = EXCLUDED.currency,
           status = EXCLUDED.status,
           is_live_synced = EXCLUDED.is_live_synced,
           last_synced_at = EXCLUDED.last_synced_at,
           updated_at = NOW()`,
        [
          acc.accountId,
          acc.userId,
          acc.isLiveSynced ? 'deriv' : 'pipflow',
          acc.accountType,
          acc.currency,
          acc.balance,
          acc.status,
          Boolean(acc.isLiveSynced),
          acc.updatedAt,
        ]
      );
    }

    for (const [uid, syms] of Object.entries(db.watchlists || {})) {
      await p.query(
        `INSERT INTO watchlists (user_id, symbols, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id) DO UPDATE SET symbols = EXCLUDED.symbols, updated_at = NOW()`,
        [uid, JSON.stringify(syms)]
      );
    }

    for (const n of (db.notifications || []).slice(0, 80)) {
      await p.query(
        `INSERT INTO notifications (id, user_id, title, message, category, is_read, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
         ON CONFLICT (id) DO UPDATE SET is_read = EXCLUDED.is_read`,
        [n.id, n.userId, n.title, n.message, n.category, Boolean(n.read), n.createdAt]
      );
    }

    for (const el of (db.emailLogs || []).slice(0, 80)) {
      await p.query(
        `INSERT INTO email_logs (id, recipient_email, email_type, subject, status, provider_message_id, error_reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [el.id, el.recipientEmail, el.emailType, el.subject, el.status, el.providerMessageId || null, el.errorReason || null, el.createdAt]
      );
    }

    await p.query(
      `INSERT INTO application_settings (setting_key, setting_value, updated_at)
       VALUES ('platform_config', $1::jsonb, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
      [JSON.stringify(db.config)]
    );

    for (const log of (db.auditLogs || []).slice(0, 120)) {
      await p.query(
        `INSERT INTO administrator_audit_logs (id, action, actor, target_type, target_id, details, ip_address, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [log.id, log.action, log.actor, log.targetType, log.targetId || null, log.details, log.ip || null, log.status, log.createdAt]
      );
    }

    neonReady = true;
    neonLastError = null;
  } catch (err: any) {
    neonLastError = err?.message || 'Neon sync failed';
    console.error('Neon sync error:', neonLastError);
  }
}

export function scheduleNeonSync(db: PersistedDatabase): void {
  if (!getNeonPool()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void syncSnapshotToNeon(db);
  }, 250);
}

export async function saveOAuthStateToNeon(
  state: string,
  codeVerifier: string,
  redirectUri: string,
  userId?: string
): Promise<void> {
  const p = getNeonPool();
  if (!p) return;
  try {
    if (!neonReady) await ensureNeonSchema();
    await p.query(
      `DELETE FROM pf_oauth_states WHERE created_at < NOW() - INTERVAL '15 minutes'`
    );
    await p.query(
      `INSERT INTO pf_oauth_states (state, code_verifier, redirect_uri, user_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (state) DO UPDATE SET
         code_verifier = EXCLUDED.code_verifier,
         redirect_uri = EXCLUDED.redirect_uri,
         user_id = EXCLUDED.user_id,
         created_at = NOW()`,
      [state, codeVerifier, redirectUri, userId || null]
    );
  } catch {
    // Non-fatal: in-memory PKCE map still holds the state for single-instance runtimes
  }
}

export async function consumeOAuthStateFromNeon(state: string): Promise<{
  codeVerifier: string;
  redirectUri: string;
  userId?: string;
} | null> {
  const p = getNeonPool();
  if (!p) return null;
  try {
    if (!neonReady) await ensureNeonSchema();
    const res = await p.query<{
      code_verifier: string;
      redirect_uri: string;
      user_id: string | null;
    }>(
      `DELETE FROM pf_oauth_states
       WHERE state = $1 AND created_at >= NOW() - INTERVAL '15 minutes'
       RETURNING code_verifier, redirect_uri, user_id`,
      [state]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      codeVerifier: row.code_verifier,
      redirectUri: row.redirect_uri,
      userId: row.user_id || undefined,
    };
  } catch {
    return null;
  }
}

export async function upsertMarketInstrumentsInNeon(
  instruments: Array<{
    symbol: string;
    displayName: string;
    category: string;
    pipDecimals: number;
    suspended?: boolean;
    source?: string;
  }>
): Promise<void> {
  const p = getNeonPool();
  if (!p || !instruments.length) return;
  try {
    if (!neonReady) await ensureNeonSchema();
    for (const inst of instruments.slice(0, 200)) {
      await p.query(
        `INSERT INTO market_instruments (symbol, display_name, market_category, pip_decimals, is_trading_suspended, source, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (symbol) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           market_category = EXCLUDED.market_category,
           pip_decimals = EXCLUDED.pip_decimals,
           is_trading_suspended = EXCLUDED.is_trading_suspended,
           updated_at = NOW()`,
        [inst.symbol, inst.displayName, inst.category, inst.pipDecimals, Boolean(inst.suspended), inst.source || 'deriv']
      );
    }
  } catch {
    // Non-fatal
  }
}

export async function saveMarketDataCacheInNeon(
  symbol: string,
  timeframe: string,
  candles: unknown[],
  lastPrice: number
): Promise<void> {
  const p = getNeonPool();
  if (!p) return;
  try {
    if (!neonReady) await ensureNeonSchema();
    const cacheKey = `${symbol}:${timeframe}`;
    await p.query(
      `INSERT INTO market_data_cache (cache_key, symbol, timeframe, candles_json, last_price, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
       ON CONFLICT (cache_key) DO UPDATE SET
         candles_json = EXCLUDED.candles_json,
         last_price = EXCLUDED.last_price,
         updated_at = NOW()`,
      [cacheKey, symbol, timeframe, JSON.stringify(candles.slice(-200)), lastPrice]
    );
  } catch {
    // Non-fatal
  }
}


