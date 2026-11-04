"""PLUTO normalise + join to the LPC records by BBL (docs/WORLD.md 12.1, 12.4.6)."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "world"))
import lpc_parse  # noqa: E402
import pluto  # noqa: E402

REF = ROOT / "build" / "ref" / "street" / "pluto_1907_1908.json"
REPORT = ROOT / "build" / "ref" / "street" / "lpc" / "report.txt"
pytestmark = pytest.mark.skipif(not (REF.exists() and REPORT.exists()), reason="street reference files not present")


@pytest.fixture(scope="module")
def lots():
    return pluto.normalize(json.loads(REF.read_text()))


def test_bbl_and_lpc_bbl():
    assert pluto.bbl10("1019070046.00000000") == "1019070046"
    assert pluto.lpc_bbl(1907, 46) == "1019070046" and pluto.lpc_bbl(1908, 25) == "1019080025"


def test_124_dimensions(lots):
    r = lots["1019070046"]
    assert r["address"] == "124 WEST 123 STREET"
    assert abs(r["lotfront_ft"] - 16.67) < 0.01 and r["bldgfront_ft"] == 17.0 and r["bldgdepth_ft"] == 48.0
    assert r["floors"] == 3 and r["year"] == 1870 and r["bldgclass"] == "B1"
    assert abs(r["front_m"] - 5.18) < 0.01


def test_church_condos_and_missing_values(lots):
    assert lots["1019080009"]["bldgclass"] == "M1" and lots["1019080009"]["front_m"] > 22
    assert lots["1019087504"]["floors"] == 8 and lots["1019087504"]["year"] == 2008
    assert lots["1019080017"]["floors"] == 0          # PLUTO sometimes has no numfloors: 0, never a crash


def test_join_lpc(lots):
    j = pluto.join_lpc(lpc_parse.parse_file(REPORT), lots)
    assert j["1019070046"]["pluto"]["bldgfront_ft"] == 17.0
    assert j["1019070046"]["lpc"]["style"] == "Second Empire"
    assert j["1019080025"]["pluto"]["histdist"].startswith("Mount Morris")
    assert j["1019070037"]["pluto"]["address"] == "102 WEST 123 STREET"
