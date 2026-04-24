// Primitives shared by worker modules. No external side effects.

/** Current epoch milliseconds. Wrapped for easier testing / mocking. */
export function nowMs() {
  return Date.now();
}

/**
 * JSON response with sensible defaults.
 * @param {unknown} data
 * @param {ResponseInit & { headers?: HeadersInit }} [init]
 */
export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers
    }
  });
}

/**
 * 302 redirect.
 * @param {string} location
 * @param {HeadersInit} [headers]
 */
export function redirect(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "cache-control": "no-store", ...headers }
  });
}

/** Pick a random element from a non-empty array using `crypto.getRandomValues`. */
export function randomItem(items) {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return items[bytes[0] % items.length];
}

/** Cryptographically random decimal digits. */
export function randomDigits(length = 4) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const value of bytes) out += String(value % 10);
  return out;
}

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** URL-safe random token string. Length defaults to 40. */
export function randomToken(length = 40) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const value of bytes) out += TOKEN_ALPHABET[value % TOKEN_ALPHABET.length];
  return out;
}

/**
 * Constant-time string equality. Length mismatch short-circuits (not a leak
 * because length is not secret). Both inputs are coerced to string first.
 */
export function safeEqual(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Schedule `promise` via `ctx.waitUntil` when available; otherwise await it so
 * the response path still reflects the side effect.
 */
export async function waitUntilOrRun(ctx, promise) {
  if (typeof ctx?.waitUntil === "function") {
    ctx.waitUntil(promise);
    return;
  }
  await promise;
}
