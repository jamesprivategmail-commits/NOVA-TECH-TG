const { getUserByNovaId } = require('./firebase');

const AVATAR_COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2', '#64D2FF', '#FF375F', '#5E5CE6'];

function randomAvatarColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

async function generateNovaId() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const digits = Math.floor(100000 + Math.random() * 900000); // 6 digits
    const candidate = `+1-626-715-${String(digits).slice(-4)}`;
    try {
      const existing = await getUserByNovaId(candidate);
      if (!existing) return candidate;
    } catch {
      return candidate;
    }
  }
  return `+1-626-715-${Math.floor(1000 + Math.random() * 9000)}`;
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = { generateNovaId, generateInviteCode, randomAvatarColor };