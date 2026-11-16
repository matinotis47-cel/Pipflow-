# PIPFLOW Deployment & Verification Guide

## Current deployment architecture
PIPFLOW runs the Vite/React build and Express API in one Render web service. The UI is unchanged. Production requires Neon PostgreSQL via `DATABASE_URL`; local JSON storage is used only for development. PostgreSQL currently stores a JSONB application-state document, so deploy a single Render instance (`numInstances: 1`). This is persistent across restarts but is not a normalized/high-write multi-instance schema; do not scale horizontally until storage is migrated to transactional relational repositories.

## Render setup
1. Push the `copilot/render-neon-deriv-readiness` branch and create a Neon database.
2. Create a Render Blueprint from `render.yaml`, or create a Node web service connected to the repository.
3. Set build command `npm install && npm run lint && npm run build`; start command `npm start`; health check `/api/health`.
4. Add the Neon pooled connection string as `DATABASE_URL` (include `sslmode=require`). Do not check secrets into Git.
5. Set `APP_URL` to the Render URL and configure the other optional integrations only after their provider setup is complete.
6. Configure `PIPFLOW_ADMIN_PASSWORD_HASH` to a salted scrypt (`salt:hash`) or bcrypt hash. The admin bootstrap path remains available on a fresh DB if no hash is supplied; configure the environment hash before public launch.
7. Verify `/api/health`, registration, login, config load, and data surviving a Render redeploy. Existing local JSON data is deliberately not imported into a fresh production database.

## Environment variables
Required in production:
- `DATABASE_URL`: Neon PostgreSQL connection string with TLS.
- `AUTH_SECRET`: Render-generated secret; at least 32 characters.
- `NODE_ENV=production`.
- `APP_URL`: public Render/custom-domain origin.

Optional integrations:
- `PIPFLOW_ADMIN_PASSWORD_HASH`: pre-hashed admin password.
- `DERIV_CLIENT_ID`, `DERIV_CLIENT_SECRET`, `DERIV_REDIRECT_URI`: Deriv registered application values. A working Deriv OAuth integration and approved callback must be implemented/configured before claiming account linking is live. Never place Deriv tokens in frontend code.
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`: Brevo sender setup. Email delivery is not enabled merely by supplying a key; transaction templates and verified sender/domain are still needed.
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`: Firebase Admin service-account values for Android push. FCM also requires a client-side Android app/device-token registration flow; this backend does not currently register device tokens or deliver push messages.
- `GEMINI_API_KEY`: optional Gemini features.

## Build and local verification
```bash
npm install
npm run lint
npm run build
npm start
```
The service listens on `0.0.0.0:$PORT`, serves `dist/`, exposes `/uploads`, and uses `/api/health` for Render health checks. In local development, set `DATABASE_URL` to a development PostgreSQL database to exercise the production store; without it, `.data/pipflow-store.json` remains a local-only fallback.

## Important account and payment limitations
PIPFLOW's `ROT...` and `DOT...` records and trade settlement endpoints remain platform-side simulated accounts. Neon persistence does not turn them into Deriv accounts or live trades. There is no live deposit/withdrawal processing or automatic Deriv transaction notification in this change. Do not represent simulated balances as withdrawable funds. Deriv OAuth should use the current provider-approved authorization flow and minimum scopes; do not request payment/deposit/withdrawal scopes absent explicit provider approval and a reviewed money-movement flow.
