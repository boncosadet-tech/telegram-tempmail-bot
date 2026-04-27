import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";

const MIN_ENV = {
  WA_AUTH_DIR: "/tmp/wa-auth",
  RELAY_URL: "https://w.example.com/relay/gopay-otp/ingest",
  RELAY_TOKEN: "supersecret"
};

test("loadConfig: happy path with defaults", () => {
  const c = loadConfig({ ...MIN_ENV });
  assert.equal(c.authDir, "/tmp/wa-auth");
  assert.equal(c.relayUrl, MIN_ENV.RELAY_URL);
  assert.equal(c.relayToken, "supersecret");
  assert.deepEqual(c.expectedSenders, []);
  assert.ok(c.otpRegex instanceof RegExp);
  assert.equal(c.minBodyLength, 6);
  assert.equal(c.logLevel, "info");
  assert.equal(c.pairMode, "qr");
  assert.equal(c.pairPhone, "");
});

test("loadConfig: throws on missing required vars", () => {
  assert.throws(() => loadConfig({}), /missing required env vars/);
  assert.throws(
    () => loadConfig({ WA_AUTH_DIR: "/tmp", RELAY_URL: "https://x" }),
    /RELAY_TOKEN/
  );
});

test("loadConfig: parses expected senders (trimmed, comma-separated)", () => {
  const c = loadConfig({
    ...MIN_ENV,
    WA_EXPECTED_SENDERS: " 6281@s.whatsapp.net , GoPay@s.whatsapp.net "
  });
  assert.deepEqual(c.expectedSenders, [
    "6281@s.whatsapp.net",
    "GoPay@s.whatsapp.net"
  ]);
});

test("loadConfig: rejects invalid regex", () => {
  assert.throws(
    () => loadConfig({ ...MIN_ENV, WA_OTP_REGEX: "[unterminated" }),
    /invalid WA_OTP_REGEX/
  );
});

test("loadConfig: pair-code mode requires pair-phone", () => {
  assert.throws(
    () => loadConfig({ ...MIN_ENV, WA_PAIR_MODE: "code" }),
    /WA_PAIR_PHONE/
  );
  const c = loadConfig({
    ...MIN_ENV,
    WA_PAIR_MODE: "code",
    WA_PAIR_PHONE: "+62 812-345-6789"
  });
  assert.equal(c.pairMode, "code");
  assert.equal(c.pairPhone, "628123456789");
});

test("loadConfig: pair-mode defaults to qr for unknown values", () => {
  const c = loadConfig({ ...MIN_ENV, WA_PAIR_MODE: "nonsense" });
  assert.equal(c.pairMode, "qr");
});

test("loadConfig: minBodyLength parsed as positive int", () => {
  assert.equal(loadConfig({ ...MIN_ENV, WA_MIN_BODY_LENGTH: "12" }).minBodyLength, 12);
  assert.equal(loadConfig({ ...MIN_ENV, WA_MIN_BODY_LENGTH: "abc" }).minBodyLength, 6);
  assert.equal(loadConfig({ ...MIN_ENV, WA_MIN_BODY_LENGTH: "-3" }).minBodyLength, 6);
});
