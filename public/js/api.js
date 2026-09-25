// api.js - typed fetch wrapper over /api with the JWT and error normalisation
import { state, emit } from './state.js';

function resolveApiBase() {
  const PROD_API = 'https://ais-dev-si4qe2vjzzkc5btvtulch6-866141125336.europe-west2.run.app/api';
  try {
    if (typeof window !== 'undefined' && window.__API_BASE__) return String(window.__API_BASE__).replace(/\/$/, '');
    const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="api-base"]') : null;
    const metaVal = meta?.content?.trim();
    if (metaVal && !metaVal.includes('vercel.app')) return metaVal.replace(/\/$/, '');
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('apiBase') : null;
    if (stored && !stored.includes('vercel.app')) return stored.replace(/\/$/, '');
    // Standard web browser / AI Studio preview: use current origin's /api
    if (typeof location !== 'undefined' && /^https?:/.test(location.protocol)
        && !location.hostname.includes('appassets.androidplatform.net')
        && location.hostname !== 'localhost') {
      return '/api';
    }
    // APK WebView / local file fallback
    if (typeof location !== 'undefined' && (
      location.hostname.includes('appassets.androidplatform.net')
      || location.hostname === 'localhost'
      || location.protocol === 'file:'
    )) {
      return (metaVal && !metaVal.includes('vercel.app')) ? metaVal : PROD_API;
    }
  } catch { /* ignore */ }
  return '/api';
}

const BASE = resolveApiBase();

/** Origin of the API host (no trailing slash) */
export function apiOrigin() {
  try {
    if (/^https?:\/\//i.test(BASE)) {
      return BASE.replace(/\/api\/?$/, '');
    }
  } catch { /* ignore */ }
  if (typeof location !== 'undefined' && /^https?:/.test(location.protocol)
      && !location.hostname.includes('appassets.androidplatform.net')
      && location.hostname !== 'localhost') {
    return location.origin;
  }
  return 'https://ais-dev-si4qe2vjzzkc5btvtulch6-866141125336.europe-west2.run.app';
}

/** Make media/storage URLs absolute and fix dead domains so APK WebView and web load properly */
export function mediaSrc(url) {
  if (!url) return '';
  let u = String(url);
  // Normalize old vercel or obsolete host URLs pointing to storage
  if (/vercel\.app/i.test(u) || /darkchat.*\.app/i.test(u)) {
    const storageIdx = u.indexOf('/api/storage/files/');
    if (storageIdx !== -1) {
      u = u.slice(storageIdx);
    } else {
      const assetIdx = u.indexOf('/assets/');
      if (assetIdx !== -1) u = u.slice(assetIdx);
    }
  }
  if (u.startsWith('data:') || u.startsWith('blob:')) return u;
  if (u.startsWith('/')) return apiOrigin() + u;
  if (/^https?:\/\//i.test(u)) return u;
  return apiOrigin() + '/' + u;
}

export function apiBase() { return BASE; }


export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    throw new ApiError('Network error - check your connection', 0, null);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    // Only treat a 401 as an expired session when a token was actually sent.
    // Anonymous startup calls and failed logins must never wipe the session.
    if (res.status === 401 && auth && state.token) emit('auth:expired');
    throw new ApiError(message, res.status, data);
  }
  return data;
}

