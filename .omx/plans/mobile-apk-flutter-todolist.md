# Plan / Todolist — Mobile APK TempMail Cloudflare

Tanggal: 2026-04-20 18:44 WIB  
Status: draft siap dilanjut jam 22:00  
Target: versi mobile open-source dari `telegram-tempmail-bot` npm app.

## 1. Requirements Summary

Buat aplikasi Android/APK dengan UI smooth dan modern untuk mengelola tempmail Cloudflare seperti npm app sekarang.

Fitur target:

- Setup dari HP tanpa Termux:
  - input Cloudflare account email
  - input Cloudflare Global API Key
  - input Telegram Bot Token
  - input domain utama yang sudah Active/onboard di Cloudflare
  - input worker script name optional
- Jalankan flow provisioning yang sekarang ada di npm:
  - Cloudflare zone lookup
  - Worker upload/update
  - KV namespace
  - D1 database
  - Email Routing DNS
  - catch-all route ke Worker
  - Telegram webhook
  - owner claim link
- Tambah domain dari app:
  - domain harus sudah Active di Cloudflare
  - set catch-all ke Worker yang sama
  - update KV domain list
- Verify setup dari app:
  - zone
  - worker settings
  - KV/D1 binding
  - D1 query
  - email routing
  - catch-all
  - Telegram webhook
  - owner claim
- Dashboard ringan di app:
  - buka Worker dashboard web via WebView atau browser
  - tampilkan health status
  - quick actions: `/menu`, `/web`, claim link
- UX:
  - Flutter frontend
  - Android Kotlin native layer bila perlu untuk secure storage, background task, clipboard, deep link
  - pretty UI, smooth animation, dark/light, Bahasa Indonesia-first
- Open source:
  - tidak hardcode API key/token
  - tidak kirim credentials ke server pihak ketiga
  - semua credential hanya dipakai dari device user ke Cloudflare/Telegram API

## 2. Current Codebase Facts

Core yang bisa dipakai ulang:

- `src/lib/cloudflare.js`
  - Cloudflare API client: zones, Worker upload, KV, D1, Email Routing, catch-all.
- `src/lib/service.js`
  - orchestration setup/verify/admin:
    - `performSetup`
    - `performVerify`
    - `addDomainToApp`
    - `resetOwner`
    - `rotateWebhookSecret`
- `src/lib/telegram.js`
  - Telegram Bot API client dan webhook setup.
- `src/main.js`
  - Cloudflare Worker runtime untuk bot, web dashboard, email handler.
- `src/cli/app.js`, `src/cli/setup.js`, `src/cli/admin.js`, `src/cli/verify.js`
  - CLI wrapper yang sekarang dipakai npm.

## 3. Architecture Decision Draft

### Recommended path

**Flutter app + Kotlin native helpers + shared npm core adapted for mobile build tooling.**

Praktisnya dibagi dua layer:

1. **Provisioning Core**
   - ekstrak logic dari `src/lib/cloudflare.js`, `src/lib/service.js`, `src/lib/telegram.js`
   - jadikan API yang UI-friendly: progress events, typed result, safe error messages
   - tetap menjadi npm package canonical

2. **Mobile App**
   - Flutter untuk UI
   - Kotlin untuk:
     - Android Keystore / EncryptedSharedPreferences
     - clipboard
     - open Telegram/browser intents
     - optional background checks
   - Flutter memanggil provisioning core melalui salah satu opsi:
     - Option A: port client Cloudflare/Telegram ke Dart
     - Option B: embed JS runtime / Node bridge
     - Option C: app memanggil small local JS runner packaged with APK

### Preferred MVP implementation

**Port API orchestration ke Dart untuk mobile MVP, sambil menjaga npm sebagai reference implementation.**

Alasan:

- APK lebih ringan daripada embed Node.
- Tidak perlu server lokal.
- Cloudflare/Telegram API bisa dipanggil langsung dari Dart `http`.
- Lebih mudah publish open-source dan build di GitHub Actions.
- Npm package tetap dipakai sebagai source-of-truth behavior melalui test fixtures dan docs.

### Rejected for MVP

- Embed full Node.js runtime di APK:
  - lebih berat
  - debugging lebih sulit
  - packaging Android ribet
- Backend server hosted:
  - bertentangan dengan konsep free/minimal/self-contained
  - menyimpan/menyentuh credential user berisiko

## 4. Proposed Repo Structure

Tambahkan folder baru:

