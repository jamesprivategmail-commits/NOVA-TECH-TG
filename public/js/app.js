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
  const d = new Date(dateStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString();
}

function clockTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
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
  $('#auth-subtitle').textContent = 'Log in with your NOVA ID.';
  $('#nova-id-reveal').classList.add('hidden');
  hideAuthError();
});

$('#toggle-to-signup a').addEventListener('click', (e) => {
  e.preventDefault();
  $('#login-form').classList.add('hidden');
  $('#signup-form').classList.remove('hidden');
  $('#toggle-to-signup').classList.add('hidden');
  $('#toggle-to-login').classList.remove('hidden');
  $('#auth-title').textContent = 'Welcome to NOVA';
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

// ---------------- BOOT ----------------
async function boot() {
  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  $('#me-avatar').style.background = state.me.avatarColor;
  $('#me-avatar').textContent = initials(state.me.displayName);
  $('#me-avatar').title = `${state.me.displayName} (${state.me.novaId}) — tap to copy ID, long-press area for logout`;
  $('#me-avatar').addEventListener('click', () => {
    navigator.clipboard?.writeText(state.me.novaId);
    if (confirm(`You are ${state.me.displayName} (${state.me.novaId}).\n\nID copied to clipboard.\n\nLog out?`)) logout();
  });
  connectSocket();
  await loadConversations();
  initStatusColors();
}

function connectSocket() {
  state.socket = io({ auth: { token: state.token } });

  state.socket.on('message:new', (msg) => {
    if (!state.messages[msg.conversation_id]) state.messages[msg.conversation_id] = [];
    state.messages[msg.conversation_id].push(msg);
    if (state.activeConvId === msg.conversation_id) {
      renderMessages(msg.conversation_id);
    }
    loadConversations(); // refresh previews/order
  });

  state.socket.on('typing', ({ conversationId, userId, isTyping }) => {
    if (conversationId !== state.activeConvId || userId === state.me.id) return;
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
}

// ---------------- TABS ----------------
$$('.tabbar button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tabbar button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    $('#tab-chats').classList.toggle('hidden', tab !== 'chats');
    $('#tab-status').classList.toggle('hidden', tab !== 'status');
    $('#tab-posts').classList.toggle('hidden', tab !== 'posts');
    if (tab === 'status') loadStatuses();
    if (tab === 'posts') loadPosts();
  });
});

// ---------------- CONVERSATIONS ----------------
async function loadConversations() {
  const { conversations } = await api('/conversations');
  state.conversations = conversations;
  renderConvList();
  if (state.activeConvId) {
    state.activeConv = state.conversations.find(c => c.id === state.activeConvId) || state.activeConv;
  }
}

function renderConvList() {
  const list = $('#conv-list');
  if (state.conversations.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="icon">👋</div><div class="title">No chats yet</div><div class="subtitle">Tap "+ New Chat" to message a friend.</div></div>`;
    return;
  }
  list.innerHTML = state.conversations.map(c => {
    const preview = c.last_message
      ? (c.last_sender_id === state.me.id ? 'You: ' : '') + escapeHtml(c.last_message)
      : (c.type === 'channel' ? 'No posts yet' : 'Say hi 👋');
    const badge = c.type === 'group' ? '<span class="conv-badge group">Group</span>'
      : c.type === 'channel' ? '<span class="conv-badge channel">Channel</span>' : '';
    return `
      <div class="conv-item ${c.id === state.activeConvId ? 'active' : ''}" data-id="${c.id}">
        <div class="avatar" style="background:${c.avatar_color || '#8E8E93'}">${initials(c.name || '?')}</div>
        <div class="conv-info">
          <div class="top-row">
            <span class="name">${escapeHtml(c.name || 'Unnamed')} ${badge}</span>
            <span class="time">${c.last_message_at ? timeAgo(c.last_message_at) : ''}</span>
          </div>
          <div class="preview">${preview}</div>
        </div>
      </div>`;
  }).join('');

  $$('.conv-item').forEach(item => {
    item.addEventListener('click', () => openConversation(parseInt(item.dataset.id, 10)));
  });
}

async function openConversation(id) {
  state.activeConvId = id;
  appScreen.classList.add('chat-open');
  $('#chat-empty').classList.add('hidden');
  $('#chat-active').classList.remove('hidden');
  renderConvList();

  const conv = state.conversations.find(c => c.id === id);
  state.activeConv = conv;
  $('#chat-title').textContent = conv?.name || 'Chat';
  $('#chat-subtitle').textContent = conv?.type === 'channel' ? 'Channel' : conv?.type === 'group' ? 'Group' : conv?.other_user?.nova_id || '';
  $('#chat-avatar').style.background = conv?.avatar_color || '#8E8E93';
  $('#chat-avatar').textContent = initials(conv?.name || '?');

  // Show the manage (⋮) button only for groups/channels, not DMs
  $('#chat-manage-btn').classList.toggle('hidden', !conv || conv.type === 'dm');

  state.socket.emit('conversation:join', { conversationId: id });

  if (!state.messages[id]) {
    const { messages } = await api(`/conversations/${id}/messages`);
    state.messages[id] = messages;
  }
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

  msgs.forEach((m, i) => {
    const mine = m.sender_id === state.me.id;
    const showTimeStamp = !lastTime || (new Date(m.created_at) - new Date(lastTime)) > 30 * 60 * 1000;

    if (showTimeStamp) {
      html += `<div class="msg-time">${new Date(m.created_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>`;
    }

    const isFirstInGroup = lastSender !== m.sender_id || showTimeStamp;
    if (isFirstInGroup && !mine) {
      html += `<div class="msg-group-sender">${escapeHtml(m.display_name)}</div>`;
    }

    html += `
      <div class="msg-row ${mine ? 'mine' : 'theirs'} ${isFirstInGroup ? 'grouped-first' : ''}">
        <div class="bubble ${mine ? 'mine' : 'theirs'}">${escapeHtml(m.content)}</div>
      </div>`;

    lastSender = m.sender_id;
    lastTime = m.created_at;
  });

  area.innerHTML = html || `<div class="empty-state"><div class="icon">✨</div><div class="title">No messages yet</div><div class="subtitle">Say something!</div></div>`;
  area.scrollTop = area.scrollHeight;
}

// ---------------- COMPOSER ----------------
const composerInput = $('#composer-input');

composerInput.addEventListener('input', () => {
  composerInput.style.height = 'auto';
  composerInput.style.height = Math.min(composerInput.scrollHeight, 100) + 'px';
  $('#send-btn').disabled = !composerInput.value.trim();

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

  state.socket.emit('message:send', { conversationId: state.activeConvId, content }, (res) => {
    if (res?.error) alert(res.error);
  });

  composerInput.value = '';
  composerInput.style.height = 'auto';
  $('#send-btn').disabled = true;
  state.socket.emit('typing', { conversationId: state.activeConvId, isTyping: false });
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

// ---------------- MANAGE GROUP (add/remove members, rename, delete) ----------------
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

  const isOwner = conv.owner_id === state.me.id;
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
  const myRole = members.find(m => m.id === state.me.id)?.role;
  const canModerate = ['owner', 'admin'].includes(myRole);

  const list = $('#manage-members-list');
  list.innerHTML = members.map(m => `
    <div class="conv-item" data-userid="${m.id}" style="cursor:default;">
      <div class="avatar sm profile-trigger" style="background:${m.avatar_color}; cursor:pointer;">${initials(m.display_name)}</div>
      <div class="conv-info profile-trigger" style="cursor:pointer;">
        <div class="top-row"><span class="name">${escapeHtml(m.display_name)} ${m.role !== 'member' ? `<span class="conv-badge group">${m.role}</span>` : ''}</span></div>
        <div class="preview">${escapeHtml(m.nova_id)}</div>
      </div>
      ${canModerate && m.id !== state.me.id && m.role !== 'owner' ? `<button class="modal-close remove-member-btn" data-userid="${m.id}" style="position:static;">Remove</button>` : ''}
    </div>`).join('');

  list.querySelectorAll('.profile-trigger').forEach(el => {
    el.addEventListener('click', () => {
      const userId = parseInt(el.closest('[data-userid]').dataset.userid, 10);
      const member = members.find(m => m.id === userId);
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
$('#profile-modal').addEventListener('click', (e) => {
  if (e.target.id === 'profile-modal') $('#profile-modal').classList.add('hidden');
});

async function viewProfile(member) {
  const card = $('#profile-card');
  card.innerHTML = `<div style="text-align:center;padding:16px;">Loading...</div>`;
  $('#profile-modal').classList.remove('hidden');
  try {
    const { user } = await api(`/auth/lookup/${encodeURIComponent(member.nova_id)}`);
    card.innerHTML = `
      <button class="modal-close" id="profile-close-btn">Close</button>
      <div style="text-align:center; padding:24px 16px;">
        <div class="avatar" style="background:${user.avatarColor}; width:72px; height:72px; font-size:28px; margin:0 auto 12px;">${initials(user.displayName)}</div>
        <div style="font-weight:700; font-size:18px;">${escapeHtml(user.displayName)}</div>
        <div style="color:var(--text-secondary); margin-bottom:12px;">${escapeHtml(user.novaId)}</div>
        ${user.bio ? `<div style="padding:12px; background:rgba(255,255,255,0.05); border-radius:10px;">${escapeHtml(user.bio)}</div>` : ''}
      </div>`;
    $('#profile-close-btn').addEventListener('click', () => $('#profile-modal').classList.add('hidden'));
  } catch (err) {
    card.innerHTML = `<div style="text-align:center;padding:16px;">Couldn't load profile.</div>`;
  }
}

// ---------------- STATUS ----------------
const STATUS_COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2', '#FF375F'];

function initStatusColors() {
  const wrap = $('#status-colors');
  wrap.innerHTML = STATUS_COLORS.map((c, i) =>
    `<button type="button" data-color="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};border:${i === 0 ? '3px solid #333' : 'none'}"></button>`
  ).join('');
  let selected = STATUS_COLORS[0];
  wrap.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      selected = b.dataset.color;
      wrap.querySelectorAll('button').forEach(x => x.style.border = 'none');
      b.style.border = '3px solid #333';
    });
  });
  wrap.dataset.selected = selected;

  $('#status-post-btn').onclick = async () => {
    try {
      const content = $('#status-text').value.trim();
      if (!content) return showStatusError('Write something first');
      await api('/status', { method: 'POST', body: { content, bgColor: wrap.querySelector('button[style*="3px"]')?.dataset.color || selected } });
      $('#new-status-modal').classList.add('hidden');
      $('#status-text').value = '';
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
  const mine = statuses.filter(s => s.user_id === state.me.id);
  const others = statuses.filter(s => s.user_id !== state.me.id);
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
    html += `<div class="empty-state"><div class="icon">🌟</div><div class="title">No updates yet</div><div class="subtitle">When friends post a status, it'll show up here.</div></div>`;
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

  // Tapping the row: view your own status if you have one, else open the composer.
  // Tapping the + button always opens the composer to add another status.
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
    item.addEventListener('click', () => viewStatus(others.find(s => s.id == item.dataset.id)));
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
      <button class="status-viewer-close" id="status-viewer-close">✕</button>
      <div>${escapeHtml(status.content)}</div>
    </div>`;
  backdrop.classList.remove('hidden');

  const close = () => backdrop.classList.add('hidden');
  $('#status-viewer-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  setTimeout(close, 5000);
}

// ---------------- POSTS ----------------
$('#new-post-btn').addEventListener('click', async () => {
  const caption = $('#new-post-text').value.trim();
  if (!caption) return;
  await api('/posts', { method: 'POST', body: { caption } });
  $('#new-post-text').value = '';
  loadPosts();
});

async function loadPosts() {
  const { posts } = await api('/posts');
  const list = $('#posts-list');
  if (posts.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📸</div><div class="title">No posts yet</div><div class="subtitle">Be the first to share something.</div></div>`;
    return;
  }
  list.innerHTML = posts.map(p => `
    <div class="post-card" data-id="${p.id}">
      <div class="post-header">
        <div class="avatar sm" style="background:${p.avatar_color}">${initials(p.display_name)}</div>
        <div>
          <div style="font-weight:600;">${escapeHtml(p.display_name)}</div>
          <div style="font-size:12px;color:var(--text-secondary);">${timeAgo(p.created_at)} ago</div>
        </div>
      </div>
      <div class="post-caption">${escapeHtml(p.caption)}</div>
    </div>`).join('');
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
