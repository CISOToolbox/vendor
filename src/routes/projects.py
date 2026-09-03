from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Optional

import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.assessment_validation import validate_blob
from src.auth import ADMIN_MODULE_ROLES, VIEWER_MODULE_ROLES, auth_enabled, get_current_user, perms_for_module_role
from src.calculations import compute_project_stats, recalculate_all
from src.database import get_db
from src.models import (
    DoraArrangement,
    DoraArrangementFunction,
    DoraArrangementRfe,
    DoraArrangementService,
    DoraArrangementSubcontractor,
    DoraBranch,
    DoraConsolidationScope,
    DoraEntity,
    DoraFunction,
    DoraSigner,
    DoraSubcontractor,
    Project,
    ProjectMetadata,
    User,
    Vendor,
    VendorAssessment,
    VendorDocument,
    VendorMeasure,
    VendorRisk,
)
from src.schemas import (
    ProjectCreate,
    ProjectListItem,
    ProjectResponse,
    ProjectStats,
    ProjectUpdate,
    ShareRequest,
)
from src.upload_common import read_json_upload

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ── Helpers ────────────────────────────────────────────────────────

def _user_permissions(project: Project, user: Optional[User]) -> list[str]:
    if not auth_enabled() or user is None:
        return ["read", "edit", "delete", "share"]
    if user.role == "admin":
        return ["read", "edit", "delete", "share"]
    if project.owner_id == user.id:
        return ["read", "edit", "delete", "share"]
    if project.owner_id is None:
        # Unowned resource: rights follow the module role. Admins get full,
        # viewers stay read-only, everyone else read+edit — previously an
        # unowned project was a full-access free-for-all.
        mrole = getattr(user, "_module_role", "")
        if mrole in ADMIN_MODULE_ROLES:
            return ["read", "edit", "delete", "share"]
        if mrole in VIEWER_MODULE_ROLES:
            return ["read"]
        return ["read", "edit"]
    for share in (project.shared_with or []):
        if share.get("user_id") == str(user.id):
            return share.get("permissions", ["read"])
    # Fallback: if the user has a module role (they passed get_current_user),
    # grant access based on that role via the shared ladder. Without this,
    # contributors not explicitly in shared_with cannot see any project.
    return perms_for_module_role(getattr(user, "_module_role", ""))


def _can(perm: str, project: Project, user: Optional[User]) -> bool:
    return perm in _user_permissions(project, user)


# ── Reconstruct D object from relational tables ───────────────────

def _vendor_to_dict(v: Vendor, vendor_measures: list[VendorMeasure]) -> dict:
    measures = [
        {
            "id": m.id,
            "mesure": m.mesure or "",
            "details": m.details or "",
            "type": m.type or "",
            "statut": m.statut or "a_faire",
            "responsable": m.responsable or "",
            "echeance": m.echeance or "",
            "ref_socle": m.ref_socle or "",
            "effet": m.effet or "",
            # Round-trip completeness (FEAT-30): the progress journal is
            # written by Pilot and the source* columns carry the
            # assessment-remediation provenance — losing them on restore
            # (or on the blob PUT) was audit finding P1.7.
            "progress_log": m.progress_log or [],
            "source": m.source or "",
            "source_assessment_id": m.source_assessment_id or "",
            "source_question_id": m.source_question_id or "",
        }
        for m in vendor_measures
    ]
    return {
        "id": v.id,
        "name": v.name or "",
        "legal_entity": v.legal_entity or "",
        "country": v.country or "",
        "sector": v.sector or "",
        "website": v.website or "",
        "siret": v.siret or "",
        "status": v.status or "active",
        "notes": v.notes or "",
        "logo": v.logo or "",
        "dpa_signed": v.dpa_signed or False,
        "contact": v.contact or {},
        "internal_contact": v.internal_contact or {},
        "contract": v.contract or {},
        "classification": v.classification or {},
        "exposure": v.exposure or {},
        "certifications": v.certifications or [],
        "sub_contractors": v.sub_contractors or [],
        "measures": measures,
        # ── DORA RoI additive columns ──
        "lei": v.lei or "",
        "legal_name_latin": v.legal_name_latin or "",
        "person_type": v.person_type or "",
        "entity_nature": v.entity_nature or "",
        "additional_id_type": v.additional_id_type or "",
        "additional_id_value": v.additional_id_value or "",
        "additional_id_issuer": v.additional_id_issuer or "",
        "ultimate_parent_id": v.ultimate_parent_id or "",
        "country_iso2": v.country_iso2 or "",
    }


