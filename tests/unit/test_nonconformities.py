"""FEAT-45 — non-conformities and derogations on third parties.

The shared mechanics are exercised through Vendor's own models and hook,
against SQLite: the object is a third party, approving a derogation writes
nothing on it, and the stats envelope counts what the module detects on its
own — a third party we work with that carries no validated assessment.
"""
import os
import sys
import uuid
from datetime import date, timedelta

import pytest
import pytest_asyncio
from fastapi import HTTPException

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite://")
os.environ.setdefault("MODULE_NAME", "vendor")
os.environ.setdefault("JWT_SECRET", "test-secret-that-is-long-enough-32ch")
os.environ.setdefault("SERVICE_TOKEN", "svc-token-for-tests-0123456789abcdef")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from sqlalchemy import JSON  # noqa: E402
from sqlalchemy.dialects.postgresql import JSONB as _JSONB  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from starlette.requests import Request  # noqa: E402

from src.models import (Base, Derogation, Nonconformity, Project, Vendor,  # noqa: E402
                        VendorAssessment, VendorMeasure)
from src.nonconformity_common import (DecisionBody, DerogationCreate, NonconformityCreate,  # noqa: E402
                                      NonconformityPatch, QualifyBody, expire_derogations, revoke_for_subject)
from src.routes.nonconformities import VENDOR_HOOK, router  # noqa: E402

for _t in Base.metadata.tables.values():
    for _c in _t.columns:
        if _c.server_default is not None:
            _sd = str(getattr(_c.server_default, "arg", "")).lower()
            if any(k in _sd for k in ("gen_random_uuid", "now(", "::jsonb")):
                _c.server_default = None
        if isinstance(_c.type, _JSONB):
            _c.type = JSON()

PID = uuid.uuid4()


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite://", connect_args={"check_same_thread": False},
                                 poolclass=StaticPool)
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        session.add(Project(id=PID, name="MedSecure"))
        # Assessed: the module has nothing to say about it.
        session.add(Vendor(project_id=PID, id="PP-001", name="Cloud Imaging SAS", country="FR", status="active"))
        session.add(VendorAssessment(project_id=PID, id="ASS-001", vendor_id="PP-001",
                                     title="Annual questionnaire", status="validated", score=62.0))
        # Worked with, never assessed: what the module detects.
        session.add(Vendor(project_id=PID, id="PP-002", name="Shadow Analytics", status="active"))
        # Never assessed either, but already being worked on.
        session.add(Vendor(project_id=PID, id="PP-003", name="Backup Partner", status="review"))
        session.add(VendorMeasure(project_id=PID, vendor_id="PP-003", id="PP-003-M01",
                                  mesure="Plan an onboarding assessment", statut="a_faire"))
        session.add(VendorMeasure(project_id=PID, vendor_id="PP-001", id="PP-001-M01",
                                  mesure="Collect the penetration test report", statut="a_faire"))
        # Out of scope: a former third party is nobody's problem any more.
        session.add(Vendor(project_id=PID, id="PP-004", name="Former Supplier", status="archived"))
        await session.commit()
        yield session
    await engine.dispose()


def _req() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/api/derogations", "headers": [],
                    "query_string": b"", "client": ("127.0.0.1", 1)})


def _endpoint(name: str):
    for r in router.routes:
        if r.endpoint.__name__ == name:
            return r.endpoint
    raise KeyError(name)


def _key(vendor_id: str) -> str:
    return f"{PID}:{vendor_id}"


def _der_body(subject_id, **over):
    body = {"subject_type": "vendor", "subject_id": subject_id,
            "title": "Contract signed before the assessment",
            "justification": "The service starts in January; the assessment is booked for the end of February.",
            "risk_owner": "purchasing@medsecure.example", "approver": "ciso@medsecure.example",
            "valid_until": (date.today() + timedelta(days=30)).isoformat()}
    body.update(over)
    return body


@pytest.mark.asyncio
async def test_the_hook_names_a_third_party_of_the_project(db):
    assert await VENDOR_HOOK.exists(db, "vendor", _key("PP-001")) == "Cloud Imaging SAS · FR"
    assert await VENDOR_HOOK.exists(db, "vendor", _key("PP-002")) == "Shadow Analytics"
    assert await VENDOR_HOOK.exists(db, "vendor", _key("PP-404")) is None
    assert await VENDOR_HOOK.exists(db, "vendor", "garbage") is None
    assert await VENDOR_HOOK.exists(db, "vendor", f"{uuid.uuid4()}:PP-001") is None


