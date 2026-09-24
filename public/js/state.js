// state.js - single source of truth + tiny event bus
const TOKEN_KEY = 'darkchat_token';
const READ_KEY = 'darkchat_read_at';
const UNREAD_KEY = 'darkchat_unread';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export const state = {
  token: null,
  me: null,
  conversations: [],
  activeConv: null,
  messages: {},          // conversationId -> array (oldest -> newest)
  hasMore: {},           // conversationId -> boolean (more history before first message)
  statuses: [],
  posts: [],
  notifications: [],
  unreadNotifications: 0,
  presence: {},          // userId -> online boolean
  typing: {},            // conversationId -> { userId -> expiresAt }
  settings: { privacySettings: {}, blockedUserIds: [] },
  filter: 'all',
  readAt: readJson(READ_KEY, {}),   // conversationId -> ISO timestamp
  unread: readJson(UNREAD_KEY, {}), // conversationId -> count
  searchOpen: false,
  socketReady: false,
  online: navigator.onLine !== false
};

export function loadToken() {
  try { state.token = localStorage.getItem(TOKEN_KEY); } catch { state.token = null; }
  return state.token;
}

export function saveToken(token) {
  state.token = token || null;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

export function clearSession() {
  saveToken(null);
  state.me = null;
  state.conversations = [];
  state.activeConv = null;
  state.messages = {};
  state.hasMore = {};
  state.statuses = [];
  state.posts = [];
  state.notifications = [];
  state.unreadNotifications = 0;
  state.presence = {};
  state.typing = {};
  state.readAt = {};
  state.unread = {};
  writeJson(READ_KEY, {});
  writeJson(UNREAD_KEY, {});
}

export function markRead(conversationId, timestamp) {
  if (!conversationId) return;
  const readTimestamp = timestamp || new Date().toISOString();
  state.readAt[conversationId] = readTimestamp;
  state.unread[conversationId] = 0;
  const conv = state.conversations.find((c) => c.id === conversationId);
  if (conv) {
    conv.unread_count = 0;
  }
  writeJson(READ_KEY, state.readAt);
  writeJson(UNREAD_KEY, state.unread);
  emit('unread:changed');
}

export function bumpUnread(conversationId) {
  if (!conversationId) return;
  // Do not count messages we are currently looking at in active tab.
  if (state.activeConv && state.activeConv.id === conversationId && document.visibilityState === 'visible') return;
  const next = (state.unread[conversationId] || 0) + 1;
  state.unread[conversationId] = next;
  const conv = state.conversations.find((c) => c.id === conversationId);
  if (conv) {
    conv.unread_count = next;
  }
  writeJson(UNREAD_KEY, state.unread);
  emit('unread:changed');
}

export function isUnread(conv) {
  if (!conv) return false;
  // If the user sent the last message, the conversation cannot be unread for them.
  if (conv.last_sender_id && state.me?.id && String(conv.last_sender_id) === String(state.me.id)) {
    return false;
  }
  const count = (typeof state.unread[conv.id] === 'number')
    ? state.unread[conv.id]
    : (conv.unread_count || 0);
  return count > 0;
}

/** Sum of real unread message counts across non-archived conversations. */
export function totalUnreadCount() {
  let total = 0;
  for (const conv of state.conversations || []) {
    if (conv.archived || conv.type === 'channel') continue;
    if (conv.last_sender_id && state.me?.id && String(conv.last_sender_id) === String(state.me.id)) {
      continue;
    }
    const count = (typeof state.unread[conv.id] === 'number')
      ? state.unread[conv.id]
      : (conv.unread_count || 0);
    if (count > 0) {
      total += count;
    }
  }
  return total;
}

// -------- event bus --------
const handlers = new Map();

export function on(event, handler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(handler);
  return () => off(event, handler);
}

export function off(event, handler) {
  const set = handlers.get(event);
  if (set) set.delete(handler);
}

export function emit(event, detail) {
  const set = handlers.get(event);
  if (!set) return;
  for (const handler of [...set]) {
    try { handler(detail); } catch (err) { console.error('handler error for', event, err); }
  }
}
