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
        `SELECT u.id, u.nova_id, u.display_name, u.avatar_color FROM conversation_members m
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
  if (!target.rows[0]) return res.status(404).json({ error: 'No one has that NOVA ID' });
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
    `SELECT u.id, u.nova_id, u.display_name, u.avatar_color, m.role
     FROM conversation_members m JOIN users u ON u.id = m.user_id
     WHERE m.conversation_id = $1 ORDER BY m.role, u.display_name`,
    [req.params.id]
  );
  res.json({ members: rows });
});

// GET /api/conversations/:id/messages?before=<messageId>
router.get('/:id/messages', async (req, res) => {
  const check = await db.query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!check.rows[0]) return res.status(403).json({ error: 'Not a member of this conversation' });

  const before = req.query.before ? parseInt(req.query.before, 10) : null;
  const params = before ? [req.params.id, before] : [req.params.id];
  const { rows } = await db.query(
    `SELECT msg.id, msg.content, msg.created_at, msg.sender_id, u.display_name, u.avatar_color
     FROM messages msg JOIN users u ON u.id = msg.sender_id
     WHERE msg.conversation_id = $1 ${before ? 'AND msg.id < $2' : ''}
     ORDER BY msg.created_at DESC LIMIT 50`,
    params
  );
  res.json({ messages: rows.reverse() });
});

module.exports = router;