# DARK CHAT — Base44 Dev Notes

## What this is
A real-time messaging app (DMs, groups, channels, statuses, posts) built with
Node.js + Express + Socket.io and a **vanilla HTML/CSS/JS frontend** (no build step,
no framework). The frontend lives in `public/` and is served via `express.static`.

## Backend: Firebase, not PostgreSQL
Despite the README mentioning PostgreSQL, the app has fully migrated to **Firebase
Firestore** using the **client-side Firebase SDK** (`firebase/app`, `firebase/auth`,
`firebase/firestore`).

- Firebase web config is committed in `firebase-applet-config.json` — these are
  public web API keys (normal for the client SDK; security is via Firestore rules).
- `db/firebase.js` is the entire data layer. `db/index.js` just re-exports it.
- `db/schema.sql` and `db/migrate.js` are **vestigial** (PostgreSQL leftovers) and are
  not used at runtime.
- The backend authenticates to Firebase Auth with a hardcoded service account
  email/password (`service-backend@darkchat.internal`) inside `db/firebase.js`,
  then uses Firestore. No service-account JSON file is needed.

## Environment variables
- `JWT_SECRET` — signs JWT session tokens. Has a hardcoded code fallback, so the
  app boots without it, but a generated development placeholder is provided via the
  platform secret store. Replace with a real random value for production.
- `ADMIN_NOVA_IDS` — comma-separated DARK CHAT IDs granted admin powers. Defaults to
  `+1-999-234-8321` (the seeded admin account) when unset. Optional.
- `DATABASE_URL` — listed in `.env.example` but **unused** (Firebase migration). Ignore.

No external third-party credentials are required to boot.

## Running here
```
docker compose -f docker-compose.base44.yml up -d
```
- Uses `node:22`, bind-mounts the repo, installs deps, and runs `nodemon -L server.js`
  for live reload (polling mode for bind mounts).
- Frontend edits in `public/` are served directly by Express — a browser refresh
  picks them up; server-side edits auto-restart via nodemon.
- Health check: `GET /api/health` → `{ ok: true, name: "DARK CHAT", backend: "firebase" }`.

## Verifying it works
1. `docker compose -f docker-compose.base44.yml ps` — the `web` service should be `Up`.
2. `curl -s localhost:3000/api/health` — should return the health JSON.
3. `curl -s localhost:3000` — should return the `public/index.html` (auth screen).
4. In the preview, the sign-up / login screen should render.

## Notes / gotchas
- The app listens on `0.0.0.0:3000` and CORS is wide open (`origin: '*'`), so no
  host/origin allowlist configuration is needed.
- Socket.io is used for real-time messaging; the client connects with a JWT in the
  `auth` handshake.
- An admin user is auto-seeded into Firestore on first boot
  (`+1-999-234-8321` / `21272127`).
