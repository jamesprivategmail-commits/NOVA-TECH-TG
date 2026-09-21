const express = require('express');
const {
  getConversationsForUser,
  getConversationById,
  createConversation,
  findDmBetween,
  findNotesForUser,
  updateConversation,
  deleteConversation,
  addConversationMember,
  removeConversationMember,
  getConversationMembers,
  getUserByNovaId,
  getUserById,
  getMessages,
  createMessage,
  getDarkBotCommandReply,
  getDarkPairMenu,
  getMessageById,
  getDarkPairReply,
  updateMessage,
  markConversationRead,
  searchMessages,
  createNotification
} = require('../db/firebase');
const { generateInviteCode } = require('../db/idGen');
const { requireAuth } = require('../middleware/auth');
const { roleFor, hasPermission, canActOnTarget } = require('../db/conversationPermissions');

const router = express.Router();
router.use(requireAuth);

function auditEntry(actionType, actorId, targetId = null, reason = null) {
  return { action_type: actionType, actor_id: String(actorId), target_id: targetId == null ? null : String(targetId), reason, timestamp: new Date().toISOString() };
}

// GET /api/conversations - list all conversations for current user
router.get('/', async (req, res) => {
  try {
    const list = await getConversationsForUser(req.user.id);
    res.json({ conversations: list });
  } catch (err) {
    console.error('List conversations error:', err);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// POST /api/conversations/dm { novaId }
router.post('/dm', async (req, res) => {
  try {
    const { novaId } = req.body;
    const target = await getUserByNovaId((novaId || '').trim().toUpperCase());
    if (!target) return res.status(404).json({ error: 'No one has that DARK CHAT ID' });

    // Notes to self / Saved Messages
    if (target.id === req.user.id) {
      const existingNotes = await findNotesForUser(req.user.id);
      if (existingNotes) {
        return res.json({ conversationId: existingNotes.id, existed: true, notes: true });
      }
      const now = new Date().toISOString();
      const notes = await createConversation({
        type: 'notes',
        name: 'Saved Messages',
        ownerId: req.user.id,
        memberIds: [req.user.id],
        members: {
          [req.user.id]: { role: 'owner', joined_at: now }
        }
      });
      return res.json({ conversationId: notes.id, existed: false, notes: true });
    }

    // Check for existing DM
    const existing = await findDmBetween(req.user.id, target.id);
    if (existing) {
      return res.json({ conversationId: existing.id, existed: true });
    }

    const now = new Date().toISOString();
    const conv = await createConversation({
      type: 'dm',
      ownerId: req.user.id,
      memberIds: [req.user.id, target.id],
      members: {
        [req.user.id]: { role: 'member', joined_at: now },
        [target.id]: { role: 'member', joined_at: now }
      }
    });

    res.json({ conversationId: conv.id, existed: false });
  } catch (err) {
    console.error('Create DM error:', err);
    res.status(500).json({ error: 'Failed to start chat' });
  }
});

// POST /api/conversations/group { name, memberNovaIds: [] }
router.post('/group', async (req, res) => {
  try {
    const { name, memberNovaIds = [] } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });

    const now = new Date().toISOString();
    const memberIds = [req.user.id];
    const members = {
      [req.user.id]: { role: 'owner', joined_at: now }
    };

    for (const nid of memberNovaIds) {
      const u = await getUserByNovaId(nid.trim().toUpperCase());
      if (u && u.id !== req.user.id && !memberIds.includes(u.id)) {
        memberIds.push(u.id);
        members[u.id] = { role: 'member', joined_at: now };
      }
    }

    const conv = await createConversation({
      type: 'group',
      name: name.trim(),
      ownerId: req.user.id,
      inviteCode: generateInviteCode(),
      memberIds,
      members
    });

    res.json({ conversation: conv });
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// POST /api/conversations/channel { name }
router.post('/channel', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Channel name is required' });

    const inviteCode = generateInviteCode();
    const now = new Date().toISOString();
    const conv = await createConversation({
      type: 'channel',
      name: name.trim(),
      ownerId: req.user.id,
      inviteCode,
      memberIds: [req.user.id],
      members: {
        [req.user.id]: { role: 'owner', joined_at: now }
      }
    });

    res.json({ conversation: conv });
  } catch (err) {
    console.error('Create channel error:', err);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// POST /api/conversations/join { inviteCode }
router.post('/join', async (req, res) => {
  try {
    const { inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ error: 'Invite code is required' });

    // Find conversation by invite_code
    const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');
    const { ensureInit } = require('../db/firebase');
    const db = await ensureInit();
    const q = query(
      collection(db, 'conversations'),
      where('invite_code', '==', inviteCode.trim().toUpperCase())
    );
    const snap = await getDocs(q);
    if (snap.empty) return res.status(404).json({ error: 'Invalid invite code' });

    const conv = snap.docs[0].data();
    await addConversationMember(conv.id, req.user.id, 'member');
    res.json({ conversation: conv });
  } catch (err) {
    console.error('Join conversation error:', err);
    res.status(500).json({ error: 'Failed to join' });
  }
});

// GET /api/conversations/:id/members
router.get('/:id/members', async (req, res) => {
  try {
    const conv = await getConversationById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (conv.type !== 'channel' && !(conv.member_ids || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    const members = await getConversationMembers(req.params.id);
    res.json({ members });
  } catch (err) {
    console.error('Get members error:', err);
    res.status(500).json({ error: 'Failed to get members' });
  }
});

// POST /api/conversations/:id/members { novaId }
router.post('/:id/members', async (req, res) => {
  try {
    const convId = req.params.id;
    const { novaId, novaIds = [] } = req.body;
    const conv = await getConversationById(convId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    if (!hasPermission(conv, req.user.id, conv.type === 'channel' ? 'can_add_subscribers' : 'can_add_members')) return res.status(403).json({ error: 'You do not have permission to add members' });
    if (conv.type !== 'group') {
      return res.status(400).json({ error: 'Can only add members to groups' });
    }

    const requested = Array.from(new Set([...(Array.isArray(novaIds) ? novaIds : []), ...(novaId ? [novaId] : [])]))
      .map((value) => String(value).trim().toUpperCase()).filter(Boolean);
    const added = [];
    for (const requestedId of requested) {
      const target = await getUserByNovaId(requestedId);
      if (target && !(conv.banned_user_ids || []).includes(String(target.id)) && !(conv.member_ids || []).includes(target.id)) {
        await addConversationMember(convId, target.id, 'member');
        added.push({ id: target.id, display_name: target.display_name, avatar_color: target.avatar_color, role: 'member' });
      }
    }
    if (!added.length) return res.status(404).json({ error: 'No new users were selected' });
    await updateConversation(convId, { audit_log: [...(conv.audit_log || []), ...added.map((member) => auditEntry('member_added', req.user.id, member.id))].slice(-200) });
    res.json({ members: added, member: added[0] });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// DELETE /api/conversations/:id/members/:userId
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const convId = req.params.id;
    const targetUserId = req.params.userId;
    const conv = await getConversationById(convId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const isSelf = String(req.user.id) === targetUserId;
    if (!isSelf && !canActOnTarget(conv, req.user.id, targetUserId, conv.type === 'channel' ? 'can_ban_subscribers' : 'can_kick')) return res.status(403).json({ error: 'You do not have permission to remove that member' });
    const targetRole = conv.members?.[targetUserId]?.role || (conv.owner_id === targetUserId ? 'owner' : 'member');
    if (targetRole === 'owner' && isSelf) return res.status(400).json({ error: 'Transfer ownership before leaving' });
    if (targetRole === 'owner' && role !== 'owner') return res.status(403).json({ error: 'Admins cannot remove the owner' });
    if (targetRole === 'owner') {
      const successor = Object.entries(conv.members || {})
        .filter(([id, member]) => id !== targetUserId && ['admin', 'member'].includes(member.role) && (conv.member_ids || []).includes(id))
        .sort((a, b) => new Date(a[1].joined_at || 0) - new Date(b[1].joined_at || 0))[0];
      if (!successor) return res.status(400).json({ error: 'Add another member before leaving' });
      await updateConversation(convId, { owner_id: successor[0], members: { ...conv.members, [successor[0]]: { ...successor[1], role: 'owner' } } });
    }
    await removeConversationMember(convId, targetUserId);
    await updateConversation(convId, { audit_log: [...(conv.audit_log || []), auditEntry(isSelf ? 'member_left' : 'member_removed', req.user.id, targetUserId)].slice(-200) });
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// POST /api/conversations/:id/ownership { userId }
router.post('/:id/ownership', async (req, res) => {
  try {
    const conv = await getConversationById(req.params.id);
    if (!conv || !['group', 'channel'].includes(conv.type)) return res.status(404).json({ error: 'Group or channel not found' });
    if (String(conv.owner_id) !== String(req.user.id)) return res.status(403).json({ error: 'Only the owner can transfer ownership' });
    const targetId = String(req.body?.userId || '');
    if (!targetId || !(conv.member_ids || []).includes(targetId)) return res.status(404).json({ error: 'New owner must be a member' });
    if (targetId === String(req.user.id)) return res.status(400).json({ error: 'You are already the owner' });
    const members = { ...(conv.members || {}) };
    members[String(req.user.id)] = { ...(members[String(req.user.id)] || {}), role: 'admin' };
    members[targetId] = { ...(members[targetId] || {}), role: 'owner' };
    const updated = await updateConversation(conv.id, { owner_id: targetId, members, audit_log: [...(conv.audit_log || []), auditEntry('ownership_transferred', req.user.id, targetId)].slice(-200) });
    res.json({ conversation: updated });
  } catch (err) {
    console.error('Transfer ownership error:', err);
    res.status(500).json({ error: 'Failed to transfer ownership' });
  }
});

// PATCH /api/conversations/:id/members/:userId/moderation { action: mute|unmute|ban|unban, durationSeconds }
router.patch('/:id/members/:userId/moderation', async (req, res) => {
  try {
    const conv = await getConversationById(req.params.id);
    if (!conv || !['group', 'channel'].includes(conv.type)) return res.status(404).json({ error: 'Group or channel not found' });
    const targetId = String(req.params.userId);
    const action = String(req.body?.action || '').toLowerCase();
    if (!['mute', 'unmute', 'ban', 'unban'].includes(action)) return res.status(400).json({ error: 'Invalid moderation action' });
    if (targetId === String(conv.owner_id)) return res.status(403).json({ error: 'The owner is protected from moderation actions' });
    const permission = conv.type === 'channel' ? 'can_ban_subscribers' : action.startsWith('ban') ? 'can_ban' : 'can_mute';
    if (!hasPermission(conv, req.user.id, permission)) return res.status(403).json({ error: 'You do not have permission to moderate members' });
    const members = { ...(conv.members || {}) };
    const banned = new Set((conv.banned_user_ids || []).map(String));
    if (action === 'mute' || action === 'unmute') {
      if (!members[targetId]) return res.status(404).json({ error: 'Member not found' });
      const duration = Math.max(0, Number(req.body?.durationSeconds) || 0);
      members[targetId] = { ...members[targetId], muted_until: action === 'mute' ? (duration ? new Date(Date.now() + duration * 1000).toISOString() : '9999-12-31T23:59:59.999Z') : null };
    } else if (action === 'ban') {
      banned.add(targetId);
      delete members[targetId];
    } else {
      banned.delete(targetId);
    }
    const updates = {
      members,
      member_ids: action === 'ban' ? (conv.member_ids || []).filter((id) => String(id) !== targetId) : (conv.member_ids || []),
      banned_user_ids: Array.from(banned),
      audit_log: [...(conv.audit_log || []), auditEntry(`member_${action}`, req.user.id, targetId)].slice(-200)
    };
    res.json({ conversation: await updateConversation(conv.id, updates) });
  } catch (err) {
    console.error('Moderation error:', err);
    res.status(500).json({ error: 'Failed to update member moderation' });
  }
});

// PATCH /api/conversations/:id/members/:userId/role
router.patch('/:id/members/:userId/role', async (req, res) => {
  try {
    const conv = await getConversationById(req.params.id);
    if (!conv || !['group', 'channel'].includes(conv.type)) return res.status(404).json({ error: 'Group or channel not found' });
    const actorRole = roleFor(conv, req.user.id);
    if (actorRole !== 'owner') return res.status(403).json({ error: 'Only the owner can change admin roles' });
    const targetId = String(req.params.userId);
    if (targetId === String(conv.owner_id)) return res.status(400).json({ error: 'The owner role cannot be changed' });
    if (!['admin', 'member'].includes(req.body.role)) return res.status(400).json({ error: 'Role must be admin or member' });
    const members = { ...(conv.members || {}) };
    if (!members[targetId]) return res.status(404).json({ error: 'Member not found' });
    members[targetId] = { ...members[targetId], role: req.body.role };
    const updated = await updateConversation(conv.id, { members, audit_log: [...(conv.audit_log || []), auditEntry(req.body.role === 'admin' ? 'member_promoted' : 'admin_demoted', req.user.id, targetId)].slice(-200) });
    res.json({ conversation: updated });
  } catch (err) {
    console.error('Update member role error:', err);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

// PUT /api/conversations/:id { name, pinned, archived, muted, wallpaper } - update chat settings
router.put('/:id', async (req, res) => {
  try {
    const convId = req.params.id;
    const { name, description, visibility, pinned, archived, muted, wallpaper, avatarUrl, inviteCode, isLocked, lockedPermissions, adminPermissions, slowModeSeconds } = req.body || {};

    const conv = await getConversationById(convId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!(conv.member_ids || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    const updates = {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Name is required' });
      if (conv.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can rename this' });
      updates.name = String(name).trim().slice(0, 120);
    }
    if (description !== undefined || visibility !== undefined) {
      if (!hasPermission(conv, req.user.id, conv.type === 'channel' ? 'can_edit_channel_info' : 'can_edit_group_info')) return res.status(403).json({ error: 'You do not have permission to edit this information' });
      if (description !== undefined) updates.description = String(description).slice(0, 1000);
      if (visibility !== undefined) {
        if (!['public', 'private'].includes(String(visibility))) return res.status(400).json({ error: 'Visibility must be public or private' });
        updates.visibility = String(visibility);
        updates.settings = { ...(conv.settings || {}), public: String(visibility) === 'public' };
      }
    }
    if (avatarUrl !== undefined) {
      if (!['group', 'channel'].includes(conv.type)) return res.status(400).json({ error: 'Only groups and channels have profile pictures' });
      const role = conv.members?.[req.user.id]?.role || (conv.owner_id === req.user.id ? 'owner' : null);
      if (!['owner', 'admin'].includes(role)) return res.status(403).json({ error: 'Only the owner or admins can change the profile picture' });
      updates.avatar_url = String(avatarUrl).slice(0, 500);
    }
    if (inviteCode !== undefined) {
      if (!['group', 'channel'].includes(conv.type)) return res.status(400).json({ error: 'Only groups and channels have invite links' });
      if (conv.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can change the invite link' });
      const normalized = String(inviteCode).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
      if (normalized.length < 6) return res.status(400).json({ error: 'Invite link must be at least 6 characters' });
      updates.invite_code = normalized;
    }
    if (isLocked !== undefined) {
      if (conv.type === 'dm') return res.status(400).json({ error: 'Direct messages cannot be locked' });
      if (!hasPermission(conv, req.user.id, 'can_lock_group')) return res.status(403).json({ error: 'You do not have permission to lock this conversation' });
      updates.is_locked = Boolean(isLocked);
      updates.locked_by = Boolean(isLocked) ? String(req.user.id) : null;
      updates.locked_at = Boolean(isLocked) ? new Date().toISOString() : null;
      updates.audit_log = [...(conv.audit_log || []), auditEntry(Boolean(isLocked) ? 'conversation_locked' : 'conversation_unlocked', req.user.id)].slice(-200);
    }
    if (lockedPermissions !== undefined) {
      if (!hasPermission(conv, req.user.id, 'can_lock_group')) return res.status(403).json({ error: 'You do not have permission to change lock settings' });
      updates.locked_permissions = { ...(conv.locked_permissions || {}), ...(lockedPermissions || {}) };
    }
    if (adminPermissions !== undefined) {
      if (roleFor(conv, req.user.id) !== 'owner') return res.status(403).json({ error: 'Only the owner can change admin permissions' });
      updates.admin_permissions = { ...(conv.admin_permissions || {}), ...(adminPermissions || {}) };
    }
    if (slowModeSeconds !== undefined) {
      if (!hasPermission(conv, req.user.id, 'can_edit_group_info')) return res.status(403).json({ error: 'You do not have permission to change slow mode' });
      updates.slow_mode_seconds = Math.max(0, Math.min(86400, Number(slowModeSeconds) || 0));
    }
    for (const [key, value] of Object.entries({ pinned, archived, muted, wallpaper })) {
      if (value !== undefined) updates[key] = key === 'wallpaper' ? String(value).slice(0, 200) : Boolean(value);
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
    const updated = await updateConversation(convId, updates);
    res.json({ conversation: updated });
  } catch (err) {
    console.error('Rename conversation error:', err);
    res.status(500).json({ error: 'Failed to rename conversation' });
  }
});

// DELETE /api/conversations/:id - delete conversation
router.delete('/:id', async (req, res) => {
  try {
    const convId = req.params.id;
    const conv = await getConversationById(convId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    if (conv.type === 'dm') {
      if (!(conv.member_ids || []).includes(req.user.id)) {
        return res.status(403).json({ error: 'Not a member of this conversation' });
      }
    } else if (conv.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the owner can delete this' });
    }

    await deleteConversation(convId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete conversation error:', err);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// GET /api/conversations/:id/messages
router.get('/:id/messages', async (req, res) => {
  try {
    const conv = await getConversationById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (conv.type !== 'channel' && !(conv.member_ids || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    const before = req.query.before || null;
    const messages = await getMessages(req.params.id, {
      limitCount: 50,
      beforeTime: before,
      userId: req.user.id
    });
    res.json({ messages });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /api/conversations/:id/messages - HTTP fallback for serverless deployments
router.post('/:id/messages', async (req, res) => {
  try {
    const conv = await getConversationById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (conv.type !== 'channel' && !(conv.member_ids || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }
    if (conv.type === 'dm') {
      const otherId = (conv.member_ids || []).find((id) => String(id) !== String(req.user.id));
      const senderUser = await getUserById(req.user.id);
      const otherUser = otherId ? await getUserById(otherId) : null;
      if (senderUser?.blocked_user_ids?.includes(String(otherId)) || otherUser?.blocked_user_ids?.includes(String(req.user.id))) {
        return res.status(403).json({ error: 'Messaging is unavailable because this user is blocked.' });
      }
    }
    const role = conv.members?.[req.user.id]?.role || (conv.owner_id === req.user.id ? 'owner' : null);
    if ((conv.banned_user_ids || []).includes(String(req.user.id))) return res.status(403).json({ error: 'You are banned from this conversation' });
    if (conv.members?.[req.user.id]?.muted_until && new Date(conv.members[req.user.id].muted_until).getTime() > Date.now()) return res.status(403).json({ error: 'You are muted in this conversation' });
    if (conv.type === 'channel' && conv.is_locked) return res.status(403).json({ error: 'This channel is currently paused by the owner' });
    if (conv.type === 'group' && conv.is_locked && !['owner', 'admin'].includes(role)) return res.status(403).json({ error: 'This group is locked — only admins can send messages' });
    if (conv.type === 'channel' && !['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Only channel admins can post here' });
    }
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Only text messages are supported by the HTTP fallback' });
    const startedAt = process.hrtime.bigint();
    const message = await createMessage(req.params.id, {
      id: req.body?.clientMessageId || undefined,
      senderId: req.user.id,
      content: content.slice(0, 4000),
      replyToId: req.body?.replyToId || null,
      statusReply: req.body?.statusReply || null
    });
    const sender = await getUserById(req.user.id);
    const recipients = (conv.member_ids || []).filter((id) => String(id) !== String(req.user.id));
    await Promise.all(recipients.map((recipientId) => createNotification({
      userId: recipientId,
      actorId: req.user.id,
      type: 'message',
      payload: { conversationId: String(req.params.id), messageId: message.id, preview: content.slice(0, 120) }
    })));
    const messagePayload = {
      ...message,
      display_name: sender?.display_name || 'User',
      avatar_color: sender?.avatar_color || '#0A84FF',
      avatar_url: sender?.avatar_url || null,
      is_verified: sender?.is_verified || false
    };
    let assistantMessage = null;
    const isDarkPairConversation = (conv.member_ids || []).includes('u_dark_pair') || String(req.params.id).startsWith('dm_dark_pair_');
    const commandText = content.toLowerCase();
    let assistantReply = null;
    if (isDarkPairConversation && (commandText.startsWith('/') || /^\d{6}$/.test(commandText))) {
      assistantReply = await getDarkPairReply(content, req.user.id);
    } else if (sender?.dark_pair_linked && commandText === '.ping') {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      assistantReply = [
        '╭━━〔 DARK BOT 〕━━┈⊷',
        '┃ ⚡ *Speed Test Completed!*',
        '┃',
        `┃ 📡 *Latency:* ${latencyMs.toFixed(4)} ms`,
        '┃ 🟢 Status: Stable & Responsive',
        '╰━━━━━━━━━━━━━━'
      ].join('\n');
    } else if (sender?.dark_pair_linked && commandText === '.menu') {
      assistantReply = getDarkPairMenu();
    } else if (sender?.dark_pair_linked && commandText.startsWith('.')) {
      assistantReply = await getDarkBotCommandReply(content, req.user.id, req.params.id);
      if (assistantReply === null) assistantReply = `Unknown command: ${content}. Send .menu to see available commands.`;
    }
    if (assistantReply) {
      const savedReply = await createMessage(req.params.id, {
        senderId: req.user.id,
        content: assistantReply
      });
      assistantMessage = {
        ...savedReply,
        display_name: sender?.display_name || 'User',
        avatar_color: sender?.avatar_color || '#0A84FF',
        avatar_url: sender?.avatar_url || null,
        is_verified: sender?.is_verified || false
      };
    }
    res.json({ message: messagePayload, assistantMessage });
  } catch (err) {
    console.error('HTTP send message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// POST /api/conversations/:id/read - mark messages from other people as read
router.post('/:id/read', async (req, res) => {
  try {
    const conv = await getConversationById(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (conv.type !== 'channel' && !(conv.member_ids || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }
    res.json(await markConversationRead(req.params.id, req.user.id));
  } catch (err) {
    console.error('Mark conversation read error:', err);
    res.status(500).json({ error: 'Failed to mark messages read' });
  }
});

// GET /api/conversations/:id/search
router.get('/:id/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ messages: [] });
    const messages = await searchMessages(req.params.id, q);
    res.json({ messages });
  } catch (err) {
    console.error('Search messages error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// PATCH /api/conversations/:id/messages/:messageId
router.patch('/:id/messages/:messageId', async (req, res) => {
  try {
    const msg = await getMessageById(req.params.id, req.params.messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the sender can edit this message' });
    }

    const content = String(req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Message content is required' });

    const updated = await updateMessage(req.params.id, req.params.messageId, {
      content: content.slice(0, 4000),
      edited_at: new Date().toISOString()
    });
    res.json({ message: updated });
  } catch (err) {
    console.error('Edit message error:', err);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// DELETE /api/conversations/:id/messages/:messageId
router.delete('/:id/messages/:messageId', async (req, res) => {
  try {
    const msg = await getMessageById(req.params.id, req.params.messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const scope = req.body?.scope === 'everyone' ? 'everyone' : 'me';
    if (scope === 'everyone' && msg.sender_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the sender can delete for everyone' });
    }

    if (scope === 'everyone') {
      await updateMessage(req.params.id, req.params.messageId, {
        content: null,
        media_data: null,
        media_url: null,
        deleted_for_everyone: true,
        deleted_at: new Date().toISOString()
      });
    } else {
      const hidden = msg.hidden_by || [];
      if (!hidden.includes(req.user.id)) hidden.push(req.user.id);
      await updateMessage(req.params.id, req.params.messageId, { hidden_by: hidden });
    }

    res.json({ ok: true, scope });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// POST /api/conversations/:id/messages/:messageId/reactions
router.post('/:id/messages/:messageId/reactions', async (req, res) => {
  try {
    const msg = await getMessageById(req.params.id, req.params.messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const reaction = String(req.body.reaction || '').trim().slice(0, 32);
    if (!reaction) return res.status(400).json({ error: 'Reaction is required' });

    let reactions = msg.reactions || [];
    const existingIndex = reactions.findIndex(r => r.user_id === req.user.id && r.reaction === reaction);
    if (existingIndex > -1) {
      reactions.splice(existingIndex, 1);
    } else {
      reactions.push({ user_id: req.user.id, reaction });
    }

    await updateMessage(req.params.id, req.params.messageId, { reactions });

    // Format reaction aggregates
    const countMap = {};
    for (const r of reactions) {
      countMap[r.reaction] = (countMap[r.reaction] || 0) + 1;
    }
    const result = Object.entries(countMap).map(([k, v]) => ({ reaction: k, count: v }));
    res.json({ reactions: result });
  } catch (err) {
    console.error('Reactions error:', err);
    res.status(500).json({ error: 'Failed to update reaction' });
  }
});

// POST /api/conversations/:id/messages/:messageId/save
router.post('/:id/messages/:messageId/save', async (req, res) => {
  try {
    const msg = await getMessageById(req.params.id, req.params.messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    let savedBy = msg.saved_by || [];
    const index = savedBy.indexOf(req.user.id);
    let saved = false;
    if (index > -1) {
      savedBy.splice(index, 1);
      saved = false;
    } else {
      savedBy.push(req.user.id);
      saved = true;
    }

    await updateMessage(req.params.id, req.params.messageId, { saved_by: savedBy });
    res.json({ saved });
  } catch (err) {
    console.error('Save message error:', err);
    res.status(500).json({ error: 'Failed to save message' });
  }
});

// POST /api/conversations/:id/messages/:messageId/pin
router.post('/:id/messages/:messageId/pin', async (req, res) => {
  try {
    const msg = await getMessageById(req.params.id, req.params.messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const conv = await getConversationById(req.params.id);
    const role = conv?.members?.[req.user.id]?.role || (conv?.owner_id === req.user.id ? 'owner' : null);
    if (!['owner', 'admin'].includes(role) && msg.sender_id !== req.user.id) {
      return res.status(403).json({ error: 'Only group admin or sender can pin messages' });
    }

    const pinned = !msg.pinned_at;
    await updateMessage(req.params.id, req.params.messageId, {
      pinned_at: pinned ? new Date().toISOString() : null,
      pinned_by: pinned ? req.user.id : null
    });
    res.json({ pinned });
  } catch (err) {
    console.error('Pin message error:', err);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

module.exports = router;
