# PIPFLOW — Architecture, Deriv Read-Only API Flow & Render/Neon Deployment Guide

## 1. Platform Overview & Security Posture

**PIPFLOW** (`https://pipflow.site`) is an MT5-inspired analytics, market-watch, charting, and educational paper-trading platform powered by:
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, PWA Service Worker (`vite-plugin-pwa`)
- **Backend**: Node.js, Express, WebSockets (`ws`), Server-Sent Events (`/api/platform/events`)
- **Primary Database**: Neon PostgreSQL (`DATABASE_URL`)
- **Transactional Email**: Brevo Transactional Email API (`https://api.brevo.com/v3/smtp/email`)
- **Push Notifications**: Web Push (VAPID) for Android & desktop notifications
- **Market Data & Account Read-Only Verification**: Official Deriv API (`wss://ws.derivws.com/websockets/v3` & `https://auth.deriv.com`)
- **Hosting**: Render Web Service (`render.yaml`)

### Strict Read-Only Deriv Integration Mandate
1. **Zero Real-Money Order Execution**: PIPFLOW never calls `{ buy }`, `{ proposal }`, or any live order-placement endpoint on Deriv. All `/api/trading/*` trades run exclusively inside PIPFLOW's local educational paper simulator (`liveExecution: false`).
2. **Read-Only Scope Only**: OAuth2 requests strictly enforce `scope=read`. Requests to connect via OAuth or Personal Access Token (PAT) require explicit user authorization consent (`consentAccepted: true`) and store encrypted credentials server-side only (`AES-256-GCM`).
3. **Zero Credential Exposure**: User Deriv tokens, OAuth refresh tokens, and secrets are never returned to the frontend, admin endpoints, or logs.

---

## 2. Official Deriv API Endpoints Used

### A. Public Market Data Feed (`server/services/derivMarketFeed.ts`)
Connects publicly (without sending `{ authorize }`) to:
- `wss://ws.derivws.com/websockets/v3?app_id=<DERIV_APP_ID>`
- **Keepalive**: Sends `{ "ping": 1 }` every 25 seconds.
- **Reconnection**: Exponential backoff on disconnects (`1.5s` up to `30s`) and automatic re-subscription to watched instruments.
- **Instrument Catalog**: `{ "active_symbols": "brief", "product_type": "basic" }` cached into Neon (`market_instruments`).
- **Historical Data**: `{ "ticks_history": "<SYMBOL>", "style": "candles" | "ticks", "granularity": <SECONDS>, "end": "latest", "count": <N> }` exposed via `GET /api/markets/history` and cached into Neon (`market_data_cache`).
- **Live Price Stream**: `{ "ticks": "<SYMBOL>", "subscribe": 1 }` broadcasted to connected browser clients over SSE (`market:tick` events).

### B. Read-Only Account Verification & OAuth2 (`server/services/deriv.ts`)
1. **OAuth2 PKCE Flow (`scope=read`)**:
   - `GET /api/auth/deriv/url` generates PKCE `code_verifier` / `code_challenge` (`S256`) and persists state in Neon (`pf_oauth_states`).
   - Redirects user to `https://auth.deriv.com/oauth2/auth` (or legacy fallback) requesting strictly `scope=read`.
   - Callback `GET /auth/callback` exchanges authorization code server-side at `POST https://auth.deriv.com/oauth2/token`, requests OTP WS URL via `POST /trading/v1/options/accounts/{accountId}/otp` (or verifies via WS `{ authorize }`), retrieves read-only account ID, Demo/Real flag (`is_virtual`), currency, and balance (`{ balance: 1, account: "all" }`).
2. **Explicit Read-Only PAT Connection (`POST /api/auth/connect-deriv-token` & `POST /api/auth/deriv-login`)**:
   - Requires `consentAccepted: true`.
   - Calls `{ authorize: "<token>" }` and `{ balance: 1, account: "all" }` solely to verify identity and read-only balances.
3. **Account Lifecycle Endpoints**:
   - `GET /api/auth/deriv-status` — returns sanitized connection status (`connected`, `disconnected`, `revoked`), identifier, Real/Demo breakdown, currency, authorized scopes, and timestamps.
   - `POST /api/auth/disconnect-deriv` — deletes stored Deriv tokens, sets status to `disconnected`, logs audit event, and sends Brevo security notice.
   - `POST /api/auth/revoke-deriv` — attempts upstream `{ revoke_oauth_app }` if applicable, wipes stored tokens, sets status to `revoked`, logs audit event, and sends Brevo revocation email.

---

