"""Postcards and the nightly skyline: PNG upload validation, path safety, Telegram, the Sunday nudge."""
from __future__ import annotations

import base64
import struct
import zlib
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from epoch import db, game, rules, scheduler, timeutil
from epoch.web import app as webapp


def make_png(width=64, height=48, color=(200, 120, 40)) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = b"".join(b"\x00" + bytes(color) * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


PNG = make_png()
PNG64 = base64.b64encode(PNG).decode()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def card(client, **body):
    return client.post("/api/postcards", json=body)


# --------------------------------------------------------------------------
# png_size
# --------------------------------------------------------------------------

def test_png_size_reads_the_header():
    assert webapp.png_size(make_png(640, 480)) == (640, 480)


@pytest.mark.parametrize("data,code", [
    (b"", "not_png"), (b"GIF89a" + b"\0" * 100, "not_png"), (b"\x89PNG\r\n\x1a\n" + b"\0" * 10, "not_png"),
    (PNG[:-12], "not_png"), (PNG[:30], "not_png"), (b"<svg></svg>" * 10, "not_png"),
    (make_png(8, 100), "bad_size"), (make_png(100, 5000), "bad_size"), (make_png(5000, 5000), "bad_size"),
])
def test_png_size_refuses(data, code):
    with pytest.raises(webapp.UploadError) as exc:
        webapp.png_size(data)
    assert exc.value.code == code


def test_png_size_refuses_over_four_megabytes():
    big = PNG[:-12] + b"\0" * (4 * 1024 * 1024) + PNG[-12:]
    with pytest.raises(webapp.UploadError) as exc:
        webapp.png_size(big)
    assert exc.value.status == 413


# --------------------------------------------------------------------------
# Postcards
# --------------------------------------------------------------------------

def test_upload_a_weekly_postcard_as_base64(owner, v2_state):
    body = card(owner, kind="weekly", period="2026-10-14", png_base64=b64(PNG)).json()          # a Wednesday: normalised to Monday
    assert body["ok"] is True
    pc = body["postcard"]
    assert pc["id"] == "weekly-2026-10-12" and pc["kind"] == "weekly" and pc["period"] == "2026-10-12"
    assert pc["bytes"] == len(PNG) and (pc["width"], pc["height"]) == (64, 48) and pc["url"] == "/postcards/weekly-2026-10-12.png"
    saved = v2_state.config.data_dir / "postcards" / "weekly-2026-10-12.png"
    assert saved.read_bytes() == PNG
    assert [p.name for p in saved.parent.iterdir()] == ["weekly-2026-10-12.png"]          # no temp files left behind


def test_upload_accepts_a_data_url_and_an_iso_week_and_day_kind(owner, v2_state):
    body = card(owner, kind="day", period="2026-10-13", png_base64="data:image/png;base64," + b64(PNG)).json()
    assert body["postcard"]["id"] == "day-2026-10-13"
    week = card(owner, kind="weekly", period="2026-W42", png_base64=b64(PNG)).json()
    assert week["postcard"]["period"] == "2026-10-12"


def test_upload_as_multipart(owner, v2_state):
    response = owner.post("/api/postcards", data={"kind": "day", "period": "2026-10-14"}, files={"file": ("card.png", PNG, "image/png")})
    assert response.status_code == 200 and response.json()["postcard"]["id"] == "day-2026-10-14"
    assert (v2_state.config.data_dir / "postcards" / "day-2026-10-14.png").read_bytes() == PNG
    no_file = owner.post("/api/postcards", data={"kind": "day", "period": "2026-10-14"}, files={"other": ("x.txt", b"hi", "text/plain")})
    assert no_file.status_code == 400 and no_file.json()["code"] == "no_file"
    junk = owner.post("/api/postcards", data={"kind": "day", "period": "2026-10-14"}, files={"file": ("card.png", b"not a png at all" * 5, "image/png")})
    assert junk.status_code == 400 and junk.json()["code"] == "not_png"


def test_reupload_replaces(owner, v2_state):
    card(owner, kind="day", period="2026-10-14", png_base64=b64(PNG))
    other = make_png(32, 32, (1, 2, 3))
    card(owner, kind="day", period="2026-10-14", png_base64=b64(other))
    listed = owner.get("/api/postcards").json()["postcards"]
    assert len(listed) == 1 and listed[0]["bytes"] == len(other) and listed[0]["width"] == 32
    assert (v2_state.config.data_dir / "postcards" / "day-2026-10-14.png").read_bytes() == other


@pytest.mark.parametrize("body,status,code", [
    (dict(kind="monthly", period="2026-10-14", png_base64=PNG64), 400, "bad_kind"),
    (dict(kind="weekly", period="yesterday", png_base64=PNG64), 400, "bad_period"),
    (dict(kind="weekly", period="../../etc/passwd", png_base64=PNG64), 400, "bad_period"),
    (dict(kind="weekly", period="1999-01-01", png_base64=PNG64), 400, "bad_period"),
    (dict(kind="day", period="2026-13-40", png_base64=PNG64), 400, "bad_period"),
    (dict(kind="day", period="2026-10-14"), 400, "no_file"),
    (dict(kind="day", period="2026-10-14", png_base64="@@@not base64@@@"), 400, "bad_base64"),
    (dict(kind="day", period="2026-10-14", png_base64=b64(b"hello world, definitely not an image")), 400, "not_png"),
    (dict(kind="day", period="2026-10-14", png_base64=b64(make_png(4, 4))), 400, "bad_size"),
])
def test_upload_validation(owner, v2_state, body, status, code):
    response = card(owner, **body)
    assert response.status_code == status and response.json()["ok"] is False and response.json()["code"] == code
    assert not (v2_state.config.data_dir / "postcards").exists() or not list((v2_state.config.data_dir / "postcards").iterdir())
    assert owner.get("/api/postcards").json()["postcards"] == []


def test_upload_size_cap(owner, v2_state):
    big = PNG[:-12] + b"\0" * (4 * 1024 * 1024 - len(PNG) + 100) + PNG[-12:]            # a valid-looking PNG just over 4 MB
    response = card(owner, kind="day", period="2026-10-14", png_base64=b64(big))
    assert response.status_code == 413 and response.json()["code"] == "too_large"
    huge = card(owner, kind="day", period="2026-10-14", png_base64="A" * (7 * 1024 * 1024))
    assert huge.status_code == 413
    multi = owner.post("/api/postcards", data={"kind": "day", "period": "2026-10-14"}, files={"file": ("c.png", big, "image/png")})
    assert multi.status_code in (400, 413)
    just_under = PNG[:-12] + b"\0" * (3 * 1024 * 1024) + PNG[-12:]
    assert card(owner, kind="day", period="2026-10-14", png_base64=b64(just_under)).status_code == 200


def test_upload_rejects_non_json_bodies(owner):
    assert owner.post("/api/postcards", content=b"not json", headers={"content-type": "application/json"}).status_code == 400
    assert owner.post("/api/postcards", content=b"[1,2]", headers={"content-type": "application/json"}).status_code == 400


def test_list_download_and_inline(owner):
    card(owner, kind="weekly", period="2026-10-05", png_base64=b64(PNG))
    card(owner, kind="day", period="2026-10-13", png_base64=b64(make_png(40, 40)))
    listed = owner.get("/api/postcards").json()["postcards"]
    assert [p["id"] for p in listed] == ["day-2026-10-13", "weekly-2026-10-05"]               # newest period first
    download = owner.get("/postcards/weekly-2026-10-05.png")
    assert download.status_code == 200 and download.content == PNG and download.headers["content-type"] == "image/png"
    assert "attachment" in download.headers["content-disposition"] and "weekly-2026-10-05" in download.headers["content-disposition"]
    inline = owner.get("/postcards/weekly-2026-10-05.png?inline=1")
    assert "content-disposition" not in inline.headers and inline.content == PNG


@pytest.mark.parametrize("path", [
    "/postcards/..%2F..%2Fwitness.png", "/postcards/%2e%2e%2fwitness.png", "/postcards/weekly-2026-10-05.png.png",
    "/postcards/weekly-2026-10-06.png", "/postcards/nope.png", "/postcards/weekly-2026-10-05%00.png",
    "/postcards/..%5C..%5Cwitness.png", "/postcards/day-2026-10-13/../../witness.png", "/postcards/WEEKLY-2026-10-05.png",
])
def test_download_cannot_escape_or_guess(owner, v2_state, path):
    card(owner, kind="weekly", period="2026-10-05", png_base64=b64(PNG))
    (v2_state.config.data_dir / "secret.png").write_bytes(PNG)
    response = owner.get(path)
    assert response.status_code in (404, 400) and response.content != PNG


def test_files_not_in_the_table_are_not_served(owner, v2_state):
    folder = v2_state.config.data_dir / "postcards"
    folder.mkdir()
    (folder / "weekly-2026-10-05.png").write_bytes(PNG)                                       # dropped there by hand
    assert owner.get("/postcards/weekly-2026-10-05.png").status_code == 404


def test_postcards_page(owner):
    page = owner.get("/postcards").text
    assert "ready to make" in page and 'data-js="postcard-list"' in page and "No postcards yet" in page
    card(owner, kind="weekly", period="2026-10-12", png_base64=b64(PNG))
    page = owner.get("/postcards").text
    assert "ready to make" not in page and "/postcards/weekly-2026-10-12.png" in page


def test_upload_is_blocked_cross_site(owner):
    response = owner.post("/api/postcards", json={"kind": "day"}, headers={"origin": "http://evil.example"})
    assert response.status_code == 403


# --------------------------------------------------------------------------
# Skyline
# --------------------------------------------------------------------------

class FakeBot:
    def __init__(self, fail=False):
        self.photos, self.fail = [], fail

    async def send_photo(self, chat_id, photo, caption=None):
        if self.fail:
            raise RuntimeError("offline")
        self.photos.append((chat_id, photo, caption))
        return SimpleNamespace(message_id=700 + len(self.photos))


@pytest.fixture
def with_telegram(v2_state):
    bot = FakeBot()
    v2_state.config = replace(v2_state.config, telegram_bot_token="1:x", telegram_user_id=42)
    v2_state.telegram_app = SimpleNamespace(bot=bot)
    return bot


def skyline(client, **body):
    return client.post("/api/skyline", json=body)


def test_skyline_is_saved_for_today_by_default(owner, v2_state):
    body = skyline(owner, png_base64=b64(PNG)).json()
    assert body["ok"] and body["skyline"] == {"day": "2026-10-14", "url": "/skylines/2026-10-14.png", "bytes": len(PNG), "telegram": "not_configured"}
    assert (v2_state.config.data_dir / "skylines" / "2026-10-14.png").read_bytes() == PNG
    assert owner.get("/api/skylines").json()["skylines"] == [{"day": "2026-10-14", "url": "/skylines/2026-10-14.png", "bytes": len(PNG)}]
    got = owner.get("/skylines/2026-10-14.png")
    assert got.status_code == 200 and got.content == PNG and "attachment" in got.headers["content-disposition"]
    assert owner.get("/skylines/2026-10-14.png?inline=1").headers.get("content-disposition") is None


def test_skyline_for_a_given_day_and_multipart(owner, v2_state):
    skyline(owner, png_base64=b64(PNG), day="2026-10-12")
    response = owner.post("/api/skyline", data={"day": "2026-10-13"}, files={"file": ("s.png", PNG, "image/png")})
    assert response.json()["skyline"]["day"] == "2026-10-13"
    assert [s["day"] for s in owner.get("/api/skylines").json()["skylines"]] == ["2026-10-13", "2026-10-12"]


@pytest.mark.parametrize("body,status,code", [
    (dict(png_base64=b64(PNG), day="not-a-date"), 400, "bad_day"),
    (dict(png_base64=b64(PNG), day="../../x"), 400, "bad_day"),
    (dict(png_base64=b64(b"nope" * 30)), 400, "not_png"),
    (dict(), 400, "no_file"),
])
def test_skyline_validation(owner, v2_state, body, status, code):
    response = skyline(owner, **body)
    assert response.status_code == status and response.json()["code"] == code
    assert not (v2_state.config.data_dir / "skylines").exists() or not list((v2_state.config.data_dir / "skylines").iterdir())


@pytest.mark.parametrize("path", ["/skylines/..%2Fwitness.png", "/skylines/2026-10-14.png.png", "/skylines/x.png", "/skylines/2026-10-15.png"])
def test_skyline_download_is_safe(owner, path):
    skyline(owner, png_base64=b64(PNG))
    assert owner.get(path).status_code in (404, 400)


def test_skyline_goes_to_telegram_once_with_a_recap_caption(owner, with_telegram, v2_state):
    with db.get_conn(v2_state.db_path) as conn:
        start = timeutil.at_local(game.rules.today_local(conn), "19:00", "Asia/Kolkata", 4)
        rules.add_entry(conn, start, start + timedelta(minutes=90), "Python", True, "live")
    first = skyline(owner, png_base64=b64(PNG)).json()["skyline"]
    assert first["telegram"] == "sent"
    ((chat, photo, caption),) = with_telegram.photos
    assert chat == 42 and photo == PNG
    assert caption.startswith("Epoch · Day 10 · Wed 14 Oct · ") and "deep" in caption and not game.has_banned_words(caption)
    second = skyline(owner, png_base64=b64(PNG)).json()["skyline"]
    assert second["telegram"] == "skipped" and len(with_telegram.photos) == 1
    assert owner.get("/api/skylines").json()["skylines"][0]["bytes"] == len(PNG)


def test_telegram_trouble_never_breaks_the_save(owner, with_telegram, v2_state):
    with_telegram.fail = True
    body = skyline(owner, png_base64=b64(PNG)).json()
    assert body["ok"] and body["skyline"]["telegram"] == "not_sent"
    assert (v2_state.config.data_dir / "skylines" / "2026-10-14.png").exists()
    with_telegram.fail = False
    assert skyline(owner, png_base64=b64(PNG)).json()["skyline"]["telegram"] == "sent"      # tried again, since nothing was sent


def test_send_photo_never_raises():
    from epoch import telegram_bot
    import asyncio

    no_app = SimpleNamespace(telegram_app=None, config=SimpleNamespace(telegram_user_id=42))
    assert asyncio.run(telegram_bot.send_photo(no_app, PNG, "x")) is None
    boom = SimpleNamespace(telegram_app=SimpleNamespace(bot=FakeBot(fail=True)), config=SimpleNamespace(telegram_user_id=42))
    assert asyncio.run(telegram_bot.send_photo(boom, PNG, "x")) is None
    good = SimpleNamespace(telegram_app=SimpleNamespace(bot=FakeBot()), config=SimpleNamespace(telegram_user_id=42))
    assert asyncio.run(telegram_bot.send_photo(good, PNG, "x" * 5000)) == 701
    assert len(good.telegram_app.bot.photos[0][2]) <= 1000
    assert asyncio.run(telegram_bot.send_photo(good, b"", "x")) is None
    assert asyncio.run(telegram_bot.send_photo(good, PNG, "y", chat_id=7)) == 702 and good.telegram_app.bot.photos[1][0] == 7


# --------------------------------------------------------------------------
# The Sunday postcard nudge
# --------------------------------------------------------------------------

SUNDAY = datetime(2026, 10, 18, 12, 40, tzinfo=timezone.utc)        # Sun 18:10 IST
SUNDAY_DATE = SUNDAY.date()


def week_activity(conn):
    start = timeutil.at_local(SUNDAY_DATE - timedelta(days=2), "19:00", "Asia/Kolkata", 4)
    rules.add_entry(conn, start, start + timedelta(minutes=45), "Python", True, "live")


def kinds(conn, d=SUNDAY_DATE):
    return [r["kind"] for r in conn.execute("SELECT kind FROM slots WHERE local_date = ? ORDER BY due_utc", (d.isoformat(),))]


def test_sunday_gets_a_postcard_slot_when_the_week_has_activity(conn):
    scheduler.ensure_slots(conn, SUNDAY_DATE, SUNDAY)
    assert "postcard" not in kinds(conn)                                # nothing happened this week
    week_activity(conn)
    scheduler.ensure_slots(conn, SUNDAY_DATE, SUNDAY)
    assert kinds(conn).count("postcard") == 1
    slot = conn.execute("SELECT * FROM slots WHERE kind = 'postcard'").fetchone()
    assert slot["due_utc"] == "2026-10-18T12:40:00Z"                     # 18:10 local
    scheduler.ensure_slots(conn, SUNDAY_DATE, SUNDAY)
    assert kinds(conn).count("postcard") == 1                            # once


def test_postcard_card_text_and_link(conn):
    week_activity(conn)
    scheduler.ensure_slots(conn, SUNDAY_DATE, SUNDAY)
    slot = conn.execute("SELECT * FROM slots WHERE kind = 'postcard'").fetchone()
    title, body, buttons, url = scheduler.render(conn, slot, 8765)
    assert title == "Your week's postcard" and "postcard is ready to make" in body and "deep" in body
    assert url == "http://127.0.0.1:8765/postcards" and buttons == []
    assert not game.has_banned_words(title + " " + body)
    cards = scheduler.collect_due_cards(conn.execute("PRAGMA database_list").fetchone()[2], 8765, SUNDAY + timedelta(minutes=1))
    assert [c.title for c in cards if c.slot["kind"] == "postcard"] == ["Your week's postcard"]


def test_no_nudge_once_the_postcard_exists(conn):
    week_activity(conn)
    conn.execute("INSERT INTO postcards(id, kind, period, created_utc, bytes, width, height) VALUES ('weekly-2026-10-12', 'weekly', '2026-10-12', 'x', 1, 64, 64)")
    scheduler.ensure_slots(conn, SUNDAY_DATE, SUNDAY)
    assert "postcard" not in kinds(conn)


def test_a_pending_nudge_is_dropped_when_the_postcard_is_made_first(conn):
    week_activity(conn)
    scheduler.ensure_slots(conn, SUNDAY_DATE, SUNDAY - timedelta(hours=1))
    assert kinds(conn).count("postcard") == 1
    conn.execute("INSERT INTO postcards(id, kind, period, created_utc, bytes, width, height) VALUES ('weekly-2026-10-12', 'weekly', '2026-10-12', 'x', 1, 64, 64)")
    scheduler.ensure_slots(conn, SUNDAY_DATE, SUNDAY - timedelta(minutes=30))
    assert conn.execute("SELECT status FROM slots WHERE kind = 'postcard'").fetchone()["status"] == "skipped"


def test_other_days_never_get_it(conn):
    week_activity(conn)
    for offset in range(1, 7):
        d = SUNDAY_DATE - timedelta(days=offset)
        scheduler.ensure_slots(conn, d, SUNDAY - timedelta(days=offset))
        assert "postcard" not in kinds(conn, d)


def test_the_message_cap_applies_to_the_nudge(conn):
    week_activity(conn)
    with db.transaction(conn):
        db.set_setting(conn, "msg_cap", 1)
    scheduler.ensure_slots(conn, SUNDAY_DATE, SUNDAY)
    active = [r["kind"] for r in conn.execute("SELECT kind FROM slots WHERE local_date = ? AND status != 'skipped'", (SUNDAY_DATE.isoformat(),))]
    assert active.count("postcard") + [k for k in active if k not in ("sunday",)].count("morning") <= 1
    capped = [k for k in active if k not in ("sunday",)]
    assert len(capped) <= 1
