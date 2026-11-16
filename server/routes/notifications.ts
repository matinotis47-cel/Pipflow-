import { Router } from 'express';
import { z } from 'zod';
import { requireUser, type AuthenticatedRequest } from '../middleware/auth.ts';
import { loadDb } from '../db/store.ts';
import {
  getVapidPublicKey,
  removeUserPushSubscription,
  saveUserPushSubscription,
  sendPushToUser,
} from '../services/push.ts';
import { isBrevoConfigured, sendBrevoEmail } from '../services/brevo.ts';

const router = Router();

router.get('/push-key', (_req, res) => {
  const publicKey = getVapidPublicKey();
  res.json({ publicKey });
});

const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(8),
      auth: z.string().min(4),
    }),
  }),
});

router.post('/subscribe', requireUser, (req: AuthenticatedRequest, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Web Push subscription payload.' });
    return;
  }

  const record = saveUserPushSubscription({
    userId: req.userSession!.sub,
    subscription: parsed.data.subscription,
    userAgent: req.get('user-agent') || undefined,
  });

  res.status(201).json({
    ok: true,
    subscriptionId: record.id,
    pushEnabled: true,
  });
});

router.post('/unsubscribe', requireUser, (req: AuthenticatedRequest, res) => {
  const endpoint = req.body?.endpoint ? String(req.body.endpoint) : undefined;
  removeUserPushSubscription(req.userSession!.sub, endpoint);
  res.json({ ok: true, pushEnabled: false });
});

router.post('/test-push', requireUser, async (req: AuthenticatedRequest, res) => {
  const userId = req.userSession!.sub;
  const db = loadDb();
  const user = db.users[userId];

  const pushResult = await sendPushToUser(userId, {
    title: 'PIPFLOW Android Alerts Active',
    body: 'Instant deposit, withdrawal, and live trade alerts are now connected to your device.',
    url: '/dashboard',
    tag: 'pipflow-test-push',
  });

  let emailSent = false;
  if (req.body?.sendTestEmail && user?.email && isBrevoConfigured()) {
    const emailRes = await sendBrevoEmail({
      toEmail: user.email,
      toName: user.fullName,
      subject: 'PIPFLOW Alert Test — Email & Android Push Connected',
      htmlContent: `<p>Hello <strong>${user.fullName}</strong>,</p><p>Your PIPFLOW Brevo email alerts and Android Web Push alerts are verified and active.</p>`,
    });
    emailSent = emailRes.sent;
  }

  res.json({
    ok: true,
    pushResult,
    emailSent,
  });
});

export default router;
