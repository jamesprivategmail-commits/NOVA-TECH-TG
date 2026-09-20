// chat.js - conversation screen: history, realtime, sending, media, actions
import { api, ApiError } from './api.js';
import { state, emit, on, markRead } from './state.js';
import { joinConversation, sendMessage as socketSend, sendTyping } from './socket.js';
import {
  $, avatar, icon, escapeHtml, formatTime, dayLabel, lastSeenLabel, conversationTitle,
  conversationAvatarUser, toast, openSheet, closeSheet, confirmSheet, promptSheet,
  emptyState, errorState, setBusy, fileToDataUrl, humanSize
} from './ui.js';

let els = {};
let replyTo = null;
let attachment = null; // { type, name, mime, dataUrl, duration, size }
let typingSent = false;
let typingTimer = null;
let mediaRecorder = null;
let recChunks = [];
let recording = false;
let recStart = 0;
let loadingOlder = false;
let searchSeq = 0;

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export function initChat() {
  els = {
    screen: $('#screen-chat'),
    messages: $('#messages'),
    title: $('#chat-title'),
    sub: $('#chat-sub'),
    chatAvatar: $('#chat-avatar'),
    back: $('#chat-back'),
    userBtn: $('#chat-user-btn'),
    callBtn: $('#chat-call-btn'),
    videoBtn: $('#chat-video-btn'),
    searchBtn: $('#chat-search-btn'),
    moreBtn: $('#chat-more-btn'),
    searchBar: $('#chat-searchbar'),
    searchInput: $('#chat-search-input'),
    searchClose: $('#chat-search-close'),
    pinnedBar: $('#pinned-bar'),
    typing: $('#typing-indicator'),
    replyPreview: $('#reply-preview'),
    replyName: $('#reply-preview-name'),
    replyText: $('#reply-preview-text'),
    replyCancel: $('#reply-cancel'),
    composer: $('#composer'),
    input: $('#composer-input'),
    sendBtn: $('#send-btn'),
    attachBtn: $('#composer-attach'),
    attachInput: $('#attach-input'),
    voiceBtn: $('#composer-voice'),
    emojiBtn: $('#composer-emoji'),
    attachPreview: $('#attachment-preview'),
    attachPreviewInner: $('#attachment-preview-inner'),
    attachProgress: $('#attachment-progress'),
    attachCancel: $('#attachment-cancel')
  };

  els.back?.addEventListener('click', closeConversation);
  els.userBtn?.addEventListener('click', openConversationInfo);
  els.callBtn?.addEventListener('click', () => startCall('voice'));
  els.videoBtn?.addEventListener('click', () => startCall('video'));
  els.searchBtn?.addEventListener('click', toggleSearch);
  els.searchClose?.addEventListener('click', () => toggleSearch(false));
  els.moreBtn?.addEventListener('click', openChatMenu);
  els.replyCancel?.addEventListener('click', clearReply);
  els.attachCancel?.addEventListener('click', clearAttachment);

  els.composer?.addEventListener('submit', (e) => { e.preventDefault(); handleSend(); });
  els.input?.addEventListener('input', onInput);
  els.input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); handleSend(); }
  });
  els.attachBtn?.addEventListener('click', () => els.attachInput.click());
  els.attachInput?.addEventListener('change', onAttachSelected);
  els.voiceBtn?.addEventListener('click', toggleRecording);
  els.emojiBtn?.addEventListener('click', () => insertText('🙂'));

  els.searchInput?.addEventListener('input', onSearchInput);

  els.messages?.addEventListener('scroll', onMessagesScroll);
  els.messages?.addEventListener('click', onMessagesClick);

  on('message:new', onIncomingMessage);
  on('typing', onTyping);
  on('presence', onPresence);
}

// ---------------- open / close ----------------
export async function openConversation(conv) {
  if (!conv) return;
  state.activeConv = conv;
  replyTo = null;
  clearAttachment(false);
  clearReply();
  els.screen.hidden = false;
  els.screen.classList.add('active');
  document.querySelectorAll('.screen-list').forEach((s) => s.classList.add('chat-open'));
  renderHeader();
  markRead(conv.id);
  els.messages.innerHTML = `<div style="padding:20px">${emptyState({ iconName: 'message', title: 'Loading messages', subtitle: '' })}</div>`;
  joinConversation(conv.id);
  try {
    const res = await api.messages(conv.id);
    state.messages[conv.id] = res.messages || [];
    state.hasMore[conv.id] = (res.messages || []).length >= 50;
    renderMessages(true);
  } catch (err) {
    els.messages.innerHTML = errorState({ title: 'Could not load messages', subtitle: err.message, retryId: 'retry-messages' });
    $('#retry-messages')?.addEventListener('click', () => openConversation(conv));
  }
  setTimeout(() => els.input?.focus(), 80);
}

export function closeConversation() {
  state.activeConv = null;
  els.screen.hidden = true;
  document.querySelectorAll('.screen-list').forEach((s) => s.classList.remove('chat-open'));
  clearTyping();
  stopTypingSignal();
  state.searchOpen = false;
  els.searchBar?.classList.add('hidden');
}

