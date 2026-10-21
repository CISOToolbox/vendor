"""BUG-112 — a vendor's ultimate parent, picked among the project's vendors,
is saved. The picker sends the parent vendor's id ("PP-001"); it used to be
checked as a LEI and refused (422), so the parent was never stored."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from src.dora_validation import validate_vendor_roi  # noqa: E402


def test_a_vendor_of_the_project_is_accepted_as_ultimate_parent():
    validate_vendor_roi({"ultimate_parent_id": "PP-001"}, vendor_ids={"PP-001", "PP-002"}, self_id="PP-002")


def test_a_lei_is_still_accepted():
    validate_vendor_roi({"ultimate_parent_id": "529900T8BM49AURSDO55"}, vendor_ids={"PP-002"}, self_id="PP-002")


def test_clearing_the_parent_is_accepted():
    validate_vendor_roi({"ultimate_parent_id": ""}, vendor_ids={"PP-002"}, self_id="PP-002")
    validate_vendor_roi({"ultimate_parent_id": None}, vendor_ids={"PP-002"}, self_id="PP-002")


@pytest.mark.parametrize("value", ["PP-999", "not a lei", "PP-002"])
def test_an_unknown_vendor_or_the_vendor_itself_is_refused(value):
    with pytest.raises(Exception) as exc:
        validate_vendor_roi({"ultimate_parent_id": value}, vendor_ids={"PP-001", "PP-002"}, self_id="PP-002")
    assert exc.value.status_code == 422
