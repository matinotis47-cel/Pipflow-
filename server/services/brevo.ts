import { loadDb, saveDb } from '../db/store.ts';
import { generateId } from '../security/crypto.ts';
import type { EmailLogRecord } from '../../src/types/pipflow.ts';

export interface BrevoEmailPayload {
  toEmail: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  emailType?: string;
}

export interface BrevoSendResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
}

export function isBrevoConfigured(): boolean {
  return Boolean((process.env.BREVO_API_KEY || '').trim());
}

function recordEmailLog(entry: Omit<EmailLogRecord, 'id' | 'createdAt'>): void {
  try {
    const db = loadDb();
    db.emailLogs.unshift({
      ...entry,
      id: generateId('eml'),
      createdAt: new Date().toISOString(),
    });
    if (db.emailLogs.length > 500) {
      db.emailLogs.length = 500;
    }
    saveDb(db);
  } catch (err) {
    console.error('Failed to record email log:', err);
  }
}

/**
 * Sends a transactional email via Brevo v3 SMTP REST API (https://api.brevo.com/v3/smtp/email).
 * Never exposes BREVO_API_KEY to the frontend; gracefully returns { sent: false } if key is unset.
 */
export async function sendBrevoEmail(payload: BrevoEmailPayload): Promise<BrevoSendResult> {
  const apiKey = (process.env.BREVO_API_KEY || '').trim();
  const emailType = payload.emailType || 'transactional';

  if (!apiKey) {
    const reason = 'BREVO_API_KEY not configured';
    recordEmailLog({
      recipientEmail: payload.toEmail,
      emailType,
      subject: payload.subject,
      status: 'skipped',
      errorReason: reason,
    });
    return { sent: false, reason };
  }

  const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'noreply@pipflow.site').trim();
  const senderName = (process.env.BREVO_SENDER_NAME || 'PIPFLOW Trading').trim();

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: payload.toEmail, name: payload.toName || payload.toEmail }],
        subject: payload.subject,
        htmlContent: payload.htmlContent,
        textContent: payload.textContent,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Brevo API error:', res.status, errText);
      const reason = `Brevo HTTP ${res.status}`;
      recordEmailLog({
        recipientEmail: payload.toEmail,
        emailType,
        subject: payload.subject,
        status: 'failed',
        errorReason: reason,
      });
      return { sent: false, reason };
    }

    const data = (await res.json()) as { messageId?: string };
    recordEmailLog({
      recipientEmail: payload.toEmail,
      emailType,
      subject: payload.subject,
      status: 'sent',
      providerMessageId: data.messageId,
    });
    return { sent: true, messageId: data.messageId };
  } catch (err: any) {
    const reason = err?.message || 'Network failure';
    console.error('Brevo request failed:', reason);
    recordEmailLog({
      recipientEmail: payload.toEmail,
      emailType,
      subject: payload.subject,
      status: 'failed',
      errorReason: reason,
    });
    return { sent: false, reason };
  }
}

