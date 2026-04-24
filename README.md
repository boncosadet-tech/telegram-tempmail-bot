# telegram-tempmail-bot

Aplikasi npm interaktif untuk membuat **temp mail pribadi** dengan:

- Cloudflare Email Routing
- Cloudflare Workers
- Cloudflare KV
- Cloudflare D1
- Telegram Bot
- private web dashboard

Runtime-nya berjalan di Cloudflare. Setelah setup selesai, Termux/laptop/VPS lokal boleh mati.

## Status paket

```bash
npx telegram-tempmail-bot
```

Versi npm saat ini mengikuti `latest` di npm registry. Release mobile APK dipublikasikan terpisah di GitHub Releases.

## Android APK alpha

APK Android tersedia dari halaman GitHub Releases:

```text
https://github.com/shizukudes/telegram-tempmail-bot/releases
```

Release mobile terbaru yang sudah dibuild oleh GitHub Actions:

```text
mobile-v0.1.9-alpha.1
```

Catatan mobile alpha:

- Setup Cloudflare + Telegram berjalan langsung dari APK.
- Mode Control Existing bisa login/kontrol Worker lama tanpa deploy ulang.
- Setelah setup/control, runtime tetap fully Cloudflare + Telegram; HP/Termux boleh mati.
- Native inbox membaca Cloudflare D1 langsung; private dashboard Worker tetap tersedia sebagai fallback.
- Credential dapat disimpan terenkripsi di device via Android Keystore; tetap jangan share Global API Key atau bot token di tempat publik.


Subcommand langsung:

```bash
npx --package telegram-tempmail-bot telegram-tempmail-setup
npx --package telegram-tempmail-bot telegram-tempmail-verify
npx --package telegram-tempmail-bot telegram-tempmail-admin
```

## Apa yang bisa dibuat

Setelah setup, kamu akan punya:

- email sementara di domain sendiri, contoh `hello@domainkamu.com`
- menu Telegram dengan tombol inline, bukan command-only
- alias custom dari Telegram, contoh `/new tokopedia`
- tambah domain lain yang sudah onboard/Active di Cloudflare
- catch-all email, jadi alamat apa pun di domain bisa diterima
- notifikasi email masuk ke Telegram
- OTP/code extraction otomatis
- dashboard web private untuk melihat inbox
- parsing email HTML ke tampilan detail yang lebih rapi
- hapus histori OTP/manual cleanup

## Apakah bisa pakai Cloudflare Free?

Bisa untuk pemakaian personal/ringan.

Yang dipakai:

| Komponen | Fungsi | Free plan |
| --- | --- | --- |
| Cloudflare DNS | domain diarahkan ke Cloudflare | bisa |
| Email Routing | menerima email domain | tersedia di semua plan |
| Email Workers | memproses email masuk dengan Worker | ikut Workers pricing |
| Workers | menjalankan bot/web/API | ada Free plan dengan limit |
| Workers KV | owner/session state | ada Free plan dengan limit |
| D1 | inbox/dashboard storage | tersedia di Free dan Paid Workers plan |

Catatan batasan:

- Cloudflare Email Routing punya batas ukuran email, jadi email sangat besar/attachment berat bukan target utama.
- Worker/KV/D1 Free punya quota harian/bulanan. Untuk tempmail pribadi biasanya cukup, tapi bukan untuk layanan publik besar.
- Ini bukan mailbox hosting penuh. Ini sistem routing + dashboard tempmail pribadi.

Rujukan resmi:

- Cloudflare Email Routing: https://developers.cloudflare.com/email-routing/
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Global API Key: https://developers.cloudflare.com/fundamentals/api/get-started/keys/

## Prasyarat

Sebelum setup, siapkan:

1. **Domain sendiri**
   - domain harus bisa dipindahkan nameserver-nya ke Cloudflare
2. **Akun Cloudflare**
   - Free plan cukup
3. **Cloudflare account email**
   - email login Cloudflare, contoh `nama@gmail.com`
4. **Cloudflare Global API Key**
   - dipakai oleh tool untuk setup otomatis
5. **Telegram Bot Token**
   - dibuat lewat BotFather
6. **Node.js 20+**
   - kalau pakai `npx`, tidak perlu clone repo

## License

MIT. Lihat `LICENSE`.

## Dependencies yang dipasang

Kalau menjalankan dari npm:

```bash
npx telegram-tempmail-bot
```

