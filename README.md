# telegram-tempmail-bot

Cloudflare Worker untuk temp mail pribadi yang terintegrasi Telegram bot.

## Fitur
- Handler `email` untuk menerima email dari Cloudflare Email Routing.
- Handler `fetch` untuk menerima Telegram webhook.
- Command bot: `/start`, `/help`, `/new`, `/whoami`.
- Catch-all domain bisa diarahkan ke Worker agar alamat random `*@domain` diterima.

## Struktur
- `src/main.js`: Worker source code.
- `wrangler.toml`: konfigurasi Worker dan vars non-rahasia.

## Secrets yang wajib diset
- `BOT_TOKEN`
- `WEBHOOK_SECRET`

Set via Wrangler:

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
```

## Deploy

```bash
npx wrangler deploy
```

## Set Telegram Webhook
Ganti `<workers-subdomain>` dan `<secret>`:

```bash
curl -X POST "https://api.telegram.org/bot<bot_token>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://telegram-tempmail.<workers-subdomain>.workers.dev/tg/<secret>","secret_token":"<secret>","allowed_updates":["message"]}'
```

## Catatan
Jangan commit token, API key, atau webhook secret ke repo.
