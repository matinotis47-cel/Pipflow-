# PIPFLOW Database & Persistence Model

## Primary Persistence Layer
PIPFLOW persists all runtime state (users, `ROT...` real accounts, `DOT...` demo accounts, trades, ledger transactions, audited P&L adjustments, watchlists, notifications, contact submissions, audit logs, and live platform/branding/theme/feature configuration) through `server/db/store.ts` using atomic disk writes (`.data/pipflow-store.json`) combined with Firebase Firestore mirroring (`firebase-blueprint.json` + `firestore.rules`) when Firebase Admin credentials are available.

## Entities & Relationships
- **Users (`users`)**: `id`, `email`, `fullName`, `country`, `phone`, `emailVerified`, `status` (`active` | `suspended`), `activeAccountId`, `preferredTheme`, `preferredCurrency`.
- **Trading Accounts (`accounts`)**:
  - **Real Accounts (`ROT...`)**: Independent balance and currency (`USD`, `KSH`, `EUR`, `GBP`).
  - **Demo Accounts (`DOT...`)**: Independent simulated funds starting at the admin-configured default (`$10,000.00`).
- **Trades (`trades`)**: Linked to `userId` and `accountId`, tracking `source` (`manual`, `bot`, `ai_profit_bot`, `bulk`, `copy`), `entryPrice`, `exitPrice`, `stake`, `payout`, `profitLoss`, and `status` (`open` | `closed`).
- **Transactions (`transactions`)**: Double-entry balance audit trail (`credit`, `debit`, `reset`, `trade_win`, `trade_loss`, `pnl_adjustment`).
- **P&L Adjustments (`pnlAdjustments`)**: Separate audited adjustments referencing `tradeId` while keeping original trade records immutable.
- **Audit Logs (`auditLogs`)**: Chronological trail of every admin login, failure, user update, balance edit, logo upload, and configuration change.

## Relational SQL Portability
`.env.example` also defines `DATABASE_URL` so deployments targeting external PostgreSQL/Neon clusters can swap `server/db/store.ts` cleanly behind the same storage interface without altering API contracts.
