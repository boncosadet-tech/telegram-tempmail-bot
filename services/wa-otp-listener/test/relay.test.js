import test from "node:test";
import assert from "node:assert/strict";
import pino from "pino";

import { postOtpToRelay } from "../src/relay.js";

const silentLogger = pino({ level: "silent" });

test("postOtpToRelay: 202 is treated as success", async () => {
  let capturedInit;
  const fetchFn = async (url, init) => {
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true, masked: "****42" }), {
      status: 202,
      headers: { "content-type": "application/json" }
    });
  };
  const res = await postOtpToRelay({
    relayUrl: "https://w.example.com/relay/gopay-otp/ingest",
    relayToken: "t0ken",
    code: "424242",
    sourceJid: "6281@s.whatsapp.net",
    logger: silentLogger,
    fetchFn
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 202);
  assert.equal(capturedInit.method, "POST");
  assert.equal(capturedInit.headers.authorization, "Bearer t0ken");
  const parsed = JSON.parse(capturedInit.body);
  assert.equal(parsed.code, "424242");
  assert.equal(parsed.source_jid, "6281@s.whatsapp.net");
  assert.equal(typeof parsed.ts, "number");
});

test("postOtpToRelay: 401 is NOT retried and returns ok=false", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return new Response("nope", { status: 401 });
  };
  const res = await postOtpToRelay({
    relayUrl: "https://w.example.com/relay/gopay-otp/ingest",
    relayToken: "wrong",
    code: "111111",
    logger: silentLogger,
    fetchFn
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(calls, 1, "4xx must not be retried");
});

test("postOtpToRelay: 5xx is retried up to 3 total attempts", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return new Response("boom", { status: 500 });
  };
  const res = await postOtpToRelay({
    relayUrl: "https://w.example.com/relay/gopay-otp/ingest",
    relayToken: "t",
    code: "222222",
    logger: silentLogger,
    fetchFn
  });
  assert.equal(res.ok, false);
  assert.equal(calls, 3);
});

test("postOtpToRelay: network error is retried", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    if (calls < 3) throw new Error("econnreset");
    return new Response("{}", { status: 202 });
  };
  const res = await postOtpToRelay({
    relayUrl: "https://w.example.com/relay/gopay-otp/ingest",
    relayToken: "t",
    code: "333333",
    logger: silentLogger,
    fetchFn
  });
  assert.equal(res.ok, true);
  assert.equal(calls, 3);
});
