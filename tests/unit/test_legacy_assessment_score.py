"""A legacy assessment (no template_snapshot) never takes a client score.

Legacy rows skip the response rules, but they must not open a side door
around the workflow: created through POST or the blob PUT, they start as
draft / in_progress like any other assessment, and neither creation nor an
update (PATCH or blob) writes the `score` / `completion_rate` the client
sends — a validated assessment's score feeds the Pilot posture.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from assessment_validation import validate_blob, validate_on_create, validate_on_update  # noqa: E402

FORGED = {"score": 100, "completion_rate": 100}


def _legacy(status: str = "draft", **extra) -> dict:
    return {"id": "EVAL-031", "vendor_id": "PP-025", "title": "Legacy review",
            "status": status, "template_snapshot": None, "responses": [], **extra}


class _Row:
    def __init__(self, data: dict) -> None:
        self.__dict__.update(data)


# ── POST /assessments ────────────────────────────────────────────────

@pytest.mark.parametrize("status", ["validated", "pending_approval", "rejected"])
def test_create_refuses_a_non_initial_status(status):
    with pytest.raises(Exception) as exc:
        validate_on_create(_legacy(status, **FORGED))
    assert exc.value.status_code == 409


def test_create_drops_the_client_score():
    out = validate_on_create(_legacy("in_progress", **FORGED))
    assert out["status"] == "in_progress"
    assert out["score"] is None and out["completion_rate"] is None


# ── PATCH /assessments/{id} ──────────────────────────────────────────

@pytest.mark.parametrize("status", ["draft", "pending_approval"])
def test_patch_drops_the_client_score(status):
    out = validate_on_update(_Row(_legacy(status, score=40, completion_rate=50)), dict(FORGED))
    assert "score" not in out and "completion_rate" not in out


def test_patch_validating_keeps_the_stored_score():
    out = validate_on_update(_Row(_legacy("pending_approval", score=40)),
                             {"status": "validated", **FORGED})
    assert out["status"] == "validated"
    assert "score" not in out and "completion_rate" not in out


# ── PUT /projects/{id} (blob) ────────────────────────────────────────

def test_blob_refuses_a_new_validated_legacy_assessment():
    with pytest.raises(Exception) as exc:
        validate_blob([_legacy("validated", **FORGED)], {})
    assert exc.value.status_code == 409


def test_blob_new_legacy_assessment_has_no_score():
    [out] = validate_blob([_legacy("draft", **FORGED)], {})
    assert out["score"] is None and out["completion_rate"] is None


def test_blob_update_keeps_the_stored_score():
    stored = _legacy("pending_approval", score=40, completion_rate=50)
    [out] = validate_blob([dict(stored, status="validated", **FORGED)], {stored["id"]: stored})
    assert out["status"] == "validated"
    assert out["score"] == 40 and out["completion_rate"] == 50


# ── V1 exports: `completed` is the legacy terminal status ────────────

def test_create_accepts_a_completed_legacy_assessment_without_score():
    out = validate_on_create(_legacy("completed", **FORGED))
    assert out["status"] == "completed"
    assert out["score"] is None and out["completion_rate"] is None


def test_import_keeps_completed_legacy_assessments():
    # POST /projects/import and POST /projects validate with an empty stored map.
    done, draft = validate_blob([_legacy("completed", **FORGED), dict(_legacy("draft"), id="EVAL-032")], {})
    assert done["status"] == "completed" and done["score"] is None
    assert draft["status"] == "draft"


def test_completed_is_not_accepted_for_an_assessment_with_a_template():
    tpl = {"sections": [{"id": "s1", "title": "S1", "questions": [
        {"id": "q1", "text": "Q1", "criticality": "major", "weight": 3}]}]}
    with pytest.raises(Exception) as exc:
        validate_on_create(_legacy("completed", template_snapshot=tpl))
    assert exc.value.status_code == 409
