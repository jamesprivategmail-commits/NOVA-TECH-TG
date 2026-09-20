const express = require('express');
const crypto = require('crypto');
const {
  createCallSession,
  getCallSession,
  updateCallSessionState,
  getCallHistory,
  getConversationById
} = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/calls/history/:conversationId
router.get('/history/:conversationId', async (req, res) => {
  try {
    const conv = await getConversationById(req.params.conversationId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!(conv.member_ids || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    const calls = await getCallHistory(req.params.conversationId);
    res.json({ calls });
  } catch (err) {
    console.error('Call history error:', err);
    res.status(500).json({ error: 'Failed to load call history' });
  }
});

// POST /api/calls { conversationId, kind }
router.post('/', async (req, res) => {
  try {
    const { conversationId, kind } = req.body;
    if (!conversationId || !['voice', 'video'].includes(kind)) {
      return res.status(400).json({ error: 'conversationId and kind are required' });
    }

    const conv = await getConversationById(conversationId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!(conv.member_ids || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    const targetUserId = (conv.member_ids || []).find(id => String(id) !== String(req.user.id)) || null;
    const call = await createCallSession({
      id: crypto.randomUUID(),
      conversationId,
      initiatorId: req.user.id,
      targetUserId,
      kind
    });

    res.status(201).json({ call });
  } catch (err) {
    console.error('Start call error:', err);
    res.status(500).json({ error: 'Failed to start call' });
  }
});

// PATCH /api/calls/:id { state }
router.patch('/:id', async (req, res) => {
  try {
    const call = await getCallSession(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    const conv = await getConversationById(call.conversation_id);
    if (!conv || !(conv.member_ids || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'Not a member of this call' });
    }

    const allowed = ['ringing', 'accepted', 'declined', 'ended', 'missed', 'busy', 'reconnecting'];
    if (!allowed.includes(req.body.state)) {
      return res.status(400).json({ error: 'Invalid call state' });
    }

    const updated = await updateCallSessionState(req.params.id, req.body.state);
    res.json({ call: updated });
  } catch (err) {
    console.error('Update call error:', err);
    res.status(500).json({ error: 'Failed to update call' });
  }
});

module.exports = router;
