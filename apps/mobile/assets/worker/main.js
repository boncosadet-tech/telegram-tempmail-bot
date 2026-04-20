const VERSION = "2026-04-19-telegram-tempmail-v3";
const OWNER_KEY = "owner";
const DOMAINS_KEY = "domains";
const LOGIN_PREFIX = "login:";
const SESSION_PREFIX = "session:";
const SESSION_COOKIE = "tt_session";
const LOGIN_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const OTP_RETENTION_MS = 30 * 60 * 1000;
const MAIL_RETENTION_MS = 24 * 60 * 60 * 1000;
const ALIAS_ADJECTIVES = ["amber", "brisk", "calm", "clever", "dawn", "ember", "lunar", "nova", "quiet", "swift"];
const ALIAS_NOUNS = ["field", "forest", "harbor", "meadow", "orbit", "river", "signal", "spring", "valley", "wave"];
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    alias_local TEXT NOT NULL,
    alias_full TEXT NOT NULL,
    sender TEXT NOT NULL,
    subject TEXT NOT NULL,
    preview_text TEXT NOT NULL,
    rendered_html TEXT NOT NULL DEFAULT '',
    otp_code TEXT NOT NULL DEFAULT '-',
    is_otp INTEGER NOT NULL DEFAULT 0,
    size_kb INTEGER NOT NULL DEFAULT 0,
    raw_kind TEXT NOT NULL DEFAULT 'unknown',
    received_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages (received_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_messages_alias_local ON messages (alias_local, received_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages (expires_at)",
  `CREATE TABLE IF NOT EXISTS aliases (
    alias_local TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    is_pinned INTEGER NOT NULL DEFAULT 0
  )`
];

function htmlDecode(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function randomItem(items) {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return items[bytes[0] % items.length];
}

function randomDigits(length = 4) {
  const digits = [];
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const value of bytes) digits.push(String(value % 10));
  return digits.join("");
}

function randomToken(length = 40) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[value % 64]).join("");
}

function generateReadableLocal() {
  return `${randomItem(ALIAS_ADJECTIVES)}-${randomItem(ALIAS_NOUNS)}-${randomDigits(4)}`;
}

function sanitizeRequestedLocal(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  const localOnly = raw.split("@")[0];
  const sanitized = localOnly
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[._-]{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 48);
  if (!sanitized) return "";
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(sanitized)) return "";
  return sanitized;
}

function normalizeDomainName(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/^@+/, "")
    .replace(/\.+$/g, "");
}

function formatDomainList(domains) {
  return domains.length > 0 ? domains.join(", ") : "-";
}

async function getConfiguredDomains(env) {
  const domains = [];
  const add = (value) => {
    const domain = normalizeDomainName(value);
    if (domain && !domains.includes(domain)) domains.push(domain);
  };
  add(env.DOMAIN || "example.com");
  if (env.STATE_KV) {
    const raw = await env.STATE_KV.get(DOMAINS_KEY).catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const values = Array.isArray(parsed) ? parsed : parsed?.domains;
        if (Array.isArray(values)) {
          for (const value of values) add(value);
        }
      } catch (_error) {
        // Ignore malformed optional domain list and keep the primary DOMAIN binding.
      }
    }
  }
  return domains;
}

function parseNewAlias(text) {
  const parts = String(text || "").trim().split(/\s+/).slice(1);
  if (parts.length === 0) return { local: generateReadableLocal(), domain: "", custom: false };
  const raw = parts.join("-").trim().toLowerCase();
  const requestedDomain = raw.includes("@") ? normalizeDomainName(raw.split("@").slice(1).join("@")) : "";
  const requested = sanitizeRequestedLocal(raw);
  if (!requested) {
    return { local: "", domain: requestedDomain, custom: true, error: "Custom alias only supports letters, numbers, dot, dash, and underscore." };
  }
  return { local: requested, domain: requestedDomain, custom: true };
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

function extractHtmlBody(raw) {
  const textHtml = raw.match(/Content-Type:\s*text\/html[\s\S]*?\n\n([\s\S]*?)(?=\n--|\nContent-Type:|$)/i);
  return textHtml?.[1] || "";
}

function sanitizeUrl(href) {
  const value = String(href || "").trim();
  if (!value) return "";
  if (/^(https?:|mailto:)/i.test(value)) return value;
  return "";
}

function renderInlineText(text) {
  const placeholderPattern = /\[\[LINK:([^\]|]+)\|([^\]]+)\]\]/g;
  const pieces = [];
  let lastIndex = 0;
  for (const match of String(text || "").matchAll(placeholderPattern)) {
    const index = match.index ?? 0;
    const prefix = text.slice(lastIndex, index);
    pieces.push(
      escapeHtml(prefix).replace(
        /((?:https?:\/\/|mailto:)[^\s<]+)/gi,
        (value) => `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`
      )
    );
    const safeHref = sanitizeUrl(match[2]);
    const label = escapeHtml(match[1]);
    pieces.push(safeHref ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label);
    lastIndex = index + match[0].length;
  }
  const suffix = text.slice(lastIndex);
  pieces.push(
    escapeHtml(suffix).replace(
      /((?:https?:\/\/|mailto:)[^\s<]+)/gi,
      (value) => `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`
    )
  );
  return pieces.join("");
}

