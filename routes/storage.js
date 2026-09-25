const express = require('express');
const { uploadToStorage, getStorageFile } = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Bug #7 fix: server-side size/type enforcement for uploads (additive only —
// anything that already passed these checks before still uploads exactly as before).
// Client composers (chat.js, posts.js) already cap uploads at 50MB, so the server
// ceiling is set a little above that — a safety net against abuse, not a tighter limit
// than what already works today.
const MAX_BYTES = {
  image: 60 * 1024 * 1024,
  video: 120 * 1024 * 1024,
  audio: 60 * 1024 * 1024,
  document: 60 * 1024 * 1024,
  default: 60 * 1024 * 1024
};
// Broad allow-by-category (matches what the composer already sends: image/video/audio/file),
// with a small blocklist for executable content. This is a safety net, not a format restriction —
// keep it permissive so existing post/video/file uploads keep working exactly as before.
const ALLOWED_TOP_LEVEL = ['image/', 'video/', 'audio/', 'application/', 'text/'];
const BLOCKED_MIME_EXACT = ['application/x-msdownload', 'application/x-sh', 'application/x-executable', 'application/vnd.microsoft.portable-executable'];

function categoryForMime(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

function base64ByteLength(data) {
  const commaIdx = data.indexOf(',');
  const raw = commaIdx !== -1 && data.slice(0, commaIdx).includes('base64') ? data.slice(commaIdx + 1) : data;
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  return Math.floor((raw.length * 3) / 4) - padding;
}

function safeExtensionFromFilename(filename, mimeType) {
  const fromName = /\.([a-zA-Z0-9]{1,8})$/.exec(String(filename || ''));
  if (fromName) return fromName[1].toLowerCase();
  const fromMime = /\/([a-zA-Z0-9.+-]+)$/.exec(mimeType || '');
  return fromMime ? fromMime[1].toLowerCase().replace('+xml', '') : 'bin';
}

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
    const { data, filename } = req.body;
    const mimeType = req.body.mimeType || 'image/jpeg';
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'No data provided' });
    }
    if (!ALLOWED_TOP_LEVEL.some((prefix) => mimeType.startsWith(prefix)) || BLOCKED_MIME_EXACT.includes(mimeType.toLowerCase())) {
      return res.status(415).json({ error: `File type ${mimeType} is not allowed` });
    }

    let byteLength;
    try {
      byteLength = base64ByteLength(data);
    } catch {
      return res.status(400).json({ error: 'Malformed file data' });
    }
    if (!byteLength || byteLength <= 0) {
      return res.status(400).json({ error: 'Malformed file data' });
    }
    const category = categoryForMime(mimeType);
    const limit = MAX_BYTES[category] || MAX_BYTES.default;
    if (byteLength > limit) {
      return res.status(413).json({ error: `${category} uploads are limited to ${Math.round(limit / (1024 * 1024))}MB` });
    }

    const ext = safeExtensionFromFilename(filename, mimeType);
    const safeFilename = filename ? String(filename).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 150) : `upload.${ext}`;

    const uploaded = await uploadToStorage({
      data,
      mimeType,
      filename: safeFilename,
      userId: req.user.id
    });

    res.json(uploaded);
  } catch (err) {
    console.error('Storage upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
