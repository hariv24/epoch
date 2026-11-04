"""Start-up: build the shared state, the web app, and the background jobs, then serve.

`python -m epoch` ends up in `run()`. The web server is the main process; the
scheduler ticker and the Telegram bot run as background tasks inside its event loop
and are started and stopped by the app's lifespan.
"""
from __future__ import annotations

import asyncio
import logging
import re
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from typing import Any, AsyncIterator

import uvicorn

from . import db, lan, scheduler
from .activitywatch import AWClient
from .config import Config, load_config
from .llm import OpenRouterClient

log = logging.getLogger(__name__)

HOST = "127.0.0.1"      # the default: the app is not exposed to the network
LAN_HOST = "0.0.0.0"    # tablet mode (opt-in): listen on the network; lan.LanGuard only lets paired devices in
TELEGRAM_RETRY_SECONDS = (30, 60, 120, 300)  # waits between start-up attempts; the last one repeats


@dataclass
class AppState:
    """Everything the web app, the ticker and the Telegram bot share."""

    config: Config
    db_path: Any                        # pathlib.Path
    aw: AWClient
    llm: OpenRouterClient | None = None
    telegram_app: Any = None            # telegram.ext.Application, or None when not configured
    lan_active: bool = False            # True when the server really listens on the network (set in run())


def build_state(config: Config | None = None) -> AppState:
    """Load config, create the database if needed, and build the clients."""
    config = config or load_config()
    db.init_db(config.db_path)
    aw = AWClient(config.activitywatch_url)

    llm = None
    if config.llm_enabled:
        with db.get_conn(config.db_path) as conn:
            daily_cap = int(db.get_setting(conn, "llm_daily_cap"))
        llm = OpenRouterClient(
            config.openrouter_api_key, config.openrouter_models, config.db_path, daily_cap=daily_cap
        )

    state = AppState(config=config, db_path=config.db_path, aw=aw, llm=llm)
    state.telegram_app = _build_telegram(state)
    return state


def _build_telegram(state: AppState):
    """The Telegram application, or None if it is not configured or cannot be built."""
    if not state.config.telegram_enabled:
        return None
    try:
        from . import telegram_bot

        return telegram_bot.build_application(state)
    except Exception:
        log.exception("Telegram could not be set up; continuing without it")
        return None


async def _start_telegram(telegram_app) -> bool:
    """Start long polling. Returns True if it is running."""
    try:
        await telegram_app.initialize()
        await telegram_app.start()
        if telegram_app.updater is not None:
            await telegram_app.updater.start_polling()
        return True
    except Exception:
        log.exception("Telegram failed to start; continuing without it")
        await _stop_telegram(telegram_app)
        return False


async def _stop_telegram(telegram_app) -> None:
    """Stop polling and shut the bot down; each step is allowed to fail on its own."""
    steps = []
    if telegram_app.updater is not None:
        steps.append(telegram_app.updater.stop)
    steps += [telegram_app.stop, telegram_app.shutdown]
    for step in steps:
        try:
            await step()
        except Exception:
            log.debug("telegram shutdown step failed", exc_info=True)


async def _retry_telegram(state: AppState) -> None:
    """Keep trying to start Telegram (e.g. the Mac woke up before Wi-Fi did) until it works."""
    attempt = 0
    while True:
        await asyncio.sleep(TELEGRAM_RETRY_SECONDS[min(attempt, len(TELEGRAM_RETRY_SECONDS) - 1)])
        attempt += 1
        telegram_app = _build_telegram(state)  # a fresh application: a failed one has been shut down
        if telegram_app is None:
            return
        if await _start_telegram(telegram_app):
            state.telegram_app = telegram_app
            log.info("Telegram started after %d retr%s", attempt, "y" if attempt == 1 else "ies")
            return


@asynccontextmanager
async def background_services(state: AppState) -> AsyncIterator[None]:
    """Run the ticker and the Telegram bot for as long as the body of `async with` runs.

    `state.telegram_app` is only set while Telegram is really running, so the scheduler and
    the web pages never try to use a bot that failed to start. A failed start is retried.
    """
    ticker_task = asyncio.create_task(scheduler.ticker(state), name="witness-ticker")
    retry_task = None
    configured_app = state.telegram_app
    if configured_app is not None:
        state.telegram_app = None
        if await _start_telegram(configured_app):
            state.telegram_app = configured_app
        else:
            retry_task = asyncio.create_task(_retry_telegram(state), name="witness-telegram-retry")
    try:
        yield
    finally:
        for task in (ticker_task, retry_task):
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        if state.telegram_app is not None:
            await _stop_telegram(state.telegram_app)


def attach_background_services(app, state: AppState) -> None:
    """Wrap the app's lifespan so the background jobs start and stop with the server."""
    original = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(the_app):
        async with original(the_app) as maybe_state:
            async with background_services(state):
                yield maybe_state

    app.router.lifespan_context = lifespan


class _HideTelegramToken(logging.Filter):
    """Replace 'bot<id>:<secret>' in log lines, because Telegram puts the token in every URL."""

    PATTERN = re.compile(r"bot\d+:[\w-]+")

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if self.PATTERN.search(message):
            record.msg, record.args = self.PATTERN.sub("bot<hidden>", message), None
        return True


def configure_logging() -> None:
    """Log to stderr (launchd sends it to data/epoch.log) without ever writing the bot token."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # httpx logs every request URL at INFO, and Telegram's URLs contain the token.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    for handler in logging.getLogger().handlers:
        handler.addFilter(_HideTelegramToken())


def bind_host(state: AppState) -> str:
    """127.0.0.1 normally; 0.0.0.0 when tablet mode is on (Settings toggle or EPOCH_LAN=1). Read at start-up."""
    with db.get_conn(state.db_path) as conn:
        return LAN_HOST if lan.lan_requested(state.config, conn) else HOST


def run() -> None:
    """Build everything and serve (on 127.0.0.1, or on the network in tablet mode) until stopped."""
    configure_logging()
    state = build_state()
    host = bind_host(state)
    state.lan_active = host == LAN_HOST

    from .web.app import create_app  # imported here: the web package is built separately

    app = create_app(state)
    app.state.witness = state
    attach_background_services(app, state)
    log.info("Epoch is running at http://127.0.0.1:%s", state.config.port)
    if state.lan_active:
        for item in lan.access_urls(state.config.port):
            log.info("Tablet mode is on. Paired devices can use %s", item["url"])
    # proxy_headers=False: the client address must be the real TCP peer, never a header someone sent.
    uvicorn.run(app, host=host, port=state.config.port, log_level="info", proxy_headers=False)
