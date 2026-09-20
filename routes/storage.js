const express = require('express');
const { uploadToStorage, getStorageFile } = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/storage/files/:fileId - serve file from Firebase storage
router.get('/files/:fileId', async (req, res) => {
  try {
    const file = await getStorageFile(req.params.fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', file.size || file.buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (file.filename) {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    }

    return res.end(file.buffer);
  } catch (err) {
    console.error('Storage get error:', err);
    res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

// POST /api/storage/upload { data, mimeType, filename }
router.post('/upload', requireAuth, async (req, res) => {
  try {
    const { data, mimeType, filename } = req.body;
    if (!data) {
      return res.status(400).json({ error: 'No data provided' });
    }

    const uploaded = await uploadToStorage({
      data,
      mimeType: mimeType || 'image/jpeg',
      filename: filename || 'upload',
      userId: req.user.id
    });

    res.json(uploaded);
  } catch (err) {
    console.error('Storage upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
