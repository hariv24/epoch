"""Tests for epoch.parser: regex parsing, category keywords, and the LLM fallback."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from epoch import categories, parser

# 19:30 in Asia/Kolkata on Wed 2026-10-14.
NOW = datetime(2026, 10, 14, 14, 0, tzinfo=timezone.utc)
SETTINGS = {"timezone": "Asia/Kolkata", "day_start_hour": 4}


def parse(text: str):
    return parser.parse_log(text, SETTINGS, NOW)


@pytest.mark.parametrize(
    "text, category, minutes",
    [
        ("45m numpy ex 1-12", "Python", 45),
        ("45 min numpy", "Python", 45),
        ("1h30 math LA 2.1", "Math", 90),
        ("2h python", "Python", 120),
        ("1h python", "Python", 60),
        ("1h 30m pytorch", "ML/DL", 90),
        ("1h30m pytorch", "ML/DL", 90),
        ("1.5h karpathy", "ML/DL", 90),
        ("90 min papers attention", "Papers", 90),
        ("90 minutes papers", "Papers", 90),
        ("2 hours of papers", "Papers", 120),
        ("1 hr leetcode", "Python", 60),
        ("yt 40m", "Distracted", 40),
        ("python for 45 min", "Python", 45),
        ("did 20 minutes of la", "Math", 20),
        ("I spent half an hour on leetcode", "Python", 30),
        ("an hour of calculus", "Math", 60),
        ("30m gym", "Exercise", 30),
        ("tweet thread 40m", "Writing/X", 40),
        ("1h tracker", "Tracker build", 60),
        ("PYTHON 45M", "Python", 45),
    ],
)
def test_phrasings(text, category, minutes):
    parsed = parse(text)
    assert parsed is not None, text
    assert (parsed.category, parsed.minutes) == (category, minutes)


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        "45m",                  # no category
        "numpy",                # no duration
        "30 min plan the week",  # "la" must not match inside "plan"
        "0m python",
        "999m python",          # over 600 minutes
        "just thinking",
        "ex 1-12 numpy",        # 1-12 is not a duration
    ],
)
def test_rejects(text):
    assert parse(text) is None


def test_entry_ends_now_and_starts_minutes_earlier():
    parsed = parse("45m numpy ex 1-12")
    assert parsed.start_utc == NOW - timedelta(minutes=45)
    assert parsed.note == "numpy ex 1-12"


def test_note_drops_filler_words():
    assert parse("python for 45 min").note == "python"
    assert parse("did 20 minutes of la").note == "la"


def test_start_time_at_clock():
    parsed = parse("python 45 min at 18:30")
    # 18:30 IST is 13:00 UTC, which is before NOW (14:00 UTC).
    assert parsed.start_utc == datetime(2026, 10, 14, 13, 0, tzinfo=timezone.utc)
    assert parsed.minutes == 45
    assert parsed.note == "python"


def test_start_time_with_am_pm():
    parsed = parse("python at 6pm 1h")
    assert parsed.start_utc == datetime(2026, 10, 14, 12, 30, tzinfo=timezone.utc)


def test_future_clock_means_yesterday():
    parsed = parse("python 30m at 21:00")  # 21:00 IST is after 19:30 IST "now"
    assert parsed.start_utc == datetime(2026, 10, 13, 15, 30, tzinfo=timezone.utc)


def test_time_range_gives_start_and_length():
    parsed = parse("math 18:30-19:15")
    assert parsed.minutes == 45
    assert parsed.start_utc == datetime(2026, 10, 14, 13, 0, tzinfo=timezone.utc)
    assert parsed.note == "math"


def test_time_range_wins_over_typed_duration_and_handles_spaces():
    parsed = parse("numpy 18:00 - 19:00")
    assert parsed.minutes == 60


def test_range_crossing_midnight():
    parsed = parse("python 23:30-00:15")
    assert parsed.minutes == 45


def test_bare_hour_is_not_a_clock():
    assert parse("python at 7") is None  # no duration, and "at 7" is ambiguous


def test_invalid_clock_ignored():
    parsed = parse("python 30m at 25:99")
    assert parsed is not None and parsed.start_utc == NOW - timedelta(minutes=30)


def test_naive_now_is_treated_as_utc():
    parsed = parser.parse_log("30m python", SETTINGS, NOW.replace(tzinfo=None))
    assert parsed.start_utc == NOW - timedelta(minutes=30)


# ---- deep / shallow ------------------------------------------------------

@pytest.mark.parametrize("category_text", ["python", "math", "pytorch", "papers", "tweet"])
def test_ladder_defaults_to_deep(category_text):
    assert parse(f"30m {category_text}").deep is True


@pytest.mark.parametrize("text", ["30m gym", "30m lunch", "30m yt", "30m nap", "30m commute"])
def test_other_categories_default_to_shallow(text):
    assert parse(text).deep is False


@pytest.mark.parametrize("text", ["45m python shallow", "45m python distracted", "shallow 45m math"])
def test_shallow_words_override(text):
    assert parse(text).deep is False


def test_tracker_build_is_deep_by_default():
    assert parse("1h tracker").deep is True


# ---- keywords ------------------------------------------------------------

@pytest.mark.parametrize(
    "text, expected",
    [
        ("la", "Math"),
        ("LA 2.1", "Math"),
        ("plan", None),
        ("planning", None),
        ("pylint", None),
        ("py", "Python"),
        ("html", None),         # "ml" inside a word
        ("ml/dl", "ML/DL"),
        ("ml course", "ML/DL"),
        ("papers", "Papers"),
        ("reading a paper on neural nets", "Papers"),  # activity word beats topic word
        ("paperwork", None),
        ("walks", "Exercise"),
        ("homework", None),
        ("threading", None),
        ("thread", "Writing/X"),
        ("leetcode", "Python"),
        ("linear algebra", "Math"),
        ("deep learning", "ML/DL"),
        ("stats", "Math"),
        ("nothing here", None),
    ],
)
def test_detect_category(text, expected):
    assert parser.detect_category(text) == expected


def test_every_keyword_maps_to_a_real_category():
    for word, category in categories.KEYWORDS:
        assert category in categories.ALL, word
        assert word == word.lower() and word == word.strip(), f"fragile keyword {word!r}"


# ---- parse_log_smart -----------------------------------------------------

class FakeLLM:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def complete_json(self, purpose, system, user, schema):
        self.calls.append((purpose, user))
        return self.result


def smart(text, llm):
    return parser.parse_log_smart(None, llm, text, SETTINGS, NOW)


def test_smart_uses_regex_first_without_calling_llm():
    llm = FakeLLM({"category": "Math", "minutes": 5, "deep": True, "note": "x"})
    parsed = smart("45m numpy", llm)
    assert parsed.category == "Python" and llm.calls == []


def test_smart_without_llm_returns_none_when_regex_fails():
    assert smart("worked on a transformers tutorial for a bit", None) is None


def test_smart_falls_back_to_llm():
    llm = FakeLLM({"category": "ML/DL", "minutes": 50, "deep": True, "note": "attention tutorial"})
    parsed = smart("went through the attention tutorial for fifty minutes", llm)
    assert (parsed.category, parsed.minutes, parsed.deep) == ("ML/DL", 50, True)
    assert parsed.note == "attention tutorial"
    assert parsed.start_utc == NOW - timedelta(minutes=50)
    assert llm.calls[0][0] == "parse_log"


def test_smart_sends_only_typed_text():
    llm = FakeLLM(None)
    smart("a" * 1000, llm)
    assert len(llm.calls[0][1]) == parser.MAX_LLM_INPUT_CHARS


@pytest.mark.parametrize(
    "result",
    [
        None,
        "not a dict",
        {"category": "Basketweaving", "minutes": 30, "deep": True, "note": ""},
        {"category": "Unknown", "minutes": 30, "deep": True, "note": ""},
        {"category": "Math", "minutes": 0, "deep": True, "note": ""},
        {"category": "Math", "minutes": 601, "deep": True, "note": ""},
        {"category": "Math", "minutes": "30", "deep": True, "note": ""},
        {"category": "Math", "minutes": True, "deep": True, "note": ""},
        {"category": "Math", "deep": True, "note": ""},
    ],
)
def test_smart_rejects_bad_llm_answers(result):
    assert smart("studied something odd", FakeLLM(result)) is None


def test_smart_honours_typed_clock_and_shallow_word():
    llm = FakeLLM({"category": "Math", "minutes": 40, "deep": True, "note": ""})
    parsed = smart("studied the odd chapter at 18:00 shallow", llm)
    assert parsed.start_utc == datetime(2026, 10, 14, 12, 30, tzinfo=timezone.utc)
    assert parsed.deep is False
    assert parsed.note  # falls back to the cleaned text


def test_smart_survives_a_raising_llm():
    class Boom:
        def complete_json(self, *a, **k):
            raise RuntimeError("boom")

    assert smart("studied something odd", Boom()) is None
