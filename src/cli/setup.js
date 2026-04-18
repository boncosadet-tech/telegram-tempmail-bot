#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CloudflareClient } from "../lib/cloudflare.js";
import { TelegramClient } from "../lib/telegram.js";
import {
  boolInput,
  defaultWorkerNameForDomain,
  parseArgs,
  randomToken,
  readInput,
  readTextFile,
  requireInput,
  sanitizeWorkerName,
  writeJsonFile
} from "../lib/common.js";

function normalizeCatchAllTarget(catchAll) {
  const action = catchAll?.actions?.find((item) => item.type === "worker");
  const value = action?.value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return "";
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const domain = readInput(args, "domain", "DOMAIN");
  const cfEmail = readInput(args, "cf-email", "CF_EMAIL");
  const cfGlobalKey = readInput(args, "cf-global-key", "CF_GLOBAL_KEY");
  const telegramBotToken = readInput(args, "telegram-bot-token", "TELEGRAM_BOT_TOKEN");
  const force = boolInput(args, "force", "FORCE", false);
  const dryRun = boolInput(args, "dry-run", "DRY_RUN", false);
  const scriptNameInput = readInput(args, "script-name", "SCRIPT_NAME");

  requireInput("domain", domain);
  requireInput("cf-email", cfEmail);
  requireInput("cf-global-key", cfGlobalKey);
  requireInput("telegram-bot-token", telegramBotToken);

  const scriptName = scriptNameInput
    ? sanitizeWorkerName(scriptNameInput)
    : defaultWorkerNameForDomain(domain);
  const kvTitle = `telegram-tempmail:${domain}`;
  const webhookSecret = randomToken(36);
  const claimToken = "claim";

  const tg = new TelegramClient(telegramBotToken);
  const cf = new CloudflareClient({ email: cfEmail, globalApiKey: cfGlobalKey });

  console.log(`[setup] validating Telegram bot token`);
  const me = await tg.getMe();
  if (!me.username) {
    throw new Error("Telegram bot must have a username before setup can continue.");
  }

  console.log(`[setup] resolving Cloudflare zone for ${domain}`);
  const zone = await cf.getZoneByDomain(domain);
  const accountId = zone.account?.id;
  if (!accountId) {
    throw new Error("Cloudflare zone has no account id.");
  }

  console.log(`[setup] ensuring KV namespace`);
  const kvNamespace = await cf.findOrCreateKVNamespace(accountId, kvTitle);

  const accountSubdomainInfo = await cf.getAccountWorkersSubdomain(accountId);
  const accountSubdomain = accountSubdomainInfo;
  const workerUrlBase = `https://${scriptName}.${accountSubdomain}.workers.dev`;
  const webhookUrl = `${workerUrlBase}/tg/${webhookSecret}`;

  if (dryRun) {
    console.log("[setup] dry-run complete");
    console.log(
      JSON.stringify(
        {
          domain,
          scriptName,
          accountId,
          zoneId: zone.id,
          kvNamespaceId: kvNamespace.id,
          workerUrlBase,
          webhookUrl,
          claimLink: `https://t.me/${me.username}?start=${claimToken}`
        },
        null,
        2
      )
    );
    return;
  }

  const mainPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../main.js");
  const workerSource = readTextFile(mainPath);

  console.log(`[setup] uploading worker script ${scriptName}`);
  await cf.uploadWorkerScript(accountId, scriptName, workerSource, domain, kvNamespace.id, "2026-04-18");

  console.log("[setup] setting worker secrets");
  await cf.setWorkerSecret(accountId, scriptName, "BOT_TOKEN", telegramBotToken);
  await cf.setWorkerSecret(accountId, scriptName, "WEBHOOK_SECRET", webhookSecret);

  console.log("[setup] enabling workers.dev endpoint");
  await cf.enableWorkerSubdomain(accountId, scriptName);

  console.log("[setup] enabling email routing DNS (idempotent)");
  await cf.enableEmailRoutingDns(zone.id);

  console.log("[setup] checking catch-all rule");
  const catchAll = await cf.getCatchAllRule(zone.id);
  const existingTarget = normalizeCatchAllTarget(catchAll);
  if (existingTarget && existingTarget !== scriptName && !force) {
    throw new Error(
      `Catch-all currently points to worker "${existingTarget}". Re-run with --force to replace it.`
    );
  }
  await cf.setCatchAllWorker(zone.id, scriptName);

  console.log("[setup] configuring Telegram webhook");
  await tg.setWebhook(webhookUrl, webhookSecret);

  const statePath = path.resolve(process.cwd(), ".tempmail/setup-state.json");
  const stateData = {
    version: 1,
    createdAt: new Date().toISOString(),
    domain,
    zoneId: zone.id,
    accountId,
    scriptName,
    accountSubdomain,
    workerUrlBase,
    webhookUrlPrefix: `${workerUrlBase}/tg/`,
    kvNamespaceId: kvNamespace.id,
    botUsername: me.username,
    claimToken
  };
  writeJsonFile(statePath, stateData);

  console.log("");
  console.log("[setup] success");
  console.log(`Worker URL: ${workerUrlBase}`);
  console.log(`Claim link: https://t.me/${me.username}?start=${claimToken}`);
  console.log(`State file: ${statePath}`);
}

run().catch((error) => {
  console.error(`[setup] failed: ${error.message}`);
  process.exitCode = 1;
});
