# telegram-tempmail-bot

Private temp-mail bot on Cloudflare Email Routing + Cloudflare Workers + Telegram.

## What this repo does
- Auto setup Cloudflare Worker, KV, Email Routing catch-all, and Telegram webhook.
- Uses one catch-all worker route (`*@domain`) and virtual aliases from `/new`.
- Owner is claimed once via `/start claim` in private chat.

## Required inputs
- `domain`
- `cf-email`
- `cf-global-key`
- `telegram-bot-token`

Cloudflare Global API Key must be paired with Cloudflare account email.

## One-command setup
```bash
npm run setup -- \
  --domain yourdomain.com \
  --cf-email your-cloudflare-email@example.com \
  --cf-global-key <CLOUDFLARE_GLOBAL_API_KEY> \
  --telegram-bot-token <TELEGRAM_BOT_TOKEN>
```

The command prints a claim link:
`https://t.me/<bot_username>?start=claim`

Open it, then the owner is claimed automatically.

## Verify setup
```bash
npm run verify -- \
  --domain yourdomain.com \
  --cf-email your-cloudflare-email@example.com \
  --cf-global-key <CLOUDFLARE_GLOBAL_API_KEY> \
  --telegram-bot-token <TELEGRAM_BOT_TOKEN>
```

You can omit `--telegram-bot-token` in verify. Telegram webhook check will be marked as pending.

## Bot commands
- `/start claim` claim owner on first use
- `/start` show status
- `/new` generate random alias
- `/status` show runtime status
- `/whoami` show telegram ids
- `/help` show command list

## Notes
- Setup only manages catch-all email rule. Literal email rules are preserved.
- If existing catch-all points to another worker, setup fails unless `--force`.
- Cloudflare Email Routing max message size is 25 MiB.
- Do not commit API keys or bot tokens.
