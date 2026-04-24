#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CloudflareClient } from "../lib/cloudflare.js";
import { TelegramClient } from "../lib/telegram.js";
import {
  boolInput,
  normalizeDomainName,
  parseArgs,
  promptConfirm,
  promptInput,
  readInput,
  readJsonFile,
  requireInput,
  withPrompts,
  sanitizeWorkerName
} from "../lib/common.js";
import { performSetup, resolveScriptName } from "../lib/service.js";

async function collectSetupInputs(args, cwd) {
  const statePath = path.resolve(cwd, ".tempmail/setup-state.json");
  const saved = readJsonFile(statePath, {});
  let domain = readInput(args, "domain", "DOMAIN", saved.domain || "");
  let cfEmail = readInput(args, "cf-email", "CF_EMAIL");
  let cfGlobalKey = readInput(args, "cf-global-key", "CF_GLOBAL_KEY");
  let telegramBotToken = readInput(args, "telegram-bot-token", "TELEGRAM_BOT_TOKEN");
  let scriptNameInput = readInput(args, "script-name", "SCRIPT_NAME", saved.scriptName || "");
  let force = boolInput(args, "force", "FORCE", false);
  const dryRun = boolInput(args, "dry-run", "DRY_RUN", false);

  const missingRequired = !domain || !cfEmail || !cfGlobalKey || !telegramBotToken;
  if (missingRequired) {
    await withPrompts(async (rl) => {
      console.log("Interactive setup");
      domain = await promptInput(rl, "Domain", domain);
      cfEmail = await promptInput(rl, "Cloudflare email", cfEmail);
      cfGlobalKey = await promptInput(rl, "Cloudflare Global API Key", cfGlobalKey);
      telegramBotToken = await promptInput(rl, "Telegram bot token", telegramBotToken);
      scriptNameInput = await promptInput(rl, "Worker script name", scriptNameInput);
      if (!force) {
        force = await promptConfirm(rl, "Replace existing foreign catch-all if found", false);
      }
    });
  }

  domain = normalizeDomainName(domain);
  requireInput("domain", domain);
  requireInput("cf-email", cfEmail);
  requireInput("cf-global-key", cfGlobalKey);
  requireInput("telegram-bot-token", telegramBotToken);

  return {
    domain,
    cfEmail,
    cfGlobalKey,
    telegramBotToken,
    scriptNameInput,
    force,
    dryRun
  };
}

export async function runSetup(rawArgs = parseArgs(process.argv.slice(2))) {
  const cwd = process.cwd();
  const { domain, cfEmail, cfGlobalKey, telegramBotToken, scriptNameInput, force, dryRun } =
    await collectSetupInputs(rawArgs, cwd);

  const scriptName = resolveScriptName(
    domain,
    scriptNameInput ? sanitizeWorkerName(scriptNameInput) : ""
  );

  const tg = new TelegramClient(telegramBotToken);
  const cf = new CloudflareClient({ email: cfEmail, globalApiKey: cfGlobalKey });

  const result = await performSetup({
    cwd,
    cf,
    tg,
    domain,
    scriptName,
    telegramBotToken,
    force,
    dryRun,
    onProgress: (message) => console.log(`[setup] ${message}`)
  });

  if (dryRun) {
    console.log("[setup] dry-run complete");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("");
  console.log("[setup] success");
  console.log(`Worker URL: ${result.workerUrlBase}`);
  console.log(`Claim link: ${result.claimLink}`);
  console.log(`State file: ${result.statePath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSetup().catch((error) => {
    console.error(`[setup] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
