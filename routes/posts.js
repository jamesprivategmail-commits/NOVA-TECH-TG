const express = require('express');
const {
  getPosts,
  createPost,
  deletePost,
  adminDeletePost,
  togglePostLike,
  getPostComments,
  addPostComment,
  uploadToStorage
} = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');

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
    if (imageData) {
      // Upload image to Firebase Storage
      const uploaded = await uploadToStorage({
        data: imageData,
        mimeType: detectedMime,
        filename: `post_${req.user.id}_${Date.now()}.jpg`,
        userId: req.user.id
      });
      imageUrl = uploaded.url;
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

// DELETE /api/posts/:id - own post or admin
router.delete('/:id', async (req, res) => {
  try {
    // Try own delete first
    const ok = await deletePost(req.params.id, req.user.id);
    if (ok) return res.json({ ok: true });
    // If not owner, check admin
    const { isAdminNovaId } = require('../middleware/admin');
    if (isAdminNovaId(req.user.novaId)) {
      const adminOk = await adminDeletePost(req.params.id);
      if (adminOk) return res.json({ ok: true });
    }
    return res.status(404).json({ error: 'Post not found or unauthorized' });
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
