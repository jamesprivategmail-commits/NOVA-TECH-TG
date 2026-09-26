const jwt = require('jsonwebtoken');
const {
  getUserById,
  updateUser,
  getConversationById,
  getConversationsForUser,
  createMessage,
  getDarkBotCommandReply,
  getDarkPairMenu,
  getDarkPairReply,
  uploadToStorage,
  markConversationRead,
  createNotification,
  getCallSession,
  updateCallSessionState,
  joinCallParticipant,
  leaveCallParticipant
} = require('../db/firebase');
const { roleFor, hasPermission } = require('../db/conversationPermissions');

const JWT_SECRET = process.env.JWT_SECRET || 'darkchat-firebase-jwt-secret-2026';

function initSockets(io) {
  const onlineSockets = new Map();
  // Active group call rooms: callId -> { conversationId, callId, kind, participants: Map<userId, participantData> }
  const activeCallRooms = new Map();
  // User -> Set of callIds they are currently in
  const userCallRooms = new Map();

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

    // ==========================================
    // 1-TO-1 CALL SIGNALING & EVENTS
    // ==========================================
    socket.on('call:invite', async ({ targetUserId, call }) => {
      if (!targetUserId || !call) return;
      io.to(`user:${targetUserId}`).emit('call:incoming', { call, fromUserId: userId });

      // In-app notification for incoming call
      try {
        const callerInfo = await getUserById(userId);
        const notification = await createNotification({
          userId: targetUserId,
          actorId: userId,
          type: 'call',
          payload: {
            callId: call.id,
            kind: call.kind || 'voice',
            conversationId: call.conversation_id
          }
        });
        io.to(`user:${targetUserId}`).emit('notification:new', {
          ...notification,
          actor_name: callerInfo?.display_name || 'Someone'
        });
      } catch (err) {
        // ignore notification error
      }
    });

    socket.on('call:signal', ({ targetUserId, callId, signal }) => {
      if (targetUserId && callId && signal) {
        io.to(`user:${targetUserId}`).emit('call:signal', { callId, signal, fromUserId: userId });
      }
    });

    socket.on('call:state', async ({ targetUserId, callId, state }) => {
      if (!callId || !state) return;
      if (targetUserId) {
        io.to(`user:${targetUserId}`).emit('call:state', { callId, state, fromUserId: userId });
      }
      try {
        await updateCallSessionState(callId, state);
      } catch (err) {
        console.error('Update call session state error:', err);
      }
    });

    // ==========================================
    // GROUP CALL SIGNALING & ROOM MANAGEMENT
    // ==========================================
    socket.on('call:group:start', async ({ conversationId, call }) => {
      if (!conversationId || !call) return;
      try {
        const conv = await getConversationById(conversationId);
        if (!conv) return;

        // Join room
        socket.join(`call:room:${call.id}`);
        if (!userCallRooms.has(userId)) userCallRooms.set(userId, new Set());
        userCallRooms.get(userId).add(call.id);

        const callerInfo = await getUserById(userId);
        const participant = {
          userId,
          displayName: callerInfo?.display_name || 'Participant',
          avatarUrl: callerInfo?.avatar_url || null,
          avatarColor: callerInfo?.avatar_color || '#0A84FF',
          muted: false,
          cameraOff: call.kind !== 'video',
          joinedAt: new Date().toISOString()
        };

        if (!activeCallRooms.has(call.id)) {
          const pMap = new Map();
          pMap.set(userId, participant);
          activeCallRooms.set(call.id, {
            conversationId,
            callId: call.id,
            kind: call.kind,
            participants: pMap
          });
        }

        // Broadcast incoming group call to all members of conversation
        const recipients = (conv.member_ids || []).filter((id) => String(id) !== String(userId));
        for (const memberId of recipients) {
          io.to(`user:${memberId}`).emit('call:group:incoming', {
            call,
            fromUserId: userId,
            conversationId,
            caller: participant
          });
        }

        // Notify conversation room about active group call
        io.to(`conv:${conversationId}`).emit('call:group:active-updated', {
          callId: call.id,
          conversationId,
          active: true,
          count: 1,
          kind: call.kind,
          participants: [participant]
        });
      } catch (err) {
        console.error('call:group:start error:', err);
      }
    });

    socket.on('call:group:join', async ({ conversationId, callId, kind, mediaState }, ack) => {
      if (!callId) return ack?.({ error: 'Missing callId' });
      try {
        socket.join(`call:room:${callId}`);
        if (!userCallRooms.has(userId)) userCallRooms.set(userId, new Set());
        userCallRooms.get(userId).add(callId);

        const userInfo = await getUserById(userId);
        const participant = {
          userId,
          displayName: userInfo?.display_name || 'Participant',
          avatarUrl: userInfo?.avatar_url || null,
          avatarColor: userInfo?.avatar_color || '#0A84FF',
          muted: Boolean(mediaState?.muted),
          cameraOff: mediaState?.cameraOff !== undefined ? Boolean(mediaState.cameraOff) : (kind !== 'video'),
          joinedAt: new Date().toISOString()
        };

        let room = activeCallRooms.get(callId);
        if (!room) {
          room = {
            conversationId: conversationId || null,
            callId,
            kind: kind || 'video',
            participants: new Map()
          };
          activeCallRooms.set(callId, room);
        }
        room.participants.set(userId, participant);

        // Update database
        await joinCallParticipant(callId, participant).catch(() => {});

        // Broadcast to existing room members that new user joined
        socket.to(`call:room:${callId}`).emit('call:group:user-joined', {
          callId,
          user: participant
        });

        // Broadcast updated participant count to conversation
        const targetConvId = conversationId || room.conversationId;
        if (targetConvId) {
          io.to(`conv:${targetConvId}`).emit('call:group:active-updated', {
            callId,
            conversationId: targetConvId,
            active: true,
            count: room.participants.size,
            kind: room.kind,
            participants: Array.from(room.participants.values())
          });
        }

        const otherParticipants = Array.from(room.participants.values()).filter((p) => p.userId !== userId);
        ack?.({
          ok: true,
          callId,
          participants: otherParticipants
        });
      } catch (err) {
        console.error('call:group:join error:', err);
        ack?.({ error: err.message || 'Failed to join group call' });
      }
    });

    socket.on('call:group:signal', ({ callId, targetUserId, signal }) => {
      if (!callId || !targetUserId || !signal) return;
      io.to(`user:${targetUserId}`).emit('call:group:signal', {
        callId,
        fromUserId: userId,
        signal
      });
    });

    socket.on('call:group:media-state', ({ callId, muted, cameraOff }) => {
      if (!callId) return;
      const room = activeCallRooms.get(callId);
      if (room && room.participants.has(userId)) {
        const p = room.participants.get(userId);
        if (muted !== undefined) p.muted = Boolean(muted);
        if (cameraOff !== undefined) p.cameraOff = Boolean(cameraOff);
      }
      socket.to(`call:room:${callId}`).emit('call:group:media-state', {
        callId,
        userId,
        muted,
        cameraOff
      });
    });

    socket.on('call:group:leave', async ({ callId, conversationId }) => {
      if (!callId) return;
      try {
        socket.leave(`call:room:${callId}`);
        if (userCallRooms.has(userId)) userCallRooms.get(userId).delete(callId);

        const room = activeCallRooms.get(callId);
        if (room) {
          room.participants.delete(userId);
          socket.to(`call:room:${callId}`).emit('call:group:user-left', { callId, userId });

          const targetConvId = conversationId || room.conversationId;
          if (room.participants.size === 0) {
            activeCallRooms.delete(callId);
            await updateCallSessionState(callId, 'ended').catch(() => {});
            if (targetConvId) {
              io.to(`conv:${targetConvId}`).emit('call:group:ended', { callId, conversationId: targetConvId });
            }
          } else {
            await leaveCallParticipant(callId, userId).catch(() => {});
            if (targetConvId) {
              io.to(`conv:${targetConvId}`).emit('call:group:active-updated', {
                callId,
                conversationId: targetConvId,
                active: true,
                count: room.participants.size,
                kind: room.kind,
                participants: Array.from(room.participants.values())
              });
            }
          }
        }
      } catch (err) {
        console.error('call:group:leave error:', err);
      }
    });

    socket.on('call:group:end', async ({ callId, conversationId }) => {
      if (!callId) return;
      try {
        const room = activeCallRooms.get(callId);
        const targetConvId = conversationId || room?.conversationId;
        activeCallRooms.delete(callId);
        await updateCallSessionState(callId, 'ended').catch(() => {});
        io.to(`call:room:${callId}`).emit('call:group:ended', { callId, conversationId: targetConvId });
        if (targetConvId) {
          io.to(`conv:${targetConvId}`).emit('call:group:ended', { callId, conversationId: targetConvId });
        }
      } catch (err) {
        console.error('call:group:end error:', err);
      }
    });

    // content: text message. media: { type: 'image'|'voice', data: base64, mime, duration } optional
    socket.on('message:send', async ({ conversationId, content, media, replyToId, statusReply, clientMessageId }, ack) => {
      try {
        const startedAt = process.hrtime.bigint();
        const hasText = content && content.trim();
        const hasMedia = media && (media.data || media.url) && media.type;
        if (!hasText && !hasMedia) return ack?.({ error: 'Empty message' });

        const conv = await getConversationById(conversationId);
        if (!conv) return ack?.({ error: 'Conversation not found' });
        const senderInfo = await getUserById(userId);

        const isMember = (conv.member_ids || []).includes(userId);
        if (!isMember && conv.type !== 'channel') {
          return ack?.({ error: 'Not a member of this conversation' });
        }
        if ((conv.banned_user_ids || []).includes(String(userId))) return ack?.({ error: 'You are banned from this conversation' });

        if (conv.type === 'dm') {
          const otherId = (conv.member_ids || []).find((id) => String(id) !== String(userId));
          const otherUser = otherId ? await getUserById(otherId) : null;
          if (senderInfo?.blocked_user_ids?.includes(String(otherId)) || otherUser?.blocked_user_ids?.includes(String(userId))) {
            return ack?.({ error: 'Messaging is unavailable because this user is blocked.' });
          }
        }

        const role = conv.members?.[userId]?.role || (conv.owner_id === userId ? 'owner' : null);
        const memberState = conv.members?.[userId] || {};
        if (memberState.muted_until && new Date(memberState.muted_until).getTime() > Date.now()) return ack?.({ error: 'You are muted in this conversation' });
        if (conv.type === 'channel' && conv.is_locked) return ack?.({ error: 'This channel is currently paused by the owner' });
        if (conv.type === 'group' && conv.is_locked && !['owner', 'admin'].includes(role)) return ack?.({ error: 'This group is locked — only admins can send messages' });
        if (hasMedia && conv.type === 'group' && conv.is_locked && conv.locked_permissions?.media !== false && !['owner', 'admin'].includes(role)) return ack?.({ error: 'Media sharing is disabled while this group is locked' });
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
          if (media.url) {
            mediaUrl = String(media.url);
          } else {
            const uploadResult = await uploadToStorage({
              data: media.data,
              mimeType: mediaMime || fallbackMime,
              filename,
              userId
            });
            mediaUrl = uploadResult.url;
            mediaMime = uploadResult.mimeType;
          }
        }

        const permanentId = clientMessageId && !String(clientMessageId).startsWith('temp_') ? String(clientMessageId) : undefined;
        const msg = await createMessage(conversationId, {
          id: permanentId,
          senderId: userId,
          content: hasText ? content.trim().slice(0, 4000) : null,
          mediaType: hasMedia ? media.type : null,
          mediaUrl: mediaUrl,
          mediaData: mediaUrl, // provide URL so existing frontend renders immediately
          mediaMime: mediaMime,
          mediaDuration: media?.duration || null,
          waveform: media?.waveform || null,
          replyToId: replyToId || null,
          statusReply: statusReply || null
        });

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
          waveform: msg.waveform || null,
          reply_to_id: msg.reply_to_id,
          status_reply: msg.status_reply,
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
          assistantReply = getDarkPairMenu();
        } else if (senderInfo?.dark_pair_linked && commandText.startsWith('.')) {
          assistantReply = await getDarkBotCommandReply(content.trim(), userId, conversationId);
          if (assistantReply === null) assistantReply = `Unknown command: ${content.trim()}. Send .menu to see available commands.`;
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
        if (result.messageIds?.length) {
          io.to(`conv:${conversationId}`).emit('messages:read', {
            conversationId,
            messageIds: result.messageIds,
            readAt: result.readAt,
            readerId: userId
          });
          for (const mid of (conv.member_ids || [])) {
            io.to(`user:${mid}`).emit('messages:read', {
              conversationId,
              messageIds: result.messageIds,
              readAt: result.readAt,
              readerId: userId
            });
          }
        }
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
      // Clean up any call rooms the disconnecting user was in
      if (userCallRooms.has(userId)) {
        const callIds = Array.from(userCallRooms.get(userId));
        userCallRooms.delete(userId);
        for (const callId of callIds) {
          const room = activeCallRooms.get(callId);
          if (room) {
            room.participants.delete(userId);
            io.to(`call:room:${callId}`).emit('call:group:user-left', { callId, userId });
            const targetConvId = room.conversationId;
            if (room.participants.size === 0) {
              activeCallRooms.delete(callId);
              updateCallSessionState(callId, 'ended').catch(() => {});
              if (targetConvId) {
                io.to(`conv:${targetConvId}`).emit('call:group:ended', { callId, conversationId: targetConvId });
              }
            } else {
              leaveCallParticipant(callId, userId).catch(() => {});
              if (targetConvId) {
                io.to(`conv:${targetConvId}`).emit('call:group:active-updated', {
                  callId,
                  conversationId: targetConvId,
                  active: true,
                  count: room.participants.size,
                  kind: room.kind,
                  participants: Array.from(room.participants.values())
                });
              }
            }
          }
        }
      }

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
