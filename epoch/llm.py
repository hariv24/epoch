"""A tiny OpenRouter client for FREE models only, plus the Sunday narration.

Rules this module enforces:
- Only free models are ever called (`config.is_free_model`).
- At most `daily_cap` real requests per local day, counted from the `llm_calls` table.
- At most 20 requests in any 60 seconds.
- Every attempt, successful or not, is recorded in `llm_calls`.
- Nothing here raises: every failure returns None.
"""
from __future__ import annotations

import json
import re
import threading
import time as _time
from collections import deque
from pathlib import Path
from typing import Any, Callable, Sequence

import httpx

from . import db, timeutil
from .config import is_free_model

API_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_CALLS_PER_MINUTE = 20
RATE_WINDOW_SECONDS = 60.0

# Rows with these errors never reached the network, so they do not use up the daily cap.
LOCAL_SKIP_ERRORS = ("rate_limited", "daily_cap", "non_free_model")

_FENCE_RE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*\n?(.*?)\n?\s*```\s*$", re.DOTALL)


def strip_code_fences(text: str) -> str:
    """Remove a ```json ... ``` wrapper if the model added one."""
    match = _FENCE_RE.match(text)
    return match.group(1).strip() if match else text.strip()


class OpenRouterClient:
    """Calls OpenRouter's chat completions API, trying each configured model in order."""

    def __init__(
        self,
        api_key: str,
        models: Sequence[str],
        db_path: Path,
        daily_cap: int = 100,
        timeout: float = 30,
        client: httpx.Client | None = None,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = _time.monotonic,
    ) -> None:
        """`client`, `transport` and `clock` exist so tests can avoid the network and real time."""
        self.api_key = api_key
        self.models = tuple(models)
        self.db_path = Path(db_path)
        self.daily_cap = daily_cap
        self._http = client or httpx.Client(timeout=timeout, transport=transport)
        self._clock = clock
        self._recent: deque[float] = deque()  # monotonic times of recent real requests
        self._lock = threading.Lock()

    # ---- public API -------------------------------------------------------

    def calls_today(self) -> int:
        """Real requests made today (local date). Skipped attempts are not counted.

        If the database cannot be read this returns the daily cap, so no request goes out
        that could not be counted.
        """
        try:
            with db.get_conn(self.db_path) as conn:
                marks = ",".join("?" for _ in LOCAL_SKIP_ERRORS)
                row = conn.execute(
                    f"SELECT COUNT(*) FROM llm_calls WHERE local_date = ? "
                    f"AND (error IS NULL OR error NOT IN ({marks}))",
                    (self._local_date(conn), *LOCAL_SKIP_ERRORS),
                ).fetchone()
                return int(row[0])
        except Exception:
            return self.daily_cap  # fail closed: if the count cannot be read, assume the cap is used up

    def complete_json(self, purpose: str, system: str, user: str, schema: dict) -> dict | None:
        """Ask for a JSON object matching `schema`. Returns the parsed dict, or None on failure."""
        try:
            instruction = (
                system.rstrip()
                + "\n\nRespond with ONLY a JSON object (no prose, no code fences) that matches "
                + "this JSON schema:\n"
                + json.dumps(schema)
            )
            response_format = {
                "type": "json_schema",
                "json_schema": {"name": "result", "strict": True, "schema": schema},
            }
            text = self._run(purpose, instruction, user, 600, response_format, _json_validator(schema))
            return None if text is None else json.loads(strip_code_fences(text))
        except Exception:
            return None

    def complete_text(self, purpose: str, system: str, user: str, max_tokens: int = 400) -> str | None:
        """Ask for plain text. Returns the stripped text, or None on failure."""
        try:
            return self._run(purpose, system, user, max_tokens, None, None)
        except Exception:
            return None

    def close(self) -> None:
        try:
            self._http.close()
        except Exception:
            pass

    # ---- the model loop ---------------------------------------------------

    def _run(
        self,
        purpose: str,
        system: str,
        user: str,
        max_tokens: int,
        response_format: dict | None,
        validator: Callable[[str], str | None] | None,
    ) -> str | None:
        """Try each model in order; return the first good content string."""
        if not self.api_key:
            return None
        for model in self.models:
            if not is_free_model(model):
                self._record(purpose, model, False, "non_free_model")
                continue
            if self.calls_today() >= self.daily_cap:
                self._record(purpose, model, False, "daily_cap")
                return None  # the cap is global, so other models would be refused too
            if not self._take_rate_slot():
                self._record(purpose, model, False, "rate_limited")
                return None

            content, error = self._request(model, system, user, max_tokens, response_format)
            if content is not None and validator is not None:
                error = validator(content)
                if error is not None:
                    content = None
            self._record(purpose, model, content is not None, error)
            if content is not None:
                return content
        return None

    def _request(
        self, model: str, system: str, user: str, max_tokens: int, response_format: dict | None
    ) -> tuple[str | None, str | None]:
        """One HTTP call. Returns (content, None) on success or (None, error_text)."""
        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }
        if response_format is not None:
            payload["response_format"] = response_format
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost",
            "X-Title": "Epoch",
        }
        try:
            response = self._http.post(API_URL, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            return None, f"network:{type(exc).__name__}"
        except Exception as exc:
            return None, f"error:{type(exc).__name__}"

        if response.status_code != 200:
            return None, f"http_{response.status_code}"
        try:
            body = response.json()
        except ValueError:
            return None, "bad_json_body"
        return _content_from_body(body)

    # ---- bookkeeping ------------------------------------------------------

    def _take_rate_slot(self) -> bool:
        """True if fewer than 20 requests happened in the last 60 s (and claims a slot)."""
        with self._lock:
            now = self._clock()
            while self._recent and now - self._recent[0] >= RATE_WINDOW_SECONDS:
                self._recent.popleft()
            if len(self._recent) >= MAX_CALLS_PER_MINUTE:
                return False
            self._recent.append(now)
            return True

    @staticmethod
    def _local_date(conn) -> str:
        tz = db.get_setting(conn, "timezone")
        day_start = db.get_setting(conn, "day_start_hour")
        return timeutil.local_date_of(timeutil.now_utc(), tz, day_start).isoformat()

    def _record(self, purpose: str, model: str | None, ok: bool, error: str | None) -> None:
        """Insert one row in llm_calls. Never raises."""
        try:
            with db.get_conn(self.db_path) as conn:
                conn.execute(
                    "INSERT INTO llm_calls(ts_utc, local_date, purpose, model, ok, error) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        timeutil.to_iso(timeutil.now_utc()),
                        self._local_date(conn),
                        purpose,
                        model,
                        1 if ok else 0,
                        None if ok else (error or "unknown")[:200],
                    ),
                )
        except Exception:
            pass


def _content_from_body(body: Any) -> tuple[str | None, str | None]:
    """Pull the message text out of a 200 response, or say why there is none."""
    if not isinstance(body, dict):
        return None, "bad_body"
    if body.get("error"):
        error = body["error"]
        message = error.get("message") if isinstance(error, dict) else str(error)
        return None, f"api_error:{str(message)[:150]}"
    choices = body.get("choices")
    if not choices:
        return None, "empty_choices"
    try:
        content = choices[0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None, "bad_choice"
    if isinstance(content, list):  # some providers return a list of text parts
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    if not isinstance(content, str) or not content.strip():
        return None, "empty_content"
    return content.strip(), None


def _json_validator(schema: dict) -> Callable[[str], str | None]:
    """Build a check that the content is a JSON object with the schema's required keys."""
    required = schema.get("required", [])

    def check(content: str) -> str | None:
        try:
            data = json.loads(strip_code_fences(content))
        except ValueError:
            return "invalid_json"
        if not isinstance(data, dict):
            return "json_not_object"
        missing = [key for key in required if key not in data]
        return f"missing_keys:{','.join(missing)}" if missing else None

    return check


# ---------------------------------------------------------------------------
# Sunday narration
# ---------------------------------------------------------------------------

NARRATION_MAX_WORDS = 150  # the prompt asks for 120; this is the hard limit with some slack
_NUMBER_RE = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")
_LIST_MARKER_RE = re.compile(r"^\s*(?:[-*•]\s+|\d+[.)]\s+)", re.MULTILINE)
_GUILT_WORDS = ("failed", "failure", "wasted", "lazy", "streak lost", "future self")

_NARRATION_SYSTEM = (
    "You write a short, kind weekly summary for one person from a JSON object of facts about "
    "their week. Write at most 120 words of plain prose with exactly four parts: one win, one "
    "gap, one pattern you notice, and one concrete if-then plan for next week "
    "('If it is ..., then I ...'). Use ONLY numbers that appear in the facts, copied exactly as "
    "written there; do not convert units, add, round or invent any number. Do not number or "
    "bullet the parts. Be warm and forward-looking. Never use guilt words such as failed, "
    "wasted, lazy or streak lost."
)


def _normalise_number(token: str) -> float:
    return float(token.replace(",", ""))


def _numbers_in(text: str) -> set[float]:
    return {_normalise_number(token) for token in _NUMBER_RE.findall(text)}


def narration_is_grounded(text: str, facts: dict) -> bool:
    """True if every number in `text` also appears in the JSON of `facts`."""
    allowed = _numbers_in(json.dumps(facts, default=str, ensure_ascii=False))
    without_markers = _LIST_MARKER_RE.sub("", text)
    return _numbers_in(without_markers) <= allowed


def weekly_narration(llm, facts: dict) -> str | None:
    """A <=120-word weekly summary from the facts, or None if the LLM is off, fails or invents numbers."""
    if llm is None:
        return None
    try:
        facts_json = json.dumps(facts, default=str, ensure_ascii=False)
        text = llm.complete_text("weekly_narration", _NARRATION_SYSTEM, facts_json, max_tokens=400)
    except Exception:
        return None
    if not text:
        return None
    text = text.strip()
    if len(text.split()) > NARRATION_MAX_WORDS:
        return None
    lowered = text.lower()
    if any(word in lowered for word in _GUILT_WORDS):
        return None
    if not narration_is_grounded(text, facts):
        return None
    return text