function wrapEmailLayout(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; background:#060a14; color:#f8fafc; padding:28px 16px;">
      <div style="max-width:560px; margin:0 auto; background:#0b1120; border:1px solid #1e293b; border-radius:14px; overflow:hidden;">
        <div style="padding:20px 24px; border-bottom:1px solid #1e293b; background:linear-gradient(90deg,#061812,#0b1120);">
          <div style="font-size:18px; font-weight:800; color:#22c55e; letter-spacing:0.5px;">PIPFLOW <span style="color:#94a3b8; font-weight:500; font-size:12px;">pipflow.site</span></div>
          <div style="font-size:14px; font-weight:700; color:#ffffff; margin-top:6px;">${title}</div>
        </div>
        <div style="padding:24px; font-size:14px; line-height:1.6; color:#cbd5e1;">
          ${bodyHtml}
        </div>
        <div style="padding:14px 24px; border-top:1px solid #1e293b; font-size:11px; color:#64748b;">
          PIPFLOW · ANALYZE, TRADE, GROW · https://pipflow.site
        </div>
      </div>
    </div>
  `;
}

export async function sendWelcomeEmail(params: {
  email: string;
  fullName: string;
  realAccountId: string;
  demoAccountId: string;
  verificationCode?: string;
}): Promise<BrevoSendResult> {
  return sendBrevoEmail({
    toEmail: params.email,
    toName: params.fullName,
    emailType: 'welcome',
    subject: 'Welcome to PIPFLOW — Your Trading Accounts Are Ready',
    htmlContent: wrapEmailLayout(
      'Welcome to PIPFLOW',
      `
      <p>Hello <strong>${params.fullName}</strong>,</p>
      <p>Your PIPFLOW trading workspace has been provisioned:</p>
      <ul style="padding-left:18px;">
        <li><strong>Real Account:</strong> ${params.realAccountId}</li>
        <li><strong>Demo Account:</strong> ${params.demoAccountId}</li>
      </ul>
      ${
        params.verificationCode
          ? `<p>Your email verification code is: <strong style="font-size:18px; color:#22c55e; letter-spacing:2px;">${params.verificationCode}</strong></p>`
          : ''
      }
      <p>Trade smart and manage risk before every execution.</p>
      `
    ),
  });
}

export async function sendVerificationEmail(email: string, fullName: string, code: string): Promise<BrevoSendResult> {
  return sendBrevoEmail({
    toEmail: email,
    toName: fullName,
    emailType: 'verification',
    subject: `PIPFLOW Email Verification Code: ${code}`,
    htmlContent: wrapEmailLayout(
      'Verify Your Email Address',
      `
      <p>Hello <strong>${fullName}</strong>,</p>
      <p>Use the verification code below to confirm your PIPFLOW email:</p>
      <div style="margin:18px 0; padding:14px; background:#060a14; border:1px solid #22c55e; border-radius:10px; text-align:center; font-size:24px; font-weight:800; color:#22c55e; letter-spacing:4px;">${code}</div>
      `
    ),
  });
}

export async function sendPasswordResetEmail(email: string, fullName: string, code: string): Promise<BrevoSendResult> {
  return sendBrevoEmail({
    toEmail: email,
    toName: fullName,
    emailType: 'password_reset',
    subject: `PIPFLOW Password Reset Code: ${code}`,
    htmlContent: wrapEmailLayout(
      'Password Reset Request',
      `
      <p>Hello <strong>${fullName}</strong>,</p>
      <p>Enter this one-time code (valid for 15 minutes) to reset your PIPFLOW password:</p>
      <div style="margin:18px 0; padding:14px; background:#060a14; border:1px solid #38bdf8; border-radius:10px; text-align:center; font-size:24px; font-weight:800; color:#38bdf8; letter-spacing:4px;">${code}</div>
      <p>If you did not request this reset, please ignore this email.</p>
      `
    ),
  });
}

export async function sendTransactionEmail(params: {
  email: string;
  fullName: string;
  type: 'deposit' | 'withdrawal' | 'credit' | 'debit';
  amount: number;
  currency: string;
  accountId: string;
  balanceAfter: number;
  reason: string;
}): Promise<BrevoSendResult> {
  const isIncoming = params.type === 'deposit' || params.type === 'credit';
  const label = isIncoming ? 'Deposit / Credit Confirmed' : 'Withdrawal / Debit Processed';
  const color = isIncoming ? '#22c55e' : '#f59e0b';

  return sendBrevoEmail({
    toEmail: params.email,
    toName: params.fullName,
    emailType: 'transaction',
    subject: `PIPFLOW ${label}: ${isIncoming ? '+' : '-'}${params.amount.toFixed(2)} ${params.currency}`,
    htmlContent: wrapEmailLayout(
      label,
      `
      <p>Hello <strong>${params.fullName}</strong>,</p>
      <p>A balance transaction was completed on your PIPFLOW account:</p>
      <div style="margin:14px 0; padding:14px; background:#060a14; border:1px solid #1e293b; border-radius:10px;">
        <div><strong>Account:</strong> ${params.accountId}</div>
        <div><strong>Type:</strong> <span style="color:${color}; font-weight:700;">${params.type.toUpperCase()}</span></div>
        <div><strong>Amount:</strong> ${isIncoming ? '+' : '-'}${params.amount.toFixed(2)} ${params.currency}</div>
        <div><strong>New Balance:</strong> ${params.balanceAfter.toFixed(2)} ${params.currency}</div>
        <div><strong>Reference:</strong> ${params.reason}</div>
      </div>
      `
    ),
  });
}

export async function sendTradeConfirmationEmail(params: {
  email: string;
  fullName: string;
  symbol: string;
  direction: string;
  stake: number;
  accountId: string;
  contractId?: string;
}): Promise<BrevoSendResult> {
  return sendBrevoEmail({
    toEmail: params.email,
    toName: params.fullName,
    emailType: 'trade_summary',
    subject: `PIPFLOW Simulated Order Recorded: ${params.symbol} (${params.direction})`,
    htmlContent: wrapEmailLayout(
      'Simulated Order Confirmation',
      `
      <p>Hello <strong>${params.fullName}</strong>,</p>
      <p>Your simulated trade order was logged on PIPFLOW:</p>
      <ul style="padding-left:18px;">
        <li><strong>Account:</strong> ${params.accountId}</li>
        <li><strong>Market:</strong> ${params.symbol}</li>
        <li><strong>Direction:</strong> ${params.direction}</li>
        <li><strong>Stake:</strong> $${params.stake.toFixed(2)}</li>
        ${params.contractId ? `<li><strong>Reference ID:</strong> ${params.contractId}</li>` : ''}
      </ul>
      `
    ),
  });
}

export async function sendDerivConnectionEmail(params: {
  email: string;
  fullName: string;
  action: 'connected' | 'disconnected' | 'revoked';
  accountId?: string;
  authMode?: string;
  scope?: string;
}): Promise<BrevoSendResult> {
  const titleMap = {
    connected: 'Deriv Read-Only Account Connected',
    disconnected: 'Deriv Account Disconnected',
    revoked: 'Deriv Authorization Revoked',
  };
  const badgeColor =
    params.action === 'connected' ? '#22c55e' : params.action === 'disconnected' ? '#f59e0b' : '#f43f5e';
  const title = titleMap[params.action];

  return sendBrevoEmail({
    toEmail: params.email,
    toName: params.fullName,
    emailType: `deriv_${params.action}`,
    subject: `PIPFLOW Security Notice: ${title}`,
    htmlContent: wrapEmailLayout(
      title,
      `
      <p>Hello <strong>${params.fullName}</strong>,</p>
      <p>Your PIPFLOW profile recorded the following Deriv API authorization update:</p>
      <div style="margin:14px 0; padding:14px; background:#060a14; border:1px solid #1e293b; border-radius:10px;">
        <div><strong>Status:</strong> <span style="color:${badgeColor}; font-weight:700;">${params.action.toUpperCase()}</span></div>
        ${params.accountId ? `<div><strong>Account ID:</strong> ${params.accountId}</div>` : ''}
        ${params.authMode ? `<div><strong>Auth Mode:</strong> ${params.authMode.toUpperCase()}</div>` : ''}
        <div><strong>Permitted Scope:</strong> ${params.scope || 'read (Read-Only)'}</div>
        <div><strong>Timestamp:</strong> ${new Date().toISOString()}</div>
      </div>
      <p>PIPFLOW never stores unencrypted tokens or places real-money orders on external accounts.</p>
      `
    ),
  });
}

export async function sendSecurityAlertEmail(params: {
  email: string;
  fullName: string;
  eventTitle: string;
  details: string;
  ip?: string;
}): Promise<BrevoSendResult> {
  return sendBrevoEmail({
    toEmail: params.email,
    toName: params.fullName,
    emailType: 'security_alert',
    subject: `PIPFLOW Security Alert: ${params.eventTitle}`,
    htmlContent: wrapEmailLayout(
      params.eventTitle,
      `
      <p>Hello <strong>${params.fullName}</strong>,</p>
      <p>${params.details}</p>
      <div style="margin:14px 0; padding:12px; background:#060a14; border:1px solid #1e293b; border-radius:10px; font-size:12px;">
        <div><strong>Event:</strong> ${params.eventTitle}</div>
        ${params.ip ? `<div><strong>IP Address:</strong> ${params.ip}</div>` : ''}
        <div><strong>Time:</strong> ${new Date().toISOString()}</div>
      </div>
      <p>If this was not you, update your PIPFLOW password or revoke connected authorizations immediately.</p>
      `
    ),
  });
}

export async function sendAnnouncementEmail(params: {
  email: string;
  fullName: string;
  title: string;
  message: string;
}): Promise<BrevoSendResult> {
  return sendBrevoEmail({
    toEmail: params.email,
    toName: params.fullName,
    emailType: 'announcement',
    subject: `PIPFLOW Notice: ${params.title}`,
    htmlContent: wrapEmailLayout(
      params.title,
      `
      <p>Hello <strong>${params.fullName}</strong>,</p>
      <p>${params.message}</p>
      `
    ),
  });
}
