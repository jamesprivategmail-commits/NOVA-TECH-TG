// posts.js - modern social feed / timeline for DARK CHAT Home
import { api, mediaSrc } from './api.js';
import { state, emit, on } from './state.js';
import {
  $, avatar, icon, escapeHtml, timeAgo, emptyState, errorState, skeletonList,
  toast, openSheet, closeSheet, confirmSheet, setBusy, fileToDataUrl, verifyBadge
} from './ui.js';
import { openUserProfileSheet } from './profile.js';

let els = {};
let composeMedia = []; // array of { dataUrl, mime, isVideo, filename }
let quoteTarget = null; // post being quoted
let currentDetailPostId = null;

export function initPosts() {
  els = {
    screen: $('#screen-posts'),
    list: $('#posts-list'),
    refreshBtn: $('#home-refresh-btn'),
    detailScreen: $('#screen-post-detail'),
    detailBack: $('#post-detail-back'),
    detailShare: $('#post-detail-share-btn'),
    detailContent: $('#post-detail-content'),
    detailReplyForm: $('#post-detail-reply-form'),
    detailReplyInput: $('#post-detail-reply-input'),
    detailReplySubmit: $('#post-detail-reply-submit')
  };

  els.list.innerHTML = composerHtml() + '<div id="posts-feed" class="posts-feed" role="feed"></div>';
  wireComposer();
  wireRefreshButton();
  wirePostDetail();

  on('me:updated', () => {
    updateComposerAvatar();
    renderPosts();
  });
}

function updateComposerAvatar() {
  const avatarWrap = $('#composer-author-avatar');
  if (avatarWrap && state.me) {
    avatarWrap.innerHTML = avatar(state.me, { size: 'sm' });
  }
}

function wireRefreshButton() {
  els.refreshBtn?.addEventListener('click', async () => {
    const iconEl = els.refreshBtn.querySelector('.icon');
    iconEl?.classList.add('spin-anim');
    await loadPosts();
    setTimeout(() => iconEl?.classList.remove('spin-anim'), 400);
  });
}

function composerHtml() {
  const me = state.me || {};
  return `<form class="home-composer-card" id="post-composer" autocomplete="off">
    <div class="composer-top-row">
      <div class="composer-avatar" id="composer-author-avatar">
        ${avatar(me, { size: 'sm' })}
      </div>
      <div class="composer-input-area">
        <textarea id="post-caption" class="composer-textarea" placeholder="What's happening in DARKCHAT HOME?" maxlength="500" rows="2"></textarea>
        <div id="post-quote-box" class="composer-quote-box hidden"></div>
        <div id="post-preview" class="composer-media-grid hidden"></div>
      </div>
    </div>
    <div class="composer-bottom-bar">
      <div class="composer-tools">
        <input type="file" id="post-media-input" accept="image/*,video/*" multiple class="hidden">
        <button type="button" class="composer-tool-btn" id="post-media-btn" aria-label="Add photo or video" title="Add photo or video">
          ${icon('image')}
          <span class="tool-label">Media</span>
        </button>
      </div>
      <div class="composer-status-right">
        <span class="char-count" id="composer-char-count">500</span>
        <button type="submit" class="btn btn-primary btn-sm composer-send-btn" id="post-submit">Post</button>
      </div>
    </div>
  </form>`;
}

function wireComposer() {
  const mediaInput = $('#post-media-input');
  const mediaBtn = $('#post-media-btn');
  const captionInput = $('#post-caption');
  const charCount = $('#composer-char-count');
  const composerForm = $('#post-composer');

  mediaBtn?.addEventListener('click', () => mediaInput?.click());

  captionInput?.addEventListener('input', () => {
    // Auto-grow textarea
    captionInput.style.height = 'auto';
    captionInput.style.height = `${Math.min(180, captionInput.scrollHeight)}px`;
    const remaining = 500 - captionInput.value.length;
    if (charCount) {
      charCount.textContent = remaining;
      charCount.classList.toggle('near-limit', remaining <= 30);
    }
  });

  mediaInput?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (composeMedia.length + files.length > 4) {
      toast('Maximum 4 photos/videos per post');
      e.target.value = '';
      return;
    }

    for (const file of files) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        toast('Only image and video files are supported');
        continue;
      }
      if (file.size > 50 * 1024 * 1024) {
        toast('Media too large (max 50MB per file)');
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        composeMedia.push({
          dataUrl,
          mime: file.type,
          isVideo: file.type.startsWith('video/'),
          filename: file.name
        });
      } catch {
        toast('Could not read media file');
      }
    }
    e.target.value = '';
    renderComposerPreviews();
  });

  composerForm?.addEventListener('submit', onPost);
}

