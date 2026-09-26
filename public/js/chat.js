// chat.js - conversation screen: history, realtime, sending, media, actions
import { api, mediaSrc, apiBase, ApiError } from './api.js';
import { pref } from './settings.js';
import { openStickerPicker, saveSentStickerToPack } from './stickers.js';
import { state, emit, on, markRead, bumpUnread } from './state.js';
import { joinConversation, sendMessage as socketSend, sendTyping, markConversationRead } from './socket.js';
import {
  $, avatar, icon, escapeHtml, formatTime, dayLabel, lastSeenLabel, conversationTitle, conversationIsVerified, verifyBadge,
  conversationAvatarUser, toast, openSheet, closeSheet, confirmSheet, promptSheet,
  emptyState, errorState, setBusy, fileToDataUrl, humanSize, linkify
} from './ui.js';

let els = {};
let replyTo = null;
let attachment = null; // { type, name, mime, dataUrl, duration, size, waveform }
let typingSent = false;
let typingTimer = null;
let mediaRecorder = null;
let recChunks = [];
let recAmplitudes = [];
let recording = false;
let recStartTime = 0;
let recStream = null;
let recAudioCtx = null;
let recAnalyser = null;
let recAnimId = null;
let recTimerId = null;
let recordedBlob = null;
let recordedDuration = 0;
let recordingStopAction = 'preview'; // 'preview' | 'send' | 'cancel'
let previewAudio = null;
let loadingOlder = false;
let searchSeq = 0;
let messagePollTimer = null;

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

function safeEscape(val) {
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(val);
  return String(val || '').replace(/["\\]/g, '\\$&');
}

// Audio manager for WhatsApp-style voice note bubbles (singleton player)
export const VoiceAudioManager = {
  currentMsgId: null,
  audio: null,
  speed: 1, // 1 | 1.5 | 2

  play(msgId, url, duration) {
    if (!url) {
      toast('Voice note audio is unavailable');
      return;
    }

    if (this.currentMsgId === msgId && this.audio) {
      if (this.audio.paused) {
        this.audio.play().catch((err) => {
          console.warn('Voice play resume error:', err);
          toast('Playback failed');
        });
        this.updatePlayState(true);
      } else {
        this.audio.pause();
        this.updatePlayState(false);
      }
      return;
    }

    this.stop();
    this.currentMsgId = msgId;
    const resolvedUrl = mediaSrc(url);
    this.audio = new Audio(resolvedUrl);
    this.audio.playbackRate = this.speed;
    this.audio.preload = 'auto';

    this.audio.addEventListener('play', () => this.updatePlayState(true));
    this.audio.addEventListener('pause', () => this.updatePlayState(false));
    this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.audio.addEventListener('ended', () => this.onEnded(duration));
    this.audio.addEventListener('error', (e) => {
      console.warn('Voice playback error:', e);
      toast('Failed to load audio');
      this.stop();
    });

    this.updatePlayState(true);
    this.audio.play().catch((err) => {
      console.warn('Audio play rejected:', err);
      this.updatePlayState(false);
    });
  },

  seek(msgId, url, duration, fraction) {
    if (this.currentMsgId !== msgId || !this.audio) {
      this.play(msgId, url, duration);
    }
    if (this.audio) {
      const dur = this.audio.duration || duration || 1;
      const targetTime = Math.max(0, Math.min(dur, fraction * dur));
      if (Number.isFinite(targetTime)) {
        this.audio.currentTime = targetTime;
        this.onTimeUpdate();
        if (this.audio.paused) {
          this.audio.play().catch(() => {});
        }
      }
    }
  },

  toggleSpeed() {
    const speeds = [1, 1.5, 2];
    const nextIdx = (speeds.indexOf(this.speed) + 1) % speeds.length;
    this.speed = speeds[nextIdx];
    if (this.audio) {
      this.audio.playbackRate = this.speed;
    }
    document.querySelectorAll('.voice-speed-pill').forEach((btn) => {
      btn.textContent = `${this.speed}x`;
    });
  },

  onTimeUpdate() {
    if (!this.audio || !this.currentMsgId) return;
    const bubble = document.querySelector(`.voice-bubble[data-voice-msg="${safeEscape(this.currentMsgId)}"]`);
    if (!bubble) return;
    const dur = this.audio.duration || Number(bubble.dataset.voiceDuration) || 0;
    const cur = this.audio.currentTime || 0;
    const pct = dur > 0 ? Math.min(1, cur / dur) : 0;

    const bars = bubble.querySelectorAll('.voice-bar');
    const activeCount = Math.round(pct * bars.length);
    bars.forEach((b, i) => {
      b.classList.toggle('active', i < activeCount);
    });

    const timeEl = bubble.querySelector('[data-voice-time]');
    if (timeEl) {
      timeEl.textContent = formatDuration(cur);
    }
  },

  onEnded(originalDuration) {
    this.updatePlayState(false);
    if (!this.currentMsgId) return;
    const bubble = document.querySelector(`.voice-bubble[data-voice-msg="${safeEscape(this.currentMsgId)}"]`);
    if (!bubble) return;
    const bars = bubble.querySelectorAll('.voice-bar');
    bars.forEach((b) => b.classList.remove('active'));
    const timeEl = bubble.querySelector('[data-voice-time]');
    if (timeEl) {
      timeEl.textContent = formatDuration(originalDuration || 0);
    }
  },

  updatePlayState(isPlaying) {
    if (!this.currentMsgId) return;
    const bubble = document.querySelector(`.voice-bubble[data-voice-msg="${safeEscape(this.currentMsgId)}"]`);
    if (!bubble) return;
    const playBtn = bubble.querySelector('.voice-play-btn');
    if (playBtn) {
      playBtn.innerHTML = `<svg class="icon"><use href="${isPlaying ? '#i-pause' : '#i-play'}"></use></svg>`;
      playBtn.setAttribute('aria-label', isPlaying ? 'Pause voice note' : 'Play voice note');
    }
  },

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    if (this.currentMsgId) {
      const bubble = document.querySelector(`.voice-bubble[data-voice-msg="${safeEscape(this.currentMsgId)}"]`);
      if (bubble) {
        const playBtn = bubble.querySelector('.voice-play-btn');
        if (playBtn) playBtn.innerHTML = `<svg class="icon"><use href="#i-play"></use></svg>`;
        const bars = bubble.querySelectorAll('.voice-bar');
        bars.forEach((b) => b.classList.remove('active'));
        const timeEl = bubble.querySelector('[data-voice-time]');
        if (timeEl) timeEl.textContent = formatDuration(bubble.dataset.voiceDuration || 0);
      }
      this.currentMsgId = null;
    }
  },

  syncCurrentUI() {
    if (!this.currentMsgId || !this.audio) return;
    this.updatePlayState(!this.audio.paused);
    this.onTimeUpdate();
    const bubble = document.querySelector(`.voice-bubble[data-voice-msg="${safeEscape(this.currentMsgId)}"]`);
    if (bubble) {
      const speedBtn = bubble.querySelector('.voice-speed-pill');
      if (speedBtn) speedBtn.textContent = `${this.speed}x`;
    }
  }
};

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
    darkPairCodeBar: $('#dark-pair-code-bar'),
    darkPairCodeInput: $('#dark-pair-code-input'),
    darkPairCodeSubmit: $('#dark-pair-code-submit'),
    blockedNotice: $('#blocked-chat-notice'),
    emojiPicker: $('#emoji-picker'),
    composer: $('#composer'),
    input: $('#composer-input'),
    attachBtn: $('#composer-attach'),
    attachInput: $('#attach-input'),
    voiceBtn: $('#composer-voice'),
    composerMain: $('#composer-main-content'),
    voiceRecBar: $('#voice-recording-bar'),
    voiceRecTimer: $('#voice-rec-timer'),
    voiceRecCanvas: $('#voice-rec-canvas'),
    voiceRecCancel: $('#voice-rec-cancel'),
    voiceRecStop: $('#voice-rec-stop'),
    voiceRecSend: $('#voice-rec-send'),
    voicePrevBar: $('#voice-preview-bar'),
    voicePrevPlay: $('#voice-preview-play'),
    voicePrevPlayIcon: $('#voice-preview-play-icon'),
    voicePrevScrubber: $('#voice-preview-scrubber'),
    voicePrevProgress: $('#voice-preview-progress'),
    voicePrevTime: $('#voice-preview-time'),
    voicePrevDelete: $('#voice-preview-delete'),
    voicePrevSend: $('#voice-preview-send'),
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

  // Voice recording & preview listeners
  els.voiceBtn?.addEventListener('click', () => {
    if (els.input?.value.trim()) {
      handleSend();
      return;
    }
    if (recording) stopVoiceRecording('preview');
    else startVoiceRecording();
  });
  els.voiceRecCancel?.addEventListener('click', cancelVoiceRecording);
  els.voiceRecStop?.addEventListener('click', () => stopVoiceRecording('preview'));
  els.voiceRecSend?.addEventListener('click', () => stopVoiceRecording('send'));

  els.voicePrevPlay?.addEventListener('click', togglePreviewPlayback);
  els.voicePrevScrubber?.addEventListener('click', seekPreviewAudio);
  els.voicePrevDelete?.addEventListener('click', deleteVoicePreview);
  els.voicePrevSend?.addEventListener('click', () => {
    if (recordedBlob) executeSendVoiceNote(recordedBlob, recordedDuration, recAmplitudes);
  });
  // Scroll-to-bottom control
  if (!document.getElementById('scroll-bottom-fab')) {
    const fab = document.createElement('button');
    fab.id = 'scroll-bottom-fab';
    fab.type = 'button';
    fab.className = 'scroll-bottom-fab hidden';
    fab.setAttribute('aria-label', 'Scroll to latest');
    fab.innerHTML = '↓';
    (els.messages?.parentElement || document.body).appendChild(fab);
    fab.addEventListener('click', () => scrollToEnd());
  }
  els.messages?.addEventListener('scroll', () => {
    const fab = document.getElementById('scroll-bottom-fab');
    if (!fab || !els.messages) return;
    const dist = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
    fab.classList.toggle('hidden', dist < 120);
  });
  els.darkPairCodeSubmit?.addEventListener('click', submitDarkPairCode);
  els.darkPairCodeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitDarkPairCode(); }
  });

  els.composer?.addEventListener('submit', (e) => { e.preventDefault(); handleSend(); });
  els.input?.addEventListener('input', onInput);
  els.input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && pref('enterToSend', true)) {
      e.preventDefault();
      handleSend();
    }
  });
  els.attachBtn?.addEventListener('click', () => els.attachInput.click());
  els.attachInput?.addEventListener('change', onAttachSelected);
  $('#composer-sticker')?.addEventListener('click', () => {
    openStickerPicker({
      onPick: async (sticker) => {
        // Send sticker immediately as a sticker message
        const conv = state.activeConv;
        if (!conv) return;
        attachment = {
          type: 'sticker',
          name: 'sticker',
          mime: sticker.mime || 'image/png',
          dataUrl: sticker.url, // may be remote URL — handleSend uploads if data URL else send url
          size: 0,
          duration: null,
          remoteUrl: sticker.url.startsWith('data:') ? null : sticker.url
        };
        showAttachmentPreview();
        await handleSend();
      }
    });
  });

  els.searchInput?.addEventListener('input', onSearchInput);

  els.messages?.addEventListener('scroll', onMessagesScroll);
  els.messages?.addEventListener('click', onMessagesClick);

  on('message:new', onIncomingMessage);
  on('messages:read', onMessagesRead);
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
  els.darkPairCodeBar?.classList.toggle('hidden', conv.other_user?.id !== 'u_dark_pair');
  updateBlockedChatState(conv);
  markRead(conv.id);

  // Instant UI: If messages already exist in memory for this chat, render them immediately
  const cachedMessages = state.messages[conv.id];
  if (Array.isArray(cachedMessages) && cachedMessages.length > 0) {
    renderMessages(true);
  } else {
    els.messages.innerHTML = `<div style="padding:20px">${emptyState({ iconName: 'message', title: 'Loading messages', subtitle: '' })}</div>`;
  }

  joinConversation(conv.id);

  try {
    // Parallelize message and call history requests
    const [res, callHistoryRes] = await Promise.all([
      api.messages(conv.id),
      api.callHistory(conv.id).catch(() => ({ calls: [] }))
    ]);

    const remoteMessages = res.messages || [];
    state.messages[conv.id] = remoteMessages;

    const calls = callHistoryRes.calls || [];
    if (calls.length) {
      const callLogs = calls.map((call) => ({
        id: `call_${call.id}`,
        conversation_id: conv.id,
        sender_id: call.initiator_id,
        created_at: call.ended_at || call.started_at,
        call_log: { kind: call.kind, state: call.state, started_at: call.started_at, ended_at: call.ended_at },
        display_name: conv.other_user?.display_name || conv.name || 'Call'
      }));
      const existing = new Set(state.messages[conv.id].map((message) => message.id));
      state.messages[conv.id].push(...callLogs.filter((message) => !existing.has(message.id)));
      state.messages[conv.id].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }

    markConversationRead(conv.id);
    state.hasMore[conv.id] = remoteMessages.length >= 50;
    renderMessages(true);
    startMessagePolling(conv.id);
  } catch (err) {
    if (!state.messages[conv.id] || !state.messages[conv.id].length) {
      els.messages.innerHTML = errorState({ title: 'Could not load messages', subtitle: err.message, retryId: 'retry-messages' });
      $('#retry-messages')?.addEventListener('click', () => openConversation(conv));
    }
  }
  setTimeout(() => els.input?.focus(), 80);
}

