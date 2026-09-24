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

// Load config from firebase-applet-config.json
const configPath = path.join(__dirname, '..', 'firebase-applet-config.json');
let config = {};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

let firebaseApp = null;
let firestoreDb = null;
let firebaseAuth = null;
let firebaseStorage = null;
let isInitialized = false;
let initPromise = null;

async function ensureInit() {
  if (isInitialized && firestoreDb) return firestoreDb;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!getApps().length) {
      firebaseApp = initializeApp(config);
    } else {
      firebaseApp = getApps()[0];
    }
    firebaseAuth = getAuth(firebaseApp);
    firebaseStorage = getStorage(firebaseApp);

    // Authenticate backend service account
    const email = 'service-backend@darkchat.internal';
    const password = 'DarkChatSecure2026!';
    try {
      await signInWithEmailAndPassword(firebaseAuth, email, password);
    } catch (e) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
        try {
          await createUserWithEmailAndPassword(firebaseAuth, email, password);
        } catch (createErr) {
          console.warn('Backend service user creation warning:', createErr.message);
        }
      } else {
        console.warn('Backend sign-in warning:', e.message);
      }
    }

    const dbId = config.firestoreDatabaseId || undefined;
    firestoreDb = getFirestore(firebaseApp, dbId);
    isInitialized = true;
    console.log('✅ Firebase initialized successfully for DARK CHAT (database:', dbId, ')');
    
    await seedAdminUser();
    await seedDarkPairAccount();
    return firestoreDb;
  })();

  return initPromise;
}

async function seedAdminUser() {
  try {
    const adminNovaId = '+1-999-234-8321';
    const plainPassword = '21272127';
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const q = query(
      collection(firestoreDb, 'users'),
      where('nova_id', '==', adminNovaId),
      limit(1)
    );
    const snap = await getDocs(q);
    const now = new Date().toISOString();

    if (!snap.empty) {
      console.log('✅ Existing admin account preserved for', adminNovaId);
    } else {
      const adminId = 'u_admin_master';
      await setDoc(doc(firestoreDb, 'users', adminId), {
        id: adminId,
        nova_id: adminNovaId,
        display_name: 'DARK CHAT Admin',
        password_hash: passwordHash,
        avatar_color: '#ff3131',
        avatar_url: '/assets/logo.jpg',
        avatar_data: null,
        avatar_mime: null,
        bio: 'Official DARK CHAT Administrator',
        is_verified: true,
        is_banned: false,
        ban_reason: null,
        created_at: now,
        last_seen: now
      });
      console.log('✅ Admin account seeded for', adminNovaId);
    }
  } catch (err) {
    console.warn('Admin account seeding warning:', err.message);
  }
}

async function seedDarkPairAccount() {
  try {
    const accountId = 'u_dark_pair';
    const ref = doc(firestoreDb, 'users', accountId);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    const now = new Date().toISOString();
    await setDoc(ref, {
      id: accountId,
      nova_id: 'DARK-PAIR',
      display_name: 'DARK PAIR',
      password_hash: null,
      avatar_color: '#7C3AED',
      avatar_url: '/assets/logo.jpg',
      avatar_data: null,
      avatar_mime: null,
      bio: 'DARK CHAT quick assistant. Send /start to see the menu.',
      is_verified: true,
      is_system: true,
      is_banned: false,
      created_at: now,
      last_seen: now
    });
    console.log('✅ DARK PAIR special account seeded');
  } catch (err) {
    console.warn('DARK PAIR seeding warning:', err.message);
  }
}

