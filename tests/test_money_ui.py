"""The money pages (Money, NYC Store, Passport, Home), the header wallet pill, the Sunday rent-day card on Close, the Settings star control
and the view helpers in epoch/web/money_ui.py. The frozen clock is Wed 2026-10-14 (conftest.V2_NOW)."""
from __future__ import annotations

import re

import pytest

from epoch import db, economy, game
from epoch import economy_catalog as cat
from epoch.web import money_ui


def fund(db_path, dollars):
    with db.get_conn(db_path) as conn:
        conn.execute("INSERT INTO econ_earned(local_date, source, cents, updated_utc) VALUES ('2026-10-06', 'output', ?, '2026-10-06T00:00:00Z') "
                     "ON CONFLICT(local_date, source) DO UPDATE SET cents = cents + excluded.cents", (dollars * 100,))


def buy(client, item):
    q = client.post("/api/shop/buy", json={"item": item}).json()
    assert q["ok"], q
    done = client.post("/api/shop/buy", json={"item": item, "price": q["quote"]["price"], "token": q["quote"]["token"]}).json()
    assert done["ok"], done


def quiet_on(db_path):
    with db.get_conn(db_path) as conn:
        db.set_setting(conn, "quiet_mode", True)


PAGES = ("/money", "/store", "/passport", "/home")


@pytest.mark.parametrize("path", PAGES)
def test_money_pages_render_with_the_tabs_and_the_wallet_pill(owner, path):
    r = owner.get(path)
    assert r.status_code == 200
    html = r.text
    assert 'data-js="wallet-pill"' in html and 'aria-label="Money sections"' in html
    assert 'data-nav="money"' in html and 'aria-current="page"' in html
    assert "/app/money.js" in html


def test_wallet_pill_shows_the_savings_everywhere(owner, v2_state):
    fund(v2_state.db_path, 1234)
    for path in ("/", "/world", "/settings", "/money"):
        assert re.search(r'data-js="wallet-num">\$1,2\d\d<', owner.get(path).text), path


def test_money_page_shows_rate_ladder_next_raise_and_week(owner):
    html = owner.get("/money").text
    assert "Barista" in html and "$25/h" in html
    assert "2 more skill nodes to Intern · $30/h" in html
    assert "Rent-day recap" in html and "Net worth" in html
    assert 'class="nw"' in html and "<svg" in html
    for label in ("Deep focus", "Shipped outputs", "Three-star days", "Kept week"):
        assert label in html


def test_store_has_four_aisles_the_on_now_strip_and_plain_gating(owner, v2_state):
    html = owner.get("/store").text
    for label in ("Furniture &amp; decor", "Outfits", "NYC experiences", "Tower upgrades", "On now"):
        assert label in html
    assert "Unlocks with Midtown &amp; Times Square, Level 13." in html
    assert 'data-item="desk_setup"' in html and "$150" in html
    assert html.count('data-js="aisle-panel"') == 4
    assert 'data-js="confirm-dlg"' in html


def test_store_item_states_follow_the_money(owner, v2_state):
    fund(v2_state.db_path, 400)
    html = owner.get("/store").text
    desk = re.search(r'<article class="item[^"]*" data-item="desk_setup".*?</article>', html, re.S).group(0)
    assert 'data-js="buy"' in desk and "aria-disabled" not in desk
    piano = re.search(r'<article class="item[^"]*" data-item="grand_piano".*?</article>', html, re.S).group(0)
    assert 'aria-disabled="true"' in piano and "more savings to go" in piano
    buy(owner, "desk_setup")
    html = owner.get("/store").text
    desk = re.search(r'<article class="item[^"]*" data-item="desk_setup".*?</article>', html, re.S).group(0)
    assert "In your room" in desk and 'data-js="equip"' in desk and "Move to storage" in desk


