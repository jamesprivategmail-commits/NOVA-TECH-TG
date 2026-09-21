// status.js - status / stories screen + viewer
import { api, ApiError } from './api.js';
import { state, emit, on } from './state.js';
import {
  $, avatar, icon, escapeHtml, timeAgo, emptyState, errorState, skeletonList, verifyBadge,
  toast, openSheet, closeSheet, confirmSheet, setBusy, fileToDataUrl, fileToDataUrl as readFile
} from './ui.js';

let els = {};
let viewerTimer = null;
let progressStartedAt = 0;
let progressRemaining = 0;
let progressPaused = false;
let viewerPointerCleanup = null;

const STATUS_COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2', '#ff3b45', '#1a1a1d'];

export function initStatus() {
  els = {
    list: $('#status-list'),
    channels: $('#channel-list'),
    newBtn: $('#new-status-btn'),
    viewer: $('#viewer')
  };
  els.newBtn?.addEventListener('click', openNewStatusSheet);
  on('status:changed', () => renderStatus());
  on('conversations:changed', renderChannels);
  renderStatus();
  renderChannels();
}

export async function loadStatuses() {
  els.list.innerHTML = skeletonList(5);
  try {
    const res = await api.statusFeed();
    state.statuses = res.statuses || [];
    renderStatus();
  } catch (err) {
    els.list.innerHTML = errorState({ title: 'Could not load status updates', subtitle: err.message, retryId: 'retry-status' });
    $('#retry-status')?.addEventListener('click', loadStatuses);
  }
}

function groupByUser() {
  const groups = [];
  const map = new Map();
  for (const s of state.statuses) {
    if (!map.has(s.user_id)) {
      const group = { userId: s.user_id, name: s.display_name, novaId: s.nova_id, avatarUrl: s.avatar_url, color: s.avatar_color, verified: s.is_verified, items: [] };
      map.set(s.user_id, group);
      groups.push(group);
    }
    map.get(s.user_id).items.push(s);
  }
  return groups;
}

function renderStatus() {
  if (!els.list) return;
  const groups = groupByUser();
  if (!groups.length) {
    els.list.innerHTML = emptyState({
      iconName: 'camera-plus',
      title: 'No status updates',
      subtitle: 'Statuses from you and your contacts appear here for 24 hours.',
      actionLabel: 'Add status',
      actionId: 'empty-add-status'
    });
    $('#empty-add-status')?.addEventListener('click', openNewStatusSheet);
    return;
  }
  const own = state.me ? groups.find((g) => String(g.userId) === String(state.me.id)) : null;
  const others = groups.filter((g) => g !== own);
  const ringHtml = (g, isOwn) => {
    const seen = g.items.every((s) => s.viewed) && !isOwn;
    const item = g.items[g.items.length - 1];
    return `<button class="story ${isOwn ? 'story-own' : ''}" data-status-user="${escapeHtml(g.userId)}">
      <span class="story-ring ${seen ? 'seen' : ''}">
        <span class="story-inner">${avatar({ displayName: g.name, avatarUrl: g.avatarUrl, avatarColor: g.color }, { cls: '' })}</span>
      </span>
      ${isOwn ? `<span class="story-plus">${icon('plus')}</span>` : ''}
      <span class="story-name truncate">${escapeHtml(isOwn ? 'My status' : (g.name || 'User'))} ${verifyBadge(g.verified)}</span>
    </button>`;
  };
  let html = '<div class="story-strip">';
  if (own) html += ringHtml(own, true);
  else html += `<button class="story story-own" data-new-status="1"><span class="story-ring"><span class="story-inner">${avatar(state.me || {}, {})}</span></span><span class="story-plus">${icon('plus')}</span><span class="story-name">My status</span></button>`;
  html += others.map((g) => ringHtml(g, false)).join('');
  html += '</div>';

  els.list.innerHTML = html;
  els.list.querySelector('[data-new-status]')?.addEventListener('click', openNewStatusSheet);
  els.list.querySelectorAll('[data-status-user]').forEach((btn) => btn.addEventListener('click', () => openViewerForUser(btn.dataset.statusUser)));
}

function renderChannels() {
  if (!els.channels) return;
  const channels = (state.conversations || []).filter((conversation) => conversation.type === 'channel');
  if (!channels.length) {
    els.channels.innerHTML = '';
    return;
  }
  els.channels.innerHTML = channels.map((channel) => `<button class="channel-row" data-channel-id="${escapeHtml(channel.id)}">
    ${avatar({ displayName: channel.name || 'Channel', avatarUrl: channel.avatar_url, avatarColor: channel.avatar_color }, { size: 'sm' })}
    <span class="channel-info"><span class="channel-name truncate">${escapeHtml(channel.name || 'Channel')} ${verifyBadge(channel.is_verified)}</span><span class="channel-meta truncate">${escapeHtml(channel.last_message?.content || 'Channel updates')}</span></span>
    <span class="channel-chevron">${icon('chevron-right')}</span>
  </button>`).join('');
  els.channels.querySelectorAll('[data-channel-id]').forEach((button) => button.addEventListener('click', () => {
    const channel = channels.find((item) => item.id === button.dataset.channelId);
    if (channel) emit('chat:open', channel);
  }));
}