function renderComposerPreviews() {
  const previewBox = $('#post-preview');
  if (!previewBox) return;

  if (composeMedia.length === 0) {
    previewBox.innerHTML = '';
    previewBox.classList.add('hidden');
    return;
  }

  previewBox.classList.remove('hidden');
  previewBox.setAttribute('data-count', String(composeMedia.length));
  previewBox.innerHTML = composeMedia.map((m, idx) => `
    <div class="composer-media-item ${m.isVideo ? 'is-video' : ''}">
      ${m.isVideo
        ? `<video src="${escapeHtml(m.dataUrl)}" playsinline preload="metadata"></video><span class="media-badge">VIDEO</span>`
        : `<img src="${escapeHtml(m.dataUrl)}" alt="Preview">`}
      <button type="button" class="composer-media-remove" data-remove-idx="${idx}" aria-label="Remove media" title="Remove">✕</button>
    </div>
  `).join('');

  previewBox.querySelectorAll('[data-remove-idx]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.removeIdx);
      if (!Number.isNaN(idx)) {
        composeMedia.splice(idx, 1);
        renderComposerPreviews();
      }
    });
  });
}

function renderComposerQuote() {
  const quoteBox = $('#post-quote-box');
  if (!quoteBox) return;

  if (!quoteTarget) {
    quoteBox.innerHTML = '';
    quoteBox.classList.add('hidden');
    return;
  }

  quoteBox.classList.remove('hidden');
  quoteBox.innerHTML = `
    <div class="quoted-preview-card">
      <div class="quoted-header">
        ${avatar({ displayName: quoteTarget.display_name, avatarUrl: quoteTarget.avatar_url, avatarColor: quoteTarget.avatar_color }, { size: 'xs' })}
        <span class="quoted-name">${escapeHtml(quoteTarget.display_name || 'User')}</span>
        ${verifyBadge(quoteTarget.is_verified)}
        <span class="quoted-handle">@${escapeHtml(quoteTarget.nova_id || '')}</span>
        <button type="button" class="quoted-remove-btn" id="quote-remove-btn" aria-label="Remove quote" title="Remove quote">✕</button>
      </div>
      ${quoteTarget.caption ? `<div class="quoted-caption truncate">${escapeHtml(quoteTarget.caption)}</div>` : ''}
    </div>
  `;

  quoteBox.querySelector('#quote-remove-btn')?.addEventListener('click', () => {
    quoteTarget = null;
    renderComposerQuote();
  });
}

