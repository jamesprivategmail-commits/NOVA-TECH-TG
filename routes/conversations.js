const express = require('express');
const {
  getConversationsForUser,
  getConversationById,
  createConversation,
  findDmBetween,
  updateConversation,
  deleteConversation,
  addConversationMember,
  removeConversationMember,
  getConversationMembers,
  getUserByNovaId,
  getUserById,
  getMessages,
  getMessageById,
  updateMessage,
  searchMessages
} = require('../db/firebase');
const { generateInviteCode } = require('../db/idGen');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

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
    if (target.id === req.user.id) return res.status(400).json({ error: "You can't DM yourself" });

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
    const { novaId } = req.body;
    const conv = await getConversationById(convId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const role = conv.members?.[req.user.id]?.role || (conv.owner_id === req.user.id ? 'owner' : null);
    if (!['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Only the owner or admins can add members' });
    }
    if (conv.type !== 'group') {
      return res.status(400).json({ error: 'Can only add members to groups' });
    }

    const target = await getUserByNovaId((novaId || '').trim().toUpperCase());
    if (!target) return res.status(404).json({ error: 'No one has that DARK CHAT ID' });
    if ((conv.member_ids || []).includes(target.id)) {
      return res.status(409).json({ error: 'Already in this group' });
    }

    await addConversationMember(convId, target.id, 'member');
    res.json({
      member: {
        id: target.id,
        display_name: target.display_name,
        avatar_color: target.avatar_color,
        role: 'member'
      }
    });
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

    const role = conv.members?.[req.user.id]?.role || (conv.owner_id === req.user.id ? 'owner' : null);
    if (!['owner', 'admin'].includes(role) && String(req.user.id) !== targetUserId) {
      return res.status(403).json({ error: 'Only the owner or admins can remove members' });
    }

    await removeConversationMember(convId, targetUserId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// PUT /api/conversations/:id { name } - rename
router.put('/:id', async (req, res) => {
  try {
    const convId = req.params.id;
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

    const conv = await getConversationById(convId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (conv.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the owner can rename this' });
    }

    const updated = await updateConversation(convId, { name: name.trim() });
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
