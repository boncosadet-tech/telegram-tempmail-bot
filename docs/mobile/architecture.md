# Mobile Architecture — Private TempMail

This mobile app is the Android/APK frontend for the existing `telegram-tempmail-bot` npm package.

Current status: **real provisioning MVP**. The app can run the Cloudflare + Telegram setup flow directly from the Android device without a local Termux process after setup.

## Layers

- **Flutter UI**: welcome screen, credential form, setup progress timeline, management dashboard, and add-domain screen.
- **Dart service clients**: Cloudflare API and Telegram Bot API calls through `dart:io` `HttpClient`.
- **Provisioning orchestration**: `ProvisioningService` emits progress updates for Telegram validation, Cloudflare zone lookup, KV, D1, Worker upload, secrets, Email Routing DNS, catch-all routing, and Telegram webhook setup.
- **Kotlin native helper**: method channel for opening URLs and copying text.
- **Worker runtime asset**: `apps/mobile/assets/worker/main.js` is bundled into the APK and uploaded to Cloudflare Workers during setup.
- **Existing npm package**: remains the source-of-truth for CLI operations, Worker runtime development, npm distribution, and mocked service tests.

## Runtime model

After setup, runtime traffic does not depend on the phone, Termux, laptop, or VPS:

1. Cloudflare Email Routing receives mail for configured domains.
2. Cloudflare routes catch-all email to the Worker.
3. Worker stores inbox data in D1 and owner/app state in KV.
4. Worker handles Telegram webhook updates.
5. Telegram sends owner notifications and command interactions.
6. The private web dashboard is served by the Worker.

The mobile app is an operator/admin client for setup and management, not a required runtime server.

## Setup flow

The mobile provisioning flow currently performs:

1. Validate Telegram bot token with `getMe`.
2. Resolve the active Cloudflare zone and account.
3. Find or create KV namespace.
4. Find or create D1 database.
5. Upload Worker module with KV/D1/plain-text bindings.
6. Apply D1 inbox schema.
7. Store Worker secrets (`BOT_TOKEN`, `WEBHOOK_SECRET`).
8. Enable workers.dev endpoint.
9. Enable Cloudflare Email Routing DNS.
10. Set catch-all Email Routing rule to the Worker.
11. Configure Telegram webhook.
12. Produce dashboard URL and owner claim link.

## Security model

- No credential is committed to the repository.
- Release signing uses GitHub Actions secrets.
- User Cloudflare and Telegram secrets are sent directly from the device to Cloudflare/Telegram APIs.
- The “save credentials” UI toggle is intentionally non-persistent until Android secure storage is implemented.
- Global API Key has broad Cloudflare account power; users should rotate any key that was shared or exposed.

## Current limitations

- Native mobile inbox is not implemented yet; the app opens the Worker-hosted private dashboard for inbox management.
- Persistent credential storage is not implemented yet.
- Verify/admin parity with every npm CLI action is still incomplete.
- The mobile APK uses a Dart port of the provisioning flow; npm CLI remains the canonical implementation for advanced operator actions.

## Next development targets

1. Android secure storage for optional credential persistence.
2. Native inbox list/detail UI backed by Worker dashboard APIs.
3. Mobile verify flow equivalent to `telegram-tempmail-verify`.
4. Safer conflict-resolution UI for catch-all and existing MX records.
5. Screenshots and visual regression references for release QA.
