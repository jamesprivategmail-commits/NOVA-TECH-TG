require('dotenv').config();
const fs = require('fs');
const http = require('http');
const jwt = require('jsonwebtoken');
const { ensureInit, getUserByNovaId } = require('./db/firebase');
const secret = process.env.JWT_SECRET || 'darkchat-firebase-jwt-secret-2026';
(async () => {
  await ensureInit();
  const u = await getUserByNovaId('+1-999-234-8321');
  if (!u) { console.error('NO_ADMIN_USER'); process.exit(1); }
  const token = jwt.sign({ id: u.id, novaId: u.nova_id, displayName: u.display_name }, secret, { expiresIn: '30d' });
  fs.writeFileSync('/home/nebula/qa/token.txt', token);
  const req = http.request({ host: 'localhost', port: 3000, path: '/api/auth/me', headers: { Authorization: 'Bearer ' + token } }, (res) => {
    let body = '';
    res.on('data', (c) => body += c);
    res.on('end', () => { console.log('ME_STATUS=' + res.statusCode); console.log('ME_BODY=' + body.slice(0, 160)); process.exit(0); });
  });
  req.on('error', (e) => { console.error('REQ_ERR', e.message); process.exit(1); });
  req.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
