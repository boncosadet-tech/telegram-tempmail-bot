#!/usr/bin/env python3
"""
Auto-signup ChatGPT account using a custom-domain email handled by this
repository's Cloudflare Worker (telegram-tempmail) + Cloudflare D1.

Designed to run inside GitHub Actions (no existing Chrome required). Reads
configuration from environment variables and CLI arguments; sends the
final credentials and Cookie-Editor cookies file to the Telegram chat
specified by `OWNER_CHAT_ID`.

Required env vars:
  CLOUDFLARE_GLOBAL_API  Cloudflare Global API Key
  CLOUDFLARE_EMAIL       Cloudflare account email (X-Auth-Email header)
  TELEGRAM_BOT_TOKEN     Telegram bot token (sender)
  OWNER_CHAT_ID          Telegram chat id of the recipient
  CF_ACCOUNT_ID          Cloudflare account id (default: hard-coded user)
  D1_DATABASE_ID         D1 database id (default: hard-coded user)
  DOMAIN                 Email domain (default: hard-coded user)

CLI flags (all optional):
  --mode pretty|short|random   alias style
  --alias <local>              custom alias (overrides --mode)
  --password <pwd>             custom password
  --full-name <name>           custom full name
  --age <int>                  age (default: 25)
  --otp-timeout <int>          seconds to wait for OTP (default: 180)
  --no-fast                    disable resource blocking
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import urllib.request

# patchright is a maintained fork of playwright that ships pre-applied
# CDP-detection patches (the same approach as rebrowser-playwright). It is
# noticeably more reliable than tf-playwright-stealth at clearing the
# Cloudflare “Just a moment…” challenge from a fresh runner IP, especially
# when paired with a real headed Chromium under Xvfb.
from patchright.sync_api import sync_playwright, TimeoutError as PWTimeout


# Defaults (overridable via env vars). Tied to a specific tempmail deployment.
DEFAULT_CF_ACCOUNT = "3c4f8096a94b82c80fced2fccad04dcb"
DEFAULT_D1_DB = "3cdf782b-c072-4078-ade6-23de7389653a"
DEFAULT_DOMAIN = "dahus.my.id"


WORDS_A = [
    "calm", "swift", "bright", "gentle", "happy", "lucky", "noble",
    "quiet", "sunny", "brave", "merry", "clever", "kind", "wise",
]
WORDS_B = [
    "river", "forest", "ocean", "meadow", "harbor", "valley", "mountain",
    "cloud", "garden", "island", "summit", "stream", "horizon",
]
FIRST_NAMES = [
    "aisha", "dimas", "justin", "riko", "reza", "farhan", "adit", "bagas",
    "intan", "sasha", "nadia", "raka", "tara", "luna", "kiki", "dewi",
    "andre", "bayu", "surya", "yoga", "vania", "naufal", "mira", "bella",
    "david", "kevin", "oscar", "liam", "noah", "emma", "olivia", "chloe",
    "adrian", "ethan", "leo", "mia", "zara", "ayla", "alexa", "vince",
]
LAST_NAMES = [
    "putra", "saputra", "hartono", "wijaya", "prasetyo", "santoso",
    "kusuma", "nugraha", "setiawan", "pratama", "anggara", "firmansyah",
    "halim", "wibowo", "susanto", "tanaka", "smith", "lee", "chen",
    "morgan", "reyes", "silva", "cole", "hayes", "miller", "reed",
    "foster", "warren", "bennett", "brooks",
]


def gen_alias(mode: str = "pretty") -> str:
    if mode == "random":
        return f"{random.choice(WORDS_A)}-{random.choice(WORDS_B)}-{random.randint(1000, 9999)}"
    if mode == "short":
        return f"{random.choice(FIRST_NAMES)}{random.randint(10, 99)}"
    return f"{random.choice(FIRST_NAMES)}.{random.choice(LAST_NAMES)}"


def alias_to_full_name(alias: str) -> str:
    cleaned = alias.replace(".", " ").replace("-", " ").replace("_", " ")
    parts = [w for w in cleaned.split() if not w.isdigit()]
    parts = ["".join(c for c in w if c.isalpha()) for w in parts]
    parts = [w for w in parts if w]
    if len(parts) == 1:
        parts.append(random.choice(LAST_NAMES))
    return " ".join(w.capitalize() for w in parts[:2])


def gen_password() -> str:
    base = random.choice(WORDS_A).capitalize() + random.choice(WORDS_B).capitalize()
    return f"{base}@{random.randint(2000, 2099)}"


# ---------------------------------------------------------------------------
# Telegram + Cloudflare API helpers
# ---------------------------------------------------------------------------


def http_request(method: str, url: str, headers: dict, body: bytes | None = None,
                 timeout: int = 30) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def telegram_send(token: str, chat_id: str, text: str) -> None:
    if not token or not chat_id:
        print("[telegram] missing token/chat_id; skipping send")
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "HTML",
                       "disable_web_page_preview": True}).encode()
    status, _ = http_request("POST", url, {"Content-Type": "application/json"}, body)
    print(f"[telegram] sendMessage -> {status}")


def telegram_send_document(token: str, chat_id: str, file_path: str,
                           caption: str = "") -> None:
    if not token or not chat_id:
        return
    url = f"https://api.telegram.org/bot{token}/sendDocument"
    boundary = "----devin-boundary-" + str(int(time.time()))
    parts: list[bytes] = []
    def field(name: str, value: str) -> None:
        parts.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            value.encode(), b"\r\n",
        ])
    field("chat_id", chat_id)
    if caption:
        field("caption", caption)
    with open(file_path, "rb") as f:
        data = f.read()
    fname = os.path.basename(file_path)
    parts.extend([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="document"; filename="{fname}"\r\n'.encode(),
        b"Content-Type: application/json\r\n\r\n",
        data, b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    body = b"".join(parts)
    status, _ = http_request(
        "POST", url,
        {"Content-Type": f"multipart/form-data; boundary={boundary}"},
        body,
    )
    print(f"[telegram] sendDocument({fname}) -> {status}")


def d1_query(account_id: str, db_id: str, sql: str) -> dict:
    api_key = os.environ["CLOUDFLARE_GLOBAL_API"]
    cf_email = os.environ["CLOUDFLARE_EMAIL"]
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/d1/database/{db_id}/query"
    )
    body = json.dumps({"sql": sql}).encode()
    status, payload = http_request(
        "POST", url,
        {
            "X-Auth-Email": cf_email,
            "X-Auth-Key": api_key,
            "Content-Type": "application/json",
        },
        body,
    )
    if status >= 400:
        raise RuntimeError(f"D1 query HTTP {status}: {payload.decode()[:200]}")
    return json.loads(payload)


def d1_query_params(account_id: str, db_id: str, sql: str, params: list) -> dict:
    """Same as d1_query but uses the D1 ``params`` field for safe binding."""
    api_key = os.environ["CLOUDFLARE_GLOBAL_API"]
    cf_email = os.environ["CLOUDFLARE_EMAIL"]
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/d1/database/{db_id}/query"
    )
    body = json.dumps({"sql": sql, "params": params}).encode()
    status, payload = http_request(
        "POST", url,
        {
            "X-Auth-Email": cf_email,
            "X-Auth-Key": api_key,
            "Content-Type": "application/json",
        },
        body,
    )
    if status >= 400:
        raise RuntimeError(f"D1 query HTTP {status}: {payload.decode()[:200]}")
    return json.loads(payload)


_ACCOUNTS_TABLE_READY = False


def ensure_accounts_table(account_id: str, db_id: str) -> None:
    """Create the chatgpt_accounts table if it doesn't already exist."""
    global _ACCOUNTS_TABLE_READY
    if _ACCOUNTS_TABLE_READY:
        return
    sql = (
        "CREATE TABLE IF NOT EXISTS chatgpt_accounts ("
        "email TEXT PRIMARY KEY, "
        "password TEXT NOT NULL, "
        "full_name TEXT, "
        "alias_local TEXT, "
        "age INTEGER, "
        "created_at INTEGER NOT NULL"
        ")"
    )
    d1_query_params(account_id, db_id, sql, [])
    _ACCOUNTS_TABLE_READY = True