export function startQuote(post) {
  quoteTarget = post;
  renderComposerQuote();
  const caption = $('#post-caption');
  caption?.focus();
  caption?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function onPost(e) {
  e.preventDefault();
  const captionInput = $('#post-caption');
  const caption = (captionInput?.value || '').trim();

  if (!caption && composeMedia.length === 0 && !quoteTarget) {
    toast('Add some text, photo/video, or a quote');
    captionInput?.focus();
    return;
  }

  const btn = $('#post-submit');
  setBusy(btn, true, 'Posting...');

  try {
    const payload = {
      caption,
      quotePostId: quoteTarget?.id || null,
      media: composeMedia.map((m) => ({ data: m.dataUrl, mime: m.mime }))
    };

    const res = await api.createPost(payload);

    // Reset composer state
    if (captionInput) {
      captionInput.value = '';
      captionInput.style.height = 'auto';
    }
    const charCount = $('#composer-char-count');
    if (charCount) charCount.textContent = '500';

    composeMedia = [];
    quoteTarget = null;
    renderComposerPreviews();
    renderComposerQuote();

    toast('Posted to DARKCHAT HOME', 'success');

    // Add new post to state immediately without full page reload
    if (res.post) {
      state.posts = [res.post, ...(state.posts || []).filter((p) => p.id !== res.post.id)];
      renderPosts();
    } else {
      loadPosts();
    }
  } catch (err) {
    toast(err.message || 'Could not post');
  } finally {
    setBusy(btn, false);
  }
}

export async function loadPosts() {
  const feed = $('#posts-feed');
  if (!feed) return;

  if (!state.posts || !state.posts.length) {
    feed.innerHTML = skeletonList(4);
  }

  try {
    const res = await api.posts();
    state.posts = res.posts || [];
    renderPosts();
  } catch (err) {
    if (!state.posts || !state.posts.length) {
      feed.innerHTML = errorState({
        title: 'Could not load updates',
        subtitle: err.message,
        retryId: 'retry-posts'
      });
      $('#retry-posts')?.addEventListener('click', loadPosts);
    }
  }
}

function renderPosts() {
  const feed = $('#posts-feed');
  if (!feed) return;

  if (!state.posts || !state.posts.length) {
    feed.innerHTML = emptyState({
      iconName: 'updates',
      title: 'No updates yet',
      subtitle: 'Share something with DARKCHAT HOME to start the conversation.'
    });
    return;
  }

  feed.innerHTML = state.posts.map(postHtml).join('');
  wirePostCards(feed);
}

function wirePostCards(container) {
  // Author profile click
  container.querySelectorAll('[data-author-profile]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = el.getAttribute('data-author-profile');
      if (uid) openProfile(uid);
    });
  });

  // Like button
  container.querySelectorAll('[data-like]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLike(btn.dataset.like);
    });
  });

  // Repost button
  container.querySelectorAll('[data-repost]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleRepost(btn.dataset.repost);
    });
  });

  // Quote button
  container.querySelectorAll('[data-quote]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.quote;
      const post = state.posts.find((p) => p.id === postId);
      if (post) startQuote(post);
    });
  });

  // Bookmark button
  container.querySelectorAll('[data-bookmark]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBookmark(btn.dataset.bookmark);
    });
  });

  // Reply / Comments button
  container.querySelectorAll('[data-reply]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPostDetail(btn.dataset.reply);
    });
  });

  // Share button
  container.querySelectorAll('[data-share]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.share;
      const post = state.posts.find((p) => p.id === postId);
      if (post) sharePost(post);
    });
  });

  // More menu (...)
  container.querySelectorAll('[data-post-more]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const postId = btn.dataset.postMore;
      const post = state.posts.find((p) => p.id === postId);
      if (post) openPostOptionsMenu(post);
    });
  });

  // Quoted card click -> open quoted post in detail
  container.querySelectorAll('[data-open-quoted]').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const quotedId = card.getAttribute('data-open-quoted');
      if (quotedId) openPostDetail(quotedId);
    });
  });

  // Post card tap -> open detail view (if not clicked an inner interactive element)
  container.querySelectorAll('.post-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, textarea, video, .post-more-btn, .post-action-btn, .post-author-link, .quoted-card')) {
        return;
      }
      const postId = card.dataset.post;
      if (postId) openPostDetail(postId);
    });
  });

  // Lightbox for media
  container.querySelectorAll('[data-lightbox-media]').forEach((mediaEl) => {
    mediaEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const src = mediaEl.getAttribute('data-lightbox-media');
      const isVid = mediaEl.getAttribute('data-is-video') === '1';
      openMediaLightbox(src, isVid);
    });
  });
}