// ---------------- create ----------------
function openNewStatusSheet() {
  openSheet({
    title: 'New status',
    body: `<div class="sheet-pad">
      <div id="status-error" class="alert alert-error hidden"></div>
      <label class="field"><span class="field-label">What's on your mind?</span>
        <textarea class="textarea" id="status-text" maxlength="300" placeholder="Type a status..."></textarea></label>
      <label class="field"><span class="field-label">Photo or video (optional)</span>
        <input class="input" type="file" id="status-media" accept="image/*,video/*"></label>
      <div id="status-preview"></div>
      <div class="field"><span class="field-label">Background colour</span>
        <div id="status-colors" class="row" style="flex-wrap:wrap"></div></div>
    </div>`,
    footer: `<div class="sheet-pad"><button class="btn btn-primary btn-block" id="status-post">Post status</button></div>`,
    onMount(sheet) {
      let color = STATUS_COLORS[0];
      let media = null;
      const colors = sheet.querySelector('#status-colors');
      colors.innerHTML = STATUS_COLORS.map((c, i) => `<button class="avatar" data-color="${c}" style="background:${c};width:34px;height:34px;border:2px solid ${i === 0 ? '#fff' : 'transparent'}" aria-label="Colour ${c}"></button>`).join('');
      colors.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-color]');
        if (!btn) return;
        color = btn.dataset.color;
        colors.querySelectorAll('[data-color]').forEach((b) => { b.style.border = '2px solid transparent'; });
        btn.style.border = '2px solid #fff';
      });
      sheet.querySelector('#status-media').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) { media = null; sheet.querySelector('#status-preview').innerHTML = ''; return; }
        if (file.size > 15 * 1024 * 1024) { toast('File too large (max 15MB)'); e.target.value = ''; return; }
        try {
          const dataUrl = await fileToDataUrl(file);
          media = { dataUrl, mime: file.type, type: file.type.startsWith('video/') ? 'video' : 'image' };
          const preview = file.type.startsWith('video/')
            ? `<video src="${escapeHtml(dataUrl)}" controls style="max-height:200px;border-radius:12px"></video>`
            : `<img src="${escapeHtml(dataUrl)}" alt="" style="max-height:200px;border-radius:12px">`;
          sheet.querySelector('#status-preview').innerHTML = preview;
        } catch { toast('Could not read file'); }
      });
      sheet.querySelector('#status-post').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const text = sheet.querySelector('#status-text').value.trim();
        const errBox = sheet.querySelector('#status-error');
        const fail = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
        if (!text && !media) return fail('Add text or media to post a status');
        setBusy(btn, true, 'Posting...');
        try {
          await api.createStatus({
            content: text,
            bgColor: color,
            mediaData: media?.dataUrl || null,
            mediaMime: media?.mime || null,
            mediaType: media?.type || null
          });
          closeSheet();
          toast('Status posted', 'success');
          loadStatuses();
        } catch (err) {
          fail(err instanceof ApiError ? err.message : 'Could not post status');
        } finally {
          setBusy(btn, false);
        }
      });
    }
  });
}