function renderHeader() {
  const conv = state.activeConv;
  if (!conv) return;
  const user = conversationAvatarUser(conv);
  els.chatAvatar.outerHTML = avatar(user, { size: 'sm', id: 'chat-avatar' });
  els.chatAvatar = $('#chat-avatar');
  els.title.textContent = conversationTitle(conv);
  renderPresenceState();
  // channels: only owners/admins can post
  const role = conv.role || conv.members?.[state.me?.id]?.role;
  const canPost = conv.type !== 'channel' || ['owner', 'admin'].includes(role);
  els.input.disabled = !canPost;
  els.input.placeholder = canPost ? 'Message' : 'Only admins can post in this channel';
  els.sendBtn.disabled = !canPost;
}

function renderPresenceState() {
  const conv = state.activeConv;
  if (!conv || !els.sub) return;
  if (conv.type !== 'dm' || !conv.other_user) {
    const n = (conv.member_ids || []).length;
    els.sub.textContent = conv.type === 'channel' ? 'Channel' : `${n} member${n === 1 ? '' : 's'}`;
    els.sub.classList.remove('online');
    return;
  }
  const online = state.presence[conv.other_user.id];
  const label = lastSeenLabel(conv.other_user.last_seen, online);
  els.sub.textContent = label;
  els.sub.classList.toggle('online', !!online);
}

// ---------------- typing ----------------
function onInput() {
  autoGrow();
  const typing = els.input.value.length > 0;
  if (typing && !typingSent) {
    typingSent = true;
    sendTyping(state.activeConv.id, true);
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTypingSignal, 1800);
}

function stopTypingSignal() {
  if (typingSent && state.activeConv) sendTyping(state.activeConv.id, false);
  typingSent = false;
}

function onTyping(payload) {
  if (!state.activeConv || payload.conversationId !== state.activeConv.id) return;
  if (payload.userId === state.me?.id) return;
  if (!state.typing[payload.conversationId]) state.typing[payload.conversationId] = {};
  const map = state.typing[payload.conversationId];
  if (payload.isTyping) {
    map[payload.userId] = Date.now() + 3000;
  } else {
    delete map[payload.userId];
  }
  renderTyping();
}

function renderTyping() {
  const conv = state.activeConv;
  if (!conv) return;
  const map = state.typing[conv.id] || {};
  const now = Date.now();
  const names = Object.keys(map).filter((uid) => map[uid] > now);
  if (!names.length) {
    els.typing.classList.add('hidden');
    els.typing.textContent = '';
    return;
  }
  const label = conv.type === 'dm' ? 'typing...' : `${names.length} typing...`;
  els.typing.textContent = label;
  els.typing.classList.remove('hidden');
}

function onPresence(payload) {
  state.presence[payload.userId] = payload.online;
  if (state.activeConv && state.activeConv.type === 'dm' && state.activeConv.other_user?.id === payload.userId) {
    state.activeConv.other_user.last_seen = new Date().toISOString();
    renderPresenceState();
  }
}

// ---------------- messages ----------------
function messageMediaUrl(msg) {
  const url = msg.media_url || msg.media_data;
  if (typeof url !== 'string' || !url) return null;
  if (url.startsWith('/') || url.startsWith('data:')) return url;
  return null;
}

function mediaHtml(msg) {
  const url = messageMediaUrl(msg);
  const type = msg.media_type;
  if (!type || !url) return '';
  if (type === 'image') {
    return `<div class="media"><img src="${escapeHtml(url)}" alt="Photo" loading="lazy" data-open-media="${escapeHtml(url)}" onerror="this.closest('.media').style.display='none'"></div>`;
  }
  if (type === 'video') {
    return `<div class="media"><video src="${escapeHtml(url)}" controls preload="metadata" onerror="this.closest('.media').style.display='none'"></video></div>`;
  }
  if (type === 'voice' || type === 'audio') {
    return `<div class="media"><audio src="${escapeHtml(url)}" controls preload="metadata"></audio></div>`;
  }
  const name = msg.media_name || (msg.media_mime ? msg.media_mime.split('/')[1] : 'file');
  return `<div class="media-file">${icon('file')}<span class="file-name truncate">${escapeHtml(name)}</span>
    <a class="icon-btn" href="${escapeHtml(url)}" download="${escapeHtml(name)}" aria-label="Download file" target="_blank" rel="noopener">${icon('download')}</a></div>`;
}

function replyQuoteHtml(msg) {
  if (!msg.reply_to_id) return '';
  const list = state.messages[msg.conversation_id] || [];
  const target = list.find((m) => m.id === msg.reply_to_id);
  if (!target) return `<div class="reply-quote"><span class="who">Reply</span> · message unavailable</div>`;
  const who = target.sender_id === state.me?.id ? 'You' : (target.display_name || 'User');
  const text = target.deleted_for_everyone ? 'This message was deleted' : (target.content || (target.media_type ? 'Attachment' : ''));
  return `<div class="reply-quote"><span class="who">${escapeHtml(who)}</span><div class="truncate">${escapeHtml(text)}</div></div>`;
}

