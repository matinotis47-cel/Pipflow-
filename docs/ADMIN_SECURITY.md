# PIPFLOW Administrator Security Architecture

## Authentication & Session Isolation
- **Separate Session Cookie**: User sessions use `pf_session` (`HttpOnly`, `SameSite=Lax`), whereas Administrator sessions use an independent HMAC-SHA256 signed `pf_admin_session` (`HttpOnly`, `SameSite=Lax`, `Secure` in production). Signing into a regular trader account never grants `/admin` or `/api/admin/*` privileges.
- **No Frontend Secrets**: Neither `PIPFLOW_ADMIN_PASSWORD_HASH`, `AUTH_SECRET`, nor `GEMINI_API_KEY` are ever bundled into the Vite frontend build (`VITE_*` is never used for secrets).
- **Salted Password Hashing**: Administrator credentials are verified using constant-time comparison against salted `scrypt` (`salt:hash`) or `bcrypt` (`$2a$` / `$2b$` / `$2y$`) hashes.
- **Environment Override**: Setting `PIPFLOW_ADMIN_PASSWORD_HASH` in the runtime environment overrides the stored bootstrap hash and locks initial credential bootstrapping.

## Brute-Force Protection & Auditing
- `/api/admin/login` enforces per-IP rate limiting (maximum 5 failed attempts per 15-minute window, returning HTTP `429` with retry countdown).
- Every admin authentication attempt (success/failure), balance modification, P&L adjustment, user suspension, logo upload, and configuration update records an immutable entry in the audit log (`GET /api/admin/audit-logs`) with timestamp, actor, target, details, and client IP.
- Every `/api/admin/*` management route passes through `requireAdmin` middleware, returning `401 Unauthorized` when the `pf_admin_session` cookie is missing or invalid.
