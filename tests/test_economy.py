"""The money engine (epoch/economy.py): uncapped deep pay, raises, the ratchet, weekly rent, homes and storage, the shop, events.

Dates: the tracker starts Mon 2026-10-05 (conftest.START), so week 1 (Oct 5-11) is the rent-free baseline and the first rent is for the
week of Mon Oct 12. Deep work is logged at 08:00 local, well before the 00:30 sleep cutoff, unless a test says otherwise.
"""
from __future__ import annotations

import json
import sqlite3
import struct
from datetime import date, datetime, timedelta, timezone

import pytest

from epoch import db, economy, game, rules, timeutil
from epoch import economy_catalog as cat

TZ = "Asia/Kolkata"
D = lambda n: date(2026, 10, 5) + timedelta(days=n)        # noqa: E731 - D(0) = Mon Oct 5, D(7) = Mon Oct 12
NOON = lambda d: timeutil.at_local(d, "12:00", TZ, 4)      # noqa: E731
PEOPLE_RICH = 10 ** 9


def add(conn, d, minutes, hhmm="08:00", cat_="Python", deep=True):
    start = timeutil.at_local(d, hhmm, TZ, 4)
    return rules.add_entry(conn, start, start + timedelta(minutes=minutes), cat_, deep, "live", "work")


def ship(conn, d, n=1):
    for i in range(n):
        rules.add_output(conn, d, "Python", f"thing {i}")


def fund(conn, dollars, day="2026-10-05"):
    """Put money straight into the banked rows (a test shortcut for 'the user has earned this')."""
    conn.execute("INSERT INTO econ_earned(local_date, source, cents, updated_utc) VALUES (?, 'output', ?, '2026-10-05T00:00:00Z') "
                 "ON CONFLICT(local_date, source) DO UPDATE SET cents = cents + excluded.cents", (day, dollars * 100))


def set_level(conn, xp=100_000):
    """Move the XP ratchet up so every district is open (level 29+ needs 24,500 XP)."""
    conn.execute("INSERT OR REPLACE INTO unlocks(key, kind, unlocked_at, meta) VALUES ('xp_hw', 'ratchet', '2026-10-05T00:00:00Z', ?)",
                 (json.dumps({"xp": xp}),))


def unlock_nodes(conn, stamps):
    """Ledger rows for ladder nodes at given timestamps (the skill-ladder unlocks that give raises)."""
    keys = [f"node:{c}:{n}" for c in ("Python", "Math", "ML/DL", "Papers", "Writing/X") for n in range(1, 6)]
    for key, stamp in zip(keys, stamps):
        conn.execute("INSERT OR IGNORE INTO unlocks(key, kind, unlocked_at, meta) VALUES (?, 'node', ?, NULL)", (key, stamp))


def deep_cents(conn):
    """Banked deep-focus pay only (a 4 h day also earns the $50 three-star bonus, which is a separate source)."""
    return conn.execute("SELECT COALESCE(SUM(cents), 0) FROM econ_earned WHERE source = 'deep'").fetchone()[0]


def balance(conn, today, now=None):
    return economy.economy_state(conn, today=today, now=now or NOON(today))["balance_cents"]


# --------------------------------------------------------------------------
# Earning
# --------------------------------------------------------------------------

def test_deep_focus_pays_per_minute_with_no_daily_cap(conn):
    day = D(6)                                    # a Sunday
    add(conn, day, 8 * 60)                        # 8 h: XP stops at 4 h, money does not
    s = economy.economy_state(conn, today=day, now=NOON(day) + timedelta(hours=9))
    assert deep_cents(conn) == 8 * 60 * 25 * 100 // 60 == 20000
    assert s["balance_cents"] == 20000 + 5000                  # plus the $50 three-star bonus
    assert s["week"]["today"]["deep_minutes"] == 480
    assert game.day_xp(conn, day, day).deep == 60            # the XP cap (240 min -> 60 XP) is untouched


def test_the_pay_is_pro_rata_per_minute(conn):
    day = D(6)
    add(conn, day, 37)
    assert balance(conn, day) == 37 * 25 * 100 // 60       # 1541 cents, not rounded to the hour


def test_minutes_after_the_sleep_cutoff_do_not_pay(conn):
    day = D(6)
    add(conn, day, 6 * 60, hhmm="19:45")           # 19:45 to 01:45; the cutoff is 00:30
    assert rules.day_summary(conn, day, day).deep_minutes == 285
    balance(conn, day)
    assert deep_cents(conn) == 285 * 25 * 100 // 60


def test_outputs_pay_fifty_each_up_to_three_a_day(conn):
    day = D(6)
    ship(conn, day, 5)
    assert balance(conn, day) == 3 * 5000


def test_a_three_star_day_pays_the_bonus_once(conn):
    day = D(6)
    add(conn, day, 240)                            # first light + doors + 4 h deep = three stars
    s = economy.economy_state(conn, today=day, now=NOON(day) + timedelta(hours=5))
    assert game._Ctx(conn, day).stars(day) == 3
    assert s["week"]["earned"]["star"] == 50 and s["balance"] == 100 + 50
    assert s["stars"]["days"] == 1 and s["gold_days"] == [day.isoformat()]


def test_a_kept_week_pays_one_hundred(conn):
    for i in range(7, 12):                          # Mon-Fri of the first contract week: 5 floor days
        add(conn, D(i), 30)
    ship(conn, D(7), 2)
    today = D(13)
    s = economy.economy_state(conn, today=today, now=NOON(today))
    assert game._Ctx(conn, today).week(D(7)).status == "kept"
    assert s["week"]["earned"]["kept"] == 100


def test_the_balance_is_the_sum_of_every_source(conn):
    day = D(6)
    add(conn, day, 60)
    ship(conn, day, 1)
    assert balance(conn, day) == 2500 + 5000


# --------------------------------------------------------------------------
# Raises from skills
# --------------------------------------------------------------------------