function htmlToDisplayText(html) {
  return cleanText(
    String(html || "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|head|iframe|object|embed|svg|canvas|form|button|input|textarea|select)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<a\b[^>]*href=(['"]?)([^"' >]+)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, href, inner) => {
        const text = cleanText(inner);
        const safeHref = sanitizeUrl(href);
        return safeHref ? ` [[LINK:${text}|${safeHref}]] ` : text;
      })
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|table|tr|blockquote|pre|h1|h2|h3|h4|h5|h6)>/gi, "\n\n")
      .replace(/<(li)\b[^>]*>/gi, "\n• ")
  );
}

function textToDisplayHtml(text) {
  const normalized = String(text || "").replace(/\r/g, "").trim();
  if (!normalized) {
    return '<p class="email-empty">(no content)</p>';
  }

  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const parts = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const isList = lines.length > 1 && lines.every((line) => line.startsWith("• "));
    if (isList) {
      parts.push(`<ul>${lines.map((line) => `<li>${renderInlineText(line.slice(2))}</li>`).join("")}</ul>`);
      continue;
    }
    if (lines.length === 1 && lines[0].startsWith("• ")) {
      parts.push(`<ul><li>${renderInlineText(lines[0].slice(2))}</li></ul>`);
      continue;
    }
    parts.push(`<p>${lines.map((line) => renderInlineText(line)).join("<br>")}</p>`);
  }
  return parts.join("");
}

function renderEmailHtml(raw, previewText) {
  const htmlBody = extractHtmlBody(raw);
  const text = htmlBody ? htmlToDisplayText(htmlBody) : String(previewText || "");
  return textToDisplayHtml(text);
}

