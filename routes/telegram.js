const express = require('express');
const crypto = require('crypto');
const { handleUpdate, isConfigured } = require('../services/telegramBot');
const { consumeTelegramPairing } = require('../db/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function hasValidSecret(req) {
  const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!expected) return true;
  const received = String(req.get('x-telegram-bot-api-secret-token') || '');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

// POST /api/telegram/webhook - Telegram sends updates here.
router.post('/webhook', async (req, res) => {
  if (!isConfigured()) return res.status(503).json({ error: 'Telegram bot is not configured' });
  if (!hasValidSecret(req)) return res.status(401).json({ error: 'Invalid Telegram webhook secret' });

  try {
    await handleUpdate(req.body || {});
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Telegram update error:', err);
    res.status(500).json({ error: 'Telegram update could not be processed' });
  }
});

router.get('/pair/status', requireAuth, async (req, res) => {
  try {
    const { getUserById } = require('../db/firebase');
    const user = await getUserById(req.user.id);
    res.json({ telegram: user?.telegram_chat_id ? {
      linked: true,
      username: user.telegram_username || null,
      linkedAt: user.telegram_linked_at || null
    } : { linked: false } });
  } catch (err) {
    console.error('Telegram pairing status error:', err);
    res.status(500).json({ error: 'Failed to load Telegram pairing status' });
  }
});

router.post('/pair', requireAuth, async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the six-digit code from Telegram' });
    const result = await consumeTelegramPairing(code, req.user.id);
    if (!result.ok) {
      const message = result.reason === 'expired' ? 'That pairing code has expired' :
        result.reason === 'account' ? 'That code belongs to a different DARK CHAT ID' :
          'Invalid or already used pairing code';
      return res.status(400).json({ error: message });
    }
    res.json({ telegram: result.telegram });
  } catch (err) {
    console.error('Telegram pairing error:', err);
    res.status(500).json({ error: 'Failed to pair Telegram bot' });
  }
});

module.exports = router;
