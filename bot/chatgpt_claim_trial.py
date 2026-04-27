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
import contextlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections.abc import Iterator

from patchright.sync_api import (
    Error as PWError,
    FrameLocator,
    Locator,
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
    cf_turnstile_clickbox,
    d1_query_params,
    ensure_accounts_table,
    http_request,
    telegram_send,
)

EMAIL_SELECTOR = (
    'input[type="email"], input[name="email"], '
    'input[name="username"], input[autocomplete="username"]'
)
PASSWORD_SELECTOR = (
    'input[type="password"], input[name="password"], '
    'input[autocomplete="current-password"]'
)

DEFAULT_PROVINCE = "DKI"  # typeahead match for "DKI Jakarta — Jakarta"
DEFAULT_ADDRESS = "Jl. Sudirman Kav. 1"
DEFAULT_CITY = "Jakarta"
DEFAULT_POSTAL = "10220"

# ---------------------------------------------------------------------------
# Timeouts (ms unless noted) — centralised for easy tuning
# ---------------------------------------------------------------------------
LOGIN_PAGE_TOTAL_MS = 60_000
EMAIL_INPUT_TIMEOUT_MS = 45_000
POST_LOGIN_NAV_TIMEOUT_MS = 60_000
CONTINUE_BUTTON_TIMEOUT_MS = 10_000
TURNSTILE_DEFAULT_TIMEOUT_MS = 6_000
TURNSTILE_LOGIN_TIMEOUT_MS = 8_000
TURNSTILE_LANDING_TIMEOUT_MS = 4_000
LOGIN_ENTRY_PROBE_TIMEOUT_MS = 1_500
LOGIN_ENTRY_CLICK_TIMEOUT_MS = 4_000

ONBOARDING_DIALOG_PROBE_MS = 5_000
ONBOARDING_CLICK_TIMEOUT_MS = 4_000
# chatgpt.com's interest-picker has up to 3 pages on a fresh account
# (onboarding_interest_picker_max_depth). Loop budget = 5 to be safe.
ONBOARDING_MAX_STEPS = 5

PRICING_MODAL_TIMEOUT_MS = 8_000
PRICING_MODAL_CLICK_TIMEOUT_MS = 4_000
PERSONAL_TOGGLE_CLICK_TIMEOUT_MS = 4_000
CLAIM_FREE_OFFER_TIMEOUT_MS = 10_000
CLAIM_FREE_OFFER_NAV_TIMEOUT_MS = 45_000
COUNTRY_TRIGGER_TIMEOUT_MS = 5_000
COUNTRY_PRICING_SETTLE_MS = 2_000

STRIPE_NAME_INPUT_TIMEOUT_MS = 20_000
STRIPE_PROVINCE_TIMEOUT_MS = 5_000
STRIPE_SUBSCRIBE_CLICK_TIMEOUT_MS = 10_000
MIDTRANS_NAV_TIMEOUT_MS = 60_000

GOPAY_LINKING_NAV_TIMEOUT_MS = 30_000
GOPAY_PHONE_INPUT_TIMEOUT_MS = 15_000
GOPAY_LINK_PAY_TIMEOUT_MS = 10_000
GOPAY_HUBUNGKAN_PROBE_TIMEOUT_MS = 2_000
GOPAY_OTP_PROMPT_TIMEOUT_MS = 30_000
GOPAY_PIN_PROMPT_TIMEOUT_MS = 30_000
GOPAY_PAY_NAV_TIMEOUT_MS = 30_000
GOPAY_PAY_CLICK_TIMEOUT_MS = 10_000
GOPAY_BAYAR_TIMEOUT_MS = 20_000
SUCCESS_REDIRECT_TIMEOUT_MS = 60_000

# Iframe-discovery polling: 30 attempts × 500 ms = 15 s effective.
IFRAME_POLL_ITERATIONS = 30
IFRAME_POLL_INTERVAL_MS = 500

