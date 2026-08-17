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
from src.models import User, VendorRisk
from src.schemas import VendorRiskCreate, VendorRiskResponse, VendorRiskUpdate

router = APIRouter(prefix="/api/projects/{project_id}", tags=["vendor-risks"])



@router.get("/risks", response_model=list[VendorRiskResponse])
async def list_risks(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    result = await db.execute(
        select(VendorRisk)
        .where(VendorRisk.project_id == project_id)
        .order_by(VendorRisk.sort_order)
    )
    return result.scalars().all()


@router.post("/risks", response_model=VendorRiskResponse, status_code=201)
async def create_risk(
    project_id: uuid.UUID,
    body: VendorRiskCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")

    existing = await db.get(VendorRisk, (project_id, body.id))
    if existing:
        raise HTTPException(status_code=409, detail="Risk ID already exists")

    if body.sort_order == 0:
        max_order = await db.execute(
            select(func.coalesce(func.max(VendorRisk.sort_order), 0))
            .where(VendorRisk.project_id == project_id)
        )
        body.sort_order = max_order.scalar() + 1

    risk = VendorRisk(project_id=project_id, **body.model_dump())
    db.add(risk)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(risk)
    return risk


@router.patch("/risks/{risk_id}", response_model=VendorRiskResponse)
async def update_risk(
    project_id: uuid.UUID,
    risk_id: str,
    body: VendorRiskUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")

    risk = await db.get(VendorRisk, (project_id, risk_id))
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(risk, field, value)

    risk.updated_at = datetime.now(timezone.utc)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(risk)
    return risk


@router.delete("/risks/{risk_id}", status_code=204)
async def delete_risk(
    project_id: uuid.UUID,
    risk_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")

    risk = await db.get(VendorRisk, (project_id, risk_id))
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")

    await db.delete(risk)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
