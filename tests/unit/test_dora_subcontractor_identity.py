"""BUG-114 — a subcontractor without a LEI is identified by an additional
identifier of a type the EBA knows (B_05.02.0030 / 0060, B_05.01.0010), and a
LEI or an identifier already carried by another record of the same kind is
refused (one record, one key).

Same in-memory register as test_dora_export_complete.py."""
import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException

from src.models import Base, DoraArrangementSubcontractor, DoraSubcontractor
from tests.unit.test_dora_export_complete import LEI_SUBC, LEI_TPP, _engine, _export, _red_cells, _seed, _Session, _set
from tests.unit.test_dora_export_integrity import _add, _sheets, _violations

pytestmark = pytest.mark.asyncio
EUID = "IEBRN.123456"


@pytest_asyncio.fixture(autouse=True)
async def _db():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _no_lei(db, pid, _):
    sub = await db.get(DoraSubcontractor, (pid, "SUB-001"))
    sub.lei = None
    sub.additional_id_type = "EUID"
    sub.additional_id_value = EUID


async def test_a_subcontractor_without_a_lei_is_identified_by_its_additional_identifier():
    blob = await _export({_no_lei: None})
    rows = _sheets(blob)
    rank2 = [r for r in rows("B_05.02") if r[4] == 2]
    assert rank2 and rank2[0][2] == EUID and rank2[0][3] == "eba_qCO:qx2002"
    rank3 = [r for r in rows("B_05.02") if r[4] == 3]
    assert rank3 and rank3[0][5] == EUID and rank3[0][6] == "eba_qCO:qx2002"   # its recipient at rank n-1
    sub_row = [r for r in rows("B_05.01") if r[0] == EUID]
    assert len(sub_row) == 1 and sub_row[0][1] == "eba_qCO:qx2002" and sub_row[0][4] == "DC Ops"
    assert not [c for c in _red_cells(blob) if c.startswith(("B_05.02", "B_05.01"))]
    assert _violations(blob) == []


async def test_a_subcontractor_with_a_lei_also_reports_its_additional_identifier():
    async def extra(db, pid, _):
        sub = await db.get(DoraSubcontractor, (pid, "SUB-001"))
        sub.additional_id_type = "EUID"
        sub.additional_id_value = EUID
    row = [r for r in _sheets(await _export({extra: None}))("B_05.01") if r[0] == LEI_SUBC]
    assert row and row[0][2] == EUID and row[0][3] == "eba_qCO:qx2002"


async def test_an_additional_identifier_without_an_eba_type_is_refused():
    from src.routes.dora import update_subcontractor
    from src.schemas import DoraSubcontractorUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        with pytest.raises(HTTPException) as exc:
            await update_subcontractor(pid, "SUB-001", DoraSubcontractorUpdate(additional_id_type="robot"), user=None, db=db)
        assert exc.value.status_code == 422
        out = await update_subcontractor(pid, "SUB-001", DoraSubcontractorUpdate(additional_id_type="EUID",
                                         additional_id_value=EUID), user=None, db=db)
        assert (out.additional_id_value if not isinstance(out, dict) else out["additional_id_value"]) == EUID


async def test_a_lei_already_carried_by_another_subcontractor_is_refused():
    from src.routes.dora import create_subcontractor, update_subcontractor
    from src.schemas import DoraSubcontractorCreate, DoraSubcontractorUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        with pytest.raises(HTTPException) as exc:
            await create_subcontractor(pid, DoraSubcontractorCreate(id="SUB-009", name="Dup", lei=LEI_SUBC.lower()),
                                       user=None, db=db)
        assert exc.value.status_code == 422 and "DC Ops" in exc.value.detail
        with pytest.raises(HTTPException):
            await update_subcontractor(pid, "SUB-002", DoraSubcontractorUpdate(lei=LEI_SUBC), user=None, db=db)
        # Its own LEI, re-sent, and a vendor's LEI (a provider that is also a subcontractor) are accepted.
        await update_subcontractor(pid, "SUB-001", DoraSubcontractorUpdate(lei=LEI_SUBC), user=None, db=db)
        await create_subcontractor(pid, DoraSubcontractorCreate(id="SUB-010", name="Cloud as sub", lei=LEI_TPP),
                                   user=None, db=db)


