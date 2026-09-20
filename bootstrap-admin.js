require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const ADMIN_ID = '+1-999-234-8321';
const PASSWORD = process.env.NEW_ADMIN_PASSWORD;
if (!PASSWORD) throw new Error('NEW_ADMIN_PASSWORD must be provided at runtime');
(async () => {
  const hash = await bcrypt.hash(PASSWORD, 12);
  const existing = await db.query('SELECT id FROM users WHERE nova_id=$1', [ADMIN_ID]);
  if (existing.rows[0]) {
    await db.query('UPDATE users SET password_hash=$1, is_banned=FALSE, is_verified=TRUE WHERE id=$2', [hash, existing.rows[0].id]);
    console.log('Admin credentials updated');
  } else {
    await db.query('INSERT INTO users (nova_id, display_name, password_hash, avatar_color, is_verified) VALUES ($1,$2,$3,$4,TRUE)', [ADMIN_ID, 'DARK CHAT Admin', hash, '#ff3131']);
    console.log('Admin account created');
  }
  await db.pool.end();
})().catch(async err => { console.error(err.message); await db.pool.end(); process.exit(1); });
