// admin.js - admin panel: users, updates, and statuses moderation
import { api } from './api.js';
import { state } from './state.js';
import {
  $, avatar, icon, escapeHtml, emptyState, errorState, skeletonList, toast,
  openSheet, closeSheet, confirmSheet, promptSheet, verifyBadge
} from './ui.js';

let seq = 0;

export function initAdmin() {
  const btn = $('#admin-btn');
  btn?.addEventListener('click', openAdminPanel);
}

export function openAdminPanel() {
  openSheet({
    title: 'Admin panel',
    body: `
      <div class="tabs" id="admin-tabs">
        <button data-atab="users" class="active">Users</button>
        <button data-atab="updates">Updates</button>
        <button data-atab="statuses">Statuses</button>
      </div>
      <div class="sheet-pad">
        <div id="admin-error" class="alert alert-error hidden"></div>
        <label class="field" id="admin-search-field">
          <input class="input" id="admin-search" placeholder="Search by name or DARK CHAT ID" autocomplete="off">
        </label>
      </div>
      <div class="sheet-body" id="admin-content"></div>`,
    onMount(sheet) {
      let currentAdminTab = 'users';
      let t;

      const tabs = sheet.querySelector('#admin-tabs');
      tabs.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-atab]');
        if (!btn) return;
        currentAdminTab = btn.dataset.atab;
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
        // Show/hide search field (only for users)
        sheet.querySelector('#admin-search-field').style.display = currentAdminTab === 'users' ? '' : 'none';
        loadAdminContent(currentAdminTab, '');
      });

      sheet.querySelector('#admin-search').addEventListener('input', (e) => {
        clearTimeout(t);
        t = setTimeout(() => loadAdminContent('users', e.target.value.trim()), 300);
      });

      loadAdminContent('users', '');
    }
  });
}

async function loadAdminContent(tab, search) {
  if (tab === 'users') return loadAdminUsers(search);
  if (tab === 'updates') return loadAdminUpdates();
  if (tab === 'statuses') return loadAdminStatuses();
}

async function loadAdminUsers(search) {
  const list = $('#admin-content');
  const err = $('#admin-error');
  if (!list) return;
  const local = ++seq;
  list.innerHTML = skeletonList(6);
  err?.classList.add('hidden');
  try {
    const res = await api.adminUsers(search);
    if (local !== seq) return;
    const seen = new Set();
    const users = (res.users || []).filter((u) => {
      if (!u || seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });
    if (!users.length) {
      list.innerHTML = emptyState({ iconName: 'users', title: 'No users found', subtitle: search ? 'Try another search.' : '' });
      return;
    }
    list.innerHTML = users.map(adminRow).join('');
    list.querySelectorAll('[data-ban]').forEach((b) => b.addEventListener('click', () => banUser(b.dataset.ban, search)));
    list.querySelectorAll('[data-unban]').forEach((b) => b.addEventListener('click', () => run(() => api.adminUnban(b.dataset.unban), 'User unbanned', search)));
    list.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', () => run(() => api.adminVerify(b.dataset.verify), 'User verified', search)));
    list.querySelectorAll('[data-unverify]').forEach((b) => b.addEventListener('click', () => run(() => api.adminUnverify(b.dataset.unverify), 'Verification removed', search)));
    list.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => deleteUser(b.dataset.delete, search)));
  } catch (error) {
    if (local !== seq) return;
    if (err) { err.textContent = error.message || 'Could not load users'; err.classList.remove('hidden'); }
    list.innerHTML = errorState({ title: 'Could not load users', subtitle: error.message, retryId: 'retry-admin' });
    $('#retry-admin')?.addEventListener('click', () => loadAdminUsers(search));
  }
}

function adminRow(u) {
  const isMe = String(u.id) === String(state.me?.id);
  const banned = u.isBanned === true;
  return `<div class="discover-card">
    <span class="avatar-wrap">${avatar({ displayName: u.displayName, avatarUrl: u.avatarUrl, avatarColor: u.avatarColor }, { size: 'sm' })}</span>
    <div class="discover-info">
      <div class="discover-name truncate">
        ${escapeHtml(u.displayName || 'User')} ${verifyBadge(u.isVerified)}
        <span class="pill ${banned ? '' : 'channel'}" style="${banned ? 'color:var(--danger);border:1px solid rgba(255,69,58,.3)' : ''}">${banned ? 'BANNED' : 'ACTIVE'}</span>
        ${isMe ? '<span class="pill">You</span>' : ''}
      </div>
      <div class="discover-handle truncate">${escapeHtml(u.novaId || '')}</div>
      ${banned && u.banReason ? `<div class="discover-bio truncate">Reason: ${escapeHtml(u.banReason)}</div>` : ''}
    </div>
    <div class="row" style="gap:6px">
      ${banned
        ? `<button class="btn btn-ghost btn-sm" data-unban="${escapeHtml(u.id)}">Unban</button>`
        : `<button class="btn btn-danger btn-sm" data-ban="${escapeHtml(u.id)}">Ban</button>`}
      ${u.isVerified
        ? `<button class="btn btn-ghost btn-sm" data-unverify="${escapeHtml(u.id)}">Unverify</button>`
        : `<button class="btn btn-ghost btn-sm" data-verify="${escapeHtml(u.id)}">Verify</button>`}
      <button class="icon-btn" data-delete="${escapeHtml(u.id)}" aria-label="Delete user" ${isMe ? 'disabled' : ''}>${icon('trash')}</button>
    </div>
  </div>`;
}

