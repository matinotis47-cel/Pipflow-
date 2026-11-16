import WebSocket from 'ws';

export interface DerivLinkedAccount {
  accountId: string; // e.g. CR123456 or VRTC123456
  currency: 'USD' | 'KSH' | 'EUR' | 'GBP';
  isVirtual: boolean;
  balance: number;
}

export interface VerifiedDerivSession {
  loginid: string;
  email: string;
  fullname: string;
  country: string;
  currency: 'USD' | 'KSH' | 'EUR' | 'GBP';
  balance: number;
  isVirtual: boolean;
  authorizedScopes: string;
  accountList: DerivLinkedAccount[];
}

export interface DerivOAuthTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
  tokenType: string;
  scope: string;
}

export interface DerivReadCredentials {
  authType?: 'oauth' | 'pat';
  patToken?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  onTokenRefreshed?: (tokens: DerivOAuthTokenSet) => void | Promise<void>;
}

export function getDerivAppId(): string {
  const raw = (process.env.DERIV_APP_ID || '').trim();
  return raw || '1089';
}

export function getDerivAuthBase(): string {
  return ((process.env.DERIV_AUTH_BASE || '').trim() || 'https://auth.deriv.com').replace(/\/+$/, '');
}

export function getDerivApiBase(): string {
  return ((process.env.DERIV_API_BASE || '').trim() || 'https://api.deriv.com').replace(/\/+$/, '');
}

export function getDerivDefaultRedirectUri(): string {
  const explicit = (process.env.DERIV_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const appUrl = ((process.env.APP_URL || '').trim() || 'http://localhost:3000').replace(/\/+$/, '');
  return `${appUrl}/auth/callback`;
}

export function getDerivCommissionRate(): number {
  const rate = Number(process.env.DERIV_COMMISSION_RATE || '0.015');
  return Number.isFinite(rate) && rate >= 0 ? rate : 0.015;
}

export function getDerivConfigStatus(): {
  appId: string;
  customAppIdSet: boolean;
  masterTokenSet: boolean;
  affiliateTokenSet: boolean;
  oauthClientSecretSet: boolean;
  redirectUri: string;
  authBase: string;
  apiBase: string;
  commissionRate: number;
  readOnlyMode: true;
  allowedScope: 'read';
} {
  return {
    appId: getDerivAppId(),
    customAppIdSet: Boolean((process.env.DERIV_APP_ID || '').trim()),
    masterTokenSet: Boolean((process.env.DERIV_API_TOKEN || '').trim()),
    affiliateTokenSet: Boolean((process.env.DERIV_AFFILIATE_TOKEN || '').trim()),
    oauthClientSecretSet: Boolean((process.env.DERIV_CLIENT_SECRET || '').trim()),
    redirectUri: getDerivDefaultRedirectUri(),
    authBase: getDerivAuthBase(),
    apiBase: getDerivApiBase(),
    commissionRate: getDerivCommissionRate(),
    readOnlyMode: true,
    allowedScope: 'read',
  };
}

function normalizeCurrency(curr?: string): 'USD' | 'KSH' | 'EUR' | 'GBP' {
  const upper = String(curr || 'USD').toUpperCase();
  if (upper === 'KES' || upper === 'KSH') return 'KSH';
  if (upper === 'EUR') return 'EUR';
  if (upper === 'GBP') return 'GBP';
  return 'USD';
}

export function mapMarketSymbolForDeriv(symbol: string): string {
  const map: Record<string, string> = {
    R_100_1S: '1HZ100V',
    R_100: 'R_100',
    R_75: 'R_75',
    R_50: 'R_50',
    R_25: 'R_25',
    R_10: 'R_10',
    'EUR/USD': 'frxEURUSD',
    'GBP/USD': 'frxGBPUSD',
    'USD/JPY': 'frxUSDJPY',
    'AUD/USD': 'frxAUDUSD',
    'BTC/USD': 'cryBTCUSD',
    'ETH/USD': 'cryETHUSD',
    'XAU/USD': 'frxXAUUSD',
  };
  return map[symbol] || symbol;
}

/**
 * Builds Deriv OAuth 2.0 authorization URL using PKCE S256 (developers.deriv.com).
 * Strictly enforces read-only scope ('read') — never requests 'trade' permissions.
 */
export function buildDerivAuthorizeUrl(params: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const authBase = getDerivAuthBase();
  const url = new URL(`${authBase}/oauth2/auth`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', getDerivAppId());
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  url.searchParams.set('scope', 'read');
  return url.toString();
}

/**
 * Exchanges an OAuth 2.0 authorization code for access_token & refresh_token server-side.
 */
export async function exchangeDerivOAuthCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<DerivOAuthTokenSet> {
  const authBase = getDerivAuthBase();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: getDerivAppId(),
    code_verifier: params.codeVerifier,
  });

  const clientSecret = (process.env.DERIV_CLIENT_SECRET || '').trim();
  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const res = await fetch(`${authBase}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data?.access_token) {
    const msg = data?.error_description || data?.error || `Deriv OAuth token exchange failed (${res.status})`;
    throw new Error(String(msg));
  }

  const expiresIn = Number(data.expires_in) || 3600;
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token || ''),
    expiresIn,
    expiresAt: Date.now() + expiresIn * 1000,
    tokenType: String(data.token_type || 'Bearer'),
    scope: String(data.scope || 'read'),
  };
}

/**
 * Refreshes an expired Deriv OAuth 2.0 access token using refresh_token.
 */
export async function refreshDerivAccessToken(refreshToken: string): Promise<DerivOAuthTokenSet> {
  if (!refreshToken) {
    throw new Error('Deriv refresh token missing. Please reconnect via Deriv OAuth.');
  }
  const authBase = getDerivAuthBase();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: getDerivAppId(),
  });
  const clientSecret = (process.env.DERIV_CLIENT_SECRET || '').trim();
  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const res = await fetch(`${authBase}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data?.access_token) {
    const msg = data?.error_description || data?.error || `Deriv token refresh failed (${res.status})`;
    throw new Error(String(msg));
  }

  const expiresIn = Number(data.expires_in) || 3600;
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token || refreshToken),
    expiresIn,
    expiresAt: Date.now() + expiresIn * 1000,
    tokenType: String(data.token_type || 'Bearer'),
    scope: String(data.scope || 'read'),
  };
}

