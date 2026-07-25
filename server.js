require('dotenv').config();
const fs = require('fs');
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const db = require('./db');
const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversations');
const statusRoutes = require('./routes/status');
const postRoutes = require('./routes/posts');
const { initSockets } = require('./sockets');

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set. Set it in your environment variables before deploying.');
}

// Auto-create tables on boot if they don't exist yet (safe to run every deploy —
// schema.sql uses CREATE TABLE IF NOT EXISTS, so this never touches existing data).
async function ensureSchema() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await db.query(schema);
    console.log('✅ Database schema is ready.');
  } catch (err) {
    console.error('❌ Failed to set up database schema:', err.message);
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/posts', postRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'NOVA Chat' }));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initSockets(io);

const PORT = process.env.PORT || 3000;
ensureSchema().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 NOVA Chat running on port ${PORT}`);
  });
});