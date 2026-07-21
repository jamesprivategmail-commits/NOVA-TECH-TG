require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const Groq = require('groq-sdk');
const { evaluate } = require('mathjs');
const QRCode = require('qrcode');

const bot = new Telegraf(process.env.BOT_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ---------- Dummy web server (keeps Render happy) ----------
const app = express();
app.get('/', (req, res) => res.send('Bot is alive'));
app.listen(process.env.PORT || 3000, () => console.log('Web server running'));

// ---------- In-memory storage (swap for a real DB later) ----------
const users = {};
const chatHistory = {}; // per-chat AI conversation memory

const CHANNEL_LINK = 'https://t.me/+dXp9U3RUO8U0ZmY8';
const GROUP_LINK = 'https://t.me/+OWupog-mnfVkYTg0';

// ---------- Moderation storage ----------
const warnings = {}; // warnings[chatId][userId] = count
const MAX_WARNINGS = 3;

const bannedWords = ['badword1', 'badword2']; // add whatever words you want auto-filtered, lowercase

const spamTracker = {}; // spamTracker[chatId][userId] = [timestamps]
const SPAM_LIMIT = 5; // max messages
const SPAM_WINDOW_MS = 10000; // per 10 seconds

function addWarning(chatId, userId) {
  if (!warnings[chatId]) warnings[chatId] = {};
  warnings[chatId][userId] = (warnings[chatId][userId] || 0) + 1;
  return warnings[chatId][userId];
}

function getWarnings(chatId, userId) {
  return (warnings[chatId] && warnings[chatId][userId]) || 0;
}

function resetWarnings(chatId, userId) {
  if (warnings[chatId]) delete warnings[chatId][userId];
}

// ---------- XP / Level system ----------
const xpData = {}; // xpData[chatId][userId] = { xp, name }
const XP_PER_MESSAGE = 5;
const XP_COOLDOWN_MS = 10000; // don't farm XP by spamming
const xpCooldown = {}; // xpCooldown[chatId][userId] = lastTimestamp

function levelFromXp(xp) {
  return Math.floor(Math.sqrt(xp / 20)) + 1; // simple curve: more XP needed each level
}

function addXp(chatId, userId, name) {
  if (!xpData[chatId]) xpData[chatId] = {};
  if (!xpData[chatId][userId]) xpData[chatId][userId] = { xp: 0, name };

  if (!xpCooldown[chatId]) xpCooldown[chatId] = {};
  const now = Date.now();
  if (xpCooldown[chatId][userId] && now - xpCooldown[chatId][userId] < XP_COOLDOWN_MS) return;
  xpCooldown[chatId][userId] = now;

  xpData[chatId][userId].xp += XP_PER_MESSAGE;
  xpData[chatId][userId].name = name; // keep name fresh
}

// ---------- Helpers ----------
async function askAI(chatId, prompt) {
  if (!chatHistory[chatId]) chatHistory[chatId] = [];
  chatHistory[chatId].push({ role: 'user', content: prompt });

  // keep last 10 messages only, to control token usage
  const trimmed = chatHistory[chatId].slice(-10);

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'You are Nova, a helpful and friendly assistant inside a Telegram bot. Keep replies concise unless asked for detail.' },
      ...trimmed,
    ],
  });

  const reply = completion.choices[0].message.content;
  chatHistory[chatId].push({ role: 'assistant', content: reply });
  return reply;
}

async function isAdmin(ctx) {
  if (ctx.chat.type === 'private') return true;
  const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
  return ['administrator', 'creator'].includes(member.status);
}

// ---------- Promo image shown once per /start ----------
const PROMO_IMAGE = 'https://i.postimg.cc/d0Jpsvxc/download-(1).jpg';

function joinPromptMarkup(ctx) {
  return Markup.inlineKeyboard([
    [Markup.button.url('📢 Join Channel', CHANNEL_LINK)],
    [Markup.button.url('👥 Join Group', GROUP_LINK)],
    [Markup.button.url('➕ Add me to your Group', `https://t.me/${ctx.botInfo.username}?startgroup=true`)],
  ]);
}