function postHtml(p) {
  const own = String(p.user_id) === String(state.me?.id) || (p.nova_id && String(p.nova_id).toUpperCase() === String(state.me?.novaId || '').toUpperCase());
  const canDelete = own || Boolean(state.me?.isAdmin || state.me?.is_admin);

  // Normalize media items array
  const mediaList = Array.isArray(p.media_items) && p.media_items.length > 0
    ? p.media_items
    : (p.image_url ? [{ url: p.image_url, mime: p.image_mime || 'image/jpeg', type: String(p.image_mime).startsWith('video/') ? 'video' : 'image' }] : []);

  return `<article class="post-card" data-post="${escapeHtml(p.id)}">
    <div class="post-card-inner">
      <div class="post-card-aside">
        <button type="button" class="post-avatar-btn" data-author-profile="${escapeHtml(p.user_id)}" aria-label="View profile of ${escapeHtml(p.display_name || 'user')}">
          ${avatar({ displayName: p.display_name, avatarUrl: p.avatar_url, avatarColor: p.avatar_color }, { size: 'sm' })}
        </button>
      </div>

      <div class="post-card-main">
        <div class="post-card-head">
          <div class="post-author-meta">
            <button type="button" class="post-author-link truncate" data-author-profile="${escapeHtml(p.user_id)}">
              <span class="post-display-name">${escapeHtml(p.display_name || 'DARK CHAT User')}</span>
              ${verifyBadge(p.is_verified)}
            </button>
            <span class="post-handle truncate">@${escapeHtml(p.nova_id || '')}</span>
            <span class="post-dot">·</span>
            <time class="post-timestamp">${escapeHtml(timeAgo(p.created_at))}</time>
          </div>
          <button type="button" class="post-more-btn" data-post-more="${escapeHtml(p.id)}" aria-label="More options" title="More options">
            ${icon('more-vertical')}
          </button>
        </div>

        ${p.caption ? `<div class="post-caption-text">${formatCaption(p.caption)}</div>` : ''}

        ${mediaList.length > 0 ? renderMediaGallery(mediaList) : ''}

        ${p.quote_post ? renderQuotedCard(p.quote_post) : ''}

        <div class="post-action-bar">
          <!-- Reply -->
          <button type="button" class="post-action-btn action-reply" data-reply="${escapeHtml(p.id)}" aria-label="Replies">
            ${icon('comment')}
            <span class="action-count">${p.comment_count || 0}</span>
          </button>

          <!-- Repost -->
          <button type="button" class="post-action-btn action-repost ${p.reposted_by_me ? 'active' : ''}" data-repost="${escapeHtml(p.id)}" aria-label="Repost">
            ${icon('repeat')}
            <span class="action-count">${p.repost_count || 0}</span>
          </button>

          <!-- Like -->
          <button type="button" class="post-action-btn action-like ${p.liked_by_me ? 'active' : ''}" data-like="${escapeHtml(p.id)}" aria-label="Like">
            ${icon('heart')}
            <span class="action-count">${p.like_count || 0}</span>
          </button>

          <!-- Bookmark -->
          <button type="button" class="post-action-btn action-bookmark ${p.bookmarked_by_me ? 'active' : ''}" data-bookmark="${escapeHtml(p.id)}" aria-label="Bookmark" title="Bookmark">
            ${icon('bookmark')}
          </button>

          <!-- Quote -->
          <button type="button" class="post-action-btn action-quote" data-quote="${escapeHtml(p.id)}" aria-label="Quote post" title="Quote post">
            ${icon('quote')}
          </button>

          <!-- Share -->
          <button type="button" class="post-action-btn action-share" data-share="${escapeHtml(p.id)}" aria-label="Share post" title="Share post">
            ${icon('share')}
          </button>
        </div>
      </div>
    </div>
  </article>`;
}

function renderMediaGallery(mediaList) {
  const count = Math.min(mediaList.length, 4);
  return `<div class="post-gallery" data-layout="${count}">
    ${mediaList.slice(0, 4).map((item) => {
      const src = mediaSrc(item.url);
      const isVideo = String(item.mime || '').startsWith('video/')
        || item.type === 'video'
        || /\.(mp4|webm|mov|mkv)(\?.*)?$/i.test(src);

      if (isVideo) {
        return `<div class="gallery-cell is-video">
          <video src="${escapeHtml(src)}" playsinline controls preload="metadata" data-lightbox-media="${escapeHtml(src)}" data-is-video="1"></video>
          <span class="media-video-badge">VIDEO</span>
        </div>`;
      }
      return `<div class="gallery-cell">
        <img src="${escapeHtml(src)}" alt="Photo" loading="lazy" data-lightbox-media="${escapeHtml(src)}" data-is-video="0" onerror="this.onerror=null;this.classList.add('media-failed');">
      </div>`;
    }).join('')}
  </div>`;
}