function updateBlockedChatState(conv) {
  const blockedByMe = Boolean(conv?.blocked_by_me);
  const blockedMe = Boolean(conv?.blocked_me);
  const blocked = blockedByMe || blockedMe;
  els.blockedNotice?.classList.toggle('hidden', !blocked);
  els.composer?.classList.toggle('hidden', blocked);
  els.composer?.setAttribute('data-state', blocked ? 'blocked' : 'open');
  els.blockedNotice?.classList.toggle('is-blocked', blocked);
  els.darkPairCodeBar?.classList.toggle('hidden', blocked || conv?.other_user?.id !== 'u_dark_pair');
  if (!els.blockedNotice || !blocked) { renderRestrictionState(); return; }
  if (blockedByMe) {
    const name = escapeHtml(conv.other_user?.display_name || 'this user');
    els.blockedNotice.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-ban"></use></svg><span>You blocked ${name}.</span><button class="btn btn-ghost btn-sm" id="unblock-chat-user">Unblock</button>`;
    els.blockedNotice.querySelector('#unblock-chat-user')?.addEventListener('click', async () => {
      try {
        await api.unblock(conv.other_user.id);
        conv.blocked_by_me = false;
        state.settings.blockedUserIds = (state.settings.blockedUserIds || []).filter((id) => id !== conv.other_user.id);
        updateBlockedChatState(conv);
        toast('User unblocked', 'success');
      } catch (err) { toast(err.message || 'Could not unblock'); }
    });
  } else {
    els.blockedNotice.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-ban"></use></svg><span>You are blocked from messaging this person</span>';
  }
  renderRestrictionState();
}

function submitDarkPairCode() {
  const code = els.darkPairCodeInput?.value.trim() || '';
  if (!/^\d{6}$/.test(code)) {
    toast('Enter the six-digit Dark code');
    return;
  }
  els.input.value = code;
  els.darkPairCodeInput.value = '';
  handleSend();
}

export function closeConversation() {
  clearInterval(messagePollTimer);
  messagePollTimer = null;
  state.activeConv = null;
  els.screen.hidden = true;
  document.querySelectorAll('.screen-list').forEach((s) => s.classList.remove('chat-open'));
  clearTyping();
  stopTypingSignal();
  state.searchOpen = false;
  els.searchBar?.classList.add('hidden');
  if (recording) cancelVoiceRecording();
  stopPreviewAudio();
  VoiceAudioManager.stop();
  resetComposerToMain();
}

function renderHeader() {
  const conv = state.activeConv;
  if (!conv) return;
  const user = conversationAvatarUser(conv);
  els.chatAvatar.outerHTML = avatar(user, { size: 'sm', id: 'chat-avatar' });
  els.chatAvatar = $('#chat-avatar');
  els.title.innerHTML = `${escapeHtml(conversationTitle(conv))} ${verifyBadge(conversationIsVerified(conv))}`;
  if (conv.is_locked) els.title.innerHTML = `${icon('lock')} ${els.title.innerHTML}`;
  renderPresenceState();
  // channels: only owners/admins can post
  const role = conv.role || conv.members?.[state.me?.id]?.role;
  const canPost = conv.type !== 'channel' || ['owner', 'admin'].includes(role);
  els.input.disabled = !canPost;
  els.input.placeholder = canPost ? 'Message' : 'Only admins can post in this channel';
  if (els.voiceBtn) els.voiceBtn.disabled = !canPost;
  renderRestrictionState();
}

