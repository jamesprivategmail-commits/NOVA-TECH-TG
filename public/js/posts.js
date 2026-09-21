// posts.js - updates feed: compose, like, comment, delete
import { api } from './api.js';
import { state } from './state.js';
import {
  $, avatar, icon, escapeHtml, timeAgo, emptyState, errorState, skeletonList,
  toast, openSheet, closeSheet, confirmSheet, setBusy, fileToDataUrl, verifyBadge
} from './ui.js';

let els = {};
let composeImage = null;

export function initPosts() {
  els = { list: $('#posts-list') };
  els.list.innerHTML = composeHtml() + '<div id="posts-feed"></div>';
  wireComposer();
  loadPosts();
}

function composeHtml() {
  return `<form class="composer-inline" id="post-composer">
    <textarea id="post-caption" placeholder="Share something..." maxlength="500"></textarea>
    <div id="post-preview"></div>
    <div class="toolbar">
      <input type="file" id="post-image-input" accept="image/*,video/*" class="hidden">
      <button type="button" class="icon-btn" id="post-image-btn" aria-label="Add photo or video" title="Add photo or video">${icon('image')}</button>
      <span class="spacer"></span>
      <button type="submit" class="btn btn-primary btn-sm" id="post-submit">Post</button>
    </div>
  </form>`;
}

function wireComposer() {
  $('#post-image-btn')?.addEventListener('click', () => $('#post-image-input').click());
  $('#post-image-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) { composeImage = null; $('#post-preview').innerHTML = ''; return; }
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { toast('Choose an image or video'); e.target.value = ''; return; }
    if (file.size > 30 * 1024 * 1024) { toast('Media too large (max 30MB)'); e.target.value = ''; return; }
    try {
      const dataUrl = await fileToDataUrl(file);
      composeImage = { dataUrl, mime: file.type };
      $('#post-preview').innerHTML = file.type.startsWith('video/')
        ? `<div class="post-image"><video src="${escapeHtml(dataUrl)}" controls style="width:100%;max-height:320px;border-radius:12px"></video></div>`
        : `<div class="post-image"><img src="${escapeHtml(dataUrl)}" alt=""></div>`;
    } catch { toast('Could not read image'); }
  });
  $('#post-composer')?.addEventListener('submit', onPost);
}

async function onPost(e) {
  e.preventDefault();
  const caption = $('#post-caption').value.trim();
  if (!caption && !composeImage) { toast('Add a caption or a photo or video'); return; }
  const btn = $('#post-submit');
  setBusy(btn, true, 'Posting...');
  try {
    await api.createPost({ caption, imageData: composeImage?.dataUrl || null, imageMime: composeImage?.mime || null });
    $('#post-caption').value = '';
    composeImage = null;
    $('#post-preview').innerHTML = '';
    $('#post-image-input').value = '';
    toast('Posted', 'success');
    loadPosts();
  } catch (err) {
    toast(err.message || 'Could not post');
  } finally {
    setBusy(btn, false);
  }
}

export async function loadPosts() {
  const feed = $('#posts-feed');
  if (!feed) return;
  feed.innerHTML = skeletonList(4);
  try {
    const res = await api.posts();
    state.posts = res.posts || [];
    renderPosts();
  } catch (err) {
    feed.innerHTML = errorState({ title: 'Could not load updates', subtitle: err.message, retryId: 'retry-posts' });
    $('#retry-posts')?.addEventListener('click', loadPosts);
  }
}

function renderPosts() {
  const feed = $('#posts-feed');
  if (!feed) return;
  if (!state.posts.length) {
    feed.innerHTML = emptyState({ iconName: 'updates', title: 'No updates yet', subtitle: 'Be the first to share something.' });
    return;
  }
  feed.innerHTML = state.posts.map(postHtml).join('');
  feed.querySelectorAll('[data-like]').forEach((btn) => btn.addEventListener('click', () => toggleLike(btn.dataset.like)));
  feed.querySelectorAll('[data-comments]').forEach((btn) => btn.addEventListener('click', () => openComments(btn.dataset.comments)));
  feed.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', () => deletePost(btn.dataset.del)));
  feed.querySelectorAll('[data-open-post-image]').forEach((img) => img.addEventListener('click', () => {
    const url = img.getAttribute('data-open-post-image');
    const viewer = $('#viewer');
    viewer.hidden = false;
    viewer.innerHTML = `<div class="viewer-stage"><img src="${escapeHtml(url)}" alt=""></div>
      <div class="viewer-foot"><button class="btn btn-ghost btn-block" id="lightbox-close">Close</button></div>`;
    viewer.querySelector('#lightbox-close').addEventListener('click', () => { viewer.hidden = true; viewer.innerHTML = ''; });
  }));
}

