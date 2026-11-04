"""Live updates for the browser: an in-process hub and Server-Sent-Events formatting.

Writers (any thread) call `hub.publish(event, data)`. Each open `/api/stream` request owns a
`Subscription` whose asyncio queue is fed through `loop.call_soon_threadsafe`, so a publisher never
blocks and never needs to know about the event loop.

`current_client` carries the `X-Witness-Client` header of the request being served (set by the LAN
guard middleware) so a published game message can say which tab already played its events.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import threading
from contextvars import ContextVar
from typing import Any

current_client: ContextVar[str | None] = ContextVar("witness_client", default=None)

MAX_QUEUE = 100


class Subscription:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=MAX_QUEUE)

    def _put(self, item: tuple[str, Any]) -> None:
        try:
            self.queue.put_nowait(item)
        except asyncio.QueueFull:  # a stuck reader: drop the oldest, keep the newest
            try:
                self.queue.get_nowait()
                self.queue.put_nowait(item)
            except Exception:
                pass


class Hub:
    def __init__(self) -> None:
        self._subs: set[Subscription] = set()
        self._lock = threading.Lock()
        self._seq = itertools.count(1)

    def subscribe(self) -> Subscription:
        sub = Subscription(asyncio.get_running_loop())
        with self._lock:
            self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        with self._lock:
            self._subs.discard(sub)

    @property
    def subscribers(self) -> int:
        with self._lock:
            return len(self._subs)

    def next_seq(self) -> int:
        return next(self._seq)

    def publish(self, event: str, data: Any) -> int:
        """Send to every open stream. Returns how many were reached. Safe from any thread."""
        with self._lock:
            subs = list(self._subs)
        reached = 0
        for sub in subs:
            try:
                sub.loop.call_soon_threadsafe(sub._put, (event, data))
                reached += 1
            except RuntimeError:  # that loop has closed
                self.unsubscribe(sub)
        return reached


hub = Hub()


def publish_game_events(events: list[dict], at: str) -> None:
    """Tell every open page that a write produced celebrations (skipped when there are none)."""
    if not events:
        return
    hub.publish("game", {"seq": hub.next_seq(), "events": events, "origin": current_client.get(), "at": at})


def sse(event: str, data: Any, event_id: int | None = None) -> str:
    """One Server-Sent-Events message."""
    body = json.dumps(data, separators=(",", ":"), ensure_ascii=True)
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {event}\ndata: {body}\n\n"
