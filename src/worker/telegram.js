// Telegram Bot API transport + webhook/command handlers.

import {
  DOMAINS_KEY,
  formatDomainList,
  generateReadableLocal,
  getConfiguredDomains,
  getOwner,
  isOwnerMessage,
  ownerStatusText,
  parseNewAlias,
  parseStartToken,
  setOwner
} from "./domains.js";
import { hasMailDb, upsertAlias } from "./db.js";
import { issueLoginToken } from "./auth.js";
import { safeEqual } from "./utils.js";
import {
  CHATGPT_HELP_TEXT,
  CREATEGPT_HELP_TEXT,
  CREATEGPT_MAX_BATCH,
  isValidAlias,
  parseChatgptArgs,
  parseCreategptCount,
  triggerChatgptBatch,
  triggerChatgptSignup
} from "./chatgpt.js";

const TELEGRAM_API_ROOT = "https://api.telegram.org";

async function telegramApi(env, method, payload) {
  const res = await fetch(`${TELEGRAM_API_ROOT}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(`Telegram ${method} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

export async function sendTelegram(env, chatId, text, options = {}) {
  return telegramApi(env, "sendMessage", {
    chat_id: String(chatId),
    text: String(text).slice(0, 4090),
    disable_web_page_preview: true,
    ...options
  });
}

export async function answerCallbackQuery(env, callbackQueryId, text = "") {
  if (!callbackQueryId) return null;
  try {
    return await telegramApi(env, "answerCallbackQuery", {
      callback_query_id: String(callbackQueryId),
      text: String(text).slice(0, 200),
      show_alert: false
    });
  } catch {
    return null;
  }
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "➕ Buat email", callback_data: "new" },
        { text: "🌐 Pilih domain", callback_data: "domains" }
      ],
      [
        { text: "📬 Dashboard", callback_data: "web" },
        { text: "📊 Status", callback_data: "status" }
      ],
      [{ text: "❔ Bantuan", callback_data: "help" }]
    ]
  };
}

function domainPickerKeyboard(domains, prefix = "new") {
  const rows = domains.map((domain, index) => [
    { text: `@${domain}`, callback_data: `${prefix}:${index}` }
  ]);
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function aliasCreatedKeyboard(origin = "") {
  const rows = [[{ text: "➕ Buat lagi", callback_data: "new" }]];
  if (origin) rows.push([{ text: "📬 Buka dashboard", callback_data: "web" }]);
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function dashboardKeyboard(loginUrl) {
  return {
    inline_keyboard: [
      [{ text: "📬 Buka dashboard", url: loginUrl }],
      [{ text: "⬅️ Menu", callback_data: "menu" }]
    ]
  };
}

function statusKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "➕ Buat email", callback_data: "new" },
        { text: "📬 Dashboard", callback_data: "web" }
      ],
      [{ text: "⬅️ Menu", callback_data: "menu" }]
    ]
  };
}

function helpKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "➕ Buat email", callback_data: "new" },
        { text: "🌐 Pilih domain", callback_data: "domains" }
      ],
      [
        { text: "📬 Dashboard", callback_data: "web" },
        { text: "⬅️ Menu", callback_data: "menu" }
      ]
    ]
  };
}

function menuText(domain, owner, domains) {
  return [
    "⚡ TempMail Control Center",
    "",
    owner ? "Status: active" : "Status: not claimed",
    `Primary: ${domain}`,
    `Domains: ${formatDomainList(domains)}`,
    "",
    "Pilih tombol di bawah. Command manual tetap bisa dipakai."
  ].join("\n");
}

function helpText(domain, domains) {
  return [
    "Bantuan TempMail",
    "",
    "Tombol:",
    "➕ Buat email - generate alias readable",
    "🌐 Pilih domain - generate alias di domain tertentu",
    "📬 Dashboard - link login web private",
    "📊 Status - cek owner/domain",
    "",
    "Command manual:",
    "/menu - tampilkan menu tombol",
    "/new - buat alias readable",
    "/new hello - buat alias custom",
    `/new hello@${domain} - buat alias di domain tertentu`,
    "/chatgpt - auto-signup akun ChatGPT (lewat GitHub Actions)",
    "/chatgpt aisha.putra - alias custom",
    "/creategpt 5 - buat 5 akun ChatGPT sekaligus (max 10)",
    "/web - login dashboard",
    "/status - status runtime",
    "/whoami - tampilkan Telegram ID",
    "",
    `Domain aktif: ${formatDomainList(domains)}`
  ].join("\n");
}

async function sendMainMenu(env, chatId, domain, owner, domains) {
  return sendTelegram(env, chatId, menuText(domain, owner, domains), {
    reply_markup: mainMenuKeyboard()
  });
}

async function sendDomainPicker(env, chatId, domains) {
  return sendTelegram(env, chatId, "Pilih domain untuk membuat temp email:", {
    reply_markup: domainPickerKeyboard(domains)
  });
}

