const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getUserByNovaId, getUserById, getUserStickerPacks, addStickerToPack, uploadToStorage, getConversationsForUser, getPosts, getActiveStatuses } = require('../db/firebase');
const { updateProfileSettings, getProfileSettings, blockUser, unblockUser, changePassword, deleteUserAccount, toggleStarredMessage } = require('../db/profile');

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

router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    await changePassword(req.user.id, currentPassword, newPassword);
    res.json({ ok: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to change password' });
  }
});

router.post('/delete-account', async (req, res) => {
  try {
    const { password } = req.body || {};
    await deleteUserAccount(req.user.id, password);
    res.json({ ok: true, message: 'Account deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to delete account' });
  }
});

router.post('/starred/:messageId', async (req, res) => {
  try {
    const updated = await toggleStarredMessage(req.user.id, req.params.messageId);
    res.json({ ok: true, starredMessageIds: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update starred message' });
  }
});

router.get('/backup', async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    const convs = await getConversationsForUser(req.user.id);
    const posts = await getPosts(req.user.id);
    const settings = await getProfileSettings(req.user.id);
    const backupData = {
      exportDate: new Date().toISOString(),
      app: 'DARK CHAT',
      version: '2.4.0',
      user: {
        id: user.id,
        novaId: user.nova_id,
        displayName: user.display_name,
        bio: user.bio,
        isVerified: user.is_verified,
        createdAt: user.created_at
      },
      settings,
      conversationsSummary: convs.map(c => ({ id: c.id, type: c.type, name: c.name, lastMessageAt: c.last_message_at })),
      postsCount: posts.length
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="darkchat_backup_${user.nova_id}.json"`);
    res.json(backupData);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate account backup' });
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
