// D1 repository for inbox messages + virtual aliases. Schema is self-healing
// at runtime so existing deployments pick up new columns on first request.

import { nowMs } from "./utils.js";

export const OTP_RETENTION_MS = 30 * 60 * 1000;
export const MAIL_RETENTION_MS = 24 * 60 * 60 * 1000;

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    alias_local TEXT NOT NULL,
    alias_full TEXT NOT NULL,
    sender TEXT NOT NULL,
    subject TEXT NOT NULL,
    preview_text TEXT NOT NULL,
    rendered_html TEXT NOT NULL DEFAULT '',
    otp_code TEXT NOT NULL DEFAULT '-',
    is_otp INTEGER NOT NULL DEFAULT 0,
    size_kb INTEGER NOT NULL DEFAULT 0,
    raw_kind TEXT NOT NULL DEFAULT 'unknown',
    received_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages (received_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_messages_alias_local ON messages (alias_local, received_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages (expires_at)",
  `CREATE TABLE IF NOT EXISTS aliases (
    alias_local TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    is_pinned INTEGER NOT NULL DEFAULT 0
  )`
];

const MESSAGE_COLUMNS = [
  "id",
  "alias_local",
  "alias_full",
  "sender",
  "subject",
  "preview_text",
  "rendered_html",
  "otp_code",
  "is_otp",
  "size_kb",
  "raw_kind",
  "received_at",
  "expires_at"
].join(", ");

export function hasMailDb(env) {
  return Boolean(env?.MAIL_DB && typeof env.MAIL_DB.prepare === "function");
}

async function runDb(env, sql, params = []) {
  if (!hasMailDb(env)) return null;
  const stmt = env.MAIL_DB.prepare(sql);
  const bound = params.length > 0 ? stmt.bind(...params) : stmt;
  return bound.run();
}

async function allDb(env, sql, params = []) {
  if (!hasMailDb(env)) return [];
  const stmt = env.MAIL_DB.prepare(sql);
  const bound = params.length > 0 ? stmt.bind(...params) : stmt;
  const result = await bound.all();
  return result?.results || [];
}

async function firstDb(env, sql, params = []) {
  if (!hasMailDb(env)) return null;
  const stmt = env.MAIL_DB.prepare(sql);
  const bound = params.length > 0 ? stmt.bind(...params) : stmt;
  return bound.first();
}

export async function ensureMailDb(env) {
  if (!hasMailDb(env) || env.__mailDbReady) return;
  for (const statement of SCHEMA_STATEMENTS) {
    await runDb(env, statement);
  }
  // Backfill column for older deployments. The column is already in the CREATE
  // above, but older tables without it need a migration.
  try {
    await runDb(env, "ALTER TABLE messages ADD COLUMN rendered_html TEXT NOT NULL DEFAULT ''");
  } catch (error) {
    if (!String(error?.message ?? error).includes("duplicate column")) {
      throw error;
    }
  }
  env.__mailDbReady = true;
}

export async function purgeExpiredMessages(env) {
  if (!hasMailDb(env)) return 0;
  await ensureMailDb(env);
  const result = await runDb(env, "DELETE FROM messages WHERE expires_at <= ?", [nowMs()]);
  return result?.meta?.changes || 0;
}

export async function upsertAlias(env, aliasLocal, source = "web") {
  if (!hasMailDb(env) || !aliasLocal) return;
  await ensureMailDb(env);
  const ts = nowMs();
  await runDb(
    env,
    `INSERT INTO aliases (alias_local, source, created_at, last_seen_at, is_pinned)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(alias_local) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    [aliasLocal, source, ts, ts]
  );
}

export async function insertMessage(env, message) {
  if (!hasMailDb(env)) return;
  await ensureMailDb(env);
  await runDb(
    env,
    `INSERT INTO messages (${MESSAGE_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.aliasLocal,
      message.aliasFull,
      message.sender,
      message.subject,
      message.previewText,
      message.renderedHtml,
      message.otpCode,
      message.isOtp ? 1 : 0,
      message.sizeKb,
      message.rawKind,
      message.receivedAt,
      message.expiresAt
    ]
  );
}

export async function listMessages(env, aliasFilter = "") {
  await ensureMailDb(env);
  await purgeExpiredMessages(env);
  const base = `SELECT ${MESSAGE_COLUMNS} FROM messages`;
  if (aliasFilter) {
    return allDb(env, `${base} WHERE alias_local = ? ORDER BY received_at DESC LIMIT 100`, [
      aliasFilter
    ]);
  }
  return allDb(env, `${base} ORDER BY received_at DESC LIMIT 100`);
}

export async function getMessageById(env, id) {
  await ensureMailDb(env);
  await purgeExpiredMessages(env);
  return firstDb(env, `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ? LIMIT 1`, [id]);
}

export async function deleteMessageById(env, id) {
  await ensureMailDb(env);
  return runDb(env, "DELETE FROM messages WHERE id = ?", [id]);
}

export async function purgeOtpMessages(env) {
  await ensureMailDb(env);
  return runDb(env, "DELETE FROM messages WHERE is_otp = 1");
}

export async function purgeAllMessages(env) {
  await ensureMailDb(env);
  return runDb(env, "DELETE FROM messages");
}

export async function listAliases(env) {
  await ensureMailDb(env);
  return allDb(
    env,
    "SELECT alias_local, source, created_at, last_seen_at, is_pinned FROM aliases ORDER BY last_seen_at DESC LIMIT 100"
  );
}
