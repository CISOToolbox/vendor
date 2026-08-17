from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.auth import get_current_user
from src.database import get_db
from src.routes.auth_helpers import get_project_or_404
from src.models import User, Vendor
from src.schemas import VendorCreate, VendorResponse, VendorUpdate

router = APIRouter(prefix="/api/projects/{project_id}", tags=["vendors"])



@router.get("/vendors", response_model=list[VendorResponse])
async def list_vendors(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    result = await db.execute(
        select(Vendor)
        .where(Vendor.project_id == project_id)
        .order_by(Vendor.sort_order)
    )
    return result.scalars().all()


@router.post("/vendors", response_model=VendorResponse, status_code=201)
async def create_vendor(
    project_id: uuid.UUID,
    body: VendorCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")

    existing = await db.get(Vendor, (project_id, body.id))
    if existing:
        raise HTTPException(status_code=409, detail="Vendor ID already exists")

    if body.sort_order == 0:
        max_order = await db.execute(
            select(func.coalesce(func.max(Vendor.sort_order), 0))
            .where(Vendor.project_id == project_id)
        )
        body.sort_order = max_order.scalar() + 1

    vendor = Vendor(project_id=project_id, **body.model_dump())
    db.add(vendor)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(vendor)
    return vendor


@router.get("/vendors/{vendor_id}", response_model=VendorResponse)
async def get_vendor(
    project_id: uuid.UUID,
    vendor_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    result = await db.execute(
        select(Vendor)
        .where(Vendor.project_id == project_id, Vendor.id == vendor_id)
        .options(selectinload(Vendor.measures))
    )
    vendor = result.scalar_one_or_none()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor


@router.patch("/vendors/{vendor_id}", response_model=VendorResponse)
async def update_vendor(
    project_id: uuid.UUID,
    vendor_id: str,
    body: VendorUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")
    vendor = await db.get(Vendor, (project_id, vendor_id))
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        if isinstance(value, dict):
            setattr(vendor, field, value)
        else:
            setattr(vendor, field, value)

    vendor.updated_at = datetime.now(timezone.utc)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(vendor)
    return vendor


@router.delete("/vendors/{vendor_id}", status_code=204)
async def delete_vendor(
    project_id: uuid.UUID,
    vendor_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")
    vendor = await db.get(Vendor, (project_id, vendor_id))
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    await db.delete(vendor)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