async function createAndSendAlias(env, chatId, alias, targetDomain, custom, origin = "") {
  const addr = `${alias}@${targetDomain}`;
  if (hasMailDb(env)) await upsertAlias(env, alias, "bot");
  await sendTelegram(
    env,
    chatId,
    [
      custom ? "✅ Custom temp email dibuat" : "✅ Temp email dibuat",
      "",
      addr,
      "",
      "Pakai alamat ini untuk menerima OTP/verifikasi. Email masuk akan dikirim ke Telegram dan dashboard."
    ].join("\n"),
    { reply_markup: aliasCreatedKeyboard(origin) }
  );
  return addr;
}

async function sendDashboardLogin(env, chatId, owner, origin) {
  const loginToken = await issueLoginToken(env, owner);
  const loginUrl = `${origin}/auth/telegram?token=${loginToken}`;
  return sendTelegram(
    env,
    chatId,
    `📬 Dashboard private\n\nLink login berlaku 10 menit:\n${loginUrl}`,
    { reply_markup: dashboardKeyboard(loginUrl) }
  );
}

async function handleCallback(request, env, callback, owner, domain, domains) {
  const chatId = callback.message?.chat?.id || callback.from?.id;
  if (!chatId) return new Response("ok", { status: 200 });
  const msgLike = {
    from: callback.from || {},
    chat: callback.message?.chat || { id: chatId, type: "private" }
  };

  if (!owner) {
    await answerCallbackQuery(env, callback.id, "Bot belum di-claim.");
    await sendTelegram(env, chatId, "Bot is not claimed yet. Use: /start claim");
    return new Response("ok", { status: 200 });
  }
  if (!isOwnerMessage(msgLike, owner)) {
    await answerCallbackQuery(env, callback.id, "Access denied.");
    return new Response("ok", { status: 200 });
  }

  const data = String(callback.data || "");
  const origin = new URL(request.url).origin;
  await answerCallbackQuery(env, callback.id, "OK");

  if (data === "menu") {
    await sendMainMenu(env, chatId, domain, owner, domains);
  } else if (data === "help") {
    await sendTelegram(env, chatId, helpText(domain, domains), {
      reply_markup: helpKeyboard()
    });
  } else if (data === "status") {
    await sendTelegram(
      env,
      chatId,
      `${ownerStatusText(domain, owner, domains)}\nDashboard: ${origin}/app`,
      { reply_markup: statusKeyboard() }
    );
  } else if (data === "web") {
    await sendDashboardLogin(env, chatId, owner, origin);
  } else if (data === "domains" || (data === "new" && domains.length > 1)) {
    await sendDomainPicker(env, chatId, domains);
  } else if (data === "new") {
    await createAndSendAlias(env, chatId, generateReadableLocal(), domain, false, origin);
  } else if (data.startsWith("new:")) {
    const index = Number(data.slice("new:".length));
    const targetDomain = Number.isInteger(index) ? domains[index] : "";
    if (!targetDomain) {
      await sendTelegram(env, chatId, "Domain tidak ditemukan. Buka menu lagi.", {
        reply_markup: mainMenuKeyboard()
      });
    } else {
      await createAndSendAlias(env, chatId, generateReadableLocal(), targetDomain, false, origin);
    }
  } else {
    await sendMainMenu(env, chatId, domain, owner, domains);
  }
  return new Response("ok", { status: 200 });
}

