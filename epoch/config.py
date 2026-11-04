"""Process-level configuration: secrets and paths, read from `.env` and the environment.

User-editable preferences (schedule, floor, targets) live in the database
`settings` table instead; see `db.DEFAULT_SETTINGS`.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_MODELS = (
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "openrouter/free",
)


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines and # comments. Never overrides real env vars."""
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def is_free_model(model_id: str) -> bool:
    """Only free OpenRouter models may ever be called (hard budget rule: ₹0)."""
    return model_id.endswith(":free") or model_id == "openrouter/free"


@dataclass(frozen=True)
class Config:
    data_dir: Path
    db_path: Path
    backup_dir: Path | None
    port: int
    telegram_bot_token: str | None
    telegram_user_id: int | None
    openrouter_api_key: str | None
    openrouter_models: tuple[str, ...]
    activitywatch_url: str
    lan: bool = False                   # EPOCH_LAN=1: listen on the local network (tablet mode)

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_bot_token and self.telegram_user_id)

    @property
    def llm_enabled(self) -> bool:
        return bool(self.openrouter_api_key and self.openrouter_models)


def _env(name: str) -> str | None:
    """EPOCH_<name> wins; the older UNDERDOG_<name> and WITNESS_<name> still work so an existing .env keeps working."""
    for prefix in ("EPOCH_", "UNDERDOG_", "WITNESS_"):
        value = os.environ.get(prefix + name)
        if value is not None and value != "":
            return value
    return None


def load_config(env_file: Path | None = None) -> Config:
    _load_dotenv(env_file or PROJECT_ROOT / ".env")

    data_dir = Path(_env("DATA_DIR") or PROJECT_ROOT / "data").expanduser()
    backup = _env("BACKUP_DIR")
    user_id = os.environ.get("TELEGRAM_USER_ID", "").strip()
    models_env = os.environ.get("OPENROUTER_MODELS", "")
    models = tuple(m.strip() for m in models_env.split(",") if m.strip()) or DEFAULT_MODELS

    return Config(
        data_dir=data_dir,
        db_path=data_dir / "witness.db",
        backup_dir=Path(backup).expanduser() if backup else None,
        port=int(_env("PORT") or "8765"),
        telegram_bot_token=os.environ.get("TELEGRAM_BOT_TOKEN") or None,
        telegram_user_id=int(user_id) if user_id.isdigit() else None,
        openrouter_api_key=os.environ.get("OPENROUTER_API_KEY") or None,
        openrouter_models=tuple(m for m in models if is_free_model(m)),
        activitywatch_url=os.environ.get("ACTIVITYWATCH_URL", "http://localhost:5600").rstrip("/"),
        lan=(_env("LAN") or "").strip().lower() in ("1", "true", "yes", "on"),
    )