function renderQuotedCard(quoted) {
  const rawImage = quoted.image_url || quoted.image_data;
  const image = rawImage ? mediaSrc(rawImage) : null;
  const isVideo = String(quoted.image_mime || '').startsWith('video/');

  return `<div class="quoted-card" data-open-quoted="${escapeHtml(quoted.id)}">
    <div class="quoted-head">
      ${avatar({ displayName: quoted.display_name, avatarUrl: quoted.avatar_url, avatarColor: quoted.avatar_color }, { size: 'xs' })}
      <span class="quoted-name">${escapeHtml(quoted.display_name || 'User')}</span>
      ${verifyBadge(quoted.is_verified)}
      <span class="quoted-handle">@${escapeHtml(quoted.nova_id || '')}</span>
      <span class="quoted-dot">·</span>
      <time class="quoted-time">${escapeHtml(timeAgo(quoted.created_at))}</time>
    </div>
    ${quoted.caption ? `<div class="quoted-caption">${formatCaption(quoted.caption)}</div>` : ''}
    ${image ? `<div class="quoted-media">
      ${isVideo
        ? `<video src="${escapeHtml(image)}" preload="metadata" playsinline></video>`
        : `<img src="${escapeHtml(image)}" alt="" loading="lazy">`}
    </div>` : ''}
  </div>`;
}

function formatCaption(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  // Auto-link URLs
  const withLinks = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="post-inline-link" onclick="event.stopPropagation()">$1</a>');
  // Auto-link #hashtags
  const withTags = withLinks.replace(/(#[\w\d_-]+)/g, '<span class="post-hashtag">$1</span>');
  return withTags;
}

// ---------------- POST DETAIL SCREEN (CONVERSATION VIEW) ----------------
function wirePostDetail() {
  els.detailBack?.addEventListener('click', () => {
    closePostDetail();
  });

  els.detailShare?.addEventListener('click', () => {
    if (!currentDetailPostId) return;
    const post = state.posts?.find((p) => p.id === currentDetailPostId);
    if (post) sharePost(post);
  });

  els.detailReplyForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentDetailPostId) return;
    const input = els.detailReplyInput;
    const content = (input?.value || '').trim();
    if (!content) return;

    const submitBtn = els.detailReplySubmit;
    setBusy(submitBtn, true, '...');
    try {
      await api.addComment(currentDetailPostId, content);
      input.value = '';
      // Update local post comment count
      const post = state.posts?.find((p) => p.id === currentDetailPostId);
      if (post) post.comment_count = (post.comment_count || 0) + 1;
      renderPosts();
      loadPostDetailComments(currentDetailPostId);
      toast('Reply sent', 'success');
    } catch (err) {
      toast(err.message || 'Could not send reply');
    } finally {
      setBusy(submitBtn, false);
    }
  });
}

export function isPostDetailOpen() {
  return els.detailScreen && !els.detailScreen.classList.contains('hidden');
}

export function closePostDetail() {
  currentDetailPostId = null;
  if (!els.detailScreen) return;
  els.detailScreen.classList.add('hidden');
  els.detailScreen.hidden = true;
  document.querySelectorAll('.screen-list').forEach((s) => s.classList.remove('chat-open'));
}

export async function openPostDetail(postId) {
  if (!postId) return;
  currentDetailPostId = postId;

  // SPA navigation history entry so Back returns to Updates
  const appUrl = location.href.split('#')[0];
  history.pushState({ app: true, tab: 'posts', postDetail: postId }, '', `${appUrl}#post`);

  if (!els.detailScreen) return;
  els.detailScreen.hidden = false;
  els.detailScreen.classList.remove('hidden');
  document.querySelectorAll('.screen-list').forEach((s) => s.classList.add('chat-open'));

  els.detailContent.innerHTML = `<div class="sheet-pad">${skeletonList(3)}</div>`;

  try {
    const res = await api.postDetails(postId);
    const post = res.post;
    if (!post) {
      els.detailContent.innerHTML = errorState({ title: 'Post not found', subtitle: 'This update may have been removed.' });
      return;
    }
    renderPostDetailView(post);
    loadPostDetailComments(postId);
  } catch (err) {
    els.detailContent.innerHTML = errorState({ title: 'Could not load post', subtitle: err.message });
  }
}

