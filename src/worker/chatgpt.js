// Trigger the GitHub Actions workflow that auto-signs up a ChatGPT account
// using a temp-mail alias. Returns a short status message that the bot
// command handler can echo back to the user.

const DEFAULT_REPO = "moahaassy-design/telegram-tempmail-bot";
const DEFAULT_EVENT_TYPE = "chatgpt-signup";

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
