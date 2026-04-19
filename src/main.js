const VERSION = "2026-04-19-telegram-tempmail-v2";
const OWNER_KEY = "owner";

function htmlDecode(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function decodeMimeWords(input) {
  return String(input || "").replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (_, charset, enc, text) => {
    try {
      if (enc.toUpperCase() === "B") {
        const bin = atob(text);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
      }
      const qp = text
        .replace(/_/g, " ")
        .replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
      const bytes = Uint8Array.from(qp, (c) => c.charCodeAt(0));
      return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
    } catch (_error) {
      return text;
    }
  });
}

function randomLocal() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `tmp-${[...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10)}`;
}

function cleanText(s) {
  return htmlDecode(String(s || ""))
    .replace(/\r/g, "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => {
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
      if (total <= limit) {
        chunks.push(value);
      } else {
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
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

function extractLikelyCode(text) {
  const s = String(text || "");
  const stopwords = new Set(["code", "kode", "token", "otp", "pin"]);
  const patterns = [
    /(?:kode|code|otp|verification|verifikasi|pin|token)[^0-9A-Z]{0,30}([0-9]{4,8})/gi,
    /(?:kode|code|otp|verification|verifikasi|pin|token)[^0-9A-Z]{0,30}([A-Z0-9]{6,10})/gi,
    /\b([0-9]{4,8})\b/g,
    /\b([A-Z0-9]{6,10})\b/g
  ];
  for (const re of patterns) {
    for (const match of s.matchAll(re)) {
      const candidate = String(match[1] || "").trim();
      if (!candidate) continue;
      if (stopwords.has(candidate.toLowerCase())) continue;
      if (/[A-Z]/i.test(candidate) && !/[0-9]/.test(candidate)) continue;
      return candidate;
    }
  }
  return "-";
}

function getBestPreview(raw) {
  const textPlain = raw.match(/Content-Type:\s*text\/plain[\s\S]*?\n\n([\s\S]*?)(?=\n--|\nContent-Type:|$)/i);
  const textHtml = raw.match(/Content-Type:\s*text\/html[\s\S]*?\n\n([\s\S]*?)(?=\n--|\nContent-Type:|$)/i);
  const body = textPlain?.[1] || textHtml?.[1] || raw.split(/\r?\n\r?\n/).slice(1).join("\n\n") || raw;
  return cleanText(body).slice(0, 2200);
}

async function sendTelegram(env, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: String(chatId),
      text: String(text).slice(0, 4090),
      disable_web_page_preview: true
    })
  });
  if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
  return res;
}

