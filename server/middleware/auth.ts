import type { Request, Response, NextFunction } from 'express';
import { verifySessionToken, type SessionPayload } from '../security/crypto.ts';
import { loadDb } from '../db/store.ts';

export interface AuthenticatedRequest extends Request {
  userSession?: SessionPayload;
  adminSession?: SessionPayload;
}

export const USER_COOKIE_NAME = 'pf_session';
export const ADMIN_COOKIE_NAME = 'pf_admin_session';

export function extractUserToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  const headerToken =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;
  const cookieToken = req.cookies?.[USER_COOKIE_NAME];

  if (headerToken && verifySessionToken(headerToken, 'user')) return headerToken;
  if (cookieToken && verifySessionToken(cookieToken, 'user')) return cookieToken;
  return headerToken || cookieToken || undefined;
}

export function extractAdminToken(req: Request): string | undefined {
  const rawHeader = req.headers['x-admin-token'];
  const headerToken = typeof rawHeader === 'string' && rawHeader.trim() ? rawHeader.trim() : undefined;
  const cookieToken = req.cookies?.[ADMIN_COOKIE_NAME];

  if (headerToken && verifySessionToken(headerToken, 'admin')) return headerToken;
  if (cookieToken && verifySessionToken(cookieToken, 'admin')) return cookieToken;
  return headerToken || cookieToken || undefined;
}

export function requireUser(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractUserToken(req);
  const session = verifySessionToken(token, 'user');
  if (!session) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const db = loadDb();
  const user = db.users[session.sub];
  if (!user) {
    res.status(401).json({ error: 'User account not found' });
    return;
  }
  if (user.status === 'suspended') {
    res.status(403).json({ error: 'Account suspended. Contact PIPFLOW support.' });
    return;
  }
  req.userSession = session;
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractAdminToken(req);
  const session = verifySessionToken(token, 'admin');
  if (!session) {
    res.status(401).json({ error: 'Administrator session required' });
    return;
  }
  req.adminSession = session;
  next();
}
