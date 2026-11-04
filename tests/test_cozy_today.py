"""Today is the room (docs/COZY.md 3a): no hourly log card or docked log bar, the room with its HUD fills the screen, everything else is in
the Today drawer, "+ Add time" opens the old log form in a sheet, and GET / goes to the Focus Screen while a focus run is active."""
from __future__ import annotations

import re
from pathlib import Path

from epoch import game

APP = Path(__file__).resolve().parent.parent / "epoch" / "web" / "static" / "app"
TPL = Path(__file__).resolve().parent.parent / "epoch" / "web" / "templates"


def start(client, **body):
    body = {"category": "Python", "label": "numpy", **body}
    res = client.post("/api/pomodoro/start", json=body).json()
    assert res["ok"], res
    return res


def test_today_is_the_room_without_the_log_card(owner):
    html = owner.get("/").text
    assert "What did you do this hour" not in html
    assert 'data-js="home-dock"' not in html and 'data-no-dock' in html
    hud = html.split('data-js="home-hud"', 1)[1].split('data-js="today-drawer"', 1)[0]
    for hook in ("level-card", "hud-money", "hud-job", "hud-missions", "hud-chest", "hud-stars", "hud-deep", "start-studying",
                 "today-open", "hud-decorate", "hud-outside"):
        assert f'data-js="{hook}"' in hud, hook                     # the HUD is served with the page, usable before the 3D loads
    assert 'data-cozy-built="1"' in html
    assert 'href="/pomodoro?new=1"' in hud and "Start studying" in hud
    assert 'href="/world#city"' in hud and "Look outside" in hud and "Decorate" in hud
    assert "Your week in New York" not in html and 'data-js="day-btns"' not in html


def test_the_today_drawer_holds_the_rest(owner):
    owner.post("/api/log", json={"category": "Python", "minutes": 45, "deep": True, "note": "numpy"})
    owner.post("/api/outputs", json={"stage": "Python", "what": "a notebook"})
    html = owner.get("/").text
    drawer = html.split('id="todayDlg"', 1)[1].split("</dialog>", 1)[0]
    assert "Today's three" in drawer or "Today&#39;s three" in drawer
    assert "Clear Skies" in drawer and "Wins feed" in drawer and "Today's plan" in drawer.replace("&#39;", "'")
    assert "Today's log" in drawer.replace("&#39;", "'") and "Delete this entry" in drawer and "numpy" in drawer
    assert 'data-open-dialog="#logDlg"' in drawer and "Add time" in drawer
    assert 'data-open-dialog="#shipDlg"' in drawer and "Ship an output" in drawer
    assert 'data-js="ring-wrap"' in drawer and "Doors (floor)" in drawer


def test_add_time_is_the_old_log_form_in_a_sheet(owner):
    html = owner.get("/").text
    sheet = html.split('id="logDlg"', 1)[1].split("</dialog>", 1)[0]
    assert 'action="/log"' in sheet and 'data-js="log-form"' in sheet and 'data-js="log-text"' in sheet
    assert 'data-js="dur-chips"' in sheet and 'data-js="cat-chips"' in sheet and 'data-js="repeat-chips"' in sheet
    assert "Add time" in sheet and "without the timer" in sheet


def test_logging_still_works_without_javascript(owner):
    r = owner.post("/log", data={"text": "45m numpy ex 1-12"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/")
    page = owner.get(r.headers["location"]).text
    assert "numpy" in page                                          # the entry is in today's log, in the drawer


def test_today_goes_to_the_focus_screen_during_a_run(owner, v2_clock):
    assert owner.get("/", follow_redirects=False).status_code == 200        # idle: the room
    start(owner)
    r = owner.get("/", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/pomodoro"     # running
    owner.post("/api/pomodoro/pause", json={})
    assert owner.get("/", follow_redirects=False).headers["location"] == "/pomodoro"   # paused
    owner.post("/api/pomodoro/resume", json={})
    v2_clock.advance(minutes=51)
    assert owner.get("/api/pomodoro").json()["run"]["phase"] == "waiting"
    assert owner.get("/", follow_redirects=False).headers["location"] == "/pomodoro"   # the block-done hold
    # the bypass: Go home, and the links that must open the room
    for url in ("/?home=1", "/?decorate=1", "/?place=desk"):
        r = owner.get(url, follow_redirects=False)
        assert r.status_code == 200 and 'data-js="home-stage"' in r.text, url
    assert owner.get("/", headers={"HX-Request": "true"}, follow_redirects=False).status_code == 200


def test_today_redirect_on_a_break_and_back_home_after(owner, v2_clock):
    start(owner, preset="25-5-4")
    v2_clock.advance(minutes=26)
    owner.post("/api/pomodoro/rate", json={"focus": "full"})
    state = owner.get("/api/pomodoro").json()
    if state["run"] and state["run"]["phase"] == "waiting":
        owner.post("/api/pomodoro/next", json={})
        state = owner.get("/api/pomodoro").json()
    assert state["active"]
    assert owner.get("/", follow_redirects=False).headers["location"] == "/pomodoro"
    owner.post("/api/pomodoro/stop", json={})
    assert owner.get("/api/pomodoro").json()["active"] is False
    assert owner.get("/", follow_redirects=False).status_code == 200        # the run is over: home again


def test_a_flash_message_travels_with_the_redirect(owner):
    start(owner)
    r = owner.get("/?msg=Logged+Python.&kind=ok", follow_redirects=False)
    assert r.headers["location"].startswith("/pomodoro?msg=Logged+Python.")


def test_the_focus_screen_has_a_go_home_link(owner):
    html = owner.get("/pomodoro").text
    assert re.search(r'<a class="focus__back" href="/\?home=1"[^>]*>.*?Go home', html, re.S)


def test_today_copy_is_calm():
    raw = (TPL / "_today_main.html").read_text() + (TPL / "_log_sheet.html").read_text()
    text = re.sub(r"<script.*?</script>|<[^>]+>|\{[{%#].*?[}%#]\}", " ", raw, flags=re.S)
    assert not game.has_banned_words(text)
    assert "!" not in text


def test_today_css_block_is_at_the_end_and_js_stays_relative():
    css = (APP / "style.css").read_text()
    assert "COZY TODAY ROOM" in css and css.rstrip().endswith("/* ==== end COZY TODAY ROOM ==== */")
    app = (APP / "app.js").read_text()
    assert "renderHudDeep" in app and "initRoomDay" in app
    cozy = (APP / "cozy.js").read_text()
    assert "data-no-dock" in cozy