function renderRestrictionState() {
  const conv = state.activeConv;
  if (!conv || !els.input || !els.blockedNotice) return;
  const role = conv.role || conv.members?.[state.me?.id]?.role;
  const lockedForMe = conv.is_locked && (conv.type === 'channel' || !['owner', 'admin'].includes(role));
  if (lockedForMe) {
    els.input.disabled = true;
    if (els.voiceBtn) els.voiceBtn.disabled = true;
    els.input.placeholder = conv.type === 'channel' ? 'This channel is currently paused' : 'Group is locked — only admins can send messages';
    [els.attachBtn, els.voiceBtn].forEach((button) => { if (button) button.disabled = true; });
    if (!els.blockedNotice.textContent.includes('blocked')) {
      els.blockedNotice.innerHTML = `<span>${conv.type === 'channel' ? 'This channel is currently paused by the owner.' : 'This group is locked. Only admins can send messages and manage the group.'}</span>`;
      els.blockedNotice.classList.remove('hidden');
    }
  } else {
    [els.attachBtn, els.voiceBtn].forEach((button) => { if (button) button.disabled = false; });
    if (!els.blockedNotice.textContent.includes('blocked')) els.blockedNotice.classList.add('hidden');
  }
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
  updateComposerActionState();
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

function onMessagesRead(payload) {
  if (!payload?.conversationId) return;
  const ids = new Set(payload.messageIds || []);
  (state.messages[payload.conversationId] || []).forEach((msg) => {
    if (ids.has(msg.id)) msg.read_at = payload.readAt;
  });
  if (state.activeConv?.id === payload.conversationId) renderMessages(false);
}

// ---------------- messages ----------------
function messageMediaUrl(msg) {
  const url = msg.media_url || msg.media_data;
  if (typeof url !== 'string' || !url) return null;
  // Absolute http(s), data URLs, and relative /api/storage paths (made absolute via mediaSrc)
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/') || /^https?:\/\//i.test(url)) {
    return mediaSrc(url);
  }
  return null;
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}

function getWaveformBars(msg, barCount = 28) {
  if (Array.isArray(msg.waveform) && msg.waveform.length >= 8) {
    const raw = msg.waveform;
    const bars = [];
    for (let i = 0; i < barCount; i++) {
      const idx = Math.floor((i / barCount) * raw.length);
      const val = Math.max(0.14, Math.min(1, Number(raw[idx]) || 0.2));
      bars.push(Math.round(val * 24));
    }
    return bars;
  }
  const seedStr = String(msg.id || 'voice');
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) hash = (hash * 31 + seedStr.charCodeAt(i)) >>> 0;
  const bars = [];
  for (let i = 0; i < barCount; i++) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const norm = (hash % 100) / 100;
    const height = Math.round(5 + norm * 19);
    bars.push(height);
  }
  return bars;
}

function voicePlayerHtml(msg) {
  const url = messageMediaUrl(msg);
  const own = msg.sender_id === state.me?.id;
  const duration = Number(msg.media_duration) || 0;
  const bars = getWaveformBars(msg, 28);
  const barsHtml = bars.map((h, i) => `<span class="voice-bar" data-bar="${i}" style="height:${h}px"></span>`).join('');
  const durationText = formatDuration(duration);
  const isPlaying = VoiceAudioManager.currentMsgId === msg.id && VoiceAudioManager.audio && !VoiceAudioManager.audio.paused;

  return `<div class="voice-bubble ${own ? 'own' : ''}" data-voice-msg="${escapeHtml(msg.id)}" data-voice-url="${escapeHtml(url)}" data-voice-duration="${duration}">
    <button type="button" class="voice-play-btn" data-action="voice-play" aria-label="${isPlaying ? 'Pause voice note' : 'Play voice note'}">
      <svg class="icon"><use href="${isPlaying ? '#i-pause' : '#i-play'}"></use></svg>
    </button>
    <div class="voice-player-main">
      <div class="voice-waveform" data-action="voice-seek" role="progressbar" aria-label="Audio scrubber" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
        ${barsHtml}
      </div>
      <div class="voice-player-meta">
        <span class="voice-duration" data-voice-time>${durationText}</span>
        <button type="button" class="voice-speed-pill" data-action="voice-speed" aria-label="Playback speed">${VoiceAudioManager.speed || 1}x</button>
      </div>
    </div>
  </div>`;
}

function mediaHtml(msg) {
  const url = messageMediaUrl(msg);
  const type = msg.media_type;
  if (!type || !url) return '';
  if (type === 'sticker') {
    const isVideo = (msg.media_mime || '').startsWith('video/');
    const media = isVideo
      ? `<video class="sticker-media" src="${escapeHtml(url)}" autoplay loop muted playsinline></video>`
      : `<img class="sticker-media" src="${escapeHtml(url)}" alt="Sticker" loading="lazy">`;
    return `<div class="sticker-bubble" data-save-sticker="${escapeHtml(msg.id || '')}" data-sticker-url="${escapeHtml(url)}" data-sticker-mime="${escapeHtml(msg.media_mime || '')}" data-sticker-type="${isVideo ? 'video' : 'image'}">${media}</div>`;
  }
  if (type === 'image') {
    return `<div class="media"><img src="${escapeHtml(url)}" alt="Photo" loading="lazy" data-open-media="${escapeHtml(url)}" onerror="this.closest('.media').style.display='none'"></div>`;
  }
  if (type === 'video') {
    return `<div class="media"><video src="${escapeHtml(url)}" controls playsinline preload="metadata" style="max-width:100%;border-radius:12px;background:#000" onerror="this.closest('.media').style.display='none'"></video></div>`;
  }
  if (type === 'voice' || type === 'audio') {
    return voicePlayerHtml(msg);
  }
  const name = msg.media_name || (msg.media_mime ? msg.media_mime.split('/')[1] : 'file');
  return `<div class="media-file">${icon('file')}<span class="file-name truncate">${escapeHtml(name)}</span>
    <a class="icon-btn" href="${escapeHtml(url)}" download="${escapeHtml(name)}" aria-label="Download file" target="_blank" rel="noopener">${icon('download')}</a></div>`;
}

function replyQuoteHtml(msg) {
  const status = msg.status_reply;
  const statusMedia = status?.media_url
    ? (status.media_type === 'video'
      ? `<video class="status-reply-media" src="${escapeHtml(mediaSrc(status.media_url))}" muted playsinline preload="metadata"></video>`
      : `<img class="status-reply-media" src="${escapeHtml(mediaSrc(status.media_url))}" alt="Replied status">`)
    : '';
  const statusQuote = status ? `<div class="status-reply-quote"><span class="who">Replying to ${escapeHtml(status.author || 'status')}</span>${statusMedia}<div class="status-reply-text">${escapeHtml(status.content || 'Status post')}</div></div>` : '';
  if (!msg.reply_to_id) return statusQuote;
  const list = state.messages[msg.conversation_id] || [];
  const target = list.find((m) => m.id === msg.reply_to_id);
  if (!target) return `${statusQuote}<div class="reply-quote"><span class="who">Reply</span> · message unavailable</div>`;
  const who = target.sender_id === state.me?.id ? 'You' : (target.display_name || 'User');
  const text = target.deleted_for_everyone
    ? 'This message was deleted'
    : (target.content || (target.media_type === 'voice' ? `🎤 Voice note (${formatDuration(target.media_duration || 0)})` : (target.media_type ? 'Attachment' : '')));
  return `${statusQuote}<div class="reply-quote"><span class="who">${escapeHtml(who)}</span><div class="truncate">${escapeHtml(text)}</div></div>`;
}

