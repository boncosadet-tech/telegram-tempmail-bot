// GoPay OTP relay: bridges a WhatsApp OTP listener (or Telegram `/otp
// <code>` fallback) and a polling HTTP client (e.g. the
// chatgpt-claim-trial Python script).
//
// Flow:
//   1. GoPay sends a WhatsApp OTP to the owner's phone.
//   2a. AUTOMATED: the `services/wa-otp-listener` Baileys service on the
//       VM captures the OTP and POSTs it to
//       `/relay/gopay-otp/ingest` with a bearer token.
//   2b. MANUAL FALLBACK: the owner types `/otp 123456` in Telegram and
//       the bot stashes it under the same KV key.
//   3. Bot/ingest stashes the code in STATE_KV under `gopay_otp:pending`
//      with a short TTL (default 5 minutes).
//   4. The Python script polls `GET /relay/gopay-otp?token=...` with the
//      shared `GOPAY_OTP_TOKEN`. The handler returns and deletes the
//      code in one shot, so each OTP is consumed exactly once.
//
// If `GOPAY_OTP_TOKEN` is not configured the relay is disabled (both
// endpoints return 401 and the Telegram command refuses the OTP).

import { getOwner } from "./domains.js";
import { json, safeEqual } from "./utils.js";

const TELEGRAM_API_ROOT = "https://api.telegram.org";

export const GOPAY_OTP_KV_KEY = "gopay_otp:pending";
export const GOPAY_OTP_DEFAULT_TTL_S = 300;
const OTP_PATTERN = /^\d{4,8}$/;

/** Parse a `/otp 123456` argument; return the digits or empty string. */
export function parseOtpArg(text) {
  const body = String(text ?? "")
    .replace(/^\/otp(?:@\S+)?/, "")
    .trim();
  return OTP_PATTERN.test(body) ? body : "";
}

/** Mask all but the last two digits for log/UI display. */
export function maskOtp(code) {
  const s = String(code ?? "");
  if (s.length <= 2) return "*".repeat(s.length);
  return "*".repeat(s.length - 2) + s.slice(-2);
}

/**
 * Stash a pending OTP in KV. `ttlSeconds` is clamped to >= 60s because
 * Cloudflare KV requires `expirationTtl >= 60`.
 */
export async function setPendingGopayOtp(env, code, ttlSeconds = GOPAY_OTP_DEFAULT_TTL_S) {
  if (!env.STATE_KV) throw new Error("missing STATE_KV binding");
  if (!OTP_PATTERN.test(String(code))) throw new Error("invalid OTP format");
  const payload = JSON.stringify({ code: String(code), ts: Date.now() });
  const expirationTtl = Math.max(60, Math.floor(ttlSeconds));
  await env.STATE_KV.put(GOPAY_OTP_KV_KEY, payload, { expirationTtl });
}

/**
 * Return-and-delete the pending OTP atomically (best effort: KV is
 * eventually consistent, but Workers serialize requests per-isolate so this
 * is fine for a single human in the loop).
 */
export async function consumePendingGopayOtp(env) {
  if (!env.STATE_KV) return null;
  const raw = await env.STATE_KV.get(GOPAY_OTP_KV_KEY);
  if (!raw) return null;
  await env.STATE_KV.delete(GOPAY_OTP_KV_KEY);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.code === "string") return parsed;
  } catch {
    // fall through
  }
  return null;
}

/** Token comparison helper; treats missing config as "auth disabled". */
function authorizeRelay(env, providedToken) {
  const expected = String(env.GOPAY_OTP_TOKEN || "");
  if (!expected) return false;
  return safeEqual(providedToken, expected);
}

/** Handler for `GET /relay/gopay-otp?token=...`. */
export async function handleGopayOtpRelay(request, env) {
  if (request.method !== "GET") {
    return json({ ok: false, error: "method not allowed" }, { status: 405 });
  }
  const url = new URL(request.url);
  const token =
    url.searchParams.get("token") ||
    (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!authorizeRelay(env, token)) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const pending = await consumePendingGopayOtp(env);
  if (!pending) return json({ ok: false, error: "no pending otp" }, { status: 404 });
  return json({ ok: true, code: pending.code, ts: pending.ts });
}

/**
 * Send a small Telegram message to the claimed owner announcing that an
 * OTP was ingested from the WA listener. Best-effort — any failure is
 * swallowed so the ingest HTTP call still returns 2xx.
 *
 * Extracted as a standalone helper (instead of reusing
 * ``telegram.sendTelegram``) to avoid a circular import between
 * ``otp_relay.js`` and ``telegram.js``.
 */
export async function notifyOwnerOfOtpIngest(env, maskedCode, sourceJid) {
  try {
    const botToken = env?.BOT_TOKEN || env?.TELEGRAM_BOT_TOKEN;
    if (!botToken || !env?.STATE_KV) return;
    const owner = await getOwner(env);
    if (!owner?.chatId) return;
    const srcLine = sourceJid ? `\nSumber: ${String(sourceJid).slice(0, 80)}` : "";
    const text =
      `📨 OTP GoPay diterima otomatis dari WhatsApp.\n` +
      `Kode (masked): ${maskedCode}\n` +
      `Akan dikonsumsi script aktif dalam 5 menit.${srcLine}`;
    await fetch(`${TELEGRAM_API_ROOT}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: owner.chatId,
        text,
        disable_web_page_preview: true
      })
    });
  } catch {
    // Swallow — notify is best-effort.
  }
}

/** Extract bearer token from Authorization header or ?token= query. */
function extractIngestToken(request, url) {
  const auth = (request.headers.get("authorization") || "").trim();
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return url.searchParams.get("token") || "";
}

/**
 * Handler for ``POST /relay/gopay-otp/ingest``.
 *
 * Body (JSON): ``{ code: "123456", source_jid?: "...", ts?: 12345 }``
 * Auth: ``Authorization: Bearer <GOPAY_OTP_TOKEN>`` (or ``?token=`` fallback).
 *
 * Responses:
 *   202 Accepted — code stashed; owner optionally notified.
 *   400 Bad Request — invalid JSON or malformed code.
 *   401 Unauthorized — token missing / wrong / not configured.
 *   503 Service Unavailable — STATE_KV binding missing.
 */
export async function handleGopayOtpIngest(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, { status: 405 });
  }
  const url = new URL(request.url);
  const token = extractIngestToken(request, url);
  if (!authorizeRelay(env, token)) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!env?.STATE_KV) {
    return json({ ok: false, error: "STATE_KV not bound" }, { status: 503 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const code = String(payload?.code ?? "").trim();
  if (!OTP_PATTERN.test(code)) {
    return json({ ok: false, error: "invalid code" }, { status: 400 });
  }
  const sourceJid = payload?.source_jid ? String(payload.source_jid).slice(0, 120) : "";

  await setPendingGopayOtp(env, code);

  // Best-effort notify to the owner when the feature flag is on. Defaults
  // to OFF to avoid surprising existing deployments; the /autorevoke
  // docs recommend turning this on for audit trail.
  if (env?.GOPAY_OTP_INGEST_NOTIFY === "1" || env?.GOPAY_OTP_INGEST_NOTIFY === "true") {
    await notifyOwnerOfOtpIngest(env, maskOtp(code), sourceJid);
  }

  return json({ ok: true, masked: maskOtp(code) }, { status: 202 });
}
