// POST OTP payload to the Worker relay endpoint, with bounded retries.
//
// Retries on 5xx and network errors (exponential back-off capped at 3
// attempts total). Returns {ok, status, body} on the last outcome.

import { maskOtp } from "./parser.js";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {object} params
 * @param {string} params.relayUrl
 * @param {string} params.relayToken
 * @param {string} params.code
 * @param {string} [params.sourceJid]
 * @param {import('pino').Logger} params.logger
 * @param {typeof fetch} [params.fetchFn]  // injectable for tests
 * @returns {Promise<{ok: boolean, status: number, body: string}>}
 */
export async function postOtpToRelay({ relayUrl, relayToken, code, sourceJid, logger, fetchFn }) {
  const fn = fetchFn || fetch;
  const payload = {
    code: String(code),
    ts: Date.now()
  };
  if (sourceJid) payload.source_jid = sourceJid;

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const resp = await fn(relayUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${relayToken}`,
          "user-agent": "wa-otp-listener/0.1"
        },
        body: JSON.stringify(payload)
      });
      const body = await safeReadBody(resp);
      if (resp.status >= 200 && resp.status < 300) {
        logger.info(
          { attempt, status: resp.status, masked: maskOtp(code) },
          "relay ingest ok"
        );
        return { ok: true, status: resp.status, body };
      }
      // 4xx (not 408/429) is non-retryable — config / token / code issue.
      const retryable = resp.status === 408 || resp.status === 429 || resp.status >= 500;
      logger.warn(
        { attempt, status: resp.status, retryable, body: body.slice(0, 200) },
        "relay ingest non-2xx"
      );
      if (!retryable) return { ok: false, status: resp.status, body };
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastErr = err;
      logger.warn({ attempt, err: err?.message }, "relay ingest network error");
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  return { ok: false, status: 0, body: lastErr?.message || "unknown error" };
}

async function safeReadBody(resp) {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}
