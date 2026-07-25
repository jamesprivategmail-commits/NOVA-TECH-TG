const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/posts - feed, newest first
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.id, p.caption, p.created_at,
            u.id AS user_id, u.nova_id, u.display_name, u.avatar_color,
            (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id)::int AS like_count,
            EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = $1) AS liked_by_me,
            (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id)::int AS comment_count
     FROM posts p JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json({ posts: rows });
});

// POST /api/posts { caption }
router.post('/', async (req, res) => {
  const { caption } = req.body;
  if (!caption || !caption.trim()) return res.status(400).json({ error: 'Caption is required' });
  const { rows } = await db.query(
    `INSERT INTO posts (user_id, caption) VALUES ($1, $2) RETURNING *`,
    [req.user.id, caption.trim().slice(0, 500)]
  );
  res.json({ post: rows[0] });
});

// POST /api/posts/:id/like (toggle)
router.post('/:id/like', async (req, res) => {
  const existing = await db.query('SELECT 1 FROM post_likes WHERE post_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (existing.rows[0]) {
    await db.query('DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    return res.json({ liked: false });
  }
  await db.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2)', [req.params.id, req.user.id]);
  res.json({ liked: true });
});

// GET /api/posts/:id/comments
router.get('/:id/comments', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.content, c.created_at, u.display_name, u.avatar_color
     FROM post_comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = $1 ORDER BY c.created_at ASC`,
    [req.params.id]
  );
  res.json({ comments: rows });
});

// POST /api/posts/:id/comments { content }
router.post('/:id/comments', async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
  const { rows } = await db.query(
    `INSERT INTO post_comments (post_id, user_id, content) VALUES ($1,$2,$3) RETURNING *`,
    [req.params.id, req.user.id, content.trim().slice(0, 500)]
  );
  res.json({ comment: rows[0] });
});

module.exports = router;