const express = require('express');
const crypto = require('crypto');
const { handleUpdate, isConfigured } = require('../services/telegramBot');

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

module.exports = router;