// ---------------- STORAGE SERVICE ----------------
// Stores files persistently in Firebase with instant URL access, supporting videos and media of any size
async function uploadToStorage({ data, mimeType = 'image/jpeg', filename = 'upload.bin', userId = null }) {
  await ensureInit();
  const fileId = 'file_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  
  // Extract pure base64 if data is a data URL
  let base64Data = data;
  let detectedMime = mimeType;
  if (typeof data === 'string' && data.startsWith('data:')) {
    const match = data.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      detectedMime = match[1];
      base64Data = match[2];
    }
  }

  const byteLength = Buffer.from(base64Data, 'base64').length;

  const metadata = {
    id: fileId,
    filename,
    mimeType: detectedMime,
    size: byteLength,
    userId,
    createdAt: new Date().toISOString()
  };

  // If small (<= 700KB), store directly in Firestore document
  if (byteLength <= 700 * 1024) {
    await setDoc(doc(firestoreDb, 'storage_files', fileId), { ...metadata, data: base64Data });
  } else {
    // For large files (e.g. videos up to 100MB):
    // Attempt Firebase Storage first if accessible
    let storedInBucket = false;
    if (firebaseStorage) {
      const storagePath = `dark-chat/${userId || 'system'}/${fileId}/${filename}`;
      try {
        await uploadBytes(storageRef(firebaseStorage, storagePath), Buffer.from(base64Data, 'base64'), { contentType: detectedMime });
        await setDoc(doc(firestoreDb, 'storage_files', fileId), { ...metadata, storagePath });
        storedInBucket = true;
      } catch (storageErr) {
        console.warn('Firebase Storage bucket write unavailable, storing in resilient Firestore chunked storage:', storageErr.message);
      }
    }

    // High-reliability chunking directly in storage_files (matches cloud rules perfectly)
    if (!storedInBucket) {
      const CHUNK_CHAR_SIZE = 450000; // ~337KB raw base64 per chunk (well within 1MB Firestore limit)
      const totalChunks = Math.ceil(base64Data.length / CHUNK_CHAR_SIZE);
      const chunkPromises = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkData = base64Data.slice(i * CHUNK_CHAR_SIZE, (i + 1) * CHUNK_CHAR_SIZE);
        const chunkDocId = `${fileId}_part_${i}`;
        chunkPromises.push(
          setDoc(doc(firestoreDb, 'storage_files', chunkDocId), {
            fileId,
            index: i,
            totalChunks,
            data: chunkData
          })
        );
      }
      await Promise.all(chunkPromises);
      await setDoc(doc(firestoreDb, 'storage_files', fileId), {
        ...metadata,
        chunked: true,
        totalChunks,
        chunkSize: CHUNK_CHAR_SIZE
      });
    }
  }

  const publicBase = (process.env.PUBLIC_BASE_URL || process.env.VERCEL_URL
    ? (process.env.PUBLIC_BASE_URL || `https://${process.env.VERCEL_URL}`)
    : '').replace(/\/$/, '');
  const downloadUrl = publicBase
    ? `${publicBase}/api/storage/files/${fileId}`
    : `/api/storage/files/${fileId}`;
  return { fileId, url: downloadUrl, mimeType: detectedMime, size: byteLength };
}

async function getStorageFile(fileId) {
  await ensureInit();
  const snap = await getDoc(doc(firestoreDb, 'storage_files', fileId));
  if (!snap.exists()) return null;
  const file = snap.data();
  if (file.storagePath && firebaseStorage) {
    try {
      const bytes = await getBytes(storageRef(firebaseStorage, file.storagePath));
      return { ...file, buffer: Buffer.from(bytes) };
    } catch (e) {
      console.warn('Firebase Storage retrieval failed, checking chunks or data:', e.message);
    }
  }
  if (file.chunked && file.totalChunks) {
    const chunkSnaps = await Promise.all(
      Array.from({ length: file.totalChunks }, (_, i) =>
        getDoc(doc(firestoreDb, 'storage_files', `${fileId}_part_${i}`))
      )
    );
    const fullBase64 = chunkSnaps.map(s => (s.exists() ? s.data().data || '' : '')).join('');
    return {
      ...file,
      buffer: Buffer.from(fullBase64, 'base64')
    };
  }
  if (file.data) {
    return {
      ...file,
      buffer: Buffer.from(file.data, 'base64')
    };
  }
  return null;
}

