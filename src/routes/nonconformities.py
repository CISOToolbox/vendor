"""FEAT-45 — non-conformities and derogations, Vendor flavour.

The mechanics (states, validation, router, expiry) are shared; this file says
what a record covers here — a **third party**, addressed by its key
`<project_id>:<vendor_id>`.

What deserves a record in this module is the *relationship*, not the
questionnaire: contracting with a third party before assessing it, working
with one that was never registered, keeping one past a certification that
lapsed. A gap inside an assessment is answered by its action plan and its
corrective measure, which the module already carries — it does not need a
record of its own.

What the module *detects* on its own is the first of those: a third party we
work with (active, or under review) with **no validated assessment**. A
third party that was never registered has, by definition, no object here: the
record is declared without one, and the declaration can create the vendor,
which then becomes its object.

"Derogated" writes nothing on the vendor. Its score and its tier are computed
from its assessments and its exposure; a derogation governs a situation, it
does not change the facts. The frontend derives the state from the approved
derogations, exactly as Compliance does for a requirement.

Measure ids are `<project_id>:<vendor_id>:<measure_id>` (a measure belongs to
a vendor, inside a project).
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Derogation, Nonconformity, Project, Vendor, VendorAssessment, VendorMeasure
from src.nonconformity_common import make_internal_router, make_router
from src.auth import require_min_role

# Same ladder as the module's own write routes: an editor writes, a viewer does not.
_ROLES = ["viewer", "reader", "triager", "editor", "contributor", "manager", "admin", "control"]

SUBJECT_TYPE = "vendor"


def split_vendor_key(key: str) -> Optional[tuple]:
    parts = (key or "").split(":", 1)
    if len(parts) != 2 or not parts[1]:
        return None
    try:
        return uuid.UUID(parts[0]), parts[1]
    except ValueError:
        return None


def split_measure_key(key: str) -> Optional[tuple]:
    parts = (key or "").split(":", 2)
    if len(parts) != 3 or not parts[1] or not parts[2]:
        return None
    try:
        return uuid.UUID(parts[0]), parts[1], parts[2]
    except ValueError:
        return None


class VendorHook:
    async def exists(self, db: AsyncSession, subject_type: str, subject_id: str, project_id: str = "") -> Optional[str]:
        if subject_type != SUBJECT_TYPE:
            return None
        key = split_vendor_key(subject_id)
        # The vendor names its project: a record never reaches into another one.
        if key is None or (project_id and str(key[0]) != str(project_id)):
            return None
        v = await db.get(Vendor, key)
        if v is None:
            return None
        return f"{v.name or v.id}{' · ' + v.country if v.country else ''}"[:500]

    async def apply(self, db: AsyncSession, derogation: Any) -> None:
        return None          # derived: nothing is written on the third party

    async def release(self, db: AsyncSession, derogation: Any, reason: str) -> None:
        return None

    async def missing_measures(self, db: AsyncSession, ids: list, project_id: str = "") -> list:
        missing = []
        for i in ids:
            key = split_measure_key(i)
            # A measure is its project's: a record never links another one's.
            if key is None or (project_id and str(key[0]) != str(project_id)) or await db.get(VendorMeasure, key) is None:
                missing.append(i)
        return missing

    async def measure_states(self, db: AsyncSession, ids: list, project_id: str = "") -> dict:
        out = {}
        for i in ids:
            key = split_measure_key(i)
            if key is None or (project_id and str(key[0]) != str(project_id)):
                continue
            m = await db.get(VendorMeasure, key)
            if m is not None:
                out[i] = m.statut
        return out


VENDOR_HOOK = VendorHook()


async def unassessed_vendors(db: AsyncSession) -> set:
    """Keys of the third parties we work with that carry no validated
    assessment — what this module detects without anyone declaring it."""
    validated = {
        (pid, vid) for pid, vid in (await db.execute(
            select(VendorAssessment.project_id, VendorAssessment.vendor_id)
            .where(VendorAssessment.status == "validated")
        )).all()
    }
    # The third parties we work with: the module's own scope, so the register
    # counts what the posture and the action plan count.
    from src.routes.internal import VENDOR_IN_SCOPE

    rows = (await db.execute(
        select(Vendor.project_id, Vendor.id).where(Vendor.status.in_(VENDOR_IN_SCOPE))
    )).all()
    return {f"{pid}:{vid}" for pid, vid in rows if (pid, vid) not in validated}


class ProjectScope:
    """The register is project-scoped here: a record belongs to the project it
    was declared in, and a user only ever sees or touches the projects the
    module already grants them. A record without a project came from the
    console: it is module-level and stays visible to everyone."""

    async def readable(self, db: AsyncSession, user: Any) -> list:
        from src.routes.projects import _user_permissions
        rows = (await db.execute(select(Project))).scalars().all()
        return [str(p.id) for p in rows if "read" in _user_permissions(p, user)]

    async def writable(self, db: AsyncSession, user: Any, project_id: str) -> None:
        from src.routes.auth_helpers import get_project_or_404
        try:
            pid = uuid.UUID(str(project_id))
        except ValueError:
            raise HTTPException(status_code=404, detail="Project not found")
        await get_project_or_404(pid, user, db, require_perm="edit")


PROJECT_SCOPE = ProjectScope()


router = make_router(Nonconformity, Derogation, VENDOR_HOOK, subject_types=(SUBJECT_TYPE,),
                     require_writer=lambda u: require_min_role(u, "editor", _ROLES),
                     project_scope=PROJECT_SCOPE)

# Pilot's view of the register (service token): the same operations, relayed
# with the Pilot user as actor. The token check is the module's own.
from src.routes.internal import _check_service_token  # noqa: E402

internal_router = make_internal_router(Nonconformity, Derogation, VENDOR_HOOK, subject_types=(SUBJECT_TYPE,),
                                       check_service_token=_check_service_token)
