# services/wa-otp-listener

Baileys-based WhatsApp listener that forwards GoPay / Midtrans OTP
messages to the telegram-tempmail Worker relay endpoint.

See [`docs/wa-otp-listener.md`](../../docs/wa-otp-listener.md) for the
architecture diagram and full install / troubleshooting guide.

## Quick start

```bash
npm install
cp .env.example ~/.wa-otp-listener/env
# edit the env file, then:
env $(grep -v '^#' ~/.wa-otp-listener/env | xargs) node src/index.js
```

Scan the QR (or run `node src/pair.js <phone>` for pair-code mode).

## Run tests

```bash
npm test
```
