# telegram-tempmail-bot

Private temp-mail bot on Cloudflare Email Routing + Cloudflare Workers + Telegram.

## Docs
- [AI.md](./AI.md)
- [Project Context](./docs/project-context.md)
- [Development Roadmap](./docs/development-roadmap.md)

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

## Interactive app
```bash
npm start
```

This opens a simple terminal menu for:
- setup
- verify
- show saved local state

`npm run setup` and `npm run verify` are also interactive if required inputs are missing.

## Run from npm package
After publish, the app can be started with:

```bash
npx telegram-tempmail-bot
```

Direct subcommands are also available:

```bash
npx telegram-tempmail-admin
npx telegram-tempmail-setup
npx telegram-tempmail-verify
```

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
- `/new` generate readable alias like `calm-river-4821`
- `/new hello` create custom alias
- `/new hello.team@domain.com` create custom alias from local-part input
- `/web` generate owner-only login link for private dashboard
- `/status` show runtime status
- `/whoami` show telegram ids
- `/help` show command list

## Private web dashboard
- Runtime tetap Cloudflare-only: Worker + Email Routing + KV + D1
- Login dashboard via bot command `/web`
- Dashboard owner-only supports:
  - inbox list
  - alias filter
  - create alias
  - OTP highlight
  - delete one message
  - delete all OTP history
  - delete all history
- OTP history auto-expire lebih cepat daripada email biasa

## Admin commands
- `telegram-tempmail-admin --action reset-owner`
- `telegram-tempmail-admin --action rotate-secret`

The interactive app also exposes both actions from the main menu.

## Runtime hosting model
- After setup, the live system runs on Cloudflare + Telegram only.
- Termux/local machine can be offline; inbound email, webhook handling, KV state, and Telegram delivery continue to run.
- Local environment is only needed for setup, verify, admin actions, upgrades, and publishing.

## Notes
- Setup only manages catch-all email rule. Literal email rules are preserved.
- If existing catch-all points to another worker, setup fails unless `--force`.
- Cloudflare Email Routing max message size is 25 MiB.
- Re-running setup rotates the webhook secret and updates the webhook URL.
- Do not commit API keys or bot tokens.

## GitHub publish workflow
This repo includes [publish-npm.yml](./.github/workflows/publish-npm.yml) to publish the package from GitHub Actions.

Requirements:
- add repo secret `NPM_TOKEN`
- use an npm token that can publish public packages

Triggers:
- push tag like `v1.0.3`
- GitHub release published
- manual `workflow_dispatch`

## GitHub CI workflow
This repo also includes [ci.yml](./.github/workflows/ci.yml) for development checks on:
- push to `master`
- pull requests targeting `master`
