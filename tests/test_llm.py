"""Tests for epoch.llm. No test touches the network: httpx.MockTransport answers everything."""
from __future__ import annotations

import json

import httpx
import pytest

from epoch import db, llm
from epoch.llm import OpenRouterClient, weekly_narration

SCHEMA = {
    "type": "object",
    "properties": {"category": {"type": "string"}, "minutes": {"type": "integer"}},
    "required": ["category", "minutes"],
    "additionalProperties": False,
}
GOOD = {"category": "Math", "minutes": 30}


def ok_body(content: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": content}}]}


class Server:
    """A scripted fake OpenRouter: one (status, body) reply per request, last one repeats."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        index = min(len(self.requests) - 1, len(self.replies) - 1)
        status, body = self.replies[index]
        return httpx.Response(status, json=body)

    def sent_models(self) -> list[str]:
        return [json.loads(r.content)["model"] for r in self.requests]


def make_client(db_path, server, models=("a/one:free", "b/two:free"), **kwargs) -> OpenRouterClient:
    return OpenRouterClient(
        "sk-test", models, db_path, transport=httpx.MockTransport(server), **kwargs
    )


def call_rows(db_path):
    with db.get_conn(db_path) as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM llm_calls ORDER BY id")]


# ---- complete_json -------------------------------------------------------

def test_success_sends_headers_and_schema_and_records(db_path):
    server = Server((200, ok_body(json.dumps(GOOD))))
    client = make_client(db_path, server)

    assert client.complete_json("parse_log", "Be exact.", "30m math", SCHEMA) == GOOD

    request = server.requests[0]
    assert str(request.url) == "https://openrouter.ai/api/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer sk-test"
    assert request.headers["HTTP-Referer"] == "http://localhost"
    assert request.headers["X-Title"] == "Epoch"
    payload = json.loads(request.content)
    assert payload["model"] == "a/one:free"
    assert payload["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "result", "strict": True, "schema": SCHEMA},
    }
    assert "JSON" in payload["messages"][0]["content"]  # also asked for in the prompt
    assert payload["messages"][1] == {"role": "user", "content": "30m math"}

    rows = call_rows(db_path)
    assert len(rows) == 1
    assert (rows[0]["purpose"], rows[0]["model"], rows[0]["ok"], rows[0]["error"]) == (
        "parse_log", "a/one:free", 1, None,
    )
    assert rows[0]["local_date"] and rows[0]["ts_utc"].endswith("Z")
    assert client.calls_today() == 1


def test_falls_back_to_second_model(db_path):
    server = Server((500, {"error": "boom"}), (200, ok_body(json.dumps(GOOD))))
    client = make_client(db_path, server)

    assert client.complete_json("p", "s", "u", SCHEMA) == GOOD
    assert server.sent_models() == ["a/one:free", "b/two:free"]
    rows = call_rows(db_path)
    assert [(r["model"], r["ok"], r["error"]) for r in rows] == [
        ("a/one:free", 0, "http_500"),
        ("b/two:free", 1, None),
    ]


def test_http_429_is_recorded_and_next_model_tried(db_path):
    server = Server((429, {"error": {"message": "slow down"}}), (200, ok_body(json.dumps(GOOD))))
    client = make_client(db_path, server)

    assert client.complete_json("p", "s", "u", SCHEMA) == GOOD
    assert call_rows(db_path)[0]["error"] == "http_429"


def test_all_models_429_returns_none(db_path):
    server = Server((429, {"error": "rate"}))
    client = make_client(db_path, server)

    assert client.complete_json("p", "s", "u", SCHEMA) is None
    assert len(server.requests) == 2
    assert [r["ok"] for r in call_rows(db_path)] == [0, 0]


def test_error_object_inside_200_body_is_a_failure(db_path):
    server = Server(
        (200, {"error": {"code": 502, "message": "provider down"}}),
        (200, ok_body(json.dumps(GOOD))),
    )
    client = make_client(db_path, server)

    assert client.complete_json("p", "s", "u", SCHEMA) == GOOD
    first = call_rows(db_path)[0]
    assert first["ok"] == 0 and first["error"].startswith("api_error:provider down")


def test_empty_choices_is_a_failure(db_path):
    server = Server((200, {"choices": []}))
    client = make_client(db_path, server, models=("a/one:free",))

    assert client.complete_json("p", "s", "u", SCHEMA) is None
    assert call_rows(db_path)[0]["error"] == "empty_choices"


def test_json_inside_code_fences_is_accepted(db_path):
    fenced = "```json\n" + json.dumps(GOOD) + "\n```"
    client = make_client(db_path, Server((200, ok_body(fenced))))

    assert client.complete_json("p", "s", "u", SCHEMA) == GOOD


def test_bad_json_and_missing_keys_fall_through(db_path):
    server = Server(
        (200, ok_body("sorry, I cannot")),
        (200, ok_body(json.dumps({"category": "Math"}))),  # minutes missing
    )
    client = make_client(db_path, server)

    assert client.complete_json("p", "s", "u", SCHEMA) is None
    errors = [r["error"] for r in call_rows(db_path)]
    assert errors == ["invalid_json", "missing_keys:minutes"]


def test_network_error_never_raises(db_path):
    def broken(request):
        raise httpx.ConnectError("no network")

    client = OpenRouterClient("k", ["a/one:free"], db_path, transport=httpx.MockTransport(broken))
    assert client.complete_json("p", "s", "u", SCHEMA) is None
    assert call_rows(db_path)[0]["error"] == "network:ConnectError"


def test_non_json_body_never_raises(db_path):
    handler = lambda request: httpx.Response(200, content=b"<html>oops</html>")  # noqa: E731
    client = OpenRouterClient("k", ["a/one:free"], db_path, transport=httpx.MockTransport(handler))
    assert client.complete_text("p", "s", "u") is None
    assert call_rows(db_path)[0]["error"] == "bad_json_body"


# ---- limits and safety ---------------------------------------------------

def test_daily_cap_reached_makes_no_request(db_path):
    server = Server((200, ok_body(json.dumps(GOOD))))
    client = make_client(db_path, server, daily_cap=2)

    assert client.complete_json("p", "s", "u", SCHEMA) == GOOD
    assert client.complete_json("p", "s", "u", SCHEMA) == GOOD
    assert client.complete_json("p", "s", "u", SCHEMA) is None

    assert len(server.requests) == 2
    assert client.calls_today() == 2  # the refused attempt is logged but not counted
    last = call_rows(db_path)[-1]
    assert (last["ok"], last["error"]) == (0, "daily_cap")


def test_calls_from_earlier_days_do_not_count(db_path):
    with db.get_conn(db_path) as conn:
        conn.execute(
            "INSERT INTO llm_calls(ts_utc, local_date, purpose, model, ok, error) "
            "VALUES ('2020-01-01T00:00:00Z', '2020-01-01', 'old', 'a:free', 1, NULL)"
        )
    server = Server((200, ok_body(json.dumps(GOOD))))
    client = make_client(db_path, server, daily_cap=1)

    assert client.calls_today() == 0
    assert client.complete_json("p", "s", "u", SCHEMA) == GOOD


def test_non_free_model_is_refused_without_a_request(db_path):
    server = Server((200, ok_body(json.dumps(GOOD))))
    client = make_client(db_path, server, models=("openai/gpt-4o", "meta/llama:free"))

    assert client.complete_json("p", "s", "u", SCHEMA) == GOOD
    assert server.sent_models() == ["meta/llama:free"]
    first = call_rows(db_path)[0]
    assert (first["model"], first["ok"], first["error"]) == ("openai/gpt-4o", 0, "non_free_model")


def test_only_non_free_models_means_no_request_at_all(db_path):
    server = Server((200, ok_body("hi")))
    client = make_client(db_path, server, models=("openai/gpt-4o", "anthropic/claude:paid"))

    assert client.complete_text("p", "s", "u") is None
    assert server.requests == []


def test_openrouter_free_router_is_allowed(db_path):
    server = Server((200, ok_body("hello")))
    client = make_client(db_path, server, models=("openrouter/free",))
    assert client.complete_text("p", "s", "u") == "hello"


def test_rate_limit_of_20_per_minute(db_path):
    now = [1000.0]
    server = Server((200, ok_body("hi")))
    client = make_client(db_path, server, models=("a/one:free",), daily_cap=1000, clock=lambda: now[0])

    for _ in range(20):
        assert client.complete_text("p", "s", "u") == "hi"
    assert client.complete_text("p", "s", "u") is None  # 21st within the minute
    assert len(server.requests) == 20
    last = call_rows(db_path)[-1]
    assert (last["ok"], last["error"]) == (0, "rate_limited")

    now[0] += 61  # a minute later the window has emptied
    assert client.complete_text("p", "s", "u") == "hi"


def test_no_api_key_returns_none(db_path):
    server = Server((200, ok_body("hi")))
    client = OpenRouterClient("", ["a/one:free"], db_path, transport=httpx.MockTransport(server))
    assert client.complete_text("p", "s", "u") is None
    assert server.requests == []


# ---- complete_text -------------------------------------------------------

def test_complete_text_returns_stripped_text_without_response_format(db_path):
    server = Server((200, ok_body("  Nice week.  ")))
    client = make_client(db_path, server)

    assert client.complete_text("narration", "sys", "usr", max_tokens=123) == "Nice week."
    payload = json.loads(server.requests[0].content)
    assert "response_format" not in payload and payload["max_tokens"] == 123


def test_empty_content_is_a_failure(db_path):
    server = Server((200, ok_body("   ")), (200, ok_body("fine")))
    client = make_client(db_path, server)
    assert client.complete_text("p", "s", "u") == "fine"
    assert call_rows(db_path)[0]["error"] == "empty_content"


# ---- weekly_narration ----------------------------------------------------

FACTS = {
    "outputs": 2,
    "floor_days": 5,
    "floor_days_required": 5,
    "deep_minutes": 640,
    "top_category": "Python",
    "skips_left": 1,
    "week_of": "2026-10-12",
    "best_start": "19:30",
}
GOOD_TEXT = (
    "You shipped 2 outputs and hit the floor on 5 days, with 640 deep minutes, mostly Python. "
    "The gap is Math, which only showed up once. Pattern: your best days started right at 19:30. "
    "If it is Monday at 19:30, then I open the Math chapter first."
)


class FakeText:
    def __init__(self, text):
        self.text = text
        self.calls = []

    def complete_text(self, purpose, system, user, max_tokens=400):
        self.calls.append((purpose, system, user))
        return self.text


def test_narration_accepts_grounded_text():
    fake = FakeText(GOOD_TEXT)
    assert weekly_narration(fake, FACTS) == GOOD_TEXT
    purpose, system, user = fake.calls[0]
    assert purpose == "weekly_narration"
    assert json.loads(user) == FACTS
    assert "120" in system


def test_narration_rejects_invented_number():
    assert weekly_narration(FakeText(GOOD_TEXT.replace("640", "700")), FACTS) is None


def test_narration_rejects_converted_units():
    assert weekly_narration(FakeText("You did 10.7 hours of deep work."), FACTS) is None


def test_narration_ignores_list_markers():
    text = "1. Win: 2 outputs.\n2. Gap: Math.\n3. Pattern: Python.\n4. If it is 19:30, then I open ch 1."
    assert weekly_narration(FakeText(text), FACTS) == text


def test_narration_allows_number_forms_from_facts():
    assert weekly_narration(FakeText("Deep minutes: 640.0, outputs: 2."), FACTS) is not None


def test_narration_rejects_guilt_copy_and_overlong_text():
    assert weekly_narration(FakeText("You failed at Math with 2 outputs."), FACTS) is None
    assert weekly_narration(FakeText("word " * 200), FACTS) is None


def test_narration_none_paths():
    assert weekly_narration(None, FACTS) is None
    assert weekly_narration(FakeText(None), FACTS) is None
    assert weekly_narration(FakeText(""), FACTS) is None


def test_narration_through_real_client(db_path):
    server = Server((200, ok_body(GOOD_TEXT)))
    client = make_client(db_path, server)
    assert weekly_narration(client, FACTS) == GOOD_TEXT
    assert call_rows(db_path)[0]["purpose"] == "weekly_narration"


def test_strip_code_fences():
    assert llm.strip_code_fences('```json\n{"a": 1}\n```') == '{"a": 1}'
    assert llm.strip_code_fences('```\n{"a": 1}\n```') == '{"a": 1}'
    assert llm.strip_code_fences('  {"a": 1}  ') == '{"a": 1}'


def test_an_unreadable_database_fails_closed_no_request_is_made(db_path):
    """If today's calls cannot be counted, the cap is treated as used up instead of ignored."""
    server = Server((200, ok_body(json.dumps(GOOD))))
    client = make_client(db_path, server, daily_cap=100)
    with db.get_conn(db_path) as conn:
        conn.execute("DROP TABLE llm_calls")
    assert client.calls_today() == 100
    assert client.complete_json("p", "s", "u", SCHEMA) is None
    assert server.requests == []
