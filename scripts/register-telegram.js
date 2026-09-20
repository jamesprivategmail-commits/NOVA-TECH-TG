const { telegramRequest } = require('../services/telegramBot');

const webhookUrl = String(process.env.TELEGRAM_WEBHOOK_URL || '').trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();

if (!webhookUrl) {
  console.error('TELEGRAM_WEBHOOK_URL is required, for example https://your-domain.vercel.app/api/telegram/webhook');
  process.exit(1);
}

(async () => {
  await telegramRequest('setWebhook', {
    url: webhookUrl,
    ...(secret ? { secret_token: secret } : {}),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false
  });

  await telegramRequest('setMyCommands', {
    commands: [
      { command: 'start', description: 'Open the DARK CHAT menu' },
      { command: 'menu', description: 'Show the bot menu' },
      { command: 'ping', description: 'Check the bot connection' },
      { command: 'pair', description: 'Pair a DARK CHAT account' }
    ]
  });

  console.log(`Telegram webhook registered at ${webhookUrl}`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
