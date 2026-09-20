(() => {

const API = '/api';

let state = {
  token: localStorage.getItem('nova_token') || null,
  me: JSON.parse(localStorage.getItem('nova_me') || 'null'),
  conversations: [],
  activeConvId: null,
  activeConv: null,
  messages: {}, // convId -> [messages]
  socket: null,
  typingTimeout: null,
  myStatuses: [],
  replyToId: null,
  postImageData: null,
  postImageMime: null,
  conversationFilter: '',
  openMessageId: null,
  presence: {}
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function api(path, opts = {}) {
  return fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(opts.headers || {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  });
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function icon(name, label = '') {
  const paths = {
    reply: '<path d="M9 8 4 12l5 4v-3c5 0 7 2 8 4-.2-5-2.5-8-8-8V8Z"/>',
    react: '<circle cx="12" cy="12" r="8"/><path d="M8.5 10h.01M15.5 10h.01M8.5 14c1.8 1.8 5.2 1.8 7 0"/>',
    star: '<path d="m12 4 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8L12 4Z"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    copy: '<rect x="8" y="8" width="10" height="10" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
    check: '<path d="m5 12 4 4L19 6"/>'
  };
  return `<svg class="inline-icon" ${label ? `role="img" aria-label="${escapeHtml(label)}"` : 'aria-hidden="true"'} viewBox="0 0 24 24">${paths[name] || paths.more}</svg>`;
}

function verifiedBadge(isVerified) {
  return isVerified ? `<span class="verification-badge" title="Verified" aria-label="Verified">${icon('check')}</span>` : '';
}

// ---------------- AUTH ----------------
const authScreen = $('#auth-screen');
const appScreen = $('#app-screen');

function showAuthError(msg) {
  const el = $('#auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideAuthError() { $('#auth-error').classList.add('hidden'); }

$('#toggle-to-login a').addEventListener('click', (e) => {
  e.preventDefault();
  $('#signup-form').classList.add('hidden');
  $('#login-form').classList.remove('hidden');
  $('#toggle-to-login').classList.add('hidden');
  $('#toggle-to-signup').classList.remove('hidden');
  $('#auth-title').textContent = 'Welcome back';
  $('#auth-subtitle').textContent = 'Log in with your DARK CHAT ID.';
  $('#nova-id-reveal').classList.add('hidden');
  hideAuthError();
});

$('#toggle-to-signup a').addEventListener('click', (e) => {
  e.preventDefault();
  $('#login-form').classList.add('hidden');
  $('#signup-form').classList.remove('hidden');
  $('#toggle-to-signup').classList.add('hidden');
  $('#toggle-to-login').classList.remove('hidden');
  $('#auth-title').textContent = 'Welcome to DARK CHAT';
  $('#auth-subtitle').textContent = 'Message your people, your way.';
  hideAuthError();
});

$('#signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthError();
  const displayName = $('#signup-name').value.trim();
  const password = $('#signup-password').value;
  try {
    const { token, user } = await api('/auth/signup', { method: 'POST', body: { displayName, password } });
    $('#nova-id-reveal').classList.remove('hidden');
    $('#revealed-nova-id').textContent = user.novaId;
    setTimeout(() => login(token, user), 1800);
  } catch (err) {
    showAuthError(err.message);
  }
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthError();
  const novaId = $('#login-novaid').value.trim();
  const password = $('#login-password').value;
  try {
    const { token, user } = await api('/auth/login', { method: 'POST', body: { novaId, password } });
    login(token, user);
  } catch (err) {
    showAuthError(err.message);
  }
});

function login(token, user) {
  state.token = token;
  state.me = user;
  localStorage.setItem('nova_token', token);
  localStorage.setItem('nova_me', JSON.stringify(user));
  boot();
}

function logout() {
  localStorage.removeItem('nova_token');
  localStorage.removeItem('nova_me');
  location.reload();
}

function openProfileSettings() {
  const user = state.me;
  if (!user) return;
  $('#profile-edit-title').textContent = user.displayName || 'Your profile';
  $('#profile-edit-id').textContent = user.novaId || '';
  $('#profile-display-name').value = user.displayName || '';
  $('#profile-bio').value = user.bio || '';
  const avatar = $('#profile-edit-avatar');
  avatar.textContent = initials(user.displayName);
  avatar.style.background = user.avatarColor || '#ff3131';
  if (user.avatarUrl) avatar.style.backgroundImage = `url(${user.avatarUrl})`, avatar.style.backgroundSize = 'cover';
  const settings = JSON.parse(localStorage.getItem('nova_settings') || '{}');
  $('#setting-online').checked = settings.online !== false;
  $('#setting-receipts').checked = settings.receipts !== false;
  $('#setting-notifications').checked = settings.notifications !== false;
  $('#profile-modal').classList.remove('hidden');
  $('#profile-modal').setAttribute('aria-hidden', 'false');
  api('/profile/settings').then(result => {
    const privacy = result.privacySettings || {};
    if (privacy.online !== undefined) $('#setting-online').checked = privacy.online !== false;
    if (privacy.readReceipts !== undefined) $('#setting-receipts').checked = privacy.readReceipts !== false;
  }).catch(() => {});
}

function initProfileSettings() {
  const modal = $('#profile-modal');
  if (!modal || modal.dataset.initialized === '1') return;
  modal.dataset.initialized = '1';
  $('#me-avatar')?.addEventListener('click', openProfileSettings);
  $('#mobile-profile-btn')?.addEventListener('click', openProfileSettings);
  $('#profile-close-btn')?.addEventListener('click', () => $('#profile-modal').classList.add('hidden'));
  $('#profile-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'profile-modal') $('#profile-modal').classList.add('hidden');
  });
  $('#profile-logout-btn')?.addEventListener('click', () => {
    if (confirm('Log out of NOVA Messenger?')) logout();
  });
  $('#profile-edit-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('#profile-form-error');
    error.classList.add('hidden');
    const body = { displayName: $('#profile-display-name').value.trim(), bio: $('#profile-bio').value.trim() };
    const file = $('#profile-avatar-input').files?.[0];
    try {
      if (file) {
        body.avatarMime = file.type || 'image/jpeg';
        body.avatarData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      const result = await api('/auth/me', { method: 'PUT', body });
      state.me = result.user;
      localStorage.setItem('nova_me', JSON.stringify(state.me));
      $('#profile-modal').classList.add('hidden');
      updateCurrentUserAvatar();
      await loadConversations();
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove('hidden');
    }
  });
  ['online', 'receipts', 'notifications'].forEach(key => $(`#setting-${key}`)?.addEventListener('change', () => {
    const settings = JSON.parse(localStorage.getItem('nova_settings') || '{}');
    settings[key] = $(`#setting-${key}`).checked;
    localStorage.setItem('nova_settings', JSON.stringify(settings));
    const payload = key === 'receipts' ? { readReceipts: settings[key] } : key === 'online' ? { online: settings[key] } : {};
    if (Object.keys(payload).length) api('/profile/settings', { method: 'PUT', body: payload }).catch(() => {});
  }));
}

function updateCurrentUserAvatar() {
  const avatar = $('#me-avatar');
  if (!avatar || !state.me) return;
  avatar.textContent = initials(state.me.displayName);
  avatar.style.background = state.me.avatarColor || '#ff3131';
  if (state.me.avatarUrl) {
    avatar.style.backgroundImage = `url(${state.me.avatarUrl})`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
    avatar.textContent = '';
  }
}

function formatNotification(notification) {
  const kind = notification.type || notification.kind || 'activity';
  const text = notification.message || notification.content || `${kind} notification`;
  return `<div class="notification-item ${notification.read_at ? '' : 'unread'}"><div class="notification-dot"></div><div><div class="notification-text">${escapeHtml(text)}</div><div class="notification-time">${timeAgo(notification.created_at || notification.createdAt)}</div></div></div>`;
}

async function loadNotifications() {
  const list = $('#notifications-list');
  if (!list) return;
  list.innerHTML = '<div class="notification-loading">Loading notifications…</div>';
  try {
    const result = await api('/notifications');
    const notifications = result.notifications || [];
    list.innerHTML = notifications.length ? notifications.map(formatNotification).join('') : '<div class="notification-empty">You are all caught up.</div>';
    const unread = notifications.filter(n => !n.read_at).length;
    $('#notifications-btn')?.classList.toggle('has-unread', unread > 0);
  } catch (err) {
    list.innerHTML = `<div class="notification-empty">${escapeHtml(err.message)}</div>`;
  }
}

function initNotifications() {
  const modal = $('#notifications-modal');
  if (!modal || modal.dataset.initialized === '1') return;
  modal.dataset.initialized = '1';
  $('#notifications-btn')?.addEventListener('click', async () => {
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    await loadNotifications();
  });
  const close = () => { modal.classList.add('hidden'); document.body.classList.remove('modal-open'); };
  $('#notifications-close-btn')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
  $('#notifications-read-btn')?.addEventListener('click', async () => {
    await api('/notifications/read', { method: 'POST', body: {} });
    await loadNotifications();
  });
}

function selectTab(tab) {
  $$('.tabbar button, .mobile-nav button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-chats').classList.toggle('hidden', tab !== 'chats');
  $('#tab-status').classList.toggle('hidden', tab !== 'status');
  $('#tab-posts').classList.toggle('hidden', tab !== 'posts');
  $('#tab-discover').classList.toggle('hidden', tab !== 'discover');
  if (tab === 'status') loadStatuses();
  if (tab === 'posts') loadPosts();
  if (tab === 'discover') loadDiscover();
}

function discoverAvatar(user) {
  return user.avatarUrl
    ? `<img src="${escapeHtml(user.avatarUrl)}" alt="">`
    : escapeHtml(initials(user.displayName));
}

async function loadDiscover(search = $('#discover-search-input')?.value.trim() || '') {
  const list = $('#discover-list');
  if (!list) return;
  list.innerHTML = '<div class="discover-loading">Loading people…</div>';
  try {
    const result = await api(`/discover/users?search=${encodeURIComponent(search)}`);
    const users = result.users || [];
    list.innerHTML = users.length ? users.map(user => `
      <article class="discover-card">
        <div class="discover-head">
          <div class="discover-avatar" style="background:${escapeHtml(user.avatarColor)}">${discoverAvatar(user)}</div>
          <div class="discover-info">
            <div class="discover-name">${escapeHtml(user.displayName)} ${verifiedBadge(user.isVerified)}</div>
            <div class="discover-handle">${escapeHtml(user.novaId)}</div>
          </div>
          <button class="discover-message-btn" type="button" data-message-user="${escapeHtml(user.novaId)}">Message</button>
        </div>
        ${user.bio ? `<div class="discover-bio">${escapeHtml(user.bio)}</div>` : ''}
      </article>`).join('') : '<div class="discover-empty">No people found.<br>Try a name or DARK CHAT ID.</div>';
    list.querySelectorAll('[data-message-user]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Opening…';
      try {
        const result = await api('/conversations/dm', { method: 'POST', body: { novaId: button.dataset.messageUser } });
        await loadConversations();
        selectTab('chats');
        await openConversation(result.conversationId);
      } catch (err) {
        button.disabled = false;
        button.textContent = 'Message';
        alert(err.message);
      }
    }));
  } catch (err) {
    list.innerHTML = `<div class="discover-error">${escapeHtml(err.message)}</div>`;
  }
}

let discoverSearchTimer = null;
$('#discover-search-input')?.addEventListener('input', () => {
  clearTimeout(discoverSearchTimer);
  discoverSearchTimer = setTimeout(() => loadDiscover(), 220);
});

// ---------------- BOOT ----------------
async function boot() {
  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  updateCurrentUserAvatar();
  $('#me-avatar').title = `${state.me.displayName} (${state.me.novaId}) — open profile settings`;

  // Admin button visibility
  if (state.me.isAdmin) {
    const adminBtn = $('#admin-panel-btn');
    if (adminBtn) adminBtn.classList.remove('hidden');
  }

  connectSocket();
  await loadConversations();
  initStatusColors();
  initMediaButtons();
  initPostMedia();
  initAdminPanel();
  initCallControls();
  initChatHeaderActions();
  initProfileSettings();
  initNotifications();
}

function connectSocket() {
  state.socket = io({ auth: { token: state.token } });

  state.socket.on('message:new', (msg) => {
    if (!state.messages[msg.conversation_id]) state.messages[msg.conversation_id] = [];
    // Avoid duplicates
    if (!state.messages[msg.conversation_id].some(m => String(m.id) === String(msg.id))) {
      state.messages[msg.conversation_id].push(msg);
    }
    if (String(state.activeConvId) === String(msg.conversation_id)) {
      renderMessages(msg.conversation_id);
    }
    loadConversations(); // refresh previews/order
  });

  state.socket.on('typing', ({ conversationId, userId, isTyping }) => {
    if (String(conversationId) !== String(state.activeConvId) || String(userId) === String(state.me.id)) return;
    const area = $('#messages-area');
    let indicator = document.getElementById('typing-indicator-el');
    if (isTyping) {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'typing-indicator-el';
        indicator.className = 'msg-row theirs';
        indicator.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
        area.appendChild(indicator);
        area.scrollTop = area.scrollHeight;
      }
    } else if (indicator) {
      indicator.remove();
    }
  });

  state.socket.on('presence', ({ userId, online }) => {
    state.presence[String(userId)] = Boolean(online);
    if (state.activeConv?.type !== 'dm') return;
    if (String(state.activeConv.other_user?.id) === String(userId)) {
      $('#chat-subtitle').textContent = online ? 'online' : 'last seen recently';
    }
  });
}

// ---------------- TABS ----------------
$$('.tabbar button, .mobile-nav button[data-tab]').forEach(btn => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));
$('#conversation-search-input')?.addEventListener('input', (e) => {
  state.conversationFilter = e.target.value.trim().toLowerCase();
  renderConvList();
});