function reactionsHtml(msg) {
  const reactions = Array.isArray(msg.reactions) ? msg.reactions : [];
  const counts = new Map();
  for (const r of reactions) {
    const key = r.reaction;
    if (!counts.has(key)) counts.set(key, { count: 0, mine: false });
    const entry = counts.get(key);
    entry.count += 1;
    if (r.user_id === state.me?.id) entry.mine = true;
  }
  const chips = [...counts.entries()].map(([emoji, info]) =>
    `<button type="button" class="reaction ${info.mine ? 'mine' : ''}" data-react="${escapeHtml(emoji)}" data-react-msg="${escapeHtml(msg.id)}">${escapeHtml(emoji)} ${info.count}</button>`
  ).join('');
  return chips ? `<div class="reactions">${chips}</div>` : '';
}

function metaHtml(msg) {
  if (msg._status === 'failed') {
    return `<div class="meta"><span class="failed">Failed</span> · <button class="retry" data-retry="${escapeHtml(msg.id)}">Retry</button></div>`;
  }
  const edited = msg.edited_at ? '<span class="edited">edited</span>' : '';
  const ticking = msg._status === 'sending'
    ? `<span class="sending" title="Sending" aria-label="Sending">${icon('send')}</span>`
    : msg.read_at ? `<span class="seen read" title="Read" aria-label="Read">${icon('check-check')}</span>` : `<span class="sent" title="Sent" aria-label="Sent">${icon('check')}</span>`;
  const pin = msg.pinned_at ? `<span class="pin-flag" title="Pinned">${icon('pin')}</span>` : '';
  return `<div class="meta">${edited}${pin}<span>${escapeHtml(formatTime(msg.created_at))}</span>${msg.sender_id === state.me?.id ? ticking : ''}</div>`;
}

