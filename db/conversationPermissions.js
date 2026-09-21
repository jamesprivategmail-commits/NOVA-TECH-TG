const ROLE_RANK = { member: 1, admin: 2, owner: 3 };

const DEFAULT_ADMIN_PERMISSIONS = {
  can_kick: true,
  can_ban: true,
  can_mute: true,
  can_add_members: true,
  can_promote_admins: false,
  can_edit_group_info: true,
  can_pin_messages: true,
  can_delete_messages: true,
  can_manage_invite_links: true,
  can_lock_group: true,
  can_manage_polls_events: true,
  can_start_calls: true,
  can_post: true,
  can_edit_others_posts: true,
  can_delete_posts: true,
  can_pin_posts: true,
  can_add_subscribers: true,
  can_ban_subscribers: true,
  can_edit_channel_info: true,
  can_view_statistics: true,
  can_schedule_posts: true
};

function roleFor(conv, userId) {
  if (!conv || userId == null) return null;
  const id = String(userId);
  return id === String(conv.owner_id) ? 'owner' : (conv.members?.[id]?.role || (conv.member_ids || []).includes(id) ? 'member' : null);
}

function rankFor(role) { return ROLE_RANK[role] || 0; }

function hasPermission(conv, userId, permission) {
  const role = roleFor(conv, userId);
  if (role === 'owner') return true;
  if (role !== 'admin') return false;
  return conv.admin_permissions?.[String(userId)]?.[permission] !== false && DEFAULT_ADMIN_PERMISSIONS[permission] !== false;
}

function canActOnTarget(conv, actorId, targetId, permission) {
  const actorRole = roleFor(conv, actorId);
  const targetRole = roleFor(conv, targetId);
  if (!actorRole || !targetRole || String(actorId) === String(targetId)) return false;
  return hasPermission(conv, actorId, permission) && rankFor(actorRole) > rankFor(targetRole);
}

function managementDefaults(data = {}) {
  return {
    description: data.description || '',
    visibility: data.visibility || 'private',
    is_locked: Boolean(data.isLocked ?? data.is_locked),
    locked_by: data.lockedBy || data.locked_by || null,
    locked_at: data.lockedAt || data.locked_at || null,
    locked_permissions: {
      messaging: true,
      media: true,
      reactions: false,
      add_members: true,
      edit_info: true,
      pin_messages: true,
      create_polls: true,
      voice_calls: true,
      ...(data.lockedPermissions || data.locked_permissions || {})
    },
    admin_permissions: data.adminPermissions || data.admin_permissions || {},
    banned_user_ids: data.bannedUserIds || data.banned_user_ids || [],
    slow_mode_seconds: Number(data.slowModeSeconds ?? data.slow_mode_seconds ?? 0) || 0,
    settings: {
      public: data.visibility === 'public' || Boolean(data.settings?.public),
      who_can_edit_info: data.settings?.who_can_edit_info || 'admin',
      who_can_add_members: data.settings?.who_can_add_members || 'all',
      ...(data.settings || {})
    },
    audit_log: Array.isArray(data.auditLog || data.audit_log) ? (data.auditLog || data.audit_log) : []
  };
}

module.exports = { ROLE_RANK, DEFAULT_ADMIN_PERMISSIONS, roleFor, rankFor, hasPermission, canActOnTarget, managementDefaults };
