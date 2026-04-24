import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  decodeMimeWords,
  extractLikelyCode,
  getBestPreview,
  getRawKind,
  readRaw
} from "../src/worker/email.js";

describe("extractLikelyCode", () => {
  it("returns a dash when nothing resembles a code", () => {
    assert.equal(extractLikelyCode("hello world"), "-");
  });

  it("prefers the code that follows a verification keyword", () => {
    assert.equal(
      extractLikelyCode("Your verification code is 123456. Ignore otherwise."),
      "123456"
    );
  });

  it("accepts alphanumeric codes", () => {
    const code = extractLikelyCode("Use token ABC123 to verify");
    assert.equal(code, "ABC123");
  });

  it("ignores stopwords that match the alphabet pattern", () => {
    const code = extractLikelyCode("CODE please reply");
    assert.equal(code, "-");
  });
});

describe("decodeMimeWords", () => {
  it("decodes quoted-printable MIME words", () => {
    assert.equal(decodeMimeWords("=?utf-8?Q?Hello=20World?="), "Hello World");
  });

  it("decodes base64 MIME words", () => {
    assert.equal(decodeMimeWords("=?utf-8?B?SGVsbG8gd29ybGQ=?="), "Hello world");
  });
});

describe("getBestPreview", () => {
  it("prefers text/plain over text/html", () => {
    const raw = [
      "Content-Type: multipart/alternative; boundary=BOUNDARY",
      "",
      "--BOUNDARY",
      "Content-Type: text/plain",
      "",
      "hello plain world",
      "",
      "--BOUNDARY",
      "Content-Type: text/html",
      "",
      "<p>hello html</p>",
      "--BOUNDARY--"
    ].join("\n");
    const preview = getBestPreview(raw);
    assert.match(preview, /hello plain world/);
    assert.doesNotMatch(preview, /hello html/);
  });
});

describe("getRawKind", () => {
  it("classifies the primary body type", () => {
    assert.equal(getRawKind("Content-Type: text/plain\n\nhi"), "text/plain");
    assert.equal(getRawKind("Content-Type: text/html\n\n<p>hi</p>"), "text/html");
    assert.equal(getRawKind("Content-Type: multipart/alternative; boundary=xyz"), "multipart");
    assert.equal(getRawKind("plain raw"), "unknown");
  });
});

describe("readRaw", () => {
  it("reads a byte stream and decodes it as UTF-8 up to the given limit", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode("0123456789");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 4));
        controller.enqueue(bytes.slice(4));
        controller.close();
      }
    });
    const text = await readRaw(stream, 6);
    assert.equal(text, "012345");
  });
});