@pytest.mark.asyncio
async def test_an_approved_derogation_writes_nothing_on_the_third_party(db):
    d = await _endpoint("request_derogation")(DerogationCreate(**_der_body(_key("PP-002"))), _req(), user=None, db=db)
    d = await _endpoint("decide_derogation")(d["id"], DecisionBody(approve=True), _req(), user=None, db=db)
    assert d["status"] == "approved" and d["subject_label"] == "Shadow Analytics"
    v = await db.get(Vendor, (PID, "PP-002"))
    await db.refresh(v)
    assert v.status == "active" and v.name == "Shadow Analytics"
    # Only one live derogation per third party.
    with pytest.raises(HTTPException) as x:
        await _endpoint("request_derogation")(DerogationCreate(**_der_body(_key("PP-002"))), _req(), user=None, db=db)
    assert x.value.status_code == 409
    # Past its end of validity it expires, and the situation is open again.
    der = await db.get(Derogation, uuid.UUID(d["id"]))
    der.valid_until = date.today() - timedelta(days=1)
    await db.commit()
    assert await expire_derogations(db, Derogation, VENDOR_HOOK, Nonconformity) == 1
    assert (await db.get(Derogation, uuid.UUID(d["id"]))).status == "expired"
    # Treating the situation revokes what covered it.
    d2 = await _endpoint("request_derogation")(DerogationCreate(**_der_body(_key("PP-002"))), _req(), user=None, db=db)
    await _endpoint("decide_derogation")(d2["id"], DecisionBody(approve=True), _req(), user=None, db=db)
    await revoke_for_subject(db, Derogation, "vendor", _key("PP-002"), "the third party has been assessed", actor="ciso")
    await db.commit()
    assert (await db.get(Derogation, uuid.UUID(d2["id"]))).status == "revoked"


@pytest.mark.asyncio
async def test_a_record_concerns_third_parties_and_their_measures(db):
    n = await _endpoint("declare_nonconformity")(
        NonconformityCreate(title="Two third parties are used without any assessment",
                            subjects=[{"type": "vendor", "id": _key("PP-002")},
                                      {"type": "vendor", "id": _key("PP-003")}]),
        _req(), user=None, db=db)
    assert [x["id"] for x in n["subjects"]] == [_key("PP-002"), _key("PP-003")]
    await _endpoint("qualify_nonconformity")(n["id"], QualifyBody(), user=None, db=db)
    r = await _endpoint("patch_nonconformity")(n["id"], NonconformityPatch(measure_ids=[f"{PID}:PP-003:PP-003-M01"]),
                                               user=None, db=db)
    assert r["status"] == "in_remediation"
    # Closing waits for the remediation to be done.
    with pytest.raises(HTTPException) as x:
        await _endpoint("close_nonconformity")(n["id"], NonconformityPatch(closure_evidence="assessment validated"),
                                               user=None, db=db)
    assert x.value.status_code == 409
    with pytest.raises(HTTPException) as x:
        await _endpoint("patch_nonconformity")(n["id"], NonconformityPatch(measure_ids=[f"{PID}:PP-003:PP-003-M99"]),
                                               user=None, db=db)
    assert x.value.status_code == 422


@pytest.mark.asyncio
async def test_a_record_without_object_covers_the_third_party_nobody_registered(db):
    """Working with a third party that was never registered: the record is
    declared without an object, and stands on its own until one exists."""
    n = await _endpoint("declare_nonconformity")(
        NonconformityCreate(title="Invoices from a provider that is in no register",
                            description="Found while reviewing the purchase ledger."),
        _req(), user=None, db=db)
    assert n["subjects"] == [] and n["status"] == "to_qualify"
    # Once the third party is registered, the record names it.
    db.add(Vendor(project_id=PID, id="PP-005", name="Ghost Consulting", status="active"))
    await db.commit()
    r = await _endpoint("patch_nonconformity")(
        n["id"], NonconformityPatch(subjects=[{"type": "vendor", "id": _key("PP-005")}]), user=None, db=db)
    assert [x["id"] for x in r["subjects"]] == [_key("PP-005")]


@pytest.mark.asyncio
async def test_stats_envelope_counts_the_third_parties_left_unassessed(db):
    from src.routes.internal import internal_stats
    sreq = Request({"type": "http", "method": "GET", "path": "/api/internal/stats", "query_string": b"",
                    "headers": [(b"x-service-token", os.environ["SERVICE_TOKEN"].encode())], "client": ("127.0.0.1", 1)})

    stats = await internal_stats(sreq, db)
    # PP-002 and PP-003 are worked with and never assessed; PP-003 is already
    # being worked on; PP-001 is assessed and PP-004 is out of scope.
    assert stats["nonconformities"] == {"derogated": 0, "detected_open": 2, "with_measure": 1,
                                        "to_qualify": 0, "open": 0}

    d = await _endpoint("request_derogation")(DerogationCreate(**_der_body(_key("PP-002"))), _req(), user=None, db=db)
    await _endpoint("decide_derogation")(d["id"], DecisionBody(approve=True), _req(), user=None, db=db)
    await _endpoint("declare_nonconformity")(NonconformityCreate(title="Declared, waiting"), _req(), user=None, db=db)
    db.expunge_all()
    stats = await internal_stats(sreq, db)
    assert stats["nonconformities"] == {"derogated": 1, "detected_open": 1, "with_measure": 1,
                                        "to_qualify": 1, "open": 0}

    # An acceptance granted on an assessed third party counts too: it is a
    # decision, even though the module detects nothing about that one.
    d2 = await _endpoint("request_derogation")(DerogationCreate(**_der_body(_key("PP-001"))), _req(), user=None, db=db)
    await _endpoint("decide_derogation")(d2["id"], DecisionBody(approve=True), _req(), user=None, db=db)
    db.expunge_all()
    assert (await internal_stats(sreq, db))["nonconformities"]["derogated"] == 2


