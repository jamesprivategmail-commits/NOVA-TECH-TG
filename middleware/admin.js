// Owner/admin access is controlled entirely via the ADMIN_NOVA_IDS environment variable.
// Set it in Railway (or your .env) as a comma-separated list of NOVA IDs, e.g.:
//   ADMIN_NOVA_IDS=NOVA-401022
// Anyone whose account has one of these NOVA IDs gets admin powers. No database flag needed.

function getAdminIds() {
  return (process.env.ADMIN_NOVA_IDS || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
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