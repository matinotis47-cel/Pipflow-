# Final Render + Neon deployment checklist

## 1. Repository and Render
- Connect the GitHub repository to Render and deploy branch `copilot/render-neon-deriv-readiness` for staging first.
- `render.yaml` configures a single Node web service, build `npm install && npm run lint && npm run build`, start `npm start`, and health check `/api/health`.
- Keep one instance while the current JSONB snapshot store is used; do not enable multiple instances or background workers.
- Uploaded logos are currently written to the container filesystem. Configure a persistent disk mounted at `public/uploads`, or move upload assets to object storage before relying on uploaded assets after deploy.

## 2. Neon
- Create a Neon project/database and copy its pooled connection URI to Render `DATABASE_URL`; keep `sslmode=require`.
- The service creates `pipflow_app_state` on startup. Confirm the Render logs show healthy DB startup, then call `/api/health`.
- Do not automatically import `.data/pipflow-store.json`: it contains legacy/test user records and credential hashes. If migration is needed, audit and sanitize it offline first.

## 3. Required secrets and provider configuration
Set in Render environment (never commit these): `AUTH_SECRET` (at least 32 random characters), `DATABASE_URL`, `APP_URL`, and `PIPFLOW_ADMIN_PASSWORD_HASH` (a scrypt/bcrypt hash).
For Deriv linking set registered app's `DERIV_CLIENT_ID`, `DERIV_CLIENT_SECRET` if required by provider, exact `DERIV_REDIRECT_URI=https://<service>/api/integrations/deriv/callback`, plus approved `DERIV_OAUTH_URL` and `DERIV_TOKEN_URL`. Register the identical redirect URL in Deriv's developer portal. This implementation requests only `read trade`; validate exact scope names and PKCE parameters against the app's approved Deriv OAuth docs before public launch. No deposit/withdrawal permissions are requested.
For email set `BREVO_API_KEY`, verified `BREVO_SENDER_EMAIL`, and optional `BREVO_SENDER_NAME`.
For Android push set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` (store newline escaped in Render). An Android client must obtain an FCM registration token and POST it to `/api/integrations/notifications/devices` with the signed-in user's session. This repository does not include that Android client token-registration workflow, so push delivery cannot be considered active until the client is integrated.
Set `TRANSACTION_EVENTS_SECRET` to a separate random secret for trusted transaction notification events.

## 4. Smoke tests
1. Build on a clean environment: `npm ci`, `npm run lint`, `npm run build`.
2. Deploy staging and check `/api/health`, registration, login, config load, and logout.
3. Restart/redeploy and confirm user/config state remains in Neon.
4. Verify Deriv connection begins only for authenticated users, state is single-use/short-lived, callback rejects invalid/expired state, and provider tokens never appear in JSON, logs, or URLs. Test only with Deriv sandbox/demo account first.
5. Register an FCM test device using the authenticated device route and verify a controlled notification arrives.
6. Verify Brevo sender and deliverability with an owned test inbox. Test `/api/integrations/email/verification` only for an unverified test account.
7. Deliver a test transaction notification with `POST /api/integrations/events/transaction` and `x-transaction-event-secret`; only call this from trusted, confirmed payment/provider events. The endpoint notifies only; it does not deposit, withdraw, or modify balances. Event IDs are used for duplicate prevention.
8. Check Render logs, Neon records, cookie security, and alert delivery failures before switching the custom domain.

## 5. Important limitations before production
- `ROT...` and `DOT...` balances/trades remain simulated; Deriv OAuth connection is account linking only, not live trade execution or money movement.
- Transaction notification endpoint is an event receiver, not an actual Deriv deposit/withdrawal event subscription. Wire it to a verified provider webhook/event source before promising real transaction notifications.
- The current Neon adapter stores a whole JSONB document. It is suitable only for low-volume, single-instance staging/initial deployment; migrate to normalized tables and transactional operations before scaling.
- Brevo and FCM are optional runtime integrations, and sending fails closed if credentials are missing. Complete provider setup and end-to-end testing before production launch.