export async function handleTelegram(request, env) {
  if (request.method !== "POST") {
    return new Response("telegram webhook ok", { status: 200 });
  }
  if (!env.STATE_KV) return new Response("missing kv binding", { status: 500 });

  const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (env.WEBHOOK_SECRET && !safeEqual(secretHeader, env.WEBHOOK_SECRET)) {
    return new Response("bad secret", { status: 403 });
  }

  const update = await request.json().catch(() => null);
  if (!update) return new Response("bad json", { status: 400 });

  const domains = await getConfiguredDomains(env);
  const domain = domains[0] || env.DOMAIN || "example.com";
  const owner = await getOwner(env);

  if (update.callback_query) {
    return handleCallback(request, env, update.callback_query, owner, domain, domains);
  }

  const msg = update.message || update.edited_message || null;
  if (!msg) return new Response("ok", { status: 200 });

  const replyChatId = msg.chat?.id || msg.from?.id;
  if (!replyChatId) return new Response("ok", { status: 200 });

  const text = String(msg.text || "").trim();

  if (text.startsWith("/start") || text.startsWith("/menu")) {
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
      await sendTelegram(
        env,
        replyChatId,
        `Owner claimed successfully.\n\n${ownerStatusText(domain, claimedOwner, domains)}`,
        { reply_markup: mainMenuKeyboard() }
      );
      return new Response("ok", { status: 200 });
    }
    if (!isOwnerMessage(msg, owner)) {
      await sendTelegram(env, replyChatId, "This bot is already claimed by another owner.");
      return new Response("ok", { status: 200 });
    }
    await sendMainMenu(env, replyChatId, domain, owner, domains);
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

  const origin = new URL(request.url).origin;

  if (text.startsWith("/new")) {
    const alias = parseNewAlias(text);
    const targetDomain = alias.domain || domain;
    if (alias.error) {
      await sendTelegram(
        env,
        replyChatId,
        `${alias.error}\n\nUsage:\n/new\n/new hello\n/new hello-team\n/new hello.team@${domain}`
      );
      return new Response("ok", { status: 200 });
    }
    if (!domains.includes(targetDomain)) {
      await sendTelegram(
        env,
        replyChatId,
        `Domain is not configured for this app: ${targetDomain}\n\nConfigured domains:\n${formatDomainList(domains)}`
      );
      return new Response("ok", { status: 200 });
    }
    await createAndSendAlias(env, replyChatId, alias.local, targetDomain, alias.custom, origin);
  } else if (text.startsWith("/web")) {
    await sendDashboardLogin(env, replyChatId, owner, origin);
  } else if (text.startsWith("/status")) {
    await sendTelegram(
      env,
      replyChatId,
      `${ownerStatusText(domain, owner, domains)}\nDashboard: ${origin}/app`,
      { reply_markup: statusKeyboard() }
    );
  } else if (text.startsWith("/whoami")) {
    await sendTelegram(env, replyChatId, `User ID: ${msg.from?.id}\nChat ID: ${msg.chat?.id}`, {
      reply_markup: mainMenuKeyboard()
    });
  } else if (text.startsWith("/creategpt")) {
    const body = text.replace(/^\/creategpt(?:@\S+)?/, "").trim();
    if (!body || body === "help" || body === "-h" || body === "--help") {
      await sendTelegram(env, replyChatId, CREATEGPT_HELP_TEXT);
      return new Response("ok", { status: 200 });
    }
    const count = parseCreategptCount(body);
    if (count === null) {
      await sendTelegram(
        env,
        replyChatId,
        `Jumlah tidak valid. Pakai angka 1\u2013${CREATEGPT_MAX_BATCH}, contoh: /creategpt 5`
      );
      return new Response("ok", { status: 200 });
    }
    await sendTelegram(
      env,
      replyChatId,
      `\u23f3 Mulai membuat ${count} akun ChatGPT paralel (alias auto-generated)...`
    );
    const batch = await triggerChatgptBatch(env, replyChatId, count);
    if (!batch.ok) {
      const failedList = batch.failures.map((f) => `#${f.index}: ${f.error}`).join("\n");
      await sendTelegram(
        env,
        replyChatId,
        `\u26a0\ufe0f Hanya ${batch.dispatched}/${count} workflow ter-dispatch.\n${failedList}`
      );
      return new Response("ok", { status: 200 });
    }
    await sendTelegram(
      env,
      replyChatId,
      `\ud83d\ude80 ${count} workflow ter-dispatch. Kredensial + cookies + akun.txt akan dikirim begitu tiap akun selesai (~30\u201360 detik per akun).`
    );
  } else if (text.startsWith("/chatgpt")) {
    const body = text.replace(/^\/chatgpt(?:@\S+)?/, "").trim();
    if (body === "help" || body === "-h" || body === "--help") {
      await sendTelegram(env, replyChatId, CHATGPT_HELP_TEXT);
      return new Response("ok", { status: 200 });
    }
    const args = parseChatgptArgs(body);
    if (!isValidAlias(args.alias)) {
      await sendTelegram(
        env,
        replyChatId,
        "Alias tidak valid. Hanya huruf, angka, titik, dash, underscore."
      );
      return new Response("ok", { status: 200 });
    }
    const ack = args.alias
      ? `⏳ Memulai signup ChatGPT untuk alias: ${args.alias}@${domain}`
      : `⏳ Memulai signup ChatGPT (mode: ${args.mode}, alias auto-generated)`;
    await sendTelegram(env, replyChatId, ack);
    const dispatch = await triggerChatgptSignup(env, replyChatId, args);
    if (!dispatch.ok) {
      await sendTelegram(env, replyChatId, `❌ Gagal trigger workflow: ${dispatch.error}`);
      return new Response("ok", { status: 200 });
    }
    await sendTelegram(
      env,
      replyChatId,
      `🚀 Workflow di-trigger di ${dispatch.repo}. Kredensial + cookies akan dikirim ~30 detik lagi.`
    );
  } else if (text.startsWith("/help") || !text) {
    await sendTelegram(env, replyChatId, helpText(domain, domains), {
      reply_markup: helpKeyboard()
    });
  } else {
    await sendTelegram(env, replyChatId, "Unknown command. Use /help atau /menu.", {
      reply_markup: mainMenuKeyboard()
    });
  }
  return new Response("ok", { status: 200 });
}

// Re-exported for tests / tooling.
export { DOMAINS_KEY };
