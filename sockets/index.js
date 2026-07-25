const jwt = require('jsonwebtoken');
const db = require('../db');

function initSockets(io) {
  // Auth middleware for socket connections
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token provided'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const { rows } = await db.query('SELECT is_banned FROM users WHERE id = $1', [payload.id]);
      if (rows[0]?.is_banned) return next(new Error('Account banned'));
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

    // content: text message. media: { type: 'image'|'voice', data: base64, mime, duration } optional
    socket.on('message:send', async ({ conversationId, content, media }, ack) => {
      try {
        const hasText = content && content.trim();
        const hasMedia = media && media.data && media.type;
        if (!hasText && !hasMedia) return ack?.({ error: 'Empty message' });

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
          `INSERT INTO messages (conversation_id, sender_id, content, media_type, media_data, media_mime, media_duration)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            conversationId,
            userId,
            hasText ? content.trim().slice(0, 4000) : null,
            hasMedia ? media.type : null,
            hasMedia ? media.data : null,
            hasMedia ? (media.mime || null) : null,
            hasMedia ? (media.duration || null) : null
          ]
        );
        const msg = rows[0];
        const senderInfo = await db.query('SELECT display_name, avatar_color, is_verified FROM users WHERE id=$1', [userId]);

        const payload = {
          id: msg.id,
          conversation_id: conversationId,
          sender_id: userId,
          content: msg.content,
          media_type: msg.media_type,
          media_data: msg.media_data,
          media_mime: msg.media_mime,
          media_duration: msg.media_duration,
          created_at: msg.created_at,
          display_name: senderInfo.rows[0].display_name,
          avatar_color: senderInfo.rows[0].avatar_color,
          is_verified: senderInfo.rows[0].is_verified
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