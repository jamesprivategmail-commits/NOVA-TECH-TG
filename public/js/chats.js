// chats.js - conversation list screen
import { api, ApiError } from './api.js';
import { pref } from './settings.js';
import { state, emit, on, isUnread, totalUnreadCount, syncAllUnread } from './state.js';
import {
  $, avatar, icon, escapeHtml, timeAgo, conversationTitle, conversationAvatarUser, conversationIsVerified, verifyBadge,
  emptyState, errorState, skeletonList, toast, openSheet, closeSheet, setBusy
} from './ui.js';

let els = {};

async function openNotesToSelf() {
  if (!state.me?.novaId) return toast('Sign in first');
  try {
    const res = await api.createDm(state.me.novaId);
    const refreshed = await api.conversations();
    state.conversations = refreshed.conversations || [];
    emit('conversations:changed');
    const conv = state.conversations.find((c) => c.id === res.conversationId);
    if (conv) emit('chat:open', conv);
    else toast('Saved Messages ready');
  } catch (err) {
    toast(err.message || 'Could not open Saved Messages — server may need update');
  }
}

export function initChats() {
  els = {
    list: $('#chats-list'),
    search: $('#chats-search'),
    filters: $('#chat-filters'),
    newBtn: $('#new-chat-btn'),
    meAvatar: $('#me-avatar-btn'),
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

  on('conversations:changed', () => { renderChats(); updateFilterChips(); updateChatsNavDot(); });
  on('unread:changed', () => { renderChats(); updateFilterChips(); updateChatsNavDot(); });
  on('settings:changed', () => { renderChats(); updateFilterChips(); updateChatsNavDot(); });
  on('presence', ({ userId, online }) => {
    state.presence[userId] = online;
    updatePresenceDots();
  });
  renderChats();
  updateFilterChips();
  updateChatsNavDot();
}

function updateFilterChips() {
  if (!els.filters) return;
  const unreadTotal = totalUnreadCount();
  const archivedCount = (state.conversations || []).filter((c) => c.archived && c.type !== 'channel').length;
  els.filters.querySelectorAll('.chip').forEach((chip) => {
    const filter = chip.dataset.filter;
    const label = chip.dataset.label || chip.textContent.replace(/\s*\d+\+?$/, '').trim();
    chip.dataset.label = label;
    if (filter === 'unread') {
      chip.innerHTML = unreadTotal
        ? `${escapeHtml(label)} <span class="chip-count">${unreadTotal > 99 ? '99+' : unreadTotal}</span>`
        : escapeHtml(label);
      chip.classList.toggle('has-count', unreadTotal > 0);
    } else if (filter === 'archived') {
      chip.innerHTML = archivedCount
        ? `${escapeHtml(label)} <span class="chip-count muted-count">${archivedCount > 99 ? '99+' : archivedCount}</span>`
        : escapeHtml(label);
    } else {
      chip.textContent = label;
    }
  });
}

function updateChatsNavDot() {
  const dot = $('#nav-dot-chats');
  if (!dot) return;
  // Chats tab dot reflects real message unreads, not notification centre count.
  const total = pref('showUnreadBadges', true) ? totalUnreadCount() : 0;
  dot.classList.toggle('hidden', total < 1);
  dot.textContent = total > 99 ? '99+' : (total > 0 ? String(total) : '');
}

export function setConversations(list) {
  state.conversations = Array.isArray(list) ? list : [];
  for (const conv of state.conversations) {
    const isMine = conv.last_sender_id && state.me?.id && String(conv.last_sender_id) === String(state.me.id);
    if (isMine) {
      state.unread[conv.id] = 0;
      conv.unread_count = 0;
    } else if (typeof conv.unread_count === 'number') {
      state.unread[conv.id] = conv.unread_count;
    } else {
      state.unread[conv.id] = 0;
      conv.unread_count = 0;
    }
  }
  syncAllUnread(state.unread);
  renderChats();
  updateFilterChips();
  updateChatsNavDot();
  emit('conversations:changed');
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
  const list = state.conversations.filter((conv) => {
    if (conv.type === 'channel') return false;
    if (state.filter === 'archived') {
      if (!conv.archived) return false;
    } else {
      // Main lists hide archived chats.
      if (conv.archived) return false;
      if (state.filter === 'unread' && !isUnread(conv)) return false;
      if (state.filter === 'groups' && conv.type !== 'group') return false;
    }
    if (!term) return true;
    const hay = [
      conversationTitle(conv),
      conv.last_message,
      conv.other_user?.nova_id,
      conv.invite_code
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(term);
  });
  // Saved Messages always first
  list.sort((a, b) => {
    if (a.type === 'notes' && b.type !== 'notes') return -1;
    if (b.type === 'notes' && a.type !== 'notes') return 1;
    if (a.pinned && !b.pinned) return -1;
    if (b.pinned && !a.pinned) return 1;
    return 0;
  });
  return list;
}

function previewHtml(conv) {
  if (!conv.last_message) return `<span class="truncate">No messages yet</span>`;
  const mine = conv.last_sender_id === state.me?.id;
  const prefix = mine ? 'You: ' : '';
  const body = conv.last_message;
  const hasMedia = !body || /^(📷 Photo|Voice note|Attachment|Sticker|🎥 Video)$/.test(body);
  const mediaIcon = body === '📷 Photo' ? icon('image') : (body === 'Voice note' ? icon('mic') : (hasMedia ? icon('file') : ''));
  return `${mediaIcon}<span class="truncate">${escapeHtml(prefix + body)}</span>`;
}

function conversationRow(conv) {
  const isMine = conv.last_sender_id && state.me?.id && String(conv.last_sender_id) === String(state.me.id);
  const unreadCount = isMine ? 0 : ((typeof state.unread[conv.id] === 'number') ? state.unread[conv.id] : (conv.unread_count || 0));
  const user = conversationAvatarUser(conv);
  const badge = conv.type === 'group' ? '<span class="pill group">Group</span>'
    : conv.type === 'channel' ? '<span class="pill channel">Channel</span>'
    : conv.type === 'notes' ? '<span class="pill">Notes</span>' : '';
  const pin = conv.pinned ? `<span class="pin-flag">${icon('pin')}</span>` : '';
  const archived = conv.archived ? `<span class="pill">Archived</span>` : '';
  const online = conv.type === 'dm' && conv.other_user && state.presence[conv.other_user.id];
  return `<button class="chat-row${unreadCount > 0 ? ' is-unread' : ''}" data-conv="${escapeHtml(conv.id)}">
    <span class="avatar-wrap">
      ${avatar(user)}
      ${online ? `<span class="online-dot" data-presence-user="${escapeHtml(conv.other_user.id)}"></span>` : ''}
    </span>
    <span class="chat-info">
      <span class="chat-top">
        ${pin}
        <span class="chat-name truncate">${escapeHtml(conversationTitle(conv))} ${verifyBadge(conversationIsVerified(conv))}</span>
        <span class="chat-time">${escapeHtml(timeAgo(conv.last_message_at))}</span>
      </span>
      <span class="chat-bottom">
        <span class="chat-preview">${previewHtml(conv)}</span>
        ${unreadCount > 0 && pref('showUnreadBadges', true) ? `<span class="unread" aria-label="${unreadCount} unread">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
      </span>
      ${badge || archived ? `<span class="chat-top">${badge}${archived}</span>` : ''}
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
    const archivedEmpty = state.filter === 'archived';
    const unreadEmpty = state.filter === 'unread';
    els.list.innerHTML = emptyState({
      iconName: archivedEmpty ? 'bookmark' : (unreadEmpty ? 'message' : 'search'),
      title: archivedEmpty ? 'No archived chats' : (unreadEmpty ? 'No unread chats' : 'Nothing matches'),
      subtitle: archivedEmpty
        ? 'Archive a chat from its options menu to hide it from the main list.'
        : (unreadEmpty ? 'You are all caught up.' : 'Try a different search or filter.')
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
        <button data-tab="community">Community</button>
        <button data-tab="join">Join</button>
      </div>
      <div class="sheet-pad">
        <div id="new-error" class="alert alert-error hidden"></div>
        <div id="pane-dm">
          <label class="field"><span class="field-label">DARK CHAT ID</span>
            <input class="input" id="dm-novaid" placeholder="+1-626-715-0000" autocomplete="off"></label>
          <button type="button" class="btn btn-ghost btn-block" id="open-notes-btn" style="margin-top:10px">Bookmark · Saved Messages (chat yourself)</button>
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
        <div id="pane-community" class="hidden">
          <label class="field"><span class="field-label">Community name</span>
            <input class="input" id="community-name" placeholder="Tech / Gaming / Neighborhood"></label>
          <label class="field"><span class="field-label">Community description</span>
            <input class="input" id="community-desc" placeholder="Announcements and topic groups for all members"></label>
        </div>
        <div id="pane-join" class="hidden">
          <label class="field"><span class="field-label">Invite code</span>
            <input class="input" id="join-code" placeholder="e.g. AB3D7KQ"></label>
        </div>
      </div>`,
    footer: `<div class="sheet-pad"><button class="btn btn-primary btn-block" id="new-submit">Continue</button></div>`,
    onMount(sheet) {
      const tabs = sheet.querySelector('#new-tabs');
      const panes = {
        dm: sheet.querySelector('#pane-dm'),
        group: sheet.querySelector('#pane-group'),
        channel: sheet.querySelector('#pane-channel'),
        community: sheet.querySelector('#pane-community'),
        join: sheet.querySelector('#pane-join')
      };
      let mode = 'dm';
      const showError = (msg) => {
        const box = sheet.querySelector('#new-error');
        box.textContent = msg || '';
        box.classList.toggle('hidden', !msg);
      };
      sheet.querySelector('#open-notes-btn')?.addEventListener('click', async () => {
        showError('');
        try {
          if (!state.me?.novaId) throw new ApiError('Sign in first');
          setBusy(sheet.querySelector('#new-submit'), true, 'Opening...');
          const res = await api.createDm(state.me.novaId);
          await refreshConversations();
          closeSheet();
          const conv = state.conversations.find((c) => c.id === res.conversationId);
          if (conv) emit('chat:open', conv);
          else toast('Saved Messages ready');
        } catch (err) {
          showError(err.message || 'Could not open Saved Messages');
        } finally {
          setBusy(sheet.querySelector('#new-submit'), false);
        }
      });
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
