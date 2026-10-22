"""BUG-120 — a restored (or imported) project goes through the same checks as
what is entered: a value outside its list, an old free-text impact, an invalid
country or LEI, an orphan reference come back normalised (cleared, or
dropped when the row cannot exist without it) instead of verbatim — and the
restore still succeeds on an old backup. Creating a project (or importing one)
refuses two records with one code, as the save does (BUG-114).

Same in-memory database as test_dora_export_complete.py."""
import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select

from src.models import (
    Base, DoraArrangement, DoraArrangementFunction, DoraArrangementSubcontractor, DoraBranch, DoraEntity, DoraFunction,
    DoraSubcontractor, Project, Vendor,
)
from tests.unit.test_dora_export_complete import _engine, _Session

pytestmark = pytest.mark.asyncio
LEI = "529900T8BM49AURSDO55"


@pytest_asyncio.fixture(autouse=True)
async def _db():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _old_backup() -> dict:
    """A backup taken before the current rules, with every kind of drift."""
    return {
        "vendors": [
            {"id": "PP-1", "name": "Cloud", "lei": LEI, "person_type": "robot", "country_iso2": "ZZ",
             "ultimate_parent_id": "PP-GONE"},
            {"id": "PP-2", "name": "Group", "ultimate_parent_id": "PP-1"},
        ],
        "assessments": [], "risks": [], "documents": [], "metadata": {},
        "dora": {
            "entities": [{"id": "ENT-1", "lei": "NOT-A-LEI", "name": "MedSecure", "entity_type": "bank-ish",
                          "hierarchy": "parent", "country_iso2": "FR"}],
            "functions": [
                {"id": "FN-1", "code": "F1", "name": "Payments", "impact_tolerance_description": " High ", "rfe_id": "ENT-GONE"},
                {"id": "FN-2", "code": "F2", "name": "HR", "impact_tolerance_description": "the business stops"},
            ],
            "branches": [{"id": "BR-1", "rfe_id": "ENT-GONE", "name": "Orphan branch"}],
            "subcontractors": [{"id": "SUB-1", "name": "DC Ops", "person_type": "alien", "additional_id_type": "other",
                                "additional_id_value": "X-1"}],
            "arrangements": [
                {"id": "ARR-1", "vendor_id": "PP-1", "arrangement_reference": "ARR-1", "arrangement_type": "weird",
                 "currency": "EUR", "governing_law_country": "XX", "linked_arrangement_id": "ARR-GONE",
                 "parent_arrangement_id": "ARR-GONE", "open_ended": False},
                {"id": "ARR-2", "vendor_id": "PP-GONE", "arrangement_reference": "ARR-2", "currency": "EUR", "open_ended": False},
            ],
            "arrangement_functions": [{"arrangement_id": "ARR-1", "function_id": "FN-1"},
                                      {"arrangement_id": "ARR-1", "function_id": "FN-GONE"},
                                      {"arrangement_id": "ARR-2", "function_id": "FN-1"}],
            "arrangement_subcontractors": [{"arrangement_id": "ARR-1", "subcontractor_id": "SUB-1", "tier": 3,
                                            "parent_subcontractor_id": "SUB-GONE"},
                                           {"arrangement_id": "ARR-1", "subcontractor_id": "SUB-GONE", "tier": 2}],
        },
    }


async def _restore(db, pid, data):
    from src.routes.projects import _decompose_data
    db.add(Project(id=pid, name="Restored"))
    await db.flush()
    await _decompose_data(db, pid, data)
    await db.commit()


async def test_an_old_backup_is_restored_normalised():
    async with _Session() as db:
        pid = uuid.uuid4()
        await _restore(db, pid, _old_backup())
        v1 = await db.get(Vendor, (pid, "PP-1"))
        assert v1.person_type in (None, "") and v1.country_iso2 in (None, "")       # outside their lists
        assert v1.ultimate_parent_id is None                                       # orphan, not a LEI
        assert (await db.get(Vendor, (pid, "PP-2"))).ultimate_parent_id == "PP-1"  # a real parent stays
        ent = await db.get(DoraEntity, (pid, "ENT-1"))
        assert ent.lei in (None, "") and ent.entity_type in (None, "") and ent.hierarchy == "parent"
        f1 = await db.get(DoraFunction, (pid, "FN-1"))
        f2 = await db.get(DoraFunction, (pid, "FN-2"))
        assert f1.impact_tolerance_description == "high" and f1.rfe_id is None   # normalised; orphan cleared
        assert f2.impact_tolerance_description == "not_assessed"                  # old free text
        assert await db.get(DoraBranch, (pid, "BR-1")) is None                     # needs its entity: dropped
        sub = await db.get(DoraSubcontractor, (pid, "SUB-1"))
        assert sub.person_type in (None, "") and sub.additional_id_type == "other"   # a stored type is kept
        a1 = await db.get(DoraArrangement, (pid, "ARR-1"))
        assert a1.arrangement_type in (None, "") and a1.governing_law_country in (None, "")
        assert a1.linked_arrangement_id is None and a1.parent_arrangement_id is None
        assert await db.get(DoraArrangement, (pid, "ARR-2")) is None              # its vendor is gone: dropped
        fns = (await db.execute(select(DoraArrangementFunction).where(DoraArrangementFunction.project_id == pid))).scalars().all()
        assert [(x.arrangement_id, x.function_id) for x in fns] == [("ARR-1", "FN-1")]
        links = (await db.execute(select(DoraArrangementSubcontractor).where(
            DoraArrangementSubcontractor.project_id == pid))).scalars().all()
        assert [(x.subcontractor_id, x.parent_subcontractor_id) for x in links] == [("SUB-1", None)]


