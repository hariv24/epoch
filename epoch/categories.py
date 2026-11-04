"""Categories, their colours and short codes, and default ActivityWatch rules."""
from __future__ import annotations

from datetime import date

# The ladder: only these count toward the floor and target (plus "Tracker build"
# during the first 14 days, see counts_toward_floor).
LADDER = ("Python", "Math", "ML/DL", "Papers", "Writing/X")
OTHER = (
    "Tracker build", "Day job", "Commute", "Food", "Exercise", "Rest",
    "Social", "Admin", "Sleep", "Distracted", "Other", "Unknown",
)
ALL = LADDER + OTHER

# Morningside palette (navy surfaces, Columbia blue is the reward). These are the dark-mode values
# tuned to pass 4.5:1 on the navy cards; the web UI swaps in light-mode tokens for the ladder (see
# app.CATEGORY_VAR and _catcolor.html). Red never appears for lapses: Papers is coral, Distracted is slate.
COLORS = {
    "Python": "#6ab0ff", "Math": "#b9a2ff", "ML/DL": "#5fdda5", "Papers": "#ff967a",
    "Writing/X": "#f590d6", "Tracker build": "#7d93b3", "Day job": "#94a3b8",
    "Commute": "#a8a29e", "Food": "#d6a77a", "Exercise": "#4fd18b", "Rest": "#f4c977",
    "Social": "#f49ac8", "Admin": "#c3d3e6", "Sleep": "#2a4572", "Distracted": "#9aaecb",
    "Other": "#c9d6e6", "Unknown": "#dfe8f2",
}

# Short codes for compact Telegram callback data ("ci:<slot_id>:<code>").
CODES = {
    "Python": "py", "Math": "ma", "ML/DL": "ml", "Papers": "pa", "Writing/X": "wx",
    "Tracker build": "tb", "Day job": "dj", "Commute": "co", "Food": "fo", "Exercise": "ex",
    "Rest": "re", "Social": "so", "Admin": "ad", "Sleep": "sl", "Distracted": "di",
    "Other": "ot", "Unknown": "un",
}
FROM_CODE = {code: name for name, code in CODES.items()}

# Words in a typed log that imply a category. Matching is lowercase and word-boundary aware
# (see parser.detect_category): "la" matches the word "la" but not "plan", and a keyword of
# 4+ letters also matches its plural ("paper" matches "papers"). The first hit in this
# list wins, so activity words ("paper", "thread") come before topic words ("python").
KEYWORDS = (
    ("tracker", "Tracker build"), ("witness", "Tracker build"), ("underdog", "Tracker build"), ("epoch", "Tracker build"),
    ("paper", "Papers"), ("arxiv", "Papers"),
    ("tweet", "Writing/X"), ("thread", "Writing/X"), ("explainer", "Writing/X"),
    ("blog", "Writing/X"), ("writing", "Writing/X"),
    ("python", "Python"), ("numpy", "Python"), ("pandas", "Python"), ("py", "Python"),
    ("leetcode", "Python"), ("exercism", "Python"),
    ("linear algebra", "Math"), ("linalg", "Math"), ("calculus", "Math"),
    ("probability", "Math"), ("statistics", "Math"), ("stats", "Math"), ("math", "Math"),
    ("maths", "Math"), ("mml", "Math"), ("la", "Math"),
    ("pytorch", "ML/DL"), ("karpathy", "ML/DL"), ("micrograd", "ML/DL"), ("nanogpt", "ML/DL"),
    ("deep learning", "ML/DL"), ("neural", "ML/DL"), ("backprop", "ML/DL"),
    ("transformer", "ML/DL"), ("llm", "ML/DL"), ("ml", "ML/DL"), ("dl", "ML/DL"),
    ("cs229", "ML/DL"), ("cs231n", "ML/DL"), ("cs224n", "ML/DL"), ("d2l", "ML/DL"),
    ("day job", "Day job"), ("office", "Day job"), ("meeting", "Day job"), ("standup", "Day job"),
    ("commute", "Commute"), ("lunch", "Food"), ("dinner", "Food"), ("breakfast", "Food"),
    ("gym", "Exercise"), ("walk", "Exercise"), ("walking", "Exercise"), ("running", "Exercise"),
    ("workout", "Exercise"), ("yoga", "Exercise"), ("exercise", "Exercise"),
    ("nap", "Rest"), ("rest", "Rest"),
    ("youtube", "Distracted"), ("yt", "Distracted"), ("instagram", "Distracted"),
    ("reels", "Distracted"), ("scroll", "Distracted"), ("scrolling", "Distracted"),
    ("distracted", "Distracted"),
)

# Default ActivityWatch rules: (field, regex, category, deep, priority). Lower priority runs first.
DEFAULT_AW_RULES = (
    ("title", r"accotability|witness|underdog", "Tracker build", 1, 10),
    ("url", r"x\.com/compose|twitter\.com/compose", "Writing/X", 1, 20),
    ("url", r"arxiv\.org|openreview\.net|paperswithcode|semanticscholar|alphaxiv", "Papers", 1, 20),
    ("title", r"3blue1brown|essence of linear algebra|khan academy|mathacademy|calculus|linear algebra", "Math", 1, 30),
    ("title", r"karpathy|zero to hero|micrograd|nanogpt|pytorch|cs231n|cs224n|cs229|dive into deep learning", "ML/DL", 1, 30),
    ("url", r"colab\.research\.google\.com|kaggle\.com", "ML/DL", 1, 30),
    ("url", r"leetcode\.com|exercism\.org|hackerrank\.com|docs\.python\.org|realpython\.com", "Python", 1, 30),
    ("app", r"^(Code|Visual Studio Code|Cursor|PyCharm.*|Jupyter.*)$", "Python", 1, 50),
    ("app", r"^(Slack|Microsoft Teams|zoom\.us|Microsoft Outlook)$", "Day job", 0, 60),
    ("app", r"^(Telegram|WhatsApp|Messages|Discord)$", "Social", 0, 70),
    ("url", r"youtube\.com|instagram\.com|reddit\.com|netflix\.com|primevideo\.com|hotstar\.com", "Distracted", 0, 80),
    ("url", r"x\.com|twitter\.com", "Distracted", 0, 90),
)


def is_ladder(category: str) -> bool:
    return category in LADDER


def counts_toward_floor(category: str, local_date: date, tracker_build_until: date | None) -> bool:
    """Ladder work always counts; "Tracker build" counts only during the first 14 days."""
    if category in LADDER:
        return True
    return category == "Tracker build" and tracker_build_until is not None and local_date <= tracker_build_until
