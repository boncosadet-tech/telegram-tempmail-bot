# Mobile Architecture — Private TempMail

This mobile app is the Android/APK frontend for the existing `telegram-tempmail-bot` npm package.

Current status: partial scaffold.

## Layers

- Flutter UI: onboarding, credential form, progress timeline, dashboard, add-domain screen.
- Dart service clients: partial Cloudflare and Telegram API clients.
- Kotlin native helper: method channel for opening URLs and copying text.
- Existing npm package remains the source-of-truth for production Cloudflare Worker runtime.

## Security model

- No credential is committed.
- Release signing uses GitHub Actions secrets.
- User Cloudflare and Telegram secrets are intended to stay on-device.
- Next phase must add Android secure storage before enabling persistent credential save.

## Current limitation

The setup button currently runs a dry setup animation only. The next phase ports the full orchestration from `src/lib/service.js` into Dart.
