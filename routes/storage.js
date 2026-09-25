const express = require('express');
const { uploadToStorage, getStorageFile } = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET & HEAD /api/storage/files/:fileId - serve file from Firebase storage with Range streaming for video/audio
router.all('/files/:fileId', async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const file = await getStorageFile(req.params.fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const buffer = file.buffer || (file.data ? Buffer.from(file.data, 'base64') : Buffer.alloc(0));
    const mimeType = file.mimeType || 'application/octet-stream';
    const totalSize = buffer.length || file.size || 0;
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (file.filename) {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    }

    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', totalSize);
      return res.end();
    }

    if (range && totalSize > 0) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

      if (start >= totalSize || end >= totalSize || start > end) {
        res.setHeader('Content-Range', `bytes */${totalSize}`);
        return res.status(416).end();
      }

      const chunkLength = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      res.setHeader('Content-Length', chunkLength);
      res.setHeader('Content-Type', mimeType);

      return res.end(buffer.subarray(start, end + 1));
    } else {
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', totalSize);
      return res.end(buffer);
    }
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
