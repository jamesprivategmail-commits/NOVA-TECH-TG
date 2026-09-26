const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const STORE_PATH = path.join(__dirname, 'data-store.json');

// Precomputed bcrypt hash for '21272127'
const ADMIN_PASSWORD_HASH = bcrypt.hashSync('21272127', 10);

const defaultStore = {
  users: {
    'u_1789899726676_828027': {
      id: 'u_1789899726676_828027',
      nova_id: '+1-999-234-8321',
      display_name: '𝕾⃟MR DARKHEX𖤍',
      password_hash: ADMIN_PASSWORD_HASH,
      avatar_color: '#ff3131',
      avatar_url: '/api/storage/files/file_1789932298737_a15455bc',
      avatar_data: '/api/storage/files/file_1789932298737_a15455bc',
      avatar_mime: 'image/jpeg',
      bio: 'MR DARKHEX OWNER AND FOUNDER ',
      is_verified: true,
      is_banned: false,
      ban_reason: null,
      dark_pair_linked: true,
      created_at: '2026-09-20T10:22:06.676Z',
      last_seen: new Date().toISOString()
    },
    'u_admin_master': {
      id: 'u_admin_master',
      nova_id: '+1-999-234-8321',
      display_name: 'DARK CHAT Admin',
      password_hash: ADMIN_PASSWORD_HASH,
      avatar_color: '#ff3131',
      avatar_url: '/assets/logo.jpg',
      bio: 'Official DARK CHAT Administrator',
      is_verified: true,
      is_banned: false,
      created_at: '2026-09-20T10:22:06.676Z',
      last_seen: new Date().toISOString()
    },
    'u_dark_pair': {
      id: 'u_dark_pair',
      nova_id: 'DARK-PAIR',
      display_name: 'DARK PAIR',
      password_hash: null,
      avatar_color: '#7C3AED',
      avatar_url: '/assets/logo.jpg',
      bio: 'DARK CHAT quick assistant. Send /start to see the menu.',
      is_verified: true,
      is_system: true,
      is_banned: false,
      created_at: '2026-09-20T10:22:06.676Z',
      last_seen: new Date().toISOString()
    }
  },
  conversations: {},
  messages: {}, // convId -> [messages]
  statuses: {},
  posts: {},
  comments: {}, // postId -> [comments]
  notifications: {}, // userId -> [notifications]
  calls: {},
  storage_files: {}
};

let store = defaultStore;

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      store = {
        users: { ...defaultStore.users, ...(parsed.users || {}) },
        conversations: { ...defaultStore.conversations, ...(parsed.conversations || {}) },
        messages: { ...defaultStore.messages, ...(parsed.messages || {}) },
        statuses: { ...defaultStore.statuses, ...(parsed.statuses || {}) },
        posts: { ...defaultStore.posts, ...(parsed.posts || {}) },
        comments: { ...defaultStore.comments, ...(parsed.comments || {}) },
        notifications: { ...defaultStore.notifications, ...(parsed.notifications || {}) },
        calls: { ...defaultStore.calls, ...(parsed.calls || {}) },
        storage_files: { ...defaultStore.storage_files, ...(parsed.storage_files || {}) }
      };
      // Ensure admin passwords are valid
      if (store.users['u_1789899726676_828027']) {
        store.users['u_1789899726676_828027'].password_hash = ADMIN_PASSWORD_HASH;
      }
      if (store.users['u_admin_master']) {
        store.users['u_admin_master'].password_hash = ADMIN_PASSWORD_HASH;
      }
    } else {
      saveStoreSync();
    }
  } catch (err) {
    console.warn('Could not load data-store.json, using defaults:', err.message);
  }
}

let saveTimeout = null;
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveStoreSync();
  }, 300);
}

function saveStoreSync() {
  try {
    // Avoid saving huge base64 chunk data in main JSON if large
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save data-store.json:', err.message);
  }
}

loadStore();