def test_the_rate_follows_the_unlocked_nodes(conn):
    day = D(6)
    assert economy.economy_state(conn, today=day)["rate"]["title"] == "Barista"
    unlock_nodes(conn, ["2026-10-05T10:00:00Z", "2026-10-05T11:00:00Z"])
    rate = economy.economy_state(conn, today=day, now=NOON(day))["rate"]
    assert (rate["title"], rate["per_hour"], rate["nodes"]) == ("Intern", 30, 2)
    assert rate["next"]["title"] == "Columbia TA" and rate["next"]["nodes_to_go"] == 3
    assert [t["title"] for t in rate["ladder"]] == ["Barista", "Intern", "Columbia TA", "Research Assistant", "ML Engineer", "Founder"]
    assert [t["per_hour"] for t in rate["ladder"]] == [25, 30, 35, 45, 60, 80]


def test_a_raise_applies_from_the_moment_it_unlocks(conn):
    day = D(6)
    start = timeutil.at_local(day, "19:45", TZ, 4)                   # 4 h: 19:45-23:45
    rules.add_entry(conn, start, start + timedelta(hours=4), "Python", True, "live", "x")
    raise_at = timeutil.to_iso(start + timedelta(hours=2))           # the second node unlocks halfway through
    unlock_nodes(conn, ["2026-10-04T00:00:00Z", raise_at])
    balance(conn, day, start + timedelta(hours=5))
    assert deep_cents(conn) == 120 * 25 * 100 // 60 + 120 * 30 * 100 // 60     # $50 + $60


def test_an_earlier_day_keeps_the_old_rate_and_a_later_day_gets_the_new_one(conn):
    unlock_nodes(conn, ["2026-10-04T00:00:00Z", "2026-10-07T00:00:00Z"])      # the raise lands on Wed Oct 7 (05:30 IST)
    add(conn, D(1), 60)                                                        # Tue Oct 6: old rate
    add(conn, D(3), 60)                                                        # Thu Oct 8: new rate
    assert balance(conn, D(3)) == 2500 + 3000


def test_a_title_is_never_lowered_even_if_the_work_behind_it_disappears(conn):
    unlock_nodes(conn, ["2026-10-04T00:00:00Z", "2026-10-04T00:00:01Z"])
    day = D(6)
    assert economy.economy_state(conn, today=day)["rate"]["title"] == "Intern"
    conn.execute("UPDATE outputs SET deleted = 1")
    conn.execute("UPDATE entries SET deleted = 1")
    assert economy.economy_state(conn, today=day)["rate"]["title"] == "Intern"


def test_a_node_that_is_unlocked_but_not_yet_in_the_ledger_counts_from_now(conn):
    day = D(6)
    for cat_ in ("Python", "Math"):
        rules.add_output(conn, day, cat_, "first")                     # node 1 of two ladders by the gates (1 output each)
    now = NOON(day)
    rate = economy.economy_state(conn, today=day, now=now)["rate"]
    assert rate["nodes"] == 2 and rate["title"] == "Intern"
    assert rate["raises"][0]["at"] == timeutil.to_iso(now)


# --------------------------------------------------------------------------
# The ratchet
# --------------------------------------------------------------------------

def test_deleting_work_never_lowers_savings(conn):
    day = D(6)
    entry = add(conn, day, 120)
    out = rules.add_output(conn, day, "Python", "a notebook")
    before = balance(conn, day)
    assert before > 0
    conn.execute("UPDATE entries SET deleted = 1 WHERE id = ?", (entry,))
    conn.execute("UPDATE outputs SET deleted = 1 WHERE id = ?", (out,))
    assert balance(conn, day) == before


def test_a_past_purchase_stays_affordable_after_the_work_is_deleted(conn):
    day = D(6)
    entry = add(conn, day, 8 * 60)                                # $200
    state = economy.shop_state(conn, today=day, now=NOON(day))
    item = next(i for a in state["aisles"] for i in a["items"] if i["id"] == "bookshelf")
    economy.buy(conn, "bookshelf", item["price"], item["token"], today=day, now=NOON(day))
    conn.execute("UPDATE entries SET deleted = 1 WHERE id = ?", (entry,))
    after = economy.economy_state(conn, today=day, now=NOON(day))
    assert after["balance_cents"] == 5000                              # $250 earned, $200 spent: the star bonus stays, nothing goes below zero
    assert "bookshelf" in after["owned"]["furniture"]


def test_econ_earned_only_goes_up_and_the_ledger_is_append_only(conn):
    day = D(6)
    add(conn, day, 120)
    economy.sync(conn, today=day, now=NOON(day))
    conn.execute("UPDATE econ_earned SET cents = 1 WHERE source = 'deep'")           # the trigger ignores a lower value
    assert conn.execute("SELECT cents FROM econ_earned WHERE source = 'deep'").fetchone()[0] == 5000
    with pytest.raises(sqlite3.DatabaseError):
        conn.execute("DELETE FROM econ_earned")
    conn.execute("INSERT INTO econ_ledger(at_utc, kind, ref, cents) VALUES ('2026-10-05T00:00:00Z', 'rent', 'x', -1)")
    with pytest.raises(sqlite3.DatabaseError):
        conn.execute("UPDATE econ_ledger SET cents = 0")
    with pytest.raises(sqlite3.DatabaseError):
        conn.execute("DELETE FROM econ_ledger")


def test_sync_is_idempotent(conn):
    day = D(20)
    add(conn, D(8), 90)
    first = economy.sync(conn, today=day, now=NOON(day))
    second = economy.sync(conn, today=day, now=NOON(day))
    assert first["weeks_closed"] and second == {"banked": 0, "weeks_closed": []}
    rows = conn.execute("SELECT COUNT(*) FROM econ_ledger").fetchone()[0]
    economy.sync(conn, today=day, now=NOON(day))
    assert conn.execute("SELECT COUNT(*) FROM econ_ledger").fetchone()[0] == rows


