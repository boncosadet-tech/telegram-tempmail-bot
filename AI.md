# AI.md

## Purpose

This repository provides an interactive npm app and CLI package for operating a private temp-mail workflow on top of:

- Cloudflare Email Routing
- Cloudflare Workers
- Cloudflare KV
- Telegram Bot API

The package is intended for a single-owner deployment per domain.

## Current Product Model

- One Cloudflare zone per deployment
- One Worker catch-all route for `*@domain`
- One Telegram bot owner
- One owner claim flow via `/start claim`
- Virtual aliases generated from `/new`

This is not a mailbox host. It is a forwarding and notification system.

## Important Operational Rules

- Do not add per-alias Cloudflare routing rules for each `/new` address.
  The design depends on a single catch-all Worker route.
- Do not switch catch-all routing from `worker` to `forward` unless you also add destination verification logic.
- Keep the owner state in KV under the `owner` key.
- Treat `reset-owner` as an explicit admin operation only.
- Re-running setup rotates the webhook secret and updates the Telegram webhook URL.

## Main Entry Points

- `src/cli/app.js`
  Interactive terminal app
- `src/cli/setup.js`
  Bootstrap Cloudflare and Telegram integration
- `src/cli/verify.js`
  Validate deployment state
- `src/cli/admin.js`
  Administrative actions such as owner reset and webhook secret rotation
- `src/main.js`
  Worker runtime for Telegram webhook handling and inbound email processing

## Shared Logic

- `src/lib/service.js`
  Main orchestration logic shared by CLI commands
- `src/lib/cloudflare.js`
  Cloudflare API client
- `src/lib/telegram.js`
  Telegram API client
- `src/lib/common.js`
  Argument parsing, prompt helpers, local state helpers, naming helpers

Keep new orchestration logic in `src/lib/service.js` instead of growing the CLI entrypoints.

## Local Commands

```bash
npm start
npm run setup
npm run verify
npm run test
npm run check
```

## Published Package Commands

```bash
npx telegram-tempmail-bot
npx --package telegram-tempmail-bot telegram-tempmail-setup
npx --package telegram-tempmail-bot telegram-tempmail-verify
npx --package telegram-tempmail-bot telegram-tempmail-admin
```

## Release Notes

- npm package is published from GitHub Actions
- CI runs on pushes and pull requests to `master`
- npm publish workflow runs on:
  - tag push `v*`
  - release published
  - manual workflow dispatch

## Known Limitations

- MIME parsing is intentionally lightweight
- Attachment processing is not implemented
- Cloudflare Email Routing size limits still apply
- npm CLI emits a warning about `bin` field cleanup during publish, even though installed commands work

## Recommended Next Work

- Improve MIME parsing quality for complex multipart messages
- Add more end-to-end mocked tests for failure paths
- Add structured logging and better operator diagnostics
- Consider optional scoped API token mode in addition to Global API Key mode
