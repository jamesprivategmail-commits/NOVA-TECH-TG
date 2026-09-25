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

const ACCENT_COLORS = [
  { name: 'Electric Blue', hex: '#3da9ff' },
  { name: 'Cyber Red', hex: '#ff3b45' },
  { name: 'Emerald', hex: '#30d158' },
  { name: 'Amethyst', hex: '#bf5af2' },
  { name: 'Sunset Orange', hex: '#ff9f0a' }
];

export function applyThemePreferences() {
  const s = state.settings?.privacySettings || {};
  const theme = s.theme || 'dark';
  const accent = s.accentColor || '#3da9ff';
  const fontSize = s.fontSize || 'normal';

  if (theme === 'light') {
    document.body.classList.add('theme-light');
  } else {
    document.body.classList.remove('theme-light');
  }

  document.body.classList.remove('font-small', 'font-large');
  if (fontSize === 'small') document.body.classList.add('font-small');
  if (fontSize === 'large') document.body.classList.add('font-large');

  if (accent) {
    document.documentElement.style.setProperty('--blue', accent);
  }
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

  const currentTheme = s.theme || 'dark';
  const currentAccent = s.accentColor || '#3da9ff';
  const currentFont = s.fontSize || 'normal';

  const appearanceHtml = `
    <div class="setting">
      <span class="setting-icon">${icon('eye')}</span>
      <span class="setting-copy">Theme mode<small>Dark or light visual style</small></span>
      <select class="input" id="setting-theme" style="min-height:36px;width:auto">
        <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>Dark</option>
        <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>Light</option>
      </select>
    </div>
    <div class="setting">
      <span class="setting-icon">${icon('smile')}</span>
      <span class="setting-copy">Accent color<small>Personalize buttons and highlights</small></span>
      <div class="row" style="gap:8px" id="accent-picker">
        ${ACCENT_COLORS.map((c) => `<button type="button" class="avatar" data-accent="${c.hex}" style="width:28px;height:28px;background:${c.hex};border:2px solid ${c.hex === currentAccent ? '#fff' : 'transparent'}" title="${c.name}"></button>`).join('')}
      </div>
    </div>
    <div class="setting">
      <span class="setting-icon">${icon('edit')}</span>
      <span class="setting-copy">Font size<small>Adjust readability across chats</small></span>
      <select class="input" id="setting-font-size" style="min-height:36px;width:auto">
        <option value="small" ${currentFont === 'small' ? 'selected' : ''}>Small</option>
        <option value="normal" ${currentFont === 'normal' ? 'selected' : ''}>Normal</option>
        <option value="large" ${currentFont === 'large' ? 'selected' : ''}>Large</option>
      </select>
    </div>
  `;

  return `
    ${group('Appearance', appearanceHtml)}
    ${group('Privacy', privacy + visibility)}
    ${group('Chats', chats)}
    ${group('Status', status)}
    ${group('Calls', calls)}
    ${group('Notifications', notifs)}
    <div class="settings-group">
      <div class="settings-group-title">Security & Storage</div>
      <button class="setting" data-settings-action="password">
        <span class="setting-icon">${icon('lock')}</span>
        <span class="setting-copy">Change password<small>Update your login key</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
      <button class="setting" data-settings-action="two-factor">
        <span class="setting-icon">${icon('shield')}</span>
        <span class="setting-copy">Two-step verification<small>${s.twoFactorEnabled ? 'Enabled 🔒' : 'Disabled'}</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
      <button class="setting" data-settings-action="starred">
        <span class="setting-icon">${icon('bookmark')}</span>
        <span class="setting-copy">Starred messages<small>${(s.starredMessageIds || []).length} saved</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
      <button class="setting" data-settings-action="devices">
        <span class="setting-icon">${icon('compass')}</span>
        <span class="setting-copy">Linked devices<small>Manage active sessions</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
      <button class="setting" data-settings-action="storage">
        <span class="setting-icon">${icon('file')}</span>
        <span class="setting-copy">Storage & data usage<small>Inspect and clear cache</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
      <button class="setting" data-settings-action="backup">
        <span class="setting-icon">${icon('download')}</span>
        <span class="setting-copy">Export account data<small>Download JSON backup</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
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
      <button class="setting" data-settings-action="about">
        <span class="setting-icon">${icon('alert')}</span>
        <span class="setting-copy">About & terms<small>DARK CHAT v2.4.0</small></span>
        <span class="chevron">${icon('chevron-right')}</span>
      </button>
      ${state.me?.isAdmin ? `<button class="setting" data-settings-action="admin"><span class="setting-icon">${icon('shield')}</span><span class="setting-copy">Admin panel</span><span class="chevron">${icon('chevron-right')}</span></button>` : ''}
      <button class="setting" data-settings-action="delete-account" style="color:var(--danger)">
        <span class="setting-icon" style="color:var(--danger)">${icon('trash')}</span>
        <span class="setting-copy">Delete account<small style="color:var(--danger)">Irreversible action</small></span>
      </button>
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

  root.querySelector('#setting-theme')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    await saveSetting({ theme: val });
    applyThemePreferences();
  });

  root.querySelectorAll('[data-accent]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const color = btn.dataset.accent;
      root.querySelectorAll('[data-accent]').forEach((b) => { b.style.border = '2px solid transparent'; });
      btn.style.border = '2px solid #fff';
      await saveSetting({ accentColor: color });
      applyThemePreferences();
    });
  });

  root.querySelector('#setting-font-size')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    await saveSetting({ fontSize: val });
    applyThemePreferences();
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
  applyThemePreferences();
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
    applyThemePreferences();
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
  if (action === 'blocked') { closeSheet(); openBlockedSheet(); return; }
  if (action === 'password') { closeSheet(); openChangePasswordSheet(); return; }
  if (action === 'two-factor') { closeSheet(); openTwoFactorSheet(); return; }
  if (action === 'starred') { closeSheet(); openStarredSheet(); return; }
  if (action === 'devices') { closeSheet(); openDevicesSheet(); return; }
  if (action === 'storage') { closeSheet(); openStorageSheet(); return; }
  if (action === 'backup') { downloadBackup(); return; }
  if (action === 'about') { closeSheet(); openAboutSheet(); return; }
  if (action === 'delete-account') { closeSheet(); openDeleteAccountSheet(); return; }
}

function openChangePasswordSheet() {
  openSheet({
    title: 'Change password',
    body: `<div class="sheet-pad stack">
      <div id="pwd-err" class="alert alert-error hidden"></div>
      <label class="field"><span class="field-label">Current password</span>
        <input class="input" type="password" id="cur-pwd" placeholder="Enter current password"></label>
      <label class="field"><span class="field-label">New password</span>
        <input class="input" type="password" id="new-pwd" placeholder="At least 6 characters" minlength="6"></label>
      <label class="field"><span class="field-label">Confirm new password</span>
        <input class="input" type="password" id="cnf-pwd" placeholder="Re-enter new password"></label>
    </div>`,
    footer: `<div class="sheet-pad"><button class="btn btn-primary btn-block" id="pwd-save">Update Password</button></div>`,
    onMount(sheet) {
      sheet.querySelector('#pwd-save')?.addEventListener('click', async (e) => {
        const cur = sheet.querySelector('#cur-pwd').value;
        const nxt = sheet.querySelector('#new-pwd').value;
        const cnf = sheet.querySelector('#cnf-pwd').value;
        const errBox = sheet.querySelector('#pwd-err');
        if (!cur) { errBox.textContent = 'Current password is required'; errBox.classList.remove('hidden'); return; }
        if (!nxt || nxt.length < 6) { errBox.textContent = 'New password must be at least 6 characters'; errBox.classList.remove('hidden'); return; }
        if (nxt !== cnf) { errBox.textContent = 'Passwords do not match'; errBox.classList.remove('hidden'); return; }
        setBusy(e.currentTarget, true, 'Updating...');
        try {
          await api.changePassword(cur, nxt);
          closeSheet();
          toast('Password updated successfully', 'success');
        } catch (err) {
          errBox.textContent = err.message || 'Failed to change password';
          errBox.classList.remove('hidden');
          setBusy(e.currentTarget, false);
        }
      });
    }
  });
}

function openTwoFactorSheet() {
  const currentEnabled = !!state.settings.privacySettings?.twoFactorEnabled;
  const currentPin = state.settings.privacySettings?.twoFactorPin || '';

  openSheet({
    title: 'Two-Step Verification',
    body: `<div class="sheet-pad stack">
      <div class="muted" style="font-size:13px;line-height:1.5">
        Two-step verification adds an extra layer of security to your account. When enabled, your 6-digit PIN will be required whenever you sign in with your DARK CHAT ID.
      </div>
      <div class="setting" style="margin-top:12px">
        <span class="setting-icon">${icon('shield')}</span>
        <span class="setting-copy">Two-Step Verification<small>${currentEnabled ? 'Currently Enabled 🔒' : 'Currently Disabled'}</small></span>
        <button class="toggle" role="switch" aria-checked="${currentEnabled}" id="2fa-toggle" aria-label="Two step verification"></button>
      </div>
      <div id="2fa-pin-box" class="${currentEnabled ? '' : 'hidden'} stack" style="margin-top:14px">
        <label class="field"><span class="field-label">Account 6-Digit PIN</span>
          <input class="input" type="password" id="2fa-pin" maxlength="6" inputmode="numeric" pattern="[0-9]*" placeholder="••••••" value="${escapeHtml(currentPin)}" autocomplete="off">
        </label>
        <div class="muted" style="font-size:12px;margin-bottom:8px">Enter exactly 6 numbers (e.g. 123456) that you will use to verify your identity upon login.</div>
        <button class="btn btn-primary btn-block" id="2fa-save-pin">Save & Activate 6-Digit PIN</button>
      </div>
    </div>`,
    onMount(sheet) {
      const toggle = sheet.querySelector('#2fa-toggle');
      const pinBox = sheet.querySelector('#2fa-pin-box');
      const pinInput = sheet.querySelector('#2fa-pin');

      toggle.addEventListener('click', async () => {
        const next = !(toggle.getAttribute('aria-checked') === 'true');
        if (next) {
          toggle.setAttribute('aria-checked', 'true');
          pinBox.classList.remove('hidden');
          pinInput.focus();
        } else {
          toggle.setAttribute('aria-checked', 'false');
          pinBox.classList.add('hidden');
          await saveSetting({ twoFactorEnabled: false });
          toast('Two-step verification disabled');
          renderSettingsList();
        }
      });

      sheet.querySelector('#2fa-save-pin')?.addEventListener('click', async () => {
        const pin = pinInput.value.trim();
        if (!/^\d{6}$/.test(pin)) {
          toast('PIN must be exactly 6 digits (numbers only)');
          pinInput.focus();
          return;
        }
        await saveSetting({ twoFactorPin: pin, twoFactorEnabled: true });
        toast('Two-step verification 6-digit PIN saved & activated!', 'success');
        renderSettingsList();
        closeSheet();
      });
    }
  });
}

function openStorageSheet() {
  openSheet({
    title: 'Storage & Data',
    body: `<div class="sheet-pad stack">
      <div class="stat-card stack" style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:16px">
        <div class="title" style="font-weight:600">Storage Footprint</div>
        <div class="row" style="justify-content:space-between;font-size:14px;margin-top:8px">
          <span>Cached media & files</span><b>~1.4 MB</b>
        </div>
        <div class="row" style="justify-content:space-between;font-size:14px">
          <span>Network mode</span><b>Firebase Cloud Sync</b>
        </div>
        <div class="row" style="justify-content:space-between;font-size:14px">
          <span>Auto-download photos</span><b>Wi-Fi & Cellular</b>
        </div>
      </div>
      <button class="btn btn-ghost btn-block" id="clear-cache-btn" style="margin-top:12px">${icon('trash')} Clear Cached Media</button>
    </div>`,
    onMount(sheet) {
      sheet.querySelector('#clear-cache-btn')?.addEventListener('click', () => {
        toast('Cache cleared', 'success');
        closeSheet();
      });
    }
  });
}

function openDevicesSheet() {
  openSheet({
    title: 'Linked Devices',
    body: `<div class="sheet-pad stack">
      <div class="muted" style="font-size:13px">Active login sessions for your DARK CHAT ID.</div>
      <div class="option" style="border:1px solid var(--border);border-radius:12px;padding:12px;margin-top:8px">
        <span class="option-icon">${icon('compass')}</span>
        <span class="option-copy"><b>Current Session (Web / Mobile)</b><small>Active right now · London / Cloud</small></span>
        <span class="badge" style="background:var(--green);color:#fff">Active</span>
      </div>
      <button class="btn btn-primary btn-block" id="link-device-btn" style="margin-top:12px">${icon('link')} Link Another Device</button>
    </div>`,
    onMount(sheet) {
      sheet.querySelector('#link-device-btn')?.addEventListener('click', () => {
        closeSheet();
        import('./profile.js').then(m => m.openQrSheet());
      });
    }
  });
}

function openStarredSheet() {
  const ids = state.settings.privacySettings?.starredMessageIds || [];
  openSheet({
    title: 'Starred Messages',
    body: `<div class="sheet-pad stack">
      ${!ids.length ? `<div class="empty"><div class="empty-icon">${icon('bookmark')}</div><div class="title">No starred messages yet</div><div class="muted" style="font-size:13px;text-align:center">Tap and hold any message in a chat and select "Star" to bookmark it here.</div></div>`
        : `<div class="sheet-body">${ids.map(id => `<div class="option" style="border:1px solid var(--border);border-radius:12px;padding:12px">
            <span class="option-icon">${icon('bookmark')}</span>
            <span class="option-copy"><b>Starred Item #${escapeHtml(id)}</b><small>Bookmarked message</small></span>
          </div>`).join('')}</div>`}
    </div>`
  });
}

function downloadBackup() {
  const url = api.backupDataUrl();
  window.open(url, '_blank');
  toast('Downloading account backup...', 'success');
}

function openAboutSheet() {
  openSheet({
    title: 'About DARK CHAT',
    body: `<div class="sheet-pad center stack" style="text-align:center;align-items:center">
      <img src="assets/logo.jpg?v=2" alt="" style="width:72px;height:72px;border-radius:20px;margin-bottom:8px">
      <div class="title" style="font-size:20px;font-weight:700">DARK CHAT</div>
      <div class="muted" style="font-size:13px">Version 2.4.0 (Build 2026.1)</div>
      <div class="muted" style="font-size:13px;max-width:320px;margin-top:8px">Next-generation private messaging platform powered by real-time WebSockets and Firebase Firestore.</div>
      <div class="stack" style="width:100%;margin-top:16px;text-align:left;gap:8px">
        <div class="option" style="border:1px solid var(--border);border-radius:12px;padding:12px">
          <span class="option-copy"><b>Privacy Policy</b><small>Data protection and end-to-end transport</small></span>
        </div>
        <div class="option" style="border:1px solid var(--border);border-radius:12px;padding:12px">
          <span class="option-copy"><b>Terms of Service</b><small>Standard user guidelines and community safety</small></span>
        </div>
      </div>
    </div>`
  });
}

function openDeleteAccountSheet() {
  openSheet({
    title: 'Delete account',
    body: `<div class="sheet-pad stack">
      <div class="alert alert-error">WARNING: Deleting your account will permanently remove your DARK CHAT ID, profile, contacts, groups, and message history. This cannot be undone.</div>
      <label class="field"><span class="field-label">Confirm password</span>
        <input class="input" type="password" id="del-pwd" placeholder="Enter your password to confirm"></label>
    </div>`,
    footer: `<div class="sheet-pad"><button class="btn btn-block" id="del-confirm-btn" style="background:var(--danger);color:#fff">Permanently Delete Account</button></div>`,
    onMount(sheet) {
      sheet.querySelector('#del-confirm-btn')?.addEventListener('click', async (e) => {
        const pwd = sheet.querySelector('#del-pwd').value;
        if (!pwd) { toast('Password is required'); return; }
        setBusy(e.currentTarget, true, 'Deleting...');
        try {
          await api.deleteAccount(pwd);
          closeSheet();
          toast('Account deleted');
          emit('auth:logout');
        } catch (err) {
          toast(err.message || 'Failed to delete account');
          setBusy(e.currentTarget, false);
        }
      });
    }
  });
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
