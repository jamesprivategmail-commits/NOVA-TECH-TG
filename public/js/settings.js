// settings.js - privacy & notification settings, blocked users, logout
import { api, ApiError } from './api.js';
import { state, emit } from './state.js';
import {
  $, avatar, icon, escapeHtml, toast, openSheet, closeSheet, confirmSheet, setBusy
} from './ui.js';

const PRIVACY_TOGGLES = [
  { key: 'online', label: 'Show online status', hint: 'Let contacts see when you are active', icon: 'eye' },
  { key: 'lastSeen', label: 'Show last seen', hint: 'Show the last time you were online', icon: 'eye' },
  { key: 'readReceipts', label: 'Read receipts', hint: 'Share when you have read messages', icon: 'check-check' },
  { key: 'profilePhoto', label: 'Profile photo visible', hint: 'Show your photo to everyone', icon: 'image' },
  { key: 'status', label: 'Share my status', hint: 'Let others see your status updates', icon: 'status' }
];

const CHAT_TOGGLES = [
  { key: 'enterToSend', label: 'Enter to send', hint: 'Press Enter to send; Shift+Enter for a new line', icon: 'send', defaultOn: true },
  { key: 'unarchiveOnNewMessage', label: 'Unarchive on new message', hint: 'Move an archived chat back to the main list when a new message arrives', icon: 'bookmark', defaultOn: true },
  { key: 'showUnreadBadges', label: 'Unread badges', hint: 'Show real unread counts on chats and the Unread filter', icon: 'message-dot', defaultOn: true }
];

const STATUS_TOGGLES = [
  { key: 'statusVideoAutoplay', label: 'Autoplay status videos', hint: 'Play status videos automatically; hold still pauses', icon: 'play', defaultOn: true },
  { key: 'statusRepliesNotify', label: 'Status reply notifications', hint: 'Notify you when someone replies to your status', icon: 'bell', defaultOn: true }
];

const CALL_TOGGLES = [
  { key: 'allowVoiceCalls', label: 'Allow voice calls', hint: 'Others can place voice calls to you', icon: 'phone', defaultOn: true },
  { key: 'allowVideoCalls', label: 'Allow video calls', hint: 'Others can place video calls to you', icon: 'video', defaultOn: true },
  { key: 'callNotifications', label: 'Call notifications', hint: 'Alert you about incoming calls', icon: 'bell', defaultOn: true }
];

const NOTIF_TOGGLES = [
  { key: 'notifications', label: 'Message notifications', hint: 'Notify you about new messages', icon: 'bell', defaultOn: true }
];

const VISIBILITY = [
  { key: 'whoCanMessage', label: 'Who can message me', options: ['everyone', 'contacts', 'nobody'] },
  { key: 'whoCanAddToGroups', label: 'Who can add me to groups', options: ['everyone', 'contacts', 'nobody'] }
];

function isOn(settings, key, defaultOn = true) {
  if (settings[key] === undefined || settings[key] === null) return defaultOn;
  return settings[key] !== false;
}

function toggleRow(t, s) {
  const on = isOn(s, t.key, t.defaultOn !== false);
  return `<div class="setting">
      <span class="setting-icon">${icon(t.icon || 'settings')}</span>
      <span class="setting-copy">${escapeHtml(t.label)}<small>${escapeHtml(t.hint)}</small></span>
      <button class="toggle" role="switch" aria-checked="${on}" data-toggle="${t.key}" data-default-on="${t.defaultOn !== false}" aria-label="${escapeHtml(t.label)}"></button>
    </div>`;
}

function group(title, rows) {
  return `<div class="settings-group">
      <div class="settings-group-title">${escapeHtml(title)}</div>
      ${rows}
    </div>`;
}

export function initSettings() {
  $('#profile-settings-btn')?.addEventListener('click', openSettingsSheet);
}

