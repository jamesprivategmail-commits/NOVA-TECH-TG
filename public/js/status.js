// status.js - status / stories screen + viewer
import { api, ApiError , mediaSrc} from './api.js';
import { pref } from './settings.js';
import { state, emit, on } from './state.js';
import { refreshConversations } from './chats.js';
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
    channelDiscover: $('#channel-discover-list'),
    newBtn: $('#new-status-btn'),
    viewer: $('#viewer')
  };
  els.newBtn?.addEventListener('click', openNewStatusSheet);
  on('status:changed', () => renderStatus());
  on('conversations:changed', () => { renderChannels(); });
  on('tab:show', (name) => {
    if (name === 'status') {
      loadStatuses();
      loadChannelDiscovery();
    }
  });
  renderStatus();
  renderChannels();
}

export async function loadStatuses() {
  if (els.list && (!state.statuses || !state.statuses.length)) {
    els.list.innerHTML = skeletonList(5);
  }
  try {
    const res = await api.statusFeed();
    state.statuses = res.statuses || [];
    renderStatus();
  } catch (err) {
    if (!state.statuses || !state.statuses.length) {
      els.list.innerHTML = errorState({ title: 'Could not load status updates', subtitle: err.message, retryId: 'retry-status' });
      $('#retry-status')?.addEventListener('click', loadStatuses);
    }
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

let discoverChannelsCache = [];

async function loadChannelDiscovery() {
  if (!els.channelDiscover) return;
  try {
    const res = await api.discoverChannels();
    discoverChannelsCache = res.channels || [];
    renderChannelDiscovery();
  } catch (err) {
    // Quiet failure — this is a secondary section, not the primary status feed.
    els.channelDiscover.innerHTML = '';
  }
}

function renderChannelDiscovery() {
  if (!els.channelDiscover) return;
  if (!discoverChannelsCache.length) {
    els.channelDiscover.innerHTML = emptyState({ title: 'No new channels to find', subtitle: 'You are following every public channel right now.' });
    return;
  }
  els.channelDiscover.innerHTML = discoverChannelsCache.map((channel) => `<div class="channel-row" style="cursor:default" data-discover-channel-id="${escapeHtml(channel.id)}">
    ${avatar({ displayName: channel.name, avatarUrl: channel.avatarUrl, avatarColor: channel.avatarColor }, { size: 'sm' })}
    <span class="channel-info"><span class="channel-name truncate">${escapeHtml(channel.name)} ${verifyBadge(channel.isVerified)}</span><span class="channel-meta truncate">${channel.memberCount} follower${channel.memberCount === 1 ? '' : 's'}${channel.description ? ' · ' + escapeHtml(channel.description) : ''}</span></span>
    <button type="button" class="btn btn-ghost btn-sm" data-follow-channel="${escapeHtml(channel.id)}" ${channel.inviteCode ? '' : 'disabled'}>Follow</button>
  </div>`).join('');
  els.channelDiscover.querySelectorAll('[data-follow-channel]').forEach((button) => button.addEventListener('click', async () => {
    const channel = discoverChannelsCache.find((item) => item.id === button.dataset.followChannel);
    if (!channel?.inviteCode) return;
    setBusy(button, true);
    try {
      await api.joinConversation(channel.inviteCode);
      await refreshConversations();
      toast(`Following ${channel.name}`, 'success');
      discoverChannelsCache = discoverChannelsCache.filter((item) => item.id !== channel.id);
      renderChannelDiscovery();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not follow channel', 'error');
      setBusy(button, false);
    }
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
        const isVideo = file.type.startsWith('video/');
        const maxBytes = isVideo ? 50 * 1024 * 1024 : 25 * 1024 * 1024;
        if (!file.type.startsWith('image/') && !isVideo) {
          toast('Statuses support photos and videos only');
          e.target.value = '';
          return;
        }
        if (file.size > maxBytes) {
          toast(isVideo ? 'Video too large (max 50MB)' : 'Photo too large (max 25MB)');
          e.target.value = '';
          return;
        }
        try {
          const dataUrl = await fileToDataUrl(file);
          media = { dataUrl, mime: file.type, type: isVideo ? 'video' : 'image' };
          const preview = isVideo
            ? `<video src="${escapeHtml(dataUrl)}" muted playsinline controls style="max-height:200px;border-radius:12px;width:100%"></video>`
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
  let pointerStartedAt = 0;
  const onPointerDown = (event) => {
    if (event.target.closest('.viewer-head, .viewer-foot, button, input')) return;
    pointerStartedAt = Date.now();
    event.preventDefault();
    viewer.setPointerCapture?.(event.pointerId);
    pauseProgress();
  };
  const onPointerUp = (event) => {
    if (viewer.hasPointerCapture?.(event.pointerId)) viewer.releasePointerCapture(event.pointerId);
    resumeProgress();
    if (!event.target.closest('.viewer-head, .viewer-foot, button, input, video') && pointerStartedAt && Date.now() - pointerStartedAt < 350) {
      const rect = viewer.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (x <= rect.width * 0.35 && (index > 0 || userIndex > 0)) { retreat(); }
      else if (x >= rect.width * 0.65) advance();
    }
    pointerStartedAt = 0;
  };
  viewer.addEventListener('pointerdown', onPointerDown);
  viewer.addEventListener('pointerup', onPointerUp);
  viewer.addEventListener('pointercancel', onPointerUp);
  viewer.addEventListener('lostpointercapture', resumeProgress);
  const onContextMenu = (event) => event.preventDefault();
  viewer.addEventListener('contextmenu', onContextMenu);
  viewerPointerCleanup = () => {
    viewer.removeEventListener('pointerdown', onPointerDown);
    viewer.removeEventListener('pointerup', onPointerUp);
    viewer.removeEventListener('pointercancel', onPointerUp);
    viewer.removeEventListener('lostpointercapture', resumeProgress);
    viewer.removeEventListener('contextmenu', onContextMenu);
    viewerPointerCleanup = null;
  };

  const render = () => {
    items = groups[userIndex].items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const s = items[index];
    const isOwn = String(s.user_id) === String(state.me?.id);
    const canPrev = index > 0 || userIndex > 0;
    const canNext = index < items.length - 1 || userIndex < groups.length - 1;
    let media = '';
    if (s.media_url && s.media_type === 'video') {
      // No native controls — hold-to-pause matches image behaviour; tap sides to navigate.
      media = `<video src="${escapeHtml(mediaSrc(s.media_url))}" autoplay playsinline muted loop class="status-video"></video>`;
    } else if (s.media_url) {
      media = `<img src="${escapeHtml(mediaSrc(s.media_url))}" alt="">`;
    } else {
      media = `<div class="viewer-text" style="background:${escapeHtml(s.bg_color || '#1a1a1d')}">${escapeHtml(s.content || '')}</div>`;
    }
    const caption = s.media_url && s.content ? `<div class="viewer-caption">${escapeHtml(s.content)}</div>` : '';

    viewer.innerHTML = `
      <div class="viewer-progress">${items.map((_, i) => `<div class="seg ${i < index ? 'done' : ''}"><span style="width:${i < index ? '100%' : '0%'}"></span></div>`).join('')}</div>
      <div class="viewer-head">
        ${avatar({ displayName: s.display_name, avatarUrl: s.avatar_url, avatarColor: s.avatar_color }, { size: 'sm' })}
        <div class="grow"><div class="name truncate">${escapeHtml(s.display_name || 'User')} ${verifyBadge(s.is_verified)}</div><div class="time">${escapeHtml(timeAgo(s.created_at))}</div></div>
        <div class="viewer-actions">
          ${s.media_url && s.media_type === 'video' ? `<button type="button" class="icon-btn" id="viewer-sound" aria-label="Unmute video">${icon('volume-off')}</button>` : ''}
          <button type="button" class="icon-btn" id="viewer-pause" aria-label="Pause status" aria-pressed="false">${icon('pause')}</button>
          ${isOwn ? `<button type="button" class="icon-btn" id="viewer-delete" aria-label="Delete status">${icon('trash')}</button>` : ''}
          <button type="button" class="icon-btn" id="viewer-close" aria-label="Close">${icon('x')}</button>
        </div>
      </div>
      <div class="viewer-stage">${media}${caption}</div>
      <div class="viewer-react-bar">
        <button type="button" class="viewer-react-btn" id="viewer-like" aria-label="React">${s.my_reaction ? escapeHtml(s.my_reaction) : '♡'} <span class="react-count">${s.reaction_count || 0}</span></button>
        <button type="button" class="viewer-react-btn" id="viewer-save" aria-label="Save" ${s.media_url ? '' : 'disabled'}>${icon('download')} Save</button>
        <button type="button" class="viewer-react-btn" id="viewer-repost" aria-label="Repost">${icon('share')} Repost</button>
      </div>
      <div class="viewer-emoji-row hidden" id="viewer-emoji-row">
        ${['❤️','😂','🔥','😮','😢','👏','😍','👍','🎉','💯'].map((e) => `<button type="button" class="viewer-emoji" data-emoji="${e}">${e}</button>`).join('')}
        <button type="button" class="viewer-emoji viewer-emoji-custom" id="viewer-emoji-custom" title="Custom emoji">+</button>
      </div>
      <div class="viewer-reply-tools">
        <button type="button" class="viewer-react-btn" id="viewer-reply-image" aria-label="Reply with photo">${icon('image')}</button>
        <button type="button" class="viewer-react-btn" id="viewer-reply-video" aria-label="Reply with video">${icon('video')}</button>
        <button type="button" class="viewer-react-btn" id="viewer-reply-sticker" aria-label="Reply with sticker">${icon('smile')}</button>
        <input type="file" id="viewer-reply-file" accept="image/*,video/*" hidden>
      </div>
      <div id="viewer-reply-preview" class="viewer-reply-preview hidden"></div>
      <div class="viewer-foot">
        <input class="input" id="viewer-reply" placeholder="Reply with text, photo, video or sticker..." autocomplete="off">
        <button type="button" class="btn btn-primary" id="viewer-send" aria-label="Send reply">${icon('send')}</button>
      </div>
      ${canPrev ? '<button type="button" class="viewer-nav prev" id="viewer-prev" aria-label="Previous status"></button>' : ''}
      ${canNext ? '<button type="button" class="viewer-nav next" id="viewer-next" aria-label="Next status"></button>' : ''}
    `;
    viewer.querySelector('#viewer-close').addEventListener('click', (e) => { e.stopPropagation(); closeViewer(); });
    viewer.querySelector('#viewer-prev')?.addEventListener('click', () => retreat());
    viewer.querySelector('#viewer-next')?.addEventListener('click', () => advance());
    viewer.querySelector('#viewer-sound')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const vid = viewer.querySelector('video.status-video');
      if (vid) {
        vid.muted = !vid.muted;
        btn.innerHTML = icon(vid.muted ? 'volume-off' : 'volume');
        btn.setAttribute('aria-label', vid.muted ? 'Unmute video' : 'Mute video');
      }
    });
    viewer.querySelector('#viewer-pause').addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      if (progressPaused) {
        resumeProgress();
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', 'Pause status');
        btn.innerHTML = icon('pause');
      } else {
        pauseProgress();
        btn.setAttribute('aria-pressed', 'true');
        btn.setAttribute('aria-label', 'Play status');
        btn.innerHTML = icon('play');
      }
    });
    viewer.querySelector('#viewer-delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      // The confirmation sheet sits below the full-screen viewer. Close the
      // viewer first so the confirmation controls are actually tappable.
      closeViewer();
      const ok = await confirmSheet({ title: 'Delete status', message: 'Delete this status?', confirmText: 'Delete', danger: true });
      if (!ok) return;
      try { await api.deleteStatus(s.id); toast('Deleted', 'success'); await loadStatuses(); } catch (err) { toast(err.message || 'Delete failed'); }
    });
    let replyMedia = null;
    const replyPreview = viewer.querySelector('#viewer-reply-preview');
    const replyFile = viewer.querySelector('#viewer-reply-file');
    const setReplyPreview = () => {
      if (!replyMedia) { replyPreview.classList.add('hidden'); replyPreview.innerHTML = ''; return; }
      replyPreview.classList.remove('hidden');
      const thumb = replyMedia.type === 'video' || (replyMedia.mime || '').startsWith('video/')
        ? `<video src="${escapeHtml(replyMedia.dataUrl || replyMedia.url)}" muted></video>`
        : `<img src="${escapeHtml(replyMedia.dataUrl || replyMedia.url)}" alt="">`;
      replyPreview.innerHTML = `${thumb}<button type="button" class="icon-btn" id="viewer-reply-clear" aria-label="Remove">${icon('x')}</button>`;
      replyPreview.querySelector('#viewer-reply-clear')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        replyMedia = null;
        setReplyPreview();
      });
    };
    viewer.querySelector('#viewer-reply-image')?.addEventListener('click', (e) => {
      e.stopPropagation();
      pauseProgress();
      replyFile.accept = 'image/*';
      replyFile.onchange = async () => {
        const file = replyFile.files?.[0];
        replyFile.value = '';
        if (!file) { resumeProgress(); return; }
        try {
          const dataUrl = await fileToDataUrl(file);
          replyMedia = { type: 'image', mime: file.type || 'image/jpeg', dataUrl, name: file.name };
          setReplyPreview();
        } catch { toast('Could not read image'); }
        resumeProgress();
      };
      replyFile.click();
    });
    viewer.querySelector('#viewer-reply-video')?.addEventListener('click', (e) => {
      e.stopPropagation();
      pauseProgress();
      replyFile.accept = 'video/*';
      replyFile.onchange = async () => {
        const file = replyFile.files?.[0];
        replyFile.value = '';
        if (!file) { resumeProgress(); return; }
        if (file.size > 50 * 1024 * 1024) { toast('Video too large (max 50MB)'); resumeProgress(); return; }
        try {
          const dataUrl = await fileToDataUrl(file);
          replyMedia = { type: 'video', mime: file.type || 'video/mp4', dataUrl, name: file.name };
          setReplyPreview();
        } catch { toast('Could not read video'); }
        resumeProgress();
      };
      replyFile.click();
    });
    viewer.querySelector('#viewer-reply-sticker')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      pauseProgress();
      try {
        const { openStickerPicker } = await import('./stickers.js');
        openStickerPicker({
          onPick: (sticker) => {
            replyMedia = {
              type: 'sticker',
              mime: sticker.mime || 'image/png',
              url: sticker.url.startsWith('data:') ? null : sticker.url,
              dataUrl: sticker.url.startsWith('data:') ? sticker.url : sticker.url,
              name: 'sticker'
            };
            setReplyPreview();
            resumeProgress();
          }
        });
      } catch {
        toast('Stickers unavailable');
        resumeProgress();
      }
    });
    viewer.querySelector('#viewer-send').addEventListener('click', (e) => {
      e.stopPropagation();
      replyToStatus(s, viewer.querySelector('#viewer-reply').value, replyMedia);
    });

    const emojiRow = viewer.querySelector('#viewer-emoji-row');
    viewer.querySelector('#viewer-like')?.addEventListener('click', (e) => {
      e.stopPropagation();
      pauseProgress();
      emojiRow?.classList.toggle('hidden');
    });
    emojiRow?.querySelectorAll('[data-emoji]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await reactToCurrent(s, btn.dataset.emoji, viewer);
        emojiRow.classList.add('hidden');
        resumeProgress();
      });
    });
    viewer.querySelector('#viewer-emoji-custom')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      pauseProgress();
      const custom = window.prompt('Type any emoji to react with', s.my_reaction || '✨');
      if (custom && custom.trim()) await reactToCurrent(s, custom.trim(), viewer);
      emojiRow.classList.add('hidden');
      resumeProgress();
    });
    viewer.querySelector('#viewer-save')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      pauseProgress();
      try {
        await saveStatusMedia(s);
        toast('Saved to device', 'success');
      } catch (err) {
        toast(err.message || 'Could not save');
      }
      resumeProgress();
    });
    viewer.querySelector('#viewer-repost')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      pauseProgress();
      try {
        await repostStatus(s);
      } catch (err) {
        toast(err.message || 'Could not repost');
      }
      resumeProgress();
    });

    if (!s.viewed && !isOwn) api.viewStatus(s.id).catch(() => {});
    startProgress(s);
  };

  async function reactToCurrent(status, emoji, root) {
    try {
      const res = await api.reactStatus(status.id, emoji);
      status.reactions = res.reactions || status.reactions;
      status.reaction_count = res.reaction_count || 0;
      status.my_reaction = res.my_reaction || null;
      const feedItem = state.statuses.find((x) => x.id === status.id);
      if (feedItem) {
        feedItem.reactions = status.reactions;
        feedItem.reaction_count = status.reaction_count;
        feedItem.my_reaction = status.my_reaction;
      }
      const likeBtn = root.querySelector('#viewer-like');
      if (likeBtn) {
        likeBtn.innerHTML = `${status.my_reaction ? escapeHtml(status.my_reaction) : '♡'} <span class="react-count">${status.reaction_count || 0}</span>`;
      }
      emit('status:changed');
    } catch (err) {
      toast(err.message || 'Could not react');
    }
  }

  async function saveStatusMedia(status) {
    if (!status.media_url) throw new Error('This status has no media to save');
    const res = await fetch(mediaSrc(status.media_url), { credentials: 'include' });
    if (!res.ok) throw new Error('Could not download media');
    const blob = await res.blob();
    const ext = (status.media_mime || blob.type || 'image/jpeg').split('/')[1]?.split(';')[0] || (status.media_type === 'video' ? 'mp4' : 'jpg');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `darkchat-status-${status.id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function repostStatus(status) {
    const captionDefault = status.content || '';
    const caption = window.prompt('Repost with caption (optional)', captionDefault);
    if (caption === null) return;
    const payload = {
      content: String(caption || '').trim().slice(0, 300),
      bgColor: status.bg_color || '#0A84FF'
    };
    if (status.media_url) {
      const res = await fetch(mediaSrc(status.media_url), { credentials: 'include' });
      if (!res.ok) throw new Error('Could not copy media for repost');
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read media'));
        reader.readAsDataURL(blob);
      });
      payload.mediaData = dataUrl;
      payload.mediaMime = status.media_mime || blob.type || 'image/jpeg';
      payload.mediaType = status.media_type || (payload.mediaMime.startsWith('video/') ? 'video' : 'image');
    }
    await api.createStatus(payload);
    toast('Reposted to your status', 'success');
    await loadStatuses();
  }

  function startProgress(s) {
    clearTimeout(viewerTimer);
    const seg = viewer.querySelectorAll('.viewer-progress .seg span')[index];
    const video = viewer.querySelector('video.status-video');
    const applyDuration = (durationMs) => {
      const duration = Math.max(2000, Math.min(durationMs, 30000));
      progressRemaining = duration;
      progressPaused = false;
      progressStartedAt = Date.now();
      if (seg) {
        seg.style.transition = 'none';
        seg.style.width = '0%';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            seg.style.transition = `width ${duration}ms linear`;
            seg.style.width = '100%';
          });
        });
      }
      viewerTimer = setTimeout(() => advance(), duration);
    };

    if (video) {
      // Hold-to-pause works on the progress timer + the video element.
      const kickoff = () => {
        const ms = Number.isFinite(video.duration) && video.duration > 0
          ? Math.ceil(video.duration * 1000)
          : 15000;
        applyDuration(ms);
        if (pref('statusVideoAutoplay', true)) {
          video.play().catch(() => {});
        } else {
          video.pause();
          // Leave progress running but paused so user can hold/tap play
          pauseProgress();
        }
      };
      if (video.readyState >= 1) kickoff();
      else video.addEventListener('loadedmetadata', kickoff, { once: true });
      return;
    }

    applyDuration(5000);
  }
  function advance() {
    if (index < items.length - 1) { index++; render(); return; }
    if (userIndex < groups.length - 1) { userIndex++; index = 0; render(); return; }
    closeViewer();
  }
  function retreat() {
    if (index > 0) { index--; render(); return; }
    if (userIndex > 0) {
      userIndex--;
      // Jump to the LAST status of the previous person, not their first.
      const prevItems = groups[userIndex].items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      index = prevItems.length - 1;
      render();
      return;
    }
    // Already at the very first status of the very first person — nothing to do.
  }
  function pauseProgress() {
    if (progressPaused) return;
    progressPaused = true;
    progressRemaining = Math.max(0, progressRemaining - (Date.now() - progressStartedAt));
    clearTimeout(viewerTimer);
    const seg = viewer.querySelectorAll('.viewer-progress .seg span')[index];
    if (seg) {
      const computed = getComputedStyle(seg).width;
      seg.style.transition = 'none';
      seg.style.width = computed;
    }
    const video = viewer.querySelector('video');
    if (video && !video.paused) video.pause();
    const pauseBtn = viewer.querySelector('#viewer-pause');
    if (pauseBtn) {
      pauseBtn.setAttribute('aria-pressed', 'true');
      pauseBtn.innerHTML = icon('play');
    }
  }
  function resumeProgress() {
    if (!progressPaused) return;
    progressPaused = false;
    progressStartedAt = Date.now();
    const seg = viewer.querySelectorAll('.viewer-progress .seg span')[index];
    if (seg && progressRemaining > 0) {
      seg.style.transition = `width ${progressRemaining}ms linear`;
      seg.style.width = '100%';
    }
    const video = viewer.querySelector('video');
    if (video) video.play().catch(() => {});
    const pauseBtn = viewer.querySelector('#viewer-pause');
    if (pauseBtn) {
      pauseBtn.setAttribute('aria-pressed', 'false');
      pauseBtn.innerHTML = icon('pause');
    }
    viewerTimer = setTimeout(() => {
      advance();
    }, progressRemaining || 1);
  }

  render();
}

function closeViewer() {
  clearTimeout(viewerTimer);
  progressPaused = false;
  try { els.viewer.querySelector('video')?.pause(); } catch { /* ignore */ }
  viewerPointerCleanup?.();
  els.viewer.hidden = true;
  els.viewer.innerHTML = '';
}

async function replyToStatus(status, text, media = null) {
  const value = (text || '').trim();
  if (!value && !media) {
    toast('Add text, a photo, video or sticker to reply');
    return;
  }
  if (String(status.user_id) === String(state.me?.id)) { toast('That is your own status'); return; }
  try {
    const dm = await api.createDm(status.nova_id);
    const mediaPayload = media ? {
      type: media.type,
      mime: media.mime,
      data: media.dataUrl && String(media.dataUrl).startsWith('data:') ? media.dataUrl : null,
      url: media.url || (media.dataUrl && !String(media.dataUrl).startsWith('data:') ? media.dataUrl : null),
      name: media.name || 'reply'
    } : null;
    emit('chat:needs-send', {
      conversationId: dm.conversationId,
      content: value,
      novaId: status.nova_id,
      media: mediaPayload,
      statusReply: {
        id: status.id,
        author: status.display_name,
        content: status.content || (status.media_type === 'video' ? 'Video' : status.media_type === 'image' ? 'Photo' : 'Status'),
        media_url: status.media_url || null,
        media_type: status.media_type || null,
        created_at: status.created_at
      }
    });
    closeViewer();
  } catch (err) {
    toast(err instanceof ApiError ? err.message : 'Could not send reply');
  }
}

export { readFile };