# --------------------------------------------------------------------------
# Rent, interest, homes
# --------------------------------------------------------------------------

def test_the_baseline_week_is_rent_free_and_the_first_rent_is_for_the_first_contract_week(conn):
    for i in range(1, 5):
        add(conn, D(i), 120)                                        # 4 x $50 = $200 in the baseline week
    economy.sync(conn, today=D(7), now=NOON(D(7)))
    weeks = {m: json.loads(s) for m, s in conn.execute("SELECT monday, summary FROM econ_weeks")}
    assert weeks["2026-10-05"]["rent"]["status"] == "free" and weeks["2026-10-05"]["savings_end"] == 200
    assert not conn.execute("SELECT 1 FROM econ_ledger WHERE kind IN ('rent', 'unpaid')").fetchall()
    economy.sync(conn, today=D(14), now=NOON(D(14)))
    week2 = json.loads(conn.execute("SELECT summary FROM econ_weeks WHERE monday = '2026-10-12'").fetchone()[0])
    assert week2["rent"] == {"due": 150, "status": "paid", "home": "morningside-studio", "home_name": "Pre-war walk-up studio"}
    assert week2["savings_end"] == 50


def test_rent_is_never_taken_when_savings_cannot_cover_it(conn):
    add(conn, D(6), 60)                                              # $25 only
    economy.sync(conn, today=D(14), now=NOON(D(14)))
    week2 = json.loads(conn.execute("SELECT summary FROM econ_weeks WHERE monday = '2026-10-12'").fetchone()[0])
    assert week2["rent"]["status"] == "unpaid" and week2["savings_end_cents"] == 2500 and week2["unpaid_streak"] == 1
    assert "not covered" in week2["message"] and "nothing was taken" in week2["message"]
    assert economy.economy_state(conn, today=D(14), now=NOON(D(14)))["balance_cents"] == 2500


def test_a_kept_week_earns_two_percent_interest_on_savings(conn):
    fund(conn, 1000)
    for i in range(7, 12):
        add(conn, D(i), 30)
    ship(conn, D(7), 2)
    economy.sync(conn, today=D(14), now=NOON(D(14)))
    week = json.loads(conn.execute("SELECT summary FROM econ_weeks WHERE monday = '2026-10-12'").fetchone()[0])
    on = json.loads(conn.execute("SELECT meta FROM econ_ledger WHERE kind = 'interest'").fetchone()[0])["on_cents"]
    assert week["kept"] and on >= 100000 and week["interest_cents"] == int(on * 0.02)


def test_interest_is_capped_at_two_hundred_dollars_a_week(conn):
    fund(conn, 50_000)
    for i in range(7, 12):
        add(conn, D(i), 30)
    ship(conn, D(7), 2)
    economy.sync(conn, today=D(14), now=NOON(D(14)))
    week = json.loads(conn.execute("SELECT summary FROM econ_weeks WHERE monday = '2026-10-12'").fetchone()[0])
    assert week["interest_cents"] == 20000


def test_no_interest_when_the_week_is_not_kept(conn):
    fund(conn, 1000)
    economy.sync(conn, today=D(14), now=NOON(D(14)))
    assert conn.execute("SELECT COUNT(*) FROM econ_ledger WHERE kind = 'interest'").fetchone()[0] == 0


def test_two_unpaid_weeks_move_you_down_one_step_and_nothing_is_lost(conn):
    set_level(conn)
    fund(conn, 1500)
    day = D(7)                                                          # Mon Oct 12
    now = NOON(day)
    quote = economy.move_home(conn, "harlem-floorthrough", today=day, now=now)["quote"]
    assert quote["deposit"] == 400 and quote["net"] == 400 and quote["rent"] == 200
    moved = economy.move_home(conn, "harlem-floorthrough", quote["token"], today=day, now=now)
    assert moved["moved"] and moved["balance"] == 1100
    for item in ("desk_setup", "trailing_plant", "reading_lamp", "woven_rug", "postcard_board", "skyline_print", "record_player", "bookshelf", "fiddle_fig"):             # nine pieces: the 1-bed holds 12, the studio only 8
        s = economy.shop_state(conn, today=day, now=now)
        it = next(i for a in s["aisles"] for i in a["items"] if i["id"] == item)
        economy.buy(conn, item, it["price"], it["token"], today=day, now=now)
    s = economy.economy_state(conn, today=day, now=now)
    assert s["home"]["id"] == "harlem-floorthrough" and s["home"]["used"] == 9 and s["home"]["budget"] == 12 and s["balance"] == 155
    assert s["rent"]["status"] == "short" and s["rent"]["amount"] == 200

    # week of Oct 12 and week of Oct 19 both go unpaid -> the move down happens at the close of the second
    mid = economy.economy_state(conn, today=D(14), now=NOON(D(14)))
    assert mid["home"]["id"] == "harlem-floorthrough" and mid["rent"]["unpaid_streak"] == 1 and mid["rent"]["weeks_to_move"] == 1
    after = economy.economy_state(conn, today=D(21), now=NOON(D(21)))
    assert after["home"]["id"] == "morningside-studio" and after["home"]["slots"] == 4 and after["home"]["budget"] == 8
    assert after["rent"]["unpaid_streak"] == 0
    assert after["home"]["used"] == 8 and len(after["storage"]) == 1                       # the ninth piece is in storage
    assert set(after["owned"]["furniture"]) >= {x["item"] for x in after["storage"]}      # never lost
    assert after["balance"] == 155 + 400 - 300                                             # old deposit back, new deposit paid
    latest = after["recap"]["latest"]
    assert latest["moved"]["reason"] == "quiet_weeks" and "smaller place" in latest["moved"]["message"]
    assert "safe in storage" in latest["moved"]["message"]
    assert not game.has_banned_words(json.dumps(after))