async function loadAdminUpdates() {
  const list = $('#admin-content');
  if (!list) return;
  list.innerHTML = skeletonList(5);
  try {
    const res = await api.posts();
    const posts = res.posts || [];
    if (!posts.length) {
      list.innerHTML = emptyState({ iconName: 'updates', title: 'No updates', subtitle: 'No user updates to moderate.' });
      return;
    }
    list.innerHTML = posts.map((p) => `<div class="admin-post">
      <div class="post-head">
        ${avatar({ displayName: p.display_name, avatarUrl: p.avatar_url, avatarColor: p.avatar_color }, { size: 'sm' })}
        <div class="post-info">
          <div class="post-author truncate">${escapeHtml(p.display_name || 'User')} ${verifyBadge(p.is_verified)}</div>
          <div class="post-time">${escapeHtml(p.id)}</div>
        </div>
        <button class="btn btn-danger btn-sm" data-admin-del-post="${escapeHtml(p.id)}">Delete</button>
      </div>
      ${p.caption ? `<div class="post-caption" style="padding:0 4px">${escapeHtml(p.caption)}</div>` : ''}
    </div>`).join('');
    list.querySelectorAll('[data-admin-del-post]').forEach((btn) => btn.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: 'Delete update', message: 'Remove this update from the feed? This cannot be undone.', confirmText: 'Delete', danger: true });
      if (!ok) return;
      try {
        await api.deletePost(btn.dataset.adminDelPost);
        toast('Update deleted', 'success');
        loadAdminUpdates();
      } catch (err) { toast(err.message || 'Could not delete'); }
    }));
  } catch (error) {
    list.innerHTML = errorState({ title: 'Could not load updates', subtitle: error.message, retryId: 'retry-admin-updates' });
    $('#retry-admin-updates')?.addEventListener('click', loadAdminUpdates);
  }
}

async function loadAdminStatuses() {
  const list = $('#admin-content');
  if (!list) return;
  list.innerHTML = skeletonList(5);
  try {
    const res = await api.statusFeed();
    const statuses = res.statuses || [];
    if (!statuses.length) {
      list.innerHTML = emptyState({ iconName: 'status', title: 'No statuses', subtitle: 'No active statuses to moderate.' });
      return;
    }
    list.innerHTML = statuses.map((s) => `<div class="admin-post">
      <div class="post-head">
        ${avatar({ displayName: s.display_name, avatarUrl: s.avatar_url, avatarColor: s.avatar_color }, { size: 'sm' })}
        <div class="post-info">
          <div class="post-author truncate">${escapeHtml(s.display_name || 'User')} ${verifyBadge(s.is_verified)}</div>
          <div class="post-time">${escapeHtml(s.content || (s.media_type === 'video' ? 'Video' : 'Photo'))}</div>
        </div>
        <button class="btn btn-danger btn-sm" data-admin-del-status="${escapeHtml(s.id)}">Delete</button>
      </div>
    </div>`).join('');
    list.querySelectorAll('[data-admin-del-status]').forEach((btn) => btn.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: 'Delete status', message: 'Remove this status? This cannot be undone.', confirmText: 'Delete', danger: true });
      if (!ok) return;
      try {
        await api.deleteStatus(btn.dataset.adminDelStatus);
        toast('Status deleted', 'success');
        loadAdminStatuses();
      } catch (err) { toast(err.message || 'Could not delete'); }
    }));
  } catch (error) {
    list.innerHTML = errorState({ title: 'Could not load statuses', subtitle: error.message, retryId: 'retry-admin-statuses' });
    $('#retry-admin-statuses')?.addEventListener('click', loadAdminStatuses);
  }
}

async function run(action, successMessage, search) {
  try {
    await action();
    toast(successMessage, 'success');
    loadAdminUsers(search);
  } catch (err) {
    toast(err.message || 'Action failed');
  }
}

async function banUser(id, search) {
  const reason = await promptSheet({ title: 'Ban user', label: 'Reason (optional)', placeholder: 'Terms violation', confirmText: 'Ban' });
  if (reason === null) return;
  await run(() => api.adminBan(id, reason || null), 'User banned', search);
}

async function deleteUser(id, search) {
  const ok = await confirmSheet({ title: 'Delete user', message: 'Permanently delete this account? This cannot be undone.', confirmText: 'Delete', danger: true });
  if (!ok) return;
  await run(() => api.adminDelete(id), 'User deleted', search);
}
