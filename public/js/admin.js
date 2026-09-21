// admin.js - admin panel: real account state, ban/unban, verify/unverify
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
      <div class="sheet-pad">
        <div id="admin-error" class="alert alert-error hidden"></div>
        <label class="field">
          <input class="input" id="admin-search" placeholder="Search by name or DARK CHAT ID" autocomplete="off">
        </label>
      </div>
      <div class="settings-group-title">Users</div>
      <div class="sheet-body" id="admin-users"></div>
      <div class="settings-group-title">Channels</div>
      <div class="sheet-body" id="admin-channels"></div>`,
    onMount(sheet) {
      let t;
      sheet.querySelector('#admin-search').addEventListener('input', (e) => {
        clearTimeout(t);
        t = setTimeout(() => { loadAdminUsers(e.target.value.trim()); loadAdminChannels(e.target.value.trim()); }, 300);
      });
      loadAdminUsers('');
      loadAdminChannels('');
    }
  });
}

async function loadAdminUsers(search) {
  const list = $('#admin-users');
  const err = $('#admin-error');
  if (!list) return;
  const local = ++seq;
  list.innerHTML = skeletonList(6);
  err?.classList.add('hidden');
  try {
    const res = await api.adminUsers(search);
    if (local !== seq) return;
    // defensive dedupe by id in case a page is delivered twice
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

async function loadAdminChannels(search) {
  const list = $('#admin-channels');
  if (!list) return;
  list.innerHTML = skeletonList(3);
  try {
    const res = await api.adminChannels(search);
    const channels = res.channels || [];
    if (!channels.length) { list.innerHTML = '<div class="sheet-pad muted">No channels found.</div>'; return; }
    list.innerHTML = channels.map(channelRow).join('');
    list.querySelectorAll('[data-channel-verify]').forEach((button) => button.addEventListener('click', () => runChannel(() => api.adminVerifyChannel(button.dataset.channelVerify), 'Channel verified', search)));
    list.querySelectorAll('[data-channel-unverify]').forEach((button) => button.addEventListener('click', () => runChannel(() => api.adminUnverifyChannel(button.dataset.channelUnverify), 'Channel verification removed', search)));
  } catch (error) { list.innerHTML = `<div class="sheet-pad alert alert-error">${escapeHtml(error.message || 'Could not load channels')}</div>`; }
}

function channelRow(channel) {
  return `<div class="discover-card">
    <span class="avatar-wrap">${avatar({ displayName: channel.name, avatarUrl: channel.avatarUrl }, { size: 'sm' })}</span>
    <div class="discover-info"><div class="discover-name truncate">${escapeHtml(channel.name || 'Channel')} ${channel.isVerified ? verifyBadge(true) : ''}</div><div class="discover-handle truncate">${escapeHtml(channel.inviteCode || '')}</div></div>
    ${channel.isVerified ? `<button class="btn btn-ghost btn-sm" data-channel-unverify="${escapeHtml(channel.id)}">Unverify</button>` : `<button class="btn btn-ghost btn-sm" data-channel-verify="${escapeHtml(channel.id)}">Verify</button>`}
  </div>`;
}

async function runChannel(action, successMessage, search) {
  try { await action(); toast(successMessage, 'success'); await loadAdminChannels(search); }
  catch (err) { toast(err.message || 'Action failed'); }
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
