// In-memory only session token fallback for strict third-party iframe previews.
// Never persisted in localStorage or sessionStorage.

let userToken: string | null = null;
let adminToken: string | null = null;

export function setMemoryUserToken(token: string | null): void {
  userToken = token;
}

export function setMemoryAdminToken(token: string | null): void {
  adminToken = token;
}

export function getMemoryUserToken(): string | null {
  return userToken;
}

export function getMemoryAdminToken(): string | null {
  return adminToken;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (userToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${userToken}`);
  }
  if (adminToken && !headers.has('X-Admin-Token')) {
    headers.set('X-Admin-Token', adminToken);
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  });
}
