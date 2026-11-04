"""Seed a temp Underdog DB with ~10 days of realistic study data (for the theme snapshot).

Usage: UNDERDOG_DATA_DIR=<tmpdir> .venv/bin/python docs/themes-v2/tools/seed.py [--focus-run]
  --focus-run  also start a 50/10 x3 Python focus run that began 18 minutes ago (Focus Screen shows the dial).
               Run it just before `capture.mjs ... focus` (or capture today first: an active run adds a nav dot).
Never point this at the real data dir.
"""
import os, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from underdog import db, rules, timeutil  # noqa: E402

data_dir = Path(os.environ["UNDERDOG_DATA_DIR"])
if "--focus-run" in sys.argv and (data_dir / "witness.db").exists():
    from underdog import pomodoro
    with db.get_conn(data_dir / "witness.db") as conn:
        pomodoro.start(conn, category="Python", label="numpy ex 13-25", preset="50-10-3",
                       now=timeutil.now_utc() - timedelta(minutes=18, seconds=24))
    print("focus run started"); sys.exit(0)
assert "accotability/data" not in str(data_dir.resolve()), "refusing to seed the real data dir"
db_path = data_dir / "witness.db"
TZ = "Asia/Kolkata"
from zoneinfo import ZoneInfo
IST = ZoneInfo(TZ)
now_local = datetime.now(IST)
today = (now_local - timedelta(hours=4)).date()
db.init_db(db_path, today=today - timedelta(days=10))

PLAN = [  # (days ago, [(start hh:mm, minutes, category, note)], outputs)
    (10, [("19:40", 50, "Python", "python crash course ch 3"), ("20:45", 30, "Math", "khan academy vectors")], []),
    (9,  [("19:35", 45, "Python", "list comprehensions drills")], []),
    (8,  [("19:30", 60, "Python", "numpy ex 1-12"), ("21:00", 30, "Writing/X", "thread on day 3")], [("Writing/X", "posted a thread on learning numpy")]),
    (7,  [("10:15", 90, "Python", "pandas groupby notebook"), ("14:00", 60, "Math", "3b1b linear algebra ep 1-3"), ("16:30", 45, "Papers", "attention is all you need skim")], [("Python", "pandas groupby notebook")]),
    (6,  [("10:30", 75, "Math", "gilbert strang lecture 1"), ("15:00", 60, "ML/DL", "karpathy micrograd part 1")], []),
    (5,  [("19:40", 45, "Python", "numpy ex 13-25"), ("20:40", 30, "Math", "matrix multiplication practice")], []),
    (4,  [("19:30", 60, "ML/DL", "micrograd backprop by hand")], [("ML/DL", "micrograd backward pass from scratch")]),
    (3,  [("19:45", 50, "Python", "leetcode easy x3"), ("21:00", 40, "Papers", "resnet paper notes")], []),
    (2,  [("19:35", 55, "Math", "derivatives + chain rule"), ("20:45", 30, "Writing/X", "x post on chain rule")], [("Writing/X", "chain rule explainer post")]),
    (1,  [("19:30", 60, "ML/DL", "makemore part 1"), ("20:45", 45, "Python", "numpy ex 1-12")], []),
    (0,  [("07:10", 45, "Python", "numpy ex 1-12"), ("08:00", 25, "Math", "eigenvectors 3b1b")], []),
]
with db.get_conn(db_path) as conn:
    db.set_setting(conn, "weather_enabled", False)
    db.set_setting(conn, "seasonal_enabled", False)
    for ago, entries, outs in PLAN:
        d = today - timedelta(days=ago)
        for hhmm, mins, cat, note in entries:
            h, m = map(int, hhmm.split(":"))
            start = datetime(d.year, d.month, d.day, h, m, tzinfo=IST)
            if ago == 0 and start + timedelta(minutes=mins) > now_local:
                start = now_local - timedelta(minutes=mins + 5)
            rules.add_entry(conn, start.astimezone(timezone.utc), (start + timedelta(minutes=mins)).astimezone(timezone.utc), cat, True, "live", note)
        for stage, what in outs:
            rules.add_output(conn, d, stage, what, "https://x.com/underdog/status/1")
    conn.commit()
if "--focus-run" in sys.argv:
    from underdog import pomodoro
    with db.get_conn(db_path) as conn:
        pomodoro.start(conn, category="Python", label="numpy ex 13-25", preset="50-10-3",
                       now=timeutil.now_utc() - timedelta(minutes=18, seconds=24))
print("seeded", db_path, "today", today)