// ---------- Utility: get chat ID (use this inside your group/channel to grab the ID) ----------
bot.command('getid', (ctx) => {
  ctx.reply(`This chat's ID is:\n\`${ctx.chat.id}\``, { parse_mode: 'Markdown' });
});

// (old hard force-join gate removed — replaced by the skippable soft prompt above)

// ---------- Auto-moderation: bad word filter + anti-spam ----------
bot.use(async (ctx, next) => {
  if (
    ctx.chat &&
    ctx.chat.type !== 'private' &&
    ctx.message &&
    ctx.message.text &&
    !ctx.message.text.startsWith('/')
  ) {
    const text = ctx.message.text.toLowerCase();
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    // Bad word filter
    const hit = bannedWords.find((w) => text.includes(w));
    if (hit) {
      try {
        await ctx.deleteMessage();
      } catch (err) {
        /* bot may lack delete permission */
      }
      const count = addWarning(chatId, userId);
      await ctx.reply(`⚠️ ${ctx.from.first_name}, that language isn't allowed. Warning ${count}/${MAX_WARNINGS}.`);
      if (count >= MAX_WARNINGS) {
        try {
          await ctx.telegram.banChatMember(chatId, userId);
          await ctx.reply(`🚫 ${ctx.from.first_name} has been banned for repeated violations.`);
          resetWarnings(chatId, userId);
        } catch (err) {
          /* bot may lack ban permission */
        }
      }
      return; // don't process further (e.g. AI reply) for filtered messages
    }

    // Anti-spam
    if (!spamTracker[chatId]) spamTracker[chatId] = {};
    if (!spamTracker[chatId][userId]) spamTracker[chatId][userId] = [];
    const now = Date.now();
    spamTracker[chatId][userId] = spamTracker[chatId][userId].filter((t) => now - t < SPAM_WINDOW_MS);
    spamTracker[chatId][userId].push(now);

    if (spamTracker[chatId][userId].length > SPAM_LIMIT) {
      try {
        await ctx.telegram.restrictChatMember(chatId, userId, {
          permissions: { can_send_messages: false },
          until_date: Math.floor(Date.now() / 1000) + 60, // 1 min mute
        });
        await ctx.reply(`🔇 ${ctx.from.first_name} was muted for 1 minute for spamming.`);
      } catch (err) {
        /* bot may lack restrict permission */
      }
      spamTracker[chatId][userId] = [];
      return;
    }

    // XP gain for normal messages
    addXp(chatId, userId, ctx.from.first_name);
  }
  return next();
});

// ---------- Basic commands ----------
bot.start(async (ctx) => {
  users[ctx.from.id] = { name: ctx.from.first_name, joined: new Date() };
  try {
    await ctx.replyWithPhoto(PROMO_IMAGE, {
      caption: '🎉 Join our channel & group for updates, tips, and more!',
      ...joinPromptMarkup(ctx),
    });
  } catch (err) {
    console.error('Failed to send promo:', err.message);
  }
  ctx.reply(
    `Welcome ${ctx.from.first_name}! 👋 I'm Nova, your AI-powered bot.\n\nUse /menu to see what I can do.`
  );
});

bot.command('menu', (ctx) => {
  ctx.reply(
    'What would you like to do?',
    Markup.inlineKeyboard([
      [Markup.button.callback('🤖 Ask AI', 'menu_ai')],
      [Markup.button.callback('🎲 Fun', 'menu_fun')],
      [Markup.button.callback('👥 Group Tools', 'menu_group')],
      [Markup.button.url('➕ Add me to your Group', `https://t.me/${ctx.botInfo.username}?startgroup=true`)],
      [Markup.button.callback('ℹ️ Help', 'menu_help')],
    ])
  );
});

bot.action('menu_ai', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('Just type /ai followed by your question, or talk to me directly in DM!');
});

bot.action('menu_fun', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('Try:\n/roll - roll a dice\n/coinflip - flip a coin\n/quote - random quote');
});

