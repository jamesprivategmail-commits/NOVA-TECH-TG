// app.js - boot + router
import { api } from './api.js';
import { state, loadToken, on, emit, saveCachedMe } from './state.js';
import { $, toast, closeSheet } from './ui.js';
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
const loadedTabs = new Set(['chats']);

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

  // Lazy-load data only on tab view
  if (name === 'status') loadStatuses();
  if (name === 'posts') loadPosts();
  if (name === 'discover') loadDiscover();
  if (name === 'profile') renderProfile();
  loadedTabs.add(name);
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

  // Connect socket immediately without waiting for other APIs
  connectSocket().catch(() => {
    // Non-fatal, retried automatically
  });

  // Fast background sync of chats, unread badges, and profile settings
  Promise.allSettled([
    loadConversations(),
    loadProfileSettings(),
    refreshUnread()
  ]);
}

function wireChrome() {
  const appUrl = location.href.split('#')[0];
  // Keep an in-app history entry so the first browser Back action is handled by the SPA.
  history.replaceState({ app: true, tab: currentTab, chat: false }, '', `${appUrl}#chats`);
  history.pushState({ app: true, tab: currentTab, chat: false }, '', `${appUrl}#chats`);
  document.querySelectorAll('.bottom-nav .nav').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      history.pushState({ app: true, tab, chat: false }, '', `${appUrl}#${tab}`);
      showTab(tab);
    });
  });
  window.addEventListener('popstate', (event) => {
    if (event.state?.app && state.activeConv) {
      closeConversation();
      return;
    }
    if (event.state?.app) {
      const tab = event.state.tab || 'chats';
      showTab(SCREENS[tab] ? tab : 'chats');
      return;
    }
    // The sentinel entry prevents the first Back action from leaving the app.
    history.pushState({ app: true, tab: currentTab, chat: false }, '', `${appUrl}#${currentTab}`);
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
  on('notification:open-chat', async ({ conversationId }) => {
    try {
      await refreshConversations();
      const conv = state.conversations.find((item) => String(item.id) === String(conversationId));
      if (!conv) return toast('Chat is no longer available');
      closeSheet();
      emit('chat:open', conv);
    } catch { toast('Could not open that chat'); }
  });
  on('admin:open-panel', () => openAdminPanel());
  on('chat:open', (conv) => {
    showTab(currentTab);
    history.pushState({ app: true, tab: currentTab, chat: true }, '', `#${currentTab}/chat`);
    openConversation(conv);
  });
  on('chat:needs-send', async ({ conversationId, content, statusReply, media }) => {
    try {
      await refreshConversations();
      const conv = state.conversations.find((c) => c.id === conversationId);
      if (conv) openConversation(conv);
      let mediaPayload = media || null;
      // If media is a data URL, upload first so both clients can resolve it.
      if (mediaPayload && mediaPayload.data && !mediaPayload.url) {
        try {
          const uploaded = await api.upload(mediaPayload.data, mediaPayload.mime, mediaPayload.name || 'status-reply');
          mediaPayload = {
            type: mediaPayload.type,
            url: uploaded.url,
            mime: uploaded.mimeType || mediaPayload.mime,
            duration: mediaPayload.duration || null
          };
        } catch (err) {
          toast(err.message || 'Could not upload reply media');
          return;
        }
      }
      const ack = await sendMessage({ conversationId, content, statusReply, media: mediaPayload });
      if (!ack || ack.error) toast(ack?.error || 'Could not send reply');
      else toast('Reply sent', 'success');
    } catch { toast('Could not send reply'); }
  });
}


function wireConnectivity() {
  const banner = document.getElementById('offline-banner');
  const sync = () => {
    state.online = navigator.onLine !== false;
    if (banner) banner.classList.toggle('hidden', state.online);
    if (state.online) emit('connectivity:online');
    else emit('connectivity:offline');
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
}

async function boot() {
  wireChrome();
  wireEvents();
  initAuth();

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

  // If we already have a cached profile, display UI IMMEDIATELY (0ms boot)
  if (state.me) {
    hideAuth();
    renderMeHeader();
    showTab('chats');
    updateLayout();
    connectSocket().catch(() => {});
  }

  // Validate / refresh profile and conversations in background
  try {
    const res = await api.me();
    state.me = res.user;
    saveCachedMe(res.user);
    await onSignedIn();
  } catch (err) {
    if (!state.me) {
      showAuth();
    }
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* SW optional */ });
  });
}

boot();

export { closeConversation };


/** Capacitor native shell hooks (Android/iOS WebView). */
async function capacitorAppInit() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    document.documentElement.classList.add('native-shell');
    document.documentElement.style.setProperty('--safe-t', 'env(safe-area-inset-top, 0px)');
  } catch { /* web only */ }
}
capacitorAppInit();
