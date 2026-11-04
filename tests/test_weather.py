"""NYC weather: Open-Meteo parsing, caching, offline behaviour, the toggle and the endpoint (no network)."""
from __future__ import annotations

from datetime import timedelta

import pytest

from epoch import db, timeutil, weather

NOW = timeutil.from_iso("2026-10-14T15:00:00Z")      # 11:00 in New York (EDT)


def payload(code=61, temp=11.24, is_day=1, cloud=90, precip=0.4, wind=14.4):
    return {
        "latitude": 40.71, "longitude": -74.0, "timezone": "America/New_York",
        "current": {"time": "2026-10-14T11:00", "interval": 900, "temperature_2m": temp, "weather_code": code, "is_day": is_day,
                    "cloud_cover": cloud, "precipitation": precip, "wind_speed_10m": wind},
    }


class Fetcher:
    def __init__(self, *answers):
        self.answers, self.calls = list(answers), 0

    def __call__(self):
        self.calls += 1
        answer = self.answers[min(self.calls - 1, len(self.answers) - 1)]
        if isinstance(answer, Exception):
            raise answer
        return answer


@pytest.mark.parametrize("code,condition", [
    (0, "clear"), (1, "clear"), (2, "clouds"), (3, "clouds"), (45, "fog"), (48, "fog"), (51, "rain"), (55, "rain"), (61, "rain"),
    (65, "rain"), (67, "rain"), (71, "snow"), (75, "snow"), (77, "snow"), (80, "rain"), (82, "rain"), (85, "snow"), (86, "snow"),
    (95, "storm"), (96, "storm"), (99, "storm"),
])
def test_wmo_codes_map_to_six_conditions(code, condition):
    assert weather.parse(payload(code=code))["condition"] == condition


def test_parse_fields_and_units():
    reading = weather.parse(payload())
    assert reading == {
        "condition": "rain", "description": "Light rain", "weather_code": 61, "temp_c": 11.2, "temp_f": 52.2, "is_day": True,
        "cloud_cover": 90, "precipitation_mm": 0.4, "wind_kmh": 14.4,
    }
    night = weather.parse(payload(code=0, is_day=0, cloud=0, precip=0.0, wind=6.5, temp=3.9))
    assert night["is_day"] is False and night["temp_f"] == 39.0 and night["condition"] == "clear"


def test_unknown_code_falls_back_on_cloud_cover():
    assert weather.parse(payload(code=1234, cloud=80))["condition"] == "clouds"
    assert weather.parse(payload(code=1234, cloud=10))["condition"] == "clear"


@pytest.mark.parametrize("bad", [{}, {"current": None}, {"current": {}}, {"current": {"temperature_2m": 3}}, [], "x", None])
def test_parse_rejects_unusable_answers(bad):
    with pytest.raises(ValueError):
        weather.parse(bad)


def test_get_weather_shape(conn):
    result = weather.get_weather(conn, NOW, Fetcher(payload()))
    assert result["ok"] and result["enabled"] and result["available"] and result["stale"] is False
    assert result["condition"] == "rain" and result["temp_c"] == 11.2 and result["is_day"] is True
    assert result["local_time_ny"] == "2026-10-14T11:00:00-04:00" and result["local_hm_ny"] == "11:00"
    assert result["fetched_at"] == "2026-10-14T15:00:00Z" and result["source"] == "open-meteo"


def test_new_york_time_follows_daylight_saving():
    winter = weather.ny_time(timeutil.from_iso("2026-12-01T15:00:00Z"))
    assert winter.strftime("%H:%M") == "10:00" and weather.ny_time(NOW).strftime("%H:%M") == "11:00"


