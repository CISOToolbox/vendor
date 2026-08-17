"""Unit tests for calculation helpers in assessment_validation.py.

Covers: _compute_score, _assessment_stats, _compute_completion.
Complements test_assessment_score.py with additional edge cases and
_compute_completion tests (not covered elsewhere).
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from assessment_validation import _compute_score, _assessment_stats, _compute_completion


def _tpl(questions):
    """Build a minimal template_snapshot with one section."""
    return {"sections": [{"id": "s1", "title": "S1", "questions": questions}]}


def _q(qid, weight=1, criticality="info"):
    return {"id": qid, "text": f"Question {qid}", "weight": weight, "criticality": criticality}


# ═══════════════════════════════════════════════════════════════════════
# _compute_score — weighted scoring with coverage values
# ═══════════════════════════════════════════════════════════════════════

class TestComputeScoreWeightedMixed:
    def test_heavy_question_covered_light_not(self):
        # q1 (w=10): covered -> 10, q2 (w=1): not_covered -> 0
        # score = 10/11 * 100 = 90.9 -> round = 91
        tpl = _tpl([_q("q1", weight=10), _q("q2", weight=1)])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "not_covered"},
        ]
        assert _compute_score(tpl, responses) == 91

    def test_light_question_covered_heavy_not(self):
        # q1 (w=1): covered -> 1, q2 (w=10): not_covered -> 0
        # score = 1/11 * 100 = 9.09 -> round = 9
        tpl = _tpl([_q("q1", weight=1), _q("q2", weight=10)])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "not_covered"},
        ]
        assert _compute_score(tpl, responses) == 9

    def test_partial_with_weight_3_vs_weight_1(self):
        # q1 (w=3): partial -> 1.5, q2 (w=1): covered -> 1
        # total=2.5, max=4, score = 62.5 -> round = 62 (Python rounds 62.5 to 62)
        tpl = _tpl([_q("q1", weight=3), _q("q2", weight=1)])
        responses = [
            {"question_id": "q1", "coverage": "partial"},
            {"question_id": "q2", "coverage": "covered"},
        ]
        assert _compute_score(tpl, responses) == 62

    def test_all_partial_equal_weights(self):
        tpl = _tpl([_q("q1", weight=2), _q("q2", weight=2)])
        responses = [
            {"question_id": "q1", "coverage": "partial"},
            {"question_id": "q2", "coverage": "partial"},
        ]
        assert _compute_score(tpl, responses) == 50


class TestComputeScoreNotApplicable:
    def test_na_excluded_from_both(self):
        # q1 covered (w=5), q2 NA (excluded), q3 not_covered (w=5)
        # total=5, max=10, score=50
        tpl = _tpl([_q("q1", weight=5), _q("q2", weight=5), _q("q3", weight=5)])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "not_applicable"},
            {"question_id": "q3", "coverage": "not_covered"},
        ]
        assert _compute_score(tpl, responses) == 50

    def test_all_na_returns_zero(self):
        tpl = _tpl([_q("q1", weight=3), _q("q2", weight=7)])
        responses = [
            {"question_id": "q1", "coverage": "not_applicable"},
            {"question_id": "q2", "coverage": "not_applicable"},
        ]
        assert _compute_score(tpl, responses) == 0

    def test_single_scored_among_many_na(self):
        tpl = _tpl([_q("q1", weight=2), _q("q2", weight=3), _q("q3", weight=5)])
        responses = [
            {"question_id": "q1", "coverage": "not_applicable"},
            {"question_id": "q2", "coverage": "not_applicable"},
            {"question_id": "q3", "coverage": "covered"},
        ]
        assert _compute_score(tpl, responses) == 100


class TestComputeScoreEdgeCases:
    def test_empty_template(self):
        tpl = _tpl([])
        assert _compute_score(tpl, []) == 0

    def test_template_with_no_sections(self):
        tpl = {"sections": []}
        assert _compute_score(tpl, []) == 0

    def test_response_for_unknown_question_ignored(self):
        tpl = _tpl([_q("q1", weight=5)])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q_unknown", "coverage": "not_covered"},
        ]
        # q_unknown has no matching question -> q.get() returns None -> skipped
        assert _compute_score(tpl, responses) == 100

    def test_response_with_null_coverage(self):
        tpl = _tpl([_q("q1", weight=5)])
        responses = [{"question_id": "q1", "coverage": None}]
        # None is not "not_applicable", so max_w += 5. Coverage is None -> 0 points
        assert _compute_score(tpl, responses) == 0

    def test_weight_as_string(self):
        tpl = _tpl([{"id": "q1", "text": "Q1", "weight": "5"}])
        responses = [{"question_id": "q1", "coverage": "covered"}]
        assert _compute_score(tpl, responses) == 100

    def test_weight_as_invalid_string_defaults_to_1(self):
        tpl = _tpl([{"id": "q1", "text": "Q1", "weight": "bad"}])
        responses = [{"question_id": "q1", "coverage": "covered"}]
        assert _compute_score(tpl, responses) == 100

    def test_multi_section_template(self):
        tpl = {
            "sections": [
                {"id": "s1", "title": "S1", "questions": [_q("q1", weight=2)]},
                {"id": "s2", "title": "S2", "questions": [_q("q2", weight=8)]},
            ]
        }
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "not_covered"},
        ]
        # 2/10 * 100 = 20
        assert _compute_score(tpl, responses) == 20


# ═══════════════════════════════════════════════════════════════════════
# _assessment_stats
# ═══════════════════════════════════════════════════════════════════════

class TestAssessmentStatsAdvanced:
    def test_total_is_response_count_not_template_count(self):
        tpl = _tpl([_q("q1"), _q("q2"), _q("q3")])
        responses = [{"question_id": "q1", "coverage": "covered"}]
        stats = _assessment_stats(tpl, responses)
        assert stats["total"] == 1

    def test_not_covered_with_action_plan_is_answered(self):
        tpl = _tpl([_q("q1")])
        responses = [{
            "question_id": "q1",
            "coverage": "not_covered",
            "action_plans": [{"title": "Remediate"}],
        }]
        stats = _assessment_stats(tpl, responses)
        assert stats["answered"] == 1
        assert stats["missing_remediation"] == []

    def test_not_covered_with_justification_is_answered(self):
        tpl = _tpl([_q("q1")])
        responses = [{
            "question_id": "q1",
            "coverage": "not_covered",
            "justification": "Risk accepted by CISO",
        }]
        stats = _assessment_stats(tpl, responses)
        assert stats["answered"] == 1

    def test_partial_with_empty_action_title_not_remediated(self):
        tpl = _tpl([_q("q1")])
        responses = [{
            "question_id": "q1",
            "coverage": "partial",
            "action_plans": [{"title": ""}],
        }]
        stats = _assessment_stats(tpl, responses)
        assert stats["answered"] == 0
        assert "q1" in stats["missing_remediation"]

    def test_partial_with_whitespace_justification_not_remediated(self):
        tpl = _tpl([_q("q1")])
        responses = [{
            "question_id": "q1",
            "coverage": "partial",
            "justification": "   ",
        }]
        stats = _assessment_stats(tpl, responses)
        assert stats["answered"] == 0
        assert "q1" in stats["missing_remediation"]

    def test_mixed_all_categories(self):
        tpl = _tpl([_q("q1"), _q("q2"), _q("q3"), _q("q4"), _q("q5")])
        responses = [
            {"question_id": "q1", "coverage": "covered"},
            {"question_id": "q2", "coverage": "not_applicable"},
            {"question_id": "q3", "coverage": None},
            {"question_id": "q4", "coverage": "partial", "action_plans": [{"title": "Fix"}]},
            {"question_id": "q5", "coverage": "not_covered"},
        ]
        stats = _assessment_stats(tpl, responses)
        assert stats["total"] == 5
        assert stats["answered"] == 3  # q1 (covered) + q2 (na) + q4 (partial remediated)
        assert stats["missing_coverage"] == ["q3"]
        assert stats["missing_remediation"] == ["q5"]

    def test_empty_responses_list(self):
        tpl = _tpl([_q("q1"), _q("q2")])
        stats = _assessment_stats(tpl, [])
        assert stats["total"] == 0
        assert stats["answered"] == 0
        assert stats["missing_coverage"] == []
        assert stats["missing_remediation"] == []


# ═══════════════════════════════════════════════════════════════════════
# _compute_completion
# ═══════════════════════════════════════════════════════════════════════

class TestComputeCompletion:
    def test_all_answered(self):
        stats = {"total": 5, "answered": 5}
        assert _compute_completion(stats) == 100

    def test_none_answered(self):
        stats = {"total": 5, "answered": 0}
        assert _compute_completion(stats) == 0

    def test_partial_answered(self):
        stats = {"total": 4, "answered": 3}
        assert _compute_completion(stats) == 75

    def test_zero_total_returns_zero(self):
        stats = {"total": 0, "answered": 0}
        assert _compute_completion(stats) == 0

    def test_rounding(self):
        # 1/3 * 100 = 33.33... -> round = 33
        stats = {"total": 3, "answered": 1}
        assert _compute_completion(stats) == 33

    def test_two_thirds(self):
        # 2/3 * 100 = 66.66... -> round = 67
        stats = {"total": 3, "answered": 2}
        assert _compute_completion(stats) == 67

    def test_single_question_answered(self):
        stats = {"total": 1, "answered": 1}
        assert _compute_completion(stats) == 100

    def test_single_question_not_answered(self):
        stats = {"total": 1, "answered": 0}
        assert _compute_completion(stats) == 0
