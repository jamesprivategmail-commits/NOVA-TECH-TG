// chats.js - conversation list screen
import { api, ApiError } from './api.js';
import { state, emit, on, isUnread } from './state.js';
import {
  $, avatar, icon, escapeHtml, timeAgo, conversationTitle, conversationAvatarUser,
  emptyState, errorState, skeletonList, toast, openSheet, closeSheet, setBusy
} from './ui.js';

let els = {};

export function initChats() {
  els = {
    list: $('#chats-list'),
    search: $('#chats-search'),
    filters: $('#chat-filters'),
    newBtn: $('#new-chat-btn'),
    meAvatar: $('#me-avatar-btn'),
    notifications: $('#notifications-btn'),
    adminBtn: $('#admin-btn')
  };

  els.search?.addEventListener('input', () => renderChats());
  els.filters?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    els.filters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderChats();
  });
  els.newBtn?.addEventListener('click', openNewChatSheet);
  els.meAvatar?.addEventListener('click', () => emit('tab:show', 'profile'));

  on('conversations:changed', () => renderChats());
  on('unread:changed', () => renderChats());
  on('presence', ({ userId, online }) => {
    state.presence[userId] = online;
    updatePresenceDots();
  });
  renderChats();
}

export function setConversations(list) {
  state.conversations = Array.isArray(list) ? list : [];
  renderChats();
}

export function renderMeHeader() {
  const me = state.me;
  if (!me) return;
  const node = $('#me-avatar');
  if (node) node.outerHTML = avatar(me, { size: 'sm', id: 'me-avatar' });
  const sub = $('#me-id-sub');
  if (sub) sub.textContent = me.novaId || '';
  const adminBtn = $('#admin-btn');
  if (adminBtn) adminBtn.hidden = !me.isAdmin;
}

function updatePresenceDots() {
  els.list?.querySelectorAll('[data-presence-user]').forEach((dot) => {
    const uid = dot.getAttribute('data-presence-user');
    dot.classList.toggle('hidden', !state.presence[uid]);
  });
}