export function settingsGroupHtml() {
  const s = state.settings.privacySettings || {};
  const privacy = PRIVACY_TOGGLES.map((t) => toggleRow(t, s)).join('');
  const visibility = VISIBILITY.map((v) => `
    <div class="setting">
      <span class="setting-icon">${icon('users')}</span>
      <span class="setting-copy">${escapeHtml(v.label)}</span>
      <select class="input" data-visibility="${v.key}" style="min-height:40px;width:auto">
        ${v.options.map((o) => `<option value="${o}" ${(s[v.key] || 'everyone') === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </div>`).join('');
  const chats = CHAT_TOGGLES.map((t) => toggleRow(t, s)).join('');
  const status = STATUS_TOGGLES.map((t) => toggleRow(t, s)).join('');
  const calls = CALL_TOGGLES.map((t) => toggleRow(t, s)).join('');
  const notifs = NOTIF_TOGGLES.map((t) => toggleRow(t, s)).join('');

  return `
    ${group('Privacy', privacy + visibility)}
    ${group('Chats', chats)}
    ${group('Status', status)}
    ${group('Calls', calls)}
    ${group('Notifications', notifs)}
    <div class="settings-group">
      <div class="settings-group-title">Account</div>
      <button class="setting" data-settings-action="edit">
        <span class="setting-icon">${icon('edit')}</span>
        <span class="setting-copy">Edit profile</span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
      <button class="setting" data-settings-action="blocked">
        <span class="setting-icon">${icon('lock')}</span>
        <span class="setting-copy">Blocked users<small>${(state.settings.blockedUserIds || []).length} blocked</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
      ${state.me?.isAdmin ? `<button class="setting" data-settings-action="admin"><span class="setting-icon">${icon('shield')}</span><span class="setting-copy">Admin panel</span><span class="chevron">${icon('chevron-right')}</span></button>` : ''}
      <button class="setting" data-settings-action="logout" style="color:var(--danger)">
        <span class="setting-icon" style="color:var(--danger)">${icon('logout')}</span>
        <span class="setting-copy">Log out</span>
      </button>
    </div>`;
}

export function wireSettingsGroup(root = document) {
  root.querySelectorAll('[data-toggle]').forEach((btn) => {
    const initial = btn.getAttribute('aria-checked') === 'true';
    btn.addEventListener('click', async () => {
      const next = !(btn.getAttribute('aria-checked') === 'true');
      btn.setAttribute('aria-checked', String(next));
      try {
        await saveSetting({ [btn.dataset.toggle]: next });
      } catch (err) {
        btn.setAttribute('aria-checked', String(!next));
        toast(err.message || 'Could not save setting');
      }
    });
  });
  root.querySelectorAll('[data-visibility]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try { await saveSetting({ [sel.dataset.visibility]: sel.value }); }
      catch (err) { toast(err.message || 'Could not save setting'); }
    });
  });
  root.querySelectorAll('[data-settings-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn.dataset.settingsAction));
  });
}

async function saveSetting(patch) {
  const res = await api.updateProfileSettings(patch);
  state.settings.privacySettings = res.privacySettings || { ...state.settings.privacySettings, ...patch };
  emit('settings:changed', state.settings.privacySettings);
  toast('Saved', 'success');
}

/** Read a boolean preference with a default. */
export function pref(key, defaultOn = true) {
  const s = state.settings.privacySettings || {};
  if (s[key] === undefined || s[key] === null) return defaultOn;
  return s[key] !== false;
}

export async function loadProfileSettings() {
  try {
    const res = await api.profileSettings();
    state.settings.privacySettings = res.privacySettings || {};
    state.settings.blockedUserIds = res.blockedUserIds || [];
  } catch { /* non-fatal */ }
}

export function openSettingsSheet() {
  openSheet({
    title: 'Settings',
    body: `<div class="sheet-body">${settingsGroupHtml()}</div>`,
    onMount(sheet) { wireSettingsGroup(sheet); }
  });
}

async function handleAction(action) {
  if (action === 'edit') { closeSheet(); emit('profile:edit'); return; }
  if (action === 'admin') { closeSheet(); emit('admin:open'); return; }
  if (action === 'logout') {
    const ok = await confirmSheet({ title: 'Log out', message: 'Log out of DARK CHAT on this device?', confirmText: 'Log out', danger: true });
    if (ok) { closeSheet(); emit('auth:logout'); }
    return;
  }
  if (action === 'blocked') { closeSheet(); openBlockedSheet(); }
}

async function openBlockedSheet() {
  openSheet({
    title: 'Blocked users',
    body: `<div class="sheet-body" id="blocked-list"></div>`,
    onMount() { renderBlocked(); }
  });
}

async function renderBlocked() {
  const list = $('#blocked-list');
  if (!list) return;
  const ids = state.settings.blockedUserIds || [];
  if (!ids.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">${icon('lock')}</div><div class="title">No blocked users</div></div>`;
    return;
  }
  list.innerHTML = ids.map((id) => `<div class="option">
    <span class="option-icon">${icon('user')}</span>
    <span class="option-copy">${escapeHtml(id)}</span>
    <button class="btn btn-ghost btn-sm" data-unblock="${escapeHtml(id)}">Unblock</button>
  </div>`).join('');
  list.querySelectorAll('[data-unblock]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await api.unblock(btn.dataset.unblock);
      state.settings.blockedUserIds = ids.filter((x) => x !== btn.dataset.unblock);
      toast('Unblocked', 'success');
      renderBlocked();
    } catch (err) { toast(err.message || 'Could not unblock'); }
  }));
}
