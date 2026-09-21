// discover.js - find people and start chats
import { api } from './api.js';
import { state, emit } from './state.js';
import {
  $, avatar, icon, escapeHtml, emptyState, errorState, skeletonList, toast, verifyBadge
} from './ui.js';

let els = {};
let seq = 0;

export function initDiscover() {
  els = { list: $('#discover-list'), search: $('#discover-search'), count: $('#discover-count') };
  els.search?.addEventListener('input', debounce(() => loadDiscover(), 260));
  renderIntro();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function renderIntro() {
  if (els.list) els.list.innerHTML = emptyState({
    iconName: 'compass',
    title: 'Find people on DARK CHAT',
    subtitle: 'Search by name or DARK CHAT ID to start a conversation.'
  });
}

export async function loadDiscover() {
  let term = (els.search?.value || '').trim();
  // Normalize phone-style IDs: keep + and digits/dashes
  if (term && /\d/.test(term)) {
    term = term.replace(/\s+/g, '');
  }
  const local = ++seq;
  els.list.innerHTML = skeletonList(6);
  try {
    const res = await api.discover(term);
    if (local !== seq) return;
    if (els.count) {
      const totalUsers = Number(res.totalUsers);
      els.count.textContent = Number.isFinite(totalUsers)
        ? `Total users: ${totalUsers.toLocaleString()}`
        : '';
    }
    const users = (res.users || []).filter((u) => String(u.id) !== String(state.me?.id));
    if (!users.length) {
      els.list.innerHTML = emptyState({
        iconName: 'users',
        title: term ? 'No one matches' : 'No one to show yet',
        subtitle: term ? 'Try a different name or DARK CHAT ID.' : 'When others join DARK CHAT they will appear here.'
      });
      return;
    }
    els.list.innerHTML = users.map(userCard).join('');
    els.list.querySelectorAll('[data-message]').forEach((btn) => btn.addEventListener('click', () => startChat(btn.dataset.message, btn)));
  } catch (err) {
    if (local !== seq) return;
    els.list.innerHTML = errorState({ title: 'Could not load people', subtitle: err.message, retryId: 'retry-discover' });
    $('#retry-discover')?.addEventListener('click', loadDiscover);
  }
}

function userCard(u) {
  return `<div class="discover-card">
    <span class="avatar-wrap">${avatar({ displayName: u.displayName, avatarUrl: u.avatarUrl, avatarColor: u.avatarColor })}</span>
    <div class="discover-head">
      <div class="discover-info">
        <div class="discover-name truncate">${escapeHtml(u.displayName || 'DARK CHAT User')} ${verifyBadge(u.isVerified)}</div>
        <div class="discover-handle truncate">${escapeHtml(u.novaId || '')}</div>
        ${u.bio ? `<div class="discover-bio truncate">${escapeHtml(u.bio)}</div>` : ''}
      </div>
    </div>
    <button class="follow-btn" data-message="${escapeHtml(u.novaId || '')}" aria-label="Message ${escapeHtml(u.displayName || 'user')}">${icon('message')} Message</button>
  </div>`;
}

async function startChat(novaId, button) {
  if (!novaId) return;
  button.disabled = true;
  try {
    const res = await api.createDm(novaId);
    const refreshed = await api.conversations();
    state.conversations = refreshed.conversations || [];
    emit('conversations:changed');
    const conv = state.conversations.find((c) => c.id === res.conversationId);
    if (conv) emit('chat:open', conv);
    else toast('Chat ready');
  } catch (err) {
    toast(err.message || 'Could not start chat');
  } finally {
    button.disabled = false;
  }
}


/** Open or create Saved Messages (notes to self) */
export async function openSavedMessages() {
  if (!state.me?.novaId) {
    toast('Sign in first');
    return;
  }
  try {
    const res = await api.createDm(state.me.novaId);
    const refreshed = await api.conversations();
    state.conversations = refreshed.conversations || [];
    emit('conversations:changed');
    const conv = state.conversations.find((c) => c.id === res.conversationId);
    if (conv) emit('chat:open', conv);
    else toast('Saved Messages ready');
  } catch (err) {
    toast(err.message || 'Could not open Saved Messages');
  }
}
