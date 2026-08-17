"""
DORA Register of Information — server-side validation rules.

Single source of truth for all writes to the DORA RoI tables. Mirrors the
Vendor assessment_validation.py pattern: every POST/PATCH/DELETE that
touches a DORA entity goes through these helpers.

Reference: Reg. (EU) 2024/2956 (EBA ITS on Register of Information).

Rules
─────
R1  LEI must validate ISO 17442 mod-97-10 (when present).
R2  country_iso2 must be in ISO-3166-1 alpha-2 (or empty).
R3  currency must be in EBA ISO-4217 list (codelists).
R4  Codelist values (entity_type, hierarchy, person_type, entity_nature,
    additional_id_type, relation_to_rfe, inclusion_method,
    arrangement_type, data_sensitivity, signer_role) must match.
R5  Dates must be YYYY-MM-DD (or empty).
R6  reporting_period must be YYYY-12-31 (or empty).
R7  Subcontractor parent chain depth ≤ MAX_DEPTH (cycles forbidden).
R8  Subcontractor.tier ∈ [1, MAX_DEPTH].
R9  arrangement_reference is unique per project (DB enforces).
R10 Ultimate-parent chain (vendor.ultimate_parent_id) depth ≤ MAX_DEPTH.
R11 If hierarchy='subsidiary' → parent_lei required (when set).
R12 If is_critical_function_support=true on Arrangement → at least one
    of the linked function_ids must reference a function with
    is_critical_or_important=true.
R13 RTO/RPO must be ≥ 0.
R14 total_assets must be ≥ 0.
R15 Sub-contractor self-reference forbidden (parent_subcontractor_id ≠ id).
R16 User-chosen ids/codes (entity.id, function.id, function.code,
    branch.id, branch.branch_code) restricted to [A-Za-z0-9_-]{1,50}.
    arrangement_reference allows '.' '/' too, max 100 chars.
R17 Vendor with person_type='legal' established in the EEA requires
    a valid LEI (B.05.01 mandatory field per EBA RoI ITS).

Pattern
───────
Each helper raises HTTPException(422, detail=...) with a user-friendly
message; routes/dora.py calls them before any DB write.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

from fastapi import HTTPException


MAX_DEPTH = 10  # parent chain & subcontractor chain depth cap


# ── Codelist loader (cached at import) ────────────────────────────

_CODELISTS_PATH = os.path.join(os.path.dirname(__file__), "dora_codelists.json")
try:
    with open(_CODELISTS_PATH, encoding="utf-8") as _f:
        _CODELISTS: dict[str, Any] = json.load(_f)
except FileNotFoundError:
    _CODELISTS = {}


def codelists() -> dict[str, Any]:
    """Return the loaded codelists for /api/dora/codelists endpoint."""
    return _CODELISTS


def _codes(key: str) -> set[str]:
    items = _CODELISTS.get(key, [])
    if items and isinstance(items[0], dict):
        return {it["code"] for it in items}
    return set(items)


# ── ISO-3166 alpha-2 (compact list of EEA + major partner jurisdictions) ──

_ISO3166_ALPHA2 = {
    "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
    "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS",
    "BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN",
    "CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE",
    "EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF",
    "GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM",
    "HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT","JE","JM",
    "JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC",
    "LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK",
    "ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA",
    "NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG",
    "PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW",
    "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS",
    "ST","SV","SX","SY","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO",
    "TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI",
    "VN","VU","WF","WS","XK","YE","YT","ZA","ZM","ZW",
}


# ── R1: LEI mod-97-10 (ISO 17442) ─────────────────────────────────

_LEI_RE = re.compile(r"^[A-Z0-9]{18}[0-9]{2}$")


def lei_is_valid(lei: str) -> bool:
    """ISO 17442 mod-97-10 check on a 20-char LEI."""
    if not lei:
        return False
    lei = lei.upper().strip()
    if not _LEI_RE.match(lei):
        return False
    # Convert each letter to its numeric value (A=10..Z=35), keep digits
    digits = ""
    for ch in lei:
        if ch.isdigit():
            digits += ch
        else:
            digits += str(ord(ch) - 55)
    return int(digits) % 97 == 1


def validate_lei(lei: str | None, *, required: bool = False, field: str = "lei") -> None:
    if lei is None or lei == "":
        if required:
            raise HTTPException(422, f"{field} is required")
        return
    if not lei_is_valid(lei):
        raise HTTPException(422, f"{field} '{lei}' is not a valid ISO 17442 LEI")


# ── R16: free-form EBA RoI identifier (id, code, reference) ──────
#
# B.06.01.0010 (function id), B.01.03 branch_code, B.01.02 RFE id and
# B.03.01 arrangement_reference are user-chosen identifiers. The EBA
# templates accept any printable string, but the suite enforces a safe
# subset to keep them URL-safe, file-name-safe and Excel-friendly.

_EBA_CODE_RE = re.compile(r"^[A-Za-z0-9_\-]{1,50}$")


def validate_eba_code(value: str | None, *, field: str, required: bool = False) -> None:
    if value is None or value == "":
        if required:
            raise HTTPException(422, f"{field} is required")
        return
    if not _EBA_CODE_RE.match(value):
        raise HTTPException(
            422,
            f"{field} '{value}' must contain only letters, digits, '_' or '-' (max 50 chars)",
        )


# ── EEA member states (LEI required for legal persons) ────────────
#
# Source: EEA Agreement (EU-27 + Iceland, Liechtenstein, Norway).
# Used by R17 (validate_vendor_roi) to enforce LEI presence on EEA
# legal persons, in line with EBA RoI mandatory-fields rules.

_EEA_COUNTRIES = {
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
    "FR", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU",
    "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK",
}


# ── R2: country ISO-3166 alpha-2 ──────────────────────────────────

def validate_country(c: str | None, *, field: str = "country_iso2") -> None:
    if c is None or c == "":
        return
    if c.upper() not in _ISO3166_ALPHA2:
        raise HTTPException(422, f"{field} '{c}' is not a valid ISO-3166-1 alpha-2 country")


# ── R3: currency ISO-4217 ─────────────────────────────────────────

def validate_currency(cur: str | None, *, field: str = "currency") -> None:
    if cur is None or cur == "":
        return
    if cur.upper() not in _codes("currency_iso4217"):
        raise HTTPException(422, f"{field} '{cur}' is not in ISO-4217 list")


# ── R4: codelist enum ─────────────────────────────────────────────

def validate_codelist(value: str | None, key: str, *, field: str | None = None) -> None:
    if value is None or value == "":
        return
    allowed = _codes(key)
    if value not in allowed:
        raise HTTPException(422, f"{field or key} '{value}' is not in codelist '{key}'")


# ── R5/R6: dates ──────────────────────────────────────────────────

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PERIOD_RE = re.compile(r"^\d{4}-12-31$")


def validate_date(d: str | None, *, field: str = "date") -> None:
    if d is None or d == "":
        return
    if not _DATE_RE.match(d):
        raise HTTPException(422, f"{field} '{d}' must be YYYY-MM-DD")


def validate_reporting_period(d: str | None, *, field: str = "reporting_period") -> None:
    if d is None or d == "":
        return
    if not _PERIOD_RE.match(d):
        raise HTTPException(422, f"{field} '{d}' must be YYYY-12-31")


# ── R13/R14: non-negative numbers ─────────────────────────────────

def validate_non_negative(v: float | int | None, *, field: str) -> None:
    if v is None:
        return
    if v < 0:
        raise HTTPException(422, f"{field} must be ≥ 0")


# ── R7/R10/R15: parent chain depth & cycles ──────────────────────

def validate_parent_chain(
    edges: dict[str, str | None],
    start: str,
    *,
    max_depth: int = MAX_DEPTH,
    field: str = "parent",
) -> None:
    """
    edges: child_id -> parent_id mapping (None = root).
    Walk from `start` upward, fail if cycle or depth > max_depth.
    """
    seen = set()
    cur: str | None = start
    depth = 0
    while cur:
        if cur in seen:
            raise HTTPException(422, f"{field} chain has a cycle at '{cur}'")
        seen.add(cur)
        depth += 1
        if depth > max_depth:
            raise HTTPException(422, f"{field} chain exceeds depth {max_depth}")
        cur = edges.get(cur)


# ── Per-entity validators (called from routes/dora.py) ────────────

def validate_dora_entity(payload: dict[str, Any]) -> None:
    """RFE row (B_01.02). Called for create + update."""
    if "id" in payload:
        validate_eba_code(payload.get("id"), field="id")
    if "lei" in payload:
        validate_lei(payload.get("lei"), required=False, field="lei")
    if "country_iso2" in payload:
        validate_country(payload.get("country_iso2"), field="country_iso2")
    if "entity_type" in payload:
        validate_codelist(payload.get("entity_type"), "entity_type", field="entity_type")
    if "hierarchy" in payload:
        validate_codelist(payload.get("hierarchy"), "hierarchy", field="hierarchy")
    if "parent_lei" in payload:
        validate_lei(payload.get("parent_lei"), required=False, field="parent_lei")
    if "total_assets" in payload:
        validate_non_negative(payload.get("total_assets"), field="total_assets")
    if "reporting_period" in payload:
        validate_reporting_period(payload.get("reporting_period"))
    # R11: subsidiary requires parent_lei (if both fields are set together)
    h = payload.get("hierarchy")
    if h == "subsidiary" and "parent_lei" in payload and not payload.get("parent_lei"):
        raise HTTPException(422, "hierarchy='subsidiary' requires parent_lei")


def validate_dora_function(payload: dict[str, Any]) -> None:
    if "id" in payload:
        validate_eba_code(payload.get("id"), field="id")
    if "code" in payload:
        validate_eba_code(payload.get("code"), field="code")
    if "recovery_time_objective_h" in payload:
        validate_non_negative(payload.get("recovery_time_objective_h"), field="recovery_time_objective_h")
    if "recovery_point_objective_h" in payload:
        validate_non_negative(payload.get("recovery_point_objective_h"), field="recovery_point_objective_h")


def validate_dora_branch(payload: dict[str, Any]) -> None:
    if "id" in payload:
        validate_eba_code(payload.get("id"), field="id")
    if "branch_code" in payload:
        validate_eba_code(payload.get("branch_code"), field="branch_code")
    if "country_iso2" in payload:
        validate_country(payload.get("country_iso2"))
    if "lei" in payload:
        validate_lei(payload.get("lei"), required=False)


def validate_dora_consolidation(payload: dict[str, Any]) -> None:
    if "entity_lei" in payload:
        validate_lei(payload.get("entity_lei"), required=False, field="entity_lei")
    if "country_iso2" in payload:
        validate_country(payload.get("country_iso2"))
    if "relation_to_rfe" in payload:
        validate_codelist(payload.get("relation_to_rfe"), "relation_to_rfe")
    if "inclusion_method" in payload:
        validate_codelist(payload.get("inclusion_method"), "inclusion_method")


def validate_dora_arrangement(
    payload: dict[str, Any],
    *,
    function_is_critical: bool | None = None,
) -> None:
    if "arrangement_reference" in payload:
        # arrangement_reference accepts the same charset as ids; users may
        # type "ARR-0001" or import a contract code from an external system.
        ref = payload.get("arrangement_reference")
        if ref:
            # Use a slightly relaxed pattern: 100-char limit (DB column).
            if not re.match(r"^[A-Za-z0-9_\-./]{1,100}$", ref):
                raise HTTPException(
                    422,
                    f"arrangement_reference '{ref}' must contain only letters, digits, '_', '-', '.' or '/' (max 100 chars)",
                )
    if "arrangement_type" in payload:
        validate_codelist(payload.get("arrangement_type"), "arrangement_type")
    if "currency" in payload:
        validate_currency(payload.get("currency"))
    if "data_sensitivity" in payload:
        validate_codelist(payload.get("data_sensitivity"), "data_sensitivity")
    if "annual_cost_amount" in payload:
        validate_non_negative(payload.get("annual_cost_amount"), field="annual_cost_amount")
    if "notice_period_days" in payload:
        validate_non_negative(payload.get("notice_period_days"), field="notice_period_days")
    for f in ("start_date", "end_date", "last_audit_date"):
        if f in payload:
            validate_date(payload.get(f), field=f)
    for f in ("governing_law_country", "jurisdiction_country", "data_storage_country", "data_processing_country"):
        if f in payload:
            validate_country(payload.get(f), field=f)
    # ITS B.07.01 substitutability + reintegration codelists
    if "substitutability_level" in payload:
        validate_codelist(payload.get("substitutability_level"), "substitutability")
    if "substitutability_reason" in payload:
        validate_codelist(payload.get("substitutability_reason"), "substitutability_reason")
    if "reintegration_level" in payload:
        validate_codelist(payload.get("reintegration_level"), "reintegration_level")
    # B.07.01.0060 is mandatory iff substitutability_level ∈ {not_substitutable, highly_complex}
    sub_lvl = payload.get("substitutability_level")
    sub_rsn = payload.get("substitutability_reason")
    if sub_lvl in ("not_substitutable", "highly_complex"):
        if "substitutability_reason" in payload and not sub_rsn:
            raise HTTPException(
                422,
                "substitutability_reason is required when substitutability_level is not_substitutable or highly_complex",
            )
    # R12: critical-function support requires the function itself to be critical
    if payload.get("is_critical_function_support"):
        if function_is_critical is False:
            raise HTTPException(
                422,
                "is_critical_function_support=true requires linked function with is_critical_or_important=true",
            )


def validate_dora_signer(payload: dict[str, Any]) -> None:
    if "signer_lei" in payload:
        validate_lei(payload.get("signer_lei"), required=False, field="signer_lei")
    if "signer_role" in payload:
        validate_codelist(payload.get("signer_role"), "signer_role")
    if "signed_on" in payload:
        validate_date(payload.get("signed_on"), field="signed_on")


def validate_dora_subcontractor(payload: dict[str, Any]) -> None:
    """Validate the global subcontractor identity (no per-link fields)."""
    if "lei" in payload:
        validate_lei(payload.get("lei"), required=False)
    if "country_iso2" in payload:
        validate_country(payload.get("country_iso2"))


def validate_dora_arrangement_subcontractor(
    payload: dict[str, Any],
    *,
    self_subcontractor_id: str | None = None,
) -> None:
    """Validate per-link junction attributes: tier, data_country, R15."""
    if "data_country" in payload:
        validate_country(payload.get("data_country"), field="data_country")
    tier = payload.get("tier")
    if tier is not None and (tier < 1 or tier > MAX_DEPTH):
        raise HTTPException(422, f"tier must be in [1, {MAX_DEPTH}]")
    # R15: self-reference forbidden in the chain
    if self_subcontractor_id is not None and payload.get("parent_subcontractor_id") == self_subcontractor_id:
        raise HTTPException(422, "parent_subcontractor_id cannot equal subcontractor_id")


def validate_vendor_roi(payload: dict[str, Any]) -> None:
    """Vendor-level RoI fields (lei, country_iso2, person_type, etc.)."""
    if "lei" in payload:
        validate_lei(payload.get("lei"), required=False)
    if "ultimate_parent_id" in payload:
        validate_lei(payload.get("ultimate_parent_id"), required=False, field="ultimate_parent_id")
    if "country_iso2" in payload:
        validate_country(payload.get("country_iso2"))
    if "person_type" in payload:
        validate_codelist(payload.get("person_type"), "person_type")
    if "entity_nature" in payload:
        validate_codelist(payload.get("entity_nature"), "entity_nature")
    if "additional_id_type" in payload:
        validate_codelist(payload.get("additional_id_type"), "additional_id_type")
    # R17: legal persons established in the EEA must report a valid LEI.
    # Only enforced when the caller provides BOTH person_type AND
    # country_iso2 in the same payload (avoids false positives during
    # partial PATCHes that touch only one of the two fields).
    if "person_type" in payload and "country_iso2" in payload:
        person_type = (payload.get("person_type") or "").lower()
        country = (payload.get("country_iso2") or "").upper()
        if person_type == "legal" and country in _EEA_COUNTRIES:
            lei = payload.get("lei")
            if not lei:
                raise HTTPException(
                    422,
                    f"lei is required for legal persons established in the EEA (country '{country}')",
                )