async function deleteStorageFile(fileId) {
  await ensureInit();
  const ref = doc(firestoreDb, 'storage_files', fileId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    if (data.storagePath && firebaseStorage) {
      try {
        await deleteObject(storageRef(firebaseStorage, data.storagePath));
      } catch (e) { /* ignore */ }
    }
    if (data.chunked && data.totalChunks) {
      try {
        const deletes = Array.from({ length: data.totalChunks }, (_, i) =>
          deleteDoc(doc(firestoreDb, 'storage_files', `${fileId}_part_${i}`))
        );
        await Promise.all(deletes);
      } catch (e) { /* ignore */ }
    }
  }
  await deleteDoc(ref);
}

// ---------------- USERS ----------------
async function createUser(userData) {
  await ensureInit();
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

  await setDoc(doc(firestoreDb, 'users', id), user);
  return user;
}

async function getUserById(id) {
  if (!id) return null;
  await ensureInit();
  const snap = await getDoc(doc(firestoreDb, 'users', String(id)));
  return snap.exists() ? snap.data() : null;
}

async function getUserByNovaId(novaId) {
  if (!novaId) return null;
  await ensureInit();
  const q = query(
    collection(firestoreDb, 'users'),
    where('nova_id', '==', String(novaId).trim().toUpperCase()),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].data();
}

async function updateUser(id, updates) {
  await ensureInit();
  const ref = doc(firestoreDb, 'users', String(id));
  const mapped = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) mapped[k] = v;
  }
  await updateDoc(ref, mapped);
  const updated = await getDoc(ref);
  return updated.data();
}

async function getAllUsers(search = '', limitCount = 100) {
  await ensureInit();
  const snap = await getDocs(collection(firestoreDb, 'users'));
  let users = snap.docs.map(d => d.data());
  if (search) {
    const s = search.toLowerCase();
    users = users.filter(u =>
      (u.nova_id && u.nova_id.toLowerCase().includes(s)) ||
      (u.display_name && u.display_name.toLowerCase().includes(s))
    );
  }
  users.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return users.slice(0, limitCount);
}

async function getUserCount() {
  await ensureInit();
  const snap = await getDocs(collection(firestoreDb, 'users'));
  return snap.docs.filter(d => !d.data().is_banned).length;
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

  if (command === '.ping') {
    return null; // The transport calculates and formats measured latency.
  }
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
  await ensureInit();
  await deleteDoc(doc(firestoreDb, 'users', String(id)));
  return true;
}