function getRawKind(raw) {
  if (/Content-Type:\s*text\/html/i.test(raw)) return "text/html";
  if (/Content-Type:\s*text\/plain/i.test(raw)) return "text/plain";
  if (/multipart\//i.test(raw)) return "multipart";
  return "unknown";
}

function aliasLocalFromAddress(address) {
  return String(address || "").split("@")[0].trim().toLowerCase();
}

function nowMs() {
  return Date.now();
}

async function telegramApi(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Telegram ${method} failed: ${res.status} ${await res.text()}`);
  return res;
}

async function sendTelegram(env, chatId, text, options = {}) {
  return telegramApi(env, "sendMessage", {
    chat_id: String(chatId),
    text: String(text).slice(0, 4090),
    disable_web_page_preview: true,
    ...options
  });
}

async function answerCallbackQuery(env, callbackQueryId, text = "") {
  if (!callbackQueryId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        callback_query_id: String(callbackQueryId),
        text: String(text).slice(0, 200),
        show_alert: false
      })
    });
    return res.ok ? res : null;
  } catch (_error) {
    return null;
  }
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

async function waitUntilOrRun(ctx, promise) {
  if (typeof ctx?.waitUntil === "function") {
    ctx.waitUntil(promise);
    return;
  }
  await promise;
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

function ownerStatusText(domain, owner, domains = [domain]) {
  const domainLines = [`Primary domain: ${domain}`, `Domains: ${formatDomainList(domains)}`];
  if (!owner) return `${domainLines.join("\n")}\nOwner: not claimed`;
  return [
    ...domainLines,
    `Owner user id: ${owner.userId}`,
    `Owner chat id: ${owner.chatId}`,
    `Claimed at: ${owner.claimedAt || "-"}`
  ].join("\n");
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "➕ Buat email", callback_data: "new" }, { text: "🌐 Pilih domain", callback_data: "domains" }],
      [{ text: "📬 Dashboard", callback_data: "web" }, { text: "📊 Status", callback_data: "status" }],
      [{ text: "❔ Bantuan", callback_data: "help" }]
    ]
  };
}

function domainPickerKeyboard(domains, prefix = "new") {
  const rows = domains.map((domain, index) => ([{
    text: `@${domain}`,
    callback_data: `${prefix}:${index}`
  }]));
  rows.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function aliasCreatedKeyboard(origin = "") {
  const row = [{ text: "➕ Buat lagi", callback_data: "new" }];
  const rows = [row];
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
      [{ text: "➕ Buat email", callback_data: "new" }, { text: "📬 Dashboard", callback_data: "web" }],
      [{ text: "⬅️ Menu", callback_data: "menu" }]
    ]
  };
}

function helpKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "➕ Buat email", callback_data: "new" }, { text: "🌐 Pilih domain", callback_data: "domains" }],
      [{ text: "📬 Dashboard", callback_data: "web" }, { text: "⬅️ Menu", callback_data: "menu" }]
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

async function handleTelegramCallback(request, env, callback, owner, domain, domains) {
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
    return new Response("ok", { status: 200 });
  }

  if (data === "help") {
    await sendTelegram(env, chatId, helpText(domain, domains), { reply_markup: helpKeyboard() });
    return new Response("ok", { status: 200 });
  }

  if (data === "status") {
    await sendTelegram(env, chatId, `${ownerStatusText(domain, owner, domains)}\nDashboard: ${origin}/app`, {
      reply_markup: statusKeyboard()
    });
    return new Response("ok", { status: 200 });
  }

  if (data === "web") {
    await sendDashboardLogin(env, chatId, owner, origin);
    return new Response("ok", { status: 200 });
  }

  if (data === "domains" || (data === "new" && domains.length > 1)) {
    await sendDomainPicker(env, chatId, domains);
    return new Response("ok", { status: 200 });
  }

  if (data === "new") {
    await createAndSendAlias(env, chatId, generateReadableLocal(), domain, false, origin);
    return new Response("ok", { status: 200 });
  }

  if (data.startsWith("new:")) {
    const index = Number(data.slice("new:".length));
    const targetDomain = Number.isInteger(index) ? domains[index] : "";
    if (!targetDomain) {
      await sendTelegram(env, chatId, "Domain tidak ditemukan. Buka menu lagi.", { reply_markup: mainMenuKeyboard() });
      return new Response("ok", { status: 200 });
    }
    await createAndSendAlias(env, chatId, generateReadableLocal(), targetDomain, false, origin);
    return new Response("ok", { status: 200 });
  }

  await sendMainMenu(env, chatId, domain, owner, domains);
  return new Response("ok", { status: 200 });
}

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  return Object.fromEntries(
    header.split(/;\s*/).filter(Boolean).map((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return [part, ""];
      return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
    })
  );
}

function sessionCookie(value, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function issueLoginToken(env, owner) {
  const token = randomToken(48);
  await env.STATE_KV.put(`${LOGIN_PREFIX}${token}`, JSON.stringify({ ownerUserId: owner.userId, createdAt: new Date().toISOString() }), {
    expirationTtl: LOGIN_TTL_SECONDS
  });
  return token;
}

async function consumeLoginToken(env, token) {
  const key = `${LOGIN_PREFIX}${token}`;
  const raw = await env.STATE_KV.get(key);
  if (!raw) return null;
  if (typeof env.STATE_KV.delete === "function") {
    await env.STATE_KV.delete(key);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function createSession(env, owner) {
  const token = randomToken(48);
  await env.STATE_KV.put(`${SESSION_PREFIX}${token}`, JSON.stringify({
    userId: owner.userId,
    chatId: owner.chatId,
    createdAt: new Date().toISOString()
  }), { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

async function getSession(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const raw = await env.STATE_KV.get(`${SESSION_PREFIX}${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasMailDb(env) {
  return Boolean(env?.MAIL_DB && typeof env.MAIL_DB.prepare === "function");
}

async function runDb(env, sql, params = []) {
  if (!hasMailDb(env)) return null;
  const stmt = env.MAIL_DB.prepare(sql);
  const bound = params.length > 0 ? stmt.bind(...params) : stmt;
  return bound.run();
}

async function allDb(env, sql, params = []) {
  if (!hasMailDb(env)) return [];
  const stmt = env.MAIL_DB.prepare(sql);
  const bound = params.length > 0 ? stmt.bind(...params) : stmt;
  const result = await bound.all();
  return result?.results || [];
}

async function firstDb(env, sql, params = []) {
  if (!hasMailDb(env)) return null;
  const stmt = env.MAIL_DB.prepare(sql);
  const bound = params.length > 0 ? stmt.bind(...params) : stmt;
  return bound.first();
}

async function ensureMailDb(env) {
  if (!hasMailDb(env) || env.__mailDbReady) return;
  for (const statement of SCHEMA_STATEMENTS) {
    await runDb(env, statement);
  }
  try {
    await runDb(env, "ALTER TABLE messages ADD COLUMN rendered_html TEXT NOT NULL DEFAULT ''");
  } catch (error) {
    if (!String(error?.message || error).includes("duplicate column")) {
      throw error;
    }
  }
  env.__mailDbReady = true;
}

async function purgeExpiredMessages(env) {
  if (!hasMailDb(env)) return 0;
  await ensureMailDb(env);
  const result = await runDb(env, "DELETE FROM messages WHERE expires_at <= ?", [nowMs()]);
  return result?.meta?.changes || 0;
}

async function upsertAlias(env, aliasLocal, source = "web") {
  if (!hasMailDb(env) || !aliasLocal) return;
  await ensureMailDb(env);
  const ts = nowMs();
  await runDb(
    env,
    `INSERT INTO aliases (alias_local, source, created_at, last_seen_at, is_pinned)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(alias_local) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    [aliasLocal, source, ts, ts]
  );
}

async function insertMessage(env, message) {
  if (!hasMailDb(env)) return;
  await ensureMailDb(env);
  await runDb(
    env,
    `INSERT INTO messages (
      id, alias_local, alias_full, sender, subject, preview_text, rendered_html, otp_code,
      is_otp, size_kb, raw_kind, received_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.aliasLocal,
      message.aliasFull,
      message.sender,
      message.subject,
      message.previewText,
      message.renderedHtml,
      message.otpCode,
      message.isOtp ? 1 : 0,
      message.sizeKb,
      message.rawKind,
      message.receivedAt,
      message.expiresAt
    ]
  );
}

async function listMessages(env, aliasFilter = "") {
  await ensureMailDb(env);
  await purgeExpiredMessages(env);
  const rows = aliasFilter
    ? await allDb(
        env,
        `SELECT id, alias_local, alias_full, sender, subject, preview_text, rendered_html, otp_code, is_otp, size_kb, raw_kind, received_at, expires_at
         FROM messages WHERE alias_local = ? ORDER BY received_at DESC LIMIT 100`,
        [aliasFilter]
      )
    : await allDb(
        env,
        `SELECT id, alias_local, alias_full, sender, subject, preview_text, rendered_html, otp_code, is_otp, size_kb, raw_kind, received_at, expires_at
         FROM messages ORDER BY received_at DESC LIMIT 100`
      );
  return rows;
}

async function getMessageById(env, id) {
  await ensureMailDb(env);
  await purgeExpiredMessages(env);
  return firstDb(
    env,
    `SELECT id, alias_local, alias_full, sender, subject, preview_text, rendered_html, otp_code, is_otp, size_kb, raw_kind, received_at, expires_at
     FROM messages WHERE id = ? LIMIT 1`,
    [id]
  );
}

async function deleteMessageById(env, id) {
  await ensureMailDb(env);
  return runDb(env, "DELETE FROM messages WHERE id = ?", [id]);
}

async function purgeOtpMessages(env) {
  await ensureMailDb(env);
  return runDb(env, "DELETE FROM messages WHERE is_otp = 1");
}

async function purgeAllMessages(env) {
  await ensureMailDb(env);
  return runDb(env, "DELETE FROM messages");
}

async function listAliases(env) {
  await ensureMailDb(env);
  return allDb(env, "SELECT alias_local, source, created_at, last_seen_at, is_pinned FROM aliases ORDER BY last_seen_at DESC LIMIT 100");
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) }
  });
}

