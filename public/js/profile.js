// profile.js - own profile screen and profile editing
import { api } from './api.js';
import { state, emit, on } from './state.js';
import {
  $, avatar, icon, escapeHtml, toast, openSheet, closeSheet, confirmSheet, setBusy, verifyBadge, fileToDataUrl, renderQrSvg
} from './ui.js';
import { settingsGroupHtml, wireSettingsGroup } from './settings.js';

export function initProfile() {
  $('#profile-edit-btn')?.addEventListener('click', openEditProfileSheet);
  on('me:updated', renderProfile);
  on('settings:changed', renderProfile);
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

  const acctType = state.settings.privacySettings?.accountType || 'personal';
  const typeBadge = acctType === 'business' ? '<span class="chip" style="background:#0A84FF;color:#fff;font-size:11px">Business 💼</span>'
    : acctType === 'creator' ? '<span class="chip" style="background:#BF5AF2;color:#fff;font-size:11px">Creator ✨</span>'
    : '<span class="chip" style="background:var(--card-bg);font-size:11px">Personal</span>';

  content.innerHTML = `
    <div class="profile-cover"></div>
    <div class="profile-body">
      <div class="profile-photo">${avatar(me, { size: 'lg' })}</div>
      <div class="profile-name">${escapeHtml(me.displayName || 'You')} ${verifyBadge(me.isVerified)} ${typeBadge}</div>
      <button type="button" class="profile-id-badge" id="profile-id-badge" title="Tap to copy">
        <span class="profile-id-label">DARK CHAT ID</span>
        <span class="profile-id-value">${escapeHtml(me.novaId || '')}</span>
      </button>
      ${me.bio ? `<div class="profile-bio">${escapeHtml(me.bio)}</div>` : '<div class="profile-bio muted">No about yet.</div>'}
      <div class="profile-stats">
        <div class="stat"><b>${myConvs}</b><span>Chats</span></div>
        <div class="stat"><b>${myPosts}</b><span>Updates</span></div>
        <div class="stat"><b>${myStatuses}</b><span>Statuses</span></div>
      </div>
      <div class="profile-actions" style="flex-wrap:wrap;gap:8px">
        <button class="btn btn-primary profile-action" id="profile-edit-action">${icon('edit')} Edit profile</button>
        <button class="btn btn-ghost profile-action" id="profile-qr">${icon('link')} My QR Code</button>
        <button class="btn btn-ghost profile-action" id="profile-share">${icon('share')} Share ID</button>
        <button class="btn btn-ghost profile-action" id="profile-type">${icon('user')} Account type</button>
      </div>
    </div>
    ${settingsGroupHtml()}
  `;
  wireSettingsGroup(content);
  content.querySelector('#profile-edit-action').addEventListener('click', openEditProfileSheet);
  content.querySelector('#profile-qr').addEventListener('click', openQrSheet);
  content.querySelector('#profile-share').addEventListener('click', shareId);
  content.querySelector('#profile-type').addEventListener('click', openAccountTypeSheet);
  content.querySelector('#profile-id-badge')?.addEventListener('click', shareId);
}

async function shareId() {
  const id = state.me?.novaId || '';
  try { await navigator.clipboard.writeText(id); toast('DARK CHAT ID copied', 'success'); }
  catch { toast(id); }
}

export function openQrSheet() {
  const me = state.me;
  if (!me) return;
  const qrSvg = renderQrSvg(`darkchat://user/${me.novaId}`, 220);
  openSheet({
    title: 'My DARK CHAT QR',
    body: `<div class="sheet-pad center stack" style="align-items:center;text-align:center">
      <div style="margin:12px auto">${qrSvg}</div>
      <div class="profile-name" style="font-size:18px">${escapeHtml(me.displayName || 'You')} ${verifyBadge(me.isVerified)}</div>
      <div class="muted" style="font-size:13px">${escapeHtml(me.novaId || '')}</div>
      <div class="muted" style="font-size:12px;max-width:280px">Friends can scan this QR code or use your DARK CHAT ID to message you directly.</div>
    </div>`,
    footer: `<div class="sheet-pad stack">
      <button class="btn btn-primary btn-block" id="qr-copy-link">${icon('link')} Copy Profile Link</button>
      <button class="btn btn-ghost btn-block" id="qr-copy-id">${icon('check')} Copy ID: ${escapeHtml(me.novaId || '')}</button>
    </div>`,
    onMount(sheet) {
      sheet.querySelector('#qr-copy-link')?.addEventListener('click', async () => {
        const link = `${window.location.origin}/#user=${encodeURIComponent(me.novaId)}`;
        try { await navigator.clipboard.writeText(link); toast('Profile link copied!', 'success'); }
        catch { toast(link); }
      });
      sheet.querySelector('#qr-copy-id')?.addEventListener('click', () => shareId());
    }
  });
}

export function openAccountTypeSheet() {
  const current = state.settings.privacySettings?.accountType || 'personal';
  openSheet({
    title: 'Account Type',
    body: `<div class="sheet-pad stack">
      <div class="option ${current === 'personal' ? 'selected' : ''}" data-type="personal" style="cursor:pointer;border:1px solid var(--border);border-radius:12px;padding:12px">
        <span class="option-icon">${icon('user')}</span>
        <span class="option-copy"><b>Personal Account</b><small>Standard messaging, status stories, and updates for private chats with friends and family.</small></span>
      </div>
      <div class="option ${current === 'business' ? 'selected' : ''}" data-type="business" style="cursor:pointer;border:1px solid var(--border);border-radius:12px;padding:12px">
        <span class="option-icon">${icon('shield')}</span>
        <span class="option-copy"><b>Business Account 💼</b><small>Connect with customers, automated greeting, quick replies, catalog showcase, and business hours.</small></span>
      </div>
      <div class="option ${current === 'creator' ? 'selected' : ''}" data-type="creator" style="cursor:pointer;border:1px solid var(--border);border-radius:12px;padding:12px">
        <span class="option-icon">${icon('status')}</span>
        <span class="option-copy"><b>Creator Account ✨</b><small>Public channel features, audience updates, creator verification badge, and analytics.</small></span>
      </div>
    </div>`,
    onMount(sheet) {
      sheet.querySelectorAll('[data-type]').forEach((btn) => btn.addEventListener('click', async () => {
        const chosen = btn.dataset.type;
        try {
          await api.updateProfileSettings({ accountType: chosen });
          state.settings.privacySettings = { ...(state.settings.privacySettings || {}), accountType: chosen };
          closeSheet();
          toast(`Account switched to ${chosen.toUpperCase()}`, 'success');
          renderProfile();
        } catch (err) {
          toast(err.message || 'Could not update account type');
        }
      }));
    }
  });
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
      <label class="field"><span class="field-label">About / Bio</span>
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