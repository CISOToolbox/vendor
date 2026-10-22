"""BUG-115 — the vendor-maturity settings are saved: an assessment's weight
override and exclusion (PATCH and project save, approved assessments too,
R10), and the project's maturity configuration (weights by kind and by
template, decay). Before, the server dropped all three: the setting was lost
on reload and the maturity recomputed without it.

Same in-memory database shim as test_dora_export_complete.py."""
import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException

from src.models import Base, Project, Vendor, VendorAssessment
from tests.unit.test_dora_export_complete import _engine, _Session

pytestmark = pytest.mark.asyncio

TPL = {"sections": [{"id": "s1", "title": "S1", "questions": [
    {"id": "q1", "text": "Q1", "criticality": "high", "weight": 3}]}]}
RESP = [{"question_id": "q1", "coverage": "covered", "comment": "", "justification": "", "action_plans": []}]
CFG = {"weight_by_kind": {"questionnaire": 1.0, "audit": 2.5}, "weight_by_template": {"TPL-1": 3.0},
       "decay_per_quarter": 0.1, "min_effective_weight": 0.2}


@pytest_asyncio.fixture(autouse=True)
async def _db():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _seed(db, pid):
    db.add(Project(id=pid, name="Maturity"))
    db.add(Vendor(project_id=pid, id="PP-001", name="Cloud Corp"))
    db.add(VendorAssessment(project_id=pid, id="EVAL-001", vendor_id="PP-001", title="Annual", status="validated",
                            template_snapshot=TPL, responses=RESP, self_validation=True, score=100,
                            completion_rate=100, approved_at="2026-10-20T07:24:04+00:00"))
    await db.commit()


async def test_weight_override_and_exclusion_are_saved_on_an_approved_assessment():
    from src.routes.projects import _reconstruct_data
    from src.routes.vendor_assessments import update_assessment
    from src.schemas import VendorAssessmentUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        out = await update_assessment(pid, "EVAL-001", VendorAssessmentUpdate(weight_override=2.0), user=None, db=db)
        assert out.weight_override == 2.0
        await update_assessment(pid, "EVAL-001", VendorAssessmentUpdate(excluded=True), user=None, db=db)
        a = (await _reconstruct_data(db, pid))["assessments"][0]
        assert a["weight_override"] == 2.0 and a["excluded"] is True     # kept on reload
        await update_assessment(pid, "EVAL-001", VendorAssessmentUpdate(weight_override=None), user=None, db=db)
        assert (await _reconstruct_data(db, pid))["assessments"][0]["weight_override"] is None   # cleared


async def test_a_negative_weight_override_is_refused():
    from src.routes.vendor_assessments import update_assessment
    from src.schemas import VendorAssessmentUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        with pytest.raises(HTTPException) as exc:
            await update_assessment(pid, "EVAL-001", VendorAssessmentUpdate(weight_override=-1), user=None, db=db)
        assert exc.value.status_code == 422


async def test_the_project_save_keeps_the_settings_and_the_configuration():
    from src.routes.projects import _reconstruct_data, update_project
    from src.schemas import ProjectUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        data = await _reconstruct_data(db, pid)
        data["assessments"][0]["weight_override"] = 1.5
        data["assessments"][0]["excluded"] = True
        data["maturity_config"] = CFG
        await update_project(pid, ProjectUpdate(data=data), user=None, db=db)
        back = await _reconstruct_data(db, pid)
        assert back["assessments"][0]["weight_override"] == 1.5 and back["assessments"][0]["excluded"] is True
        assert back["maturity_config"] == CFG


@pytest.mark.parametrize("cfg", [
    {"decay_per_quarter": -0.1}, {"decay_per_quarter": 2}, {"min_effective_weight": "high"},
    {"weight_by_kind": {"audit": -1}}, {"weight_by_template": "x"}, ["not", "an", "object"],
])
async def test_an_invalid_maturity_configuration_is_refused(cfg):
    from src.routes.projects import _reconstruct_data, update_project
    from src.schemas import ProjectUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        data = await _reconstruct_data(db, pid)
        data["maturity_config"] = cfg
        with pytest.raises(HTTPException) as exc:
            await update_project(pid, ProjectUpdate(data=data), user=None, db=db)
        assert exc.value.status_code == 422


@pytest.mark.parametrize("bad", [{"excluded": "false"}, {"weight_override": -3}, {"weight_override": "heavy"}])
async def test_a_restored_backup_goes_through_r11(bad):
    from src.assessment_validation import validate_on_restore
    with pytest.raises(HTTPException) as exc:
        validate_on_restore([dict({"id": "EVAL-1", "vendor_id": "PP-001", "status": "validated",
                                   "template_snapshot": TPL, "responses": RESP}, **bad)])
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException):   # a legacy row (no snapshot) too
        validate_on_restore([dict({"id": "EVAL-2", "vendor_id": "PP-001", "status": "completed"}, **bad)])


# ── BUG-118: the maturity configuration has a write of its own ──


async def test_the_maturity_configuration_is_saved_by_its_own_route():
    from src.routes.projects import _reconstruct_data, patch_maturity_config
    from src.schemas import MaturityConfigPatch
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        out = await patch_maturity_config(pid, MaturityConfigPatch(maturity_config=CFG), user=None, db=db)
        assert out["maturity_config"] == CFG
        assert (await _reconstruct_data(db, pid))["maturity_config"] == CFG


async def test_the_maturity_configuration_route_applies_r11():
    from src.routes.projects import patch_maturity_config
    from src.schemas import MaturityConfigPatch
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        with pytest.raises(HTTPException) as exc:
            await patch_maturity_config(pid, MaturityConfigPatch(maturity_config={"decay_per_quarter": 2}), user=None, db=db)
        assert exc.value.status_code == 422


async def test_the_maturity_configuration_field_is_required():
    from pydantic import ValidationError
    from src.schemas import MaturityConfigPatch
    with pytest.raises(ValidationError):
        MaturityConfigPatch()                       # omitted: refused, never a silent reset
    assert MaturityConfigPatch(maturity_config=None).maturity_config is None   # explicit reset
