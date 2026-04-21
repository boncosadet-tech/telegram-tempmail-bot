# Project Context

## Overview

`telegram-tempmail-bot` is an operator-focused tool that provisions and manages a private temp-mail setup using Cloudflare and Telegram.

The current implementation supports:

- Interactive CLI app
- Setup flow for Cloudflare Worker, KV, Email Routing, and Telegram webhook
- Verification flow for deployed infrastructure
- Admin flow for owner reset, webhook secret rotation, and adding onboarded domains
- npm package distribution
- GitHub Actions CI and publish workflows

## Runtime Architecture

### Inbound email

1. Cloudflare Email Routing receives email at `*@domain`
2. Catch-all route sends the message to a Worker
3. Worker parses a lightweight preview and possible OTP/code
4. Worker forwards the summary to the Telegram owner chat

### Telegram control path

1. Telegram sends webhook updates to the Worker
2. Worker validates the webhook secret
3. Worker reads owner state from KV
4. Worker serves owner-only commands

### State

- Cloudflare KV stores the owner record under the key `owner`
- Cloudflare KV stores configured app domains under the key `domains`
- D1 stores inbox messages and rendered HTML previews
- Local setup metadata is stored at `.tempmail/setup-state.json`

## Runtime vs local dependency

After setup, runtime traffic is fully cloud-hosted:

- Cloudflare Email Routing receives mail
- Cloudflare Worker processes webhook and email events
- Cloudflare KV stores owner state
- Telegram delivers control messages and notifications

A local Termux session is not part of the runtime path. It is only used for operator tasks such as setup, verify, admin actions, upgrades, and publishing.

## Repository Structure

- `src/main.js`
  Worker runtime
- `src/cli/`
  CLI entrypoints
- `src/lib/`
  Shared service and API clients
- `bin/`
  Published npm command wrappers
- `test/`
  Unit and service-level mocked tests
- `.github/workflows/`
  CI and npm release automation

## Supported Operator Flows

- First-time bootstrap with `setup`
- Health validation with `verify`
- Owner reset with `admin --action reset-owner`
- Webhook secret rotation with `admin --action rotate-secret`
- Add onboarded Cloudflare domain with `admin --action add-domain`

## Constraints

- One owner per deployment
- One primary domain per deployment, with optional additional domains on the same Cloudflare account
- Worker catch-all path is the main routing mechanism
- Cloudflare authentication currently uses account email plus Global API Key
- Telegram bot must have a username for the claim link flow

## Current Strengths

- Shared orchestration logic is centralized in `src/lib/service.js`
- Live deployment and npm package both already work
- CI and release automation are present
- Local and published CLI paths are both tested

## Current Weak Spots

- MIME parsing is intentionally basic
- Large attachment handling is out of scope
- Some external-system edge cases are only covered manually, not exhaustively in tests
- Mobile native inbox and secure credential storage are still planned follow-ups