// ---------------- CONVERSATIONS ----------------
async function createConversation(data) {
  await ensureInit();
  const id = data.id || 'c_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const now = new Date().toISOString();
  const conv = {
    id,
    type: data.type, // 'dm' | 'group' | 'channel'
    name: data.name || null,
    avatar_color: data.avatarColor || data.avatar_color || '#8E8E93',
    avatar_url: data.avatarUrl || data.avatar_url || null,
    owner_id: data.ownerId || data.owner_id || null,
    is_verified: Boolean(data.isVerified || data.is_verified),
    invite_code: data.inviteCode || data.invite_code || null,
    member_ids: data.memberIds || data.member_ids || [],
    members: data.members || {}, // map: { [userId]: { role: 'owner'|'admin'|'member', joined_at: ... } }
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

  // Ensure member_ids contains owner
  if (conv.owner_id && !conv.member_ids.includes(conv.owner_id)) {
    conv.member_ids.push(conv.owner_id);
    conv.members[conv.owner_id] = { role: 'owner', joined_at: now };
  }

  await setDoc(doc(firestoreDb, 'conversations', id), conv);
  return conv;
}

async function getConversationById(id) {
  if (!id) return null;
  await ensureInit();
  const snap = await getDoc(doc(firestoreDb, 'conversations', String(id)));
  return snap.exists() ? snap.data() : null;
}

async function getAllChannels(search = '') {
  await ensureInit();
  const snap = await getDocs(query(collection(firestoreDb, 'conversations'), where('type', '==', 'channel')));
  const term = String(search || '').trim().toLowerCase();
  return snap.docs.map((d) => d.data()).filter((channel) => !term || `${channel.name || ''} ${channel.invite_code || ''}`.toLowerCase().includes(term));
}

async function getConversationsForUser(userId) {
  await ensureInit();
  await ensureDarkPairConversation(userId);
  const q = query(
    collection(firestoreDb, 'conversations'),
    where('member_ids', 'array-contains', String(userId))
  );
  const snap = await getDocs(q);
  const list = snap.docs.map(d => d.data());
  const currentUser = await getUserById(userId);

  // Populate DMs with other user's identity
  for (const conv of list) {
    conv.role = conv.members?.[userId]?.role || (conv.owner_id === userId ? 'owner' : 'member');
    if (conv.type === 'dm') {
      const otherId = (conv.member_ids || []).find(mid => mid !== userId);
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

  // Sort newest message first
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
  await ensureInit();
  const q = query(
    collection(firestoreDb, 'conversations'),
    where('type', '==', 'dm'),
    where('member_ids', 'array-contains', String(user1Id))
  );
  const snap = await getDocs(q);
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.member_ids && data.member_ids.includes(String(user2Id))) {
      return data;
    }
  }
  return null;
}


async function findNotesForUser(userId) {
  await ensureInit();
  const q = query(
    collection(firestoreDb, 'conversations'),
    where('type', '==', 'notes'),
    where('member_ids', 'array-contains', String(userId))
  );
  const snap = await getDocs(q);
  if (snap.empty) {
    // fallback scan if member_ids field naming differs
    const all = await getDocs(query(collection(firestoreDb, 'conversations'), where('type', '==', 'notes')));
    for (const d of all.docs) {
      const c = d.data();
      const members = c.member_ids || c.memberIds || Object.keys(c.members || {});
      if (members.map(String).includes(String(userId))) return { id: d.id, ...c };
    }
    return null;
  }
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}


async function updateConversation(id, updates) {
  await ensureInit();
  const ref = doc(firestoreDb, 'conversations', String(id));
  await updateDoc(ref, updates);
  const snap = await getDoc(ref);
  return snap.data();
}

async function deleteConversation(id) {
  await ensureInit();
  // Delete subcollection messages
  const msgSnap = await getDocs(collection(firestoreDb, 'conversations', String(id), 'messages'));
  for (const mDoc of msgSnap.docs) {
    await deleteDoc(mDoc.ref);
  }
  await deleteDoc(doc(firestoreDb, 'conversations', String(id)));
  return true;
}

async function addConversationMember(convId, userId, role = 'member') {
  await ensureInit();
  const conv = await getConversationById(convId);
  if (!conv) return null;
  const memberIds = conv.member_ids || [];
  if (!memberIds.includes(userId)) memberIds.push(userId);
  const members = conv.members || {};
  members[userId] = { role, joined_at: new Date().toISOString() };
  await updateDoc(doc(firestoreDb, 'conversations', String(convId)), {
    member_ids: memberIds,
    members
  });
  return true;
}

async function removeConversationMember(convId, userId) {
  await ensureInit();
  const conv = await getConversationById(convId);
  if (!conv) return false;
  const memberIds = (conv.member_ids || []).filter(id => id !== String(userId));
  const members = { ...(conv.members || {}) };
  delete members[String(userId)];
  await updateDoc(doc(firestoreDb, 'conversations', String(convId)), {
    member_ids: memberIds,
    members
  });
  return true;
}

async function getConversationMembers(convId) {
  await ensureInit();
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
  await ensureInit();
  const id = msgData.id || 'm_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
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
    reply_to_id: msgData.replyToId || msgData.reply_to_id || null,
    status_reply: msgData.statusReply || msgData.status_reply || null,
    forwarded_from_id: msgData.forwardedFromId || msgData.forwarded_from_id || null,
    deleted_for_everyone: false,
    deleted_at: null,
    edited_at: null,
    pinned_at: null,
    pinned_by: null,
    read_at: null,
    reactions: [], // array of { reaction, user_id }
    saved_by: [], // array of userIds
    hidden_by: [], // array of userIds
    created_at: now
  };

  await setDoc(doc(firestoreDb, 'conversations', String(convId), 'messages', id), message);

  // Update conversation last_message preview
  let preview = message.content;
  if (!preview) {
    if (message.media_type === 'sticker') preview = 'Sticker';
    else if (message.media_type === 'image') preview = '📷 Photo';
    else if (message.media_type === 'voice' || message.media_type === 'audio') preview = 'Voice note';
    else if (message.media_type === 'video') preview = '🎥 Video';
    else preview = 'Attachment';
  }
  await updateDoc(doc(firestoreDb, 'conversations', String(convId)), {
    last_message: preview,
    last_message_at: now,
    last_sender_id: message.sender_id
  });

  return message;
}

