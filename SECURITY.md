# Security Policy

## Supported versions

Only the latest `main` branch and the most recent published release receive
security updates.

## Reporting a vulnerability

Please report security issues privately via email to the maintainer listed in
[`package.json`](./package.json). Please do **not** file a public issue for
undisclosed vulnerabilities.

We aim to acknowledge reports within 72 hours and publish a fix within 14 days
for high-severity issues.

## Threat model

The Worker is designed to be used by a **single owner** identified by a
Telegram user id. The following assumptions hold:

- The owner is trusted; the dashboard is private and requires a short-lived
  login link issued via Telegram.
- The `BOT_TOKEN` and `WEBHOOK_SECRET` secrets are stored as Worker secrets —
  never committed to the repo.
- Inbound emails are untrusted and treated as hostile input.

## Hardening in place

| Concern                             | Mitigation                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Dashboard XSS                       | User-controlled fields rendered via `textContent` / `setAttribute`; server pre-sanitizes HTML.    |
| Telegram webhook spoofing           | Secret-token header compared in constant time (`safeEqual`).                                      |
| HTML body rendering                 | Allow-list HTML-to-text pipeline; `sanitizeUrl` restricts links to `http(s):` and `mailto:`.      |
| Login-token replay                  | Tokens are single-use (deleted from KV on consumption) and expire after 10 minutes.               |
| Session hijacking                   | Sessions are HttpOnly + Secure + SameSite=Lax cookies; rotated on logout.                         |
| Clickjacking / MIME sniffing        | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` response headers.   |
| D1 / KV denial-of-service           | Expired messages are purged on every read; inbox retention is capped at 24h (30min for OTPs).     |
| Over-broad Worker bindings          | Only three bindings (`DOMAIN`, `STATE_KV`, `MAIL_DB`) plus two secrets (`BOT_TOKEN`, `WEBHOOK_SECRET`). |

## Out of scope

- Multi-tenant deployments (by design).
- Preventing Cloudflare-side abuse of the owner's own account.
- Compromises of the owner's Telegram account or device.
