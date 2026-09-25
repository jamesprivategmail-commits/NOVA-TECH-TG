const express = require('express');
const {
  getPosts,
  createPost,
  deletePost,
  togglePostLike,
  getPostComments,
  addPostComment,
  uploadToStorage
} = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');
const { isAdminNovaId } = require('../middleware/admin');

const router = express.Router();
router.use(requireAuth);

// GET /api/posts - feed, newest first
router.get('/', async (req, res) => {
  try {
    const posts = await getPosts(req.user.id);
    res.json({ posts });
  } catch (err) {
    console.error('Get posts error:', err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// POST /api/posts { caption, imageData, imageMime }
router.post('/', async (req, res) => {
  try {
    const { caption, imageData, imageMime } = req.body;
    if ((!caption || !caption.trim()) && !imageData) {
      return res.status(400).json({ error: 'Add a caption or an image' });
    }

    let imageUrl = null;
    let detectedMime = imageMime || 'image/jpeg';
    if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
      const match = imageData.match(/^data:([^;]+)/);
      if (match) detectedMime = match[1];
    }
    if (imageData && !/^(image|video)\//.test(detectedMime)) {
      return res.status(400).json({ error: 'Updates support image and video files only' });
    }
    if (imageData) {
      const ext = (detectedMime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
      const uploaded = await uploadToStorage({
        data: imageData,
        mimeType: detectedMime,
        filename: `post_${req.user.id}_${Date.now()}.${ext || 'bin'}`,
        userId: req.user.id
      });
      imageUrl = `/api/storage/files/${uploaded.fileId}`;
      detectedMime = uploaded.mimeType;
    }

    const post = await createPost({
      userId: req.user.id,
      caption: caption ? caption.trim().slice(0, 500) : '',
      imageUrl,
      imageMime: detectedMime
    });

    res.json({ post });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// DELETE /api/posts/:id - only your own post
router.delete('/:id', async (req, res) => {
  try {
    const ok = await deletePost(req.params.id, req.user.id, isAdminNovaId(req.user.novaId));
    if (!ok) return res.status(404).json({ error: 'Post not found or unauthorized' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete post error:', err);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// POST /api/posts/:id/like (toggle)
router.post('/:id/like', async (req, res) => {
  try {
    const liked = await togglePostLike(req.params.id, req.user.id);
    res.json({ liked });
  } catch (err) {
    console.error('Like post error:', err);
    res.status(500).json({ error: 'Failed to like post' });
  }
});

// GET /api/posts/:id/comments
router.get('/:id/comments', async (req, res) => {
  try {
    const comments = await getPostComments(req.params.id);
    res.json({ comments });
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

// POST /api/posts/:id/comments { content }
router.post('/:id/comments', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

    const comment = await addPostComment(req.params.id, {
      userId: req.user.id,
      content: content.trim()
    });

    res.json({ comment });
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

module.exports = router;
