# NOVA Chat

A real-time messaging platform for you and your friends — DMs, groups, channels,
24-hour status updates, and a posts feed. iMessage-inspired UI. No phone number
required: signing up generates you a unique **NOVA ID** (like `NOVA-482913`) that's
secured by your password — that's your "number."

## Stack
- Node.js + Express + Socket.io (real-time)
- PostgreSQL
- Vanilla HTML/CSS/JS frontend (no build step, no framework)
- JWT auth, bcrypt password hashing

## Deploying to Railway

1. **Push this folder to a GitHub repo**, then in Railway: New Project → Deploy from GitHub repo.
2. **Add a PostgreSQL database**: In your Railway project, click "+ New" → "Database" → "Add PostgreSQL". Railway automatically injects `DATABASE_URL` into your app's environment — you don't need to set it yourself.
3. **Set environment variables** on your web service (Settings → Variables):
   - `JWT_SECRET` — generate one with `openssl rand -hex 32` (or any long random string). **Required.**
   - `DATABASE_URL` — already set automatically by the Postgres plugin, just confirm it's there.
4. **Run the migration once** to create the tables. Easiest way: open the Railway service's shell/console (or use the "Run Command" feature) and run:
   ```
   npm run migrate
   ```
   Alternatively, run it locally against the Railway Postgres by copying `DATABASE_URL` into a local `.env` and running `npm run migrate` on your machine.
5. Railway will detect `npm start` from `railway.json` / `package.json` and deploy. Once live, visit your Railway-provided URL — you'll land on the NOVA sign-up screen.

## Running locally

```bash
cp .env.example .env
# fill in DATABASE_URL (point at a local or Railway Postgres) and JWT_SECRET
npm install
npm run migrate
npm start
```

Visit `http://localhost:3000`.

## How accounts work

- Sign up with just a display name + password. NOVA generates you a unique ID
  (`NOVA-XXXXXX`) — that's shown once at signup, save it. It's how friends find
  you to start a DM or add you to a group.
- Log back in anytime with your NOVA ID + password.
- There's no email/phone recovery flow yet — if you lose your password, you lose
  the account. Fine for a friends-group app; add a recovery flow before opening
  this up more broadly.

## Feature map

| Feature | Status |
|---|---|
| Auth (NOVA ID + password) | ✅ |
| Direct messages (real-time) | ✅ |
| Group chats | ✅ |
| Channels (broadcast, invite code to join) | ✅ |
| Typing indicators | ✅ |
| Status updates (24h expiring text) | ✅ |
| Posts feed (captions, likes, comment counts) | ✅ |
| Media/image uploads | ❌ not yet — see below |
| End-to-end encryption | ❌ not yet — see below |
| Push notifications | ❌ not yet |

## What's next if you want to keep building

- **Media uploads** (photos in chat, status, posts): wire up Cloudinary or
  Supabase Storage — free tiers are generous. I kept this out of v1 to get you
  a working real-time core first.
- **End-to-end encryption**: right now messages are encrypted in transit (HTTPS/WSS)
  and at rest in Postgres, but the server can technically read message content.
  True E2E (Signal Protocol) is a substantial addition — worth doing once the
  core product feels good to use.
- **Push notifications**: needs a service worker + Web Push, or a mobile wrapper.
- **Comment UI for posts**: the API supports comments already (`/api/posts/:id/comments`),
  just needs a UI panel — small addition.

## Security notes

- Passwords are hashed with bcrypt, never stored in plaintext.
- `JWT_SECRET` must be kept private — anyone with it can mint valid session tokens.
- Never commit your `.env` file or paste real API keys/secrets into chat — rotate
  immediately if you ever do.