/**
 * Authenticated read-only REST request helper for api.deriv.com.
 * Injects Deriv-App-ID header as required by official Deriv documentation.
 */
export async function derivRestFetch<T = any>(
  path: string,
  options: {
    bearerToken: string;
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    timeoutMs?: number;
  }
): Promise<T> {
  const apiBase = getDerivApiBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.bearerToken.trim()}`,
      'Deriv-App-ID': getDerivAppId(),
      Accept: 'application/json',
    };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${apiBase}${path.startsWith('/') ? path : `/${path}`}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const errMsg =
        data?.error?.message ||
        data?.message ||
        data?.error_description ||
        `Deriv REST API error (${res.status})`;
      throw new Error(String(errMsg));
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

function extractRestAccounts(raw: any): DerivLinkedAccount[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.data?.accounts)
        ? raw.data.accounts
        : Array.isArray(raw?.accounts)
          ? raw.accounts
          : [];

  return list
    .filter((a: any) => a && (a.account_id || a.loginid || a.id) && !a.is_disabled)
    .map((a: any) => {
      const accountId = String(a.account_id || a.loginid || a.id);
      const isVirtual = Boolean(
        a.is_virtual ??
          a.is_demo ??
          (String(a.account_type || a.type || '').toLowerCase() === 'demo' || accountId.startsWith('VRTC'))
      );
      return {
        accountId,
        currency: normalizeCurrency(a.currency),
        isVirtual,
        balance: Number(Number(a.balance ?? 0).toFixed(2)),
      };
    });
}

/**
 * Lists accounts via Deriv REST API (/trading/v1/options/accounts) in read-only mode.
 */
export async function fetchDerivAccountsViaRest(bearerToken: string): Promise<DerivLinkedAccount[]> {
  const resp = await derivRestFetch<any>('/trading/v1/options/accounts', {
    bearerToken,
    method: 'GET',
  });
  return extractRestAccounts(resp);
}

/**
 * Generates a single-use read-only authenticated WebSocket URL via Deriv REST OTP endpoint.
 * Used exclusively to read account balance when REST omits it.
 */
export async function getDerivOtpWsUrl(bearerToken: string, accountId: string): Promise<string> {
  const resp = await derivRestFetch<any>(
    `/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
    {
      bearerToken,
      method: 'POST',
    }
  );
  const otpUrl = String(resp?.data?.url || resp?.url || '').trim();
  if (!otpUrl.startsWith('wss://') && !otpUrl.startsWith('ws://')) {
    throw new Error('Deriv OTP endpoint did not return a valid authenticated WebSocket URL.');
  }
  return otpUrl;
}

