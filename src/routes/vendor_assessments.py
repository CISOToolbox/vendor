from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.assessment_validation import validate_on_create, validate_on_update
from src.auth import get_current_user
from src.database import get_db
from src.routes.auth_helpers import get_project_or_404
from src.models import User, VendorAssessment
from src.schemas import VendorAssessmentCreate, VendorAssessmentResponse, VendorAssessmentUpdate

router = APIRouter(prefix="/api/projects/{project_id}", tags=["vendor-assessments"])



@router.get("/assessments", response_model=list[VendorAssessmentResponse])
async def list_assessments(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    result = await db.execute(
        select(VendorAssessment)
        .where(VendorAssessment.project_id == project_id)
        .order_by(VendorAssessment.sort_order)
    )
    return result.scalars().all()


@router.post("/assessments", response_model=VendorAssessmentResponse, status_code=201)
async def create_assessment(
    project_id: uuid.UUID,
    body: VendorAssessmentCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")

    existing = await db.get(VendorAssessment, (project_id, body.id))
    if existing:
        raise HTTPException(status_code=409, detail="Assessment ID already exists")

    if body.sort_order == 0:
        max_order = await db.execute(
            select(func.coalesce(func.max(VendorAssessment.sort_order), 0))
            .where(VendorAssessment.project_id == project_id)
        )
        body.sort_order = max_order.scalar() + 1

    # Run server-side validation (see src/assessment_validation.py):
    # enforces response shape, recomputes score / completion_rate,
    # strips reviewer-only fields, and blocks creation with a
    # "validated" / "pending_approval" status.
    sanitized = validate_on_create(body.model_dump())
    sanitized["sort_order"] = body.sort_order
    assessment = VendorAssessment(project_id=project_id, **sanitized)
    db.add(assessment)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(assessment)
    return assessment


@router.patch("/assessments/{assess_id}", response_model=VendorAssessmentResponse)
async def update_assessment(
    project_id: uuid.UUID,
    assess_id: str,
    body: VendorAssessmentUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")

    assessment = await db.get(VendorAssessment, (project_id, assess_id))
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    # Run server-side validation (see src/assessment_validation.py):
    # enforces template_snapshot immutability, status-transition rules,
    # completeness gate on transition to pending_approval, response
    # shape, reviewer-field stripping, and recomputes score.
    sanitized = validate_on_update(assessment, body.model_dump(exclude_unset=True))

    # Server-side assignment of reviewer timestamps, triggered by the
    # new status value (R7 in the validator doc).
    now = datetime.now(timezone.utc)
    new_status = sanitized.get("status", assessment.status)
    if new_status == "pending_approval" and not getattr(assessment, "submitted_at", None):
        sanitized["submitted_at"] = now.isoformat()
    if new_status == "validated" and not getattr(assessment, "approved_at", None):
        sanitized["approved_at"] = now.isoformat()
        sanitized["approved_by"] = (user.email if user is not None else "") or ""

    for field, value in sanitized.items():
        setattr(assessment, field, value)

    assessment.updated_at = now
    project.updated_at = now
    await db.commit()
    await db.refresh(assessment)
    return assessment


@router.delete("/assessments/{assess_id}", status_code=204)
async def delete_assessment(
    project_id: uuid.UUID,
    assess_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")

    assessment = await db.get(VendorAssessment, (project_id, assess_id))
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if getattr(assessment, "status", "") == "validated":
        raise HTTPException(status_code=403, detail="Validated assessments cannot be deleted")

    await db.delete(assessment)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
