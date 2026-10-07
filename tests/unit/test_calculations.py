"""Unit tests for all calculation functions in src/calculations.py.

Covers: _to_num, compute_dependance, compute_penetration, compute_threat_level,
compute_tier, compute_is_dora_critical, compute_assessment_score,
score_to_maturity, compute_risk_level, compute_project_stats, recalculate_all.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from calculations import (
    _to_num,
    compute_dependance,
    compute_penetration,
    compute_threat_level,
    compute_tier,
    compute_is_dora_critical,
    compute_assessment_score,
    score_to_maturity,
    compute_risk_level,
    compute_project_stats,
    recalculate_all,
)


# ═══════════════════════════════════════════════════════════════════════
# _to_num
# ═══════════════════════════════════════════════════════════════════════

class TestToNum:
    def test_int(self):
        assert _to_num(3) == 3.0

    def test_float(self):
        assert _to_num(2.5) == 2.5

    def test_string_number(self):
        assert _to_num("4") == 4.0

    def test_none(self):
        assert _to_num(None) == 0

    def test_empty_string(self):
        assert _to_num("") == 0

    def test_invalid_string(self):
        assert _to_num("abc") == 0

    def test_bool_true(self):
        assert _to_num(True) == 1.0

    def test_list_returns_zero(self):
        assert _to_num([1, 2]) == 0


# ═══════════════════════════════════════════════════════════════════════
# compute_dependance
# ═══════════════════════════════════════════════════════════════════════

class TestComputeDependance:
    def test_all_zeros(self):
        cl = {"ops_impact": 0, "processes": 0, "replace_difficulty": 0}
        assert compute_dependance(cl) == 0

    def test_all_fours(self):
        cl = {"ops_impact": 4, "processes": 4, "replace_difficulty": 4}
        assert compute_dependance(cl) == 4.0

    def test_mixed_values(self):
        # All three rated (0 is a real rating): (1 + 0 + 3) / 3 = 1.33
        cl = {"ops_impact": 1, "processes": 0, "replace_difficulty": 3}
        assert compute_dependance(cl) == 1.3

    def test_all_non_zero_average(self):
        # (1 + 2 + 3) / 3 = 2.0
        cl = {"ops_impact": 1, "processes": 2, "replace_difficulty": 3}
        assert compute_dependance(cl) == 2.0

    def test_missing_keys_is_none(self):
        # FEAT-54: all three unassessed → axis not assessed (None), not 0.
        assert compute_dependance({}) is None

    def test_none_values_is_none(self):
        cl = {"ops_impact": None, "processes": None, "replace_difficulty": None}
        assert compute_dependance(cl) is None

    def test_partial_assessment_is_none(self):
        # FEAT-54 all-or-nothing: one indicator unassessed → the whole axis is
        # None, even if the others are rated.
        assert compute_dependance({"ops_impact": 4, "processes": 3}) is None
        assert compute_dependance(
            {"ops_impact": 4, "processes": 3, "replace_difficulty": None}) is None

    def test_all_zero_assessed_is_zero_not_none(self):
        # Three real 0s → a real mean of 0.0 (tier "low"), distinct from None.
        assert compute_dependance(
            {"ops_impact": 0, "processes": 0, "replace_difficulty": 0}) == 0.0

    def test_string_values_converted(self):
        cl = {"ops_impact": "3", "processes": "2", "replace_difficulty": "1"}
        assert compute_dependance(cl) == 2.0

    def test_single_rated_rest_zero_divides_by_three(self):
        # All three rated (two at a real 0): 4 / 3 = 1.33
        cl = {"ops_impact": 4, "processes": 0, "replace_difficulty": 0}
        assert compute_dependance(cl) == 1.3

    def test_rounding(self):
        # (1 + 2 + 4) / 3 = 2.333... -> 2.3
        cl = {"ops_impact": 1, "processes": 2, "replace_difficulty": 4}
        assert compute_dependance(cl) == 2.3


# ═══════════════════════════════════════════════════════════════════════
# compute_penetration
# ═══════════════════════════════════════════════════════════════════════

class TestComputePenetration:
    def test_all_zeros(self):
        cl = {"data_sensitivity": 0, "integration": 0, "regulatory_impact": 0}
        assert compute_penetration(cl) == 0

    def test_all_fours(self):
        cl = {"data_sensitivity": 4, "integration": 4, "regulatory_impact": 4}
        assert compute_penetration(cl) == 4.0

    def test_mixed_values(self):
        # Average of all three axes (missing = 0): (2 + 0 + 4) / 3 = 2.0
        cl = {"data_sensitivity": 2, "integration": 0, "regulatory_impact": 4}
        assert compute_penetration(cl) == 2.0

    def test_all_non_zero_average(self):
        # (1 + 3 + 2) / 3 = 2.0
        cl = {"data_sensitivity": 1, "integration": 3, "regulatory_impact": 2}
        assert compute_penetration(cl) == 2.0

    def test_missing_keys_is_none(self):
        # FEAT-54: all three unassessed → axis not assessed (None), not 0.
        assert compute_penetration({}) is None

    def test_partial_assessment_is_none(self):
        assert compute_penetration({"data_sensitivity": 2, "integration": 1}) is None

    def test_all_zero_assessed_is_zero_not_none(self):
        assert compute_penetration(
            {"data_sensitivity": 0, "integration": 0, "regulatory_impact": 0}) == 0.0

    def test_none_values_is_none(self):
        cl = {"data_sensitivity": None, "integration": None, "regulatory_impact": None}
        assert compute_penetration(cl) is None

    def test_rounding(self):
        # (1 + 3 + 4) / 3 = 2.666... -> 2.7
        cl = {"data_sensitivity": 1, "integration": 3, "regulatory_impact": 4}
        assert compute_penetration(cl) == 2.7


# ═══════════════════════════════════════════════════════════════════════
# compute_threat_level
# ═══════════════════════════════════════════════════════════════════════

class TestComputeThreatLevel:
    """Canonical formula (dep * pen) / (mat * conf); None when not assessed."""

    def test_full_exposure_low_defences_is_high(self):
        # (4 * 4) / (1 * 1) = 16.0
        assert compute_threat_level(4.0, 4.0, 1.0, 1.0) == 16.0

    def test_critical_boundary(self):
        # (4 * 4) / (2 * 2) = 4.0
        assert compute_threat_level(4.0, 4.0, 2.0, 2.0) == 4.0

    def test_high_boundary(self):
        # (4 * 2) / (2 * 2) = 2.0
        assert compute_threat_level(4.0, 2.0, 2.0, 2.0) == 2.0

    def test_medium_boundary(self):
        # (2 * 2) / (2 * 2) = 1.0
        assert compute_threat_level(2.0, 2.0, 2.0, 2.0) == 1.0

    def test_strong_defences_is_low(self):
        # (1 * 1) / (4 * 4) = 0.06
        assert compute_threat_level(1.0, 1.0, 4.0, 4.0) == 0.06

    def test_rounding(self):
        # (1 * 3) / (2 * 2) = 0.75
        assert compute_threat_level(1.0, 3.0, 2.0, 2.0) == 0.75

    # ── Maturity/confidence floor at 1: they only mitigate, never "unassess" ──
    def test_zero_confidence_floors_to_1(self):
        # confidence 0 → treated as 1 (conservative): (4*4)/(4*1) = 4.0, not None.
        assert compute_threat_level(4.0, 4.0, 4.0, 0.0) == 4.0

    def test_zero_maturity_floors_to_1(self):
        # maturity 0 → treated as 1: (4*4)/(1*4) = 4.0, not None.
        assert compute_threat_level(4.0, 4.0, 0.0, 4.0) == 4.0

    def test_classified_but_unassessed_is_conservative_max(self):
        # A classified vendor with no assessment/confidence (mat=conf=1) gets
        # the maximum threat for its exposure — never a false low.
        assert compute_threat_level(4.0, 4.0, 1.0, 1.0) == 16.0

    # ── "unassessed" = a None axis (not fully rated), NOT an axis at 0 (FEAT-54) ──
    def test_none_dependance_is_unassessed(self):
        assert compute_threat_level(None, 4.0, 4.0, 4.0) is None

    def test_none_penetration_is_unassessed(self):
        assert compute_threat_level(4.0, None, 4.0, 4.0) is None

    def test_zero_dependance_is_low_not_unassessed(self):
        # A real 0 (the three axis indicators all rated, sum 0) yields a threat
        # of 0 → tier "low", never "unassessed".
        assert compute_threat_level(0.0, 4.0, 4.0, 4.0) == 0.0

    def test_zero_penetration_is_low_not_unassessed(self):
        assert compute_threat_level(4.0, 0.0, 4.0, 4.0) == 0.0


# ═══════════════════════════════════════════════════════════════════════
# compute_tier
# ═══════════════════════════════════════════════════════════════════════

class TestComputeTier:
    def test_unassessed(self):
        # None (not assessed) is a distinct tier, never "low".
        assert compute_tier(None) == "unassessed"

    def test_critical(self):
        assert compute_tier(4.0) == "critical"
        assert compute_tier(16.0) == "critical"

    def test_high(self):
        assert compute_tier(2.0) == "high"
        assert compute_tier(3.99) == "high"

    def test_medium(self):
        assert compute_tier(1.0) == "medium"
        assert compute_tier(1.99) == "medium"

    def test_low(self):
        assert compute_tier(0.0) == "low"
        assert compute_tier(0.99) == "low"


# ═══════════════════════════════════════════════════════════════════════
# compute_is_dora_critical
# ═══════════════════════════════════════════════════════════════════════

class TestComputeIsDoraCritical:
    def test_three_at_max_is_critical(self):
        cl = {
            "ops_impact": 4, "processes": 4, "replace_difficulty": 4,
            "data_sensitivity": 0, "integration": 0, "regulatory_impact": 0,
        }
        assert compute_is_dora_critical(cl) is True

    def test_average_above_3_5_is_critical(self):
        # avg = (4+4+4+4+4+1)/6 = 21/6 = 3.5
        cl = {
            "ops_impact": 4, "processes": 4, "replace_difficulty": 4,
            "data_sensitivity": 4, "integration": 4, "regulatory_impact": 1,
        }
        assert compute_is_dora_critical(cl) is True

    def test_two_at_max_low_average_not_critical(self):
        cl = {
            "ops_impact": 4, "processes": 4, "replace_difficulty": 0,
            "data_sensitivity": 0, "integration": 0, "regulatory_impact": 0,
        }
        # at_max=2, avg=8/6=1.33 -> False
        assert compute_is_dora_critical(cl) is False

    def test_all_zeros_not_critical(self):
        cl = {
            "ops_impact": 0, "processes": 0, "replace_difficulty": 0,
            "data_sensitivity": 0, "integration": 0, "regulatory_impact": 0,
        }
        assert compute_is_dora_critical(cl) is False

    def test_empty_dict_not_critical(self):
        assert compute_is_dora_critical({}) is False

    def test_all_fours_critical(self):
        cl = {
            "ops_impact": 4, "processes": 4, "replace_difficulty": 4,
            "data_sensitivity": 4, "integration": 4, "regulatory_impact": 4,
        }
        assert compute_is_dora_critical(cl) is True

    def test_incomplete_classification_not_critical(self):
        # FEAT-54: a would-be-critical classification with any indicator still
        # unassessed is NOT flagged — the flag waits for the full six.
        cl = {
            "ops_impact": 4, "processes": 4, "replace_difficulty": 4,
            "data_sensitivity": None, "integration": 0, "regulatory_impact": 0,
        }
        assert compute_is_dora_critical(cl) is False


# ═══════════════════════════════════════════════════════════════════════
# compute_assessment_score (legacy v1 format)
# ═══════════════════════════════════════════════════════════════════════

class TestComputeAssessmentScore:
    def test_empty_responses(self):
        score, completion = compute_assessment_score([])
        assert score == 0
        assert completion == 0

    def test_all_compliant(self):
        responses = [
            {"answer": "compliant"},
            {"answer": "compliant"},
        ]
        score, completion = compute_assessment_score(responses)
        assert score == 100
        assert completion == 100

    def test_all_non_compliant(self):
        responses = [
            {"answer": "non_compliant"},
            {"answer": "non_compliant"},
        ]
        score, completion = compute_assessment_score(responses)
        assert score == 0
        assert completion == 100

    def test_all_partial(self):
        responses = [{"answer": "partial"}]
        score, completion = compute_assessment_score(responses)
        assert score == 50
        assert completion == 100

    def test_mixed_answers(self):
        responses = [
            {"answer": "compliant"},
            {"answer": "partial"},
            {"answer": "non_compliant"},
        ]
        # earned = 10 + 5 + 0 = 15, total_weight = 30, score = 50%
        score, completion = compute_assessment_score(responses)
        assert score == 50
        assert completion == 100

    def test_na_excluded_from_score_denominator(self):
        responses = [
            {"answer": "compliant"},
            {"answer": "na"},
        ]
        # Only 1 scored answer: 10/10 = 100%, completion = 2/2 = 100%
        score, completion = compute_assessment_score(responses)
        assert score == 100
        assert completion == 100

    def test_unanswered_reduces_completion(self):
        responses = [
            {"answer": "compliant"},
            {"answer": ""},
            {"answer": ""},
        ]
        # answered=1, total_weight=10, earned=10 -> score=100%, completion=1/3=33.3%
        score, completion = compute_assessment_score(responses)
        assert score == 100
        assert completion == 33.3

    def test_none_responses(self):
        score, completion = compute_assessment_score(None)
        assert score == 0
        assert completion == 0


# ═══════════════════════════════════════════════════════════════════════
# score_to_maturity
# ═══════════════════════════════════════════════════════════════════════

class TestScoreToMaturity:
    def test_level_4(self):
        assert score_to_maturity(80) == 4
        assert score_to_maturity(100) == 4

    def test_level_3(self):
        assert score_to_maturity(60) == 3
        assert score_to_maturity(79) == 3

    def test_level_2(self):
        assert score_to_maturity(40) == 2
        assert score_to_maturity(59) == 2

    def test_floors_at_1(self):
        # Maturity never returns 0 — it is a denominator that only mitigates.
        assert score_to_maturity(39) == 1
        assert score_to_maturity(20) == 1
        assert score_to_maturity(0) == 1


# ═══════════════════════════════════════════════════════════════════════
# compute_risk_level
# ═══════════════════════════════════════════════════════════════════════

class TestComputeRiskLevel:
    def test_critical(self):
        assert compute_risk_level(5, 3) == "critical"  # 15
        assert compute_risk_level(5, 5) == "critical"  # 25

    def test_high(self):
        assert compute_risk_level(3, 3) == "high"  # 9
        assert compute_risk_level(4, 3) == "high"  # 12

    def test_medium(self):
        assert compute_risk_level(2, 2) == "medium"  # 4
        assert compute_risk_level(2, 4) == "medium"  # 8

    def test_low(self):
        assert compute_risk_level(1, 1) == "low"  # 1
        assert compute_risk_level(1, 3) == "low"  # 3


# ═══════════════════════════════════════════════════════════════════════
# compute_project_stats
# ═══════════════════════════════════════════════════════════════════════

class TestComputeProjectStats:
    def test_empty_project(self):
        stats = compute_project_stats({})
        assert stats["total_vendors"] == 0
        assert stats["total_risks"] == 0
        assert stats["total_measures"] == 0
        assert stats["total_assessments"] == 0
        assert stats["total_documents"] == 0
        assert stats["vendors_by_tier"] == {"critical": 0, "high": 0, "medium": 0, "low": 0, "unassessed": 0}
        assert stats["avg_assessment_score"] is None
        assert stats["measures_progress"] is None

    def test_vendors_by_tier(self):
        data = {
            "vendors": [
                {"_tier": "critical"},
                {"_tier": "high"},
                {"_tier": "high"},
                {"_tier": "low"},
                {"_tier": "unassessed"},
                {"_tier": "unassessed"},
            ]
        }
        stats = compute_project_stats(data)
        assert stats["total_vendors"] == 6
        assert stats["vendors_by_tier"]["critical"] == 1
        assert stats["vendors_by_tier"]["high"] == 2
        assert stats["vendors_by_tier"]["low"] == 1
        assert stats["vendors_by_tier"]["medium"] == 0
        assert stats["vendors_by_tier"]["unassessed"] == 2
        # The breakdown must stay a true partition of total_vendors.
        assert sum(stats["vendors_by_tier"].values()) == stats["total_vendors"]

    def test_vendors_by_status(self):
        data = {
            "vendors": [
                {"status": "active"},
                {"status": "active"},
                {"status": "prospect"},
            ]
        }
        stats = compute_project_stats(data)
        assert stats["vendors_by_status"]["active"] == 2
        assert stats["vendors_by_status"]["prospect"] == 1

    def test_vendor_without_tier_defaults_low(self):
        data = {"vendors": [{"name": "V1"}]}
        stats = compute_project_stats(data)
        assert stats["vendors_by_tier"]["low"] == 1

    def test_risks_by_level(self):
        data = {
            "risks": [
                {"_risk_level": "critical"},
                {"_risk_level": "medium"},
                {"_risk_level": "medium"},
            ]
        }
        stats = compute_project_stats(data)
        assert stats["total_risks"] == 3
        assert stats["risks_by_level"]["critical"] == 1
        assert stats["risks_by_level"]["medium"] == 2

    def test_avg_assessment_score(self):
        data = {
            "assessments": [
                {"status": "completed", "score": 80},
                {"status": "completed", "score": 60},
                {"status": "draft", "score": 100},  # not completed, excluded
            ]
        }
        stats = compute_project_stats(data)
        assert stats["avg_assessment_score"] == 70.0

    def test_measures_progress(self):
        data = {
            "vendors": [
                {
                    "measures": [
                        {"statut": "completed"},
                        {"statut": "in_progress"},
                        {"statut": "completed"},
                    ]
                },
                {
                    "measures": [
                        {"statut": "planned"},
                    ]
                },
            ]
        }
        stats = compute_project_stats(data)
        assert stats["total_measures"] == 4
        # 4 active (all have non-empty statut), 2 completed -> 50%
        assert stats["measures_progress"] == 50.0

    def test_measures_progress_none_when_no_active(self):
        data = {"vendors": [{"measures": [{"statut": ""}]}]}
        stats = compute_project_stats(data)
        assert stats["measures_progress"] is None

    def test_documents_count(self):
        data = {"documents": [{"id": "d1"}, {"id": "d2"}]}
        stats = compute_project_stats(data)
        assert stats["total_documents"] == 2


# ═══════════════════════════════════════════════════════════════════════
# recalculate_all
# ═══════════════════════════════════════════════════════════════════════

class TestRecalculateAll:
    def test_empty_data(self):
        result = recalculate_all({})
        assert result["vendors"] == []
        assert result["risks"] == []
        assert result["assessments"] == []

    def test_vendor_exposure_computed(self):
        data = {
            "vendors": [{
                "id": "v1",
                "classification": {
                    "ops_impact": 4, "processes": 4, "replace_difficulty": 4,
                    "data_sensitivity": 2, "integration": 2, "regulatory_impact": 2,
                },
                "exposure": {"maturite": 2, "confiance": 2},
            }],
            "risks": [],
            "assessments": [],
        }
        result = recalculate_all(data)
        v = result["vendors"][0]
        assert v["exposure"]["dependance"] == 4.0
        assert v["exposure"]["penetration"] == 2.0
        assert v["_tier"] in ("critical", "high", "medium", "low")
        assert isinstance(v["_threat_level"], float)

    def test_risk_levels_computed(self):
        data = {
            "vendors": [],
            "risks": [{"impact": 5, "likelihood": 3}],
            "assessments": [],
        }
        result = recalculate_all(data)
        assert result["risks"][0]["_risk_level"] == "critical"

    def test_assessment_score_updated(self):
        data = {
            "vendors": [],
            "risks": [],
            "assessments": [{
                "status": "completed",
                "vendor_id": "v1",
                "responses": [
                    {"answer": "compliant"},
                    {"answer": "partial"},
                ],
            }],
        }
        result = recalculate_all(data)
        a = result["assessments"][0]
        assert a["score"] == 75.0
        assert a["completion_rate"] == 100.0

    def test_vendor_without_classification(self):
        # Empty exposure = not assessed: a distinct 'unassessed' tier with no
        # score, never a false 'low' (the methodology fix).
        data = {
            "vendors": [{"id": "v1", "exposure": {}}],
            "risks": [],
            "assessments": [],
        }
        result = recalculate_all(data)
        v = result["vendors"][0]
        assert v["_tier"] == "unassessed"
        assert v["_threat_level"] is None
