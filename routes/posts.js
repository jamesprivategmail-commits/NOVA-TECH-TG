const express = require('express');
const {
  getPosts,
  getPostDetails,
  createPost,
  deletePost,
  togglePostLike,
  togglePostRepost,
  togglePostBookmark,
  getPostComments,
  addPostComment,
  uploadToStorage
} = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');
const { isAdminNovaId } = require('../middleware/admin');

const router = express.Router();
router.use(requireAuth);

// GET /api/posts - feed, newest first. Supports ?feed=for-you (default) or ?feed=following
router.get('/', async (req, res) => {
  try {
    const feedType = String(req.query.feed || 'for-you').toLowerCase();
    const posts = await getPosts(req.user.id, 60, feedType);
    res.json({ posts });
  } catch (err) {
    console.error('Get posts error:', err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// GET /api/posts/:id - single post detail with author and quote
router.get('/:id', async (req, res) => {
  try {
    const post = await getPostDetails(req.params.id, req.user.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ post });
  } catch (err) {
    console.error('Get post details error:', err);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

// POST /api/posts { caption, imageData, imageMime, media, quotePostId }
router.post('/', async (req, res) => {
  try {
    const { caption, imageData, imageMime, media, quotePostId } = req.body;
    const mediaItems = [];

    // Process multiple media array (up to 4 items)
    if (Array.isArray(media) && media.length > 0) {
      for (let i = 0; i < Math.min(media.length, 4); i++) {
        const item = media[i];
        if (!item || !item.data) continue;
        let detectedMime = item.mime || 'image/jpeg';
        if (typeof item.data === 'string' && item.data.startsWith('data:')) {
          const match = item.data.match(/^data:([^;]+)/);
          if (match) detectedMime = match[1];
        }
        if (!/^(image|video)\//.test(detectedMime)) continue;
        const ext = (detectedMime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
        const uploaded = await uploadToStorage({
          data: item.data,
          mimeType: detectedMime,
          filename: `post_${req.user.id}_${Date.now()}_${i}.${ext || 'bin'}`,
          userId: req.user.id
        });
        mediaItems.push({
          url: `/api/storage/files/${uploaded.fileId}`,
          mime: uploaded.mimeType,
          type: detectedMime.startsWith('video/') ? 'video' : 'image'
        });
      }
    } else if (imageData) {
      // Single legacy image/video
      let detectedMime = imageMime || 'image/jpeg';
      if (typeof imageData === 'string' && imageData.startsWith('data:')) {
        const match = imageData.match(/^data:([^;]+)/);
        if (match) detectedMime = match[1];
      }
      if (!/^(image|video)\//.test(detectedMime)) {
        return res.status(400).json({ error: 'Updates support image and video files only' });
      }
      const ext = (detectedMime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
      const uploaded = await uploadToStorage({
        data: imageData,
        mimeType: detectedMime,
        filename: `post_${req.user.id}_${Date.now()}.${ext || 'bin'}`,
        userId: req.user.id
      });
      mediaItems.push({
        url: `/api/storage/files/${uploaded.fileId}`,
        mime: uploaded.mimeType,
        type: detectedMime.startsWith('video/') ? 'video' : 'image'
      });
    }

    if ((!caption || !caption.trim()) && mediaItems.length === 0 && !quotePostId) {
      return res.status(400).json({ error: 'Add some text, media or a quote to your post' });
    }

    const post = await createPost({
      userId: req.user.id,
      caption: caption ? caption.trim().slice(0, 500) : '',
      imageUrl: mediaItems[0]?.url || null,
      imageMime: mediaItems[0]?.mime || null,
      mediaItems,
      quotePostId: quotePostId || null
    });

    res.json({ post });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// DELETE /api/posts/:id - only your own post or admin
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
    const result = await togglePostLike(req.params.id, req.user.id);
    if (!result) return res.status(404).json({ error: 'Post not found' });
    res.json(result);
  } catch (err) {
    console.error('Like post error:', err);
    res.status(500).json({ error: 'Failed to like post' });
  }
});

// POST /api/posts/:id/repost (toggle)
router.post('/:id/repost', async (req, res) => {
  try {
    const result = await togglePostRepost(req.params.id, req.user.id);
    if (!result) return res.status(404).json({ error: 'Post not found' });
    res.json(result);
  } catch (err) {
    console.error('Repost error:', err);
    res.status(500).json({ error: 'Failed to repost' });
  }
});

// POST /api/posts/:id/bookmark (toggle)
router.post('/:id/bookmark', async (req, res) => {
  try {
    const result = await togglePostBookmark(req.params.id, req.user.id);
    if (!result) return res.status(404).json({ error: 'Post not found' });
    res.json(result);
  } catch (err) {
    console.error('Bookmark error:', err);
    res.status(500).json({ error: 'Failed to bookmark post' });
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
    if (!content || !content.trim()) return res.status(400).json({ error: 'Reply cannot be empty' });

    const comment = await addPostComment(req.params.id, {
      userId: req.user.id,
      content: content.trim()
    });

    res.json({ comment });
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ error: 'Failed to post reply' });
  }
});

module.exports = router;