def _risk_to_dict(r: VendorRisk) -> dict:
    return {
        "id": r.id,
        "vendor_id": r.vendor_id,
        "title": r.title or "",
        "description": r.description or "",
        "category": r.category or "",
        "impact": r.impact,
        "likelihood": r.likelihood,
        "residual_impact": r.residual_impact,
        "residual_likelihood": r.residual_likelihood,
        "status": r.status or "active",
        "linked_measures": r.linked_measures or "",
        "treatment": r.treatment or {},
    }


def _document_to_dict(d: VendorDocument) -> dict:
    return {
        "id": d.id,
        "vendor_id": d.vendor_id,
        "name": d.name or "",
        "type": d.type or "",
        "url": d.url or "",
        "expiry_date": d.expiry_date or "",
        "source": d.source or "",
        "verified": d.verified or False,
    }


def _assessment_to_dict(a: VendorAssessment) -> dict:
    """Serialize an assessment row including phase 0b fields."""
    return {
        "id": a.id,
        "vendor_id": a.vendor_id,
        "title": a.title or "",
        "status": a.status or "draft",
        "date": a.date or "",
        "score": a.score,
        "assessor": a.assessor or "",
        "responses": a.responses or [],
        # ── Phase 0b fields (see src/assessment_validation.py) ──
        "type": a.type or "periodic",
        "due_date": a.due_date or "",
        "template_id": a.template_id,
        "template_version": a.template_version,
        "template_snapshot": a.template_snapshot,
        "self_validation": bool(a.self_validation),
        "self_validated_at": a.self_validated_at,
        "submitted_at": a.submitted_at,
        "approved_at": a.approved_at,
        "approved_by": a.approved_by,
        "rejected_reason": a.rejected_reason,
        "completion_rate": a.completion_rate,
    }


# ── DORA RoI snapshot helpers (used for backup/restore round-trip) ─
#
# 11 DORA tables hang off Project via project_id. They are NOT covered
# by the legacy ``data`` blob (vendors/measures/risks/documents/assessments).
# For the backup/restore endpoints to round-trip a project faithfully,
# ``data`` carries an extra ``dora`` key that stores every DoraXxx row
# as a plain dict using the SQLAlchemy column introspection below.
#
# Insert order respects FK dependencies; delete order is the reverse.
# The same helpers are reused by ``_decompose_data`` / ``_delete_children``.

_DORA_MODELS_IN_INSERT_ORDER = (
    ("entities", DoraEntity),                       # B_01.02
    ("consolidation_scope", DoraConsolidationScope),  # B_01.01 / B_01.02
    ("branches", DoraBranch),                       # B_01.03 (FK -> entities)
    ("functions", DoraFunction),                    # B_06.01
    ("subcontractors", DoraSubcontractor),          # B_05.01 (project-global identity)
    ("arrangements", DoraArrangement),              # B_02.02 / B_03.02 (FK -> vendors)
    ("arrangement_services", DoraArrangementService),
    ("arrangement_functions", DoraArrangementFunction),
    ("arrangement_rfes", DoraArrangementRfe),
    ("arrangement_subcontractors", DoraArrangementSubcontractor),
    ("signers", DoraSigner),                        # B_03.03
)

# Columns that are managed by the DB (server defaults / onupdate) and
# must be omitted from re-insert payloads so the DB picks fresh values.
_DORA_SKIP_COLS = {"created_at", "updated_at"}


