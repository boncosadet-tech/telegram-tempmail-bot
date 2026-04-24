// Email parsing helpers: MIME decoding, body extraction, OTP heuristics.
import { cleanText, htmlToDisplayText, textToDisplayHtml } from "./html.js";

/** Decode `=?charset?B?...?=` / `=?charset?Q?...?=` MIME word blocks. */
export function decodeMimeWords(input) {
  return String(input ?? "").replace(
    /=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g,
    (_m, charset, enc, text) => {
      try {
        if (enc.toUpperCase() === "B") {
          const bin = atob(text);
          const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
          return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
        }
        const qp = text
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, (_match, h) => String.fromCharCode(parseInt(h, 16)));
        const bytes = Uint8Array.from(qp, (c) => c.charCodeAt(0));
        return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
      } catch {
        return text;
      }
    }
  );
}

/**
 * Read the first `limit` bytes from a readable byte stream and decode as UTF-8.
 * The stream is always released even on error paths.
 */
export async function readRaw(stream, limit = 120_000) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total <= limit) {
        chunks.push(value);
      } else {
        const remain = Math.max(0, limit - (total - value.byteLength));
        if (remain > 0) chunks.push(value.slice(0, remain));
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/**
 * Heuristic OTP/verification-code extractor. Returns `"-"` when nothing plausible
 * is found. Designed for concise codes (4–10 chars, digits or uppercase alphanumerics).
 */
export function extractLikelyCode(text) {
  const haystack = String(text ?? "");
  const stopwords = new Set(["code", "kode", "token", "otp", "pin"]);
  const patterns = [
    /(?:kode|code|otp|verification|verifikasi|pin|token)[^0-9A-Z]{0,30}([0-9]{4,8})/gi,
    /(?:kode|code|otp|verification|verifikasi|pin|token)[^0-9A-Z]{0,30}([A-Z0-9]{6,10})/gi,
    /\b([0-9]{4,8})\b/g,
    /\b([A-Z0-9]{6,10})\b/g
  ];
  for (const pattern of patterns) {
    for (const match of haystack.matchAll(pattern)) {
      const candidate = String(match[1] ?? "").trim();
      if (!candidate) continue;
      if (stopwords.has(candidate.toLowerCase())) continue;
      // Reject pure-alpha words for the digit-first patterns.
      if (/^[A-Z]+$/i.test(candidate) && !/[0-9]/.test(candidate)) continue;
      return candidate;
    }
  }
  return "-";
}

export function extractHtmlBody(raw) {
  const match = raw.match(
    /Content-Type:\s*text\/html[\s\S]*?\n\n([\s\S]*?)(?=\n--|\nContent-Type:|$)/i
  );
  return match?.[1] ?? "";
}

export function getBestPreview(raw) {
  const textPlain = raw.match(
    /Content-Type:\s*text\/plain[\s\S]*?\n\n([\s\S]*?)(?=\n--|\nContent-Type:|$)/i
  );
  const textHtml = raw.match(
    /Content-Type:\s*text\/html[\s\S]*?\n\n([\s\S]*?)(?=\n--|\nContent-Type:|$)/i
  );
  const body =
    textPlain?.[1] ||
    textHtml?.[1] ||
    raw
      .split(/\r?\n\r?\n/)
      .slice(1)
      .join("\n\n") ||
    raw;
  return cleanText(body).slice(0, 2200);
}

export function renderEmailHtml(raw, previewText) {
  const htmlBody = extractHtmlBody(raw);
  const text = htmlBody ? htmlToDisplayText(htmlBody) : String(previewText ?? "");
  return textToDisplayHtml(text);
}

export function getRawKind(raw) {
  if (/Content-Type:\s*text\/html/i.test(raw)) return "text/html";
  if (/Content-Type:\s*text\/plain/i.test(raw)) return "text/plain";
  if (/multipart\//i.test(raw)) return "multipart";
  return "unknown";
}
