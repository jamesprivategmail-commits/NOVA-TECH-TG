const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getUserByNovaId } = require('../db/firebase');
const { updateProfileSettings, getProfileSettings, blockUser, unblockUser } = require('../db/profile');

const router = express.Router();
router.use(requireAuth);

router.get('/settings', async (req, res) => {
  try {
    const settings = await getProfileSettings(req.user.id);
    if (!settings) return res.status(404).json({ error: 'Profile not found' });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile settings' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const settings = await updateProfileSettings(req.user.id, req.body || {});
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save profile settings' });
  }
});

router.post('/block', async (req, res) => {
  try {
    const target = await getUserByNovaId(String(req.body?.novaId || '').trim().toUpperCase());
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!(await blockUser(req.user.id, target.id))) return res.status(400).json({ error: 'Unable to block user' });
    res.json({ ok: true, blockedUserId: target.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to block user' });
  }
});

router.post('/unblock', async (req, res) => {
  try {
    await unblockUser(req.user.id, String(req.body?.userId || ''));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

module.exports = router;
