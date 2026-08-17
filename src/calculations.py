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


# ═════════════════════════════════════════════════════════════════════
# VENDOR CALCULATIONS
# ═════════════════════════════════════════════════════════════════════

def compute_dependance(classification: dict) -> float:
    """Average of dependency-axis sliders (0-4 scale)."""
    ops = _to_num(classification.get("ops_impact"))
    proc = _to_num(classification.get("processes"))
    repl = _to_num(classification.get("replace_difficulty"))
    vals = [v for v in [ops, proc, repl] if v > 0]
    return round(sum(vals) / len(vals), 1) if vals else 0


def compute_penetration(classification: dict) -> float:
    """Average of penetration-axis sliders (0-4 scale)."""
    data = _to_num(classification.get("data_sensitivity"))
    integ = _to_num(classification.get("integration"))
    reg = _to_num(classification.get("regulatory_impact"))
    vals = [v for v in [data, integ, reg] if v > 0]
    return round(sum(vals) / len(vals), 1) if vals else 0


def compute_threat_level(dependance: float, penetration: float, maturite: float, confiance: float) -> float:
    """Threat level = ((dep + pen) / 2 + (4 - mat) + (4 - conf)) / 3 * 4."""
    avg_exposure = (dependance + penetration) / 2
    maturity_gap = 4 - maturite
    trust_gap = 4 - confiance
    return round((avg_exposure + maturity_gap + trust_gap) / 3 * 4, 2)


def compute_tier(threat_level: float) -> str:
    """Map threat level to tier label."""
    if threat_level >= 3:
        return "critical"
    if threat_level >= 2:
        return "high"
    if threat_level >= 1:
        return "medium"
    return "low"


def compute_is_dora_critical(classification: dict) -> bool:
    """DORA critical ICT provider: >= 3 fields at max (4) OR average >= 3.5."""
    vals = [
        _to_num(classification.get("ops_impact")),
        _to_num(classification.get("processes")),
        _to_num(classification.get("replace_difficulty")),
        _to_num(classification.get("data_sensitivity")),
        _to_num(classification.get("integration")),
        _to_num(classification.get("regulatory_impact")),
    ]
    at_max = sum(1 for v in vals if v >= 4)
    avg = sum(vals) / len(vals) if vals else 0
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
    """Convert assessment score (0-100) to maturity level (0-4)."""
    if score >= 81:
        return 4
    if score >= 61:
        return 3
    if score >= 41:
        return 2
    if score >= 21:
        return 1
    return 0


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

        if dep > 0 and pen > 0:
            threat = compute_threat_level(dep, pen, mat, conf)
            v["_threat_level"] = threat
            v["_tier"] = compute_tier(threat)
        else:
            v["_threat_level"] = 0
            v["_tier"] = "low"

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

    # Vendors by tier
    tiers: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
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
