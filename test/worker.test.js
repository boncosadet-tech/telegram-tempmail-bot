import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/main.js";

class MockKV {
  constructor(initial = {}) {
    this.store = new Map(Object.entries(initial));
  }

  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }
}

class MockD1Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new MockD1Statement(this.db, this.sql, params);
  }

  async run() {
    const sql = this.sql.trim();
    if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) {
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith("ALTER TABLE messages ADD COLUMN rendered_html")) {
      if (this.db.renderedHtmlColumnAdded) {
        throw new Error("duplicate column name: rendered_html");
      }
      this.db.renderedHtmlColumnAdded = true;
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith("INSERT INTO aliases")) {
      const [aliasLocal, source, createdAt, lastSeenAt] = this.params;
      this.db.aliases.set(aliasLocal, { alias_local: aliasLocal, source, created_at: createdAt, last_seen_at: lastSeenAt });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO messages")) {
      const [
        id, aliasLocal, aliasFull, sender, subject, previewText, renderedHtml,
        otpCode, isOtp, sizeKb, rawKind, receivedAt, expiresAt
      ] = this.params;
      this.db.messages.push({
        id,
        alias_local: aliasLocal,
        alias_full: aliasFull,
        sender,
        subject,
        preview_text: previewText,
        rendered_html: renderedHtml,
        otp_code: otpCode,
        is_otp: isOtp,
        size_kb: sizeKb,
        raw_kind: rawKind,
        received_at: receivedAt,
        expires_at: expiresAt
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM messages WHERE expires_at")) {
      return { meta: { changes: 0 } };
    }
    return { meta: { changes: 0 } };
  }

  async all() {
    return { results: [] };
  }

  async first() {
    return null;
  }
}

class MockD1 {
  constructor() {
    this.messages = [];
    this.aliases = new Map();
    this.renderedHtmlColumnAdded = false;
  }

  prepare(sql) {
    return new MockD1Statement(this, sql);
  }
}

function createEnv(owner = null, extras = {}) {
  return {
    DOMAIN: "example.com",
    BOT_TOKEN: "bot-token",
    WEBHOOK_SECRET: "secret-token",
    STATE_KV: new MockKV(owner ? { owner: JSON.stringify(owner) } : {}),
    ...extras
  };
}

function createTelegramUpdate(text, { userId = 42, chatId = 42, chatType = "private" } = {}) {
  return {
    message: {
      message_id: 1,
      text,
      from: { id: userId },
      chat: { id: chatId, type: chatType }
    }
  };
}

function createRawEmail(text) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
}

test("health endpoint reports owner claim state", async () => {
  const unclaimedResponse = await worker.fetch(new Request("https://worker.example/health"), createEnv());
  const unclaimedData = await unclaimedResponse.json();
  assert.equal(unclaimedResponse.status, 200);
  assert.equal(unclaimedData.ownerClaimed, false);

  const claimedResponse = await worker.fetch(
    new Request("https://worker.example/health"),
    createEnv({ userId: "99", chatId: "77", claimedAt: "2026-04-19T00:00:00.000Z", domain: "example.com" })
  );
  const claimedData = await claimedResponse.json();
  assert.equal(claimedData.ownerClaimed, true);
});

