import path from "node:path";

import {
  defaultWorkerNameForDomain,
  randomToken,
  readJsonFile,
  readTextFile,
  sanitizeWorkerName,
  writeJsonFile
} from "./common.js";

export const OWNER_KEY = "owner";
const D1_BINDING_NAME = "MAIL_DB";
const D1_DB_PREFIX = "telegram-tempmail";
const D1_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    alias_local TEXT NOT NULL,
    alias_full TEXT NOT NULL,
    sender TEXT NOT NULL,
    subject TEXT NOT NULL,
    preview_text TEXT NOT NULL,
    otp_code TEXT NOT NULL DEFAULT '-',
    is_otp INTEGER NOT NULL DEFAULT 0,
    size_kb INTEGER NOT NULL DEFAULT 0,
    raw_kind TEXT NOT NULL DEFAULT 'unknown',
    received_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages (received_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_messages_alias_local ON messages (alias_local, received_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages (expires_at)",
  `CREATE TABLE IF NOT EXISTS aliases (
    alias_local TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    is_pinned INTEGER NOT NULL DEFAULT 0
  )`
];

export function resolveScriptName(domain, scriptNameInput = "") {
  return scriptNameInput
    ? sanitizeWorkerName(scriptNameInput)
    : defaultWorkerNameForDomain(domain);
}

export function normalizeCatchAllTarget(catchAll) {
  const action = catchAll?.actions?.find((item) => item.type === "worker");
  const value = action?.value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return "";
}

export function statePathFor(cwd) {
  return path.resolve(cwd, ".tempmail/setup-state.json");
}

export function readSavedState(cwd) {
  return readJsonFile(statePathFor(cwd), {});
}

async function applyD1Migrations(cf, accountId, databaseId) {
  for (const statement of D1_SCHEMA_STATEMENTS) {
    await cf.queryD1(accountId, databaseId, statement);
  }
}

export async function performSetup({
  cwd,
  cf,
  tg,
  domain,
  scriptName,
  telegramBotToken,
  force = false,
  dryRun = false,
  onProgress = () => {}
}) {
  const kvTitle = `telegram-tempmail:${domain}`;
  const webhookSecret = randomToken(36);
  const claimToken = "claim";

  onProgress("validating Telegram bot token");
  const me = await tg.getMe();
  if (!me.username) {
    throw new Error("Telegram bot must have a username before setup can continue.");
  }

  onProgress(`resolving Cloudflare zone for ${domain}`);
  const zone = await cf.getZoneByDomain(domain);
  const accountId = zone.account?.id;
  if (!accountId) {
    throw new Error("Cloudflare zone has no account id.");
  }

  onProgress("ensuring KV namespace");
  const kvNamespace = await cf.findOrCreateKVNamespace(accountId, kvTitle);
  onProgress("ensuring D1 database");
  const d1Database = await cf.findOrCreateD1Database(accountId, sanitizeWorkerName(`${D1_DB_PREFIX}-${domain}`));

  const accountSubdomain = await cf.getAccountWorkersSubdomain(accountId);
  const workerUrlBase = `https://${scriptName}.${accountSubdomain}.workers.dev`;
  const webhookUrl = `${workerUrlBase}/tg/${webhookSecret}`;
  const dashboardUrl = `${workerUrlBase}/app`;

  if (dryRun) {
    return {
      dryRun: true,
      domain,
      scriptName,
      accountId,
      zoneId: zone.id,
      kvNamespaceId: kvNamespace.id,
      d1DatabaseId: d1Database.uuid || d1Database.id,
      workerUrlBase,
      dashboardUrl,
      webhookUrl,
      claimLink: `https://t.me/${me.username}?start=${claimToken}`
    };
  }

  const workerSource = readTextFile(path.resolve(cwd, "src/main.js"));

  onProgress(`uploading worker script ${scriptName}`);
  await cf.uploadWorkerScript(
    accountId,
    scriptName,
    workerSource,
    domain,
    kvNamespace.id,
    "2026-04-18",
    d1Database.uuid || d1Database.id
  );

  onProgress("applying D1 schema");
  await applyD1Migrations(cf, accountId, d1Database.uuid || d1Database.id);

  onProgress("setting worker secrets");
  await cf.setWorkerSecret(accountId, scriptName, "BOT_TOKEN", telegramBotToken);
  await cf.setWorkerSecret(accountId, scriptName, "WEBHOOK_SECRET", webhookSecret);

  onProgress("enabling workers.dev endpoint");
  await cf.enableWorkerSubdomain(accountId, scriptName);

  onProgress("enabling email routing DNS (idempotent)");
  await cf.enableEmailRoutingDns(zone.id);

  onProgress("checking catch-all rule");
  const catchAll = await cf.getCatchAllRule(zone.id);
  const existingTarget = normalizeCatchAllTarget(catchAll);
  if (existingTarget && existingTarget !== scriptName && !force) {
    throw new Error(
      `Catch-all currently points to worker "${existingTarget}". Re-run with --force to replace it.`
    );
  }
  await cf.setCatchAllWorker(zone.id, scriptName);

  onProgress("configuring Telegram webhook");
  await tg.setWebhook(webhookUrl, webhookSecret);

  const statePath = statePathFor(cwd);
  const stateData = {
    version: 1,
    createdAt: new Date().toISOString(),
    domain,
    zoneId: zone.id,
    accountId,
    scriptName,
    accountSubdomain,
    workerUrlBase,
    dashboardUrl,
    webhookUrlPrefix: `${workerUrlBase}/tg/`,
    kvNamespaceId: kvNamespace.id,
    d1DatabaseId: d1Database.uuid || d1Database.id,
    botUsername: me.username,
    claimToken
  };
  writeJsonFile(statePath, stateData);

  return {
    domain,
    zoneId: zone.id,
    accountId,
    scriptName,
    accountSubdomain,
    workerUrlBase,
    dashboardUrl,
    webhookUrl,
    kvNamespaceId: kvNamespace.id,
    d1DatabaseId: d1Database.uuid || d1Database.id,
    claimLink: `https://t.me/${me.username}?start=${claimToken}`,
    statePath
  };
}

export async function performVerify({
  cf,
  tg = null,
  domain,
  scriptName,
  onStatus = () => {}
}) {
  const failures = [];

  const zone = await cf.getZoneByDomain(domain);
  onStatus("zone", "ok", `${zone.name} (${zone.id})`);

  const accountId = zone.account?.id;
  if (!accountId) {
    throw new Error("Cloudflare zone has no account id.");
  }

  const accountSubdomain = await cf.getAccountWorkersSubdomain(accountId);
  onStatus("workers-subdomain", "ok", accountSubdomain);

  const workerSettings = await cf.getWorkerSettings(accountId, scriptName).catch((error) => {
    failures.push(`worker settings unavailable: ${error.message}`);
    return null;
  });
  let kvBinding = null;
  if (workerSettings) {
    const bindings = workerSettings.bindings || [];
    const domainBinding = bindings.find((b) => b.type === "plain_text" && b.name === "DOMAIN");
    kvBinding = bindings.find((b) => b.type === "kv_namespace" && b.name === "STATE_KV");
    const d1Binding = bindings.find((b) => b.type === "d1" && b.name === D1_BINDING_NAME);
    if (!domainBinding || domainBinding.text !== domain) {
      failures.push("DOMAIN binding is missing or mismatched");
    } else {
      onStatus("binding DOMAIN", "ok", domainBinding.text);
    }
    if (!kvBinding || !kvBinding.namespace_id) {
      failures.push("STATE_KV binding is missing");
    } else {
      onStatus("binding STATE_KV", "ok", kvBinding.namespace_id);
    }
    if (!d1Binding || !(d1Binding.database_id || d1Binding.id)) {
      failures.push("MAIL_DB binding is missing");
    } else {
      onStatus("binding MAIL_DB", "ok", d1Binding.database_id || d1Binding.id);
      try {
        await cf.queryD1(accountId, d1Binding.database_id || d1Binding.id, "SELECT 1 AS ok");
        onStatus("d1-query", "ok", "schema reachable");
      } catch (error) {
        failures.push(`D1 query failed: ${error.message}`);
      }
    }
  }

  const routing = await cf.getEmailRouting(zone.id);
  if (!routing.enabled) {
    failures.push("Email routing is not enabled");
  } else {
    onStatus("email-routing", "ok", `${routing.status || "unknown"}`);
  }

  const catchAll = await cf.getCatchAllRule(zone.id);
  const target = normalizeCatchAllTarget(catchAll);
  if (!target) {
    failures.push("Catch-all is not using worker action");
  } else if (target !== scriptName) {
    failures.push(`Catch-all points to "${target}" instead of "${scriptName}"`);
  } else {
    onStatus("catch-all", "ok", target);
  }

  if (kvBinding?.namespace_id) {
    const ownerRaw = await cf.getKVValue(accountId, kvBinding.namespace_id, OWNER_KEY);
    if (!ownerRaw) {
      onStatus("owner-claim", "pending", "owner not claimed yet, send /start claim");
    } else {
      let owner;
      try {
        owner = JSON.parse(ownerRaw);
      } catch {
        owner = null;
      }
      if (!owner?.userId || !owner?.chatId) {
        failures.push("owner KV value exists but format is invalid");
      } else {
        onStatus("owner-claim", "ok", `userId=${owner.userId} chatId=${owner.chatId}`);
      }
    }
  }

  if (tg) {
    const webhookInfo = await tg.getWebhookInfo();
    const expectedPrefix = `https://${scriptName}.${accountSubdomain}.workers.dev/tg/`;
    const actualUrl = webhookInfo.url || "";
    if (!actualUrl) {
      failures.push("Telegram webhook URL is empty");
    } else if (!actualUrl.startsWith(expectedPrefix)) {
      failures.push(`Telegram webhook URL mismatch: ${actualUrl}`);
    } else {
      onStatus("telegram-webhook", "ok", actualUrl);
    }
  } else {
    onStatus("telegram-webhook", "pending", "skipped (provide --telegram-bot-token to validate)");
  }

  if (failures.length > 0) {
    for (const item of failures) {
      onStatus("failure", "failed", item);
    }
    return { ok: false, failures };
  }
  onStatus("verify", "ok", "all critical checks passed");
  return { ok: true, failures: [] };
}

export async function resetOwner({
  cf,
  domain,
  scriptName,
  cwd,
  onProgress = () => {}
}) {
  const saved = readSavedState(cwd);
  const zone = await cf.getZoneByDomain(domain);
  const accountId = zone.account?.id;
  if (!accountId) {
    throw new Error("Cloudflare zone has no account id.");
  }
  const effectiveScriptName = scriptName || saved.scriptName || defaultWorkerNameForDomain(domain);
  const workerSettings = await cf.getWorkerSettings(accountId, effectiveScriptName);
  const kvBinding = (workerSettings.bindings || []).find((b) => b.type === "kv_namespace" && b.name === "STATE_KV");
  if (!kvBinding?.namespace_id) {
    throw new Error("STATE_KV binding is missing");
  }
  onProgress("deleting owner key from KV");
  await cf.deleteKVValue(accountId, kvBinding.namespace_id, OWNER_KEY);
  return { accountId, namespaceId: kvBinding.namespace_id, scriptName: effectiveScriptName };
}

export async function rotateWebhookSecret({
  cf,
  tg,
  domain,
  scriptName,
  telegramBotToken,
  cwd,
  onProgress = () => {}
}) {
  const saved = readSavedState(cwd);
  const zone = await cf.getZoneByDomain(domain);
  const accountId = zone.account?.id;
  if (!accountId) {
    throw new Error("Cloudflare zone has no account id.");
  }

  const effectiveScriptName = scriptName || saved.scriptName || defaultWorkerNameForDomain(domain);
  const botInfo = await tg.getMe();
  if (!botInfo.username) {
    throw new Error("Telegram bot must have a username before secret rotation can continue.");
  }
  const accountSubdomain = await cf.getAccountWorkersSubdomain(accountId);
  const workerUrlBase = `https://${effectiveScriptName}.${accountSubdomain}.workers.dev`;
  const webhookSecret = randomToken(36);
  const webhookUrl = `${workerUrlBase}/tg/${webhookSecret}`;

  onProgress("updating worker secret");
  await cf.setWorkerSecret(accountId, effectiveScriptName, "BOT_TOKEN", telegramBotToken);
  await cf.setWorkerSecret(accountId, effectiveScriptName, "WEBHOOK_SECRET", webhookSecret);

  onProgress("updating Telegram webhook");
  await tg.setWebhook(webhookUrl, webhookSecret);

  const statePath = statePathFor(cwd);
  const stateData = {
    ...saved,
    version: 1,
    domain,
    zoneId: zone.id,
    accountId,
    scriptName: effectiveScriptName,
    accountSubdomain,
    workerUrlBase,
    webhookUrlPrefix: `${workerUrlBase}/tg/`,
    botUsername: botInfo.username
  };
  writeJsonFile(statePath, stateData);

  return {
    workerUrlBase,
    webhookUrl,
    statePath
  };
}
