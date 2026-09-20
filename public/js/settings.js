// settings.js - privacy & notification settings, blocked users, logout
import { api, ApiError } from './api.js';
import { state, emit } from './state.js';
import {
  $, avatar, icon, escapeHtml, toast, openSheet, closeSheet, confirmSheet, setBusy
} from './ui.js';

const TOGGLES = [
  { key: 'online', label: 'Show online status', hint: 'Let contacts see when you are active' },
  { key: 'lastSeen', label: 'Show last seen', hint: 'Show the last time you were online' },
  { key: 'readReceipts', label: 'Read receipts', hint: 'Share when you have read messages' },
  { key: 'profilePhoto', label: 'Profile photo visible', hint: 'Show your photo to everyone' },
  { key: 'notifications', label: 'Message notifications', hint: 'Notify you about new messages' }
];

const VISIBILITY = [
  { key: 'whoCanMessage', label: 'Who can message me', options: ['everyone', 'contacts', 'nobody'] },
  { key: 'whoCanAddToGroups', label: 'Who can add me to groups', options: ['everyone', 'contacts', 'nobody'] }
];

export function initSettings() {
  $('#profile-settings-btn')?.addEventListener('click', openSettingsSheet);
}

export function settingsGroupHtml() {
  const s = state.settings.privacySettings || {};
  const toggles = TOGGLES.map((t) => `
    <div class="setting">
      <span class="setting-icon">${icon(t.key === 'notifications' ? 'bell' : t.key === 'readReceipts' ? 'check-check' : 'eye')}</span>
      <span class="setting-copy">${escapeHtml(t.label)}<small>${escapeHtml(t.hint)}</small></span>
      <button class="toggle" role="switch" aria-checked="${s[t.key] !== false}" data-toggle="${t.key}" aria-label="${escapeHtml(t.label)}"></button>
    </div>`).join('');

  const visibility = VISIBILITY.map((v) => `
    <div class="setting">
      <span class="setting-icon">${icon('users')}</span>
      <span class="setting-copy">${escapeHtml(v.label)}</span>
      <select class="input" data-visibility="${v.key}" style="min-height:40px;width:auto">
        ${v.options.map((o) => `<option value="${o}" ${(s[v.key] || 'everyone') === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </div>`).join('');

  return `
    <div class="settings-group">
      <div class="settings-group-title">Privacy</div>
      ${toggles}
      ${visibility}
    </div>
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
    </div>
    <div class="settings-group">
      <div class="settings-group-title">Integrations</div>
      ${telegramPairHtml()}
    </div>`;
}

function telegramPairHtml() {
  const telegram = state.settings.telegram || {};
  if (telegram.linked) {
    return `<div class="telegram-pair" data-telegram-panel>
      <div class="telegram-pair-title">Telegram bot linked</div>
      <div class="telegram-pair-copy">${telegram.username ? `@${escapeHtml(telegram.username)}` : 'Your Telegram account is connected'}.</div>
      <div class="telegram-pair-hint">Use .ping to test the connection and .menu to see available commands.</div>
    </div>`;
  }
  return `<div class="telegram-pair" data-telegram-panel>
    <div class="telegram-pair-title">Link Telegram bot</div>
    <div class="telegram-pair-copy">In Telegram, send <b>/pair ${escapeHtml(state.me?.novaId || 'YOUR-DARK-CHAT-ID')}</b> to the DARK CHAT bot. Then enter the six-digit code here.</div>
    <div class="telegram-pair-form">
      <input class="input" data-telegram-code inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" aria-label="Telegram pairing code">
      <button class="btn btn-primary" type="button" data-telegram-pair>Link bot</button>
    </div>
    <div class="telegram-pair-hint" data-telegram-status>Code expires after 10 minutes.</div>
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
  root.querySelectorAll('[data-telegram-pair]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const panel = btn.closest('[data-telegram-panel]');
      const input = panel?.querySelector('[data-telegram-code]');
      const code = input?.value.trim() || '';
      if (!/^\d{6}$/.test(code)) {
        const status = panel?.querySelector('[data-telegram-status]');
        if (status) status.textContent = 'Enter the six-digit code from Telegram.';
        return;
      }
      setBusy(btn, true, 'Linking...');
      try {
        const res = await api.telegramPair(code);
        state.settings.telegram = res.telegram || { linked: true };
        if (panel) panel.outerHTML = telegramPairHtml();
        toast('Telegram bot linked', 'success');
      } catch (err) {
        const status = panel?.querySelector('[data-telegram-status]');
        if (status) status.textContent = err.message || 'Could not link Telegram bot.';
        setBusy(btn, false);
      }
    });
  });
}

async function saveSetting(patch) {
  const res = await api.updateProfileSettings(patch);
  state.settings.privacySettings = res.privacySettings || state.settings.privacySettings;
  toast('Saved', 'success');
}

export async function loadProfileSettings() {
  try {
    const res = await api.profileSettings();
    state.settings.privacySettings = res.privacySettings || {};
    state.settings.blockedUserIds = res.blockedUserIds || [];
    state.settings.telegram = res.telegram || { linked: false };
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
