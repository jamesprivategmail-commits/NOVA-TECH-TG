require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const Groq = require('groq-sdk');

const bot = new Telegraf(process.env.BOT_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ---------- Dummy web server (keeps Render happy) ----------
const app = express();
app.get('/', (req, res) => res.send('Bot is alive'));
app.listen(process.env.PORT || 3000, () => console.log('Web server running'));

// ---------- In-memory storage (swap for a real DB later) ----------
const users = {};
const chatHistory = {}; // per-chat AI conversation memory
const verifiedUsers = new Set(); // users who passed the join check this session

// IDs of your channel/group the user must join before DM'ing the bot
const REQUIRED_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID; // e.g. -1001234567890
const REQUIRED_GROUP_ID = process.env.REQUIRED_GROUP_ID;
const CHANNEL_LINK = 'https://t.me/+dXp9U3RUO8U0ZmY8';
const GROUP_LINK = 'https://t.me/+OWupog-mnfVkYTg0';

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

async function hasJoinedRequired(ctx) {
  if (!REQUIRED_CHANNEL_ID || !REQUIRED_GROUP_ID) return true; // not configured yet, skip check
  try {
    const [channelMember, groupMember] = await Promise.all([
      ctx.telegram.getChatMember(REQUIRED_CHANNEL_ID, ctx.from.id),
      ctx.telegram.getChatMember(REQUIRED_GROUP_ID, ctx.from.id),
    ]);
    const inChannel = !['left', 'kicked'].includes(channelMember.status);
    const inGroup = !['left', 'kicked'].includes(groupMember.status);
    return inChannel && inGroup;
  } catch (err) {
    console.error('Join check failed:', err.message);
    return false;
  }
}

function joinPromptMarkup() {
  return Markup.inlineKeyboard([
    [Markup.button.url('📢 Join Channel', CHANNEL_LINK)],
    [Markup.button.url('👥 Join Group', GROUP_LINK)],
    [Markup.button.callback('✅ I\'ve Joined', 'check_join')],
  ]);
}

// ---------- Utility: get chat ID (use this inside your group/channel to grab the ID) ----------
bot.command('getid', (ctx) => {
  ctx.reply(`This chat's ID is:\n\`${ctx.chat.id}\``, { parse_mode: 'Markdown' });
});

// ---------- Force-join gate (private chats only) ----------
bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type === 'private') {
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/getid')) return next();
    if (!verifiedUsers.has(ctx.from.id)) {
      const joined = await hasJoinedRequired(ctx);
      if (joined) {
        verifiedUsers.add(ctx.from.id);
      } else {
        return ctx.reply(
          '🔒 To use this bot, please join our channel and group first, then tap "I\'ve Joined".',
          joinPromptMarkup()
        );
      }
    }
  }
  return next();
});

bot.action('check_join', async (ctx) => {
  const joined = await hasJoinedRequired(ctx);
  if (joined) {
    verifiedUsers.add(ctx.from.id);
    await ctx.answerCbQuery('✅ Verified!');
    await ctx.editMessageText('✅ Thanks for joining! You can now use the bot. Send /start to begin.');
  } else {
    await ctx.answerCbQuery('❌ You haven\'t joined both yet.', { show_alert: true });
  }
});

// ---------- Basic commands ----------
bot.start((ctx) => {
  users[ctx.from.id] = { name: ctx.from.first_name, joined: new Date() };
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
    `*Group admin only:*\n` +
    `/tagall - mention all admins\n` +
    `/kick - remove a user (reply)\n` +
    `/ban - permanently ban a user (reply)\n` +
    `/unban <user_id> - unban a user\n` +
    `/mute - mute a user (reply)\n` +
    `/lock - stop non-admins from messaging\n` +
    `/unlock - allow messaging again\n` +
    `/setname <name> - change group name\n` +
    `/setdesc <text> - change group description\n`,
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

// Free-form AI chat in DMs (no command needed)
bot.on('text', async (ctx, next) => {
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

// Welcome new members
bot.on('new_chat_members', (ctx) => {
  ctx.message.new_chat_members.forEach((member) => {
    ctx.reply(`👋 Welcome to the group, ${member.first_name}!`);
  });
});

// ---------- Launch ----------
bot.launch();
console.log('Bot is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
