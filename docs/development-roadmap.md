# Development Roadmap

## Near-Term Priorities

### 1. Email parsing quality

- Improve multipart parsing for common provider templates
- Add better plain-text fallback extraction
- Improve OTP/code extraction accuracy

### 2. Better diagnostics

- Add more explicit operator messages on Cloudflare API failures
- Add clearer remediation hints for webhook mismatch, owner state problems, and catch-all conflicts
- Add machine-readable output mode for `verify`

### 3. Test coverage

- Expand mocked tests for failure and conflict paths
- Add tests for interactive input collection
- Add regression tests around secret rotation and owner reset

## Medium-Term Improvements

### 4. Security and credentials

- Support scoped Cloudflare API token mode in addition to Global API Key mode
- Add stronger local guidance for secret handling and credential rotation

### 5. UX and package ergonomics

- Smooth out npm packaging warnings if possible
- Improve admin menu flow in the interactive app
- Add clearer success summaries with next-step hints

### 6. Operational resilience

- Add retry helpers for transient Cloudflare and Telegram API failures
- Add optional structured logs for CI and local runs
- Add a safe dry-run mode for admin actions

## Out of Scope for the Current Model

- Full mailbox hosting
- Multi-owner sharing
- Per-user multitenant routing
- Attachment download and storage
- Sending outbound mail