bot.action('menu_group', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('Group admin commands:\n/kick (reply to user)\n/mute (reply to user)\n/tagall - mention everyone\n/poll <question> - create a poll');
});

bot.action('menu_help', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('I\'m Nova 🤖 — an AI assistant bot. Use /menu anytime to see options.');
});

bot.help((ctx) => {
  ctx.reply(
    `📋 *Commands*\n\n` +
    `/start - welcome message\n` +
    `/menu - interactive menu\n` +
    `/ai <question> - ask the AI anything\n` +
    `/roll - roll a dice\n` +
    `/coinflip - flip a coin\n` +
    `/quote - random quote\n` +
    `/poll <question> - create a poll\n` +
    `/getid - get this chat's ID\n\n` +
    `*Utility:*\n` +
    `/weather <city> - current weather\n` +
    `/translate <lang> <text> - translate text\n` +
    `/calc <expression> - calculator\n` +
    `/define <word> - dictionary definition\n` +
    `/qr <text> - generate a QR code\n\n` +
    `*Stats & Fun:*\n` +
    `/profile (or /rank) - your level & XP\n` +
    `/leaderboard - top 10 in this group\n` +
    `/8ball <question> - magic 8 ball\n` +
    `/trivia - random trivia question\n` +
    `/meme - random meme\n\n` +
    `*Group admin only:*\n` +
    `/tagall - mention all admins\n` +
    `/kick - remove a user (reply)\n` +
    `/ban - permanently ban a user (reply)\n` +
    `/unban <user_id> - unban a user\n` +
    `/mute - mute a user (reply)\n` +
    `/lock - stop non-admins from messaging\n` +
    `/unlock - allow messaging again\n` +
    `/setname <name> - change group name\n` +
    `/setdesc <text> - change group description\n` +
    `/warn - warn a user (reply), auto-bans at ${MAX_WARNINGS}\n` +
    `/warnings - check a user's warning count\n` +
    `/resetwarn - clear a user's warnings (reply)\n\n` +
    `_Auto-moderation is also active: banned words get deleted + warned, and spam (${SPAM_LIMIT}+ msgs/10s) gets auto-muted._`,
    { parse_mode: 'Markdown' }
  );
});

// ---------- AI command ----------
bot.command('ai', async (ctx) => {
  const prompt = ctx.message.text.split(' ').slice(1).join(' ');
  if (!prompt) return ctx.reply('Ask me something! Example: /ai what is the capital of France?');

  const thinking = await ctx.reply('🤔 Thinking...');
  try {
    const reply = await askAI(ctx.chat.id, prompt);
    await ctx.telegram.editMessageText(ctx.chat.id, thinking.message_id, null, reply);
  } catch (err) {
    console.error(err);
    await ctx.telegram.editMessageText(ctx.chat.id, thinking.message_id, null, '⚠️ Something went wrong talking to the AI.');
  }
});

// Trivia answer check + Free-form AI chat in DMs (no command needed)
bot.on('text', async (ctx, next) => {
  // Trivia answer check (works in groups)
  if (ctx.chat.type !== 'private' && activeTrivia[ctx.chat.id]) {
    const guess = ctx.message.text.trim().toLowerCase();
    if (guess === activeTrivia[ctx.chat.id].answer) {
      addXp(ctx.chat.id, ctx.from.id, ctx.from.first_name);
      await ctx.reply(`✅ Correct, ${ctx.from.first_name}! +5 bonus XP 🎉`);
      delete activeTrivia[ctx.chat.id];
      return;
    }
  }

  if (ctx.chat.type === 'private' && !ctx.message.text.startsWith('/')) {
    try {
      const reply = await askAI(ctx.chat.id, ctx.message.text);
      return ctx.reply(reply);
    } catch (err) {
      console.error(err);
      return ctx.reply('⚠️ AI error, try again.');
    }
  }
  return next();
});

// ---------- Fun commands ----------
bot.command('roll', (ctx) => {
  const n = Math.floor(Math.random() * 6) + 1;
  ctx.reply(`🎲 You rolled a ${n}`);
});

