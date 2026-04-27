# WhatsApp OTP Listener

A minimal Node.js service that listens to incoming WhatsApp messages on the
owner's phone number (via [Baileys](https://github.com/WhiskeySockets/Baileys))
and forwards GoPay / Midtrans OTP codes to the telegram-tempmail Worker so
the claim-trial automation can continue without human intervention.

## Architecture

```
┌────────────────┐    scan QR / pair-code (1x)   ┌──────────────────────────┐
│  HP WhatsApp   │ ◄───────────────────────────► │  VM                       │
│  +NOMOR_GOPAY  │                               │  services/wa-otp-listener │   POST /relay/gopay-otp/ingest
│                │                               │  (Node.js + Baileys,      │   Authorization: Bearer
│                │                               │   systemd service)        │ ────────────────────────────┐
└────────────────┘                               └──────────────────────────┘                              │
        ▲                                                                                                   │
        │ OTP via WA                                                                                        │
        │                                                                                                   ▼
[GoPay / Midtrans] ─────────────────────────────────────────► [Cloudflare Worker] ◄───────────────────────┤
                                                               GET  /relay/gopay-otp?token=...   (script polling)
                                                               POST /relay/gopay-otp/ingest       (WA listener)
                                                               POST /tg/<secret>                   (Telegram bot)
```

Manual `/otp 123456` in Telegram still works as a fallback — it writes to
the same KV key (`gopay_otp:pending`) and is consumed by the polling
script identically.

## Why Baileys (and not puppeteer / whatsapp-web.js)

- **Lightweight**: pure Node.js, no Chromium. Fits on a tiny VM.
- **Persistent**: Baileys serialises its auth state to disk; after one
  pairing, reboots do not require re-scanning.
- **Read-only**: the listener **never sends** a WA message. This keeps
  the linked-device footprint minimal and reduces ban risk.

## Install

```bash
# from the repo root
cd services/wa-otp-listener
npm install
cp .env.example ~/.wa-otp-listener/env    # move secrets out of the repo
chmod 600 ~/.wa-otp-listener/env
```

Edit `~/.wa-otp-listener/env`:

| Variable              | Required | Purpose                                                                 |
| --------------------- | -------- | ----------------------------------------------------------------------- |
| `WA_AUTH_DIR`         | ✅       | Persistent directory for Baileys creds. E.g. `/home/ubuntu/.wa-otp-listener/auth` |
| `RELAY_URL`           | ✅       | Worker endpoint: `https://<your-worker>.workers.dev/relay/gopay-otp/ingest` |
| `RELAY_TOKEN`         | ✅       | Must equal the Worker's `GOPAY_OTP_TOKEN`                                |
| `WA_EXPECTED_SENDERS` | ⬜       | Comma-separated allow-list of WA JIDs. Leave empty to accept any.       |
| `WA_OTP_REGEX`        | ⬜       | Custom regex with one capture group. Default covers common phrasings.   |
| `WA_MIN_BODY_LENGTH`  | ⬜       | Ignore messages shorter than this (default: 6).                         |
| `WA_PAIR_MODE`        | ⬜       | `qr` (default) or `code` (8-digit pair-code flow).                      |
| `WA_PAIR_PHONE`       | ⬜       | Required when `WA_PAIR_MODE=code`. Digits only, e.g. `628123456789`.    |
| `WA_QR_PNG_PATH`      | ⬜       | Write the current pairing QR as a PNG to this path (headless-friendly). A sibling `.ts` flag file updates per QR for cache-busting. |
| `LOG_LEVEL`           | ⬜       | `debug` / `info` / `warn` / `error`. Default `info`.                    |

## Pair the phone

### Option A: QR code (easier, requires camera on phone)

```bash
cd services/wa-otp-listener
env $(grep -v '^#' ~/.wa-otp-listener/env | xargs) node src/index.js
```

Scan the QR code printed to the terminal from
**WhatsApp → Settings → Linked Devices → Link a device**.

### Option B: Pair code (no QR, just an 8-digit code)

```bash
cd services/wa-otp-listener
env $(grep -v '^#' ~/.wa-otp-listener/env | xargs) node src/pair.js 628123456789
```

Enter the 8-digit code the script prints into
**WhatsApp → Settings → Linked Devices → Link with phone number**.

Either way, Baileys will serialise its auth state into `WA_AUTH_DIR`. After
pairing, you never need to repeat this unless you log out from the phone.

## Run as a systemd service

```bash
sudo cp services/wa-otp-listener/systemd/wa-otp-listener.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wa-otp-listener
journalctl -u wa-otp-listener -f
```

Healthy logs look like:

```
{"level":"info","msg":"whatsapp connection open — listening for OTP"}
{"level":"info","jid":"GoPay@s.whatsapp.net","masked":"****42","msg":"OTP extracted — forwarding"}
{"level":"info","status":202,"masked":"****42","msg":"relay ingest ok"}
```

## Enable audit-trail notifications (optional)

Set `GOPAY_OTP_INGEST_NOTIFY=1` on the Worker (via `wrangler secret put` or
the setup CLI). Each ingested OTP will also be posted to the owner's
Telegram chat with the code masked — useful for auditing.

## Security notes

- `WA_AUTH_DIR` contains WhatsApp session keys that let anyone post as
  your account. Store it under `~/.wa-otp-listener/auth` with `chmod 700`.
- `RELAY_TOKEN` should be a long (>= 32 char) random string and must
  match the Worker's `GOPAY_OTP_TOKEN`. Rotate both together if leaked.
- The service opens **no inbound ports**. All network traffic is
  outbound HTTPS to `*.workers.dev`.

## Troubleshooting

| Symptom                                              | Fix                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `logged out — delete WA_AUTH_DIR and re-pair`        | Phone revoked the linked device. `rm -rf $WA_AUTH_DIR/*` and repeat pairing.               |
| `relay ingest non-2xx status=401`                    | `RELAY_TOKEN` ≠ `GOPAY_OTP_TOKEN`. Compare and restart.                                     |
| Messages arrive but no OTP is forwarded              | Tune `WA_OTP_REGEX` or set `LOG_LEVEL=debug` to see raw bodies.                             |
| Script claim times out waiting on OTP                | `journalctl -u wa-otp-listener` should show the ingest. If not, check `WA_EXPECTED_SENDERS`. |
