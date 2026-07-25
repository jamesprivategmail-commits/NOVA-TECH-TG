const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST /api/status { content, bgColor }
router.post('/', async (req, res) => {
  const { content, bgColor } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Status text is required' });

  const { rows } = await db.query(
    `INSERT INTO statuses (user_id, content, bg_color, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours') RETURNING *`,
    [req.user.id, content.trim().slice(0, 300), bgColor || '#0A84FF']
  );
  res.json({ status: rows[0] });
});

// GET /api/status/feed - active statuses from everyone (friends model: everyone on the server)
router.get('/feed', async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.content, s.bg_color, s.created_at, s.expires_at,
            u.id as user_id, u.nova_id, u.display_name, u.avatar_color, u.is_verified,
            EXISTS(SELECT 1 FROM status_views v WHERE v.status_id = s.id AND v.viewer_id = $1) AS viewed
     FROM statuses s JOIN users u ON u.id = s.user_id
     WHERE s.expires_at > NOW()
     ORDER BY s.created_at DESC`,
    [req.user.id]
  );
  res.json({ statuses: rows });
});

// POST /api/status/:id/view
router.post('/:id/view', async (req, res) => {
  await db.query(
    `INSERT INTO status_views (status_id, viewer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

// DELETE /api/status/:id
router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM statuses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;