test("telegram start claim stores owner in KV and acknowledges claim", async () => {
  const env = createEnv();
  const sentMessages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sentMessages.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example/tg/secret-token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "secret-token"
        },
        body: JSON.stringify(createTelegramUpdate("/start claim", { userId: 6083649512, chatId: 6083649512 }))
      }),
      env
    );

    assert.equal(response.status, 200);
    const owner = JSON.parse(await env.STATE_KV.get("owner"));
    assert.equal(owner.userId, "6083649512");
    assert.equal(owner.chatId, "6083649512");
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /Owner claimed successfully/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web command issues owner-only dashboard login link", async () => {
  const env = createEnv({
    userId: "6083649512",
    chatId: "6083649512",
    claimedAt: "2026-04-19T00:00:00.000Z",
    domain: "example.com"
  });
  const sentMessages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sentMessages.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const response = await worker.fetch(
      new Request("https://telegram-tempmail.example.workers.dev/tg/secret-token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "secret-token"
        },
        body: JSON.stringify(createTelegramUpdate("/web", { userId: 6083649512, chatId: 6083649512 }))
      }),
      env
    );

    assert.equal(response.status, 200);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /Dashboard login link:/);
    assert.match(sentMessages[0].text, /https:\/\/telegram-tempmail\.example\.workers\.dev\/auth\/telegram\?token=/);
    const loginKeys = Array.from(env.STATE_KV.store.keys()).filter((key) => key.startsWith("login:"));
    assert.equal(loginKeys.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("new command supports custom alias names", async () => {
  const env = createEnv({
    userId: "6083649512",
    chatId: "6083649512",
    claimedAt: "2026-04-19T00:00:00.000Z",
    domain: "example.com"
  });
  const sentMessages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sentMessages.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example/tg/secret-token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "secret-token"
        },
        body: JSON.stringify(createTelegramUpdate("/new hello.team@example.com", { userId: 6083649512, chatId: 6083649512 }))
      }),
      env
    );

    assert.equal(response.status, 200);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /Custom temp email created:/);
    assert.match(sentMessages[0].text, /hello\.team@example\.com/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("new command generates readable default alias", async () => {
  const env = createEnv({
    userId: "6083649512",
    chatId: "6083649512",
    claimedAt: "2026-04-19T00:00:00.000Z",
    domain: "example.com"
  });
  const sentMessages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sentMessages.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example/tg/secret-token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "secret-token"
        },
        body: JSON.stringify(createTelegramUpdate("/new", { userId: 6083649512, chatId: 6083649512 }))
      }),
      env
    );

    assert.equal(response.status, 200);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /[a-z]+-[a-z]+-[0-9]{4}@example\.com/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("email handler forwards summary to claimed owner chat", async () => {
  const env = createEnv({
    userId: "6083649512",
    chatId: "6083649512",
    claimedAt: "2026-04-19T00:00:00.000Z",
    domain: "example.com"
  });
  const sentMessages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sentMessages.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    await worker.email(
      {
        from: "noreply@example.net",
        to: "tmp-abc123@example.com",
        headers: new Headers({ subject: "Your OTP code" }),
        raw: createRawEmail("Subject: Your OTP code\nContent-Type: text/plain\n\nYour verification code is 123456.")
      },
      env,
      { waitUntil(promise) { return promise; } }
    );

    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].chat_id, "6083649512");
    assert.match(sentMessages[0].text, /To: tmp-abc123@example.com/);
    assert.match(sentMessages[0].text, /Possible code: 123456/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("email handler still sends when waitUntil is unavailable", async () => {
  const env = createEnv({
    userId: "6083649512",
    chatId: "6083649512",
    claimedAt: "2026-04-19T00:00:00.000Z",
    domain: "example.com"
  });
  const sentMessages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sentMessages.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    await worker.email(
      {
        from: "noreply@example.net",
        to: "tmp-noctx@example.com",
        headers: new Headers({ subject: "Login code" }),
        raw: createRawEmail("Subject: Login code\nContent-Type: text/plain\n\nUse 654321 to continue.")
      },
      env,
      {}
    );

    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /To: tmp-noctx@example.com/);
    assert.match(sentMessages[0].text, /Possible code: 654321/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("email handler stores html-like rendered content for dashboard view", async () => {
  const mailDb = new MockD1();
  const env = createEnv({
    userId: "6083649512",
    chatId: "6083649512",
    claimedAt: "2026-04-19T00:00:00.000Z",
    domain: "example.com"
  }, { MAIL_DB: mailDb });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    await worker.email(
      {
        from: "noreply@example.net",
        to: "html-view@example.com",
        headers: new Headers({ subject: "Welcome" }),
        raw: createRawEmail(
          "Subject: Welcome\nContent-Type: multipart/alternative; boundary=abc\n\n--abc\nContent-Type: text/plain\n\nHello there\n\n--abc\nContent-Type: text/html\n\n<p>Hello <strong>there</strong></p><p>Visit <a href=\"https://example.com/verify\">Verify</a></p>\n--abc--"
        )
      },
      env,
      { waitUntil(promise) { return promise; } }
    );

    assert.equal(mailDb.messages.length, 1);
    assert.match(mailDb.messages[0].rendered_html, /<p>Hello there<\/p>/);
    assert.match(mailDb.messages[0].rendered_html, /<a href="https:\/\/example.com\/verify"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
