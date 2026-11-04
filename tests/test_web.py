"""Web app tests: FastAPI TestClient against a temporary database, no network.

The clock is frozen at Wednesday 2026-10-14 20:30 IST (15:00 UTC). The tracker started on
2026-10-05, so this is week 2 and the contract (2 outputs + 5 floor days) is in force.
"""
from __future__ import annotations

import html as htmllib
import re
import json
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from epoch import categories, db, game, rules, timeutil
from epoch.activitywatch import AWEvent
from epoch.config import Config
from epoch.web.app import create_app

UTC = timezone.utc
NOW = datetime(2026, 10, 14, 15, 0, tzinfo=UTC)  # Wed 20:30 IST
TODAY = date(2026, 10, 14)
HX = {"HX-Request": "true"}


def has_asset(html: str, path: str) -> bool:
    """Pages load code and CSS from the versioned prefix /static/v/<fingerprint>/ (see asset_version in app.py)."""
    return re.search(r'"/static/v/[0-9a-f]{10}/' + re.escape(path) + '"', html) is not None


class Clock:
    """A clock tests can move forward."""

    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


class FakeAW:
    """ActivityWatch stand-in. Unavailable by default."""

    def __init__(self, events: list[AWEvent] | None = None, available: bool = False) -> None:
        self._events = events or []
        self._available = available

    def available(self) -> bool:
        return self._available

    def events(self, start_utc, end_utc):
        return [e for e in self._events if e.end_utc > start_utc and e.start_utc < end_utc]


class FakeBot:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[tuple[int, str]] = []
        self.fail = fail

    async def send_message(self, chat_id, text):
        if self.fail:
            raise RuntimeError("offline")
        self.sent.append((chat_id, text))


def make_config(tmp_path, db_path, telegram: bool = False) -> Config:
    return Config(
        data_dir=tmp_path, db_path=db_path, backup_dir=None, port=8765,
        telegram_bot_token="123:abc" if telegram else None,
        telegram_user_id=42 if telegram else None,
        openrouter_api_key=None, openrouter_models=(), activitywatch_url="http://localhost:5600",
    )


@pytest.fixture
def clock(monkeypatch):
    fake = Clock(NOW)
    monkeypatch.setattr(timeutil, "now_utc", fake)
    return fake


@pytest.fixture
def state(tmp_path, db_path, clock):
    return SimpleNamespace(
        config=make_config(tmp_path, db_path), db_path=db_path, telegram_app=None, aw=FakeAW(), llm=None
    )


@pytest.fixture
def client(state):
    return TestClient(create_app(state))


def fetch(db_path, sql, *params):
    with db.get_conn(db_path) as conn:
        return conn.execute(sql, params).fetchall()


def unescaped(response) -> str:
    """Response text with HTML entities decoded (so apostrophes read normally)."""
    return htmllib.unescape(response.text)


def local(hhmm: str, d: date = TODAY) -> datetime:
    return timeutil.at_local(d, hhmm, "Asia/Kolkata", 4)


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------

@pytest.mark.parametrize("path", [
    "/", "/plan", "/plan?day=tomorrow", "/close", "/close?day=2026-10-13", "/world", "/world?view=shelf",
    "/world?view=week&week=2026-10-05", "/settings", "/lapse", "/focus", "/today/entries", "/health",
    "/api/today", "/api/world", "/api/shelf",
    "/static/app/style.css", "/static/app/app.js", "/static/app/city.js", "/static/app/icons.svg", "/static/htmx.min.js",
])
def test_every_get_route_returns_200(client, path):
    assert client.get(path).status_code == 200


@pytest.mark.parametrize("path", ["/static/app/app.js", "/static/app/city/manhattan.js", "/static/app/style.css"])
def test_static_files_are_revalidated_so_an_update_never_mixes_old_and_new_modules(client, path):
    first = client.get(path)
    assert first.headers["cache-control"] == "no-cache"
    again = client.get(path, headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304


def test_pages_load_code_from_a_versioned_prefix_that_serves_the_same_files(client):
    html = client.get("/").text
    prefix = re.search(r'src="(/static/v/[0-9a-f]{10})/app/app\.js"', html).group(1)
    for path in ("app/app.js", "app/city.js", "app/city/manhattan.js", "app/style.css", "vendor/three/three.module.js"):
        versioned, plain = client.get(f"{prefix}/{path}"), client.get(f"/static/{path}")
        assert versioned.status_code == 200 and versioned.content == plain.content, path
        assert versioned.headers["cache-control"] == "no-cache"


def test_the_asset_version_changes_whenever_a_static_file_changes(tmp_path):
    import os
    from epoch.web.app import asset_version
    (tmp_path / "app").mkdir()
    module = tmp_path / "app" / "mod.js"
    module.write_text("export const a = 1;")
    first = asset_version(tmp_path)
    assert asset_version(tmp_path) == first                     # stable while nothing changes
    module.write_text("export const a = 22;")
    st = module.stat()
    os.utime(module, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))
    assert asset_version(tmp_path) != first                     # an edited module gets new URLs
    (tmp_path / "app" / "new.js").write_text("")
    assert len(asset_version(tmp_path)) == 10


@pytest.mark.parametrize("path", ["/grid", "/grid?week=2026-10-05", "/week", "/week?week=2026-10-05", "/outputs"])
def test_old_urls_redirect_into_the_world_tab(client, path):
    response = client.get(path, follow_redirects=False)
    assert response.status_code == 303 and response.headers["location"].startswith("/world")
    assert client.get(path).status_code == 200  # followed through to the new page


def test_health(client):
    assert client.get("/health").json() == {"ok": True}


def test_nav_links_on_every_page(client):
    for path in ("/", "/close", "/world", "/settings", "/plan", "/lapse", "/focus"):
        html = client.get(path).text
        for key, href, label in (("today", "/", "Today"), ("close", "/close", "Close"), ("world", "/world", "World"), ("settings", "/settings", "Settings")):
            assert f'<a href="{href}" data-nav="{key}"' in html
            assert label in html
        assert has_asset(html, "app/style.css") and has_asset(html, "app/app.js") and "/static/htmx.min.js" in html
    assert client.get("/close").text.count('aria-current="page"') == 1


def test_today_dom_contract_hooks(client):
    # Today is the room (docs/COZY.md 3a): the scene and its HUD, the Today drawer, and the log form in the "+ Add time" sheet
    html = client.get("/").text
    for hook in ("home-stage", "home-scene", "home-hud", "home-away", "level-card", "xp-fill", "hud-money", "hud-missions", "hud-chest",
                 "hud-stars", "hud-deep", "hud-deep-num", "hud-crown-arc", "start-studying", "today-open", "hud-decorate", "hud-outside",
                 "today-drawer", "ring-wrap", "arc-target", "arc-floor", "quests", "wins", "entries", "add-time", "ship-open", "focus-slot",
                 "log-sheet", "log-form", "log-text", "log-btn", "dur-chips", "cat-chips", "repeat-chips", "stage",
                 "toasts", "lights-out", "run-pill", "close-dot"):
        assert f'data-js="{hook}"' in html, hook
    assert 'data-stage="week" data-source-only' in html          # the offscreen city that renders the apartment window
    assert 'data-enhance="output"' in html and 'data-enhance="day-mark"' in html
    for dialog in ("todayDlg", "logDlg", "shipDlg", "planDlg"):
        assert f'id="{dialog}"' in html
    assert 'data-js="day-btns"' not in html and "Your week in New York" not in html     # the week card left Today
    assert 'data-js="home-dock"' not in html and "data-no-dock" in html                # no docked log bar
    assert "What did you do this hour" not in html
    assert 'href="/pomodoro?new=1"' in html and "Start studying" in html
    assert 'data-today="2026-10-14"' in html and 'data-quiet="0"' in html


def test_today_shows_ring_week_card_and_run(client):
    html = client.get("/").text
    assert "Doors (floor)" in html and "Crown (target)" in html
    assert "Today&#39;s three" in html or "Today's three" in html
    assert "outputs" in html and "floor days" in html and "skips left" in html
    assert 'data-js="run-num"' in html


def test_baseline_week_has_no_targets(tmp_path, db_path, clock):
    clock.now = datetime(2026, 10, 8, 15, 0, tzinfo=UTC)  # Thursday of the baseline week
    state = SimpleNamespace(config=make_config(tmp_path, db_path), db_path=db_path, telegram_app=None, aw=FakeAW(), llm=None)
    html = TestClient(create_app(state)).get("/").text
    assert "Baseline week" in html


def test_no_guilt_copy_anywhere(client, db_path):
    pages = [client.get(p).text for p in ("/", "/plan", "/close", "/week", "/lapse", "/outputs", "/settings")]
    lowered = " ".join(pages).lower()
    for phrase in ("you failed", "wasted", "streak lost", "lazy", "future self"):
        assert phrase not in lowered
    assert "failed" not in lowered


def test_output_text_is_escaped(client, db_path):
    client.post("/outputs", data={"stage": "Python", "what": "<script>alert(1)</script>"})
    html = client.get("/").text
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


# --------------------------------------------------------------------------
# Logging
# --------------------------------------------------------------------------

