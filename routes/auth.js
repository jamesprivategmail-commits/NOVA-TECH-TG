const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  createUser,
  getUserById,
  getUserByNovaId,
  updateUser,
  uploadToStorage
} = require('../db/firebase');
const { generateNovaId, randomAvatarColor } = require('../db/idGen');
const { requireAuth } = require('../middleware/auth');
const { isAdminNovaId } = require('../middleware/admin');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'darkchat-firebase-jwt-secret-2026';

function sign(user) {
  return jwt.sign(
    { id: user.id, novaId: user.nova_id, displayName: user.display_name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function publicUser(u) {
  const avatar = u.avatar_url || (u.avatar_data ? (u.avatar_data.startsWith('data:') ? u.avatar_data : `data:${u.avatar_mime || 'image/jpeg'};base64,${u.avatar_data}`) : null);
  return {
    id: u.id,
    novaId: u.nova_id,
    displayName: u.display_name,
    avatarColor: u.avatar_color,
    avatarUrl: avatar,
    avatarData: avatar,
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

    const user = await createUser({
      novaId,
      displayName: displayName.trim(),
      passwordHash: hash,
      avatarColor
    });

    const token = sign(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed, try again' });
  }
});

// POST /api/auth/login { novaId, password }
router.post('/login', async (req, res) => {
  try {
    const { novaId, password } = req.body;
    if (!novaId || !password) return res.status(400).json({ error: 'DARK CHAT ID and password are required' });

    const user = await getUserByNovaId(novaId.trim().toUpperCase());
    if (!user) return res.status(401).json({ error: 'Wrong DARK CHAT ID or password' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Wrong DARK CHAT ID or password' });

    if (user.is_banned) {
      return res.status(403).json({ error: user.ban_reason ? `Account banned: ${user.ban_reason}` : 'Your account has been banned.' });
    }

    const updated = await updateUser(user.id, { last_seen: new Date().toISOString() });
    const token = sign(updated || user);
    res.json({ token, user: publicUser(updated || user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed, try again' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

// PUT /api/auth/me { displayName, bio, avatarData, avatarMime } - edit profile
router.put('/me', requireAuth, async (req, res) => {
  try {
    const { displayName, bio, avatarData, avatarMime } = req.body;
    const updates = {};

    if (displayName !== undefined && displayName.trim()) {
      updates.display_name = displayName.trim();
    }
    if (bio !== undefined) {
      updates.bio = (bio || '').slice(0, 160);
    }
    if (avatarData) {
      // Store avatar in Firebase Storage
      const uploaded = await uploadToStorage({
        data: avatarData,
        mimeType: avatarMime || 'image/jpeg',
        filename: `avatar_${req.user.id}.jpg`,
        userId: req.user.id
      });
      updates.avatar_url = uploaded.url;
      updates.avatar_data = uploaded.url;
      updates.avatar_mime = uploaded.mimeType;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const updated = await updateUser(req.user.id, updates);
    res.json({ user: publicUser(updated) });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/auth/lookup/:novaId - find a user
router.get('/lookup/:novaId', requireAuth, async (req, res) => {
  try {
    const user = await getUserByNovaId(req.params.novaId.trim().toUpperCase());
    if (!user) return res.status(404).json({ error: 'No one has that DARK CHAT ID' });
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Lookup error:', err);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

module.exports = router;