def test_the_studio_is_the_floor_and_unpaid_weeks_just_pile_up_quietly(conn):
    economy.sync(conn, today=D(35), now=NOON(D(35)))
    s = economy.economy_state(conn, today=D(35), now=NOON(D(35)))
    assert s["home"]["id"] == "morningside-studio" and s["balance"] == 0
    assert conn.execute("SELECT COUNT(*) FROM econ_ledger WHERE kind = 'move'").fetchone()[0] == 0


def test_moving_back_up_returns_the_stored_things_and_savings_never_go_below_zero(conn):
    set_level(conn)
    fund(conn, 1500)
    day, now = D(7), NOON(D(7))
    q = economy.move_home(conn, "harlem-floorthrough", today=day, now=now)["quote"]
    economy.move_home(conn, "harlem-floorthrough", q["token"], today=day, now=now)
    for item in ("desk_setup", "trailing_plant", "reading_lamp", "woven_rug", "postcard_board", "skyline_print", "record_player", "bookshelf", "fiddle_fig"):
        it = next(i for a in economy.shop_state(conn, today=day, now=now)["aisles"] for i in a["items"] if i["id"] == item)
        economy.buy(conn, item, it["price"], it["token"], today=day, now=now)
    down = economy.economy_state(conn, today=D(21), now=NOON(D(21)))
    assert down["home"]["id"] == "morningside-studio" and len(down["storage"]) == 1
    # back in the studio with a little left; earn something, then move up again
    fund(conn, 2000, "2026-10-26")
    day2, now2 = D(24), NOON(D(24))
    q2 = economy.move_home(conn, "harlem-floorthrough", today=day2, now=now2)["quote"]
    assert q2["net"] == 400 - 300
    back = economy.move_home(conn, "harlem-floorthrough", q2["token"], today=day2, now=now2)
    assert back["stored"] == 0
    up = economy.economy_state(conn, today=day2, now=now2)
    assert up["home"]["id"] == "harlem-floorthrough" and up["home"]["used"] == 9 and up["storage"] == []
    assert up["balance_cents"] >= 0 and up["deposit_held"] == 400


def test_a_move_is_refused_when_the_district_is_not_open_or_savings_are_short(conn):
    fund(conn, 5000)
    with pytest.raises(economy.EconomyError) as locked:
        economy.move_home(conn, "brow-penthouse", today=D(7), now=NOON(D(7)))
    assert locked.value.code == "locked" and "Level 29" in locked.value.hint
    set_level(conn)
    with pytest.raises(economy.EconomyError) as stale:
        economy.move_home(conn, "brow-penthouse", "nope", today=D(7), now=NOON(D(7)))
    assert stale.value.code == "stale"
    with pytest.raises(economy.EconomyError) as same:
        economy.move_home(conn, "morningside-studio", today=D(7), now=NOON(D(7)))
    assert same.value.code == "same_home"


def test_a_move_without_enough_savings_is_a_calm_refusal(conn):
    set_level(conn)
    fund(conn, 100)
    with pytest.raises(economy.EconomyError) as short:
        economy.move_home(conn, "harlem-floorthrough", today=D(7), now=NOON(D(7)))
    assert short.value.code == "insufficient_funds" and not game.has_banned_words(short.value.hint)


def test_rent_for_a_week_is_the_dearest_home_you_lived_in(conn):
    """Moving to a cheaper place just before the week closes does not dodge the rent."""
    set_level(conn)
    fund(conn, 3000)
    day, now = D(7), NOON(D(7))
    q = economy.move_home(conn, "harlem-floorthrough", today=day, now=now)["quote"]
    economy.move_home(conn, "harlem-floorthrough", q["token"], today=day, now=now)
    late = timeutil.at_local(D(12), "12:00", TZ, 4)                       # Sat Oct 17
    q = economy.move_home(conn, "morningside-studio", today=D(12), now=late)["quote"]
    economy.move_home(conn, "morningside-studio", q["token"], today=D(12), now=late)
    economy.sync(conn, today=D(14), now=NOON(D(14)))
    week = json.loads(conn.execute("SELECT summary FROM econ_weeks WHERE monday = '2026-10-12'").fetchone()[0])
    assert week["rent"]["due"] == 200


# --------------------------------------------------------------------------
# The shop
# --------------------------------------------------------------------------

def item_of(state, item_id):
    return next(i for a in state["aisles"] for i in a["items"] if i["id"] == item_id)


def test_buying_is_a_two_step_with_a_price_and_a_token(conn):
    fund(conn, 300)
    day, now = D(7), NOON(D(7))
    quote = economy.buy(conn, "bookshelf", today=day, now=now)
    assert quote["confirm_needed"] and quote["quote"]["price"] == 200 and quote["quote"]["balance_after"] == 100
    with pytest.raises(economy.EconomyError) as wrong_price:
        economy.buy(conn, "bookshelf", 1, quote["quote"]["token"], today=day, now=now)
    assert wrong_price.value.code == "price_changed"
    with pytest.raises(economy.EconomyError) as bad:
        economy.buy(conn, "bookshelf", 200, "0000", today=day, now=now)
    assert bad.value.code == "stale"
    bought = economy.buy(conn, "bookshelf", 200, quote["quote"]["token"], today=day, now=now)
    assert bought["bought"] and bought["balance"] == 100 and bought["placed"] == {"slot": 0}
    with pytest.raises(economy.EconomyError) as twice:
        economy.buy(conn, "bookshelf", 200, quote["quote"]["token"], today=day, now=now)
    assert twice.value.code == "already_owned"


def test_a_stale_token_is_refused_after_any_money_event(conn):
    fund(conn, 400)
    day, now = D(7), NOON(D(7))
    q1 = economy.buy(conn, "bookshelf", today=day, now=now)["quote"]
    q2 = economy.buy(conn, "desk_setup", today=day, now=now)["quote"]
    economy.buy(conn, "desk_setup", 150, q2["token"], today=day, now=now)
    with pytest.raises(economy.EconomyError) as stale:
        economy.buy(conn, "bookshelf", 200, q1["token"], today=day, now=now)
    assert stale.value.code == "stale"


