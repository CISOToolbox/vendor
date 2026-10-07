"""TPRM — Server-side calculation functions.

Ports the authoritative calculation logic from the browser JS
(TPRM_app.js) into Python so the backend can enforce consistency.
"""

from __future__ import annotations


def _to_num(val) -> float:
    if val is None or val == "":
        return 0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0


def _num_or_none(val):
    """A classification indicator: a number (0-4, where 0 is a real "no
    impact" rating) when assessed, or None when not assessed (null/absent/"").

    The distinction between a deliberate 0 and "not yet rated" is the whole
    point of FEAT-54: 0 is a value that must be ratable, not a synonym for
    missing.
    """
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


# ═════════════════════════════════════════════════════════════════════
# VENDOR CALCULATIONS
# ═════════════════════════════════════════════════════════════════════

def compute_dependance(classification: dict) -> float | None:
    """Mean of the three dependency-axis indicators (0-4), or None when the
    axis is not fully assessed (FEAT-54).

    All-or-nothing: if any of the three indicators is unassessed (null), the
    whole axis is "not assessed" (None) rather than silently counting the gap
    as 0. A real 0 (a deliberate "no impact" rating) therefore stays distinct
    from "not yet rated". No division by zero is possible: either the three are
    present and we divide by 3, or the axis is None.
    """
    ops = _num_or_none(classification.get("ops_impact"))
    proc = _num_or_none(classification.get("processes"))
    repl = _num_or_none(classification.get("replace_difficulty"))
    if ops is None or proc is None or repl is None:
        return None
    return round((ops + proc + repl) / 3, 1)


def compute_penetration(classification: dict) -> float | None:
    """Mean of the three penetration-axis indicators (0-4), or None when the
    axis is not fully assessed — same all-or-nothing rule as
    ``compute_dependance`` (FEAT-54).
    """
    data = _num_or_none(classification.get("data_sensitivity"))
    integ = _num_or_none(classification.get("integration"))
    reg = _num_or_none(classification.get("regulatory_impact"))
    if data is None or integ is None or reg is None:
        return None
    return round((data + integ + reg) / 3, 1)


def compute_threat_level(dependance: float | None, penetration: float | None,
                         maturite: float, confiance: float) -> float | None:
    """Canonical vendor threat level = (dep * pen) / (mat * conf).

    Maturity and confidence floor at 1 — they can only *mitigate* the threat
    (they are the denominator), never make it uncomputable. The sole
    "unassessed" state is a dependency or penetration axis that is ``None``
    (not fully rated) — NOT an axis rated 0: a real 0 yields a threat of 0
    (tier "low"), never "unassessed" (FEAT-54). A classified-but-not-yet-
    assessed vendor (mat=conf=1 by default) gets the conservative maximum for
    its exposure, not a false low. Single source of truth for the three
    surfaces that used to diverge: the frontend ``_computeExposure`` and
    ``routes/internal._compute_menace`` share this exact formula and scale.
    """
    if dependance is None or penetration is None:
        return None
    m = maturite or 1
    c = confiance or 1
    return round((dependance * penetration) / (m * c), 2)


def compute_tier(threat_level: float | None) -> str:
    """Map the canonical threat level to a tier. ``None`` => ``unassessed``."""
    if threat_level is None:
        return "unassessed"
    if threat_level >= 4:
        return "critical"
    if threat_level >= 2:
        return "high"
    if threat_level >= 1:
        return "medium"
    return "low"


def compute_is_dora_critical(classification: dict) -> bool:
    """DORA critical ICT provider: >= 3 indicators at max (4) OR average >= 3.5.

    Only pronounced on a COMPLETE classification (FEAT-54): if any of the six
    indicators is unassessed (None), returns False — a vendor is not
    auto-flagged "DORA critical" on partial data; the flag waits for the full
    classification.
    """
    vals = [
        _num_or_none(classification.get("ops_impact")),
        _num_or_none(classification.get("processes")),
        _num_or_none(classification.get("replace_difficulty")),
        _num_or_none(classification.get("data_sensitivity")),
        _num_or_none(classification.get("integration")),
        _num_or_none(classification.get("regulatory_impact")),
    ]
    if any(v is None for v in vals):
        return False
    at_max = sum(1 for v in vals if v >= 4)
    avg = sum(vals) / len(vals)
    return at_max >= 3 or avg >= 3.5


def compute_assessment_score(responses: list[dict], questions: list[dict] | None = None) -> tuple[float, float]:
    """Compute assessment score and completion rate.

    Returns (score_percent, completion_percent).
    """
    if not responses:
        return 0, 0

    total_weight = 0
    earned = 0
    answered = 0

    for resp in responses:
        weight = 10  # default weight
        answer = resp.get("answer", "")
        if answer in ("compliant", "partial", "non_compliant"):
            answered += 1
            total_weight += weight
            if answer == "compliant":
                earned += weight
            elif answer == "partial":
                earned += weight * 0.5
        elif answer == "na":
            answered += 1

    total_questions = len(responses)
    completion = round(answered / total_questions * 100, 1) if total_questions else 0
    score = round(earned / total_weight * 100, 1) if total_weight else 0
    return score, completion


