# PIPFLOW Administrator & Platform API Reference

All `/api/admin/*` routes (except `/session`, `/bootstrap`, `/login`, `/logout`) require a valid `pf_admin_session` HTTP-only cookie enforced by `requireAdmin`.

## Admin Authentication
- `GET /api/admin/session` — Returns `{ authenticated, needsBootstrap, usingEnvHash, ttlHours, expiresAt }`.
- `POST /api/admin/bootstrap` — Sets initial salted admin password hash when no env/stored hash exists.
- `POST /api/admin/login` — Validates password (rate-limited), sets `pf_admin_session` cookie.
- `POST /api/admin/logout` — Clears `pf_admin_session` cookie.

## Overview, Users & Accounts
- `GET /api/admin/overview` — Platform KPIs, recent users, trades, audit logs, and contact submissions.
- `GET /api/admin/users?q=` — List and search users with `ROT...` / `DOT...` accounts.
- `GET /api/admin/users/:id` — Detailed user inspection (accounts, trades, transactions).
- `PATCH /api/admin/users/:id` — Update profile fields and verification status.
- `POST /api/admin/users/:id/suspend` | `/reactivate` — Toggle user status.
- `DELETE /api/admin/users/:id` — Permanently delete user and owned trading accounts.
- `GET /api/admin/demo-accounts` — List all Real (`ROT...`) and Demo (`DOT...`) trading accounts.
- `POST /api/admin/accounts` — Provision new `ROT...` or `DOT...` account (`{ userId, accountType, currency, initialBalance }`).
- `PATCH /api/admin/accounts/:id/status` — Set account status (`active` | `frozen`).

## Balance & Audited P&L Operations
- `POST /api/admin/demo-accounts/:id/adjust` — `{ mode: 'credit' | 'debit' | 'set', amount, reason }`. Broadcasts SSE `account:updated`.
- `POST /api/admin/demo-accounts/:id/reset` — Reset balance to target or default demo starting balance.
- `GET /api/admin/trading-activity` — All recorded trades.
- `GET /api/admin/demo-transactions` — Account credit/debit/trade/P&L ledger entries.
- `GET /api/admin/demo-performance` — Platform P&L summary and adjustment ledger.
- `POST /api/admin/pnl-adjust` — `{ tradeId, adjustmentDelta, reason }`. Preserves original trade record and appends audited adjustment + ledger transaction.

## Configuration, Branding, Logos & Security
- `GET /api/admin/branding` | `PATCH /api/admin/branding`
- `POST /api/admin/upload-logo` — `multipart/form-data` (`slot`, `logo` file ≤ 2 MB) -> `/uploads/...`.
- `GET /api/admin/settings` | `PATCH /api/admin/settings` — Theme, website copy, dashboard defaults, markets.
- `GET /api/admin/features` | `PATCH /api/admin/features` — Feature flag toggles.
- `POST /api/admin/notifications` — Broadcast or targeted user alert (`userId: 'all' | string`).
- `GET /api/admin/audit-logs?type=` — Filterable audit log feed.
- `PATCH /api/admin/security` — Update `ttlHours` and/or rotate `adminPasswordHash`.