def test_not_enough_savings_is_a_kind_message_and_buys_nothing(conn):
    fund(conn, 100)
    day, now = D(7), NOON(D(7))
    with pytest.raises(economy.EconomyError) as short:
        economy.buy(conn, "bookshelf", today=day, now=now)
    assert short.value.code == "insufficient_funds" and short.value.extra["short_by"] == 100
    assert "more than your savings" in short.value.hint and not game.has_banned_words(short.value.hint)
    state = economy.shop_state(conn, today=day, now=now)
    shelf = item_of(state, "bookshelf")
    assert shelf["can_buy"] is False and shelf["short_by"] == 100 and shelf["state"] == "available"
    assert conn.execute("SELECT COUNT(*) FROM econ_ledger WHERE kind = 'purchase'").fetchone()[0] == 0


def test_district_gated_experiences_need_the_level(conn):
    fund(conn, 1000)
    day, now = D(7), NOON(D(7))
    shop = economy.shop_state(conn, today=day, now=now)
    broadway = item_of(shop, "broadway_show")
    assert broadway["state"] == "locked" and broadway["unlocks_at_level"] == 13 and "Level 13" in broadway["why_not"]
    with pytest.raises(economy.EconomyError) as locked:
        economy.buy(conn, "broadway_show", today=day, now=now)
    assert locked.value.code == "locked"
    assert item_of(shop, "columbia_lecture")["state"] == "available"
    set_level(conn)
    assert item_of(economy.shop_state(conn, today=day, now=now), "broadway_show")["state"] == "available"


def test_things_go_into_use_when_bought(conn):
    fund(conn, 2000)
    day, now = D(7), NOON(D(7))
    for item_id in ("columbia_hoodie", "string_lights", "desk_setup", "columbia_lecture"):
        q = economy.buy(conn, item_id, today=day, now=now)["quote"]
        economy.buy(conn, item_id, q["price"], q["token"], today=day, now=now)
    s = economy.economy_state(conn, today=day, now=now)
    assert s["equipped"] == {"outfit": "columbia_hoodie", "upgrades": ["string_lights"]}
    assert [p["item"] for p in s["home"]["placed"]] == ["desk_setup"]
    assert [p["item"] for p in s["passport"]] == ["columbia_lecture"]
    assert s["net_worth"] == s["balance"] + 80 + 150 + 150          # hoodie + lights + desk; the lecture is a memory
    assert s["items_value"] == 80 + 150 + 150


def test_equip_toggles_outfits_upgrades_and_furniture_slots(conn):
    fund(conn, 2000)
    day, now = D(7), NOON(D(7))
    for item_id in ("columbia_hoodie", "nyu_hoodie", "string_lights", "desk_setup", "bookshelf"):
        q = economy.buy(conn, item_id, today=day, now=now)["quote"]
        economy.buy(conn, item_id, q["price"], q["token"], today=day, now=now)
    assert economy.equip(conn, "outfit", "columbia_hoodie", True)["outfit"] == "columbia_hoodie"
    assert economy.equip(conn, "outfit", "columbia_hoodie", False)["outfit"] == "everyday"
    assert economy.equip(conn, "upgrade", "string_lights", False)["upgrades"] == []
    assert economy.equip(conn, "upgrade", "string_lights", True)["upgrades"] == ["string_lights"]
    placed = economy.equip(conn, "furniture", "desk_setup", True, slot=3)["placed"]
    assert (3, "desk_setup") in {(p["slot"], p["item"]) for p in placed}        # slot 3 is the old fixed slot at (0.35, 0.35)
    res = economy.equip(conn, "furniture", "bookshelf", False)
    assert [p["item"] for p in res["placed"]] == ["desk_setup"] and [s["item"] for s in res["storage"]] == ["bookshelf"]
    assert [x["id"] for x in res["layout"]["items"]] == ["desk_setup"] and res["layout"]["used"] == 1
    with pytest.raises(economy.EconomyError) as bad_slot:
        economy.equip(conn, "furniture", "bookshelf", True, slot=9)
    assert bad_slot.value.code == "bad_slot"
    with pytest.raises(economy.EconomyError) as not_owned:
        economy.equip(conn, "outfit", "navy_suit", True)
    assert not_owned.value.code == "not_owned"
    with pytest.raises(economy.EconomyError) as wrong_kind:
        economy.equip(conn, "upgrade", "desk_setup", True)
    assert wrong_kind.value.code == "unknown_item"


def test_a_full_home_sends_new_furniture_to_storage(conn):
    fund(conn, 9000)
    day, now = D(7), NOON(D(7))
    ids = ["desk_setup", "bookshelf", "trailing_plant", "reading_lamp", "woven_rug", "postcard_board", "skyline_print",
           "record_player", "fiddle_fig"]                                               # the studio holds 8 things
    for item_id in ids:
        q = economy.buy(conn, item_id, today=day, now=now)["quote"]
        result = economy.buy(conn, item_id, q["price"], q["token"], today=day, now=now)
    assert result["stored"] is True and result["placed"] is None
    s = economy.economy_state(conn, today=day, now=now)
    assert s["home"]["used"] == 8 and [x["item"] for x in s["storage"]] == ["fiddle_fig"]
    with pytest.raises(economy.EconomyError) as full:
        economy.equip(conn, "furniture", "fiddle_fig", True)
    assert full.value.code == "no_free_slot" and "fits 8 things" in full.value.hint


# --------------------------------------------------------------------------
# Events calendar
# --------------------------------------------------------------------------

def ny_noon(y, m, d):
    return datetime(y, m, d, 17, 0, tzinfo=timezone.utc)          # noon in New York (EST or EDT: 12-13 local)


