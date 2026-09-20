require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const { ensureInit } = require('./db/firebase');
const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversations');
const statusRoutes = require('./routes/status');
const postRoutes = require('./routes/posts');
const notificationRoutes = require('./routes/notifications');
const callRoutes = require('./routes/calls');
const adminRoutes = require('./routes/admin');
const storageRoutes = require('./routes/storage');
const profileRoutes = require('./routes/profile');
const discoverRoutes = require('./routes/discover');
const telegramRoutes = require('./routes/telegram');
const { initSockets } = require('./sockets');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'darkchat-firebase-jwt-secret-2026';
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e8 // 100MB for media files
});

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Firebase Storage route
app.use('/api/storage', storageRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/discover', discoverRoutes);
app.use('/api/telegram', telegramRoutes);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'DARK CHAT', backend: 'firebase' }));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initSockets(io);

// Initialize Firebase before accepting traffic
ensureInit()
  .then(() => {
    server.listen(3000, '0.0.0.0', () => {
      console.log('🚀 DARK CHAT running on http://0.0.0.0:3000 powered by Firebase');
    });
  })
  .catch((err) => {
    console.error('Failed to initialize Firebase on boot:', err);
    // Still start server so developer can see diagnostics
    server.listen(3000, '0.0.0.0', () => {
      console.log('🚀 DARK CHAT running on http://0.0.0.0:3000 (starting...)');
    });
  });
