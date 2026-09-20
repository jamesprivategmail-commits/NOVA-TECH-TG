require('dotenv').config();
const { createTelegramPairing } = require('../db/firebase');

const TELEGRAM_API = 'https://api.telegram.org';

function getBotToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function isConfigured() {
  return Boolean(getBotToken());
}

async function telegramRequest(method, payload) {
  const token = getBotToken();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || `Telegram ${method} failed (${response.status})`);
  }
  return data.result;
}

function menuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Ping', callback_data: 'darkchat:ping' },
        { text: 'Pair account', callback_data: 'darkchat:pair' }
      ],
      [{ text: 'Help', callback_data: 'darkchat:help' }]
    ]
  };
}

function menuText() {
  return [
    'DARK CHAT assistant',
    '',
    'To link your account:',
    '1. Send /pair YOUR-DARK-CHAT-ID',
    '2. Copy the six-digit code I send back',
    '3. Enter the code in DARK CHAT → Profile → Settings → Link DARK CHAT assistant',
    '',
    'After pairing, use .ping to test the connection and .menu to see commands.',
    '',
    'Available commands:',
    '.ping — check the bot connection',
    '.menu — show this command menu',
    '/pair YOUR-DARK-CHAT-ID — get a pairing code'
  ].join('\n');
}

async function sendMessage(chatId, text, options = {}) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    ...options
  });
}

async function answerCallbackQuery(callbackQueryId, text) {
  return telegramRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false
  });
}

async function handleUpdate(update) {
  if (update.callback_query) {
    const callback = update.callback_query;
    const chatId = callback.message?.chat?.id;
    if (!chatId) return;

    await answerCallbackQuery(callback.id, '');
    if (callback.data === 'darkchat:ping') {
      await sendMessage(chatId, 'pong — DARK CHAT assistant is online.');
    } else if (callback.data === 'darkchat:pair') {
      await sendMessage(chatId, 'Send /pair YOUR-DARK-CHAT-ID to receive a six-digit pairing code.');
    } else if (callback.data === 'darkchat:help') {
      await sendMessage(chatId, menuText(), { reply_markup: menuKeyboard() });
    }
    return;
  }

  const message = update.message;
  if (!message?.chat?.id || typeof message.text !== 'string') return;

  const text = message.text.trim().toLowerCase();
  const parts = text.split(/\s+/);
  const command = parts[0].split('@')[0];
  if (command === '/start' || command === '/menu' || command === '.menu') {
    await sendMessage(message.chat.id, menuText(), { reply_markup: menuKeyboard() });
  } else if (command === '/ping' || command === '.ping') {
    await sendMessage(message.chat.id, 'pong — DARK CHAT assistant is online.');
  } else if (command === '/pair' || command === '.pair') {
    const novaId = parts[1] || '';
    if (!novaId) {
      await sendMessage(message.chat.id, 'Send /pair YOUR-DARK-CHAT-ID to receive a six-digit pairing code.');
      return;
    }
    const pairing = await createTelegramPairing({
      chatId: message.chat.id,
      novaId,
      telegramUser: message.from || {}
    });
    if (!pairing) {
      await sendMessage(message.chat.id, 'I could not find that DARK CHAT ID. Check the ID and try again.');
      return;
    }
    await sendMessage(message.chat.id, [
      `Your DARK CHAT pairing code is: ${pairing.code}`,
      '',
      'Open DARK CHAT → Profile → Settings → Link DARK CHAT assistant, enter this code, and tap Link assistant.',
      'The code expires in 10 minutes.'
    ].join('\n'));
  }
}

module.exports = {
  answerCallbackQuery,
  handleUpdate,
  isConfigured,
  menuKeyboard,
  menuText,
  sendMessage,
  telegramRequest
};

if (require.main === module) {
  const command = process.argv[2];
  if (command === 'set-commands') {
    telegramRequest('setMyCommands', {
      commands: [
        { command: 'start', description: 'Open the DARK CHAT menu' },
        { command: 'menu', description: 'Show the bot menu' },
        { command: 'ping', description: 'Check the bot connection' },
        { command: 'pair', description: 'Pair a DARK CHAT account' }
      ]
    }).then(() => console.log('Telegram commands registered.')).catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
  }
}
