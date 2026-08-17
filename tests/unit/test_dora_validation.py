"""Unit tests for DORA RoI validation rules R1..R15.

Reference: src/dora_validation.py docstring.
"""
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from dora_validation import (
    codelists,
    lei_is_valid,
    validate_country,
    validate_currency,
    validate_date,
    validate_dora_arrangement,
    validate_dora_branch,
    validate_dora_consolidation,
    validate_dora_entity,
    validate_dora_function,
    validate_dora_signer,
    validate_dora_arrangement_subcontractor,
    validate_dora_subcontractor,
    validate_lei,
    validate_non_negative,
    validate_parent_chain,
    validate_reporting_period,
    validate_vendor_roi,
)


# R1 — LEI mod-97-10 ─────────────────────────────────────────────


class TestR1LeiChecksum:
    def test_valid_lei_accepted(self):
        # 213800WSGIIZCXF1P572 is a real-format mod-97-10 valid LEI
        assert lei_is_valid("213800WSGIIZCXF1P572")

    def test_invalid_checksum_rejected(self):
        assert not lei_is_valid("213800WSGIIZCXF1P500")

    def test_too_short_rejected(self):
        assert not lei_is_valid("ABC")

    def test_lowercase_normalized(self):
        assert lei_is_valid("213800wsgiizcxf1p572")

    def test_validate_lei_empty_optional_ok(self):
        validate_lei("")
        validate_lei(None)

    def test_validate_lei_required_empty_raises(self):
        with pytest.raises(HTTPException) as ei:
            validate_lei("", required=True)
        assert ei.value.status_code == 422

    def test_validate_lei_invalid_raises(self):
        with pytest.raises(HTTPException):
            validate_lei("ABCDEF")


# R2 — country ISO-3166 ───────────────────────────────────────────


class TestR2Country:
    @pytest.mark.parametrize("c", ["FR", "DE", "GB", "US"])
    def test_known_country_ok(self, c):
        validate_country(c)

    def test_empty_ok(self):
        validate_country("")

    def test_unknown_raises(self):
        with pytest.raises(HTTPException):
            validate_country("XX")


# R3 — currency ISO-4217 ─────────────────────────────────────────


class TestR3Currency:
    def test_eur_ok(self):
        validate_currency("EUR")

    def test_unknown_raises(self):
        with pytest.raises(HTTPException):
            validate_currency("XYZ")

    def test_empty_ok(self):
        validate_currency("")


# R4 — codelists enum (covered through entity_type, etc.) ────────


class TestR4Codelist:
    def test_entity_type_codelist_loaded(self):
        cl = codelists()
        assert any(it["code"] == "credit_institution" for it in cl["entity_type"])

    def test_entity_unknown_type_raises(self):
        with pytest.raises(HTTPException):
            validate_dora_entity({"entity_type": "not_a_real_type"})

    def test_arrangement_unknown_type_raises(self):
        with pytest.raises(HTTPException):
            validate_dora_arrangement({"arrangement_type": "fake"})


# R5 / R6 — dates / reporting period ─────────────────────────────


class TestR5R6Dates:
    def test_iso_date_ok(self):
        validate_date("2024-01-15")

    def test_bad_format_raises(self):
        with pytest.raises(HTTPException):
            validate_date("15/01/2024")

    def test_reporting_period_must_be_year_end(self):
        validate_reporting_period("2024-12-31")
        with pytest.raises(HTTPException):
            validate_reporting_period("2024-06-30")


# R7 / R10 — parent chain depth & cycles ─────────────────────────


class TestR7R10ParentChain:
    def test_simple_chain_ok(self):
        validate_parent_chain({"a": "b", "b": "c", "c": None}, "a")

    def test_cycle_raises(self):
        with pytest.raises(HTTPException) as ei:
            validate_parent_chain({"a": "b", "b": "a"}, "a")
        assert "cycle" in ei.value.detail.lower()

    def test_too_deep_raises(self):
        # 12-deep chain exceeds default max_depth=10
        edges = {f"n{i}": f"n{i+1}" for i in range(12)}
        edges["n12"] = None
        with pytest.raises(HTTPException) as ei:
            validate_parent_chain(edges, "n0")
        assert "depth" in ei.value.detail.lower()


