import test from "node:test";
import assert from "node:assert/strict";

import {
  GOPAY_OTP_KV_KEY,
  consumePendingGopayOtp,
  handleGopayOtpRelay,
  maskOtp,
  parseOtpArg,
  setPendingGopayOtp
} from "../src/worker/otp_relay.js";

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

function makeRequest(url, init = {}) {
  return new Request(url, { method: "GET", ...init });
}

test("parseOtpArg: extracts 4-8 digit code; rejects junk", () => {
  assert.equal(parseOtpArg("/otp 123456"), "123456");
  assert.equal(parseOtpArg("/otp@MyBot 9876"), "9876");
  assert.equal(parseOtpArg("/otp 12345678"), "12345678");
  assert.equal(parseOtpArg("/otp 123"), ""); // too short
  assert.equal(parseOtpArg("/otp 123456789"), ""); // too long
  assert.equal(parseOtpArg("/otp abc123"), "");
  assert.equal(parseOtpArg("/otp"), "");
  assert.equal(parseOtpArg(""), "");
});

test("maskOtp: shows last two digits only", () => {
  assert.equal(maskOtp("123456"), "****56");
  assert.equal(maskOtp("12"), "**");
  assert.equal(maskOtp(""), "");
});

test("setPendingGopayOtp + consumePendingGopayOtp roundtrip", async () => {
  const STATE_KV = new MockKV();
  await setPendingGopayOtp({ STATE_KV }, "987654");
  const stored = await STATE_KV.get(GOPAY_OTP_KV_KEY);
  assert.ok(stored, "value should be present in KV");
  assert.equal(JSON.parse(stored).code, "987654");
  // ttl floor is 60s
  assert.ok(STATE_KV.lastPutOptions.expirationTtl >= 60);

  const consumed = await consumePendingGopayOtp({ STATE_KV });
  assert.equal(consumed.code, "987654");
  // Second consume returns null (one-shot).
  assert.equal(await consumePendingGopayOtp({ STATE_KV }), null);
});

test("setPendingGopayOtp clamps ttl to >= 60s", async () => {
  const STATE_KV = new MockKV();
  await setPendingGopayOtp({ STATE_KV }, "1234", 5);
  assert.equal(STATE_KV.lastPutOptions.expirationTtl, 60);
});

test("setPendingGopayOtp rejects malformed code", async () => {
  const STATE_KV = new MockKV();
  await assert.rejects(() => setPendingGopayOtp({ STATE_KV }, "abc"));
  await assert.rejects(() => setPendingGopayOtp({ STATE_KV }, "12"));
});

test("relay: 401 when token missing or wrong", async () => {
  const env = { STATE_KV: new MockKV(), GOPAY_OTP_TOKEN: "expected-secret" };
  const noToken = await handleGopayOtpRelay(
    makeRequest("https://w.example.com/relay/gopay-otp"),
    env
  );
  assert.equal(noToken.status, 401);
  const wrongToken = await handleGopayOtpRelay(
    makeRequest("https://w.example.com/relay/gopay-otp?token=wrong"),
    env
  );
  assert.equal(wrongToken.status, 401);
});

test("relay: 401 when worker has no GOPAY_OTP_TOKEN configured", async () => {
  const env = { STATE_KV: new MockKV(), GOPAY_OTP_TOKEN: "" };
  const res = await handleGopayOtpRelay(
    makeRequest("https://w.example.com/relay/gopay-otp?token=anything"),
    env
  );
  assert.equal(res.status, 401);
});

test("relay: 405 on non-GET method", async () => {
  const env = { STATE_KV: new MockKV(), GOPAY_OTP_TOKEN: "expected-secret" };
  const res = await handleGopayOtpRelay(
    new Request("https://w.example.com/relay/gopay-otp?token=expected-secret", {
      method: "POST"
    }),
    env
  );
  assert.equal(res.status, 405);
});

test("relay: 404 when no pending OTP", async () => {
  const env = { STATE_KV: new MockKV(), GOPAY_OTP_TOKEN: "expected-secret" };
  const res = await handleGopayOtpRelay(
    makeRequest("https://w.example.com/relay/gopay-otp?token=expected-secret"),
    env
  );
  assert.equal(res.status, 404);
});

test("relay: returns and consumes pending OTP on first hit only", async () => {
  const env = { STATE_KV: new MockKV(), GOPAY_OTP_TOKEN: "expected-secret" };
  await setPendingGopayOtp(env, "424242");

  const first = await handleGopayOtpRelay(
    makeRequest("https://w.example.com/relay/gopay-otp?token=expected-secret"),
    env
  );
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.ok, true);
  assert.equal(body.code, "424242");
  assert.equal(typeof body.ts, "number");

  const second = await handleGopayOtpRelay(
    makeRequest("https://w.example.com/relay/gopay-otp?token=expected-secret"),
    env
  );
  assert.equal(second.status, 404, "second call must not return same OTP");
});

test("relay: accepts Authorization: Bearer header", async () => {
  const env = { STATE_KV: new MockKV(), GOPAY_OTP_TOKEN: "expected-secret" };
  await setPendingGopayOtp(env, "111122");
  const res = await handleGopayOtpRelay(
    makeRequest("https://w.example.com/relay/gopay-otp", {
      headers: { authorization: "Bearer expected-secret" }
    }),
    env
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.code, "111122");
});
