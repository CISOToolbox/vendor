"""Perf regression (M1): vendor /internal/stats counts without hydrating whole
tables.

The handler used to load every Vendor, every VendorMeasure and every validated
VendorAssessment (each carrying a big template_snapshot/responses blob) into ORM
objects just to bucket/average them — on every 30s Pilot poll. It now projects
the needed columns and uses func.avg. This test locks the counts/score the
rewrite must preserve.
"""
import os
import uuid
from types import SimpleNamespace

import pytest

os.environ.setdefault("SERVICE_TOKEN", "test-service-token")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite://")

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB as _JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from src.models import Base, Project, Vendor, VendorAssessment, VendorMeasure
from src.routes.internal import internal_stats

for _t in Base.metadata.tables.values():
    for _c in _t.columns:
        if _c.server_default is not None:
            _sd = str(getattr(_c.server_default, "arg", "")).lower()
            if any(k in _sd for k in ("gen_random_uuid", "now(", "::jsonb")):
                _c.server_default = None
        if isinstance(_c.type, _JSONB):
            _c.type = JSON()

_engine = create_async_engine(
    "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
)
_Session = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)

pytestmark = pytest.mark.asyncio

_CRITICAL = {"dependance": 4, "penetration": 4, "maturite": 1, "confiance": 1}  # (16)/(1)=16 → Critique


async def test_stats_counts_and_posture_are_preserved():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        pid = uuid.uuid4()
        async with _Session() as db:
            db.add(Project(id=pid, name="MedSecure"))
            db.add_all([
                Vendor(project_id=pid, id="PP-001", name="Acme", exposure=_CRITICAL),  # critical
                Vendor(project_id=pid, id="PP-002", name="Globex", exposure={}),        # low
            ])
            db.add_all([
                VendorMeasure(project_id=pid, vendor_id="PP-001", id="M1", statut="completed"),
                VendorMeasure(project_id=pid, vendor_id="PP-001", id="M2", statut="in_progress"),
                VendorMeasure(project_id=pid, vendor_id="PP-001", id="M3", statut="a_faire"),
                VendorMeasure(project_id=pid, vendor_id="PP-001", id="M4", statut="a_faire", echeance="2020-01-01"),
            ])
            db.add_all([
                VendorAssessment(project_id=pid, id="A1", vendor_id="PP-001", status="validated", score=60.0),
                VendorAssessment(project_id=pid, id="A2", vendor_id="PP-001", status="validated", score=80.0),
                VendorAssessment(project_id=pid, id="A3", vendor_id="PP-001", status="draft", score=100.0),  # excluded
            ])
            await db.commit()

            req = SimpleNamespace(headers={"X-Service-Token": "test-service-token"})
            out = await internal_stats(req, db)

        assert out["entity_count"] == 2
        assert out["criticals"] == 1                     # one critical-tier vendor
        m = out["measures"]
        assert (m["total"], m["completed"], m["in_progress"], m["planned"]) == (4, 1, 1, 2)
        assert m["overdue"] == 1                          # M4: past echeance, not completed
        assert out["posture"]["score"] == 70             # round(avg(60, 80)); draft 100 excluded
    finally:
        async with _engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
