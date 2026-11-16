# PIPFLOW Database & Persistence Model

## Primary persistence
In production the Express backend stores application state in Neon PostgreSQL using `DATABASE_URL`. The current adapter uses one `pipflow_app_state` row with a JSONB snapshot, preserving the existing synchronous storage API without changing the UI. The service initializes the table and loads the state before listening; queued writes are flushed before API responses. Keep the Render service at one instance while using this snapshot adapter. A normalized schema and transactional repository layer are required before horizontal scaling or high write volume.

In development only, the adapter falls back to `.data/pipflow-store.json` if `DATABASE_URL` is unset. Production startup fails closed without `DATABASE_URL`; production does not import the repository's local JSON store.

## Entities represented in the state
User profiles, platform-created simulated accounts, simulated trades, ledger transactions, P&L adjustments, notifications, watchlists, audit logs, contact submissions, and platform configuration remain available under their existing interface. `ROT...`/`DOT...` are platform simulation identifiers, not Deriv account IDs.

## Secrets and migration
Set `AUTH_SECRET` in Render; never persist or commit real secrets. A fresh Neon database starts with default platform configuration and no seeded user or admin credentials. Existing local JSON state is intentionally not auto-imported into production because the checked-in snapshot may contain test identities and credential hashes. Export/import only after auditing and sanitizing the data.
