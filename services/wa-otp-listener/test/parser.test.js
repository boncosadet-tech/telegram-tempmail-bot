import test from "node:test";
import assert from "node:assert/strict";

import {
  extractMessageText,
  extractOtp,
  isSenderAllowed,
  maskOtp
} from "../src/parser.js";

const DEFAULT_REGEX = /(?:OTP|kode|code|verif(?:ikasi|y))[^0-9]{0,20}([0-9]{4,8})/i;

test("maskOtp: shows last two digits only", () => {
  assert.equal(maskOtp("342918"), "****18");
  assert.equal(maskOtp("1234"), "**34");
  assert.equal(maskOtp("12"), "**");
  assert.equal(maskOtp(""), "");
});

test("extractOtp: matches typical GoPay / Midtrans phrasings", () => {
  const samples = [
    ["OTP verifikasi GoPay kamu: 342918. Jangan bagi ke siapapun.", "342918"],
    ["Kode OTP kamu 987654 — rahasia ya!", "987654"],
    ["Your Midtrans OTP is 823174", "823174"],
    ["Gunakan kode 554433 untuk verifikasi login GoPay.", "554433"],
    ["Kode verifikasi: 11-22-33 untuk transaksi Rp 1", "112233"] // normalized run
  ];
  for (const [body, expected] of samples) {
    // Strip dashes inside runs first so regex sees a contiguous digit run.
    const cleaned = body.replace(/(\d)[-](\d)/g, "$1$2").replace(/(\d)[-](\d)/g, "$1$2");
    assert.equal(
      extractOtp(cleaned, DEFAULT_REGEX),
      expected,
      `body: ${body}`
    );
  }
});

test("extractOtp: keyword-fallback picks unique 4-8 digit run", () => {
  const body = "Halo, kode kamu adalah 918273 dan jangan dibagi.";
  // No direct keyword-adjacent digits in regex match (space after "adalah"),
  // but fallback triggers because of the keyword.
  const custom = /(?:OTP)[^0-9]{0,5}([0-9]{4,8})/i;
  assert.equal(extractOtp(body, custom), "918273");
});

test("extractOtp: ignores amounts without OTP keyword", () => {
  const body = "Pembayaran Rp 100000 berhasil.";
  assert.equal(extractOtp(body, DEFAULT_REGEX), null);
});

test("extractOtp: primary regex wins over ambiguous fallback", () => {
  // Primary regex matches "Kode 123456" first — the first-after-keyword
  // run is the OTP. Fallback is never reached.
  const body = "Kode 123456 dan 654321 harus dipakai bergantian.";
  assert.equal(extractOtp(body, DEFAULT_REGEX), "123456");
});

test("extractOtp: fallback returns null on two conflicting 6-digit runs without primary match", () => {
  // Keyword present but primary regex can't anchor: both digit runs are
  // far from the keyword. Fallback sees two candidates → ambiguous → null.
  const body =
    "Untuk transaksi ini diperlukan verifikasi. Angka-angka di bawah: 123456 atau 654321.";
  assert.equal(extractOtp(body, DEFAULT_REGEX), null);
});

test("extractOtp: rejects too-short bodies", () => {
  assert.equal(extractOtp("otp 1", DEFAULT_REGEX), null);
  assert.equal(extractOtp("", DEFAULT_REGEX), null);
  assert.equal(extractOtp(null, DEFAULT_REGEX), null);
});

test("extractOtp: matches case-insensitively and with Indonesian phrasings", () => {
  assert.equal(
    extractOtp("otp kamu: 778899", DEFAULT_REGEX),
    "778899"
  );
  assert.equal(
    extractOtp("kode Verifikasi GoPay 445566", DEFAULT_REGEX),
    "445566"
  );
});

test("isSenderAllowed: empty allow-list accepts any JID", () => {
  assert.equal(isSenderAllowed("6281@s.whatsapp.net", []), true);
  assert.equal(isSenderAllowed("anything", null), true);
});

test("isSenderAllowed: non-empty allow-list enforces exact match (case-insensitive)", () => {
  const allow = ["6281234567890@s.whatsapp.net", "GoPay@s.whatsapp.net"];
  assert.equal(isSenderAllowed("6281234567890@s.whatsapp.net", allow), true);
  assert.equal(isSenderAllowed("gopay@s.whatsapp.net", allow), true);
  assert.equal(isSenderAllowed("somebody@s.whatsapp.net", allow), false);
  assert.equal(isSenderAllowed("", allow), false);
});

test("extractMessageText: handles common Baileys message shapes", () => {
  assert.equal(
    extractMessageText({ conversation: "hello OTP 123456" }),
    "hello OTP 123456"
  );
  assert.equal(
    extractMessageText({ extendedTextMessage: { text: "kode 987654" } }),
    "kode 987654"
  );
  assert.equal(
    extractMessageText({ imageMessage: { caption: "OTP 112233 di sini" } }),
    "OTP 112233 di sini"
  );
  assert.equal(
    extractMessageText({
      ephemeralMessage: { message: { conversation: "kode 445566" } }
    }),
    "kode 445566"
  );
  assert.equal(extractMessageText(null), "");
  assert.equal(extractMessageText({}), "");
});
