"""
DORA Register of Information — granular REST endpoints.

Per project-scoped tree, every entity (RFE, function, branch, consolidation
scope, arrangement, signer, subcontractor) has its own POST/PATCH/DELETE
routes. NO blob PUT, ever — see memory/feedback_persistence_model.md.

All writes funnel through src/dora_validation.py for the R1..R15 rule set.

Routes
──────
GET    /api/dora/codelists                                    # public-ish (auth-gated)
GET    /api/projects/{pid}/dora                               # whole-tree read (export-friendly)
PATCH  /api/projects/{pid}/vendors/{vid}/roi                  # 9 vendor-level RoI fields

POST   /api/projects/{pid}/dora/entities                      # RFE
GET    /api/projects/{pid}/dora/entities
PATCH  /api/projects/{pid}/dora/entities/{id}
DELETE /api/projects/{pid}/dora/entities/{id}

POST   /api/projects/{pid}/dora/functions
GET    /api/projects/{pid}/dora/functions
PATCH  /api/projects/{pid}/dora/functions/{id}
DELETE /api/projects/{pid}/dora/functions/{id}

POST   /api/projects/{pid}/dora/branches
GET    /api/projects/{pid}/dora/branches
PATCH  /api/projects/{pid}/dora/branches/{id}
DELETE /api/projects/{pid}/dora/branches/{id}

POST   /api/projects/{pid}/dora/consolidation
GET    /api/projects/{pid}/dora/consolidation
PATCH  /api/projects/{pid}/dora/consolidation/{id}
DELETE /api/projects/{pid}/dora/consolidation/{id}

POST   /api/projects/{pid}/dora/arrangements
GET    /api/projects/{pid}/dora/arrangements
PATCH  /api/projects/{pid}/dora/arrangements/{id}
DELETE /api/projects/{pid}/dora/arrangements/{id}
POST   /api/projects/{pid}/dora/arrangements/{aid}/rfes       # link RFE to arrangement
DELETE /api/projects/{pid}/dora/arrangements/{aid}/rfes/{rid}

POST   /api/projects/{pid}/dora/arrangements/{aid}/signers
PATCH  /api/projects/{pid}/dora/arrangements/{aid}/signers/{id}
DELETE /api/projects/{pid}/dora/arrangements/{aid}/signers/{id}

# Subcontractor identity (project-global)
POST   /api/projects/{pid}/dora/subcontractors
GET    /api/projects/{pid}/dora/subcontractors
PATCH  /api/projects/{pid}/dora/subcontractors/{sub_id}
DELETE /api/projects/{pid}/dora/subcontractors/{sub_id}

# Subcontractor links to an arrangement (per-link RoI fields)
POST   /api/projects/{pid}/dora/arrangements/{aid}/subcontractors
PATCH  /api/projects/{pid}/dora/arrangements/{aid}/subcontractors/{sub_id}
DELETE /api/projects/{pid}/dora/arrangements/{aid}/subcontractors/{sub_id}

GET    /api/projects/{pid}/dora/export.xlsx                   # consolidated EBA-format XLSX
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import auth_enabled, get_current_user
from src.database import get_db
from src.dora_validation import (
    codelists,
    validate_dora_arrangement,
    validate_dora_arrangement_subcontractor,
    validate_dora_branch,
    validate_dora_consolidation,
    validate_dora_entity,
    validate_dora_function,
    validate_dora_signer,
    validate_dora_subcontractor,
    validate_parent_chain,
    validate_vendor_roi,
)
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
    User,
    Vendor,
)
from src.routes.auth_helpers import get_project_or_404
from src.schemas import (
    DoraArrangementCreate,
    DoraArrangementResponse,
    DoraArrangementRfeLink,
    DoraArrangementUpdate,
    DoraBranchCreate,
    DoraBranchResponse,
    DoraBranchUpdate,
    DoraConsolidationScopeCreate,
    DoraConsolidationScopeResponse,
    DoraConsolidationScopeUpdate,
    DoraEntityCreate,
    DoraEntityResponse,
    DoraEntityUpdate,
    DoraFunctionCreate,
    DoraFunctionResponse,
    DoraFunctionUpdate,
    DoraArrangementSubcontractorCreate,
    DoraArrangementSubcontractorResponse,
    DoraArrangementSubcontractorUpdate,
    DoraSignerCreate,
    DoraSignerResponse,
    DoraSignerUpdate,
    DoraSubcontractorCreate,
    DoraSubcontractorResponse,
    DoraSubcontractorUpdate,
    DoraVendorRoIPatch,
)

router = APIRouter(tags=["dora"])


# ── Codelists endpoint (no project scope) ─────────────────────────


@router.get("/api/dora/codelists")
async def get_codelists(
    user: Optional[User] = Depends(get_current_user),
):
    # `user is None` means "auth disabled" (AUTH_MODE=none serves every
    # route as admin) — an actual unauthenticated request already received
    # its 401 from the get_current_user dependency. Only reject when auth
    # is enabled, so AUTH_MODE=none answers 200 (AUTH-02a).
    if auth_enabled() and user is None:
        raise HTTPException(401, "Authentication required")
    return codelists()


async def _touch_project(db: AsyncSession, project: Project) -> None:
    project.updated_at = datetime.now(timezone.utc)


# ── RFE entities ──────────────────────────────────────────────────


@router.get(
    "/api/projects/{project_id}/dora/entities",
    response_model=list[DoraEntityResponse],
)
async def list_entities(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    res = await db.execute(
        select(DoraEntity)
        .where(DoraEntity.project_id == project_id)
        .order_by(DoraEntity.sort_order, DoraEntity.id)
    )
    return res.scalars().all()


@router.post(
    "/api/projects/{project_id}/dora/entities",
    response_model=DoraEntityResponse,
    status_code=201,
)
async def create_entity(
    project_id: uuid.UUID,
    body: DoraEntityCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    payload = body.model_dump()
    validate_dora_entity(payload)
    if await db.get(DoraEntity, (project_id, body.id)):
        raise HTTPException(409, "Entity id already exists")
    obj = DoraEntity(project_id=project_id, **payload)
    db.add(obj)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.patch(
    "/api/projects/{project_id}/dora/entities/{entity_id}",
    response_model=DoraEntityResponse,
)
async def update_entity(
    project_id: uuid.UUID,
    entity_id: str,
    body: DoraEntityUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    obj = await db.get(DoraEntity, (project_id, entity_id))
    if not obj:
        raise HTTPException(404, "Entity not found")
    patch = body.model_dump(exclude_unset=True)
    validate_dora_entity(patch)
    for k, v in patch.items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete(
    "/api/projects/{project_id}/dora/entities/{entity_id}",
    status_code=204,
)
async def delete_entity(
    project_id: uuid.UUID,
    entity_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")
    obj = await db.get(DoraEntity, (project_id, entity_id))
    if not obj:
        raise HTTPException(404, "Entity not found")
    await db.delete(obj)
    await _touch_project(db, project)
    await db.commit()


# ── Functions ────────────────────────────────────────────────────


@router.get(
    "/api/projects/{project_id}/dora/functions",
    response_model=list[DoraFunctionResponse],
)
async def list_functions(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    res = await db.execute(
        select(DoraFunction)
        .where(DoraFunction.project_id == project_id)
        .order_by(DoraFunction.sort_order, DoraFunction.id)
    )
    return res.scalars().all()


@router.post(
    "/api/projects/{project_id}/dora/functions",
    response_model=DoraFunctionResponse,
    status_code=201,
)
async def create_function(
    project_id: uuid.UUID,
    body: DoraFunctionCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    payload = body.model_dump()
    validate_dora_function(payload)
    if await db.get(DoraFunction, (project_id, body.id)):
        raise HTTPException(409, "Function id already exists")
    obj = DoraFunction(project_id=project_id, **payload)
    db.add(obj)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.patch(
    "/api/projects/{project_id}/dora/functions/{function_id}",
    response_model=DoraFunctionResponse,
)
async def update_function(
    project_id: uuid.UUID,
    function_id: str,
    body: DoraFunctionUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    obj = await db.get(DoraFunction, (project_id, function_id))
    if not obj:
        raise HTTPException(404, "Function not found")
    patch = body.model_dump(exclude_unset=True)
    validate_dora_function(patch)
    for k, v in patch.items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete(
    "/api/projects/{project_id}/dora/functions/{function_id}",
    status_code=204,
)
async def delete_function(
    project_id: uuid.UUID,
    function_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")
    obj = await db.get(DoraFunction, (project_id, function_id))
    if not obj:
        raise HTTPException(404, "Function not found")
    await db.delete(obj)
    await _touch_project(db, project)
    await db.commit()


# ── Branches ─────────────────────────────────────────────────────


@router.get(
    "/api/projects/{project_id}/dora/branches",
    response_model=list[DoraBranchResponse],
)
async def list_branches(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    res = await db.execute(
        select(DoraBranch)
        .where(DoraBranch.project_id == project_id)
        .order_by(DoraBranch.sort_order, DoraBranch.id)
    )
    return res.scalars().all()


@router.post(
    "/api/projects/{project_id}/dora/branches",
    response_model=DoraBranchResponse,
    status_code=201,
)
async def create_branch(
    project_id: uuid.UUID,
    body: DoraBranchCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    payload = body.model_dump()
    validate_dora_branch(payload)
    if not await db.get(DoraEntity, (project_id, body.rfe_id)):
        raise HTTPException(422, f"rfe_id '{body.rfe_id}' does not exist")
    if await db.get(DoraBranch, (project_id, body.id)):
        raise HTTPException(409, "Branch id already exists")
    obj = DoraBranch(project_id=project_id, **payload)
    db.add(obj)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.patch(
    "/api/projects/{project_id}/dora/branches/{branch_id}",
    response_model=DoraBranchResponse,
)
async def update_branch(
    project_id: uuid.UUID,
    branch_id: str,
    body: DoraBranchUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    obj = await db.get(DoraBranch, (project_id, branch_id))
    if not obj:
        raise HTTPException(404, "Branch not found")
    patch = body.model_dump(exclude_unset=True)
    validate_dora_branch(patch)
    for k, v in patch.items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete(
    "/api/projects/{project_id}/dora/branches/{branch_id}",
    status_code=204,
)
async def delete_branch(
    project_id: uuid.UUID,
    branch_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")
    obj = await db.get(DoraBranch, (project_id, branch_id))
    if not obj:
        raise HTTPException(404, "Branch not found")
    await db.delete(obj)
    await _touch_project(db, project)
    await db.commit()


# ── Consolidation scope ──────────────────────────────────────────


@router.get(
    "/api/projects/{project_id}/dora/consolidation",
    response_model=list[DoraConsolidationScopeResponse],
)
async def list_consolidation(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    res = await db.execute(
        select(DoraConsolidationScope)
        .where(DoraConsolidationScope.project_id == project_id)
        .order_by(DoraConsolidationScope.sort_order, DoraConsolidationScope.id)
    )
    return res.scalars().all()


@router.post(
    "/api/projects/{project_id}/dora/consolidation",
    response_model=DoraConsolidationScopeResponse,
    status_code=201,
)
async def create_consolidation(
    project_id: uuid.UUID,
    body: DoraConsolidationScopeCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    payload = body.model_dump()
    validate_dora_consolidation(payload)
    if await db.get(DoraConsolidationScope, (project_id, body.id)):
        raise HTTPException(409, "Consolidation entry id already exists")
    obj = DoraConsolidationScope(project_id=project_id, **payload)
    db.add(obj)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.patch(
    "/api/projects/{project_id}/dora/consolidation/{cs_id}",
    response_model=DoraConsolidationScopeResponse,
)
async def update_consolidation(
    project_id: uuid.UUID,
    cs_id: str,
    body: DoraConsolidationScopeUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    obj = await db.get(DoraConsolidationScope, (project_id, cs_id))
    if not obj:
        raise HTTPException(404, "Consolidation entry not found")
    patch = body.model_dump(exclude_unset=True)
    validate_dora_consolidation(patch)
    for k, v in patch.items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete(
    "/api/projects/{project_id}/dora/consolidation/{cs_id}",
    status_code=204,
)
async def delete_consolidation(
    project_id: uuid.UUID,
    cs_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")
    obj = await db.get(DoraConsolidationScope, (project_id, cs_id))
    if not obj:
        raise HTTPException(404, "Consolidation entry not found")
    await db.delete(obj)
    await _touch_project(db, project)
    await db.commit()


# ── Arrangements (with rfe_ids junction handling) ────────────────


async def _arrangement_to_response(
    db: AsyncSession,
    obj: DoraArrangement,
) -> dict:
    rfes_res = await db.execute(
        select(DoraArrangementRfe.rfe_id)
        .where(
            DoraArrangementRfe.project_id == obj.project_id,
            DoraArrangementRfe.arrangement_id == obj.id,
        )
    )
    rfe_ids = [r[0] for r in rfes_res.all()]
    fns_res = await db.execute(
        select(DoraArrangementFunction.function_id)
        .where(
            DoraArrangementFunction.project_id == obj.project_id,
            DoraArrangementFunction.arrangement_id == obj.id,
        )
    )
    function_ids = [r[0] for r in fns_res.all()]
    svcs_res = await db.execute(
        select(DoraArrangementService.service_code)
        .where(
            DoraArrangementService.project_id == obj.project_id,
            DoraArrangementService.arrangement_id == obj.id,
        )
        .order_by(DoraArrangementService.service_code)
    )
    service_codes = [r[0] for r in svcs_res.all()]
    sub_links_res = await db.execute(
        select(DoraArrangementSubcontractor)
        .where(
            DoraArrangementSubcontractor.project_id == obj.project_id,
            DoraArrangementSubcontractor.arrangement_id == obj.id,
        )
        .order_by(DoraArrangementSubcontractor.tier, DoraArrangementSubcontractor.sort_order)
    )
    subcontractor_links = [
        {
            "project_id": l.project_id,
            "arrangement_id": l.arrangement_id,
            "subcontractor_id": l.subcontractor_id,
            "sort_order": l.sort_order,
            "tier": l.tier,
            "service_provided": l.service_provided,
            "is_critical_function_support": l.is_critical_function_support,
            "parent_subcontractor_id": l.parent_subcontractor_id,
            "data_country": l.data_country,
            "created_at": l.created_at,
            "updated_at": l.updated_at,
        }
        for l in sub_links_res.scalars().all()
    ]
    return {
        "project_id": obj.project_id,
        "id": obj.id,
        "vendor_id": obj.vendor_id,
        "sort_order": obj.sort_order,
        "arrangement_reference": obj.arrangement_reference,
        "arrangement_type": obj.arrangement_type,
        "function_ids": function_ids,
        "is_critical_function_support": obj.is_critical_function_support,
        "start_date": obj.start_date,
        "end_date": obj.end_date,
        "notice_period_days": obj.notice_period_days,
        "governing_law_country": obj.governing_law_country,
        "jurisdiction_country": obj.jurisdiction_country,
        "annual_cost_amount": obj.annual_cost_amount,
        "currency": obj.currency,
        "nature_of_service": obj.nature_of_service,
        "data_sensitivity": obj.data_sensitivity,
        "data_storage_country": obj.data_storage_country,
        "data_processing_country": obj.data_processing_country,
        "substitutability_level": obj.substitutability_level,
        "substitutability_reason": obj.substitutability_reason,
        "reintegration_level": obj.reintegration_level,
        "is_substitutable": obj.is_substitutable,
        "exit_strategy_documented": obj.exit_strategy_documented,
        "reintegration_possible": obj.reintegration_possible,
        "last_audit_date": obj.last_audit_date,
        # Migration 011 — EBA RoI completeness
        "reliance_level": obj.reliance_level,
        "impact_discontinuing_level": obj.impact_discontinuing_level,
        "alternative_tpp_id": obj.alternative_tpp_id,
        "notice_period_tpsp_days": obj.notice_period_tpsp_days,
        "termination_reason": obj.termination_reason,
        "parent_arrangement_id": obj.parent_arrangement_id,
        "rfe_ids": rfe_ids,
        "service_codes": service_codes,
        "subcontractor_links": subcontractor_links,
        "created_at": obj.created_at,
        "updated_at": obj.updated_at,
    }


@router.get(
    "/api/projects/{project_id}/dora/arrangements",
    response_model=list[DoraArrangementResponse],
)
async def list_arrangements(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    res = await db.execute(
        select(DoraArrangement)
        .where(DoraArrangement.project_id == project_id)
        .order_by(DoraArrangement.sort_order, DoraArrangement.id)
    )
    out = []
    for obj in res.scalars().all():
        out.append(await _arrangement_to_response(db, obj))
    return out


@router.post(
    "/api/projects/{project_id}/dora/arrangements",
    response_model=DoraArrangementResponse,
    status_code=201,
)
async def create_arrangement(
    project_id: uuid.UUID,
    body: DoraArrangementCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    payload = body.model_dump()
    rfe_ids = payload.pop("rfe_ids", []) or []
    function_ids = payload.pop("function_ids", []) or []
    service_codes = payload.pop("service_codes", []) or []
    # FK pre-checks
    if not await db.get(Vendor, (project_id, body.vendor_id)):
        raise HTTPException(422, f"vendor_id '{body.vendor_id}' does not exist")
    any_critical = False
    for fid in function_ids:
        fn = await db.get(DoraFunction, (project_id, fid))
        if not fn:
            raise HTTPException(422, f"function_id '{fid}' does not exist")
        if fn.is_critical_or_important:
            any_critical = True
    func_critical: Optional[bool] = any_critical if function_ids else None
    validate_dora_arrangement(payload, function_is_critical=func_critical)
    # Server-derive flags (not trusted from client):
    # - is_critical_function_support = OR(linked function is critical)
    # - is_substitutable = (substitutability_level == 'easy')
    # - reintegration_possible = (reintegration_level == 'easy')
    payload["is_critical_function_support"] = bool(any_critical) if function_ids else False
    payload["is_substitutable"] = (payload.get("substitutability_level") == "easy")
    payload["reintegration_possible"] = (payload.get("reintegration_level") == "easy")
    if await db.get(DoraArrangement, (project_id, body.id)):
        raise HTTPException(409, "Arrangement id already exists")
    # arrangement_reference uniqueness — DB enforces, but pre-check for clean error
    ref_res = await db.execute(
        select(DoraArrangement.id)
        .where(
            DoraArrangement.project_id == project_id,
            DoraArrangement.arrangement_reference == body.arrangement_reference,
        )
    )
    if ref_res.first():
        raise HTTPException(409, f"arrangement_reference '{body.arrangement_reference}' already exists in project")
    obj = DoraArrangement(project_id=project_id, **payload)
    db.add(obj)
    # Junction rows
    for rid in rfe_ids:
        if not await db.get(DoraEntity, (project_id, rid)):
            raise HTTPException(422, f"rfe_id '{rid}' does not exist")
        db.add(DoraArrangementRfe(project_id=project_id, arrangement_id=body.id, rfe_id=rid))
    for fid in set(function_ids):
        db.add(DoraArrangementFunction(project_id=project_id, arrangement_id=body.id, function_id=fid))
    for code in set(service_codes):
        if code:
            db.add(DoraArrangementService(project_id=project_id, arrangement_id=body.id, service_code=code))
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return await _arrangement_to_response(db, obj)


@router.patch(
    "/api/projects/{project_id}/dora/arrangements/{arrangement_id}",
    response_model=DoraArrangementResponse,
)
async def update_arrangement(
    project_id: uuid.UUID,
    arrangement_id: str,
    body: DoraArrangementUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    obj = await db.get(DoraArrangement, (project_id, arrangement_id))
    if not obj:
        raise HTTPException(404, "Arrangement not found")
    patch = body.model_dump(exclude_unset=True)
    new_function_ids = patch.pop("function_ids", None)
    new_service_codes = patch.pop("service_codes", None)
    # Determine the target function set for R12 (critical-fn support) check.
    if new_function_ids is None:
        cur = await db.execute(
            select(DoraArrangementFunction.function_id)
            .where(
                DoraArrangementFunction.project_id == project_id,
                DoraArrangementFunction.arrangement_id == arrangement_id,
            )
        )
        target_function_ids = [r[0] for r in cur.all()]
    else:
        target_function_ids = list(new_function_ids)
    any_critical = False
    for fid in target_function_ids:
        fn = await db.get(DoraFunction, (project_id, fid))
        if not fn:
            raise HTTPException(422, f"function_id '{fid}' does not exist")
        if fn.is_critical_or_important:
            any_critical = True
    func_critical: Optional[bool] = any_critical if target_function_ids else None
    validate_dora_arrangement(patch, function_is_critical=func_critical)
    # Server-derive flags (not trusted from client). Mirror create_arrangement.
    if new_function_ids is not None:
        patch["is_critical_function_support"] = bool(any_critical) if target_function_ids else False
    elif any(k in patch for k in ("substitutability_level", "reintegration_level")):
        # Function set unchanged — recompute from current DB state if any
        # function-related fact may have shifted. (No-op here: function set
        # is unchanged so any_critical reflects DB.)
        patch["is_critical_function_support"] = bool(any_critical) if target_function_ids else False
    if "substitutability_level" in patch:
        patch["is_substitutable"] = (patch.get("substitutability_level") == "easy")
    if "reintegration_level" in patch:
        patch["reintegration_possible"] = (patch.get("reintegration_level") == "easy")
    if "arrangement_reference" in patch and patch["arrangement_reference"] != obj.arrangement_reference:
        ref_res = await db.execute(
            select(DoraArrangement.id)
            .where(
                DoraArrangement.project_id == project_id,
                DoraArrangement.arrangement_reference == patch["arrangement_reference"],
                DoraArrangement.id != arrangement_id,
            )
        )
        if ref_res.first():
            raise HTTPException(409, f"arrangement_reference '{patch['arrangement_reference']}' already exists")
    for k, v in patch.items():
        setattr(obj, k, v)
    # Replace function_ids junction if explicitly provided in the patch.
    if new_function_ids is not None:
        await db.execute(
            delete(DoraArrangementFunction).where(
                DoraArrangementFunction.project_id == project_id,
                DoraArrangementFunction.arrangement_id == arrangement_id,
            )
        )
        for fid in set(new_function_ids):
            db.add(DoraArrangementFunction(
                project_id=project_id, arrangement_id=arrangement_id, function_id=fid,
            ))
    # Replace service_codes junction if explicitly provided.
    if new_service_codes is not None:
        await db.execute(
            delete(DoraArrangementService).where(
                DoraArrangementService.project_id == project_id,
                DoraArrangementService.arrangement_id == arrangement_id,
            )
        )
        for code in set(new_service_codes):
            if code:
                db.add(DoraArrangementService(
                    project_id=project_id, arrangement_id=arrangement_id, service_code=code,
                ))
    obj.updated_at = datetime.now(timezone.utc)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return await _arrangement_to_response(db, obj)


@router.delete(
    "/api/projects/{project_id}/dora/arrangements/{arrangement_id}",
    status_code=204,
)
async def delete_arrangement(
    project_id: uuid.UUID,
    arrangement_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")
    obj = await db.get(DoraArrangement, (project_id, arrangement_id))
    if not obj:
        raise HTTPException(404, "Arrangement not found")
    await db.delete(obj)
    await _touch_project(db, project)
    await db.commit()


# ── RFE ↔ Arrangement junction ──────────────────────────────────


@router.post(
    "/api/projects/{project_id}/dora/arrangements/{arrangement_id}/rfes",
    status_code=201,
)
async def link_arrangement_rfe(
    project_id: uuid.UUID,
    arrangement_id: str,
    body: DoraArrangementRfeLink,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    if not await db.get(DoraArrangement, (project_id, arrangement_id)):
        raise HTTPException(404, "Arrangement not found")
    if not await db.get(DoraEntity, (project_id, body.rfe_id)):
        raise HTTPException(422, f"rfe_id '{body.rfe_id}' does not exist")
    if await db.get(DoraArrangementRfe, (project_id, arrangement_id, body.rfe_id)):
        raise HTTPException(409, "RFE already linked to arrangement")
    db.add(DoraArrangementRfe(project_id=project_id, arrangement_id=arrangement_id, rfe_id=body.rfe_id))
    await _touch_project(db, project)
    await db.commit()
    return {"status": "linked", "arrangement_id": arrangement_id, "rfe_id": body.rfe_id}


@router.delete(
    "/api/projects/{project_id}/dora/arrangements/{arrangement_id}/rfes/{rfe_id}",
    status_code=204,
)
async def unlink_arrangement_rfe(
    project_id: uuid.UUID,
    arrangement_id: str,
    rfe_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")
    obj = await db.get(DoraArrangementRfe, (project_id, arrangement_id, rfe_id))
    if not obj:
        raise HTTPException(404, "Link not found")
    await db.delete(obj)
    await _touch_project(db, project)
    await db.commit()


# ── Signers ──────────────────────────────────────────────────────


@router.post(
    "/api/projects/{project_id}/dora/arrangements/{arrangement_id}/signers",
    response_model=DoraSignerResponse,
    status_code=201,
)
async def create_signer(
    project_id: uuid.UUID,
    arrangement_id: str,
    body: DoraSignerCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    if not await db.get(DoraArrangement, (project_id, arrangement_id)):
        raise HTTPException(404, "Arrangement not found")
    payload = body.model_dump()
    validate_dora_signer(payload)
    if await db.get(DoraSigner, (project_id, arrangement_id, body.id)):
        raise HTTPException(409, "Signer id already exists")
    obj = DoraSigner(project_id=project_id, arrangement_id=arrangement_id, **payload)
    db.add(obj)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.patch(
    "/api/projects/{project_id}/dora/arrangements/{arrangement_id}/signers/{signer_id}",
    response_model=DoraSignerResponse,
)
async def update_signer(
    project_id: uuid.UUID,
    arrangement_id: str,
    signer_id: str,
    body: DoraSignerUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    obj = await db.get(DoraSigner, (project_id, arrangement_id, signer_id))
    if not obj:
        raise HTTPException(404, "Signer not found")
    patch = body.model_dump(exclude_unset=True)
    validate_dora_signer(patch)
    for k, v in patch.items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete(
    "/api/projects/{project_id}/dora/arrangements/{arrangement_id}/signers/{signer_id}",
    status_code=204,
)
async def delete_signer(
    project_id: uuid.UUID,
    arrangement_id: str,
    signer_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")
    obj = await db.get(DoraSigner, (project_id, arrangement_id, signer_id))
    if not obj:
        raise HTTPException(404, "Signer not found")
    await db.delete(obj)
    await _touch_project(db, project)
    await db.commit()


# ── Subcontractors (global identity) ─────────────────────────────


@router.get(
    "/api/projects/{project_id}/dora/subcontractors",
    response_model=list[DoraSubcontractorResponse],
)
async def list_subcontractors(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    res = await db.execute(
        select(DoraSubcontractor)
        .where(DoraSubcontractor.project_id == project_id)
        .order_by(DoraSubcontractor.sort_order, DoraSubcontractor.id)
    )
    return res.scalars().all()


@router.post(
    "/api/projects/{project_id}/dora/subcontractors",
    response_model=DoraSubcontractorResponse,
    status_code=201,
)
async def create_subcontractor(
    project_id: uuid.UUID,
    body: DoraSubcontractorCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    payload = body.model_dump()
    validate_dora_subcontractor(payload)
    if await db.get(DoraSubcontractor, (project_id, body.id)):
        raise HTTPException(409, "Subcontractor id already exists")
    obj = DoraSubcontractor(project_id=project_id, **payload)
    db.add(obj)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.patch(
    "/api/projects/{project_id}/dora/subcontractors/{sub_id}",
    response_model=DoraSubcontractorResponse,
)
async def update_subcontractor(
    project_id: uuid.UUID,
    sub_id: str,
    body: DoraSubcontractorUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    obj = await db.get(DoraSubcontractor, (project_id, sub_id))
    if not obj:
        raise HTTPException(404, "Subcontractor not found")
    patch = body.model_dump(exclude_unset=True)
    validate_dora_subcontractor(patch)
    for k, v in patch.items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete(
    "/api/projects/{project_id}/dora/subcontractors/{sub_id}",
    status_code=204,
)
async def delete_subcontractor(
    project_id: uuid.UUID,
    sub_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")
    obj = await db.get(DoraSubcontractor, (project_id, sub_id))
    if not obj:
        raise HTTPException(404, "Subcontractor not found")
    # Cascading deletes drop all junction rows referencing this sub.
    await db.delete(obj)
    await _touch_project(db, project)
    await db.commit()


# ── Subcontractor links to an arrangement (junction CRUD) ────────


async def _validate_link_chain(
    db: AsyncSession,
    project_id: uuid.UUID,
    arrangement_id: str,
    sub_id: str,
    new_parent: str | None,
) -> None:
    """R7 (depth ≤ MAX_DEPTH) and R15 (no cycle / no self-ref) on the
    parent chain inside one arrangement."""
    if new_parent and new_parent == sub_id:
        raise HTTPException(422, "parent_subcontractor_id cannot equal subcontractor_id")
    if new_parent:
        if not await db.get(DoraArrangementSubcontractor, (project_id, arrangement_id, new_parent)):
            raise HTTPException(
                422,
                f"parent_subcontractor_id '{new_parent}' is not linked to this arrangement",
            )
    res = await db.execute(
        select(
            DoraArrangementSubcontractor.subcontractor_id,
            DoraArrangementSubcontractor.parent_subcontractor_id,
        ).where(
            DoraArrangementSubcontractor.project_id == project_id,
            DoraArrangementSubcontractor.arrangement_id == arrangement_id,
        )
    )
    edges = {r[0]: r[1] for r in res.all()}
    edges[sub_id] = new_parent
    validate_parent_chain(edges, sub_id, field="subcontractor parent")


@router.post(
    "/api/projects/{project_id}/dora/arrangements/{arrangement_id}/subcontractors",
    response_model=DoraArrangementSubcontractorResponse,
    status_code=201,
)
async def link_subcontractor(
    project_id: uuid.UUID,
    arrangement_id: str,
    body: DoraArrangementSubcontractorCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    arr = await db.get(DoraArrangement, (project_id, arrangement_id))
    if not arr:
        raise HTTPException(404, "Arrangement not found")
    if not await db.get(DoraSubcontractor, (project_id, body.subcontractor_id)):
        raise HTTPException(422, f"subcontractor_id '{body.subcontractor_id}' does not exist")
    payload = body.model_dump()
    validate_dora_arrangement_subcontractor(payload, self_subcontractor_id=body.subcontractor_id)
    if await db.get(
        DoraArrangementSubcontractor,
        (project_id, arrangement_id, body.subcontractor_id),
    ):
        raise HTTPException(409, "Subcontractor already linked to this arrangement")
    await _validate_link_chain(
        db, project_id, arrangement_id, body.subcontractor_id, body.parent_subcontractor_id,
    )
    # Server-derive: a subcontractor supports a critical function iff its parent
    # arrangement does. Never trusted from client (mass-assignment guard).
    payload["is_critical_function_support"] = bool(arr.is_critical_function_support)
    obj = DoraArrangementSubcontractor(
        project_id=project_id, arrangement_id=arrangement_id, **payload,
    )
    db.add(obj)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.patch(
    "/api/projects/{project_id}/dora/arrangements/{arrangement_id}/subcontractors/{sub_id}",
    response_model=DoraArrangementSubcontractorResponse,
)
async def update_subcontractor_link(
    project_id: uuid.UUID,
    arrangement_id: str,
    sub_id: str,
    body: DoraArrangementSubcontractorUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    obj = await db.get(DoraArrangementSubcontractor, (project_id, arrangement_id, sub_id))
    if not obj:
        raise HTTPException(404, "Subcontractor link not found")
    patch = body.model_dump(exclude_unset=True)
    validate_dora_arrangement_subcontractor(patch, self_subcontractor_id=sub_id)
    new_parent = patch.get("parent_subcontractor_id", obj.parent_subcontractor_id)
    if new_parent != obj.parent_subcontractor_id:
        await _validate_link_chain(db, project_id, arrangement_id, sub_id, new_parent)
    for k, v in patch.items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete(
    "/api/projects/{project_id}/dora/arrangements/{arrangement_id}/subcontractors/{sub_id}",
    status_code=204,
)
async def unlink_subcontractor(
    project_id: uuid.UUID,
    arrangement_id: str,
    sub_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")
    obj = await db.get(DoraArrangementSubcontractor, (project_id, arrangement_id, sub_id))
    if not obj:
        raise HTTPException(404, "Subcontractor link not found")
    await db.delete(obj)
    await _touch_project(db, project)
    await db.commit()


# ── Vendor-level RoI fields ──────────────────────────────────────


@router.patch(
    "/api/projects/{project_id}/vendors/{vendor_id}/roi",
    status_code=200,
)
async def patch_vendor_roi(
    project_id: uuid.UUID,
    vendor_id: str,
    body: DoraVendorRoIPatch,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    vendor = await db.get(Vendor, (project_id, vendor_id))
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    patch = body.model_dump(exclude_unset=True)
    validate_vendor_roi(patch)
    for k, v in patch.items():
        setattr(vendor, k, v)
    vendor.updated_at = datetime.now(timezone.utc)
    await _touch_project(db, project)
    await db.commit()
    await db.refresh(vendor)
    return {
        "id": vendor.id,
        "lei": vendor.lei,
        "legal_name_latin": vendor.legal_name_latin,
        "person_type": vendor.person_type,
        "entity_nature": vendor.entity_nature,
        "additional_id_type": vendor.additional_id_type,
        "additional_id_value": vendor.additional_id_value,
        "additional_id_issuer": vendor.additional_id_issuer,
        "ultimate_parent_id": vendor.ultimate_parent_id,
        "country_iso2": vendor.country_iso2,
    }


# ── Whole-tree read & XLSX export ────────────────────────────────


@router.get("/api/projects/{project_id}/dora")
async def read_dora_tree(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Single round-trip read of the full DORA tree for the project."""
    await get_project_or_404(project_id, user, db)
    entities = (await db.execute(
        select(DoraEntity).where(DoraEntity.project_id == project_id).order_by(DoraEntity.sort_order)
    )).scalars().all()
    functions = (await db.execute(
        select(DoraFunction).where(DoraFunction.project_id == project_id).order_by(DoraFunction.sort_order)
    )).scalars().all()
    branches = (await db.execute(
        select(DoraBranch).where(DoraBranch.project_id == project_id).order_by(DoraBranch.sort_order)
    )).scalars().all()
    consolidation = (await db.execute(
        select(DoraConsolidationScope).where(DoraConsolidationScope.project_id == project_id).order_by(DoraConsolidationScope.sort_order)
    )).scalars().all()
    arrangements = (await db.execute(
        select(DoraArrangement).where(DoraArrangement.project_id == project_id).order_by(DoraArrangement.sort_order)
    )).scalars().all()
    arr_responses = []
    for a in arrangements:
        arr_responses.append(await _arrangement_to_response(db, a))
    signers = (await db.execute(
        select(DoraSigner).where(DoraSigner.project_id == project_id).order_by(DoraSigner.sort_order)
    )).scalars().all()
    subcontractors = (await db.execute(
        select(DoraSubcontractor).where(DoraSubcontractor.project_id == project_id).order_by(DoraSubcontractor.sort_order)
    )).scalars().all()
    subcontractor_links = (await db.execute(
        select(DoraArrangementSubcontractor)
        .where(DoraArrangementSubcontractor.project_id == project_id)
        .order_by(
            DoraArrangementSubcontractor.arrangement_id,
            DoraArrangementSubcontractor.tier,
            DoraArrangementSubcontractor.sort_order,
        )
    )).scalars().all()

    def _row(o, fields):
        return {f: getattr(o, f, None) for f in fields}

    return {
        "entities": [_row(e, [c.name for c in DoraEntity.__table__.columns]) for e in entities],
        "functions": [_row(f, [c.name for c in DoraFunction.__table__.columns]) for f in functions],
        "branches": [_row(b, [c.name for c in DoraBranch.__table__.columns]) for b in branches],
        "consolidation": [_row(c, [col.name for col in DoraConsolidationScope.__table__.columns]) for c in consolidation],
        "arrangements": arr_responses,
        "signers": [_row(s, [c.name for c in DoraSigner.__table__.columns]) for s in signers],
        "subcontractors": [_row(s, [c.name for c in DoraSubcontractor.__table__.columns]) for s in subcontractors],
        "subcontractor_links": [
            _row(l, [c.name for c in DoraArrangementSubcontractor.__table__.columns])
            for l in subcontractor_links
        ],
    }


