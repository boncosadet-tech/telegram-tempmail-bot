// Cloudflare Worker entry point. Delegates to modules under `./worker/`.
// The deploy pipeline uploads this file plus every module it imports as a
// multi-module Worker script.

import { handleApi } from "./worker/api.js";
import {
  clearSessionCookie,
  consumeLoginToken,
  createSession,
  getSession,
  sessionCookie
} from "./worker/auth.js";
import {
  hasMailDb,
  ensureMailDb,
  insertMessage,
  purgeExpiredMessages,
  upsertAlias,
  MAIL_RETENTION_MS,
  OTP_RETENTION_MS
} from "./worker/db.js";
import { renderAppPage, renderLoginPage } from "./worker/dashboard.js";
import { aliasLocalFromAddress, getConfiguredDomains, getOwner } from "./worker/domains.js";
import {
  decodeMimeWords,
  extractLikelyCode,
  getBestPreview,
  getRawKind,
  readRaw,
  renderEmailHtml
} from "./worker/email.js";
import { handleTelegram, sendTelegram } from "./worker/telegram.js";
import { handleGopayOtpRelay } from "./worker/otp_relay.js";
import { nowMs, redirect, waitUntilOrRun } from "./worker/utils.js";

export const VERSION = "2026-04-19-telegram-tempmail-v4";

const HTML_SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY"
});

function htmlResponse(body, init = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...HTML_SECURITY_HEADERS,
      ...(init.headers || {})
    }
  });
}

async function handleLoginPage(request, env) {
  const session = await getSession(request, env);
  if (session) return redirect("/app");
  return htmlResponse(renderLoginPage(env.DOMAIN || "example.com"));
}

async function handleAppPage(request, env) {
  const session = await getSession(request, env);
  if (!session) return redirect("/login");
  return htmlResponse(renderAppPage(env.DOMAIN || "example.com"));
}

async function handleAuthTelegram(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  if (!token) return redirect("/login");
  const loginRecord = await consumeLoginToken(env, token);
  const owner = await getOwner(env);
  if (!loginRecord || !owner) return redirect("/login");
  if (String(loginRecord.ownerUserId) !== String(owner.userId)) return redirect("/login");
  const sessionToken = await createSession(env, owner);
  return redirect("/app", { "Set-Cookie": sessionCookie(sessionToken) });
}

function handleLogout() {
  return redirect("/login", { "Set-Cookie": clearSessionCookie() });
}

async function handleHealth(env) {
  const owner = env.STATE_KV ? await getOwner(env) : null;
  const domains = await getConfiguredDomains(env);
  return Response.json({
    ok: true,
    service: "telegram-tempmail",
    version: VERSION,
    domain: domains[0] || env.DOMAIN,
    domains,
    ownerClaimed: Boolean(owner),
    dashboardEnabled: hasMailDb(env)
  });
}

async function handleInboundEmail(message, env, ctx) {
  if (!env.STATE_KV) return;
  const owner = await getOwner(env);

  const raw = await readRaw(message.raw);
  const from = decodeMimeWords(message.headers.get("from") || message.from || "-");
  const to = message.to || "-";
  const subject = decodeMimeWords(message.headers.get("subject") || "(no subject)");
  const preview = getBestPreview(raw);
  const code = extractLikelyCode(`${subject}\n${preview}\n${raw.slice(0, 4000)}`);
  const sizeKb = Math.ceil((message.rawSize || raw.length || 0) / 1024);
  const isOtp = code !== "-";
  const receivedAt = nowMs();
  const aliasLocal = aliasLocalFromAddress(to);

  if (hasMailDb(env)) {
    await ensureMailDb(env);
    await purgeExpiredMessages(env);
    await upsertAlias(env, aliasLocal, "discovered");
    await insertMessage(env, {
      id: crypto.randomUUID(),
      aliasLocal,
      aliasFull: to,
      sender: from,
      subject,
      previewText: preview || "(no preview)",
      renderedHtml: renderEmailHtml(raw, preview || "(no preview)"),
      otpCode: code,
      isOtp,
      sizeKb,
      rawKind: getRawKind(raw),
      receivedAt,
      expiresAt: receivedAt + (isOtp ? OTP_RETENTION_MS : MAIL_RETENTION_MS)
    });
  }

  if (!owner?.chatId) return;

  const text = [
    "New email received",
    "",
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    `Size: ${sizeKb} KB`,
    "",
    `Possible code: ${code}`,
    "",
    "Preview:",
    preview || "(no preview)"
  ].join("\n");

  await waitUntilOrRun(ctx, sendTelegram(env, owner.chatId, text));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/health") return handleHealth(env);
    if (pathname === "/") return redirect("/app");
    if (pathname === "/login") return handleLoginPage(request, env);
    if (pathname === "/app") return handleAppPage(request, env);
    if (pathname === "/auth/telegram") return handleAuthTelegram(request, env);
    if (pathname === "/logout" && request.method === "POST") return handleLogout();
    if (pathname.startsWith("/api/")) return handleApi(request, env);
    if (pathname === "/relay/gopay-otp") return handleGopayOtpRelay(request, env);
    if (pathname === `/tg/${env.WEBHOOK_SECRET}`) return handleTelegram(request, env);

    return new Response("not found", { status: 404 });
  },

  async email(message, env, ctx) {
    return handleInboundEmail(message, env, ctx);
  }
};
