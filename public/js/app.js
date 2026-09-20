// app.js - boot + router
import { api } from './api.js';
import { state, loadToken, on, emit } from './state.js';
import { $, toast } from './ui.js';
import { connectSocket, disconnectSocket, sendMessage } from './socket.js';

import { initAuth, showAuth, hideAuth, forceLogout, logout } from './auth.js';
import { initChats, refreshConversations, showChatsLoading, showChatsError, renderMeHeader } from './chats.js';
import { initChat, openConversation, closeConversation } from './chat.js';
import { initStatus, loadStatuses } from './status.js';
import { initDiscover, loadDiscover } from './discover.js';
import { initPosts, loadPosts } from './posts.js';
import { initProfile, renderProfile } from './profile.js';
import { initSettings, loadProfileSettings } from './settings.js';
import { initAdmin, openAdminPanel } from './admin.js';
import { initNotifications, refreshUnread } from './notifications.js';
import { initCalls } from './calls.js';

const SCREENS = {
  chats: '#screen-chats',
  status: '#screen-status',
  posts: '#screen-posts',
  discover: '#screen-discover',
  profile: '#screen-profile'
};

let currentTab = 'chats';

const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;

export function showTab(name) {
  if (!SCREENS[name]) return;
  currentTab = name;
  Object.entries(SCREENS).forEach(([key, sel]) => {
    const el = $(sel);
    if (!el) return;
    const active = key === name;
    el.classList.toggle('active', active);
    el.hidden = !active;
  });
  document.querySelectorAll('.bottom-nav .nav').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === name));
  emit('tab:show', name);
  if (name === 'status') loadStatuses();
  if (name === 'posts') loadPosts();
  if (name === 'discover') loadDiscover();
  if (name === 'profile') renderProfile();
}

function showChatPlaceholder() {
  const screen = $('#screen-chat');
  if (!screen) return;
  screen.hidden = false;
  screen.classList.add('active');
  const messages = $('#messages');
  if (messages) messages.innerHTML = `<div class="empty">
    <div class="empty-icon"><svg class="icon" aria-hidden="true"><use href="#i-message"></use></svg></div>
    <div class="title">Select a conversation</div>
    <div class="subtitle">Pick a chat from the list, or start a new one with a friend's DARK CHAT ID.</div></div>`;
  const title = $('#chat-title'); if (title) title.textContent = 'DARK CHAT';
  const sub = $('#chat-sub'); if (sub) sub.textContent = 'Choose a conversation';
  const avatarEl = $('#chat-avatar');
  if (avatarEl) avatarEl.outerHTML = '<span class="avatar avatar-sm" id="chat-avatar"></span>';
}

function updateLayout() {
  const screen = $('#screen-chat');
  if (!screen) return;
  if (state.activeConv) return; // chat module controls visibility
  if (isDesktop()) showChatPlaceholder();
  else { screen.hidden = true; screen.classList.remove('active'); }
}

async function loadConversations() {
  showChatsLoading();
  try {
    await refreshConversations();
  } catch (err) {
    showChatsError(err.message || 'Network error');
  }
}

async function onSignedIn() {
  hideAuth();
  renderMeHeader();
  showTab('chats');
  updateLayout();
  await Promise.allSettled([
    loadConversations(),
    loadStatuses(),
    loadPosts(),
    loadProfileSettings(),
    refreshUnread()
  ]);
  try {
    await connectSocket();
  } catch {
    toast('Realtime connection unavailable');
  }
}

function wireChrome() {
  document.querySelectorAll('.bottom-nav .nav').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  window.addEventListener('resize', updateLayout);
}

function wireEvents() {
  on('tab:show', () => updateLayout());
  on('auth:signed-in', onSignedIn);
  on('auth:expired', () => { disconnectSocket(); forceLogout('Your session expired - please log in again.'); });
  on('auth:logout', () => { disconnectSocket(); logout(); });
  on('me:updated', () => { renderMeHeader(); renderProfile(); emit('conversations:changed'); });
  on('data:refresh-conversations', () => loadConversations());
  on('admin:open-panel', () => openAdminPanel());
  on('chat:open', (conv) => { showTab(currentTab); openConversation(conv); });
  on('chat:needs-send', async ({ conversationId, content }) => {
    try {
      await refreshConversations();
      const conv = state.conversations.find((c) => c.id === conversationId);
      if (conv) openConversation(conv);
      const ack = await sendMessage({ conversationId, content });
      if (!ack || ack.error) toast('Could not send reply');
    } catch { toast('Could not send reply'); }
  });
}

async function boot() {
  wireChrome();
  wireEvents();
  initAuth();

  // Load the session BEFORE wiring up modules that fetch, so nothing ever
  // fires an authenticated request without a token attached.
  const token = loadToken();
  if (!token) {
    showAuth();
    return;
  }

  initChats();
  initChat();
  initStatus();
  initDiscover();
  initPosts();
  initProfile();
  initSettings();
  initAdmin();
  initNotifications();
  initCalls();

  try {
    const res = await api.me();
    state.me = res.user;
    await onSignedIn();
  } catch {
    showAuth();
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* SW optional */ });
  });
}

boot();

export { closeConversation };