function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } });
}

async function parseJsonBody(request) {
  return request.json().catch(() => ({}));
}

function unauthorizedJson() {
  return json({ ok: false, error: "unauthorized" }, { status: 401 });
}

async function requireOwnerSession(request, env) {
  const session = await getSession(request, env);
  const owner = await getOwner(env);
  if (!session || !owner) return null;
  if (String(session.userId) !== String(owner.userId)) return null;
  return { session, owner };
}

function renderLoginPage(domain) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>TempMail Login</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(255, 214, 69, .55), transparent 34rem),
        linear-gradient(135deg, #fff8d7 0%, #ffe182 42%, #fbbf24 100%);
      color: #171717;
      margin: 0;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      max-width: 720px;
      margin: 8vh auto;
      background: rgba(255,255,255,.92);
      border: 3px solid #171717;
      border-radius: 28px;
      padding: 30px;
      box-shadow: 10px 10px 0 #171717;
    }
    .badge { display: inline-flex; align-items: center; gap: 8px; background: #171717; color: #ffd84d; padding: 8px 12px; border-radius: 999px; font-weight: 800; }
    h1 { font-size: clamp(32px, 6vw, 54px); line-height: .95; margin: 18px 0 12px; letter-spacing: -2px; }
    p { color: #3f3f46; font-size: 17px; line-height: 1.6; }
    code { background: #fff3bf; border: 2px solid #171717; padding: 3px 8px; border-radius: 8px; font-weight: 800; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">⚡ Owner only</div>
    <h1>Private TempMail Dashboard</h1>
    <p>Domain: <strong>${escapeHtml(domain)}</strong></p>
    <p>Dashboard ini private. Untuk login, buka bot Telegram kamu lalu kirim <code>/web</code>.</p>
    <p>Bot akan mengirim link login sekali pakai yang langsung membuka dashboard owner-only.</p>
  </div>
</body>
</html>`;
}

function renderAppPage(domain) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>TempMail Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #171717;
      --muted: #6b5f3f;
      --paper: #fffef7;
      --cream: #fff7d1;
      --yellow: #ffd84d;
      --yellow-2: #ffbd1f;
      --orange: #ff8a00;
      --line: #171717;
      --soft-line: rgba(23,23,23,.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 8% 4%, rgba(255, 235, 120, .8), transparent 26rem),
        radial-gradient(circle at 96% 8%, rgba(255, 138, 0, .22), transparent 30rem),
        linear-gradient(135deg, #fffdf2 0%, #fff1a8 48%, #ffc83d 100%);
      color: var(--ink);
      min-height: 100vh;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      padding: 18px 22px;
      margin: 18px;
      background: linear-gradient(135deg, #fffef7, #ffe17a);
      border: 3px solid var(--line);
      border-radius: 28px;
      box-shadow: 8px 8px 0 var(--line);
    }
    .brand { display: flex; align-items: center; gap: 14px; }
    .brand-mark { width: 52px; height: 52px; display: grid; place-items: center; border: 3px solid var(--line); border-radius: 18px; background: var(--ink); color: var(--yellow); font-size: 26px; box-shadow: 4px 4px 0 var(--yellow-2); }
    .title-eyebrow { font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: .12em; color: #8a5a00; }
    h1, h2, h3 { margin: 0 0 12px; letter-spacing: -.03em; }
    h1 { margin: 0; font-size: clamp(26px, 3vw, 38px); line-height: .95; }
    .domain-chip { display: inline-flex; margin-top: 8px; background: #171717; color: #fff3bf; border-radius: 999px; padding: 5px 10px; font-weight: 800; font-size: 13px; }
    .wrap { display: grid; grid-template-columns: minmax(320px, 390px) 1fr; gap: 18px; padding: 0 18px 18px; min-height: calc(100vh - 122px); }
    aside, main { min-width: 0; }
    .muted { color: var(--muted); font-size: 14px; }
    .stack { display: grid; gap: 14px; }
    .card { background: rgba(255,255,255,.93); border: 3px solid var(--line); border-radius: 24px; padding: 16px; box-shadow: 6px 6px 0 rgba(23,23,23,.9); }
    input, select, button, textarea {
      width: 100%;
      background: var(--paper);
      color: var(--ink);
      border: 2px solid var(--line);
      border-radius: 16px;
      padding: 12px 13px;
      font: inherit;
    }
    button { cursor: pointer; font-weight: 900; transition: transform .12s ease, box-shadow .12s ease, background .12s ease; }
    button:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--line); }
    button.primary { background: linear-gradient(135deg, var(--yellow), var(--yellow-2)); border-color: var(--line); }
    .row { display: flex; gap: 10px; }
    .row > * { flex: 1; }
    .messages { display: grid; gap: 12px; max-height: 66vh; overflow: auto; padding-right: 3px; }
    .message { border: 2px solid var(--line); border-radius: 18px; padding: 13px; background: #fffdf4; cursor: pointer; text-align: left; box-shadow: 3px 3px 0 rgba(23,23,23,.55); }
    .message.active { background: #fff1a8; box-shadow: 5px 5px 0 var(--line); }
    .pill { display: inline-block; border-radius: 999px; padding: 3px 9px; background: var(--ink); color: var(--yellow); font-weight: 900; font-size: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #fffdf4; padding: 12px; border-radius: 18px; border: 2px solid var(--soft-line); color: #3f3f46; }
    .email-surface { background: #ffffff; color: #202124; border: 2px solid var(--line); border-radius: 20px; padding: 20px; line-height: 1.65; box-shadow: inset 0 0 0 1px rgba(23,23,23,.05); }
    .email-surface p { margin: 0 0 14px; }
    .email-surface ul { margin: 0 0 14px 18px; padding: 0; }
    .email-surface li { margin-bottom: 6px; }
    .email-surface a { color: #1a73e8; text-decoration: underline; font-weight: 700; }
    .email-empty { color: #71717a; font-style: italic; }
    @media (max-width: 920px) { header { margin: 12px; } .wrap { grid-template-columns: 1fr; padding: 0 12px 12px; } .row { flex-wrap: wrap; } }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-mark">✉</div>
      <div>
        <div class="title-eyebrow">private tempmail</div>
        <h1>Dashboard</h1>
        <div class="domain-chip">${escapeHtml(domain)}</div>
      </div>
    </div>
    <div class="row" style="width: 240px;">
      <button id="refreshBtn">Refresh</button>
      <button id="logoutBtn">Logout</button>
    </div>
  </header>
  <div class="wrap">
    <aside class="stack">
      <div class="card stack">
        <h3>Create alias</h3>
        <div class="muted">Kosongkan untuk alias readable otomatis.</div>
        <input id="aliasInput" placeholder="hello atau hello.team" />
        <select id="aliasDomainSelect"></select>
        <button class="primary" id="createAliasBtn">Create alias</button>
        <div id="aliasResult" class="muted"></div>
      </div>
      <div class="card stack">
        <h3>Aliases</h3>
        <select id="aliasFilter"><option value="">All aliases</option></select>
      </div>
      <div class="card stack">
        <h3>Cleanup</h3>
        <button id="purgeOtpBtn">Delete all OTP history</button>
        <button id="purgeAllBtn">Delete all history</button>
      </div>
      <div class="card stack">
        <h3>Inbox</h3>
        <div class="muted" id="messageCount">Loading...</div>
        <div class="messages" id="messages"></div>
      </div>
    </aside>
    <main class="stack">
      <div class="card stack">
        <h2 id="detailSubject">Select a message</h2>
        <div class="muted" id="detailMeta">No message selected.</div>
        <div id="detailOtp"></div>
        <div id="detailHtml" class="email-surface"><p class="email-empty">Inbox preview will appear here.</p></div>
        <pre id="detailPreview">Inbox preview text will appear here.</pre>
        <div class="row">
          <button id="deleteBtn" disabled>Delete message</button>
        </div>
      </div>
    </main>
  </div>
  <script>
    const state = { messages: [], selectedId: null };

    async function api(path, options = {}) {
      const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
        ...options,
      });
      if (response.status === 401) {
        location.href = '/login';
        throw new Error('Unauthorized');
      }
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) return response.json();
      return response.text();
    }

    function formatTime(value) {
      return new Date(value).toLocaleString();
    }

    function renderMessages() {
      const root = document.getElementById('messages');
      const count = document.getElementById('messageCount');
      count.textContent = state.messages.length + ' message(s)';
      root.innerHTML = '';
      for (const message of state.messages) {
        const item = document.createElement('button');
        item.className = 'message' + (state.selectedId === message.id ? ' active' : '');
        item.innerHTML = [
          '<div style=\"display:flex;justify-content:space-between;gap:8px;align-items:center;\">',
          '<strong>' + message.alias_full + '</strong>',
          (message.is_otp ? '<span class=\"pill\">OTP</span>' : ''),
          '</div>',
          '<div>' + message.subject + '</div>',
          '<div class=\"muted\">' + message.sender + '</div>',
          '<div class=\"muted\">' + formatTime(message.received_at) + '</div>'
        ].join('');
        item.onclick = () => selectMessage(message.id);
        root.appendChild(item);
      }
    }

    async function loadAliases() {
      const data = await api('/api/aliases');
      const select = document.getElementById('aliasFilter');
      const domainSelect = document.getElementById('aliasDomainSelect');
      const current = select.value;
      select.innerHTML = '<option value="">All aliases</option>';
      domainSelect.innerHTML = '';
      for (const domain of data.domains || [data.domain]) {
        const option = document.createElement('option');
        option.value = domain;
        option.textContent = '@' + domain;
        domainSelect.appendChild(option);
      }
      for (const alias of data.aliases) {
        const option = document.createElement('option');
        option.value = alias.alias_local;
        option.textContent = alias.alias_local + '@' + data.domain;
        if (alias.alias_local === current) option.selected = true;
        select.appendChild(option);
      }
    }

    async function loadMessages() {
      const alias = document.getElementById('aliasFilter').value;
      const data = await api('/api/messages' + (alias ? '?alias=' + encodeURIComponent(alias) : ''));
      state.messages = data.messages;
      if (!state.messages.find((item) => item.id === state.selectedId)) {
        state.selectedId = state.messages[0]?.id || null;
      }
      renderMessages();
      if (state.selectedId) {
        await selectMessage(state.selectedId);
      } else {
        resetDetail();
      }
    }

    function resetDetail() {
      document.getElementById('detailSubject').textContent = 'Select a message';
      document.getElementById('detailMeta').textContent = 'No message selected.';
      document.getElementById('detailOtp').innerHTML = '';
      document.getElementById('detailHtml').innerHTML = '<p class=\"email-empty\">Inbox preview will appear here.</p>';
      document.getElementById('detailPreview').textContent = 'Inbox preview text will appear here.';
      document.getElementById('deleteBtn').disabled = true;
    }

    async function selectMessage(id) {
      state.selectedId = id;
      renderMessages();
      const data = await api('/api/messages/' + encodeURIComponent(id));
      const message = data.message;
      document.getElementById('detailSubject').textContent = message.subject;
      document.getElementById('detailMeta').textContent = message.alias_full + ' • ' + message.sender + ' • ' + formatTime(message.received_at);
      document.getElementById('detailOtp').innerHTML = message.is_otp ? '<span class=\"pill\">OTP ' + message.otp_code + '</span>' : '';
      document.getElementById('detailHtml').innerHTML = message.rendered_html || '<p class=\"email-empty\">(no html preview)</p>';
      document.getElementById('detailPreview').textContent = message.preview_text || '(no preview)';
      document.getElementById('deleteBtn').disabled = false;
    }

    async function init() {
      await api('/api/session');
      await loadAliases();
      await loadMessages();
    }

    document.getElementById('refreshBtn').onclick = async () => { await loadAliases(); await loadMessages(); };
    document.getElementById('aliasFilter').onchange = async () => { await loadMessages(); };
    document.getElementById('createAliasBtn').onclick = async () => {
      const alias = document.getElementById('aliasInput').value;
      const domain = document.getElementById('aliasDomainSelect').value;
      const data = await api('/api/aliases', { method: 'POST', body: JSON.stringify({ alias, domain }) });
      document.getElementById('aliasResult').textContent = data.address;
      document.getElementById('aliasInput').value = '';
      await loadAliases();
      await loadMessages();
    };
    document.getElementById('deleteBtn').onclick = async () => {
      if (!state.selectedId) return;
      await api('/api/messages/' + encodeURIComponent(state.selectedId), { method: 'DELETE' });
      state.selectedId = null;
      await loadMessages();
    };
    document.getElementById('purgeOtpBtn').onclick = async () => {
      await api('/api/messages/purge-otp', { method: 'POST', body: '{}' });
      state.selectedId = null;
      await loadMessages();
    };
    document.getElementById('purgeAllBtn').onclick = async () => {
      await api('/api/messages/purge-all', { method: 'POST', body: '{}' });
      state.selectedId = null;
      await loadMessages();
    };
    document.getElementById('logoutBtn').onclick = async () => {
      await api('/logout', { method: 'POST', body: '{}' });
      location.href = '/login';
    };

    init().catch((error) => {
      console.error(error);
      resetDetail();
    });
  </script>
</body>
</html>`;
}

async function handleLoginPage(request, env) {
  const session = await getSession(request, env);
  if (session) return redirect("/app");
  return new Response(renderLoginPage(env.DOMAIN || "example.com"), {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

async function handleAppPage(request, env) {
  const auth = await requireOwnerSession(request, env);
  if (!auth) return redirect("/login");
  return new Response(renderAppPage(env.DOMAIN || "example.com"), {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

async function handleAuthTelegram(request, env) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!token) return new Response("Missing login token", { status: 400 });
  const owner = await getOwner(env);
  const payload = await consumeLoginToken(env, token);
  if (!payload || !owner || String(payload.ownerUserId) !== String(owner.userId)) {
    return new Response("Invalid or expired login token", { status: 403 });
  }
  const sessionToken = await createSession(env, owner);
  return redirect("/app", { "Set-Cookie": sessionCookie(sessionToken) });
}

async function handleLogout() {
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}

async function handleApi(request, env) {
  const auth = await requireOwnerSession(request, env);
  if (!auth) return unauthorizedJson();
  if (!hasMailDb(env)) {
    return json({ ok: false, error: "mail database not configured" }, { status: 503 });
  }

  await ensureMailDb(env);
  await purgeExpiredMessages(env);

  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const pathname = url.pathname;

  if (pathname === "/api/session" && method === "GET") {
    const domains = await getConfiguredDomains(env);
    return json({
      ok: true,
      domain: domains[0] || env.DOMAIN,
      domains,
      owner: auth.owner,
      hasMailDb: true
    });
  }

  if (pathname === "/api/messages" && method === "GET") {
    const alias = sanitizeRequestedLocal(url.searchParams.get("alias") || "");
    const messages = await listMessages(env, alias);
    return json({ ok: true, messages });
  }

  if (pathname === "/api/messages/purge-otp" && method === "POST") {
    await purgeOtpMessages(env);
    return json({ ok: true });
  }

  if (pathname === "/api/messages/purge-all" && method === "POST") {
    await purgeAllMessages(env);
    return json({ ok: true });
  }

  if (pathname.startsWith("/api/messages/") && method === "GET") {
    const id = pathname.slice("/api/messages/".length);
    const message = await getMessageById(env, id);
    if (!message) return json({ ok: false, error: "not found" }, { status: 404 });
    return json({ ok: true, message });
  }

  if (pathname.startsWith("/api/messages/") && method === "DELETE") {
    const id = pathname.slice("/api/messages/".length);
    await deleteMessageById(env, id);
    return json({ ok: true });
  }

  if (pathname === "/api/aliases" && method === "GET") {
    const domains = await getConfiguredDomains(env);
    const aliases = await listAliases(env);
    return json({ ok: true, domain: domains[0] || env.DOMAIN, domains, aliases });
  }

  if (pathname === "/api/aliases" && method === "POST") {
    const domains = await getConfiguredDomains(env);
    const body = await parseJsonBody(request);
    const local = body.alias ? sanitizeRequestedLocal(body.alias) : generateReadableLocal();
    const requestedDomain = normalizeDomainName(body.domain || domains[0] || env.DOMAIN);
    if (!local) {
      return json({ ok: false, error: "invalid alias" }, { status: 400 });
    }
    if (!domains.includes(requestedDomain)) {
      return json({ ok: false, error: "domain is not configured" }, { status: 400 });
    }
    await upsertAlias(env, local, "web");
    return json({ ok: true, address: `${local}@${requestedDomain}` });
  }

  return json({ ok: false, error: "not found" }, { status: 404 });
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

  const domains = await getConfiguredDomains(env);
  const domain = domains[0] || env.DOMAIN || "example.com";
  const owner = await getOwner(env);

  const callback = update.callback_query || null;
  if (callback) {
    return handleTelegramCallback(request, env, callback, owner, domain, domains);
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
      await sendTelegram(env, replyChatId, `Owner claimed successfully.\n\n${ownerStatusText(domain, claimedOwner, domains)}`, {
        reply_markup: mainMenuKeyboard()
      });
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
    await createAndSendAlias(env, replyChatId, alias.local, targetDomain, alias.custom, new URL(request.url).origin);
  } else if (text.startsWith("/web")) {
    const origin = new URL(request.url).origin;
    await sendDashboardLogin(env, replyChatId, owner, origin);
  } else if (text.startsWith("/status")) {
    await sendTelegram(env, replyChatId, `${ownerStatusText(domain, owner, domains)}\nDashboard: ${new URL(request.url).origin}/app`, {
      reply_markup: statusKeyboard()
    });
  } else if (text.startsWith("/whoami")) {
    await sendTelegram(env, replyChatId, `User ID: ${msg.from?.id}\nChat ID: ${msg.chat?.id}`, {
      reply_markup: mainMenuKeyboard()
    });
  } else if (text.startsWith("/help") || !text) {
    await sendTelegram(env, replyChatId, helpText(domain, domains), { reply_markup: helpKeyboard() });
  } else {
    await sendTelegram(env, replyChatId, "Unknown command. Use /help atau /menu.", {
      reply_markup: mainMenuKeyboard()
    });
  }
  return new Response("ok", { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const owner = env.STATE_KV ? await getOwner(env) : null;
      const domains = await getConfiguredDomains(env);
      return Response.json({
        ok: true,
        service: "telegram-tempmail",
        version: VERSION,
        domain: domains[0] || env.DOMAIN,
        domains,
        ownerClaimed: Boolean(owner),
        dashboardEnabled: hasMailDb(env)
      });
    }
    if (url.pathname === "/") return redirect("/app");
    if (url.pathname === "/login") return handleLoginPage(request, env);
    if (url.pathname === "/app") return handleAppPage(request, env);
    if (url.pathname === "/auth/telegram") return handleAuthTelegram(request, env);
    if (url.pathname === "/logout" && request.method === "POST") return handleLogout();
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    if (url.pathname === `/tg/${env.WEBHOOK_SECRET}`) return handleTelegram(request, env);
    return new Response("not found", { status: 404 });
  },

  async email(message, env, ctx) {
    if (!env.STATE_KV) return;
    const owner = await getOwner(env);

    const raw = await readRaw(message.raw);
    const from = decodeMimeWords(message.headers.get("from") || message.from || "-");
    const to = message.to || "-";
    const subject = decodeMimeWords(message.headers.get("subject") || "(no subject)");
    const preview = getBestPreview(raw);
    const code = extractLikelyCode(`${subject}\n${preview}\n${raw.slice(0, 4000)}`);
    const sizeKb = Math.ceil((message.rawSize || raw.length || 0) / 1024);
    const isOtp = code !== "-";
    const receivedAt = nowMs();
    const aliasLocal = aliasLocalFromAddress(to);

    if (hasMailDb(env)) {
      await ensureMailDb(env);
      await purgeExpiredMessages(env);
      await upsertAlias(env, aliasLocal, "discovered");
      await insertMessage(env, {
        id: crypto.randomUUID(),
        aliasLocal,
        aliasFull: to,
        sender: from,
        subject,
        previewText: preview || "(no preview)",
        renderedHtml: renderEmailHtml(raw, preview || "(no preview)"),
        otpCode: code,
        isOtp,
        sizeKb,
        rawKind: getRawKind(raw),
        receivedAt,
        expiresAt: receivedAt + (isOtp ? OTP_RETENTION_MS : MAIL_RETENTION_MS)
      });
    }

    if (!owner?.chatId) return;

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

    await waitUntilOrRun(ctx, sendTelegram(env, owner.chatId, text));
  }
};
