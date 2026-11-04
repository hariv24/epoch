"""The daily chest (docs/COZY.md 4.6): earned when all three missions are done, never expires, stacks up to 7, opens once per day with a
seeded reward (money, a rare chest-only item, a postcard, the pity rule), banked in the ledger with unique refs."""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from epoch import cozy, db, economy, game, rules, timeutil
from epoch import economy_catalog as cat

TZ = "Asia/Kolkata"
D = lambda n: date(2026, 10, 5) + timedelta(days=n)        # noqa: E731
AT = lambda d, hhmm: timeutil.at_local(d, hhmm, TZ, 4)     # noqa: E731
THREE = [{"id": "one_block", "tier": "easy", "params": {}}, {"id": "deep_n", "tier": "medium", "params": {"n": 60}},
         {"id": "ship_it", "tier": "stretch", "params": {}}]


def earn(conn, *days):
    """Days on which all three missions were done (rows as `cozy.sync` leaves them)."""
    for d in days:
        key = D(d).isoformat() if isinstance(d, int) else d.isoformat()
        conn.execute("INSERT OR IGNORE INTO econ_missions(local_date, missions, done, created_utc) VALUES (?, ?, ?, '2026-10-05T00:00:00Z')",
                     (key, json.dumps(THREE), json.dumps({m["id"]: "2026-10-05T10:00:00Z" for m in THREE})))


def balance(conn, today=None):
    return economy.economy_state(conn, today=today or D(40), now=AT(today or D(40), "12:00"))["balance_cents"]


def ledger(conn, kind):
    return [(r["ref"], r["cents"], json.loads(r["meta"] or "{}")) for r in conn.execute("SELECT ref, cents, meta FROM econ_ledger WHERE kind = ? ORDER BY id", (kind,))]


def open_(conn, day=None, today=None):
    t = today or D(40)
    return cozy.open_chest(conn, D(day).isoformat() if isinstance(day, int) else day, today=t, now=AT(t, "12:00"))


def add(conn, d, minutes, hhmm="08:00"):
    start = AT(d, hhmm)
    return rules.add_entry(conn, start, start + timedelta(minutes=minutes), "Python", True, "live", "work")


# --------------------------------------------------------------------------
# Earning a chest
# --------------------------------------------------------------------------

def test_finishing_all_three_missions_puts_a_chest_on_the_shelf(conn):
    d = D(10)
    cozy.missions_state(conn, today=d, now=AT(d, "06:00"))
    conn.execute("UPDATE econ_missions SET missions = ?", (json.dumps(THREE),))
    start = AT(d, "08:00")
    conn.execute("INSERT INTO pomodoro_runs(preset, work_s, break_s, cycles, category, started_utc, status, phase_idx, phase_start_utc, "
                 "phase_elapsed_s, ended_utc, spot) VALUES ('custom', 1800, 300, 1, 'Python', ?, 'finished', 0, ?, 0, ?, 'butler')",
                 (timeutil.to_iso(start), timeutil.to_iso(start), timeutil.to_iso(start + timedelta(minutes=30))))
    conn.execute("INSERT INTO pomodoro_blocks(run_id, cycle, started_utc, ended_utc, worked_s, partial, status, focus, category) "
                 "VALUES (1, 1, ?, ?, 1800, 0, 'rated', 'full', 'Python')", (timeutil.to_iso(start), timeutil.to_iso(start + timedelta(minutes=30))))
    add(conn, d, 70, "09:00")
    s = cozy.missions_state(conn, today=d, now=AT(d, "11:00"))
    assert [m["done"] for m in s["missions"]] == [True, True, False] and s["chest"]["ready"] == 0
    rules.add_output(conn, d, "Python", "shipped")
    s = cozy.missions_state(conn, today=d, now=AT(d, "11:05"))
    assert s["all_done"] and s["message"] == "All three done. Your chest is ready."
    assert s["chest"]["ready"] == 1 and s["chest"]["next_date"] == d.isoformat() and s["chest"]["earned_today"] is True
    assert economy.economy_state(conn, today=d, now=AT(d, "11:10"))["chest"]["ready"] == 1


