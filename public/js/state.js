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
  state.readAt[conversationId] = timestamp || new Date().toISOString();
  state.unread[conversationId] = 0;
  writeJson(READ_KEY, state.readAt);
  writeJson(UNREAD_KEY, state.unread);
  emit('unread:changed');
}

export function bumpUnread(conversationId) {
  if (!conversationId) return;
  // Do not count messages we are currently looking at.
  if (state.activeConv && state.activeConv.id === conversationId && document.visibilityState === 'visible') return;
  state.unread[conversationId] = (state.unread[conversationId] || 0) + 1;
  writeJson(UNREAD_KEY, state.unread);
  emit('unread:changed');
}

export function isUnread(conv) {
  if (!conv) return false;
  if (state.unread[conv.id]) return true;
  const lastAt = conv.last_message_at;
  if (!lastAt) return false;
  const seen = state.readAt[conv.id];
  if (!seen) return true;
  return new Date(lastAt).getTime() > new Date(seen).getTime();
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
