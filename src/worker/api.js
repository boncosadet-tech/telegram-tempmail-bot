// Owner-only JSON API for the dashboard SPA.

import { json } from "./utils.js";
import {
  deleteMessageById,
  ensureMailDb,
  getMessageById,
  hasMailDb,
  listAliases,
  listMessages,
  purgeAllMessages,
  purgeExpiredMessages,
  purgeOtpMessages,
  upsertAlias
} from "./db.js";
import { requireOwnerSession } from "./auth.js";
import {
  generateReadableLocal,
  getConfiguredDomains,
  normalizeDomainName,
  sanitizeRequestedLocal
} from "./domains.js";

function unauthorizedJson() {
  return json({ ok: false, error: "unauthorized" }, { status: 401 });
}

async function parseJsonBody(request) {
  return request.json().catch(() => ({}));
}

export async function handleApi(request, env) {
  const auth = await requireOwnerSession(request, env);
  if (!auth) return unauthorizedJson();
  if (!hasMailDb(env)) {
    return json({ ok: false, error: "mail database not configured" }, { status: 503 });
  }

  await ensureMailDb(env);
  await purgeExpiredMessages(env);

  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const { pathname } = url;

  if (pathname === "/api/session" && method === "GET") {
    const domains = await getConfiguredDomains(env);
    return json({
      ok: true,
      domain: domains[0] || env.DOMAIN,
      domains,
      owner: auth.owner,
      hasMailDb: true
    });
  }

  if (pathname === "/api/messages" && method === "GET") {
    const alias = sanitizeRequestedLocal(url.searchParams.get("alias") || "");
    const messages = await listMessages(env, alias);
    return json({ ok: true, messages });
  }

  if (pathname === "/api/messages/purge-otp" && method === "POST") {
    await purgeOtpMessages(env);
    return json({ ok: true });
  }

  if (pathname === "/api/messages/purge-all" && method === "POST") {
    await purgeAllMessages(env);
    return json({ ok: true });
  }

  if (pathname.startsWith("/api/messages/") && method === "GET") {
    const id = pathname.slice("/api/messages/".length);
    const message = await getMessageById(env, id);
    if (!message) return json({ ok: false, error: "not found" }, { status: 404 });
    return json({ ok: true, message });
  }

  if (pathname.startsWith("/api/messages/") && method === "DELETE") {
    const id = pathname.slice("/api/messages/".length);
    await deleteMessageById(env, id);
    return json({ ok: true });
  }

  if (pathname === "/api/aliases" && method === "GET") {
    const domains = await getConfiguredDomains(env);
    const aliases = await listAliases(env);
    return json({ ok: true, domain: domains[0] || env.DOMAIN, domains, aliases });
  }

  if (pathname === "/api/aliases" && method === "POST") {
    const domains = await getConfiguredDomains(env);
    const body = await parseJsonBody(request);
    const local = body.alias ? sanitizeRequestedLocal(body.alias) : generateReadableLocal();
    const requestedDomain = normalizeDomainName(body.domain || domains[0] || env.DOMAIN);
    if (!local) {
      return json({ ok: false, error: "invalid alias" }, { status: 400 });
    }
    if (!domains.includes(requestedDomain)) {
      return json({ ok: false, error: "domain is not configured" }, { status: 400 });
    }
    await upsertAlias(env, local, "web");
    return json({ ok: true, address: `${local}@${requestedDomain}` });
  }

  return json({ ok: false, error: "not found" }, { status: 404 });
}