function renderPostDetailView(post) {
  const rawImage = post.image_url || post.image_data;
  const mediaList = Array.isArray(post.media_items) && post.media_items.length > 0
    ? post.media_items
    : (rawImage ? [{ url: rawImage, mime: post.image_mime || 'image/jpeg', type: String(post.image_mime).startsWith('video/') ? 'video' : 'image' }] : []);

  els.detailContent.innerHTML = `
    <article class="post-detail-card" data-post="${escapeHtml(post.id)}">
      <div class="post-detail-head">
        <button type="button" class="post-avatar-btn" data-author-profile="${escapeHtml(post.user_id)}" aria-label="View profile">
          ${avatar({ displayName: post.display_name, avatarUrl: post.avatar_url, avatarColor: post.avatar_color }, { size: 'md' })}
        </button>
        <div class="post-detail-author-info">
          <button type="button" class="post-author-link" data-author-profile="${escapeHtml(post.user_id)}">
            <span class="post-display-name">${escapeHtml(post.display_name || 'User')}</span>
            ${verifyBadge(post.is_verified)}
          </button>
          <span class="post-handle">@${escapeHtml(post.nova_id || '')}</span>
        </div>
        <button type="button" class="post-more-btn" data-post-more="${escapeHtml(post.id)}" aria-label="More options">
          ${icon('more-vertical')}
        </button>
      </div>

      ${post.caption ? `<div class="post-detail-caption">${formatCaption(post.caption)}</div>` : ''}

      ${mediaList.length > 0 ? renderMediaGallery(mediaList) : ''}

      ${post.quote_post ? renderQuotedCard(post.quote_post) : ''}

      <div class="post-detail-time-row">
        <time>${new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${new Date(post.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</time>
      </div>

      <div class="post-detail-stats-row">
        <div class="stat-item"><b>${post.like_count || 0}</b> <span>Likes</span></div>
        <div class="stat-item"><b>${post.repost_count || 0}</b> <span>Reposts</span></div>
        <div class="stat-item"><b>${post.comment_count || 0}</b> <span>Replies</span></div>
      </div>

      <div class="post-action-bar detail-actions">
        <button type="button" class="post-action-btn action-reply" id="detail-reply-focus" aria-label="Reply">
          ${icon('comment')}
        </button>
        <button type="button" class="post-action-btn action-repost ${post.reposted_by_me ? 'active' : ''}" data-like-detail="repost" aria-label="Repost">
          ${icon('repeat')}
        </button>
        <button type="button" class="post-action-btn action-like ${post.liked_by_me ? 'active' : ''}" data-like-detail="like" aria-label="Like">
          ${icon('heart')}
        </button>
        <button type="button" class="post-action-btn action-bookmark ${post.bookmarked_by_me ? 'active' : ''}" data-like-detail="bookmark" aria-label="Bookmark">
          ${icon('bookmark')}
        </button>
        <button type="button" class="post-action-btn action-quote" data-like-detail="quote" aria-label="Quote">
          ${icon('quote')}
        </button>
        <button type="button" class="post-action-btn action-share" data-like-detail="share" aria-label="Share">
          ${icon('share')}
        </button>
      </div>
    </article>

    <div class="replies-header">
      <span>Replies</span>
    </div>
    <div id="post-detail-comments-container" class="post-detail-comments">
      ${skeletonList(2)}
    </div>
  `;

  // Wire actions inside detail view
  els.detailContent.querySelector('#detail-reply-focus')?.addEventListener('click', () => {
    els.detailReplyInput?.focus();
  });

  els.detailContent.querySelector('[data-like-detail="like"]')?.addEventListener('click', async () => {
    await toggleLike(post.id);
    const updated = state.posts.find((p) => p.id === post.id);
    if (updated) renderPostDetailView(updated);
  });

  els.detailContent.querySelector('[data-like-detail="repost"]')?.addEventListener('click', async () => {
    await toggleRepost(post.id);
    const updated = state.posts.find((p) => p.id === post.id);
    if (updated) renderPostDetailView(updated);
  });

  els.detailContent.querySelector('[data-like-detail="bookmark"]')?.addEventListener('click', async () => {
    await toggleBookmark(post.id);
    const updated = state.posts.find((p) => p.id === post.id);
    if (updated) renderPostDetailView(updated);
  });

  els.detailContent.querySelector('[data-like-detail="quote"]')?.addEventListener('click', () => {
    closePostDetail();
    startQuote(post);
  });

  els.detailContent.querySelector('[data-like-detail="share"]')?.addEventListener('click', () => {
    sharePost(post);
  });

  els.detailContent.querySelectorAll('[data-author-profile]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openProfile(el.getAttribute('data-author-profile'));
    });
  });

  els.detailContent.querySelectorAll('[data-post-more]').forEach((btn) => {
    btn.addEventListener('click', () => openPostOptionsMenu(post));
  });

  els.detailContent.querySelectorAll('[data-lightbox-media]').forEach((mediaEl) => {
    mediaEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const src = mediaEl.getAttribute('data-lightbox-media');
      const isVid = mediaEl.getAttribute('data-is-video') === '1';
      openMediaLightbox(src, isVid);
    });
  });
}

