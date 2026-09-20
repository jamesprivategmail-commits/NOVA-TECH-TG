const express = require('express');
const db = require('../db');
const { generateInviteCode } = require('../db/idGen');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/conversations - list all conversations for current user, with last message preview
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.type, c.name, c.avatar_color, c.owner_id, c.invite_code,
            m.role,
            lm.content AS last_message, lm.created_at AS last_message_at, lm.sender_id AS last_sender_id
     FROM conversation_members m
     JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN LATERAL (
       SELECT content, created_at, sender_id FROM messages
       WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
     ) lm ON true
     WHERE m.user_id = $1
     ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
    [req.user.id]
  );

  // For DMs, resolve the other participant's identity as the display name
  for (const conv of rows) {
    if (conv.type === 'dm') {
      const other = await db.query(
        `SELECT u.id, u.nova_id, u.display_name, u.avatar_color, u.is_verified FROM conversation_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.conversation_id = $1 AND m.user_id != $2`,
        [conv.id, req.user.id]
      );
      if (other.rows[0]) {
        conv.name = other.rows[0].display_name;
        conv.avatar_color = other.rows[0].avatar_color;
        conv.other_user = other.rows[0];
      }
    }
  }

  res.json({ conversations: rows });
});

// POST /api/conversations/dm { novaId }
router.post('/dm', async (req, res) => {
  const { novaId } = req.body;
  const target = await db.query('SELECT * FROM users WHERE nova_id = $1', [(novaId || '').trim().toUpperCase()]);
  if (!target.rows[0]) return res.status(404).json({ error: 'No one has that DARK CHAT ID' });
  if (target.rows[0].id === req.user.id) return res.status(400).json({ error: "You can't DM yourself" });

  // Check for existing DM between these two users
  const existing = await db.query(
    `SELECT c.id FROM conversations c
     JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = $1
     JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = $2
     WHERE c.type = 'dm'`,
    [req.user.id, target.rows[0].id]
  );
  if (existing.rows[0]) return res.json({ conversationId: existing.rows[0].id, existed: true });

  const conv = await db.query(`INSERT INTO conversations (type) VALUES ('dm') RETURNING id`);
  const convId = conv.rows[0].id;
  await db.query(
    `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'member'),($1,$3,'member')`,
    [convId, req.user.id, target.rows[0].id]
  );
  res.json({ conversationId: convId, existed: false });
});

// POST /api/conversations/group { name, memberNovaIds: [] }
router.post('/group', async (req, res) => {
  const { name, memberNovaIds = [] } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });

  const conv = await db.query(
    `INSERT INTO conversations (type, name, owner_id) VALUES ('group', $1, $2) RETURNING *`,
    [name.trim(), req.user.id]
  );
  const convId = conv.rows[0].id;
  await db.query(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'owner')`, [convId, req.user.id]);

  for (const nid of memberNovaIds) {
    const u = await db.query('SELECT id FROM users WHERE nova_id = $1', [nid.trim().toUpperCase()]);
    if (u.rows[0] && u.rows[0].id !== req.user.id) {
      await db.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
        [convId, u.rows[0].id]
      );
    }
  }
  res.json({ conversation: conv.rows[0] });
});

// POST /api/conversations/channel { name }  -- broadcast: owner/admins post, everyone else reads
router.post('/channel', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Channel name is required' });

  const inviteCode = generateInviteCode();
  const conv = await db.query(
    `INSERT INTO conversations (type, name, owner_id, invite_code) VALUES ('channel', $1, $2, $3) RETURNING *`,
    [name.trim(), req.user.id, inviteCode]
  );
  const convId = conv.rows[0].id;
  await db.query(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'owner')`, [convId, req.user.id]);
  res.json({ conversation: conv.rows[0] });
});

