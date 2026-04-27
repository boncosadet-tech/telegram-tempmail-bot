// Trigger the GitHub Actions workflow that auto-signs up a ChatGPT account
// using a temp-mail alias. Returns a short status message that the bot
// command handler can echo back to the user.

const DEFAULT_REPO = "moahaassy-design/telegram-tempmail-bot";
const DEFAULT_EVENT_TYPE = "chatgpt-signup";
const CLAIM_EVENT_TYPE = "chatgpt-claim";
const REVOKE_EVENT_TYPE = "chatgpt-revoke";
const AUTOREVOKE_EVENT_TYPE = "chatgpt-autorevoke";

/** Lightweight argv parser for the `/chatgpt` command body. */
export function parseChatgptArgs(rawText) {
  const out = {
    mode: "pretty",
    alias: "",
    password: "",
    full_name: "",
    age: ""
  };
  if (!rawText) return out;

  const unquote = (s) => s.replace(/^['"]|['"]$/g, "");
  const tokens = rawText.match(/(?:[^\s'"]+|"[^"]*"|'[^']*')+/g) || [];
  for (let i = 0; i < tokens.length; i++) {
    const t = unquote(tokens[i]);
    if (t === "--mode" && tokens[i + 1]) {
      const v = unquote(tokens[++i]);
      if (["pretty", "short", "random"].includes(v)) out.mode = v;
    } else if (t === "--alias" && tokens[i + 1]) {
      out.alias = unquote(tokens[++i]);
    } else if (t === "--password" && tokens[i + 1]) {
      out.password = unquote(tokens[++i]);
    } else if (t === "--name" && tokens[i + 1]) {
      out.full_name = unquote(tokens[++i]);
    } else if (t === "--age" && tokens[i + 1]) {
      out.age = unquote(tokens[++i]);
    } else if (!out.alias) {
      out.alias = t;
    }
  }
  return out;
}

/** Validate alias local-part: letters, digits, dots, dashes, underscores only. */
export function isValidAlias(alias) {
  if (!alias) return true; // empty is fine, runner will auto-generate
  return /^[a-z0-9][a-z0-9._-]{0,62}$/i.test(alias);
}

export async function triggerChatgptSignup(env, chatId, args) {
  const pat = env.GITHUB_PAT;
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  if (!pat) {
    return { ok: false, error: "GITHUB_PAT secret is not set on the worker." };
  }

  const url = `https://api.github.com/repos/${repo}/dispatches`;
  const body = {
    event_type: DEFAULT_EVENT_TYPE,
    client_payload: {
      mode: args.mode || "pretty",
      alias: args.alias || "",
      password: args.password || "",
      full_name: args.full_name || "",
      age: args.age || "",
      count: String(args.count || 1),
      chat_id: String(chatId)
    }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "telegram-tempmail-bot"
    },
    body: JSON.stringify(body)
  });

  if (resp.status >= 200 && resp.status < 300) {
    return { ok: true, repo };
  }

  let detail = "";
  try {
    detail = (await resp.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  return { ok: false, error: `GitHub API ${resp.status}: ${detail}` };
}

/**
 * Parse the body of `/creategpt N` into a positive integer between 1 and
 * `max`. Returns `null` for missing / malformed / out-of-range values.
 */
export function parseCreategptCount(rawText, max = CREATEGPT_MAX_BATCH) {
  const trimmed = (rawText || "").trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{1,3})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > max) return null;
  return n;
}

export const CREATEGPT_MAX_BATCH = 10;

/**
 * Trigger a single GitHub Actions workflow run that fans out to ``count``
 * matrix jobs, each producing one ChatGPT account. The workflow's
 * ``prepare`` job translates ``count`` into a ``[1..count]`` matrix array,
 * and ``signup`` runs in parallel. Returns ``{ok, dispatched, failures}``.
 */
export async function triggerChatgptBatch(env, chatId, count) {
  const r = await triggerChatgptSignup(env, chatId, {
    mode: "pretty",
    alias: "",
    password: "",
    full_name: "",
    age: "",
    count
  });
  if (r.ok) {
    return { ok: true, dispatched: count, failures: [] };
  }
  return {
    ok: false,
    dispatched: 0,
    failures: [{ index: 0, error: r.error }]
  };
}

export const CREATEGPT_HELP_TEXT = [
  `🤖 /creategpt N — buat N akun ChatGPT sekaligus (max ${CREATEGPT_MAX_BATCH}).`,
  "",
  "Contoh:",
  "/creategpt 3 — dispatch 3 signup paralel",
  "/creategpt 10 — dispatch 10 signup paralel (limit)",
  "",
  "Tiap akun selesai → bot kirim kredensial + cookies file +",
  "akun.txt (rolling 30 hari) ke chat ini."
].join("\n");

/**
 * Parse `email` from the body of `/claim <email>`. Returns the lowercased
 * email or empty string if the body is empty / malformed.
 *
 * The regex matches the conservative subset of RFC 5322 that the rest of
 * the project uses: ASCII local-part with the usual punctuation set, then
 * a domain with one or more labels separated by dots. This keeps junk like
 * `<>@<>.<>`, embedded whitespace, multiple `@`, or trailing punctuation
 * out of the dispatch payload.
 */
export function parseClaimEmail(rawText) {
  const trimmed = (rawText || "").trim();
  if (!trimmed) return "";
  const m = trimmed.match(
    /^([a-z0-9._+-]{1,64})@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/i
  );
  return m ? `${m[1]}@${m[2]}`.toLowerCase() : "";
}

/**
 * Trigger the `chatgpt-claim` workflow for a single account. The workflow
 * looks up the password from D1 (chatgpt_accounts) so we only pass the
 * email + chat_id to the runner.
 */
export async function triggerChatgptClaim(env, chatId, email) {
  const pat = env.GITHUB_PAT;
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  if (!pat) {
    return { ok: false, error: "GITHUB_PAT secret is not set on the worker." };
  }

  const url = `https://api.github.com/repos/${repo}/dispatches`;
  const body = {
    event_type: CLAIM_EVENT_TYPE,
    client_payload: {
      email,
      chat_id: String(chatId)
    }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "telegram-tempmail-bot"
    },
    body: JSON.stringify(body)
  });

  if (resp.status >= 200 && resp.status < 300) {
    return { ok: true, repo };
  }

  let detail = "";
  try {
    detail = (await resp.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  return { ok: false, error: `GitHub API ${resp.status}: ${detail}` };
}

export const CLAIM_HELP_TEXT = [
  "🎁 /claim <email> — claim free trial GoPay untuk 1 akun.",
  "",
  "Contoh:",
  "/claim adit.brooks@areyoustudent.me",
  "",
  "Setelah trigger, bot akan minta OTP WhatsApp via /otp 123456.",
  "Akun yang gak punya free offer otomatis di-skip."
].join("\n");

/**
 * Parse `email` from the body of `/revoke <email>` or `/autorevoke <email>`.
 * Shares the same strictness as `parseClaimEmail`.
 */
export function parseRevokeEmail(rawText) {
  return parseClaimEmail(rawText);
}

async function dispatchWorkflow(env, eventType, clientPayload) {
  const pat = env.GITHUB_PAT;
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  if (!pat) {
    return { ok: false, error: "GITHUB_PAT secret is not set on the worker." };
  }
  const url = `https://api.github.com/repos/${repo}/dispatches`;
  const body = { event_type: eventType, client_payload: clientPayload };
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "telegram-tempmail-bot"
    },
    body: JSON.stringify(body)
  });
  if (resp.status >= 200 && resp.status < 300) {
    return { ok: true, repo };
  }
  let detail = "";
  try {
    detail = (await resp.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  return { ok: false, error: `GitHub API ${resp.status}: ${detail}` };
}

/**
 * Trigger the ``chatgpt-revoke`` workflow for a single account. The
 * workflow runs ``bot/chatgpt_revoke.py`` which cancels the ChatGPT Plus
 * subscription via the Stripe customer portal (no OTP required — Stripe
 * accepts the same logged-in session used for signup).
 */
export async function triggerChatgptRevoke(env, chatId, email) {
  return dispatchWorkflow(env, REVOKE_EVENT_TYPE, {
    email,
    chat_id: String(chatId)
  });
}

/**
 * Trigger the ``chatgpt-autorevoke`` workflow which chains claim → wait
 * for ``payments/success`` → revoke in a single runner job. Useful for
 * users who want a one-shot "give me Plus and auto-cancel before the
 * next cycle" flow.
 */
export async function triggerChatgptAutorevoke(env, chatId, email) {
  return dispatchWorkflow(env, AUTOREVOKE_EVENT_TYPE, {
    email,
    chat_id: String(chatId)
  });
}

export const REVOKE_HELP_TEXT = [
  "🚫 /revoke <email> — cancel ChatGPT Plus subscription (stop next billing cycle).",
  "",
  "Contoh:",
  "/revoke adit.brooks@areyoustudent.me",
  "",
  "Script login ke chatgpt.com pakai password di D1, buka Stripe",
  "customer portal, klik Cancel plan. Tidak minta OTP / PIN.",
  "Akses Plus tetap aktif sampai akhir periode berjalan."
].join("\n");

export const AUTOREVOKE_HELP_TEXT = [
  "🔁 /autorevoke <email> — one-shot: claim free trial → auto cancel plan.",
  "",
  "Contoh:",
  "/autorevoke adit.brooks@areyoustudent.me",
  "",
  "Workflow menjalankan 2 fase dalam 1 runner:",
  "  1. claim trial (butuh OTP WA otomatis dari wa-otp-listener)",
  "  2. cancel plan di Stripe portal supaya tidak ter-charge bulan depan",
  "",
  "Akses Plus tetap aktif sampai akhir periode trial."
].join("\n");

export const CHATGPT_HELP_TEXT = [
  "🤖 /chatgpt — buat akun ChatGPT otomatis (lewat GitHub Actions runner).",
  "",
  "Contoh:",
  "/chatgpt — alias auto, mode pretty",
  "/chatgpt aisha.putra — alias custom",
  "/chatgpt --mode short — alias firstname42",
  "/chatgpt aisha.putra --password 'MyPass@2026' --age 25",
  "",
  "Setelah perintah, bot ack langsung. ~30 detik kemudian Anda dapat",
  "kredensial lengkap + file cookies (Cookie-Editor JSON)."
].join("\n");