def test_quick_log_creates_entry(client, db_path):
    response = client.post(
        "/api/entries", data={"category": "Python", "minutes": "45", "deep": "1", "note": "numpy"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    rows = fetch(db_path, "SELECT * FROM entries")
    assert len(rows) == 1
    row = rows[0]
    assert (row["category"], row["deep"], row["source"], row["note"]) == ("Python", 1, "live", "numpy")
    assert timeutil.from_iso(row["end_utc"]) == NOW
    assert timeutil.from_iso(row["end_utc"]) - timeutil.from_iso(row["start_utc"]) == timedelta(minutes=45)


def test_quick_log_via_htmx_returns_partial_and_updates_bars(client, db_path):
    response = client.post("/api/entries", data={"category": "Math", "minutes": "40", "deep": "1"}, headers=HX)
    assert response.status_code == 200
    assert "<html" not in response.text
    events = json.loads(response.headers["HX-Trigger"])["witness:events"]
    assert events[0]["kind"] == "log" and "Math logged" in game.toast_text(events)
    assert any(e["kind"] == "floor" for e in events)  # 40 deep minutes cross the 30 minute floor


def test_quick_log_non_ladder_is_never_deep(client, db_path):
    client.post("/api/entries", data={"category": "Rest", "minutes": "20", "deep": "1"})
    assert fetch(db_path, "SELECT deep FROM entries")[0]["deep"] == 0


@pytest.mark.parametrize("data", [
    {"category": "Nope", "minutes": "30"},
    {"category": "Python", "minutes": "0"},
    {"category": "Python", "minutes": "abc"},
    {"category": "Python", "minutes": "601"},
])
def test_quick_log_rejects_bad_input(client, db_path, data):
    response = client.post("/api/entries", data=data, headers=HX)
    assert response.status_code == 200
    assert fetch(db_path, "SELECT * FROM entries") == []
    assert "flash warn" in response.text


def test_quick_log_links_plan_block(client, db_path):
    with db.get_conn(db_path) as conn:
        block = rules.add_plan_block(conn, TODAY, "Python", 60, "19:30", "ch.6")
    client.post("/api/entries", data={"category": "Python", "minutes": "60", "deep": "1", "plan_block_id": str(block)})
    assert fetch(db_path, "SELECT plan_block_id FROM entries")[0]["plan_block_id"] == block


def test_typed_log_creates_parsed_entry(client, db_path):
    response = client.post("/log", data={"text": "45m numpy ex 1-12"}, headers=HX)
    assert response.status_code == 200
    rows = fetch(db_path, "SELECT * FROM entries")
    assert len(rows) == 1
    assert (rows[0]["category"], rows[0]["source"], rows[0]["deep"]) == ("Python", "parsed", 1)
    minutes = (timeutil.from_iso(rows[0]["end_utc"]) - timeutil.from_iso(rows[0]["start_utc"])).total_seconds() / 60
    assert minutes == 45
    events = json.loads(response.headers["HX-Trigger"])["witness:events"]
    assert game.toast_text(events).startswith("45m Python logged.")


def test_typed_log_unreadable_gives_friendly_message(client, db_path):
    response = client.post("/log", data={"text": "blah blah"}, headers=HX)
    assert "couldn't read that" in unescaped(response).lower()
    assert "45m numpy ex 1-12" in response.text
    assert "HX-Trigger" not in response.headers
    assert fetch(db_path, "SELECT * FROM entries") == []


def test_typed_log_plain_post_redirects(client, db_path):
    response = client.post("/log", data={"text": "1h30 math LA 2.1"}, follow_redirects=False)
    assert response.status_code == 303
    assert fetch(db_path, "SELECT category FROM entries")[0]["category"] == "Math"


def test_typed_log_uses_llm_when_regex_fails(state, db_path):
    class FakeLLM:
        def complete_json(self, purpose, system, user, schema):
            return {"category": "Papers", "minutes": 30, "deep": True, "note": "attention paper"}

    state.llm = FakeLLM()
    response = TestClient(create_app(state)).post("/log", data={"text": "read the attention thing for a bit"})
    assert response.status_code == 200
    assert fetch(db_path, "SELECT category FROM entries")[0]["category"] == "Papers"


def test_delete_entry_api_and_form(client, db_path):
    client.post("/api/entries", data={"category": "Python", "minutes": "30", "deep": "1"})
    client.post("/api/entries", data={"category": "Math", "minutes": "30", "deep": "1"})
    first, second = [r["id"] for r in fetch(db_path, "SELECT id FROM entries ORDER BY id")]

    response = client.delete(f"/api/entries/{first}")
    assert response.status_code == 200 and response.json() == {"ok": True}
    assert fetch(db_path, "SELECT deleted FROM entries WHERE id = ?", first)[0]["deleted"] == 1

    htmx = client.delete(f"/api/entries/{second}", headers=HX)
    assert htmx.status_code == 200 and 'id="entries"' in htmx.text
    assert "Entry removed" in json.loads(htmx.headers["HX-Trigger"])["witness:events"][0]["title"]

    assert client.delete("/api/entries/9999").status_code == 404


def test_delete_entry_plain_form_fallback(client, db_path):
    client.post("/api/entries", data={"category": "Python", "minutes": "30", "deep": "1"})
    entry_id = fetch(db_path, "SELECT id FROM entries")[0]["id"]
    response = client.post(f"/entries/{entry_id}/delete", follow_redirects=False)
    assert response.status_code == 303
    assert fetch(db_path, "SELECT deleted FROM entries")[0]["deleted"] == 1
    assert client.get("/").text.count("Delete this entry") == 0


def test_timeline_lists_entries_with_delete(client):
    client.post("/api/entries", data={"category": "Python", "minutes": "30", "deep": "1", "note": "pandas"})
    html = client.get("/").text
    assert "pandas" in html and "20:00 to 20:30" in html  # shown in local time
    assert 'hx-post="/entries/' in html and 'id="entries"' in html


# --------------------------------------------------------------------------
# Shipped, focus, skips
# --------------------------------------------------------------------------

def test_shipped_creates_output_and_meets_floor(client, db_path):
    response = client.post(
        "/outputs", data={"stage": "Python", "what": "numpy broadcasting notebook", "url": "github.com/me/nb"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    row = fetch(db_path, "SELECT * FROM outputs")[0]
    assert (row["stage"], row["what"], row["url"], row["local_date"]) == (
        "Python", "numpy broadcasting notebook", "https://github.com/me/nb", "2026-10-14")
    with db.get_conn(db_path) as conn:
        assert rules.day_summary(conn, TODAY, TODAY).floor_met
    html = client.get("/").text
    assert "numpy broadcasting notebook" in html
    assert 'href="https://github.com/me/nb"' in html


@pytest.mark.parametrize("data", [
    {"stage": "Python", "what": "x", "url": "javascript:alert(1)"},
    {"stage": "Python", "what": "   "},
    {"stage": "Rest", "what": "nap"},
])
def test_shipped_rejects_bad_input(client, db_path, data):
    response = client.post("/outputs", data=data, headers=HX)
    assert "flash warn" in response.text
    assert fetch(db_path, "SELECT * FROM outputs") == []


def test_focus_start_and_stop_creates_deep_entry(client, db_path, clock):
    start = client.post("/focus/start", data={"minutes": "50", "label": "numpy broadcasting", "category": "Python"}, headers=HX)
    assert "Focus started" in start.text
    page = client.get("/").text
    assert "numpy broadcasting" in page and 'data-js="focus-clock"' in page and "Cancel (logs nothing)" in page
    assert "already running" in client.post("/focus/start", data={"minutes": "10", "category": "Math"}, headers=HX).text

    clock.now = NOW + timedelta(minutes=30)
    stop = client.post("/focus/stop", data={"outcome": "full"}, headers=HX)
    assert "30m Python logged" in game.toast_text(json.loads(stop.headers["HX-Trigger"])["witness:events"])
    entry = fetch(db_path, "SELECT * FROM entries")[0]
    assert (entry["category"], entry["deep"], entry["source"], entry["note"]) == ("Python", 1, "focus", "numpy broadcasting")
    session = fetch(db_path, "SELECT * FROM focus_sessions")[0]
    assert session["outcome"] == "full" and session["entry_id"] == entry["id"]
    assert 'data-js="focus-clock"' not in client.get("/").text


def test_focus_pulled_away_is_not_deep_and_never_exceeds_plan(client, db_path, clock):
    client.post("/focus/start", data={"minutes": "25", "category": "Math"})
    clock.now = NOW + timedelta(hours=3)  # forgot to stop
    client.post("/focus/stop", data={"outcome": "pulled_away"})
    entry = fetch(db_path, "SELECT * FROM entries")[0]
    minutes = (timeutil.from_iso(entry["end_utc"]) - timeutil.from_iso(entry["start_utc"])).total_seconds() / 60
    assert entry["deep"] == 0 and minutes == 25


def test_focus_cancel_logs_nothing(client, db_path):
    client.post("/focus/start", data={"minutes": "25", "category": "Math"})
    client.post("/focus/stop", data={"outcome": "cancelled"})
    assert fetch(db_path, "SELECT * FROM entries") == []
    assert fetch(db_path, "SELECT outcome FROM focus_sessions")[0]["outcome"] == "cancelled"


def test_focus_stop_without_session(client):
    assert "No focus session" in client.post("/focus/stop", data={"outcome": "full"}, headers=HX).text


def test_skip_and_rest_day(client, db_path):
    response = client.post("/skip", data={"day": "2026-10-14", "kind": "rest", "reason": "tired"}, follow_redirects=False)
    assert response.status_code == 303
    row = fetch(db_path, "SELECT * FROM day_marks")[0]
    assert (row["local_date"], row["kind"], row["reason"]) == ("2026-10-14", "rest", "tired")
    client.post("/skip", data={"day": "2026-10-15"})
    out_of_skips = client.post("/skip", data={"day": "2026-10-16"})  # third skip in the week
    assert "No skips left" in out_of_skips.text


def test_plan_block_status_buttons(client, db_path):
    with db.get_conn(db_path) as conn:
        block = rules.add_plan_block(conn, TODAY, "Python", 60, "19:30", None)
    client.post(f"/plan/{block}/status", data={"status": "done"})
    assert fetch(db_path, "SELECT status FROM plan_blocks")[0]["status"] == "done"


# --------------------------------------------------------------------------
# Plan
# --------------------------------------------------------------------------

def test_plan_creates_blocks_with_if_then(client, db_path):
    response = client.post(
        "/plan",
        data={
            "day": "today",
            "category": ["Python", "Math", "Papers"],
            "minutes": ["60", "45", ""],
            "cue_time": ["19:30", "20:45", "21:30"],
            "task": ["ch.6 ex 1-10", "LA 2.1", ""],
        },
        follow_redirects=False,
    )
    assert response.status_code == 303
    rows = fetch(db_path, "SELECT * FROM plan_blocks ORDER BY id")
    assert len(rows) == 2
    assert rows[0]["if_then"] == "IF it's 19:30 and I'm home, THEN I open ch.6 ex 1-10."
    assert (rows[1]["category"], rows[1]["minutes"], rows[1]["cue_time"]) == ("Math", 45, "20:45")
    html = client.get("/plan").text
    assert "IF it&#39;s 19:30 and I&#39;m home, THEN I open ch.6 ex 1-10." in html
    assert "Today&#39;s plan" in client.get("/").text or "Today's plan" in client.get("/").text


def test_plan_tomorrow_uses_next_date(client, db_path):
    client.post("/plan", data={"day": "tomorrow", "category": ["Python"], "minutes": ["30"], "cue_time": ["19:30"], "task": [""]})
    assert fetch(db_path, "SELECT local_date FROM plan_blocks")[0]["local_date"] == "2026-10-15"


def test_plan_floor_only_preset(client, db_path):
    client.post("/plan", data={"day": "today", "preset": "floor"})
    row = fetch(db_path, "SELECT * FROM plan_blocks")[0]
    assert (row["minutes"], row["category"], row["cue_time"]) == (30, "Python", "19:30")


def test_plan_refuses_more_than_max_blocks(client, db_path):
    data = {"day": "today", "category": ["Python"] * 4, "minutes": ["30"] * 4, "cue_time": ["19:30"] * 4, "task": [""] * 4}
    response = client.post("/plan", data=data)
    assert response.status_code == 400
    assert "up to 3 blocks" in response.text
    assert fetch(db_path, "SELECT * FROM plan_blocks") == []


def test_plan_rejects_bad_time_and_empty(client, db_path):
    bad = client.post("/plan", data={"category": ["Python"], "minutes": ["30"], "cue_time": ["25:99"], "task": [""]})
    assert bad.status_code == 400
    empty = client.post("/plan", data={"category": ["Python"], "minutes": [""], "cue_time": ["19:30"], "task": [""]})
    assert empty.status_code == 400
    assert fetch(db_path, "SELECT * FROM plan_blocks") == []


def test_plan_delete_block(client, db_path):
    client.post("/plan", data={"category": ["Python"], "minutes": ["30"], "cue_time": ["19:30"], "task": [""]})
    block = fetch(db_path, "SELECT id FROM plan_blocks")[0]["id"]
    client.post(f"/plan/{block}/delete", data={"day": "today"})
    assert fetch(db_path, "SELECT * FROM plan_blocks") == []


def test_plan_warns_about_overrun_from_week_three(tmp_path, db_path, clock):
    clock.now = datetime(2026, 10, 21, 15, 0, tzinfo=UTC)  # Wed of week 3
    with db.get_conn(db_path) as conn:
        for day in (date(2026, 10, 13), date(2026, 10, 14)):
            rules.add_plan_block(conn, day, "Python", 60, "19:30", None)  # planned, nothing done
        rules.add_plan_block(conn, date(2026, 10, 21), "Python", 120, "19:30", None)
    state = SimpleNamespace(config=make_config(tmp_path, db_path), db_path=db_path, telegram_app=None, aw=FakeAW(), llm=None)
    html = TestClient(create_app(state)).get("/plan").text
    assert "You usually finish about 0%" in html


def test_no_overrun_warning_in_week_two(client, db_path):
    with db.get_conn(db_path) as conn:
        rules.add_plan_block(conn, TODAY, "Python", 120, "19:30", None)
    assert "You usually finish" not in client.get("/plan").text


# --------------------------------------------------------------------------
# Evening close
# --------------------------------------------------------------------------

def test_close_records_job_block_then_labels_a_gap(client, db_path):
    response = client.post("/close", data={"day": "2026-10-14", "choice": "usual"}, follow_redirects=False)
    assert response.status_code == 303
    job = fetch(db_path, "SELECT * FROM entries WHERE category = 'Day job'")[0]
    assert timeutil.from_iso(job["start_utc"]) == local("10:00")
    assert timeutil.from_iso(job["end_utc"]) == local("19:00")
    assert "Recorded: 10:00 to 19:00" in client.get("/close").text

    with db.get_conn(db_path) as conn:
        gaps = rules.gaps(conn, TODAY)
    assert len(gaps) == 2  # 07:30-10:00 and 19:00-20:30
    start, end = gaps[1]
    page = unescaped(client.get("/close"))
    assert "19:00 to 20:30" in page
    assert "ActivityWatch" not in page  # not running, and the user does not use it: say nothing about it
    assert "Don't remember" in page

    label = client.post(
        "/close/label",
        data={"day": "2026-10-14", "start": timeutil.to_iso(start), "end": timeutil.to_iso(end), "category": "Commute"},
        follow_redirects=False,
    )
    assert label.status_code == 303
    entry = fetch(db_path, "SELECT * FROM entries WHERE category = 'Commute'")[0]
    assert (timeutil.from_iso(entry["start_utc"]), timeutil.from_iso(entry["end_utc"])) == (start, end)
    assert entry["source"] == "backfill" and entry["deep"] == 0
    with db.get_conn(db_path) as conn:
        assert len(rules.gaps(conn, TODAY)) == 1


def test_close_dont_remember_labels_unknown(client, db_path):
    with db.get_conn(db_path) as conn:
        start, end = rules.gaps(conn, TODAY)[0]
    client.post("/close/label", data={
        "day": "2026-10-14", "start": timeutil.to_iso(start), "end": timeutil.to_iso(end),
        "category": "Don't remember", "deep": "1"})
    entry = fetch(db_path, "SELECT * FROM entries")[0]
    assert (entry["category"], entry["deep"]) == ("Unknown", 0)


def test_close_job_choices_replace_earlier_answer(client, db_path):
    client.post("/close", data={"day": "2026-10-14", "choice": "usual"})
    client.post("/close", data={"day": "2026-10-14", "choice": "left_early"})
    live = fetch(db_path, "SELECT * FROM entries WHERE deleted = 0 AND category = 'Day job'")
    assert len(live) == 1 and timeutil.from_iso(live[0]["end_utc"]) == local("17:00")
    client.post("/close", data={"day": "2026-10-14", "choice": "leave"})
    assert fetch(db_path, "SELECT * FROM entries WHERE deleted = 0") == []


def test_close_rejects_bad_label(client, db_path):
    response = client.post("/close/label", data={"day": "2026-10-14", "start": "nope", "end": "nope", "category": "Python"})
    assert "Couldn" in response.text
    assert fetch(db_path, "SELECT * FROM entries") == []


def test_close_shows_activitywatch_suggestions_and_saves_one(tmp_path, db_path, clock):
    events = [AWEvent(local("19:00"), local("19:45"), "Code", "numpy.py", None)]
    state = SimpleNamespace(
        config=make_config(tmp_path, db_path), db_path=db_path, telegram_app=None,
        aw=FakeAW(events, available=True), llm=None,
    )
    client = TestClient(create_app(state))
    client.post("/close", data={"day": "2026-10-14", "choice": "usual"})
    page = client.get("/close").text
    assert "ActivityWatch thinks" in page
    assert "19:00 to 19:45 Python" in page

    with db.get_conn(db_path) as conn:
        start = timeutil.to_iso(local("19:00"))
    client.post("/close/label", data={
        "day": "2026-10-14", "start": start, "end": timeutil.to_iso(local("19:45")),
        "category": "Python", "deep": "1", "source": "aw"})
    entry = fetch(db_path, "SELECT * FROM entries WHERE category = 'Python'")[0]
    assert (entry["source"], entry["deep"]) == ("aw", 1)


def test_close_summary(client):
    client.post("/api/entries", data={"category": "Python", "minutes": "40", "deep": "1"})
    page = client.get("/close").text
    assert "Deep <strong>40m</strong>" in page and "floor <strong>met</strong>" in page


# --------------------------------------------------------------------------
# Grid
# --------------------------------------------------------------------------

def test_grid_colours_logged_hours(client):
    client.post("/api/entries", data={"category": "Python", "minutes": "50", "deep": "1"})
    html = client.get("/grid").text
    assert html.count("<tr>") == 25  # header + 24 hours
    assert "--c: var(--c-python)" in html  # ladder categories use the theme's tuned token, not the stored hex
    assert 'class="cell logged"' in html
    assert "Python" in html and "50m" in html  # totals
    assert "ActivityWatch" not in html  # nothing about it while it is not running


def test_grid_shows_faded_aw_suggestions(tmp_path, db_path, clock):
    events = [AWEvent(local("18:00"), local("19:00"), "Code", "x", None)]
    state = SimpleNamespace(
        config=make_config(tmp_path, db_path), db_path=db_path, telegram_app=None,
        aw=FakeAW(events, available=True), llm=None,
    )
    html = TestClient(create_app(state)).get("/grid").text
    assert 'class="cell aw"' in html
    assert "not saved" in html


# --------------------------------------------------------------------------
# Lapse
# --------------------------------------------------------------------------

def test_lapse_banner_and_skip_flow(client, db_path):
    assert 'href="/lapse"' in client.get("/").text  # Tuesday had nothing logged
    page = client.get("/lapse").text
    assert "Tue 13 Oct" in page and "Mark it as rest" in page and "didn't reach the 30-minute floor" in page
    assert "smallest" not in page and "Tonight's minimum plan" in page and "if-then" not in page

    response = client.post(
        "/lapse",
        data={"reason": "work_late", "choice": "skip", "minutes": "25", "cue_time": "19:30", "task": "ch.6 ex 1-3"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    lapse = fetch(db_path, "SELECT * FROM lapses")[0]
    assert (lapse["local_date"], lapse["reason"], lapse["choice"]) == ("2026-10-13", "work_late", "skip")
    assert fetch(db_path, "SELECT local_date FROM day_marks")[0]["local_date"] == "2026-10-13"
    block = fetch(db_path, "SELECT * FROM plan_blocks")[0]
    assert (block["local_date"], block["minutes"]) == ("2026-10-14", 25)
    assert block["if_then"] == "IF it's 19:30 and I'm home, THEN I open ch.6 ex 1-3."
    assert 'href="/lapse"' not in client.get("/").text
    assert "Nothing to look back on" in client.get("/lapse").text


def test_lapse_repair_opens_window_banner(client, db_path):
    client.post("/lapse", data={"reason": "tired", "choice": "repair", "minutes": "0"})
    assert fetch(db_path, "SELECT choice FROM lapses")[0]["choice"] == "repair"
    assert fetch(db_path, "SELECT * FROM plan_blocks") == []  # "Not today"
    html = client.get("/").text
    assert "Repair window open" in html and "Tue 13 Oct" in html


def test_lapse_skip_without_skips_left_becomes_let_go(client, db_path):
    client.post("/skip", data={"day": "2026-10-12"})
    client.post("/skip", data={"day": "2026-10-14"})
    response = client.post("/lapse", data={"reason": "other", "choice": "skip", "minutes": "0"}, follow_redirects=True)
    assert "No rest days were left" in response.text
    assert fetch(db_path, "SELECT choice FROM lapses")[0]["choice"] == "let_go"


def test_lapse_requires_a_choice(client, db_path):
    response = client.post("/lapse", data={"reason": "tired", "minutes": "25"})
    assert response.status_code == 400
    assert fetch(db_path, "SELECT * FROM lapses") == []


def test_lapse_post_without_pending_lapse(client, db_path):
    client.post("/api/entries", data={"category": "Python", "minutes": "30", "deep": "1"})
    with db.get_conn(db_path) as conn:
        rules.add_entry(conn, local("20:00", date(2026, 10, 13)), local("21:00", date(2026, 10, 13)), "Python", True, "live")
    response = client.post("/lapse", data={"choice": "repair", "minutes": "0"}, follow_redirects=True)
    assert "Nothing to look back on" in response.text
    assert fetch(db_path, "SELECT * FROM lapses") == []


# --------------------------------------------------------------------------
# Week, contract, referee
# --------------------------------------------------------------------------

def test_week_page_shows_report_in_textarea_with_copy_button(client):
    client.post("/outputs", data={"stage": "Python", "what": "numpy notebook", "url": "https://github.com/me/nb"})
    html = client.get("/week").text
    assert "<textarea" in html and "Copy</button>" in html
    assert "Week 1 so far: 1 of 2 outputs" in html
    assert "• numpy notebook (https://github.com/me/nb)" in html
    assert "next week: 2 outputs + 5 floor days" in html


def test_referee_report_for_kept_and_not_kept_weeks(client, db_path):
    with db.get_conn(db_path) as conn:
        rules.add_output(conn, date(2026, 10, 12), "Python", "first", None)
        rules.add_output(conn, date(2026, 10, 13), "Math", "second", "https://x.com/a")
    # Week of 10-12 is still in progress with 2 outputs but few floor days.
    assert "Week 1 so far: 2 of 2 outputs" in client.get("/week?week=2026-10-12").text
    # The baseline week reads differently, with no verdict.
    baseline = client.get("/week?week=2026-10-05").text
    assert "Baseline week: 0 outputs logged, no targets yet." in baseline


def test_referee_report_not_this_week(tmp_path, db_path, clock):
    clock.now = datetime(2026, 10, 21, 15, 0, tzinfo=UTC)
    state = SimpleNamespace(config=make_config(tmp_path, db_path), db_path=db_path, telegram_app=None, aw=FakeAW(), llm=None)
    html = TestClient(create_app(state)).get("/week?week=2026-10-12").text
    assert "Week 1: 0 of 2 outputs. Not this week." in html
    assert "not this week" in html


def test_contract_raise_applies_now_and_lower_waits(client, db_path):
    with db.get_conn(db_path) as conn:
        assert rules.contract_for(conn, TODAY)["outputs_per_week"] == 2

    raised = client.post("/week", data={"action": "change", "outputs": "3", "floor_days": "5"}, follow_redirects=True)
    assert "from this Monday" in raised.text
    with db.get_conn(db_path) as conn:
        current = rules.contract_for(conn, TODAY)
        assert (current["outputs_per_week"], current["floor_days_per_week"]) == (3, 5)

    lowered = client.post("/week", data={"action": "change", "outputs": "2", "floor_days": "4"}, follow_redirects=True)
    assert "starts Monday 19 Oct" in lowered.text
    with db.get_conn(db_path) as conn:
        assert rules.contract_for(conn, TODAY)["outputs_per_week"] == 3  # unchanged this week
        assert rules.contract_for(conn, date(2026, 10, 19))["floor_days_per_week"] == 4
    assert "Starting next Monday: 2 outputs + 4 floor days" in client.get("/week").text


def test_contract_keep_and_validation(client, db_path):
    kept = client.post("/week", data={"action": "keep"}, follow_redirects=True)
    assert "stays as it is" in kept.text
    bad = client.post("/week", data={"action": "change", "outputs": "x", "floor_days": "9"}, follow_redirects=True)
    assert "Outputs can be 0 to 14" in bad.text
    assert len(fetch(db_path, "SELECT * FROM contracts")) == 1


def test_send_to_referee(tmp_path, db_path, clock):
    bot = FakeBot()
    state = SimpleNamespace(
        config=make_config(tmp_path, db_path, telegram=True), db_path=db_path,
        telegram_app=SimpleNamespace(bot=bot), aw=FakeAW(), llm=None,
    )
    client = TestClient(create_app(state))
    assert "Send to referee" not in client.get("/week").text  # no referee set yet
    with db.get_conn(db_path) as conn:
        db.set_setting(conn, "referee_chat_id", 777)
    assert "Send to referee" in client.get("/week").text
    response = client.post("/week/send", data={"week": "2026-10-12"}, follow_redirects=True)
    assert "Sent to your referee" in response.text
    assert bot.sent and bot.sent[0][0] == 777 and "Week 1 so far" in bot.sent[0][1]


def test_send_to_referee_survives_telegram_errors_and_missing_setup(tmp_path, db_path, clock):
    state = SimpleNamespace(
        config=make_config(tmp_path, db_path, telegram=True), db_path=db_path,
        telegram_app=SimpleNamespace(bot=FakeBot(fail=True)), aw=FakeAW(), llm=None,
    )
    client = TestClient(create_app(state))
    assert "need to be set up" in client.post("/week/send", data={"week": ""}, follow_redirects=True).text
    with db.get_conn(db_path) as conn:
        db.set_setting(conn, "referee_chat_id", 777)
    assert "Couldn't reach Telegram" in unescaped(client.post("/week/send", data={"week": ""}, follow_redirects=True))


def test_narration_button_only_with_llm_and_uses_only_numbers(state, db_path):
    client = TestClient(create_app(state))
    assert "free-model call" not in client.get("/week").text

    seen = {}

    class FakeLLM:
        def complete_text(self, purpose, system, user, max_tokens=400):
            seen["user"] = user
            return "You shipped 1 output."

    state.llm = FakeLLM()
    client = TestClient(create_app(state))
    client.post("/outputs", data={"stage": "Python", "what": "secret title", "url": "https://example.com/private"})
    assert "free-model call" in client.get("/week").text
    response = client.post("/week/narrate", data={"week": "2026-10-12"})
    assert "You shipped 1 output." in response.text
    assert "secret title" not in seen["user"] and "example.com" not in seen["user"]

    class SilentLLM:
        def complete_text(self, *args, **kwargs):
            return None

    state.llm = SilentLLM()
    response = TestClient(create_app(state)).post("/week/narrate", data={"week": ""})
    assert "No summary this time" in response.text


# --------------------------------------------------------------------------
# Outputs ledger
# --------------------------------------------------------------------------

def test_outputs_ledger_toggle_and_delete(client, db_path):
    client.post("/outputs", data={"stage": "Math", "what": "problem set 1", "url": "https://example.com/ps1"})
    html = client.get("/outputs").text
    assert "problem set 1" in html and "Private" in html and 'href="https://example.com/ps1"' in html
    output_id = fetch(db_path, "SELECT id FROM outputs")[0]["id"]

    client.post(f"/outputs/{output_id}/public")
    assert fetch(db_path, "SELECT is_public FROM outputs")[0]["is_public"] == 1
    assert "Public" in client.get("/outputs").text

    client.post(f"/outputs/{output_id}/delete")
    assert "problem set 1" not in client.get("/outputs").text
    assert fetch(db_path, "SELECT deleted FROM outputs")[0]["deleted"] == 1


def test_ledger_never_links_unsafe_urls(client, db_path):
    with db.get_conn(db_path) as conn:
        conn.execute(
            "INSERT INTO outputs(local_date, stage, url, what, created_at) VALUES ('2026-10-14', 'Python', 'javascript:alert(1)', 'bad', 'x')"
        )
    assert "javascript:" not in client.get("/outputs").text


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------

def settings_form(**overrides):
    data = {
        "timezone": "Asia/Kolkata", "day_start_hour": "4", "job_days": ["0", "1", "2", "3", "4"],
        "job_start": "10:00", "job_end": "19:00",
        "morning_time_weekday": "07:30", "morning_time_weekend": "08:30",
        "study_start_weekday": "19:30", "study_end_weekday": "23:00",
        "study_start_weekend": "10:00", "study_end_weekend": "22:00",
        "bedtime": "23:30", "sleep_cutoff": "00:30",
        "floor_minutes": "30", "target_weekday_minutes": "90", "target_weekend_minutes": "180",
        "deep_cap_minutes": "240", "skips_per_week": "2", "max_blocks_per_day": "3", "phase": "Python",
        "msg_cap": "4", "llm_daily_cap": "100", "referee_name": "", "referee_chat_id": "",
    }
    data.update(overrides)
    return data


def test_settings_page_shows_status(client):
    html = client.get("/settings").text
    assert "Telegram: not set up" in html
    assert "Free language model:" in html and "not set up" in html
    assert "ActivityWatch:" in html and "not reachable" in html
    assert "<code>" in html  # default AW rules are listed


def test_settings_status_when_everything_is_on(tmp_path, db_path, clock):
    class FakeLLM:
        daily_cap = 100

        def calls_today(self):
            return 7

    config = make_config(tmp_path, db_path, telegram=True)
    config = Config(**{**config.__dict__, "openrouter_api_key": "k", "openrouter_models": ("a/b:free",)})
    state = SimpleNamespace(config=config, db_path=db_path, telegram_app=None, aw=FakeAW(available=True), llm=FakeLLM())
    html = TestClient(create_app(state)).get("/settings").text
    assert "Telegram: configured" in html
    assert "7 of 100 calls today" in html and "a/b:free" in html
    assert "reachable" in html and "not reachable" not in html


def test_settings_save(client, db_path, state):
    class FakeLLM:
        daily_cap = 100

        def calls_today(self):
            return 0

    state.llm = FakeLLM()
    response = TestClient(create_app(state)).post(
        "/settings",
        data=settings_form(
            floor_minutes="45", job_days=["0", "1", "2"], bedtime="23:00", phase="Math", referee_name="Sam",
            referee_chat_id="12345", llm_daily_cap="60", silence_alert_ok="1",
        ),
        follow_redirects=True,
    )
    assert "Settings saved" in response.text
    with db.get_conn(db_path) as conn:
        settings = db.all_settings(conn)
    assert settings["floor_minutes"] == 45
    assert settings["job_days"] == [0, 1, 2]
    assert settings["bedtime"] == "23:00"
    assert settings["phase"] == "Math"
    assert settings["referee_name"] == "Sam" and settings["referee_chat_id"] == 12345
    assert settings["silence_alert_ok"] is True
    assert settings["start_date"] == "2026-10-05"  # untouched
    assert state.llm.daily_cap == 60


def test_settings_validation_saves_nothing(client, db_path):
    response = client.post(
        "/settings",
        data=settings_form(timezone="Mars/Olympus", floor_minutes="0", bedtime="25:61", phase="Day job", floor_x="1"),
    )
    assert response.status_code == 400
    assert "Nothing was saved" in response.text
    assert "isn&#39;t a known time zone" in response.text
    assert "Floor (deep minutes)" in response.text
    assert "use a time like 19:30" in response.text
    with db.get_conn(db_path) as conn:
        settings = db.all_settings(conn)
    assert settings["timezone"] == "Asia/Kolkata" and settings["floor_minutes"] == 30
    assert 'value="Mars/Olympus"' in response.text  # the typed value is kept for fixing


def test_settings_page_offers_the_new_choices_with_plain_help(client):
    html = unescaped(client.get("/settings"))
    assert "Third star: deep focus per day" in html
    for label in ("3 hours", "4 hours", "5 hours", "6 hours"):
        assert f">{label}</option>" in html
    assert re.search(r'<option value="240"\s+selected>4 hours', html)
    assert "Off (count every minute)" in html and '<option value="00:30" selected>12:30 AM' in html
    assert "still counts for Monday" in html            # day-start explanation
    assert "are still logged and shown, but don't count" in html


def test_settings_save_deep_star_day_start_and_cutoff(client, db_path):
    response = client.post(
        "/settings", data=settings_form(deep_star_minutes="300", day_start_hour="3", sleep_cutoff="01:30"),
        follow_redirects=True,
    )
    assert "Settings saved" in response.text
    with db.get_conn(db_path) as conn:
        settings = db.all_settings(conn)
    assert (settings["deep_star_minutes"], settings["day_start_hour"], settings["sleep_cutoff"]) == (300, 3, "01:30")
    client.post("/settings", data=settings_form(sleep_cutoff="off"))
    with db.get_conn(db_path) as conn:
        assert db.get_setting(conn, "sleep_cutoff") == "off"
    assert "Deep focus 5h today" in client.get("/").text


@pytest.mark.parametrize("overrides,message", [
    ({"deep_star_minutes": "200"}, "Third star: deep focus per day: pick one of"),
    ({"deep_star_minutes": "lots"}, "pick one of 3 hours, 4 hours, 5 hours, 6 hours"),
    ({"day_start_hour": "9"}, "use a whole number from 0 to 6"),
    ({"sleep_cutoff": "banana"}, "pick a time like 00:30, or Off"),
    ({"day_start_hour": "0", "sleep_cutoff": "00:30"}, "doesn't fit a day that starts at 00:00"),
    ({"sleep_cutoff": "08:00"}, "doesn't fit a day that starts at 04:00"),
])
def test_settings_validation_for_the_new_fields(client, db_path, overrides, message):
    response = client.post("/settings", data=settings_form(**overrides))
    assert response.status_code == 400
    assert message in unescaped(response)
    with db.get_conn(db_path) as conn:
        settings = db.all_settings(conn)
    assert (settings["deep_star_minutes"], settings["day_start_hour"], settings["sleep_cutoff"]) == (240, 4, "00:30")


def test_moving_the_day_boundary_keeps_entries_and_moves_auto_dated_outputs(client, db_path):
    with db.get_conn(db_path) as conn:
        night = timeutil.at_local(TODAY - timedelta(days=1), "01:00", "Asia/Kolkata", 4)   # 1 AM: Tuesday's day at 4, Wednesday's at 0
        conn.execute("INSERT INTO outputs(local_date, stage, url, what, created_at) VALUES (?, 'Python', NULL, 'night', ?)",
                     ("2026-10-13", timeutil.to_iso(night)))
        conn.execute("INSERT INTO outputs(local_date, stage, url, what, created_at) VALUES ('2026-10-01', 'Python', NULL, 'dated', ?)",
                     (timeutil.to_iso(night),))
        rules.add_entry(conn, night, night + timedelta(minutes=30), "Python", True, "live", None)
        entries_before = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
    assert client.post("/settings", data=settings_form(day_start_hour="0", sleep_cutoff="off")).status_code in (200, 303)
    with db.get_conn(db_path) as conn:
        dates = {r["what"]: r["local_date"] for r in conn.execute("SELECT what, local_date FROM outputs")}
        assert conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0] == entries_before
    assert dates["night"] == "2026-10-14"          # followed the new boundary
    assert dates["dated"] == "2026-10-01"          # a deliberately dated output stays put


def test_today_shows_progress_the_explainer_and_the_status_line(client):
    html = unescaped(client.get("/"))
    assert "Deep focus 4h today" in html and "0m of 4h" in html
    assert "smallest" not in html
    assert 'popovertarget="towerHow"' in html and "How your tower grows" in html
    assert "1 floor = 15 minutes of deep focus" in html and "Doors open at 30 minutes" in html
    assert "It tops out at 16 floors = 4h" in html and "Each thing you ship adds a beacon" in html
    assert 'data-js="tower-line"' in html and "Empty lot" in html and "crown at floor 6" in html


def test_today_page_says_when_it_is_still_yesterdays_day(client, clock):
    clock.now = datetime(2026, 10, 14, 21, 30, tzinfo=UTC)         # 3:00 AM IST on Thursday: still Wednesday's day
    html = unescaped(client.get("/"))
    assert "Still Wednesday's day until 4:00 AM. Late-night study counts for Wednesday." in html
    assert "past your 12:30 AM sleep cutoff" in html and "change the cutoff in Settings" in html
    assert 'data-js="rollover-note" hidden' not in html
    clock.now = NOW
    assert 'data-js="rollover-note" hidden' in unescaped(client.get("/"))


def test_api_today_carries_the_note_and_the_status_line(client):
    data = client.get("/api/today").json()
    assert data["today"]["tower_line"].startswith("Empty lot") and "rollover" in data
    assert data["quests"][2]["label"] == "Deep focus 4h today" and data["quests"][2]["detail"] == "0m of 4h"


def test_settings_roundtrip_keeps_defaults(client, db_path):
    client.get("/settings")
    client.post("/settings", data=settings_form())
    with db.get_conn(db_path) as conn:
        settings = db.all_settings(conn)
    for key, value in db.DEFAULT_SETTINGS.items():
        if key != "start_date":
            assert settings[key] == value, key


def test_aw_rules_add_and_delete(client, db_path):
    before = len(fetch(db_path, "SELECT * FROM aw_rules"))
    added = client.post(
        "/settings/aw-rules",
        data={"field": "url", "pattern": r"colab\.research", "category": "ML/DL", "deep": "1", "priority": "15"},
        follow_redirects=True,
    )
    assert "Rule added" in added.text
    rows = fetch(db_path, "SELECT * FROM aw_rules")
    assert len(rows) == before + 1
    new = [r for r in rows if r["priority"] == 15][0]
    assert (new["field"], new["category"], new["deep"]) == ("url", "ML/DL", 1)

    removed = client.post(f"/settings/aw-rules/{new['id']}/delete", follow_redirects=True)
    assert "Rule removed" in removed.text
    assert len(fetch(db_path, "SELECT * FROM aw_rules")) == before


@pytest.mark.parametrize("data", [
    {"field": "nope", "pattern": "x", "category": "Python", "priority": "1"},
    {"field": "app", "pattern": "", "category": "Python", "priority": "1"},
    {"field": "app", "pattern": "(unclosed", "category": "Python", "priority": "1"},
    {"field": "app", "pattern": "x", "category": "Bogus", "priority": "1"},
    {"field": "app", "pattern": "x", "category": "Python", "priority": "abc"},
])
def test_aw_rules_validation(client, db_path, data):
    before = len(fetch(db_path, "SELECT * FROM aw_rules"))
    response = client.post("/settings/aw-rules", data=data)
    assert response.status_code == 400
    assert len(fetch(db_path, "SELECT * FROM aw_rules")) == before


# --------------------------------------------------------------------------
# Safety
# --------------------------------------------------------------------------

def test_unknown_host_is_refused(client):
    assert client.get("/", headers={"host": "evil.example.com"}).status_code == 400
    assert client.get("/", headers={"host": "localhost:8765"}).status_code == 200
    assert client.get("/", headers={"host": "127.0.0.1:8765"}).status_code == 200


def test_cross_site_post_is_refused(client, db_path):
    response = client.post(
        "/api/entries", data={"category": "Python", "minutes": "30"},
        headers={"origin": "https://evil.example.com"},
    )
    assert response.status_code == 403
    assert fetch(db_path, "SELECT * FROM entries") == []
    ok = client.post(
        "/api/entries", data={"category": "Python", "minutes": "30"}, headers={"origin": "http://testserver"},
    )
    assert ok.status_code == 200


def test_create_app_without_state_builds_one_from_config(tmp_path, monkeypatch):
    monkeypatch.setenv("EPOCH_DATA_DIR", str(tmp_path / "data"))
    for name in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_USER_ID", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    client = TestClient(create_app())
    assert client.get("/health").json() == {"ok": True}
    assert (tmp_path / "data" / "witness.db").exists()


# --------------------------------------------------------------------------
# Fix pass: regression tests
# --------------------------------------------------------------------------

@pytest.mark.parametrize("path", [
    "/week?week=9999-12-31", "/week?week=0001-01-01", "/grid?week=0001-01-01", "/grid?week=9999-12-31",
    "/close?day=0001-01-01", "/close?day=9999-12-31",
])
def test_far_away_dates_fall_back_to_the_default_instead_of_a_500(client, path):
    assert client.get(path).status_code == 200


def test_far_away_dates_in_forms_do_not_crash(client):
    response = client.post("/skip", data={"day": "9999-12-31"}, follow_redirects=False)
    assert response.status_code == 303
    assert client.post("/close", data={"day": "0001-01-01", "choice": "usual"}, follow_redirects=False).status_code == 303


def test_leave_day_opens_the_job_hours_and_the_page_remembers_it(client, db_path):
    page = unescaped(client.get("/close"))
    assert "Recorded:" not in page and "07:30 to 10:00" in page and "10:00 to 19:00" not in page
    client.post("/close", data={"day": "2026-10-14", "choice": "leave"})
    page = unescaped(client.get("/close"))
    assert "Recorded: day off from the job" in page
    assert "07:30 to 20:30" in page                      # job hours are open for labelling


def test_answering_the_lapse_on_the_web_answers_the_lapse_card(client, db_path):
    with db.get_conn(db_path) as conn:
        conn.execute(
            "INSERT INTO slots(kind, local_date, ref_id, due_utc, status) VALUES ('lapse', ?, 0, '2026-10-14T02:00:00Z', 'pending')",
            (TODAY.isoformat(),),
        )
    client.post("/lapse", data={"reason": "tired", "choice": "let_go", "minutes": "0"})
    assert fetch(db_path, "SELECT status FROM slots WHERE kind = 'lapse'")[0]["status"] == "answered"


def test_an_overlong_output_line_is_cut(client, db_path):
    client.post("/outputs", data={"stage": "Python", "what": "w" * 3000, "url": ""})
    assert len(fetch(db_path, "SELECT what FROM outputs")[0]["what"]) == rules.MAX_WHAT_CHARS


# --------------------------------------------------------------------------
# JSON API (docs/game-design.md 9.4)
# --------------------------------------------------------------------------

def kinds(response) -> list[str]:
    return [e["kind"] for e in response.json()["events"]]


def test_api_today_shape(client):
    data = client.get("/api/today").json()
    assert data["ok"] is True and data["date"] == "2026-10-14"
    for key in ("today", "level", "tower", "quests", "stars", "wins", "repeat_chips", "week", "run", "lapse", "repair",
                "close", "ghost", "config", "as_of", "tz", "close_dot"):
        assert key in data, key
    assert set(data["today"]) >= {"deep_minutes", "floors", "floor_met", "target_met", "target_minutes", "ring", "over_cap_min"}
    assert set(data["level"]) >= {"number", "district", "xp", "into", "needed", "progress"}
    assert len(data["quests"]) <= 3 and len(data["week"]["days"]) == 7
    assert data["close_dot"] is False and data["close"]["evening"] is False  # 20:30 is before the evening window


def test_close_dot_shows_in_the_evening_window(client, clock):
    clock.now = datetime(2026, 10, 14, 17, 30, tzinfo=UTC)  # 23:00 IST
    assert client.get("/api/today").json()["close_dot"] is True
    html = client.get("/").text
    assert 'data-js="close-dot">' in html and 'data-js="close-dot" hidden' not in html


def test_api_world_shape_and_days_param(client):
    data = client.get("/api/world").json()
    assert set(data) >= {"as_of", "today", "tz", "config", "level", "totals", "days", "weeks", "landmarks", "ghost", "sky"}
    assert len(data["days"]) == 28 and len(data["weeks"]) == 4
    assert len(data["landmarks"]) == 5
    day = data["days"][-1 - 4]  # Wednesday of the current week
    assert day["date"] == "2026-10-14" and day["is_today"] is True
    assert set(day) >= {"floors", "doors", "crown", "lamps", "fog_minutes", "outputs", "state", "target_floor"}
    assert len(client.get("/api/world?days=7").json()["days"]) == 7


def test_api_shelf_shape(client):
    data = client.get("/api/shelf").json()
    assert set(data) >= {"level", "achievements", "counts", "ladders", "postcards", "decor", "outputs"}
    assert data["counts"]["total"] == len(data["achievements"]) >= 29
    assert len(data["ladders"]) == 5 and all(len(l["nodes"]) == 5 for l in data["ladders"])


def test_api_log_typed_text_returns_events_today_level(client, db_path):
    response = client.post("/api/log", json={"text": "45m numpy ex 1-12"})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True and body["toast"].startswith("45m Python logged.")
    assert body["today"]["deep_minutes"] == 45 and body["today"]["floor_met"] is True
    assert body["level"]["xp"] > 0
    assert kinds(response)[0] == "log" and "floor" in kinds(response)
    event = body["events"][0]
    assert set(event) >= {"kind", "size", "title", "detail", "fx"}
    assert fetch(db_path, "SELECT category, source FROM entries")[0]["source"] == "parsed"


def test_api_log_chip_body(client, db_path):
    response = client.post("/api/log", json={"category": "Math", "minutes": 30, "deep": True, "note": "LA 2.1"})
    assert response.json()["ok"] is True and "floor" in kinds(response)
    row = fetch(db_path, "SELECT * FROM entries")[0]
    assert (row["category"], row["deep"], row["note"], row["source"]) == ("Math", 1, "LA 2.1", "live")


def test_api_log_rest_chip_is_an_honest_hour_and_never_deep(client, db_path):
    response = client.post("/api/log", json={"category": "Rest", "minutes": 30, "deep": True, "rest": True})
    assert response.json()["ok"] is True and "floor" not in kinds(response)
    assert fetch(db_path, "SELECT category, deep FROM entries")[0]["deep"] == 0
    assert client.get("/api/today").json()["tower"]["lamps"] == [{"category": "Rest", "n": 1}]


@pytest.mark.parametrize("body", [
    {"text": "blah blah"}, {"category": "Python"}, {"category": "Nope", "minutes": 30}, {"category": "Python", "minutes": 0}, {},
])
def test_api_log_unreadable_is_a_kind_hint_with_http_200(client, db_path, body):
    response = client.post("/api/log", json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is False and data["hint"]
    assert fetch(db_path, "SELECT * FROM entries") == []


def test_api_log_events_for_floor_then_target(client, clock):
    first = client.post("/api/log", json={"category": "Python", "minutes": 30, "deep": True})
    assert "floor" in kinds(first) and "target" not in kinds(first)
    clock.now = NOW + timedelta(minutes=60)
    second = client.post("/api/log", json={"category": "Python", "minutes": 60, "deep": True})
    assert "target" in kinds(second) and "floor" not in kinds(second)
    target = next(e for e in second.json()["events"] if e["kind"] == "target")
    assert target["fx"]["confetti"] > 0
    clock.now = NOW + timedelta(minutes=90)
    third = client.post("/api/log", json={"category": "Python", "minutes": 15, "deep": True})
    assert "target" not in kinds(third) and "floor" not in kinds(third)  # each moment is celebrated once


def test_api_outputs_event_and_beacon(client, db_path):
    response = client.post("/api/outputs", json={"stage": "Math", "what": "LA notes", "url": "github.com/me/la"})
    body = response.json()
    assert body["ok"] is True and "output" in kinds(response)
    output = next(e for e in body["events"] if e["kind"] == "output")
    assert output["fx"]["beacon"] and output["size"] == "big"
    assert body["today"]["outputs"] == 1 and body["today"]["floor_met"] is True
    assert fetch(db_path, "SELECT url FROM outputs")[0]["url"] == "https://github.com/me/la"


@pytest.mark.parametrize("body", [{"stage": "Math", "what": "x", "url": "javascript:alert(1)"}, {"stage": "Math", "what": "  "}, {"stage": "Rest", "what": "nap"}])
def test_api_outputs_rejects_bad_input_with_hint(client, db_path, body):
    response = client.post("/api/outputs", json=body)
    assert response.status_code == 200 and response.json()["ok"] is False and response.json()["hint"]
    assert fetch(db_path, "SELECT * FROM outputs") == []


def test_api_focus_stop(client, db_path, clock):
    client.post("/focus/start", data={"minutes": "50", "label": "numpy", "category": "Python"})
    clock.now = NOW + timedelta(minutes=40)
    response = client.post("/api/focus/stop", json={"outcome": "full"})
    body = response.json()
    assert body["ok"] is True and body["entry"]["minutes"] == 40 and "floor" in kinds(response)
    assert client.post("/api/focus/stop", json={"outcome": "full"}).json()["ok"] is False  # nothing running


def test_api_day_mark_rest_and_skip_limit(client, db_path):
    response = client.post("/api/day-mark", json={"kind": "rest", "reason": "tired"})
    assert response.json()["ok"] is True and kinds(response) == ["rest"]
    assert fetch(db_path, "SELECT kind FROM day_marks")[0]["kind"] == "rest"
    client.post("/api/day-mark", json={"day": "2026-10-13", "kind": "skip"})
    third = client.post("/api/day-mark", json={"day": "2026-10-12", "kind": "skip"})
    assert third.status_code == 200 and third.json()["ok"] is False and "floor is only" in third.json()["hint"]


def test_api_close_label_and_seal_flow(tmp_path, db_path, clock):
    events = [AWEvent(local("19:00"), local("19:45"), "Code", "numpy.py", None)]
    state = SimpleNamespace(config=make_config(tmp_path, db_path), db_path=db_path, telegram_app=None, aw=FakeAW(events, True), llm=None)
    client = TestClient(create_app(state))
    client.post("/close", data={"day": "2026-10-14", "choice": "usual"})
    client.post("/api/log", json={"category": "Python", "minutes": 45, "deep": True})
    sealed_early = client.post("/api/close/seal", json={})
    assert sealed_early.status_code == 200 and sealed_early.json()["ok"] is False and "open" in sealed_early.json()["hint"]

    clock.now = NOW + timedelta(hours=2, minutes=15)      # 22:45 IST: past bedtime minus an hour
    with db.get_conn(db_path) as conn:
        gaps = rules.gaps(conn, TODAY)
    assert gaps
    remaining = None
    for start, end in gaps:
        label = client.post("/api/close/label", json={
            "day": "2026-10-14", "start": timeutil.to_iso(start), "end": timeutil.to_iso(end), "category": "Don't remember"})
        body = label.json()
        assert body["ok"] is True and "fog_minutes" in body and "remaining_gaps" in body
        remaining = body["remaining_gaps"]
    assert remaining == 0
    seal = client.post("/api/close/seal", json={"day": "2026-10-14"})
    body = seal.json()
    assert body["ok"] is True and body["toast"] == "Day 10 sealed." and body["recap"]["sealed"] is True
    assert "seal" in kinds(seal)
    again = client.post("/api/close/seal", json={}).json()
    assert again["ok"] is True and again["newly_sealed"] is False  # sealing twice is harmless
    assert client.get("/api/today").json()["close"]["sealed"] is True
    assert client.get("/close").text.count('data-sealed="1"') == 1


def test_api_close_label_bad_stretch_is_a_hint(client):
    response = client.post("/api/close/label", json={"start": "x", "end": "y", "category": "Python"})
    assert response.status_code == 200 and response.json()["ok"] is False


def test_api_settings_game_roundtrip(client, db_path):
    response = client.post("/api/settings/game", json={"quiet_mode": True, "sound": True, "motion": "off", "sky_tz": "ny"})
    body = response.json()
    assert body["ok"] is True and body["settings"]["quiet_mode"] is True and body["settings"]["sky_tz"] == "ny"
    page = client.get("/").text
    assert 'data-quiet="1"' in page and 'data-sound="1"' in page and 'data-motion="off"' in page and 'data-sky-tz="ny"' in page
    assert 'class="quiet ' in page
    assert client.get("/api/today").json()["quiet"] is True
    for bad in ({"motion": "sideways"}, {"quiet_mode": "maybe"}, {"nonsense": 1}, {}):
        r = client.post("/api/settings/game", json=bad)
        assert r.status_code == 200 and r.json()["ok"] is False


def test_settings_page_has_game_toggles_and_old_fields(client):
    html = client.get("/settings").text
    for name in ("game_enabled", "quiet_mode", "sound", "motion", "three_d", "sky_tz", "hide_achievements"):
        assert f'name="{name}"' in html and 'data-js="game-setting"' in html
    assert 'data-js="theme-choice"' in html
    for old in ("timezone", "floor_minutes", "job_days", "referee_name", "ActivityWatch rules", "Telegram"):
        assert old in html


def test_game_settings_plain_form_saves_and_unticked_boxes_turn_off(client, db_path):
    client.post("/api/settings/game", json={"quiet_mode": True, "sound": True})
    response = client.post("/settings/game", data={"motion": "on", "three_d": "off", "sky_tz": "local"}, follow_redirects=False)
    assert response.status_code == 303
    values = client.post("/api/settings/game", json={"sound": False}).json()["settings"]
    assert values["quiet_mode"] is False and values["motion"] == "on" and values["three_d"] == "off"


# --------------------------------------------------------------------------
# HTMX events and plain-redirect flashes
# --------------------------------------------------------------------------

def test_htmx_routes_send_events_in_hx_trigger(client):
    response = client.post("/outputs", data={"stage": "Python", "what": "nb"}, headers=HX)
    assert response.status_code == 200
    events = json.loads(response.headers["HX-Trigger"])["witness:events"]
    assert "output" in [e["kind"] for e in events]
    response.headers["HX-Trigger"].encode("ascii")  # a valid header value


def test_htmx_skip_and_stop_send_events(client):
    skip = client.post("/skip", data={"day": "2026-10-14", "kind": "rest"}, follow_redirects=False)
    assert skip.status_code == 303 and "Rest+day+logged" in skip.headers["location"]


def test_plain_redirect_flash_carries_the_receipt_and_milestones(client):
    response = client.post("/log", data={"text": "45m numpy ex 1-12"}, follow_redirects=False)
    assert response.status_code == 303
    page = client.get(response.headers["location"])
    assert "45m Python logged" in unescaped(page) and "Doors open" in unescaped(page)


def test_plain_log_without_javascript_uses_chip_fields(client, db_path):
    response = client.post("/log", data={"text": "", "minutes": "45", "category": "Python"}, follow_redirects=False)
    assert response.status_code == 303
    row = fetch(db_path, "SELECT * FROM entries")[0]
    assert (row["category"], row["deep"]) == ("Python", 1)


def test_game_layer_failure_never_blocks_a_log(client, db_path, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("game layer down")
    monkeypatch.setattr(game, "snapshot", boom)
    monkeypatch.setattr(game, "finish_write", boom)
    response = client.post("/api/log", json={"category": "Python", "minutes": 30, "deep": True})
    assert response.status_code == 200
    assert len(fetch(db_path, "SELECT * FROM entries")) == 1


def test_xp_never_drops_when_an_entry_is_deleted(client, db_path):
    client.post("/api/log", json={"category": "Python", "minutes": 60, "deep": True})
    before = client.get("/api/today").json()["level"]["xp"]
    entry_id = fetch(db_path, "SELECT id FROM entries")[0]["id"]
    client.post(f"/entries/{entry_id}/delete")
    assert client.get("/api/today").json()["level"]["xp"] >= before


def test_visiting_pages_does_not_replay_old_celebrations(client):
    client.post("/api/log", json={"category": "Python", "minutes": 60, "deep": True})
    client.get("/"); client.get("/world")
    again = client.post("/api/log", json={"category": "Python", "minutes": 15, "deep": True})
    assert "floor" not in kinds(again) and "comeback" not in kinds(again)


# --------------------------------------------------------------------------
# World and Shelf pages
# --------------------------------------------------------------------------

def test_world_page_has_three_views_and_dom_hooks(client):
    client.post("/api/outputs", json={"stage": "Python", "what": "numpy notebook", "url": "https://example.com/nb"})
    html = client.get("/world").text
    for hook in ('data-js="world-tabs"', 'data-panel="city"', 'data-panel="week"', 'data-panel="shelf"', 'data-stage="city"',
                 'data-js="snapshot"', 'data-js="totals"', 'data-js="out-slots"', 'data-js="floor-pips"', 'data-js="rest-pips"',
                 'data-js="ghost-chart"', 'data-js="ach-grid"', 'data-js="ladders"', 'data-js="ach-count"'):
        assert hook in html, hook
    assert "<svg viewBox=\"0 0 420 300\"" in html  # 4 x 7 skyline fallback
    assert "numpy notebook" in html and 'href="https://example.com/nb"' in html  # outputs ledger
    assert "First Light" in html and "Referee report" in html and "Next week" in html
    assert "168-hour grid" in html and "Raise or lower to these numbers" in html


def test_world_week_view_keeps_referee_report_and_contract(client):
    html = client.get("/world?view=week&week=2026-10-05").text
    assert "Week of Mon 05 Oct" in html and 'id="report"' in html and 'data-js="copy-btn"' in html
    assert "Raise or lower" not in html  # only the current week can change the contract


def test_world_grid_opens_from_the_old_grid_url(client):
    response = client.get("/grid", follow_redirects=False)
    assert response.headers["location"].endswith("#week") and "grid=1" in response.headers["location"]
    assert "<details class=\"disclosure\" id=\"grid\" open>" in client.get(response.headers["location"].split("#")[0]).text


def test_shelf_shows_unlocked_achievement_after_a_log(client):
    client.post("/api/log", json={"category": "Python", "minutes": 30, "deep": True})
    html = client.get("/world").text
    assert 'class="achi on" data-key="first_light"' in html
    shelf = client.get("/api/shelf").json()
    assert next(a for a in shelf["achievements"] if a["key"] == "first_light")["unlocked"] is True


def test_close_page_has_seal_and_gap_hooks(client):
    html = client.get("/close").text
    for hook in ('data-js="gaps"', 'data-js="fog-count"', 'data-js="fog-label"', 'data-js="fog-minutes"', 'data-js="seal-card"',
                 'data-js="seal-btn"', 'data-js="seal-hint"', 'data-js="recap"', 'data-enhance="close-label"', 'data-enhance="close-seal"'):
        assert hook in html, hook
    assert 'action="/close/seal"' in html and "Don&#39;t remember" in html or "Don't remember" in html
    assert 'data-job-open="1"' in html  # Wednesday is a job day and the job question is open


def test_close_seal_plain_post_redirects_with_a_message(client):
    response = client.post("/close/seal", data={"day": "2026-10-14"}, follow_redirects=False)
    assert response.status_code == 303 and "msg=" in response.headers["location"]


# --------------------------------------------------------------------------
# Guardrails
# --------------------------------------------------------------------------

def test_host_and_origin_protection_covers_the_json_api(client):
    assert client.post("/api/log", json={"text": "30m math"}, headers={"host": "evil.example"}).status_code == 400
    assert client.get("/api/today", headers={"host": "evil.example"}).status_code == 400
    assert client.post("/api/log", json={"text": "30m math"}, headers={"origin": "http://evil.example"}).status_code == 403
    assert client.post("/api/settings/game", json={"quiet_mode": True}, headers={"origin": "http://evil.example"}).status_code == 403
    assert client.post("/api/log", json={"text": "30m math"}, headers={"origin": "http://testserver"}).status_code == 200


def test_pages_use_no_cdn_and_no_banned_words(client):
    client.post("/api/log", json={"category": "Python", "minutes": 60, "deep": True})
    paths = ["/", "/close", "/world", "/world?view=week", "/world?view=shelf", "/settings", "/plan", "/lapse", "/focus"]
    texts = [unescaped(client.get(p)) for p in paths]
    for path, text in zip(paths, texts):
        assert "http://cdn" not in text and "https://cdn" not in text and "googleapis" not in text, path
        visible = re.sub(r"<script.*?</script>|<style.*?</style>", "", text, flags=re.S)
        visible = re.sub(r"<[^>]+>", " ", visible)
        assert not game.has_banned_words(visible), (path, [w for w in game.BANNED_WORDS if w in visible.lower()])
    for api in ("/api/today", "/api/world", "/api/shelf"):
        assert not game.has_banned_words(client.get(api).text)


def test_missed_day_copy_stays_kind(tmp_path, db_path, clock):
    clock.now = datetime(2026, 10, 14, 15, 0, tzinfo=UTC)
    state = SimpleNamespace(config=make_config(tmp_path, db_path), db_path=db_path, telegram_app=None, aw=FakeAW(), llm=None)
    client = TestClient(create_app(state))
    html = unescaped(client.get("/"))
    assert 'id="lapseDlg"' in html and "lot is waiting" in html
    assert "One day is one day." in html


def test_pages_declare_an_inline_icon_so_browsers_do_not_request_favicon_ico(client):
    for path in ("/", "/close", "/world", "/settings"):
        assert 'rel="icon" href="data:image/svg+xml' in client.get(path).text


def test_python_user_facing_strings_have_no_banned_words():
    """Validation messages and bot replies live in Python source, outside the rendered pages the other test scans."""
    import ast
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent / "epoch"
    offenders = []
    for rel in ("web/app.py", "telegram_bot.py", "scheduler.py", "notify.py"):
        tree = ast.parse((root / rel).read_text())
        skip: set[int] = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module)):
                if node.body and isinstance(node.body[0], ast.Expr) and isinstance(getattr(node.body[0], "value", None), ast.Constant):
                    skip.add(id(node.body[0].value))
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in (
                    "debug", "info", "warning", "error", "exception", "critical"):
                skip.update(id(n) for n in ast.walk(node))
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in skip and game.has_banned_words(node.value):
                offenders.append((rel, node.lineno, node.value[:60]))
    assert not offenders, offenders


def test_week_panel_names_its_monday_and_uses_the_calm_status_words(client, db_path):
    html = client.get("/world?view=week&week=2026-10-05").text
    assert 'data-week-monday="2026-10-05"' in html
    assert ">missed<" not in html


def test_unreadable_typed_line_is_kept_in_the_field_without_javascript(client):
    posted = client.post("/log", data={"text": "zzz qqq <b>"}, follow_redirects=False)
    assert posted.status_code == 303
    page = client.get(posted.headers["location"])
    assert 'value="zzz qqq &lt;b&gt;"' in page.text


# --------------------------------------------------------------------------
# v2 front-end: Focus Screen, pairing UI, soundscape, lines, postcards
# --------------------------------------------------------------------------

STATIC = __import__("pathlib").Path(__file__).resolve().parent.parent / "epoch" / "web" / "static"


def test_focus_screen_is_a_kiosk_page_with_real_forms(client):
    page = client.get("/pomodoro")
    html = page.text
    assert page.status_code == 200
    assert 'data-js="focus"' in html and 'data-state="idle"' in html
    assert 'class="nav"' not in html and 'class="top"' not in html                      # no app chrome on the tablet screen
    assert 'action="/pomodoro/start"' in html and 'name="preset"' in html
    for preset in ("50-10-3", "25-5-4", "90-15-2"):
        assert f'value="{preset}"' in html
    for action in ("pause", "resume", "skip-break", "stop"):                              # every control works as a plain form
        assert f'action="/pomodoro/{action}"' in html
    assert 'data-js="stage" data-stage="week"' in html and "stage--cam" in html           # the construction cam
    assert 'data-js="fullscreen"' in html and 'data-js="sounds-open"' in html
    assert 'rel="manifest"' in html and has_asset(html, "app/focus.js") and has_asset(html, "app/audio.js")


def test_focus_screen_renders_a_running_block_and_the_rating_sheet(client):
    assert client.post("/api/pomodoro/start", json={"preset": "50-10-3", "category": "Python", "label": "numpy"}).json()["ok"]
    html = unescaped(client.get("/pomodoro"))
    assert 'data-state="work"' in html and "Deep work" in html and "Cycle 1 of 3" in html and "numpy" in html
    assert 'data-js="dial-time"' in html
    assert 'data-pending="0"' in html and "hidden" in re.search(r'<div class="rate"[^>]*>', html).group(0)
    assert 'name="focus" value="full"' in html and 'name="focus" value="pulled_away"' in html


def test_today_has_the_run_entry_flow_meter_weather_chip_and_soundscape(client):
    html = unescaped(client.get("/"))
    assert 'href="/pomodoro?new=1"' in html and "Start studying" in html                  # the Focus Screen, with the spot picker
    assert 'data-js="flow-meter"' in html and html.count('class="avlight') == 6          # six avenue lights
    assert 'data-js="weather-chip"' in html and 'data-js="today-run"' in html
    assert 'data-js="soundscape"' in html and 'value="subway"' in html and 'type="range"' in html
    assert 'data-js="postcard-nudge"' in html and 'class="nav__in"' in html


def test_today_flow_lights_fill_with_the_chain(client):
    client.post("/api/log", json={"category": "Python", "minutes": 90, "deep": True})
    html = client.get("/").text
    assert re.search(r'avlight is-on" style="--f:1\.00"', html)                            # one full hour lit
    assert re.search(r'avlight" style="--f:0\.5', html)                                    # the next lamp is half way


def test_settings_has_the_tablet_panel_and_the_new_toggles(owner):
    html = unescaped(owner.get("/settings"))
    assert "Use on your tablet" in html and 'data-js="lan-toggle"' in html and 'data-js="pair-btn"' in html
    assert 'data-js="device-list"' in html and 'action="/settings/lan/pair"' in html
    assert 'name="weather_enabled"' in html and 'name="seasonal_enabled"' in html
    assert has_asset(html, "app/lan.js")


def test_pair_page_is_standalone_and_big(owner, from_addr):
    assert owner.post("/api/settings/lan", json={"enabled": True}).json()["ok"]
    html = from_addr("192.168.1.40").get("/pair").text
    assert 'data-page="pair"' in html and 'class="nav"' not in html and "app/app.js" not in html
    assert 'name="code"' in html and 'autocomplete="one-time-code"' in html and 'inputmode="numeric"' in html
    assert "Pair this device" in html


def test_world_has_a_lines_tab_with_a_plain_list_underneath(client):
    html = unescaped(client.get("/world"))
    assert 'value="lines"' in html and 'data-panel="lines"' in html and 'data-js="subway"' in html
    assert "Python line" in html and "Hello Loop" in html                                  # the no-JS list of stations
    assert has_asset(html, "app/subway.js")
    assert 'data-js="postcard-gallery"' in html and 'data-js="postcard-open"' in html


def test_postcards_page_offers_the_flow_and_lists_saved_ones(client):
    import base64, struct, zlib

    def png(w=32, h=32):
        raw = b"".join(b"\x00" + b"\x00\x00\x00" * w for _ in range(h))
        chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
        return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

    empty = unescaped(client.get("/postcards"))
    assert "Make this week" in empty and 'data-js="postcard-list"' in empty and "No postcards yet" in empty
    saved = client.post("/api/postcards", json={"kind": "weekly", "period": "2026-10-12", "png_base64": base64.b64encode(png()).decode()})
    assert saved.json()["ok"]
    html = unescaped(client.get("/postcards"))
    assert "Week of Oct 12" in html and "/postcards/weekly-2026-10-12.png" in html and "download" in html


def test_v2_pages_use_no_cdn_and_no_banned_words(client, owner, from_addr):
    client.post("/api/log", json={"category": "Python", "minutes": 60, "deep": True})
    pages = {p: client.get(p).text for p in ("/", "/pomodoro", "/postcards", "/settings", "/world", "/world?view=shelf", "/settings/lan")}
    owner.post("/api/settings/lan", json={"enabled": True})
    pages["/pair"] = from_addr("192.168.1.40").get("/pair").text
    for path, text in pages.items():
        text = htmllib.unescape(text)
        assert "http://cdn" not in text and "https://cdn" not in text and "googleapis" not in text, path
        visible = re.sub(r"<script.*?</script>|<style.*?</style>", "", text, flags=re.S)
        visible = re.sub(r"<[^>]+>", " ", visible)
        assert not game.has_banned_words(visible), (path, [w for w in game.BANNED_WORDS if w in visible.lower()])


def test_v2_static_files_exist_and_the_manifest_is_installable(client):
    for name in ("focus.js", "audio.js", "lan.js", "subway.js", "postcard.js", "icon-192.png", "icon-512.png", "icon.svg", "manifest.webmanifest"):
        assert (STATIC / "app" / name).is_file(), name
        assert client.get(f"/static/app/{name}").status_code == 200, name
    manifest = json.loads((STATIC / "app" / "manifest.webmanifest").read_text())
    assert manifest["display"] == "standalone" and manifest["name"] and manifest["start_url"].startswith("/pomodoro")
    sizes = {i["sizes"] for i in manifest["icons"]}
    assert {"192x192", "512x512"} <= sizes
    for icon in manifest["icons"]:
        assert (STATIC.parent / icon["src"].lstrip("/")).is_file(), icon["src"]
    assert client.get("/static/app/manifest.webmanifest").headers["content-type"].startswith("application/manifest+json")
    for name in ("focus.js", "audio.js", "lan.js", "subway.js", "postcard.js"):           # no runtime CDN, no external requests
        source = (STATIC / "app" / name).read_text()
        assert not re.search(r"https?://(?!www\.w3\.org)", source), name


def test_nav_is_a_full_height_grid_column_not_a_fixed_overlay():
    css = (STATIC / "app" / "style.css").read_text()
    desktop = css[css.index("/* ---------- layout >= 900px"):]
    assert re.search(r"\.nav\{position:static;grid-column:1;grid-row:1", desktop)
    assert ".nav__in{position:sticky" in desktop