function filteredConversations() {
  const term = (els.search?.value || '').trim().toLowerCase();
  return state.conversations.filter((conv) => {
    if (state.filter === 'unread' && !isUnread(conv)) return false;
    if (state.filter === 'groups' && conv.type !== 'group') return false;
    if (conv.type === 'channel') return false;
    if (!term) return true;
    const hay = [
      conversationTitle(conv),
      conv.last_message,
      conv.other_user?.nova_id,
      conv.invite_code
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(term);
  });
}

function previewHtml(conv) {
  if (!conv.last_message) return `<span class="truncate">No messages yet</span>`;
  const mine = conv.last_sender_id === state.me?.id;
  const prefix = mine ? 'You: ' : '';
  const body = conv.last_message;
  const hasMedia = !body || /^(📷 Photo|Voice note|Attachment)$/.test(body);
  const mediaIcon = body === '📷 Photo' ? icon('image') : (body === 'Voice note' ? icon('mic') : (hasMedia ? icon('file') : ''));
  return `${mediaIcon}<span class="truncate">${escapeHtml(prefix + body)}</span>`;
}

function conversationRow(conv) {
  const unread = isUnread(conv);
  const unreadCount = state.unread[conv.id] || 0;
  const user = conversationAvatarUser(conv);
  const badge = conv.type === 'group' ? '<span class="pill group">Group</span>'
    : conv.type === 'channel' ? '<span class="pill channel">Channel</span>' : '';
  const pin = conv.pinned ? `<span class="pin-flag">${icon('pin')}</span>` : '';
  const online = conv.type === 'dm' && conv.other_user && state.presence[conv.other_user.id];
  return `<button class="chat-row" data-conv="${escapeHtml(conv.id)}">
    <span class="avatar-wrap">
      ${avatar(user)}
      ${online ? `<span class="online-dot" data-presence-user="${escapeHtml(conv.other_user.id)}"></span>` : ''}
    </span>
    <span class="chat-info">
      <span class="chat-top">
        ${pin}
        <span class="chat-name truncate">${escapeHtml(conversationTitle(conv))}</span>
        <span class="chat-time">${escapeHtml(timeAgo(conv.last_message_at))}</span>
      </span>
      <span class="chat-bottom">
        <span class="chat-preview">${previewHtml(conv)}</span>
        ${unreadCount ? `<span class="unread">${unreadCount > 99 ? '99+' : unreadCount}</span>` : (unread ? '<span class="unread">1</span>' : '')}
      </span>
      ${badge ? `<span class="chat-top">${badge}</span>` : ''}
    </span>
  </button>`;
}

export function renderChats() {
  if (!els.list) return;
  const list = filteredConversations();
  if (!state.conversations.length) {
    els.list.innerHTML = emptyState({
      iconName: 'message',
      title: 'No conversations yet',
      subtitle: 'Start a chat with a friend\'s DARK CHAT ID to get going.',
      actionLabel: 'New chat',
      actionId: 'empty-new-chat'
    });
    $('#empty-new-chat')?.addEventListener('click', openNewChatSheet);
    return;
  }
  if (!list.length) {
    els.list.innerHTML = emptyState({
      iconName: 'search',
      title: 'Nothing matches',
      subtitle: 'Try a different search or filter.'
    });
    return;
  }
  els.list.innerHTML = list.map(conversationRow).join('');
  els.list.querySelectorAll('[data-conv]').forEach((row) => {
    row.addEventListener('click', () => {
      const conv = state.conversations.find((c) => c.id === row.dataset.conv);
      if (conv) emit('chat:open', conv);
    });
  });
  updatePresenceDots();
}

export function showChatsLoading() {
  if (els.list) els.list.innerHTML = skeletonList(7);
}

export function showChatsError(message) {
  if (!els.list) return;
  els.list.innerHTML = errorState({ title: 'Could not load chats', subtitle: message, retryId: 'retry-chats' });
  $('#retry-chats')?.addEventListener('click', () => emit('data:refresh-conversations'));
}

// ---------------- new chat / group / channel / join ----------------
export function openNewChatSheet() {
  openSheet({
    title: 'New conversation',
    body: `
      <div class="tabs" id="new-tabs">
        <button data-tab="dm" class="active">Direct</button>
        <button data-tab="group">Group</button>
        <button data-tab="channel">Channel</button>
        <button data-tab="join">Join</button>
      </div>
      <div class="sheet-pad">
        <div id="new-error" class="alert alert-error hidden"></div>
        <div id="pane-dm">
          <label class="field"><span class="field-label">DARK CHAT ID</span>
            <input class="input" id="dm-novaid" placeholder="+1-626-715-0000" autocomplete="off"></label>
        </div>
        <div id="pane-group" class="hidden">
          <label class="field"><span class="field-label">Group name</span>
            <input class="input" id="group-name" placeholder="Weekend Squad"></label>
          <label class="field"><span class="field-label">Members (DARK CHAT IDs, comma separated)</span>
            <input class="input" id="group-members" placeholder="+1-626-715-0000, +1-626-715-0001"></label>
        </div>
        <div id="pane-channel" class="hidden">
          <label class="field"><span class="field-label">Channel name</span>
            <input class="input" id="channel-name" placeholder="Announcements"></label>
        </div>
        <div id="pane-join" class="hidden">
          <label class="field"><span class="field-label">Invite code</span>
            <input class="input" id="join-code" placeholder="e.g. AB3D7KQ"></label>
        </div>
      </div>`,
    footer: `<div class="sheet-pad"><button class="btn btn-primary btn-block" id="new-submit">Continue</button></div>`,
    onMount(sheet) {
      const tabs = sheet.querySelector('#new-tabs');
      const panes = { dm: sheet.querySelector('#pane-dm'), group: sheet.querySelector('#pane-group'), channel: sheet.querySelector('#pane-channel'), join: sheet.querySelector('#pane-join') };
      let mode = 'dm';
      const showError = (msg) => {
        const box = sheet.querySelector('#new-error');
        box.textContent = msg || '';
        box.classList.toggle('hidden', !msg);
      };
      tabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        mode = btn.dataset.tab;
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
        Object.entries(panes).forEach(([key, pane]) => pane.classList.toggle('hidden', key !== mode));
        showError('');
      });
      sheet.querySelector('#new-submit').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        showError('');
        try {
          setBusy(btn, true, 'Working...');
          if (mode === 'dm') {
            const novaId = sheet.querySelector('#dm-novaid').value.trim();
            if (!novaId) throw new ApiError('Enter a DARK CHAT ID');
            const res = await api.createDm(novaId);
            await refreshConversations();
            closeSheet();
            const conv = state.conversations.find((c) => c.id === res.conversationId);
            if (conv) emit('chat:open', conv);
            else toast('Chat ready');
          } else if (mode === 'group') {
            const name = sheet.querySelector('#group-name').value.trim();
            if (!name) throw new ApiError('Enter a group name');
            const ids = sheet.querySelector('#group-members').value.split(',').map((s) => s.trim()).filter(Boolean);
            const res = await api.createGroup(name, ids);
            await refreshConversations();
            closeSheet();
            const conv = state.conversations.find((c) => c.id === res.conversation?.id) || state.conversations.find((c) => c.id === res.conversation?.id);
            toast('Group created', 'success');
            if (conv) emit('chat:open', conv);
          } else if (mode === 'channel') {
            const name = sheet.querySelector('#channel-name').value.trim();
            if (!name) throw new ApiError('Enter a channel name');
            const res = await api.createChannel(name);
            await refreshConversations();
            closeSheet();
            const created = state.conversations.find((c) => c.id === res.conversation?.id);
            toast('Channel created', 'success');
            if (created) emit('chat:open', created);
          } else {
            const code = sheet.querySelector('#join-code').value.trim();
            if (!code) throw new ApiError('Enter an invite code');
            const res = await api.joinConversation(code);
            await refreshConversations();
            closeSheet();
            const conv = state.conversations.find((c) => c.id === res.conversation?.id);
            toast('Joined', 'success');
            if (conv) emit('chat:open', conv);
          }
        } catch (err) {
          showError(err instanceof ApiError ? err.message : 'Something went wrong');
        } finally {
          setBusy(btn, false);
        }
      });
    }
  });
}

export async function refreshConversations() {
  const res = await api.conversations();
  setConversations(res.conversations);
  return state.conversations;
}
