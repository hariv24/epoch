"""Shared fixtures. Every test gets its own fresh database file."""
from __future__ import annotations

from datetime import date

import pytest

from epoch import db

# A Monday, so week arithmetic in tests is easy to reason about.
START = date(2026, 10, 5)


@pytest.fixture
def db_path(tmp_path):
    path = tmp_path / "witness.db"
    db.init_db(path, today=START)
    return path


@pytest.fixture
def conn(db_path):
    with db.get_conn(db_path) as connection:
        yield connection


@pytest.fixture(autouse=True)
def _isolate_v2_side_effects(monkeypatch):
    """No test may keep the Mac awake, reach the weather API, or inherit pairing rate limits."""
    from epoch import lan, pomodoro, weather

    monkeypatch.setattr(pomodoro.keepawake, "enabled", False)
    pomodoro.keepawake.release()

    def offline():
        raise OSError("tests are offline")

    monkeypatch.setattr(weather, "fetch_raw", offline)
    weather.clear_memory()
    lan.limiter.reset()
    monkeypatch.setattr(lan, "lan_ips", lambda: ["192.168.1.23"])
    monkeypatch.setattr(lan, "mdns_names", lambda: ["test-mac.local", "test-mac"])
    yield
    weather.clear_memory()


# --------------------------------------------------------------------------
# Shared by the v2 test modules: a frozen clock, a state and an app, and clients that connect from any address.
# --------------------------------------------------------------------------

from datetime import datetime, timezone  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from epoch import timeutil  # noqa: E402
from epoch.config import Config  # noqa: E402
from epoch.web.app import create_app  # noqa: E402

V2_NOW = datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc)   # Wed 20:30 IST; the tracker started Mon 2026-10-05


class V2Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs) -> datetime:
        from datetime import timedelta

        self.now = self.now + timedelta(**kwargs)
        return self.now


@pytest.fixture
def v2_clock(monkeypatch):
    fake = V2Clock(V2_NOW)
    monkeypatch.setattr(timeutil, "now_utc", fake)
    return fake


@pytest.fixture
def v2_state(tmp_path, db_path, v2_clock):
    config = Config(
        data_dir=tmp_path, db_path=db_path, backup_dir=None, port=8765, telegram_bot_token=None, telegram_user_id=None,
        openrouter_api_key=None, openrouter_models=(), activitywatch_url="http://localhost:5600",
    )

    class NoAW:
        def available(self):
            return False

        def events(self, start_utc, end_utc):
            return []

    return SimpleNamespace(config=config, db_path=db_path, telegram_app=None, aw=NoAW(), llm=None)


@pytest.fixture
def v2_app(v2_state):
    return create_app(v2_state)


@pytest.fixture
def owner(v2_app):
    """The laptop: a request from loopback."""
    return TestClient(v2_app)


@pytest.fixture
def from_addr(v2_app):
    """Make a client that connects from the given address and asks for the given host."""
    def make(ip: str, host: str = "192.168.1.23:8765") -> TestClient:
        return TestClient(v2_app, base_url=f"http://{host}", client=(ip, 51234), follow_redirects=False)
    return make