function reactionsHtml(msg) {
  const reactions = Array.isArray(msg.reactions) ? msg.reactions : [];
  if (!reactions.length) return '';
  const counts = new Map();
  for (const r of reactions) {
    const key = r.reaction;
    if (!counts.has(key)) counts.set(key, { count: 0, mine: false });
    const entry = counts.get(key);
    entry.count += 1;
    if (r.user_id === state.me?.id) entry.mine = true;
  }
  return `<div class="reactions">${[...counts.entries()].map(([emoji, info]) =>
    `<button class="reaction ${info.mine ? 'mine' : ''}" data-react="${escapeHtml(emoji)}" data-react-msg="${escapeHtml(msg.id)}">${escapeHtml(emoji)} ${info.count}</button>`
  ).join('')}</div>`;
}

function metaHtml(msg) {
  if (msg._status === 'failed') {
    return `<div class="meta"><span class="failed">Failed</span> · <button class="retry" data-retry="${escapeHtml(msg.id)}">Retry</button></div>`;
  }
  const edited = msg.edited_at ? '<span class="edited">edited</span>' : '';
  const ticking = msg._status === 'sending'
    ? `<span style="opacity:.6">${icon('check')}</span>`
    : `<span class="seen">${icon('check-check')}</span>`;
  const pin = msg.pinned_at ? `<span class="pin-flag" title="Pinned">${icon('pin')}</span>` : '';
  return `<div class="meta">${edited}${pin}<span>${escapeHtml(formatTime(msg.created_at))}</span>${msg.sender_id === state.me?.id ? ticking : ''}</div>`;
}

function messageHtml(msg, index, list) {
  const own = msg.sender_id === state.me?.id;
  const prev = list[index - 1];
  const grouped = prev && prev.sender_id === msg.sender_id && dayLabel(prev.created_at) === dayLabel(msg.created_at);
  const deleted = msg.deleted_for_everyone;
  const sender = !own && !grouped ? `<span class="sender" style="color:${escapeHtml(msg.avatar_color || '#3da9ff')}">${escapeHtml(msg.display_name || 'User')}</span>` : '';
  const bubbleClass = ['bubble'];
  if (deleted) bubbleClass.push('deleted');
  const inner = deleted
    ? `<span class="text">${icon('alert')} This message was deleted</span>`
    : `${sender}${replyQuoteHtml(msg)}${mediaHtml(msg)}${msg.content ? `<span class="text">${escapeHtml(msg.content)}</span>` : ''}`;
  const cls = ['message'];
  if (own) cls.push('own');
  if (grouped) cls.push('grouped');
  return `<div class="${cls.join(' ')}" data-msg="${escapeHtml(msg.id)}">
    <div class="${bubbleClass.join(' ')}" data-bubble="${escapeHtml(msg.id)}">${inner}</div>
    ${reactionsHtml(msg)}
    ${metaHtml(msg)}
  </div>`;
}