def _row_to_dict(obj) -> dict:
    """Serialize an SQLAlchemy row to a JSON-safe dict, skipping
    project_id (re-injected by the loader) and DB-managed timestamps."""
    out: dict = {}
    for col in obj.__table__.columns:
        if col.name in _DORA_SKIP_COLS or col.name == "project_id":
            continue
        v = getattr(obj, col.name)
        if isinstance(v, datetime):
            v = v.isoformat()
        out[col.name] = v
    return out


async def _dora_to_dict(db: AsyncSession, project_id: uuid.UUID) -> dict:
    """Read every DORA table for a project and return a single dict.
    Returned shape: ``{<key>: [<row dict>, ...], ...}`` for every entry
    of ``_DORA_MODELS_IN_INSERT_ORDER``. Empty keys are kept so the
    consumer can rely on a stable schema."""
    out: dict = {}
    for key, model in _DORA_MODELS_IN_INSERT_ORDER:
        q = select(model).where(model.project_id == project_id)
        if hasattr(model, "sort_order"):
            q = q.order_by(model.sort_order)
        rows = (await db.execute(q)).scalars().all()
        out[key] = [_row_to_dict(r) for r in rows]
    return out


async def _dora_delete_all(db: AsyncSession, project_id: uuid.UUID) -> None:
    """Delete every DORA row for a project in reverse FK order."""
    for key, model in reversed(_DORA_MODELS_IN_INSERT_ORDER):
        await db.execute(delete(model).where(model.project_id == project_id))


async def _dora_from_dict(
    db: AsyncSession, project_id: uuid.UUID, dora: dict
) -> None:
    """Recreate DORA rows from the dict produced by ``_dora_to_dict``.
    Unknown keys are ignored; unknown columns in a row are filtered out
    so a backup taken on an older migration can still be restored on a
    schema that added/removed columns."""
    if not dora:
        return
    for key, model in _DORA_MODELS_IN_INSERT_ORDER:
        rows = dora.get(key) or []
        if not rows:
            continue
        col_names = {c.name for c in model.__table__.columns}
        for row in rows:
            payload = {k: v for k, v in row.items() if k in col_names}
            payload["project_id"] = project_id
            db.add(model(**payload))


async def _reconstruct_data(db: AsyncSession, project_id: uuid.UUID) -> dict:
    """Reconstruct the D object from relational tables."""
    # Query all child tables
    meta_result = await db.execute(
        select(ProjectMetadata).where(ProjectMetadata.project_id == project_id)
    )
    meta = meta_result.scalar_one_or_none()

    vendors_result = await db.execute(
        select(Vendor).where(Vendor.project_id == project_id).order_by(Vendor.sort_order)
    )
    vendors = vendors_result.scalars().all()

    measures_result = await db.execute(
        select(VendorMeasure).where(VendorMeasure.project_id == project_id).order_by(VendorMeasure.sort_order)
    )
    all_measures = measures_result.scalars().all()

    risks_result = await db.execute(
        select(VendorRisk).where(VendorRisk.project_id == project_id).order_by(VendorRisk.sort_order)
    )
    risks = risks_result.scalars().all()

    documents_result = await db.execute(
        select(VendorDocument).where(VendorDocument.project_id == project_id).order_by(VendorDocument.sort_order)
    )
    documents = documents_result.scalars().all()

    assessments_result = await db.execute(
        select(VendorAssessment).where(VendorAssessment.project_id == project_id).order_by(VendorAssessment.sort_order)
    )
    assessments = assessments_result.scalars().all()

    # Group measures by vendor_id
    measures_by_vendor: dict[str, list[VendorMeasure]] = {}
    for m in all_measures:
        measures_by_vendor.setdefault(m.vendor_id, []).append(m)

    # Build the D object
    data = {
        "metadata": {
            "organization": meta.organization or "" if meta else "",
            "created": meta.created_date or "" if meta else "",
        },
        "vendors": [_vendor_to_dict(v, measures_by_vendor.get(v.id, [])) for v in vendors],
        "risks": [_risk_to_dict(r) for r in risks],
        "assessments": [_assessment_to_dict(a) for a in assessments],
        "documents": [_document_to_dict(d) for d in documents],
        # DORA RoI snapshot — preserves the 11 dora_* tables so that
        # Pilot's centralized backup loop captures the full project
        # state (otherwise DORA data was silently absent from backups
        # and silently preserved across restores).
        "dora": await _dora_to_dict(db, project_id),
    }
    return data