Kamu hanya butuh:

- Node.js 20 atau lebih baru
- akses internet
- akun Cloudflare
- token bot Telegram

Kalau clone repo untuk development:

```bash
git clone https://github.com/shizukudes/telegram-tempmail-bot.git
cd telegram-tempmail-bot
npm install
npm start
```

Dependency dev utama:

- `wrangler` untuk development manual Cloudflare Worker

Setup production normal **tidak wajib** pakai `wrangler login`, karena app memakai Cloudflare API langsung.

## Step 1 — Onboarding domain ke Cloudflare

Tujuan: domain kamu aktif di Cloudflare DNS.

Langkah:

1. Login ke Cloudflare.
2. Klik **Add a domain** / **Add site**.
3. Masukkan domain kamu, contoh:

   ```text
   domainkamu.com
   ```

4. Pilih plan **Free**.
5. Cloudflare akan scan DNS record.
6. Lanjutkan sampai Cloudflare memberi 2 nameserver, contoh:

   ```text
   ada.ns.cloudflare.com
   ben.ns.cloudflare.com
   ```

7. Buka panel registrar tempat kamu beli domain.
8. Ganti nameserver domain ke nameserver dari Cloudflare.
9. Tunggu sampai status domain di Cloudflare menjadi **Active**.

Cara cek berhasil:

- Dashboard Cloudflare menampilkan domain dengan status **Active**.
- Menu DNS/Email Routing/Workers bisa dibuka.

Catatan:

- Kalau domain masih punya email lama aktif, hati-hati. Setup ini akan mengelola Email Routing/catch-all.
- Untuk domain percobaan/kosong, aman lanjut.

## Step 2 — Buat Telegram Bot Token

Tujuan: bot Telegram menjadi tempat kontrol dan notifikasi email.

Langkah:

1. Buka Telegram.
2. Chat ke:

   ```text
   @BotFather
   ```

3. Kirim:

   ```text
   /newbot
   ```

4. Ikuti instruksi nama bot dan username bot.
5. BotFather akan memberi token seperti:

   ```text
   1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

Simpan token itu. Jangan upload ke GitHub atau chat publik.

## Step 3 — Ambil Cloudflare Global API Key

Tujuan: app bisa otomatis membuat Worker, KV, D1, Email Routing, dan webhook.

Langkah dari dashboard Cloudflare:

1. Login ke Cloudflare.
2. Klik ikon profil kanan atas.
3. Masuk ke **My Profile**.
4. Buka menu **API Tokens**.
5. Scroll ke bagian **API Keys**.
6. Pada **Global API Key**, klik **View**.
7. Cloudflare mungkin meminta password/2FA.
8. Copy Global API Key.

Data yang perlu kamu punya:

```text
Cloudflare email: email-login-cloudflare@example.com
Global API Key: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Peringatan keamanan:

- Global API Key punya akses luas ke akun Cloudflare.
- Jangan commit ke repo.
- Jangan kirim ke grup/chat publik.
- Kalau pernah bocor, langsung **Change** / rotate dari halaman yang sama.

## Step 4 — Jalankan setup interaktif

Cara paling gampang:

```bash
npx telegram-tempmail-bot
```

Pilih menu:

```text
1. Setup
```

Isi data:

```text
Domain: domainkamu.com
Cloudflare email: email-login-cloudflare@example.com
Cloudflare Global API Key: <GLOBAL_API_KEY>
Telegram bot token: <BOT_TOKEN>
Worker script name: telegram-tempmail
```

Kalau mau langsung satu command:

```bash
npx --package telegram-tempmail-bot telegram-tempmail-setup \
  --domain domainkamu.com \
  --cf-email email-login-cloudflare@example.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --telegram-bot-token <BOT_TOKEN> \
  --script-name telegram-tempmail
```

Yang otomatis dibuat:

- Cloudflare Worker
- Worker URL `workers.dev`
- KV namespace untuk owner/session
- D1 database untuk inbox dashboard
- schema D1
- Email Routing DNS
- catch-all route ke Worker
- Telegram webhook

Setelah setup selesai, app akan menampilkan link claim:

```text
https://t.me/<bot_username>?start=claim
```

Buka link itu dari akun Telegram kamu untuk menjadi owner.

## Step 5 — Verifikasi setup

Jalankan:

```bash
npx --package telegram-tempmail-bot telegram-tempmail-verify \
  --domain domainkamu.com \
  --cf-email email-login-cloudflare@example.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --telegram-bot-token <BOT_TOKEN> \
  --script-name telegram-tempmail
```

Hasil sehat biasanya seperti:

```text
OK zone
OK workers-subdomain
OK binding DOMAIN
OK binding STATE_KV
OK binding MAIL_DB
OK d1-query
OK email-routing
OK catch-all
OK owner-claim
OK telegram-webhook
OK verify - all critical checks passed
```

Kalau `owner-claim` masih pending, buka bot dan kirim:

```text
/start claim
```

## Step 6 — Pakai bot

UI utama:

```text
/menu
```

atau:

```text
/start
```

Bot akan menampilkan tombol:

- **➕ Buat email**
- **🌐 Pilih domain**
- **📬 Dashboard**
- **📊 Status**
- **❔ Bantuan**

Command manual tetap tersedia:

```text
/start claim
```

Claim owner pertama kali.

```text
/menu
```

Tampilkan menu tombol utama.

```text
/new
```

Buat alias readable otomatis, contoh:

```text
calm-river-4821@domainkamu.com
```

```text
/new tokopedia
```

Buat alias custom:

```text
tokopedia@domainkamu.com
```

```text
/new hello.team@domainkamu.com
```

Input full email juga diterima. Kalau domain tersebut sudah ditambahkan ke app, bot akan membuat alamat di domain itu.

Contoh setelah kamu menambahkan domain kedua:

```text
/new billing@domainkedua.com
```

Hasil:

```text
billing@domainkedua.com
```

```text
/web
```

Minta link login dashboard private.

```text
/status
```

Cek status bot.

```text
/help
```

Lihat bantuan dengan tombol shortcut.

## Step 7 — Pakai web dashboard private

1. Buka bot Telegram.
2. Kirim:

   ```text
   /web
   ```

3. Bot akan mengirim link login sekali pakai.
4. Buka link tersebut.
5. Dashboard private terbuka.

Fitur dashboard:

- lihat inbox terbaru
- filter per alias
- buat alias baru
- lihat OTP/code
- lihat email HTML dalam tampilan detail yang lebih rapi
- hapus 1 email
- hapus semua histori OTP
- hapus semua histori email

Dashboard tidak bisa dibuka publik tanpa session owner.

## Step 8 — Test email masuk

1. Buat alias:

   ```text
   /new test
   ```

2. Kirim email dari Gmail/email lain ke:

   ```text
   test@domainkamu.com
   ```

3. Cek Telegram.
4. Cek dashboard web dari `/web`.

Jika email belum muncul:

- tunggu 1–5 menit
- cek domain sudah Active di Cloudflare
- cek verify command
- pastikan catch-all mengarah ke Worker

## Admin command

Tambah domain yang sudah onboard/Active di Cloudflare ke app yang sama:

```bash
npx --package telegram-tempmail-bot telegram-tempmail-admin \
  --action add-domain \
  --domain domainkedua.com \
  --cf-email email-login-cloudflare@example.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --script-name telegram-tempmail
```

Yang dilakukan command ini:

- memastikan domain sudah Active di Cloudflare
- mengaktifkan Email Routing DNS domain baru
- memasang catch-all domain baru ke Worker yang sama
- menyimpan daftar domain ke KV app

Verifikasi domain tambahan:

```bash
npx --package telegram-tempmail-bot telegram-tempmail-verify \
  --domain domainkedua.com \
  --cf-email email-login-cloudflare@example.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --script-name telegram-tempmail
```

Catatan:

- domain baru harus berada di akun Cloudflare yang sama dengan Worker
- gunakan `--force` hanya kalau kamu memang ingin mengganti catch-all lama di domain baru
- setelah berhasil, kamu bisa pakai `/new alias@domainkedua.com`

Reset owner:

```bash
npx --package telegram-tempmail-bot telegram-tempmail-admin \
  --action reset-owner \
  --domain domainkamu.com \
  --cf-email email-login-cloudflare@example.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --script-name telegram-tempmail
```

Rotate webhook secret:

```bash
npx --package telegram-tempmail-bot telegram-tempmail-admin \
  --action rotate-secret \
  --domain domainkamu.com \
  --cf-email email-login-cloudflare@example.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --telegram-bot-token <BOT_TOKEN> \
  --script-name telegram-tempmail
```

## Troubleshooting

### Cloudflare API: `Invalid format for X-Auth-Key header`

