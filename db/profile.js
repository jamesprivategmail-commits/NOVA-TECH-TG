const bcrypt = require('bcryptjs');
const { getUserById, updateUser, deleteUser, getMessageById } = require('./firebase');

async function updateProfileSettings(userId, updates = {}) {
  const user = await getUserById(userId);
  if (!user) return null;
  const current = user.privacy_settings || {};
  const allowed = [
    'online', 'lastSeen', 'profilePhoto', 'bio', 'status',
    'whoCanMessage', 'whoCanAddToGroups', 'readReceipts', 'notifications',
    // Chat behaviour
    'enterToSend', 'unarchiveOnNewMessage', 'showUnreadBadges',
    // Status
    'statusRepliesNotify', 'statusVideoAutoplay',
    // Calls
    'allowVoiceCalls', 'allowVideoCalls', 'callNotifications',
    // Appearance
    'theme', 'accentColor', 'fontSize', 'chatWallpaper',
    // Security & Chat Lock
    'twoFactorEnabled', 'twoFactorPin', 'recoveryCodes', 'chatPasscode',
    // Account Type
    'accountType', 'businessDetails', 'creatorDetails',
    // Starred messages
    'starredMessageIds'
  ];
  const privacy = { ...current };
  for (const key of allowed) {
    if (updates[key] !== undefined) privacy[key] = updates[key];
  }
  const updated = await updateUser(userId, { privacy_settings: privacy });
  return { privacySettings: updated.privacy_settings || {} };
}

async function getProfileSettings(userId) {
  const user = await getUserById(userId);
  return user ? {
    privacySettings: user.privacy_settings || {},
    blockedUserIds: user.blocked_user_ids || [],
    accountType: user.privacy_settings?.accountType || 'personal',
    businessDetails: user.privacy_settings?.businessDetails || null,
    creatorDetails: user.privacy_settings?.creatorDetails || null,
    starredMessageIds: user.privacy_settings?.starredMessageIds || [],
    devices: user.linked_devices || [
      { id: 'dev_current', name: 'Web Browser / AI Studio Session', platform: 'Web', lastActive: new Date().toISOString(), isCurrent: true }
    ]
  } : null;
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await getUserById(userId);
  if (!user) throw new Error('User not found');
  if (user.password_hash) {
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) throw new Error('Current password is incorrect');
  }
  if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters');
  const hash = await bcrypt.hash(newPassword, 10);
  await updateUser(userId, { password_hash: hash });
  return true;
}

async function deleteUserAccount(userId, password) {
  const user = await getUserById(userId);
  if (!user) throw new Error('User not found');
  if (user.password_hash) {
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new Error('Password incorrect');
  }
  await deleteUser(userId);
  return true;
}

async function blockUser(userId, targetId) {
  const user = await getUserById(userId);
  const target = await getUserById(targetId);
  if (!user || !target || String(userId) === String(targetId)) return false;
  const ids = Array.from(new Set([...(user.blocked_user_ids || []), String(targetId)]));
  await updateUser(userId, { blocked_user_ids: ids });
  return true;
}

async function unblockUser(userId, targetId) {
  const user = await getUserById(userId);
  if (!user) return false;
  const ids = (user.blocked_user_ids || []).filter(id => String(id) !== String(targetId));
  await updateUser(userId, { blocked_user_ids: ids });
  return true;
}

async function toggleStarredMessage(userId, messageId) {
  const user = await getUserById(userId);
  if (!user) return [];
  const current = user.privacy_settings?.starredMessageIds || [];
  const idStr = String(messageId);
  let updated;
  if (current.includes(idStr)) {
    updated = current.filter(id => id !== idStr);
  } else {
    updated = [...current, idStr];
  }
  await updateProfileSettings(userId, { starredMessageIds: updated });
  return updated;
}

module.exports = {
  updateProfileSettings,
  getProfileSettings,
  changePassword,
  deleteUserAccount,
  blockUser,
  unblockUser,
  toggleStarredMessage
};
