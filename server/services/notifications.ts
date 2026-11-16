import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { loadDb } from '../db/store.ts';

export interface TransactionNotice {
  eventId: string;
  userId: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
}

export async function sendBrevoEmail(to: string, subject: string, textContent: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !senderEmail) throw new Error('Brevo email is not configured.');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: senderEmail, name: process.env.BREVO_SENDER_NAME || 'PIPFLOW' },
      to: [{ email: to }],
      subject,
      textContent,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Brevo rejected email (${response.status}): ${detail.slice(0, 300)}`);
  }
}

function firebaseMessaging() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Firebase push is not configured.');
  if (!getApps().length) {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (clientEmail && privateKey) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
    else initializeApp({ credential: applicationDefault(), projectId });
  }
  return getMessaging();
}

export async function sendPushToUser(userId: string, title: string, body: string): Promise<void> {
  const devices = loadDb().pushDevices?.[userId] || [];
  if (!devices.length) return;
  const messaging = firebaseMessaging();
  const result = await messaging.sendEachForMulticast({
    tokens: devices.map((device) => device.token),
    notification: { title, body },
    data: { title, body, category: 'account' },
    android: { priority: 'high', notification: { channelId: 'pipflow-account-alerts', sound: 'default' } },
  });
  const invalidTokens = new Set<string>();
  result.responses.forEach((item, index) => {
    if (!item.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(item.error?.code || '')) {
      invalidTokens.add(devices[index].token);
    }
  });
  if (invalidTokens.size) {
    const db = loadDb();
    if (db.pushDevices?.[userId]) db.pushDevices[userId] = db.pushDevices[userId].filter((device) => !invalidTokens.has(device.token));
    const { saveDb } = await import('../db/store.ts');
    saveDb(db);
  }
  if (result.failureCount) throw new Error(`${result.failureCount} push notification(s) failed.`);
}
