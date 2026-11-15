# PIPFLOW Administrator Guide

## Accessing the Hidden Control Centre
1. Sign in to the authenticated PIPFLOW trading workspace (`/dashboard`).
2. Click the **PIPFLOW** brand logo in the top-left navigation bar **10 consecutive times** within a 2-second click interval.
3. Complete authentication in the modal:
   - **First launch (when no credential is set):** Set an administrator password (minimum 8 characters) to bootstrap the credential hash in the backend store.
   - **Subsequent sessions:** Enter the configured administrator password (verified against `PIPFLOW_ADMIN_PASSWORD_HASH` if defined, otherwise against the salted `scrypt` hash stored on the server).
4. Normal single clicks on the logo work normally and redirect home/workspace without revealing any admin indicator.
5. Navigating directly to `/admin` without an active admin cookie (`pf_admin_session`) shows the **Administrator Session Required** gate.

## Control Centre Sections
1. **Overview** — Real-time metrics across traders, `ROT...` Real & `DOT...` Demo accounts, volume, net platform P&L, recent registrations, audit logs, and contact messages.
2. **User Management** — Search users by email, name, ID, or `ROT`/`DOT` account ID; inspect user ledger; edit profile details; verify email; suspend/reactivate; delete.
3. **Account Management** — View all `ROT...` Real and `DOT...` Demo accounts; provision new `ROT...` or `DOT...` accounts in `USD`, `KSH`, `EUR`, or `GBP`; freeze/unfreeze accounts.
4. **Balance Management** — Select any trader and adjust either their Real (`ROT...`) or Demo (`DOT...`) account via Credit, Debit, Set Exact Balance, or Reset. Every adjustment requires a confirmation step and an audit reason, and broadcasts an SSE `account:updated` event so the user's open dashboard updates immediately.
5. **Trading Activity** — Inspect open and closed positions across manual, bot, bulk, copy, and AI Profit Bot trades.
6. **Profit & Loss** — View platform realised P&L and issue **Audited P&L Adjustments** that preserve original trade records intact.
7. **Branding** — Update application name, dashboard title, tagline, support contacts, footer text, and announcement banner.
8. **Logo Management** — Upload PNG/SVG/WebP/ICO logos (≤ 2 MB) for Main Header, Dashboard Header, Footer, Favicon, and Mobile Header directly to `/public/uploads/`.
9. **Website Customisation** — Customize primary/secondary/background/card/button colors, typography, border radius, and homepage hero copy.
10. **Market Config** — Enable/disable instruments and tune payout rates, spreads, and volatility.
11. **Notifications** — Broadcast alerts to all traders or target an individual user.
12. **Feature Management** — Toggle platform-wide feature flags (AI Profit Bot, Bot Builder, Copy Trading, Bulk Trader, Watchlists, Dark Mode, etc.).
13. **Platform Settings** — Configure default demo starting balance, default chart timeframe, currency, and timezone.
14. **Audit Logs** — Filter and review every admin action, failed login, and configuration update.
15. **Security Settings** — Configure admin session TTL (1–72 hours) and rotate the stored administrator password.
