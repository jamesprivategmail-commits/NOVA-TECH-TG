const express = require('express');
const { getAllUsers, getUserCount, getAllChannels } = require('../db/firebase');
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
      .filter(user => String(user.id) !== String(req.user.id) && !user.is_banned && !user.is_system)
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

// GET /api/discover/channels - public channels the current user has not joined yet
router.get('/channels', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const channels = await getAllChannels(search);
    const notFollowing = channels
      .filter((channel) => !(channel.member_ids || []).map(String).includes(String(req.user.id)))
      .map((channel) => ({
        id: channel.id,
        name: channel.name || 'Channel',
        description: channel.description || '',
        avatarUrl: channel.avatar_url || null,
        avatarColor: channel.avatar_color || '#18181a',
        isVerified: Boolean(channel.is_verified),
        memberCount: (channel.member_ids || []).length,
        inviteCode: channel.invite_code || null
      }))
      .sort((a, b) => b.memberCount - a.memberCount);
    res.json({ channels: notFollowing });
  } catch (err) {
    console.error('Discover channels error:', err);
    res.status(500).json({ error: 'Failed to load channel discovery' });
  }
});

module.exports = router;