def record_account(account_id: str, db_id: str, result: dict) -> None:
    """Persist a freshly-created ChatGPT account to D1."""
    ensure_accounts_table(account_id, db_id)
    sql = (
        "INSERT INTO chatgpt_accounts "
        "(email, password, full_name, alias_local, age, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(email) DO UPDATE SET "
        "password = excluded.password, "
        "full_name = excluded.full_name, "
        "alias_local = excluded.alias_local, "
        "age = excluded.age, "
        "created_at = excluded.created_at"
    )
    now_ms = int(time.time() * 1000)
    alias_local = result["email"].split("@", 1)[0]
    d1_query_params(account_id, db_id, sql, [
        result["email"], result["password"], result.get("full_name", ""),
        alias_local, int(result.get("age") or 0), now_ms,
    ])


def fetch_recent_accounts(account_id: str, db_id: str,
                          window_days: int = 30) -> list[dict]:
    ensure_accounts_table(account_id, db_id)
    cutoff_ms = int((time.time() - window_days * 86400) * 1000)
    sql = (
        "SELECT email, password, full_name, age, created_at "
        "FROM chatgpt_accounts WHERE created_at >= ? "
        "ORDER BY created_at DESC"
    )
    res = d1_query_params(account_id, db_id, sql, [cutoff_ms])
    return (res.get("result") or [{}])[0].get("results") or []