async def test_an_additional_identifier_already_carried_by_another_subcontractor_is_refused():
    from src.routes.dora import create_subcontractor
    from src.schemas import DoraSubcontractorCreate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid, {_no_lei: None})
        with pytest.raises(HTTPException) as exc:
            await create_subcontractor(pid, DoraSubcontractorCreate(id="SUB-009", name="Dup", additional_id_type="EUID",
                                                                    additional_id_value=EUID), user=None, db=db)
        assert exc.value.status_code == 422


async def test_a_lei_already_carried_by_another_vendor_is_refused():
    from src.routes.dora import patch_vendor_roi
    from src.schemas import DoraVendorRoIPatch
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        with pytest.raises(HTTPException) as exc:
            await patch_vendor_roi(pid, "PP-004", DoraVendorRoIPatch(lei=LEI_TPP.lower()), user=None, db=db)
        assert exc.value.status_code == 422 and "Cloud Corp" in exc.value.detail
        await patch_vendor_roi(pid, "PP-002", DoraVendorRoIPatch(lei=LEI_TPP), user=None, db=db)   # its own


async def test_a_vendor_additional_identifier_already_carried_by_another_vendor_is_refused():
    from src.routes.dora import patch_vendor_roi
    from src.schemas import DoraVendorRoIPatch
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        with pytest.raises(HTTPException) as exc:   # PP-004 carries EUID FRRCS.123456789
            await patch_vendor_roi(pid, "PP-003", DoraVendorRoIPatch(additional_id_type="EUID",
                                   additional_id_value="FRRCS.123456789"), user=None, db=db)
        assert exc.value.status_code == 422


async def test_a_subcontractor_link_without_any_code_still_shows_red():
    async def nothing(db, pid, _):
        sub = await db.get(DoraSubcontractor, (pid, "SUB-001"))
        sub.lei = None
    blob = await _export({nothing: None})
    assert [c for c in _red_cells(blob) if c.startswith("B_05.02.0030")]
    _ = (DoraArrangementSubcontractor, _add, _set)


async def test_the_project_save_refuses_a_new_duplicate_lei_but_keeps_an_old_one():
    from src.dora_validation import new_duplicate_codes
    stored = [{"name": "A", "lei": LEI_TPP}, {"name": "B", "lei": ""}]
    assert new_duplicate_codes([{"name": "A", "lei": LEI_TPP}, {"name": "B", "lei": LEI_TPP.lower()}], stored)
    old = [{"name": "A", "lei": LEI_TPP}, {"name": "B", "lei": LEI_TPP}]
    assert new_duplicate_codes(old, old) == []   # a duplicate stored before: the save still goes through
    assert new_duplicate_codes([{"name": "A", "additional_id_type": "EUID", "additional_id_value": EUID},
                                {"name": "B", "additional_id_type": "EUID", "additional_id_value": EUID + " "}], []) != []


async def test_the_project_save_route_refuses_a_new_duplicate_lei():
    from src.routes.projects import _reconstruct_data, update_project
    from src.schemas import ProjectUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        data = await _reconstruct_data(db, pid)
        for v in data["vendors"]:
            if v["id"] == "PP-004":
                v["lei"] = LEI_TPP
        with pytest.raises(HTTPException) as exc:
            await update_project(pid, ProjectUpdate(data=data), user=None, db=db)
        assert exc.value.status_code == 422 and LEI_TPP in exc.value.detail


# ── Review of BUG-114 ──


async def test_the_project_save_refuses_a_new_duplicate_subcontractor_lei():
    from src.routes.projects import _reconstruct_data, update_project
    from src.schemas import ProjectUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        data = await _reconstruct_data(db, pid)
        for s in data["dora"]["subcontractors"]:
            if s["id"] == "SUB-002":
                s["lei"] = LEI_SUBC
        with pytest.raises(HTTPException) as exc:
            await update_project(pid, ProjectUpdate(data=data), user=None, db=db)
        assert exc.value.status_code == 422


async def _dup_subs(db, pid, _):
    sub = await db.get(DoraSubcontractor, (pid, "SUB-002"))
    sub.lei = LEI_SUBC   # a duplicate stored before BUG-114


