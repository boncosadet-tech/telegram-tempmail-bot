# Panduan Setup Indonesia — telegram-tempmail-bot

Dokumen ini adalah versi ringkas untuk operator Indonesia.

## Yang perlu disiapkan

- Domain pribadi
- Cloudflare Free plan
- Telegram bot token dari BotFather
- Cloudflare account email
- Cloudflare Global API Key
- Node.js 20+

## Alur cepat

1. Tambahkan domain ke Cloudflare.
2. Pilih plan Free.
3. Ganti nameserver domain ke Cloudflare.
4. Tunggu status domain Active.
5. Buat bot Telegram lewat BotFather.
6. Ambil Global API Key dari Cloudflare.
7. Jalankan:

```bash
npx telegram-tempmail-bot
```

8. Pilih Setup.
9. Buka claim link.
10. Kirim `/new` dan `/web` di bot.

## Tambah domain setelah setup

Kalau domain kedua sudah ditambahkan ke Cloudflare dan statusnya **Active**, jalankan:

```bash
npx --package telegram-tempmail-bot telegram-tempmail-admin \
  --action add-domain \
  --domain domainkedua.com \
  --cf-email email-login-cloudflare@example.com \
  --cf-global-key <GLOBAL_API_KEY> \
  --script-name telegram-tempmail
```

Setelah berhasil, bot bisa membuat alamat di domain itu:

```text
/new billing@domainkedua.com
```

Domain baru harus berada di akun Cloudflare yang sama dengan Worker/app utama.

## Kenapa Free plan bisa?

Karena project ini memakai fitur Cloudflare yang tersedia untuk pemakaian gratis/ringan:

- Email Routing tersedia di semua plan.
- Workers punya Free plan.
- KV punya Free usage limit.
- D1 tersedia di Workers Free dan Paid plan.

Untuk usage pribadi, ini cukup. Untuk public tempmail besar, gunakan Paid plan dan abuse controls.

## Keamanan

- Jangan share Global API Key.
- Jangan commit token bot.
- Kalau key/token pernah bocor, rotate.
- Dashboard hanya login via link `/web` dari owner bot.

## Setelah setup

Command Telegram:

```text
/new
/new namaalias
/new namaalias@domainkedua.com
/web
/status
/help
```

Dashboard:

- buka bot
- kirim `/web`
- klik link login
