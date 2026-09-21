const jwt = require('jsonwebtoken');
const {
  getUserById,
  updateUser,
  getConversationById,
  getConversationsForUser,
  createMessage,
  getDarkPairReply,
  uploadToStorage,
  markConversationRead,
  createNotification
} = require('../db/firebase');

const JWT_SECRET = process.env.JWT_SECRET || 'darkchat-firebase-jwt-secret-2026';

function initSockets(io) {
  const onlineSockets = new Map();

  // Auth middleware for socket connections
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token provided'));
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await getUserById(payload.id);
      if (user?.is_banned) return next(new Error('Account banned'));
      socket.user = payload;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;

    // Join a room for every conversation this user belongs to
    try {
      const convs = await getConversationsForUser(userId);
      convs.forEach((c) => socket.join(`conv:${c.id}`));
    } catch (e) {
      console.error('Socket join rooms error:', e);
    }
    socket.join(`user:${userId}`);

    onlineSockets.set(userId, (onlineSockets.get(userId) || 0) + 1);
    io.emit('presence', { userId, online: true, connections: onlineSockets.get(userId) });

    socket.on('call:invite', ({ targetUserId, call }) => {
      if (targetUserId) io.to(`user:${targetUserId}`).emit('call:incoming', { call, fromUserId: userId });
    });

    socket.on('call:signal', ({ targetUserId, callId, signal }) => {
      if (targetUserId && callId && signal) io.to(`user:${targetUserId}`).emit('call:signal', { callId, signal, fromUserId: userId });
    });

    socket.on('call:state', ({ targetUserId, callId, state }) => {
      if (targetUserId && callId && state) io.to(`user:${targetUserId}`).emit('call:state', { callId, state, fromUserId: userId });
    });

    // content: text message. media: { type: 'image'|'voice', data: base64, mime, duration } optional
    socket.on('message:send', async ({ conversationId, content, media, replyToId, clientMessageId }, ack) => {
      try {
        const startedAt = process.hrtime.bigint();
        const hasText = content && content.trim();
        const hasMedia = media && media.data && media.type;
        if (!hasText && !hasMedia) return ack?.({ error: 'Empty message' });

        const conv = await getConversationById(conversationId);
        if (!conv) return ack?.({ error: 'Conversation not found' });

        const isMember = (conv.member_ids || []).includes(userId);
        if (!isMember && conv.type !== 'channel') {
          return ack?.({ error: 'Not a member of this conversation' });
        }

        const role = conv.members?.[userId]?.role || (conv.owner_id === userId ? 'owner' : null);
        // Channels: only owner/admin can post
        if (conv.type === 'channel' && !['owner', 'admin'].includes(role)) {
          return ack?.({ error: 'Only channel admins can post here' });
        }

        let mediaUrl = null;
        let mediaMime = media?.mime || null;
        if (hasMedia) {
          // Upload media to Firebase Storage
          const fallbackMime = media.type === 'voice' ? 'audio/webm' : media.type === 'video' ? 'video/mp4' : media.type === 'audio' ? 'audio/mpeg' : 'application/octet-stream';
          const extension = (media.mime || fallbackMime).split('/')[1]?.split(';')[0] || 'bin';
          const filename = `${media.type || 'file'}_${Date.now()}.${extension}`;
          const uploadResult = await uploadToStorage({
            data: media.data,
            mimeType: mediaMime || fallbackMime,
            filename,
            userId
          });
          mediaUrl = uploadResult.url;
          mediaMime = uploadResult.mimeType;
        }

        const msg = await createMessage(conversationId, {
          id: clientMessageId || undefined,
          senderId: userId,
          content: hasText ? content.trim().slice(0, 4000) : null,
          mediaType: hasMedia ? media.type : null,
          mediaUrl: mediaUrl,
          mediaData: mediaUrl, // provide URL so existing frontend renders immediately
          mediaMime: mediaMime,
          mediaDuration: media?.duration || null,
          replyToId: replyToId || null
        });

        const senderInfo = await getUserById(userId);

        const payload = {
          id: msg.id,
          conversation_id: conversationId,
          sender_id: userId,
          content: msg.content,
          media_type: msg.media_type,
          media_url: mediaUrl,
          media_data: mediaUrl,
          media_mime: msg.media_mime,
          media_duration: msg.media_duration,
          reply_to_id: msg.reply_to_id,
          edited_at: msg.edited_at,
          deleted_for_everyone: msg.deleted_for_everyone,
          created_at: msg.created_at,
          display_name: senderInfo?.display_name || 'User',
          avatar_color: senderInfo?.avatar_color || '#0A84FF',
          avatar_url: senderInfo?.avatar_url || null,
          is_verified: senderInfo?.is_verified || false
        };

        io.to(`conv:${conversationId}`).emit('message:new', payload);
        const isDarkPairConversation = (conv.member_ids || []).includes('u_dark_pair') || String(conversationId).startsWith('dm_dark_pair_');
        const commandText = hasText ? content.trim().toLowerCase() : '';
        let assistantPayload = null;
        let assistantReply = null;
        if (isDarkPairConversation && hasText && (commandText.startsWith('/') || /^\d{6}$/.test(commandText))) {
          assistantReply = await getDarkPairReply(content.trim(), userId);
        } else if (senderInfo?.dark_pair_linked && commandText === '.ping') {
          const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
          assistantReply = [
            '╭━━〔 DARK BOT 〕━━┈⊷',
            '┃ ⚡ *Speed Test Completed!*',
            '┃',
            `┃ 📡 *Latency:* ${latencyMs.toFixed(4)} ms`,
            '┃ 🟢 Status: Stable & Responsive',
            '╰━━━━━━━━━━━━━━'
          ].join('\n');
        } else if (senderInfo?.dark_pair_linked && commandText === '.menu') {
          assistantReply = 'DARK PAIR\n\n.ping — reply with your current latency\n.menu — show this menu';
        }
        if (assistantReply) {
          const assistantMsg = await createMessage(conversationId, {
            senderId: userId,
            content: assistantReply
          });
          assistantPayload = {
            ...assistantMsg,
            display_name: senderInfo?.display_name || 'User',
            avatar_color: senderInfo?.avatar_color || '#0A84FF',
            avatar_url: senderInfo?.avatar_url || null,
            is_verified: senderInfo?.is_verified || false
          };
          io.to(`conv:${conversationId}`).emit('message:new', assistantPayload);
        }
        const recipients = (conv.member_ids || []).filter((id) => String(id) !== String(userId));
        void Promise.allSettled(recipients.map(async (recipientId) => {
          const notification = await createNotification({
            userId: recipientId,
            actorId: userId,
            type: 'message',
            payload: {
              conversationId: String(conversationId),
              messageId: msg.id,
              preview: msg.content || 'Attachment'
            }
          });
          io.to(`user:${recipientId}`).emit('notification:new', {
            ...notification,
            actor_name: senderInfo?.display_name || 'Someone'
          });
        }));
        ack?.({ ok: true, message: payload, assistantMessage: assistantPayload });
      } catch (err) {
        console.error('Send message socket error:', err);
        ack?.({ error: 'Failed to send message' });
      }
    });

    socket.on('conversation:read', async ({ conversationId }) => {
      try {
        const conv = await getConversationById(conversationId);
        if (!conv || (conv.type !== 'channel' && !(conv.member_ids || []).includes(userId))) return;
        const result = await markConversationRead(conversationId, userId);
        if (result.messageIds.length) io.to(`conv:${conversationId}`).emit('messages:read', {
          conversationId,
          messageIds: result.messageIds,
          readAt: result.readAt,
          readerId: userId
        });
      } catch (err) {
        console.error('Mark messages read socket error:', err);
      }
    });

    socket.on('typing', ({ conversationId, isTyping }) => {
      socket.to(`conv:${conversationId}`).emit('typing', { conversationId, userId, isTyping });
    });

    socket.on('conversation:join', async ({ conversationId }) => {
      const conv = await getConversationById(conversationId);
      if (conv && ((conv.member_ids || []).includes(userId) || conv.type === 'channel')) {
        socket.join(`conv:${conversationId}`);
      }
    });

    socket.on('disconnect', async () => {
      try {
        await updateUser(userId, { last_seen: new Date().toISOString() });
      } catch (e) {
        // ignore
      }
      const remaining = Math.max(0, (onlineSockets.get(userId) || 1) - 1);
      if (remaining) onlineSockets.set(userId, remaining);
      else onlineSockets.delete(userId);
      io.emit('presence', { userId, online: remaining > 0, connections: remaining });
    });
  });
}

module.exports = { initSockets };
