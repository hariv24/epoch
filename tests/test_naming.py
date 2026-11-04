"""The app is called Epoch and counts plain days. Nothing visible may still say Underdog or "Epoch N"."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from epoch import game, notify as notify_module

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "epoch"
STATIC = PKG / "web" / "static"
# The brand mark files are a separate piece of work; only their comments still carry the old name.
BRAND_FILES = {STATIC / "app" / "icon.svg"}


def _source_files():
    for path in sorted(PKG.rglob("*")):
        if path.suffix in {".py", ".html", ".js", ".css", ".webmanifest", ".sql"} and "__pycache__" not in path.parts:
            if path.name == "htmx.min.js" or "brand" in path.parts or path in BRAND_FILES:
                continue
            yield path


def test_no_visible_underdog_left_in_the_package():
    old = [str(p.relative_to(ROOT)) for p in _source_files() if "underdog" in p.read_text().lower()
           and p.name not in {"categories.py", "config.py", "lan.py"}]       # these keep the old name on purpose (aliases)
    assert not old, old


def test_nothing_says_epoch_followed_by_a_number():
    pattern = re.compile(r"""\bEpochs?\s*(?:\{\{|\d|['"]\s*\+|\$\{)""", re.I)
    offenders = [str(p.relative_to(ROOT)) for p in _source_files() if pattern.search(p.read_text())]
    assert not offenders, offenders


def test_pages_use_the_epoch_brand(owner):
    today = owner.get("/").text
    assert "<title>Today · Epoch</title>" in today and "Underdog" not in today
    assert 'aria-label="Epoch, Today"' in today
    for path in ("/world", "/close", "/plan", "/settings", "/pomodoro", "/postcards"):
        page = owner.get(path)
        assert page.status_code == 200 and "Underdog" not in page.text, path


def test_manifest_is_named_epoch():
    manifest = json.loads((STATIC / "app" / "manifest.webmanifest").read_text())
    assert manifest["name"] == "Epoch" and manifest["short_name"] == "Epoch"


def test_postcard_lettering_and_download_names():
    js = (STATIC / "app" / "postcard.js").read_text()
    assert "'EPOCH  ·  '" in js and "MY WEEK IN NEW YORK" in js and "NEW YORK TONIGHT" in js
    assert "'DAY ' + recap.day_number" in js and "dayText.toUpperCase()" in js
    assert "'epoch-postcard-'" in js and "underdog" not in js.lower()


def test_front_end_day_counter_wording():
    app_js = (STATIC / "app" / "app.js").read_text()
    assert "'Days ' + a + '-' + b" in app_js and "'Day ' + a" in app_js
    assert "'Day ' + ST.dayNumber" in app_js and "python -m epoch" in app_js


def test_download_names_say_epoch(owner):
    from epoch.web import app as webapp

    source = Path(webapp.__file__).read_text()
    assert 'filename="epoch-{card_id}.png"' in source and 'filename="epoch-skyline-{day}.png"' in source


def test_llm_and_notification_titles_say_epoch():
    source = (PKG / "scheduler.py").read_text() + (PKG / "main.py").read_text() + (PKG / "web" / "app.py").read_text()
    assert "Underdog" not in source
    assert (PKG / "llm.py").read_text().count('"X-Title": "Epoch"') == 1
    assert callable(notify_module.notify)


def test_telegram_texts_say_epoch(owner):
    from epoch import telegram_bot

    assert "Epoch" in (PKG / "telegram_bot.py").read_text() and "Underdog" not in (PKG / "telegram_bot.py").read_text()
    assert hasattr(telegram_bot, "EpochBot")


def test_install_scripts_use_the_epoch_label_and_remove_the_old_ones():
    install = (ROOT / "scripts" / "install_launchd.sh").read_text()
    uninstall = (ROOT / "scripts" / "uninstall_launchd.sh").read_text()
    for script in (install, uninstall):
        assert 'LABEL="com.epoch.tracker"' in script
        assert "com.underdog.tracker" in script and "com.witness.tracker" in script
    assert "<string>epoch</string>" in install and "data/epoch.log" in install


def test_env_example_lists_only_epoch_names():
    text = (ROOT / ".env.example").read_text()
    assert "EPOCH_PORT" in text and "EPOCH_DATA_DIR" in text and "EPOCH_BACKUP_DIR" in text and "EPOCH_LAN" in text
    assert "UNDERDOG_" not in text and "WITNESS_" not in text


def test_game_events_carry_the_day_number_not_epoch(conn):
    from datetime import date

    state = game.today_state(conn, date(2026, 10, 7))
    assert state["day_number"] == 3 and state["day_line"].startswith("Day 3 · ")
    assert "epoch" not in state and "epoch_line" not in state
