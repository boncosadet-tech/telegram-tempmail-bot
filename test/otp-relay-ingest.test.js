import test from "node:test";
import assert from "node:assert/strict";

import { GOPAY_OTP_KV_KEY, handleGopayOtpIngest } from "../src/worker/otp_relay.js";

class MockKV {
  constructor(initial = {}) {
    this.store = new Map(Object.entries(initial));
    this.lastPutOptions = null;
  }
  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  async put(key, value, options) {
    this.lastPutOptions = options || null;
    this.store.set(key, value);
  }
  async delete(key) {
    this.store.delete(key);
  }
}

function buildRequest(body, { method = "POST", token = "expected-secret", header = false } = {}) {
  const url = header
    ? "https://w.example.com/relay/gopay-otp/ingest"
    : `https://w.example.com/relay/gopay-otp/ingest?token=${encodeURIComponent(token)}`;
  const init = {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
  if (header) init.headers.authorization = `Bearer ${token}`;
  return new Request(url, init);
}

function baseEnv(overrides = {}) {
  return {
    STATE_KV: new MockKV(),
    GOPAY_OTP_TOKEN: "expected-secret",
    ...overrides
  };
}

test("ingest: 401 when no token, wrong token, or token unconfigured", async () => {
  const env = baseEnv();

  const noToken = await handleGopayOtpIngest(
    new Request("https://w.example.com/relay/gopay-otp/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "123456" })
    }),
    env
  );
  assert.equal(noToken.status, 401);

  const wrongToken = await handleGopayOtpIngest(
    buildRequest({ code: "123456" }, { token: "nope" }),
    env
  );
  assert.equal(wrongToken.status, 401);

  const envMissing = baseEnv({ GOPAY_OTP_TOKEN: "" });
  const unconfigured = await handleGopayOtpIngest(
    buildRequest({ code: "123456" }, { token: "anything" }),
    envMissing
  );
  assert.equal(unconfigured.status, 401);
});

test("ingest: 405 on non-POST method", async () => {
  const env = baseEnv();
  const res = await handleGopayOtpIngest(
    new Request("https://w.example.com/relay/gopay-otp/ingest?token=expected-secret", {
      method: "GET"
    }),
    env
  );
  assert.equal(res.status, 405);
});

test("ingest: 400 on invalid JSON body", async () => {
  const env = baseEnv();
  const res = await handleGopayOtpIngest(buildRequest("{not-json", {}), env);
  assert.equal(res.status, 400);
});

test("ingest: 400 on malformed OTP code", async () => {
  const env = baseEnv();
  for (const bad of ["", "ab12", "12", "123456789", "   "]) {
    const res = await handleGopayOtpIngest(buildRequest({ code: bad }), env);
    assert.equal(res.status, 400, `expected 400 for code=${JSON.stringify(bad)}`);
  }
});

test("ingest: 503 when STATE_KV binding is missing", async () => {
  const env = { GOPAY_OTP_TOKEN: "expected-secret" };
  const res = await handleGopayOtpIngest(buildRequest({ code: "123456" }), env);
  assert.equal(res.status, 503);
});

test("ingest: 202 stashes valid code in KV and returns masked code", async () => {
  const env = baseEnv();
  const res = await handleGopayOtpIngest(
    buildRequest({ code: "424242", source_jid: "6281234567890@s.whatsapp.net" }),
    env
  );
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.masked, "****42");

  const stored = await env.STATE_KV.get(GOPAY_OTP_KV_KEY);
  assert.ok(stored);
  assert.equal(JSON.parse(stored).code, "424242");
  assert.ok(env.STATE_KV.lastPutOptions.expirationTtl >= 60);
});

test("ingest: accepts Authorization: Bearer header", async () => {
  const env = baseEnv();
  const res = await handleGopayOtpIngest(buildRequest({ code: "111122" }, { header: true }), env);
  assert.equal(res.status, 202);
});

test("ingest: notify flag triggers telegram fetch when owner is claimed", async () => {
  const origFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : "" });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const STATE_KV = new MockKV({
      owner: JSON.stringify({ chatId: 999, userId: 1, claimedAt: 0 })
    });
    const env = {
      STATE_KV,
      GOPAY_OTP_TOKEN: "expected-secret",
      BOT_TOKEN: "bot-token-xyz",
      GOPAY_OTP_INGEST_NOTIFY: "1"
    };
    const res = await handleGopayOtpIngest(
      buildRequest({ code: "554433", source_jid: "6281@s.whatsapp.net" }),
      env
    );
    assert.equal(res.status, 202);
    const sent = calls.find((c) => c.url.includes("/sendMessage"));
    assert.ok(sent, "expected sendMessage call");
    assert.match(sent.body, /OTP GoPay diterima/);
    assert.match(sent.body, /\*\*33/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("ingest: notify flag off: no telegram fetch", async () => {
  const origFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => {
    called += 1;
    return new Response("{}", { status: 200 });
  };
  try {
    const STATE_KV = new MockKV({
      owner: JSON.stringify({ chatId: 999, userId: 1, claimedAt: 0 })
    });
    const env = {
      STATE_KV,
      GOPAY_OTP_TOKEN: "expected-secret",
      BOT_TOKEN: "bot-token-xyz"
      // GOPAY_OTP_INGEST_NOTIFY not set
    };
    const res = await handleGopayOtpIngest(buildRequest({ code: "778899" }), env);
    assert.equal(res.status, 202);
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = origFetch;
  }
});
