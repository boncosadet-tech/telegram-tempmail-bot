# Contributing

Thanks for wanting to contribute! This project is small, opinionated, and aims
for a high bar on code quality.

## Prerequisites

- Node.js 20+
- An editor with an [EditorConfig](https://editorconfig.org/) plugin

## First-time setup

```bash
git clone https://github.com/<owner>/telegram-tempmail-bot.git
cd telegram-tempmail-bot
npm install
```

## Scripts

| Command                | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `npm test`             | Run the Node.js test runner (unit tests).               |
| `npm run lint`         | Run ESLint over `src/` and `test/`.                     |
| `npm run lint:fix`     | Auto-fix ESLint findings where safe.                    |
| `npm run format`       | Run Prettier and rewrite files in place.                |
| `npm run format:check` | Fail if any file is not Prettier-formatted.             |
| `npm run syntax-check` | `node --check` every source file (fast syntax pass).    |
| `npm run check`        | Run syntax check + lint + format check + tests.         |
| `npm run dev`          | Run the Worker locally via `wrangler dev`.              |
| `npm run setup`        | Interactive provisioning CLI.                           |
| `npm run verify`       | Interactive verification CLI.                           |

## Code style

- ES modules only (`"type": "module"`).
- Two-space indentation, LF line endings, UTF-8.
- Prefer pure functions; side effects live at module boundaries.
- Keep Worker modules **small and single-purpose** — large handlers should
  decompose into helpers that are unit-testable.
- Every branch that touches user-controlled data must either escape it (HTML)
  or treat it as opaque bytes (DB parameters).

## Tests

Add tests alongside the relevant module under `test/`. Prefer the Node.js
built-in `node:test` runner; no Jest/Vitest.

We aim for:

- Every pure helper exported from `src/worker/*.js` has at least one positive
  and one negative test.
- Any user-visible behavior change in the Worker surface ships with a
  request-level test against `main.js`'s default export.

## Commit messages

No strict convention — please keep them descriptive and scoped. Squash-merging
is recommended for small PRs.

## Security

Please read [`SECURITY.md`](./SECURITY.md) before publishing anything about a
suspected vulnerability.
