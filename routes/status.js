const express = require('express');
const {
  createStatus,
  getActiveStatuses,
  markStatusViewed,
  deleteStatus
} = require('../db/firebase');
const { uploadToStorage } = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST /api/status { content, bgColor }
router.post('/', async (req, res) => {
  try {
    const { content, bgColor, mediaData, mediaMime, mediaType } = req.body || {};
    if ((!content || !content.trim()) && !mediaData) return res.status(400).json({ error: 'Status text or photo/video is required' });
    let mediaUrl = null;
    let normalizedMediaType = null;
    if (mediaData) {
      if (!/^(image|video)\//i.test(String(mediaMime || ''))) {
        return res.status(400).json({ error: 'Statuses support image and video files only' });
      }
      normalizedMediaType = String(mediaMime).toLowerCase().startsWith('video/') ? 'video' : 'image';
      const uploaded = await uploadToStorage({
        data: mediaData,
        mimeType: mediaMime || 'image/jpeg',
        filename: `status_${Date.now()}.${(mediaMime || 'image/jpeg').split('/')[1] || 'bin'}`,
        userId: req.user.id
      });
      mediaUrl = uploaded.url;
    }

    const status = await createStatus({
      userId: req.user.id,
      content: String(content || '').trim().slice(0, 300),
      bgColor: bgColor || '#0A84FF',
      mediaUrl,
      mediaType: normalizedMediaType || mediaType || null,
      mediaMime: mediaMime || null
    });

    res.json({ status });
  } catch (err) {
    console.error('Create status error:', err);
    res.status(500).json({ error: 'Failed to post status' });
  }
});

// GET /api/status/feed - active statuses from everyone
router.get('/feed', async (req, res) => {
  try {
    const statuses = await getActiveStatuses(req.user.id);
    res.json({ statuses });
  } catch (err) {
    console.error('Get status feed error:', err);
    res.status(500).json({ error: 'Failed to load status updates' });
  }
});

// POST /api/status/:id/view
router.post('/:id/view', async (req, res) => {
  try {
    await markStatusViewed(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('View status error:', err);
    res.status(500).json({ error: 'Failed to mark viewed' });
  }
});

// DELETE /api/status/:id
router.delete('/:id', async (req, res) => {
  try {
    const ok = await deleteStatus(req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Status not found or unauthorized' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete status error:', err);
    res.status(500).json({ error: 'Failed to delete status' });
  }
});

module.exports = router;
