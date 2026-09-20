# DARK CHAT — Base44 Dev Notes

## What this app is
Real-time messaging platform (DMs, groups, channels, status, posts). Single Node.js process: Express + Socket.io serving a vanilla HTML/CSS/JS frontend (no build step, no framework) from `public/`.

## Database
**Firebase Firestore** — NOT PostgreSQL despite what the README says. The README is stale; the app migrated to Firebase. Config is committed in `firebase-applet-config.json` (projectId, apiKey, etc.) and loaded by `db/firebase.js`. No external DB service or credentials needed to boot — the Firebase web client SDK authenticates with a hardcoded service email.

## Running
`docker compose -f docker-compose.base44.yml up -d` — single `web` service on port 3000. Uses `node:22-slim`, bind-mounts the repo, installs deps into a named volume, and runs `nodemon server.js` for live backend reload. Frontend static files reflect edits immediately (express.static reads from disk).

## Environment variables
- `JWT_SECRET` — optional, falls back to a built-in dev default. Set a real value for secure sessions.
- `ADMIN_NOVA_IDS` — optional, comma-separated admin DARK CHAT IDs.
- No external credentials are required to boot.

## Health check
`GET /api/health` → `{"ok":true,...}`

## Key files
- `server.js` — Express + Socket.io bootstrap, route mounting
- `db/firebase.js` — Firestore data layer (all CRUD lives here)
- `routes/` — REST API route handlers
- `sockets/index.js` — real-time socket handlers
- `public/` — frontend (index.html, js/app.js, css/)
- `db/migrate.js` — legacy PostgreSQL migration, no longer used (Firestore has no migration step)
