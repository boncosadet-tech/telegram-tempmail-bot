import test from "node:test";
import assert from "node:assert/strict";

import {
  CHATGPT_HELP_TEXT,
  CREATEGPT_HELP_TEXT,
  CREATEGPT_MAX_BATCH,
  isValidAlias,
  parseChatgptArgs,
  parseCreategptCount,
  triggerChatgptBatch,
  triggerChatgptSignup
} from "../src/worker/chatgpt.js";

test("parseChatgptArgs extracts mode and positional alias", () => {
  const args = parseChatgptArgs("aisha.putra --mode short");
  assert.equal(args.alias, "aisha.putra");
  assert.equal(args.mode, "short");
});

test("parseChatgptArgs accepts named flags only", () => {
  const args = parseChatgptArgs("--alias dimas --password 'Hello@2026' --age 30");
  assert.equal(args.alias, "dimas");
  assert.equal(args.password, "Hello@2026");
  assert.equal(args.age, "30");
});

test("parseChatgptArgs defaults to pretty mode and empty alias", () => {
  const args = parseChatgptArgs("");
  assert.equal(args.mode, "pretty");
  assert.equal(args.alias, "");
});

test("isValidAlias accepts allowed characters and rejects others", () => {
  assert.equal(isValidAlias(""), true);
  assert.equal(isValidAlias("aisha.putra"), true);
  assert.equal(isValidAlias("dimas-2026"), true);
  assert.equal(isValidAlias("user_42"), true);
  assert.equal(isValidAlias("bad@chars"), false);
  assert.equal(isValidAlias("trailing space "), false);
  assert.equal(isValidAlias("a".repeat(64)), false);
});

test("triggerChatgptSignup returns ok when GitHub responds 204", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 200 });
  };
  try {
    const env = { GITHUB_PAT: "secret", GITHUB_REPO: "owner/repo" };
    const result = await triggerChatgptSignup(env, 12345, {
      mode: "pretty",
      alias: "test.user"
    });
    assert.equal(result.ok, true);
    assert.equal(result.repo, "owner/repo");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /repos\/owner\/repo\/dispatches/);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.event_type, "chatgpt-signup");
    assert.equal(body.client_payload.alias, "test.user");
    assert.equal(body.client_payload.chat_id, "12345");
  } finally {
    delete globalThis.fetch;
  }
});

test("triggerChatgptSignup propagates GitHub error", async () => {
  globalThis.fetch = async () => new Response("forbidden", { status: 403 });
  try {
    const env = { GITHUB_PAT: "secret" };
    const result = await triggerChatgptSignup(env, 1, { mode: "pretty" });
    assert.equal(result.ok, false);
    assert.match(result.error, /403/);
  } finally {
    delete globalThis.fetch;
  }
});

test("triggerChatgptSignup fails fast without GITHUB_PAT", async () => {
  const result = await triggerChatgptSignup({}, 1, { mode: "pretty" });
  assert.equal(result.ok, false);
  assert.match(result.error, /GITHUB_PAT/);
});

test("CHATGPT_HELP_TEXT mentions key examples", () => {
  assert.match(CHATGPT_HELP_TEXT, /\/chatgpt/);
  assert.match(CHATGPT_HELP_TEXT, /aisha\.putra/);
});

test("parseCreategptCount accepts valid range and rejects junk", () => {
  assert.equal(parseCreategptCount("1"), 1);
  assert.equal(parseCreategptCount("5"), 5);
  assert.equal(parseCreategptCount(`${CREATEGPT_MAX_BATCH}`), CREATEGPT_MAX_BATCH);
  assert.equal(parseCreategptCount(""), null);
  assert.equal(parseCreategptCount("0"), null);
  assert.equal(parseCreategptCount(`${CREATEGPT_MAX_BATCH + 1}`), null);
  assert.equal(parseCreategptCount("abc"), null);
  assert.equal(parseCreategptCount("3 extra"), 3);
});

test("triggerChatgptBatch dispatches N times when each succeeds", async () => {
  let count = 0;
  globalThis.fetch = async () => {
    count += 1;
    return new Response(null, { status: 204 });
  };
  try {
    const env = { GITHUB_PAT: "secret", GITHUB_REPO: "owner/repo" };
    const result = await triggerChatgptBatch(env, 42, 3);
    assert.equal(result.ok, true);
    assert.equal(result.dispatched, 3);
    assert.equal(result.failures.length, 0);
    assert.equal(count, 3);
  } finally {
    delete globalThis.fetch;
  }
});

test("triggerChatgptBatch reports per-call failure", async () => {
  let i = 0;
  globalThis.fetch = async () => {
    i += 1;
    if (i === 2) return new Response("forbidden", { status: 403 });
    return new Response("", { status: 200 });
  };
  try {
    const env = { GITHUB_PAT: "secret", GITHUB_REPO: "owner/repo" };
    const result = await triggerChatgptBatch(env, 42, 3);
    assert.equal(result.ok, false);
    assert.equal(result.dispatched, 2);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].index, 2);
  } finally {
    delete globalThis.fetch;
  }
});

test("CREATEGPT_HELP_TEXT mentions max batch and command", () => {
  assert.match(CREATEGPT_HELP_TEXT, /\/creategpt/);
  assert.match(CREATEGPT_HELP_TEXT, new RegExp(`max ${CREATEGPT_MAX_BATCH}`));
});
