// Domain, alias, and owner helpers.

import { randomDigits, randomItem } from "./utils.js";

export const OWNER_KEY = "owner";
export const DOMAINS_KEY = "domains";

const ALIAS_ADJECTIVES = [
  "amber",
  "brisk",
  "calm",
  "clever",
  "dawn",
  "ember",
  "lunar",
  "nova",
  "quiet",
  "swift"
];
const ALIAS_NOUNS = [
  "field",
  "forest",
  "harbor",
  "meadow",
  "orbit",
  "river",
  "signal",
  "spring",
  "valley",
  "wave"
];

/** Readable two-word + 4-digit alias local part. */
export function generateReadableLocal() {
  return `${randomItem(ALIAS_ADJECTIVES)}-${randomItem(ALIAS_NOUNS)}-${randomDigits(4)}`;
}

/**
 * Normalize a user-supplied alias local part. Returns empty string if the input
 * cannot be safely mapped to a valid email local part.
 */
export function sanitizeRequestedLocal(input) {
  const raw = String(input ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  const localOnly = raw.split("@")[0];
  const sanitized = localOnly
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[._-]{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 48);
  if (!sanitized) return "";
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(sanitized)) return "";
  return sanitized;
}

/** Strip scheme/path/leading `@`, fold case, and trim trailing dots. */
export function normalizeDomainName(input) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/^@+/, "")
    .replace(/\.+$/g, "");
}

export function formatDomainList(domains) {
  return domains.length > 0 ? domains.join(", ") : "-";
}

/**
 * Parse a `/new [local][@domain]` command body.
 * Returns `{ local, domain, custom, error? }`.
 */
export function parseNewAlias(text) {
  const parts = String(text ?? "")
    .trim()
    .split(/\s+/)
    .slice(1);
  if (parts.length === 0) {
    return { local: generateReadableLocal(), domain: "", custom: false };
  }
  const raw = parts.join("-").trim().toLowerCase();
  const requestedDomain = raw.includes("@")
    ? normalizeDomainName(raw.split("@").slice(1).join("@"))
    : "";
  const requested = sanitizeRequestedLocal(raw);
  if (!requested) {
    return {
      local: "",
      domain: requestedDomain,
      custom: true,
      error: "Custom alias only supports letters, numbers, dot, dash, and underscore."
    };
  }
  return { local: requested, domain: requestedDomain, custom: true };
}

/** Extract the local part from an `alias@domain` address. */
export function aliasLocalFromAddress(address) {
  return String(address ?? "")
    .split("@")[0]
    .trim()
    .toLowerCase();
}

/**
 * Resolve the active domain list. Primary binding (`env.DOMAIN`) is always first;
 * additional domains may be appended via the `domains` key in KV.
 */
export async function getConfiguredDomains(env) {
  const domains = [];
  const add = (value) => {
    const domain = normalizeDomainName(value);
    if (domain && !domains.includes(domain)) domains.push(domain);
  };
  add(env.DOMAIN || "example.com");
  if (env.STATE_KV) {
    const raw = await env.STATE_KV.get(DOMAINS_KEY).catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const values = Array.isArray(parsed) ? parsed : parsed?.domains;
        if (Array.isArray(values)) for (const value of values) add(value);
      } catch {
        // Ignore malformed optional list; primary DOMAIN still applies.
      }
    }
  }
  return domains;
}

/**
 * Load the owner record from KV, tolerating missing keys and malformed JSON.
 * @returns {Promise<null | { userId: string; chatId: string; claimedAt?: string; domain?: string }>}
 */
export async function getOwner(env) {
  const raw = await env.STATE_KV.get(OWNER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setOwner(env, owner) {
  await env.STATE_KV.put(OWNER_KEY, JSON.stringify(owner));
}

/** True if the given Telegram message or callback originates from the claimed owner. */
export function isOwnerMessage(msg, owner) {
  if (!msg || !owner) return false;
  const fromId = msg.from?.id != null ? String(msg.from.id) : "";
  const chatId = msg.chat?.id != null ? String(msg.chat.id) : "";
  return fromId === String(owner.userId) || chatId === String(owner.chatId);
}

/** Parse the optional token that accompanies `/start <token>`. */
export function parseStartToken(text) {
  const parts = String(text ?? "")
    .trim()
    .split(/\s+/);
  return parts.length > 1 ? parts[1] : "";
}

export function ownerStatusText(domain, owner, domains = [domain]) {
  const domainLines = [`Primary domain: ${domain}`, `Domains: ${formatDomainList(domains)}`];
  if (!owner) return `${domainLines.join("\n")}\nOwner: not claimed`;
  return [
    ...domainLines,
    `Owner user id: ${owner.userId}`,
    `Owner chat id: ${owner.chatId}`,
    `Claimed at: ${owner.claimedAt || "-"}`
  ].join("\n");
}