def test_outfit_and_upgrade_toggles_and_the_passport_link(owner, v2_state):
    fund(v2_state.db_path, 900)
    for item in ("columbia_hoodie", "string_lights", "columbia_lecture"):
        buy(owner, item)
    html = owner.get("/store").text
    assert "Wearing it" in html and "Take off" in html
    assert "Showing on your towers" in html and "Switch off" in html
    assert 'href="/passport#columbia_lecture"' in html


def test_event_strip_says_when_it_ends(owner):
    html = owner.get("/store").text
    assert "Fall leaves in Riverside Park" in html or "Next up" in html


def test_passport_postcards_have_art_and_a_fact(owner, v2_state):
    fund(v2_state.db_path, 200)
    assert "No postcards yet" in owner.get("/passport").text
    buy(owner, "columbia_lecture")
    html = owner.get("/passport").text
    assert 'class="pc"' in html and "<svg" in html and "Low Library" in html
    assert "Collected" in html and "Still to collect" in html


def test_every_experience_and_event_has_a_fact_and_a_scene():
    ids = [i["id"] for i in cat.ITEMS if i["kind"] == "experience"] + [e["id"] for e in cat.EVENTS]
    for item_id in ids:
        assert money_ui.fact_for(item_id), item_id
        svg = str(money_ui.postcard_svg(item_id))
        assert svg.startswith("<svg") and "<text" not in svg and len(svg) > 400, item_id


def test_postcard_copy_is_calm_and_clean():
    for fact in money_ui.FACTS.values():
        assert len(fact) < 140 and fact.endswith(".")
        assert not any(word in fact.lower() for word in game.BANNED_WORDS), fact


def test_home_page_shows_the_address_rent_ladder_and_storage(owner, v2_state):
    html = owner.get("/home").text
    assert "421 W 118th St" in html and "Pre-war walk-up studio" in html
    assert "Open my room" in html and 'data-js="open-room"' in html
    assert "In your room" in html and "Storage" in html and "Places to live" in html
    assert html.count('data-home="') == 15
    assert "Opens at Level 3, Harlem." in html
    assert "step down to the next smaller home" in html and "nothing is lost" in html


def test_home_page_lets_you_move_up_once_a_district_opens(owner, v2_state):
    with db.get_conn(v2_state.db_path) as conn:
        conn.execute("INSERT OR REPLACE INTO unlocks(key, kind, unlocked_at, meta) VALUES ('xp_hw', 'ratchet', '2026-10-05T00:00:00Z', '{\"xp\": 100000}')")
    fund(v2_state.db_path, 3000)
    html = owner.get("/home").text
    assert 'data-js="move"' in html and "Move here" in html


def test_close_shows_the_rent_day_card_only_on_sunday(owner, v2_state, monkeypatch):
    assert "rentday" not in owner.get("/close").text   # the frozen Wednesday
    from datetime import date
    from epoch.web import app as webapp
    real = webapp.rules.today_local
    monkeypatch.setattr(webapp.rules, "today_local", lambda conn: date(2026, 10, 18))
    html = owner.get("/close").text
    assert "Rent day" in html and "Earned this week" in html and "Savings now" in html


def test_quiet_mode_hides_every_money_page_and_the_pill(owner, v2_state):
    quiet_on(v2_state.db_path)
    for path in PAGES:
        html = owner.get(path).text
        assert "Money is tucked away" in html
        assert "$" not in re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S).split("<main", 1)[1].split("</main>")[0]
    top = owner.get("/").text
    assert 'data-js="wallet-pill" data-quiet-hide' in top and 'class="quiet ' in top.split(">")[1] + ">"


def test_settings_has_the_star_choice_and_the_route_saves_it(owner, v2_state):
    html = owner.get("/settings").text
    assert 'data-js="star-setting"' in html and "Quiet mode hides all money" in html and "Stars and money" in html
    r = owner.post("/api/settings/star", json={"minutes": 300}).json()
    assert r == {"ok": True, "deep_star_minutes": 300, "hours": 5}
    with db.get_conn(v2_state.db_path) as conn:
        assert game.deep_star_minutes(db.all_settings(conn)) == 300
    bad = owner.post("/api/settings/star", json={"minutes": 200}).json()
    assert bad["ok"] is False and "3, 4, 5 or 6" in bad["hint"]
    assert owner.post("/api/settings/star", json={}).json()["ok"] is False


