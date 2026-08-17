# -----------------------------------------------------------------------------
# REPLICATED from the private shared repository (shared/python/evidence_common.py).
# DO NOT EDIT HERE - changes will be overwritten by the next propagation run.
# Fix the master in the shared repository and re-propagate. See CONTRIBUTING.md.
# -----------------------------------------------------------------------------
"""Shared evidence helpers (FEAT-08).

Master in shared/python/ — copied BY HAND into each module's src/ (no
auto-sync), like connectors_common.py. Centralises the cross-module
evidence-expiration classification and the uniform payload pushed to
Pilot's EvidenceCache, so every module agrees on what "expired / soon /
valid" means and Pilot can consolidate proofs across the whole suite.
"""
from __future__ import annotations

from datetime import date

# Evidence nature.
EVIDENCE_KINDS = ("file", "link", "observation")
# Expiration status flowing to Pilot.
EVIDENCE_STATUS = ("valide", "bientot", "expiree", "na")


def compute_evidence_status(date_expiration, today: date | None = None, soon_days: int = 30) -> str:
    """Classify an evidence by its expiration date.

    na      — no / unparseable expiration date (perpetual or not applicable)
    expiree — expiration strictly in the past
    bientot — expiring within ``soon_days``
    valide  — expiring later
    """
    if not date_expiration:
        return "na"
    if today is None:
        today = date.today()
    try:
        exp = date.fromisoformat(str(date_expiration)[:10])
    except (ValueError, TypeError):
        return "na"
    delta = (exp - today).days
    if delta < 0:
        return "expiree"
    if delta <= soon_days:
        return "bientot"
    return "valide"


def evidence_to_pilot_payload(ev: dict, module: str, linked=None, today: date | None = None) -> dict:
    """Uniform shape pushed to Pilot's EvidenceCache / returned by each
    module's GET /api/internal/evidences. See pilot-dashboard-contract.md.

    ``ev`` is a plain dict of the evidence row; ``linked`` is the list of
    objects it is attached to ([{object_type, object_id, label}]).
    """
    return {
        "source_id": str(ev.get("id", "")),
        "entity_id": str(ev.get("project_id", "")),
        "entity_name": ev.get("entity_name", "") or ev.get("label", ""),
        "label": ev.get("label", "") or "",
        "kind": ev.get("kind", "link") or "link",
        "url": ev.get("url", "") or "",
        "owner": ev.get("owner", "") or "",
        "date_obtention": ev.get("date_obtention", "") or "",
        "date_expiration": ev.get("date_expiration", "") or "",
        "status": compute_evidence_status(ev.get("date_expiration"), today),
        "tags": ev.get("tags") or [],
        "linked": linked or [],
        "source_module": module,
    }
