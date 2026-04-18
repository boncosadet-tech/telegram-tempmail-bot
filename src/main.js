const VERSION = "2026-04-19-telegram-tempmail-v1";

function htmlDecode(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeMimeWords(input) {
  return String(input || "").replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (_, charset, enc, text) => {
    try {
      if (enc.toUpperCase() === "B") {
        const bin = atob(text);
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
      }
      const qp = text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      const bytes = Uint8Array.from(qp, c => c.charCodeAt(0));
      return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
    } catch (_) {
      return text;
    }
  });
}

function randomLocal() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return "tmp-" + [...bytes].map(b => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

function cleanText(s) {
  return htmlDecode(String(s || ""))
    .replace(/\r/g, "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readRaw(stream, limit = 120000) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total <= limit) chunks.push(value);
      else {
        const remain = Math.max(0, limit - (total - value.byteLength));
        if (remain > 0) chunks.push(value.slice(0, remain));
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

function extractLikelyCode(text) {
  const s = String(text || "");
  const patterns = [
    /(?:kode|code|otp|verification|verifikasi|pin|token)[^A-Z0-9]{0,30}([A-Z0-9]{4,10})/i,
    /\b([0-9]{4,8})\b/,
    /\b([A-Z0-9]{6,10})\b/
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) return m[1];
  }
  return "-";
}

function getBestPreview(raw) {
  const textPlain = raw.match(/Content-Type:\s*text\/plain[\s\S]*?\n\n([\s\S]*?)(?=\n--|\nContent-Type:|$)/i);
  const textHtml = raw.match(/Content-Type:\s*text\/html[\s\S]*?\n\n([\s\S]*?)(?=\n--|\nContent-Type:|$)/i);
  const body = textPlain?.[1] || textHtml?.[1] || raw.split(/\r?\n\r?\n/).slice(1).join("\n\n") || raw;
  return cleanText(body).slice(0, 2200);
}

async function sendTelegram(env, text, chatId = env.ALLOWED_USER_ID) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(text).slice(0, 4090),
      disable_web_page_preview: true
    })
  });
  if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
  return res;
}

function isAllowed(update, env) {
  const msg = update.message || update.edited_message || update.channel_post || {};
  const fromId = msg.from?.id != null ? String(msg.from.id) : "";
  const chatId = msg.chat?.id != null ? String(msg.chat.id) : "";
  return fromId === String(env.ALLOWED_USER_ID) || chatId === String(env.ALLOWED_USER_ID);
}

async function handleTelegram(request, env) {
  if (request.method !== "POST") return new Response("telegram webhook ok", { status: 200 });
  const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (env.WEBHOOK_SECRET && secretHeader && secretHeader !== env.WEBHOOK_SECRET) {
    return new Response("bad secret", { status: 403 });
  }
  const update = await request.json().catch(() => null);
  if (!update) return new Response("bad json", { status: 400 });
  if (!isAllowed(update, env)) return new Response("ignored", { status: 200 });

  const msg = update.message || update.edited_message || {};
  const text = String(msg.text || "").trim();
  const domain = env.DOMAIN || "dahus.my.id";
  const replyChatId = msg.chat?.id || env.ALLOWED_USER_ID;

  if (text.startsWith("/new")) {
    const addr = `${randomLocal()}@${domain}`;
    await sendTelegram(env, `✅ Temp email dibuat\n\n${addr}\n\nPakai alamat ini untuk menerima OTP/email. Semua email masuk ke domain ini akan dikirim ke Telegram.`, replyChatId);
  } else if (text.startsWith("/whoami")) {
    await sendTelegram(env, `User ID: ${msg.from?.id}\nChat ID: ${msg.chat?.id}`, replyChatId);
  } else if (text.startsWith("/start") || text.startsWith("/help") || !text) {
    await sendTelegram(env, `🤖 TempMail Bot aktif\n\nPerintah:\n/new - buat alamat tempmail random\n/whoami - cek ID Telegram\n/help - bantuan\n\nDomain: ${domain}\nMode: private single-user`, replyChatId);
  } else {
    await sendTelegram(env, `Perintah tidak dikenal. Pakai /new untuk buat email temp.`, replyChatId);
  }
  return new Response("ok", { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({ ok: true, service: "telegram-tempmail", version: VERSION, domain: env.DOMAIN });
    }
    if (url.pathname === `/tg/${env.WEBHOOK_SECRET}`) return handleTelegram(request, env);
    return new Response("not found", { status: 404 });
  },

  async email(message, env, ctx) {
    const raw = await readRaw(message.raw);
    const from = decodeMimeWords(message.headers.get("from") || message.from || "-");
    const to = message.to || "-";
    const subject = decodeMimeWords(message.headers.get("subject") || "(no subject)");
    const preview = getBestPreview(raw);
    const code = extractLikelyCode(`${subject}\n${preview}\n${raw.slice(0, 4000)}`);
    const sizeKb = Math.ceil((message.rawSize || raw.length || 0) / 1024);

    const text = [
      "📩 Email masuk",
      "",
      `To: ${to}`,
      `From: ${from}`,
      `Subject: ${subject}`,
      `Size: ${sizeKb} KB`,
      "",
      `Kode kemungkinan: ${code}`,
      "",
      "Preview:",
      preview || "(preview kosong / MIME tidak terbaca)"
    ].join("\n");

    ctx.waitUntil(sendTelegram(env, text));
  }
};