def write_accounts_file(account_id: str, db_id: str, path: str,
                        window_days: int = 30) -> int:
    """Render the rolling account list to ``path``; returns row count."""
    rows = fetch_recent_accounts(account_id, db_id, window_days=window_days)
    header = (
        f"# ChatGPT accounts created in the last {window_days} days "
        f"(total: {len(rows)})\n"
        "# format: email | password | full_name | age | created_at_iso\n"
    )
    lines = [header]
    for r in rows:
        ts_iso = time.strftime(
            "%Y-%m-%d %H:%M:%SZ",
            time.gmtime((r.get("created_at") or 0) / 1000),
        )
        lines.append(
            f"{r.get('email','')} | {r.get('password','')} | "
            f"{r.get('full_name','')} | {r.get('age','')} | {ts_iso}\n"
        )
    with open(path, "w") as f:
        f.writelines(lines)
    return len(rows)


def poll_otp(account_id: str, db_id: str, alias_local: str, since_ts_ms: int,
             timeout_s: int = 180, interval_s: float = 1.5) -> str:
    deadline = time.time() + timeout_s
    sql = (
        "SELECT otp_code, sender, subject, received_at FROM messages "
        "WHERE alias_local = ? AND received_at > ? "
        "AND sender LIKE '%openai%' "
        "ORDER BY received_at DESC LIMIT 1"
    )
    while time.time() < deadline:
        try:
            res = d1_query_params(account_id, db_id, sql,
                                  [alias_local, since_ts_ms])
            rows = (res.get("result") or [{}])[0].get("results") or []
            if rows and rows[0].get("otp_code") and rows[0]["otp_code"] != "-":
                otp = rows[0]["otp_code"].strip()
                print(f"[OTP] received from {rows[0]['sender']}: {otp}")
                return otp
        except Exception as e:
            print(f"[D1] query failed: {e}", file=sys.stderr)
        time.sleep(interval_s)
    raise RuntimeError(f"Timeout: no OTP for {alias_local} within {timeout_s}s")


# ---------------------------------------------------------------------------
# Browser automation
# ---------------------------------------------------------------------------


def cf_turnstile_clickbox(page, timeout_ms: int = 20000) -> bool:
    try:
        iframe_loc = page.locator('iframe[src*="challenges.cloudflare.com"]').first
        iframe_loc.wait_for(state="visible", timeout=timeout_ms)
    except PWTimeout:
        return False
    try:
        box = iframe_loc.bounding_box()
        if box:
            cx = box["x"] + 30
            cy = box["y"] + box["height"] / 2
            page.mouse.move(cx - 50, cy - 20, steps=5)
            page.mouse.move(cx, cy, steps=5)
            page.wait_for_timeout(200)
            page.mouse.click(cx, cy)
            print(f"[turnstile] click at ({cx:.0f}, {cy:.0f})")
            page.wait_for_timeout(3500)
            return True
    except Exception as e:
        print(f"[turnstile] bbox click failed: {e}")
    for fr in page.frames:
        if "challenges.cloudflare.com" in (fr.url or ""):
            try:
                box = fr.wait_for_selector('input[type="checkbox"]', timeout=5000)
                box.click()
                print("[turnstile] iframe DOM click")
                page.wait_for_timeout(3500)
                return True
            except Exception:
                pass
    return False


