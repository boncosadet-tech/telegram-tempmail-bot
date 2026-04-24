# telegram-tempmail-bot

**Turn any domain you own into a private temp-mail service — Cloudflare hosted, Telegram controlled, web dashboard included.**

[![npm version](https://img.shields.io/npm/v/telegram-tempmail-bot.svg?style=flat-square&color=6366f1)](https://www.npmjs.com/package/telegram-tempmail-bot)
[![npm downloads](https://img.shields.io/npm/dm/telegram-tempmail-bot.svg?style=flat-square&color=10b981)](https://www.npmjs.com/package/telegram-tempmail-bot)
[![node >=20](https://img.shields.io/badge/node-%3E%3D20-5fa04e?style=flat-square&logo=node.js)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange?style=flat-square)](./LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/moahaassy-design/telegram-tempmail-bot?style=flat-square&color=f59e0b)](https://github.com/moahaassy-design/telegram-tempmail-bot/releases)

> Satu perintah `npx` → email sementara di domain kamu sendiri + kontrol Telegram + dashboard web + OTP auto-extract. Runtime 100% di Cloudflare, gratis untuk pemakaian personal, tidak butuh server.

---

## Daftar isi

- [Untuk siapa tool ini?](#untuk-siapa-tool-ini)
- [Cara kerja singkat](#cara-kerja-singkat)
- [Quick start (5 menit)](#quick-start-5-menit)
- [Fitur lengkap](#fitur-lengkap)
- [Android APK](#android-apk)
- [Setup step-by-step (untuk pemula)](#setup-step-by-step-untuk-pemula)
- [CLI reference (power user)](#cli-reference-power-user)
- [Arsitektur](#arsitektur)
- [Environment bindings](#environment-bindings)
- [Cloudflare quota & biaya](#cloudflare-quota--biaya)
- [Development & kontribusi](#development--kontribusi)
- [FAQ & troubleshooting](#faq--troubleshooting)
- [Keamanan](#keamanan)
- [Lisensi](#lisensi)

---

## Untuk siapa tool ini?

| Kamu... | Hasil yang kamu dapat |
| --- | --- |
| ... mau email sekali pakai tanpa bocorin email utama | alamat `apapun@domainsendiri.com` yang masuk ke Telegram kamu |
| ... sering butuh OTP untuk signup/verifikasi | kode OTP otomatis ter-deteksi & bisa dicopy 1-tap |
| ... ingin inbox portable di HP | bot Telegram + dashboard web private, tidak perlu install client email |
| ... developer yang mau testing email routing | multi-alias, multi-domain, catch-all, API `/api/*` siap pakai |
| ... mau self-host tanpa VPS | serverless di Cloudflare Workers — gratis dan auto-scale |

Tool ini **bukan**: mail hosting penuh (bukan pengganti Gmail/ProtonMail), bukan SMTP outbound, bukan untuk menampung lampiran besar-besaran.

---

## Cara kerja singkat

```
  ┌──────────┐   email masuk    ┌──────────────────────┐   event   ┌──────────┐
  │  Pengirim │ ───────────────► │ Cloudflare Email     │ ────────► │ Cloudflare│
  │ (Gmail,   │                  │ Routing (catch-all)  │           │  Worker   │
  │  dsb)     │                  └──────────────────────┘           └────┬─────┘
  └──────────┘                                                            │
                                                                          │ parse,
                                                                          │ simpan,
                                                                          │ kirim
                                                                          ▼
                  ┌────────────┐ ◄─── tombol   ┌────────────┐          ┌───────────┐
                  │ Web        │     /menu     │ Telegram   │ ◄─────── │   D1 +    │
                  │ dashboard  │               │ Bot (kamu) │          │   KV      │
                  │ private    │               └────────────┘          └───────────┘
                  └────────────┘
```

Setiap email yang masuk ke `*@domainkamu.com` diterima Cloudflare Email Routing, di-forward ke Worker, Worker memparse isi + mengekstrak OTP, menyimpan ke D1, lalu mengirim notifikasi ke Telegram kamu.

---

## Quick start (5 menit)

> Butuh: Node.js ≥ 20, domain sendiri, akun Cloudflare (Free), bot Telegram.

```bash
npx telegram-tempmail-bot
```

Pilih menu **1. Setup** → isi domain + Cloudflare email + Global API Key + Telegram bot token. Selesai.

Atau langsung sekali jalan:

```bash
npx --package telegram-tempmail-bot telegram-tempmail-setup \
  --domain domainkamu.com \
  --cf-email you@gmail.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --telegram-bot-token <BOT_TOKEN> \
  --script-name telegram-tempmail
```

Setelah setup selesai:

1. Buka link `https://t.me/<bot>?start=claim` yang ditampilkan → kamu jadi owner.
2. Kirim `/new` ke bot → dapat alias `calm-river-4821@domainkamu.com`.
3. Coba kirim email ke alamat itu dari Gmail → notifikasi masuk ke Telegram dalam ±1 menit.
4. Kirim `/web` → dapat link login dashboard private.

Itu saja. Termux/laptop boleh mati; semuanya jalan di Cloudflare.

---

## Fitur lengkap

**Telegram bot**

- Menu tombol inline (tidak harus hafal command)
- `/new` → alias random human-readable (`calm-river-4821@...`)
- `/new tokopedia` → alias custom
- `/new billing@domainkedua.com` → pilih domain tambahan
- Multi-domain (tambah domain kapan saja via admin CLI)
- Catch-all: alamat apa pun di domain kamu otomatis diterima
- Notifikasi real-time setiap email masuk
- Auto-extract OTP / kode verifikasi (regex heuristic)
- Parsing email HTML → tampilan rapi, link aman (sanitasi XSS)
- Command: `/start`, `/menu`, `/new`, `/web`, `/status`, `/help`

**Web dashboard private**

- Login via link sekali-pakai dari bot (tidak ada form password di internet)
- Session HttpOnly cookie (7 hari)
- Inbox list dengan stat tile + filter per alias
- Preview email + OTP callout (copy 1-tap)
- Hapus 1 email / semua OTP / semua inbox
- Mobile friendly + dark-mode friendly gradient UI
- 100% XSS-safe: semua konten user-controlled dirender via `textContent`

**Runtime Cloudflare**

- Worker multi-module (~9 modul terpisah, clean architecture)
- D1 database untuk inbox (retensi 24 jam; OTP 30 menit)
- KV untuk owner/session/domain list
- Email Routing + catch-all DNS otomatis ter-setup
- Webhook Telegram pakai header rahasia + compare constant-time

**Developer tooling**

- `npm run check` → syntax + ESLint + Prettier + 68 unit tests
- Flat ESLint config, Prettier, `.editorconfig`, `.gitignore` rapi
- Test coverage: utils, HTML sanitizer, MIME/OTP parser, domain validator, auth flow, multi-module upload

---

## Android APK

Release APK Android (signed, split per arsitektur) tersedia di GitHub Releases:

**→ https://github.com/moahaassy-design/telegram-tempmail-bot/releases/latest**

| ABI | Cocok untuk | Ukuran |
| --- | --- | --- |
| `app-arm64-v8a-release.apk` | HP modern (2018+) | ~15 MB |
| `app-armeabi-v7a-release.apk` | HP lama 32-bit | ~13 MB |
| `app-x86_64-release.apk` | Emulator / desktop | ~17 MB |

Fitur APK:

- Wizard setup Cloudflare + Telegram langsung dari HP (tidak perlu laptop)
- Mode **Control Existing** — kontrol Worker yang sudah ada tanpa deploy ulang
- Native inbox membaca D1 langsung (fallback ke dashboard web kalau mau)
- Credential disimpan terenkripsi via Android Keystore
- Signed dengan R8 + resource shrinking → APK ringan

Build APK menggunakan `--split-per-abi --obfuscate --split-debug-info --tree-shake-icons`.

---

## Setup step-by-step (untuk pemula)

### 1. Pastikan domain aktif di Cloudflare

1. Login ke [Cloudflare](https://dash.cloudflare.com/).
2. **Add a site** → masukkan domain kamu → pilih plan **Free**.
3. Ganti nameserver domain di registrar ke 2 nameserver dari Cloudflare (misal `ada.ns.cloudflare.com`).
4. Tunggu sampai status domain **Active**.

### 2. Buat Telegram Bot Token

1. Buka Telegram → chat [@BotFather](https://t.me/BotFather).
2. Kirim `/newbot` → ikuti instruksi.
3. Simpan token (format `1234567890:AA...`).

### 3. Ambil Cloudflare Global API Key

1. Dashboard Cloudflare → profil kanan atas → **My Profile** → **API Tokens**.
2. Scroll ke **API Keys** → klik **View** di samping **Global API Key**.
3. Simpan: email login Cloudflare + Global API Key.

> ⚠️ Global API Key punya akses luas. Jangan commit / share. Rotate di halaman yang sama kalau bocor.

### 4. Jalankan setup

```bash
npx telegram-tempmail-bot
```

Atau one-liner di [Quick start](#quick-start-5-menit).

### 5. Verifikasi

```bash
npx --package telegram-tempmail-bot telegram-tempmail-verify \
  --domain domainkamu.com \
  --cf-email you@gmail.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --telegram-bot-token <BOT_TOKEN> \
  --script-name telegram-tempmail
```

Output sehat:

```
OK zone
OK workers-subdomain
OK binding DOMAIN / STATE_KV / MAIL_DB
OK d1-query
OK email-routing
OK catch-all
OK owner-claim
OK telegram-webhook
OK verify - all critical checks passed
```

### 6. Claim owner + uji kirim email

1. Buka link `https://t.me/<bot>?start=claim` yang ditampilkan setelah setup.
2. Kirim `/new test` ke bot.
3. Dari Gmail lain, kirim email ke `test@domainkamu.com`.
4. Cek Telegram — notifikasi seharusnya masuk dalam 1–5 menit.

---

## CLI reference (power user)

| Binary | Fungsi |
| --- | --- |
| `telegram-tempmail-bot` | Menu interaktif (Setup / Verify / Admin) |
| `telegram-tempmail-setup` | Provision Worker + KV + D1 + Email Routing + webhook |
| `telegram-tempmail-verify` | Health-check semua komponen |
| `telegram-tempmail-admin` | Tambah domain, reset owner, rotate webhook secret |

### Tambah domain tambahan

Domain baru harus sudah **Active** di akun Cloudflare yang sama.

```bash
npx --package telegram-tempmail-bot telegram-tempmail-admin \
  --action add-domain \
  --domain domainkedua.com \
  --cf-email you@gmail.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --script-name telegram-tempmail
```

Setelah sukses, kamu bisa kirim `/new anything@domainkedua.com` dari bot.

### Reset owner

```bash
npx --package telegram-tempmail-bot telegram-tempmail-admin \
  --action reset-owner \
  --domain domainkamu.com \
  --cf-email you@gmail.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --script-name telegram-tempmail
```

### Rotate webhook secret (kalau curiga bocor)

```bash
npx --package telegram-tempmail-bot telegram-tempmail-admin \
  --action rotate-secret \
  --domain domainkamu.com \
  --cf-email you@gmail.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --telegram-bot-token <BOT_TOKEN> \
  --script-name telegram-tempmail
```

### Flag umum

| Flag | Wajib | Contoh |
| --- | --- | --- |
| `--domain` | ya | `domainkamu.com` |
| `--cf-email` | ya | email login Cloudflare |
| `--cf-global-key` | ya | Global API Key |
| `--telegram-bot-token` | setup/rotate | `1234:AA...` |
| `--script-name` | ya | `telegram-tempmail` |
| `--force` | opsional | override catch-all domain lama |

---

## Arsitektur

`src/main.js` hanyalah entry point tipis yang mendelegasi ke modul fokus di `src/worker/`.

| File | Tanggung jawab |
| --- | --- |
| `src/worker/utils.js` | Primitif: `json`, `redirect`, random token, **`safeEqual`** (constant-time compare) |
| `src/worker/html.js` | Escape/decode HTML, sanitasi URL, renderer email aman XSS |
| `src/worker/email.js` | Parse MIME, `readRaw`, `extractLikelyCode` (OTP regex), preview body |
| `src/worker/domains.js` | Validasi alias, normalisasi domain, owner record di KV |
| `src/worker/db.js` | Schema D1, insert/list/purge messages & aliases, auto-migration |
| `src/worker/auth.js` | HttpOnly cookie session, one-shot login token, `requireOwnerSession` |
| `src/worker/api.js` | REST API `/api/*` untuk dashboard SPA |
| `src/worker/telegram.js` | Telegram Bot API transport + command/callback handler |
| `src/worker/dashboard.js` | Template HTML login + dashboard premium (gradient design system) |

Cloudflare Workers men-support **multi-module deploy** dalam satu script: `performSetup` memanggil `collectWorkerModules()` untuk mengumpulkan semua file di atas, lalu upload lewat `CloudflareClient.uploadWorkerScript(accountId, name, modules, options)` dengan FormData + metadata.

---

## Environment bindings

| Binding | Jenis | Dibuat oleh | Catatan |
| --- | --- | --- | --- |
| `DOMAIN` | plain text | `performSetup` | Domain utama |
| `STATE_KV` | KV namespace | `performSetup` | Owner record, sessions, domain list |
| `MAIL_DB` | D1 database | `performSetup` | Inbox + aliases; retensi 24 jam (OTP 30 menit) |
| `BOT_TOKEN` | Worker secret | `performSetup` | Token Telegram bot |
| `WEBHOOK_SECRET` | Worker secret | `performSetup` | Header webhook Telegram; compared timing-safe |

---

## Cloudflare quota & biaya

Untuk pemakaian personal, **Free plan cukup**.

| Komponen | Fungsi | Free plan |
| --- | --- | --- |
| Cloudflare DNS | Hosting DNS | ✅ |
| Email Routing | Menerima email domain | ✅ (semua plan) |
| Email Workers | Eksekusi Worker per email | ikut Workers pricing |
| Workers | Jalankan bot/web/API | ✅ (100k request/hari) |
| Workers KV | Owner/session/state | ✅ (1k write/hari) |
| D1 | Inbox storage | ✅ (5GB + 5M row read/hari) |

**Catatan batasan Free:**

- Email Routing punya limit ukuran per pesan (tidak cocok untuk attachment berat).
- Worker/KV/D1 Free punya quota harian — aman untuk temp-mail pribadi, tidak cocok untuk layanan publik skala besar.

Rujukan resmi:

- [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Global API Key](https://developers.cloudflare.com/fundamentals/api/get-started/keys/)

---

## Development & kontribusi

```bash
git clone https://github.com/moahaassy-design/telegram-tempmail-bot.git
cd telegram-tempmail-bot
npm install
npm run check   # syntax + lint + prettier + 68 tests
```

**Scripts tersedia:**

| Script | Fungsi |
| --- | --- |
| `npm test` | Jalankan test suite (node:test) |
| `npm run syntax-check` | `node --check` semua file src + test |
| `npm run lint` | ESLint flat config |
| `npm run lint:fix` | ESLint + auto-fix |
| `npm run format` | Prettier tulis ulang |
| `npm run format:check` | Prettier verifikasi |
| `npm run check` | Gabungan: syntax + lint + format + test |

Detail lengkap ada di [`CONTRIBUTING.md`](./CONTRIBUTING.md).

### Release flow

Maintainer mem-publish ke npm + GitHub Release lewat tag:

```bash
# bump version di package.json + package-lock.json
npm run check
git commit -am "chore(release): vX.Y.Z"
git push
git tag vX.Y.Z
git push origin vX.Y.Z
```

Workflow `.github/workflows/publish-npm.yml` akan:

1. Jalankan `npm run check`
2. Publish ke npm (pakai secret `NPM_TOKEN`)
3. Buat GitHub Release otomatis

APK mobile rilis lewat tag `mobile-v*`; workflow `.github/workflows/buildrelease.yaml` build signed APK split-per-abi dan meng-upload ke Release.

---

## FAQ & troubleshooting

**Q: Apa bedanya dengan Mailinator/temp-mail.org?**
Itu shared mailbox publik — siapa saja bisa baca. Tool ini pakai domain kamu sendiri, dan inbox-nya private di Telegram/dashboard kamu.

**Q: Apakah bisa kirim email keluar (SMTP outbound)?**
Tidak. Ini sistem receive-only. Cloudflare Email Routing tidak menyediakan outbound SMTP.

**Q: Apakah aman pakai Global API Key?**
Tool ini cuma memanggil API resmi Cloudflare. Key disimpan dalam Worker secret (bukan hard-coded). Tetap rotate kalau pernah bocor atau ganti device.

**Q: Kenapa email tidak masuk?**
Jalankan `telegram-tempmail-verify`. Cek: domain sudah Active? Email Routing ready? Catch-all ke Worker? Webhook Telegram OK? Owner sudah claim?

**Q: Dashboard tidak bisa dibuka?**
Dashboard `/app` butuh session owner. Buka via `/web` di bot untuk dapat link login fresh.

**Q: `Invalid format for X-Auth-Key header`**
Penyebab: key kosong / salah copy / pakai API Token (bukan Global API Key) / key sudah di-rotate. Ambil ulang dari **My Profile → API Tokens → API Keys**.

**Q: Link dashboard expired**
Link login hanya berlaku 10 menit dan sekali-pakai. Kirim `/web` ke bot untuk dapat link baru.

**Q: Bisa dipakai multi-user?**
Desain saat ini: single-owner per Worker. Untuk multi-user, deploy beberapa Worker dengan nama berbeda.

---

## Keamanan

- XSS dashboard: semua konten user-controlled dirender via `textContent` / `setAttribute`, tidak pernah `innerHTML`.
- Webhook Telegram: header `X-Telegram-Bot-Api-Secret-Token` compared timing-safe (`safeEqual`).
- Headers HTML response: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- Login token: one-shot, TTL 10 menit, disimpan di KV.
- Session cookie: HttpOnly, Secure, SameSite=Lax, TTL 7 hari.
- OTP tidak pernah dicatat ke log.
- Auto-purge: D1 messages 24 jam, OTP 30 menit.

Lihat [`SECURITY.md`](./SECURITY.md) untuk threat model lengkap & reporting guideline.

---

## Lisensi

MIT © lihat [`LICENSE`](./LICENSE).

---

## Dokumen lain

- [CHANGELOG](./CHANGELOG.md) — riwayat rilis
- [CONTRIBUTING](./CONTRIBUTING.md) — panduan kontribusi
- [SECURITY](./SECURITY.md) — threat model & reporting
- [AI.md](./AI.md) — catatan untuk AI assistant
- [Project Context](./docs/project-context.md)
- [Development Roadmap](./docs/development-roadmap.md)
