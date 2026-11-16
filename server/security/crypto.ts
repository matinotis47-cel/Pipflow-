import crypto from 'crypto';
import bcrypt from 'bcryptjs';

let runtimeSecret = process.env.AUTH_SECRET || '';

export function initAuthSecret(persistedSecret?: string): string {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16) {
    runtimeSecret = process.env.AUTH_SECRET;
  } else if (persistedSecret && persistedSecret.length >= 16) {
    runtimeSecret = persistedSecret;
  } else if (!runtimeSecret) {
    runtimeSecret = crypto.randomBytes(32).toString('hex');
  }
  return runtimeSecret;
}

export function getAuthSecret(): string {
  if (!runtimeSecret) {
    return initAuthSecret();
  }
  return runtimeSecret;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !password) return false;

  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    try {
      return await bcrypt.compare(password, storedHash);
    } catch {
      return false;
    }
  }

  if (storedHash.startsWith('scrypt:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 3) return false;
    const [, salt, hexHash] = parts;
    const expectedBuf = Buffer.from(hexHash, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (expectedBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, derivedBuf);
  }

  // Fallback salt:hash format
  if (storedHash.includes(':')) {
    const [salt, hexHash] = storedHash.split(':');
    if (!salt || !hexHash) return false;
    const expectedBuf = Buffer.from(hexHash, 'hex');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    if (expectedBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, derivedBuf);
  }

  return false;
}

export type TokenRole = 'user' | 'admin' | 'analysis_auto';

export interface SessionPayload {
  sub: string;
  role: TokenRole;
  email?: string;
  sid: string;
  iat: number;
  exp: number;
}

export function signSessionToken(payload: Omit<SessionPayload, 'iat' | 'exp'>, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: SessionPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getAuthSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined, expectedRole?: TokenRole): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', getAuthSecret()).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (expectedRole && parsed.role !== expectedRole) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function generateAccountNumber(type: 'real' | 'demo'): string {
  const num = crypto.randomInt(10000000, 99999999);
  return `${type === 'real' ? 'ROT' : 'DOT'}${num}`;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function checkRateLimit(key: string, maxAttempts: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    return { allowed: true, retryAfterSec: 0 };
  }
  if (bucket.count >= maxAttempts) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function recordRateLimitAttempt(key: string, windowMs: number): RateBucket {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const next: RateBucket = { count: 1, resetAt: now + windowMs };
    rateBuckets.set(key, next);
    return next;
  }
  bucket.count += 1;
  return bucket;
}

export function clearRateLimit(key: string): void {
  rateBuckets.delete(key);
}

const ENC_PREFIX = 'enc:v1:';

function getEncryptionKey(): Buffer {
  const raw = (process.env.TOKEN_ENCRYPTION_KEY || '').trim() || getAuthSecret();
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

export function encryptAtRest(plaintext: string): string {
  if (!plaintext) return '';
  if (plaintext.startsWith(ENC_PREFIX)) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptAtRest(ciphertext?: string | null): string {
  if (!ciphertext || typeof ciphertext !== 'string') return '';
  if (!ciphertext.startsWith(ENC_PREFIX)) {
    // Backward-compatible passthrough for legacy unencrypted values
    return ciphertext;
  }
  try {
    const body = ciphertext.slice(ENC_PREFIX.length);
    const [ivHex, tagHex, dataHex] = body.split(':');
    if (!ivHex || !tagHex || !dataHex) return '';
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

export function generateOAuthState(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function generatePkcePair(): {
  codeVerifier: string;
  codeChallenge: string;
  method: 'S256';
} {
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier, 'ascii')
    .digest('base64url');
  return {
    codeVerifier,
    codeChallenge,
    method: 'S256',
  };
}

