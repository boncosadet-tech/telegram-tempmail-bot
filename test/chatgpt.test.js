import test from "node:test";
import assert from "node:assert/strict";

import {
  CHATGPT_HELP_TEXT,
  isValidAlias,
  parseChatgptArgs,
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