def test_a_chest_never_expires_and_up_to_seven_wait_on_the_shelf(conn):
    earn(conn, 0, *range(1, 10))                                            # ten chest days, the first one 40 days ago
    s = cozy.missions_state(conn, today=D(40), now=AT(D(40), "12:00"))
    assert s["chest"]["ready"] == 7 and s["chest"]["waiting"] == 3 and s["chest"]["max"] == 7 and s["chest"]["label"] == "x7"
    assert s["chest"]["next_date"] == D(0).isoformat() and len(s["chest"]["dates"]) == 7
    with pytest.raises(economy.EconomyError) as behind:
        open_(conn, 8)                                                       # not on the shelf yet
    assert behind.value.code == "shelf_full" and not game.has_banned_words(behind.value.hint)
    open_(conn, 0)
    s = cozy.missions_state(conn, today=D(40), now=AT(D(40), "12:00"))
    assert s["chest"]["ready"] == 7 and s["chest"]["waiting"] == 2                # the next one slides onto the shelf
    assert s["chest"]["next_date"] == D(1).isoformat()


def test_no_chest_means_a_calm_refusal(conn):
    with pytest.raises(economy.EconomyError) as none:
        open_(conn)
    assert none.value.code == "no_chest" and not game.has_banned_words(none.value.hint)
    earn(conn, 3)
    with pytest.raises(economy.EconomyError) as notready:
        open_(conn, 4)
    assert notready.value.code == "no_chest"
    with pytest.raises(economy.EconomyError) as bad:
        open_(conn, "tomorrow-ish")
    assert bad.value.code == "bad_date"


# --------------------------------------------------------------------------
# Opening, once
# --------------------------------------------------------------------------

def test_opening_pays_once_and_the_same_chest_again_changes_nothing(conn):
    earn(conn, 3, 4)
    before = balance(conn)
    first = open_(conn, 3)
    assert first["ok"] and first["opened"] and not first["already_opened"] and first["date"] == D(3).isoformat()
    assert 40 <= first["money"] <= 150 and first["money"] % 5 == 0
    assert balance(conn) == before + first["money"] * 100 == first["balance_cents"]
    assert ledger(conn, "chest")[0][0] == f"chest:{D(3).isoformat()}" and ledger(conn, "chest")[0][1] == first["money"] * 100
    assert first["message"].startswith(f"${first['money']}") and first["toast"] == first["message"] and not game.has_banned_words(first["message"])
    for _ in range(3):
        again = open_(conn, 3)
        assert again["already_opened"] and not again["opened"]
        assert (again["money"], [i["item"] for i in again["items"]], again["message"]) == (first["money"], [i["item"] for i in first["items"]], first["message"])
    assert balance(conn) == before + first["money"] * 100                                   # paid once
    assert len(ledger(conn, "chest")) == 1
    second = open_(conn)                                                                     # no date: the next waiting chest
    assert second["date"] == D(4).isoformat() and second["opened"]
    assert second["chest"]["ready"] == 0 and second["chest"]["opened_total"] == 2 and second["chest"]["last_opened"]["date"] == D(4).isoformat()


def test_the_reward_is_a_seeded_roll_so_two_databases_agree(tmp_path, monkeypatch):
    monkeypatch.setattr(cat, "CHEST_RARE_CHANCE", 0.7)           # plenty of prizes, so the order of opening could matter
    monkeypatch.setattr(cat, "CHEST_POSTCARD_CHANCE", 0.5)
    out = []
    for name in ("a", "b"):
        path = tmp_path / f"{name}.db"
        db.init_db(path, today=D(0))
        with db.get_conn(path) as conn:
            earn(conn, *range(2, 9))
            out.append([(r["money"], [i["item"] for i in r["items"]]) for r in (open_(conn) for _ in range(7))])
    assert out[0] == out[1]
    # the opening order does not matter either: each chest depends only on its own date and the days before it
    path = tmp_path / "c.db"
    db.init_db(path, today=D(0))
    with db.get_conn(path) as conn:
        earn(conn, *range(2, 9))
        rev = {d: open_(conn, d) for d in (8, 7, 6, 5, 4, 3, 2)}
        assert [(rev[d]["money"], [i["item"] for i in rev[d]["items"]]) for d in range(2, 9)] == out[0]
        assert sum(len(items) for _m, items in out[0]) >= 5