async function getOwner(env) {
  const raw = await env.STATE_KV.get(OWNER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

async function setOwner(env, owner) {
  await env.STATE_KV.put(OWNER_KEY, JSON.stringify(owner));
}

function isOwnerMessage(msg, owner) {
  if (!msg || !owner) return false;
  const fromId = msg.from?.id != null ? String(msg.from.id) : "";
  const chatId = msg.chat?.id != null ? String(msg.chat.id) : "";
  return fromId === String(owner.userId) || chatId === String(owner.chatId);
}

function parseStartToken(text) {
  const parts = String(text || "").trim().split(/\s+/);
  return parts.length > 1 ? parts[1] : "";
}

function ownerStatusText(domain, owner) {
  if (!owner) return `Domain: ${domain}\nOwner: not claimed`;
  return [
    `Domain: ${domain}`,
    `Owner user id: ${owner.userId}`,
    `Owner chat id: ${owner.chatId}`,
    `Claimed at: ${owner.claimedAt || "-"}`
  ].join("\n");
}

async function handleTelegram(request, env) {
  if (request.method !== "POST") return new Response("telegram webhook ok", { status: 200 });
  if (!env.STATE_KV) return new Response("missing kv binding", { status: 500 });

  const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (env.WEBHOOK_SECRET && secretHeader !== env.WEBHOOK_SECRET) {
    return new Response("bad secret", { status: 403 });
  }

  const update = await request.json().catch(() => null);
  if (!update) return new Response("bad json", { status: 400 });

  const msg = update.message || update.edited_message || null;
  if (!msg) return new Response("ok", { status: 200 });

  const domain = env.DOMAIN || "example.com";
  const replyChatId = msg.chat?.id || msg.from?.id;
  if (!replyChatId) return new Response("ok", { status: 200 });

  const text = String(msg.text || "").trim();
  const owner = await getOwner(env);

  if (text.startsWith("/start")) {
    const startToken = parseStartToken(text);
    if (!owner) {
      if (msg.chat?.type !== "private") {
        await sendTelegram(env, replyChatId, "Owner claim must be done in private chat.");
        return new Response("ok", { status: 200 });
      }
      if (startToken !== "claim") {
        await sendTelegram(env, replyChatId, "Bot is not claimed yet. Use: /start claim");
        return new Response("ok", { status: 200 });
      }
      const claimedOwner = {
        userId: String(msg.from?.id || ""),
        chatId: String(msg.chat?.id || ""),
        claimedAt: new Date().toISOString(),
        domain
      };
      await setOwner(env, claimedOwner);
      await sendTelegram(env, replyChatId, `Owner claimed successfully.\n\n${ownerStatusText(domain, claimedOwner)}`);
      return new Response("ok", { status: 200 });
    }
    if (!isOwnerMessage(msg, owner)) {
      await sendTelegram(env, replyChatId, "This bot is already claimed by another owner.");
      return new Response("ok", { status: 200 });
    }
    await sendTelegram(env, replyChatId, `TempMail bot is active.\n\n${ownerStatusText(domain, owner)}`);
    return new Response("ok", { status: 200 });
  }

  if (!owner) {
    await sendTelegram(env, replyChatId, "Bot is not claimed yet. Use: /start claim");
    return new Response("ok", { status: 200 });
  }

  if (!isOwnerMessage(msg, owner)) {
    await sendTelegram(env, replyChatId, "Access denied. This bot is private.");
    return new Response("ok", { status: 200 });
  }

  if (text.startsWith("/new")) {
    const addr = `${randomLocal()}@${domain}`;
    await sendTelegram(
      env,
      replyChatId,
      `Temp email created:\n\n${addr}\n\nUse this address to receive OTP or verification email.`
    );
  } else if (text.startsWith("/status")) {
    await sendTelegram(env, replyChatId, ownerStatusText(domain, owner));
  } else if (text.startsWith("/whoami")) {
    await sendTelegram(env, replyChatId, `User ID: ${msg.from?.id}\nChat ID: ${msg.chat?.id}`);
  } else if (text.startsWith("/help") || !text) {
    await sendTelegram(
      env,
      replyChatId,
      `Commands:\n/start claim - claim owner (first use)\n/start - bot status\n/new - create random temp email\n/status - show runtime status\n/whoami - show your ids\n/help - help`
    );
  } else {
    await sendTelegram(env, replyChatId, "Unknown command. Use /help.");
  }
  return new Response("ok", { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      const owner = env.STATE_KV ? await getOwner(env) : null;
      return Response.json({
        ok: true,
        service: "telegram-tempmail",
        version: VERSION,
        domain: env.DOMAIN,
        ownerClaimed: Boolean(owner)
      });
    }
    if (url.pathname === `/tg/${env.WEBHOOK_SECRET}`) return handleTelegram(request, env);
    return new Response("not found", { status: 404 });
  },

  async email(message, env, ctx) {
    if (!env.STATE_KV) return;
    const owner = await getOwner(env);
    if (!owner?.chatId) return;

    const raw = await readRaw(message.raw);
    const from = decodeMimeWords(message.headers.get("from") || message.from || "-");
    const to = message.to || "-";
    const subject = decodeMimeWords(message.headers.get("subject") || "(no subject)");
    const preview = getBestPreview(raw);
    const code = extractLikelyCode(`${subject}\n${preview}\n${raw.slice(0, 4000)}`);
    const sizeKb = Math.ceil((message.rawSize || raw.length || 0) / 1024);

    const text = [
      "New email received",
      "",
      `To: ${to}`,
      `From: ${from}`,
      `Subject: ${subject}`,
      `Size: ${sizeKb} KB`,
      "",
      `Possible code: ${code}`,
      "",
      "Preview:",
      preview || "(no preview)"
    ].join("\n");

    ctx.waitUntil(sendTelegram(env, owner.chatId, text));
  }
};
