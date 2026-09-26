const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { managementDefaults } = require('./conversationPermissions');
const { initializeApp, getApps } = require('firebase/app');
const {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} = require('firebase/auth');
const {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
  arrayUnion,
  arrayRemove
} = require('firebase/firestore');
const {
  getStorage,
  ref: storageRef,
  uploadBytes,
  getBytes,
  deleteObject
} = require('firebase/storage');
const cacheStore = require('./cacheStore');

// Load config from firebase-applet-config.json
const configPath = path.join(__dirname, '..', 'firebase-applet-config.json');
let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.warn('Could not parse firebase-applet-config.json:', e.message);
  }
}

let firebaseApp = null;
let firestoreDb = null;
let firebaseAuth = null;
let firebaseStorage = null;
let isInitialized = false;
let initPromise = null;

const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

function handleFirestoreError(error, operationType, path = null) {
  const msg = error instanceof Error ? error.message : String(error);
  const isQuota = msg.includes('Quota exceeded') || error?.code === 'resource-exhausted';
  if (isQuota) {
    console.warn(`[Firestore Quota Notice] ${operationType} on ${path || 'unknown'} - using resilient local store.`);
    return;
  }
  console.warn(`Firestore Error [${operationType}]:`, msg);
}

async function ensureInit() {
  if (isInitialized && firestoreDb) return firestoreDb;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (!getApps().length) {
        firebaseApp = initializeApp(config);
      } else {
        firebaseApp = getApps()[0];
      }
      firebaseAuth = getAuth(firebaseApp);
      try {
        firebaseStorage = getStorage(firebaseApp);
      } catch (e) {
        console.warn('Firebase Storage init notice:', e.message);
      }

      const email = 'service-backend@darkchat.internal';
      const password = 'DarkChatSecure2026!';
      try {
        await signInWithEmailAndPassword(firebaseAuth, email, password);
      } catch (e) {
        if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
          try {
            await createUserWithEmailAndPassword(firebaseAuth, email, password);
          } catch (createErr) {
            // ignore
          }
        }
      }

      const dbId = config.firestoreDatabaseId || undefined;
      firestoreDb = getFirestore(firebaseApp, dbId);
      isInitialized = true;
      console.log('✅ Firebase initialized successfully for DARK CHAT (database:', dbId, ')');

      // Attempt initial background sync from Firestore into cache if quota allows
      void syncRecentFromFirestore();
    } catch (err) {
      console.warn('Firebase init fallback to local resilient store:', err.message);
      isInitialized = true;
    }
    return firestoreDb;
  })();

  return initPromise;
}