# ── Decompose D object into relational tables ─────────────────────

async def _delete_children(db: AsyncSession, project_id: uuid.UUID):
    """Delete all child rows for a project (order matters for FK constraints)."""
    # DORA tables first: dora_arrangements has FK -> vendors (vendor_id),
    # so the arrangements (and their junction children) must go before
    # the Vendor rows below.
    await _dora_delete_all(db, project_id)
    await db.execute(delete(VendorMeasure).where(VendorMeasure.project_id == project_id))
    await db.execute(delete(VendorDocument).where(VendorDocument.project_id == project_id))
    await db.execute(delete(VendorRisk).where(VendorRisk.project_id == project_id))
    await db.execute(delete(VendorAssessment).where(VendorAssessment.project_id == project_id))
    await db.execute(delete(Vendor).where(Vendor.project_id == project_id))
    await db.execute(delete(ProjectMetadata).where(ProjectMetadata.project_id == project_id))


async def _renotify_project_measures(db: AsyncSession, project_id: uuid.UUID) -> None:
    """Re-notify Pilot for every measure of a project. Called when the
    project's name or organization changes so MeasureCache.entity_name
    in Pilot reflects the rename without waiting for the next manual
    POST /api/measures/sync. Same payload format as vendor_measures.py
    and internal.py call sites — fire-and-forget."""
    import asyncio
    from src.pilot_notify import notify_pilot_measures_bulk
    from src.routes.internal import VENDOR_IN_SCOPE, _normalize_status

    rows = await db.execute(
        select(VendorMeasure, Vendor.name, Project.name.label("project_name"), ProjectMetadata.organization)
        .join(Vendor, (VendorMeasure.project_id == Vendor.project_id) & (VendorMeasure.vendor_id == Vendor.id))
        .join(Project, VendorMeasure.project_id == Project.id)
        .outerjoin(ProjectMetadata, VendorMeasure.project_id == ProjectMetadata.project_id)
        # Même périmètre que /internal/measures — le canal push ne doit pas
        # ressusciter dans le cache Pilot ce que le canal pull filtre.
        .where(VendorMeasure.project_id == project_id,
               Vendor.status.in_(VENDOR_IN_SCOPE))
    )
    # Build every payload, then hand Pilot the whole batch in ONE request
    # instead of spawning a POST (+ a fresh httpx client) per measure — a
    # rename on a 500-measure project used to open 500 connections.
    payloads = []
    for row in rows.all():
        m = row[0]
        vendor_name = row[1] or ""
        project_name = row[2] or ""
        organization = row[3] or ""
        entity_name = (organization or project_name or "") + " / " + vendor_name
        payloads.append({
            "source_id": m.id,
            "entity_id": str(m.project_id),
            "entity_name": entity_name,
            "vendor_id": m.vendor_id or "",
            "vendor_name": vendor_name,
            "title": m.mesure or "",
            "description": m.details or "",
            "status": _normalize_status(m.statut or ""),
            "assignee": m.responsable or "",
            "due_date": m.echeance or "",
            "type": m.type or "",
        })
    if payloads:
        asyncio.ensure_future(notify_pilot_measures_bulk(payloads))


