const { getUserById, updateUser } = require('./firebase');

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
    'allowVoiceCalls', 'allowVideoCalls', 'callNotifications'
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
  return user ? { privacySettings: user.privacy_settings || {}, blockedUserIds: user.blocked_user_ids || [] } : null;
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

module.exports = { updateProfileSettings, getProfileSettings, blockUser, unblockUser };
