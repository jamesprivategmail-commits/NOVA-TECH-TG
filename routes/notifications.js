const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);
router.get('/', async (req, res) => {
  const { rows } = await db.query(`SELECT n.id,n.type,n.payload,n.created_at,n.read_at,u.display_name AS actor_name FROM notifications n LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 50`, [req.user.id]);
  res.json({ notifications: rows });
});
router.get('/unread-count', async (req, res) => {
  const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
  res.json({ count: rows[0].count });
});
router.post('/read', async (req, res) => {
  if (req.body.id) await db.query('UPDATE notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2', [req.body.id, req.user.id]);
  else await db.query('UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
  res.json({ ok: true });
});
module.exports = router;
