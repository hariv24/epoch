"""Settings keys added in v2: soundscape, weather and seasonal toggles; the session endpoint; shared plumbing."""
from __future__ import annotations

import pytest

from epoch import db, game


def test_new_keys_have_defaults(conn):
    for key, value in (("lan_enabled", False), ("weather_enabled", True), ("seasonal_enabled", True), ("soundscape", "off"),
                       ("soundscape_volume", 40), ("pomodoro_preset", "50-10-3")):
        assert db.get_setting(conn, key) == value and db.DEFAULT_SETTINGS[key] == value


def test_game_settings_roundtrip_the_new_keys(owner):
    body = owner.post("/api/settings/game", json={"soundscape": "rain", "soundscape_volume": 65, "weather_enabled": False, "seasonal_enabled": False}).json()
    assert body["ok"] and body["settings"]["soundscape"] == "rain" and body["settings"]["soundscape_volume"] == 65
    assert body["settings"]["weather_enabled"] is False and body["settings"]["seasonal_enabled"] is False
    for choice in ("off", "rain", "cafe", "brown", "subway"):
        assert owner.post("/api/settings/game", json={"soundscape": choice}).json()["settings"]["soundscape"] == choice


@pytest.mark.parametrize("bad", [{"soundscape": "disco"}, {"soundscape_volume": 101}, {"soundscape_volume": -1}, {"soundscape_volume": "loud"}, {"weather_enabled": "maybe"}])
def test_bad_values_are_hints(owner, bad):
    response = owner.post("/api/settings/game", json=bad).json()
    assert response["ok"] is False and response["hint"]


def test_plain_game_form_does_not_switch_the_v2_toggles_off(owner):
    owner.post("/api/settings/game", json={"soundscape": "cafe", "soundscape_volume": 70})
    owner.post("/settings/game", data={"motion": "on"})                       # an old form that knows nothing about v2
    values = owner.post("/api/settings/game", json={"sound": False}).json()["settings"]
    assert values["weather_enabled"] is True and values["seasonal_enabled"] is True
    assert values["soundscape"] == "cafe" and values["soundscape_volume"] == 70
    owner.post("/settings/game", data={"weather_enabled": "0", "soundscape": "brown"})
    values = owner.post("/api/settings/game", json={"sound": False}).json()["settings"]
    assert values["weather_enabled"] is False and values["soundscape"] == "brown"


def test_session_for_the_owner(owner):
    body = owner.get("/api/session").json()
    assert body == {"ok": True, "role": "owner", "device": None, "lan": {"enabled": False, "active": False, "restart_needed": False}}


def test_session_for_a_device(owner, from_addr, v2_state):
    with db.get_conn(v2_state.db_path) as conn:
        db.set_setting(conn, "lan_enabled", True)
    code = owner.post("/api/pair/new").json()["code"]
    tablet = from_addr("192.168.1.40")
    tablet.post("/pair", data={"code": code, "name": "Realme Pad"})
    body = tablet.get("/api/session").json()
    assert body["role"] == "device" and body["device"]["name"] == "Realme Pad" and body["lan"]["enabled"] is True


def test_settings_page_still_renders_for_the_owner_and_a_device(owner, from_addr, v2_state):
    assert owner.get("/settings").status_code == 200
    with db.get_conn(v2_state.db_path) as conn:
        db.set_setting(conn, "lan_enabled", True)
    code = owner.post("/api/pair/new").json()["code"]
    tablet = from_addr("192.168.1.40")
    tablet.post("/pair", data={"code": code})
    assert tablet.get("/settings").status_code == 200
    assert tablet.get("/").status_code == 200 and tablet.get("/world").status_code == 200


def test_home_and_world_work_through_the_new_guard(owner):
    for path in ("/", "/close", "/world", "/world?view=shelf", "/pomodoro", "/postcards", "/settings/lan", "/pair", "/api/stream?limit=1"):
        assert owner.get(path).status_code == 200, path


def test_no_new_copy_has_banned_words(owner, v2_clock):
    import re
    pages = [owner.get(p).text for p in ("/pomodoro", "/postcards", "/pair", "/settings/lan")]
    for text in pages:
        visible = re.sub(r"<[^>]+>", " ", text)
        assert not game.has_banned_words(visible), game._BANNED_RX.search(visible)
