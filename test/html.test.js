import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  escapeHtml,
  htmlDecode,
  htmlToDisplayText,
  sanitizeUrl,
  textToDisplayHtml
} from "../src/worker/html.js";

describe("escapeHtml", () => {
  it("escapes the dangerous XSS characters", () => {
    assert.equal(
      escapeHtml('<img src=x onerror="alert(1)">'),
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    );
  });

  it("coerces nullish values to an empty string", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
  });
});

describe("htmlDecode", () => {
  it("decodes the basic HTML entities", () => {
    assert.equal(htmlDecode("&lt;b&gt;hi&amp;bye&quot;&#39;"), "<b>hi&bye\"'");
  });
});

describe("sanitizeUrl", () => {
  it("accepts http, https, and mailto URLs", () => {
    assert.equal(sanitizeUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
    assert.equal(sanitizeUrl("HTTP://EXAMPLE.COM"), "HTTP://EXAMPLE.COM");
    assert.equal(sanitizeUrl("mailto:a@example.com"), "mailto:a@example.com");
  });

  it("rejects javascript: and data: URLs", () => {
    assert.equal(sanitizeUrl("javascript:alert(1)"), "");
    assert.equal(sanitizeUrl("data:text/html,<script>"), "");
    assert.equal(sanitizeUrl("  vbscript:x "), "");
  });
});

describe("htmlToDisplayText", () => {
  it("strips script/style and retains link placeholders", () => {
    const html = '<style>body{}</style>hello<script>x</script><a href="https://example.com">go</a>';
    const text = htmlToDisplayText(html);
    assert.match(text, /hello/);
    assert.match(text, /\[\[LINK:go\|https:\/\/example\.com\]\]/);
    assert.doesNotMatch(text, /<script/i);
  });

  it("drops javascript: links but keeps the label", () => {
    const out = htmlToDisplayText('<a href="javascript:alert(1)">click</a>');
    assert.match(out, /click/);
    assert.doesNotMatch(out, /javascript:/i);
  });
});

describe("textToDisplayHtml", () => {
  it("wraps single-line input in a <p>", () => {
    assert.equal(textToDisplayHtml("hello"), "<p>hello</p>");
  });

  it("escapes HTML-sensitive characters in the body", () => {
    const out = textToDisplayHtml("<script>alert(1)</script>");
    assert.doesNotMatch(out, /<script>/i);
    assert.match(out, /&lt;script&gt;/);
  });

  it("renders LINK placeholders as anchor tags with safe URLs", () => {
    const out = textToDisplayHtml("visit [[LINK:google|https://google.com]]");
    assert.match(out, /<a href="https:\/\/google\.com"[^>]*>google<\/a>/);
  });
});