async function loadPostDetailComments(postId) {
  const container = $('#post-detail-comments-container');
  if (!container) return;

  try {
    const res = await api.comments(postId);
    const comments = res.comments || [];
    if (!comments.length) {
      container.innerHTML = `<div class="empty-comments-state">${icon('comment')}<p>No replies yet. Be the first to reply!</p></div>`;
      return;
    }

    container.innerHTML = comments.map((c) => `
      <div class="comment-thread-item">
        <button type="button" class="post-avatar-btn" data-author-profile="${escapeHtml(c.user_id)}" aria-label="View profile">
          ${avatar({ displayName: c.display_name, avatarUrl: c.avatar_url, avatarColor: c.avatar_color }, { size: 'sm' })}
        </button>
        <div class="comment-thread-content">
          <div class="comment-author-row">
            <button type="button" class="post-author-link" data-author-profile="${escapeHtml(c.user_id)}">
              <span class="post-display-name">${escapeHtml(c.display_name || 'User')}</span>
              ${verifyBadge(c.is_verified)}
            </button>
            <span class="comment-time">${escapeHtml(timeAgo(c.created_at))}</span>
          </div>
          <div class="comment-thread-text">${formatCaption(c.content)}</div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-author-profile]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openProfile(el.getAttribute('data-author-profile'));
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="muted center pad">Could not load replies</div>`;
  }
}

// ---------------- ACTIONS: LIKE, REPOST, BOOKMARK, DELETE, SHARE ----------------
async function toggleLike(postId) {
  const post = state.posts?.find((p) => p.id === postId);
  if (!post) return;

  const previous = post.liked_by_me;
  post.liked_by_me = !previous;
  post.like_count = Math.max(0, (post.like_count || 0) + (post.liked_by_me ? 1 : -1));
  renderPosts();

  try {
    const res = await api.likePost(postId);
    post.liked_by_me = res.liked;
    post.like_count = res.likeCount;
    renderPosts();
  } catch (err) {
    post.liked_by_me = previous;
    post.like_count = Math.max(0, (post.like_count || 0) + (previous ? 1 : -1));
    renderPosts();
    toast(err.message || 'Could not like post');
  }
}

async function toggleRepost(postId) {
  const post = state.posts?.find((p) => p.id === postId);
  if (!post) return;

  const previous = post.reposted_by_me;
  post.reposted_by_me = !previous;
  post.repost_count = Math.max(0, (post.repost_count || 0) + (post.reposted_by_me ? 1 : -1));
  renderPosts();

  try {
    const res = await api.repostPost(postId);
    post.reposted_by_me = res.reposted;
    post.repost_count = res.repostCount;
    renderPosts();
    toast(res.reposted ? 'Reposted to DARK CHAT' : 'Removed repost');
  } catch (err) {
    post.reposted_by_me = previous;
    post.repost_count = Math.max(0, (post.repost_count || 0) + (previous ? 1 : -1));
    renderPosts();
    toast(err.message || 'Could not repost');
  }
}

async function toggleBookmark(postId) {
  const post = state.posts?.find((p) => p.id === postId);
  if (!post) return;

  const previous = post.bookmarked_by_me;
  post.bookmarked_by_me = !previous;
  post.bookmark_count = Math.max(0, (post.bookmark_count || 0) + (post.bookmarked_by_me ? 1 : -1));
  renderPosts();

  try {
    const res = await api.bookmarkPost(postId);
    post.bookmarked_by_me = res.bookmarked;
    post.bookmark_count = res.bookmarkCount;
    renderPosts();
    toast(res.bookmarked ? 'Saved to Bookmarks' : 'Removed from Bookmarks');
  } catch (err) {
    post.bookmarked_by_me = previous;
    post.bookmark_count = Math.max(0, (post.bookmark_count || 0) + (previous ? 1 : -1));
    renderPosts();
    toast(err.message || 'Could not bookmark');
  }
}

async function deletePostAction(postId) {
  const ok = await confirmSheet({
    title: 'Delete update',
    message: 'Are you sure you want to delete this post? This cannot be undone.',
    confirmText: 'Delete',
    danger: true
  });
  if (!ok) return;

  try {
    await api.deletePost(postId);
    state.posts = (state.posts || []).filter((p) => p.id !== postId);
    renderPosts();
    if (currentDetailPostId === postId) {
      closePostDetail();
    }
    toast('Post deleted', 'success');
  } catch (err) {
    toast(err.message || 'Could not delete post');
  }
}

function sharePost(post) {
  const postUrl = `${location.origin}#post_${post.id}`;
  const shareText = post.caption ? `${post.display_name}: "${post.caption}"` : `Update by ${post.display_name} on DARK CHAT`;

  if (navigator.share) {
    navigator.share({
      title: 'DARK CHAT Update',
      text: shareText,
      url: postUrl
    }).catch(() => {
      copyPostLink(postUrl);
    });
  } else {
    copyPostLink(postUrl);
  }
}

function copyPostLink(url) {
  try {
    navigator.clipboard.writeText(url);
    toast('Link copied to clipboard', 'success');
  } catch {
    toast(url);
  }
}

function openPostOptionsMenu(post) {
  const isOwn = String(post.user_id) === String(state.me?.id) || (post.nova_id && String(post.nova_id).toUpperCase() === String(state.me?.novaId || '').toUpperCase());
  const canDelete = isOwn || Boolean(state.me?.isAdmin || state.me?.is_admin);

  const options = [];
  options.push(`<button class="option" data-post-act="copy">${icon('link')}<span class="option-copy">Copy link to post</span></button>`);
  options.push(`<button class="option" data-post-act="share">${icon('share')}<span class="option-copy">Share post</span></button>`);
  options.push(`<button class="option" data-post-act="quote">${icon('quote')}<span class="option-copy">Quote post</span></button>`);
  options.push(`<button class="option" data-post-act="profile">${icon('user')}<span class="option-copy">View author profile<small>${escapeHtml(post.display_name)}</small></span></button>`);
  if (canDelete) {
    options.push(`<button class="option danger" data-post-act="delete">${icon('trash')}<span class="option-copy">Delete post</span></button>`);
  }

  openSheet({
    title: 'Post options',
    body: `<div class="sheet-body">${options.join('')}</div>`,
    onMount(sheet) {
      sheet.querySelectorAll('[data-post-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.postAct;
          closeSheet();
          if (act === 'copy') copyPostLink(`${location.origin}#post_${post.id}`);
          if (act === 'share') sharePost(post);
          if (act === 'quote') startQuote(post);
          if (act === 'profile') openProfile(post.user_id);
          if (act === 'delete') deletePostAction(post.id);
        });
      });
    }
  });
}

