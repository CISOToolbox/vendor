"""Regression guard for identifier allocation after a deletion.

Deriving the next number from ``array.length`` looks harmless until something
is deleted: the length drops back onto a number already in use, and the next
object silently inherits the links of the one that was removed. Allocation
therefore takes the maximum, or loops until a free id is found.

The test runs the **compiled** ``app/js/TPRM_app.js`` — the file the image
serves — rather than a Python transcription, which would keep passing after
the shipped code broke.

Skipped when ``node`` is unavailable; the assertions need a JS runtime.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

APP_JS = Path(__file__).resolve().parents[2] / "app" / "js" / "TPRM_app.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="needs node to run the shipped frontend code"
)


def _extract(source: str, name: str) -> str:
    start = source.find("function " + name + "(")
    assert start >= 0, f"{name} is gone from TPRM_app.js — was it renamed?"
    i = source.index("{", start)
    depth = 0
    while True:
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
        i += 1
        if depth == 0:
            return source[start:i]


def _eval(names: tuple[str, ...], expr: str, data: dict | None = None) -> object:
    source = APP_JS.read_text(encoding="utf-8")
    script = (
        "\n".join(_extract(source, n) for n in names)
        + "\nvar D = JSON.parse(process.argv[1]);"
        + f"\nprocess.stdout.write(JSON.stringify({expr}));"
    )
    out = subprocess.run(
        ["node", "-e", script, "--", json.dumps(data or {})],
        capture_output=True, text=True, timeout=30, check=True,
    )
    return json.loads(out.stdout)


def test_next_id_skips_a_number_freed_by_a_deletion():
    """PP-002 was deleted; the next vendor must not be handed PP-002 again."""
    remaining = [{"id": "PP-001"}, {"id": "PP-003"}]
    assert _eval(("_nextSeqId",), '_nextSeqId("PP", JSON.parse(process.argv[1]).items)',
                 {"items": remaining}) == "PP-004"


def test_next_id_on_an_empty_collection():
    assert _eval(("_nextSeqId",), '_nextSeqId("DOC", [])') == "DOC-001"


def test_next_id_ignores_a_missing_or_malformed_id():
    items = [{"id": "AP-007"}, {}, {"id": ""}, {"id": "not-a-number"}]
    assert _eval(("_nextSeqId",), '_nextSeqId("AP", JSON.parse(process.argv[1]).items)',
                 {"items": items}) == "AP-008"


def test_vendor_risk_id_is_scoped_to_its_vendor_and_skips_freed_numbers():
    """Two vendors number their risks independently, and PP-001-R02 stays taken."""
    data = {"risks": [
        {"id": "PP-001-R01", "vendor_id": "PP-001"},
        {"id": "PP-001-R03", "vendor_id": "PP-001"},
        {"id": "PP-002-R01", "vendor_id": "PP-002"},
    ]}
    assert _eval(("_nextVendorRiskId",), '_nextVendorRiskId({id: "PP-001"})', data) == "PP-001-R04"
    assert _eval(("_nextVendorRiskId",), '_nextVendorRiskId({id: "PP-002"})', data) == "PP-002-R02"


def test_vendor_risk_id_for_a_vendor_with_no_risk_yet():
    data = {"risks": [{"id": "PP-001-R01", "vendor_id": "PP-001"}]}
    assert _eval(("_nextVendorRiskId",), '_nextVendorRiskId({id: "PP-009"})', data) == "PP-009-R01"
