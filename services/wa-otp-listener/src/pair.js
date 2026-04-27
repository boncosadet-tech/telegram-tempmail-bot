#!/usr/bin/env node
// One-shot helper: request a WhatsApp pair-code for the phone number
// passed on argv[2] (digits only, no leading +). Exits after the code
// is printed so the operator can run it from systemctl / CLI without
// leaving a listener open.
//
// After pair, future `npm start` reuses the state in WA_AUTH_DIR.
//
// Usage:
//   node src/pair.js 628123456789

import { mkdirSync } from "node:fs";
import process from "node:process";
import pino from "pino";
import {
  Browsers,
  default as makeWASocket,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import { loadConfig } from "./config.js";

const argPhone = (process.argv[2] || "").replace(/[^0-9]/g, "");
if (!argPhone) {
  console.error("usage: node src/pair.js <phone-digits-only, e.g. 628123456789>");
  process.exit(2);
}

// Force pair-code mode for this run regardless of .env.
process.env.WA_PAIR_MODE = "code";
process.env.WA_PAIR_PHONE = argPhone;

const config = loadConfig();
const logger = pino({ level: config.logLevel });
mkdirSync(config.authDir, { recursive: true });

async function main() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);

  if (state.creds.registered) {
    logger.info("already paired — no code needed (auth state present)");
    process.exit(0);
  }

  const sock = makeWASocket({
    auth: state,
    logger: logger.child({ component: "baileys" }),
    browser: Browsers.appropriate("WA-OTP-Listener"),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  try {
    const code = await sock.requestPairingCode(argPhone);
    logger.info({ phone: argPhone, code }, "PAIR CODE ISSUED");
    // Keep the socket up long enough for the phone to consume the code.
    // We exit once the connection is fully established.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pair timeout after 180s")), 180_000);
      sock.ev.on("connection.update", (update) => {
        if (update.connection === "open") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    logger.info("pairing completed — credentials saved");
    process.exit(0);
  } catch (err) {
    logger.error({ err: err?.message }, "pair-code flow failed");
    process.exit(1);
  }
}

main();