// POST /api/conversations/join { inviteCode }
router.post('/join', async (req, res) => {
  const { inviteCode } = req.body;
  const conv = await db.query('SELECT * FROM conversations WHERE invite_code = $1', [(inviteCode || '').trim().toUpperCase()]);
  if (!conv.rows[0]) return res.status(404).json({ error: 'Invalid invite code' });
  await db.query(
    `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
    [conv.rows[0].id, req.user.id]
  );
  res.json({ conversation: conv.rows[0] });
});

// GET /api/conversations/:id/members
router.get('/:id/members', async (req, res) => {
  const check = await db.query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!check.rows[0]) return res.status(403).json({ error: 'Not a member of this conversation' });

  const { rows } = await db.query(
    `SELECT u.id, u.nova_id, u.display_name, u.avatar_color, u.is_verified, m.role
     FROM conversation_members m JOIN users u ON u.id = m.user_id
     WHERE m.conversation_id = $1 ORDER BY m.role, u.display_name`,
    [req.params.id]
  );
  res.json({ members: rows });
});

// POST /api/conversations/:id/members { novaId } - add someone to a group
router.post('/:id/members', async (req, res) => {
  const convId = req.params.id;
  const { novaId } = req.body;

  const me = await db.query(
    'SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',
    [convId, req.user.id]
  );
  if (!me.rows[0]) return res.status(403).json({ error: 'Not a member of this conversation' });
  if (!['owner', 'admin'].includes(me.rows[0].role)) {
    return res.status(403).json({ error: 'Only the owner or admins can add members' });
  }

  const convType = await db.query('SELECT type FROM conversations WHERE id=$1', [convId]);
  if (convType.rows[0]?.type !== 'group') {
    return res.status(400).json({ error: 'Can only add members to groups' });
  }

  const target = await db.query('SELECT id, display_name, avatar_color FROM users WHERE nova_id = $1', [(novaId || '').trim().toUpperCase()]);
  if (!target.rows[0]) return res.status(404).json({ error: 'No one has that DARK CHAT ID' });

  const already = await db.query(
    'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',
    [convId, target.rows[0].id]
  );
  if (already.rows[0]) return res.status(409).json({ error: 'Already in this group' });

  await db.query(
    `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'member')`,
    [convId, target.rows[0].id]
  );
  res.json({ member: target.rows[0] });
});

// DELETE /api/conversations/:id/members/:userId - remove a member (owner/admin only, or leave yourself)
router.delete('/:id/members/:userId', async (req, res) => {
  const convId = req.params.id;
  const targetUserId = req.params.userId;

  const me = await db.query(
    'SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',
    [convId, req.user.id]
  );
  if (!me.rows[0]) return res.status(403).json({ error: 'Not a member of this conversation' });
  if (!['owner', 'admin'].includes(me.rows[0].role) && String(req.user.id) !== targetUserId) {
    return res.status(403).json({ error: 'Only the owner or admins can remove members' });
  }

  await db.query(
    'DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',
    [convId, targetUserId]
  );
  res.json({ ok: true });
});

// PUT /api/conversations/:id { name } - rename group/channel (owner only)
router.put('/:id', async (req, res) => {
  const convId = req.params.id;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  const conv = await db.query('SELECT owner_id FROM conversations WHERE id=$1', [convId]);
  if (!conv.rows[0]) return res.status(404).json({ error: 'Conversation not found' });
  if (conv.rows[0].owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can rename this' });

  const { rows } = await db.query('UPDATE conversations SET name=$1 WHERE id=$2 RETURNING *', [name.trim(), convId]);
  res.json({ conversation: rows[0] });
});

// DELETE /api/conversations/:id - delete a conversation (owner only, or either DM participant)
router.delete('/:id', async (req, res) => {
  const convId = req.params.id;
  const conv = await db.query('SELECT owner_id, type FROM conversations WHERE id=$1', [convId]);
  if (!conv.rows[0]) return res.status(404).json({ error: 'Conversation not found' });

  if (conv.rows[0].type === 'dm') {
    const check = await db.query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2', [convId, req.user.id]);
    if (!check.rows[0]) return res.status(403).json({ error: 'Not a member of this conversation' });
  } else if (conv.rows[0].owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the owner can delete this' });
  }

  await db.query('DELETE FROM conversations WHERE id=$1', [convId]); // cascades to members/messages
  res.json({ ok: true });
});

// GET /api/conversations/:id/messages?before=<messageId>
router.get('/:id/messages', async (req, res) => {
  const check = await db.query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!check.rows[0]) return res.status(403).json({ error: 'Not a member of this conversation' });

  const before = req.query.before ? parseInt(req.query.before, 10) : null;
  const params = before ? [req.params.id, before] : [req.params.id];
  const { rows } = await db.query(
    `SELECT msg.id, msg.content, msg.media_type, msg.media_data, msg.media_mime, msg.media_duration,
            msg.created_at, msg.sender_id, msg.edited_at, msg.reply_to_id, msg.forwarded_from_id,
            msg.deleted_for_everyone, msg.deleted_at, msg.pinned_at, msg.pinned_by,
            u.display_name, u.avatar_color, u.is_verified,
            COALESCE((SELECT json_agg(json_build_object('reaction', mr.reaction, 'user_id', mr.user_id)) FROM message_reactions mr WHERE mr.message_id = msg.id), '[]') AS reactions,
            EXISTS(SELECT 1 FROM saved_messages sm WHERE sm.message_id = msg.id AND sm.user_id = $${before ? 3 : 2}) AS saved_by_me
     FROM messages msg JOIN users u ON u.id = msg.sender_id
     WHERE msg.conversation_id = $1 ${before ? 'AND msg.id < $2' : ''}
       AND NOT EXISTS (SELECT 1 FROM hidden_messages hm WHERE hm.message_id = msg.id AND hm.user_id = $${before ? 3 : 2})
     ORDER BY msg.created_at DESC LIMIT 50`,
    before ? [...params, req.user.id] : [...params, req.user.id]
  );
  res.json({ messages: rows.reverse() });
});

async function messageAccess(conversationId, messageId, userId) {
  const { rows } = await db.query(
    `SELECT msg.*, cm.role FROM messages msg JOIN conversation_members cm
     ON cm.conversation_id = msg.conversation_id AND cm.user_id = $3
     WHERE msg.id = $2 AND msg.conversation_id = $1`,
    [conversationId, messageId, userId]
  );
  return rows[0];
}

// Search message text within conversations the current user can access.
router.get('/:id/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ messages: [] });
  const { rows } = await db.query(
    `SELECT msg.id, msg.conversation_id, msg.content, msg.created_at, msg.sender_id,
            u.display_name, msg.media_type, msg.reply_to_id, msg.edited_at
     FROM messages msg JOIN users u ON u.id = msg.sender_id
     JOIN conversation_members cm ON cm.conversation_id = msg.conversation_id AND cm.user_id = $1
     WHERE msg.conversation_id = $2 AND msg.deleted_for_everyone = FALSE AND msg.content ILIKE $3
     ORDER BY msg.created_at DESC LIMIT 50`,
    [req.user.id, req.params.id, `%${q}%`]
  );
  res.json({ messages: rows });
});

router.patch('/:id/messages/:messageId', async (req, res) => {
  const message = await messageAccess(req.params.id, req.params.messageId, req.user.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (message.sender_id !== req.user.id) return res.status(403).json({ error: 'Only the sender can edit this message' });
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Message content is required' });
  const { rows } = await db.query('UPDATE messages SET content=$1, edited_at=NOW() WHERE id=$2 RETURNING *', [content.slice(0, 4000), message.id]);
  res.json({ message: rows[0] });
});

router.delete('/:id/messages/:messageId', async (req, res) => {
  const message = await messageAccess(req.params.id, req.params.messageId, req.user.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  const scope = req.body?.scope === 'everyone' ? 'everyone' : 'me';
  if (scope === 'everyone' && message.sender_id !== req.user.id) return res.status(403).json({ error: 'Only the sender can delete for everyone' });
  if (scope === 'everyone') {
    await db.query("UPDATE messages SET content=NULL, media_data=NULL, deleted_for_everyone=TRUE, deleted_at=NOW() WHERE id=$1", [message.id]);
  } else {
    await db.query('INSERT INTO hidden_messages (message_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [message.id, req.user.id]);
  }
  res.json({ ok: true, scope });
});

router.post('/:id/messages/:messageId/reactions', async (req, res) => {
  const message = await messageAccess(req.params.id, req.params.messageId, req.user.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  const reaction = String(req.body.reaction || '').trim().slice(0, 32);
  if (!reaction) return res.status(400).json({ error: 'Reaction is required' });
  const existing = await db.query('SELECT 1 FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND reaction=$3', [message.id, req.user.id, reaction]);
  if (existing.rows[0]) await db.query('DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND reaction=$3', [message.id, req.user.id, reaction]);
  else await db.query('INSERT INTO message_reactions (message_id,user_id,reaction) VALUES ($1,$2,$3)', [message.id, req.user.id, reaction]);
  const { rows } = await db.query('SELECT reaction, COUNT(*)::int AS count FROM message_reactions WHERE message_id=$1 GROUP BY reaction ORDER BY reaction', [message.id]);
  res.json({ reactions: rows });
});

router.post('/:id/messages/:messageId/save', async (req, res) => {
  const message = await messageAccess(req.params.id, req.params.messageId, req.user.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  const existing = await db.query('SELECT 1 FROM saved_messages WHERE message_id=$1 AND user_id=$2', [message.id, req.user.id]);
  if (existing.rows[0]) await db.query('DELETE FROM saved_messages WHERE message_id=$1 AND user_id=$2', [message.id, req.user.id]);
  else await db.query('INSERT INTO saved_messages (message_id,user_id) VALUES ($1,$2)', [message.id, req.user.id]);
  res.json({ saved: !existing.rows[0] });
});

router.post('/:id/messages/:messageId/pin', async (req, res) => {
  const message = await messageAccess(req.params.id, req.params.messageId, req.user.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (!['owner', 'admin'].includes(message.role) && message.sender_id !== req.user.id) return res.status(403).json({ error: 'Only a group admin or sender can pin messages' });
  const pinned = !message.pinned_at;
  await db.query('UPDATE messages SET pinned_at = CASE WHEN $1 THEN NOW() ELSE NULL END, pinned_by = CASE WHEN $1 THEN $2 ELSE NULL END WHERE id=$3', [pinned, req.user.id, message.id]);
  res.json({ pinned });
});

module.exports = router;
