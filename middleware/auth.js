const jwt = require('jsonwebtoken');
const db = require('../db');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, novaId, displayName }

    // Banned accounts lose access immediately, even with a still-valid token.
    const { rows } = await db.query('SELECT is_banned, ban_reason FROM users WHERE id = $1', [payload.id]);
    if (rows[0]?.is_banned) {
      return res.status(403).json({ error: rows[0].ban_reason ? `Account banned: ${rows[0].ban_reason}` : 'Your account has been banned.' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = { requireAuth };