async def test_a_stored_duplicate_does_not_block_an_unrelated_change():
    from src.routes.dora import update_subcontractor
    from src.schemas import DoraSubcontractorUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid, {_dup_subs: None})
        # The identity modal sends the whole identity, LEI unchanged.
        await update_subcontractor(pid, "SUB-002", DoraSubcontractorUpdate(name="Renamed", lei=LEI_SUBC, country_iso2="FR"),
                                   user=None, db=db)
        await update_subcontractor(pid, "SUB-002", DoraSubcontractorUpdate(additional_id_type="EUID",
                                   additional_id_value=EUID), user=None, db=db)


async def test_a_stored_duplicate_vendor_lei_does_not_block_its_additional_identifier():
    from src.models import Vendor
    from src.routes.dora import patch_vendor_roi
    from src.schemas import DoraVendorRoIPatch

    async def dup(db, pid, _):
        (await db.get(Vendor, (pid, "PP-003"))).lei = LEI_TPP
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid, {dup: None})
        await patch_vendor_roi(pid, "PP-003", DoraVendorRoIPatch(additional_id_type="VAT", additional_id_value="IE999"),
                               user=None, db=db)


async def test_two_types_with_one_eba_code_are_one_code():
    from src.routes.dora import update_subcontractor
    from src.schemas import DoraSubcontractorUpdate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        await update_subcontractor(pid, "SUB-001", DoraSubcontractorUpdate(additional_id_type="VAT",
                                   additional_id_value="FR123"), user=None, db=db)
        with pytest.raises(HTTPException):   # tax_id and VAT are both eba_qCO:qx2004
            await update_subcontractor(pid, "SUB-002", DoraSubcontractorUpdate(additional_id_type="tax_id",
                                       additional_id_value="FR123"), user=None, db=db)


async def test_an_identifier_type_without_an_eba_code_is_refused():
    from src.routes.dora import patch_vendor_roi, update_subcontractor
    from src.schemas import DoraSubcontractorUpdate, DoraVendorRoIPatch
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        with pytest.raises(HTTPException) as exc:
            await update_subcontractor(pid, "SUB-001", DoraSubcontractorUpdate(additional_id_type="other"), user=None, db=db)
        assert exc.value.status_code == 422
        with pytest.raises(HTTPException):
            await patch_vendor_roi(pid, "PP-004", DoraVendorRoIPatch(additional_id_type="other"), user=None, db=db)


async def test_a_stored_type_without_an_eba_code_does_not_block_an_unrelated_change():
    from src.models import Vendor
    from src.routes.dora import patch_vendor_roi, update_subcontractor
    from src.schemas import DoraSubcontractorUpdate, DoraVendorRoIPatch

    async def other(db, pid, _):
        sub = await db.get(DoraSubcontractor, (pid, "SUB-002"))
        sub.additional_id_type, sub.additional_id_value = "other", "X-1"
        v = await db.get(Vendor, (pid, "PP-003"))
        v.additional_id_type, v.additional_id_value = "other", "X-2"
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid, {other: None})
        # The identity modal sends the whole identity, its stored type included.
        await update_subcontractor(pid, "SUB-002", DoraSubcontractorUpdate(
            name="Renamed", lei="5493000IBP32UQZ0KL24", country_iso2="IE",
            additional_id_type="other", additional_id_value="X-1"), user=None, db=db)
        await patch_vendor_roi(pid, "PP-003", DoraVendorRoIPatch(additional_id_type="other", additional_id_value="X-3"),
                               user=None, db=db)


async def test_a_new_subcontractor_with_a_type_without_an_eba_code_is_refused():
    from src.routes.dora import create_subcontractor
    from src.schemas import DoraSubcontractorCreate
    async with _Session() as db:
        pid = uuid.uuid4()
        await _seed(db, pid)
        with pytest.raises(HTTPException) as exc:
            await create_subcontractor(pid, DoraSubcontractorCreate(id="SUB-011", name="New", additional_id_type="other",
                                                                    additional_id_value="X"), user=None, db=db)
        assert exc.value.status_code == 422
