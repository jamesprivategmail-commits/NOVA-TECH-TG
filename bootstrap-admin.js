require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getUserByNovaId, createUser, updateUser, ensureInit } = require('./db/firebase');

const ADMIN_ID = '+1-999-234-8321';
const PASSWORD = process.env.NEW_ADMIN_PASSWORD || 'DarkChatAdmin2026!';

(async () => {
  await ensureInit();
  const hash = await bcrypt.hash(PASSWORD, 12);
  const existing = await getUserByNovaId(ADMIN_ID);
  if (existing) {
    await updateUser(existing.id, {
      password_hash: hash,
      is_banned: false,
      is_verified: true
    });
    console.log('Firebase Admin credentials updated for', ADMIN_ID);
  } else {
    await createUser({
      novaId: ADMIN_ID,
      displayName: 'DARK CHAT Admin',
      passwordHash: hash,
      avatarColor: '#ff3131',
      isVerified: true
    });
    console.log('Firebase Admin account created for', ADMIN_ID);
  }
  process.exit(0);
})().catch(err => {
  console.error('Bootstrap admin error:', err.message);
  process.exit(1);
});