async function withOtpWebSocket<T>(
  otpUrl: string,
  handler: (send: (payload: Record<string, unknown>) => Promise<any>) => Promise<T>,
  timeoutMs = 15000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let reqCounter = 1;
    const pending = new Map<number, { resolve: (d: any) => void; reject: (e: Error) => void }>();

    const ws = new WebSocket(otpUrl, { perMessageDeflate: false });
    const overallTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error('Deriv OTP WebSocket connection timed out. Please retry.'));
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(overallTimer);
      for (const [, waiter] of pending) {
        waiter.reject(new Error('OTP WebSocket closed before receiving response.'));
      }
      pending.clear();
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        // ignore
      }
    };

    const send = (payload: Record<string, unknown>) => {
      return new Promise<any>((res, rej) => {
        if (ws.readyState !== WebSocket.OPEN) {
          rej(new Error('Deriv OTP WebSocket is not open.'));
          return;
        }
        const id = reqCounter++;
        pending.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ ...payload, req_id: id, id }));
      });
    };

    ws.on('open', async () => {
      try {
        const result = await handler(send);
        if (!settled) {
          settled = true;
          cleanup();
          resolve(result);
        }
      } catch (err: any) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const id = typeof msg?.req_id === 'number' ? msg.req_id : typeof msg?.id === 'number' ? msg.id : null;
        if (id !== null && pending.has(id)) {
          const waiter = pending.get(id)!;
          pending.delete(id);
          if (msg.error) {
            waiter.reject(new Error(msg.error.message || 'Deriv API returned an error.'));
          } else {
            waiter.resolve(msg);
          }
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(err?.message || 'Unable to reach Deriv OTP WebSocket server.'));
      }
    });

    ws.on('close', () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Deriv OTP WebSocket disconnected unexpectedly.'));
      }
    });
  });
}

/**
 * Legacy WebSocket v3 read-only session (wss://ws.derivws.com/websockets/v3?app_id=...).
 * Used strictly for read-only authorize + balance inspection (zero trade placement).
 */