export const api = {
  health: () => request('/health', { auth: false }),

  // auth
  signup: (displayName, password) => request('/auth/signup', { method: 'POST', body: { displayName, password }, auth: false }),
  login: (novaId, password, twoFactorPin = null) => request('/auth/login', { method: 'POST', body: { novaId, password, twoFactorPin }, auth: false }),
  me: () => request('/auth/me'),
  updateMe: (payload) => request('/auth/me', { method: 'PUT', body: payload }),
  lookup: (novaId) => request(`/auth/lookup/${encodeURIComponent(novaId)}`),

  // conversations
  conversations: () => request('/conversations'),
  createDm: (novaId) => request('/conversations/dm', { method: 'POST', body: { novaId } }),
  createGroup: (name, memberNovaIds) => request('/conversations/group', { method: 'POST', body: { name, memberNovaIds } }),
  createChannel: (name) => request('/conversations/channel', { method: 'POST', body: { name } }),
  createCommunity: (name, description) => request('/conversations/community', { method: 'POST', body: { name, description } }),
  exportConversation: (id) => `${apiOrigin()}/api/conversations/${encodeURIComponent(id)}/export`,
  setDisappearing: (id, seconds) => request(`/conversations/${encodeURIComponent(id)}/disappearing`, { method: 'POST', body: { seconds } }),
  joinConversation: (inviteCode) => request('/conversations/join', { method: 'POST', body: { inviteCode } }),
  members: (id) => request(`/conversations/${encodeURIComponent(id)}/members`),
  addMember: (id, novaId) => request(`/conversations/${encodeURIComponent(id)}/members`, { method: 'POST', body: { novaId } }),
  addMembers: (id, novaIds) => request(`/conversations/${encodeURIComponent(id)}/members`, { method: 'POST', body: { novaIds } }),
  updateMemberRole: (id, userId, role) => request(`/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/role`, { method: 'PATCH', body: { role } }),
  moderateMember: (id, userId, action, durationSeconds = 0) => request(`/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/moderation`, { method: 'PATCH', body: { action, durationSeconds } }),
  removeMember: (id, userId) => request(`/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  transferOwnership: (id, userId) => request(`/conversations/${encodeURIComponent(id)}/ownership`, { method: 'POST', body: { userId } }),
  updateConversation: (id, patch) => request(`/conversations/${encodeURIComponent(id)}`, { method: 'PUT', body: patch }),
  deleteConversation: (id) => request(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  messages: (id, before) => request(`/conversations/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  sendMessage: (id, payload) => request(`/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: payload }),
  markConversationRead: (id) => request(`/conversations/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} }),
  searchMessages: (id, q) => request(`/conversations/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}`),
  editMessage: (id, messageId, content) => request(`/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: { content } }),
  deleteMessage: (id, messageId, scope) => request(`/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE', body: { scope } }),
  react: (id, messageId, reaction) => request(`/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/reactions`, { method: 'POST', body: { reaction } }),
  saveMessage: (id, messageId) => request(`/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/save`, { method: 'POST', body: {} }),
  pinMessage: (id, messageId) => request(`/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/pin`, { method: 'POST', body: {} }),

  // status
  createStatus: (payload) => request('/status', { method: 'POST', body: payload }),
  statusFeed: () => request('/status/feed'),
  viewStatus: (id) => request(`/status/${encodeURIComponent(id)}/view`, { method: 'POST', body: {} }),
  deleteStatus: (id) => request(`/status/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // posts
  posts: () => request('/posts'),
  createPost: (payload) => request('/posts', { method: 'POST', body: payload }),
  deletePost: (id) => request(`/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  likePost: (id) => request(`/posts/${encodeURIComponent(id)}/like`, { method: 'POST', body: {} }),
  comments: (id) => request(`/posts/${encodeURIComponent(id)}/comments`),
  addComment: (id, content) => request(`/posts/${encodeURIComponent(id)}/comments`, { method: 'POST', body: { content } }),

  // notifications
  notifications: () => request('/notifications'),
  unreadCount: () => request('/notifications/unread-count'),
  markRead: (id) => request('/notifications/read', { method: 'POST', body: id ? { id } : {} }),

  reactStatus: (id, emoji) => request(`/status/${encodeURIComponent(id)}/react`, { method: 'POST', body: { emoji } }),

  // profile
  profileSettings: () => request('/profile/settings'),
  updateProfileSettings: (patch) => request('/profile/settings', { method: 'PUT', body: patch }),
  changePassword: (currentPassword, newPassword) => request('/profile/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  deleteAccount: (password) => request('/profile/delete-account', { method: 'POST', body: { password } }),
  toggleStar: (messageId) => request(`/profile/starred/${encodeURIComponent(messageId)}`, { method: 'POST' }),
  backupDataUrl: () => `${apiOrigin()}/api/profile/backup`,
  block: (novaId) => request('/profile/block', { method: 'POST', body: { novaId } }),
  stickerPacks: () => request('/profile/stickers'),
  addSticker: (payload) => request('/profile/stickers', { method: 'POST', body: payload }),
  unblock: (userId) => request('/profile/unblock', { method: 'POST', body: { userId } }),

  // discover
  discover: (search) => request(`/discover/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  discoverChannels: (search) => request(`/discover/channels${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  // admin
  adminUsers: (search) => request(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  adminChannels: (search) => request(`/admin/channels${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  adminVerifyChannel: (id) => request(`/admin/channels/${encodeURIComponent(id)}/verify`, { method: 'POST', body: {} }),
  adminUnverifyChannel: (id) => request(`/admin/channels/${encodeURIComponent(id)}/unverify`, { method: 'POST', body: {} }),
  adminBan: (id, reason) => request(`/admin/users/${encodeURIComponent(id)}/ban`, { method: 'POST', body: { reason } }),
  adminUnban: (id) => request(`/admin/users/${encodeURIComponent(id)}/unban`, { method: 'POST', body: {} }),
  adminVerify: (id) => request(`/admin/users/${encodeURIComponent(id)}/verify`, { method: 'POST', body: {} }),
  adminUnverify: (id) => request(`/admin/users/${encodeURIComponent(id)}/unverify`, { method: 'POST', body: {} }),
  adminDelete: (id) => request(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // calls
  iceServers: () => request('/calls/ice-servers'),
  callHistory: (conversationId) => request(`/calls/history/${encodeURIComponent(conversationId)}`),
  startCall: (conversationId, kind) => request('/calls', { method: 'POST', body: { conversationId, kind } }),
  updateCall: (id, stateName) => request(`/calls/${encodeURIComponent(id)}`, { method: 'PATCH', body: { state: stateName } }),

  // storage
  upload: (data, mimeType, filename) => request('/storage/upload', { method: 'POST', body: { data, mimeType, filename } })
};
