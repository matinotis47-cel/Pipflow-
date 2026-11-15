# Deployment and integration notes

## Render

This repository serves the Vite-built application and its `/api/*` routes from the same Express process. Configure the Render web service to build with `npm install && npm run build` and start with `npm start`. The server now reads Render's `PORT` value and binds to `0.0.0.0`; do not hard-code a Render port in the dashboard.

The local JSON database is stored at `<working-directory>/.data/pipflow-store.json`, and uploaded files are stored under `public/uploads`. Both locations are local filesystem storage. Attach persistent storage at the corresponding paths before relying on accounts, admin credentials, or uploads across restarts/redeploys, or migrate these stores to a shared persistent database/object store. The `.env.example` `DATABASE_URL` is not currently used by `server/db/store.ts` as the primary store.

After deployment, verify `https://<your-render-host>/api/health` returns JSON with `status: "ok"`. If it does not, inspect the Render service logs and the browser Network request for `/api/admin/session` and `/api/admin/login` before changing credentials. The admin modal's generic network-error text can also be triggered by an HTML/proxy response or response parsing failure, not just a failed password.

## Google sign-in

The preview-domain error is an external Firebase Authentication configuration issue, not an Express API route. Add each exact deployed hostname (including the Render `*.onrender.com` hostname, if Google sign-in is intended there) in Firebase Console → Authentication → Settings → Authorized domains, and ensure the Google provider is enabled. No backend code can whitelist a Firebase Auth domain. The current backend Google-token handler also needs production-grade Firebase ID-token signature/issuer/audience verification before Google sign-in should be considered secure; do not rely on decoding the token payload alone.

## Brevo and Deriv

The current PIPFLOW source has no Brevo email transport and no Deriv OAuth/API client or Deriv connection endpoints. Its `ROT...` and `DOT...` accounts and `/api/trading/*` balances are PIPFLOW's own simulated records, not Deriv accounts. Do not present them as linked external Deriv accounts or route live orders through the simulated trading endpoints.

Brevo API credentials, a verified sender, and a specified email workflow are needed before transactional email can be enabled. Deriv requires a registered Deriv application, its app ID and registered redirect URI, and an account-authorization flow that keeps user tokens protected. Those external settings are not in this repository and cannot be inferred or provisioned by a code commit. Implement Deriv linking as a separate, explicitly authorized integration; keep the existing simulated accounts distinct and start with read-only/demo access. Never commit API keys, account tokens, OAuth secrets, or admin passwords.

## Administrator credential

The screenshot exposes an administrator password; treat it as compromised and rotate it. Configure a new salted hash using `PIPFLOW_ADMIN_PASSWORD_HASH` (or use the application's first-launch bootstrap flow on a persistent deployment), then remove the exposed credential from any places it was reused. Do not put plaintext credentials in source control or chat.
