# P0: Trust, security, and deployment

This document maps the **default-secure** backend behavior and environment variables for ATLAS when the Flask API is exposed beyond a single trusted machine.

## State API (`/api/state`)

- **Default**: `GET` and `PUT` require `Authorization: Bearer <token>` from `/api/auth/login`.
- **PUT** requires optimistic locking: send `If-Match: <version>` where `<version>` is the value from the `X-Atlas-State-Version` response header on the last successful `GET` or `PUT`.
- **Conflicts**: `409` with `{ "error": "version_conflict", "serverVersion": N }` — the SPA reloads server state and surfaces a warning.
- **Legacy open mode** (local static + API demos only): set `ATLAS_OPEN_STATE_API=1` to allow unauthenticated `GET`/`PUT` and to skip `If-Match` enforcement. **Do not use on the public internet.**

## CORS

- Default: permissive CORS (development-friendly).
- Production: set `ATLAS_CORS_ORIGINS` to a comma-separated allowlist, e.g. `https://app.example.com,https://admin.example.com`. When set, only those origins may call `/api/*` with credentials.

## Secrets and demo users

- Set `ATLAS_SECRET_KEY` for stable sessions in production.
- Demo user seeding: default **on** when the `atlas_users` table is empty. Disable with `ATLAS_SEED_DEMO_USERS=0` and provision real users (e.g. SQL or future admin API).

## Server audit

- Table `atlas_audit_events` stores append-only rows for logins, state saves, engine uploads, restores, and client-posted events (`POST /api/audit/log`).
- `GET /api/audit` (authenticated) returns paginated events; the Audit Log page merges these with the browser `localStorage` cache.

## Backup / restore

- `GET /api/backup` and `POST /api/restore` require authentication.

## Client expectations

- `storage.js` sends `Authorization` and `If-Match` on state saves when a session exists.
- If `GET /api/state` returns `401` before login, the app falls back to `localStorage` until the user signs in and reloads.
