import test from "node:test";
import assert from "node:assert/strict";

import { randomToken, sanitizeWorkerName } from "../src/lib/common.js";

test("sanitizeWorkerName returns workers.dev compatible format", () => {
  const value = sanitizeWorkerName("My.Domain.com");
  assert.match(value, /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
  assert.ok(value.length <= 63);
});

test("sanitizeWorkerName trims long values", () => {
  const longDomain = `${"a".repeat(80)}.example.com`;
  const value = sanitizeWorkerName(longDomain);
  assert.ok(value.length <= 63);
  assert.match(value, /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
});

test("randomToken uses telegram-safe charset", () => {
  const token = randomToken(40);
  assert.equal(token.length, 40);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});
