const express = require('express');
const { getAllUsers, getUserCount } = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/users', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const [users, totalUsers] = await Promise.all([
      getAllUsers(search, 100),
      getUserCount()
    ]);
    res.json({ totalUsers, users: users
      .filter(user => String(user.id) !== String(req.user.id) && !user.is_banned)
      .map(user => ({
        id: user.id,
        novaId: user.nova_id,
        displayName: user.display_name || 'DARK CHAT User',
        bio: user.bio || '',
        avatarColor: user.avatar_color || '#18181a',
        avatarUrl: user.avatar_url || null,
        isVerified: Boolean(user.is_verified),
        lastSeen: user.last_seen || null
      })) });
  } catch (err) {
    console.error('Discover users error:', err);
    res.status(500).json({ error: 'Failed to load Discover users' });
  }
});

module.exports = router;
