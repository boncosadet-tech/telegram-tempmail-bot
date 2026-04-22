# Mobile Architecture — Private TempMail

This mobile app is the Android/APK frontend for the existing `telegram-tempmail-bot` npm package.

Current status: **production-alpha provisioning, control, and polished inbox MVP**. The app can deploy/redeploy from the Android device, connect to an existing Worker without redeploy, persist setup state with Android Keystore-backed secure storage, and read inbox data natively from Cloudflare D1.

## Layers

- **Flutter UI**: welcome screen, credential form, setup progress timeline, management dashboard, add-domain screen, and polished native inbox with search, action menu, empty/error/loading states, and detail bottom sheet.
- **Dart service clients**: Cloudflare API and Telegram Bot API calls through `dart:io` `HttpClient`.
- **Provisioning orchestration**: `ProvisioningService` emits progress updates for Telegram validation, Cloudflare zone lookup, KV, D1, Worker upload, secrets, Email Routing DNS, catch-all routing, and Telegram webhook setup.
- **Kotlin native helper**: method channel for opening URLs, copying text, and encrypted setup/credential storage with Android Keystore.
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

## Control existing flow

The app can also attach to an already deployed Worker without changing Cloudflare resources:

1. Validate Cloudflare email, Global API Key, domain, and Worker script name.
2. Resolve the active zone/account.
3. Inspect Worker settings and recover `STATE_KV` / `MAIL_DB` bindings.
4. Read configured domains from KV when available.
5. Persist the recovered setup state and credentials locally.
6. Enable native inbox/control actions without uploading Worker code or rotating Telegram webhook secrets.

## Security model

- No credential is committed to the repository.
- Release signing uses GitHub Actions secrets.
- User Cloudflare and Telegram secrets are sent directly from the device to Cloudflare/Telegram APIs.
- The “save credentials” UI toggle persists credentials through Android Keystore-backed encryption on the device.
- Global API Key has broad Cloudflare account power; users should rotate any key that was shared or exposed.
- Uninstalling or clearing app data removes the locally stored encrypted setup state and credentials.

## Current limitations

- Native inbox is an alpha D1 reader and supports search, list/detail bottom sheet, delete confirmation, purge OTP confirmation, loading/empty/error states; the Worker-hosted dashboard remains the fallback.
- Verify/admin parity with every npm CLI action is still incomplete.
- The mobile APK uses a Dart port of the provisioning flow; npm CLI remains the canonical implementation for advanced operator actions.
- Cloudflare quota/rate limits and any previously exposed credentials remain operator responsibilities.

## Next development targets

1. Mobile verify flow equivalent to `telegram-tempmail-verify`.
2. Richer native HTML rendering for email detail.
3. Safer scoped Cloudflare API token mode.
4. Safer conflict-resolution UI for catch-all and existing MX records.
5. Screenshots and visual regression references for release QA.
