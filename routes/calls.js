const express = require('express');
const crypto = require('crypto');
const {
  createCallSession,
  getCallSession,
  updateCallSessionState,
  joinCallParticipant,
  leaveCallParticipant,
  getActiveCallForConversation,
  getActiveGroupCall,
  getCallHistory,
  getConversationById,
  getUserById
} = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const BASE_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

// GET /api/calls/ice-servers - returns public STUN plus optional server TURN
router.get('/ice-servers', async (_req, res) => {
  const iceServers = [...BASE_ICE_SERVERS];
  if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URLS.split(',').map((url) => url.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  res.json({ iceServers });
});

// GET /api/calls/active/:conversationId
router.get('/active/:conversationId', async (req, res) => {
  try {
    const conv = await getConversationById(req.params.conversationId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!(conv.member_ids || []).includes(req.user.id) && conv.type !== 'channel') {
      return res.status(403).json({ error: 'Not a member of this conversation' });
    }

    const call = await getActiveCallForConversation(req.params.conversationId);
    res.json({ call: call || null });
  } catch (err) {
    console.error('Active call error:', err);
    res.status(500).json({ error: 'Failed to get active call' });
  }
});

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

    const isGroup = conv.type === 'group' || conv.type === 'channel' || (conv.member_ids || []).length > 2;

    // If it's a group conversation and an active group call already exists, join that one
    if (isGroup) {
      const activeCall = await getActiveGroupCall(conversationId);
      if (activeCall) {
        const caller = await getUserById(req.user.id);
        const updated = await joinCallParticipant(activeCall.id, {
          userId: req.user.id,
          displayName: caller?.display_name || req.user.display_name || 'Participant',
          avatarUrl: caller?.avatar_url || null,
          avatarColor: caller?.avatar_color || '#0A84FF',
          joinedAt: new Date().toISOString()
        });
        return res.status(200).json({ call: updated || activeCall, joinedExisting: true });
      }
    }

    const targetUserId = !isGroup
      ? (conv.member_ids || []).find(id => String(id) !== String(req.user.id)) || null
      : null;

    const caller = await getUserById(req.user.id);
    const call = await createCallSession({
      id: crypto.randomUUID(),
      conversationId,
      initiatorId: req.user.id,
      targetUserId,
      kind,
      isGroup,
      participants: [{
        userId: req.user.id,
        displayName: caller?.display_name || req.user.display_name || 'Host',
        avatarUrl: caller?.avatar_url || null,
        avatarColor: caller?.avatar_color || '#0A84FF',
        joinedAt: new Date().toISOString()
      }]
    });

    res.status(201).json({ call });
  } catch (err) {
    console.error('Start call error:', err);
    res.status(500).json({ error: 'Failed to start call' });
  }
});

// POST /api/calls/:id/join
router.post('/:id/join', async (req, res) => {
  try {
    const call = await getCallSession(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    const conv = await getConversationById(call.conversation_id);
    if (!conv || (!(conv.member_ids || []).includes(req.user.id) && conv.type !== 'channel')) {
      return res.status(403).json({ error: 'Not authorized for this call' });
    }

    const caller = await getUserById(req.user.id);
    const updated = await joinCallParticipant(call.id, {
      userId: req.user.id,
      displayName: caller?.display_name || req.user.display_name || 'Participant',
      avatarUrl: caller?.avatar_url || null,
      avatarColor: caller?.avatar_color || '#0A84FF',
      joinedAt: new Date().toISOString()
    });
    res.json({ call: updated });
  } catch (err) {
    console.error('Join call error:', err);
    res.status(500).json({ error: 'Failed to join call' });
  }
});

// POST /api/calls/:id/leave
router.post('/:id/leave', async (req, res) => {
  try {
    const call = await getCallSession(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    const updated = await leaveCallParticipant(call.id, req.user.id);
    res.json({ call: updated });
  } catch (err) {
    console.error('Leave call error:', err);
    res.status(500).json({ error: 'Failed to leave call' });
  }
});

// PATCH /api/calls/:id { state }
router.patch('/:id', async (req, res) => {
  try {
    const call = await getCallSession(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    const conv = await getConversationById(call.conversation_id);
    if (!conv || (!(conv.member_ids || []).includes(req.user.id) && conv.type !== 'channel')) {
      return res.status(403).json({ error: 'Not a member of this call' });
    }

    const allowed = ['ringing', 'accepted', 'declined', 'ended', 'missed', 'busy', 'reconnecting', 'ongoing'];
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
