// ============================================================
// 🧩 NOVA BOT — FEATURES MODULE (persona, imagine, voice, speak)
//
// In your main bot.js, after you create `bot` and `groq` and
// define `chatHistory` + `askAI`, add these two lines:
//
//   const registerFeatures = require('./features');
//   registerFeatures({ bot, groq, Markup, chatHistory, askAI });
//
// ⚠️ IMPORTANT: your existing `askAI` function's system prompt is
// hardcoded. To make /persona actually change Nova's personality,
// open your askAI function and change this line:
//
//   { role: 'system', content: 'You are Nova, a helpful and friendly assistant...' }
//
// to:
//
//   { role: 'system', content: getPersonaPrompt(chatId) }
//
// ...and also do:  const { getPersonaPrompt } = require('./features');
// (this file exports it below alongside the main function)
// ============================================================

const personas = {
  nova:   { label: '🤖 Nova (default)', prompt: 'You are Nova, a helpful and friendly assistant inside a Telegram bot. Keep replies concise unless asked for detail.' },
  sassy:  { label: '😏 Sassy',          prompt: 'You are a sassy, sarcastic assistant who still gives correct, helpful answers, delivered with witty attitude.' },
  coach:  { label: '💪 Motivator',      prompt: 'You are an energetic motivational coach. Keep replies short, punchy, and encouraging.' },
  nerd:   { label: '🧠 Nerd',           prompt: 'You are a nerdy expert who loves explaining things with technical depth and fun facts.' },
  pirate: { label: '🏴‍☠️ Pirate',       prompt: 'You speak like a pirate captain. Stay accurate and helpful, just talk like a pirate.' },
};
const userPersona = {}; // userPersona[chatId] = persona key, defaults to 'nova'

function getPersonaPrompt(chatId) {
  const key = userPersona[chatId] || 'nova';
  return (personas[key] || personas.nova).prompt;
}

function registerFeatures({ bot, groq, Markup, chatHistory, askAI }) {
  // ============================================================
  // 🎭 /persona — switch Nova's personality per chat
  // ============================================================
  bot.command('persona', (ctx) => {
    const arg = ctx.message.text.split(' ')[1];
    if (arg && personas[arg]) {
      userPersona[ctx.chat.id] = arg;
      chatHistory[ctx.chat.id] = []; // fresh memory so the new persona isn't fighting old context
      return ctx.reply(`✅ Persona switched to ${personas[arg].label}`);
    }
    ctx.reply(
      'Pick a persona:',
      Markup.inlineKeyboard(
        Object.entries(personas).map(([key, p]) => [Markup.button.callback(p.label, `persona_${key}`)])
      )
    );
  });

  bot.action(/^persona_(.+)/, (ctx) => {
    const key = ctx.match[1];
    if (!personas[key]) return ctx.answerCbQuery('Unknown persona');
    userPersona[ctx.chat.id] = key;
    chatHistory[ctx.chat.id] = [];
    ctx.answerCbQuery();
    ctx.editMessageText(`✅ Persona switched to ${personas[key].label}`);
  });

  // ============================================================
  // 🖼️ /imagine — AI image generation (Pollinations.ai, free, no key)
  // ============================================================
  bot.command(['imagine', 'image'], async (ctx) => {
    const prompt = ctx.message.text.split(' ').slice(1).join(' ');
    if (!prompt) return ctx.reply('Usage: /imagine <description>\nExample: /imagine a cyberpunk cat riding a motorcycle');

    const wait = await ctx.reply('🎨 Generating your image...');
    try {
      const seed = Math.floor(Math.random() * 1000000);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&nologo=true`;
      await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.replyWithPhoto(url, { caption: `🖼️ "${prompt}"` });
    } catch (err) {
      console.error(err);
      ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, null, '⚠️ Image generation failed, try again.').catch(() => {});
    }
  });

  // ============================================================
  // 🎙️ Voice messages -> transcribe (Groq Whisper) -> AI reply
  // ============================================================
  bot.on('voice', async (ctx) => {
    const wait = await ctx.reply('🎙️ Listening...');
    try {
      const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
      const audioRes = await fetch(fileLink.href);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      const transcription = await groq.audio.transcriptions.create({
        file: new File([audioBuffer], 'voice.ogg', { type: 'audio/ogg' }),
        model: 'whisper-large-v3-turbo',
      });

      const text = transcription.text;
      await ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, null, `🎙️ Heard: "${text}"`);

      const reply = await askAI(ctx.chat.id, text);
      await ctx.reply(reply);
    } catch (err) {
      console.error(err);
      ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, null, '⚠️ Could not process that voice message.').catch(() => {});
    }
  });

  // ============================================================
  // 🔊 /speak — text-to-speech (Groq PlayAI TTS, still preview on Groq's side)
  // ============================================================
  bot.command('speak', async (ctx) => {
    const text = ctx.message.text.split(' ').slice(1).join(' ');
    if (!text) return ctx.reply('Usage: /speak <text>');

    try {
      const response = await groq.audio.speech.create({
        model: 'playai-tts',
        voice: 'Fritz-PlayAI',
        input: text,
        response_format: 'wav',
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      await ctx.replyWithVoice({ source: buffer, filename: 'speech.wav' });
    } catch (err) {
      console.error(err);
      ctx.reply('⚠️ TTS failed — playai-tts is in preview on Groq, so your account may not have access yet. Check console.groq.com.');
    }
  });

  // 👉 Add to your /help and /menu text:
  //    /persona - switch Nova's personality
  //    /imagine <prompt> - generate an AI image
  //    /speak <text> - text-to-speech
  //    (send a voice note) - Nova transcribes it and replies
}

module.exports = registerFeatures;
module.exports.getPersonaPrompt = getPersonaPrompt;