async def _decompose_data(db: AsyncSession, project_id: uuid.UUID, data: dict):
    """Decompose a D object into relational child rows."""
    # Metadata
    meta = data.get("metadata") or {}
    db.add(ProjectMetadata(
        project_id=project_id,
        organization=meta.get("organization", ""),
        created_date=meta.get("created", ""),
    ))

    # Vendors + nested measures
    for i, v in enumerate(data.get("vendors") or []):
        vendor_id = v.get("id", "")
        db.add(Vendor(
            project_id=project_id,
            id=vendor_id,
            sort_order=i,
            name=v.get("name", ""),
            legal_entity=v.get("legal_entity", ""),
            country=v.get("country", ""),
            sector=v.get("sector", ""),
            website=v.get("website", ""),
            siret=v.get("siret", ""),
            status=v.get("status", "active"),
            notes=v.get("notes", ""),
            logo=v.get("logo", ""),
            dpa_signed=v.get("dpa_signed", False),
            contact=v.get("contact", {}),
            internal_contact=v.get("internal_contact", {}),
            contract=v.get("contract", {}),
            classification=v.get("classification", {}),
            exposure=v.get("exposure", {}),
            certifications=v.get("certifications", []),
            sub_contractors=v.get("sub_contractors", []),
            # ── DORA RoI additive columns ──
            lei=v.get("lei") or None,
            legal_name_latin=v.get("legal_name_latin") or None,
            person_type=v.get("person_type") or None,
            entity_nature=v.get("entity_nature") or None,
            additional_id_type=v.get("additional_id_type") or None,
            additional_id_value=v.get("additional_id_value") or None,
            additional_id_issuer=v.get("additional_id_issuer") or None,
            ultimate_parent_id=v.get("ultimate_parent_id") or None,
            country_iso2=v.get("country_iso2") or None,
        ))
        for j, m in enumerate(v.get("measures") or []):
            db.add(VendorMeasure(
                project_id=project_id,
                vendor_id=vendor_id,
                id=m.get("id", ""),
                sort_order=j,
                mesure=m.get("mesure", ""),
                details=m.get("details", ""),
                type=m.get("type", ""),
                statut=m.get("statut", "a_faire"),
                responsable=m.get("responsable", ""),
                echeance=m.get("echeance", ""),
                ref_socle=m.get("ref_socle", ""),
                effet=m.get("effet", ""),
                progress_log=m.get("progress_log") or [],
                source=m.get("source") or "",
                source_assessment_id=m.get("source_assessment_id") or "",
                source_question_id=m.get("source_question_id") or "",
            ))

    # Risks
    for i, r in enumerate(data.get("risks") or []):
        db.add(VendorRisk(
            project_id=project_id,
            id=r.get("id", ""),
            sort_order=i,
            vendor_id=r.get("vendor_id", ""),
            title=r.get("title", ""),
            description=r.get("description", ""),
            category=r.get("category", ""),
            impact=r.get("impact"),
            likelihood=r.get("likelihood"),
            residual_impact=r.get("residual_impact"),
            residual_likelihood=r.get("residual_likelihood"),
            status=r.get("status", "active"),
            linked_measures=r.get("linked_measures", ""),
            treatment=r.get("treatment", {}),
        ))

    # Documents
    for i, d in enumerate(data.get("documents") or []):
        db.add(VendorDocument(
            project_id=project_id,
            id=d.get("id", ""),
            sort_order=i,
            vendor_id=d.get("vendor_id", ""),
            name=d.get("name", ""),
            type=d.get("type", ""),
            url=d.get("url", ""),
            expiry_date=d.get("expiry_date", ""),
            source=d.get("source", ""),
            verified=d.get("verified", False),
        ))

    # Assessments
    # Phase 0b fields are persisted verbatim here — the caller
    # (`update_project`) is expected to have already passed the blob
    # through `validate_blob()` so `template_snapshot` is frozen,
    # `score` / `completion_rate` are recomputed, and status
    # transitions are legal. See src/assessment_validation.py.
    for i, a in enumerate(data.get("assessments") or []):
        db.add(VendorAssessment(
            project_id=project_id,
            id=a.get("id", ""),
            sort_order=i,
            vendor_id=a.get("vendor_id", ""),
            title=a.get("title", ""),
            status=a.get("status", "draft"),
            date=a.get("date", ""),
            score=a.get("score"),
            assessor=a.get("assessor", ""),
            responses=a.get("responses", []),
            type=a.get("type", "periodic"),
            due_date=a.get("due_date", ""),
            template_id=a.get("template_id"),
            template_version=a.get("template_version"),
            template_snapshot=a.get("template_snapshot"),
            self_validation=bool(a.get("self_validation", False)),
            self_validated_at=a.get("self_validated_at"),
            submitted_at=a.get("submitted_at"),
            approved_at=a.get("approved_at"),
            approved_by=a.get("approved_by"),
            rejected_reason=a.get("rejected_reason"),
            completion_rate=a.get("completion_rate", 0),
        ))

    # DORA RoI snapshot — restored after vendors so the FK
    # dora_arrangements.vendor_id → vendors.id holds. The dict is
    # produced by _reconstruct_data via _dora_to_dict and follows the
    # exact insert order declared in _DORA_MODELS_IN_INSERT_ORDER.
    #
    # Flush the vendor rows (and the other children added above) BEFORE
    # the arrangements: SQLAlchemy's unit-of-work does not guarantee that
    # buffered INSERTs run in add() order, and it may emit a
    # dora_arrangements INSERT before the Vendor it references, breaking
    # dora_arrangements_project_id_vendor_id_fkey. An explicit flush here
    # forces the vendors to exist first. Without it the whole blob PUT
    # (_autoSave path: AI auto-fill, import, undo, bulk edits) 500s and
    # rolls back on any project that has DORA arrangements.
    await db.flush()
    await _dora_from_dict(db, project_id, data.get("dora") or {})


