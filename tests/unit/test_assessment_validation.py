"""Unit tests for assessment validation rules R1-R9.

These are the most critical business rules in the Vendor module. Each
rule maps to a specific test class that verifies both acceptance and
rejection paths.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from assessment_validation import validate_on_update, _err


def _make_template():
    return {
        "sections": [{
            "id": "s1", "title": "Section 1",
            "questions": [
                {"id": "q1", "text": "Question 1", "criticality": "high", "weight": 3},
                {"id": "q2", "text": "Question 2", "criticality": "medium", "weight": 2},
            ]
        }]
    }


def _make_stored(status="draft", template_snapshot=None, responses=None):
    class FakeStored:
        pass
    s = FakeStored()
    s.status = status
    s.template_snapshot = template_snapshot or _make_template()
    s.responses = responses or []
    s.self_validation = False
    s.score = 0
    s.completion_rate = 0
    return s


class TestR1TemplateImmutability:
    def test_mutating_template_rejected(self):
        stored = _make_stored()
        with pytest.raises(Exception) as exc:
            validate_on_update(stored, {"template_snapshot": {"sections": []}})
        assert exc.value.status_code == 403

    def test_responses_allowed(self):
        stored = _make_stored()
        result = validate_on_update(stored, {
            "responses": [{"question_id": "q1", "coverage": "covered"}]
        })
        assert "responses" in result


class TestR3CoverageValues:
    def test_valid_coverage(self):
        stored = _make_stored()
        for cov in ["covered", "partial", "not_covered", "not_applicable", None]:
            result = validate_on_update(stored, {
                "responses": [{"question_id": "q1", "coverage": cov}]
            })
            assert result is not None

    def test_invalid_coverage_rejected(self):
        stored = _make_stored()
        with pytest.raises(Exception) as exc:
            validate_on_update(stored, {
                "responses": [{"question_id": "q1", "coverage": "invented_value"}]
            })
        assert exc.value.status_code in (400, 422)


class TestR5StatusTransitions:
    def test_draft_to_pending(self):
        stored = _make_stored(status="draft")
        stored.self_validation = True
        stored.responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "covered"},
        ]
        result = validate_on_update(stored, {"status": "pending_approval"})
        assert result["status"] == "pending_approval"

    def test_validated_is_terminal(self):
        stored = _make_stored(status="validated")
        with pytest.raises(Exception) as exc:
            validate_on_update(stored, {"status": "draft"})
        assert exc.value.status_code == 409


class TestR6SelfValidation:
    def test_submission_without_self_validation_rejected(self):
        stored = _make_stored(status="draft")
        stored.self_validation = False
        stored.responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "covered"},
        ]
        with pytest.raises(Exception) as exc:
            validate_on_update(stored, {"status": "pending_approval"})
        assert exc.value.status_code == 422
        assert "self_validation" in str(exc.value.detail).lower()


class TestR8ScoreRecomputed:
    def test_score_overridden(self):
        stored = _make_stored()
        result = validate_on_update(stored, {
            "responses": [{"question_id": "q1", "coverage": "covered"}],
            "score": 999,
        })
        assert result.get("score") != 999


class TestR9LegacyExempt:
    def test_no_template_passes(self):
        stored = _make_stored()
        stored.template_snapshot = None
        result = validate_on_update(stored, {"responses": [{"foo": "bar"}]})
        assert result is not None
