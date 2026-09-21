// api.js - typed fetch wrapper over /api with the JWT and error normalisation
import { state, emit } from './state.js';

const BASE = '/api';

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
  login: (novaId, password) => request('/auth/login', { method: 'POST', body: { novaId, password }, auth: false }),
  me: () => request('/auth/me'),
  updateMe: (payload) => request('/auth/me', { method: 'PUT', body: payload }),
  lookup: (novaId) => request(`/auth/lookup/${encodeURIComponent(novaId)}`),

  // conversations
  conversations: () => request('/conversations'),
  createDm: (novaId) => request('/conversations/dm', { method: 'POST', body: { novaId } }),
  createGroup: (name, memberNovaIds) => request('/conversations/group', { method: 'POST', body: { name, memberNovaIds } }),
  createChannel: (name) => request('/conversations/channel', { method: 'POST', body: { name } }),
  joinConversation: (inviteCode) => request('/conversations/join', { method: 'POST', body: { inviteCode } }),
  members: (id) => request(`/conversations/${encodeURIComponent(id)}/members`),
  addMember: (id, novaId) => request(`/conversations/${encodeURIComponent(id)}/members`, { method: 'POST', body: { novaId } }),
  addMembers: (id, novaIds) => request(`/conversations/${encodeURIComponent(id)}/members`, { method: 'POST', body: { novaIds } }),
  updateMemberRole: (id, userId, role) => request(`/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/role`, { method: 'PATCH', body: { role } }),
  removeMember: (id, userId) => request(`/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
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

  // profile
  profileSettings: () => request('/profile/settings'),
  updateProfileSettings: (patch) => request('/profile/settings', { method: 'PUT', body: patch }),
  block: (novaId) => request('/profile/block', { method: 'POST', body: { novaId } }),
  unblock: (userId) => request('/profile/unblock', { method: 'POST', body: { userId } }),

  // discover
  discover: (search) => request(`/discover/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  // admin
  adminUsers: (search) => request(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
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
