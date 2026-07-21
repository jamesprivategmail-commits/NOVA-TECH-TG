require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

app.get('/', (req, res) => res.send('Bot is alive'));
app.listen(process.env.PORT || 3000, () => console.log('Web server running'));

bot.start((ctx) => ctx.reply(`Welcome ${ctx.from.first_name}! 👋`));
bot.command('help', (ctx) => ctx.reply('Available commands:\n/start\n/help\n/ping'));
bot.command('ping', (ctx) => ctx.reply('pong 🏓'));
bot.on('text', (ctx) => ctx.reply(`You said: "${ctx.message.text}"`));

bot.launch();
console.log('Bot is running...');