def test_money_is_forty_to_a_hundred_plus_ten_per_chest_day_in_the_run_capped_at_150():
    days = [D(n).isoformat() for n in range(0, 12)]
    plan = cozy.chest_plan(days)
    for i, day in enumerate(days):
        p = plan[day]
        assert p["streak"] == i + 1 and 40 <= p["base"] <= 100 and p["base"] % 5 == 0
        assert p["money"] == min(150, p["base"] + 10 * (i + 1))
    assert max(p["money"] for p in plan.values()) == 150 or any(p["base"] + 10 * p["streak"] > 150 for p in plan.values())
    # a gap resets the run
    gap = cozy.chest_plan([D(0).isoformat(), D(1).isoformat(), D(3).isoformat()])
    assert [gap[k]["streak"] for k in sorted(gap)] == [1, 2, 1]
    # over many separate chests the base covers the whole 40..100 range
    bases = {cozy.chest_plan([D(n * 2).isoformat()])[D(n * 2).isoformat()]["base"] for n in range(200)}
    assert min(bases) == 40 and max(bases) == 100 and len(bases) == 13


def test_the_streak_bonus_is_what_gets_paid(conn):
    earn(conn, 5, 6, 7)
    paid = [open_(conn, d) for d in (5, 6, 7)]
    plan = cozy.chest_plan([D(5).isoformat(), D(6).isoformat(), D(7).isoformat()])
    assert [p["money"] for p in paid] == [plan[D(d).isoformat()]["money"] for d in (5, 6, 7)]
    assert [p["streak"] for p in paid] == [1, 2, 3] and paid[2]["bonus"] == plan[D(7).isoformat()]["money"] - plan[D(7).isoformat()]["base"]
    assert paid[2]["chest"]["streak"] == 0 and paid[2]["chest"]["best_streak"] == 3        # the run ended days ago by day 40


# --------------------------------------------------------------------------
# Rare items, postcards and the pity rule
# --------------------------------------------------------------------------

def test_a_rare_item_is_about_one_in_five_and_a_postcard_about_one_in_seven():
    days = [D(n * 2).isoformat() for n in range(600)]
    rare = sum(1 for k, p in cozy.chest_plan(days).items() if p["rare"])
    post = sum(1 for k, p in cozy.chest_plan(days).items() if p["postcard"])
    assert 0.17 < rare / 600 < 0.30                  # 20% plus the pity chests
    assert 0.10 < post / 600 < 0.20


def test_pity_after_five_chests_without_a_rare_item_the_sixth_has_one(conn, monkeypatch):
    monkeypatch.setattr(cat, "CHEST_RARE_CHANCE", 0.0)
    monkeypatch.setattr(cat, "CHEST_POSTCARD_CHANCE", 0.0)
    days = [D(n) for n in range(2, 14)]
    earn(conn, *range(2, 14))
    plan = cozy.chest_plan([d.isoformat() for d in days])
    assert [plan[d.isoformat()]["rare"] for d in days] == [False] * 5 + [True] + [False] * 5 + [True]
    results = [open_(conn) for _ in days]
    assert [bool(r["items"]) for r in results] == [False] * 5 + [True] + [False] * 5 + [True]
    sixth = results[5]
    assert sixth["pity"] == {"misses_before": 5, "guaranteed": True} and sixth["items"][0]["rare"] is True
    assert sixth["items"][0]["item"] in {i["id"] for i in cat.CHEST_RARE} and results[0]["pity"]["guaranteed"] is False
    refs = [r[0] for r in ledger(conn, "chest_item")]
    assert len(refs) == len(set(refs)) == 2 and all(r.startswith("chest_item:") for r in refs)
    assert sixth["message"].startswith("$") and " and " in sixth["message"] and sixth["message"].endswith(".")