```text
apps/mobile/
  pubspec.yaml
  android/
  lib/
    main.dart
    app.dart
    core/
      models/
      validators/
      secure_config.dart
    features/
      onboarding/
      setup/
      verify/
      domains/
      dashboard/
      settings/
    services/
      cloudflare_api.dart
      telegram_api.dart
      provisioning_service.dart
  test/
    validators_test.dart
    provisioning_mapper_test.dart

docs/mobile/
  architecture.md
  android-build.md
  screenshots.md
```

Tetap pertahankan root npm app sebagai package utama.

## 5. Mobile UX Flow

### Screen 1 — Welcome

- Judul: `Private TempMail on Cloudflare`
- Ringkas:
  - Cloudflare Free compatible
  - no server needed
  - credentials stay on device
- CTA:
  - `Mulai Setup`
  - `Saya sudah punya setup`

### Screen 2 — Requirements Checklist

Checklist:

- Domain sudah Active di Cloudflare
- Cloudflare Global API Key siap
- Telegram Bot Token siap
- Node/Termux tidak diperlukan di HP

CTA:

- `Lanjut`
- Link docs: cara ambil Global API Key, cara BotFather

### Screen 3 — Credentials Form

Fields:

- Cloudflare email
- Global API Key
- Telegram Bot Token
- Domain utama
- Worker script name optional default `telegram-tempmail`

Actions:

- `Test Credential`
- `Setup Sekarang`

Security:

- hide token by default
- paste button
- clear button
- store toggle:
  - `Simpan aman di device`
  - default off for Global API Key if user paranoid

### Screen 4 — Setup Progress

Timeline cards:

- Validate Telegram bot
- Resolve Cloudflare zone
- Ensure KV
- Ensure D1
- Upload Worker
- Apply D1 schema
- Set Worker secrets
- Enable workers.dev
- Enable Email Routing DNS
- Set catch-all
- Configure Telegram webhook

Each step:

- pending / loading / ok / failed
- show short error + retry button

### Screen 5 — Claim Owner

Show:

- Bot username
- Claim link button
- `Open Telegram`
- `Saya sudah claim, verify`

### Screen 6 — Dashboard Home

Cards:

- Worker health
- Primary domain
- Domains configured
- Owner status
- Dashboard URL
- Telegram bot username

Actions:

- Verify setup
- Open Telegram menu
- Open web dashboard
- Add domain
- Rotate secret
- Reset owner

### Screen 7 — Add Domain

Fields:

- domain to add
- force toggle with warning

Steps:

- check Active zone
- enable email routing
- set catch-all
- save domains KV
- verify domain

### Screen 8 — Settings

- export local setup state JSON
- import setup state JSON
- clear credentials
- rotate webhook secret
- show app/version/licenses

## 6. API Mapping

### Dart Cloudflare client equivalent

Must implement equivalents of:

- `getZoneByDomain(domain)`
- `getAccountWorkersSubdomain(accountId)`
- `findOrCreateKVNamespace(accountId, title)`
- `findOrCreateD1Database(accountId, name)`
- `queryD1(accountId, databaseId, sql, params)`
- `uploadWorkerScript(...)`
- `setWorkerSecret(...)`
- `enableWorkerSubdomain(...)`
- `getWorkerSettings(...)`
- `enableEmailRoutingDns(zoneId)`
- `getCatchAllRule(zoneId)`
- `setCatchAllWorker(zoneId, scriptName)`
- `getKVValue(...)`
- `putKVValue(...)`
- `deleteKVValue(...)`

### Dart Telegram client equivalent

Must implement:

- `getMe()`
- `setWebhook(url, secretToken)` with:
  - `allowed_updates: ["message", "edited_message", "callback_query"]`
- `getWebhookInfo()`

## 7. Acceptance Criteria

MVP accepted when:

- APK can be built locally with `flutter build apk`.
- User can enter Cloudflare email/key, Telegram token, domain, script name.
- App can run setup against a real Cloudflare account without Termux.
- App can add `excalibur.email`-style additional domain after it is Active in Cloudflare.
- App can verify primary and added domains.
- App can open Telegram claim link.
- App can open Worker dashboard URL.
- Credentials are not logged, committed, or sent to non-Cloudflare/non-Telegram endpoints.
- UI remains usable on small Android screen.
- Root npm package tests still pass.
- Mobile unit tests cover validators and response mapping.

## 8. Security Requirements

- Never hardcode user API keys or bot tokens.
- Mask secrets in UI and logs.
- Store optional credentials using Android secure storage:
  - Flutter secure storage or Kotlin EncryptedSharedPreferences.