async function getMessages(convId, { limitCount = 50, beforeTime = null, userId = null } = {}) {
  await ensureInit();
  const colRef = collection(firestoreDb, 'conversations', String(convId), 'messages');
  const snap = await getDocs(colRef);
  let msgs = snap.docs.map(d => d.data());

  // Filter hidden messages for current user
  if (userId) {
    msgs = msgs.filter(m => !(m.hidden_by || []).includes(String(userId)));
  }

  // Filter beforeTime if pagination is requested
  if (beforeTime) {
    const beforeMs = new Date(beforeTime).getTime();
    msgs = msgs.filter(m => new Date(m.created_at).getTime() < beforeMs);
  }

  // Sort by created_at desc for pagination, then take limitCount
  msgs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  msgs = msgs.slice(0, limitCount);

  // Fetch sender details and format
  for (const m of msgs) {
    const sender = await getUserById(m.sender_id);
    m.display_name = sender?.display_name || 'Unknown';
    m.avatar_color = sender?.avatar_color || '#0A84FF';
    m.avatar_url = sender?.avatar_url || null;
    m.is_verified = sender?.is_verified || false;
    m.saved_by_me = userId ? (m.saved_by || []).includes(String(userId)) : false;
    // Map media_url to media_data if media_data is empty
    if (!m.media_data && m.media_url) {
      m.media_data = m.media_url;
    }
  }

  // Reverse so client gets chronological order
  return msgs.reverse();
}

async function getMessageById(convId, messageId) {
  await ensureInit();
  const snap = await getDoc(doc(firestoreDb, 'conversations', String(convId), 'messages', String(messageId)));
  return snap.exists() ? snap.data() : null;
}

async function updateMessage(convId, messageId, updates) {
  await ensureInit();
  const ref = doc(firestoreDb, 'conversations', String(convId), 'messages', String(messageId));
  await updateDoc(ref, updates);
  const updated = await getDoc(ref);
  return updated.data();
}

async function markConversationRead(convId, readerUserId) {
  await ensureInit();
  const snap = await getDocs(collection(firestoreDb, 'conversations', String(convId), 'messages'));
  const readAt = new Date().toISOString();
  const messageIds = snap.docs.map(d => d.data())
    .filter(m => String(m.sender_id) !== String(readerUserId) && !m.read_at)
    .map(m => m.id);
  for (const id of messageIds) {
    await updateDoc(doc(firestoreDb, 'conversations', String(convId), 'messages', String(id)), { read_at: readAt });
  }
  return { messageIds, readAt };
}

