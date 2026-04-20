#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { CloudflareClient } from "../lib/cloudflare.js";
import { TelegramClient } from "../lib/telegram.js";
import {
  defaultWorkerNameForDomain,
  boolInput,
  normalizeDomainName,
  parseArgs,
  promptInput,
  readInput,
  readJsonFile,
  requireInput,
  sanitizeWorkerName,
  withPrompts
} from "../lib/common.js";
import { addDomainToApp, resetOwner, rotateWebhookSecret } from "../lib/service.js";

async function collectAdminInputs(args, cwd) {
  const saved = readJsonFile(`${cwd}/.tempmail/setup-state.json`, {});
  let action = readInput(args, "action", "ACTION");
  const domainFallback = action === "add-domain" ? "" : saved.domain || "";
  let domain = readInput(args, "domain", "DOMAIN", domainFallback);
  let cfEmail = readInput(args, "cf-email", "CF_EMAIL");
  let cfGlobalKey = readInput(args, "cf-global-key", "CF_GLOBAL_KEY");
  let telegramBotToken = readInput(args, "telegram-bot-token", "TELEGRAM_BOT_TOKEN");
  let scriptNameInput = readInput(args, "script-name", "SCRIPT_NAME", saved.scriptName || "");
  let force = boolInput(args, "force", "FORCE", false);

  if (!action || !domain || !cfEmail || !cfGlobalKey) {
    await withPrompts(async (rl) => {
      console.log("Interactive admin");
      action = await promptInput(rl, "Action (reset-owner|rotate-secret|add-domain)", action || "reset-owner");
      if (action === "add-domain" && domain === saved.domain) domain = "";
      domain = await promptInput(rl, action === "add-domain" ? "Domain to add" : "Domain", domain);
      cfEmail = await promptInput(rl, "Cloudflare email", cfEmail);
      cfGlobalKey = await promptInput(rl, "Cloudflare Global API Key", cfGlobalKey);
      if (action === "rotate-secret") {
        telegramBotToken = await promptInput(rl, "Telegram bot token", telegramBotToken);
      }
      scriptNameInput = await promptInput(rl, "Worker script name", scriptNameInput);
      if (action === "add-domain" && !force) {
        force = (await promptInput(rl, "Replace existing foreign catch-all if found? (yes/no)", "no")).toLowerCase().startsWith("y");
      }
    });
  }

  domain = normalizeDomainName(domain);
  requireInput("action", action);
  requireInput("domain", domain);
  requireInput("cf-email", cfEmail);
  requireInput("cf-global-key", cfGlobalKey);
  if (action === "rotate-secret") {
    requireInput("telegram-bot-token", telegramBotToken);
  }

  return {
    action,
    domain,
    cfEmail,
    cfGlobalKey,
    telegramBotToken,
    scriptNameInput,
    force
  };
}

export async function runAdmin(rawArgs = parseArgs(process.argv.slice(2))) {
  const cwd = process.cwd();
  const {
    action,
    domain,
    cfEmail,
    cfGlobalKey,
    telegramBotToken,
    scriptNameInput,
    force
  } = await collectAdminInputs(rawArgs, cwd);
  const cf = new CloudflareClient({ email: cfEmail, globalApiKey: cfGlobalKey });
  const scriptName = scriptNameInput
    ? sanitizeWorkerName(scriptNameInput)
    : (action === "add-domain" ? "" : defaultWorkerNameForDomain(domain));

  if (action === "add-domain") {
    const result = await addDomainToApp({
      cf,
      domain,
      scriptName,
      cwd,
      force,
      onProgress: (message) => console.log(`[admin] ${message}`)
    });
    console.log("[admin] success");
    console.log(`Added domain: ${result.domain}`);
    console.log(`Worker script: ${result.scriptName}`);
    console.log(`Configured domains: ${result.domains.join(", ")}`);
    console.log(`State file: ${result.statePath}`);
    return;
  }

  if (action === "reset-owner") {
    const result = await resetOwner({
      cf,
      domain,
      scriptName,
      cwd,
      onProgress: (message) => console.log(`[admin] ${message}`)
    });
    console.log("[admin] success");
    console.log(`Owner reset for script ${result.scriptName}`);
    return;
  }

  if (action === "rotate-secret") {
    const tg = new TelegramClient(telegramBotToken);
    const result = await rotateWebhookSecret({
      cf,
      tg,
      domain,
      scriptName,
      telegramBotToken,
      cwd,
      onProgress: (message) => console.log(`[admin] ${message}`)
    });
    console.log("[admin] success");
    console.log(`New webhook URL: ${result.webhookUrl}`);
    console.log(`State file: ${result.statePath}`);
    return;
  }

  throw new Error(`Unknown action: ${action}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAdmin().catch((error) => {
    console.error(`[admin] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
