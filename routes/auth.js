const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { generateNovaId, randomAvatarColor } = require('../db/idGen');
const { requireAuth } = require('../middleware/auth');
const { isAdminNovaId } = require('../middleware/admin');

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
    avatarData: u.avatar_data ? `data:${u.avatar_mime};base64,${u.avatar_data}` : null,
    bio: u.bio,
    isVerified: !!u.is_verified,
    isAdmin: isAdminNovaId(u.nova_id),
    createdAt: u.created_at,
    lastSeen: u.last_seen
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

    if (user.is_banned) {
      return res.status(403).json({ error: user.ban_reason ? `Account banned: ${user.ban_reason}` : 'Your account has been banned.' });
    }

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

// PUT /api/auth/me { displayName, bio, avatarData, avatarMime } - edit your own profile
router.put('/me', requireAuth, async (req, res) => {
  const { displayName, bio, avatarData, avatarMime } = req.body;
  const fields = [];
  const values = [];
  let i = 1;

  if (displayName !== undefined && displayName.trim()) { fields.push(`display_name = $${i++}`); values.push(displayName.trim()); }
  if (bio !== undefined) { fields.push(`bio = $${i++}`); values.push((bio || '').slice(0, 160)); }
  if (avatarData !== undefined) {
    fields.push(`avatar_data = $${i++}`); values.push(avatarData);
    fields.push(`avatar_mime = $${i++}`); values.push(avatarMime || 'image/jpeg');
  }
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  values.push(req.user.id);
  const { rows } = await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  res.json({ user: publicUser(rows[0]) });
});

// GET /api/auth/lookup/:novaId - find a user to start a DM or add to group, or view a WhatsApp-style profile
router.get('/lookup/:novaId', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM users WHERE nova_id = $1',
    [req.params.novaId.trim().toUpperCase()]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No one has that NOVA ID' });
  res.json({ user: publicUser(rows[0]) });
});

module.exports = router;