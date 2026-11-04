"""LPC designation-report parser (docs/WORLD.md 12.1, check 12.4.1): 124, 107 and 102 W 123rd."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "world"))
import lpc_parse  # noqa: E402

REPORT = ROOT / "build" / "ref" / "street" / "lpc" / "report.txt"
pytestmark = pytest.mark.skipif(not REPORT.exists(), reason="LPC reference report not present")


@pytest.fixture(scope="module")
def recs():
    return lpc_parse.by_bbl(lpc_parse.parse_file(REPORT))


def test_all_west_123rd_even_side_parsed(recs):
    even = [r for r in recs.values() if r["address"].endswith("WEST 123RD STREET") and int(r["number"]) % 2 == 0]
    assert len(even) >= 30


def test_124_second_empire_brick_brownstone_mansard(recs):
    r = recs["1019070046"]
    assert r["address"].startswith("124 WEST 123RD") and (r["block"], r["lot"]) == (1907, 46)
    assert r["style"] == "Second Empire" and r["type"] == "Row house"
    assert r["stories"] == 3 and r["basement"] is True
    assert r["materials"] == ["brick", "brownstone"]
    f = r["flags"]
    assert f["stoop"] and f["bracketed_cornice"] and f["mansard"] and f["dormers"]
    assert "slate" in r["roof"].lower() and "arched dormer" in r["roof_features"].lower()
    assert "Sidewalk" not in r["roof_features"]
    assert r["areaway"] == "Cast iron" and r["facade"] == "North Facade"


def test_107_neo_grec_brownstone_angled_bay(recs):
    r = recs["1019080025"]
    assert r["style"] == "Neo-Grec" and r["materials"] == ["brownstone"] and r["stories"] == 3
    f = r["flags"]
    assert f["angled_bay"] and f["rusticated_base"] and f["denticulated"] and f["stoop"] and not f["mansard"]
    assert r["cornice"] == "Original"


def test_102_neo_grec_bay_bracketed_cornice(recs):
    r = recs["1019070037"]
    assert r["style"] == "Neo-Grec" and r["stories"] == 3
    assert r["flags"]["angled_bay"] and r["flags"]["bracketed_cornice"] and r["flags"]["stoop"]


def test_118_apartment_house_nine_floors(recs):
    r = recs["1019070045"]
    assert r["type"] == "Apartment building" and r["stories"] == 9 and r["basement"] is False
    assert "white glazed brick" in r["materials"]
