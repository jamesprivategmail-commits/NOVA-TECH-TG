# Dark Chat Mobile UI Upgrade

## Direction
Rework the active vanilla frontend to feel like the supplied iMe/Telegram reference while preserving Dark Chat's existing capabilities and dark identity. Do not remove backend routes, realtime behavior, media/voice, calls, status, posts, discover, profile, or settings.

## Design system
- **Design movement:** dark mobile messenger / Telegram-inspired utility UI.
- **Core principles:** fast first paint, dense readable lists, one-thumb reachability, layered sheets instead of page dead-ends.
- **Color philosophy:** deep navy-black surfaces keep Dark Chat dark while the reference's cool blue active state becomes the primary accent; red remains reserved for destructive or urgent actions.
- **Layout paradigm:** fixed mobile app shell, scrollable content planes, compact list rows, persistent bottom navigation, floating compose action.
- **Signature elements:** blue active underline/pill, translucent elevated search field, rounded avatar rows with tight metadata.
- **Interaction philosophy:** tap feedback is immediate; tabs and chats slide; profile/group info rises in a sheet; long content scrolls independently.
- **Animation:** 180–240ms cubic-bezier transitions, subtle scale on press, sheet rise/fade, no heavy decorative motion.
- **Typography:** system sans / SF Pro-like stack; white primary text, cool grey metadata, blue active states.
- **Brand essence:** private, fast, expressive messaging for Dark Chat users. Personality: focused, quick, confident.
- **Brand voice:** concise and action-led. Example: “Search conversations” and “Start a new chat”.
- **Wordmark:** preserve DARK CHAT wordmark and existing logo assets; do not introduce a new brand asset.
- **Signature color:** `#42a5f5` reference-blue, used for active navigation, compose action, and links.

## Project structure
- `public/index.html`: existing app shell and feature surfaces; retain semantics and IDs.
- `public/css/app.css`: visual redesign and responsive behavior.
- `public/js/*.js`: existing feature modules and event wiring; no backend/API changes.
- `server.js` and `routes/`: existing service and realtime APIs; untouched.
- `public/manus-routes.json`: route manifest for the preview host.

## Implementation choices
- Layer a focused mobile-first override onto the existing CSS to avoid breaking feature selectors.
- Keep the five existing Dark Chat sections accessible; style them as the reference's compact app shell, with profile/settings available through the existing avatar and sheets.
- Add no AI surface and no new fake data.
- Validate with syntax checks, server health, route manifest, and a temporary HTTPS preview before committing.
