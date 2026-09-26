# Agent notes

- Run: `docker compose -f docker-compose.base44.yml up -d` → http://localhost:3000 (health: `/api/health`).
- The backend is **Firebase/Firestore** (the web SDK, set up from the committed `firebase-applet-config.json`). The README's Postgres/`DATABASE_URL`/`npm run migrate` steps are out of date: `pg` and `db/index.js` / `db/migrate.js` aren't used by the running server.
- There's no local database. All data lives in the hosted Firestore project, so local runs read and write shared, real data.
- The Firestore project is on the free tier. If the daily read quota runs out, logs show "Quota limit exceeded" and auth/data calls fail until the quota resets. The server still boots and serves the UI.
- On boot, `db/firebase.js` signs in a hardcoded backend service user and seeds or updates the admin user.
- Frontend is plain static files in `public/` (no build step), so refresh to see changes. Backend files are watched with `node --watch` and restart automatically.
- `bun.lock` exists, but the compose file installs with npm into a named `node_modules` volume.