async function searchMessages(convId, queryText) {
  await ensureInit();
  const snap = await getDocs(collection(firestoreDb, 'conversations', String(convId), 'messages'));
  const term = queryText.toLowerCase();
  const results = [];
  for (const docSnap of snap.docs) {
    const m = docSnap.data();
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
  await ensureInit();
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
    reactions: {} // { [userId]: emoji }
  };
  await setDoc(doc(firestoreDb, 'statuses', id), status);
  return status;
}

async function getActiveStatuses(viewerUserId) {
  await ensureInit();
  const snap = await getDocs(collection(firestoreDb, 'statuses'));
  const now = Date.now();
  const active = [];
  for (const d of snap.docs) {
    const s = d.data();
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
  await ensureInit();
  const ref = doc(firestoreDb, 'statuses', String(statusId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const viewers = snap.data().viewers || [];
  if (!viewers.includes(String(viewerUserId))) {
    await updateDoc(ref, { viewers: arrayUnion(String(viewerUserId)) });
  }
  return true;
}

async function deleteStatus(statusId, userId) {
  await ensureInit();
  const ref = doc(firestoreDb, 'statuses', String(statusId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  if (snap.data().user_id !== String(userId)) return false;
  await deleteDoc(ref);
  return true;
}

async function reactToStatus(statusId, userId, emoji) {
  await ensureInit();
  const ref = doc(firestoreDb, 'statuses', String(statusId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const clean = String(emoji || '').trim().slice(0, 16);
  if (!clean) return null;
  const reactions = { ...(snap.data().reactions || {}) };
  // Toggle off if same emoji
  if (reactions[String(userId)] === clean) delete reactions[String(userId)];
  else reactions[String(userId)] = clean;
  await updateDoc(ref, { reactions });
  return {
    reactions,
    reaction_count: Object.keys(reactions).length,
    my_reaction: reactions[String(userId)] || null
  };
}

async function getUserStickerPacks(userId) {
  await ensureInit();
  const user = await getUserById(userId);
  const packs = user?.sticker_packs || [];
  if (!packs.length) {
    return [{ id: 'default', name: 'My stickers', stickers: [] }];
  }
  return packs;
}

async function saveUserStickerPacks(userId, packs) {
  await ensureInit();
  await updateUser(userId, { sticker_packs: packs });
  return packs;
}

async function addStickerToPack(userId, { packId, packName, sticker }) {
  await ensureInit();
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
    type: sticker.type || 'image', // image | video
    created_at: new Date().toISOString()
  };
  pack.stickers = [entry, ...(pack.stickers || []).filter((s) => s.url !== entry.url)].slice(0, 80);
  await saveUserStickerPacks(userId, packs);
  return { packs, sticker: entry, pack };
}

// ---------------- POSTS & COMMENTS ----------------
async function createPost({ userId, caption, imageUrl, imageMime }) {
  await ensureInit();
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
  await setDoc(doc(firestoreDb, 'posts', id), post);
  return post;
}

async function getPosts(currentUserId, limitCount = 50) {
  await ensureInit();
  const snap = await getDocs(collection(firestoreDb, 'posts'));
  const posts = [];
  for (const d of snap.docs) {
    const p = d.data();
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
  await ensureInit();
  const ref = doc(firestoreDb, 'posts', String(postId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  if (!allowAdmin && snap.data().user_id !== String(userId)) return false;
  await deleteDoc(ref);
  return true;
}

async function togglePostLike(postId, userId) {
  await ensureInit();
  const ref = doc(firestoreDb, 'posts', String(postId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const likes = snap.data().likes || [];
  const uid = String(userId);
  const liked = likes.includes(uid);
  if (liked) {
    await updateDoc(ref, { likes: arrayRemove(uid) });
    return false;
  } else {
    await updateDoc(ref, { likes: arrayUnion(uid) });
    return true;
  }
}

async function addPostComment(postId, { userId, content }) {
  await ensureInit();
  const commentId = 'pcm_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const now = new Date().toISOString();
  const comment = {
    id: commentId,
    post_id: String(postId),
    user_id: String(userId),
    content: content.trim().slice(0, 500),
    created_at: now
  };
  await setDoc(doc(firestoreDb, 'posts', String(postId), 'comments', commentId), comment);

  // Increment comment_count
  const postRef = doc(firestoreDb, 'posts', String(postId));
  const pSnap = await getDoc(postRef);
  if (pSnap.exists()) {
    const currentCount = pSnap.data().comment_count || 0;
    await updateDoc(postRef, { comment_count: currentCount + 1 });
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
  await ensureInit();
  const snap = await getDocs(collection(firestoreDb, 'posts', String(postId), 'comments'));
  const comments = [];
  for (const d of snap.docs) {
    const c = d.data();
    const author = await getUserById(c.user_id);
    comments.push({
      id: c.id,
      content: c.content,
      created_at: c.created_at,
      display_name: author?.display_name || 'User',
      avatar_color: author?.avatar_color || '#0A84FF',
      avatar_url: author?.avatar_url || null,
      is_verified: author?.is_verified || false
    });
  }
  comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return comments;
}

// ---------------- NOTIFICATIONS ----------------
async function createNotification({ userId, actorId, type, payload = {} }) {
  await ensureInit();
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
  await setDoc(doc(firestoreDb, 'notifications', id), notif);
  return notif;
}

async function getNotifications(userId, limitCount = 50) {
  await ensureInit();
  const q = query(
    collection(firestoreDb, 'notifications'),
    where('user_id', '==', String(userId))
  );
  const snap = await getDocs(q);
  const list = [];
  for (const d of snap.docs) {
    const n = d.data();
    let actorName = 'Someone';
    if (n.actor_id) {
      const actor = await getUserById(n.actor_id);
      if (actor) actorName = actor.display_name;
    }
    list.push({
      ...n,
      actor_name: actorName
    });
  }
  list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return list.slice(0, limitCount);
}

async function getUnreadNotificationCount(userId) {
  await ensureInit();
  const notifs = await getNotifications(userId);
  return notifs.filter(n => !n.read_at).length;
}

async function markNotificationsRead(userId, notifId = null) {
  await ensureInit();
  const now = new Date().toISOString();
  if (notifId) {
    const ref = doc(firestoreDb, 'notifications', String(notifId));
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().user_id === String(userId)) {
      await updateDoc(ref, { read_at: now });
    }
  } else {
    const notifs = await getNotifications(userId);
    for (const n of notifs) {
      if (!n.read_at) {
        await updateDoc(doc(firestoreDb, 'notifications', n.id), { read_at: now });
      }
    }
  }
  return true;
}

// ---------------- CALL SESSIONS ----------------
async function createCallSession({ id, conversationId, initiatorId, targetUserId, kind }) {
  await ensureInit();
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
  await setDoc(doc(firestoreDb, 'call_sessions', callId), call);
  return call;
}

async function getCallSession(callId) {
  await ensureInit();
  const snap = await getDoc(doc(firestoreDb, 'call_sessions', String(callId)));
  return snap.exists() ? snap.data() : null;
}

async function updateCallSessionState(callId, state) {
  await ensureInit();
  const updates = { state };
  if (['declined', 'ended', 'missed', 'busy'].includes(state)) {
    updates.ended_at = new Date().toISOString();
  }
  await updateDoc(doc(firestoreDb, 'call_sessions', String(callId)), updates);
  const updated = await getDoc(doc(firestoreDb, 'call_sessions', String(callId)));
  return updated.data();
}

async function getCallHistory(conversationId) {
  await ensureInit();
  const q = query(
    collection(firestoreDb, 'call_sessions'),
    where('conversation_id', '==', String(conversationId))
  );
  const snap = await getDocs(q);
  const calls = snap.docs.map(d => d.data());
  calls.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  return calls.slice(0, 50);
}

module.exports = {
  ensureInit,
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
