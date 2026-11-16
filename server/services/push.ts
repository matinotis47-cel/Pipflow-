import * as webpush from 'web-push';
import { loadDb, saveDb, type PushSubscriptionRecord } from '../db/store.ts';
import { generateId } from '../security/crypto.ts';

let vapidConfigured = false;

function ensureVapidConfigured(): { publicKey: string; privateKey: string } {
  const envPublic = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPrivate = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:support@pipflow.site').trim();

  const db = loadDb();
  let publicKey = envPublic || db.vapidKeys?.publicKey || '';
  let privateKey = envPrivate || db.vapidKeys?.privateKey || '';

  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    db.vapidKeys = { publicKey, privateKey };
    saveDb(db);
  }

  if (!vapidConfigured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  }

  return { publicKey, privateKey };
}

export function getVapidPublicKey(): string {
  return ensureVapidConfigured().publicKey;
}

export function isPushConfigured(): boolean {
  try {
    const { publicKey } = ensureVapidConfigured();
    return Boolean(publicKey);
  } catch {
    return false;
  }
}

export function saveUserPushSubscription(params: {
  userId: string;
  subscription: PushSubscriptionRecord['subscription'];
  userAgent?: string;
}): PushSubscriptionRecord {
  const db = loadDb();
  const existingIdx = db.pushSubscriptions.findIndex((s) => s.endpoint === params.subscription.endpoint);
  const record: PushSubscriptionRecord = {
    id: existingIdx >= 0 ? db.pushSubscriptions[existingIdx].id : generateId('push'),
    userId: params.userId,
    endpoint: params.subscription.endpoint,
    subscription: params.subscription,
    userAgent: params.userAgent,
    createdAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    db.pushSubscriptions[existingIdx] = record;
  } else {
    db.pushSubscriptions.unshift(record);
  }

  if (db.users[params.userId]) {
    db.users[params.userId].pushEnabled = true;
    db.users[params.userId].updatedAt = new Date().toISOString();
  }
  saveDb(db);
  return record;
}

export function removeUserPushSubscription(userId: string, endpoint?: string): void {
  const db = loadDb();
  db.pushSubscriptions = db.pushSubscriptions.filter(
    (s) => s.userId !== userId || (endpoint ? s.endpoint !== endpoint : false)
  );
  if (db.users[userId]) {
    const stillHas = db.pushSubscriptions.some((s) => s.userId === userId);
    db.users[userId].pushEnabled = stillHas;
  }
  saveDb(db);
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
}

export async function sendPushToUser(
  userId: string,
  payload: PushNotificationPayload
): Promise<{ sent: number; failed: number }> {
  ensureVapidConfigured();
  const db = loadDb();
  const targets = db.pushSubscriptions.filter((s) => s.userId === userId);
  if (targets.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const expiredEndpoints = new Set<string>();

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/dashboard',
    tag: payload.tag || 'pipflow-alert',
    icon: payload.icon || '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
  });

  await Promise.all(
    targets.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, body, {
          TTL: 86400,
          urgency: 'high',
        });
        sent += 1;
      } catch (err: any) {
        failed += 1;
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          expiredEndpoints.add(sub.endpoint);
        }
      }
    })
  );

  if (expiredEndpoints.size > 0) {
    db.pushSubscriptions = db.pushSubscriptions.filter((s) => !expiredEndpoints.has(s.endpoint));
    saveDb(db);
  }

  return { sent, failed };
}

export async function sendPushToAll(payload: PushNotificationPayload): Promise<{ sent: number; failed: number }> {
  ensureVapidConfigured();
  const db = loadDb();
  const targets = db.pushSubscriptions;
  if (targets.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const expiredEndpoints = new Set<string>();

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/dashboard',
    tag: payload.tag || 'pipflow-announcement',
    icon: payload.icon || '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
  });

  await Promise.all(
    targets.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, body, {
          TTL: 86400,
          urgency: 'high',
        });
        sent += 1;
      } catch (err: any) {
        failed += 1;
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          expiredEndpoints.add(sub.endpoint);
        }
      }
    })
  );

  if (expiredEndpoints.size > 0) {
    db.pushSubscriptions = db.pushSubscriptions.filter((s) => !expiredEndpoints.has(s.endpoint));
    saveDb(db);
  }

  return { sent, failed };
}