// ---------------- viewer ----------------
function openViewerForUser(userId, focusId = null) {
  const groups = groupByUser();
  let userIndex = Math.max(0, groups.findIndex((g) => String(g.userId) === String(userId)));
  if (userIndex < 0) return;
  let items = groups[userIndex].items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let index = focusId ? Math.max(0, items.findIndex((s) => s.id === focusId)) : 0;
  const viewer = els.viewer;
  viewer.hidden = false;
  viewerPointerCleanup?.();
  const onPointerDown = (event) => {
    viewer.setPointerCapture?.(event.pointerId);
    pauseProgress();
  };
  const onPointerUp = (event) => {
    if (viewer.hasPointerCapture?.(event.pointerId)) viewer.releasePointerCapture(event.pointerId);
    resumeProgress();
  };
  viewer.addEventListener('pointerdown', onPointerDown);
  viewer.addEventListener('pointerup', onPointerUp);
  viewer.addEventListener('pointercancel', onPointerUp);
  viewer.addEventListener('lostpointercapture', resumeProgress);
  viewerPointerCleanup = () => {
    viewer.removeEventListener('pointerdown', onPointerDown);
    viewer.removeEventListener('pointerup', onPointerUp);
    viewer.removeEventListener('pointercancel', onPointerUp);
    viewer.removeEventListener('lostpointercapture', resumeProgress);
    viewerPointerCleanup = null;
  };

  const render = () => {
    items = groups[userIndex].items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const s = items[index];
    const isOwn = String(s.user_id) === String(state.me?.id);
    const canPrev = index > 0;
    const canNext = index < items.length - 1 || userIndex < groups.length - 1;
    let media = '';
    if (s.media_url && s.media_type === 'video') media = `<video src="${escapeHtml(s.media_url)}" autoplay playsinline controls></video>`;
    else if (s.media_url) media = `<img src="${escapeHtml(s.media_url)}" alt="">`;
    else media = `<div class="viewer-text" style="background:${escapeHtml(s.bg_color || '#1a1a1d')}">${escapeHtml(s.content || '')}</div>`;
    const caption = s.media_url && s.content ? `<div class="viewer-caption">${escapeHtml(s.content)}</div>` : '';

    viewer.innerHTML = `
      <div class="viewer-progress">${items.map((_, i) => `<div class="seg ${i < index ? 'done' : ''}"><span style="width:${i < index ? '100%' : '0%'}"></span></div>`).join('')}</div>
      <div class="viewer-head">
        ${avatar({ displayName: s.display_name, avatarUrl: s.avatar_url, avatarColor: s.avatar_color }, { size: 'sm' })}
        <div class="grow"><div class="name truncate">${escapeHtml(s.display_name || 'User')} ${verifyBadge(s.is_verified)}</div><div class="time">${escapeHtml(timeAgo(s.created_at))}</div></div>
        ${isOwn ? `<button class="icon-btn" id="viewer-delete" aria-label="Delete status">${icon('trash')}</button>` : ''}
        <button class="icon-btn" id="viewer-close" aria-label="Close">${icon('x')}</button>
      </div>
      <div class="viewer-stage">${media}${caption}</div>
      <div class="viewer-foot">
        <input class="input" id="viewer-reply" placeholder="Reply..." autocomplete="off">
        <button class="btn btn-primary" id="viewer-send" aria-label="Send reply">${icon('send')}</button>
      </div>
      ${canPrev ? '<button class="viewer-nav prev" id="viewer-prev" aria-label="Previous status"></button>' : ''}
      ${canNext ? '<button class="viewer-nav next" id="viewer-next" aria-label="Next status"></button>' : ''}
    `;
    viewer.querySelector('#viewer-close').addEventListener('click', closeViewer);
    viewer.querySelector('#viewer-prev')?.addEventListener('click', () => { index--; render(); });
    viewer.querySelector('#viewer-next')?.addEventListener('click', () => advance());
    viewer.querySelector('#viewer-delete')?.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: 'Delete status', message: 'Delete this status?', confirmText: 'Delete', danger: true });
      if (!ok) return;
      try { await api.deleteStatus(s.id); toast('Deleted'); closeViewer(); loadStatuses(); } catch (err) { toast(err.message || 'Delete failed'); }
    });
    viewer.querySelector('#viewer-send').addEventListener('click', () => replyToStatus(s, viewer.querySelector('#viewer-reply').value));

    if (!s.viewed && !isOwn) api.viewStatus(s.id).catch(() => {});
    startProgress(s);
  };

  function startProgress(s) {
    clearTimeout(viewerTimer);
    const seg = viewer.querySelectorAll('.viewer-progress .seg span')[index];
    const duration = s.media_type === 'video' ? 8000 : 5000;
    progressRemaining = duration;
    progressPaused = false;
    progressStartedAt = Date.now();
    if (seg) {
      requestAnimationFrame(() => { seg.style.transition = `width ${duration}ms linear`; seg.style.width = '100%'; });
    }
    viewerTimer = setTimeout(() => {
      advance();
    }, duration);
  }
  function advance() {
    if (index < items.length - 1) { index++; render(); return; }
    if (userIndex < groups.length - 1) { userIndex++; index = 0; render(); return; }
    closeViewer();
  }
  function pauseProgress() {
    if (progressPaused) return;
    progressPaused = true;
    progressRemaining = Math.max(0, progressRemaining - (Date.now() - progressStartedAt));
    clearTimeout(viewerTimer);
    viewer.querySelector('video')?.pause();
  }
  function resumeProgress() {
    if (!progressPaused) return;
    progressPaused = false;
    progressStartedAt = Date.now();
    viewer.querySelector('video')?.play().catch(() => {});
    viewerTimer = setTimeout(() => {
      advance();
    }, progressRemaining || 1);
  }

  render();
}

function closeViewer() {
  clearTimeout(viewerTimer);
  progressPaused = false;
  viewerPointerCleanup?.();
  els.viewer.hidden = true;
  els.viewer.innerHTML = '';
}

async function replyToStatus(status, text) {
  const value = (text || '').trim();
  if (!value) return;
  if (String(status.user_id) === String(state.me?.id)) { toast('That is your own status'); return; }
  try {
    const dm = await api.createDm(status.nova_id);
    emit('chat:needs-send', {
      conversationId: dm.conversationId,
      content: value,
      novaId: status.nova_id,
      statusReply: { id: status.id, author: status.display_name, content: status.content || (status.media_type === 'video' ? 'Video' : 'Photo'), created_at: status.created_at }
    });
    closeViewer();
    toast('Reply sent', 'success');
  } catch (err) {
    toast(err instanceof ApiError ? err.message : 'Could not send reply');
  }
}

export { readFile };
