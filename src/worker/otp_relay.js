// GoPay OTP relay: bridges a Telegram `/otp <code>` message and a polling
// HTTP client (e.g. the chatgpt-claim-trial Python script).
//
// Flow:
//   1. Owner receives a WhatsApp OTP from GoPay.
//   2. Owner replies in Telegram with `/otp 123456`.
//   3. Bot stashes the code in STATE_KV under `gopay_otp:pending` with a
//      short TTL (default 5 minutes).
//   4. The script polls `GET /relay/gopay-otp?token=...` with the shared
//      `GOPAY_OTP_TOKEN`. The handler returns and deletes the code in one
//      shot, so each OTP is consumed exactly once.
//
// If `GOPAY_OTP_TOKEN` is not configured the relay is disabled (the
// endpoint returns 503 and the Telegram command refuses the OTP).

import { json } from "./utils.js";
import { safeEqual } from "./utils.js";

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