function messageHtml(msg, index, list) {
  if (msg.call_log) {
    const ownCall = msg.sender_id === state.me?.id;
    const log = msg.call_log;
    const seconds = log.ended_at && log.started_at ? Math.max(0, Math.round((new Date(log.ended_at) - new Date(log.started_at)) / 1000)) : 0;
    const duration = seconds ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : '';
    const label = log.state === 'missed' ? 'Missed call' : log.state === 'declined' ? 'Declined call' : log.state === 'busy' ? 'Busy' : log.state === 'ringing' ? 'Ongoing call' : 'Call ended';
    const cls = ['message', 'call-log', ownCall ? 'own' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-msg="${escapeHtml(msg.id)}"><div class="bubble call-bubble">${icon(log.state === 'missed' ? 'phone-off' : 'phone')}<span>${label}${duration ? ` · ${duration}` : ''}</span></div><div class="meta">${escapeHtml(formatTime(msg.created_at))}</div></div>`;
  }
  const own = msg.sender_id === state.me?.id;
  const prev = list[index - 1];
  const grouped = prev && prev.sender_id === msg.sender_id && dayLabel(prev.created_at) === dayLabel(msg.created_at);
  const deleted = msg.deleted_for_everyone;
  const sender = !own && !grouped ? `<span class="sender" style="color:${escapeHtml(msg.avatar_color || '#3da9ff')}">${escapeHtml(msg.display_name || 'User')} ${verifyBadge(msg.is_verified)}</span>` : '';
  const bubbleClass = ['bubble'];
  if (deleted) bubbleClass.push('deleted');
  const inner = deleted
    ? `<span class="text">${icon('alert')} This message was deleted</span>`
    : `${sender}${replyQuoteHtml(msg)}${mediaHtml(msg)}${msg.content ? `<span class="text">${linkify(msg.content)}</span>` : ''}`;
  const cls = ['message'];
  if (own) cls.push('own');
  if (grouped) cls.push('grouped');
  return `<div class="${cls.join(' ')}" data-msg="${escapeHtml(msg.id)}">
    <div class="${bubbleClass.join(' ')}" data-bubble="${escapeHtml(msg.id)}">${inner}</div>
    ${deleted ? '' : reactionsHtml(msg)}
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
  els.messages.querySelectorAll('[data-save-sticker]').forEach((node) => {
    node.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      try {
        await saveSentStickerToPack({
          url: node.dataset.stickerUrl,
          mime: node.dataset.stickerMime,
          type: node.dataset.stickerType
        });
      } catch (err) {
        toast(err.message || 'Could not save sticker');
      }
    });
    node.title = 'Long-press / right-click to save to a pack';
  });
  renderPinned(list);
  VoiceAudioManager.syncCurrentUI();
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

function startMessagePolling(conversationId) {
  clearInterval(messagePollTimer);
  const poll = async () => {
    if (!state.activeConv || state.activeConv.id !== conversationId) return;
    try {
      const res = await api.messages(conversationId);
      const remote = res.messages || [];
      const remoteIds = new Set(remote.map((m) => m.id));
      const local = state.messages[conversationId] || [];
      const keepAfter = Date.now() - 5 * 60 * 1000;
      const unsynced = local.filter((m) => !remoteIds.has(m.id) && new Date(m.created_at).getTime() >= keepAfter);
      const previousKey = local.map((m) => `${m.id}:${m.read_at || ''}`).join('|');
      state.messages[conversationId] = [...remote, ...unsynced]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const nextKey = state.messages[conversationId].map((m) => `${m.id}:${m.read_at || ''}`).join('|');
      if (previousKey !== nextKey) {
        renderMessages(false);
        if (document.visibilityState === 'visible') {
          markRead(conversationId);
          markConversationRead(conversationId);
        }
      }
    } catch {
      // Retry quietly on the next tick while Socket.IO remains the primary path.
    }
  };
  // Gentle fallback sync: Socket.IO handles instant updates; this verifies consistency without hammering the network.
  messagePollTimer = setInterval(poll, state.socketReady ? 20000 : 8000);
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
  const isDuplicate = idx > -1;
  const pendingIdx = !isDuplicate ? list.findIndex((m) => m._status === 'sending' &&
    m.sender_id === msg.sender_id && m.content === msg.content &&
    Math.abs(new Date(m.created_at).getTime() - new Date(msg.created_at).getTime()) < 5000) : -1;
  if (pendingIdx > -1) list.splice(pendingIdx, 1);
  if (isDuplicate) list[idx] = { ...list[idx], ...msg, _status: 'sent' };
  else list.push({ ...msg, _status: 'sent' });

  // refresh conversation preview
  let conv = state.conversations.find((c) => c.id === convId);
  if (conv) {
    conv.last_message = msg.content || (msg.media_type ? 'Attachment' : '');
    conv.last_message_at = msg.created_at;
    conv.last_sender_id = msg.sender_id;
    // Optional: pull archived chat back when a new message arrives
    if (conv.archived && pref('unarchiveOnNewMessage', true) && String(msg.sender_id) !== String(state.me?.id)) {
      conv.archived = false;
      api.updateConversation(convId, { archived: false }).catch(() => {});
    }
  }

  const isCurrentActive = state.activeConv && state.activeConv.id === convId;

  if (isCurrentActive) {
    const atBottom = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 120;
    renderMessages(false);
    if (atBottom || msg.sender_id === state.me?.id) scrollToEnd();
    if (document.visibilityState === 'visible') {
      markRead(convId);
      markConversationRead(convId);
    } else if (!isDuplicate && String(msg.sender_id) !== String(state.me?.id)) {
      bumpUnread(convId);
    }
  } else {
    if (!isDuplicate && String(msg.sender_id) !== String(state.me?.id)) {
      bumpUnread(convId);
    }
  }

  if (conv) {
    emit('conversations:changed');
  } else {
    api.conversations().then((res) => {
      state.conversations = res.conversations || [];
      if (!isDuplicate && String(msg.sender_id) !== String(state.me?.id)) {
        bumpUnread(convId);
      }
      emit('conversations:changed');
    }).catch(() => {});
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
  updateComposerActionState();
}

function updateComposerActionState() {
  const button = els.voiceBtn;
  if (!button || !els.input) return;
  const hasText = Boolean(els.input.value.trim());
  button.classList.toggle('armed', hasText);
  button.setAttribute('aria-label', hasText ? 'Send message' : 'Record voice note');
  button.setAttribute('title', hasText ? 'Send message' : 'Record voice note');
  button.innerHTML = hasText ? icon('send') : icon('mic');
}

const CUSTOM_EMOJIS = {
  Faces: ['😀','😂','😍','🥰','😎','😭','😡','🤔','😴','🤯','🥳','🤍'],
  Hands: ['👍','👎','👏','🙏','✌️','🤝','💪','👋','🙌','👌','🤞','🫶'],
  Symbols: ['❤️','🔥','✨','💯','✅','❌','⭐','⚡','💔','🎉','💎','☠️'],
  Animals: ['🐶','🐱','🦊','🐻','🐼','🐸','🐵','🦁','🐯','🐨','🐰','🦄']
};

function toggleEmojiPicker() {
  if (!els.emojiPicker) return;
  if (!els.emojiPicker.innerHTML) {
    els.emojiPicker.innerHTML = Object.entries(CUSTOM_EMOJIS).map(([name, values]) => `
      <div class="emoji-section"><div class="emoji-section-title">${name}</div>
      <div class="emoji-grid">${values.map((value) => `<button type="button" class="emoji-choice" data-emoji="${value}" aria-label="${value}">${value}</button>`).join('')}</div></div>`).join('');
    els.emojiPicker.querySelectorAll('[data-emoji]').forEach((button) => button.addEventListener('click', () => {
      insertText(button.dataset.emoji);
      els.emojiPicker.classList.add('hidden');
    }));
  }
  els.emojiPicker.classList.toggle('hidden');
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
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) { toast('File is too large (max 50MB)'); els.attachInput.value = ''; return; }
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
  if (type === 'image' || type === 'sticker') thumb = `<img src="${escapeHtml(dataUrl)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:10px">`;
  else if (type === 'video') thumb = `<video src="${escapeHtml(dataUrl)}" muted style="width:48px;height:48px;object-fit:cover;border-radius:10px"></video>`;
  else thumb = `<span class="option-icon">${icon(type === 'audio' ? 'music' : 'file')}</span>`;
  els.attachPreviewInner.innerHTML = `${thumb}<span class="name truncate">${escapeHtml(name)} · ${escapeHtml(humanSize(size))}</span>`;
  els.attachPreview.classList.remove('hidden');
  els.attachProgress.querySelector('span').style.width = '0%';
}

async function handleSend() {
  const conv = state.activeConv;
  if (!conv) return;
  if (conv.blocked_by_me || conv.blocked_me) return;
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
    media_duration: currentAttachment?.duration || null,
    waveform: currentAttachment?.waveform || null,
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
  updateComposerActionState();
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

  // A sender receives both the realtime event and the acknowledgement. Keep one canonical copy.
  const samePending = list.find((m) => m._status === 'sending' && m !== temp &&
    m.sender_id === temp.sender_id && m.content === temp.content &&
    Math.abs(new Date(m.created_at).getTime() - new Date(temp.created_at).getTime()) < 5000);
  if (samePending) list.splice(list.indexOf(samePending), 1);

  let mediaData = null;
  if (temp._attachment) {
    try {
      if (temp._attachment.remoteUrl) {
        mediaData = {
          type: temp._attachment.type,
          url: temp._attachment.remoteUrl,
          mime: temp._attachment.mime,
          duration: temp._attachment.duration,
          waveform: temp._attachment.waveform
        };
      } else {
        const uploaded = await uploadAttachment(temp._attachment, (pct) => {
          if (els.attachProgress?.querySelector('span')) {
            els.attachProgress.querySelector('span').style.width = `${pct}%`;
          }
        });
        mediaData = {
          type: temp._attachment.type,
          url: uploaded.url,
          mime: uploaded.mimeType || temp._attachment.mime,
          duration: temp._attachment.duration,
          waveform: temp._attachment.waveform
        };
      }
    } catch (err) {
      temp._status = 'failed';
      update();
      toast('Upload failed - tap retry on the message');
      return;
    }
  }

  let ack = await socketSend({
    conversationId: convId,
    content: temp._content || null,
    media: mediaData,
    replyToId: temp._reply?.id || null,
    clientMessageId: temp.id
  });

  if (!ack || ack.error) {
    try {
      const fallback = await api.sendMessage(convId, {
        clientMessageId: temp.id,
        content: temp._content || null,
        media: mediaData,
        mediaUrl: mediaData?.url || null,
        mediaMime: mediaData?.mime || null,
        mediaType: mediaData?.type || null,
        mediaDuration: mediaData?.duration || null,
        waveform: mediaData?.waveform || null,
        replyToId: temp._reply?.id || null
      });
      ack = { ok: true, message: fallback.message, assistantMessage: fallback.assistantMessage };
    } catch {
      // Keep the optimistic bubble marked failed for retry.
    }
  }

  const i = list.findIndex((m) => m.id === temp.id);
  if (i > -1) list.splice(i, 1);

  if (ack && ack.ok && ack.message) {
    const real = { ...ack.message, _status: 'sent' };
    const exists = list.findIndex((m) => m.id === real.id);
    if (exists > -1) list[exists] = { ...list[exists], ...real };
    else list.push(real);
    if (ack.assistantMessage && !list.some((m) => m.id === ack.assistantMessage.id)) {
      list.push({ ...ack.assistantMessage, _status: 'sent' });
    }
    if (/^\.(block|unblock)\b/i.test(String(temp._content || '').trim())) {
      try {
        const refreshed = await api.conversations();
        const latest = (refreshed.conversations || []).find((item) => item.id === convId);
        if (latest && state.activeConv?.id === convId) {
          Object.assign(conv, latest);
          updateBlockedChatState(conv);
        }
        state.conversations = refreshed.conversations || state.conversations;
        emit('conversations:changed');
      } catch { /* the server still enforces the block if refresh is delayed */ }
    }
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
    xhr.open('POST', (typeof apiBase === 'function' ? apiBase() : '/api') + '/storage/upload');
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (state.token) xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          if (!result?.url) return reject(new Error('Upload completed without a usable file URL'));
          resolve(result);
        } catch { reject(new Error('Upload returned an invalid response')); }
      } else {
        let message = 'Upload failed';
        try { message = JSON.parse(xhr.responseText)?.error || message; } catch { /* fallback */ }
        reject(new Error(message));
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
  msg._attachment = msg.media_data ? { type: msg.media_type, dataUrl: msg.media_data, mime: msg.media_mime, name: msg.media_name, duration: msg.media_duration, waveform: msg.waveform } : null;
  msg._reply = null;
  renderMessages(true);
  await deliverTemp(conv.id, msg);
}

// ---------------- message actions ----------------
function onMessagesClick(event) {
  // Voice note play/pause control
  const voicePlay = event.target.closest('[data-action="voice-play"]');
  if (voicePlay) {
    event.stopPropagation();
    const bubble = voicePlay.closest('.voice-bubble');
    if (bubble) {
      const msgId = bubble.getAttribute('data-voice-msg');
      const url = bubble.getAttribute('data-voice-url');
      const dur = Number(bubble.getAttribute('data-voice-duration')) || 0;
      VoiceAudioManager.play(msgId, url, dur);
    }
    return;
  }

  // Voice note scrubber seek control
  const voiceSeek = event.target.closest('[data-action="voice-seek"]');
  if (voiceSeek) {
    event.stopPropagation();
    const bubble = voiceSeek.closest('.voice-bubble');
    if (bubble) {
      const msgId = bubble.getAttribute('data-voice-msg');
      const url = bubble.getAttribute('data-voice-url');
      const dur = Number(bubble.getAttribute('data-voice-duration')) || 0;
      const rect = voiceSeek.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / (rect.width || 1)));
      VoiceAudioManager.seek(msgId, url, dur, fraction);
    }
    return;
  }

  // Voice note speed toggle
  const voiceSpeed = event.target.closest('[data-action="voice-speed"]');
  if (voiceSpeed) {
    event.stopPropagation();
    VoiceAudioManager.toggleSpeed();
    return;
  }

  const media = event.target.closest('[data-open-media]');
  if (media) {
    openLightbox(media.getAttribute('data-open-media'));
    return;
  }

  const textNode = event.target.closest('.message .text');
  if (textNode && event.type === 'contextmenu') {
    event.preventDefault();
    const text = textNode.textContent || '';
    if (text && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Copied', 'success')).catch(() => {});
    }
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
      sheet.querySelectorAll('[data-quick]').forEach((btn) => btn.addEventListener('click', async () => {
        closeSheet();
        await toggleReaction(msg.id, btn.dataset.quick);
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
  const previousReactions = Array.isArray(msg.reactions) ? [...msg.reactions] : [];
  const reactions = [...previousReactions];
  const idx = reactions.findIndex((r) => String(r.user_id) === String(state.me?.id) && r.reaction === reaction);
  if (idx > -1) reactions.splice(idx, 1);
  else reactions.push({ user_id: state.me?.id, reaction });
  msg.reactions = reactions;
  renderMessages(false);
  try {
    const res = await api.react(conv.id, messageId, reaction);
    if (Array.isArray(res.entries)) msg.reactions = res.entries;
    renderMessages(false);
  } catch (err) {
    msg.reactions = previousReactions;
    renderMessages(false);
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
            <span class="option-copy"><b>${escapeHtml(m.display_name)} ${verifyBadge(m.is_verified)}</b><small class="truncate">${escapeHtml(m.content)}</small></span>
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
function resetComposerToMain() {
  if (els.composerMain) els.composerMain.classList.remove('hidden');
  if (els.voiceRecBar) els.voiceRecBar.classList.add('hidden');
  if (els.voicePrevBar) els.voicePrevBar.classList.add('hidden');
  if (els.composer) els.composer.classList.remove('recording');
}

async function startVoiceRecording() {
  if (recording) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Voice recording is not supported on this device/browser');
    return;
  }

  // Stop any active playback in chat or preview
  VoiceAudioManager.stop();
  stopPreviewAudio();

  try {
    recStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  } catch (err) {
    console.warn('Microphone access failed:', err);
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      toast('Microphone permission denied. Enable microphone access in settings.');
    } else {
      toast('Could not access microphone: ' + (err.message || 'Unknown error'));
    }
    return;
  }

  // Pick best supported MIME
  let selectedMime = '';
  const supportedMimes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/aac'
  ];
  for (const m of supportedMimes) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) {
      selectedMime = m;
      break;
    }
  }

  try {
    mediaRecorder = new MediaRecorder(recStream, selectedMime ? { mimeType: selectedMime } : {});
  } catch (mrErr) {
    try {
      mediaRecorder = new MediaRecorder(recStream);
    } catch (e) {
      toast('Voice recording initialization failed');
      recStream.getTracks().forEach((t) => t.stop());
      return;
    }
  }

  recChunks = [];
  recAmplitudes = [];
  recordedBlob = null;
  recordedDuration = 0;
  recordingStopAction = 'preview';

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recChunks.push(e.data);
    }
  };

  mediaRecorder.onstop = async () => {
    if (recStream) {
      recStream.getTracks().forEach((t) => t.stop());
      recStream = null;
    }
    cleanupAudioAnalyser();

    if (recordingStopAction === 'cancel') {
      recChunks = [];
      recAmplitudes = [];
      recordedBlob = null;
      recordedDuration = 0;
      resetComposerToMain();
      toast('Recording cancelled');
      return;
    }

    const duration = Math.max(1, Math.round((Date.now() - recStartTime) / 1000));
    recordedDuration = duration;
    const finalMime = mediaRecorder.mimeType || selectedMime || 'audio/webm';
    recordedBlob = new Blob(recChunks, { type: finalMime });

    if (recordingStopAction === 'send') {
      executeSendVoiceNote(recordedBlob, recordedDuration, recAmplitudes);
    } else {
      showVoicePreviewBar(recordedBlob, recordedDuration);
    }
  };

  setupLiveWaveformAnalyser(recStream);

  recStartTime = Date.now();
  recording = true;
  mediaRecorder.start(100);

  if (els.composerMain) els.composerMain.classList.add('hidden');
  if (els.voiceRecBar) els.voiceRecBar.classList.remove('hidden');
  if (els.voicePrevBar) els.voicePrevBar.classList.add('hidden');
  if (els.composer) els.composer.classList.add('recording');

  if (els.voiceRecTimer) els.voiceRecTimer.textContent = '0:00';
  clearInterval(recTimerId);
  recTimerId = setInterval(() => {
    if (!recording) return;
    const elapsed = Math.floor((Date.now() - recStartTime) / 1000);
    if (els.voiceRecTimer) els.voiceRecTimer.textContent = formatDuration(elapsed);
  }, 200);
}