DEFAULT_TYPE_DELAY_MS = 80
PHONE_TYPE_DELAY_MS = 40

# Where per-step failure artifacts (PNG screenshot + HTML snapshot + .txt
# context) are written. Honours the env var so the workflow can override.
DEBUG_ARTIFACTS_DIR = os.environ.get("DEBUG_ARTIFACTS_DIR", "debug-artifacts")
FAILURE_SCREENSHOT_TIMEOUT_MS = 10_000

# Login entry-point fallbacks (probed in order on the chatgpt.com landing
# page). Both the wait-for-loaded helper and the click helper share this
# list so they stay in sync.
LOGIN_ENTRY_ROLES: tuple[tuple[str, str], ...] = (
    ("button", "Log in"),
    ("link", "Log in"),
    ("button", "Sign in"),
    ("link", "Sign in"),
)


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _mask_secret(s: str) -> str:
    """Mask all but the last 2 chars of an OTP/PIN-like secret for logging."""
    if not s:
        return ""
    if len(s) <= 2:
        return "*" * len(s)
    return "*" * (len(s) - 2) + s[-2:]


def _escape_html(text: str) -> str:
    """Escape ``<``/``>``/``&`` for safe inclusion in Telegram HTML messages."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _press_text(loc: Locator, text: str, delay: int = DEFAULT_TYPE_DELAY_MS) -> None:
    """Type ``text`` into ``loc`` one keypress at a time.

    Prefers ``Locator.press_sequentially`` (Playwright >= 1.38) and falls
    back to the deprecated ``Locator.type`` if the runtime is older. The
    delay between keystrokes mimics human typing — many of the GoPay /
    Midtrans inputs auto-submit on full input and dislike paste-style fills.
    """
    press_seq = getattr(loc, "press_sequentially", None)
    if callable(press_seq):
        press_seq(text, delay=delay)
    else:  # pragma: no cover — defensive fallback for older patchright
        loc.type(text, delay=delay)


def _capture_failure(
    page: Page | None,
    step: str,
    exc: BaseException,
    out_dir: str = DEBUG_ARTIFACTS_DIR,
) -> list[str]:
    """Persist a debug bundle for a failed claim step.

    Writes up to three files into ``out_dir`` (created on demand):

    - ``<HHMMSS>_<step>.txt`` — step name, exception, current URL/title.
    - ``<HHMMSS>_<step>.png`` — full-page screenshot at moment of failure.
    - ``<HHMMSS>_<step>.html`` — rendered HTML snapshot (selector debug).

    The PNG and HTML are best-effort: if the page is already closed or the
    screenshot itself times out, we still emit the .txt so the artifact
    bundle is never empty. Returns the list of paths actually written.
    """
    try:
        os.makedirs(out_dir, exist_ok=True)
    except OSError as e:
        log(f"failure capture: cannot mkdir {out_dir}: {e}")
        return []

    safe_step = re.sub(r"[^a-zA-Z0-9_-]+", "_", step)[:40] or "unknown"
    base = f"{time.strftime('%H%M%S')}_{safe_step}"
    paths: list[str] = []

    info_lines = [
        f"step: {step}",
        f"exception: {type(exc).__name__}: {exc}",
        f"timestamp: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
    ]
    if page is not None:
        try:
            info_lines.append(f"url: {page.url}")
        except Exception as e:
            info_lines.append(f"url: <unreadable: {e}>")
        try:
            info_lines.append(f"title: {page.title()}")
        except Exception as e:
            info_lines.append(f"title: <unreadable: {e}>")
    info_path = os.path.join(out_dir, f"{base}.txt")
    try:
        with open(info_path, "w", encoding="utf-8") as f:
            f.write("\n".join(info_lines) + "\n")
        paths.append(info_path)
    except OSError as e:
        log(f"failure capture: cannot write {info_path}: {e}")

    if page is None:
        return paths

    png_path = os.path.join(out_dir, f"{base}.png")
    try:
        page.screenshot(
            path=png_path,
            full_page=True,
            timeout=FAILURE_SCREENSHOT_TIMEOUT_MS,
        )
        paths.append(png_path)
    except (PWError, PWTimeout, OSError) as e:
        log(f"failure capture: screenshot failed: {e}")

    html_path = os.path.join(out_dir, f"{base}.html")
    try:
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(page.content())
        paths.append(html_path)
    except (PWError, PWTimeout, OSError) as e:
        log(f"failure capture: html dump failed: {e}")

    log(f"captured failure artifacts ({len(paths)}): " + ", ".join(
        os.path.basename(p) for p in paths
    ))
    return paths


@contextlib.contextmanager
def _step(
    name: str,
    page: Page | None,
    out_dir: str = DEBUG_ARTIFACTS_DIR,
) -> Iterator[None]:
    """Wrap one logical claim step. On exception, capture a debug bundle
    via :func:`_capture_failure` then re-raise unchanged."""
    log(f"▶ step: {name}")
    try:
        yield
    except BaseException as exc:
        if not isinstance(exc, KeyboardInterrupt):
            _capture_failure(page, name, exc, out_dir)
        raise


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
    """Best-effort billing full-name from the local-part of an email.

    Splits on common separators (``.``, ``-``, ``_``, ``+``) so Gmail-style
    aliases like ``john.doe+chatgpt@…`` collapse cleanly to ``John Doe``.
    """
    local = email.split("@", 1)[0]
    raw_parts = re.split(r"[._\-+]+", local)
    parts = ["".join(c for c in w if c.isalpha()) for w in raw_parts]
    parts = [w for w in parts if w]
    if not parts:
        return "User"
    return " ".join(w.capitalize() for w in parts[:2])


# ---------------------------------------------------------------------------
# OTP relay client
# ---------------------------------------------------------------------------


class OtpTimeout(RuntimeError):
    pass


def _otp_relay_request(otp_url: str, otp_token: str) -> tuple[int, str]:
    """One-shot GET to the relay endpoint. Returns (status, payload)."""
    if not otp_url:
        raise RuntimeError("--otp-url required")
    if not otp_token:
        raise RuntimeError("--otp-token required")
    sep = "&" if "?" in otp_url else "?"
    url = f"{otp_url}{sep}token={urllib.parse.quote(otp_token, safe='')}"
    return http_request("GET", url, {"User-Agent": "claim-trial"})


def drain_pending_otp(otp_url: str, otp_token: str) -> str:
    """Consume + discard any OTP currently stashed in KV from a previous run.

    Without this, a stale `/otp` the user sent before the current claim run
    started would be picked up immediately by ``poll_otp_url`` and typed
    into Midtrans, where it would be rejected as invalid. Always call this
    just before signaling the user that a fresh OTP is needed.

    Returns the drained code (for logging) or empty string if nothing was
    pending. Errors are swallowed — drain is best-effort.
    """
    try:
        status, payload = _otp_relay_request(otp_url, otp_token)
    except Exception as e:
        log(f"otp drain error (non-fatal): {e}")
        return ""
    if status != 200:
        return ""
    try:
        code = str(json.loads(payload).get("code") or "").strip()
    except Exception:
        return ""
    if code:
        log(f"drained stale OTP from previous run: {_mask_secret(code)}")
    return code


def poll_otp_url(otp_url: str, otp_token: str, timeout_s: int = 300,
                 interval_s: float = 2.0) -> str:
    """Poll ``GET otp_url?token=otp_token`` until it returns 200 with a code.

    Returns the OTP digits. Raises ``OtpTimeout`` after ``timeout_s`` seconds.

    Caller is expected to call ``drain_pending_otp`` first so that a stale
    code from a previous run does not get returned immediately.
    """
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            status, payload = _otp_relay_request(otp_url, otp_token)
            if status == 200:
                data = json.loads(payload)
                code = str(data.get("code") or "").strip()
                if code.isdigit() and 4 <= len(code) <= 8:
                    log(f"OTP received via relay: {_mask_secret(code)}")
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


def _wait_for_email_or_login_button(
    page: Page, total_ms: int = LOGIN_PAGE_TOTAL_MS
) -> str:
    """Drive the chatgpt.com landing page until either the email input is
    visible (auth0 form already loaded) or the "Log in" button is clickable
    (we still need to navigate). Cloudflare turnstile is auto-clicked when
    it appears. Returns "email" or "login" indicating which we found.
    """
    deadline = time.time() + total_ms / 1000
    while time.time() < deadline:
        # Auto-clear any Turnstile challenge first — on cold loads the
        # widget renders before either the auth form or the Log-in CTA,
        # so doing this up-front shaves a full poll iteration of waiting.
        if cf_turnstile_clickbox(page, timeout_ms=TURNSTILE_LANDING_TIMEOUT_MS):
            continue
        if page.locator(EMAIL_SELECTOR).first.is_visible():
            return "email"
        for role, name in LOGIN_ENTRY_ROLES:
            try:
                page.get_by_role(role, name=name, exact=True).first.wait_for(
                    state="visible", timeout=LOGIN_ENTRY_PROBE_TIMEOUT_MS
                )
                return "login"
            except PWTimeout:
                continue
        page.wait_for_timeout(LOGIN_ENTRY_PROBE_TIMEOUT_MS)
    raise PWTimeout(f"login UI did not render within {total_ms}ms")


def _click_login_entry(page: Page) -> bool:
    """Click whichever 'Log in' / 'Sign in' entry point is currently visible
    on the chatgpt.com landing page. Returns True if a click landed."""
    for role, name in LOGIN_ENTRY_ROLES:
        try:
            page.get_by_role(role, name=name, exact=True).first.click(
                timeout=LOGIN_ENTRY_CLICK_TIMEOUT_MS
            )
            return True
        except PWTimeout:
            continue
    return False


def chatgpt_login(page: Page, email: str, password: str) -> None:
    log(f"logging in as {email}")
    page.goto("https://chatgpt.com/", wait_until="domcontentloaded")
    found = _wait_for_email_or_login_button(page, total_ms=LOGIN_PAGE_TOTAL_MS)
    if found == "login":
        _click_login_entry(page)
        # Auth0 sometimes shows another turnstile after navigating.
        cf_turnstile_clickbox(page, timeout_ms=TURNSTILE_LOGIN_TIMEOUT_MS)

    # The email input sometimes refuses to render on cold launches even
    # after the Log-in entry is clicked — typically a slow /auth/login
    # bootstrap or a Turnstile challenge that finishes *after* our click.
    # Reload once and re-drive the landing page instead of surfacing a
    # 45s timeout that burns a whole GitHub Actions run.
    email_input = page.locator(EMAIL_SELECTOR).first
    try:
        email_input.wait_for(state="visible", timeout=EMAIL_INPUT_TIMEOUT_MS)
    except PWTimeout:
        log("email input did not render — reloading and retrying once")
        page.reload(wait_until="domcontentloaded")
        cf_turnstile_clickbox(page, timeout_ms=TURNSTILE_LOGIN_TIMEOUT_MS)
        # If the landing page still shows the Log-in entry, click it
        # again; otherwise the email input should already be mounted.
        if not page.locator(EMAIL_SELECTOR).first.is_visible():
            _click_login_entry(page)
            cf_turnstile_clickbox(page, timeout_ms=TURNSTILE_LOGIN_TIMEOUT_MS)
        email_input.wait_for(state="visible", timeout=EMAIL_INPUT_TIMEOUT_MS)
    email_input.fill(email)
    page.get_by_role("button", name="Continue", exact=True).first.click(
        timeout=CONTINUE_BUTTON_TIMEOUT_MS
    )
    cf_turnstile_clickbox(page, timeout_ms=TURNSTILE_DEFAULT_TIMEOUT_MS)

    pw_input = page.locator(PASSWORD_SELECTOR).first
    pw_input.wait_for(state="visible", timeout=EMAIL_INPUT_TIMEOUT_MS)
    pw_input.fill(password)
    page.get_by_role("button", name="Continue", exact=True).first.click(
        timeout=CONTINUE_BUTTON_TIMEOUT_MS
    )

    # Land on chatgpt.com (post-login). Some accounts hit a "verify
    # device" page first; surface that explicitly so we don't sit forever.
    try:
        page.wait_for_url("**/chatgpt.com/**", timeout=POST_LOGIN_NAV_TIMEOUT_MS)
    except PWTimeout as e:
        if "/u/mfa" in page.url or "/verify" in page.url:
            raise RuntimeError(
                f"login requires MFA/verification: {page.url}"
            ) from e
        raise
    page.wait_for_load_state("domcontentloaded")
    log("login complete")


# ---------------------------------------------------------------------------
# Pricing modal (same as the manual script)
# ---------------------------------------------------------------------------


class NoPromoOffer(RuntimeError):
    """Raised when the account does not qualify for the free trial promo."""


def dismiss_chatgpt_onboarding(page: Page) -> None:
    """Skip post-login "What brings you to ChatGPT?" interest-picker.

    Brand-new accounts hit a modal ``<dialog>`` immediately after auth that
    blocks every other UI surface (sidebar, pricing modal, profile menu).
    The picker can be up to 3 pages deep on chatgpt.com, so we loop
    clicking the dialog's "Skip" button — with a one-shot "Next" fallback
    if Skip is somehow non-interactive — until the dialog is gone.

    No-op for already-onboarded accounts: if no modal dialog appears within
    :data:`ONBOARDING_DIALOG_PROBE_MS` we return immediately.
    """
    onboarding_dialog = page.locator(
        'dialog[aria-modal="true"][open]:has(button:has-text("Skip"))'
    ).first
    for step in range(1, ONBOARDING_MAX_STEPS + 1):
        try:
            onboarding_dialog.wait_for(
                state="visible", timeout=ONBOARDING_DIALOG_PROBE_MS
            )
        except PWTimeout:
            if step == 1:
                log("no onboarding dialog detected (already onboarded)")
            else:
                log(f"onboarding dismissed after {step - 1} step(s)")
            return
        skip_btn = onboarding_dialog.get_by_role(
            "button", name="Skip", exact=True
        ).first
        try:
            skip_btn.click(timeout=ONBOARDING_CLICK_TIMEOUT_MS)
            log(f"clicked Skip on onboarding (step {step})")
            continue
        except PWTimeout:
            log(f"Skip not clickable on step {step}; trying Next fallback")
        next_btn = onboarding_dialog.get_by_role(
            "button", name="Next", exact=True
        ).first
        try:
            # Pick the first available option so Next becomes enabled.
            onboarding_dialog.locator('button[aria-pressed="false"]').first.click(
                timeout=ONBOARDING_CLICK_TIMEOUT_MS
            )
            next_btn.click(timeout=ONBOARDING_CLICK_TIMEOUT_MS)
            log(f"clicked option + Next as fallback (step {step})")
        except PWTimeout as e:
            log(f"both Skip and Next failed on onboarding step {step}: {e}")
            raise
    log(
        f"onboarding loop hit ONBOARDING_MAX_STEPS={ONBOARDING_MAX_STEPS}; "
        "continuing in case the dialog has just closed."
    )


def open_pricing_modal(page: Page) -> None:
    log("opening pricing modal")
    if "chatgpt.com" not in page.url:
        page.goto("https://chatgpt.com/")
    page.wait_for_load_state("domcontentloaded")
    try:
        page.get_by_role("button", name="Claim offer").first.click(
            timeout=PRICING_MODAL_CLICK_TIMEOUT_MS
        )
    except PWTimeout:
        try:
            page.get_by_role("button", name="Free offer").first.click(
                timeout=PRICING_MODAL_CLICK_TIMEOUT_MS
            )
        except PWTimeout:
            page.goto("https://chatgpt.com/?promo_campaign=team-1-month-free#pricing")
    try:
        page.wait_for_selector(
            'text=/Try (Plus|Business) free for 1 month/',
            timeout=PRICING_MODAL_TIMEOUT_MS,
        )
    except PWTimeout as e:
        if (
            page.locator('h2:has-text("Upgrade your plan")').count() > 0
            or page.locator('button:has-text("Upgrade to Plus")').count() > 0
        ):
            raise NoPromoOffer(
                "Account is not eligible for the free trial promo "
                "(saw regular 'Upgrade your plan' modal)."
            ) from e
        page.wait_for_selector(
            'text=/Try (Plus|Business) free for 1 month/',
            timeout=PRICING_MODAL_TIMEOUT_MS,
        )
    log(f"pricing modal open at {page.url}")


def switch_to_personal(page: Page) -> None:
    log("switching pricing to Personal tab (Plus card)")
    btn = page.locator(
        'button[aria-label="Toggle for switching to Personal plans"]'
    ).first
    try:
        btn.click(timeout=PERSONAL_TOGGLE_CLICK_TIMEOUT_MS, force=True)
    except PWTimeout:
        log("personal toggle click failed (probably already active)")
    page.wait_for_selector(
        'button:has-text("Claim free offer")',
        timeout=CLAIM_FREE_OFFER_TIMEOUT_MS,
    )


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
    trigger.click(timeout=COUNTRY_TRIGGER_TIMEOUT_MS, force=True)
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
        raise RuntimeError(
            f"Indonesia option not found in country dropdown ({clicked})"
        )
    page.wait_for_timeout(COUNTRY_PRICING_SETTLE_MS)
    body = page.evaluate("() => document.body.innerText")
    if "IDR" not in body and "Rp" not in body:
        raise RuntimeError("pricing did not switch to IDR")
    log("pricing switched to IDR")


def claim_free_offer(page: Page) -> None:
    log("clicking 'Claim free offer' on Plus card")
    page.locator('button:has-text("Claim free offer")').first.click(
        timeout=CLAIM_FREE_OFFER_TIMEOUT_MS
    )
    page.wait_for_url(
        "**/checkout/openai_llc/cs_live_*",
        timeout=CLAIM_FREE_OFFER_NAV_TIMEOUT_MS,
    )
    log(f"checkout open: {page.url[:100]}…")


# ---------------------------------------------------------------------------
# Stripe billing form
# ---------------------------------------------------------------------------


def stripe_address_frame(page: Page) -> FrameLocator:
    return page.frame_locator('iframe[src*="elements-inner-address"]').first


def _addr_input(addr: FrameLocator, *names: str) -> Locator:
    selectors = []
    for n in names:
        selectors += [
            f'input[name="{n}"]',
            f'input[id="Field-{n}Input"]',
            f'input[id$="-{n}"]',
        ]
    return addr.locator(", ".join(selectors)).first


def _addr_select(addr: FrameLocator, *names: str) -> Locator:
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
    name_input.wait_for(state="visible", timeout=STRIPE_NAME_INPUT_TIMEOUT_MS)

    country_select = _addr_select(addr, "country")
    country_select.select_option(label="Indonesia")
    page.wait_for_timeout(500)

    name_input.fill(full_name)
    _addr_input(addr, "line1", "addressLine1").fill(address)
    _addr_input(addr, "city", "locality").fill(city)

    province_select = _addr_select(addr, "state", "administrativeArea")
    province_select.wait_for(state="visible", timeout=STRIPE_PROVINCE_TIMEOUT_MS)
    options = province_select.locator("option").all_text_contents()
    target = next((o for o in options if province.lower() in o.lower()), None)
    if target is None:
        raise RuntimeError(
            f"province '{province}' not found among {options[:5]}…"
        )
    province_select.select_option(label=target)

    _addr_input(addr, "postal_code", "postalCode").fill(postal)
    page.wait_for_timeout(500)
    log("billing form filled")


def submit_subscribe(page: Page) -> None:
    log("clicking Subscribe → Midtrans GoPay redirect")
    page.locator('button[aria-label="Subscribe"]').first.click(
        timeout=STRIPE_SUBSCRIBE_CLICK_TIMEOUT_MS
    )
    page.wait_for_url(
        "https://app.midtrans.com/snap/**", timeout=MIDTRANS_NAV_TIMEOUT_MS
    )
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
    page.wait_for_url(
        "**/gopay-tokenization/linking", timeout=GOPAY_LINKING_NAV_TIMEOUT_MS
    )
    inp = page.locator('input[type="tel"]').first
    inp.wait_for(state="visible", timeout=GOPAY_PHONE_INPUT_TIMEOUT_MS)
    inp.click()
    inp.fill("")
    _press_text(inp, phone, delay=PHONE_TYPE_DELAY_MS)
    page.wait_for_timeout(400)
    page.get_by_role("button", name="Link and pay").first.click(
        timeout=GOPAY_LINK_PAY_TIMEOUT_MS
    )
    log("clicked Link and pay")


def midtrans_confirm_hubungkan(page: Page) -> None:
    log("waiting for GoPay 'Hubungkan' confirmation iframe")
    for _ in range(IFRAME_POLL_ITERATIONS):
        for sel in GOPAY_IFRAME_SELECTORS:
            if page.locator(sel).count() == 0:
                continue
            fl = page.frame_locator(sel).first
            btn = fl.locator('button:has-text("Hubungkan")').first
            try:
                btn.wait_for(
                    state="visible", timeout=GOPAY_HUBUNGKAN_PROBE_TIMEOUT_MS
                )
                btn.click()
                log("clicked Hubungkan")
                return
            except PWTimeout:
                continue
        page.wait_for_timeout(IFRAME_POLL_INTERVAL_MS)
    log("Hubungkan iframe not found; falling back to coord click")
    page.mouse.click(512, 555)


def midtrans_enter_otp(page: Page, otp: str) -> None:
    log("entering WhatsApp OTP")
    fl = _find_gopay_frame(page)
    if fl is None:
        raise RuntimeError("GoPay iframe not found for OTP step")
    fl.locator(
        'text=/Masukkin OTP|Enter OTP|Masukkan kode OTP|OTP yang dikirim/'
    ).first.wait_for(state="visible", timeout=GOPAY_OTP_PROMPT_TIMEOUT_MS)
    inp = fl.locator('input').first
    inp.click()
    _press_text(inp, otp)
    log("OTP submitted")


def midtrans_enter_pin(page: Page, pin: str, label: str) -> None:
    log(f"entering GoPay PIN ({label})")
    fl = _find_gopay_frame(page)
    if fl is None:
        raise RuntimeError("GoPay iframe not found for PIN step")
    fl.locator(
        'text=/PIN kamu|PIN GoPay|6 digit PIN|Masukkin PIN/'
    ).first.wait_for(state="visible", timeout=GOPAY_PIN_PROMPT_TIMEOUT_MS)
    inp = fl.locator('input').first
    inp.click()
    _press_text(inp, pin)
    log(f"PIN ({label}) submitted")


def midtrans_pay_now(page: Page) -> None:
    log("clicking Pay now")
    page.wait_for_url(
        "**/gopay-tokenization/pay", timeout=GOPAY_PAY_NAV_TIMEOUT_MS
    )
    page.get_by_role("button", name="Pay now").first.click(
        timeout=GOPAY_PAY_CLICK_TIMEOUT_MS
    )


def midtrans_confirm_bayar(page: Page) -> None:
    log("confirming GoPay 'Bayar' inside iframe")
    fl = None
    for _ in range(IFRAME_POLL_ITERATIONS):
        fl = _find_gopay_frame(page)
        if fl is not None:
            break
        page.wait_for_timeout(IFRAME_POLL_INTERVAL_MS)
    if fl is None:
        raise RuntimeError("GoPay iframe not found for Bayar step")
    btn = fl.locator('button:has-text("Bayar")').first
    btn.wait_for(state="visible", timeout=GOPAY_BAYAR_TIMEOUT_MS)
    btn.click()
    log("clicked Bayar")


def wait_for_success(page: Page) -> None:
    log("waiting for ChatGPT payments/success redirect")
    page.wait_for_url(
        "**/payments/success**", timeout=SUCCESS_REDIRECT_TIMEOUT_MS
    )
    log(f"SUCCESS — {page.url[:120]}…")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def claim_trial(page: Page, email: str, password: str, full_name: str,
                phone: str, pin: str, otp_url: str, otp_token: str,
                otp_timeout: int, address: str, city: str, province: str,
                postal: str, bot_token: str, chat_id: str) -> None:
    """Drive the full 17-UI-step claim flow.

    Each logical step is wrapped in :func:`_step` so a failure produces a
    self-contained debug bundle (PNG + HTML + .txt) under
    ``DEBUG_ARTIFACTS_DIR``, ready for the workflow's upload-artifact step.
    """
    with _step("login", page):
        chatgpt_login(page, email, password)
    with _step("dismiss_onboarding", page):
        dismiss_chatgpt_onboarding(page)
    with _step("open_pricing_modal", page):
        open_pricing_modal(page)
    with _step("switch_to_personal", page):
        switch_to_personal(page)
    with _step("pick_indonesia_country", page):
        pick_indonesia_country(page)
    with _step("claim_free_offer", page):
        claim_free_offer(page)
    with _step("fill_billing", page):
        fill_billing(page, full_name, address, city, province, postal)
    with _step("submit_subscribe", page):
        submit_subscribe(page)
    with _step("midtrans_link_phone", page):
        midtrans_link_phone(page, phone)
    with _step("midtrans_confirm_hubungkan", page):
        midtrans_confirm_hubungkan(page)

    # Discard any stale `/otp` left behind by a previous claim run before
    # we ask the user for a fresh code. Otherwise poll_otp_url would
    # return the old digits instantly and Midtrans would reject them.
    drain_pending_otp(otp_url, otp_token)

    telegram_send(
        bot_token,
        chat_id,
        (
            f"📲 OTP WhatsApp dibutuhkan untuk <code>{email}</code>.\n"
            "Kirim balik dengan: /otp 123456 (5 menit)."
        ),
    )
    with _step("poll_otp", page):
        otp = poll_otp_url(otp_url, otp_token, timeout_s=otp_timeout)
    with _step("midtrans_enter_otp", page):
        midtrans_enter_otp(page, otp)

    with _step("midtrans_enter_pin_linking", page):
        midtrans_enter_pin(page, pin, "linking")
    with _step("midtrans_pay_now", page):
        midtrans_pay_now(page)
    with _step("midtrans_confirm_bayar", page):
        midtrans_confirm_bayar(page)
    with _step("midtrans_enter_pin_payment", page):
        midtrans_enter_pin(page, pin, "payment")
    with _step("wait_for_success", page):
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

    # Fail-fast on malformed inputs before we spin up Xvfb + Chromium.
    phone_digits = args.phone.strip()
    if not phone_digits.isdigit() or not (8 <= len(phone_digits) <= 13):
        p.error(
            "--phone must be 8-13 digits without leading + or 0 "
            f"(got {args.phone!r})"
        )
    pin_digits = args.pin.strip()
    if not pin_digits.isdigit() or len(pin_digits) != 6:
        p.error(f"--pin must be exactly 6 digits (got {len(pin_digits)})")
    args.phone = phone_digits
    args.pin = pin_digits

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
            log(f"FAILED: {type(e).__name__}: {e}")
            telegram_send(
                bot_token,
                chat_id,
                (
                    f"❌ <b>Claim gagal</b> untuk <code>{email}</code>\n"
                    f"<code>{type(e).__name__}: {_escape_html(str(e))}</code>\n"
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
