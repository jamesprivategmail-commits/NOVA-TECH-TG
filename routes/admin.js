const express = require('express');
const {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser
} = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, isAdminNovaId } = require('../middleware/admin');

const router = express.Router();
router.use(requireAuth, requireAdmin);

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
    isBanned: !!u.is_banned,
    banReason: u.ban_reason,
    isAdmin: isAdminNovaId(u.nova_id),
    createdAt: u.created_at,
    lastSeen: u.last_seen
  };
}

// GET /api/admin/users?search=
router.get('/users', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const users = await getAllUsers(search, 100);
    res.json({ users: users.map(publicUser) });
  } catch (err) {
    console.error('Admin get users error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// POST /api/admin/users/:id/ban { reason }
router.post('/users/:id/ban', async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = await updateUser(req.params.id, {
      is_banned: true,
      ban_reason: reason || null
    });
    res.json({ user: publicUser(updated) });
  } catch (err) {
    console.error('Admin ban error:', err);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', async (req, res) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = await updateUser(req.params.id, {
      is_banned: false,
      ban_reason: null
    });
    res.json({ user: publicUser(updated) });
  } catch (err) {
    console.error('Admin unban error:', err);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

// POST /api/admin/users/:id/verify
router.post('/users/:id/verify', async (req, res) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = await updateUser(req.params.id, { is_verified: true });
    res.json({ user: publicUser(updated) });
  } catch (err) {
    console.error('Admin verify error:', err);
    res.status(500).json({ error: 'Failed to verify user' });
  }
});

// POST /api/admin/users/:id/unverify
router.post('/users/:id/unverify', async (req, res) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = await updateUser(req.params.id, { is_verified: false });
    res.json({ user: publicUser(updated) });
  } catch (err) {
    console.error('Admin unverify error:', err);
    res.status(500).json({ error: 'Failed to unverify user' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
