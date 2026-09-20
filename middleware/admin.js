// Owner/admin access is controlled entirely via the ADMIN_NOVA_IDS environment variable.
// Set it in Railway (or your .env) as a comma-separated list of DARK CHAT IDs, e.g.:
//   ADMIN_NOVA_IDS=NOVA-401022
// Anyone whose account has one of these DARK CHAT IDs gets admin powers. No database flag needed.

function getAdminIds() {
  const envIds = (process.env.ADMIN_NOVA_IDS || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  const defaultAdmins = ['+1-999-234-8321'];
  return Array.from(new Set([...envIds, ...defaultAdmins]));
}

function isAdminNovaId(novaId) {
  if (!novaId) return false;
  return getAdminIds().includes(novaId.trim().toUpperCase());
}

function requireAdmin(req, res, next) {
  if (!req.user || !isAdminNovaId(req.user.novaId)) {
    return res.status(403).json({ error: 'Admin access only' });
  }
  next();
}

module.exports = { requireAdmin, isAdminNovaId, getAdminIds };