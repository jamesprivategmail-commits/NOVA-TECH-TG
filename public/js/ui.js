import { mediaSrc } from './api.js';
// ui.js - shared presentation helpers (escape, time, avatars, toast, sheet)
import { emit } from './state.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function icon(name, extraClass = '') {
  return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initials(name) {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function isImageUrl(url) {
  return typeof url === 'string' && /^\/api\/storage\/files\//.test(url);
}

function safeUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('data:video/') || trimmed.startsWith('data:audio/')) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;
  return null;
}

export function avatarUrl(user) {
  if (!user) return null;
  const raw = user.avatarUrl || user.avatar_url || user.avatarData || user.avatar_data;
  const u = safeUrl(raw);
  if (!u) return null;
  try {
    // Prefer absolute URLs for APK WebView
    if (typeof mediaSrc === 'function') return mediaSrc(u);
  } catch { /* ignore */ }
  return u;
}

// Returns HTML for an avatar (image if a real url exists, else coloured initials).
export function avatar(user, { size = '', cls = '', id = '' } = {}) {
  const name = user?.displayName || user?.display_name || user?.name || '';
  const color = user?.avatarColor || user?.avatar_color || '#1a1a1d';
  const url = avatarUrl(user);
  const classes = ['avatar', size ? `avatar-${size}` : '', cls].filter(Boolean).join(' ');
  const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
  if (url) {
    return `<span class="${classes}"${idAttr} style="background:${escapeHtml(color)}"><img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()"></span>`;
  }
  return `<span class="${classes}"${idAttr} style="background:${escapeHtml(color)}">${escapeHtml(initials(name))}</span>`;
}