function setupLiveWaveformAnalyser(stream) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    recAudioCtx = new AudioContextClass();
    if (recAudioCtx.state === 'suspended') {
      recAudioCtx.resume().catch(() => {});
    }
    const source = recAudioCtx.createMediaStreamSource(stream);
    recAnalyser = recAudioCtx.createAnalyser();
    recAnalyser.fftSize = 64;
    recAnalyser.smoothingTimeConstant = 0.6;
    source.connect(recAnalyser);

    drawLiveWaveform();
  } catch (err) {
    console.warn('Live waveform analyser error:', err);
  }
}

function cleanupAudioAnalyser() {
  if (recAnimId) {
    cancelAnimationFrame(recAnimId);
    recAnimId = null;
  }
  clearInterval(recTimerId);
  recTimerId = null;
  if (recAudioCtx) {
    try { recAudioCtx.close(); } catch {}
    recAudioCtx = null;
  }
  recAnalyser = null;
}

let lastAmpSample = 0;
function drawLiveWaveform() {
  if (!recording || !recAnalyser || !els.voiceRecCanvas) return;
  const canvas = els.voiceRecCanvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bufferLength = recAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  recAnalyser.getByteFrequencyData(dataArray);

  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    sum += dataArray[i];
  }
  const avg = sum / (bufferLength || 1);
  const normalized = Math.max(0.14, Math.min(1, avg / 128));

  const now = Date.now();
  if (now - lastAmpSample > 120) {
    recAmplitudes.push(Number(normalized.toFixed(2)));
    if (recAmplitudes.length > 80) recAmplitudes.shift();
    lastAmpSample = now;
  }

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const barCount = 24;
  const barWidth = 3;
  const gap = (w - (barCount * barWidth)) / (barCount - 1);
  const centerY = h / 2;

  for (let i = 0; i < barCount; i++) {
    const dataIdx = Math.floor((i / barCount) * bufferLength);
    const val = (dataArray[dataIdx] || 0) / 255;
    const wave = Math.sin((i / barCount) * Math.PI) * 0.2;
    const barHeight = Math.max(4, Math.min(h - 4, (val * 0.8 + wave + normalized * 0.2) * (h - 6)));

    const x = i * (barWidth + gap);
    const y = centerY - barHeight / 2;

    ctx.fillStyle = '#3a9bfc';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, barWidth, barHeight, 2);
    } else {
      ctx.rect(x, y, barWidth, barHeight);
    }
    ctx.fill();
  }

  recAnimId = requestAnimationFrame(drawLiveWaveform);
}

function stopVoiceRecording(action = 'preview') {
  if (!recording || !mediaRecorder) return;
  recordingStopAction = action;
  recording = false;
  clearInterval(recTimerId);
  if (mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function cancelVoiceRecording() {
  if (!recording) {
    resetComposerToMain();
    return;
  }
  stopVoiceRecording('cancel');
}

function showVoicePreviewBar(blob, duration) {
  stopPreviewAudio();
  if (els.composerMain) els.composerMain.classList.add('hidden');
  if (els.voiceRecBar) els.voiceRecBar.classList.add('hidden');
  if (els.voicePrevBar) els.voicePrevBar.classList.remove('hidden');
  if (els.composer) els.composer.classList.remove('recording');

  if (els.voicePrevProgress) els.voicePrevProgress.style.width = '0%';
  if (els.voicePrevTime) els.voicePrevTime.textContent = formatDuration(duration);
  if (els.voicePrevPlayIcon) els.voicePrevPlayIcon.innerHTML = `<use href="#i-play"></use>`;
  if (els.voicePrevScrubber) {
    els.voicePrevScrubber.setAttribute('aria-valuenow', '0');
  }

  const url = URL.createObjectURL(blob);
  previewAudio = new Audio(url);
  previewAudio.preload = 'metadata';

  previewAudio.addEventListener('timeupdate', () => {
    if (!previewAudio) return;
    const cur = previewAudio.currentTime || 0;
    const total = previewAudio.duration || duration || 1;
    const pct = Math.min(100, Math.max(0, (cur / total) * 100));
    if (els.voicePrevProgress) els.voicePrevProgress.style.width = `${pct}%`;
    if (els.voicePrevScrubber) els.voicePrevScrubber.setAttribute('aria-valuenow', String(Math.round(pct)));
    if (els.voicePrevTime) els.voicePrevTime.textContent = formatDuration(cur);
  });

  previewAudio.addEventListener('ended', () => {
    if (els.voicePrevPlayIcon) els.voicePrevPlayIcon.innerHTML = `<use href="#i-play"></use>`;
    if (els.voicePrevProgress) els.voicePrevProgress.style.width = '0%';
    if (els.voicePrevTime) els.voicePrevTime.textContent = formatDuration(duration);
  });

  previewAudio.addEventListener('pause', () => {
    if (els.voicePrevPlayIcon) els.voicePrevPlayIcon.innerHTML = `<use href="#i-play"></use>`;
  });

  previewAudio.addEventListener('play', () => {
    if (els.voicePrevPlayIcon) els.voicePrevPlayIcon.innerHTML = `<use href="#i-pause"></use>`;
  });
}

function togglePreviewPlayback() {
  if (!previewAudio) return;
  if (previewAudio.paused) {
    VoiceAudioManager.stop();
    previewAudio.play().catch(() => toast('Playback error'));
  } else {
    previewAudio.pause();
  }
}

function seekPreviewAudio(e) {
  if (!previewAudio || !els.voicePrevScrubber) return;
  const rect = els.voicePrevScrubber.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
  const total = previewAudio.duration || recordedDuration || 1;
  previewAudio.currentTime = fraction * total;
  if (els.voicePrevProgress) els.voicePrevProgress.style.width = `${fraction * 100}%`;
  if (previewAudio.paused) {
    previewAudio.play().catch(() => {});
  }
}

function stopPreviewAudio() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.src = '';
    previewAudio = null;
  }
}

