// socket.js - real-time layer over the existing Socket.IO server
import { state, emit } from './state.js';
import { apiOrigin } from './api.js';

let socket = null;
let connecting = null;

export function connectSocket() {
  if (socket) return Promise.resolve(socket);
  if (connecting) return connecting;
  connecting = (async () => {
    let io;
    try {
      const mod = await import('./socket.io.esm.min.js');
      io = mod.io || mod.default?.io || mod.default;
    } catch (err) {
      try {
        const mod = await import('/socket.io/socket.io.esm.min.js');
        io = mod.io || mod.default?.io || mod.default;
      } catch {
        throw new Error('Unable to load realtime client');
      }
    }
    // When UI is hosted on WebView assets, connect to the configured API origin
    let serverUrl = undefined;
    try {
      const meta = document.querySelector('meta[name="api-base"]');
      const base = (typeof window !== 'undefined' && window.__API_BASE__)
        || localStorage.getItem('apiBase')
        || (meta && meta.content)
        || '';
      if (base && /^https?:\/\//.test(base)) {
        serverUrl = base.replace(/\/api\/?$/, '');
      } else if (location.hostname.includes('appassets.androidplatform.net') || location.hostname === 'localhost' || location.protocol === 'file:') {
        serverUrl = localStorage.getItem('socketUrl') || apiOrigin();
      }
    } catch { /* ignore */ }
    socket = io(serverUrl, { auth: { token: state.token }, transports: ['websocket', 'polling'] });

    socket.on('connect', () => { state.socketReady = true; emit('socket:state', { connected: true }); });
    socket.on('disconnect', () => { state.socketReady = false; emit('socket:state', { connected: false }); });
    socket.on('connect_error', (err) => { state.socketReady = false; emit('socket:state', { connected: false, error: err?.message }); });

    socket.on('message:new', (msg) => emit('message:new', msg));
    socket.on('notification:new', (notification) => emit('notification:new', notification));
    socket.on('messages:read', (payload) => emit('messages:read', payload));
    socket.on('typing', (payload) => emit('typing', payload));
    socket.on('presence', (payload) => emit('presence', payload));
    socket.on('call:incoming', (payload) => emit('call:incoming', payload));
    socket.on('call:signal', (payload) => emit('call:signal', payload));
    socket.on('call:state', (payload) => emit('call:state', payload));

    return socket;
  })();
  return connecting;
}

export function disconnectSocket() {
  if (socket) {
    try { socket.disconnect(); } catch { /* ignore */ }
    socket = null;
    connecting = null;
  }
  state.socketReady = false;
}

export function joinConversation(conversationId) {
  if (socket) socket.emit('conversation:join', { conversationId });
}

export function sendMessage({ conversationId, content, media, replyToId, statusReply, clientMessageId }) {
  return new Promise((resolve) => {
    if (!socket) return resolve({ error: 'Not connected' });
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ error: 'Send timed out' }); } }, 5000);
    socket.emit('message:send', { conversationId, content, media, replyToId, statusReply, clientMessageId }, (ack) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ack || { error: 'No response' });
    });
  });
}

export function markConversationRead(conversationId) {
  if (socket && conversationId) socket.emit('conversation:read', { conversationId });
}

export function sendTyping(conversationId, isTyping) {
  if (socket) socket.emit('typing', { conversationId, isTyping });
}

export function inviteCall(targetUserId, call) {
  if (socket) socket.emit('call:invite', { targetUserId, call });
}

export function signalCall(targetUserId, callId, signal) {
  if (socket) socket.emit('call:signal', { targetUserId, callId, signal });
}

export function stateCall(targetUserId, callId, stateName) {
  if (socket) socket.emit('call:state', { targetUserId, callId, state: stateName });
}