def on_ids(now, wx=None):
    return {e["id"] for e in economy.events_status(now, wx) if e["on"]}


def test_event_windows_follow_real_dates():
    assert on_ids(ny_noon(2026, 10, 22)) == {"leaves_riverside"}
    assert "halloween_parade" in on_ids(ny_noon(2026, 10, 30))
    assert "marathon_cheer" in on_ids(ny_noon(2026, 11, 1)) and "marathon_cheer" not in on_ids(ny_noon(2026, 11, 8))     # first Sunday of Nov 2026 is the 1st
    assert "marathon_cheer" in on_ids(ny_noon(2027, 11, 7)) or "marathon_cheer" in on_ids(ny_noon(2027, 11, 5))         # first Sunday of Nov 2027 is the 7th
    assert "thanksgiving_balloons" in on_ids(ny_noon(2026, 11, 26)) and "thanksgiving_balloons" not in on_ids(ny_noon(2026, 11, 30))
    assert {"holiday_windows", "rockefeller_tree"} <= on_ids(ny_noon(2026, 12, 15))
    assert "ball_drop" in on_ids(ny_noon(2026, 12, 31)) and "ball_drop" in on_ids(ny_noon(2027, 1, 1))
    assert "ball_drop" not in on_ids(ny_noon(2027, 1, 2))
    assert "shakespeare_park" in on_ids(ny_noon(2027, 7, 10)) and "smorgasburg" in on_ids(ny_noon(2027, 5, 1))
    assert "shakespeare_park" not in on_ids(ny_noon(2027, 9, 10))


def test_an_event_reports_its_window_and_what_is_coming():
    by = {e["id"]: e for e in economy.events_status(ny_noon(2026, 10, 22))}
    assert by["leaves_riverside"]["on"] and by["leaves_riverside"]["days_left"] == 24 and by["leaves_riverside"]["period"] == "2026"
    assert by["halloween_parade"]["starts_in"] == 7 and by["halloween_parade"]["start"] == "2026-10-29"
    assert by["ball_drop"]["starts_in"] == 69
    assert by["hot_chocolate_snow"]["reason"] == "weather" and by["hot_chocolate_snow"]["on"] is False


def test_hot_chocolate_needs_snow_in_the_live_weather():
    snow = {"available": True, "condition": "snow"}
    rain = {"available": True, "condition": "rain"}
    assert "hot_chocolate_snow" in on_ids(ny_noon(2026, 12, 20), snow)
    assert "hot_chocolate_snow" not in on_ids(ny_noon(2026, 12, 20), rain)
    assert "hot_chocolate_snow" not in on_ids(ny_noon(2026, 12, 20), None)
    assert "hot_chocolate_snow" not in on_ids(ny_noon(2027, 7, 20), snow)                # not in July


def test_an_event_can_only_be_bought_while_it_is_on(conn):
    fund(conn, 500)
    day = D(17)                                       # Oct 22 2026
    now = datetime(2026, 10, 22, 17, 0, tzinfo=timezone.utc)
    with pytest.raises(economy.EconomyError) as off:
        economy.buy(conn, "halloween_parade", today=day, now=now)
    assert off.value.code == "off_season"
    q = economy.buy(conn, "leaves_riverside", today=day, now=now)["quote"]
    bought = economy.buy(conn, "leaves_riverside", q["price"], q["token"], today=day, now=now)
    assert bought["bought"] and bought["balance"] == 500 - 150 - 15      # the week of Oct 12 has closed: its rent was paid
    with pytest.raises(economy.EconomyError) as dup:
        economy.buy(conn, "leaves_riverside", today=day, now=now)
    assert dup.value.code == "already_owned"
    passport = economy.economy_state(conn, today=day, now=now)["passport"]
    assert passport[0]["item"] == "leaves_riverside" and passport[0]["event"] is True and passport[0]["period"] == "2026"
    shop = economy.shop_state(conn, today=day, now=now)
    leaves = next(e for e in shop["events"] if e["id"] == "leaves_riverside")
    assert leaves["owned"] and leaves["event"]["on"]
    assert next(e for e in shop["events"] if e["id"] == "halloween_parade")["event"]["starts_in"] == 7


def test_the_same_event_next_year_is_a_new_postcard(conn):
    fund(conn, 500)
    a = datetime(2026, 10, 22, 17, 0, tzinfo=timezone.utc)
    q = economy.buy(conn, "leaves_riverside", today=D(17), now=a)["quote"]
    economy.buy(conn, "leaves_riverside", 15, q["token"], today=D(17), now=a)
    b = datetime(2027, 10, 20, 17, 0, tzinfo=timezone.utc)
    q = economy.buy(conn, "leaves_riverside", today=date(2027, 10, 20), now=b)["quote"]
    assert economy.buy(conn, "leaves_riverside", 15, q["token"], today=date(2027, 10, 20), now=b)["bought"]


def test_a_snow_day_event_uses_the_weather_and_is_one_postcard_per_day(conn):
    fund(conn, 100)
    now = datetime(2026, 12, 20, 17, 0, tzinfo=timezone.utc)
    snow = {"available": True, "condition": "snow"}
    q = economy.buy(conn, "hot_chocolate_snow", today=D(76), now=now, wx=snow)["quote"]
    assert economy.buy(conn, "hot_chocolate_snow", 18, q["token"], today=D(76), now=now, wx=snow)["bought"]
    with pytest.raises(economy.EconomyError) as off:
        economy.buy(conn, "hot_chocolate_snow", today=D(76), now=now, wx=None)
    assert off.value.code == "off_season"


# --------------------------------------------------------------------------
# Net worth, recap, stars
# --------------------------------------------------------------------------

