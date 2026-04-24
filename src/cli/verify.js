#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CloudflareClient } from "../lib/cloudflare.js";
import { TelegramClient } from "../lib/telegram.js";
import {
  normalizeDomainName,
  parseArgs,
  promptInput,
  readInput,
  readJsonFile,
  requireInput,
  sanitizeWorkerName,
  withPrompts
} from "../lib/common.js";
import { performVerify, resolveScriptName } from "../lib/service.js";

function printStatus(name, status, detail) {
  console.log(`${status.toUpperCase().padEnd(7)} ${name} ${detail ? `- ${detail}` : ""}`);
}

async function collectVerifyInputs(args, cwd) {
  const saved = readJsonFile(path.resolve(cwd, ".tempmail/setup-state.json"), {});
  let domain = readInput(args, "domain", "DOMAIN", saved.domain || "");
  let cfEmail = readInput(args, "cf-email", "CF_EMAIL");
  let cfGlobalKey = readInput(args, "cf-global-key", "CF_GLOBAL_KEY");
  let telegramBotToken = readInput(args, "telegram-bot-token", "TELEGRAM_BOT_TOKEN");
  let scriptNameInput = readInput(args, "script-name", "SCRIPT_NAME", saved.scriptName || "");

  const missingRequired = !domain || !cfEmail || !cfGlobalKey;
  if (missingRequired) {
    await withPrompts(async (rl) => {
      console.log("Interactive verify");
      domain = await promptInput(rl, "Domain", domain);
      cfEmail = await promptInput(rl, "Cloudflare email", cfEmail);
      cfGlobalKey = await promptInput(rl, "Cloudflare Global API Key", cfGlobalKey);
      telegramBotToken = await promptInput(rl, "Telegram bot token (optional)", telegramBotToken);
      scriptNameInput = await promptInput(rl, "Worker script name", scriptNameInput);
    });
  }

  domain = normalizeDomainName(domain);
  requireInput("domain", domain);
  requireInput("cf-email", cfEmail);
  requireInput("cf-global-key", cfGlobalKey);

  return { domain, cfEmail, cfGlobalKey, telegramBotToken, scriptNameInput };
}

export async function runVerify(rawArgs = parseArgs(process.argv.slice(2))) {
  const cwd = process.cwd();
  const { domain, cfEmail, cfGlobalKey, telegramBotToken, scriptNameInput } =
    await collectVerifyInputs(rawArgs, cwd);

  const scriptName = resolveScriptName(
    domain,
    scriptNameInput ? sanitizeWorkerName(scriptNameInput) : ""
  );
  const cf = new CloudflareClient({ email: cfEmail, globalApiKey: cfGlobalKey });
  const tg = telegramBotToken ? new TelegramClient(telegramBotToken) : null;
  const result = await performVerify({
    cf,
    tg,
    domain,
    scriptName,
    onStatus: printStatus
  });
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runVerify().catch((error) => {
    console.error(`[verify] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
