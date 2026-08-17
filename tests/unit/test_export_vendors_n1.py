"""Perf regression (H1): /export/vendors groups measures in ONE query.

The route loaded all vendors then ran a SELECT VendorMeasure per vendor
(1 + N queries; Risk imports this). It now loads every measure once and groups
by (project_id, vendor_id). This test locks the grouping/ordering the rewrite
must preserve, including a vendor with no measures.
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

from src.models import Base, Project, Vendor, VendorMeasure
from src.routes.internal import export_vendors

# ── SQLite compatibility shim (mirrors pilot/tests/conftest.py) ──
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


async def test_export_groups_measures_without_n1():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        pid = uuid.uuid4()
        async with _Session() as db:
            db.add(Project(id=pid, name="MedSecure"))
            db.add_all([
                Vendor(project_id=pid, id="PP-001", name="Acme", sort_order=0),
                Vendor(project_id=pid, id="PP-002", name="Globex", sort_order=1),  # no measures
            ])
            db.add_all([
                VendorMeasure(project_id=pid, vendor_id="PP-001", id="PP-001-M02", mesure="second", sort_order=1),
                VendorMeasure(project_id=pid, vendor_id="PP-001", id="PP-001-M01", mesure="first", sort_order=0),
            ])
            await db.commit()

            req = SimpleNamespace(headers={"X-Service-Token": "test-service-token"})
            out = await export_vendors(req, db)

        by_id = {v["id"]: v for v in out["vendors"]}
        # PP-001's measures are grouped AND kept in sort_order.
        assert [m["mesure"] for m in by_id["PP-001"]["measures"]] == ["first", "second"]
        # PP-002 has no measures — must be an empty list, not missing/errored.
        assert by_id["PP-002"]["measures"] == []
    finally:
        async with _engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
