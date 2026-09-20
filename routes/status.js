const express = require('express');
const {
  createStatus,
  getActiveStatuses,
  markStatusViewed,
  deleteStatus,
  adminDeleteStatus,
  getStatusViewers
} = require('../db/firebase');
const { uploadToStorage } = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');
const { isAdminNovaId } = require('../middleware/admin');

const router = express.Router();
router.use(requireAuth);

// POST /api/status { content, bgColor }
router.post('/', async (req, res) => {
  try {
    const { content, bgColor, mediaData, mediaMime, mediaType } = req.body || {};
    if ((!content || !content.trim()) && !mediaData) return res.status(400).json({ error: 'Status text or media is required' });
    let mediaUrl = null;
    if (mediaData) {
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
      mediaType: mediaType || null,
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

// DELETE /api/status/:id - own status or admin
router.delete('/:id', async (req, res) => {
  try {
    const ok = await deleteStatus(req.params.id, req.user.id);
    if (ok) return res.json({ ok: true });
    // Admin can delete any status
    if (isAdminNovaId(req.user.novaId)) {
      const adminOk = await adminDeleteStatus(req.params.id);
      if (adminOk) return res.json({ ok: true });
    }
    return res.status(404).json({ error: 'Status not found or unauthorized' });
  } catch (err) {
    console.error('Delete status error:', err);
    res.status(500).json({ error: 'Failed to delete status' });
  }
});

// GET /api/status/:id/viewers - for status owner to see who viewed
router.get('/:id/viewers', async (req, res) => {
  try {
    const viewers = await getStatusViewers(req.params.id);
    res.json({ viewers });
  } catch (err) {
    console.error('Get status viewers error:', err);
    res.status(500).json({ error: 'Failed to load viewers' });
  }
});

module.exports = router;
