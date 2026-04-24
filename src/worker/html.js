// HTML helpers: escaping, decoding, URL sanitation, email-body rendering.
// No side effects; all functions are pure.

export function htmlDecode(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Returns the input iff it's an http(s) or mailto URL, otherwise an empty string. */
export function sanitizeUrl(href) {
  const value = String(href ?? "").trim();
  if (!value) return "";
  if (/^(https?:|mailto:)/i.test(value)) return value;
  return "";
}

export function cleanText(value) {
  return htmlDecode(String(value ?? ""))
    .replace(/\r/g, "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Inline-render plain text, converting [[LINK:label|url]] placeholders and bare URLs. */
function renderInlineText(text) {
  const placeholderPattern = /\[\[LINK:([^\]|]+)\|([^\]]+)\]\]/g;
  const pieces = [];
  let lastIndex = 0;
  for (const match of String(text ?? "").matchAll(placeholderPattern)) {
    const index = match.index ?? 0;
    const prefix = text.slice(lastIndex, index);
    pieces.push(
      escapeHtml(prefix).replace(
        /((?:https?:\/\/|mailto:)[^\s<]+)/gi,
        (value) =>
          `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`
      )
    );
    const safeHref = sanitizeUrl(match[2]);
    const label = escapeHtml(match[1]);
    pieces.push(
      safeHref
        ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label
    );
    lastIndex = index + match[0].length;
  }
  const suffix = text.slice(lastIndex);
  pieces.push(
    escapeHtml(suffix).replace(
      /((?:https?:\/\/|mailto:)[^\s<]+)/gi,
      (value) =>
        `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`
    )
  );
  return pieces.join("");
}

/** Convert a sanitized HTML body into plain display text while preserving links as placeholders. */
export function htmlToDisplayText(html) {
  return cleanText(
    String(html ?? "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(
        /<(script|style|head|iframe|object|embed|svg|canvas|form|button|input|textarea|select)[^>]*>[\s\S]*?<\/\1>/gi,
        " "
      )
      .replace(
        /<a\b[^>]*href=(['"]?)([^"' >]+)\1[^>]*>([\s\S]*?)<\/a>/gi,
        (_m, _q, href, inner) => {
          const text = cleanText(inner);
          const safeHref = sanitizeUrl(href);
          return safeHref ? ` [[LINK:${text}|${safeHref}]] ` : text;
        }
      )
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(
        /<\/(p|div|section|article|header|footer|table|tr|blockquote|pre|h1|h2|h3|h4|h5|h6)>/gi,
        "\n\n"
      )
      .replace(/<(li)\b[^>]*>/gi, "\n• ")
  );
}

/** Render cleaned plain text into safe, structured HTML for the dashboard detail pane. */
export function textToDisplayHtml(text) {
  const normalized = String(text ?? "")
    .replace(/\r/g, "")
    .trim();
  if (!normalized) return '<p class="email-empty">(no content)</p>';

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const parts = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const isList = lines.length > 1 && lines.every((line) => line.startsWith("• "));
    if (isList) {
      parts.push(
        `<ul>${lines.map((line) => `<li>${renderInlineText(line.slice(2))}</li>`).join("")}</ul>`
      );
      continue;
    }
    if (lines.length === 1 && lines[0].startsWith("• ")) {
      parts.push(`<ul><li>${renderInlineText(lines[0].slice(2))}</li></ul>`);
      continue;
    }
    parts.push(`<p>${lines.map(renderInlineText).join("<br>")}</p>`);
  }
  return parts.join("");
}