function postHtml(p) {
  const own = String(p.user_id) === String(state.me?.id);
  const canDelete = own || !!state.me?.isAdmin;
  const image = p.image_url || p.image_data;
  const isVideo = String(p.image_mime || '').startsWith('video/');
  return `<article class="post" data-post="${escapeHtml(p.id)}">
    <div class="post-head">
      ${avatar({ displayName: p.display_name, avatarUrl: p.avatar_url, avatarColor: p.avatar_color }, { size: 'sm' })}
      <div class="post-info">
        <div class="post-author truncate">${escapeHtml(p.display_name || 'User')} ${verifyBadge(p.is_verified)}</div>
        <div class="post-time">${escapeHtml(timeAgo(p.created_at))}</div>
      </div>
      ${canDelete ? `<button class="icon-btn" data-del="${escapeHtml(p.id)}" aria-label="Delete post">${icon('trash')}</button>` : ''}
    </div>
    ${p.caption ? `<div class="post-caption">${escapeHtml(p.caption)}</div>` : ''}
    ${image ? (isVideo ? `<div class="post-image"><video src="${escapeHtml(image)}" controls preload="metadata" style="width:100%;max-height:480px;border-radius:12px"></video></div>` : `<div class="post-image"><img src="${escapeHtml(image)}" alt="" loading="lazy" data-open-post-image="${escapeHtml(image)}" onerror="this.closest('.post-image').remove()"></div>`) : ''}
    <div class="post-actions">
      <button class="post-action ${p.liked_by_me ? 'liked' : ''}" data-like="${escapeHtml(p.id)}" aria-label="Like">
        ${icon('heart')}<span>${p.like_count || 0}</span></button>
      <button class="post-action" data-comments="${escapeHtml(p.id)}" aria-label="Comments">
        ${icon('comment')}<span>${p.comment_count || 0}</span></button>
    </div>
  </article>`;
}

async function toggleLike(postId) {
  const post = state.posts.find((p) => p.id === postId);
  if (!post) return;
  const previous = post.liked_by_me;
  post.liked_by_me = !previous;
  post.like_count = Math.max(0, (post.like_count || 0) + (post.liked_by_me ? 1 : -1));
  renderPosts();
  try {
    const res = await api.likePost(postId);
    post.liked_by_me = res.liked;
    renderPosts();
  } catch (err) {
    post.liked_by_me = previous;
    post.like_count = Math.max(0, (post.like_count || 0) + (previous ? 1 : -1));
    renderPosts();
    toast(err.message || 'Could not like post');
  }
}

async function deletePost(postId) {
  const ok = await confirmSheet({ title: 'Delete update', message: 'Delete this update? This cannot be undone.', confirmText: 'Delete', danger: true });
  if (!ok) return;
  try {
    await api.deletePost(postId);
    state.posts = state.posts.filter((p) => p.id !== postId);
    renderPosts();
    toast('Deleted', 'success');
  } catch (err) {
    toast(err.message || 'Could not delete');
  }
}

function openComments(postId) {
  openSheet({
    title: 'Comments',
    body: '<div id="comments-body">' + skeletonList(3) + '</div>',
    onMount(sheet) {
      const form = document.createElement('form');
      form.className = 'sheet-pad row';
      form.innerHTML = `<input class="input grow" id="comment-input" placeholder="Add a comment..." maxlength="500" autocomplete="off">
        <button class="btn btn-primary" type="submit" aria-label="Send comment">${icon('send')}</button>`;
      sheet.appendChild(form);
      loadComments(postId, sheet.querySelector('#comments-body'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = sheet.querySelector('#comment-input');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        try {
          await api.addComment(postId, text);
          const post = state.posts.find((p) => p.id === postId);
          if (post) post.comment_count = (post.comment_count || 0) + 1;
          loadComments(postId, sheet.querySelector('#comments-body'));
          renderPosts();
        } catch (err) {
          toast(err.message || 'Could not comment');
        }
      });
    }
  });
}

async function loadComments(postId, container) {
  if (!container) return;
  try {
    const res = await api.comments(postId);
    const comments = res.comments || [];
    if (!comments.length) {
      container.innerHTML = emptyState({ iconName: 'comment', title: 'No comments yet', subtitle: 'Be the first to comment.' });
      return;
    }
    container.innerHTML = comments.map((c) => `<div class="comment-row">
      ${avatar({ displayName: c.display_name, avatarUrl: c.avatar_url, avatarColor: c.avatar_color }, { size: 'sm' })}
      <div class="comment-body">
        <div class="comment-name">${escapeHtml(c.display_name || 'User')} ${verifyBadge(c.is_verified)}</div>
        <div class="comment-text">${escapeHtml(c.content)}</div>
        <div class="post-time">${escapeHtml(timeAgo(c.created_at))}</div>
      </div>
    </div>`).join('');
  } catch (err) {
    container.innerHTML = errorState({ title: 'Could not load comments', subtitle: err.message, retryId: 'retry-comments' });
    container.querySelector('#retry-comments')?.addEventListener('click', () => loadComments(postId, container));
  }
}