async def test_a_clean_backup_is_restored_unchanged():
    from src.routes.projects import _reconstruct_data
    clean = {
        "vendors": [{"id": "PP-1", "name": "Cloud", "lei": LEI, "person_type": "legal", "country_iso2": "IE"}],
        "assessments": [], "risks": [], "documents": [], "metadata": {},
        "dora": {"functions": [{"id": "FN-1", "code": "F1", "name": "Payments", "impact_tolerance_description": "high"}],
                 "arrangements": [{"id": "ARR-1", "vendor_id": "PP-1", "arrangement_reference": "ARR-1", "currency": "EUR",
                                   "governing_law_country": "IE", "open_ended": True}]},
    }
    async with _Session() as db:
        pid = uuid.uuid4()
        await _restore(db, pid, clean)
        back = await _reconstruct_data(db, pid)
        v = back["vendors"][0]
        assert (v["lei"], v["person_type"], v["country_iso2"]) == (LEI, "legal", "IE")
        assert back["dora"]["functions"][0]["impact_tolerance_description"] == "high"
        a = back["dora"]["arrangements"][0]
        assert (a["governing_law_country"], a["open_ended"]) == ("IE", True)


async def test_creating_a_project_refuses_two_vendors_with_one_lei():
    from src.routes.projects import create_project
    from src.schemas import ProjectCreate
    data = {"vendors": [{"id": "PP-1", "name": "A", "lei": LEI}, {"id": "PP-2", "name": "B", "lei": LEI.lower()}],
            "assessments": []}
    async with _Session() as db:
        with pytest.raises(HTTPException) as exc:
            await create_project(ProjectCreate(name="Dup", data=data), user=None, db=db)
        assert exc.value.status_code == 422


async def test_dora_rows_are_written_in_foreign_key_order():
    """Postgres refuses a branch before its entity: with SQLite's foreign keys
    on, a project with every DORA table is restored whole."""
    from sqlalchemy import text
    from src.routes.projects import _reconstruct_data
    data = _old_backup()
    data["dora"]["branches"] = [{"id": "BR-1", "rfe_id": "ENT-1", "name": "Lisboa", "country_iso2": "PT"}]
    data["dora"]["arrangement_rfes"] = [{"arrangement_id": "ARR-1", "rfe_id": "ENT-1"}]
    async with _engine.begin() as conn:
        await conn.execute(text("PRAGMA foreign_keys=ON"))
    try:
        async with _Session() as db:
            pid = uuid.uuid4()
            await _restore(db, pid, data)
            back = await _reconstruct_data(db, pid)
            assert [b["id"] for b in back["dora"]["branches"]] == ["BR-1"]
            assert [(r["arrangement_id"], r["rfe_id"]) for r in back["dora"]["arrangement_rfes"]] == [("ARR-1", "ENT-1")]
    finally:
        async with _engine.begin() as conn:
            await conn.execute(text("PRAGMA foreign_keys=OFF"))


# ── BUG-120: the questionnaire templates are saved with the project ──

TPL = {"id": "TPL-CUSTOM", "name": "Custom", "version": 1, "kind": "questionnaire", "language": "en",
       "sections": [{"id": "S1", "title": "Access", "questions": [{"id": "Q1", "text": "MFA?", "criticality": "high"}]}]}


async def test_the_questionnaire_templates_are_saved_and_read_back():
    from src.routes.projects import _reconstruct_data, update_project
    from src.schemas import ProjectUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _restore(db, pid, {"vendors": [], "assessments": [], "metadata": {}})
        data = await _reconstruct_data(db, pid)
        data["questionnaire_templates"] = [TPL]
        await update_project(pid, ProjectUpdate(data=data), user=None, db=db)
        back = await _reconstruct_data(db, pid)
        assert back["questionnaire_templates"] == [TPL]                     # was dropped: lost on reload