module.exports = {
  getStore: () => store,
  scheduleSave,
  saveStoreSync,

  // Users
  getUserById(id) {
    if (!id) return null;
    return store.users[String(id)] || null;
  },

  getUserByNovaId(novaId) {
    if (!novaId) return null;
    const clean = String(novaId).trim().toUpperCase();
    for (const u of Object.values(store.users)) {
      if (u && u.nova_id && u.nova_id.toUpperCase() === clean) {
        return u;
      }
    }
    return null;
  },

  setUser(user) {
    if (!user || !user.id) return;
    store.users[String(user.id)] = { ...user };
    scheduleSave();
  },

  updateUser(id, updates) {
    const existing = store.users[String(id)];
    if (!existing) return null;
    store.users[String(id)] = { ...existing, ...updates };
    scheduleSave();
    return store.users[String(id)];
  },

  deleteUser(id) {
    delete store.users[String(id)];
    scheduleSave();
  },

  getAllUsers(search = '', limitCount = 100) {
    let list = Object.values(store.users);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(u =>
        (u.nova_id && u.nova_id.toLowerCase().includes(s)) ||
        (u.display_name && u.display_name.toLowerCase().includes(s))
      );
    }
    list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    return list.slice(0, limitCount);
  },

  // Conversations
  getConversationById(id) {
    if (!id) return null;
    return store.conversations[String(id)] || null;
  },

  setConversation(conv) {
    if (!conv || !conv.id) return;
    store.conversations[String(conv.id)] = { ...conv };
    scheduleSave();
  },

  updateConversation(id, updates) {
    const existing = store.conversations[String(id)];
    if (!existing) return null;
    // Support nested updates like members.userId
    const updated = { ...existing };
    for (const [k, v] of Object.entries(updates)) {
      if (k.startsWith('members.') && typeof v === 'object') {
        const mid = k.slice(8);
        updated.members = { ...(updated.members || {}), [mid]: v };
      } else {
        updated[k] = v;
      }
    }
    store.conversations[String(id)] = updated;
    scheduleSave();
    return updated;
  },

  deleteConversation(id) {
    delete store.conversations[String(id)];
    delete store.messages[String(id)];
    scheduleSave();
  },

  getAllConversations() {
    return Object.values(store.conversations);
  },

  // Messages
  addMessage(convId, message) {
    const cid = String(convId);
    if (!store.messages[cid]) store.messages[cid] = [];
    const list = store.messages[cid];
    const idx = list.findIndex(m => m.id === message.id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...message };
    } else {
      list.push(message);
    }
    scheduleSave();
  },

  getMessages(convId) {
    const cid = String(convId);
    return store.messages[cid] ? [...store.messages[cid]] : [];
  },

  getMessageById(convId, msgId) {
    if (!msgId) return null;
    const cid = String(convId);
    const targetId = String(msgId).trim();
    const msgs = store.messages[cid] || [];
    let msg = msgs.find(m => String(m.id).trim() === targetId);
    if (msg) return msg;
    for (const list of Object.values(store.messages)) {
      msg = list.find(m => String(m.id).trim() === targetId);
      if (msg) return msg;
    }
    return null;
  },

  updateMessage(convId, msgId, updates) {
    if (!msgId) return null;
    const cid = String(convId);
    const targetId = String(msgId).trim();
    let msgs = store.messages[cid] || [];
    let msg = msgs.find(m => String(m.id).trim() === targetId);
    if (!msg) {
      for (const list of Object.values(store.messages)) {
        msg = list.find(m => String(m.id).trim() === targetId);
        if (msg) break;
      }
    }
    if (!msg) return null;
    Object.assign(msg, updates);
    scheduleSave();
    return { ...msg };
  },

  // Statuses
  addStatus(status) {
    store.statuses[String(status.id)] = { ...status };
    scheduleSave();
  },

  getStatuses() {
    return Object.values(store.statuses);
  },

  getStatusById(id) {
    return store.statuses[String(id)] || null;
  },

  updateStatus(id, updates) {
    const s = store.statuses[String(id)];
    if (!s) return null;
    Object.assign(s, updates);
    scheduleSave();
    return { ...s };
  },

  deleteStatus(id) {
    delete store.statuses[String(id)];
    scheduleSave();
  },

  // Posts
  addPost(post) {
    store.posts[String(post.id)] = { ...post };
    scheduleSave();
  },

  getPosts() {
    return Object.values(store.posts);
  },

  getPostById(id) {
    return store.posts[String(id)] || null;
  },

  updatePost(id, updates) {
    const p = store.posts[String(id)];
    if (!p) return null;
    Object.assign(p, updates);
    scheduleSave();
    return { ...p };
  },

  deletePost(id) {
    delete store.posts[String(id)];
    delete store.comments[String(id)];
    scheduleSave();
  },

  // Comments
  addComment(postId, comment) {
    const pid = String(postId);
    if (!store.comments[pid]) store.comments[pid] = [];
    store.comments[pid].push(comment);
    scheduleSave();
  },

  getComments(postId) {
    return store.comments[String(postId)] ? [...store.comments[String(postId)]] : [];
  },

  // Notifications
  addNotification(notif) {
    const uid = String(notif.user_id);
    if (!store.notifications[uid]) store.notifications[uid] = [];
    store.notifications[uid].unshift(notif);
    scheduleSave();
  },

  getNotifications(userId) {
    return store.notifications[String(userId)] ? [...store.notifications[String(userId)]] : [];
  },

  updateNotification(userId, notifId, updates) {
    const list = store.notifications[String(userId)] || [];
    const n = list.find(item => item.id === String(notifId));
    if (n) {
      Object.assign(n, updates);
      scheduleSave();
    }
  },

  // Calls
  addCallSession(call) {
    store.calls[String(call.id)] = { ...call };
    scheduleSave();
  },

  getCallSession(callId) {
    return store.calls[String(callId)] || null;
  },

  updateCallSession(callId, updates) {
    const c = store.calls[String(callId)];
    if (!c) return null;
    Object.assign(c, updates);
    scheduleSave();
    return { ...c };
  },

  getCallHistory(convId) {
    return Object.values(store.calls).filter(c => String(c.conversation_id) === String(convId));
  },

  // Storage
  setStorageFile(fileId, data) {
    store.storage_files[String(fileId)] = { ...data };
    scheduleSave();
  },

  getStorageFile(fileId) {
    return store.storage_files[String(fileId)] || null;
  },

  deleteStorageFile(fileId) {
    delete store.storage_files[String(fileId)];
    scheduleSave();
  }
};
