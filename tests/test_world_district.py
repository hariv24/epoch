"""Slice 3 (docs/WORLD.md 14.2): the older LPC formats (narrative district report, individual landmark reports) and the district descriptors."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "world"))
import lpc_parse  # noqa: E402

H = ROOT / "epoch" / "web" / "static" / "app" / "city" / "world" / "data" / "h"


def test_narrative_style_hint_sentence():
    txt = "In the Romanesque Revival style are the Bethel Gospel Pentecostal Church, built originally for the Harlem Club, and St. Martin's Episcopal Church, both on Lenox Avenue."
    recs = lpc_parse.parse_narrative(txt, "LP-0452")
    assert any(r.get("hint") and r["style"] == "Romanesque Revival" and r["street"] == "LENOX AVE" for r in recs)


def test_narrative_numbered_address_with_style():
    recs = lpc_parse.parse_narrative("Nos. 4-8 Mount Morris Park West are fine Neo-Grec buildings of 1888.", "LP-0452")
    assert recs and recs[0]["number"] == "4" and recs[0]["street"] == "MT MORRIS PARK W" and recs[0]["style"] == "Neo-Grec"


def test_landmark_record_block_lot_and_style():
    txt = "APOLLO THEATER, 253 West 125th Street, Borough of Manhattan. Tax Map Block 1931, Lot 3. A Neo-Classical facade of terra-cotta; neo-classical details; Neo-Classical."
    r = lpc_parse.parse_landmark(txt, "LP-1299")
    assert r["address"] == "253 W 125 ST" and r["bbl"] == "1019310003" and r["style"] == "Neo-Classical" and "terra-cotta" in r["materials"]


def test_street_name_normalisation():
    assert lpc_parse._norm_street("West 123rd Street") == "W 123 ST"
    assert lpc_parse._norm_street("Adam Clayton Powell, Jr. Boulevard") == "ADAM CLAYTON POWELL JR BLVD"


@pytest.mark.skipif(not (H / "index.json").exists(), reason="district descriptors not built")
def test_district_descriptors_shape():
    idx = json.loads((H / "index.json").read_text())
    assert len(idx["units"]) > 100 and idx["coverage"]["lots"] > 800
    assert [s["n"] for s in idx["streets"] if 120 <= s["n"] <= 126] == [126, 125, 124, 123, 122, 121, 120]    # north (low z) to south
    big = [u["id"] for u in idx["units"] if u["bytes"] > 40960]
    assert not big, big
    u = json.loads((H / "i125_lenox.json").read_text())
    assert u["subway"]["name"] == "125 St"
    styles = idx["coverage"]["styles"]
    assert styles.get("commercial", 0) > 20 and styles.get("tenement", 0) > 20 and styles.get("tower", 0) > 5
