require('dotenv').config();
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply(`Welcome ${ctx.from.first_name}! 👋 I'm alive and ready.`);
});

bot.command('help', (ctx) => {
  ctx.reply('Available commands:\n/start\n/help\n/ping');
});

bot.command('ping', (ctx) => ctx.reply('pong 🏓'));

bot.on('text', (ctx) => {
  ctx.reply(`You said: "${ctx.message.text}"`);
});

bot.launch();
console.log('Bot is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));