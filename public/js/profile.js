// profile.js - own profile screen and profile editing
import { api } from './api.js';
import { state, emit, on, saveCachedMe } from './state.js';
import {
  $, avatar, icon, escapeHtml, toast, openSheet, closeSheet, confirmSheet, setBusy, verifyBadge, fileToDataUrl, renderQrSvg
} from './ui.js';
import { openSettingsSheet } from './settings.js';
import { postHtml, wirePostCards } from './posts.js';

export function initProfile() {
  on('me:updated', () => renderProfile());
  on('settings:changed', () => renderProfile());
  on('tab:show', (tab) => {
    if (tab === 'profile') {
      renderProfile();
      loadUserPosts();
    }
  });
  on('posts:updated', () => {
    const screen = $('#screen-profile');
    if (screen && !screen.hidden) {
      renderUserPosts();
    }
  });
  on('admin:open', () => emit('admin:open-panel'));
  on('profile:edit', openEditProfileSheet);
  on('profile:photo', triggerPhotoPicker);
}

let fileInputEl = null;

function getPhotoInput() {
  if (!fileInputEl) {
    fileInputEl = document.createElement('input');
    fileInputEl.type = 'file';
    fileInputEl.accept = 'image/*';
    fileInputEl.className = 'hidden';
    document.body.appendChild(fileInputEl);
    fileInputEl.addEventListener('change', onPhotoSelected);
  }
  return fileInputEl;
}

function triggerPhotoPicker() {
  const input = getPhotoInput();
  input.value = '';
  input.click();
}

async function onPhotoSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    toast('Image too large (maximum size is 8MB)');
    return;
  }
  try {
    const dataUrl = await fileToDataUrl(file);
    const mime = file.type || 'image/jpeg';
    openPhotoPreviewSheet(dataUrl, mime);
  } catch {
    toast('Could not read selected photo');
  }
}

function openPhotoPreviewSheet(dataUrl, mime) {
  openSheet({
    title: 'Profile Photo Preview',
    body: `<div class="sheet-pad stack" style="align-items:center;text-align:center">
      <div class="photo-crop-preview" style="width:140px;height:140px;border-radius:50%;overflow:hidden;margin:12px auto;border:3px solid rgba(255,255,255,0.2);box-shadow:0 8px 24px rgba(0,0,0,0.5)">
        <img src="${escapeHtml(dataUrl)}" alt="Preview" style="width:100%;height:100%;object-fit:cover">
      </div>
      <p class="muted" style="font-size:13px;max-width:280px">This photo will appear on your profile, chat list, and messages.</p>
    </div>`,
    footer: `<div class="sheet-pad row" style="gap:10px">
      <button class="btn btn-ghost grow" id="photo-preview-cancel" type="button">Cancel</button>
      <button class="btn btn-primary grow" id="photo-preview-save" type="button">Save Photo</button>
    </div>`,
    onMount(sheet) {
      sheet.querySelector('#photo-preview-cancel')?.addEventListener('click', closeSheet);
      sheet.querySelector('#photo-preview-save')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        setBusy(btn, true, 'Saving...');
        try {
          const res = await api.updateMe({ avatarData: dataUrl, avatarMime: mime });
          state.me = res.user;
          saveCachedMe(res.user);
          emit('me:updated', res.user);
          closeSheet();
          toast('Profile photo updated!', 'success');
        } catch (err) {
          toast(err.message || 'Could not save profile photo');
        } finally {
          setBusy(btn, false);
        }
      });
    }
  });
}

function getMyPosts() {
  const me = state.me;
  if (!me) return [];
  const myId = String(me.id);
  const myNovaId = String(me.novaId || '').toUpperCase();
  return (state.posts || []).filter((p) => {
    if (p.user_id && String(p.user_id) === myId) return true;
    if (p.author_id && String(p.author_id) === myId) return true;
    if (p.nova_id && String(p.nova_id).toUpperCase() === myNovaId) return true;
    return false;
  });
}

async function loadUserPosts() {
  try {
    const res = await api.posts();
    state.posts = res.posts || [];
    renderUserPosts();
  } catch {
    renderUserPosts();
  }
}