def wait_for_signup_button(page, total_ms: int = 60000) -> None:
    deadline = time.time() + total_ms / 1000
    while time.time() < deadline:
        try:
            page.get_by_role("button", name="Sign up for free").wait_for(
                state="visible", timeout=3000)
            return
        except PWTimeout:
            pass
        try:
            page.get_by_role("link", name="Sign up for free").wait_for(
                state="visible", timeout=1500)
            return
        except PWTimeout:
            pass
        if cf_turnstile_clickbox(page, timeout_ms=4000):
            continue
        page.wait_for_timeout(1500)
    raise PWTimeout(f"Sign up button not visible within {total_ms}ms")


def export_cookies(context, target_domains=("chatgpt.com", "openai.com")) -> list:
    raw = context.cookies()
    out = []
    ss_map = {"None": "no_restriction", "Lax": "lax", "Strict": "strict", None: "unspecified"}
    for c in raw:
        dom = c.get("domain", "") or ""
        if not any(t in dom for t in target_domains):
            continue
        entry = {
            "domain": dom,
            "hostOnly": not dom.startswith("."),
            "httpOnly": bool(c.get("httpOnly", False)),
            "name": c.get("name"),
            "path": c.get("path", "/"),
            "sameSite": ss_map.get(c.get("sameSite"), "lax"),
            "secure": bool(c.get("secure", False)),
            "session": c.get("expires", -1) in (-1, None),
            "storeId": None,
            "value": c.get("value", ""),
        }
        exp = c.get("expires")
        if exp and exp != -1:
            entry["expirationDate"] = float(exp)
        out.append(entry)
    return out


_BLOCK_TYPES = {"image", "media", "font"}


def _route_blocker(route):
    if route.request.resource_type in _BLOCK_TYPES:
        return route.abort()
    return route.continue_()


