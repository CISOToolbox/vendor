"""Shared auth helpers for entity routes."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import auth_enabled
from src.models import Project


async def get_project_or_404(project_id: str, user, db: AsyncSession, require_perm: str = "read") -> Project:
    """Fetch the project (404 if missing) and enforce that ``user`` holds
    ``require_perm`` on it, using the module's permission model
    (``projects._user_permissions``).

    GET routes use the default ``"read"``; mutation routes pass ``"edit"``
    (create/update) or ``"delete"`` so a read-only viewer cannot mutate child
    entities (si_users, service accounts, reviews, …) via the API — the gate
    used to be read-level only, which made the read-only role cosmetic.
    """
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if auth_enabled() and user is not None:
        from src.routes.projects import _user_permissions
        if require_perm not in _user_permissions(project, user):
            raise HTTPException(status_code=403, detail="Access denied")
    return project
