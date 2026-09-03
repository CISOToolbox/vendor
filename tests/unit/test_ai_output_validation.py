"""Validation de sortie IA par FORME DE RÉPONSE (post-incident 2026-09-02).

Un `_CHAMPS` unique pour tout le module avait vidé les réponses de
`suggest-assessment` et `collect-info` (aucun de leurs champs n'y figurait) :
502 systématique, invisible des tests car AUCUN test n'exerçait ces formes.
Chaque forme a désormais son nettoyeur, et chaque nettoyeur son test.

Stdlib + pytest, aucune base : la validation est pure.
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
    # Un id valide orphelin retomberait dans le chemin historique du frontend
    # (mise à jour aveugle, sans aperçu). L'action invalide retire l'id.
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
    # Les mesures imbriquées écrivent dans le même plan que les mesures de
    # premier niveau : mêmes contraintes action/id.
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
    # La forme qui répondait 502 : aucun de ses champs n'était dans l'ancien
    # _CHAMPS global.
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
    # L'autre forme qui répondait 502. `_applyAiData` lit un OBJET, pas une
    # liste — la validation doit le rendre tel quel.
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


# ── garde-fou transversal ────────────────────────────────────────────────

def test_the_routes_module_imports_what_it_raises():
    # Le bug d'origine : `raise HTTPException` sans import — NameError → 500
    # sur chaque chemin d'erreur, invisible du happy path.
    import importlib
    mod = importlib.import_module("src.routes.ai")
    assert hasattr(mod, "HTTPException")