async function withLegacyDerivSession<T>(
  token: string,
  handler: (send: (payload: Record<string, unknown>) => Promise<any>, authData: any) => Promise<T>,
  timeoutMs = 15000
): Promise<T> {
  const appId = getDerivAppId();
  const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let reqCounter = 1;
    const pending = new Map<number, { resolve: (d: any) => void; reject: (e: Error) => void }>();

    const ws = new WebSocket(wsUrl);
    const overallTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error('Deriv WebSocket connection timed out. Please retry.'));
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(overallTimer);
      for (const [, waiter] of pending) {
        waiter.reject(new Error('WebSocket connection closed before response.'));
      }
      pending.clear();
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        // ignore
      }
    };

    const send = (payload: Record<string, unknown>) => {
      return new Promise<any>((res, rej) => {
        if (ws.readyState !== WebSocket.OPEN) {
          rej(new Error('Deriv WebSocket is not open.'));
          return;
        }
        const id = reqCounter++;
        pending.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ ...payload, req_id: id }));
      });
    };

    ws.on('open', async () => {
      try {
        const authRes = await send({ authorize: token.trim() });
        if (authRes?.error) {
          throw new Error(authRes.error.message || 'Deriv API token authorization failed.');
        }
        const result = await handler(send, authRes);
        if (!settled) {
          settled = true;
          cleanup();
          resolve(result);
        }
      } catch (err: any) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const id = msg?.req_id;
        if (typeof id === 'number' && pending.has(id)) {
          const waiter = pending.get(id)!;
          pending.delete(id);
          if (msg.error) {
            waiter.reject(new Error(msg.error.message || 'Deriv API returned an error.'));
          } else {
            waiter.resolve(msg);
          }
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(err?.message || 'Unable to reach Deriv WebSocket server.'));
      }
    });

    ws.on('close', () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Deriv WebSocket disconnected unexpectedly.'));
      }
    });
  });
}

/**
 * Verifies an OAuth 2.0 session using Deriv REST (/trading/v1/options/accounts)
 * in strict read-only mode.
 */
export async function verifyDerivOAuthSession(accessToken: string): Promise<VerifiedDerivSession> {
  const accountList = await fetchDerivAccountsViaRest(accessToken);
  if (!accountList.length) {
    throw new Error('No active Deriv trading accounts returned for this OAuth session.');
  }

  let email = '';
  let fullname = '';
  let country = 'International';

  try {
    const profile = await derivRestFetch<any>('/trading/v1/options/profile', {
      bearerToken: accessToken,
      method: 'GET',
      timeoutMs: 6000,
    }).catch(() => null);
    const pData = profile?.data || profile;
    if (pData) {
      email = String(pData.email || '').toLowerCase();
      fullname = String(pData.fullname || pData.full_name || pData.name || '');
      country = String(pData.country || 'International');
    }
  } catch {
    // Profile endpoint is optional
  }

  const primary = accountList.find((a) => !a.isVirtual) || accountList[0];

  if (primary && (primary.balance === 0 || accountList.every((a) => a.balance === 0))) {
    try {
      const otpUrl = await getDerivOtpWsUrl(accessToken, primary.accountId);
      const balRes = await withOtpWebSocket(otpUrl, (send) => send({ balance: 1 }), 8000);
      if (balRes?.balance?.balance !== undefined) {
        primary.balance = Number(Number(balRes.balance.balance).toFixed(2));
      }
    } catch {
      // Non-fatal
    }
  }

  return {
    loginid: primary.accountId,
    email: email || `${primary.accountId.toLowerCase()}@deriv.pipflow.site`,
    fullname: fullname || `Deriv Trader (${primary.accountId})`,
    country,
    currency: primary.currency,
    balance: primary.balance,
    isVirtual: primary.isVirtual,
    authorizedScopes: 'read',
    accountList,
  };
}

/**
 * Verifies a user's Deriv API Token / PAT in read-only mode.
 * Returns account identifiers, currencies, Demo vs Real status, and balances.
 */
