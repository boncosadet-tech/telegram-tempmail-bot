import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aliasLocalFromAddress,
  formatDomainList,
  generateReadableLocal,
  getConfiguredDomains,
  getOwner,
  isOwnerMessage,
  normalizeDomainName,
  ownerStatusText,
  parseNewAlias,
  parseStartToken,
  sanitizeRequestedLocal
} from "../src/worker/domains.js";

describe("sanitizeRequestedLocal", () => {
  it("keeps plain lowercase localparts", () => {
    assert.equal(sanitizeRequestedLocal("hello"), "hello");
  });

  it("strips @domain and coerces separators", () => {
    assert.equal(sanitizeRequestedLocal("Hello@ex.com"), "hello");
    assert.equal(sanitizeRequestedLocal("hello team"), "hello-team");
    assert.equal(sanitizeRequestedLocal("--weird--"), "weird");
  });

  it("rejects values that would become empty or invalid", () => {
    assert.equal(sanitizeRequestedLocal(""), "");
    assert.equal(sanitizeRequestedLocal("..."), "");
    assert.equal(sanitizeRequestedLocal("a..b"), "a-b");
  });
});

describe("normalizeDomainName", () => {
  it("strips scheme, path, @ prefix, and trailing dots", () => {
    assert.equal(normalizeDomainName("https://Example.COM/path?x=1"), "example.com");
    assert.equal(normalizeDomainName("@foo.Bar."), "foo.bar");
  });
});

describe("parseNewAlias", () => {
  it("generates a readable local when no argument is provided", () => {
    const parsed = parseNewAlias("/new");
    assert.equal(parsed.custom, false);
    assert.match(parsed.local, /^[a-z0-9]+(?:[-._][a-z0-9]+)*$/);
  });

  it("accepts a custom local part and extracts its domain", () => {
    const parsed = parseNewAlias("/new hello@alt.example");
    assert.deepEqual(parsed, { local: "hello", domain: "alt.example", custom: true });
  });

  it("returns an error when the local part cannot be normalized", () => {
    const parsed = parseNewAlias("/new ...@alt.example");
    assert.equal(parsed.local, "");
    assert.equal(parsed.custom, true);
    assert.ok(parsed.error);
  });
});

describe("parseStartToken", () => {
  it("returns the token or empty string", () => {
    assert.equal(parseStartToken("/start claim"), "claim");
    assert.equal(parseStartToken("/start"), "");
  });
});

describe("isOwnerMessage", () => {
  it("matches on either user id or chat id", () => {
    const owner = { userId: "123", chatId: "999" };
    assert.equal(isOwnerMessage({ from: { id: 123 }, chat: { id: 0 } }, owner), true);
    assert.equal(isOwnerMessage({ from: { id: 0 }, chat: { id: 999 } }, owner), true);
    assert.equal(isOwnerMessage({ from: { id: 1 }, chat: { id: 2 } }, owner), false);
    assert.equal(isOwnerMessage(null, owner), false);
  });
});

describe("getConfiguredDomains + getOwner", () => {
  function fakeKv(store) {
    return {
      async get(key) {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      }
    };
  }

  it("includes the primary domain plus optional extras", async () => {
    const env = {
      DOMAIN: "primary.example",
      STATE_KV: fakeKv({ domains: JSON.stringify(["alt.example", "primary.example"]) })
    };
    const domains = await getConfiguredDomains(env);
    assert.deepEqual(domains, ["primary.example", "alt.example"]);
  });

  it("falls back gracefully when KV returns invalid JSON", async () => {
    const env = { DOMAIN: "primary.example", STATE_KV: fakeKv({ domains: "not-json" }) };
    const domains = await getConfiguredDomains(env);
    assert.deepEqual(domains, ["primary.example"]);
  });

  it("returns null for missing or malformed owner records", async () => {
    assert.equal(await getOwner({ STATE_KV: fakeKv({}) }), null);
    assert.equal(await getOwner({ STATE_KV: fakeKv({ owner: "garbage" }) }), null);
  });
});

describe("formatters", () => {
  it("formats the domain list", () => {
    assert.equal(formatDomainList([]), "-");
    assert.equal(formatDomainList(["a", "b"]), "a, b");
  });

  it("renders the owner status text with or without owner", () => {
    const unclaimed = ownerStatusText("foo.example", null, ["foo.example"]);
    assert.match(unclaimed, /not claimed/);
    const claimed = ownerStatusText(
      "foo.example",
      { userId: "1", chatId: "2", claimedAt: "2024-01-01" },
      ["foo.example"]
    );
    assert.match(claimed, /Owner user id: 1/);
  });
});

describe("generateReadableLocal", () => {
  it("produces a word-word-digit alias pattern", () => {
    for (let i = 0; i < 6; i += 1) {
      assert.match(generateReadableLocal(), /^[a-z]+-[a-z]+-\d{4}$/);
    }
  });
});

describe("aliasLocalFromAddress", () => {
  it("returns the lowercased local part", () => {
    assert.equal(aliasLocalFromAddress("Hello@example.com"), "hello");
    assert.equal(aliasLocalFromAddress(""), "");
  });
});