function renderUserPosts() {
  const container = $('#profile-posts-list');
  if (!container) return;
  const myPosts = getMyPosts();

  if (!myPosts.length) {
    container.innerHTML = `
      <div class="profile-posts-empty">
        <div class="empty-icon"><svg class="icon"><use href="#i-updates"></use></svg></div>
        <h3>No posts yet</h3>
        <p>Posts you publish in Updates will appear here on your profile page.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = myPosts.map(postHtml).join('');
  wirePostCards(container);
}

export function renderProfile() {
  const me = state.me;
  const content = $('#profile-content');
  if (!me || !content) return;
  const cover = me.avatarUrl || me.avatarData || '';

  content.innerHTML = `
    <!-- 1. HEADER IMAGE: max 35% height (max 280px), object-fit cover, dark gradient -->
    <div class="profile-header-wrap">
      <div class="profile-cover-box">
        ${cover ? `<img src="${escapeHtml(cover)}" alt="Cover" class="profile-cover-img">` : `<div class="profile-cover-fallback"></div>`}
        <div class="profile-cover-gradient" aria-hidden="true"></div>
        <button class="profile-nav-btn profile-back" id="profile-back" aria-label="Back to chats" title="Back to chats">
          <svg class="icon"><use href="#i-arrow-left"></use></svg>
        </button>
        <button class="profile-nav-btn profile-more" id="profile-more" aria-label="More options" title="More options">
          <svg class="icon"><use href="#i-more-vertical"></use></svg>
        </button>
      </div>
    </div>

    <!-- 2. NORMAL LAYOUT FLOW: name, status, and 3 action buttons below image (no overlap) -->
    <div class="profile-body">
      <div class="profile-avatar-row">
        <div class="profile-photo-circle">
          ${avatar(me, { size: 'lg' })}
        </div>
      </div>
      <div class="profile-meta">
        <h1 class="profile-name">${escapeHtml(me.displayName || 'You')} ${verifyBadge(me.isVerified)}</h1>
        <div class="profile-online">online</div>
        ${me.bio ? `<div class="profile-bio">${escapeHtml(me.bio)}</div>` : ''}
      </div>

      <!-- 3 ACTION BUTTONS -->
      <div class="profile-actions">
        <button type="button" class="btn profile-action-btn" id="profile-photo-action" title="Set photo">
          <span class="profile-action-icon"><svg class="icon"><use href="#i-camera"></use></svg></span>
          <span class="profile-action-text">Set Photo</span>
        </button>
        <button type="button" class="btn profile-action-btn" id="profile-edit-action" title="Edit info">
          <span class="profile-action-icon"><svg class="icon"><use href="#i-edit"></use></svg></span>
          <span class="profile-action-text">Edit Info</span>
        </button>
        <button type="button" class="btn profile-action-btn" id="profile-settings-action" title="Settings">
          <span class="profile-action-icon"><svg class="icon"><use href="#i-settings"></use></svg></span>
          <span class="profile-action-text">Settings</span>
        </button>
      </div>
    </div>

    <!-- INFO CARD -->
    <div class="profile-info-card">
      <div class="profile-info-title">
        <svg class="icon"><use href="#i-chevron-down"></use></svg>
        <span>Account Info</span>
      </div>
      <button type="button" class="profile-info-item-btn" id="profile-copy-id" title="Tap to copy DARK CHAT ID">
        <div class="profile-info-item-left">
          <b>${escapeHtml(me.novaId || 'Not set')}</b>
          <small>DARK CHAT ID (tap to copy)</small>
        </div>
        <svg class="icon info-copy-icon"><use href="#i-link"></use></svg>
      </button>
      ${me.bio ? `
      <div class="profile-info-item">
        <b>${escapeHtml(me.bio)}</b>
        <small>About / Bio</small>
      </div>` : ''}
    </div>

    <!-- POSTS SECTION (Only user's own posts) -->
    <div class="profile-tabs-bar">
      <div class="profile-tabs" role="tablist">
        <button class="profile-tab active" type="button">Posts</button>
      </div>
    </div>
    <div class="profile-posts-list" id="profile-posts-list"></div>
  `;

  // Wire up every single button to work cleanly
  content.querySelector('#profile-back')?.addEventListener('click', () => {
    emit('tab:show', 'chats');
  });

  content.querySelector('#profile-more')?.addEventListener('click', openProfileMoreMenu);

  content.querySelector('#profile-photo-action')?.addEventListener('click', triggerPhotoPicker);

  content.querySelector('#profile-edit-action')?.addEventListener('click', openEditProfileSheet);

  content.querySelector('#profile-settings-action')?.addEventListener('click', openSettingsSheet);

  content.querySelector('#profile-copy-id')?.addEventListener('click', async () => {
    const id = me.novaId || '';
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      toast('DARK CHAT ID copied to clipboard', 'success');
    } catch {
      toast(id);
    }
  });

  renderUserPosts();
}

function openProfileMoreMenu() {
  const me = state.me;
  if (!me) return;

  openSheet({
    title: 'Profile Options',
    body: `<div class="sheet-pad stack" style="gap:4px">
      <button class="setting" id="more-edit-info" type="button">
        <span class="setting-icon">${icon('edit')}</span>
        <span class="setting-copy">Edit Info<small>Update display name, bio, and profile details</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
      <button class="setting" id="more-settings" type="button">
        <span class="setting-icon">${icon('settings')}</span>
        <span class="setting-copy">Settings<small>Privacy, notifications, chat wallpaper, and security</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
      <button class="setting" id="more-share" type="button">
        <span class="setting-icon">${icon('share')}</span>
        <span class="setting-copy">Share Profile<small>Copy DARK CHAT ID and link for friends</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
      <button class="setting" id="more-logout" type="button" style="color:var(--danger)">
        <span class="setting-icon" style="color:var(--danger)">${icon('logout')}</span>
        <span class="setting-copy">Log Out<small style="color:var(--danger)">Sign out of DARK CHAT on this device</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
    </div>`,
    onMount(sheet) {
      sheet.querySelector('#more-edit-info')?.addEventListener('click', () => {
        closeSheet();
        openEditProfileSheet();
      });
      sheet.querySelector('#more-settings')?.addEventListener('click', () => {
        closeSheet();
        openSettingsSheet();
      });
      sheet.querySelector('#more-share')?.addEventListener('click', async () => {
        closeSheet();
        const link = `${window.location.origin}/#user=${encodeURIComponent(me.novaId)}`;
        try {
          await navigator.clipboard.writeText(link);
          toast('Profile link copied to clipboard!', 'success');
        } catch {
          toast(me.novaId || link);
        }
      });
      sheet.querySelector('#more-logout')?.addEventListener('click', async () => {
        closeSheet();
        const ok = await confirmSheet({
          title: 'Log out',
          message: 'Log out of DARK CHAT on this device?',
          confirmText: 'Log out',
          danger: true
        });
        if (ok) emit('auth:logout');
      });
    }
  });
}