# ── Routes ─────────────────────────────────────────────────────────

@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    body: ProjectCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = Project(
        name=body.name,
        organization=body.organization,
        owner_id=user.id if user else None,
    )
    db.add(project)
    await db.flush()

    if body.data:
        # First-time blob on a fresh project → validate with an empty
        # stored map (every assessment is treated as a creation).
        creation_data = copy.deepcopy(body.data)
        creation_data["assessments"] = validate_blob(
            creation_data.get("assessments") or [],
            {},
        )
        await _decompose_data(db, project.id, creation_data)

    await db.commit()
    await db.refresh(project)

    data = await _reconstruct_data(db, project.id)
    return _project_response(project, data)


@router.get("", response_model=list[ProjectListItem])
async def list_projects(
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Single-project modules boot on list[0]: the canonical project must
    # come first even if a stray (e.g. resurrected by an old restore)
    # was updated more recently (FEAT-30 P1bis).
    from src.default_project import DEFAULT_PROJECT_ID
    result = await db.execute(
        select(Project).order_by(
            (Project.id == DEFAULT_PROJECT_ID).desc(),
            Project.updated_at.desc())
    )
    projects = result.scalars().all()
    if not auth_enabled() or user is None or user.role == "admin":
        return projects
    return [p for p in projects if _can("read", p, user)]


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can("read", project, user):
        raise HTTPException(status_code=403, detail="Access denied")

    data = await _reconstruct_data(db, project.id)
    return _project_response(project, data)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # FEAT-33 stale-tab guard: refuse the whole-blob overwrite when a
    # server-initiated writer bumped server_rev since this tab loaded.
    if body.expected_server_rev is not None and (project.server_rev or 0) > body.expected_server_rev:
        raise HTTPException(status_code=409,
                            detail="Données modifiées côté serveur depuis le chargement (Pilot/scheduler) — rechargez avant une sauvegarde globale.")
    if not _can("edit", project, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # Snapshot identity before mutation so we can detect a rename and
    # re-notify Pilot's MeasureCache (entity_name uses project_name and
    # ProjectMetadata.organization). See _renotify_project_measures.
    old_name = project.name or ""
    old_meta = await db.execute(
        select(ProjectMetadata.organization).where(ProjectMetadata.project_id == project.id)
    )
    old_organization = (old_meta.scalar_one_or_none() or "")

    if body.name is not None:
        project.name = body.name
    if body.organization is not None:
        project.organization = body.organization

    if body.data is not None:
        recalculated = recalculate_all(copy.deepcopy(body.data))
        # Enforce server-side assessment validation on the blob path.
        # This is the fallback save route used by the frontend when no
        # granular PATCH endpoint covers the mutation (new templates,
        # new assessments, coverage edits, status transitions). We
        # must validate every assessment the same way the PATCH route
        # does, otherwise a client could bypass the granular rules by
        # writing straight to the blob. See src/assessment_validation.py
        # for the full rule set (R1..R9).
        stored_assessments_result = await db.execute(
            select(VendorAssessment).where(VendorAssessment.project_id == project.id)
        )
        stored_map = {a.id: _assessment_to_dict(a) for a in stored_assessments_result.scalars().all()}
        recalculated["assessments"] = validate_blob(
            recalculated.get("assessments") or [],
            stored_map,
        )
        # Server-assigned timestamp fields for any assessments that
        # transitioned to pending_approval / validated via the blob path.
        # (Status transitions themselves were already enforced by
        # validate_blob, see R5.)
        now = datetime.now(timezone.utc)
        current_email = (user.email if user is not None else "") or ""
        for a in recalculated["assessments"]:
            if a.get("status") == "pending_approval" and not a.get("submitted_at"):
                a["submitted_at"] = now.isoformat()
            if a.get("status") == "validated" and not a.get("approved_at"):
                a["approved_at"] = now.isoformat()
                a["approved_by"] = a.get("approved_by") or current_email
        await _delete_children(db, project.id)
        await _decompose_data(db, project.id, recalculated)

    project.updated_at = datetime.now(timezone.utc)
    from src.audit import log_write
    await log_write(db, user, None,
                    "project.blob_put" if body.data is not None else "project.update",
                    entity_type="project", entity_id=str(project.id), target=project.name or "")
    await db.commit()
    await db.refresh(project)

    # If the project's display identity changed (name or
    # ProjectMetadata.organization), re-push every measure to Pilot so
    # MeasureCache.entity_name reflects the rename immediately. Without
    # this the cache stays stale until an admin clicks "Synchroniser"
    # in Pilot or POSTs /api/measures/sync.
    new_meta = await db.execute(
        select(ProjectMetadata.organization).where(ProjectMetadata.project_id == project.id)
    )
    new_organization = (new_meta.scalar_one_or_none() or "")
    if (project.name or "") != old_name or new_organization != old_organization:
        await _renotify_project_measures(db, project.id)

    data = await _reconstruct_data(db, project.id)
    return _project_response(project, data)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can("delete", project, user):
        raise HTTPException(status_code=403, detail="Access denied")
    from src.audit import log_write
    await log_write(db, user, None, "project.delete",
                    entity_type="project", entity_id=str(project.id), target=project.name or "")
    await db.delete(project)
    await db.commit()


@router.post("/{project_id}/duplicate", response_model=ProjectResponse, status_code=201)
async def duplicate_project(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    original = await db.get(Project, project_id)
    if not original:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can("read", original, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # Reconstruct data from original, then decompose into new project
    original_data = await _reconstruct_data(db, original.id)

    duplicate = Project(
        name=original.name + " (copy)",
        organization=original.organization,
        owner_id=user.id if user else None,
    )
    db.add(duplicate)
    await db.flush()

    await _decompose_data(db, duplicate.id, original_data)
    await db.commit()
    await db.refresh(duplicate)

    data = await _reconstruct_data(db, duplicate.id)
    return _project_response(duplicate, data)


@router.post("/import", response_model=ProjectResponse, status_code=201)
async def import_project(
    file: UploadFile,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    import json

    content = await read_json_upload(file, 10 * 1024 * 1024)
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Invalid JSON file")

    # FEAT-36 — refuse future revs, normalize + replay schema migrations.
    from src.schema_migrations import FutureRevError, migrate_blob
    try:
        data = migrate_blob("vendor", data)
    except FutureRevError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    name = ""
    if isinstance(data, dict):
        meta = data.get("metadata", {})
        name = meta.get("organization", "") if isinstance(meta, dict) else ""

    project = Project(
        name=name,
        owner_id=user.id if user else None,
    )
    db.add(project)
    await db.flush()

    if isinstance(data, dict):
        # Imported files are user-supplied → validate as fresh creations
        # (empty stored map). See src/assessment_validation.py.
        data["assessments"] = validate_blob(
            data.get("assessments") or [],
            {},
        )
        await _decompose_data(db, project.id, data)

    from src.audit import log_write
    await log_write(db, user, None, "project.import",
                    entity_type="project", entity_id=str(project.id), target=project.name or "")
    await db.commit()
    await db.refresh(project)

    data_out = await _reconstruct_data(db, project.id)
    return _project_response(project, data_out)


@router.get("/{project_id}/export")
async def export_project(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can("read", project, user):
        raise HTTPException(status_code=403, detail="Access denied")

    data = await _reconstruct_data(db, project.id)
    filename = re.sub(r'[^a-zA-Z0-9_-]', '_', project.name or "export") + "_TPRM.json"
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{project_id}/recalculate", response_model=ProjectResponse)
async def recalculate_project(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can("edit", project, user):
        raise HTTPException(status_code=403, detail="Access denied")

    data = await _reconstruct_data(db, project.id)
    recalculated = recalculate_all(copy.deepcopy(data))

    await _delete_children(db, project.id)
    await _decompose_data(db, project.id, recalculated)

    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(project)

    data_out = await _reconstruct_data(db, project.id)
    return _project_response(project, data_out)


@router.get("/{project_id}/stats", response_model=ProjectStats)
async def get_project_stats(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can("read", project, user):
        raise HTTPException(status_code=403, detail="Access denied")

    data = await _reconstruct_data(db, project.id)
    return compute_project_stats(data)


@router.post("/{project_id}/share", response_model=ProjectResponse)
async def share_project(
    project_id: uuid.UUID,
    body: ShareRequest,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can("share", project, user):
        raise HTTPException(status_code=403, detail="No share permission")

    valid = {"read", "edit", "delete", "share"}
    perms = [p for p in body.permissions if p in valid]
    if not perms:
        raise HTTPException(status_code=400, detail="At least one valid permission required")

    result = await db.execute(select(User).where(User.email == body.email))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found with this email")

    shared = list(project.shared_with or [])
    found = False
    for entry in shared:
        if entry.get("user_id") == str(target.id):
            entry["permissions"] = perms
            entry["name"] = target.name
            found = True
            break
    if not found:
        shared.append({"user_id": str(target.id), "email": target.email, "name": target.name, "permissions": perms})

    project.shared_with = shared
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(project)

    data = await _reconstruct_data(db, project.id)
    return _project_response(project, data)


@router.delete("/{project_id}/share/{user_email}", response_model=ProjectResponse)
async def revoke_share(
    project_id: uuid.UUID,
    user_email: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can("share", project, user):
        raise HTTPException(status_code=403, detail="No share permission")

    shared = [s for s in (project.shared_with or []) if s.get("email") != user_email]
    project.shared_with = shared
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(project)

    data = await _reconstruct_data(db, project.id)
    return _project_response(project, data)


# ── Response builder ───────────────────────────────────────────────

def _project_response(project: Project, data: dict) -> dict:
    """Build ProjectResponse-compatible dict with reconstructed data."""
    return {
        "id": project.id,
        "name": project.name,
        "organization": project.organization,
        "owner_id": project.owner_id,
        "shared_with": project.shared_with or [],
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "server_rev": project.server_rev or 0,
        "data": data,
    }
