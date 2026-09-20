const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
router.use(requireAuth);
async function member(callId, userId) { const { rows } = await db.query(`SELECT cs.* FROM call_sessions cs JOIN conversation_members cm ON cm.conversation_id=cs.conversation_id WHERE cs.id=$1 AND cm.user_id=$2`, [callId, userId]); return rows[0]; }
router.get('/history/:conversationId', async (req, res) => { const { rows } = await db.query(`SELECT * FROM call_sessions WHERE conversation_id=$1 AND EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2) ORDER BY started_at DESC LIMIT 50`, [req.params.conversationId, req.user.id]); res.json({ calls: rows }); });
router.post('/', async (req, res) => { const { conversationId, kind } = req.body; if (!conversationId || !['voice','video'].includes(kind)) return res.status(400).json({ error:'conversationId and kind are required' }); const { rows } = await db.query(`INSERT INTO call_sessions (id,conversation_id,initiator_id,kind) SELECT $1,$2,$3,$4 WHERE EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id=$2 AND user_id=$3) RETURNING *`, [crypto.randomUUID(), conversationId, req.user.id, kind]); if (!rows[0]) return res.status(403).json({ error:'Not a member of this conversation' }); res.status(201).json({ call: rows[0] }); });
router.patch('/:id', async (req, res) => { const call = await member(req.params.id, req.user.id); if (!call) return res.status(404).json({ error:'Call not found' }); const allowed = ['ringing','accepted','declined','ended','missed','reconnecting']; if (!allowed.includes(req.body.state)) return res.status(400).json({ error:'Invalid call state' }); const { rows } = await db.query('UPDATE call_sessions SET state=$1, ended_at=CASE WHEN $1 IN (\'declined\',\'ended\',\'missed\') THEN NOW() ELSE ended_at END WHERE id=$2 RETURNING *', [req.body.state, req.params.id]); res.json({ call: rows[0] }); });
module.exports = router;