export function openEditProfileSheet() {
  const me = state.me;
  if (!me) return;
  let avatarData = null;
  let avatarMime = null;

  openSheet({
    title: 'Edit Profile Info',
    body: `<div class="sheet-pad stack" style="gap:14px">
      <div id="edit-error" class="alert alert-error hidden"></div>
      <div class="center stack" style="align-items:center;margin:6px 0">
        <div id="edit-avatar-preview" style="cursor:pointer" title="Tap to change photo">
          ${avatar(me, { size: 'lg' })}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="edit-change-photo-btn" style="margin-top:6px">
          ${icon('camera')} Change Photo
        </button>
        <input class="hidden" type="file" id="edit-avatar-input" accept="image/*">
      </div>
      <label class="field">
        <span class="field-label">Display name</span>
        <input class="input" id="edit-name" maxlength="60" value="${escapeHtml(me.displayName || '')}" placeholder="What should people call you?" required autocomplete="off">
      </label>
      <label class="field">
        <span class="field-label">About / Bio</span>
        <textarea class="textarea" id="edit-bio" maxlength="160" rows="3" placeholder="Tell people about yourself">${escapeHtml(me.bio || '')}</textarea>
      </label>
      <label class="field">
        <span class="field-label">DARK CHAT ID (Permanent)</span>
        <input class="input" id="edit-id" value="${escapeHtml(me.novaId || '')}" readonly style="opacity:0.75;cursor:default">
      </label>
    </div>`,
    footer: `<div class="sheet-pad row" style="gap:10px">
      <button class="btn btn-ghost grow" id="edit-cancel" type="button">Cancel</button>
      <button class="btn btn-primary grow" id="edit-save" type="button">Save Changes</button>
    </div>`,
    onMount(sheet) {
      const fileInput = sheet.querySelector('#edit-avatar-input');
      sheet.querySelector('#edit-change-photo-btn')?.addEventListener('click', () => fileInput?.click());
      sheet.querySelector('#edit-avatar-preview')?.addEventListener('click', () => fileInput?.click());

      fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
          toast('Image too large (max 8MB)');
          e.target.value = '';
          return;
        }
        try {
          avatarData = await fileToDataUrl(file);
          avatarMime = file.type || 'image/jpeg';
          const preview = sheet.querySelector('#edit-avatar-preview');
          if (preview) {
            preview.innerHTML = `<img src="${escapeHtml(avatarData)}" alt="Avatar" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--text)">`;
          }
        } catch {
          toast('Could not read image');
        }
      });

      sheet.querySelector('#edit-cancel')?.addEventListener('click', closeSheet);

      sheet.querySelector('#edit-save')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const name = sheet.querySelector('#edit-name').value.trim();
        const bio = sheet.querySelector('#edit-bio').value;
        const errBox = sheet.querySelector('#edit-error');
        const fail = (m) => {
          errBox.textContent = m;
          errBox.classList.remove('hidden');
        };
        errBox.classList.add('hidden');

        if (!name) return fail('Display name cannot be empty');

        const payload = { displayName: name, bio };
        if (avatarData) {
          payload.avatarData = avatarData;
          payload.avatarMime = avatarMime;
        }

        setBusy(btn, true, 'Saving...');
        try {
          const res = await api.updateMe(payload);
          state.me = res.user;
          saveCachedMe(res.user);
          emit('me:updated', res.user);
          closeSheet();
          toast('Profile updated', 'success');
        } catch (err) {
          fail(err.message || 'Could not update profile');
        } finally {
          setBusy(btn, false);
        }
      });
    }
  });
}