def test_star_route_is_refused_cross_site(v2_app):
    from fastapi.testclient import TestClient
    c = TestClient(v2_app)
    r = c.post("/api/settings/star", json={"minutes": 300}, headers={"Origin": "http://evil.example"})
    assert r.status_code in (400, 403)


def test_helpers_format_money_and_dates():
    assert money_ui.usd(12345.9) == "$12,345" and money_ui.usd(-5) == "-$5" and money_ui.usd(None) == "$0"
    assert money_ui.usd_cents(24791) == "$247"
    assert money_ui.short_date("2026-11-15") == "Nov 15" and money_ui.long_date("2026-10-25") == "Sun 25 Oct"
    assert money_ui.week_range("2026-10-12", "2026-10-18") == "Oct 12 to Oct 18"
    assert money_ui.days_text(0) == "today" and money_ui.days_text(1) == "1 day" and money_ui.days_text(24) == "24 days"


def test_helpers_gate_and_event_text():
    locked = {"state": "locked", "district": "Midtown & Times Square", "unlocks_at_level": 13}
    assert money_ui.gate_text(locked) == "Unlocks with Midtown & Times Square, Level 13."
    assert money_ui.gate_text({"state": "available"}) == ""
    on = {"event": {"on": True, "end": "2026-11-15", "days_left": 24}}
    assert money_ui.event_text(on) == "Ends Nov 15, 24 days left"
    assert money_ui.event_text({"event": {"on": True, "end": "2026-11-15", "days_left": 0}}) == "Ends Nov 15, last day"
    soon = {"event": {"on": False, "start": "2026-10-29", "starts_in": 7}}
    assert money_ui.event_text(soon) == "Starts Oct 29, in 7 days"
    nxt = money_ui.next_event([soon, {"event": {"on": False, "start": "2026-12-01", "starts_in": 40}}, on])
    assert nxt is soon


def test_rate_line_matches_the_brief():
    rate = {"next": {"title": "Research Assistant", "per_hour": 45, "nodes_to_go": 3}}
    assert money_ui.rate_line(rate) == "3 more skill nodes to Research Assistant · $45/h"
    assert money_ui.rate_line({"next": {"title": "Intern", "per_hour": 30, "nodes_to_go": 1}}) == "1 more skill node to Intern · $30/h"
    assert "Top of the ladder" in money_ui.rate_line({"next": None})


def test_networth_chart_is_accessible_and_safe():
    series = [{"monday": "2026-10-05", "net_worth": 0, "live": False}, {"monday": "2026-10-12", "net_worth": 640, "live": False},
              {"monday": "2026-10-19", "net_worth": 1200, "live": True}]
    html = str(money_ui.networth_svg(series))
    assert 'role="img"' in html and "from $0 to $1,200" in html and html.count("nw__dot") >= 3 and ">now<" in html
    assert str(money_ui.networth_svg([])) == ""
    one = str(money_ui.networth_svg(series[:1]))
    assert "nw__dot" in one


def test_wallet_cents_reads_the_banked_rows(conn):
    assert money_ui.wallet_cents(conn) == 0
    conn.execute("INSERT INTO econ_earned(local_date, source, cents, updated_utc) VALUES ('2026-10-06', 'output', 5000, 'x')")
    assert money_ui.wallet_cents(conn) == 5000


def test_money_js_is_wired_and_keeps_to_the_rules():
    from pathlib import Path
    base = Path(__file__).resolve().parent.parent / "epoch" / "web" / "static" / "app"
    js = (base / "money.js").read_text()
    assert "/static/app/" not in js and "http://" not in js and "https://" not in js
    app = (base / "app.js").read_text()
    assert "WitnessMoney.after" in app
    css = (base / "style.css").read_text()
    assert css.rstrip().splitlines()[-1].startswith("@media") or "MONEY UI" in css