def _roi_try(errors: list, kind: str, rid: str, label: str, fn, *args, **kwargs) -> None:
    try:
        fn(*args, **kwargs)
    except HTTPException as e:
        errors.append({"kind": kind, "id": rid, "label": label, "message": str(e.detail)})


def _roi_payload(row) -> dict:
    """ORM row → validator payload. Empty/None values are dropped so the
    per-field validators only check what is actually set (PATCH semantics);
    completeness of export-critical fields is asserted separately."""
    return {c.name: getattr(row, c.name) for c in row.__table__.columns
            if getattr(row, c.name) not in (None, "")}


@router.get("/api/projects/{project_id}/dora/validate")
async def validate_dora_register(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """FEAT-17 — pre-export validation of the whole RoI register.

    Reuses the R1..R17 write-validators (dora_validation) in COLLECT mode:
    every record is checked and ALL failing records are returned (one message
    per record — the validators stop at a record's first error), plus the
    completeness of export-critical fields (entity country/type + reporting
    period, arrangement reference). The register itself is never mutated."""
    await get_project_or_404(project_id, user, db)
    errors: list[dict] = []

    entities = (await db.execute(select(DoraEntity).where(
        DoraEntity.project_id == project_id))).scalars().all()
    if not entities:
        errors.append({"kind": "entity", "id": "", "label": "",
                       "message": "Aucune entité déclarante (B_01.02) — le registre EBA doit en contenir au moins une."})
    for r in entities:
        label = getattr(r, "name", "") or r.id
        _roi_try(errors, "entity", str(r.id), label, validate_dora_entity, _roi_payload(r))
        if not (r.country_iso2 or ""):
            errors.append({"kind": "entity", "id": str(r.id), "label": label,
                           "message": "country_iso2 requis (B_01.02)"})
        if not (getattr(r, "entity_type", "") or ""):
            errors.append({"kind": "entity", "id": str(r.id), "label": label,
                           "message": "entity_type requis (B_01.02)"})
        if not (getattr(r, "reporting_period", "") or ""):
            errors.append({"kind": "entity", "id": str(r.id), "label": label,
                           "message": "reporting_period requis (renseigné au moment de l'export)"})

    for model, kind, validator in (
        (DoraFunction, "function", validate_dora_function),
        (DoraBranch, "branch", validate_dora_branch),
        (DoraConsolidationScope, "consolidation", validate_dora_consolidation),
    ):
        rows = (await db.execute(select(model).where(model.project_id == project_id))).scalars().all()
        for r in rows:
            label = getattr(r, "name", "") or getattr(r, "label", "") or str(r.id)
            _roi_try(errors, kind, str(r.id), label, validator, _roi_payload(r))

    arrangements = (await db.execute(select(DoraArrangement).where(
        DoraArrangement.project_id == project_id))).scalars().all()
    for r in arrangements:
        label = getattr(r, "arrangement_reference", "") or str(r.id)
        _roi_try(errors, "arrangement", str(r.id), label, validate_dora_arrangement, _roi_payload(r))
        if not (getattr(r, "arrangement_reference", "") or ""):
            errors.append({"kind": "arrangement", "id": str(r.id), "label": label,
                           "message": "arrangement_reference requis (B_02.01)"})

    subs = (await db.execute(select(DoraArrangementSubcontractor).where(
        DoraArrangementSubcontractor.project_id == project_id))).scalars().all()
    for r in subs:
        label = getattr(r, "name", "") or str(r.id)
        _roi_try(errors, "subcontractor", str(r.id), label, validate_dora_subcontractor, _roi_payload(r))

    vendors = (await db.execute(select(Vendor).where(Vendor.project_id == project_id))).scalars().all()
    for v in vendors:
        payload = {k: getattr(v, k) for k in ("lei", "country_iso2", "person_type")
                   if hasattr(v, k) and getattr(v, k) not in (None, "")}
        # R17 (EEA legal person needs a LEI) only fires with both keys present.
        if hasattr(v, "person_type") and hasattr(v, "country_iso2"):
            payload.setdefault("person_type", getattr(v, "person_type") or "")
            payload.setdefault("country_iso2", getattr(v, "country_iso2") or "")
        _roi_try(errors, "vendor", str(v.id), v.name or str(v.id), validate_vendor_roi, payload)

    return {"ok": not errors, "errors": errors,
            "checked": {"entities": len(entities), "arrangements": len(arrangements),
                        "subcontractors": len(subs), "vendors": len(vendors)}}


@router.get("/api/projects/{project_id}/dora/export.xlsx")
async def export_dora_xlsx(
    project_id: uuid.UUID,
    target_currency: str = "EUR",
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate the consolidated EBA-format XLSX for the whole project."""
    project = await get_project_or_404(project_id, user, db)
    from src.dora_export import build_dora_xlsx, _FX_TO_EUR
    target_currency = (target_currency or "EUR").upper()
    if target_currency not in _FX_TO_EUR:
        raise HTTPException(400, f"Unsupported target_currency: {target_currency}")
    blob = await build_dora_xlsx(db, project_id, project, target_currency=target_currency)
    # Sanitize project name to prevent Content-Disposition / CRLF injection.
    safe_name = re.sub(r"[^A-Za-z0-9_.\-]", "_", project.name or "project")[:80] or "project"
    filename = f"dora_roi_{safe_name}.xlsx"
    return Response(
        content=blob,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