def test_net_worth_is_cash_plus_things_plus_the_deposit_and_graphs_over_weeks(conn):
    set_level(conn)
    fund(conn, 1500)
    day, now = D(7), NOON(D(7))
    q = economy.move_home(conn, "harlem-floorthrough", today=day, now=now)["quote"]
    economy.move_home(conn, "harlem-floorthrough", q["token"], today=day, now=now)
    q = economy.buy(conn, "bookshelf", today=day, now=now)["quote"]
    economy.buy(conn, "bookshelf", 200, q["token"], today=day, now=now)
    s = economy.economy_state(conn, today=D(21), now=NOON(D(21)))
    assert s["net_worth"] == s["balance"] + 200 + 400 and s["deposit_held"] == 400
    series = s["recap"]["series"]
    assert [p["monday"] for p in series] == ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]
    assert [p["live"] for p in series] == [False, False, False, True]
    assert series[-1]["net_worth"] == s["net_worth"] and series[1]["net_worth"] > 0
    assert s["recap"]["latest"]["monday"] == "2026-10-19"


def test_the_recap_message_is_calm_and_money_shaped(conn):
    add(conn, D(6), 8 * 60)
    s = economy.economy_state(conn, today=D(14), now=NOON(D(14)))
    msg = s["recap"]["latest"]["message"]
    assert msg.startswith("Earned $") and "Rent of $150 paid" in msg and "Savings $" in msg
    assert not game.has_banned_words(msg)


def test_star_stats_count_the_run_and_the_week(conn):
    for i in (7, 8, 9):
        add(conn, D(i), 240)
    s = economy.economy_state(conn, today=D(9), now=NOON(D(9)) + timedelta(hours=10))
    assert s["stars"]["days"] == 3 and s["stars"]["run"] == 3 and s["stars"]["this_week"] == 3 and s["stars"]["best_run"] == 3
    assert s["stars"]["goal_minutes"] == 240


def test_the_star_goal_is_a_setting_and_gold_follows_it(conn):
    day = D(6)
    add(conn, day, 300)
    db.set_setting(conn, "deep_star_minutes", 360)
    assert economy.economy_state(conn, today=day, now=NOON(day) + timedelta(hours=9))["gold_days"] == []
    db.set_setting(conn, "deep_star_minutes", 300)
    s = economy.economy_state(conn, today=day, now=NOON(day) + timedelta(hours=9))
    assert s["gold_days"] == [day.isoformat()] and s["stars"]["goal_minutes"] == 300
    db.set_setting(conn, "deep_star_minutes", 360)                    # raising the goal later never un-golds a banked day
    assert economy.economy_state(conn, today=day, now=NOON(day) + timedelta(hours=9))["gold_days"] == [day.isoformat()]


# --------------------------------------------------------------------------
# 3-star achievements and the event
# --------------------------------------------------------------------------

def test_three_three_star_days_in_a_week_unlock_golden_week(conn):
    today = D(10)
    for i in (7, 8):
        add(conn, D(i), 240)
    keys = {a.key for a in game.achievements(conn, today) if a.unlocked}
    assert "clear_skies" in keys and "gold_week" not in keys
    add(conn, D(9), 240)
    keys = {a.key for a in game.achievements(conn, today) if a.unlocked}
    assert "gold_week" in keys and "seven_clear" not in keys


def test_seven_three_star_days_in_a_row_unlock_the_run(conn):
    for i in range(7):
        add(conn, D(i + 1), 240)
    keys = {a.key for a in game.achievements(conn, D(7)) if a.unlocked}
    assert "seven_clear" in keys and "gold_week" in keys


def test_the_third_star_fires_a_three_stars_event_once(conn):
    day = D(6)
    before = game.snapshot(conn, day, NOON(day))
    add(conn, day, 240)
    events = game.finish_write(conn, before, entry={"category": "Python", "minutes": 240, "deep": True}, today=day, now=NOON(day) + timedelta(hours=5))
    star = [e for e in events if e["kind"] == "three_stars"]
    assert len(star) == 1 and star[0]["fx"]["gold"] is True and not game.has_banned_words(star[0]["title"] + star[0]["detail"])
    again = game.snapshot(conn, day, NOON(day) + timedelta(hours=5))
    add(conn, day, 10, hhmm="14:00")
    assert not [e for e in game.finish_write(conn, again, today=day, now=NOON(day) + timedelta(hours=6)) if e["kind"] == "three_stars"]


def test_world_state_carries_gold_days_and_the_economy_block(conn):
    day = D(6)
    add(conn, day, 240)
    w = game.world_state(conn, today=day, now=NOON(day) + timedelta(hours=5))
    gold = [d["date"] for d in w["days"] if d["gold"]]
    assert gold == [day.isoformat()]
    eco = w["economy"]
    assert eco["home"]["bin"] == 1059500 and eco["home"]["size"] == "studio" and eco["home"]["slots"] == 4
    assert eco["outfit"] == "everyday" and eco["upgrades"] == [] and eco["placed"] == []
    assert eco["gold_days"] == gold and eco["three_star_days"] == 1 and eco["focus"] == {"running": False}
    assert eco["character"]["state"] in ("home", "asleep") and eco["quiet"] is False


# --------------------------------------------------------------------------
# The character, focus and the Telegram line
# --------------------------------------------------------------------------

def test_the_character_studies_walks_home_and_sleeps(conn):
    day = D(6)
    now = timeutil.at_local(day, "20:00", TZ, 4)
    conn.execute("INSERT INTO focus_sessions(start_utc, planned_minutes, label, category) VALUES (?, 50, 'x', 'Python')",
                 (timeutil.to_iso(now - timedelta(minutes=10)),))
    ctx = game._Ctx(conn, day, now)
    e = economy._E(conn, ctx=ctx)
    assert economy._focus(e)["running"] and economy.character(e)["state"] == "studying"
    conn.execute("UPDATE focus_sessions SET end_utc = ?, outcome = 'full'", (timeutil.to_iso(now - timedelta(minutes=3)),))
    e = economy._E(conn, ctx=game._Ctx(conn, day, now))
    assert economy.character(e)["state"] == "walking_home"
    late = timeutil.at_local(day, "00:45", TZ, 4)                           # past the 00:30 cutoff
    e = economy._E(conn, ctx=game._Ctx(conn, day, late))
    assert economy.character(e)["state"] == "asleep"
    noon = timeutil.at_local(day, "13:00", TZ, 4)
    e = economy._E(conn, ctx=game._Ctx(conn, day, noon))
    assert economy.character(e)["state"] == "home"


