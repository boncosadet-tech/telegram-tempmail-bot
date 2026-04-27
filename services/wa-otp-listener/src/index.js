#!/usr/bin/env node
// WA OTP listener: connects to WhatsApp via Baileys, parses incoming
// messages for OTP codes, and forwards them to the telegram-tempmail
// Worker relay endpoint.
//
// Design goals:
//   - Read-only: never sends a WA message (keeps the linked-device
//     footprint minimal and reduces ban risk).
//   - Persistent auth state in WA_AUTH_DIR (not /tmp).
//   - systemd-friendly: simple process, logs to stdout/stderr,
//     graceful SIGTERM, non-zero exit on fatal pairing errors so
//     systemd can surface them.

import { mkdirSync } from "node:fs";
import process from "node:process";
import pino from "pino";
import qrcode from "qrcode-terminal";
import {
  Browsers,
  DisconnectReason,
  default as makeWASocket,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import { loadConfig } from "./config.js";
import { extractMessageText, extractOtp, isSenderAllowed, maskOtp } from "./parser.js";
import { postOtpToRelay } from "./relay.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`[wa-otp-listener] config error: ${err.message}`);
  process.exit(2);
}

const logger = pino({
  level: config.logLevel,
  transport: process.stdout.isTTY
    ? { target: "pino/file", options: { destination: 1 } }
    : undefined
});

// Reduce Baileys' own noise to warn+ unless LOG_LEVEL=debug.
const baileysLogger = logger.child({ component: "baileys" });
baileysLogger.level = config.logLevel === "debug" ? "debug" : "warn";

mkdirSync(config.authDir, { recursive: true });

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);

  const sock = makeWASocket({
    auth: state,
    logger: baileysLogger,
    browser: Browsers.appropriate("WA-OTP-Listener"),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false
  });

  let pairingCodePrinted = false;

  // Pair-code flow: used when the operator set WA_PAIR_MODE=code and
  // there is no existing session. Request the 8-digit code once.
  if (
    !sock.authState.creds.registered &&
    config.pairMode === "code" &&
    !pairingCodePrinted
  ) {
    try {
      const code = await sock.requestPairingCode(config.pairPhone);
      logger.info(
        { phone: config.pairPhone, code },
        "pairing code issued — enter on phone: WhatsApp ▸ Linked Devices ▸ Link with phone number"
      );
      pairingCodePrinted = true;
    } catch (err) {
      logger.error({ err: err?.message }, "failed to request pairing code");
    }
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && config.pairMode === "qr" && !sock.authState.creds.registered) {
      logger.info("scan QR on your phone: WhatsApp ▸ Linked Devices ▸ Link a device");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      logger.info(
        {
          me: sock.authState?.creds?.me?.id || null,
          senders: config.expectedSenders,
          regex: config.otpRegex.source
        },
        "whatsapp connection open — listening for OTP"
      );
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logger.warn({ code, shouldReconnect }, "whatsapp connection closed");
      if (shouldReconnect) {
        setTimeout(() => start().catch((e) => logger.error({ err: e?.message }, "restart failed")), 3000);
      } else {
        logger.error("logged out — delete WA_AUTH_DIR and re-pair");
        process.exit(3);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        await handleMessage(msg);
      } catch (err) {
        logger.error({ err: err?.message }, "message handler threw");
      }
    }
  });

  function handleMessage(msg) {
    if (!msg?.message) return Promise.resolve();
    if (msg.key?.fromMe) return Promise.resolve();

    const remoteJid = msg.key?.remoteJid || "";
    const participant = msg.key?.participant || ""; // group sender
    const effectiveJid = participant || remoteJid;

    if (!isSenderAllowed(effectiveJid, config.expectedSenders)) {
      logger.debug({ jid: effectiveJid }, "sender not in allow-list");
      return Promise.resolve();
    }

    const body = extractMessageText(msg.message);
    if (!body) return Promise.resolve();

    const otp = extractOtp(body, config.otpRegex, {
      minBodyLength: config.minBodyLength
    });
    if (!otp) {
      logger.debug({ jid: effectiveJid, bodyLen: body.length }, "no OTP match");
      return Promise.resolve();
    }

    logger.info({ jid: effectiveJid, masked: maskOtp(otp) }, "OTP extracted — forwarding");

    return postOtpToRelay({
      relayUrl: config.relayUrl,
      relayToken: config.relayToken,
      code: otp,
      sourceJid: effectiveJid,
      logger
    }).then((result) => {
      if (!result.ok) {
        logger.error(
          { status: result.status, body: String(result.body).slice(0, 200) },
          "failed to forward OTP"
        );
      }
    });
  }
}

function shutdown(signal) {
  logger.info({ signal }, "received signal, exiting");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  logger.error({ err: err?.message }, "fatal startup error");
  process.exit(1);
});