bot.command('coinflip', (ctx) => {
  ctx.reply(Math.random() > 0.5 ? '🪙 Heads!' : '🪙 Tails!');
});

const quotes = [
  'The only way to do great work is to love what you do. — Steve Jobs',
  'Code is like humor. When you have to explain it, it’s bad. — Cory House',
  'First, solve the problem. Then, write the code. — John Johnson',
  'Simplicity is the soul of efficiency. — Austin Freeman',
];
bot.command('quote', (ctx) => {
  ctx.reply(quotes[Math.floor(Math.random() * quotes.length)]);
});

// ---------- Group commands ----------
bot.command('poll', async (ctx) => {
  const question = ctx.message.text.split(' ').slice(1).join(' ') || 'What do you think?';
  await ctx.telegram.sendPoll(ctx.chat.id, question, ['Yes', 'No', 'Maybe'], {
    is_anonymous: false,
  });
});

bot.command('tagall', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  if (!(await isAdmin(ctx))) return ctx.reply('Only admins can use this.');

  try {
    const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
    const mentions = admins.map((a) => `[${a.user.first_name}](tg://user?id=${a.user.id})`).join(' ');
    ctx.reply(`📢 ${mentions}`, { parse_mode: 'Markdown' });
  } catch (err) {
    ctx.reply('Could not tag members.');
  }
});

bot.command('kick', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  if (!(await isAdmin(ctx))) return ctx.reply('Only admins can use this.');
  if (!ctx.message.reply_to_message) return ctx.reply('Reply to the user you want to kick.');

  const targetId = ctx.message.reply_to_message.from.id;
  try {
    await ctx.telegram.banChatMember(ctx.chat.id, targetId);
    ctx.reply('User removed. 👋');
  } catch (err) {
    ctx.reply('Failed to kick — check my admin permissions.');
  }
});

bot.command('mute', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  if (!(await isAdmin(ctx))) return ctx.reply('Only admins can use this.');
  if (!ctx.message.reply_to_message) return ctx.reply('Reply to the user you want to mute.');

  const targetId = ctx.message.reply_to_message.from.id;
  try {
    await ctx.telegram.restrictChatMember(ctx.chat.id, targetId, {
      permissions: { can_send_messages: false },
    });
    ctx.reply('User muted. 🔇');
  } catch (err) {
    ctx.reply('Failed to mute — check my admin permissions.');
  }
});

bot.command('ban', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  if (!(await isAdmin(ctx))) return ctx.reply('Only admins can use this.');
  if (!ctx.message.reply_to_message) return ctx.reply('Reply to the user you want to ban.');

  const targetId = ctx.message.reply_to_message.from.id;
  try {
    await ctx.telegram.banChatMember(ctx.chat.id, targetId, { until_date: 0 }); // permanent
    ctx.reply('User banned permanently. 🚫');
  } catch (err) {
    ctx.reply('Failed to ban — check my admin permissions.');
  }
});

bot.command('unban', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  if (!(await isAdmin(ctx))) return ctx.reply('Only admins can use this.');

  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply('Usage: /unban <user_id>');

  try {
    await ctx.telegram.unbanChatMember(ctx.chat.id, targetId);
    ctx.reply('User unbanned. ✅');
  } catch (err) {
    ctx.reply('Failed to unban — make sure the user ID is correct.');
  }
});

bot.command('lock', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  if (!(await isAdmin(ctx))) return ctx.reply('Only admins can use this.');

  try {
    await ctx.telegram.setChatPermissions(ctx.chat.id, {
      can_send_messages: false,
      can_send_media_messages: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
    });
    ctx.reply('🔒 Group locked — only admins can send messages.');
  } catch (err) {
    ctx.reply('Failed to lock — check my admin permissions.');
  }
});