def test_cached_for_twenty_minutes_in_memory_and_in_the_database(conn, db_path):
    fetch = Fetcher(payload(code=0), payload(code=71))
    assert weather.get_weather(conn, NOW, fetch)["condition"] == "clear"
    assert weather.get_weather(conn, NOW + timedelta(minutes=19), fetch)["condition"] == "clear"
    assert fetch.calls == 1
    weather.clear_memory()                                         # a restart: the table still has the reading
    assert weather.get_weather(conn, NOW + timedelta(minutes=19), fetch)["condition"] == "clear" and fetch.calls == 1
    assert weather.get_weather(conn, NOW + timedelta(minutes=21), fetch)["condition"] == "snow" and fetch.calls == 2
    assert conn.execute("SELECT COUNT(*) FROM weather_cache").fetchone()[0] == 1


def test_offline_with_nothing_cached_is_null_never_an_error(conn):
    fetch = Fetcher(OSError("no wifi"))
    result = weather.get_weather(conn, NOW, fetch)
    assert result["ok"] is True and result["available"] is False and result["condition"] is None
    assert result["temp_c"] is None and result["is_day"] is None and result["fetched_at"] is None
    assert result["local_time_ny"] == "2026-10-14T11:00:00-04:00"          # computed locally, always there


@pytest.mark.parametrize("failure", [OSError("x"), TimeoutError(), ValueError("bad json"), RuntimeError("boom"), {"nope": 1}, "html"])
def test_every_kind_of_failure_is_swallowed(conn, failure):
    assert weather.get_weather(conn, NOW, Fetcher(failure))["available"] is False


def test_a_failed_fetch_is_not_retried_every_second(conn):
    fetch = Fetcher(OSError("down"), payload(code=0))
    assert weather.get_weather(conn, NOW, fetch)["available"] is False
    assert weather.get_weather(conn, NOW + timedelta(seconds=30), fetch)["available"] is False
    assert fetch.calls == 1
    assert weather.get_weather(conn, NOW + timedelta(seconds=61), fetch)["condition"] == "clear" and fetch.calls == 2


def test_stale_reading_is_served_when_the_network_drops(conn):
    fetch = Fetcher(payload(code=3), OSError("down"))
    weather.get_weather(conn, NOW, fetch)
    later = weather.get_weather(conn, NOW + timedelta(hours=2), fetch)
    assert later["available"] and later["stale"] is True and later["condition"] == "clouds"
    assert weather.get_weather(conn, NOW + timedelta(hours=7), Fetcher(OSError("down")))["available"] is False


def test_toggle_off_means_no_network_call(conn):
    with db.transaction(conn):
        db.set_setting(conn, "weather_enabled", False)
    fetch = Fetcher(payload())
    result = weather.get_weather(conn, NOW, fetch)
    assert result["enabled"] is False and result["available"] is False and result["condition"] is None and fetch.calls == 0


def test_endpoint(owner, monkeypatch):
    offline = owner.get("/api/weather").json()
    assert offline["ok"] and offline["available"] is False and offline["condition"] is None and offline["local_hm_ny"]
    monkeypatch.setattr(weather, "fetch_raw", lambda: payload(code=95))
    weather.clear_memory()
    live = owner.get("/api/weather").json()
    assert live["condition"] == "storm" and live["available"] is True and live["temp_f"] == 52.2
    owner.post("/api/settings/game", json={"weather_enabled": False})
    assert owner.get("/api/weather").json()["enabled"] is False


def test_fetch_raw_asks_open_meteo_for_new_york(monkeypatch):
    seen = {}

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"ok": 1}

    def fake_get(url, params, timeout):
        seen.update(url=url, params=params, timeout=timeout)
        return Response()

    monkeypatch.undo()                                      # the autouse fixture replaced fetch_raw
    monkeypatch.setattr(weather.httpx, "get", fake_get)
    assert weather.fetch_raw() == {"ok": 1}
    assert seen["url"].startswith("https://api.open-meteo.com/") and seen["params"]["latitude"] == 40.7128
    assert seen["params"]["longitude"] == -74.006 and "weather_code" in seen["params"]["current"] and seen["timeout"] <= 5
