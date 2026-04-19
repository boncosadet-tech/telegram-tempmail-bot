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

function createEnv(owner = null) {
  return {
    DOMAIN: "example.com",
    BOT_TOKEN: "bot-token",
    WEBHOOK_SECRET: "secret-token",
    STATE_KV: new MockKV(owner ? { owner: JSON.stringify(owner) } : {})
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
