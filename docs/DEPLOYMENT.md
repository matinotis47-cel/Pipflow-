# PIPFLOW Deployment & Verification Guide

## Environment Variables
Configure the following in your production environment (never commit real secrets):
- `GEMINI_API_KEY` — Server-side Google Gemini API key for AI Bot strategy generation & market insights.
- `APP_URL` — Public application origin (`https://pipflow.site`).
- `AUTH_SECRET` — Strong random string used to sign `pf_session` and `pf_admin_session` HMAC tokens.
- `PIPFLOW_ADMIN_PASSWORD_HASH` — Optional pre-hashed salted `scrypt` or `bcrypt` hash for the administrator login.
- `NODE_ENV=production` — Enables `Secure` cookie flags and serves the compiled `dist/` bundle via Express.

## Build & Start Commands
```bash
npm install
npm run lint
npm run build
npm run start
```
The Express server binds to `0.0.0.0:3000`, serves compiled static assets from `dist/`, exposes uploaded logos from `public/uploads/`, and handles all `/api/*` endpoints and SPA history fallback routes.