def score_to_maturity(score: float) -> int:
    """Convert assessment score (0-100) to maturity level (1-4).

    Floors at 1: maturity can never be 0 (see the exposure methodology — it is
    a denominator that only mitigates the threat).
    """
    if score >= 80:
        return 4
    if score >= 60:
        return 3
    if score >= 40:
        return 2
    return 1


def compute_risk_level(impact: int, likelihood: int) -> str:
    """Risk level from 5x5 matrix."""
    score = impact * likelihood
    if score >= 15:
        return "critical"
    if score >= 9:
        return "high"
    if score >= 4:
        return "medium"
    return "low"


# ═════════════════════════════════════════════════════════════════════
# FULL RECALCULATION
# ═════════════════════════════════════════════════════════════════════

def recalculate_all(data: dict) -> dict:
    """Recalculate ALL computed fields in the project data.

    Walks through vendors, risks, assessments and updates computed values.
    Returns the updated data dict (mutated in place).
    """
    vendors = data.get("vendors") or []
    risks = data.get("risks") or []
    assessments = data.get("assessments") or []

    # Build assessment score lookup: vendor_id -> latest score
    vendor_scores: dict[str, float] = {}
    for a in assessments:
        if a.get("status") == "completed" and a.get("vendor_id"):
            score, _ = compute_assessment_score(a.get("responses") or [])
            a["score"] = score
            a["completion_rate"] = _
            vendor_scores[a["vendor_id"]] = score

    # Recalculate vendor exposure and tier
    for v in vendors:
        cl = v.get("classification") or {}
        dep = compute_dependance(cl)
        pen = compute_penetration(cl)

        exp = v.get("exposure") or {}
        exp["dependance"] = dep
        exp["penetration"] = pen

        # Update maturity from latest assessment score
        vid = v.get("id", "")
        if vid in vendor_scores:
            exp["maturite"] = score_to_maturity(vendor_scores[vid])

        mat = _to_num(exp.get("maturite"))
        conf = _to_num(exp.get("confiance"))

        # A partially-assessed vendor reads as "unassessed", never a false
        # "low" — compute_threat_level returns None unless all four factors set.
        threat = compute_threat_level(dep, pen, mat, conf)
        v["_threat_level"] = threat
        v["_tier"] = compute_tier(threat)

        v["_dora_critical"] = compute_is_dora_critical(cl)
        v["exposure"] = exp

    # Recalculate risk levels
    for r in risks:
        impact = _to_num(r.get("impact"))
        likelihood = _to_num(r.get("likelihood"))
        if impact and likelihood:
            r["_risk_level"] = compute_risk_level(int(impact), int(likelihood))

        res_impact = _to_num(r.get("residual_impact"))
        res_likelihood = _to_num(r.get("residual_likelihood"))
        if res_impact and res_likelihood:
            r["_residual_risk_level"] = compute_risk_level(int(res_impact), int(res_likelihood))

    data["vendors"] = vendors
    data["risks"] = risks
    data["assessments"] = assessments
    return data


# ═════════════════════════════════════════════════════════════════════
# AGGREGATE STATISTICS
# ═════════════════════════════════════════════════════════════════════

def compute_project_stats(data: dict) -> dict:
    """Compute summary statistics for a vendor project."""
    vendors = data.get("vendors") or []
    risks = data.get("risks") or []
    assessments = data.get("assessments") or []
    documents = data.get("documents") or []

    # Count measures across all vendors
    total_measures = sum(len(v.get("measures") or []) for v in vendors)

    # Vendors by tier — "unassessed" is a real bucket, not dropped, so the
    # breakdown stays a true partition of total_vendors (mirrors internal.py).
    tiers: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unassessed": 0}
    for v in vendors:
        tier = v.get("_tier", "low")
        if tier in tiers:
            tiers[tier] += 1

    # Vendors by status
    statuses: dict[str, int] = {}
    for v in vendors:
        s = v.get("status", "prospect")
        statuses[s] = statuses.get(s, 0) + 1

    # Risks by level
    risk_levels: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for r in risks:
        level = r.get("_risk_level", "low")
        if level in risk_levels:
            risk_levels[level] += 1

    # Average assessment score
    completed = [a for a in assessments if a.get("status") == "completed"]
    scores = [_to_num(a.get("score")) for a in completed if a.get("score") is not None]
    avg_score = round(sum(scores) / len(scores), 1) if scores else None

    # Measures progress
    all_measures = []
    for v in vendors:
        all_measures.extend(v.get("measures") or [])
    active = [m for m in all_measures if m.get("statut") not in ("", None)]
    completed_m = sum(1 for m in active if m.get("statut") == "completed")
    progress = round(completed_m / len(active) * 100, 1) if active else None

    return {
        "total_vendors": len(vendors),
        "total_risks": len(risks),
        "total_measures": total_measures,
        "total_assessments": len(assessments),
        "total_documents": len(documents),
        "vendors_by_tier": tiers,
        "vendors_by_status": statuses,
        "risks_by_level": risk_levels,
        "avg_assessment_score": avg_score,
        "measures_progress": progress,
    }
