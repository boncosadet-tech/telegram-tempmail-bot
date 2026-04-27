#!/usr/bin/env python3
"""
Cancel (revoke) an active ChatGPT Plus subscription via the Stripe
customer portal. Companion to ``bot/chatgpt_claim_trial.py``.

Flow (roughly 6 UI steps; validated against chatgpt.com / Stripe portal
layouts as of 2026-04):

  1. Launch headed Chromium under Xvfb (reuse patchright helpers).
  2. Login to chatgpt.com with email + password (looked up from D1
     ``chatgpt_accounts`` when not supplied via CLI).
  3. Open Settings → Subscription (``chatgpt.com/#settings/Subscription``)
     or the Billing pane via the user menu.
  4. Click "Manage my subscription" → Stripe customer portal opens.
  5. On Stripe portal: click "Cancel plan" (or "Cancel subscription").
  6. Confirm modal (the exact wording varies a little; we accept any
     ``button:has-text("Cancel")`` inside the confirmation dialog).
  7. Verify a "will be canceled on <DATE>" / "canceled" banner.

Exit codes:
  0  subscription canceled successfully (or already canceled)
  1  fatal error (login failed, Stripe portal did not open, …)
  2  no active paid plan to cancel (skipped cleanly)

Required env vars (same pattern as the claim script):
  CLOUDFLARE_GLOBAL_API, CLOUDFLARE_EMAIL — D1 access
  TELEGRAM_BOT_TOKEN, OWNER_CHAT_ID       — progress reporting
  CF_ACCOUNT_ID (default: hard-coded), D1_DATABASE_ID (default: hard-coded)

CLI:
  --email <addr>          target ChatGPT account
  --password <pwd>        password (else looked up from D1)
  --timeout <int>         seconds to wait for each Stripe step (default 60)
  --autorevoke            chain with the claim flow (internal — used by
                          the ``chatgpt-autorevoke`` workflow)
  --phone / --pin / --otp-url / --otp-token
                          forwarded to the claim sub-flow when
                          ``--autorevoke`` is on (ignored otherwise)
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time

from patchright.sync_api import (
    Page,
    TimeoutError as PWTimeout,
    sync_playwright,
)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chatgpt_signup import (  # noqa: E402
    DEFAULT_CF_ACCOUNT,
    DEFAULT_D1_DB,
    telegram_send,
)
from chatgpt_claim_trial import (  # noqa: E402
    chatgpt_login,
    claim_trial,
    derive_full_name_from_email,
    lookup_account_password,
    DEFAULT_ADDRESS,
    DEFAULT_CITY,
    DEFAULT_POSTAL,
    DEFAULT_PROVINCE,
    NoPromoOffer,
    OtpTimeout,
)


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Revoke flow
# ---------------------------------------------------------------------------


class NoActivePlan(RuntimeError):
    """Raised when the account has no active paid plan to cancel."""


def open_subscription_settings(page: Page, timeout_s: int = 60) -> None:
    """Navigate the logged-in ChatGPT UI to Settings → Subscription."""
    log("opening Settings → Subscription")
    # Fast path: direct URL hash deep-links to the subscription tab.
    page.goto("https://chatgpt.com/#settings/Subscription", wait_until="domcontentloaded")
    # The settings modal can take a moment to mount; look for a stable
    # element inside the Subscription tab (the "Manage my subscription"
    # button, or a "You're subscribed to Plus" heading).
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        for role, pattern in (
            ("button", r"Manage my subscription"),
            ("link", r"Manage my subscription"),
            ("button", r"Manage subscription"),
            ("link", r"Manage subscription"),
        ):
            try:
                page.get_by_role(role, name=re.compile(pattern, re.I)).first.wait_for(
                    state="visible", timeout=2000
                )
                return
            except PWTimeout:
                continue
        # Secondary check: "You're subscribed to Plus" / "Plus" banner →
        # still on subscription tab but button hidden (e.g. free user).
        if page.locator(
            'text=/You.?re on the Free plan|Upgrade to Plus/i'
        ).first.count() > 0:
            raise NoActivePlan("no active paid plan — account is on Free")
        page.wait_for_timeout(1000)
    raise PWTimeout(f"subscription tab did not render within {timeout_s}s")


def open_stripe_portal(page: Page, timeout_s: int = 60) -> Page:
    """Click "Manage my subscription" and wait for the Stripe portal page."""
    log("opening Stripe customer portal")
    context = page.context
    # ChatGPT opens the portal in a new tab; wrap the click in an
    # expect_page() so we capture whichever tab actually carries the
    # billing.stripe.com URL.
    try:
        with context.expect_page(timeout=timeout_s * 1000) as new_page_info:
            for role, pattern in (
                ("button", r"Manage my subscription"),
                ("link", r"Manage my subscription"),
                ("button", r"Manage subscription"),
                ("link", r"Manage subscription"),
            ):
                try:
                    page.get_by_role(role, name=re.compile(pattern, re.I)).first.click(
                        timeout=4000
                    )
                    break
                except PWTimeout:
                    continue
            else:
                raise PWTimeout("no 'Manage subscription' button found")
        portal = new_page_info.value
    except PWTimeout:
        # Some accounts open the portal in the SAME tab. Detect that case.
        if "billing.stripe.com" in page.url or "pay.openai.com" in page.url:
            portal = page
        else:
            raise

    portal.wait_for_load_state("domcontentloaded")
    portal.wait_for_url(
        re.compile(r"(billing\.stripe\.com|pay\.openai\.com)"), timeout=timeout_s * 1000
    )
    log(f"Stripe portal open at {portal.url[:120]}…")
    return portal


def click_cancel_plan(portal: Page, timeout_s: int = 30) -> None:
    """Click the "Cancel plan" / "Cancel subscription" entry in the portal."""
    log("clicking Cancel plan")
    candidates = (
        r"Cancel plan",
        r"Cancel subscription",
        r"Cancel your plan",
    )
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        for pattern in candidates:
            try:
                portal.get_by_role(
                    "button", name=re.compile(pattern, re.I)
                ).first.click(timeout=3000)
                return
            except PWTimeout:
                try:
                    portal.get_by_role(
                        "link", name=re.compile(pattern, re.I)
                    ).first.click(timeout=2000)
                    return
                except PWTimeout:
                    continue
        portal.wait_for_timeout(1000)
    # If nothing was clickable, check for a pre-existing "Canceled" state:
    if portal.locator(
        'text=/canceled|will be canceled|plan ends on/i'
    ).first.count() > 0:
        raise NoActivePlan("plan already canceled — nothing to do")
    raise PWTimeout("Cancel button not found in Stripe portal")


def confirm_cancel(portal: Page, timeout_s: int = 30) -> None:
    """Confirm the cancel modal. Stripe uses a dialog with a destructive button."""
    log("confirming cancel in modal")
    # Stripe's confirm button text varies: "Cancel subscription" /
    # "Cancel plan" / "Confirm cancellation".
    deadline = time.time() + timeout_s
    patterns = (
        r"^Cancel subscription$",
        r"^Cancel plan$",
        r"^Confirm cancellation$",
        r"^Confirm$",
    )
    while time.time() < deadline:
        # Prefer a button inside a visible modal / dialog role.
        dialog = portal.get_by_role("dialog").first
        try:
            dialog.wait_for(state="visible", timeout=2000)
            for pattern in patterns:
                try:
                    dialog.get_by_role(
                        "button", name=re.compile(pattern, re.I)
                    ).first.click(timeout=2500)
                    return
                except PWTimeout:
                    continue
        except PWTimeout:
            # No modal — some portal variants inline-confirm.
            for pattern in patterns:
                try:
                    portal.get_by_role(
                        "button", name=re.compile(pattern, re.I)
                    ).first.click(timeout=2000)
                    return
                except PWTimeout:
                    continue
        portal.wait_for_timeout(1000)
    raise PWTimeout("confirm-cancel button not found")


def verify_canceled(portal: Page, timeout_s: int = 30) -> str:
    """Wait for the cancellation confirmation banner. Return its text."""
    log("verifying cancellation banner")
    deadline = time.time() + timeout_s
    patterns = (
        r"will be canceled on",
        r"canceled",
        r"cancellation scheduled",
        r"plan ends on",
    )
    while time.time() < deadline:
        for pattern in patterns:
            loc = portal.get_by_text(re.compile(pattern, re.I)).first
            if loc.count() > 0:
                try:
                    text = loc.inner_text(timeout=2000).strip()
                    if text:
                        log(f"cancellation confirmed: {text[:160]}")
                        return text
                except PWTimeout:
                    pass
        portal.wait_for_timeout(1000)
    raise PWTimeout("cancellation banner did not appear within timeout")


def revoke_subscription(
    page: Page,
    email: str,
    password: str,
    step_timeout_s: int = 60,
) -> str:
    """Full revoke sequence. Returns the cancellation banner text."""
    chatgpt_login(page, email, password)
    open_subscription_settings(page, timeout_s=step_timeout_s)
    portal = open_stripe_portal(page, timeout_s=step_timeout_s)
    try:
        click_cancel_plan(portal, timeout_s=step_timeout_s)
    except NoActivePlan as e:
        return str(e)
    confirm_cancel(portal, timeout_s=step_timeout_s)
    return verify_canceled(portal, timeout_s=step_timeout_s)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _escape(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def main() -> int:
    p = argparse.ArgumentParser(description="Cancel ChatGPT Plus subscription via Stripe portal")
    p.add_argument("--email", required=True)
    p.add_argument("--password", default="")
    p.add_argument("--timeout", type=int, default=60,
                   help="per-step timeout in seconds")
    p.add_argument(
        "--autorevoke",
        action="store_true",
        help="chain with the claim-trial flow (internal)",
    )
    # Forwarded to claim sub-flow when --autorevoke is on.
    p.add_argument("--phone", default="")
    p.add_argument("--pin", default="")
    p.add_argument("--otp-url", default="")
    p.add_argument("--otp-token", default="")
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

    if args.autorevoke:
        autorevoke_required = ("phone", "pin", "otp_url", "otp_token")
        missing_args = [n for n in autorevoke_required if not getattr(args, n)]
        if missing_args:
            print(f"ERROR: --autorevoke requires: {missing_args}", file=sys.stderr)
            return 2

    email = args.email.strip().lower()

    password = args.password
    if not password:
        try:
            password = lookup_account_password(account_id, db_id, email)
        except Exception as e:
            msg = f"❌ Password tidak ditemukan untuk <code>{email}</code>: {_escape(e)}"
            telegram_send(bot_token, chat_id, msg)
            print(msg, file=sys.stderr)
            return 1

    full_name = derive_full_name_from_email(email)

    telegram_send(
        bot_token,
        chat_id,
        (
            f"⏳ <b>Autorevoke</b> dimulai untuk <code>{email}</code>"
            if args.autorevoke
            else f"⏳ <b>Revoke</b> plan untuk <code>{email}</code>"
        ),
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
            if args.autorevoke:
                # Phase 1: claim the trial (reuse the existing script).
                telegram_send(
                    bot_token,
                    chat_id,
                    f"1️⃣ Fase claim trial untuk <code>{email}</code>",
                )
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
                    telegram_send(
                        bot_token,
                        chat_id,
                        f"⏭️ <b>Skipped</b>: <code>{email}</code> tidak punya free offer. "
                        f"Revoke dilewati. Durasi: {elapsed}s ({_escape(e)})",
                    )
                    return 2
                except OtpTimeout as e:
                    elapsed = round(time.time() - t0, 1)
                    telegram_send(
                        bot_token,
                        chat_id,
                        f"❌ <b>OTP timeout</b> di fase claim untuk <code>{email}</code>. "
                        f"Durasi: {elapsed}s",
                    )
                    return 1
                # Stripe sometimes takes a few seconds to materialise the
                # subscription on the account after payment. Pause so
                # "Manage my subscription" resolves.
                page.wait_for_timeout(10_000)
                telegram_send(
                    bot_token,
                    chat_id,
                    f"2️⃣ Fase cancel plan untuk <code>{email}</code>",
                )

            banner = revoke_subscription(
                page,
                email=email,
                password=password,
                step_timeout_s=args.timeout,
            )
        except NoActivePlan as e:
            elapsed = round(time.time() - t0, 1)
            log(f"SKIP: {e}")
            telegram_send(
                bot_token,
                chat_id,
                f"⏭️ <b>Tidak ada plan aktif</b> untuk <code>{email}</code>. "
                f"Durasi: {elapsed}s",
            )
            return 2
        except Exception as e:
            elapsed = round(time.time() - t0, 1)
            log(f"FAILED: {type(e).__name__}: {e}")
            telegram_send(
                bot_token,
                chat_id,
                (
                    f"❌ <b>Revoke gagal</b> untuk <code>{email}</code>\n"
                    f"<code>{type(e).__name__}: {_escape(e)}</code>\n"
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
            f"✅ <b>Plan canceled</b>: <code>{email}</code>\n"
            f"{_escape(banner[:400])}\n"
            f"Durasi: {elapsed}s"
        ),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
