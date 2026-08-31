"""Internal API endpoints for Pilot integration.

These endpoints are protected by X-Service-Token (not user JWT).
They expose data for cross-module sync and dashboard aggregation.
"""

from __future__ import annotations

import logging

import os
from urllib.parse import urlparse

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import Project, ProjectMetadata, Vendor, VendorAssessment, VendorMeasure

router = APIRouter(prefix="/api", tags=["internal"])
logger = logging.getLogger("vendor-internal")

SERVICE_TOKEN = os.getenv("SERVICE_TOKEN", "")




def _validate_proxy_url(url: str) -> None:
    """Reject a proxy URL that points at an internal target.

    Delegates to the shared ssrf_guard rather than re-implementing the
    blocklist. The local version this replaces swallowed socket.gaierror, so a
    name that failed to resolve was ACCEPTED — the opposite of the shared
    guard's fail-closed contract — and it never knew about the Alibaba/Oracle
    metadata IPs, CGNAT, multicast or the reserved blocks.

    It matters more here than at a normal call site: the route below exports
    this value into the process-wide HTTP_PROXY, and httpx runs trust_env=True,
    so it redirects EVERY outbound request the module makes afterwards —
    including ones another guard had carefully pinned to a resolved IP.
    """
    from src.ssrf_guard import validate_public_url

    try:
        # allow_private stays False: the previous implementation already
        # refused RFC1918 proxies, so this is not a behaviour change.
        validate_public_url(url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Proxy endpoint not allowed: {e}")



def _check_service_token(request: Request) -> None:
    if not SERVICE_TOKEN:
        raise HTTPException(status_code=503, detail="Service token not configured")

    token = request.headers.get("X-Service-Token", "")
    import secrets as _secrets
    if not token or not _secrets.compare_digest(token, SERVICE_TOKEN):
        raise HTTPException(status_code=403, detail="Invalid service token")


def _compute_menace(exposure: dict) -> tuple[float, str]:
    """Compute threat score from exposure JSONB using (D*P)/(M*C) formula.

    Returns (score, tier_label).
    Thresholds: >=4 critical, >=2 high, >=1 medium, <1 low.
    """
    dep = exposure.get("dependance", 0) or 0
    pen = exposure.get("penetration", 0) or 0
    mat = exposure.get("maturite", 0) or 0
    conf = exposure.get("confiance", 0) or 0

    if not dep or not pen or not mat or not conf:
        return (0.0, "Faible")

    threat = round((dep * pen) / (mat * conf), 2)

    if threat >= 4:
        tier = "Critique"
    elif threat >= 2:
        tier = "Elevee"
    elif threat >= 1:
        tier = "Moderee"
    else:
        tier = "Faible"

    return (threat, tier)


def _tier_key(tier: str) -> str:
    mapping = {"Critique": "critical", "Elevee": "high", "Moderee": "medium", "Faible": "low"}
    return mapping.get(tier, "low")


@router.get("/export/vendors")
async def export_vendors(request: Request, db: AsyncSession = Depends(get_db)):
    """Export all vendors with threat levels and measures for Risk module consumption."""
    _check_service_token(request)

    result = await db.execute(
        select(Vendor, Project.name.label("project_name"))
        .join(Project, Vendor.project_id == Project.id)
        .order_by(Vendor.project_id, Vendor.sort_order)
    )
    rows = result.all()

    # Load every measure in ONE query and group by (project_id, vendor_id),
    # instead of a SELECT per vendor (was 1 + N queries). Ordered so each
    # group stays in sort_order.
    measures_by_vendor: dict[tuple, list[dict]] = {}
    all_measures = (await db.execute(
        select(VendorMeasure).order_by(
            VendorMeasure.project_id, VendorMeasure.vendor_id, VendorMeasure.sort_order
        )
    )).scalars().all()
    for m in all_measures:
        measures_by_vendor.setdefault((m.project_id, m.vendor_id), []).append({
            "id": m.id,
            "mesure": m.mesure,
            "details": m.details or "",
            "type": m.type or "",
            "statut": m.statut,
            "responsable": m.responsable or "",
            "echeance": m.echeance or "",
            "ref_socle": m.ref_socle or "",
            "effet": m.effet or "",
        })

    all_vendors = []
    for row in rows:
        v = row[0]  # Vendor object
        project_name = row[1]

        threat, exposition = _compute_menace(v.exposure or {})
        measures = measures_by_vendor.get((v.project_id, v.id), [])

        all_vendors.append({
            "id": v.id,
            "name": v.name,
            "type": v.sector or "",
            "status": v.status,
            "website": v.website or "",
            "exposure": v.exposure or {},
            "threat_level": threat,
            "exposition": exposition,
            "measures": measures,
            "certifications": v.certifications or [],
            "classification": v.classification or {},
            "project_id": str(v.project_id),
            "project_name": project_name or "",
        })

    return {"vendors": all_vendors}


# Statuts de fournisseur qui alimentent le pilotage. Doit rester aligne avec
# VENDOR_IN_SCOPE dans app/ts/TPRM_app.ts : le frontend et cet export decrivent
# le meme perimetre, et une divergence ne produirait aucune erreur — seulement
# deux chiffres differents pour la meme chose.
VENDOR_IN_SCOPE = ("active", "review")


@router.get("/internal/measures")
async def internal_measures(request: Request, db: AsyncSession = Depends(get_db)):
    """Export all measures across all projects in normalized format for Pilot."""
    _check_service_token(request)

    result = await db.execute(
        select(VendorMeasure, Vendor.name, Project.name.label("project_name"), ProjectMetadata.organization)
        .join(Vendor, (VendorMeasure.project_id == Vendor.project_id) & (VendorMeasure.vendor_id == Vendor.id))
        .join(Project, VendorMeasure.project_id == Project.id)
        .outerjoin(ProjectMetadata, VendorMeasure.project_id == ProjectMetadata.project_id)
        # Meme perimetre que le tableau de bord Vendor : un fournisseur
        # seulement ENVISAGE n'a pas de travail a piloter, et un ANCIEN n'en a
        # plus. Sans ce filtre, Pilot afficherait dans son plan d'action des
        # mesures que Vendor a cesse de compter — deux modules en desaccord sur
        # le meme fournisseur, et rien pour le signaler.
        .where(Vendor.status.in_(VENDOR_IN_SCOPE))
        .order_by(VendorMeasure.project_id, VendorMeasure.vendor_id, VendorMeasure.sort_order)
    )
    rows = result.all()

    measures = []
    for row in rows:
        m = row[0]  # VendorMeasure
        vendor_name = row[1]
        project_name = row[2]
        organization = row[3]

        entity_name = (organization or project_name or "") + " / " + (vendor_name or "")

        measures.append({
            "source_id": m.id,
            "entity_id": str(m.project_id),
            "entity_name": entity_name,
            "vendor_id": m.vendor_id or "",
            "vendor_name": vendor_name or "",
            "title": m.mesure or "",
            "description": m.details or "",
            "status": _normalize_status(m.statut),
            "assignee": m.responsable or "",
            "due_date": m.echeance or "",
            "type": m.type or "",
            "progress_log": m.progress_log or [],
            "source_module": "vendor",
        })

    return measures


@router.get("/internal/stats")
async def internal_stats(request: Request, db: AsyncSession = Depends(get_db)):
    """Stats v2 envelope — see shared/docs/pilot-dashboard-contract.md"""
    _check_service_token(request)
    from datetime import date as _date

    total_vendors = await db.scalar(select(func.count()).select_from(Vendor)) or 0

    # ── Vendors by tier ──
    # Project only the columns the menace formula + top_items need — no full
    # Vendor hydration just to bucket (stats is polled by Pilot every 30s).
    vendor_rows = (await db.execute(
        select(Vendor.id, Vendor.name, Vendor.exposure)
    )).all()
    tiers = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    vendor_list = []
    for vid, vname, vexposure in vendor_rows:
        _, tier_label = _compute_menace(vexposure or {})
        key = _tier_key(tier_label)
        tiers[key] += 1
        vendor_list.append((vid, vname, key))

    # ── Measures ──
    # Project only the two columns the status buckets need.
    measures_rows = (await db.execute(
        select(VendorMeasure.statut, VendorMeasure.echeance)
    )).all()
    total_measures = len(measures_rows)
    completed = 0
    in_progress = 0
    planned = 0
    overdue = 0
    today = _date.today().isoformat()
    for statut, echeance in measures_rows:
        st = (statut or "").strip()
        if st in ("completed", "termine", "Terminé"):
            completed += 1
        elif st in ("in_progress", "en_cours"):
            in_progress += 1
        else:
            planned += 1
        if echeance and echeance < today and st not in ("completed", "termine", "Terminé"):
            overdue += 1
    progress_pct = round(completed / total_measures * 100) if total_measures else 0

    # ── Posture: average of validated assessment scores ──
    # func.avg in SQL — hydrating every validated assessment (each carries a
    # large template_snapshot blob) just to average one column was wasteful.
    posture_avg = await db.scalar(
        select(func.avg(VendorAssessment.score)).where(
            VendorAssessment.status == "validated",
            VendorAssessment.score.is_not(None),
        )
    )
    posture_score = round(posture_avg) if posture_avg is not None else None

    pending = await db.scalar(
        select(func.count()).select_from(VendorAssessment)
        .where(VendorAssessment.status == "pending_approval")
    ) or 0

    # ── Donut ──
    donut_segments = []
    if tiers["critical"]: donut_segments.append({"label": "Critique", "value": tiers["critical"], "color": "redMax"})
    if tiers["high"]:     donut_segments.append({"label": "Élevé",    "value": tiers["high"],     "color": "red"})
    if tiers["medium"]:   donut_segments.append({"label": "Modéré",  "value": tiers["medium"],   "color": "orange"})
    if tiers["low"]:      donut_segments.append({"label": "Faible",  "value": tiers["low"],      "color": "green"})

    top_items = []
    for vid, vname, t in vendor_list:
        if t == "critical" and len(top_items) < 3:
            top_items.append({
                "id": vid,
                "label": (vname or "")[:80],
                "severity": "critical",
                "url": "/vendor/",
            })

    alerts = []
    if overdue > 0:
        alerts.append({
            "level": "critical" if overdue >= 5 else "warning",
            "text": f"{overdue} mesure(s) en retard",
            "url": "/vendor/",
        })
    if pending > 0:
        alerts.append({
            "level": "info",
            "text": f"{pending} évaluation(s) en attente d'approbation",
            "url": "/vendor/",
        })

    return {
        "entity_count": total_vendors,
        "entity_label": "Fournisseurs",
        # Semantic critical count so Pilot doesn't parse localized breakdown
        # labels — vendors in the critical or high threat tier.
        "criticals": tiers["critical"] + tiers["high"],
        "measures": {
            "total": total_measures,
            "completed": completed,
            "in_progress": in_progress,
            "planned": planned,
            "overdue": overdue,
            "progress_pct": progress_pct,
        },
        "posture": {
            "score": posture_score,
            "score_label": _posture_label(posture_score) if posture_score is not None else "",
        },
        "breakdown": {
            "type": "donut",
            "data": {
                "segments": donut_segments,
                "center_label": str(total_vendors),
                "center_sublabel": "fournisseurs",
            },
        },
        "top_items": top_items,
        "alerts": alerts,
        # Legacy
        "total_vendors": total_vendors,
        "vendors_by_tier": tiers,
        "total_measures": total_measures,
        "measures_progress": progress_pct,
    }


def _posture_label(score):
    if score is None:
        return ""
    if score < 40:
        return "Faible"
    if score < 60:
        return "Modéré"
    if score < 80:
        return "Bon"
    return "Excellent"


@router.get("/internal/activity")
async def internal_activity(request: Request, db: AsyncSession = Depends(get_db)):
    _check_service_token(request)
    events = []
    recent = await db.execute(
        select(VendorAssessment).order_by(VendorAssessment.updated_at.desc()).limit(10)
    )
    for a in recent.scalars().all():
        label_type = {
            "validated": "assessment_approved",
            "pending_approval": "assessment_submitted",
            "rejected": "assessment_rejected",
        }.get(a.status, "assessment_updated")
        events.append({
            "date": (a.updated_at or a.created_at).isoformat(),
            "module": "vendor",
            "type": label_type,
            "label": f"Évaluation {a.id} — {a.status}",
            "url": "/vendor/",
        })
    return events[:10]



def _document_to_evidence(d, vendor=None, project_name: str = "") -> dict:
    """vendor_documents row → uniform FEAT-08 evidence payload.

    The evidence OWNER is the vendor's internal responsible
    (internal_contact.name, falling back to the vendor-side contact)."""
    from src.evidence_common import evidence_to_pilot_payload
    vendor_name = (vendor.name if vendor is not None else "") or ""
    owner = ""
    if vendor is not None:
        ic = vendor.internal_contact or {}
        c = vendor.contact or {}
        owner = (ic.get("name") or "").strip() or (c.get("name") or "").strip()
    ev = {
        "id": d.id, "project_id": d.project_id, "label": d.name or "",
        "kind": "link" if (d.url or "") else "file",
        "url": d.url or "", "owner": owner,
        "date_obtention": "", "date_expiration": d.expiry_date or "",
        "tags": [t for t in [d.type or ""] if t],
        "entity_name": vendor_name or project_name or "",
    }
    linked = [{"object_type": "vendor", "object_id": d.vendor_id, "label": vendor_name or d.vendor_id}]
    return evidence_to_pilot_payload(ev, "vendor", linked=linked)


@router.get("/internal/evidences")
async def internal_evidences(request: Request, db: AsyncSession = Depends(get_db)):
    """Export vendor documents as first-class evidences (FEAT-08)."""
    _check_service_token(request)
    from src.models import VendorDocument
    docs = (await db.execute(select(VendorDocument)
                             .order_by(VendorDocument.project_id, VendorDocument.sort_order))).scalars().all()
    vendors = {(str(v.project_id), v.id): v
               for v in (await db.execute(select(Vendor))).scalars().all()}
    projects = {str(p.id): (p.name or "") for p in (await db.execute(select(Project))).scalars().all()}
    return [_document_to_evidence(d, vendors.get((str(d.project_id), d.vendor_id)),
                                  projects.get(str(d.project_id), "")) for d in docs]


class InternalEvidenceUpdate(BaseModel):
    """Fields Pilot may edit on a vendor document via the consolidated
    registry (FEAT-08). ``project_id`` locates the document (composite PK)."""
    project_id: str
    label: str | None = None
    url: str | None = None
    date_expiration: str | None = None
    tags: list | None = None


@router.patch("/internal/evidences/{source_id}")
async def internal_update_evidence(source_id: str, body: InternalEvidenceUpdate,
                                   request: Request, db: AsyncSession = Depends(get_db)):
    """Write-back from Pilot's evidence registry onto a vendor document."""
    _check_service_token(request)
    from src.models import VendorDocument
    doc = (await db.execute(select(VendorDocument).where(
        VendorDocument.id == source_id,
        VendorDocument.project_id == body.project_id))).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if body.label is not None:
        doc.name = body.label
    if body.url is not None:
        doc.url = body.url
    if body.date_expiration is not None:
        doc.expiry_date = body.date_expiration
    if body.tags is not None:
        doc.type = (body.tags[0] if body.tags else "") or ""
    await bump_server_rev(db, doc.project_id)
    from src.audit import log_write
    await log_write(db, None, request, "evidence.writeback_update", actor="pilot",
                    entity_type="document", entity_id=str(source_id))
    await db.commit()
    await db.refresh(doc)
    # Contract: Pilot refreshes its cache row from the returned payload —
    # rebuild the same shape as GET /internal/evidences.
    v = (await db.execute(select(Vendor).where(
        Vendor.project_id == doc.project_id, Vendor.id == doc.vendor_id))).scalar_one_or_none()
    proj = await db.get(Project, doc.project_id)
    return _document_to_evidence(doc, v, (proj.name if proj else "") or "")

async def bump_server_rev(db, project_id) -> None:
    """FEAT-33 — mark a server-initiated write so stale tabs cannot blob-PUT
    over it (see routes/projects.update_project)."""
    from sqlalchemy import update as _upd
    from src.models import Project as _P
    await db.execute(_upd(_P).where(_P.id == project_id).values(server_rev=_P.server_rev + 1))


@router.patch("/internal/measures/{source_id}")
async def patch_measure(
    source_id: str,
    request: Request,
    entity_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Update a measure from Pilot (write-back)."""
    _check_service_token(request)
    body = await request.json()

    # Measure ids are unique only within a project — scope by entity_id
    # (= project_id, sent by Pilot) to avoid a cross-project MultipleResultsFound.
    query = select(VendorMeasure).where(VendorMeasure.id == source_id)
    if entity_id:
        query = query.where(VendorMeasure.project_id == entity_id)
    measure = (await db.execute(query)).scalar_one_or_none()
    if not measure:
        raise HTTPException(status_code=404, detail="Measure not found")

    # Transverse Pilot ↔ Vendor mapping: title → mesure, description → details.
    if "title" in body:
        measure.mesure = body["title"]
    if "description" in body:
        measure.details = body["description"]
    if "status" in body:
        _denorm = {"completed": "termine", "in_progress": "en_cours", "planned": "planifie"}
        measure.statut = _denorm.get(body["status"], body["status"])
    if "assignee" in body:
        measure.responsable = body["assignee"]
    if "due_date" in body:
        measure.echeance = body["due_date"]
    if "progress_log" in body:
        measure.progress_log = body["progress_log"]

    # Pilot write-back is a business write — journaled (FEAT-30 review).
    from src.audit import log_write
    await log_write(db, None, request, "measure.writeback_update", actor="pilot",
                    entity_type="measure", entity_id=str(source_id))
    await bump_server_rev(db, measure.project_id)
    await db.commit()
    # Resolve vendor + project info so Pilot's cache keeps the
    # supplier reference even on partial notify payloads.
    v_row = await db.execute(
        select(Vendor.name, Project.name.label("project_name"), ProjectMetadata.organization)
        .join(Project, Vendor.project_id == Project.id)
        .outerjoin(ProjectMetadata, Vendor.project_id == ProjectMetadata.project_id)
        .where(Vendor.project_id == measure.project_id, Vendor.id == measure.vendor_id)
    )
    vrow = v_row.first()
    vendor_name = vrow[0] if vrow else ""
    project_name = vrow[1] if vrow else ""
    organization = vrow[2] if vrow else ""
    entity_name = (organization or project_name or "") + " / " + (vendor_name or "")
    import asyncio
    from src.pilot_notify import notify_pilot_measure
    asyncio.ensure_future(notify_pilot_measure({
        "source_id": source_id,
        "entity_id": str(measure.project_id),
        "entity_name": entity_name,
        "vendor_id": measure.vendor_id or "",
        "vendor_name": vendor_name or "",
        "title": measure.mesure or "",
        "description": measure.details or "",
        "status": _normalize_status(measure.statut or ""),
        "assignee": measure.responsable or "",
        "due_date": measure.echeance or "",
    }))
    return {"ok": True}


@router.delete("/internal/measures/{source_id}", status_code=204)
async def delete_measure_internal(source_id: str, request: Request,
                                  entity_id: str | None = None,
                                  db: AsyncSession = Depends(get_db)):
    """Delete a measure via Pilot write-back (scoped by entity_id = project)."""
    _check_service_token(request)
    query = select(VendorMeasure).where(VendorMeasure.id == source_id)
    if entity_id:
        query = query.where(VendorMeasure.project_id == entity_id)
    measure = (await db.execute(query)).scalar_one_or_none()
    if not measure:
        raise HTTPException(status_code=404, detail="Measure not found")
    await db.delete(measure)
    # Pilot write-back is a business write — journaled (FEAT-30 review).
    from src.audit import log_write
    await log_write(db, None, request, "measure.writeback_delete", actor="pilot",
                    entity_type="measure", entity_id=str(source_id))
    await bump_server_rev(db, measure.project_id)
    await db.commit()


def _normalize_status(s: str) -> str:
    mapping = {
        "completed": "completed", "termine": "completed", "Terminé": "completed",
        "en_cours": "in_progress", "En cours": "in_progress",
        "planifie": "planned", "Planifié": "planned", "planifié": "planned",
    }
    return mapping.get(s, s)


# ── Audit trail for Pilot-pushed config changes (SEC hardening) ──
# set_proxy / set_custom_llm are service-token endpoints (no user), yet they
# change egress routing and the LLM the module talks to. Record the source
# and what changed so a rogue/erroneous push is traceable. Secrets are NEVER
# logged: proxy URLs are stripped of any user:pass and the LLM key is reduced
# to a boolean. Rotate credentials after any unexpected change (runbook).
def _redact_url(url: str) -> str:
    if not url:
        return "(empty)"
    try:
        p = urlparse(url)
        host = p.hostname or ""
        if p.port:
            host += f":{p.port}"
        return f"{p.scheme}://{host}" if host else "(set)"
    except Exception:
        return "(set)"


def _audit_internal_change(request: Request, action: str, details: dict) -> None:
    ip = request.client.host if request and request.client else "?"
    rendered = " ".join(f"{k}={v}" for k, v in details.items())
    logger.warning("internal config change: action=%s src=%s %s", action, ip, rendered)


@router.put("/internal/proxy")
async def set_proxy(request: Request, db: AsyncSession = Depends(get_db)):
    """Receive proxy config from Pilot."""
    _check_service_token(request)
    body = await request.json()
    for key in ("http_proxy", "https_proxy"):
        if key in body:
            _validate_proxy_url(body[key])
    if "http_proxy" in body:
        os.environ["HTTP_PROXY"] = body["http_proxy"]
        os.environ["http_proxy"] = body["http_proxy"]
    if "https_proxy" in body:
        os.environ["HTTPS_PROXY"] = body["https_proxy"]
        os.environ["https_proxy"] = body["https_proxy"]
    if "no_proxy" in body:
        os.environ["NO_PROXY"] = body["no_proxy"]
        os.environ["no_proxy"] = body["no_proxy"]
    changed = {k: _redact_url(body[k]) for k in ("http_proxy", "https_proxy") if k in body}
    if "no_proxy" in body:
        changed["no_proxy"] = body["no_proxy"]
    if changed:
        _audit_internal_change(request, "proxy.set", changed)
    return {"ok": True}


# In-memory custom LLM config (pushed by Pilot)
_custom_llm = {"endpoint": "", "model": "", "key": "", "label": "Custom LLM"}

@router.put("/internal/ai-custom")
async def set_custom_llm(request: Request):
    """Receive custom LLM config from Pilot (in-memory only, no DB persistence for key)."""
    _check_service_token(request)
    global _custom_llm
    body = await request.json()
    _custom_llm = {
        "endpoint": body.get("endpoint", ""),
        "model": body.get("model", ""),
        "key": body.get("key", ""),
        "label": body.get("label", "Custom LLM"),
    }
    _audit_internal_change(request, "ai_custom.set", {
        "endpoint": _redact_url(_custom_llm["endpoint"]) if _custom_llm["endpoint"] else "(cleared)",
        "model": _custom_llm["model"] or "(none)",
        "label": _custom_llm["label"],
        "key_set": bool(_custom_llm["key"]),
    })
    return {"ok": True}


@router.post("/internal/sync-user")
async def sync_user(request: Request, db: AsyncSession = Depends(get_db)):
    """Receive user ai_enabled update from Pilot."""
    _check_service_token(request)
    body = await request.json()
    email = body.get("email", "")
    if not email:
        return {"ok": False, "error": "no email"}

    from src.models import User as LocalUser
    result = await db.execute(select(LocalUser).where(LocalUser.email == email))
    user = result.scalar_one_or_none()
    if user:
        changed = {}
        if "ai_enabled" in body and user.ai_enabled != body["ai_enabled"]:
            user.ai_enabled = body["ai_enabled"]
            changed["ai_enabled"] = bool(body["ai_enabled"])
        if "name" in body and body["name"] and user.name != body["name"]:
            user.name = body["name"]
            changed["name"] = True
        if changed:
            # Journal only when something actually changed (FEAT-30 P3).
            from src.audit import log_write
            await log_write(db, None, request, "user.sync", actor="pilot",
                            entity_type="user", entity_id=email, details=changed)
        await db.commit()
        return {"ok": True, "updated": True}
    return {"ok": True, "updated": False, "reason": "user not found in module"}



@router.post("/internal/delete-user")
async def delete_user(request: Request, db: AsyncSession = Depends(get_db)):
    """De-provision a user deleted in Pilot.

    Pilot owns the account directory, but each module keeps its own `users`
    row (that is where the module role lives). Without this route a deleted
    person kept a role here for ever: `/internal/sync-user` only creates and
    updates, so nothing ever removed anything.

    Objects the person owned are KEPT — `owner_id` is ON DELETE SET NULL —
    only the account row and the role go.
    """
    _check_service_token(request)
    from sqlalchemy import func as _func

    from src.models import User as LocalUser
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=422, detail="email required")
    target = (await db.execute(
        select(LocalUser).where(_func.lower(LocalUser.email) == email)
    )).scalar_one_or_none()
    if target is None:
        return {"ok": True, "deleted": False}
    from src.audit import log_write
    await log_write(db, None, request, "user.delete", actor="pilot",
                    entity_type="user", entity_id=email,
                    details={"role": target.role or ""})
    await db.delete(target)
    await db.commit()
    return {"ok": True, "deleted": True}

@router.get("/internal/export")
async def internal_export_list(request: Request, db: AsyncSession = Depends(get_db)):
    """List all projects for Pilot backup."""
    _check_service_token(request)
    result = await db.execute(select(Project).order_by(Project.updated_at.desc()))
    projects = result.scalars().all()
    return [{"id": str(p.id), "name": p.name or "", "organization": p.organization or "", "updated_at": str(p.updated_at)} for p in projects]


@router.get("/internal/export/{item_id}")
async def internal_export_item(item_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Export full project data for Pilot backup."""
    _check_service_token(request)
    from src.routes.projects import _reconstruct_data
    project = await db.get(Project, item_id)
    if not project:
        raise HTTPException(status_code=404, detail="Not found")
    data = await _reconstruct_data(db, project.id)
    return {"id": str(project.id), "name": project.name, "organization": project.organization, "owner_id": str(project.owner_id) if project.owner_id else None, "shared_with": project.shared_with or [], "data": data}


@router.put("/internal/restore/{item_id}")
async def internal_restore_item(item_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Restore project data from Pilot backup.

    The restored ``assessments`` array goes through
    ``validate_on_restore`` so a tampered or legacy backup cannot
    inject responses pointing to nonexistent template questions
    (R2), unknown coverage values (R3) or arbitrary scores (R8).
    Workflow rules (R4/R5/R6) are NOT re-applied — the backup is
    authoritative for status / reviewer fields, otherwise an
    assessment that was legitimately ``validated`` could no longer
    be restored. See src/assessment_validation.py for details.
    """
    _check_service_token(request)
    # Single-project module (CHANTIER_PROJET_UNIQUE): a restore must never
    # resurrect a non-canonical project id (FEAT-30 P1bis — pre-collapse
    # backups carry the old random id). Repoint onto the canonical project.
    from src.default_project import DEFAULT_PROJECT_ID_STR
    repointed_from = None
    if item_id != DEFAULT_PROJECT_ID_STR:
        repointed_from = item_id
        item_id = DEFAULT_PROJECT_ID_STR
    body = await request.json()
    data = body.get("data", {})
    # FEAT-36 — a restored backup can carry an old blob: migrate it too.
    from src.schema_migrations import FutureRevError, migrate_blob
    try:
        data = migrate_blob("vendor", data)
    except FutureRevError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    name = body.get("name", "")
    organization = body.get("organization", "")

    from src.assessment_validation import validate_on_restore
    from src.routes.projects import _delete_children, _decompose_data

    if isinstance(data, dict) and isinstance(data.get("assessments"), list):
        data = dict(data)
        data["assessments"] = validate_on_restore(data["assessments"])

    project = await db.get(Project, item_id)
    if project:
        project.name = name or project.name
        project.organization = organization or project.organization
        from src.backup_common import restore_root_fields
        from src.models import User as _RootUser
        await restore_root_fields(db, project, body, _RootUser)
        from src.audit import log_write
        await log_write(db, None, request, "project.restore", actor="pilot",
                        entity_type="project", entity_id=str(project.id), target=project.name or "")
        await _delete_children(db, project.id)
        await _decompose_data(db, project.id, data)
        await bump_server_rev(db, project.id)
        await db.commit()
        return {"ok": True, "action": "updated", "repointed_from": repointed_from}
    else:
        project = Project(id=item_id, name=name, organization=organization)
        db.add(project)
        await db.flush()
        from src.backup_common import restore_root_fields
        from src.models import User as _RootUser
        await restore_root_fields(db, project, body, _RootUser)
        from src.audit import log_write
        await log_write(db, None, request, "project.restore", actor="pilot",
                        entity_type="project", entity_id=str(project.id), target=project.name or "")
        await _decompose_data(db, project.id, data)
        await bump_server_rev(db, project.id)
        await db.commit()
        return {"ok": True, "action": "created", "repointed_from": repointed_from}


# ── Recovery reads (FEAT-30 phase 2) — state at instant T ───────────────
# The agent's scratch instance holds the database as it was at T. These
# endpoints re-run the exact same export code against it, so Pilot's diff
# compares two payloads of identical shape. The list call also brings the
# scratch schema to head (alembic) when T predates a migration.

@router.get("/internal/export-recovery")
async def internal_export_recovery_list(request: Request):
    _check_service_token(request)
    from src.backup_common import recovery_session, upgrade_recovery_schema
    upgrade_recovery_schema()
    async with recovery_session() as rdb:
        return await internal_export_list(request, rdb)


@router.get("/internal/export-recovery/{item_id}")
async def internal_export_recovery_item(item_id: str, request: Request):
    _check_service_token(request)
    from src.backup_common import recovery_session
    async with recovery_session() as rdb:
        return await internal_export_item(item_id, request, rdb)


# ── Journal reads (FEAT-30 phase 2) — event-anchored restore ────────────
# Pilot's restore UI shows WHO changed WHAT and WHEN so the admin picks an
# event instead of guessing a clock time. Modules whose audit_log predates
# the entity columns (surface/appsec/watch) still serve time+actor+action.

@router.get("/internal/journal")
async def internal_journal(request: Request, entity_id: str = "", limit: int = 30,
                           db: AsyncSession = Depends(get_db)):
    _check_service_token(request)
    from src.models import AuditLog
    cols = {c.name for c in AuditLog.__table__.columns}
    q = select(AuditLog).order_by(AuditLog.logged_at.desc()).limit(min(max(limit, 1), 100))
    if entity_id and "entity_id" in cols:
        q = q.where(AuditLog.entity_id == entity_id)
    rows = (await db.execute(q)).scalars().all()
    return [{
        "logged_at": r.logged_at.isoformat() if r.logged_at else None,
        "user_email": r.user_email or "",
        "action": r.action or "",
        "target": r.target or "",
        "entity_type": getattr(r, "entity_type", "") or "",
        "entity_id": getattr(r, "entity_id", "") or "",
        "details": (r.details or "")[:300],
    } for r in rows]
