const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getUserByNovaId, getUserStickerPacks, addStickerToPack, uploadToStorage } = require('../db/firebase');
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

// GET /api/profile/stickers — list named packs
router.get('/stickers', async (req, res) => {
  try {
    const packs = await getUserStickerPacks(req.user.id);
    res.json({ packs });
  } catch (err) {
    console.error('List stickers error:', err);
    res.status(500).json({ error: 'Failed to load stickers' });
  }
});

// POST /api/profile/stickers — add sticker to a named pack
// body: { packName, packId?, data, mimeType, type: 'image'|'video' } OR { packName, url, mime, type }
router.post('/stickers', async (req, res) => {
  try {
    const { packName, packId, data, mimeType, type, url, mime } = req.body || {};
    let stickerUrl = url || null;
    let stickerMime = mime || mimeType || 'image/png';
    let stickerType = type || (String(stickerMime).startsWith('video/') ? 'video' : 'image');

    if (!stickerUrl && data) {
      const uploaded = await uploadToStorage({
        data,
        mimeType: stickerMime,
        filename: `sticker_${Date.now()}.${(stickerMime.split('/')[1] || 'png').split(';')[0]}`,
        userId: req.user.id
      });
      stickerUrl = uploaded.url;
      stickerMime = uploaded.mimeType || stickerMime;
    }
    if (!stickerUrl) return res.status(400).json({ error: 'Sticker data or url is required' });

    const result = await addStickerToPack(req.user.id, {
      packId,
      packName: packName || 'My stickers',
      sticker: { url: stickerUrl, mime: stickerMime, type: stickerType }
    });
    res.json(result);
  } catch (err) {
    console.error('Add sticker error:', err);
    res.status(500).json({ error: err.message || 'Failed to save sticker' });
  }
});

module.exports = router;
