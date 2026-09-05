from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import get_current_user
from src.database import get_db
from src.routes.auth_helpers import get_project_or_404
from src.models import Project, User, Vendor, VendorMeasure
from src.schemas import VendorMeasureCreate, VendorMeasureResponse, VendorMeasureUpdate

router = APIRouter(prefix="/api/projects/{project_id}", tags=["vendor-measures"])



@router.get("/vendors/{vendor_id}/measures", response_model=list[VendorMeasureResponse])
async def list_measures(
    project_id: uuid.UUID,
    vendor_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    result = await db.execute(
        select(VendorMeasure)
        .where(VendorMeasure.project_id == project_id, VendorMeasure.vendor_id == vendor_id)
        .order_by(VendorMeasure.sort_order)
    )
    return result.scalars().all()


@router.post("/vendors/{vendor_id}/measures", response_model=VendorMeasureResponse, status_code=201)
async def create_measure(
    project_id: uuid.UUID,
    vendor_id: str,
    body: VendorMeasureCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")

    vendor = await db.get(Vendor, (project_id, vendor_id))
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    existing = await db.get(VendorMeasure, (project_id, vendor_id, body.id))
    if existing:
        raise HTTPException(status_code=409, detail="Measure ID already exists")

    if body.sort_order == 0:
        max_order = await db.execute(
            select(func.coalesce(func.max(VendorMeasure.sort_order), 0))
            .where(VendorMeasure.project_id == project_id, VendorMeasure.vendor_id == vendor_id)
        )
        body.sort_order = max_order.scalar() + 1

    measure = VendorMeasure(
        project_id=project_id,
        vendor_id=vendor_id,
        **body.model_dump(exclude={"vendor_id"}),
    )
    db.add(measure)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(measure)
    return measure


@router.patch("/measures/{measure_id}", response_model=VendorMeasureResponse)
async def update_measure(
    project_id: uuid.UUID,
    measure_id: str,
    body: VendorMeasureUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")

    result = await db.execute(
        select(VendorMeasure)
        .where(VendorMeasure.project_id == project_id, VendorMeasure.id == measure_id)
    )
    measure = result.scalar_one_or_none()
    if not measure:
        raise HTTPException(status_code=404, detail="Measure not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(measure, field, value)

    measure.updated_at = datetime.now(timezone.utc)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(measure)
    import asyncio
    from src.pilot_notify import notify_pilot_measure, notify_pilot_measure_deleted
    from src.routes.internal import VENDOR_IN_SCOPE, _normalize_status
    from src.models import ProjectMetadata
    v_row = await db.execute(
        select(Vendor.name, Project.name.label("project_name"), ProjectMetadata.organization,
               Vendor.status)
        .join(Project, Vendor.project_id == Project.id)
        .outerjoin(ProjectMetadata, Vendor.project_id == ProjectMetadata.project_id)
        .where(Vendor.project_id == project_id, Vendor.id == measure.vendor_id)
    )
    vrow = v_row.first()
    # The push channel must hold the SAME scope as /internal/measures: a
    # PATCH on a measure of an out-of-scope vendor (prospect, former) used to
    # upsert the row into the Pilot cache — offboarding itself re-pushed every
    # measure it was abandoning. Out of scope, we remove.
    if vrow and (vrow[3] or "") not in VENDOR_IN_SCOPE:
        asyncio.ensure_future(notify_pilot_measure_deleted(measure_id))
        return measure
    vendor_name = vrow[0] if vrow else ""
    project_name_ = vrow[1] if vrow else ""
    organization = vrow[2] if vrow else ""
    entity_name = (organization or project_name_ or "") + " / " + (vendor_name or "")
    asyncio.ensure_future(notify_pilot_measure({
        "source_id": measure_id,
        "entity_id": str(project_id),
        "entity_name": entity_name,
        "vendor_id": measure.vendor_id or "",
        "vendor_name": vendor_name or "",
        "title": measure.mesure if hasattr(measure, "mesure") else "",
        "description": measure.details or "",
        "status": _normalize_status(measure.statut or ""),
        "assignee": measure.responsable or "",
        "due_date": measure.echeance or "",
    }))
    return measure


@router.delete("/measures/{measure_id}", status_code=204)
async def delete_measure(
    project_id: uuid.UUID,
    measure_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")

    result = await db.execute(
        select(VendorMeasure)
        .where(VendorMeasure.project_id == project_id, VendorMeasure.id == measure_id)
    )
    measure = result.scalar_one_or_none()
    if not measure:
        raise HTTPException(status_code=404, detail="Measure not found")

    await db.delete(measure)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
