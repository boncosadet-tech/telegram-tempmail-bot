# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-24

### Added

- **Modular Worker architecture.** `src/main.js` is now a thin entry point that
  delegates to focused modules under `src/worker/` (`api.js`, `auth.js`,
  `dashboard.js`, `db.js`, `domains.js`, `email.js`, `html.js`, `telegram.js`,
  `utils.js`). The Worker is still a single deployable script via the Cloudflare
  multi-module upload API.
- **Premium dashboard redesign.** Login and app pages now share a cohesive
  gradient design system, stat tiles, keyboard-navigable message list, dedicated
  OTP callout with one-click copy, toast notifications, and fully responsive
  layout.
- **Response security headers.** HTML pages are served with
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `X-Frame-Options:
  DENY`.
- **Developer tooling.** New ESLint (flat config) + Prettier configuration,
  `.editorconfig`, and scripts (`npm run lint`, `lint:fix`, `format`,
  `format:check`, `check`).
- **Expanded test suite.** 46 new unit tests for the extracted helpers
  (`html`, `email`, `domains`, `auth`, multi-module upload, `collectWorkerModules`),
  bringing total coverage to 68 tests.
- **Documentation.** Added `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, and
  polished `README.md` with an architecture overview and environment-binding
  table.

### Changed

- `CloudflareClient.uploadWorkerScript(accountId, scriptName, modules, options)`
  now accepts an array of modules plus a named-options object, enabling
  multi-module uploads. `performSetup` was updated accordingly.
- The dashboard SPA renders every user-controlled value via `textContent` /
  `setAttribute` to eliminate XSS vectors in the previous `innerHTML`-based
  template-interpolation approach.
- The Telegram webhook secret is now compared in constant time via
  `safeEqual` in `src/worker/utils.js`.
- `telegramApi` in the Worker correctly targets the requested method instead
  of hardcoding `sendMessage`.

### Fixed

- XSS risk in the dashboard where email subject, sender, and alias strings were
  interpolated into `innerHTML`.
- Incorrect URL construction in the Worker's Telegram transport when sending
  callback answers or non-`sendMessage` methods.

### Security

- See the new [SECURITY.md](./SECURITY.md) for the vulnerability disclosure
  policy and hardening notes.

## [1.0.15] - 2026-04-17

- Last release before the modular refactor. See git history for prior entries.
