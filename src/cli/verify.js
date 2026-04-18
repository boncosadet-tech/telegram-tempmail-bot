#!/usr/bin/env node
import { CloudflareClient } from "../lib/cloudflare.js";
import { TelegramClient } from "../lib/telegram.js";
import {
  defaultWorkerNameForDomain,
  parseArgs,
  readInput,
  requireInput,
  sanitizeWorkerName
} from "../lib/common.js";

function printStatus(name, status, detail) {
  console.log(`${status.toUpperCase().padEnd(7)} ${name} ${detail ? `- ${detail}` : ""}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const domain = readInput(args, "domain", "DOMAIN");
  const cfEmail = readInput(args, "cf-email", "CF_EMAIL");
  const cfGlobalKey = readInput(args, "cf-global-key", "CF_GLOBAL_KEY");
  const telegramBotToken = readInput(args, "telegram-bot-token", "TELEGRAM_BOT_TOKEN");
  const scriptNameInput = readInput(args, "script-name", "SCRIPT_NAME");

  requireInput("domain", domain);
  requireInput("cf-email", cfEmail);
  requireInput("cf-global-key", cfGlobalKey);

  const scriptName = scriptNameInput
    ? sanitizeWorkerName(scriptNameInput)
    : defaultWorkerNameForDomain(domain);
  const cf = new CloudflareClient({ email: cfEmail, globalApiKey: cfGlobalKey });

  const failures = [];

  const zone = await cf.getZoneByDomain(domain);
  printStatus("zone", "ok", `${zone.name} (${zone.id})`);

  const accountId = zone.account?.id;
  if (!accountId) {
    throw new Error("Cloudflare zone has no account id.");
  }

  const accountSubdomain = await cf.getAccountWorkersSubdomain(accountId);
  printStatus("workers-subdomain", "ok", accountSubdomain);

  const workerSettings = await cf.getWorkerSettings(accountId, scriptName).catch((error) => {
    failures.push(`worker settings unavailable: ${error.message}`);
    return null;
  });
  let kvBinding = null;
  if (workerSettings) {
    const bindings = workerSettings.bindings || [];
    const domainBinding = bindings.find((b) => b.type === "plain_text" && b.name === "DOMAIN");
    kvBinding = bindings.find((b) => b.type === "kv_namespace" && b.name === "STATE_KV");
    if (!domainBinding || domainBinding.text !== domain) {
      failures.push("DOMAIN binding is missing or mismatched");
    } else {
      printStatus("binding DOMAIN", "ok", domainBinding.text);
    }
    if (!kvBinding || !kvBinding.namespace_id) {
      failures.push("STATE_KV binding is missing");
    } else {
      printStatus("binding STATE_KV", "ok", kvBinding.namespace_id);
    }
  }

  const routing = await cf.getEmailRouting(zone.id);
  if (!routing.enabled) {
    failures.push("Email routing is not enabled");
  } else {
    printStatus("email-routing", "ok", `${routing.status || "unknown"}`);
  }

  const catchAll = await cf.getCatchAllRule(zone.id);
  const workerAction = catchAll?.actions?.find((a) => a.type === "worker");
  const target = Array.isArray(workerAction?.value) ? workerAction.value[0] : "";
  if (!target) {
    failures.push("Catch-all is not using worker action");
  } else if (target !== scriptName) {
    failures.push(`Catch-all points to "${target}" instead of "${scriptName}"`);
  } else {
    printStatus("catch-all", "ok", target);
  }

  if (kvBinding?.namespace_id) {
    const ownerRaw = await cf.getKVValue(accountId, kvBinding.namespace_id, "owner");
    if (!ownerRaw) {
      printStatus("owner-claim", "pending", "owner not claimed yet, send /start claim");
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
        printStatus("owner-claim", "ok", `userId=${owner.userId} chatId=${owner.chatId}`);
      }
    }
  }

  if (telegramBotToken) {
    const tg = new TelegramClient(telegramBotToken);
    const webhookInfo = await tg.getWebhookInfo();
    const expectedPrefix = `https://${scriptName}.${accountSubdomain}.workers.dev/tg/`;
    const actualUrl = webhookInfo.url || "";
    if (!actualUrl) {
      failures.push("Telegram webhook URL is empty");
    } else if (!actualUrl.startsWith(expectedPrefix)) {
      failures.push(`Telegram webhook URL mismatch: ${actualUrl}`);
    } else {
      printStatus("telegram-webhook", "ok", actualUrl);
    }
  } else {
    printStatus("telegram-webhook", "pending", "skipped (provide --telegram-bot-token to validate)");
  }

  if (failures.length > 0) {
    for (const item of failures) {
      printStatus("failure", "failed", item);
    }
    process.exitCode = 1;
    return;
  }
  printStatus("verify", "ok", "all critical checks passed");
}

run().catch((error) => {
  console.error(`[verify] failed: ${error.message}`);
  process.exitCode = 1;
});