export function renderMessages(scrollToBottom = false) {
  const conv = state.activeConv;
  if (!conv) return;
  const list = (state.messages[conv.id] || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (!list.length) {
    els.messages.innerHTML = emptyState({ iconName: 'message', title: 'No messages yet', subtitle: 'Say hello to start the conversation.' });
    renderPinned(list);
    return;
  }
  let html = '';
  if (state.hasMore[conv.id]) html += `<button class="day" id="load-older">${icon('refresh')} Load earlier messages</button>`;
  let lastDay = null;
  list.forEach((msg, i) => {
    const day = dayLabel(msg.created_at);
    if (day !== lastDay) { html += `<div class="day">${escapeHtml(day)}</div>`; lastDay = day; }
    html += messageHtml(msg, i, list);
  });
  els.messages.innerHTML = html;
  const older = $('#load-older');
  if (older) older.addEventListener('click', loadOlder);
  renderPinned(list);
  if (scrollToBottom) scrollToEnd();
}

function renderPinned(list) {
  const pinned = list.filter((m) => m.pinned_at);
  if (!pinned.length) { els.pinnedBar.classList.add('hidden'); return; }
  const latest = pinned[pinned.length - 1];
  const who = latest.sender_id === state.me?.id ? 'You' : (latest.display_name || 'User');
  els.pinnedBar.innerHTML = `${icon('pin')}<div class="pin-body"><div class="pin-title">Pinned message</div>
    <div class="truncate">${escapeHtml(latest.content || 'Attachment')}</div></div>
    <div class="muted" style="font-size:12px">${escapeHtml(who)}</div>`;
  els.pinnedBar.classList.remove('hidden');
  els.pinnedBar.onclick = () => scrollToMessage(latest.id);
}

function scrollToEnd() {
  requestAnimationFrame(() => { els.messages.scrollTop = els.messages.scrollHeight; });
}

function scrollToMessage(id) {
  const node = els.messages.querySelector(`[data-msg="${CSS.escape(id)}"]`);
  if (node) {
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.style.transition = 'background .4s';
    const bubble = node.querySelector('.bubble');
    if (bubble) { bubble.style.outline = '2px solid var(--red)'; setTimeout(() => { bubble.style.outline = 'none'; }, 1200); }
  }
}

async function loadOlder() {
  const conv = state.activeConv;
  if (!conv || loadingOlder) return;
  const list = state.messages[conv.id] || [];
  if (!list.length) return;
  loadingOlder = true;
  const btn = $('#load-older');
  if (btn) btn.textContent = 'Loading...';
  try {
    const oldest = list[0].created_at;
    const res = await api.messages(conv.id, oldest);
    const older = res.messages || [];
    if (older.length < 50) state.hasMore[conv.id] = false;
    const existing = new Set(list.map((m) => m.id));
    const merged = [...older.filter((m) => !existing.has(m.id)), ...list];
    state.messages[conv.id] = merged;
    const prevHeight = els.messages.scrollHeight;
    renderMessages(false);
    els.messages.scrollTop = els.messages.scrollHeight - prevHeight;
  } catch (err) {
    toast(err.message || 'Could not load earlier messages');
  } finally {
    loadingOlder = false;
  }
}

function onMessagesScroll() {
  renderTyping();
  if (els.messages.scrollTop < 40 && state.hasMore[state.activeConv?.id]) loadOlder();
}

// ---------------- incoming ----------------
export function onIncomingMessage(msg) {
  if (!msg || !msg.conversation_id) return;
  const convId = msg.conversation_id;
  if (!state.messages[convId]) state.messages[convId] = [];
  const list = state.messages[convId];
  const idx = list.findIndex((m) => m.id === msg.id);
  if (idx > -1) list[idx] = { ...list[idx], ...msg, _status: 'sent' };
  else list.push({ ...msg, _status: 'sent' });

  // refresh conversation preview
  const conv = state.conversations.find((c) => c.id === convId);
  if (conv) {
    conv.last_message = msg.content || (msg.media_type ? 'Attachment' : '');
    conv.last_message_at = msg.created_at;
    conv.last_sender_id = msg.sender_id;
    emit('conversations:changed');
  } else {
    emit('data:refresh-conversations');
  }

  if (state.activeConv && state.activeConv.id === convId) {
    const atBottom = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 120;
    renderMessages(false);
    if (atBottom || msg.sender_id === state.me?.id) scrollToEnd();
    if (document.visibilityState === 'visible') markRead(convId);
  } else {
    import('./state.js').then(({ bumpUnread }) => bumpUnread(convId));
  }
}

// ---------------- sending ----------------
function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 140)}px`;
}

function insertText(text) {
  els.input.value += text;
  els.input.focus();
  autoGrow();
}

function clearReply() {
  replyTo = null;
  els.replyPreview.classList.add('hidden');
}

function clearAttachment(resetInput = true) {
  attachment = null;
  els.attachPreview.classList.add('hidden');
  els.attachPreviewInner.innerHTML = '';
  if (resetInput && els.attachInput) els.attachInput.value = '';
}

async function onAttachSelected() {
  const file = els.attachInput.files?.[0];
  if (!file) return;
  const maxSize = 15 * 1024 * 1024;
  if (file.size > maxSize) { toast('File is too large (max 15MB)'); els.attachInput.value = ''; return; }
  try {
    const dataUrl = await fileToDataUrl(file);
    const type = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('audio/') ? 'audio' : 'file';
    attachment = { type, name: file.name, mime: file.type || 'application/octet-stream', dataUrl, size: file.size, duration: null };
    showAttachmentPreview();
  } catch {
    toast('Could not read that file');
  }
}

function showAttachmentPreview() {
  if (!attachment) return;
  const { type, dataUrl, name, size } = attachment;
  let thumb = '';
  if (type === 'image') thumb = `<img src="${escapeHtml(dataUrl)}" alt="">`;
  else if (type === 'video') thumb = `<video src="${escapeHtml(dataUrl)}" muted></video>`;
  else thumb = `<span class="option-icon">${icon(type === 'audio' ? 'music' : 'file')}</span>`;
  els.attachPreviewInner.innerHTML = `${thumb}<span class="name truncate">${escapeHtml(name)} · ${escapeHtml(humanSize(size))}</span>`;
  els.attachPreview.classList.remove('hidden');
  els.attachProgress.querySelector('span').style.width = '0%';
}

async function handleSend() {
  const conv = state.activeConv;
  if (!conv) return;
  if (els.input.disabled) return;
  const content = els.input.value.trim();
  if (!content && !attachment) return;

  const currentAttachment = attachment;
  const currentReply = replyTo;

  // optimistic bubble
  const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const temp = {
    id: tempId,
    conversation_id: conv.id,
    sender_id: state.me?.id,
    content: content || null,
    media_type: currentAttachment?.type || null,
    media_url: currentAttachment?.dataUrl || null,
    media_data: currentAttachment?.dataUrl || null,
    media_mime: currentAttachment?.mime || null,
    media_name: currentAttachment?.name || null,
    reply_to_id: currentReply?.id || null,
    created_at: new Date().toISOString(),
    display_name: state.me?.displayName,
    avatar_color: state.me?.avatarColor,
    is_verified: state.me?.isVerified,
    reactions: [],
    _status: 'sending',
    _content: content,
    _attachment: currentAttachment,
    _reply: currentReply
  };
  state.messages[conv.id] = state.messages[conv.id] || [];
  state.messages[conv.id].push(temp);
  els.input.value = '';
  autoGrow();
  clearReply();
  clearAttachment();
  renderMessages(true);
  stopTypingSignal();

  await deliverTemp(conv.id, temp);
}

async function deliverTemp(convId, temp) {
  const list = state.messages[convId] || [];
  const update = () => {
    const i = list.findIndex((m) => m.id === temp.id);
    if (i > -1) {
      const atBottom = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 160;
      renderMessages(false);
      if (atBottom) scrollToEnd();
    }
  };

  let mediaData = null;
  if (temp._attachment) {
    // real upload with progress, so failures and progress are honest
    try {
      await uploadAttachment(temp._attachment, (pct) => {
        els.attachProgress.querySelector('span').style.width = `${pct}%`;
      });
      mediaData = { type: temp._attachment.type, data: temp._attachment.dataUrl, mime: temp._attachment.mime, duration: temp._attachment.duration };
    } catch (err) {
      temp._status = 'failed';
      update();
      toast('Upload failed - tap retry on the message');
      return;
    }
  }

  const ack = await socketSend({
    conversationId: convId,
    content: temp._content || null,
    media: mediaData,
    replyToId: temp._reply?.id || null
  });

  const i = list.findIndex((m) => m.id === temp.id);
  if (i > -1) list.splice(i, 1);

  if (ack && ack.ok && ack.message) {
    const real = { ...ack.message, _status: 'sent' };
    const exists = list.findIndex((m) => m.id === real.id);
    if (exists > -1) list[exists] = { ...list[exists], ...real };
    else list.push(real);
  } else {
    // keep optimistic bubble, mark failed for retry
    temp._status = 'failed';
    const failedList = state.messages[convId];
    if (!failedList.find((m) => m.id === temp.id)) failedList.push(temp);
    update();
    return;
  }
  update();
}

function uploadAttachment(att, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/storage/upload');
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (state.token) xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
      } else {
        reject(new Error('Upload failed'));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(JSON.stringify({ data: att.dataUrl, mimeType: att.mime, filename: att.name }));
  });
}

async function retryMessage(messageId) {
  const conv = state.activeConv;
  if (!conv) return;
  const list = state.messages[conv.id] || [];
  const msg = list.find((m) => m.id === messageId);
  if (!msg) return;
  const i = list.indexOf(msg);
  if (i > -1) list.splice(i, 1);
  msg.id = `temp_${Date.now()}_retry`;
  msg._status = 'sending';
  list.push(msg);
  msg._content = msg.content;
  msg._attachment = msg.media_data ? { type: msg.media_type, dataUrl: msg.media_data, mime: msg.media_mime, name: msg.media_name } : null;
  msg._reply = null;
  renderMessages(true);
  await deliverTemp(conv.id, msg);
}

// ---------------- message actions ----------------
function onMessagesClick(event) {
  const media = event.target.closest('[data-open-media]');
  if (media) {
    openLightbox(media.getAttribute('data-open-media'));
    return;
  }
  const reaction = event.target.closest('[data-react]');
  if (reaction) {
    toggleReaction(reaction.getAttribute('data-react-msg'), reaction.getAttribute('data-react'));
    return;
  }
  const retry = event.target.closest('[data-retry]');
  if (retry) {
    retryMessage(retry.getAttribute('data-retry'));
    return;
  }
  const bubble = event.target.closest('[data-bubble]');
  if (bubble) {
    const id = bubble.getAttribute('data-bubble');
    const msg = (state.messages[state.activeConv?.id] || []).find((m) => m.id === id);
    if (msg) openMessageActions(msg);
  }
}

function openLightbox(url) {
  const viewer = $('#viewer');
  viewer.hidden = false;
  viewer.innerHTML = `<div class="viewer-stage"><img src="${escapeHtml(url)}" alt=""></div>
    <div class="viewer-foot"><button class="btn btn-ghost btn-block" id="lightbox-close">Close</button></div>`;
  viewer.querySelector('#lightbox-close').addEventListener('click', () => { viewer.hidden = true; viewer.innerHTML = ''; });
}

function openMessageActions(msg) {
  const own = msg.sender_id === state.me?.id;
  const deleted = msg.deleted_for_everyone;
  const reactionRow = QUICK_REACTIONS.map((emoji) =>
    `<button class="icon-btn" data-quick="${escapeHtml(emoji)}" aria-label="React ${escapeHtml(emoji)}" style="font-size:22px">${escapeHtml(emoji)}</button>`
  ).join('');
  const options = [];
  if (!deleted) {
    options.push(`<button class="option" data-act="reply">${icon('reply')}<span class="option-copy">Reply</span></button>`);
    if (msg.content) options.push(`<button class="option" data-act="copy">${icon('file')}<span class="option-copy">Copy text</span></button>`);
    options.push(`<button class="option" data-act="save">${icon('bookmark')}<span class="option-copy">${msg.saved_by_me ? 'Remove from saved' : 'Save message'}</span></button>`);
    options.push(`<button class="option" data-act="pin">${icon('pin')}<span class="option-copy">${msg.pinned_at ? 'Unpin' : 'Pin message'}</span></button>`);
    if (own) options.push(`<button class="option" data-act="edit">${icon('edit')}<span class="option-copy">Edit message</span></button>`);
    options.push(`<button class="option danger" data-act="delete">${icon('trash')}<span class="option-copy">Delete</span></button>`);
  }
  openSheet({
    title: 'Message',
    body: `<div class="sheet-pad" style="flex-direction:row;justify-content:space-between">${reactionRow}</div>
      <div class="sheet-body">${options.join('')}</div>`,
    onMount(sheet) {
      sheet.querySelectorAll('[data-quick]').forEach((btn) => btn.addEventListener('click', () => {
        toggleReaction(msg.id, btn.dataset.quick);
        closeSheet();
      }));
      sheet.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        closeSheet();
        if (act === 'reply') startReply(msg);
        else if (act === 'copy') {
          try { await navigator.clipboard.writeText(msg.content || ''); toast('Copied', 'success'); } catch { toast('Copy failed'); }
        } else if (act === 'save') await toggleSave(msg);
        else if (act === 'pin') await togglePin(msg);
        else if (act === 'edit') await editMessage(msg);
        else if (act === 'delete') await deleteMessage(msg);
      }));
    }
  });
}

function startReply(msg) {
  replyTo = msg;
  const who = msg.sender_id === state.me?.id ? 'You' : (msg.display_name || 'User');
  els.replyName.textContent = who;
  els.replyText.textContent = msg.content || (msg.media_type ? 'Attachment' : '');
  els.replyPreview.classList.remove('hidden');
  els.input.focus();
}

async function toggleReaction(messageId, reaction) {
  const conv = state.activeConv;
  if (!conv) return;
  const list = state.messages[conv.id] || [];
  const msg = list.find((m) => m.id === messageId);
  if (!msg || String(msg.id).startsWith('temp_')) return;
  // optimistic
  const reactions = Array.isArray(msg.reactions) ? [...msg.reactions] : [];
  const idx = reactions.findIndex((r) => r.user_id === state.me?.id && r.reaction === reaction);
  if (idx > -1) reactions.splice(idx, 1);
  else reactions.push({ user_id: state.me?.id, reaction });
  msg.reactions = reactions;
  renderMessages(false);
  try {
    const res = await api.react(conv.id, messageId, reaction);
    if (Array.isArray(res.reactions)) {
      // rebuild full list preserving who reacted where possible
      msg.reactions = reactions;
    }
  } catch (err) {
    toast(err.message || 'Reaction failed');
  }
}

async function toggleSave(msg) {
  const conv = state.activeConv;
  try {
    const res = await api.saveMessage(conv.id, msg.id);
    msg.saved_by_me = res.saved;
    toast(res.saved ? 'Saved' : 'Removed from saved', 'success');
  } catch (err) { toast(err.message || 'Could not save'); }
}

async function togglePin(msg) {
  const conv = state.activeConv;
  try {
    const res = await api.pinMessage(conv.id, msg.id);
    msg.pinned_at = res.pinned ? new Date().toISOString() : null;
    renderMessages(false);
    toast(res.pinned ? 'Pinned' : 'Unpinned', 'success');
  } catch (err) { toast(err.message || 'Could not pin'); }
}

async function editMessage(msg) {
  const conv = state.activeConv;
  const next = await promptSheet({ title: 'Edit message', label: 'Message', value: msg.content || '', confirmText: 'Save', multiline: true });
  if (next === null || next === msg.content) return;
  if (!next) { toast('Message cannot be empty'); return; }
  try {
    const res = await api.editMessage(conv.id, msg.id, next);
    msg.content = res.message?.content ?? next;
    msg.edited_at = res.message?.edited_at || new Date().toISOString();
    renderMessages(false);
  } catch (err) { toast(err.message || 'Could not edit'); }
}

async function deleteMessage(msg) {
  const conv = state.activeConv;
  const own = msg.sender_id === state.me?.id;
  const everyone = own ? await confirmSheet({ title: 'Delete message', message: 'Delete for everyone in this conversation?', confirmText: 'Delete for everyone', danger: true }) : false;
  const scope = everyone ? 'everyone' : 'me';
  if (!own && !(await confirmSheet({ title: 'Delete message', message: 'Remove this message for you?', confirmText: 'Delete', danger: true }))) return;
  try {
    await api.deleteMessage(conv.id, msg.id, scope);
    const list = state.messages[conv.id] || [];
    if (scope === 'everyone') {
      msg.deleted_for_everyone = true;
      msg.content = null;
      msg.media_url = null;
      msg.media_data = null;
    } else {
      const i = list.indexOf(msg);
      if (i > -1) list.splice(i, 1);
    }
    renderMessages(false);
  } catch (err) { toast(err.message || 'Could not delete'); }
}

// ---------------- search ----------------
function toggleSearch(force) {
  const open = force === undefined ? !state.searchOpen : force;
  state.searchOpen = open;
  els.searchBar.classList.toggle('hidden', !open);
  if (open) { els.searchInput.focus(); }
  else { els.searchInput.value = ''; }
}

async function onSearchInput() {
  const q = els.searchInput.value.trim();
  if (q.length < 2) return;
  const seq = ++searchSeq;
  try {
    const res = await api.searchMessages(state.activeConv.id, q);
    if (seq !== searchSeq) return;
    const messages = res.messages || [];
    openSheet({
      title: `Results for "${escapeHtml(q)}"`,
      body: messages.length
        ? `<div class="sheet-body">${messages.map((m) => `<button class="option" data-goto="${escapeHtml(m.id)}">
            <span class="option-copy"><b>${escapeHtml(m.display_name)}</b><small class="truncate">${escapeHtml(m.content)}</small></span>
            <span class="muted" style="font-size:12px">${escapeHtml(formatTime(m.created_at))}</span>
          </button>`).join('')}</div>`
        : emptyState({ iconName: 'search', title: 'No matches', subtitle: 'Try another word.' }),
      onMount(sheet) {
        sheet.querySelectorAll('[data-goto]').forEach((btn) => btn.addEventListener('click', () => {
          closeSheet();
          toggleSearch(false);
          const id = btn.dataset.goto;
          if ((state.messages[state.activeConv.id] || []).some((m) => m.id === id)) scrollToMessage(id);
          else toast('Scroll up to load that message');
        }));
      }
    });
  } catch (err) {
    toast(err.message || 'Search failed');
  }
}

// ---------------- voice notes ----------------
async function toggleRecording() {
  if (recording) return stopRecording();
  if (!navigator.mediaDevices?.getUserMedia) { toast('Voice recording not supported here'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const duration = Math.round((Date.now() - recStart) / 1000);
      const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const dataUrl = await fileToDataUrl(blob);
      attachment = { type: 'voice', name: `voice_${Date.now()}.webm`, mime: blob.type, dataUrl, size: blob.size, duration };
      showAttachmentPreview();
    };
    recStart = Date.now();
    mediaRecorder.start();
    recording = true;
    els.composer.classList.add('recording');
    els.voiceBtn.innerHTML = icon('stop');
    els.voiceBtn.setAttribute('aria-label', 'Stop recording');
    toast('Recording... tap again to stop');
  } catch {
    toast('Microphone permission denied');
  }
}

function stopRecording() {
  if (mediaRecorder && recording) {
    recording = false;
    mediaRecorder.stop();
    els.composer.classList.remove('recording');
    els.voiceBtn.innerHTML = icon('mic');
    els.voiceBtn.setAttribute('aria-label', 'Record voice note');
  }
}

// ---------------- conversation menu ----------------
function openChatMenu() {
  const conv = state.activeConv;
  if (!conv) return;
  const isGroup = conv.type === 'group';
  const isChannel = conv.type === 'channel';
  const role = conv.role || conv.members?.[state.me?.id]?.role;
  const canManage = ['owner', 'admin'].includes(role);
  const options = [];
  if (isGroup || isChannel) options.push(`<button class="option" data-act="members">${icon('users')}<span class="option-copy">${isChannel ? 'Channel info' : 'Group members'}<small>${(conv.member_ids || []).length} members</small></span></button>`);
  if (isGroup && canManage) options.push(`<button class="option" data-act="add">${icon('user-plus')}<span class="option-copy">Add member</span></button>`);
  if (isGroup && canManage) options.push(`<button class="option" data-act="rename">${icon('edit')}<span class="option-copy">Rename group</span></button>`);
  if (isChannel && conv.invite_code) options.push(`<button class="option" data-act="invite">${icon('link')}<span class="option-copy">Invite code<small>${escapeHtml(conv.invite_code)}</small></span></button>`);
  options.push(`<button class="option" data-act="search">${icon('search')}<span class="option-copy">Search in conversation</span></button>`);
  options.push(`<button class="option" data-act="mute">${icon('bell')}<span class="option-copy">${conv.muted ? 'Unmute' : 'Mute'} notifications</span></button>`);
  options.push(`<button class="option" data-act="pin">${icon('pin')}<span class="option-copy">${conv.pinned ? 'Unpin' : 'Pin'} conversation</span></button>`);
  options.push(`<button class="option danger" data-act="clear">${icon('trash')}<span class="option-copy">Clear messages (for me)</span></button>`);
  if ((isGroup || isChannel) && !canManage) options.push(`<button class="option danger" data-act="leave">${icon('logout')}<span class="option-copy">Leave</span></button>`);
  if ((isGroup || isChannel) && canManage) options.push(`<button class="option danger" data-act="delete">${icon('trash')}<span class="option-copy">Delete conversation</span></button>`);

  openSheet({
    title: escapeHtml(conversationTitle(conv)),
    body: `<div class="sheet-body">${options.join('')}</div>`,
    onMount(sheet) {
      sheet.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        closeSheet();
        handleChatAction(act, conv, role);
      }));
    }
  });
}

async function handleChatAction(act, conv, role) {
  const canManage = ['owner', 'admin'].includes(role);
  try {
    if (act === 'search') return toggleSearch(true);
    if (act === 'members') return openConversationInfo();
    if (act === 'add') return addMemberFlow(conv);
    if (act === 'rename') {
      const name = await promptSheet({ title: 'Rename', label: 'Group name', value: conv.name || '', confirmText: 'Save' });
      if (!name) return;
      await api.updateConversation(conv.id, { name });
      conv.name = name;
      emit('conversations:changed');
      renderHeader();
      toast('Renamed', 'success');
      return;
    }
    if (act === 'invite') {
      try { await navigator.clipboard.writeText(conv.invite_code); toast('Invite code copied', 'success'); } catch { toast(conv.invite_code); }
      return;
    }
    if (act === 'mute') {
      await api.updateConversation(conv.id, { muted: !conv.muted });
      conv.muted = !conv.muted;
      emit('conversations:changed');
      toast(conv.muted ? 'Muted' : 'Unmuted');
      return;
    }
    if (act === 'pin') {
      await api.updateConversation(conv.id, { pinned: !conv.pinned });
      conv.pinned = !conv.pinned;
      emit('conversations:changed');
      toast(conv.pinned ? 'Pinned' : 'Unpinned');
      return;
    }
    if (act === 'clear') {
      const ok = await confirmSheet({ title: 'Clear messages', message: 'Remove all messages from your view?', confirmText: 'Clear', danger: true });
      if (!ok) return;
      const list = state.messages[conv.id] || [];
      for (const m of list.slice()) {
        try { await api.deleteMessage(conv.id, m.id, 'me'); } catch { /* continue */ }
      }
      state.messages[conv.id] = [];
      renderMessages(false);
      toast('Cleared');
      return;
    }
    if (act === 'leave') {
      const ok = await confirmSheet({ title: 'Leave', message: 'Leave this conversation?', confirmText: 'Leave', danger: true });
      if (!ok) return;
      await api.removeMember(conv.id, state.me.id);
      state.conversations = state.conversations.filter((c) => c.id !== conv.id);
      emit('conversations:changed');
      closeConversation();
      return;
    }
    if (act === 'delete') {
      if (!canManage) { toast('Only the owner can delete'); return; }
      const ok = await confirmSheet({ title: 'Delete conversation', message: 'This deletes it for everyone. This cannot be undone.', confirmText: 'Delete', danger: true });
      if (!ok) return;
      await api.deleteConversation(conv.id);
      state.conversations = state.conversations.filter((c) => c.id !== conv.id);
      emit('conversations:changed');
      closeConversation();
      toast('Deleted');
    }
  } catch (err) {
    toast(err instanceof ApiError ? err.message : 'Action failed');
  }
}

async function addMemberFlow(conv) {
  const novaId = await promptSheet({ title: 'Add member', label: 'DARK CHAT ID', placeholder: '+1-626-715-0000', confirmText: 'Add' });
  if (!novaId) return;
  try {
    await api.addMember(conv.id, novaId);
    toast('Member added', 'success');
  } catch (err) {
    toast(err instanceof ApiError ? err.message : 'Could not add member');
  }
}

// ---------------- conversation info ----------------
async function openConversationInfo() {
  const conv = state.activeConv;
  if (!conv) return;
  if (conv.type === 'dm') {
    const u = conv.other_user || {};
    openSheet({
      title: 'Contact',
      body: `<div class="sheet-pad center stack">
        ${avatar({ displayName: u.display_name, avatarUrl: u.avatar_url, avatarColor: u.avatar_color }, { size: 'lg' })}
        <div style="font-size:19px;font-weight:700">${escapeHtml(u.display_name || 'User')}</div>
        <div class="muted">${escapeHtml(u.nova_id || '')}</div>
        <div class="muted">${escapeHtml(lastSeenLabel(u.last_seen, state.presence[u.id]))}</div>
      </div>`,
      footer: `<div class="sheet-pad stack">
        <button class="btn btn-primary btn-block" id="info-call">${icon('phone')} Voice call</button>
        <button class="btn btn-ghost btn-block" id="info-video">${icon('video')} Video call</button>
        <button class="btn btn-danger btn-block" id="info-block">${icon('lock')} Block user</button>
      </div>`,
      onMount(sheet) {
        sheet.querySelector('#info-call').addEventListener('click', () => { closeSheet(); startCall('voice'); });
        sheet.querySelector('#info-video').addEventListener('click', () => { closeSheet(); startCall('video'); });
        sheet.querySelector('#info-block').addEventListener('click', async () => {
          closeSheet();
          const ok = await confirmSheet({ title: 'Block user', message: `Block ${u.display_name || 'this user'}?`, confirmText: 'Block', danger: true });
          if (!ok) return;
          try { await api.block(u.nova_id); toast('User blocked', 'success'); } catch (err) { toast(err.message || 'Could not block'); }
        });
      }
    });
    return;
  }
  try {
    const res = await api.members(conv.id);
    const members = res.members || [];
    openSheet({
      title: escapeHtml(conversationTitle(conv)),
      body: `<div class="sheet-body">${members.map((m) => `<div class="option">
        ${avatar({ displayName: m.display_name, avatarUrl: m.avatar_url, avatarColor: m.avatar_color }, { size: 'sm' })}
        <span class="option-copy">${escapeHtml(m.display_name)}<small>${escapeHtml(m.nova_id || '')} · ${escapeHtml(m.role || 'member')}</small></span>
      </div>`).join('')}</div>`,
      footer: conv.invite_code ? `<div class="sheet-pad"><button class="btn btn-ghost btn-block" id="copy-invite">${icon('link')} Copy invite code</button></div>` : '',
      onMount(sheet) {
        sheet.querySelector('#copy-invite')?.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(conv.invite_code); toast('Copied', 'success'); } catch { toast(conv.invite_code); }
        });
      }
    });
  } catch (err) {
    toast(err.message || 'Could not load members');
  }
}

// ---------------- calls (delegated to calls module via event) ----------------
function startCall(kind) {
  const conv = state.activeConv;
  if (!conv) return;
  if (!conv.other_user && conv.type !== 'dm') {
    toast('Calls are supported in direct messages');
    return;
  }
  emit('call:start', { conversation: conv, kind });
}