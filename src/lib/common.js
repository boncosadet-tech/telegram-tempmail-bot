import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > 2) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

export function readInput(args, key, envName, fallback = "") {
  return (args[key] || process.env[envName] || fallback).trim();
}

export function requireInput(name, value) {
  if (!value) {
    throw new Error(`Missing required input: ${name}`);
  }
}

export function boolInput(args, key, envName = "", defaultValue = false) {
  const raw = args[key] ?? (envName ? process.env[envName] : undefined);
  if (raw == null) return defaultValue;
  const normalized = String(raw).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export function sanitizeWorkerName(name) {
  let candidate = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!candidate) {
    candidate = "telegram-tempmail";
  }
  if (candidate.length > 63) {
    candidate = candidate.slice(0, 63).replace(/-+$/g, "");
  }
  if (!candidate) {
    candidate = "telegram-tempmail";
  }
  return candidate;
}

export function defaultWorkerNameForDomain(domain) {
  return sanitizeWorkerName(`telegram-tempmail-${domain}`);
}

export function randomToken(length = 32) {
  const raw = crypto.randomBytes(Math.ceil((length * 3) / 4));
  return raw
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
    .slice(0, length);
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}
