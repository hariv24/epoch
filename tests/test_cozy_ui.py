"""The cozy UI shell (docs/COZY.md phase B3): the HUD script, the missions drawer and chest card, the 3D store hooks, the daily
missions setting, audio cues, and the house rules for front-end files (relative imports only, no network, calm copy)."""
from __future__ import annotations

import re
from pathlib import Path

from epoch import game

APP = Path(__file__).resolve().parent.parent / "epoch" / "web" / "static" / "app"
TPL = Path(__file__).resolve().parent.parent / "epoch" / "web" / "templates"


def _strings(js: str) -> str:
    """Every quoted string literal in a script, joined (the copy the user can read)."""
    return " ".join(m.group(2) for m in re.finditer(r"(['\"])((?:\\.|(?!\1).)*)\1", js))


def test_cozy_files_keep_to_the_rules():
    for name in ("cozy.js", "city/thumbs.js", "money.js"):
        js = (APP / name).read_text()
        assert "/static/app/" not in js, name                                      # pages load from /static/v/<fingerprint>/
        assert "http://" not in js and "https://" not in js, name
        assert "cdn" not in js.lower(), name
    thumbs = (APP / "city" / "thumbs.js").read_text()
    assert "from './room.js'" in thumbs and "from './character.js'" in thumbs     # relative module imports
    assert thumbs.count("new THREE.WebGLRenderer") == 1                           # one shared offscreen renderer
    app = (APP / "app.js").read_text()
    assert "new URL('cozy.js', BASE)" in app and "witness:write" in app and "witness:setting" in app


def test_cozy_copy_is_calm():
    for name in ("cozy.js", "money.js"):
        text = _strings((APP / name).read_text())
        assert not game.has_banned_words(text), name
        assert "!" not in re.sub(r"!==?|!\w|!\(", "", text), name             # no exclamation marks in the copy
    drawer = (TPL / "_cozy_drawer.html").read_text()
    assert not game.has_banned_words(re.sub(r"<[^>]+>", " ", drawer))


def test_today_has_the_missions_drawer_and_the_chest_card(owner):
    html = owner.get("/").text
    assert 'data-js="missions-dlg"' in html and 'data-js="missions-list"' in html
    assert 'data-js="chest-tpl"' in html and 'data-js="chest-collect"' in html
    assert "Switch daily missions off" in html


def test_settings_has_the_daily_missions_toggle_and_it_saves(owner):
    html = owner.get("/settings").text
    assert 'name="daily_missions"' in html and "Daily missions" in html
    assert re.search(r'name="daily_missions"[^>]*checked', html)                  # on by default
    r = owner.post("/api/settings/game", json={"daily_missions": False})
    assert r.status_code == 200 and r.json().get("ok") is not False
    assert not re.search(r'name="daily_missions"[^>]*checked', owner.get("/settings").text)
    assert owner.get("/api/missions").json()["enabled"] is False


def test_store_cards_carry_the_3d_hooks_and_the_activity_line(owner):
    html = owner.get("/store").text
    rp = re.search(r'<article class="item[^"]*" data-item="record_player".*?</article>', html, re.S).group(0)
    assert 'data-category="audio"' in rp and 'data-name="Record player"' in rp
    assert "Your character will play records here." in rp
    assert "fits 8 things" in html


def test_audio_has_the_game_cues():
    js = (APP / "audio.js").read_text()
    assert "cue: cue" in js
    for kind in ("coin", "mission", "chest", "place", "page"):
        assert f"kind === '{kind}'" in js
    assert "W.prefs.sound" in js.split("function cue")[1][:200]                    # only with the Sound toggle on


def test_cozy_css_block_is_one_commented_block_at_the_end():
    css = (APP / "style.css").read_text()
    start = css.index("COZY UI (docs/COZY.md")
    assert "MONEY UI" in css[:start] and "/* ==== end COZY UI ==== */" in css[start:]
    assert ".quiet" in css[start:] or "data-quiet-hide" in (APP / "cozy.js").read_text()
