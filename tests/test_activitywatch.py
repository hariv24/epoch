"""ActivityWatch tests. All HTTP is mocked with httpx.MockTransport."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import httpx

from epoch import db
from epoch.activitywatch import (
    AWClient,
    AWEvent,
    categorize,
    load_rules,
    parse_aw_time,
    suggest,
)
from epoch.timeutil import UTC, at_local

BUCKETS = {
    "aw-watcher-window_mac": {"type": "currentwindow", "hostname": "mac", "client": "aw-watcher-window"},
    "aw-watcher-afk_mac": {"type": "afkstatus", "hostname": "mac", "client": "aw-watcher-afk"},
    "aw-watcher-web-chrome": {"type": "web.tab.current", "hostname": "mac", "client": "aw-client-web"},
}


def raw(ts: str, seconds: float, app: str, title: str = "", url: str | None = None) -> dict:
    data = {"app": app, "title": title}
    if url is not None:
        data["url"] = url
    return {"timestamp": ts, "duration": seconds, "data": data}


def make_transport(buckets=BUCKETS, window=None, web=None, status=200, seen=None):
    """A fake ActivityWatch server."""

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if status != 200:
            return httpx.Response(status)
        path = request.url.path
        if path == "/api/0/info":
            return httpx.Response(200, json={"hostname": "mac", "version": "v0.13"})
        if path == "/api/0/buckets/":
            return httpx.Response(200, json=buckets)
        if path == "/api/0/query/":
            query = "\n".join(json.loads(request.content)["query"])
            if "web = query_bucket" in query:
                return httpx.Response(200, json=[web or []])
            return httpx.Response(200, json=[window or []])
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def client(**kwargs) -> AWClient:
    return AWClient("http://aw.test:5600", timeout=1, transport=make_transport(**kwargs))


T0 = datetime(2026, 10, 10, 14, 0, tzinfo=UTC)  # a Saturday: no job hours in the way


def iso(dt: datetime) -> str:
    return dt.isoformat()


# ---------------------------------------------------------------- client


def test_parse_aw_time_variants():
    a = parse_aw_time("2026-10-10T14:00:00.123456789+00:00")
    b = parse_aw_time("2026-10-10T14:00:00Z")
    c = parse_aw_time("2026-10-10T19:30:00+05:30")
    assert a.tzinfo is not None and a.microsecond == 123456
    assert b == T0
    assert c == T0 + timedelta(minutes=0)  # 19:30 IST is 14:00 UTC


def test_available_true_and_false():
    assert client().available() is True
    assert client(status=500).available() is False


def test_available_false_when_connection_fails():
    def boom(request):
        raise httpx.ConnectError("refused")

    aw = AWClient(transport=httpx.MockTransport(boom))
    assert aw.available() is False
    assert aw.events(T0, T0 + timedelta(hours=1)) == []


def test_events_parses_and_clips_window_events():
    window = [
        raw("2026-10-10T13:50:00+00:00", 1200, "Code", "main.py"),  # starts before the range
        raw("2026-10-10T14:10:00.5+00:00", 300, "Slack", "general"),
    ]
    events = client(window=window).events(T0, T0 + timedelta(hours=1))
    assert [e.app for e in events] == ["Code", "Slack"]
    assert events[0].start_utc == T0 and events[0].end_utc == T0 + timedelta(minutes=10)
    assert events[1].end_utc - events[1].start_utc == timedelta(seconds=300)
    assert events[0].url is None


def test_events_query_uses_not_afk_filter_and_period():
    seen: list[httpx.Request] = []
    client(window=[], seen=seen).events(T0, T0 + timedelta(hours=1))
    posts = [r for r in seen if r.method == "POST"]
    body = json.loads(posts[0].content)
    query = "\n".join(body["query"])
    assert "aw-watcher-window_mac" in query and "aw-watcher-afk_mac" in query
    assert "not-afk" in query and "filter_period_intersect" in query
    assert body["timeperiods"] == [f"{iso(T0)}/{iso(T0 + timedelta(hours=1))}"]


def test_events_attach_web_url_for_browsers_only():
    window = [
        raw("2026-10-10T14:00:00+00:00", 600, "Google Chrome", "arXiv page - Google Chrome"),
        raw("2026-10-10T14:10:00+00:00", 600, "Code", "main.py"),
    ]
    web = [
        raw("2026-10-10T14:00:00+00:00", 400, "", "Attention Is All You Need", "https://arxiv.org/abs/1706.03762"),
        raw("2026-10-10T14:06:40+00:00", 200, "", "Other", "https://example.com"),
        raw("2026-10-10T14:10:00+00:00", 600, "", "Stray tab", "https://not-attached.example"),
    ]
    events = client(window=window, web=web).events(T0, T0 + timedelta(hours=1))
    chrome, code = events
    assert chrome.url == "https://arxiv.org/abs/1706.03762"
    assert chrome.title == "Attention Is All You Need"
    assert code.url is None  # not a browser


def test_events_without_web_bucket_or_afk_bucket():
    buckets = {"aw-watcher-window_mac": BUCKETS["aw-watcher-window_mac"]}
    window = [raw("2026-10-10T14:00:00+00:00", 60, "Safari", "Home")]
    events = client(buckets=buckets, window=window).events(T0, T0 + timedelta(hours=1))
    assert len(events) == 1 and events[0].url is None


def test_events_empty_when_no_window_bucket():
    assert client(buckets={}).events(T0, T0 + timedelta(hours=1)) == []


def test_events_survive_garbage_payload():
    window = [{"nonsense": True}, raw("2026-10-10T14:00:00+00:00", 60, "Code")]
    events = client(window=window).events(T0, T0 + timedelta(hours=1))
    assert [e.app for e in events] == ["Code"]


# ---------------------------------------------------------------- categorize


def rule(field, pattern, category, deep=1, priority=100, id=0):
    return {"id": id, "field": field, "pattern": pattern, "category": category, "deep": deep, "priority": priority}


def event(app="Code", title="", url=None):
    return AWEvent(T0, T0 + timedelta(minutes=1), app, title, url)


def test_categorize_unknown_when_nothing_matches():
    assert categorize(event(), []) == ("Unknown", False)


def test_categorize_priority_beats_list_order():
    rules = [
        rule("app", "code", "Python", 1, priority=50, id=1),
        rule("title", "witness", "Tracker build", 1, priority=10, id=2),
    ]
    assert categorize(event(app="Code", title="witness - app.py"), rules) == ("Tracker build", True)


def test_categorize_case_insensitive_search_not_full_match():
    rules = [rule("title", r"linear algebra", "Math", 1)]
    assert categorize(event(title="Essence of LINEAR ALGEBRA, chapter 1"), rules) == ("Math", True)


def test_categorize_url_none_is_skipped():
    rules = [rule("url", r"youtube", "Distracted", 0, priority=1), rule("app", "chrome", "Other", 0, priority=2)]
    assert categorize(event(app="Chrome", url=None), rules) == ("Other", False)
    assert categorize(event(app="Chrome", url="https://www.YouTube.com/x"), rules) == ("Distracted", False)


def test_categorize_bad_regex_is_ignored():
    rules = [rule("title", "([", "Python", 1, priority=1), rule("title", "ok", "Math", 1, priority=2)]
    assert categorize(event(title="ok"), rules) == ("Math", True)


def test_load_rules_ordered_by_priority(conn):
    rules = load_rules(conn)
    assert len(rules) > 5
    priorities = [r["priority"] for r in rules]
    assert priorities == sorted(priorities)


def test_default_rules_categorize_real_looking_events(conn):
    rules = load_rules(conn)
    assert categorize(event("Google Chrome", "x", "https://arxiv.org/abs/1"), rules) == ("Papers", True)
    assert categorize(event("Code", "train.py"), rules) == ("Python", True)
    assert categorize(event("Slack", "general"), rules) == ("Day job", False)
    assert categorize(event("Google Chrome", "feed", "https://www.youtube.com/"), rules) == ("Distracted", False)


# ---------------------------------------------------------------- suggest


def stamp(minute: int, second: int = 0) -> str:
    return (T0 + timedelta(minutes=minute, seconds=second)).isoformat()


def test_suggest_dominant_category_per_slot_and_drops_thin_slots(conn):
    window = [
        # slot 0 (14:00-14:15): 8 min Code vs 4 min YouTube in Chrome -> Python
        raw(stamp(0), 480, "Code", "main.py"),
        raw(stamp(8), 240, "Google Chrome", "cat", "https://youtube.com/watch"),
        # slot 1 (14:15-14:30): only 2 active minutes -> dropped
        raw(stamp(15), 120, "Code", "main.py"),
    ]
    web = [raw(stamp(8), 240, "", "cat", "https://youtube.com/watch")]
    result = suggest(conn, client(window=window, web=web), T0, T0 + timedelta(hours=1))
    assert len(result) == 1
    only = result[0]
    assert (only.category, only.deep) == ("Python", True)
    assert only.start_utc == T0 and only.end_utc == T0 + timedelta(minutes=15)
    assert only.minutes == 15
    assert only.apps == ["Code", "Google Chrome"]


def test_suggest_merges_adjacent_equal_slots_but_not_across_gaps(conn):
    window = [
        raw(stamp(0), 1800, "Code", "a.py"),        # slots 0 and 1
        raw(stamp(45), 900, "Code", "b.py"),        # slot 3 (slot 2 empty -> gap)
    ]
    result = suggest(conn, client(window=window), T0, T0 + timedelta(hours=1))
    assert [(s.start_utc, s.end_utc) for s in result] == [
        (T0, T0 + timedelta(minutes=30)),
        (T0 + timedelta(minutes=45), T0 + timedelta(hours=1)),
    ]
    assert result[0].minutes == 30


def test_suggest_does_not_merge_different_categories(conn):
    window = [
        raw(stamp(0), 900, "Code", "a.py"),
        raw(stamp(15), 900, "Telegram", "chat"),
    ]
    result = suggest(conn, client(window=window), T0, T0 + timedelta(minutes=30))
    assert [s.category for s in result] == ["Python", "Social"]
    assert [s.deep for s in result] == [True, False]


def test_suggest_lists_at_most_three_apps_most_active_first(conn):
    window = [
        raw(stamp(0), 400, "Code"),
        raw(stamp(7), 200, "Terminal"),
        raw(stamp(10), 120, "Notes"),
        raw(stamp(12), 60, "Finder"),
    ]
    result = suggest(conn, client(window=window), T0, T0 + timedelta(minutes=15))
    assert result[0].apps == ["Code", "Terminal", "Notes"]


def test_suggest_unknown_category_when_no_rule_matches(conn):
    window = [raw(stamp(0), 600, "Preview", "scan.pdf")]
    result = suggest(conn, client(window=window), T0, T0 + timedelta(minutes=15))
    assert (result[0].category, result[0].deep) == ("Unknown", False)


def test_suggest_empty_when_aw_down(conn):
    assert suggest(conn, client(status=500), T0, T0 + timedelta(hours=1)) == []


def test_suggest_labels_job_hours_as_day_job_on_job_days(conn):
    # Monday 2026-10-12, job 10:00-19:00 IST. Study begins 19:30.
    monday = date(2026, 10, 12)
    ten = at_local(monday, "10:00", "Asia/Kolkata")
    seven = at_local(monday, "19:00", "Asia/Kolkata")
    window = [
        raw(ten.isoformat(), 900, "Code", "work.py"),       # inside job hours
        raw(seven.isoformat(), 900, "Code", "study.py"),    # right after job end
    ]
    result = suggest(conn, client(window=window), ten, seven + timedelta(minutes=30))
    assert [(s.category, s.deep) for s in result] == [("Day job", False), ("Python", True)]
    assert result[0].start_utc == ten
    assert result[1].start_utc == seven


def test_suggest_job_window_splits_a_slot(conn):
    monday = date(2026, 10, 12)
    seven = at_local(monday, "19:00", "Asia/Kolkata")
    # 10 min inside the job window, then 5 min of Python after it, in one slot.
    start = seven - timedelta(minutes=10)
    window = [raw(start.isoformat(), 900, "Code", "x.py")]
    result = suggest(conn, client(window=window), start, start + timedelta(minutes=15))
    assert [s.category for s in result] == ["Day job"]


def test_suggest_not_day_job_on_weekend_or_when_job_days_changed(conn):
    saturday = date(2026, 10, 10)
    eleven = at_local(saturday, "11:00", "Asia/Kolkata")
    window = [raw(eleven.isoformat(), 900, "Code", "x.py")]
    assert suggest(conn, client(window=window), eleven, eleven + timedelta(minutes=15))[0].category == "Python"

    monday = date(2026, 10, 12)
    eleven_mon = at_local(monday, "11:00", "Asia/Kolkata")
    db.set_setting(conn, "job_days", [])
    window = [raw(eleven_mon.isoformat(), 900, "Code", "x.py")]
    result = suggest(conn, client(window=window), eleven_mon, eleven_mon + timedelta(minutes=15))
    assert result[0].category == "Python"
