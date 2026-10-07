"""Unit tests for _compute_menace from routes/internal.py."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from routes.internal import _compute_menace


class TestComputeMenaceFormula:
    """Verify the (D*P)/(M*C) formula and rounding."""

    def test_basic_calculation(self):
        # (4*4)/(2*2) = 4.0
        score, _ = _compute_menace({
            "dependance": 4, "penetration": 4,
            "maturite": 2, "confiance": 2,
        })
        assert score == 4.0

    def test_fractional_result(self):
        # (3*2)/(4*1) = 1.5
        score, _ = _compute_menace({
            "dependance": 3, "penetration": 2,
            "maturite": 4, "confiance": 1,
        })
        assert score == 1.5

    def test_rounding_to_two_decimals(self):
        # (3*3)/(7*2) = 9/14 = 0.642857... -> 0.64
        score, _ = _compute_menace({
            "dependance": 3, "penetration": 3,
            "maturite": 7, "confiance": 2,
        })
        assert score == 0.64

    def test_high_numerator_low_denominator(self):
        # (5*5)/(1*1) = 25.0
        score, _ = _compute_menace({
            "dependance": 5, "penetration": 5,
            "maturite": 1, "confiance": 1,
        })
        assert score == 25.0

    def test_equal_values(self):
        # (3*3)/(3*3) = 1.0
        score, _ = _compute_menace({
            "dependance": 3, "penetration": 3,
            "maturite": 3, "confiance": 3,
        })
        assert score == 1.0


class TestComputeMenaceZeroHandling:
    """FEAT-54: 'unassessed' is a None dependance/penetration (axis not fully
    rated), NOT an axis at 0. A real 0 yields a computed (low) threat; None (or
    a missing axis) → score None, tier 'NonEvaluee'. Maturity/confidence floor
    at 1, so a 0 there is a conservative value."""

    def test_none_dependance_is_unassessed(self):
        score, tier = _compute_menace({
            "dependance": None, "penetration": 5,
            "maturite": 3, "confiance": 3,
        })
        assert score is None
        assert tier == "NonEvaluee"

    def test_none_penetration_is_unassessed(self):
        score, tier = _compute_menace({
            "dependance": 5, "penetration": None,
            "maturite": 3, "confiance": 3,
        })
        assert score is None
        assert tier == "NonEvaluee"

    def test_missing_dependance_is_unassessed(self):
        score, tier = _compute_menace({"penetration": 5, "maturite": 3, "confiance": 3})
        assert score is None
        assert tier == "NonEvaluee"

    def test_zero_dependance_is_computed_low(self):
        # A real 0 → (0*5)/(3*3) = 0.0, a computed low threat, not 'NonEvaluee'.
        score, tier = _compute_menace({
            "dependance": 0, "penetration": 5,
            "maturite": 3, "confiance": 3,
        })
        assert score == 0.0
        assert tier != "NonEvaluee"

    def test_zero_maturite_floors_to_1(self):
        # (5*5)/(1*3) = 8.33 — computed, not unassessed.
        score, tier = _compute_menace({
            "dependance": 5, "penetration": 5,
            "maturite": 0, "confiance": 3,
        })
        assert score == 8.33
        assert tier == "Critique"

    def test_zero_confiance_floors_to_1(self):
        # (5*5)/(3*1) = 8.33 — the zero-confidence case is conservative, not low.
        score, tier = _compute_menace({
            "dependance": 5, "penetration": 5,
            "maturite": 3, "confiance": 0,
        })
        assert score == 8.33
        assert tier == "Critique"

    def test_missing_keys_is_unassessed(self):
        # No classification at all → dependance/penetration 0 → unassessed.
        score, tier = _compute_menace({})
        assert score is None
        assert tier == "NonEvaluee"

    def test_none_values_is_unassessed(self):
        score, tier = _compute_menace({
            "dependance": None, "penetration": None,
            "maturite": None, "confiance": None,
        })
        assert score is None
        assert tier == "NonEvaluee"


class TestComputeMenaceTiers:
    """Thresholds: >=4 critical, >=2 high, >=1 medium, <1 low."""

    def test_critical_at_exactly_4(self):
        # (4*4)/(2*2) = 4.0
        _, tier = _compute_menace({
            "dependance": 4, "penetration": 4,
            "maturite": 2, "confiance": 2,
        })
        assert tier == "Critique"

    def test_critical_above_4(self):
        # (5*5)/(1*1) = 25.0
        _, tier = _compute_menace({
            "dependance": 5, "penetration": 5,
            "maturite": 1, "confiance": 1,
        })
        assert tier == "Critique"

    def test_high_at_exactly_2(self):
        # (4*2)/(2*2) = 2.0
        _, tier = _compute_menace({
            "dependance": 4, "penetration": 2,
            "maturite": 2, "confiance": 2,
        })
        assert tier == "Elevee"

    def test_high_between_2_and_4(self):
        # (3*3)/(2*1) = 4.5 -> critical actually, let's pick (3*2)/(2*1) = 3.0
        _, tier = _compute_menace({
            "dependance": 3, "penetration": 2,
            "maturite": 2, "confiance": 1,
        })
        assert tier == "Elevee"

    def test_medium_at_exactly_1(self):
        # (2*2)/(2*2) = 1.0
        _, tier = _compute_menace({
            "dependance": 2, "penetration": 2,
            "maturite": 2, "confiance": 2,
        })
        assert tier == "Moderee"

    def test_medium_between_1_and_2(self):
        # (3*2)/(4*1) = 1.5
        _, tier = _compute_menace({
            "dependance": 3, "penetration": 2,
            "maturite": 4, "confiance": 1,
        })
        assert tier == "Moderee"

    def test_low_below_1(self):
        # (1*1)/(3*3) = 0.11
        _, tier = _compute_menace({
            "dependance": 1, "penetration": 1,
            "maturite": 3, "confiance": 3,
        })
        assert tier == "Faible"

    def test_low_just_below_1(self):
        # (3*3)/(10*1) = 0.9
        _, tier = _compute_menace({
            "dependance": 3, "penetration": 3,
            "maturite": 10, "confiance": 1,
        })
        assert tier == "Faible"