## 3. Neon PostgreSQL Schema (11 Core Tables + App State Mirror)

On startup, `server/db/neon.ts` initializes and syncs:
1. `roles` — Role definitions (`admin`, `trader`, `analyst`)
2. `users` — User accounts, phone numbers, hashed passwords, demo/real ledger balances, and sanitized Deriv connection metadata
3. `connected_accounts` — Read-only Deriv sub-account records (`account_identifier`, `account_type`, `currency`, `balance`, `is_active`)
4. `account_authorizations` — Consent flags, `auth_mode`, `authorized_scopes`, `connection_status`, `connected_at`, `revoked_at` (zero raw tokens exposed)
5. `market_instruments` — Active Deriv symbols catalog (`symbol`, `display_name`, `market`, `submarket`, `pip`, `is_trading_suspended`)
6. `market_data_cache` — Latest cached candle/tick JSON payloads by symbol & timeframe
7. `watchlists` — Per-user favorite symbol watchlists
8. `notifications` — User & global platform notifications
9. `email_logs` — Every Brevo email attempt (`sent` / `failed` / `skipped`) with template type, recipient, and provider message ID
10. `application_settings` — Branding (`siteName`, `logoUrl`, `accentColor`), global maintenance/announcement toggles, and platform configuration
11. `administrator_audit_logs` — Immutable security & admin audit trail

---

## 4. Administrator Access & Controls

### Dual Admin Entry Points
1. **Ten Consecutive Logo Clicks**: Clicking the `PIPFLOW` logo **10 times consecutively** (within 4s click intervals) on either the **Public Landing Header** or the **Workspace Header** opens the secure Administrator Authentication modal / `/admin` portal.
2. **Private URL**: Navigating directly to `/admin`.

Both entry points validate the password server-side (`POST /api/admin/login`) and issue an HTTP-only signed session cookie (`pf_admin_session`) + `x-admin-token` header.

### Admin Modules
- **User & Balance Management**: Edit user details, Demo/Real balances, and trading rules.
- **Deriv Account Connection Monitoring**: View active/disconnected/revoked read-only connections (`GET /api/admin/connections`) with zero token exposure.
- **API Connection Diagnostics**: Live latency & health checks (`POST /api/admin/diagnostics/deriv`) testing public Deriv WS v3 (`active_symbols` + `ping`), Neon DB connectivity, and Brevo readiness.
- **Brevo Email Management**: Inspect `email_logs`, send test emails (`POST /api/admin/email/test`), and broadcast notifications with optional email delivery (`POST /api/admin/notifications`).
- **Application Branding & Global Settings**: Configure site name, custom logo upload, announcements, and maintenance mode.
- **Security & Audit Logs**: Full server-side audit log viewer.

---

## 5. Deploying to Render (via GitHub) & Neon

### Step 1: Provision Neon PostgreSQL
1. Create a database at [neon.tech](https://neon.tech).
2. Copy the pooled connection string (`postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require`).

### Step 2: Configure Deriv App ID
1. Open [app.deriv.com](https://app.deriv.com) → **Application Manager**.
2. Set Redirect URI to `https://<your-render-service>.onrender.com/auth/callback` (or `https://pipflow.site/auth/callback`).
3. Set `DERIV_APP_ID`, `DERIV_REDIRECT_URI`, and optionally `DERIV_CLIENT_SECRET`.

### Step 3: Configure Brevo & VAPID Push
1. Generate an API key in [Brevo](https://app.brevo.com/settings/keys/api) and verify your sender domain/email (`BREVO_SENDER_EMAIL`).
2. Generate Web Push VAPID keys once locally:
   ```bash
   npx web-push generate-vapid-keys
   ```

### Step 4: Deploy via `render.yaml`
1. Push this repository to GitHub.
2. In Render Dashboard → **New + → Blueprint** (or Web Service) and connect your GitHub repo.
3. Render automatically reads `render.yaml`:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
4. Fill in required secret environment variables in Render Dashboard:
   - `DATABASE_URL`
   - `APP_URL`
   - `AUTH_SECRET` (auto-generated via `render.yaml`)
   - `TOKEN_ENCRYPTION_KEY` (auto-generated via `render.yaml`)
   - `DERIV_APP_ID`, `DERIV_REDIRECT_URI`, `DERIV_CLIENT_SECRET`
   - `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   - `GEMINI_API_KEY` (if using AI Bot Generator)
5. Deploy and verify `GET /health` returns `{ "status": "ok", "deriv": { "readOnlyMode": true, "allowedScope": "read" } }`.
