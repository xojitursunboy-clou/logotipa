'use strict';

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const FormData = require('form-data');

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const STABILITY_KEY = process.env.STABILITY_API_KEY;
const RENDER_URL   = process.env.RENDER_URL;   // https://your-app.onrender.com
const PORT         = process.env.PORT || 3000;

if (!BOT_TOKEN || !STABILITY_KEY) {
  console.error('❌ TELEGRAM_BOT_TOKEN yoki STABILITY_API_KEY yo\'q!');
  process.exit(1);
}

/* ── EXPRESS + WEBHOOK ── */
const app = express();
app.use(express.json());

const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Render health check — uxlab qolmasin
app.get('/', (_req, res) => res.send('🤖 Logo Bot ishlamoqda'));

/* ── MATNLAR ── */
const EXAMPLE = `
*Namuna:*
\`\`\`
nom: Suhrob
style: orqa fon ko'k, S va B harflari birlashtirilgan, yozuv qizil
\`\`\``;

const START_MSG = `👋 *Salom! Men Logo Generator botman!*

Men sizga AI yordamida professional logo yaratib beraman.

📝 *Qanday yozish kerak:*${EXAMPLE}

💡 *Qo'shimcha:*
• Faqat \`nom:\` yozsangiz → zamonaviy logo
• \`harflarni birlashtir\` → monogram logo

🚀 Boshlaylik!`;

const ERR_FORMAT = `❌ Noto'g'ri format. Quyidagicha yozing:${EXAMPLE}`;

/* ── UZ→EN ── */
const MAP = {
  "ko'k":'blue','qizil':'red','yashil':'green','sariq':'yellow',
  'oq':'white','qora':'black','binafsha':'purple','pushti':'pink',
  "to'q ko'k":'dark blue',"och ko'k":'light blue','moviy':'cyan',
  'kumush':'silver','oltin':'gold','kulrang':'gray',"to'q yashil":'dark green',
  "to'q qizil":'dark red','zamonaviy':'modern','klassik':'classic',
  'minimalist':'minimalist','abstrakt':'abstract','geometrik':'geometric',
  'harflarni birlashtir':'monogram combined intertwined letters',
  'birlashtirilgan':'combined intertwined','birlashtir':'combine intertwine',
  'orqa fon':'background','gradient':'gradient','aylana':'circle',
  'yozuv':'text','shrift':'font','qalin':'bold','ingichka':'thin',
  'soya':'shadow','parlash':'glowing','metallik':'metallic',
};

function uz2en(text) {
  let r = text.toLowerCase();
  Object.entries(MAP)
    .sort((a,b) => b[0].length - a[0].length)
    .forEach(([uz,en]) => {
      r = r.replace(new RegExp(uz.replace(/'/g,"[''`]"), 'gi'), en);
    });
  return r;
}

/* ── PROMPT ── */
function buildPrompt(name, styleUz) {
  const styleEn = uz2en(styleUz);
  const mono = /harflarni birlashtir|monogram|birlashtir/i.test(styleUz);
  return [
    `professional logo design for brand "${name}"`,
    mono ? 'monogram logo with intertwined letters' : '',
    styleEn,
    'modern logo design, clean typography, vector style, minimalist, high quality',
    `clear readable text "${name}", correct spelling, centered composition`,
    'white background, sharp edges, professional branding, flat design, no watermark',
  ].filter(Boolean).join(', ');
}

const NEG = 'blurry, low quality, distorted text, misspelled, watermark, ' +
  'realistic photo, 3d render, people, hands, busy background, cluttered';

/* ── PARSE ── */
function parse(text) {
  let name = null, style = null;
  for (const line of text.trim().split('\n')) {
    const m1 = line.match(/^nom\s*:\s*(.+)$/i);
    const m2 = line.match(/^style\s*:\s*(.+)$/i);
    if (m1) name  = m1[1].trim();
    if (m2) style = m2[1].trim();
  }
  return { name, style };
}

/* ── GENERATE ── */
async function generate(prompt) {
  // 1. SD3
  try {
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('negative_prompt', NEG);
    form.append('model', 'sd3-large-turbo');
    form.append('aspect_ratio', '1:1');
    form.append('output_format', 'png');

    const res = await axios.post(
      'https://api.stability.ai/v2beta/stable-image/generate/sd3',
      form,
      {
        headers: { 'Authorization': `Bearer ${STABILITY_KEY}`, 'Accept': 'image/*', ...form.getHeaders() },
        responseType: 'arraybuffer',
        timeout: 65000,
      }
    );
    return Buffer.from(res.data);
  } catch (e) {
    console.log('SD3 failed:', e.response?.status, '— SDXL fallback...');
  }

  // 2. SDXL fallback
  const res = await axios.post(
    'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
    {
      text_prompts: [{ text: prompt, weight: 1 }, { text: NEG, weight: -1 }],
      cfg_scale: 7, width: 1024, height: 1024, samples: 1, steps: 30,
    },
    {
      headers: {
        'Authorization': `Bearer ${STABILITY_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 65000,
    }
  );
  return Buffer.from(res.data.artifacts[0].base64, 'base64');
}

/* ── HANDLERS ── */
bot.onText(/\/(start|help)/, msg =>
  bot.sendMessage(msg.chat.id, START_MSG, { parse_mode: 'Markdown' })
);

bot.on('message', async msg => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const { name, style } = parse(msg.text);

  if (!name) return bot.sendMessage(chatId, ERR_FORMAT, { parse_mode: 'Markdown' });

  const finalStyle = style || "zamonaviy minimalist logo, professional";

  const wait = await bot.sendMessage(
    chatId,
    `⏳ *Logo yaratilmoqda...*\n\n👤 *${name}*\n🎨 ${finalStyle}\n\n_20–40 soniya kuting..._`,
    { parse_mode: 'Markdown' }
  );

  try {
    const img = await generate(buildPrompt(name, finalStyle));
    await bot.deleteMessage(chatId, wait.message_id).catch(() => {});
    await bot.sendPhoto(chatId, img, {
      caption: `✅ *${name}* uchun logo tayyor!\n🎨 _${finalStyle}_`,
      parse_mode: 'Markdown',
    });
    console.log(`✅ [${name}] logo yuborildi`);
  } catch (err) {
    console.error('❌ Error:', err.response?.status, err.message);
    await bot.deleteMessage(chatId, wait.message_id).catch(() => {});

    const code = err.response?.status;
    const txt =
      code === 401 ? '⚠️ API kalit noto\'g\'ri.' :
      code === 429 ? '⚠️ Juda ko\'p so\'rov. 1 daqiqa kuting.' :
      err.code === 'ECONNABORTED' ? '⚠️ Timeout. Qayta urinib ko\'ring.' :
      '⚠️ Xatolik yuz berdi, keyinroq urinib ko\'ring.';

    await bot.sendMessage(chatId, txt);
  }
});

/* ── START ── */
app.listen(PORT, async () => {
  console.log(`🚀 Server :${PORT} da ishlamoqda`);
  if (RENDER_URL) {
    const url = `${RENDER_URL}/bot${BOT_TOKEN}`;
    await bot.setWebHook(url);
    console.log(`✅ Webhook: ${url}`);
  } else {
    console.warn('⚠️ RENDER_URL yo\'q — webhook o\'rnatilmadi');
  }
});
