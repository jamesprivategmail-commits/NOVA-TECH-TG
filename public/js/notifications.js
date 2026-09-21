// notifications.js - notification centre and unread badge
import { api } from './api.js';
import { state, on, emit } from './state.js';
import { $, icon, escapeHtml, timeAgo, emptyState, errorState, skeletonList, toast, openSheet } from './ui.js';

let els = {};

export function initNotifications() {
  els = { badge: $('#notif-badge'), btn: $('#notifications-btn') };
  els.btn?.addEventListener('click', openNotifications);
  on('auth:signed-in', () => refreshUnread());
  on('notification:new', onNewNotification);
  if (state.token) refreshUnread();
}

function onNewNotification(notification) {
  if (!notification || notification.user_id !== state.me?.id) return;
  state.unreadNotifications += 1;
  state.notifications = [notification, ...state.notifications.filter((n) => n.id !== notification.id)].slice(0, 50);
  renderBadge();
  toast(notification.type === 'message' ? `${notification.actor_name || 'Someone'} sent you a message` : 'New notification');
}

export async function refreshUnread() {
  try {
    const res = await api.unreadCount();
    state.unreadNotifications = res.count || 0;
    renderBadge();
  } catch { /* keep silent - badge is non-critical */ }
}

function renderBadge() {
  const badge = els.badge;
  if (!badge) return;
  const count = state.unreadNotifications;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('hidden', !count);
  // Chats tab dot is owned by chats.js (real message unreads).
}

function notificationText(n) {
  const actor = n.actor_name || 'Someone';
  switch (n.type) {
    case 'message': return `${actor} sent you a message`;
    case 'reaction': return `${actor} reacted to your message`;
    case 'follow': return `${actor} started following you`;
    case 'like': return `${actor} liked your update`;
    case 'comment': return `${actor} commented on your update`;
    case 'call': return `${actor} called you`;
    default: return n.payload?.text || `${actor} sent a notification`;
  }
}

export async function openNotifications() {
  openSheet({
    title: 'Notifications',
    body: '<div id="notif-body">' + skeletonList(5) + '</div>',
    footer: '<div class="sheet-pad"><button class="btn btn-ghost btn-block" id="notif-read-all">Mark all as read</button></div>',
    onMount(sheet) {
      sheet.querySelector('#notif-read-all').addEventListener('click', async () => {
        try {
          await api.markRead();
          state.unreadNotifications = 0;
          renderBadge();
          toast('All marked as read', 'success');
          loadNotifications();
        } catch (err) { toast(err.message || 'Could not mark read'); }
      });
    }
  });
  loadNotifications();
}

async function loadNotifications() {
  const body = $('#notif-body');
  if (!body) return;
  try {
    const res = await api.notifications();
    state.notifications = res.notifications || [];
    if (!state.notifications.length) {
      body.innerHTML = emptyState({ iconName: 'bell', title: "You're all caught up", subtitle: 'No new notifications right now.' });
      return;
    }
    body.innerHTML = state.notifications.map((n) => `<button class="option" data-notif="${escapeHtml(n.id)}" data-read="${n.read_at ? '1' : '0'}">
      <span class="option-icon">${icon(n.type === 'message' ? 'message' : n.type === 'call' ? 'phone' : n.type === 'like' ? 'heart' : n.type === 'comment' ? 'comment' : 'bell')}</span>
      <span class="option-copy" style="${n.read_at ? '' : 'font-weight:600'}">${escapeHtml(notificationText(n))}
        <small>${escapeHtml(timeAgo(n.created_at))}</small></span>
      ${n.read_at ? '' : '<span class="unread">1</span>'}
    </button>`).join('');
    body.querySelectorAll('[data-notif]').forEach((btn) => btn.addEventListener('click', async () => {
      const notification = state.notifications.find((n) => n.id === btn.dataset.notif);
      if (btn.dataset.read !== '1') {
        try {
          await api.markRead(btn.dataset.notif);
          btn.dataset.read = '1';
          btn.querySelector('.unread')?.remove();
          btn.querySelector('.option-copy')?.style.removeProperty('font-weight');
          state.unreadNotifications = Math.max(0, state.unreadNotifications - 1);
          renderBadge();
        } catch { /* ignore */ }
      }
      if (notification?.type === 'message' && notification.payload?.conversationId) {
        emit('notification:open-chat', { conversationId: notification.payload.conversationId });
      }
    }));
  } catch (err) {
    body.innerHTML = errorState({ title: 'Could not load notifications', subtitle: err.message, retryId: 'retry-notif' });
    $('#retry-notif')?.addEventListener('click', loadNotifications);
  }
}