def test_the_weekly_summary_gets_one_money_line_and_quiet_mode_hides_it(conn):
    day = D(14)
    add(conn, D(10), 120)
    line = economy.week_line(conn, day)
    assert line.startswith("Money: earned $") and "savings $" in line and "\n" not in line and not game.has_banned_words(line)
    db.set_setting(conn, "quiet_mode", True)
    assert economy.week_line(conn, day) is None


# --------------------------------------------------------------------------
# The catalog
# --------------------------------------------------------------------------

def _tile_bins():
    import glob
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent / "epoch" / "web" / "static" / "app" / "city" / "manhattan"
    found: dict[int, tuple] = {}
    for fn in glob.glob(str(root / "lod0" / "*.bin")):
        buf = Path(fn).read_bytes()
        n, = struct.unpack_from("<I", buf, 48)
        off, = struct.unpack_from("<I", buf, 60)
        for i in range(n):
            b, base_y, h = struct.unpack_from("<Iff", buf, off + 40 * i)
            flags = buf[off + 40 * i + 35]
            found[b] = (base_y, h, flags)
    return found


def test_the_homes_are_real_buildings_one_per_district_in_ladder_order():
    names = [d[2] for d in game.DISTRICTS]
    assert [h["district"] for h in cat.HOMES] == names
    assert cat.HOMES[-1]["bin"] == game.DREAM_HOME_BIN and cat.HOMES[-1]["size"] == "penthouse"
    assert cat.HOMES[0]["size"] == "studio" and cat.HOMES[0]["rent"] == 150 and cat.HOMES[-1]["rent"] == 900
    rents = [h["rent"] for h in cat.HOMES]
    assert rents == sorted(rents) and len(set(rents)) == len(rents)
    assert all(h["deposit"] == 2 * h["rent"] and h["slots"] == cat.SIZES[h["size"]] for h in cat.HOMES)
    assert len({h["bin"] for h in cat.HOMES}) == len(cat.HOMES)
    bins = _tile_bins()
    for h in cat.HOMES:
        assert h["bin"] in bins, f"{h['address']} (BIN {h['bin']}) is not in the city tiles"
        base_y, height, flags = bins[h["bin"]]
        assert not flags & 64                                             # not one of the 365 year-of-lots homes
        assert abs(base_y - h["base_y"]) < 0.2 and abs(height - h["height_m"]) < 0.2


def test_the_shop_has_all_four_aisles_and_only_calm_copy():
    ids = [i["id"] for i in cat.ITEMS] + [e["id"] for e in cat.EVENTS]
    assert len(ids) == len(set(ids))
    assert {i["kind"] for i in cat.ITEMS} == {"furniture", "outfit", "experience", "upgrade"}
    assert {u["id"] for u in cat.UPGRADES} == {"rooftop_garden", "string_lights", "neon_sign", "awning_doorman", "brass_doors", "painted_tank"}
    for obj in (cat.HOMES, cat.ITEMS, cat.EVENTS):
        for row in obj:
            for key in ("name", "blurb"):
                assert not game.has_banned_words(row[key]), row[key]
    assert all(i["district"] in {d[2] for d in game.DISTRICTS} for i in cat.ITEMS if i["district"])
    assert next(i for i in cat.ITEMS if i["id"] == "broadway_show")["district"] == "Midtown & Times Square"
    penthouse = [i["price"] for i in cat.FURNITURE if i["tier"] == "penthouse"]
    assert min(penthouse) >= 1600 and max(i["price"] for i in cat.FURNITURE if i["tier"] == "basic") <= 400


def test_the_whole_catalog_is_within_reach_of_a_strong_year():
    total = sum(i["price"] for i in cat.ITEMS) + sum(h["deposit"] for h in cat.HOMES[-1:])
    assert 30_000 <= total <= 60_000              # a strong year (about 80k earned, 25k rent) buys most of it
    assert cat.title_for(0)[1] == "Barista" and cat.title_for(25)[1] == "Founder" and cat.title_for(21)[1] == "ML Engineer"


def test_the_recap_names_the_home_the_rent_was_for_after_a_move_up_mid_week(conn):
    """Moving up mid-week charges the dearer home, and the recap and the move note say which one (final review fix)."""
    set_level(conn)
    fund(conn, 2000)
    day = D(9)                                                          # Wed Oct 14, in the first rent week
    quote = economy.move_home(conn, "harlem-floorthrough", today=day, now=NOON(day))["quote"]
    assert "$200" in quote["note"] and "new place" in quote["note"]
    economy.move_home(conn, "harlem-floorthrough", quote["token"], today=day, now=NOON(day))
    economy.sync(conn, today=D(14), now=NOON(D(14)))
    week = json.loads(conn.execute("SELECT summary FROM econ_weeks WHERE monday = '2026-10-12'").fetchone()[0])
    assert week["rent"]["due"] == 200 and week["rent"]["status"] == "paid"
    assert week["rent"]["home"] == "harlem-floorthrough" and week["rent"]["home_name"] == cat.HOME_BY_ID["harlem-floorthrough"]["name"]
    # moving back down in the same week: this Sunday's rent stays at the dearer place, and the note says so plainly
    q = economy.move_home(conn, "morningside-studio", today=D(15), now=NOON(D(15)))["quote"]
    assert "lived in both" in q["note"] and "$200" in q["note"] and "$150" in q["note"]
    assert not game.has_banned_words(q["note"])