function openProfile(userId) {
  if (!userId) return;
  if (String(userId) === String(state.me?.id)) {
    emit('tab:show', 'profile');
  } else {
    openUserProfileSheet(userId);
  }
}

function openMediaLightbox(url, isVideo) {
  const viewer = $('#viewer');
  if (!viewer) return;
  viewer.hidden = false;
  viewer.innerHTML = `
    <button type="button" class="viewer-lightbox-close" id="lightbox-close" aria-label="Close" title="Close">${icon('x')}</button>
    <div class="viewer-stage">
      ${isVideo
        ? `<video src="${escapeHtml(url)}" controls autoplay playsinline style="max-width:96vw;max-height:86vh;border-radius:12px;background:#000"></video>`
        : `<img src="${escapeHtml(url)}" alt="Full view" style="max-width:96vw;max-height:86vh;object-fit:contain;border-radius:12px">`}
    </div>
  `;
  viewer.tabIndex = -1;
  viewer.querySelector('#lightbox-close')?.addEventListener('click', closeMediaLightbox);
  viewer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMediaLightbox();
  }, { once: true });
  viewer.focus?.();
}

function closeMediaLightbox() {
  const viewer = $('#viewer');
  if (!viewer) return;
  viewer.hidden = true;
  viewer.innerHTML = '';
}