@pytest.mark.asyncio
async def test_the_register_is_scoped_to_the_project_and_to_the_role(db, monkeypatch):
    """Vendor's own gates on the register: a read-only account writes nothing,
    a third party of another project is not a valid object, and only an
    administrator (or the internal-controls team) decides."""
    from types import SimpleNamespace

    import src.auth_common as auth_common
    monkeypatch.setattr(auth_common, "auth_enabled", lambda: True)

    owner = uuid.uuid4()
    project = await db.get(Project, PID)
    project.owner_id = owner
    elsewhere = uuid.uuid4()
    db.add(Project(id=elsewhere, name="Another perimeter", owner_id=owner))
    await db.commit()
    viewer = SimpleNamespace(id=uuid.uuid4(), name="Vera Viewer", email="vera@medsecure.example",
                             role="admin", _module_role="viewer")
    editor = SimpleNamespace(id=uuid.uuid4(), name="Ed Editor", email="ed@medsecure.example",
                             role="user", _module_role="editor")
    control = SimpleNamespace(id=uuid.uuid4(), name="Cora Control", email="cora@medsecure.example",
                              role="user", _module_role="control")

    request_der = _endpoint("request_derogation")
    with pytest.raises(HTTPException) as x:
        await request_der(DerogationCreate(**_der_body(_key("PP-002"), project_id=str(PID))), _req(), user=viewer, db=db)
    assert x.value.status_code == 403
    # The object must belong to the record's project, in either direction.
    for body in (_der_body(_key("PP-002"), project_id=str(elsewhere)),
                 _der_body(f"{elsewhere}:PP-002", project_id=str(PID))):
        with pytest.raises(HTTPException) as x:
            await request_der(DerogationCreate(**body), _req(), user=editor, db=db)
        assert x.value.status_code == 404

    d = await request_der(DerogationCreate(**_der_body(_key("PP-002"), project_id=str(PID))), _req(), user=editor, db=db)
    assert d["project_id"] == str(PID)
    decide = _endpoint("decide_derogation")
    for user in (viewer, editor):
        with pytest.raises(HTTPException) as x:
            await decide(d["id"], DecisionBody(approve=True), _req(), user=user, db=db)
        assert x.value.status_code == 403
    decided = await decide(d["id"], DecisionBody(approve=True), _req(), user=control, db=db)
    assert decided["status"] == "approved" and decided["decided_by"] == "Cora Control"


@pytest.mark.asyncio
async def test_the_expiry_heartbeat_is_wired():
    """The module has no scheduler of its own: the register brings one. This
    proves the loop's single pass resolves its hook and models (a rename would
    otherwise only show up in production, a month later, on a live file)."""
    from src.derogation_expiry import run_once
    assert await run_once() == 0


@pytest.mark.asyncio
async def test_every_register_event_reaches_the_module_journal(db):
    """Criterion 7 of the feature: the module's own journal carries the
    register's events, with the actor who caused them."""
    from sqlalchemy import select as _select

    from src.models import AuditLog

    n = await _endpoint("declare_nonconformity")(NonconformityCreate(title="Journalled record"), _req(), user=None, db=db)
    await _endpoint("qualify_nonconformity")(n["id"], QualifyBody(), user=None, db=db)
    d = await _endpoint("request_derogation")(DerogationCreate(**_der_body(_key("PP-002"))), _req(), user=None, db=db)
    await _endpoint("decide_derogation")(d["id"], DecisionBody(approve=True), _req(), user=None, db=db)
    actions = set((await db.execute(_select(AuditLog.action))).scalars().all())
    assert {"nonconformity.declared", "nonconformity.qualified",
            "derogation.requested", "derogation.approved"} <= actions


@pytest.mark.asyncio
async def test_removing_the_third_party_settles_what_covered_it(db):
    """Nothing is left to accept once the third party leaves the register."""
    from src.routes.vendors import delete_vendor

    d = await _endpoint("request_derogation")(DerogationCreate(**_der_body(_key("PP-002"))), _req(), user=None, db=db)
    await _endpoint("decide_derogation")(d["id"], DecisionBody(approve=True), _req(), user=None, db=db)
    await delete_vendor(PID, "PP-002", user=None, db=db)
    assert (await db.get(Derogation, uuid.UUID(d["id"]))).status == "revoked"
