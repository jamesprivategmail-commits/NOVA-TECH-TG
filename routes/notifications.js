const express = require('express');
const {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead
} = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/notifications
router.get('/', async (req, res) => {
  try {
    const notifications = await getNotifications(req.user.id);
    res.json({ notifications });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const count = await getUnreadNotificationCount(req.user.id);
    res.json({ count });
  } catch (err) {
    console.error('Get unread count error:', err);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// POST /api/notifications/read { id? }
router.post('/read', async (req, res) => {
  try {
    await markNotificationsRead(req.user.id, req.body.id || null);
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

module.exports = router;
