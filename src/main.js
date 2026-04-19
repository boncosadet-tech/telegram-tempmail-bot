const VERSION = "2026-04-19-telegram-tempmail-v3";
const OWNER_KEY = "owner";
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

function parseNewAlias(text) {
  const parts = String(text || "").trim().split(/\s+/).slice(1);
  if (parts.length === 0) return { local: generateReadableLocal(), custom: false };
  const requested = sanitizeRequestedLocal(parts.join("-"));
  if (!requested) {
    return { local: "", custom: true, error: "Custom alias only supports letters, numbers, dot, dash, and underscore." };
  }
  return { local: requested, custom: true };
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

function ownerStatusText(domain, owner) {
  if (!owner) return `Domain: ${domain}\nOwner: not claimed`;
  return [
    `Domain: ${domain}`,
    `Owner user id: ${owner.userId}`,
    `Owner chat id: ${owner.chatId}`,
    `Claimed at: ${owner.claimedAt || "-"}`
  ].join("\n");
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
      id, alias_local, alias_full, sender, subject, preview_text, otp_code,
      is_otp, size_kb, raw_kind, received_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.aliasLocal,
      message.aliasFull,
      message.sender,
      message.subject,
      message.previewText,
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
        `SELECT id, alias_local, alias_full, sender, subject, preview_text, otp_code, is_otp, size_kb, raw_kind, received_at, expires_at
         FROM messages WHERE alias_local = ? ORDER BY received_at DESC LIMIT 100`,
        [aliasFilter]
      )
    : await allDb(
        env,
        `SELECT id, alias_local, alias_full, sender, subject, preview_text, otp_code, is_otp, size_kb, raw_kind, received_at, expires_at
         FROM messages ORDER BY received_at DESC LIMIT 100`
      );
  return rows;
}

async function getMessageById(env, id) {
  await ensureMailDb(env);
  await purgeExpiredMessages(env);
  return firstDb(
    env,
    `SELECT id, alias_local, alias_full, sender, subject, preview_text, otp_code, is_otp, size_kb, raw_kind, received_at, expires_at
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
    body { font-family: system-ui, sans-serif; background: #0b1020; color: #eef2ff; margin: 0; }
    .card { max-width: 680px; margin: 8vh auto; background: #121933; border: 1px solid #243055; border-radius: 16px; padding: 24px; }
    code { background: #0b1020; padding: 2px 6px; border-radius: 6px; }
    a { color: #8ec5ff; }
  </style>
</head>
<body>
  <div class="card">
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
    :root { color-scheme: dark; }
    body { margin: 0; font-family: system-ui, sans-serif; background: #0b1020; color: #eef2ff; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #243055; }
    .wrap { display: grid; grid-template-columns: 360px 1fr; min-height: calc(100vh - 65px); }
    aside, main { padding: 18px; }
    aside { border-right: 1px solid #243055; background: #10162e; }
    h1, h2, h3 { margin: 0 0 12px; }
    .muted { color: #94a3b8; font-size: 14px; }
    .stack { display: grid; gap: 12px; }
    .card { background: #121933; border: 1px solid #243055; border-radius: 14px; padding: 14px; }
    input, select, button, textarea { width: 100%; box-sizing: border-box; background: #0b1020; color: #eef2ff; border: 1px solid #31406f; border-radius: 10px; padding: 10px; }
    button { cursor: pointer; }
    button.primary { background: #2563eb; border-color: #2563eb; }
    .row { display: flex; gap: 8px; }
    .row > * { flex: 1; }
    .messages { display: grid; gap: 10px; max-height: 70vh; overflow: auto; }
    .message { border: 1px solid #243055; border-radius: 12px; padding: 12px; background: #121933; cursor: pointer; }
    .message.active { border-color: #60a5fa; }
    .pill { display: inline-block; border-radius: 999px; padding: 2px 8px; background: #1e3a8a; font-size: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #0b1020; padding: 12px; border-radius: 12px; border: 1px solid #243055; }
    @media (max-width: 920px) { .wrap { grid-template-columns: 1fr; } aside { border-right: 0; border-bottom: 1px solid #243055; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>TempMail Dashboard</h1>
      <div class="muted">${escapeHtml(domain)}</div>
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
        <pre id="detailPreview">Inbox preview will appear here.</pre>
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
      const current = select.value;
      select.innerHTML = '<option value="">All aliases</option>';
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
      document.getElementById('detailPreview').textContent = 'Inbox preview will appear here.';
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
      const data = await api('/api/aliases', { method: 'POST', body: JSON.stringify({ alias }) });
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
    return json({
      ok: true,
      domain: env.DOMAIN,
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
    const aliases = await listAliases(env);
    return json({ ok: true, domain: env.DOMAIN, aliases });
  }

  if (pathname === "/api/aliases" && method === "POST") {
    const body = await parseJsonBody(request);
    const local = body.alias ? sanitizeRequestedLocal(body.alias) : generateReadableLocal();
    if (!local) {
      return json({ ok: false, error: "invalid alias" }, { status: 400 });
    }
    await upsertAlias(env, local, "web");
    return json({ ok: true, address: `${local}@${env.DOMAIN}` });
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
    const alias = parseNewAlias(text);
    if (alias.error) {
      await sendTelegram(
        env,
        replyChatId,
        `${alias.error}\n\nUsage:\n/new\n/new hello\n/new hello-team\n/new hello.team@${domain}`
      );
      return new Response("ok", { status: 200 });
    }
    const addr = `${alias.local}@${domain}`;
    if (hasMailDb(env)) await upsertAlias(env, alias.local, "bot");
    await sendTelegram(
      env,
      replyChatId,
      [
        alias.custom ? "Custom temp email created:" : "Temp email created:",
        "",
        addr,
        "",
        "Use this address to receive OTP or verification email."
      ].join("\n")
    );
  } else if (text.startsWith("/web")) {
    const loginToken = await issueLoginToken(env, owner);
    const origin = new URL(request.url).origin;
    await sendTelegram(
      env,
      replyChatId,
      `Dashboard login link:\n\n${origin}/auth/telegram?token=${loginToken}\n\nThis link expires in 10 minutes.`
    );
  } else if (text.startsWith("/status")) {
    await sendTelegram(env, replyChatId, `${ownerStatusText(domain, owner)}\nDashboard: ${new URL(request.url).origin}/app`);
  } else if (text.startsWith("/whoami")) {
    await sendTelegram(env, replyChatId, `User ID: ${msg.from?.id}\nChat ID: ${msg.chat?.id}`);
  } else if (text.startsWith("/help") || !text) {
    await sendTelegram(
      env,
      replyChatId,
      `Commands:\n/start claim - claim owner (first use)\n/start - bot status\n/new - create a readable temp email\n/new hello - create custom alias\n/web - get dashboard login link\n/status - show runtime status\n/whoami - show your ids\n/help - help`
    );
  } else {
    await sendTelegram(env, replyChatId, "Unknown command. Use /help.");
  }
  return new Response("ok", { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const owner = env.STATE_KV ? await getOwner(env) : null;
      return Response.json({
        ok: true,
        service: "telegram-tempmail",
        version: VERSION,
        domain: env.DOMAIN,
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
