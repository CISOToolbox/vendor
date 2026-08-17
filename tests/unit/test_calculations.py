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
        # Only non-zero values are averaged: (1 + 3) / 2 = 2.0
        cl = {"ops_impact": 1, "processes": 0, "replace_difficulty": 3}
        assert compute_dependance(cl) == 2.0

    def test_all_non_zero_average(self):
        # (1 + 2 + 3) / 3 = 2.0
        cl = {"ops_impact": 1, "processes": 2, "replace_difficulty": 3}
        assert compute_dependance(cl) == 2.0

    def test_missing_keys(self):
        assert compute_dependance({}) == 0

    def test_none_values(self):
        cl = {"ops_impact": None, "processes": None, "replace_difficulty": None}
        assert compute_dependance(cl) == 0

    def test_string_values_converted(self):
        cl = {"ops_impact": "3", "processes": "2", "replace_difficulty": "1"}
        assert compute_dependance(cl) == 2.0

    def test_single_non_zero(self):
        cl = {"ops_impact": 4, "processes": 0, "replace_difficulty": 0}
        assert compute_dependance(cl) == 4.0

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
        # Only non-zero: (2 + 4) / 2 = 3.0
        cl = {"data_sensitivity": 2, "integration": 0, "regulatory_impact": 4}
        assert compute_penetration(cl) == 3.0

    def test_all_non_zero_average(self):
        # (1 + 3 + 2) / 3 = 2.0
        cl = {"data_sensitivity": 1, "integration": 3, "regulatory_impact": 2}
        assert compute_penetration(cl) == 2.0

    def test_missing_keys(self):
        assert compute_penetration({}) == 0

    def test_none_values(self):
        cl = {"data_sensitivity": None, "integration": None, "regulatory_impact": None}
        assert compute_penetration(cl) == 0

    def test_rounding(self):
        # (1 + 3 + 4) / 3 = 2.666... -> 2.7
        cl = {"data_sensitivity": 1, "integration": 3, "regulatory_impact": 4}
        assert compute_penetration(cl) == 2.7


# ═══════════════════════════════════════════════════════════════════════
# compute_threat_level
# ═══════════════════════════════════════════════════════════════════════

class TestComputeThreatLevel:
    def test_low_dep_pen_high_mat_conf(self):
        # ((1+1)/2 + (4-4) + (4-4)) / 3 * 4 = (1 + 0 + 0) / 3 * 4 = 1.33
        result = compute_threat_level(1.0, 1.0, 4.0, 4.0)
        assert result == 1.33

    def test_high_dep_pen_low_mat_conf(self):
        # ((4+4)/2 + (4-0) + (4-0)) / 3 * 4 = (4 + 4 + 4) / 3 * 4 = 16.0
        result = compute_threat_level(4.0, 4.0, 0.0, 0.0)
        assert result == 16.0

    def test_all_zeros(self):
        # ((0+0)/2 + (4-0) + (4-0)) / 3 * 4 = (0 + 4 + 4) / 3 * 4 = 10.67
        result = compute_threat_level(0.0, 0.0, 0.0, 0.0)
        assert result == 10.67

    def test_all_fours(self):
        # ((4+4)/2 + (4-4) + (4-4)) / 3 * 4 = (4 + 0 + 0) / 3 * 4 = 5.33
        result = compute_threat_level(4.0, 4.0, 4.0, 4.0)
        assert result == 5.33

    def test_balanced_mid(self):
        # ((2+2)/2 + (4-2) + (4-2)) / 3 * 4 = (2 + 2 + 2) / 3 * 4 = 8.0
        result = compute_threat_level(2.0, 2.0, 2.0, 2.0)
        assert result == 8.0

    def test_asymmetric_dep_pen(self):
        # ((1+3)/2 + (4-2) + (4-2)) / 3 * 4 = (2 + 2 + 2) / 3 * 4 = 8.0
        result = compute_threat_level(1.0, 3.0, 2.0, 2.0)
        assert result == 8.0

    def test_max_maturity_max_confidence_zero_exposure(self):
        # ((0+0)/2 + (4-4) + (4-4)) / 3 * 4 = 0
        result = compute_threat_level(0.0, 0.0, 4.0, 4.0)
        assert result == 0.0


# ═══════════════════════════════════════════════════════════════════════
# compute_tier
# ═══════════════════════════════════════════════════════════════════════

class TestComputeTier:
    def test_critical(self):
        assert compute_tier(3.0) == "critical"
        assert compute_tier(5.0) == "critical"

    def test_high(self):
        assert compute_tier(2.0) == "high"
        assert compute_tier(2.99) == "high"

    def test_medium(self):
        assert compute_tier(1.0) == "medium"
        assert compute_tier(1.5) == "medium"

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
        assert score_to_maturity(81) == 4
        assert score_to_maturity(100) == 4

    def test_level_3(self):
        assert score_to_maturity(61) == 3
        assert score_to_maturity(80) == 3

    def test_level_2(self):
        assert score_to_maturity(41) == 2
        assert score_to_maturity(60) == 2

    def test_level_1(self):
        assert score_to_maturity(21) == 1
        assert score_to_maturity(40) == 1

    def test_level_0(self):
        assert score_to_maturity(0) == 0
        assert score_to_maturity(20) == 0


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
        assert stats["vendors_by_tier"] == {"critical": 0, "high": 0, "medium": 0, "low": 0}
        assert stats["avg_assessment_score"] is None
        assert stats["measures_progress"] is None

    def test_vendors_by_tier(self):
        data = {
            "vendors": [
                {"_tier": "critical"},
                {"_tier": "high"},
                {"_tier": "high"},
                {"_tier": "low"},
            ]
        }
        stats = compute_project_stats(data)
        assert stats["total_vendors"] == 4
        assert stats["vendors_by_tier"]["critical"] == 1
        assert stats["vendors_by_tier"]["high"] == 2
        assert stats["vendors_by_tier"]["low"] == 1
        assert stats["vendors_by_tier"]["medium"] == 0

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
        data = {
            "vendors": [{"id": "v1", "exposure": {}}],
            "risks": [],
            "assessments": [],
        }
        result = recalculate_all(data)
        v = result["vendors"][0]
        assert v["_tier"] == "low"
        assert v["_threat_level"] == 0
