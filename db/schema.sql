-- NOVA Chat schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nova_id VARCHAR(20) UNIQUE NOT NULL,       -- e.g. NOVA-482913, this is their "number"
  display_name VARCHAR(60) NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_color VARCHAR(7) NOT NULL DEFAULT '#0A84FF',
  bio VARCHAR(160) DEFAULT '',
  avatar_data TEXT,                          -- base64 profile picture (optional)
  avatar_mime VARCHAR(40),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  type VARCHAR(10) NOT NULL CHECK (type IN ('dm', 'group', 'channel')),
  name VARCHAR(80),                          -- null for dms (derived from members)
  avatar_color VARCHAR(7) DEFAULT '#8E8E93',
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  invite_code VARCHAR(12) UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL DEFAULT 'member', -- owner | admin | member
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_read_message_id INTEGER,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT,
  media_type VARCHAR(10),                    -- image | voice | null
  media_data TEXT,                           -- base64 payload
  media_mime VARCHAR(60),
  media_duration INTEGER,                    -- seconds, for voice notes
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS statuses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT,
  bg_color VARCHAR(7) DEFAULT '#0A84FF',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS status_views (
  status_id INTEGER NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
  viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (status_id, viewer_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT,
  image_data TEXT,                           -- base64 image payload (optional)
  image_mime VARCHAR(60),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_statuses_expiry ON statuses(expires_at);