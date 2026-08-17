"""Unit tests for _compute_score and _assessment_stats from assessment_validation.py."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from assessment_validation import _compute_score, _assessment_stats


def _tpl(questions):
    """Build a minimal template_snapshot with one section."""
    return {"sections": [{"id": "s1", "title": "S1", "questions": questions}]}


def _q(qid, weight=1, criticality="info"):
    return {"id": qid, "text": f"Question {qid}", "weight": weight, "criticality": criticality}


class TestComputeScoreAllCovered:
    def test_single_question_covered(self):
        tpl = _tpl([_q("q1", weight=5)])
        responses = [{"question_id": "q1", "coverage": "covered"}]
        assert _compute_score(tpl, responses) == 100

    def test_multiple_questions_all_covered(self):
        tpl = _tpl([_q("q1", weight=3), _q("q2", weight=2)])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "covered"},
        ]
        assert _compute_score(tpl, responses) == 100

    def test_different_weights_all_covered(self):
        tpl = _tpl([_q("q1", weight=10), _q("q2", weight=1)])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "covered"},
        ]
        assert _compute_score(tpl, responses) == 100


class TestComputeScoreAllNotCovered:
    def test_single_not_covered(self):
        tpl = _tpl([_q("q1", weight=5)])
        responses = [{"question_id": "q1", "coverage": "not_covered"}]
        assert _compute_score(tpl, responses) == 0

    def test_multiple_not_covered(self):
        tpl = _tpl([_q("q1", weight=3), _q("q2", weight=2)])
        responses = [
            {"question_id": "q1", "coverage": "not_covered"},
            {"question_id": "q2", "coverage": "not_covered"},
        ]
        assert _compute_score(tpl, responses) == 0


class TestComputeScoreMixed:
    def test_partial_gives_half_weight(self):
        tpl = _tpl([_q("q1", weight=10)])
        responses = [{"question_id": "q1", "coverage": "partial"}]
        assert _compute_score(tpl, responses) == 50

    def test_mixed_covered_partial_not_covered(self):
        # q1 (w=4): covered  -> 4
        # q2 (w=4): partial  -> 2
        # q3 (w=2): not_covered -> 0
        # total=6, max=10 -> 60%
        tpl = _tpl([_q("q1", weight=4), _q("q2", weight=4), _q("q3", weight=2)])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "partial"},
            {"question_id": "q3", "coverage": "not_covered"},
        ]
        assert _compute_score(tpl, responses) == 60

    def test_not_applicable_excluded_from_denominator(self):
        # q1 (w=4): covered -> 4/4 = 100% (q2 excluded)
        tpl = _tpl([_q("q1", weight=4), _q("q2", weight=6)])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "not_applicable"},
        ]
        assert _compute_score(tpl, responses) == 100

    def test_all_not_applicable(self):
        tpl = _tpl([_q("q1", weight=3)])
        responses = [{"question_id": "q1", "coverage": "not_applicable"}]
        # max_w=0, so score is 0
        assert _compute_score(tpl, responses) == 0


class TestComputeScoreEmptyResponses:
    def test_no_responses(self):
        tpl = _tpl([_q("q1", weight=5)])
        assert _compute_score(tpl, []) == 0

    def test_empty_template_empty_responses(self):
        tpl = _tpl([])
        assert _compute_score(tpl, []) == 0


class TestComputeScoreWeightEdgeCases:
    def test_zero_weight_question(self):
        # weight=0 means max_w stays 0 for that question
        tpl = _tpl([_q("q1", weight=0), _q("q2", weight=10)])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "covered"},
        ]
        assert _compute_score(tpl, responses) == 100

    def test_default_weight_when_missing(self):
        # No weight key -> defaults to 1
        tpl = _tpl([{"id": "q1", "text": "Q1"}])
        responses = [{"question_id": "q1", "coverage": "covered"}]
        assert _compute_score(tpl, responses) == 100

    def test_null_coverage_scores_zero(self):
        tpl = _tpl([_q("q1", weight=5)])
        responses = [{"question_id": "q1", "coverage": None}]
        # None coverage -> 0 points but weight still counted in denominator
        assert _compute_score(tpl, responses) == 0


class TestAssessmentStats:
    def test_all_covered(self):
        tpl = _tpl([_q("q1"), _q("q2")])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "covered"},
        ]
        stats = _assessment_stats(tpl, responses)
        assert stats["total"] == 2
        assert stats["answered"] == 2
        assert stats["missing_coverage"] == []
        assert stats["missing_remediation"] == []

    def test_missing_coverage(self):
        tpl = _tpl([_q("q1"), _q("q2")])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": None},
        ]
        stats = _assessment_stats(tpl, responses)
        assert stats["answered"] == 1
        assert stats["missing_coverage"] == ["q2"]

    def test_partial_without_remediation(self):
        tpl = _tpl([_q("q1")])
        responses = [
            {"question_id": "q1", "coverage": "partial"},
        ]
        stats = _assessment_stats(tpl, responses)
        assert stats["answered"] == 0
        assert stats["missing_remediation"] == ["q1"]

    def test_partial_with_action_plan(self):
        tpl = _tpl([_q("q1")])
        responses = [
            {
                "question_id": "q1",
                "coverage": "partial",
                "action_plans": [{"title": "Fix it"}],
            },
        ]
        stats = _assessment_stats(tpl, responses)
        assert stats["answered"] == 1
        assert stats["missing_remediation"] == []

    def test_partial_with_justification(self):
        tpl = _tpl([_q("q1")])
        responses = [
            {
                "question_id": "q1",
                "coverage": "partial",
                "justification": "Risk accepted",
            },
        ]
        stats = _assessment_stats(tpl, responses)
        assert stats["answered"] == 1

    def test_not_applicable_counts_as_answered(self):
        tpl = _tpl([_q("q1")])
        responses = [{"question_id": "q1", "coverage": "not_applicable"}]
        stats = _assessment_stats(tpl, responses)
        assert stats["answered"] == 1

    def test_not_covered_without_remediation(self):
        tpl = _tpl([_q("q1")])
        responses = [{"question_id": "q1", "coverage": "not_covered"}]
        stats = _assessment_stats(tpl, responses)
        assert stats["answered"] == 0
        assert stats["missing_remediation"] == ["q1"]

    def test_empty_responses(self):
        tpl = _tpl([_q("q1")])
        stats = _assessment_stats(tpl, [])
        assert stats["total"] == 0
        assert stats["answered"] == 0

    def test_completion_rate_uses_response_count_as_total(self):
        """_assessment_stats uses len(responses) as total, not template question count.
        The caller (_ensure_complete_for_submission) separately checks that every
        template question has a response."""
        tpl = _tpl([_q("q1"), _q("q2"), _q("q3")])
        # Only 1 response out of 3 template questions
        responses = [{"question_id": "q1", "coverage": "covered"}]
        stats = _assessment_stats(tpl, responses)
        assert stats["total"] == 1  # len(responses), not len(template questions)
        assert stats["answered"] == 1