Penyebab umum:

- Global API Key kosong
- salah copy
- memakai API Token, bukan Global API Key
- key sudah di-rotate

Solusi:

- ambil ulang Global API Key dari **My Profile > API Tokens > API Keys**
- pastikan `--cf-email` adalah email login Cloudflare yang benar

### Domain tidak ditemukan

Penyebab:

- domain belum ditambahkan ke Cloudflare
- nameserver belum diarahkan ke Cloudflare
- status belum Active

Solusi:

- ulang Step 1
- tunggu propagasi nameserver

### Email tidak masuk

Cek:

```bash
npx --package telegram-tempmail-bot telegram-tempmail-verify ...
```

Pastikan:

- Email Routing ready
- catch-all mengarah ke Worker
- webhook Telegram OK
- owner sudah claim

### Dashboard tidak bisa dibuka

Gunakan `/web`, jangan langsung buka `/app` tanpa login.

Kalau link expired:

```text
/web
```

lalu buka link baru.

## Development

Clone repo:

```bash
git clone https://github.com/shizukudes/telegram-tempmail-bot.git
cd telegram-tempmail-bot
npm install
npm run check
npm run test
```

Branch default repo: `master`.

## GitHub Actions

Repo ini punya:

- CI untuk push/PR ke `master`
- publish workflow untuk npm saat tag `v*` dibuat

Release flow:

```bash
# edit package.json version
npm run check
npm run test
git add .
git commit -m "Release ..."
git push origin master
git tag vX.Y.Z
git push origin vX.Y.Z
```

Setelah tag dipush, GitHub Actions akan publish ke npm memakai secret `NPM_TOKEN`.

## Arsitektur Worker

`src/main.js` adalah entry point yang tipis dan meng-_import_ modul di bawah
`src/worker/`:

| File                         | Tanggung jawab                                                             |
| ---------------------------- | -------------------------------------------------------------------------- |
| `src/worker/utils.js`        | Primitives: `json`, `redirect`, random token/digit, `safeEqual`.           |
| `src/worker/html.js`         | Escape/decoding HTML, sanitasi URL, renderer email aman.                    |
| `src/worker/email.js`        | Parsing MIME, `readRaw`, `extractLikelyCode`, preview body.                 |
| `src/worker/domains.js`      | Validasi alias, normalisasi domain, owner record di KV.                     |
| `src/worker/db.js`           | Schema D1, insert/list/purge messages dan aliases.                          |
| `src/worker/auth.js`         | Cookie session, login token, `requireOwnerSession`.                         |
| `src/worker/api.js`          | REST API `/api/*` untuk dashboard.                                          |
| `src/worker/telegram.js`     | Telegram Bot API transport + handler command/callback.                      |
| `src/worker/dashboard.js`    | Template HTML login + dashboard premium.                                    |

Cloudflare mengizinkan Worker multi-modul dalam satu deploy; `performSetup`
menggunakan `collectWorkerModules()` untuk mengumpulkan semua file di atas dan
mengunggahnya lewat `CloudflareClient.uploadWorkerScript(accountId, name, modules, options)`.

### Environment bindings

| Name             | Jenis          | Dibuat oleh       | Catatan                                              |
| ---------------- | -------------- | ----------------- | ---------------------------------------------------- |
| `DOMAIN`         | Plain text     | `performSetup`    | Domain utama untuk alias email.                      |
| `STATE_KV`       | KV namespace   | `performSetup`    | Owner record, sessions, domain tambahan.             |
| `MAIL_DB`        | D1 database    | `performSetup`    | Inbox + aliases. Retention 24 jam / 30 menit untuk OTP. |
| `BOT_TOKEN`      | Worker secret  | `performSetup`    | Token bot Telegram (jangan commit).                  |
| `WEBHOOK_SECRET` | Worker secret  | `performSetup`    | Header rahasia webhook Telegram; cek timing-safe.    |

### Quality gates

```bash
npm run check   # syntax-check + lint + format:check + tests
```

Lihat [`CONTRIBUTING.md`](./CONTRIBUTING.md) untuk rincian script,
[`SECURITY.md`](./SECURITY.md) untuk threat model, dan
[`CHANGELOG.md`](./CHANGELOG.md) untuk riwayat rilis.

## Dokumen tambahan

- [AI.md](./AI.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [Project Context](./docs/project-context.md)
- [Development Roadmap](./docs/development-roadmap.md)
