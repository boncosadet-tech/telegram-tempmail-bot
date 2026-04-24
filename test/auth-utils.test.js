import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SESSION_COOKIE,
  clearSessionCookie,
  consumeLoginToken,
  createSession,
  getSession,
  issueLoginToken,
  parseCookies,
  sessionCookie
} from "../src/worker/auth.js";
import { safeEqual } from "../src/worker/utils.js";

describe("parseCookies", () => {
  it("parses multiple cookies and decodes URI-encoded values", () => {
    const req = new Request("https://example.com", {
      headers: {
        cookie: `foo=bar; ${SESSION_COOKIE}=abc%20def; empty=`
      }
    });
    const cookies = parseCookies(req);
    assert.equal(cookies.foo, "bar");
    assert.equal(cookies[SESSION_COOKIE], "abc def");
    assert.equal(cookies.empty, "");
  });

  it("returns an empty object when no cookie header is present", () => {
    const req = new Request("https://example.com");
    assert.deepEqual(parseCookies(req), {});
  });
});

describe("sessionCookie / clearSessionCookie", () => {
  it("emits secure HttpOnly cookies", () => {
    const value = sessionCookie("abc");
    assert.match(value, /HttpOnly/);
    assert.match(value, /Secure/);
    assert.match(value, /SameSite=Lax/);
    assert.match(value, new RegExp(`^${SESSION_COOKIE}=abc;`));
  });

  it("clears the session cookie with Max-Age=0", () => {
    assert.match(clearSessionCookie(), /Max-Age=0/);
  });
});

describe("safeEqual", () => {
  it("compares strings in constant time", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abd"), false);
    assert.equal(safeEqual("abc", "abcd"), false);
    assert.equal(safeEqual(null, ""), true);
  });
});

function createMemoryKv() {
  const store = new Map();
  return {
    store,
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expires && entry.expires < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key, value, opts = {}) {
      const expires = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0;
      store.set(key, { value, expires });
    },
    async delete(key) {
      store.delete(key);
    }
  };
}

describe("login tokens and sessions", () => {
  it("mints and consumes a login token exactly once", async () => {
    const env = { STATE_KV: createMemoryKv() };
    const owner = { userId: "1", chatId: "2" };
    const token = await issueLoginToken(env, owner);
    assert.ok(typeof token === "string" && token.length > 0);
    const record = await consumeLoginToken(env, token);
    assert.equal(record.ownerUserId, "1");
    const second = await consumeLoginToken(env, token);
    assert.equal(second, null);
  });

  it("creates a session retrievable via the cookie", async () => {
    const env = { STATE_KV: createMemoryKv() };
    const owner = { userId: "1", chatId: "2" };
    const token = await createSession(env, owner);
    const request = new Request("https://example.com", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` }
    });
    const session = await getSession(request, env);
    assert.equal(session.userId, "1");
    assert.equal(session.chatId, "2");
  });
});