async function syncRecentFromFirestore() {
  if (!firestoreDb) return;
  try {
    const snap = await getDocs(query(collection(firestoreDb, 'users'), limit(50)));
    for (const d of snap.docs) {
      const u = d.data();
      if (u && u.id) {
        // Do not overwrite seeded admin password if local is newer
        const existing = cacheStore.getUserById(u.id);
        if (existing && existing.nova_id === '+1-999-234-8321' && existing.password_hash) {
          cacheStore.setUser({ ...u, password_hash: existing.password_hash });
        } else {
          cacheStore.setUser(u);
        }
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }

  try {
    const cSnap = await getDocs(query(collection(firestoreDb, 'conversations'), limit(50)));
    for (const d of cSnap.docs) {
      const c = d.data();
      if (c && c.id) cacheStore.setConversation(c);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'conversations');
  }
}

// ---------------- STORAGE SERVICE ----------------
async function uploadToStorage({ data, mimeType = 'image/jpeg', filename = 'upload.bin', userId = null }) {
  await ensureInit();
  const fileId = 'file_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');

  let base64Data = data;
  let detectedMime = mimeType;
  if (typeof data === 'string' && data.startsWith('data:')) {
    const commaIndex = data.indexOf(',');
    if (commaIndex !== -1) {
      const header = data.slice(0, commaIndex);
      const mimeMatch = header.match(/^data:([^;]+)/);
      if (mimeMatch) detectedMime = mimeMatch[1];
      base64Data = data.slice(commaIndex + 1);
    }
  }
  if (typeof base64Data === 'string') {
    base64Data = base64Data.replace(/\s+/g, '');
  }

  const byteLength = Buffer.from(base64Data || '', 'base64').length;

  const metadata = {
    id: fileId,
    filename,
    mimeType: detectedMime,
    size: byteLength,
    userId,
    createdAt: new Date().toISOString(),
    data: base64Data
  };

  // Always store in local cache immediately
  cacheStore.setStorageFile(fileId, metadata);

  // Attempt cloud sync if accessible
  if (firestoreDb && byteLength <= 700 * 1024) {
    setDoc(doc(firestoreDb, 'storage_files', fileId), metadata).catch(err => {
      handleFirestoreError(err, OperationType.WRITE, `storage_files/${fileId}`);
    });
  }

  const downloadUrl = `/api/storage/files/${fileId}`;
  return { fileId, url: downloadUrl, mimeType: detectedMime, size: byteLength };
}

async function getStorageFile(fileId) {
  const cached = cacheStore.getStorageFile(fileId);
  if (cached && cached.data) {
    return {
      ...cached,
      buffer: Buffer.from(cached.data, 'base64')
    };
  }

  await ensureInit();
  if (!firestoreDb) return null;

  try {
    const snap = await getDoc(doc(firestoreDb, 'storage_files', fileId));
    if (snap.exists()) {
      const file = snap.data();
      if (file.data) {
        cacheStore.setStorageFile(fileId, file);
        return { ...file, buffer: Buffer.from(file.data, 'base64') };
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `storage_files/${fileId}`);
  }
  return null;
}

async function deleteStorageFile(fileId) {
  cacheStore.deleteStorageFile(fileId);
  await ensureInit();
  if (firestoreDb) {
    deleteDoc(doc(firestoreDb, 'storage_files', fileId)).catch(err => {
      handleFirestoreError(err, OperationType.DELETE, `storage_files/${fileId}`);
    });
  }
}

// ---------------- USERS ----------------
async function createUser(userData) {
  const id = userData.id || 'u_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const now = new Date().toISOString();
  const user = {
    id,
    nova_id: (userData.novaId || userData.nova_id).trim().toUpperCase(),
    display_name: (userData.displayName || userData.display_name).trim(),
    password_hash: userData.passwordHash || userData.password_hash,
    avatar_color: userData.avatarColor || userData.avatar_color || '#0A84FF',
    avatar_url: userData.avatarUrl || userData.avatar_url || null,
    avatar_data: userData.avatarData || userData.avatar_data || null,
    avatar_mime: userData.avatarMime || userData.avatar_mime || null,
    bio: userData.bio || '',
    is_verified: !!userData.isVerified || !!userData.is_verified,
    is_banned: !!userData.isBanned || !!userData.is_banned,
    ban_reason: userData.banReason || userData.ban_reason || null,
    created_at: userData.createdAt || now,
    last_seen: userData.lastSeen || now
  };

  // 1. Immediately store in local cache
  cacheStore.setUser(user);

  // 2. Attempt Firestore sync
  await ensureInit();
  if (firestoreDb) {
    setDoc(doc(firestoreDb, 'users', id), user).catch(err => {
      handleFirestoreError(err, OperationType.WRITE, `users/${id}`);
    });
  }

  return user;
}

async function getUserById(id) {
  if (!id) return null;
  const cached = cacheStore.getUserById(id);
  if (cached) return cached;

  await ensureInit();
  if (!firestoreDb) return null;
  try {
    const snap = await getDoc(doc(firestoreDb, 'users', String(id)));
    if (snap.exists()) {
      const u = snap.data();
      cacheStore.setUser(u);
      return u;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${id}`);
  }
  return null;
}

async function getUserByNovaId(novaId) {
  if (!novaId) return null;
  const cached = cacheStore.getUserByNovaId(novaId);
  if (cached) return cached;

  await ensureInit();
  if (!firestoreDb) return null;
  try {
    const q = query(
      collection(firestoreDb, 'users'),
      where('nova_id', '==', String(novaId).trim().toUpperCase()),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const u = snap.docs[0].data();
      cacheStore.setUser(u);
      return u;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
  return null;
}

async function updateUser(id, updates) {
  const mapped = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) mapped[k] = v;
  }

  const updated = cacheStore.updateUser(id, mapped);

  await ensureInit();
  if (firestoreDb) {
    updateDoc(doc(firestoreDb, 'users', String(id)), mapped).catch(err => {
      handleFirestoreError(err, OperationType.UPDATE, `users/${id}`);
    });
  }

  return updated;
}

async function getAllUsers(search = '', limitCount = 100) {
  return cacheStore.getAllUsers(search, limitCount);
}

async function getUserCount() {
  return cacheStore.getUserCount();
}

function getDarkPairMenu() {
  return [
    '╔══════════════════╗',
    '║  DARK BOT',
    '╠══════════════════╣',
    '║ 👑 𝗢𝗪𝗡𝗘𝗥',
    '║ ┠ .ping',
    '║ ┠ .uptime',
    '║ ┠ .self',
    '║ ┠ .block <user>',
    '║ ┠ .unblock <user>',
    '║ ┠ .channeljid',
    '║ ┖ .getchanneljid <code>',
    '╠══════════════════╣',
    '║ 🔎 𝗨𝗧𝗜𝗟𝗜𝗧𝗬',
    '║ ┖ .chatjid',
    '╠══════════════════╣',
    '║ 🛡️ 𝗚𝗥𝗢𝗨𝗣 𝗠𝗔𝗡𝗔𝗚𝗘𝗠𝗘𝗡𝗧',
    '║ ┠ .promote <user>',
    '║ ┠ .demote <user>',
    '║ ┠ .kick <user>',
    '║ ┖ .groupinfo',
    '╠══════════════════╣',
    '║ 🛠️ 𝗧𝗢𝗢𝗟𝗦',
    '║ ┖ .owner',
    '╠══════════════════╣',
    '║  📲',
    '╚══════════════════╝'
  ].join('\n');
}

async function getDarkBotCommandReply(content, userId, conversationId) {
  const text = String(content || '').trim();
  const parts = text.split(/\s+/);
  const command = (parts[0] || '').toLowerCase();
  const user = await getUserById(userId);
  const conv = conversationId ? await getConversationById(conversationId) : null;
  const role = conv?.members?.[userId]?.role || (conv?.owner_id === userId ? 'owner' : null);
  const isGroup = conv?.type === 'group';
  const isChannel = conv?.type === 'channel';
  const target = parts[1] ? await getUserByNovaId(parts[1].replace(/[<>@]/g, '').toUpperCase()) : null;
  const requireGroupAdmin = () => {
    if (!isGroup) return 'This command only works in a group.';
    if (!['owner', 'admin'].includes(role)) return 'Only the group owner or an admin can use this command.';
    return null;
  };

  if (command === '.ping') return null;
  if (command === '.menu') return getDarkPairMenu();
  if (command === '.uptime') return `DARK BOT uptime: ${Math.floor(process.uptime())} seconds`;
  if (command === '.self') return `DARK BOT is paired to ${user?.display_name || 'your account'} (${user?.nova_id || 'unknown ID'})`;
  if (command === '.owner') return 'DARK BOT owner: +1-999-234-8321';
  if (command === '.chatjid') return conv ? `Chat JID: ${conv.id}` : 'Chat context unavailable.';
  if (command === '.channeljid') return isChannel ? `Channel JID: ${conv.id}` : 'This command only works in a channel.';
  if (command === '.getchanneljid') {
    if (!parts[1]) return 'Use .getchanneljid <invite-code>';
    return conv?.invite_code === parts[1].toUpperCase() ? `Channel JID: ${conv.id}` : 'That channel code does not match this channel.';
  }
  if (command === '.block') {
    if (!target) return 'Use .block <DARK-CHAT-ID>';
    if (target.id === userId) return 'You cannot block yourself.';
    await updateUser(userId, { blocked_user_ids: Array.from(new Set([...(user.blocked_user_ids || []), target.id])) });
    return `${target.display_name} has been blocked.`;
  }
  if (command === '.unblock') {
    if (!target) return 'Use .unblock <DARK-CHAT-ID>';
    await updateUser(userId, { blocked_user_ids: (user.blocked_user_ids || []).filter(id => String(id) !== String(target.id)) });
    return `${target.display_name} has been unblocked.`;
  }
  if (['.promote', '.demote', '.kick'].includes(command)) {
    const denied = requireGroupAdmin();
    if (denied) return denied;
    if (!target) return `Use ${command} <DARK-CHAT-ID>`;
    if (!(conv.member_ids || []).includes(target.id)) return 'That user is not in this group.';
    if (command === '.promote') {
      if (role !== 'owner') return 'Only the owner can promote admins.';
      await updateConversation(conv.id, { [`members.${target.id}`]: { role: 'admin', joined_at: conv.members?.[target.id]?.joined_at || new Date().toISOString() } });
      return `${target.display_name} is now an admin.`;
    }
    if (command === '.demote') {
      if (role !== 'owner') return 'Only the owner can demote admins.';
      if (conv.members?.[target.id]?.role === 'owner') return 'The owner cannot be demoted.';
      await updateConversation(conv.id, { [`members.${target.id}`]: { role: 'member', joined_at: conv.members?.[target.id]?.joined_at || new Date().toISOString() } });
      return `${target.display_name} is now a member.`;
    }
    if (command === '.kick') {
      if (conv.members?.[target.id]?.role === 'owner') return 'The owner cannot be removed.';
      await removeConversationMember(conv.id, target.id);
      return `${target.display_name} was removed from the group.`;
    }
  }
  if (command === '.groupinfo') {
    if (!isGroup) return 'This command only works in a group.';
    return `Group: ${conv.name || 'Unnamed'}\nMembers: ${(conv.member_ids || []).length}\nOwner: ${conv.owner_id || 'unknown'}${conv.invite_code ? `\nInvite: ${conv.invite_code}` : ''}`;
  }
  return null;
}

async function getDarkPairReply(content, userId) {
  const text = String(content || '').trim();
  const parts = text.split(/\s+/);
  const command = (parts[0] || '').toLowerCase();
  if (/^\d{6}$/.test(text)) {
    const currentUser = await getUserById(userId);
    if (!currentUser?.dark_pair_code) return 'No active Dark code found. Send /pair YOUR-DARK-CHAT-ID first.';
    if (currentUser.dark_pair_code_consumed || currentUser.dark_pair_code !== text) return 'That Dark code is invalid. Send /pair YOUR-DARK-CHAT-ID to generate a new one.';
    if (new Date(currentUser.dark_pair_code_expires_at).getTime() < Date.now()) return 'That Dark code has expired. Send /pair YOUR-DARK-CHAT-ID to generate a new one.';
    const linkedAt = new Date().toISOString();
    await updateUser(userId, { dark_pair_code_consumed: true, dark_pair_code_consumed_at: linkedAt, dark_pair_linked: true, dark_pair_linked_at: linkedAt });
    return 'DARK PAIR is now paired with your account. Send /menu to see available commands.';
  }
  if (command === '/start' || command === '/menu') {
    return getDarkPairMenu();
  }
  if (command === '/pair') {
    const novaId = (parts[1] || '').toUpperCase();
    const currentUser = await getUserById(userId);
    if (!novaId) return `Use this format with your own ID: /pair ${currentUser?.nova_id || 'DARK-CHAT-ID'}`;
    const target = await getUserByNovaId(novaId);
    if (!target || target.is_banned || String(target.id) !== String(userId)) {
      return [
        'That DARK CHAT ID does not match the account currently signed in.',
        `Use your own ID: /pair ${currentUser?.nova_id || 'DARK-CHAT-ID'}`
      ].join('\n');
    }
    const code = String(crypto.randomInt(100000, 1000000));
    await updateUser(userId, {
      dark_pair_code: code,
      dark_pair_code_created_at: new Date().toISOString(),
      dark_pair_code_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      dark_pair_code_consumed: false,
      dark_pair_linked: false
    });
    return [`Your Dark code is: ${code}`, '', 'Reply with the six-digit code in this chat to confirm pairing.'].join('\n');
  }
  return 'Send /start to see the DARK PAIR menu.';
}

async function deleteUser(id) {
  cacheStore.deleteUser(id);
  await ensureInit();
  if (firestoreDb) {
    deleteDoc(doc(firestoreDb, 'users', String(id))).catch(err => {
      handleFirestoreError(err, OperationType.DELETE, `users/${id}`);
    });
  }
  return true;
}

// ---------------- CONVERSATIONS ----------------
async function createConversation(data) {
  const id = data.id || 'c_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const now = new Date().toISOString();
  const conv = {
    id,
    type: data.type, // 'dm' | 'group' | 'channel' | 'notes'
    name: data.name || null,
    avatar_color: data.avatarColor || data.avatar_color || '#8E8E93',
    avatar_url: data.avatarUrl || data.avatar_url || null,
    owner_id: data.ownerId || data.owner_id || null,
    is_verified: Boolean(data.isVerified || data.is_verified),
    invite_code: data.inviteCode || data.invite_code || null,
    member_ids: data.memberIds || data.member_ids || [],
    members: data.members || {},
    ...managementDefaults(data),
    last_message: null,
    last_message_at: null,
    last_sender_id: null,
    pinned: Boolean(data.pinned),
    archived: Boolean(data.archived),
    muted: Boolean(data.muted),
    wallpaper: data.wallpaper || null,
    created_at: now
  };

  if (conv.owner_id && !conv.member_ids.includes(conv.owner_id)) {
    conv.member_ids.push(conv.owner_id);
    conv.members[conv.owner_id] = { role: 'owner', joined_at: now };
  }

  cacheStore.setConversation(conv);

  await ensureInit();
  if (firestoreDb) {
    setDoc(doc(firestoreDb, 'conversations', id), conv).catch(err => {
      handleFirestoreError(err, OperationType.WRITE, `conversations/${id}`);
    });
  }

  return conv;
}

async function getConversationById(id) {
  if (!id) return null;
  const cached = cacheStore.getConversationById(id);
  if (cached) return cached;

  await ensureInit();
  if (!firestoreDb) return null;
  try {
    const snap = await getDoc(doc(firestoreDb, 'conversations', String(id)));
    if (snap.exists()) {
      const c = snap.data();
      cacheStore.setConversation(c);
      return c;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `conversations/${id}`);
  }
  return null;
}

async function getAllChannels(search = '') {
  const term = String(search || '').trim().toLowerCase();
  const all = cacheStore.getAllConversations();
  return all
    .filter(c => c.type === 'channel')
    .filter(channel => !term || `${channel.name || ''} ${channel.invite_code || ''}`.toLowerCase().includes(term));
}

async function getConversationsForUser(userId) {
  await ensureDarkPairConversation(userId);

  let list = cacheStore.getAllConversations().filter(c =>
    (c.member_ids || []).includes(String(userId))
  );

  const currentUser = await getUserById(userId);

  for (const conv of list) {
    conv.role = conv.members?.[userId]?.role || (conv.owner_id === userId ? 'owner' : 'member');
    const memberMeta = conv.members?.[userId] || {};
    const isLastSenderMe = conv.last_sender_id && String(conv.last_sender_id) === String(userId);

    if (isLastSenderMe || !conv.last_message_at) {
      conv.unread_count = 0;
    } else if (memberMeta.last_read_at && new Date(memberMeta.last_read_at).getTime() >= new Date(conv.last_message_at).getTime()) {
      conv.unread_count = 0;
    } else if (typeof memberMeta.unread_count === 'number' && memberMeta.unread_count > 0) {
      conv.unread_count = memberMeta.unread_count;
    } else {
      if (memberMeta.joined_at && new Date(memberMeta.joined_at).getTime() > new Date(conv.last_message_at).getTime()) {
        conv.unread_count = 0;
      } else {
        conv.unread_count = Math.max(1, typeof memberMeta.unread_count === 'number' ? memberMeta.unread_count : 1);
      }
    }

    if (conv.type === 'dm') {
      const otherId = (conv.member_ids || []).find(mid => String(mid) !== String(userId));
      if (otherId) {
        const other = await getUserById(otherId);
        if (other) {
          conv.name = other.display_name;
          conv.avatar_color = other.avatar_color;
          conv.other_user = {
            id: other.id,
            nova_id: other.nova_id,
            display_name: other.display_name,
            avatar_color: other.avatar_color,
            avatar_url: other.avatar_url,
            is_verified: other.is_verified
          };
          conv.blocked_by_me = (currentUser?.blocked_user_ids || []).includes(String(other.id));
          conv.blocked_me = (other.blocked_user_ids || []).includes(String(userId));
        }
      }
    }
  }

  list.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    if (Boolean(a.archived) !== Boolean(b.archived)) return a.archived ? 1 : -1;
    const timeA = new Date(a.last_message_at || a.created_at || 0).getTime();
    const timeB = new Date(b.last_message_at || b.created_at || 0).getTime();
    return timeB - timeA;
  });

  return list;
}

async function ensureDarkPairConversation(userId) {
  if (!userId || String(userId) === 'u_dark_pair') return null;
  const existing = await findDmBetween(userId, 'u_dark_pair');
  if (existing) return existing;
  const now = new Date().toISOString();
  return createConversation({
    id: `dm_dark_pair_${String(userId)}`,
    type: 'dm',
    ownerId: 'u_dark_pair',
    memberIds: [String(userId), 'u_dark_pair'],
    members: {
      [String(userId)]: { role: 'member', joined_at: now },
      u_dark_pair: { role: 'owner', joined_at: now }
    }
  });
}

async function findDmBetween(user1Id, user2Id) {
  const all = cacheStore.getAllConversations();
  for (const c of all) {
    if (c.type === 'dm' && c.member_ids && c.member_ids.includes(String(user1Id)) && c.member_ids.includes(String(user2Id))) {
      return c;
    }
  }
  return null;
}

async function findNotesForUser(userId) {
  const all = cacheStore.getAllConversations();
  for (const c of all) {
    if (c.type === 'notes') {
      const members = c.member_ids || Object.keys(c.members || {});
      if (members.map(String).includes(String(userId))) return c;
    }
  }
  return null;
}

async function updateConversation(id, updates) {
  const updated = cacheStore.updateConversation(id, updates);
  await ensureInit();
  if (firestoreDb) {
    updateDoc(doc(firestoreDb, 'conversations', String(id)), updates).catch(err => {
      handleFirestoreError(err, OperationType.UPDATE, `conversations/${id}`);
    });
  }
  return updated;
}

async function deleteConversation(id) {
  cacheStore.deleteConversation(id);
  await ensureInit();
  if (firestoreDb) {
    deleteDoc(doc(firestoreDb, 'conversations', String(id))).catch(err => {
      handleFirestoreError(err, OperationType.DELETE, `conversations/${id}`);
    });
  }
  return true;
}

async function addConversationMember(convId, userId, role = 'member') {
  const conv = await getConversationById(convId);
  if (!conv) return null;
  const memberIds = conv.member_ids || [];
  if (!memberIds.includes(String(userId))) memberIds.push(String(userId));
  const members = conv.members || {};
  members[String(userId)] = { role, joined_at: new Date().toISOString() };
  await updateConversation(convId, { member_ids: memberIds, members });
  return true;
}

async function removeConversationMember(convId, userId) {
  const conv = await getConversationById(convId);
  if (!conv) return false;
  const memberIds = (conv.member_ids || []).filter(id => id !== String(userId));
  const members = { ...(conv.members || {}) };
  delete members[String(userId)];
  await updateConversation(convId, { member_ids: memberIds, members });
  return true;
}

async function getConversationMembers(convId) {
  const conv = await getConversationById(convId);
  if (!conv) return [];
  const memberIds = conv.member_ids || [];
  const result = [];
  for (const uid of memberIds) {
    const user = await getUserById(uid);
    if (user) {
      result.push({
        id: user.id,
        nova_id: user.nova_id,
        display_name: user.display_name,
        avatar_color: user.avatar_color,
        avatar_url: user.avatar_url,
        avatar_data: user.avatar_data,
        is_verified: user.is_verified,
        role: conv.members?.[uid]?.role || (conv.owner_id === uid ? 'owner' : 'member'),
        muted_until: conv.members?.[uid]?.muted_until || null
      });
    }
  }
  return result;
}

// ---------------- MESSAGES ----------------
async function createMessage(convId, msgData) {
  const id = (msgData.id && !String(msgData.id).startsWith('temp_'))
    ? String(msgData.id)
    : ('m_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
  const now = new Date().toISOString();
  const message = {
    id,
    conversation_id: String(convId),
    sender_id: String(msgData.senderId || msgData.sender_id),
    content: msgData.content || null,
    media_type: msgData.mediaType || msgData.media_type || null,
    media_url: msgData.mediaUrl || msgData.media_url || null,
    media_data: msgData.mediaData || msgData.media_data || null,
    media_mime: msgData.mediaMime || msgData.media_mime || null,
    media_duration: msgData.mediaDuration || msgData.media_duration || null,
    waveform: Array.isArray(msgData.waveform) ? msgData.waveform.slice(0, 40) : null,
    reply_to_id: msgData.replyToId || msgData.reply_to_id || null,
    status_reply: msgData.statusReply || msgData.status_reply || null,
    forwarded_from_id: msgData.forwardedFromId || msgData.forwarded_from_id || null,
    deleted_for_everyone: false,
    deleted_at: null,
    edited_at: null,
    pinned_at: null,
    pinned_by: null,
    read_at: null,
    reactions: [],
    saved_by: [],
    hidden_by: [],
    created_at: now
  };

  cacheStore.addMessage(convId, message);

  let preview = message.content;
  if (!preview) {
    if (message.media_type === 'sticker') preview = 'Sticker';
    else if (message.media_type === 'image') preview = '📷 Photo';
    else if (message.media_type === 'voice' || message.media_type === 'audio') preview = 'Voice note';
    else if (message.media_type === 'video') preview = '🎥 Video';
    else preview = 'Attachment';
  }

  const conv = cacheStore.getConversationById(convId);
  let members = {};
  if (conv) {
    members = { ...(conv.members || {}) };
    const memberIds = Array.from(new Set([...(conv.member_ids || []), ...Object.keys(members)]));
    for (const mid of memberIds) {
      const current = members[mid] || {};
      if (String(mid) === String(message.sender_id)) {
        members[mid] = { ...current, last_read_at: now, unread_count: 0 };
      } else {
        members[mid] = { ...current, unread_count: (current.unread_count || 0) + 1 };
      }
    }
  }

  cacheStore.updateConversation(convId, {
    last_message: preview,
    last_message_at: now,
    last_sender_id: message.sender_id,
    members
  });

  await ensureInit();
  if (firestoreDb) {
    setDoc(doc(firestoreDb, 'conversations', String(convId), 'messages', id), message).catch(err => {
      handleFirestoreError(err, OperationType.WRITE, `conversations/${convId}/messages/${id}`);
    });
    updateDoc(doc(firestoreDb, 'conversations', String(convId)), {
      last_message: preview,
      last_message_at: now,
      last_sender_id: message.sender_id,
      members
    }).catch(err => {
      handleFirestoreError(err, OperationType.UPDATE, `conversations/${convId}`);
    });
  }

  return message;
}

async function getMessages(convId, { limitCount = 50, beforeTime = null, userId = null } = {}) {
  let msgs = cacheStore.getMessages(convId);

  if (msgs.length === 0 && convId) {
    try {
      await ensureInit();
      if (firestoreDb) {
        const snap = await getDocs(query(
          collection(firestoreDb, 'conversations', String(convId), 'messages'),
          orderBy('created_at', 'desc'),
          limit(limitCount)
        ));
        if (!snap.empty) {
          for (const d of snap.docs) {
            const data = d.data();
            cacheStore.addMessage(convId, data);
          }
          msgs = cacheStore.getMessages(convId);
        }
      }
    } catch (err) {}
  }

  if (userId) {
    msgs = msgs.filter(m => !(m.hidden_by || []).includes(String(userId)));
  }

  if (beforeTime) {
    const beforeMs = new Date(beforeTime).getTime();
    msgs = msgs.filter(m => new Date(m.created_at).getTime() < beforeMs);
  }

  msgs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  msgs = msgs.slice(0, limitCount);

  for (const m of msgs) {
    const sender = await getUserById(m.sender_id);
    m.display_name = sender?.display_name || 'Unknown';
    m.avatar_color = sender?.avatar_color || '#0A84FF';
    m.avatar_url = sender?.avatar_url || null;
    m.is_verified = sender?.is_verified || false;
    m.saved_by_me = userId ? (m.saved_by || []).includes(String(userId)) : false;
    if (!m.media_data && m.media_url) {
      m.media_data = m.media_url;
    }
  }

  return msgs.reverse();
}

async function getMessageById(convId, messageId) {
  if (!messageId) return null;
  let msg = cacheStore.getMessageById(convId, messageId);
  if (msg) return msg;
  await ensureInit();
  if (firestoreDb && convId) {
    try {
      const snap = await getDoc(doc(firestoreDb, 'conversations', String(convId), 'messages', String(messageId)));
      if (snap.exists()) {
        const data = snap.data();
        cacheStore.addMessage(convId, data);
        return data;
      }
    } catch (err) {
      try {
        const q = query(
          collection(firestoreDb, 'conversations', String(convId), 'messages'),
          where('id', '==', String(messageId)),
          limit(1)
        );
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          const data = qSnap.docs[0].data();
          cacheStore.addMessage(convId, data);
          return data;
        }
      } catch (e2) {}
    }
  }
  return null;
}

async function updateMessage(convId, messageId, updates) {
  const updated = cacheStore.updateMessage(convId, messageId, updates);
  await ensureInit();
  if (firestoreDb) {
    updateDoc(doc(firestoreDb, 'conversations', String(convId), 'messages', String(messageId)), updates).catch(err => {
      handleFirestoreError(err, OperationType.UPDATE, `conversations/${convId}/messages/${messageId}`);
    });
  }
  return updated;
}

async function markConversationRead(convId, readerUserId) {
  const readAt = new Date().toISOString();
  const conv = cacheStore.getConversationById(convId);
  if (conv) {
    const members = { ...(conv.members || {}) };
    members[readerUserId] = {
      ...(members[readerUserId] || {}),
      last_read_at: readAt,
      unread_count: 0
    };
    cacheStore.updateConversation(convId, { members });
  }

  const msgs = cacheStore.getMessages(convId);
  const messageIds = msgs
    .filter(m => String(m.sender_id) !== String(readerUserId) && !m.read_at)
    .map(m => m.id);

  for (const id of messageIds) {
    cacheStore.updateMessage(convId, id, { read_at: readAt });
  }

  await ensureInit();
  if (firestoreDb) {
    updateDoc(doc(firestoreDb, 'conversations', String(convId)), {
      [`members.${readerUserId}.last_read_at`]: readAt,
      [`members.${readerUserId}.unread_count`]: 0
    }).catch(err => {
      handleFirestoreError(err, OperationType.UPDATE, `conversations/${convId}`);
    });
  }

  return { messageIds, readAt };
}

async function searchMessages(convId, queryText) {
  const msgs = cacheStore.getMessages(convId);
  const term = queryText.toLowerCase();
  const results = [];
  for (const m of msgs) {
    if (!m.deleted_for_everyone && m.content && m.content.toLowerCase().includes(term)) {
      const sender = await getUserById(m.sender_id);
      results.push({
        id: m.id,
        conversation_id: m.conversation_id,
        content: m.content,
        created_at: m.created_at,
        sender_id: m.sender_id,
        display_name: sender?.display_name || 'User',
        media_type: m.media_type,
        reply_to_id: m.reply_to_id,
        edited_at: m.edited_at
      });
    }
  }
  results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return results.slice(0, 50);
}

// ---------------- STATUSES ----------------
async function createStatus({ userId, content, bgColor, mediaUrl, mediaType, mediaMime }) {
  const id = 's_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const status = {
    id,
    user_id: String(userId),
    content: content ? content.trim().slice(0, 300) : '',
    bg_color: bgColor || '#0A84FF',
    media_url: mediaUrl || null,
    media_type: mediaType || null,
    media_mime: mediaMime || null,
    created_at: now.toISOString(),
    expires_at: expiresAt,
    viewers: [],
    reactions: {}
  };

  cacheStore.addStatus(status);

  await ensureInit();
  if (firestoreDb) {
    setDoc(doc(firestoreDb, 'statuses', id), status).catch(err => {
      handleFirestoreError(err, OperationType.WRITE, `statuses/${id}`);
    });
  }

  return status;
}

async function getActiveStatuses(viewerUserId) {
  const now = Date.now();
  const all = cacheStore.getStatuses();
  const active = [];
  for (const s of all) {
    if (new Date(s.expires_at).getTime() > now) {
      const author = await getUserById(s.user_id);
      active.push({
        id: s.id,
        content: s.content,
        bg_color: s.bg_color,
        media_url: s.media_url,
        media_type: s.media_type || null,
        media_mime: s.media_mime || null,
        created_at: s.created_at,
        expires_at: s.expires_at,
        user_id: s.user_id,
        nova_id: author?.nova_id || '',
        display_name: author?.display_name || 'User',
        avatar_color: author?.avatar_color || '#0A84FF',
        avatar_url: author?.avatar_url || null,
        is_verified: author?.is_verified || false,
        viewed: viewerUserId ? (s.viewers || []).includes(String(viewerUserId)) : false,
        reactions: s.reactions || {},
        reaction_count: Object.keys(s.reactions || {}).length,
        my_reaction: viewerUserId ? (s.reactions || {})[String(viewerUserId)] || null : null
      });
    }
  }
  active.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return active;
}

async function markStatusViewed(statusId, viewerUserId) {
  const s = cacheStore.getStatusById(statusId);
  if (!s) return false;
  const viewers = s.viewers || [];
  if (!viewers.includes(String(viewerUserId))) {
    viewers.push(String(viewerUserId));
    cacheStore.updateStatus(statusId, { viewers });
  }
  return true;
}

async function deleteStatus(statusId, userId) {
  const s = cacheStore.getStatusById(statusId);
  if (!s || s.user_id !== String(userId)) return false;
  cacheStore.deleteStatus(statusId);
  return true;
}

async function reactToStatus(statusId, userId, emoji) {
  const s = cacheStore.getStatusById(statusId);
  if (!s) return null;
  const clean = String(emoji || '').trim().slice(0, 16);
  if (!clean) return null;
  const reactions = { ...(s.reactions || {}) };
  if (reactions[String(userId)] === clean) delete reactions[String(userId)];
  else reactions[String(userId)] = clean;
  cacheStore.updateStatus(statusId, { reactions });
  return {
    reactions,
    reaction_count: Object.keys(reactions).length,
    my_reaction: reactions[String(userId)] || null
  };
}

async function getUserStickerPacks(userId) {
  const user = await getUserById(userId);
  const packs = user?.sticker_packs || [];
  if (!packs.length) {
    return [{ id: 'default', name: 'My stickers', stickers: [] }];
  }
  return packs;
}

async function saveUserStickerPacks(userId, packs) {
  await updateUser(userId, { sticker_packs: packs });
  return packs;
}

async function addStickerToPack(userId, { packId, packName, sticker }) {
  const packs = await getUserStickerPacks(userId);
  let pack = packs.find((p) => p.id === packId || (packName && p.name === packName));
  if (!pack) {
    pack = {
      id: packId || ('pack_' + Date.now()),
      name: (packName || 'My stickers').slice(0, 40),
      stickers: []
    };
    packs.push(pack);
  }
  const entry = {
    id: sticker.id || ('stk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
    url: sticker.url,
    mime: sticker.mime || 'image/png',
    type: sticker.type || 'image',
    created_at: new Date().toISOString()
  };
  pack.stickers = [entry, ...(pack.stickers || []).filter((s) => s.url !== entry.url)].slice(0, 80);
  await saveUserStickerPacks(userId, packs);
  return { packs, sticker: entry, pack };
}

// ---------------- POSTS & COMMENTS ----------------
async function createPost({ userId, caption, imageUrl, imageMime }) {
  const id = 'p_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const now = new Date().toISOString();
  const post = {
    id,
    user_id: String(userId),
    caption: caption ? caption.trim().slice(0, 500) : '',
    image_url: imageUrl || null,
    image_data: imageUrl || null,
    image_mime: imageMime || null,
    likes: [],
    comment_count: 0,
    created_at: now
  };

  cacheStore.addPost(post);

  await ensureInit();
  if (firestoreDb) {
    setDoc(doc(firestoreDb, 'posts', id), post).catch(err => {
      handleFirestoreError(err, OperationType.WRITE, `posts/${id}`);
    });
  }

  return post;
}

async function getPosts(currentUserId, limitCount = 50) {
  const all = cacheStore.getPosts();
  const posts = [];
  for (const p of all) {
    const author = await getUserById(p.user_id);
    posts.push({
      id: p.id,
      caption: p.caption,
      image_url: p.image_url || p.image_data,
      image_data: p.image_data || p.image_url,
      image_mime: p.image_mime,
      created_at: p.created_at,
      user_id: p.user_id,
      nova_id: author?.nova_id || '',
      display_name: author?.display_name || 'User',
      avatar_color: author?.avatar_color || '#0A84FF',
      avatar_url: author?.avatar_url || null,
      is_verified: author?.is_verified || false,
      like_count: (p.likes || []).length,
      liked_by_me: currentUserId ? (p.likes || []).includes(String(currentUserId)) : false,
      comment_count: p.comment_count || 0
    });
  }
  posts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return posts.slice(0, limitCount);
}

async function deletePost(postId, userId, allowAdmin = false) {
  const p = cacheStore.getPostById(postId);
  if (!p) return false;
  if (!allowAdmin && p.user_id !== String(userId)) return false;
  cacheStore.deletePost(postId);
  return true;
}

async function togglePostLike(postId, userId) {
  const p = cacheStore.getPostById(postId);
  if (!p) return false;
  const likes = p.likes || [];
  const uid = String(userId);
  const liked = likes.includes(uid);
  let nextLikes = [];
  if (liked) {
    nextLikes = likes.filter(id => id !== uid);
  } else {
    nextLikes = [...likes, uid];
  }
  cacheStore.updatePost(postId, { likes: nextLikes });
  return !liked;
}

async function addPostComment(postId, { userId, content }) {
  const commentId = 'pcm_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const now = new Date().toISOString();
  const comment = {
    id: commentId,
    post_id: String(postId),
    user_id: String(userId),
    content: content.trim().slice(0, 500),
    created_at: now
  };

  cacheStore.addComment(postId, comment);

  const post = cacheStore.getPostById(postId);
  if (post) {
    cacheStore.updatePost(postId, { comment_count: (post.comment_count || 0) + 1 });
  }

  const author = await getUserById(userId);
  return {
    ...comment,
    display_name: author?.display_name || 'User',
    avatar_color: author?.avatar_color || '#0A84FF',
    avatar_url: author?.avatar_url || null,
    is_verified: author?.is_verified || false
  };
}

async function getPostComments(postId) {
  const comments = cacheStore.getComments(postId);
  const result = [];
  for (const c of comments) {
    const author = await getUserById(c.user_id);
    result.push({
      id: c.id,
      content: c.content,
      created_at: c.created_at,
      display_name: author?.display_name || 'User',
      avatar_color: author?.avatar_color || '#0A84FF',
      avatar_url: author?.avatar_url || null,
      is_verified: author?.is_verified || false
    });
  }
  result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return result;
}

// ---------------- NOTIFICATIONS ----------------
async function createNotification({ userId, actorId, type, payload = {} }) {
  const id = 'n_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const notif = {
    id,
    user_id: String(userId),
    actor_id: actorId ? String(actorId) : null,
    type,
    payload,
    read_at: null,
    created_at: new Date().toISOString()
  };
  cacheStore.addNotification(notif);
  return notif;
}

async function getNotifications(userId, limitCount = 50) {
  const list = cacheStore.getNotifications(userId);
  const result = [];
  for (const n of list) {
    let actorName = 'Someone';
    if (n.actor_id) {
      const actor = await getUserById(n.actor_id);
      if (actor) actorName = actor.display_name;
    }
    result.push({
      ...n,
      actor_name: actorName
    });
  }
  result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return result.slice(0, limitCount);
}

async function getUnreadNotificationCount(userId) {
  const notifs = await getNotifications(userId);
  return notifs.filter(n => !n.read_at).length;
}

async function markNotificationsRead(userId, notifId = null) {
  const now = new Date().toISOString();
  if (notifId) {
    cacheStore.updateNotification(userId, notifId, { read_at: now });
  } else {
    const notifs = cacheStore.getNotifications(userId);
    for (const n of notifs) {
      if (!n.read_at) {
        cacheStore.updateNotification(userId, n.id, { read_at: now });
      }
    }
  }
  return true;
}

// ---------------- CALL SESSIONS ----------------
async function createCallSession({ id, conversationId, initiatorId, targetUserId, kind }) {
  const callId = id || crypto.randomUUID();
  const call = {
    id: callId,
    conversation_id: String(conversationId),
    initiator_id: String(initiatorId),
    target_user_id: targetUserId ? String(targetUserId) : null,
    kind,
    state: 'ringing',
    started_at: new Date().toISOString(),
    ended_at: null
  };
  cacheStore.addCallSession(call);
  return call;
}

async function getCallSession(callId) {
  return cacheStore.getCallSession(callId);
}

async function updateCallSessionState(callId, state) {
  const updates = { state };
  if (['declined', 'ended', 'missed', 'busy'].includes(state)) {
    updates.ended_at = new Date().toISOString();
  }
  return cacheStore.updateCallSession(callId, updates);
}

async function getCallHistory(conversationId) {
  const calls = cacheStore.getCallHistory(conversationId);
  calls.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  return calls.slice(0, 50);
}

module.exports = {
  ensureInit,
  handleFirestoreError,
  OperationType,
  // Storage
  uploadToStorage,
  getStorageFile,
  deleteStorageFile,
  // Users
  createUser,
  getUserById,
  getUserByNovaId,
  updateUser,
  getAllUsers,
  getUserCount,
  ensureDarkPairConversation,
  getDarkPairMenu,
  getDarkBotCommandReply,
  getDarkPairReply,
  deleteUser,
  // Conversations
  createConversation,
  getConversationById,
  getAllChannels,
  getConversationsForUser,
  findDmBetween,
  findNotesForUser,
  updateConversation,
  deleteConversation,
  addConversationMember,
  removeConversationMember,
  getConversationMembers,
  // Messages
  createMessage,
  getMessages,
  getMessageById,
  updateMessage,
  markConversationRead,
  searchMessages,
  // Statuses
  createStatus,
  getActiveStatuses,
  markStatusViewed,
  deleteStatus,
  reactToStatus,
  getUserStickerPacks,
  addStickerToPack,
  // Posts & Comments
  createPost,
  getPosts,
  deletePost,
  togglePostLike,
  addPostComment,
  getPostComments,
  // Notifications
  createNotification,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  // Calls
  createCallSession,
  getCallSession,
  updateCallSessionState,
  getCallHistory
};
