// Read + validate environment variables for the listener.
// Exposes a single ``loadConfig()`` that throws on missing required vars.

const DEFAULT_OTP_REGEX =
  "(?:OTP|kode|code|verif(?:ikasi|y))[^0-9]{0,20}([0-9]{4,8})";

/**
 * @typedef {Object} ListenerConfig
 * @property {string} authDir
 * @property {string} relayUrl
 * @property {string} relayToken
 * @property {string[]} expectedSenders
 * @property {RegExp} otpRegex
 * @property {number} minBodyLength
 * @property {string} logLevel
 * @property {"qr"|"code"} pairMode
 * @property {string} pairPhone
 */

function parseSenders(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/** Load + validate config from process.env. Throws on required-missing. */
export function loadConfig(env = process.env) {
  const missing = [];

  const authDir = (env.WA_AUTH_DIR || "").trim();
  if (!authDir) missing.push("WA_AUTH_DIR");

  const relayUrl = (env.RELAY_URL || "").trim();
  if (!relayUrl) missing.push("RELAY_URL");

  const relayToken = (env.RELAY_TOKEN || "").trim();
  if (!relayToken) missing.push("RELAY_TOKEN");

  if (missing.length > 0) {
    throw new Error(
      `missing required env vars: ${missing.join(", ")} (copy .env.example)`
    );
  }

  let otpRegex;
  try {
    otpRegex = new RegExp(env.WA_OTP_REGEX || DEFAULT_OTP_REGEX, "i");
  } catch (e) {
    throw new Error(`invalid WA_OTP_REGEX: ${e.message}`);
  }

  const pairMode = (env.WA_PAIR_MODE || "qr").toLowerCase() === "code" ? "code" : "qr";
  const pairPhone = (env.WA_PAIR_PHONE || "").replace(/[^0-9]/g, "");
  if (pairMode === "code" && !pairPhone) {
    throw new Error("WA_PAIR_MODE=code requires WA_PAIR_PHONE (digits only, e.g. 628123456789)");
  }

  return {
    authDir,
    relayUrl,
    relayToken,
    expectedSenders: parseSenders(env.WA_EXPECTED_SENDERS),
    otpRegex,
    minBodyLength: parsePositiveInt(env.WA_MIN_BODY_LENGTH, 6),
    logLevel: (env.LOG_LEVEL || "info").toLowerCase(),
    pairMode,
    pairPhone
  };
}