function deleteVoicePreview() {
  stopPreviewAudio();
  recordedBlob = null;
  recordedDuration = 0;
  recAmplitudes = [];
  resetComposerToMain();
}

async function executeSendVoiceNote(blob, duration, amplitudes) {
  if (!blob) return;
  const conv = state.activeConv;
  if (!conv) return;

  stopPreviewAudio();
  resetComposerToMain();

  const sec = Math.max(1, duration || 1);
  const dataUrl = await fileToDataUrl(blob);
  const ext = (blob.type || '').includes('mp4') ? 'm4a' : (blob.type || '').includes('ogg') ? 'ogg' : 'webm';
  const name = `voice_${Date.now()}.${ext}`;

  // Build clean 28-bar normalized waveform data
  let waveform = [];
  if (Array.isArray(amplitudes) && amplitudes.length >= 4) {
    const barCount = 28;
    for (let i = 0; i < barCount; i++) {
      const idx = Math.floor((i / barCount) * amplitudes.length);
      waveform.push(Math.max(0.14, Math.min(1, Number(amplitudes[idx]) || 0.2)));
    }
  } else {
    const barCount = 28;
    let seed = Date.now();
    for (let i = 0; i < barCount; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      waveform.push(Number((0.2 + ((seed % 80) / 100)).toFixed(2)));
    }
  }

  const voiceAttachment = {
    type: 'voice',
    name,
    mime: blob.type || 'audio/webm',
    dataUrl,
    size: blob.size,
    duration: sec,
    waveform
  };

  recordedBlob = null;
  recordedDuration = 0;
  recAmplitudes = [];

  const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const currentReply = replyTo;
  clearReply();

  const temp = {
    id: tempId,
    conversation_id: conv.id,
    sender_id: state.me?.id,
    content: null,
    media_type: 'voice',
    media_url: dataUrl,
    media_data: dataUrl,
    media_mime: voiceAttachment.mime,
    media_name: voiceAttachment.name,
    media_duration: voiceAttachment.duration,
    waveform: voiceAttachment.waveform,
    reply_to_id: currentReply?.id || null,
    created_at: new Date().toISOString(),
    display_name: state.me?.displayName,
    avatar_color: state.me?.avatarColor,
    is_verified: state.me?.isVerified,
    reactions: [],
    _status: 'sending',
    _content: null,
    _attachment: voiceAttachment,
    _reply: currentReply
  };

  state.messages[conv.id] = state.messages[conv.id] || [];
  state.messages[conv.id].push(temp);
  renderMessages(true);
  stopTypingSignal();

  await deliverTemp(conv.id, temp);
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
  if (isChannel && role === 'owner') options.push(`<button class="option" data-act="rename">${icon('edit')}<span class="option-copy">Rename channel</span></button>`);
  if (isChannel && conv.invite_code) options.push(`<button class="option" data-act="invite">${icon('link')}<span class="option-copy">Invite code<small>${escapeHtml(conv.invite_code)}</small></span></button>`);
  options.push(`<button class="option" data-act="search">${icon('search')}<span class="option-copy">Search in conversation</span></button>`);
  options.push(`<button class="option" data-act="mute">${icon('bell')}<span class="option-copy">${conv.muted ? 'Unmute' : 'Mute'} notifications</span></button>`);
  options.push(`<button class="option" data-act="pin">${icon('pin')}<span class="option-copy">${conv.pinned ? 'Unpin' : 'Pin'} conversation</span></button>`);
  options.push(`<button class="option" data-act="archive">${icon('bookmark')}<span class="option-copy">${conv.archived ? 'Unarchive chat' : 'Archive chat'}</span></button>`);
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
      const name = await promptSheet({ title: `Rename ${conv.type === 'channel' ? 'channel' : 'group'}`, label: `${conv.type === 'channel' ? 'Channel' : 'Group'} name`, value: conv.name || '', confirmText: 'Save' });
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
    if (act === 'archive') {
      const next = !conv.archived;
      await api.updateConversation(conv.id, { archived: next });
      conv.archived = next;
      emit('conversations:changed');
      toast(next ? 'Chat archived' : 'Chat unarchived', 'success');
      if (next) closeConversation();
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
  let current = [], users = [];
  try {
    current = (await api.members(conv.id)).members || [];
    users = (await api.discover('')).users || [];
  } catch (err) {
    toast(err instanceof ApiError ? err.message : 'Could not load users'); return;
  }
  const existing = new Set(current.map((m) => String(m.id)));
  users = users.filter((u) => !existing.has(String(u.id)) && String(u.id) !== String(state.me?.id));
  if (!users.length) { toast('There are no users available to add'); return; }
  await new Promise((resolve) => {
    let decided = false;
    const done = async (value) => {
      if (decided) return; decided = true; closeSheet();
      if (value?.length) {
        try { await api.addMembers(conv.id, value); toast(`${value.length} member${value.length === 1 ? '' : 's'} added`, 'success'); emit('conversations:changed'); }
        catch (err) { toast(err instanceof ApiError ? err.message : 'Could not add members'); }
      }
      resolve();
    };
    openSheet({
      title: 'Add members',
      body: `<div class="sheet-body">${users.map((u) => `<label class="option"><input type="checkbox" class="member-pick" value="${escapeHtml(u.novaId || '')}"><span>${avatar({ displayName: u.displayName, avatarUrl: u.avatarUrl, avatarColor: u.avatarColor }, { size: 'sm' })}</span><span class="option-copy">${escapeHtml(u.displayName || 'DARK CHAT User')}<small>${escapeHtml(u.novaId || '')}</small></span></label>`).join('')}</div>`,
      footer: `<div class="sheet-pad row"><button class="btn btn-ghost grow" data-act="cancel">Cancel</button><button class="btn btn-primary grow" data-act="add">Add selected</button></div>`,
      onMount(sheet) {
        sheet.querySelector('[data-act="cancel"]').addEventListener('click', () => done([]));
        sheet.querySelector('[data-act="add"]').addEventListener('click', () => done(Array.from(sheet.querySelectorAll('.member-pick:checked')).map((el) => el.value)));
      },
      onClose() { if (!decided) { decided = true; resolve(); } }
    });
  });
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
          try {
            await api.block(u.nova_id);
            conv.blocked_by_me = true;
            state.settings.blockedUserIds = Array.from(new Set([...(state.settings.blockedUserIds || []), u.id]));
            updateBlockedChatState(conv);
            toast('User blocked', 'success');
          } catch (err) { toast(err.message || 'Could not block'); }
        });
      }
    });
    return;
  }
  try {
    const res = await api.members(conv.id);
    const members = res.members || [];
    const actorRole = conv.role || conv.members?.[state.me?.id]?.role || (conv.owner_id === state.me?.id ? 'owner' : null);
    const canManage = ['owner', 'admin'].includes(actorRole);
    const canChangeRoles = actorRole === 'owner';
    openSheet({
      title: escapeHtml(conversationTitle(conv)),
      body: `<div class="sheet-pad"><div class="settings-group-title">${members.length} member${members.length === 1 ? '' : 's'}</div></div>
      <div class="sheet-body">${members.map((m) => {
        const roleLabel = m.role === 'owner' ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member';
        const muted = Boolean(m.muted_until);
        return `<div class="option member-management-row">
        ${avatar({ displayName: m.display_name, avatarUrl: m.avatar_url, avatarColor: m.avatar_color }, { size: 'sm' })}
        <span class="option-copy">${escapeHtml(m.display_name || 'User')} ${verifyBadge(m.is_verified)}<small>${escapeHtml(m.nova_id || '')} · ${roleLabel}${muted ? ' · muted' : ''}</small></span>
        ${String(m.id) === String(conv.owner_id) ? '<span class="pill">Owner</span>' : ''}
        ${m.id !== conv.owner_id && canManage ? `<span class="member-actions">
          ${canChangeRoles ? `<button type="button" class="btn btn-ghost btn-sm" data-member-role="${escapeHtml(m.id)}" data-role="${m.role === 'admin' ? 'member' : 'admin'}" title="${m.role === 'admin' ? 'Demote' : 'Promote'}">${icon(m.role === 'admin' ? 'arrow-down' : 'arrow-up')}${m.role === 'admin' ? 'Demote' : 'Promote'}</button>` : ''}
          ${canChangeRoles ? `<button type="button" class="btn btn-ghost btn-sm" data-transfer-owner="${escapeHtml(m.id)}">${icon('share')}Make owner</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-member-moderation="${escapeHtml(m.id)}" data-moderation-action="${muted ? 'unmute' : 'mute'}" title="${muted ? 'Unmute' : 'Mute'}">${icon(muted ? 'volume' : 'volume-off')}${muted ? 'Unmute' : 'Mute'}</button>
          <button type="button" class="btn btn-ghost btn-sm danger-text" data-member-moderation="${escapeHtml(m.id)}" data-moderation-action="kick" title="Remove">${icon('user-minus')}Remove</button>
          <button type="button" class="btn btn-ghost btn-sm danger-text" data-member-moderation="${escapeHtml(m.id)}" data-moderation-action="ban" title="Ban">${icon('ban')}Ban</button>
        </span>` : ''}
      </div>`;
      }).join('')}</div>`,
      footer: `<div class="sheet-pad stack">
        ${conv.type === 'group' && canManage ? `<button class="btn btn-primary btn-block" id="add-group-members">${icon('user-plus')} Add members</button>` : ''}
        ${conv.type === 'channel' && String(conv.owner_id) === String(state.me?.id) ? `<button class="btn btn-ghost btn-block" id="rename-channel">${icon('edit')} Rename channel</button>` : ''}
        ${['group', 'channel'].includes(conv.type) && canManage ? `<button class="btn btn-ghost btn-block" id="toggle-conversation-lock">${icon(conv.is_locked ? 'unlock' : 'lock')} ${conv.is_locked ? (conv.type === 'channel' ? 'Resume channel' : 'Unlock group') : (conv.type === 'channel' ? 'Pause channel' : 'Lock group')}</button>` : ''}
        ${conv.invite_code ? `<button class="btn btn-ghost btn-block" id="copy-invite">${icon('link')} Copy invite code</button><button class="btn btn-ghost btn-block" id="custom-invite">Customize invite code</button>` : ''}
        ${canManage ? `<label class="btn btn-ghost btn-block" for="conversation-avatar-input">${icon('image')} Change group picture<input id="conversation-avatar-input" type="file" accept="image/*" hidden></label>` : ''}
      </div>`,
      onMount(sheet) {
        sheet.querySelectorAll('[data-transfer-owner]').forEach((button) => button.addEventListener('click', async () => {
          const member = members.find((item) => String(item.id) === String(button.dataset.transferOwner));
          const ok = await confirmSheet({ title: 'Transfer ownership', message: `Make ${member?.display_name || 'this member'} the new owner? You will become an admin.`, confirmText: 'Transfer', danger: true });
          if (!ok) return;
          try { await api.transferOwnership(conv.id, button.dataset.transferOwner); Object.assign(conv, { owner_id: button.dataset.transferOwner, role: 'admin' }); toast('Ownership transferred', 'success'); closeSheet(); openConversationInfo(); }
          catch (err) { toast(err.message || 'Could not transfer ownership'); }
        }));
        sheet.querySelectorAll('[data-member-role]').forEach((button) => button.addEventListener('click', async () => {
          try {
            await api.updateMemberRole(conv.id, button.dataset.memberRole, button.dataset.role);
            toast(button.dataset.role === 'admin' ? 'Member promoted' : 'Admin demoted', 'success');
            closeSheet();
            openConversationInfo();
          } catch (err) { toast(err.message || 'Could not update role'); }
        }));
        sheet.querySelectorAll('[data-member-moderation]').forEach((button) => button.addEventListener('click', async () => {
          const action = button.dataset.moderationAction;
          const targetId = button.dataset.memberModeration;
          try {
            if (action === 'kick') {
              const member = members.find((item) => String(item.id) === String(targetId));
              const ok = await confirmSheet({
                title: 'Remove member',
                message: `Remove ${member?.display_name || 'this member'} from the group?`,
                confirmText: 'Remove',
                danger: true
              });
              if (!ok) return;
              await api.removeMember(conv.id, targetId);
              toast('Member removed', 'success');
            } else {
              if (action === 'ban') {
                const member = members.find((item) => String(item.id) === String(targetId));
                const ok = await confirmSheet({
                  title: 'Ban member',
                  message: `Ban ${member?.display_name || 'this member'}? They will be removed and cannot rejoin.`,
                  confirmText: 'Ban',
                  danger: true
                });
                if (!ok) return;
              }
              await api.moderateMember(conv.id, targetId, action);
              const labels = { ban: 'Member banned', mute: 'Member muted', unmute: 'Member unmuted' };
              toast(labels[action] || 'Updated', 'success');
            }
            closeSheet();
            openConversationInfo();
          } catch (err) { toast(err.message || 'Could not update member'); }
        }));
        sheet.querySelector('#add-group-members')?.addEventListener('click', () => {
          closeSheet();
          openAddMembersSheet(conv);
        });
        sheet.querySelector('#rename-channel')?.addEventListener('click', () => {
          closeSheet();
          handleChatAction('rename', conv, role);
        });
        sheet.querySelector('#toggle-conversation-lock')?.addEventListener('click', async () => {
          const button = sheet.querySelector('#toggle-conversation-lock');
          setBusy(button, true, conv.is_locked ? 'Resuming...' : 'Locking...');
          try {
            const result = await api.updateConversation(conv.id, { isLocked: !conv.is_locked });
            Object.assign(conv, result.conversation || {}, { is_locked: !conv.is_locked });
            closeSheet();
            renderHeader();
            toast(conv.is_locked ? (conv.type === 'channel' ? 'Channel paused' : 'Group locked') : (conv.type === 'channel' ? 'Channel resumed' : 'Group unlocked'), 'success');
          } catch (err) { toast(err.message || 'Could not change lock state'); setBusy(button, false); }
        });
        sheet.querySelector('#copy-invite')?.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(conv.invite_code); toast('Copied', 'success'); } catch { toast(conv.invite_code); }
        });
        sheet.querySelector('#custom-invite')?.addEventListener('click', async () => {
          const code = await promptSheet({ title: 'Custom invite code', label: '6–40 letters, numbers, - or _', value: conv.invite_code, confirmText: 'Save' });
          if (!code) return;
          try { const result = await api.updateConversation(conv.id, { inviteCode: code }); conv.invite_code = result.conversation.invite_code || code.toUpperCase(); toast('Invite code updated', 'success'); }
          catch (err) { toast(err.message || 'Could not update invite'); }
        });
        sheet.querySelector('#conversation-avatar-input')?.addEventListener('change', async (event) => {
          const file = event.target.files?.[0]; if (!file) return;
          if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) { toast('Choose an image up to 8MB'); return; }
          try {
            const dataUrl = await fileToDataUrl(file);
            const upload = await api.upload(dataUrl, file.type, file.name);
            if (!upload?.url) throw new Error('The image upload did not return a usable URL');
            const result = await api.updateConversation(conv.id, { avatarUrl: upload.url });
            Object.assign(conv, result.conversation || {}, { avatar_url: result.conversation?.avatar_url || upload.url });
            emit('conversations:changed'); renderHeader(); toast('Group picture updated', 'success');
          } catch (err) { toast(err.message || 'Could not update group picture'); }
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
