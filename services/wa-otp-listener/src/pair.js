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
  fetchLatestBaileysVersion,
  makeWASocket,
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

  let version;
  try {
    const latest = await fetchLatestBaileysVersion();
    version = latest?.version;
  } catch {
    // fall through to Baileys default
  }

  const sock = makeWASocket({
    auth: state,
    logger: logger.child({ component: "baileys" }),
    browser: Browsers.appropriate("WA-OTP-Listener"),
    printQRInTerminal: false,
    ...(version ? { version } : {})
  });

  sock.ev.on("creds.update", saveCreds);

  // Wait until Baileys is actually connecting before requesting the pair
  // code. Calling requestPairingCode before the socket is ready returns
  // "Connection Closed".
  let codeRequested = false;
  async function requestCodeOnce() {
    if (codeRequested) return;
    codeRequested = true;
    try {
      const code = await sock.requestPairingCode(argPhone);
      // Pretty-print with a dash after 4 digits (matches WA UI).
      const pretty = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
      logger.info({ phone: argPhone, code: pretty }, "PAIR CODE ISSUED");
    } catch (err) {
      logger.error({ err: err?.message }, "requestPairingCode failed");
      process.exit(1);
    }
  }

  const overallTimeout = setTimeout(() => {
    logger.error("pair timeout after 240s");
    process.exit(1);
  }, 240_000);

  sock.ev.on("connection.update", (update) => {
    const { connection, qr } = update;
    if (qr && !codeRequested) {
      // Baileys emits `qr` once the socket is ready — this is our cue
      // that we can safely request a pair-code. We do NOT render the QR.
      requestCodeOnce();
    }
    if (connection === "open") {
      clearTimeout(overallTimeout);
      logger.info("pairing completed — credentials saved");
      process.exit(0);
    }
    if (connection === "close") {
      logger.warn(
        { reason: update?.lastDisconnect?.error?.message },
        "connection closed while waiting for pair"
      );
      // Keep looping until pair or overall timeout.
    }
  });
}

main().catch((err) => {
  console.error("pair: fatal:", err?.message || err);
  process.exit(1);
});
