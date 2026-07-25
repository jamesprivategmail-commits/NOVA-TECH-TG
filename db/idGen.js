const db = require('./index');

const AVATAR_COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2', '#64D2FF', '#FF375F', '#5E5CE6'];

function randomAvatarColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

async function generateNovaId() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const digits = Math.floor(100000 + Math.random() * 900000); // 6 digits
    const candidate = `NOVA-${digits}`;
    const { rows } = await db.query('SELECT 1 FROM users WHERE nova_id = $1', [candidate]);
    if (rows.length === 0) return candidate;
  }
  throw new Error('Could not generate a unique NOVA ID, try again');
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = { generateNovaId, generateInviteCode, randomAvatarColor };