// ---------------- CONVERSATIONS ----------------
async function loadConversations() {
  const { conversations } = await api('/conversations');
  state.conversations = conversations || [];
  renderConvList();
  if (state.activeConvId) {
    state.activeConv = state.conversations.find(c => String(c.id) === String(state.activeConvId)) || state.activeConv;
  }
}

function renderConvList() {
  const list = $('#conv-list');
  const conversations = state.conversations.filter(c => {
    if (!state.conversationFilter) return true;
    const haystack = [c.name, c.last_message, c.other_user?.nova_id].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(state.conversationFilter);
  });
  if (state.conversations.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="icon icon-chat"></div><div class="title">No chats yet</div><div class="subtitle">Tap "+ New Chat" to message a friend.</div></div>`;
    return;
  }
  if (conversations.length === 0) {
    list.innerHTML = `<div class="empty-state compact"><div class="icon icon-search"></div><div class="title">No matching chats</div><div class="subtitle">Try another name or NOVA ID.</div></div>`;
    return;
  }
  list.innerHTML = conversations.map(c => {
    const preview = c.last_message
      ? (String(c.last_sender_id) === String(state.me.id) ? 'You: ' : '') + escapeHtml(c.last_message)
      : (c.type === 'channel' ? 'No posts yet' : 'Say hi');
    const badge = c.type === 'group' ? '<span class="conv-badge group">Group</span>'
      : c.type === 'channel' ? '<span class="conv-badge channel">Channel</span>' : '';
    return `
      <div class="conv-item ${String(c.id) === String(state.activeConvId) ? 'active' : ''}" data-id="${c.id}">
        <div class="avatar" style="background:${c.avatar_color || '#8E8E93'}">${initials(c.name || '?')}</div>
        <div class="conv-info">
          <div class="top-row">
          <span class="name">${escapeHtml(c.name || 'Unnamed')} ${verifiedBadge(c.is_verified || c.other_user?.is_verified)} ${badge}</span>
            <span class="time">${c.last_message_at ? timeAgo(c.last_message_at) : ''}</span>
          </div>
          <div class="preview">${preview}</div>
        </div>
      </div>`;
  }).join('');

  $$('.conv-item').forEach(item => {
    item.addEventListener('click', () => openConversation(item.dataset.id));
  });
}

async function openConversation(id) {
  state.activeConvId = String(id);
  closeChatTools();
  appScreen.classList.add('chat-open');
  $('#chat-empty').classList.add('hidden');
  $('#chat-active').classList.remove('hidden');
  renderConvList();

  const conv = state.conversations.find(c => String(c.id) === String(id));
  state.activeConv = conv;
  $('#chat-title').textContent = conv?.name || 'Chat';
  const otherOnline = conv?.other_user?.id && state.presence[String(conv.other_user.id)];
  $('#chat-subtitle').textContent = conv?.type === 'channel' ? 'Channel' : conv?.type === 'group' ? 'Group' : otherOnline ? 'online' : conv?.other_user?.nova_id || '';
  $('#chat-avatar').style.background = conv?.avatar_color || '#8E8E93';
  $('#chat-avatar').textContent = initials(conv?.name || '?');

  $('#chat-manage-btn').classList.toggle('hidden', !conv || conv.type === 'dm');

  state.socket.emit('conversation:join', { conversationId: id });

  if (!state.messages[id]) {
    const { messages } = await api(`/conversations/${id}/messages`);
    state.messages[id] = messages;
  }
  composerInput.value = localStorage.getItem(`nova_draft_${id}`) || '';
  composerInput.dispatchEvent(new Event('input'));
  renderMessages(id);
}

$('#chat-back').addEventListener('click', () => {
  appScreen.classList.remove('chat-open');
});

function renderMessages(convId) {
  const area = $('#messages-area');
  const msgs = state.messages[convId] || [];
  let html = '';
  let lastSender = null;
  let lastTime = null;

  msgs.forEach((m) => {
    const mine = String(m.sender_id) === String(state.me.id);
    const showTimeStamp = !lastTime || (new Date(m.created_at) - new Date(lastTime)) > 30 * 60 * 1000;

    if (showTimeStamp) {
      html += `<div class="msg-time">${new Date(m.created_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>`;
    }

    const isFirstInGroup = String(lastSender) !== String(m.sender_id) || showTimeStamp;
    if (isFirstInGroup && !mine) {
      html += `<div class="msg-group-sender">${escapeHtml(m.display_name)}</div>`;
    }

    const reply = m.reply_to_id ? msgs.find(x => String(x.id) === String(m.reply_to_id)) : null;
    const mediaSrc = m.media_url || m.media_data;
    const media = mediaSrc && m.media_type === 'image' ? `<img class="message-media" src="${mediaSrc}" alt="Attachment" style="max-width:240px;border-radius:10px;margin-top:6px;display:block;">`
      : mediaSrc && m.media_type === 'video' ? `<video class="message-media" controls src="${mediaSrc}" style="max-width:240px;border-radius:10px;margin-top:6px;display:block;"></video>`
      : mediaSrc && (m.media_type === 'audio' || m.media_type === 'voice') ? `<audio controls src="${mediaSrc}" style="max-width:240px;margin-top:6px;display:block;"></audio>`
      : mediaSrc && m.media_type === 'file' ? `<a class="message-file" href="${mediaSrc}" target="_blank" rel="noopener">Open attachment</a>` : '';

    const body = m.deleted_for_everyone ? '<em>This message was deleted</em>' : `${escapeHtml(m.content || '')}${media}`;
    const reactions = (m.reactions || []).map(r => `<span class="message-reaction">${escapeHtml(r.reaction)}</span>`).join('');
    html += `
      <div class="msg-row ${mine ? 'mine' : 'theirs'} ${isFirstInGroup ? 'grouped-first' : ''}" data-message-id="${m.id}">
        <div class="bubble ${mine ? 'mine' : 'theirs'}">
          ${reply ? `<button class="reply-preview" data-jump-to="${reply.id}"><strong>Replying to ${escapeHtml(reply.display_name || 'message')}</strong><span>${escapeHtml(reply.content || 'Attachment')}</span></button>` : ''}
          <div class="message-body">${body}</div>
          ${reactions ? `<div class="message-reactions">${reactions}</div>` : ''}
          <div class="message-meta">${new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${m.edited_at ? ' · edited' : ''}</div>
        </div>
        <div class="message-actions">
          <button data-action="reply" data-id="${m.id}" aria-label="Reply">${icon('reply','Reply')}</button>
          <button data-action="react" data-id="${m.id}" aria-label="React">${icon('react','React')}</button>
          <button data-action="save" data-id="${m.id}" aria-label="${m.saved_by_me ? 'Unsave' : 'Save'}">${icon('star', m.saved_by_me ? 'Unsave' : 'Save')}</button>
          <button data-action="more" data-id="${m.id}" aria-label="More message actions">${icon('more','More')}</button>
        </div>
      </div>`;

    lastSender = m.sender_id;
    lastTime = m.created_at;
  });

  area.innerHTML = html || `<div class="empty-state"><div class="icon">✨</div><div class="title">No messages yet</div><div class="subtitle">Say something!</div></div>`;
  wireMessageActions(convId);
  area.querySelectorAll('.msg-row[data-message-id]').forEach(row => {
    const open = (event) => {
      if (event.target.closest('button, a, input, textarea')) return;
      event.preventDefault();
      area.querySelectorAll('.msg-row.message-menu-open').forEach(item => item.classList.remove('message-menu-open'));
      row.classList.add('message-menu-open');
      state.openMessageId = row.dataset.messageId;
    };
    row.addEventListener('click', open);
    row.addEventListener('contextmenu', open);
  });
  area.scrollTop = area.scrollHeight;
}

function wireMessageActions(convId) {
  const area = $('#messages-area');
  area.querySelectorAll('[data-action="reply"]').forEach(btn => btn.addEventListener('click', () => {
    state.replyToId = btn.dataset.id;
    const msg = (state.messages[convId] || []).find(m => String(m.id) === String(state.replyToId));
    composerInput.value = '';
    composerInput.placeholder = `Reply to ${msg?.display_name || 'message'}…`;
    composerInput.focus();
  }));

  area.querySelectorAll('[data-action="react"]').forEach(btn => btn.addEventListener('click', async () => {
    const reaction = prompt('Reaction emoji', '❤️');
    if (!reaction) return;
    await api(`/conversations/${convId}/messages/${btn.dataset.id}/reactions`, { method: 'POST', body: { reaction } });
    const result = await api(`/conversations/${convId}/messages`);
    state.messages[convId] = result.messages;
    renderMessages(convId);
  }));

  area.querySelectorAll('[data-action="save"]').forEach(btn => btn.addEventListener('click', async () => {
    await api(`/conversations/${convId}/messages/${btn.dataset.id}/save`, { method: 'POST' });
    const result = await api(`/conversations/${convId}/messages`);
    state.messages[convId] = result.messages;
    renderMessages(convId);
  }));

  area.querySelectorAll('[data-action="more"]').forEach(btn => btn.addEventListener('click', async () => {
    const msg = (state.messages[convId] || []).find(m => String(m.id) === String(btn.dataset.id));
    const isMine = String(msg?.sender_id) === String(state.me.id);
    const options = isMine ? 'edit, delete, delete-everyone, cancel' : 'delete, save, cancel';
    const choice = prompt(`Message actions (${options}):`);
    if (choice === 'edit' && msg) {
      const content = prompt('Edit message', msg.content || '');
      if (content) await api(`/conversations/${convId}/messages/${msg.id}`, { method: 'PATCH', body: { content } });
    } else if (choice === 'delete' || choice === 'delete-everyone') {
      await api(`/conversations/${convId}/messages/${msg.id}`, { method: 'DELETE', body: { scope: choice === 'delete-everyone' ? 'everyone' : 'me' } });
    } else return;
    const result = await api(`/conversations/${convId}/messages`);
    state.messages[convId] = result.messages;
    renderMessages(convId);
  }));

  area.querySelectorAll('.reply-preview').forEach(btn => btn.addEventListener('click', () => {
    const target = area.querySelector(`[data-message-id="${btn.dataset.jumpTo}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
}

function closeChatTools() {
  $('#chat-tools-menu')?.classList.add('hidden');
}

function initChatHeaderActions() {
  const menu = $('#chat-tools-menu');
  if (!menu || menu.dataset.initialized === '1') return;
  menu.dataset.initialized = '1';
  $('#chat-call-btn')?.addEventListener('click', () => startCall('voice'));
  $('#chat-video-btn')?.addEventListener('click', () => startCall('video'));
  $('#chat-search-btn')?.addEventListener('click', () => {
    const query = prompt('Search this conversation');
    if (!query?.trim() || !state.activeConvId) return;
    api(`/conversations/${state.activeConvId}/search?q=${encodeURIComponent(query.trim())}`).then(result => {
      const hit = (result.messages || [])[0];
      if (!hit) return alert('No matching messages in this chat.');
      document.querySelector(`[data-message-id="${hit.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }).catch(err => alert(err.message));
  });
  $('#chat-more-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    menu?.classList.toggle('hidden');
  });
  menu?.querySelectorAll('[data-chat-tool]').forEach(btn => btn.addEventListener('click', async () => {
    const action = btn.dataset.chatTool;
    const conv = state.activeConv;
    if (!conv) return;
    closeChatTools();
    if (action === 'clear') {
      if (!confirm('Clear this chat for you?')) return;
      const messages = state.messages[conv.id] || [];
      await Promise.all(messages.map(message => api(`/conversations/${conv.id}/messages/${message.id}`, { method: 'DELETE', body: { scope: 'me' } }).catch(() => null)));
      const result = await api(`/conversations/${conv.id}/messages`);
      state.messages[conv.id] = result.messages || [];
      renderMessages(conv.id);
      return;
    }
    if (action === 'pin' || action === 'archive' || action === 'mute') {
      await api(`/conversations/${conv.id}`, { method: 'PUT', body: { [action === 'pin' ? 'pinned' : action === 'archive' ? 'archived' : 'muted']: true } });
      await loadConversations();
      return;
    }
    if (action === 'media') alert('Shared media will appear here once this conversation has attachments.');
  }));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#chat-tools-menu, #chat-more-btn')) closeChatTools();
  });
}

// ---------------- COMPOSER & MEDIA (FIREBASE STORAGE) ----------------
const composerInput = $('#composer-input');

composerInput.addEventListener('input', () => {
  composerInput.style.height = 'auto';
  composerInput.style.height = Math.min(composerInput.scrollHeight, 100) + 'px';
  $('#send-btn').disabled = !composerInput.value.trim();
  if (state.activeConvId) localStorage.setItem(`nova_draft_${state.activeConvId}`, composerInput.value);

  if (state.activeConvId) {
    state.socket.emit('typing', { conversationId: state.activeConvId, isTyping: true });
    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(() => {
      state.socket.emit('typing', { conversationId: state.activeConvId, isTyping: false });
    }, 1500);
  }
});

composerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

$('#send-btn').addEventListener('click', sendMessage);

function sendMessage() {
  const content = composerInput.value.trim();
  if (!content || !state.activeConvId) return;

  state.socket.emit('message:send', {
    conversationId: state.activeConvId,
    content,
    replyToId: state.replyToId || null
  }, (res) => {
    if (res?.error) alert(res.error);
  });

  composerInput.value = '';
  localStorage.removeItem(`nova_draft_${state.activeConvId}`);
  state.replyToId = null;
  composerInput.placeholder = 'Message';
  composerInput.style.height = 'auto';
  $('#send-btn').disabled = true;
  state.socket.emit('typing', { conversationId: state.activeConvId, isTyping: false });
}

// Attach image and voice note to chat (saved to Firebase Storage)
let mediaRecorder = null;
let audioChunks = [];
let isRecordingVoice = false;

function initMediaButtons() {
  const imageBtn = $('#image-btn');
  const imageInput = $('#image-input');
  const fileBtn = $('#file-btn');
  const fileInput = $('#file-input');
  const voiceBtn = $('#voice-btn');

  if (imageBtn && imageInput) {
    imageBtn.addEventListener('click', () => {
      if (!state.activeConvId) return alert('Open a chat first');
      imageInput.click();
    });

    imageInput.addEventListener('change', async () => {
      const file = imageInput.files?.[0];
      if (!file || !state.activeConvId) return;

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result;
        state.socket.emit('message:send', {
          conversationId: state.activeConvId,
          content: composerInput.value.trim() || null,
          media: {
            type: 'image',
            data: base64,
            mime: file.type || 'image/jpeg'
          },
          replyToId: state.replyToId || null
        }, (res) => {
          if (res?.error) alert(res.error);
        });
        composerInput.value = '';
        state.replyToId = null;
        imageInput.value = '';
      };
      reader.readAsDataURL(file);
    });
  }

  if (fileBtn && fileInput) {
    fileBtn.addEventListener('click', () => {
      if (!state.activeConvId) return alert('Open a chat first');
      fileInput.click();
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file || !state.activeConvId) return;
      const reader = new FileReader();
      reader.onload = () => {
        const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file';
        state.socket.emit('message:send', {
          conversationId: state.activeConvId,
          content: file.name,
          media: { type, data: reader.result, mime: file.type || 'application/octet-stream' },
          replyToId: state.replyToId || null
        }, res => { if (res?.error) alert(res.error); });
        fileInput.value = '';
        state.replyToId = null;
      };
      reader.readAsDataURL(file);
    });
  }

  if (voiceBtn) {
    voiceBtn.addEventListener('click', async () => {
      if (!state.activeConvId) return alert('Open a chat first');

      if (!isRecordingVoice) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks = [];

          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
          };

          mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = () => {
              state.socket.emit('message:send', {
                conversationId: state.activeConvId,
                content: null,
                media: {
                  type: 'voice',
                  data: reader.result,
                  mime: 'audio/webm'
                }
              }, (res) => {
                if (res?.error) alert(res.error);
              });
            };
            reader.readAsDataURL(audioBlob);
            stream.getTracks().forEach(t => t.stop());
          };

          mediaRecorder.start();
          isRecordingVoice = true;
          voiceBtn.style.color = '#FF453A';
          voiceBtn.title = 'Recording... Tap to send';
        } catch (err) {
          alert('Microphone access denied: ' + err.message);
        }
      } else {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
        isRecordingVoice = false;
        voiceBtn.style.color = '';
        voiceBtn.title = 'Record voice note';
      }
    });
  }
}

// ---------------- NEW CHAT MODAL ----------------
$('#new-chat-btn').addEventListener('click', () => $('#new-chat-modal').classList.remove('hidden'));
$('#close-new-chat').addEventListener('click', () => $('#new-chat-modal').classList.add('hidden'));

$$('.modal-tabs [data-newtab]').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.modal-tabs [data-newtab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['dm', 'group', 'channel', 'join'].forEach(t => {
      document.getElementById(`newtab-${t}`).classList.toggle('hidden', t !== btn.dataset.newtab);
    });
    $('#modal-error').classList.add('hidden');
  });
});

function showModalError(msg) {
  const el = $('#modal-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

$('#dm-start-btn').addEventListener('click', async () => {
  try {
    const novaId = $('#dm-novaid').value.trim();
    const { conversationId } = await api('/conversations/dm', { method: 'POST', body: { novaId } });
    $('#new-chat-modal').classList.add('hidden');
    $('#dm-novaid').value = '';
    await loadConversations();
    openConversation(conversationId);
  } catch (err) { showModalError(err.message); }
});

$('#group-create-btn').addEventListener('click', async () => {
  try {
    const name = $('#group-name').value.trim();
    const memberNovaIds = $('#group-members').value.split(',').map(s => s.trim()).filter(Boolean);
    const { conversation } = await api('/conversations/group', { method: 'POST', body: { name, memberNovaIds } });
    $('#new-chat-modal').classList.add('hidden');
    $('#group-name').value = ''; $('#group-members').value = '';
    await loadConversations();
    openConversation(conversation.id);
  } catch (err) { showModalError(err.message); }
});

$('#channel-create-btn').addEventListener('click', async () => {
  try {
    const name = $('#channel-name').value.trim();
    const { conversation } = await api('/conversations/channel', { method: 'POST', body: { name } });
    $('#new-chat-modal').classList.add('hidden');
    $('#channel-name').value = '';
    await loadConversations();
    openConversation(conversation.id);
    alert(`Channel created! Invite code: ${conversation.invite_code}`);
  } catch (err) { showModalError(err.message); }
});

$('#join-btn').addEventListener('click', async () => {
  try {
    const inviteCode = $('#join-code').value.trim();
    const { conversation } = await api('/conversations/join', { method: 'POST', body: { inviteCode } });
    $('#new-chat-modal').classList.add('hidden');
    $('#join-code').value = '';
    await loadConversations();
    openConversation(conversation.id);
  } catch (err) { showModalError(err.message); }
});

// ---------------- MANAGE GROUP ----------------
function showManageError(msg) {
  const el = $('#manage-group-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideManageError() { $('#manage-group-error').classList.add('hidden'); }

$('#chat-manage-btn').addEventListener('click', openManageGroup);
$('#close-manage-group').addEventListener('click', () => $('#manage-group-modal').classList.add('hidden'));

async function openManageGroup() {
  hideManageError();
  const conv = state.activeConv;
  if (!conv) return;
  $('#manage-group-title').textContent = conv.name || 'Manage';
  $('#manage-group-name').value = conv.name || '';

  const isOwner = String(conv.owner_id) === String(state.me.id);
  $('#manage-rename-group').classList.toggle('hidden', !isOwner);
  $('#manage-add-group').classList.toggle('hidden', conv.type !== 'group');
  $('#manage-delete-btn').classList.toggle('hidden', !isOwner);
  $('#manage-leave-btn').classList.toggle('hidden', isOwner);

  await renderManageMembers();
  $('#manage-group-modal').classList.remove('hidden');
}

async function renderManageMembers() {
  const conv = state.activeConv;
  const { members } = await api(`/conversations/${conv.id}/members`);
  const myRole = members.find(m => String(m.id) === String(state.me.id))?.role;
  const canModerate = ['owner', 'admin'].includes(myRole);

  const list = $('#manage-members-list');
  list.innerHTML = members.map(m => `
    <div class="conv-item" data-userid="${m.id}" style="cursor:default;">
      <div class="avatar sm profile-trigger" style="background:${m.avatar_color}; cursor:pointer;">${initials(m.display_name)}</div>
      <div class="conv-info profile-trigger" style="cursor:pointer;">
        <div class="top-row"><span class="name">${escapeHtml(m.display_name)} ${m.role !== 'member' ? `<span class="conv-badge group">${m.role}</span>` : ''}</span></div>
        <div class="preview">${escapeHtml(m.nova_id)}</div>
      </div>
      ${canModerate && String(m.id) !== String(state.me.id) && m.role !== 'owner' ? `<button class="modal-close remove-member-btn" data-userid="${m.id}" style="position:static;">Remove</button>` : ''}
    </div>`).join('');

  list.querySelectorAll('.profile-trigger').forEach(el => {
    el.addEventListener('click', () => {
      const userId = el.closest('[data-userid]').dataset.userid;
      const member = members.find(m => String(m.id) === String(userId));
      if (member) viewProfile(member);
    });
  });

  list.querySelectorAll('.remove-member-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Remove this person from the group?')) return;
      try {
        await api(`/conversations/${conv.id}/members/${btn.dataset.userid}`, { method: 'DELETE' });
        await renderManageMembers();
      } catch (err) { showManageError(err.message); }
    });
  });
}

$('#manage-add-btn').addEventListener('click', async () => {
  hideManageError();
  try {
    const novaId = $('#manage-add-novaid').value.trim();
    await api(`/conversations/${state.activeConv.id}/members`, { method: 'POST', body: { novaId } });
    $('#manage-add-novaid').value = '';
    await renderManageMembers();
  } catch (err) { showManageError(err.message); }
});

$('#manage-rename-btn').addEventListener('click', async () => {
  hideManageError();
  try {
    const name = $('#manage-group-name').value.trim();
    const { conversation } = await api(`/conversations/${state.activeConv.id}`, { method: 'PUT', body: { name } });
    $('#manage-group-title').textContent = conversation.name;
    $('#chat-title').textContent = conversation.name;
    await loadConversations();
  } catch (err) { showManageError(err.message); }
});

$('#manage-delete-btn').addEventListener('click', async () => {
  if (!confirm('Delete this group for everyone? This cannot be undone.')) return;
  try {
    await api(`/conversations/${state.activeConv.id}`, { method: 'DELETE' });
    $('#manage-group-modal').classList.add('hidden');
    appScreen.classList.remove('chat-open');
    $('#chat-active').classList.add('hidden');
    $('#chat-empty').classList.remove('hidden');
    state.activeConvId = null;
    state.activeConv = null;
    await loadConversations();
  } catch (err) { showManageError(err.message); }
});

$('#manage-leave-btn').addEventListener('click', async () => {
  if (!confirm('Leave this group?')) return;
  try {
    await api(`/conversations/${state.activeConv.id}/members/${state.me.id}`, { method: 'DELETE' });
    $('#manage-group-modal').classList.add('hidden');
    appScreen.classList.remove('chat-open');
    $('#chat-active').classList.add('hidden');
    $('#chat-empty').classList.remove('hidden');
    state.activeConvId = null;
    state.activeConv = null;
    await loadConversations();
  } catch (err) { showManageError(err.message); }
});

// ---------------- PROFILE VIEW ----------------
$('#public-profile-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'public-profile-modal') $('#public-profile-modal').classList.add('hidden');
});

async function viewProfile(member) {
  const card = $('#profile-card');
  if (!card) return;
  card.innerHTML = `<div style="text-align:center;padding:16px;">Loading...</div>`;
  $('#public-profile-modal')?.classList.remove('hidden');
  try {
    const { user } = await api(`/auth/lookup/${encodeURIComponent(member.nova_id)}`);
    card.innerHTML = `
      <button class="modal-close" id="profile-close-btn">Close</button>
      <div style="text-align:center; padding:24px 16px;">
        <div class="avatar" style="background:${user.avatarColor}; width:72px; height:72px; font-size:28px; margin:0 auto 12px;">${initials(user.displayName)}</div>
        <div style="font-weight:700; font-size:18px;">${escapeHtml(user.displayName)} ${verifiedBadge(user.isVerified)}</div>
        <div style="color:var(--text-secondary); margin-bottom:12px;">${escapeHtml(user.novaId)}</div>
        ${user.bio ? `<div style="padding:12px; background:rgba(255,255,255,0.05); border-radius:10px;">${escapeHtml(user.bio)}</div>` : ''}
        <button class="profile-block-btn" id="profile-block-btn" type="button">Block user</button>
      </div>`;
    $('#profile-close-btn').addEventListener('click', () => $('#public-profile-modal').classList.add('hidden'));
    $('#profile-block-btn')?.addEventListener('click', async () => {
      if (!confirm(`Block ${user.displayName}?`)) return;
      await api('/profile/block', { method: 'POST', body: { novaId: user.novaId } });
      $('#public-profile-modal').classList.add('hidden');
    });
  } catch (err) {
    card.innerHTML = `<div style="text-align:center;padding:16px;">Couldn't load profile.</div>`;
  }
}

// ---------------- STATUS ----------------
const STATUS_COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2', '#FF375F'];

function initStatusColors() {
  const wrap = $('#status-colors');
  if (!wrap) return;
  const mediaInput = $('#status-media-input');
  let mediaData = null;
  let mediaMime = null;
  let mediaType = null;
  mediaInput?.addEventListener('change', () => {
    const file = mediaInput.files?.[0];
    if (!file) return;
    mediaMime = file.type || 'image/jpeg';
    mediaType = file.type.startsWith('video/') ? 'video' : 'image';
    const reader = new FileReader();
    reader.onload = () => {
      mediaData = reader.result;
      $('#status-media-preview').innerHTML = mediaType === 'video' ? `<video controls src="${mediaData}"></video>` : `<img src="${mediaData}" alt="Status preview">`;
    };
    reader.readAsDataURL(file);
  });
  wrap.innerHTML = STATUS_COLORS.map((c, i) =>
    `<button type="button" data-color="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};border:${i === 0 ? '3px solid #fff' : 'none'}"></button>`
  ).join('');
  let selected = STATUS_COLORS[0];
  wrap.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      selected = b.dataset.color;
      wrap.querySelectorAll('button').forEach(x => x.style.border = 'none');
      b.style.border = '3px solid #fff';
    });
  });

  $('#status-post-btn').onclick = async () => {
    try {
      const content = $('#status-text').value.trim();
      if (!content && !mediaData) return showStatusError('Write text or choose media first');
      const activeBtn = wrap.querySelector('button[style*="3px"]');
      const color = activeBtn ? activeBtn.dataset.color : selected;
      await api('/status', { method: 'POST', body: { content, bgColor: color, mediaData, mediaMime, mediaType } });
      $('#new-status-modal').classList.add('hidden');
      $('#status-text').value = '';
      if (mediaInput) mediaInput.value = '';
      mediaData = null; mediaMime = null; mediaType = null;
      $('#status-media-preview').innerHTML = '';
      loadStatuses();
    } catch (err) { showStatusError(err.message); }
  };
}

function showStatusError(msg) {
  const el = $('#status-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

$('#close-new-status').addEventListener('click', () => $('#new-status-modal').classList.add('hidden'));

async function loadStatuses() {
  const { statuses } = await api('/status/feed');
  const list = $('#status-list');
  const mine = (statuses || []).filter(s => String(s.user_id) === String(state.me.id));
  const others = (statuses || []).filter(s => String(s.user_id) !== String(state.me.id));
  state.myStatuses = mine;

  let html = `
    <div class="status-item" id="add-status-row">
      <div class="status-ring">
        <div class="avatar sm" style="background:${state.me.avatarColor}">${mine.length ? initials(state.me.displayName) : '+'}</div>
      </div>
      <div>
        <div style="font-weight:600;">My Status</div>
        <div style="font-size:12px;color:var(--text-secondary);">${mine.length ? `${mine.length} active — tap to view` : 'Tap to add status update'}</div>
      </div>
      <button class="modal-close" id="add-status-plus-btn" style="position:static; margin-left:auto;">+</button>
    </div>`;

  if (others.length === 0) {
    html += `<div class="empty-state"><div class="icon icon-status" aria-hidden="true"></div><div class="title">No updates yet</div><div class="subtitle">When friends post a status, it'll show up here.</div></div>`;
  } else {
    html += others.map(s => `
      <div class="status-item" data-id="${s.id}">
        <div class="status-ring ${s.viewed ? 'viewed' : ''}">
          <div class="avatar sm" style="background:${s.avatar_color}">${initials(s.display_name)}</div>
        </div>
        <div>
          <div style="font-weight:600;">${escapeHtml(s.display_name)}</div>
          <div style="font-size:12px;color:var(--text-secondary);">${timeAgo(s.created_at)} ago</div>
        </div>
      </div>`).join('');
  }

  list.innerHTML = html;

  $('#add-status-row').addEventListener('click', (e) => {
    if (e.target.id === 'add-status-plus-btn') return;
    if (mine.length > 0) {
      viewStatus(mine[0], true);
    } else {
      $('#new-status-modal').classList.remove('hidden');
    }
  });

  $('#add-status-plus-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#new-status-modal').classList.remove('hidden');
  });

  list.querySelectorAll('.status-item[data-id]').forEach(item => {
    item.addEventListener('click', () => viewStatus(others.find(s => String(s.id) === String(item.dataset.id))));
  });
}

async function viewStatus(status, isMine) {
  if (!status) return;
  if (!isMine) await api(`/status/${status.id}/view`, { method: 'POST' });

  const backdrop = $('#status-viewer');
  backdrop.innerHTML = `
    <div class="status-viewer-card" style="background:${status.bg_color}">
      <div class="status-viewer-progress"><div class="status-viewer-progress-fill"></div></div>
      <div class="status-viewer-header">
        <div class="avatar sm" style="background:rgba(255,255,255,0.3)">${initials(status.display_name)}</div>
        <span>${escapeHtml(status.display_name)}${isMine ? ' (you)' : ''}</span>
      </div>
      <button class="status-viewer-close" id="status-viewer-close" aria-label="Close status viewer">${icon('close','Close')}</button>
      ${isMine ? '<button class="status-viewer-delete" id="status-viewer-delete" type="button">Delete status</button>' : ''}
      ${status.media_url && status.media_type === 'video' ? `<video class="status-viewer-media" controls src="${status.media_url}"></video>` : status.media_url ? `<img class="status-viewer-media" src="${status.media_url}" alt="Status media">` : ''}
      ${status.content ? `<div style="font-size:20px; line-height:1.4; word-break:break-word;">${escapeHtml(status.content)}</div>` : ''}
    </div>`;
  backdrop.classList.remove('hidden');

  const close = () => {
    backdrop.classList.add('hidden');
    if (backdrop._timer) clearTimeout(backdrop._timer);
  };
  $('#status-viewer-close').addEventListener('click', close);
  $('#status-viewer-delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this status?')) return;
    try {
      await api(`/status/${status.id}`, { method: 'DELETE' });
      close();
      await loadStatuses();
    } catch (err) { alert(err.message); }
  });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop._timer = setTimeout(close, 5000);
}

// ---------------- POSTS (WITH FIREBASE STORAGE IMAGES) ----------------
function initPostMedia() {
  const postImageBtn = $('#post-image-btn');
  const postImageInput = $('#post-image-input');
  const postPreview = $('#post-image-preview');

  if (postImageBtn && postImageInput) {
    postImageBtn.addEventListener('click', () => postImageInput.click());
    postImageInput.addEventListener('change', () => {
      const file = postImageInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.postImageData = reader.result;
        state.postImageMime = file.type || 'image/jpeg';
        if (postPreview) {
          postPreview.src = reader.result;
          postPreview.style.display = 'block';
        }
      };
      reader.readAsDataURL(file);
    });
  }

  $('#new-post-btn').addEventListener('click', async () => {
    const caption = $('#new-post-text').value.trim();
    if (!caption && !state.postImageData) return alert('Add some text or an image');

    await api('/posts', {
      method: 'POST',
      body: {
        caption,
        imageData: state.postImageData,
        imageMime: state.postImageMime
      }
    });

    $('#new-post-text').value = '';
    state.postImageData = null;
    state.postImageMime = null;
    if (postPreview) {
      postPreview.src = '';
      postPreview.style.display = 'none';
    }
    if (postImageInput) postImageInput.value = '';
    loadPosts();
  });
}

async function loadPosts() {
  const { posts } = await api('/posts');
  const list = $('#posts-list');
  if (!posts || posts.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📸</div><div class="title">No posts yet</div><div class="subtitle">Be the first to share something with Firebase Storage!</div></div>`;
    return;
  }
  list.innerHTML = posts.map(p => {
    const imageSrc = p.image_url || p.image_data;
    return `
    <div class="post-card" data-id="${p.id}">
      <div class="post-header">
        <div class="avatar sm" style="background:${p.avatar_color}">${initials(p.display_name)}</div>
        <div>
          <div style="font-weight:600;">${escapeHtml(p.display_name)} ${verifiedBadge(p.is_verified)}</div>
          <div style="font-size:12px;color:var(--text-secondary);">${timeAgo(p.created_at)} ago</div>
        </div>
      </div>
      ${p.caption ? `<div class="post-caption">${escapeHtml(p.caption)}</div>` : ''}
      ${imageSrc ? `<img src="${imageSrc}" style="width:100%; border-radius:10px; margin:8px 0; max-height:400px; object-fit:cover;" alt="Post image">` : ''}
      <div class="post-actions-row">
        <button class="post-like-btn" data-like-id="${p.id}">♥ <span>${p.like_count || 0}</span></button>
        <button class="post-comment-btn" data-comment-id="${p.id}">Comments (${p.comment_count || 0})</button>
      </div>
      <div class="post-comment-panel hidden" id="comments-${p.id}">
        <div class="comments-list"></div>
        <form class="comment-form" data-comment-form="${p.id}">
          <input maxlength="500" placeholder="Write a comment...">
          <button type="submit">Send</button>
        </form>
      </div>
    </div>`;
  }).join('');

  // Wire like buttons
  $$('.post-like-btn').forEach(btn => btn.addEventListener('click', async () => {
    const res = await api(`/posts/${btn.dataset.likeId}/like`, { method: 'POST' });
    const countSpan = btn.querySelector('span');
    let count = parseInt(countSpan.textContent, 10) || 0;
    countSpan.textContent = res.liked ? count + 1 : Math.max(0, count - 1);
  }));

  wirePostComments();
}

function wirePostComments() {
  $$('.post-comment-btn').forEach(btn => btn.addEventListener('click', async () => {
    const panel = document.querySelector('#comments-' + btn.dataset.commentId);
    panel.classList.toggle('hidden');
    if (panel.dataset.loaded) return;
    const result = await api('/posts/' + btn.dataset.commentId + '/comments');
    panel.querySelector('.comments-list').innerHTML = (result.comments || []).map(c => '<div class="post-comment"><strong>' + escapeHtml(c.display_name) + '</strong> ' + escapeHtml(c.content) + '</div>').join('') || '<div class="post-comment">No comments yet.</div>';
    panel.dataset.loaded = '1';
  }));

  $$('.comment-form').forEach(form => form.addEventListener('submit', async e => {
    e.preventDefault();
    const input = form.querySelector('input');
    if (!input.value.trim()) return;
    await api('/posts/' + form.dataset.commentForm + '/comments', { method: 'POST', body: { content: input.value.trim() } });
    input.value = '';
    loadPosts();
  }));
}

// ---------------- ADMIN PANEL ----------------
function initAdminPanel() {
  const adminBtn = $('#admin-panel-btn');
  const closeBtn = $('#close-admin-panel');
  const modal = $('#admin-modal');
  const searchInput = $('#admin-search');

  if (adminBtn && modal) {
    adminBtn.addEventListener('click', () => {
      modal.classList.remove('hidden');
      loadAdminUsers();
    });
  }
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  }
  if (searchInput) {
    let timeout = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => loadAdminUsers(searchInput.value.trim()), 300);
    });
  }
}

async function loadAdminUsers(search = '') {
  try {
    const { users } = await api(`/admin/users?search=${encodeURIComponent(search)}`);
    const list = $('#admin-users-list');
    if (!list) return;

    list.innerHTML = (users || []).map(u => `
      <div class="conv-item" style="cursor:default; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:8px;">
        <div class="avatar sm" style="background:${u.avatarColor}">${initials(u.displayName)}</div>
        <div class="conv-info" style="flex:1;">
          <div class="top-row">
            <span class="name">${escapeHtml(u.displayName)} ${verifiedBadge(u.isVerified)} ${u.isBanned ? '<span class="account-state banned">BANNED</span>' : '<span class="account-state active">ACTIVE</span>'}</span>
          </div>
          <div class="preview">${escapeHtml(u.novaId)}</div>
        </div>
        <div style="display:flex; gap:6px;">
          ${u.isBanned
            ? `<button class="modal-close" data-unban="${u.id}" style="position:static; padding:4px 8px; font-size:12px; background:#30D158;">Unban</button>`
            : `<button class="modal-close" data-ban="${u.id}" style="position:static; padding:4px 8px; font-size:12px; background:#FF453A;">Ban</button>`}
          ${u.isVerified
            ? `<button class="modal-close" data-unverify="${u.id}" style="position:static; padding:4px 8px; font-size:12px;">Unverify</button>`
            : `<button class="modal-close" data-verify="${u.id}" style="position:static; padding:4px 8px; font-size:12px;">Verify</button>`}
        </div>
      </div>
    `).join('') || '<div style="text-align:center; padding:16px; color:var(--text-secondary);">No users found</div>';

    list.querySelectorAll('[data-ban]').forEach(btn => btn.addEventListener('click', async () => {
      const reason = prompt('Ban reason:', 'Terms violation');
      await api(`/admin/users/${btn.dataset.ban}/ban`, { method: 'POST', body: { reason } });
      loadAdminUsers(search);
    }));

    list.querySelectorAll('[data-unban]').forEach(btn => btn.addEventListener('click', async () => {
      await api(`/admin/users/${btn.dataset.unban}/unban`, { method: 'POST' });
      loadAdminUsers(search);
    }));

    list.querySelectorAll('[data-verify]').forEach(btn => btn.addEventListener('click', async () => {
      await api(`/admin/users/${btn.dataset.verify}/verify`, { method: 'POST' });
      loadAdminUsers(search);
    }));

    list.querySelectorAll('[data-unverify]').forEach(btn => btn.addEventListener('click', async () => {
      await api(`/admin/users/${btn.dataset.unverify}/unverify`, { method: 'POST' });
      loadAdminUsers(search);
    }));
  } catch (err) {
    const el = $('#admin-error');
    if (el) {
      el.textContent = err.message;
      el.classList.remove('hidden');
    }
  }
}

// ---------------- REAL WEBRTC CALLS ----------------
let activeCall = null;
let pendingIncomingCall = null;

function setCallModal(mode, call, title, subtitle) {
  const modal = $('#call-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  $('#call-modal-title').textContent = title;
  $('#call-modal-subtitle').textContent = subtitle;
  $('#call-modal-kind').textContent = String(call.kind || 'voice').toUpperCase();
  $('#incoming-call-actions').classList.toggle('hidden', mode !== 'incoming');
  $('#active-call-actions').classList.toggle('hidden', mode !== 'active');
  $('#local-video').style.display = call.kind === 'video' ? 'block' : 'none';
  $('#remote-video').style.display = call.kind === 'video' ? 'block' : 'none';
  $('#call-avatar').classList.toggle('hidden', call.kind === 'video');
}

function closeCallModal() {
  const modal = $('#call-modal');
  modal?.classList.add('hidden');
  modal?.setAttribute('aria-hidden', 'true');
  const local = $('#local-video');
  const remote = $('#remote-video');
  if (local) local.srcObject = null;
  if (remote) remote.srcObject = null;
  const audio = $('#remote-audio');
  if (audio) audio.srcObject = null;
}

function sendCallSignal(targetUserId, callId, signal) {
  state.socket?.emit('call:signal', { targetUserId, callId, signal });
}

async function buildPeer(call, targetUserId, stream) {
  const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  stream.getTracks().forEach(track => peer.addTrack(track, stream));
  peer.onicecandidate = e => e.candidate && sendCallSignal(targetUserId, call.id, { candidate: e.candidate });
  peer.ontrack = e => {
    const remote = e.streams[0];
    if (call.kind === 'video') $('#remote-video').srcObject = remote;
    else $('#remote-audio').srcObject = remote;
  };
  peer.onconnectionstatechange = () => {
    if (!activeCall || activeCall.call.id !== call.id) return;
    if (['failed', 'disconnected'].includes(peer.connectionState)) $('#call-modal-subtitle').textContent = 'Connection interrupted';
    if (peer.connectionState === 'connected') $('#call-modal-subtitle').textContent = 'Connected';
  };
  $('#local-video').srcObject = call.kind === 'video' ? stream : null;
  return peer;
}

async function startCall(kind) {
  const target = state.activeConv?.other_user?.id;
  if (!target || !state.activeConvId) return alert('Calls are available for direct chats.');
  if (activeCall || pendingIncomingCall) return alert('There is already an active call.');
  try {
    const { call } = await api('/calls', { method: 'POST', body: { conversationId: state.activeConvId, kind } });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
    const peer = await buildPeer(call, target, stream);
    activeCall = { call, peer, stream, targetUserId: target, initiator: true, remoteDescriptionSet: false };
    setCallModal('active', call, `Calling ${state.activeConv.name || 'contact'}`, 'Ringing…');
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    state.socket.emit('call:invite', { targetUserId: target, call });
    sendCallSignal(target, call.id, { sdp: peer.localDescription });
  } catch (err) {
    closeCallModal();
    alert(err.message || 'Unable to start call. Check microphone and camera permissions.');
  }
}

async function acceptIncomingCall() {
  if (!pendingIncomingCall) return;
  const incoming = pendingIncomingCall;
  pendingIncomingCall = null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: incoming.call.kind === 'video' });
    const peer = await buildPeer(incoming.call, incoming.fromUserId, stream);
    activeCall = { call: incoming.call, peer, stream, targetUserId: incoming.fromUserId, initiator: false, remoteDescriptionSet: false };
    setCallModal('active', incoming.call, 'Call connected', 'Connecting…');
    state.socket.emit('call:state', { targetUserId: incoming.fromUserId, callId: incoming.call.id, state: 'accepted' });
    if (incoming.signal?.sdp) await handleCallSignal(incoming.signal, incoming.fromUserId, incoming.call.id);
  } catch (err) {
    state.socket.emit('call:state', { targetUserId: incoming.fromUserId, callId: incoming.call.id, state: 'declined' });
    closeCallModal();
    alert(err.message || 'Unable to access microphone or camera.');
  }
}

async function handleCallSignal(signal, fromUserId, callId) {
  if (!activeCall || activeCall.call.id !== callId) {
    if (pendingIncomingCall && pendingIncomingCall.call.id === callId) pendingIncomingCall.signal = signal;
    return;
  }
  const peer = activeCall.peer;
  if (signal.sdp) {
    await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    activeCall.remoteDescriptionSet = true;
    if (signal.sdp.type === 'offer') {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendCallSignal(fromUserId, callId, { sdp: peer.localDescription });
    }
  }
  if (signal.candidate) {
    try { await peer.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (err) { console.warn('ICE candidate rejected', err); }
  }
}

async function endActiveCall(nextState = 'ended') {
  const call = activeCall;
  if (!call) { closeCallModal(); return; }
  call.stream?.getTracks().forEach(track => track.stop());
  call.peer?.close();
  state.socket?.emit('call:state', { targetUserId: call.targetUserId, callId: call.call.id, state: nextState });
  await api(`/calls/${call.call.id}`, { method: 'PATCH', body: { state: nextState } }).catch(() => {});
  activeCall = null;
  closeCallModal();
}

function initCallControls() {
  if ($('#call-controls-initialized')) return;
  const marker = document.createElement('span');
  marker.id = 'call-controls-initialized';
  marker.className = 'hidden';
  document.body.appendChild(marker);
  $('#chat-call-btn')?.addEventListener('click', () => startCall('voice'));
  $('#chat-video-btn')?.addEventListener('click', () => startCall('video'));
  $('#accept-call-btn')?.addEventListener('click', acceptIncomingCall);
  $('#decline-call-btn')?.addEventListener('click', () => {
    if (!pendingIncomingCall) return closeCallModal();
    state.socket.emit('call:state', { targetUserId: pendingIncomingCall.fromUserId, callId: pendingIncomingCall.call.id, state: 'declined' });
    pendingIncomingCall = null;
    closeCallModal();
  });
  $('#end-call-btn')?.addEventListener('click', () => endActiveCall('ended'));
  $('#toggle-mic-btn')?.addEventListener('click', () => {
    const track = activeCall?.stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $('#toggle-mic-btn').textContent = track.enabled ? 'Mute' : 'Unmute';
  });
  $('#toggle-camera-btn')?.addEventListener('click', () => {
    const track = activeCall?.stream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $('#toggle-camera-btn').textContent = track.enabled ? 'Camera off' : 'Camera on';
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && activeCall) endActiveCall('ended'); });
  state.socket.on('call:incoming', ({ call, fromUserId }) => {
    if (activeCall || pendingIncomingCall) {
      state.socket.emit('call:state', { targetUserId: fromUserId, callId: call.id, state: 'busy' });
      return;
    }
    pendingIncomingCall = { call, fromUserId, signal: null };
    setCallModal('incoming', call, 'Incoming call', `${call.kind === 'video' ? 'Video' : 'Voice'} call incoming`);
  });
  state.socket.on('call:signal', ({ callId, signal, fromUserId }) => handleCallSignal(signal, fromUserId, callId));
  state.socket.on('call:state', ({ callId, state: callState }) => {
    if (pendingIncomingCall?.call.id === callId && ['declined', 'ended', 'busy'].includes(callState)) {
      pendingIncomingCall = null;
      closeCallModal();
    }
    if (activeCall?.call.id === callId) {
      if (callState === 'accepted') $('#call-modal-subtitle').textContent = 'Connecting…';
      if (['ended', 'declined', 'missed', 'busy'].includes(callState)) endActiveCall(callState === 'busy' ? 'ended' : callState);
    }
  });
}

// ---------------- INIT ----------------
if (state.token && state.me) {
  boot();
}

// ---------------- PWA SERVICE WORKER ----------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('Service worker registration failed:', err);
  });
}

})();
