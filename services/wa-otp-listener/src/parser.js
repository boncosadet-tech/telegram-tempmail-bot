// Pure OTP extraction helpers — no side effects, trivially unit-testable.

const DEFAULT_MIN_BODY_LENGTH = 6;

/** Mask all but the last two digits. Matches worker/otp_relay.js:maskOtp. */
export function maskOtp(code) {
  const s = String(code ?? "");
  if (s.length <= 2) return "*".repeat(s.length);
  return "*".repeat(s.length - 2) + s.slice(-2);
}

/** Normalise a message body: join whitespace runs, trim. */
function normaliseBody(body) {
  return String(body ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Extract an OTP from a WhatsApp message body.
 *
 * Strategy:
 *  1. Run the configured regex (must contain a capturing group for digits).
 *  2. If no match, fall back to a loose "first 4–8 digit run that looks
 *     OTP-shaped" extractor — but only if the body contains an
 *     OTP-adjacent keyword to avoid false positives from amounts or
 *     phone numbers (e.g. "Rp 100.000" or "+62 812...").
 *
 * Returns the digits-only string or null.
 *
 * @param {string} body
 * @param {RegExp} regex
 * @param {{ minBodyLength?: number }} [opts]
 */
export function extractOtp(body, regex, opts = {}) {
  const minLength = opts.minBodyLength ?? DEFAULT_MIN_BODY_LENGTH;
  const normalised = normaliseBody(body);
  if (!normalised || normalised.length < minLength) return null;

  const primary = regex.exec(normalised);
  if (primary && primary[1]) {
    const digits = String(primary[1]).replace(/\D/g, "");
    if (digits.length >= 4 && digits.length <= 8) return digits;
  }

  // Loose fallback: only if the body contains an OTP keyword AND exactly
  // one 4–8 digit run exists (to avoid capturing amounts / phone numbers).
  const keywordHit = /(otp|kode|code|verif|pin\s+login|pass(?:word)?)/i.test(normalised);
  if (!keywordHit) return null;

  const runs = normalised.match(/\b\d{4,8}\b/g) || [];
  const candidates = runs.filter((r) => r.length >= 4 && r.length <= 8);
  if (candidates.length === 1) return candidates[0];
  return null;
}

/**
 * Decide if the supplied JID is an allowed OTP sender.
 *
 * - Empty allow-list -> accept any JID (regex-only filtering).
 * - Non-empty allow-list -> exact string match (case-insensitive).
 */
export function isSenderAllowed(jid, allowList) {
  if (!allowList || allowList.length === 0) return true;
  const lc = String(jid ?? "").toLowerCase();
  return allowList.some((allowed) => allowed.toLowerCase() === lc);
}

/**
 * Flatten a Baileys ``message`` object into a single plain-text string we
 * can regex-scan. Handles common shapes (conversation,
 * extendedTextMessage, imageMessage caption, buttonsResponseMessage, …).
 * Returns empty string when no text can be recovered.
 */
export function extractMessageText(messageObj) {
  if (!messageObj || typeof messageObj !== "object") return "";
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (typeof node !== "object") return;
    if (typeof node.conversation === "string") parts.push(node.conversation);
    if (typeof node.text === "string") parts.push(node.text);
    if (typeof node.caption === "string") parts.push(node.caption);
    if (node.extendedTextMessage) walk(node.extendedTextMessage);
    if (node.imageMessage) walk(node.imageMessage);
    if (node.videoMessage) walk(node.videoMessage);
    if (node.documentMessage) walk(node.documentMessage);
    if (node.buttonsResponseMessage) walk(node.buttonsResponseMessage);
    if (node.templateButtonReplyMessage) walk(node.templateButtonReplyMessage);
    if (node.listResponseMessage) walk(node.listResponseMessage);
    if (node.ephemeralMessage?.message) walk(node.ephemeralMessage.message);
    if (node.viewOnceMessage?.message) walk(node.viewOnceMessage.message);
    if (node.viewOnceMessageV2?.message) walk(node.viewOnceMessageV2.message);
  };
  walk(messageObj);
  return parts.join(" ").trim();
}