def test_chest_items_become_owned_and_wait_in_storage_and_can_be_placed(conn, monkeypatch):
    monkeypatch.setattr(cat, "CHEST_RARE_CHANCE", 1.0)
    monkeypatch.setattr(cat, "CHEST_POSTCARD_CHANCE", 0.0)
    earn(conn, 5)
    r = open_(conn, 5)
    item = r["items"][0]
    assert item["item"] in {i["id"] for i in cat.CHEST_RARE} and item["rare"]
    eco = economy.economy_state(conn, today=D(40), now=AT(D(40), "12:00"))
    owned = eco["owned"]["furniture" if item["kind"] == "furniture" else "outfit"]
    assert item["item"] in owned
    if item["kind"] == "furniture":
        assert item["item"] in [s["item"] for s in eco["storage"]]               # waits in the storage drawer, not auto-placed
        placed = economy.equip(conn, "furniture", item["item"], True)
        assert placed["layout"]["used"] == 1
    # never sold
    with pytest.raises(economy.EconomyError) as err:
        economy.buy(conn, item["item"], today=D(40), now=AT(D(40), "12:00"))
    assert err.value.code == "chest_only"
    shop = economy.shop_state(conn, today=D(40), now=AT(D(40), "12:00"))
    assert item["item"] not in [i["id"] for a in shop["aisles"] for i in a["items"]]


def test_rare_prizes_run_out_and_then_pay_a_little_extra_instead(conn, monkeypatch):
    monkeypatch.setattr(cat, "CHEST_RARE_CHANCE", 1.0)
    monkeypatch.setattr(cat, "CHEST_POSTCARD_CHANCE", 0.0)
    earn(conn, *range(0, 10))
    out = [open_(conn) for _ in range(10)]
    got = [i["item"] for r in out for i in r["items"]]
    assert len(got) == len(set(got)) == len(cat.CHEST_RARE) == 8                      # each prize at most once
    last = out[-1]
    assert last["items"] == [] and last["fallback"] is True
    plan = cozy.chest_plan([D(n).isoformat() for n in range(10)])[D(9).isoformat()]
    assert last["money"] == plan["money"] + cat.CHEST_FALLBACK_DOLLARS


def test_postcards_go_into_the_passport(conn, monkeypatch):
    monkeypatch.setattr(cat, "CHEST_RARE_CHANCE", 0.0)
    monkeypatch.setattr(cat, "CHEST_POSTCARD_CHANCE", 1.0)
    earn(conn, 1, 2, 3, 4)
    out = [open_(conn) for _ in range(4)]
    cards = [i["item"] for r in out for i in r["items"]]
    assert len(cards) == 3 and set(cards) == {c["id"] for c in cat.CHEST_POSTCARDS} and out[3]["items"] == []     # three exist
    eco = economy.economy_state(conn, today=D(40), now=AT(D(40), "12:00"))
    assert {p["item"] for p in eco["passport"] if p.get("chest")} == set(cards)
    assert set(cards) <= set(eco["owned"]["postcard"])
    assert all(p["price"] == 0 for p in eco["passport"] if p.get("chest"))


# --------------------------------------------------------------------------
# The API
# --------------------------------------------------------------------------

def test_the_chest_api_is_idempotent_per_chest(owner, v2_state):
    with db.get_conn(v2_state.db_path) as conn:
        earn(conn, 3, 4)
    state = owner.get("/api/missions").json()
    assert state["chest"]["ready"] == 2 and state["chest"]["next_date"] == D(3).isoformat()
    first = owner.post("/api/chest/open", json={"date": D(3).isoformat()}).json()
    again = owner.post("/api/chest/open", json={"date": D(3).isoformat()}).json()
    assert first["ok"] and first["opened"] and again["ok"] and again["already_opened"] and again["money"] == first["money"]
    nothing = owner.post("/api/chest/open", json={"date": "2020-01-01"}).json()
    assert nothing == {"ok": False, "code": "no_chest", "hint": "That chest is not ready."}
    eco = owner.get("/api/economy").json()
    assert eco["chest"]["ready"] == 1 and eco["balance_cents"] == first["balance_cents"]
    with db.get_conn(v2_state.db_path) as conn:
        assert len(ledger(conn, "chest")) == 1
        with pytest.raises(Exception):                                  # the ledger is append-only
            conn.execute("DELETE FROM econ_ledger WHERE kind = 'chest'")
