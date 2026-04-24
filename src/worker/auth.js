// Owner-only session & one-time login tokens, backed by the STATE_KV binding.

import { randomToken } from "./utils.js";
import { getOwner } from "./domains.js";

export const LOGIN_PREFIX = "login:";
export const SESSION_PREFIX = "session:";
export const SESSION_COOKIE = "tt_session";
export const LOGIN_TTL_SECONDS = 10 * 60;
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Parse request `Cookie` header into a plain object. */
export function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  return Object.fromEntries(
    header
      .split(/;\s*/)
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf("=");
        if (idx === -1) return [part, ""];
        try {
          return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
        } catch {
          return [part.slice(0, idx), part.slice(idx + 1)];
        }
      })
  );
}

export function sessionCookie(value, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Mint a short-lived single-use login token, returned to the owner via Telegram. */
export async function issueLoginToken(env, owner) {
  const token = randomToken(48);
  await env.STATE_KV.put(
    `${LOGIN_PREFIX}${token}`,
    JSON.stringify({
      ownerUserId: owner.userId,
      createdAt: new Date().toISOString()
    }),
    { expirationTtl: LOGIN_TTL_SECONDS }
  );
  return token;
}

/** Consume (delete + return) a login token. Returns null if the token is unknown or malformed. */
export async function consumeLoginToken(env, token) {
  const key = `${LOGIN_PREFIX}${token}`;
  const raw = await env.STATE_KV.get(key);
  if (!raw) return null;
  if (typeof env.STATE_KV.delete === "function") {
    await env.STATE_KV.delete(key);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Create a fresh session record in KV and return the opaque cookie token. */
export async function createSession(env, owner) {
  const token = randomToken(48);
  await env.STATE_KV.put(
    `${SESSION_PREFIX}${token}`,
    JSON.stringify({
      userId: owner.userId,
      chatId: owner.chatId,
      createdAt: new Date().toISOString()
    }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );
  return token;
}

export async function getSession(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const raw = await env.STATE_KV.get(`${SESSION_PREFIX}${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Validate that the cookie session matches the currently-claimed owner.
 * Returns `{ session, owner }` on success, `null` otherwise.
 */
export async function requireOwnerSession(request, env) {
  const session = await getSession(request, env);
  const owner = await getOwner(env);
  if (!session || !owner) return null;
  if (String(session.userId) !== String(owner.userId)) return null;
  return { session, owner };
}
