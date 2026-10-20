"""FEAT-60 — the EBA DORA RoI data model the Excel export marks empty
required cells from.

One source: ``src/dora_roi_model.json``, extracted from the EBA "Data Model
for DORA RoI" (a column is required when Nullable = No); ``required`` is
None where the model's cell could not be read.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from src.dora_validation import roi_model, roi_required_columns  # noqa: E402

TEMPLATES = ["B_01.01", "B_01.02", "B_01.03", "B_02.01", "B_02.02", "B_02.03", "B_03.01",
             "B_03.02", "B_03.03", "B_04.01", "B_05.01", "B_05.02", "B_06.01", "B_07.01"]


def test_every_template_of_the_model_is_there():
    tables = roi_model()["tables"]
    assert sorted(tables) == sorted(TEMPLATES)
    assert all(tables[t] for t in TEMPLATES)


def test_required_flags_match_the_model():
    req = roi_required_columns()
    assert len(req) == 73
    # Keys and identifiers are required.
    for col in ("B_01.01.0010", "B_01.02.0010", "B_02.01.0010", "B_02.02.0010", "B_05.01.0010", "B_06.01.0010"):
        assert col in req, col
    # Nullable in the model.
    for col in ("B_01.02.0060", "B_01.02.0100", "B_01.02.0110", "B_02.01.0030", "B_05.01.0060"):
        assert col not in req, col


def test_unreadable_cells_are_not_shown_as_required():
    tables = roi_model()["tables"]
    unknown = sorted(f"{t}.{c['code']}" for t, cols in tables.items() for c in cols if c["required"] is None)
    assert unknown == ["B_02.02.0140", "B_06.01.0060", "B_07.01.0030"]
    assert not set(unknown) & roi_required_columns()


def test_column_codes_are_unique_per_template():
    for t, cols in roi_model()["tables"].items():
        codes = [c["code"] for c in cols]
        assert len(codes) == len(set(codes)), t


def test_the_export_writes_exactly_the_model_columns_of_each_template():
    # Guards the extraction against a page break that files columns under
    # the wrong template: what the export writes and what the model says
    # must be the same codes, sheet by sheet.
    import src.dora_export as ex
    tables = roi_model()["tables"]
    for t in TEMPLATES:
        cols = getattr(ex, "_COLS_" + t.replace("_", "").replace(".", ""))
        assert [c for c, _ in cols] == [c["code"] for c in tables[t]], t
