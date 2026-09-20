// profile.js - own profile screen and profile editing
import { api } from './api.js';
import { state, emit, on } from './state.js';
import {
  $, avatar, icon, escapeHtml, toast, openSheet, closeSheet, setBusy, verifyBadge, fileToDataUrl
} from './ui.js';
import { settingsGroupHtml, wireSettingsGroup } from './settings.js';

export function initProfile() {
  $('#profile-edit-btn')?.addEventListener('click', openEditProfileSheet);
  on('me:updated', renderProfile);
  on('tab:show', (tab) => { if (tab === 'profile') renderProfile(); });
  on('admin:open', () => emit('admin:open-panel'));
  on('profile:edit', openEditProfileSheet);
  renderProfile();
}

export function renderProfile() {
  const me = state.me;
  const content = $('#profile-content');
  if (!me || !content) return;
  const myConvs = state.conversations.length;
  const myStatuses = state.statuses.filter((s) => String(s.user_id) === String(me.id)).length;
  const myPosts = state.posts.filter((p) => String(p.user_id) === String(me.id)).length;
  const lastSeen = me.lastSeen || me.last_seen;
  const isOnline = state.presence[me.id];

  content.innerHTML = `
    <div class="profile-cover"></div>
    <div class="profile-body">
      <div class="profile-photo-wrap">
        <div class="profile-photo">${avatar(me, { size: 'lg' })}</div>
        ${isOnline ? '<span class="profile-online-dot"></span>' : ''}
      </div>
      <div class="profile-name">${escapeHtml(me.displayName || 'You')} ${verifyBadge(me.isVerified)}</div>
      <div class="profile-handle truncate">${escapeHtml(me.novaId || '')}</div>
      <div class="profile-presence ${isOnline ? 'online' : ''}">${escapeHtml(isOnline ? 'online' : (lastSeen ? 'last seen ' + timeAgoShort(lastSeen) : 'offline'))}</div>
      ${me.bio ? `<div class="profile-bio">${escapeHtml(me.bio)}</div>` : '<div class="profile-bio muted">No about yet.</div>'}
      <div class="profile-stats">
        <div class="stat"><b>${myConvs}</b><span>Chats</span></div>
        <div class="stat"><b>${myPosts}</b><span>Updates</span></div>
        <div class="stat"><b>${myStatuses}</b><span>Statuses</span></div>
      </div>
      <div class="profile-actions">
        <button class="btn btn-primary profile-action" id="profile-edit-action">${icon('edit')} Edit profile</button>
        <button class="btn btn-ghost profile-action" id="profile-share">${icon('link')} Share ID</button>
      </div>
    </div>
    ${settingsGroupHtml()}
  `;
  wireSettingsGroup(content);
  content.querySelector('#profile-edit-action').addEventListener('click', openEditProfileSheet);
  content.querySelector('#profile-share').addEventListener('click', shareId);
}

function timeAgoShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function shareId() {
  const id = state.me?.novaId || '';
  try { await navigator.clipboard.writeText(id); toast('DARK CHAT ID copied', 'success'); }
  catch { toast(id); }
}

export function openEditProfileSheet() {
  const me = state.me;
  if (!me) return;
  let avatarData = null;
  let avatarMime = null;
  openSheet({
    title: 'Edit profile',
    body: `<div class="sheet-pad">
      <div id="edit-error" class="alert alert-error hidden"></div>
      <div class="center stack">${avatar(me, { size: 'lg' })}</div>
      <label class="field"><span class="field-label">Profile photo</span>
        <input class="input" type="file" id="edit-avatar" accept="image/*"></label>
      <label class="field"><span class="field-label">Display name</span>
        <input class="input" id="edit-name" maxlength="60" value="${escapeHtml(me.displayName || '')}"></label>
      <label class="field"><span class="field-label">About</span>
        <textarea class="textarea" id="edit-bio" maxlength="160" placeholder="Tell people about yourself">${escapeHtml(me.bio || '')}</textarea></label>
      <div class="muted" style="font-size:13px">DARK CHAT ID: ${escapeHtml(me.novaId || '')}</div>
    </div>`,
    footer: `<div class="sheet-pad"><button class="btn btn-primary btn-block" id="edit-save">Save changes</button></div>`,
    onMount(sheet) {
      sheet.querySelector('#edit-avatar').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) { toast('Image too large (max 8MB)'); e.target.value = ''; return; }
        try {
          avatarData = await fileToDataUrl(file);
          avatarMime = file.type || 'image/jpeg';
          sheet.querySelector('.center').innerHTML = avatar({ displayName: me.displayName, avatarData }, { size: 'lg' });
        } catch { toast('Could not read image'); }
      });
      sheet.querySelector('#edit-save').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const name = sheet.querySelector('#edit-name').value.trim();
        const bio = sheet.querySelector('#edit-bio').value;
        const errBox = sheet.querySelector('#edit-error');
        const fail = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
        errBox.classList.add('hidden');
        if (!name) return fail('Display name cannot be empty');
        const payload = { displayName: name, bio };
        if (avatarData) { payload.avatarData = avatarData; payload.avatarMime = avatarMime; }
        setBusy(btn, true, 'Saving...');
        try {
          const res = await api.updateMe(payload);
          state.me = res.user;
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