export async function verifyDerivToken(token: string): Promise<VerifiedDerivSession> {
  const cleaned = (token || '').trim();
  if (cleaned.length < 8) {
    throw new Error('Please provide a valid Deriv API token.');
  }

  try {
    return await withLegacyDerivSession(cleaned, async (send, authData) => {
      const auth = authData.authorize || {};
      let balancesMap: Record<string, { balance: number; currency: string }> = {};

      try {
        const balRes = await send({ balance: 1, account: 'all' });
        if (balRes?.balance?.accounts) {
          balancesMap = balRes.balance.accounts;
        }
      } catch {
        // Fallback when token omits multi-account balance query
      }

      const rawAccounts = Array.isArray(auth.account_list) ? auth.account_list : [];
      const mappedAccounts: DerivLinkedAccount[] = rawAccounts
        .filter((a: any) => !a.is_disabled && a.loginid)
        .map((a: any) => {
          const bEntry = balancesMap[a.loginid];
          const fallbackBal = a.loginid === auth.loginid ? Number(auth.balance || 0) : 0;
          return {
            accountId: String(a.loginid),
            currency: normalizeCurrency(bEntry?.currency || a.currency || auth.currency),
            isVirtual: Boolean(a.is_virtual),
            balance: Number((bEntry?.balance ?? fallbackBal).toFixed(2)),
          };
        });

      if (mappedAccounts.length === 0 && auth.loginid) {
        mappedAccounts.push({
          accountId: String(auth.loginid),
          currency: normalizeCurrency(auth.currency),
          isVirtual: Boolean(auth.is_virtual),
          balance: Number(Number(auth.balance || 0).toFixed(2)),
        });
      }

      const scopesArr = Array.isArray(auth.scopes) ? auth.scopes : ['read'];
      return {
        loginid: String(auth.loginid || ''),
        email: String(auth.email || '').toLowerCase(),
        fullname: String(auth.fullname || auth.loginid || 'Deriv Trader'),
        country: String(auth.country || 'International'),
        currency: normalizeCurrency(auth.currency),
        balance: Number(Number(auth.balance || 0).toFixed(2)),
        isVirtual: Boolean(auth.is_virtual),
        authorizedScopes: scopesArr.includes('read') ? 'read' : String(scopesArr.join(',')),
        accountList: mappedAccounts,
      };
    });
  } catch (wsErr) {
    try {
      return await verifyDerivOAuthSession(cleaned);
    } catch {
      throw wsErr;
    }
  }
}

async function resolveUsableAccessToken(creds: DerivReadCredentials): Promise<string> {
  let token = (creds.accessToken || '').trim();
  if (!token) return '';
  const needsRefresh =
    typeof creds.expiresAt === 'number' && creds.expiresAt <= Date.now() + 60_000;
  if (needsRefresh && creds.refreshToken) {
    const refreshed = await refreshDerivAccessToken(creds.refreshToken);
    token = refreshed.accessToken;
    if (creds.onTokenRefreshed) {
      await creds.onTokenRefreshed(refreshed);
    }
  }
  return token;
}

/**
 * Fetches live read-only balances across all linked Real & Demo accounts.
 */
export async function fetchDerivBalancesWithCreds(
  creds: DerivReadCredentials
): Promise<DerivLinkedAccount[]> {
  const accessToken = await resolveUsableAccessToken(creds);
  if (accessToken) {
    try {
      return await fetchDerivAccountsViaRest(accessToken);
    } catch (err) {
      if (!creds.patToken) throw err;
    }
  }
  if (creds.patToken) {
    const session = await verifyDerivToken(creds.patToken);
    return session.accountList;
  }
  throw new Error('No Deriv credentials connected.');
}

export async function fetchDerivBalances(token: string): Promise<DerivLinkedAccount[]> {
  const session = await verifyDerivToken(token);
  return session.accountList;
}

/**
 * Attempts clean remote authorization revocation on Deriv where supported,
 * and always resolves cleanly so local token wiping proceeds deterministically.
 */
export async function revokeDerivAuthorization(creds: {
  patToken?: string;
  accessToken?: string;
}): Promise<{ remoteRevoked: boolean }> {
  const appIdNum = Number(getDerivAppId());
  if (creds.patToken && Number.isFinite(appIdNum)) {
    try {
      await withLegacyDerivSession(
        creds.patToken,
        async (send) => {
          await send({ revoke_oauth_app: appIdNum });
          return true;
        },
        7000
      );
      return { remoteRevoked: true };
    } catch {
      return { remoteRevoked: false };
    }
  }
  return { remoteRevoked: false };
}
