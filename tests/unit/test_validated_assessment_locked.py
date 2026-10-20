"""A validated (approved) assessment is locked.

Its content — responses, action plans, justifications, title, dates,
self-validation — can no longer change, through PATCH or through the
project blob PUT, and the blob PUT cannot drop it either. Only the
vendor-maturity settings (weight override, exclusion) and the display
order stay writable, as they weigh the approved result, they do not change
it. Re-sending the stored values is accepted as a no-op.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from assessment_validation import validate_blob, validate_on_update  # noqa: E402

TPL = {"sections": [{"id": "s1", "title": "S1", "questions": [
    {"id": "q1", "text": "Q1", "criticality": "high", "weight": 3},
    {"id": "q2", "text": "Q2", "criticality": "medium", "weight": 2},
]}]}
RESPONSES = [
    {"question_id": "q1", "coverage": "covered", "comment": "", "justification": "", "action_plans": []},
    {"question_id": "q2", "coverage": "partial", "comment": "", "justification": "planned", "action_plans": []},
]


def _stored(status: str = "validated") -> dict:
    return {
        "id": "EVAL-022", "vendor_id": "PP-025", "title": "Annual", "status": status,
        "template_snapshot": TPL, "responses": [dict(r) for r in RESPONSES],
        "self_validation": True, "due_date": "2026-12-31", "score": 80, "completion_rate": 100,
        "approved_at": "2026-10-20T07:24:04+00:00", "approved_by": "approver@example.org",
    }


class _Row:
    def __init__(self, data: dict) -> None:
        self.__dict__.update(data)


@pytest.mark.parametrize("change", [
    {"responses": [dict(RESPONSES[0]), dict(RESPONSES[1], coverage="covered")]},
    {"responses": [dict(RESPONSES[0]), dict(RESPONSES[1], justification="")]},
    {"title": "Renamed"},
    {"due_date": "2027-01-31"},
    {"self_validation": False},
    {"status": "in_progress"},
])
def test_patch_refuses_any_change(change):
    with pytest.raises(Exception) as exc:
        validate_on_update(_Row(_stored()), change)
    assert exc.value.status_code == 409


def test_patch_resending_stored_values_is_a_no_op():
    s = _stored()
    out = validate_on_update(_Row(s), {
        "status": "validated", "responses": s["responses"], "title": s["title"],
        "score": 12, "completion_rate": 3,          # client values, recomputed anyway
    })
    assert "responses" not in out and "title" not in out and "status" not in out
    assert "score" not in out and "completion_rate" not in out


@pytest.mark.parametrize("field,value", [("weight_override", 2.0), ("excluded", True), ("sort_order", 4)])
def test_maturity_settings_and_order_stay_writable(field, value):
    out = validate_on_update(_Row(_stored()), {field: value})
    assert out[field] == value


def test_blob_refuses_a_changed_validated_assessment():
    s = _stored()
    with pytest.raises(Exception) as exc:
        validate_blob([dict(s, title="Renamed")], {"EVAL-022": s})
    assert exc.value.status_code == 409


def test_blob_refuses_dropping_a_validated_assessment():
    s = _stored()
    with pytest.raises(Exception) as exc:
        validate_blob([], {"EVAL-022": s})
    assert exc.value.status_code == 409


def test_blob_keeps_an_unchanged_validated_assessment():
    s = _stored()
    out = validate_blob([dict(s)], {"EVAL-022": s})
    assert out[0]["responses"] == s["responses"] and out[0]["status"] == "validated"


def test_blob_can_still_drop_an_assessment_in_progress():
    s = _stored(status="in_progress")
    assert validate_blob([], {"EVAL-022": s}) == []


def test_an_assessment_in_progress_stays_editable():
    out = validate_on_update(_Row(_stored(status="in_progress")), {"title": "Renamed"})
    assert out["title"] == "Renamed"


def test_an_exact_echo_of_rows_stored_before_the_rules_is_accepted():
    # An orphan question id and an old coverage value, stored before R2/R3:
    # echoing them unchanged must not block the project save.
    s = _stored()
    s["responses"] = [{"question_id": "Q01", "coverage": "compliant"}]
    out = validate_blob([dict(s, responses=[dict(r) for r in s["responses"]])], {"EVAL-022": s})
    assert out[0]["responses"] == s["responses"]
    with pytest.raises(Exception) as exc:
        validate_blob([dict(s, responses=[{"question_id": "Q01", "coverage": "partial"}])], {"EVAL-022": s})
    assert exc.value.status_code == 409