- Add explicit warning:
  - Global API Key has broad Cloudflare access.
  - rotate if leaked.
- Add local-only privacy statement in app and README.
- Do not implement any third-party account automation/OTP signup automation.
- Do not proxy credential through our server.

## 9. Todolist by Phase

### Phase 0 — Preparation

- [ ] Decide app folder: `apps/mobile`.
- [ ] Add Flutter project scaffold.
- [ ] Add `docs/mobile/architecture.md`.
- [ ] Add GitHub Actions mobile build check.
- [ ] Decide app id/package name, e.g. `id.shizukudes.telegram_tempmail`.
- [ ] Add license decision for open source.

### Phase 1 — UI Prototype

- [ ] Welcome screen.
- [ ] Requirements checklist screen.
- [ ] Credentials form screen.
- [ ] Setup progress timeline mock.
- [ ] Home dashboard mock.
- [ ] Add domain screen mock.
- [ ] Settings screen mock.
- [ ] Theme: warm yellow/orange style aligned with current web dashboard.
- [ ] Smooth transitions and loading states.

### Phase 2 — Core Mobile Services

- [ ] Implement domain/script validators in Dart.
- [ ] Implement Cloudflare API auth headers.
- [ ] Implement zone lookup.
- [ ] Implement Telegram `getMe`.
- [ ] Implement Worker subdomain lookup.
- [ ] Implement health fetch.
- [ ] Add response/error mappers.
- [ ] Add unit tests for validators and API mappers.

### Phase 3 — Provisioning MVP

- [ ] Port/setup KV namespace creation.
- [ ] Port/setup D1 database creation.
- [ ] Port/setup Worker upload.
- [ ] Port/setup D1 schema query.
- [ ] Port/setup Worker secrets.
- [ ] Port/setup workers.dev enable.
- [ ] Port/setup Email Routing DNS.
- [ ] Port/setup catch-all Worker route.
- [ ] Port/setup Telegram webhook with callback_query allowed.
- [ ] Save local setup state securely.

### Phase 4 — Verify + Admin

- [ ] Implement verify flow.
- [ ] Implement add-domain flow.
- [ ] Implement reset-owner flow.
- [ ] Implement rotate-secret flow.
- [ ] Implement export/import state JSON.
- [ ] Implement dashboard open intent.
- [ ] Implement Telegram open claim/menu intent.

### Phase 5 — Polish + Release

- [ ] App icon.
- [ ] Splash screen.
- [ ] Indonesian onboarding copy.
- [ ] Error troubleshooting pages.
- [ ] Screenshots for README.
- [ ] Build APK artifact from GitHub Actions.
- [ ] Manual live test with `dahus.my.id` and `excalibur.email`.
- [ ] Tag mobile alpha release.

## 10. Verification Plan

### Local

```bash
npm run check
npm run test
```

For mobile later:

```bash
cd apps/mobile
flutter test
flutter analyze
flutter build apk --debug
```

### Live

- Setup fresh test domain.
- Add second domain.
- Verify both domains.
- Send `/menu` to bot.
- Tap all buttons:
  - create email
  - pick domain
  - dashboard
  - status
  - help
- Send test email to generated alias.
- Confirm Telegram receives email.
- Confirm dashboard displays email.

## 11. Risks and Mitigation

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Cloudflare API schema changes | setup fails | keep npm reference tests and clear API wrappers |
| Worker multipart upload from Dart is tricky | blocker | implement small isolated uploader test first |
| Storing Global API Key on mobile | security risk | secure storage, default not persisted, clear warning |
| Android background restrictions | verify not realtime | keep app foreground-driven; Worker handles runtime |
| App grows too large if embedding Node | heavy APK | prefer Dart port for MVP |
| Multi-domain state drift | wrong verify result | always read/write `domains` KV and verify catch-all per domain |

## 12. Next Session Checklist — Jam 22:00

Start here:

1. Create `apps/mobile` Flutter scaffold.
2. Add theme matching current web dashboard.
3. Build static UI screens first, no API yet.
4. Add `docs/mobile/architecture.md`.
5. Add CI job for Flutter if toolchain available.
6. Then port validators and Cloudflare/Telegram API clients.

## 13. Open Questions for Later

- App name final: `TempMail CF`, `CloudMail Bot`, or `Private TempMail`?
- Minimum Android version target?
- Store Global API Key by default or require paste each setup?
- Use Flutter WebView for dashboard or external browser only?
- Publish APK via GitHub Releases only or Play Store later?