def signup(args, account_id: str, db_id: str, domain: str) -> dict:
    email = f"{args.alias}@{domain}"
    password = args.password or gen_password()
    started_ms = int(time.time() * 1000) - 5000
    t0 = time.time()
    print(f"[signup] email={email}  password={password}  name={args.full_name}")

    with sync_playwright() as pw:
        # patchright + headed Chromium under Xvfb is the combination that
        # reliably clears Cloudflare's "Just a moment…" challenge from a fresh
        # GitHub Actions runner IP. headless=True is detected and stalls.
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1366, "height": 768},
            locale="en-US",
        )
        page = context.new_page()

        if args.fast:
            page.route("**/*", _route_blocker)
            print("[fast] blocking image/media/font")

        page.goto("https://chatgpt.com/")
        wait_for_signup_button(page, total_ms=60000)
        try:
            page.get_by_role("button", name="Sign up for free").click(timeout=5000)
        except PWTimeout:
            page.get_by_role("link", name="Sign up for free").click()

        page.wait_for_selector('input[name="email"], input[type="email"]', timeout=20000)
        page.fill('input[name="email"], input[type="email"]', email)
        page.get_by_role("button", name="Continue", exact=True).click()

        page.wait_for_selector('input[name="password"], input[type="password"]', timeout=20000)
        page.fill('input[name="password"], input[type="password"]', password)
        page.get_by_role("button", name="Continue", exact=True).click()

        page.wait_for_url("**/email-verification*", timeout=30000)
        otp = poll_otp(account_id, db_id, args.alias, started_ms,
                       timeout_s=args.otp_timeout)
        page.fill('input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"]', otp)
        page.get_by_role("button", name="Continue", exact=True).click()

        page.wait_for_url("**/about-you*", timeout=30000)
        page.fill('input[name="name"], input[placeholder*="name" i]', args.full_name)
        page.fill('input[name="age"], input[placeholder*="age" i]', str(args.age))
        page.get_by_role("button", name="Finish creating account").click()

        try:
            page.wait_for_url("**/chatgpt.com/**", timeout=30000)
        except PWTimeout:
            pass

        for label in ["Skip", "Skip Tour", "Skip tour", "Continue",
                      "Okay, let's go", "Okay, let\u2019s go"]:
            try:
                page.get_by_role("button", name=label).click(timeout=1500)
            except Exception:
                pass

        try:
            if "chatgpt.com" not in (page.url or ""):
                page.goto("https://chatgpt.com/", wait_until="domcontentloaded")
        except Exception:
            pass
        page.wait_for_timeout(800)

        cookies = export_cookies(context)
        elapsed = time.time() - t0
        print(f"[timing] signup completed in {elapsed:.1f}s")

        try:
            browser.close()
        except Exception:
            pass

        return {
            "email": email,
            "password": password,
            "full_name": args.full_name,
            "age": args.age,
            "elapsed_seconds": round(elapsed, 1),
            "cookies": cookies,
        }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    p = argparse.ArgumentParser(description="Auto-signup ChatGPT (GitHub Actions runner)")
    p.add_argument("--mode", choices=["pretty", "short", "random"], default="pretty")
    p.add_argument("--alias", default=None)
    p.add_argument("--password", default=None)
    p.add_argument("--full-name", default=None)
    p.add_argument("--age", type=int, default=25)
    p.add_argument("--otp-timeout", type=int, default=180)
    p.add_argument("--fast", dest="fast", action="store_true", default=True)
    p.add_argument("--no-fast", dest="fast", action="store_false")
    p.add_argument("--out-dir", default="./out", help="Where to write the cookies file")
    args = p.parse_args()

    account_id = os.environ.get("CF_ACCOUNT_ID", DEFAULT_CF_ACCOUNT)
    db_id = os.environ.get("D1_DATABASE_ID", DEFAULT_D1_DB)
    domain = os.environ.get("DOMAIN", DEFAULT_DOMAIN)

    if not args.alias:
        args.alias = gen_alias(args.mode)
    if not args.full_name:
        args.full_name = alias_to_full_name(args.alias)
    if not args.password:
        args.password = gen_password()

    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("OWNER_CHAT_ID", "")

    missing = [n for n in ("CLOUDFLARE_GLOBAL_API", "CLOUDFLARE_EMAIL")
               if not os.environ.get(n)]
    if missing:
        print(f"ERROR: missing env vars: {missing}", file=sys.stderr)
        return 2

    telegram_send(bot_token, chat_id,
                  f"\u23f3 Membuat akun ChatGPT...\nEmail: <code>{args.alias}@{domain}</code>")

    try:
        result = signup(args, account_id, db_id, domain)
    except Exception as e:
        # Telegram sendMessage uses parse_mode=HTML; escape the exception text
        # so messages like "<Locator selector=...>" don't break the parser.
        escaped = (str(e).replace("&", "&amp;")
                   .replace("<", "&lt;").replace(">", "&gt;"))
        msg = f"\u274c Signup gagal: <code>{type(e).__name__}: {escaped}</code>"
        print(f"Signup gagal: {type(e).__name__}: {e}", file=sys.stderr)
        telegram_send(bot_token, chat_id, msg)
        return 1

    cookies = result.pop("cookies")
    os.makedirs(args.out_dir, exist_ok=True)
    cookies_path = os.path.join(args.out_dir, f"{args.alias}-cookies.json")
    with open(cookies_path, "w") as f:
        json.dump(cookies, f, indent=2)

    # Persist + render rolling 30-day account list.
    try:
        record_account(account_id, db_id, result)
        accounts_path = os.path.join(args.out_dir, "akun.txt")
        write_accounts_file(account_id, db_id, accounts_path)
    except Exception as e:
        print(f"[accounts] failed to persist/render: {e}", file=sys.stderr)
        accounts_path = None

    summary = (
        "\u2705 <b>Akun ChatGPT berhasil dibuat</b>\n"
        f"\nEmail: <code>{result['email']}</code>"
        f"\nPassword: <code>{result['password']}</code>"
        f"\nNama: {result['full_name']}"
        f"\nAge: {result['age']}"
        f"\nDurasi: {result['elapsed_seconds']}s"
        f"\nCookies: {len(cookies)} ({cookies_path.split('/')[-1]})"
        f"\n\nLogin di https://chatgpt.com/ atau import cookies via "
        "Cookie-Editor (Firefox Android)."
    )
    telegram_send(bot_token, chat_id, summary)
    telegram_send_document(
        bot_token, chat_id, cookies_path,
        caption=f"Cookies untuk {result['email']} (Cookie-Editor JSON)",
    )
    if accounts_path and os.path.isfile(accounts_path):
        telegram_send_document(
            bot_token, chat_id, accounts_path,
            caption="Akun ChatGPT (30 hari terakhir)",
        )

    print(json.dumps({**result, "cookies_file": cookies_path,
                      "cookies_count": len(cookies)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
