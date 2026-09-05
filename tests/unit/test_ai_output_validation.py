"""AI output validation per RESPONSE SHAPE (post-incident 2026-09-02).

A single `_CHAMPS` for the whole module had emptied the responses of
`suggest-assessment` and `collect-info` (none of their fields were in it):
systematic 502, invisible to the tests because NO test exercised those
shapes. Each shape now has its own cleaner, and each cleaner its test.

Stdlib + pytest, no database: the validation is pure.
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from src.ai_prompts import validate_output  # noqa: E402


# ── forme "measures" ─────────────────────────────────────────────────────

def test_measures_keeps_the_fields_the_frontend_reads():
    out = validate_output([{
        "action": "enrich", "id": "M-01", "mesure": "MFA fournisseur",
        "details": "Étendre aux comptes de service.", "type": "Technique",
        "responsable": "RSSI", "inconnu": "dropped",
    }], "measures")
    assert out == [{
        "action": "enrich", "id": "M-01", "mesure": "MFA fournisseur",
        "details": "Étendre aux comptes de service.", "type": "Technique",
        "responsable": "RSSI",
    }]


def test_an_invalid_action_takes_the_id_with_it():
    # An orphaned valid id would fall back into the frontend's historical
    # path (blind update, no preview). The invalid action removes the id.
    out = validate_output([{"action": "Overwrite", "id": "M-01",
                            "mesure": "x"}], "measures")
    assert out == [{"mesure": "x"}]


def test_action_case_is_normalised_not_rejected():
    out = validate_output([{"action": " Enrich ", "id": "M-01",
                            "mesure": "x"}], "measures")
    assert out[0]["action"] == "enrich" and out[0]["id"] == "M-01"


def test_a_malformed_id_takes_the_action_with_it():
    out = validate_output([{"action": "enrich", "id": "../../etc",
                            "mesure": "x"}], "measures")
    assert out == [{"mesure": "x"}]


# ── forme "risks" ────────────────────────────────────────────────────────

def test_risks_constrain_the_nested_measures_too():
    # Nested measures write into the same plan as top-level measures:
    # same action/id constraints.
    out = validate_output([{
        "title": "Défaillance sous-traitant", "category": "OPS",
        "impact": 9, "likelihood": 0,
        "measures": [{"action": "hijack", "id": "M-02", "mesure": "ok"},
                     "pas-un-dict"],
    }], "risks")
    r = out[0]
    assert r["impact"] == 5 and r["likelihood"] == 1
    assert r["measures"] == [{"mesure": "ok"}]


def test_a_non_numeric_impact_is_dropped_not_propagated():
    out = validate_output([{"title": "x", "impact": "élevé"}], "risks")
    assert "impact" not in out[0]


# ── forme "assessment" ───────────────────────────────────────────────────

def test_assessment_answers_survive_validation():
    # The shape that answered 502: none of its fields were in the old
    # global _CHAMPS.
    out = validate_output([{"question_id": "Q01", "answer": "partial",
                            "comment": "SOC 2 en cours"}], "assessment")
    assert out == [{"question_id": "Q01", "answer": "partial",
                    "comment": "SOC 2 en cours"}]


def test_assessment_requires_a_question_id():
    with pytest.raises(ValueError):
        validate_output([{"answer": "compliant"}], "assessment")


def test_assessment_answer_outside_the_enum_is_dropped():
    out = validate_output([{"question_id": "Q-001", "answer": "excellent",
                            "coverage": "covered"}], "assessment")
    assert "answer" not in out[0] and out[0]["coverage"] == "covered"


# ── forme "profile" ──────────────────────────────────────────────────────

def test_profile_returns_the_object_the_frontend_applies():
    # The other shape that answered 502. `_applyAiData` reads an OBJECT, not
    # a list — the validation must return it as-is.
    out = validate_output({
        "legal_entity": "MedSecure SAS", "country": "FR",
        "certifications": ["ISO 27001"],
        "public_docs": [{"name": "Trust", "url": "https://x", "type": "trust_center",
                         "tracking_pixel": "dropped"}],
        "risks": [{"title": "Dépendance cloud", "impact": 3, "likelihood": 3}],
        "security_assessment": {"governance": "compliant"},
        "notes": "ras", "exfiltrate": "dropped",
    }, "profile")
    assert isinstance(out, dict)
    assert out["legal_entity"] == "MedSecure SAS"
    assert out["public_docs"] == [{"name": "Trust", "url": "https://x",
                                   "type": "trust_center"}]
    assert out["risks"][0]["title"] == "Dépendance cloud"
    assert "exfiltrate" not in out


def test_an_unusable_profile_raises():
    with pytest.raises(ValueError):
        validate_output({"champ": "hors schéma"}, "profile")


# ── cross-cutting safeguard ──────────────────────────────────────────────

def test_the_routes_module_imports_what_it_raises():
    # The original bug: `raise HTTPException` without import — NameError → 500
    # on every error path, invisible from the happy path.
    import importlib
    mod = importlib.import_module("src.routes.ai")
    assert hasattr(mod, "HTTPException")
