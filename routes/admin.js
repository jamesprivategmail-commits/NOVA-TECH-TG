const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, isAdminNovaId } = require('../middleware/admin');

const router = express.Router();
router.use(requireAuth, requireAdmin);

function publicUser(u) {
  return {
    id: u.id,
    novaId: u.nova_id,
    displayName: u.display_name,
    avatarColor: u.avatar_color,
    bio: u.bio,
    isVerified: !!u.is_verified,
    isBanned: !!u.is_banned,
    banReason: u.ban_reason,
    isAdmin: isAdminNovaId(u.nova_id),
    createdAt: u.created_at,
    lastSeen: u.last_seen
  };
}

// GET /api/admin/users?search=NOVA-401022 or a name
router.get('/users', async (req, res) => {
  const search = (req.query.search || '').trim();
  let rows;
  if (search) {
    const like = `%${search}%`;
    ({ rows } = await db.query(
      `SELECT * FROM users WHERE nova_id ILIKE $1 OR display_name ILIKE $1 ORDER BY created_at DESC LIMIT 100`,
      [like]
    ));
  } else {
    ({ rows } = await db.query(`SELECT * FROM users ORDER BY created_at DESC LIMIT 100`));
  }
  res.json({ users: rows.map(publicUser) });
});

// POST /api/admin/users/:id/ban { reason }
router.post('/users/:id/ban', async (req, res) => {
  const { reason } = req.body;
  const { rows } = await db.query(
    'UPDATE users SET is_banned = TRUE, ban_reason = $1 WHERE id = $2 RETURNING *',
    [reason || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(rows[0]) });
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', async (req, res) => {
  const { rows } = await db.query(
    'UPDATE users SET is_banned = FALSE, ban_reason = NULL WHERE id = $1 RETURNING *',
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(rows[0]) });
});

// POST /api/admin/users/:id/verify
router.post('/users/:id/verify', async (req, res) => {
  const { rows } = await db.query('UPDATE users SET is_verified = TRUE WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(rows[0]) });
});

// POST /api/admin/users/:id/unverify
router.post('/users/:id/unverify', async (req, res) => {
  const { rows } = await db.query('UPDATE users SET is_verified = FALSE WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(rows[0]) });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  const { rows } = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

module.exports = router;