async def test_a_restore_keeps_the_templates_and_drops_malformed_entries():
    from src.routes.projects import _reconstruct_data
    async with _Session() as db:
        pid = uuid.uuid4()
        await _restore(db, pid, {"vendors": [], "assessments": [], "metadata": {},
                                 "questionnaire_templates": [TPL, "junk", {"name": "no id"}, dict(TPL)]})
        back = await _reconstruct_data(db, pid)
        assert [t["id"] for t in back["questionnaire_templates"]] == ["TPL-CUSTOM"]   # malformed and repeated ids dropped


@pytest.mark.parametrize("left_out", ["absent", "null"])
async def test_the_project_save_never_rewinds_dora_written_meanwhile(left_out):
    """The page keeps the DORA snapshot it loaded; DORA is written through its
    own routes. A later whole-project save must not write that old snapshot
    back over them."""
    from src.routes.projects import _reconstruct_data, update_project
    from src.schemas import ProjectUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _restore(db, pid, {"vendors": [{"id": "PP-1", "name": "Cloud"}], "assessments": [], "metadata": {},
                                 "dora": {"arrangements": [{"id": "ARR-1", "vendor_id": "PP-1", "arrangement_reference": "ARR-1",
                                                           "currency": "EUR", "open_ended": False}]}})
        snapshot = await _reconstruct_data(db, pid)                       # what the page loaded
        arr = await db.get(DoraArrangement, (pid, "ARR-1"))               # then an edit through the DORA route
        arr.open_ended = True
        await db.commit()
        snapshot["questionnaire_templates"] = [TPL]                       # then the page's save, DORA left out
        if left_out == "absent":
            del snapshot["dora"]
        else:
            snapshot["dora"] = None
        await update_project(pid, ProjectUpdate(data=snapshot), user=None, db=db)
        db.expire_all()
        assert (await db.get(DoraArrangement, (pid, "ARR-1"))).open_ended is True


async def test_a_file_loaded_into_the_project_replaces_its_dora():
    from src.routes.projects import _reconstruct_data, update_project
    from src.schemas import ProjectUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _restore(db, pid, {"vendors": [{"id": "PP-1", "name": "Cloud"}], "assessments": [], "metadata": {},
                                 "dora": {"arrangements": [{"id": "ARR-1", "vendor_id": "PP-1", "arrangement_reference": "ARR-1"}]}})
        loaded = await _reconstruct_data(db, pid)
        loaded["dora"] = {"arrangements": [{"id": "ARR-2", "vendor_id": "PP-1", "arrangement_reference": "ARR-2"}]}
        await update_project(pid, ProjectUpdate(data=loaded), user=None, db=db)
        db.expire_all()
        assert await db.get(DoraArrangement, (pid, "ARR-1")) is None
        assert await db.get(DoraArrangement, (pid, "ARR-2")) is not None


@pytest.mark.parametrize("bad", [{"tier": "2"}, {"notice_period_days": "30"}, {"lei": 12345}])
async def test_a_value_of_the_wrong_type_is_cleared_not_a_failure(bad):
    from src.dora_validation import sanitize_dora_rows
    row = dict({"id": "ARR-1", "vendor_id": "PP-1", "arrangement_reference": "ARR-1", "currency": "EUR"}, **bad)
    sub = {"arrangement_id": "ARR-1", "subcontractor_id": "SUB-1", **({"tier": bad["tier"]} if "tier" in bad else {})}
    ent = {"id": "ENT-1", **({"lei": bad["lei"]} if "lei" in bad else {})}
    out = sanitize_dora_rows({"arrangements": [row], "subcontractors": [{"id": "SUB-1"}],
                              "arrangement_subcontractors": [sub], "entities": [ent]}, {"PP-1"})
    field, = bad
    table = {"tier": "arrangement_subcontractors", "lei": "entities"}.get(field, "arrangements")
    assert out[table][0][field] is None                     # cleared…
    assert out["arrangements"][0]["currency"] == "EUR"      # …its neighbours kept


async def test_templates_with_a_wrong_shape_are_dropped():
    from src.dora_validation import sanitize_templates
    ok = {"id": "T1", "sections": [{"id": "S", "questions": [{"id": "Q"}]}]}
    out = sanitize_templates([ok, {"id": "T2", "sections": "junk"}, {"id": "T3", "sections": [{"questions": "x"}]},
                              {"id": "T4", "sections": [{"questions": [{"id": "Q", "weight": "<b>2</b>"}]}], "version": "<b>"}])
    assert [t["id"] for t in out] == ["T1", "T4"]
    t4 = out[1]
    assert t4["version"] == 1 and t4["sections"][0]["questions"][0]["weight"] == 0   # numbers, never markup
