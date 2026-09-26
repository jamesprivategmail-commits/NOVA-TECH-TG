const jwt = require('jsonwebtoken');
const { getUserById } = require('../db/firebase');

const JWT_SECRET = process.env.JWT_SECRET || 'darkchat-firebase-jwt-secret-2026';

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, novaId, displayName }

    // Banned accounts lose access immediately.
    // If the Firestore read fails (e.g. quota exhausted) we still allow the
    // request through — the JWT itself is valid, and blocking here would
    // silently log users out and make their data look like it was deleted.
    try {
      const user = await getUserById(payload.id);
      if (user?.is_banned) {
        return res.status(403).json({
          error: user.ban_reason ? `Account banned: ${user.ban_reason}` : 'Your account has been banned.'
        });
      }
    } catch (banErr) {
      console.warn('Ban-check read failed, allowing request:', banErr.message);
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = { requireAuth };