# R8 — subcontractor tier range ──────────────────────────────────


class TestR8Tier:
    # Tier is a per-link (junction) attribute since the identity/junction
    # split — the junction validator carries R8 (test updated accordingly).
    def test_tier_in_range_ok(self):
        validate_dora_arrangement_subcontractor({"tier": 5})

    def test_tier_zero_raises(self):
        with pytest.raises(HTTPException):
            validate_dora_arrangement_subcontractor({"tier": 0})

    def test_tier_too_deep_raises(self):
        with pytest.raises(HTTPException):
            validate_dora_arrangement_subcontractor({"tier": 99})


# R11 — subsidiary requires parent_lei ───────────────────────────


class TestR11SubsidiaryParent:
    def test_subsidiary_without_parent_raises(self):
        with pytest.raises(HTTPException):
            validate_dora_entity({"hierarchy": "subsidiary", "parent_lei": ""})

    def test_subsidiary_with_parent_ok(self):
        validate_dora_entity({
            "hierarchy": "subsidiary",
            "parent_lei": "213800WSGIIZCXF1P572",
        })


# R12 — critical-function support requires critical function ──────


class TestR12CriticalFunctionSupport:
    def test_critical_support_with_critical_fn_ok(self):
        validate_dora_arrangement(
            {"is_critical_function_support": True}, function_is_critical=True
        )

    def test_critical_support_with_non_critical_fn_raises(self):
        with pytest.raises(HTTPException):
            validate_dora_arrangement(
                {"is_critical_function_support": True}, function_is_critical=False
            )

    def test_non_critical_support_no_check(self):
        validate_dora_arrangement(
            {"is_critical_function_support": False}, function_is_critical=False
        )


# R13 / R14 — non-negative numbers ───────────────────────────────


class TestR13R14NonNegative:
    def test_positive_ok(self):
        validate_non_negative(5, field="x")

    def test_zero_ok(self):
        validate_non_negative(0, field="x")

    def test_none_ok(self):
        validate_non_negative(None, field="x")

    def test_negative_raises(self):
        with pytest.raises(HTTPException):
            validate_non_negative(-1, field="x")


# R15 — sub-contractor self-reference ────────────────────────────


class TestR15SubSelfRef:
    # R15 lives on the junction validator (identity/junction split).
    def test_self_parent_raises(self):
        with pytest.raises(HTTPException):
            validate_dora_arrangement_subcontractor(
                {"parent_subcontractor_id": "S1"}, self_subcontractor_id="S1"
            )

    def test_other_parent_ok(self):
        validate_dora_arrangement_subcontractor(
            {"parent_subcontractor_id": "S2"}, self_subcontractor_id="S1"
        )


# Vendor RoI ─────────────────────────────────────────────────────


class TestVendorRoIPatch:
    def test_full_valid_payload_ok(self):
        validate_vendor_roi({
            "lei": "213800WSGIIZCXF1P572",
            "country_iso2": "FR",
            "person_type": "legal",
            "entity_nature": "non_intragroup",  # codelist changed: intragroup|non_intragroup
            "additional_id_type": "VAT",
        })

    def test_bad_country_raises(self):
        with pytest.raises(HTTPException):
            validate_vendor_roi({"country_iso2": "ZZ"})

    def test_bad_person_type_raises(self):
        with pytest.raises(HTTPException):
            validate_vendor_roi({"person_type": "robot"})


# Branch / Function / Consolidation / Signer happy paths ─────────


class TestHappyPaths:
    def test_branch_full_ok(self):
        validate_dora_branch({"country_iso2": "FR", "lei": "213800WSGIIZCXF1P572"})

    def test_function_rto_negative_raises(self):
        with pytest.raises(HTTPException):
            validate_dora_function({"recovery_time_objective_h": -2})

    def test_consolidation_ok(self):
        validate_dora_consolidation({
            "entity_lei": "213800WSGIIZCXF1P572",
            "country_iso2": "DE",
            "relation_to_rfe": "subsidiary",
            "inclusion_method": "full",
        })

    def test_signer_ok(self):
        validate_dora_signer({
            "signer_lei": "213800WSGIIZCXF1P572",
            "signer_role": "tpp",
            "signed_on": "2024-03-15",
        })
