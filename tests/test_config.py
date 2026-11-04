"""Environment names: EPOCH_* wins, the older UNDERDOG_* and WITNESS_* names keep working, and the database keeps its file name."""
from __future__ import annotations

import pytest

from epoch.config import load_config

NAMES = ("PORT", "DATA_DIR", "BACKUP_DIR", "LAN")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for prefix in ("EPOCH_", "UNDERDOG_", "WITNESS_"):
        for name in NAMES:
            monkeypatch.delenv(prefix + name, raising=False)


def load(tmp_path):
    return load_config(tmp_path / "no-such.env")


def test_defaults(tmp_path):
    config = load(tmp_path)
    assert config.port == 8765 and config.lan is False and config.backup_dir is None
    assert config.db_path.name == "witness.db"          # the database keeps its old file name on purpose
    assert config.data_dir.name == "data"


def test_epoch_names(tmp_path, monkeypatch):
    monkeypatch.setenv("EPOCH_PORT", "8761")
    monkeypatch.setenv("EPOCH_DATA_DIR", str(tmp_path / "d"))
    monkeypatch.setenv("EPOCH_BACKUP_DIR", str(tmp_path / "b"))
    monkeypatch.setenv("EPOCH_LAN", "1")
    config = load(tmp_path)
    assert config.port == 8761 and config.lan is True
    assert config.data_dir == tmp_path / "d" and config.db_path == tmp_path / "d" / "witness.db"
    assert config.backup_dir == tmp_path / "b"


def test_underdog_names_still_work(tmp_path, monkeypatch):
    monkeypatch.setenv("UNDERDOG_PORT", "8764")
    monkeypatch.setenv("UNDERDOG_DATA_DIR", str(tmp_path / "u"))
    monkeypatch.setenv("UNDERDOG_BACKUP_DIR", str(tmp_path / "ub"))
    monkeypatch.setenv("UNDERDOG_LAN", "true")
    config = load(tmp_path)
    assert config.port == 8764 and config.lan is True
    assert config.data_dir == tmp_path / "u" and config.backup_dir == tmp_path / "ub"


def test_old_witness_names_still_work(tmp_path, monkeypatch):
    monkeypatch.setenv("WITNESS_PORT", "8762")
    monkeypatch.setenv("WITNESS_DATA_DIR", str(tmp_path / "old"))
    monkeypatch.setenv("WITNESS_BACKUP_DIR", str(tmp_path / "oldb"))
    monkeypatch.setenv("WITNESS_LAN", "yes")
    config = load(tmp_path)
    assert config.port == 8762 and config.lan is True
    assert config.data_dir == tmp_path / "old" and config.backup_dir == tmp_path / "oldb"


def test_epoch_wins_over_underdog_and_witness(tmp_path, monkeypatch):
    monkeypatch.setenv("WITNESS_PORT", "8762")
    monkeypatch.setenv("UNDERDOG_PORT", "8763")
    monkeypatch.setenv("EPOCH_PORT", "8764")
    monkeypatch.setenv("WITNESS_LAN", "1")
    monkeypatch.setenv("UNDERDOG_LAN", "1")
    monkeypatch.setenv("EPOCH_LAN", "0")
    config = load(tmp_path)
    assert config.port == 8764 and config.lan is False


def test_underdog_wins_over_witness(tmp_path, monkeypatch):
    monkeypatch.setenv("WITNESS_PORT", "8762")
    monkeypatch.setenv("UNDERDOG_PORT", "8763")
    config = load(tmp_path)
    assert config.port == 8763


def test_python_m_old_names_are_shims_for_epoch(capsys, monkeypatch):
    import runpy
    import sys

    import epoch.main
    import epoch.__main__ as entry
    import witness.__main__ as witness_shim
    import underdog.__main__ as underdog_shim

    assert entry.run is epoch.main.run
    assert witness_shim.run is epoch.main.run and underdog_shim.run is epoch.main.run
    for name in ("underdog", "witness"):
        calls = []
        monkeypatch.setattr(epoch.main, "run", lambda: calls.append(1))
        monkeypatch.delitem(sys.modules, f"{name}.__main__", raising=False)
        # Run the shim as __main__ without starting a server: `run` is replaced with a stub.
        runpy.run_module(f"{name}.__main__", run_name="__main__")
        out = capsys.readouterr().out
        assert calls == [1] and out.count("\n") == 1 and "python -m epoch" in out
