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
from src.models import User, VendorDocument
from src.schemas import VendorDocumentCreate, VendorDocumentResponse, VendorDocumentUpdate

router = APIRouter(prefix="/api/projects/{project_id}", tags=["vendor-documents"])



def _doc_evidence_payload(doc, vendor=None, project_name: str = "") -> dict:
    """Shared with routes/internal.py — build the FEAT-08 payload for a doc."""
    from src.routes.internal import _document_to_evidence
    return _document_to_evidence(doc, vendor, project_name)


async def _notify_doc(db, doc) -> None:
    """Fire-and-forget push of a document change to Pilot's evidence cache."""
    import asyncio
    from src.models import Project, Vendor
    from src.pilot_notify import notify_pilot_evidence
    v = (await db.execute(select(Vendor).where(
        Vendor.project_id == doc.project_id, Vendor.id == doc.vendor_id))).scalar_one_or_none()
    proj = await db.get(Project, doc.project_id)
    payload = _doc_evidence_payload(doc, v, (proj.name if proj else "") or "")
    asyncio.ensure_future(notify_pilot_evidence(payload))


@router.get("/documents", response_model=list[VendorDocumentResponse])
async def list_documents(
    project_id: uuid.UUID,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_project_or_404(project_id, user, db)
    result = await db.execute(
        select(VendorDocument)
        .where(VendorDocument.project_id == project_id)
        .order_by(VendorDocument.sort_order)
    )
    return result.scalars().all()


@router.post("/documents", response_model=VendorDocumentResponse, status_code=201)
async def create_document(
    project_id: uuid.UUID,
    body: VendorDocumentCreate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")

    existing = await db.get(VendorDocument, (project_id, body.id))
    if existing:
        raise HTTPException(status_code=409, detail="Document ID already exists")

    if body.sort_order == 0:
        max_order = await db.execute(
            select(func.coalesce(func.max(VendorDocument.sort_order), 0))
            .where(VendorDocument.project_id == project_id)
        )
        body.sort_order = max_order.scalar() + 1

    document = VendorDocument(project_id=project_id, **body.model_dump())
    db.add(document)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(document)
    await _notify_doc(db, document)   # FEAT-08 — evidence registry push
    return document


@router.patch("/documents/{doc_id}", response_model=VendorDocumentResponse)
async def update_document(
    project_id: uuid.UUID,
    doc_id: str,
    body: VendorDocumentUpdate,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="edit")

    doc = await db.get(VendorDocument, (project_id, doc_id))
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(doc, field, value)

    doc.updated_at = datetime.now(timezone.utc)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(doc)
    await _notify_doc(db, doc)   # FEAT-08 — evidence registry push
    return doc


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_document(
    project_id: uuid.UUID,
    doc_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project_or_404(project_id, user, db, require_perm="delete")

    doc = await db.get(VendorDocument, (project_id, doc_id))
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    deleted_id = doc.id
    await db.delete(doc)
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    import asyncio
    from src.pilot_notify import notify_pilot_evidence_deleted
    asyncio.ensure_future(notify_pilot_evidence_deleted(deleted_id))   # FEAT-08
