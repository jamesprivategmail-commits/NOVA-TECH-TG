const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { generateNovaId, randomAvatarColor } = require('../db/idGen');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function sign(user) {
  return jwt.sign(
    { id: user.id, novaId: user.nova_id, displayName: user.display_name },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function publicUser(u) {
  return {
    id: u.id,
    novaId: u.nova_id,
    displayName: u.display_name,
    avatarColor: u.avatar_color,
    bio: u.bio
  };
}

// POST /api/auth/signup { displayName, password }
router.post('/signup', async (req, res) => {
  try {
    const { displayName, password } = req.body;
    if (!displayName || !displayName.trim()) return res.status(400).json({ error: 'Display name is required' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const novaId = await generateNovaId();
    const hash = await bcrypt.hash(password, 10);
    const avatarColor = randomAvatarColor();

    const { rows } = await db.query(
      `INSERT INTO users (nova_id, display_name, password_hash, avatar_color)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [novaId, displayName.trim(), hash, avatarColor]
    );
    const user = rows[0];
    const token = sign(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Signup failed, try again' });
  }
});

// POST /api/auth/login { novaId, password }
router.post('/login', async (req, res) => {
  try {
    const { novaId, password } = req.body;
    if (!novaId || !password) return res.status(400).json({ error: 'NOVA ID and password are required' });

    const { rows } = await db.query('SELECT * FROM users WHERE nova_id = $1', [novaId.trim().toUpperCase()]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Wrong NOVA ID or password' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Wrong NOVA ID or password' });

    await db.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [user.id]);
    const token = sign(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed, try again' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(rows[0]) });
});

// GET /api/auth/lookup/:novaId - find a user to start a DM or add to group
router.get('/lookup/:novaId', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, nova_id, display_name, avatar_color, bio FROM users WHERE nova_id = $1',
    [req.params.novaId.trim().toUpperCase()]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No one has that NOVA ID' });
  res.json({ user: publicUser(rows[0]) });
});

module.exports = router;