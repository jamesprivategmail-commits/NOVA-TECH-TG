const jwt = require('jsonwebtoken');
const db = require('../db');

function initSockets(io) {
  // Auth middleware for socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token provided'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;

    // Join a room for every conversation this user belongs to
    const { rows: convs } = await db.query(
      'SELECT conversation_id FROM conversation_members WHERE user_id = $1',
      [userId]
    );
    convs.forEach((c) => socket.join(`conv:${c.conversation_id}`));
    socket.join(`user:${userId}`);

    io.emit('presence', { userId, online: true });

    socket.on('message:send', async ({ conversationId, content }, ack) => {
      try {
        if (!content || !content.trim()) return ack?.({ error: 'Empty message' });

        const member = await db.query(
          'SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',
          [conversationId, userId]
        );
        if (!member.rows[0]) return ack?.({ error: 'Not a member of this conversation' });

        // Channels: only owner/admin can post
        const conv = await db.query('SELECT type FROM conversations WHERE id=$1', [conversationId]);
        if (conv.rows[0]?.type === 'channel' && !['owner', 'admin'].includes(member.rows[0].role)) {
          return ack?.({ error: 'Only channel admins can post here' });
        }

        const { rows } = await db.query(
          `INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *`,
          [conversationId, userId, content.trim().slice(0, 4000)]
        );
        const msg = rows[0];
        const senderInfo = await db.query('SELECT display_name, avatar_color FROM users WHERE id=$1', [userId]);

        const payload = {
          id: msg.id,
          conversation_id: conversationId,
          sender_id: userId,
          content: msg.content,
          created_at: msg.created_at,
          display_name: senderInfo.rows[0].display_name,
          avatar_color: senderInfo.rows[0].avatar_color
        };

        io.to(`conv:${conversationId}`).emit('message:new', payload);
        ack?.({ ok: true, message: payload });
      } catch (err) {
        console.error(err);
        ack?.({ error: 'Failed to send message' });
      }
    });

    socket.on('typing', ({ conversationId, isTyping }) => {
      socket.to(`conv:${conversationId}`).emit('typing', { conversationId, userId, isTyping });
    });

    socket.on('conversation:join', async ({ conversationId }) => {
      const member = await db.query(
        'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',
        [conversationId, userId]
      );
      if (member.rows[0]) socket.join(`conv:${conversationId}`);
    });

    socket.on('disconnect', async () => {
      await db.query('UPDATE users SET last_seen = NOW() WHERE id=$1', [userId]);
      io.emit('presence', { userId, online: false });
    });
  });
}

module.exports = { initSockets };