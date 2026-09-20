# DARK CHAT Upgrade Backlog

This backlog records the next implementation scope for NOVA TECH TG. It is intentionally split into **20 bugs to fix** and **20 features to add**. Authentication remains on the existing bcrypt/JWT implementation and is not included as a migration item.

## 20 bugs to fix

1. **Vercel deployment drift.** The live `nova-tech-tg.vercel.app` deployment can serve an older build than GitHub `main`. The deployment must be linked to the correct repository and production branch, with a visible commit SHA in the app diagnostics.

2. **Branding drift between environments.** The repository, page title, and live deployment have used both `NOVA Messenger` and `DARK CHAT`. The product name must be consistent in the header, metadata, authentication screens, and deployment verification.

3. **Privacy settings are not enforced server-side.** Stored online, last-seen, profile-photo, bio, status, and read-receipt preferences must control every relevant API response and socket event.

4. **Blocked users are not fully isolated.** Blocking currently has a persistence endpoint, but message creation, conversation lookup, search, notifications, and presence must all reject or hide blocked-user interactions.

5. **Notification coverage is incomplete.** Message, reaction, mention, status-reply, group, and call events do not consistently create notifications. Event creation must be centralized and deduplicated.

6. **Notification unread state is not live.** The client updates the indicator mainly when the notification modal opens. Socket events should update unread counts immediately and mark notifications read only after they are actually viewed.

7. **Media uploads lack size and type enforcement.** Images, videos, audio, and documents need server-side byte limits, MIME validation, extension normalization, and rejection of malformed base64 payloads.

8. **Media uploads are not resumable.** Large uploads can fail without progress, retry, cancellation, or recovery. The composer needs a visible upload state and safe retry behavior.

9. **Generic file messages lose useful metadata.** File messages should preserve the original filename, byte size, MIME type, and a safe download name rather than displaying only `Open attachment`.

10. **Status privacy is not applied.** Status feeds currently need audience filtering for contacts, selected users, exclusions, and blocked users before status documents reach the client.

11. **Status lifecycle controls are incomplete.** Expired status records should be excluded reliably, media should be cleaned up after deletion, and viewer records should not expose unauthorized data.

12. **Call signaling is incomplete.** The call session model does not yet guarantee complete offer, answer, ICE candidate, busy, declined, missed, reconnecting, and ended transitions.

13. **Presence can become stale.** Disconnects, reconnects, multiple tabs, and server restarts can leave users incorrectly marked online. Presence needs heartbeat expiry and connection counting.

14. **Drafts are device-local only.** Drafts stored in local storage disappear on another device and can conflict when conversations are open in multiple tabs. Draft persistence needs a server-backed revision model.

15. **Conversation lists do not paginate.** Large accounts load the entire conversation set. The API and client need cursor pagination and incremental rendering.

16. **Message lists do not provide a complete history experience.** Older-message loading, loading state, duplicate prevention, and scroll-position restoration are incomplete.

17. **Message sending lacks an offline queue.** A temporary network failure can lose a message or leave the composer in an ambiguous state. Messages need client IDs, retry state, and idempotent server handling.

18. **Read and delivery states are incomplete.** Sent, delivered, read, failed, and seen-by states are not consistently persisted, broadcast, or rendered for direct and group messages.

19. **Mobile keyboard and safe-area behavior is fragile.** Composer height, viewport resizing, bottom navigation, and device safe areas need testing on real Android and iOS browsers.

20. **There is no automated end-to-end regression suite.** Authentication, conversation creation, messaging, uploads, status posting, notifications, privacy, and calls need browser tests that run against a seeded test environment.

## 20 features to add

1. **WhatsApp-style message delivery indicators.** Render sent, delivered, read, failed, and retry states with socket updates and server persistence.

2. **Multi-message selection mode.** Add long-press and desktop selection with bulk copy, forward, save, star, delete, and report actions.

3. **Forward-message workflow.** Let users choose one or more conversations, add an optional caption, and preserve source attribution safely.

4. **Message information screen.** Show delivery time, read time, recipients, reactions, edits, and deletion state for the selected message.

5. **Pinned and starred message views.** Add conversation-level pinned-message controls and an account-level starred-message screen with navigation back to the original chat.

6. **GIF and sticker system.** Add searchable GIFs, sticker packs, recent items, favorites, animated playback, and server-side content safety limits.

7. **Rich composer tools.** Add emoji history, mention autocomplete, link preview cards, formatting controls, and attachment previews before sending.

8. **Shared-media browser.** Add tabs for photos, videos, links, documents, audio, and voice messages with date grouping and download controls.

9. **Complete status editor.** Add captions, text placement, emoji, background controls, cropping, video trimming, and a preview before publishing.

10. **Status audience selector.** Add contacts, selected contacts, exclusions, and privacy presets, with the chosen audience enforced by the backend.

11. **Status reactions and replies.** Allow quick reactions and replies that create normal conversation messages with a reference to the originating status.

12. **Full group administration.** Add member roles, admin promotion, demotion, removal, invite approval, group description, group image, join permissions, and moderation history.

13. **Channel management.** Add subscriber controls, channel roles, post editing, post deletion, reactions, channel-specific notifications, and basic analytics.

14. **Complete one-to-one calling.** Add incoming and outgoing call screens, accept, decline, busy, missed, mute, camera, speaker, reconnect, retry, duration, and call history states.

15. **Group voice and video calls.** Add participant management, active-speaker display, mute controls, camera controls, and safe call termination.

16. **Push-notification system.** Add service-worker registration, device tokens, message notifications, mentions, reactions, status replies, and call alerts with preference controls.

17. **Offline-first synchronization.** Add IndexedDB caching, an offline send queue, background synchronization, conflict resolution, and reconnect reconciliation.

18. **Privacy and safety center.** Add unblock management, mute and restrict controls, reporting, who-can-message rules, who-can-add-to-groups rules, and account data export.

19. **Archive, wallpaper, and disappearing-message controls.** Add dedicated archived and pinned-chat screens, per-chat wallpaper selection, retention timers, and automatic message-expiry handling.

20. **Production observability and quality gates.** Add deployment commit diagnostics, structured server logs, rate limiting, error reporting, accessibility checks, performance budgets, security-rule checks, and mobile browser CI.

## Recommended implementation order

The first release block should fix deployment drift, privacy enforcement, blocking, notification correctness, upload validation, pagination, and delivery states. The second block should deliver message selection, forwarding, shared media, the complete status system, and group administration. The third block should deliver calls, push notifications, offline synchronization, and production quality gates.

## Scope boundary

The existing bcrypt/JWT authentication flow remains unchanged. This backlog covers the non-authentication product, reliability, safety, and deployment work around that flow.

## References

[1]: https://github.com/jamesprivategmail-commits/NOVA-TECH-TG "NOVA TECH TG source repository"

[2]: https://nova-tech-tg.vercel.app "NOVA TECH TG live deployment"