export async function openUserProfileSheet(userOrId) {
  const userId = typeof userOrId === 'string' ? userOrId : userOrId?.id;
  if (!userId) return;

  if (String(userId) === String(state.me?.id)) {
    closeSheet();
    emit('tab:show', 'profile');
    return;
  }

  let user = typeof userOrId === 'object' && userOrId !== null ? { ...userOrId } : null;
  openSheet({
    title: 'User Profile',
    body: `<div class="sheet-pad center stack" id="user-profile-sheet-body">
      <div class="skeleton" style="width:80px;height:80px;border-radius:50%;margin:0 auto"></div>
      <div class="skeleton" style="width:160px;height:20px;margin:8px auto"></div>
    </div>`,
    async onMount(sheet) {
      const container = sheet.querySelector('#user-profile-sheet-body');
      try {
        const res = await api.userProfile(userId);
        user = res.user;
      } catch {
        if (!user) {
          container.innerHTML = `<div class="muted">Could not load user details</div>`;
          return;
        }
      }

      const isFollowing = Boolean(user.isFollowing);
      const acctType = user.accountType || 'personal';
      const typeBadge = acctType === 'business' ? '<span class="chip" style="background:#202020;color:#fff;font-size:11px">Business 💼</span>'
        : acctType === 'creator' ? '<span class="chip" style="background:#202020;color:#fff;font-size:11px">Creator ✨</span>'
        : '';

      container.innerHTML = `
        <div class="center" style="margin-bottom:6px">
          ${avatar({ displayName: user.displayName, avatarUrl: user.avatarUrl, avatarColor: user.avatarColor }, { size: 'lg' })}
        </div>
        <div style="font-size:19px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px">
          ${escapeHtml(user.displayName || 'DARK CHAT User')} ${verifyBadge(user.isVerified)} ${typeBadge}
        </div>
        <button type="button" class="profile-id-badge" id="sheet-user-id" title="Tap to copy">
          <span class="profile-id-label">DARK CHAT ID</span>
          <span class="profile-id-value">${escapeHtml(user.novaId || '')}</span>
        </button>
        ${user.bio ? `<div class="muted" style="font-size:13.5px;max-width:320px;margin:0 auto">${escapeHtml(user.bio)}</div>` : ''}
        <div class="row" style="justify-content:center;gap:8px;margin-top:10px;width:100%">
          <button class="btn ${isFollowing ? 'btn-ghost' : 'btn-primary'} grow" id="sheet-follow-btn">
            ${isFollowing ? 'Following' : `${icon('user-plus')} Follow`}
          </button>
          <button class="btn btn-primary grow" id="sheet-msg-btn">
            ${icon('message')} Message
          </button>
        </div>
      `;

      sheet.querySelector('#sheet-user-id')?.addEventListener('click', () => {
        if (!user.novaId) return;
        try {
          navigator.clipboard.writeText(user.novaId);
          toast('Copied DARK CHAT ID to clipboard', 'success');
        } catch {
          toast(user.novaId);
        }
      });

      sheet.querySelector('#sheet-follow-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const res = await api.followUser(user.id);
          user.isFollowing = res.following;
          btn.className = `btn ${res.following ? 'btn-ghost' : 'btn-primary'} grow`;
          btn.innerHTML = res.following ? 'Following' : `${icon('user-plus')} Follow`;
          toast(res.following ? `Following ${user.displayName || 'user'}` : `Unfollowed ${user.displayName || 'user'}`);
          emit('following:changed', { userId: user.id, isFollowing: res.following });
        } catch (err) {
          toast(err.message || 'Could not update follow');
        } finally {
          btn.disabled = false;
        }
      });

      sheet.querySelector('#sheet-msg-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const dmRes = await api.createDm(user.novaId);
          const convRes = await api.conversations();
          state.conversations = convRes.conversations || [];
          emit('conversations:changed');
          closeSheet();
          const conv = state.conversations.find((c) => c.id === dmRes.conversationId);
          if (conv) emit('chat:open', conv);
          else toast('Chat opened');
        } catch (err) {
          toast(err.message || 'Could not start chat');
        } finally {
          btn.disabled = false;
        }
      });
    }
  });
}
