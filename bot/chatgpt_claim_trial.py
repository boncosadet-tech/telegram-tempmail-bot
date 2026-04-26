#!/usr/bin/env python3
"""
Claim the IDR-pricing GoPay free trial for an existing ChatGPT account
inside GitHub Actions. Companion to ``bot/chatgpt_signup.py``.

Flow (16 UI steps; tested manually 2026-04-26 on real Indonesian accounts):

  1. Launch headed Chromium under Xvfb.
  2. Login to chatgpt.com with email + password (looked up from D1
     ``chatgpt_accounts`` if not supplied via CLI).
  3. Click "Claim offer" sidebar → opens promo pricing modal.
  4. Click "Personal" toggle → Plus card visible.
  5. Open country picker, pick Indonesia → pricing flips to Rp.
  6. Click "Claim free offer" on Plus card → /checkout/openai_llc/cs_live_*.
  7. Fill Stripe Address Element (Full name, Country, Address, City,
     Province, Postal) inside ``elements-inner-address-*`` iframe.
  8. Click Subscribe → app.midtrans.com/snap/v4/redirection/.../linking.
  9. Type +62 phone, click "Link and pay".
 10. Wait for GoPay iframe, click "Hubungkan".
 11. Wait for WhatsApp OTP page; poll the worker relay endpoint
     (``GET <otp-url>?token=<otp-token>``) every 2s for the user-supplied
     code (delivered via Telegram ``/otp 123456``).
 12. Type OTP (auto-submits at 6 chars).
 13. PIN page #1 ("Silakan ketik 6 digit PIN"). Type PIN.
 14. Wait for ``#/gopay-tokenization/pay``, click "Pay now".
 15. Click "Bayar Rp 1" inside GoPay iframe.
 16. PIN page #2 ("Masukkin PIN GoPay"). Type PIN again.
 17. Wait for ``chatgpt.com/payments/success?...&plan_type=plus``.

Exit codes:
  0  trial claimed successfully
  1  fatal error (login failed, OTP timeout, payment refused, …)
  2  account not eligible for the free trial promo (skipped cleanly)

Required env vars (read by ``bot.chatgpt_signup`` helpers as well):
  CLOUDFLARE_GLOBAL_API, CLOUDFLARE_EMAIL — D1 access
  TELEGRAM_BOT_TOKEN, OWNER_CHAT_ID       — progress reporting
  CF_ACCOUNT_ID (default: hard-coded), D1_DATABASE_ID (default: hard-coded)

CLI:
  --email <addr>          target ChatGPT account
  --password <pwd>        password (else looked up from D1)
  --full-name <name>      billing full name (else derived from email local)
  --phone <digits>        +62 phone without leading 0/+62 (e.g. 85951756709)
  --pin <digits>          6-digit GoPay PIN
  --otp-url <url>         worker relay endpoint
  --otp-token <token>     bearer token for the relay endpoint
  --otp-timeout <int>     seconds to wait for OTP (default 300)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

from patchright.sync_api import (
    FrameLocator,
    Page,
    TimeoutError as PWTimeout,
    sync_playwright,
)

# Reuse helpers from the signup script to avoid duplication. They share the
# CI runner so the import works at runtime.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chatgpt_signup import (  # noqa: E402  (sibling import after path tweak)
    DEFAULT_CF_ACCOUNT,
    DEFAULT_D1_DB,
    DEFAULT_DOMAIN,
    cf_turnstile_clickbox,
    d1_query_params,
    ensure_accounts_table,
    http_request,
    telegram_send,
)

DEFAULT_PROVINCE = "DKI"  # typeahead match for "DKI Jakarta — Jakarta"
DEFAULT_ADDRESS = "Jl. Sudirman Kav. 1"
DEFAULT_CITY = "Jakarta"
DEFAULT_POSTAL = "10220"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# D1 lookup
# ---------------------------------------------------------------------------


def lookup_account_password(account_id: str, db_id: str, email: str) -> str:
    """Read the stored password for ``email`` from chatgpt_accounts."""
    ensure_accounts_table(account_id, db_id)
    sql = "SELECT password FROM chatgpt_accounts WHERE email = ? LIMIT 1"
    res = d1_query_params(account_id, db_id, sql, [email])
    rows = (res.get("result") or [{}])[0].get("results") or []
    if not rows:
        raise RuntimeError(f"account not found in D1: {email}")
    pw = rows[0].get("password") or ""
    if not pw:
        raise RuntimeError(f"empty password for {email} in D1")
    return pw


def derive_full_name_from_email(email: str) -> str:
    local = email.split("@", 1)[0]
    cleaned = local.replace(".", " ").replace("-", " ").replace("_", " ")
    parts = ["".join(c for c in w if c.isalpha()) for w in cleaned.split()]
    parts = [w for w in parts if w]
    if not parts:
        return "User"
    return " ".join(w.capitalize() for w in parts[:2])


# ---------------------------------------------------------------------------
# OTP relay client
# ---------------------------------------------------------------------------


class OtpTimeout(RuntimeError):
    pass


def poll_otp_url(otp_url: str, otp_token: str, timeout_s: int = 300,
                 interval_s: float = 2.0) -> str:
    """Poll ``GET otp_url?token=otp_token`` until it returns 200 with a code.

    Returns the OTP digits. Raises ``OtpTimeout`` after ``timeout_s`` seconds.
    """
    if not otp_url:
        raise RuntimeError("--otp-url required")
    if not otp_token:
        raise RuntimeError("--otp-token required")
    sep = "&" if "?" in otp_url else "?"
    url = f"{otp_url}{sep}token={urllib.parse.quote(otp_token, safe='')}"
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            status, payload = http_request("GET", url, {"User-Agent": "claim-trial"})
            if status == 200:
                data = json.loads(payload)
                code = str(data.get("code") or "").strip()
                if code.isdigit() and 4 <= len(code) <= 8:
                    log(f"OTP received via relay: {'*' * (len(code) - 2)}{code[-2:]}")
                    return code
            elif status not in (404, 401):
                log(f"otp relay HTTP {status}: {payload[:120]!r}")
        except Exception as e:
            log(f"otp relay error: {e}")
        time.sleep(interval_s)
    raise OtpTimeout(f"OTP not received within {timeout_s}s")


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------


def chatgpt_login(page: Page, email: str, password: str) -> None:
    log(f"logging in as {email}")
    page.goto("https://chatgpt.com/auth/login", wait_until="domcontentloaded")
    # First "Log in" button on landing page (some accounts skip straight to
    # the Auth0 form; both cases are handled).
    try:
        page.get_by_role("button", name="Log in").first.click(timeout=8000)
    except PWTimeout:
        pass
    cf_turnstile_clickbox(page, timeout_ms=8000)

    email_input = page.locator('input[type="email"], input[name="email"]').first
    email_input.wait_for(state="visible", timeout=30000)
    email_input.fill(email)
    page.get_by_role("button", name="Continue").first.click(timeout=10000)

    pw_input = page.locator('input[type="password"], input[name="password"]').first
    pw_input.wait_for(state="visible", timeout=30000)
    pw_input.fill(password)
    page.get_by_role("button", name="Continue").first.click(timeout=10000)

    # Land on chatgpt.com (post-login).
    page.wait_for_url("**/chatgpt.com/**", timeout=60000)
    page.wait_for_load_state("domcontentloaded")
    log("login complete")


# ---------------------------------------------------------------------------
# Pricing modal (same as the manual script)
# ---------------------------------------------------------------------------


class NoPromoOffer(RuntimeError):
    """Raised when the account does not qualify for the free trial promo."""


def open_pricing_modal(page: Page) -> None:
    log("opening pricing modal")
    if "chatgpt.com" not in page.url:
        page.goto("https://chatgpt.com/")
    page.wait_for_load_state("domcontentloaded")
    try:
        page.get_by_role("button", name="Claim offer").first.click(timeout=4000)
    except PWTimeout:
        try:
            page.get_by_role("button", name="Free offer").first.click(timeout=4000)
        except PWTimeout:
            page.goto("https://chatgpt.com/?promo_campaign=team-1-month-free#pricing")
    try:
        page.wait_for_selector(
            'text=/Try (Plus|Business) free for 1 month/', timeout=8000
        )
    except PWTimeout:
        if (
            page.locator('h2:has-text("Upgrade your plan")').count() > 0
            or page.locator('button:has-text("Upgrade to Plus")').count() > 0
        ):
            raise NoPromoOffer(
                "Account is not eligible for the free trial promo "
                "(saw regular 'Upgrade your plan' modal)."
            )
        page.wait_for_selector(
            'text=/Try (Plus|Business) free for 1 month/', timeout=8000
        )
    log(f"pricing modal open at {page.url}")


def switch_to_personal(page: Page) -> None:
    log("switching pricing to Personal tab (Plus card)")
    btn = page.locator('button[aria-label="Toggle for switching to Personal plans"]').first
    try:
        btn.click(timeout=4000)
    except PWTimeout:
        log("personal toggle click failed (probably already active)")
    page.wait_for_selector('button:has-text("Claim free offer")', timeout=10000)


def pick_indonesia_country(page: Page) -> None:
    log("opening country picker; selecting Indonesia")
    page.evaluate(
        """() => {
        for (const el of document.querySelectorAll('*')) {
            const cs = getComputedStyle(el);
            if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll')
                && el.scrollHeight > el.clientHeight) {
                el.scrollTop = el.scrollHeight;
            }
        }
    }"""
    )
    page.wait_for_timeout(400)
    trigger = page.locator(
        'button[aria-expanded]:has-text("United States")'
    ).first
    if trigger.count() == 0:
        log("country trigger not found (already Indonesia?)")
        return
    trigger.scroll_into_view_if_needed()
    trigger.click(timeout=5000)
    page.wait_for_timeout(400)
    clicked = page.evaluate(
        """async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const firstOpt = document.querySelector('[aria-selected="false"]');
        if (!firstOpt) return 'no_options';
        let inner = firstOpt.parentElement;
        while (inner) {
            const cs = getComputedStyle(inner);
            if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll'
                 || cs.overflowY === 'overlay')
                && inner.scrollHeight > inner.clientHeight + 1) break;
            inner = inner.parentElement;
        }
        if (!inner) return 'no_inner';
        inner.scrollTop = 0;
        for (let i = 0; i < 80; i++) {
            for (const o of document.querySelectorAll('[aria-selected]')) {
                if (o.textContent.trim() === 'Indonesia') {
                    o.scrollIntoView({block: 'center'});
                    await sleep(80);
                    o.click();
                    return 'ok';
                }
            }
            inner.scrollTop += Math.max(120, inner.clientHeight - 40);
            await sleep(40);
            if (inner.scrollTop + inner.clientHeight >= inner.scrollHeight - 1) {
                for (const o of document.querySelectorAll('[aria-selected]')) {
                    if (o.textContent.trim() === 'Indonesia') {
                        o.scrollIntoView({block: 'center'});
                        await sleep(80);
                        o.click();
                        return 'ok';
                    }
                }
                return 'not_found';
            }
        }
        return 'timeout';
    }"""
    )
    if clicked != "ok":
        raise RuntimeError(f"Indonesia option not found in country dropdown ({clicked})")
    page.wait_for_timeout(2000)
    body = page.evaluate("() => document.body.innerText")
    if "IDR" not in body and "Rp" not in body:
        raise RuntimeError("pricing did not switch to IDR")
    log("pricing switched to IDR")


def claim_free_offer(page: Page) -> None:
    log("clicking 'Claim free offer' on Plus card")
    page.locator('button:has-text("Claim free offer")').first.click(timeout=10000)
    page.wait_for_url("**/checkout/openai_llc/cs_live_*", timeout=45000)
    log(f"checkout open: {page.url[:100]}…")


# ---------------------------------------------------------------------------
# Stripe billing form
# ---------------------------------------------------------------------------


def stripe_address_frame(page: Page) -> FrameLocator:
    return page.frame_locator('iframe[src*="elements-inner-address"]').first


def _addr_input(addr: FrameLocator, *names: str):
    selectors = []
    for n in names:
        selectors += [
            f'input[name="{n}"]',
            f'input[id="Field-{n}Input"]',
            f'input[id$="-{n}"]',
        ]
    return addr.locator(", ".join(selectors)).first


def _addr_select(addr: FrameLocator, *names: str):
    selectors = []
    for n in names:
        selectors += [
            f'select[name="{n}"]',
            f'select[id="Field-{n}Input"]',
            f'select[id$="-{n}"]',
        ]
    return addr.locator(", ".join(selectors)).first


def fill_billing(page: Page, full_name: str, address: str,
                 city: str, province: str, postal: str) -> None:
    log("filling Stripe billing form")
    addr = stripe_address_frame(page)
    name_input = _addr_input(addr, "name")
    name_input.wait_for(state="visible", timeout=20000)

    country_select = _addr_select(addr, "country")
    country_select.select_option(label="Indonesia")
    page.wait_for_timeout(500)

    name_input.fill(full_name)
    _addr_input(addr, "line1", "addressLine1").fill(address)
    _addr_input(addr, "city", "locality").fill(city)

    province_select = _addr_select(addr, "state", "administrativeArea")
    province_select.wait_for(state="visible", timeout=5000)
    options = province_select.locator("option").all_text_contents()
    target = next((o for o in options if province.lower() in o.lower()), None)
    if target is None:
        raise RuntimeError(f"province '{province}' not found among {options[:5]}…")
    province_select.select_option(label=target)

    _addr_input(addr, "postal_code", "postalCode").fill(postal)
    page.wait_for_timeout(500)
    log("billing form filled")


def submit_subscribe(page: Page) -> None:
    log("clicking Subscribe → Midtrans GoPay redirect")
    page.locator('button[aria-label="Subscribe"]').first.click(timeout=10000)
    page.wait_for_url("https://app.midtrans.com/snap/**", timeout=60000)
    log(f"on Midtrans: {page.url[:120]}…")


# ---------------------------------------------------------------------------
# Midtrans / GoPay
# ---------------------------------------------------------------------------


GOPAY_IFRAME_SELECTORS = (
    'iframe[src*="gopay"]',
    'iframe[src*="gtflabs"]',
    'iframe[src*="gojek"]',
    'iframe[src*="midtrans"]',
)


def _find_gopay_frame(page: Page) -> FrameLocator | None:
    for sel in GOPAY_IFRAME_SELECTORS:
        if page.locator(sel).count() > 0:
            return page.frame_locator(sel).first
    return None


def midtrans_link_phone(page: Page, phone: str) -> None:
    log(f"entering GoPay phone +62 {phone}")
    page.wait_for_url("**/gopay-tokenization/linking", timeout=30000)
    inp = page.locator('input[type="tel"]').first
    inp.wait_for(state="visible", timeout=15000)
    inp.click()
    inp.fill("")
    inp.type(phone, delay=40)
    page.wait_for_timeout(400)
    page.get_by_role("button", name="Link and pay").first.click(timeout=10000)
    log("clicked Link and pay")


def midtrans_confirm_hubungkan(page: Page) -> None:
    log("waiting for GoPay 'Hubungkan' confirmation iframe")
    for _ in range(30):
        for sel in GOPAY_IFRAME_SELECTORS:
            if page.locator(sel).count() == 0:
                continue
            fl = page.frame_locator(sel).first
            btn = fl.locator('button:has-text("Hubungkan")').first
            try:
                btn.wait_for(state="visible", timeout=2000)
                btn.click()
                log("clicked Hubungkan")
                return
            except PWTimeout:
                continue
        page.wait_for_timeout(500)
    log("Hubungkan iframe not found; falling back to coord click")
    page.mouse.click(512, 555)


def midtrans_enter_otp(page: Page, otp: str) -> None:
    log("entering WhatsApp OTP")
    fl = _find_gopay_frame(page)
    if fl is None:
        raise RuntimeError("GoPay iframe not found for OTP step")
    fl.locator(
        'text=/Masukkin OTP|Enter OTP|Masukkan kode OTP|OTP yang dikirim/'
    ).first.wait_for(state="visible", timeout=30000)
    inp = fl.locator('input').first
    inp.click()
    inp.type(otp, delay=80)
    log("OTP submitted")


def midtrans_enter_pin(page: Page, pin: str, label: str) -> None:
    log(f"entering GoPay PIN ({label})")
    fl = _find_gopay_frame(page)
    if fl is None:
        raise RuntimeError("GoPay iframe not found for PIN step")
    fl.locator(
        'text=/PIN kamu|PIN GoPay|6 digit PIN|Masukkin PIN/'
    ).first.wait_for(state="visible", timeout=30000)
    inp = fl.locator('input').first
    inp.click()
    inp.type(pin, delay=80)
    log(f"PIN ({label}) submitted")


def midtrans_pay_now(page: Page) -> None:
    log("clicking Pay now")
    page.wait_for_url("**/gopay-tokenization/pay", timeout=30000)
    page.get_by_role("button", name="Pay now").first.click(timeout=10000)


def midtrans_confirm_bayar(page: Page) -> None:
    log("confirming GoPay 'Bayar' inside iframe")
    fl = None
    for _ in range(30):
        fl = _find_gopay_frame(page)
        if fl is not None:
            break
        page.wait_for_timeout(500)
    if fl is None:
        raise RuntimeError("GoPay iframe not found for Bayar step")
    btn = fl.locator('button:has-text("Bayar")').first
    btn.wait_for(state="visible", timeout=20000)
    btn.click()
    log("clicked Bayar")


def wait_for_success(page: Page) -> None:
    log("waiting for ChatGPT payments/success redirect")
    page.wait_for_url("**/payments/success**", timeout=60000)
    log(f"SUCCESS — {page.url[:120]}…")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def claim_trial(page: Page, email: str, password: str, full_name: str,
                phone: str, pin: str, otp_url: str, otp_token: str,
                otp_timeout: int, address: str, city: str, province: str,
                postal: str, bot_token: str, chat_id: str) -> None:
    chatgpt_login(page, email, password)
    open_pricing_modal(page)
    switch_to_personal(page)
    pick_indonesia_country(page)
    claim_free_offer(page)
    fill_billing(page, full_name, address, city, province, postal)
    submit_subscribe(page)
    midtrans_link_phone(page, phone)
    midtrans_confirm_hubungkan(page)

    telegram_send(
        bot_token,
        chat_id,
        (
            f"📲 OTP WhatsApp dibutuhkan untuk <code>{email}</code>.\n"
            "Kirim balik dengan: /otp 123456 (5 menit)."
        ),
    )
    otp = poll_otp_url(otp_url, otp_token, timeout_s=otp_timeout)
    midtrans_enter_otp(page, otp)

    midtrans_enter_pin(page, pin, "linking")
    midtrans_pay_now(page)
    midtrans_confirm_bayar(page)
    midtrans_enter_pin(page, pin, "payment")
    wait_for_success(page)


def main() -> int:
    p = argparse.ArgumentParser(description="Claim ChatGPT free trial via GoPay")
    p.add_argument("--email", required=True)
    p.add_argument("--password", default="")
    p.add_argument("--full-name", default="")
    p.add_argument("--phone", required=True)
    p.add_argument("--pin", required=True)
    p.add_argument("--otp-url", required=True)
    p.add_argument("--otp-token", required=True)
    p.add_argument("--otp-timeout", type=int, default=300)
    p.add_argument("--address", default=DEFAULT_ADDRESS)
    p.add_argument("--city", default=DEFAULT_CITY)
    p.add_argument("--province", default=DEFAULT_PROVINCE)
    p.add_argument("--postal-code", default=DEFAULT_POSTAL)
    args = p.parse_args()

    account_id = os.environ.get("CF_ACCOUNT_ID", DEFAULT_CF_ACCOUNT)
    db_id = os.environ.get("D1_DATABASE_ID", DEFAULT_D1_DB)
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("OWNER_CHAT_ID", "")

    missing = [n for n in ("CLOUDFLARE_GLOBAL_API", "CLOUDFLARE_EMAIL")
               if not os.environ.get(n)]
    if missing:
        print(f"ERROR: missing env vars: {missing}", file=sys.stderr)
        return 2

    email = args.email.strip().lower()

    password = args.password
    if not password:
        try:
            password = lookup_account_password(account_id, db_id, email)
        except Exception as e:
            msg = f"❌ Password tidak ditemukan untuk <code>{email}</code>: {e}"
            telegram_send(bot_token, chat_id, msg)
            print(msg, file=sys.stderr)
            return 1

    full_name = args.full_name or derive_full_name_from_email(email)
    telegram_send(
        bot_token,
        chat_id,
        f"⏳ Claim trial dimulai untuk <code>{email}</code>",
    )

    t0 = time.time()
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )
        page = context.new_page()
        try:
            claim_trial(
                page,
                email=email,
                password=password,
                full_name=full_name,
                phone=args.phone,
                pin=args.pin,
                otp_url=args.otp_url,
                otp_token=args.otp_token,
                otp_timeout=args.otp_timeout,
                address=args.address,
                city=args.city,
                province=args.province,
                postal=args.postal_code,
                bot_token=bot_token,
                chat_id=chat_id,
            )
        except NoPromoOffer as e:
            elapsed = round(time.time() - t0, 1)
            log(f"SKIP: {e}")
            telegram_send(
                bot_token,
                chat_id,
                f"⏭️ <b>Skipped</b>: <code>{email}</code> tidak punya free offer "
                f"(modal 'Upgrade your plan' reguler). Durasi: {elapsed}s",
            )
            return 2
        except OtpTimeout as e:
            elapsed = round(time.time() - t0, 1)
            log(f"FAILED: {e}")
            telegram_send(
                bot_token,
                chat_id,
                f"❌ <b>OTP timeout</b> untuk <code>{email}</code> setelah "
                f"{args.otp_timeout}s. Run /claim lagi atau cek WhatsApp.",
            )
            return 1
        except Exception as e:
            elapsed = round(time.time() - t0, 1)
            escaped = (str(e).replace("&", "&amp;")
                       .replace("<", "&lt;").replace(">", "&gt;"))
            log(f"FAILED: {type(e).__name__}: {e}")
            telegram_send(
                bot_token,
                chat_id,
                (
                    f"❌ <b>Claim gagal</b> untuk <code>{email}</code>\n"
                    f"<code>{type(e).__name__}: {escaped}</code>\n"
                    f"Durasi: {elapsed}s"
                ),
            )
            return 1
        finally:
            try:
                browser.close()
            except Exception:
                pass

    elapsed = round(time.time() - t0, 1)
    telegram_send(
        bot_token,
        chat_id,
        (
            f"✅ <b>Plus aktif</b>: <code>{email}</code>\n"
            f"Charge: Rp 1 (verification)\n"
            f"Durasi: {elapsed}s"
        ),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