bot.command('unlock', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  if (!(await isAdmin(ctx))) return ctx.reply('Only admins can use this.');

  try {
    await ctx.telegram.setChatPermissions(ctx.chat.id, {
      can_send_messages: true,
      can_send_media_messages: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
    });
    ctx.reply('🔓 Group unlocked — everyone can send messages again.');
  } catch (err) {
    ctx.reply('Failed to unlock — check my admin permissions.');
  }
});

bot.command('setname', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  if (!(await isAdmin(ctx))) return ctx.reply('Only admins can use this.');

  const newName = ctx.message.text.split(' ').slice(1).join(' ');
  if (!newName) return ctx.reply('Usage: /setname <new group name>');

  try {
    await ctx.telegram.setChatTitle(ctx.chat.id, newName);
    ctx.reply(`✅ Group name changed to "${newName}"`);
  } catch (err) {
    ctx.reply('Failed to change name — check my admin permissions.');
  }
});

bot.command('setdesc', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  if (!(await isAdmin(ctx))) return ctx.reply('Only admins can use this.');

  const newDesc = ctx.message.text.split(' ').slice(1).join(' ');
  if (!newDesc) return ctx.reply('Usage: /setdesc <new group description>');

  try {
    await ctx.telegram.setChatDescription(ctx.chat.id, newDesc);
    ctx.reply('✅ Group description updated.');
  } catch (err) {
    ctx.reply('Failed to change description — check my admin permissions.');
  }
});

bot.command('warn', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  if (!(await isAdmin(ctx))) return ctx.reply('Only admins can use this.');
  if (!ctx.message.reply_to_message) return ctx.reply('Reply to the user you want to warn.');

  const target = ctx.message.reply_to_message.from;
  const count = addWarning(ctx.chat.id, target.id);
  await ctx.reply(`⚠️ ${target.first_name} warned. (${count}/${MAX_WARNINGS})`);

  if (count >= MAX_WARNINGS) {
    try {
      await ctx.telegram.banChatMember(ctx.chat.id, target.id);
      await ctx.reply(`🚫 ${target.first_name} has been banned for reaching ${MAX_WARNINGS} warnings.`);
      resetWarnings(ctx.chat.id, target.id);
    } catch (err) {
      ctx.reply('Failed to auto-ban — check my admin permissions.');
    }
  }
});

bot.command('warnings', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  const target = ctx.message.reply_to_message ? ctx.message.reply_to_message.from : ctx.from;
  const count = getWarnings(ctx.chat.id, target.id);
  ctx.reply(`${target.first_name} has ${count}/${MAX_WARNINGS} warnings.`);
});

bot.command('resetwarn', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('This only works in groups.');
  if (!(await isAdmin(ctx))) return ctx.reply('Only admins can use this.');
  if (!ctx.message.reply_to_message) return ctx.reply('Reply to the user whose warnings you want to reset.');

  const target = ctx.message.reply_to_message.from;
  resetWarnings(ctx.chat.id, target.id);
  ctx.reply(`✅ Warnings reset for ${target.first_name}.`);
});

// ---------- Utility commands ----------
bot.command('weather', async (ctx) => {
  const city = ctx.message.text.split(' ').slice(1).join(' ');
  if (!city) return ctx.reply('Usage: /weather <city name>');

  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=%C+%t+(feels+%f)+💧%h+💨%w`);
    const data = await res.text();
    ctx.reply(`🌤️ Weather in ${city}:\n${data}`);
  } catch (err) {
    ctx.reply('Could not fetch weather right now.');
  }
});

bot.command('translate', async (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  const targetLang = parts[0];
  const text = parts.slice(1).join(' ');
  if (!targetLang || !text) return ctx.reply('Usage: /translate <language> <text>\nExample: /translate spanish Hello there');

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a translation engine. Translate the user text into the requested language. Reply ONLY with the translation, nothing else.' },
        { role: 'user', content: `Translate to ${targetLang}: ${text}` },
      ],
    });
    ctx.reply(completion.choices[0].message.content);
  } catch (err) {
    ctx.reply('Translation failed, try again.');
  }
});

bot.command('calc', (ctx) => {
  const expression = ctx.message.text.split(' ').slice(1