"""Unit tests for the FEAT-17 pre-export collector helpers (routes/dora.py).

The endpoint itself needs a DB; these lock the collect-mode mechanics:
_roi_try must swallow HTTPExceptions into structured entries and let valid
records through, _roi_payload must drop empty values (PATCH semantics).
"""
import os
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from src.routes.dora import _roi_payload, _roi_try  # noqa: E402
from src.dora_validation import validate_dora_entity  # noqa: E402


class _Col:
    def __init__(self, name): self.name = name


def _row(**cols):
    row = SimpleNamespace(**cols)
    row.__table__ = SimpleNamespace(columns=[_Col(k) for k in cols])
    return row


def test_roi_payload_drops_empty_values():
    row = _row(id="ENT-1", lei="", country_iso2=None, entity_type="credit_institution")
    assert _roi_payload(row) == {"id": "ENT-1", "entity_type": "credit_institution"}


def test_roi_try_collects_validator_errors():
    errors = []
    _roi_try(errors, "entity", "ENT-1", "Siège", validate_dora_entity,
             {"lei": "NOTALEI"})
    assert len(errors) == 1
    assert errors[0]["kind"] == "entity" and errors[0]["id"] == "ENT-1"
    assert "lei" in errors[0]["message"].lower()


def test_roi_try_passes_valid_records():
    errors = []
    _roi_try(errors, "entity", "ENT-1", "Siège", validate_dora_entity,
             {"lei": "213800WSGIIZCXF1P572", "country_iso2": "FR"})
    assert errors == []