export function verifyBadge(isVerified) {
  return isVerified ? `<span class="verify verify-meta" title="Verified account" aria-label="Verified account">${icon('badge-check')}</span>` : '';
}

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function dayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function lastSeenLabel(lastSeen, online) {
  if (online) return 'online';
  if (!lastSeen) return 'offline';
  const d = new Date(lastSeen);
  if (Number.isNaN(d.getTime())) return 'offline';
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'last seen just now';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `last seen ${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `last seen ${hrs}h ago`;
  return `last seen ${dayLabel(lastSeen).toLowerCase()}`;
}

export function conversationTitle(conv) {
  if (!conv) return '';
  if (conv.type === 'notes') return conv.name || 'Saved Messages';
  if (conv.type === 'dm') return conv.other_user?.display_name || conv.name || 'Direct message';
  return conv.name || (conv.type === 'channel' ? 'Channel' : 'Group');
}

export function conversationIsVerified(conv) {
  if (!conv) return false;
  return conv.type === 'dm' ? Boolean(conv.other_user?.is_verified) : Boolean(conv.is_verified);
}

export function conversationAvatarUser(conv) {
  if (!conv) return {};
  if (conv.type === 'notes') {
    return {
      displayName: 'Saved Messages',
      avatarUrl: null,
      avatarColor: '#0A84FF',
      isVerified: false
    };
  }
  if (conv.type === 'dm' && conv.other_user) {
    return {
      displayName: conv.other_user.display_name,
      avatarUrl: conv.other_user.avatar_url,
      avatarColor: conv.other_user.avatar_color,
      isVerified: conv.other_user.is_verified
    };
  }
  return { displayName: conv.name, avatarUrl: conv.avatar_url, avatarColor: conv.avatar_color, isVerified: conv.is_verified };
}

// ---------- toast ----------
export function toast(message, kind = '') {
  const host = $('#toast-host');
  if (!host) return;
  const node = document.createElement('div');
  node.className = `toast ${kind}`.trim();
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, 2600);
}

// ---------- sheet / overlay ----------
let overlayHandler = null;

export function openSheet({ title = '', body = '', footer = '', onMount = null, onClose = null } = {}) {
  const overlay = $('#overlay');
  const sheet = $('#sheet');
  if (!overlay || !sheet) return null;
  sheet.innerHTML = `
    <div class="handle" aria-hidden="true"></div>
    ${title ? `<div class="sheet-title">${title}</div>` : ''}
    <div class="sheet-body" id="sheet-body">${body}</div>
    ${footer ? `<div class="sheet-foot" id="sheet-foot">${footer}</div>` : ''}
  `;
  overlay.hidden = false;
  overlayHandler = (event) => { if (event.target === overlay) closeSheet(); };
  overlay.addEventListener('click', overlayHandler);
  const onKey = (event) => { if (event.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);
  overlay._onKey = onKey;
  overlay._onClose = onClose;
  if (typeof onMount === 'function') onMount(sheet);
  return sheet;
}

export function closeSheet() {
  const overlay = $('#overlay');
  const sheet = $('#sheet');
  if (!overlay) return;
  if (overlayHandler) overlay.removeEventListener('click', overlayHandler);
  if (overlay._onKey) document.removeEventListener('keydown', overlay._onKey);
  overlay.hidden = true;
  if (sheet) sheet.innerHTML = '';
  const cb = overlay._onClose;
  overlay._onClose = null;
  overlayHandler = null;
  if (typeof cb === 'function') cb();
}

export function isSheetOpen() {
  const overlay = $('#overlay');
  return overlay ? !overlay.hidden : false;
}

// ---------- confirm / prompt ----------
export function confirmSheet({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const done = (value) => { if (decided) return; decided = true; closeSheet(); resolve(value); };
    openSheet({
      title: escapeHtml(title),
      body: `<div class="sheet-pad"><p class="muted">${escapeHtml(message)}</p></div>`,
      footer: `<div class="sheet-pad row">
        <button class="btn btn-ghost grow" data-act="cancel">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} grow" data-act="ok">${escapeHtml(confirmText)}</button>
      </div>`,
      onMount(sheet) {
        sheet.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
        sheet.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
      },
      onClose() { done(false); }
    });
  });
}

export function promptSheet({ title = '', label = '', placeholder = '', value = '', confirmText = 'Save', multiline = false } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const done = (v) => { if (decided) return; decided = true; closeSheet(); resolve(v); };
    const field = multiline
      ? `<textarea class="textarea" id="prompt-input" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`
      : `<input class="input" id="prompt-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}">`;
    openSheet({
      title: escapeHtml(title),
      body: `<div class="sheet-pad">
        <label class="field"><span class="field-label">${escapeHtml(label)}</span>${field}</label>
      </div>`,
      footer: `<div class="sheet-pad row">
        <button class="btn btn-ghost grow" data-act="cancel">Cancel</button>
        <button class="btn btn-primary grow" data-act="ok">${escapeHtml(confirmText)}</button>
      </div>`,
      onMount(sheet) {
        const input = sheet.querySelector('#prompt-input');
        input.focus();
        input.select?.();
        sheet.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
        sheet.querySelector('[data-act="ok"]').addEventListener('click', () => done(input.value.trim()));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) done(input.value.trim()); });
      },
      onClose() { done(null); }
    });
  });
}

// ---------- states ----------
export function emptyState({ iconName = 'message', title = '', subtitle = '', actionLabel = '', actionId = '' } = {}) {
  return `<div class="empty">
    <div class="empty-icon">${icon(iconName)}</div>
    <div class="title">${escapeHtml(title)}</div>
    ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
    ${actionLabel ? `<button class="btn btn-primary" id="${escapeHtml(actionId)}">${escapeHtml(actionLabel)}</button>` : ''}
  </div>`;
}

export function errorState({ title = 'Something went wrong', subtitle = '', retryId = 'retry' } = {}) {
  return `<div class="empty">
    <div class="empty-icon">${icon('alert')}</div>
    <div class="title">${escapeHtml(title)}</div>
    ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
    <button class="btn btn-ghost" id="${escapeHtml(retryId)}">${icon('refresh')}Try again</button>
  </div>`;
}

export function skeletonList(rows = 6) {
  let html = '';
  for (let i = 0; i < rows; i++) {
    html += `<div class="skeleton-row"><div class="skeleton av"></div><div class="lines"><div class="skeleton l1"></div><div class="skeleton l2"></div></div></div>`;
  }
  return html;
}

export function setBusy(button, busy, busyLabel = 'Working...') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    if (button.dataset.label) { button.innerHTML = button.dataset.label; delete button.dataset.label; }
  }
}

// ---------- files ----------
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function humanSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function refreshUnread() { emit('unread:changed'); }


/** Escape text then turn http(s) URLs into safe links. */
export function linkify(value) {
  const raw = String(value ?? '');
  const escaped = escapeHtml(raw);
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a class="msg-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
}

/** Generate a clean high-contrast SVG QR-style visual code for DARK CHAT IDs and links */
export function renderQrSvg(payload, size = 200) {
  const str = String(payload || 'DARKCHAT');
  const grid = 25;
  const matrix = Array.from({ length: grid }, () => Array(grid).fill(false));

  // Position markers (7x7 in 3 corners)
  function drawMarker(r0, c0) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const border = r === 0 || r === 6 || c === 0 || c === 6;
        const center = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[r0 + r][c0 + c] = border || center;
      }
    }
  }
  drawMarker(0, 0);
  drawMarker(0, grid - 7);
  drawMarker(grid - 7, 0);

  // Timing lines
  for (let i = 8; i < grid - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Generate deterministic pattern based on payload characters
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }

  let bitIdx = 0;
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      // Skip corner markers and timing lines
      const inTopLeft = r < 8 && c < 8;
      const inTopRight = r < 8 && c >= grid - 8;
      const inBottomLeft = r >= grid - 8 && c < 8;
      const inTiming = r === 6 || c === 6;
      if (inTopLeft || inTopRight || inBottomLeft || inTiming) continue;

      const charVal = str.charCodeAt(bitIdx % str.length) || 42;
      const bit = ((hash ^ (r * 31 + c * 17) ^ (charVal << (bitIdx % 8))) & 1) === 1;
      matrix[r][c] = bit;
      bitIdx++;
    }
  }

  const cellSize = size / (grid + 4);
  const offset = cellSize * 2;
  let rects = '';
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${(offset + c * cellSize).toFixed(2)}" y="${(offset + r * cellSize).toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="#ffffff" rx="1.5"/>`;
      }
    }
  }

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="background:#0a0a0c;border-radius:16px;padding:8px" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="#0a0a0c" rx="16"/>
    ${rects}
  </svg>`;
}
