"""Regression: child-entity mutations must enforce edit/delete permission.

Access child routes (si_users, service_accounts, reviews, …) used to gate only
project READ access via get_project_or_404, so a read-only viewer could still
create/edit/delete entities through the API. get_project_or_404 now takes a
require_perm and enforces it via the module permission model.
"""
import asyncio
import os
import sys
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault("MODULE_NAME", "vendor")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from routes.auth_helpers import get_project_or_404  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class _Result:
    def __init__(self, project):
        self._p = project

    def scalar_one_or_none(self):
        return self._p


def _db(project):
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_Result(project))
    return db


def _user(module_role, role="user"):
    u = SimpleNamespace(id=uuid.uuid4(), role=role)
    u._module_role = module_role
    return u


def _call(user, require_perm):
    # Patch auth_enabled in both namespaces (get_project_or_404 + _user_permissions)
    # so the test is independent of JWT_SECRET / test import order.
    proj = SimpleNamespace(id=uuid.uuid4(), owner_id=None, shared_with=[])
    with patch("routes.auth_helpers.auth_enabled", return_value=True), \
         patch("src.routes.projects.auth_enabled", return_value=True):
        return asyncio.run(get_project_or_404(str(proj.id), user, _db(proj), require_perm=require_perm))


def _denied(user, require_perm):
    try:
        _call(user, require_perm)
        return False
    except HTTPException as e:
        return e.status_code == 403


def test_viewer_can_read_but_not_edit_or_delete():
    v = _user("viewer")
    assert _call(v, "read") is not None      # can read the review data
    assert _denied(v, "edit")                # but not mutate
    assert _denied(v, "delete")


def test_editor_can_edit_but_not_delete():
    e = _user("editor")
    assert _call(e, "edit") is not None
    assert _denied(e, "delete")              # delete is admin-only in access


def test_plain_user_can_edit_but_not_delete():
    u = _user("user")
    assert _call(u, "edit") is not None      # no lockout for plain user
    assert _denied(u, "delete")


def test_admin_can_delete():
    a = _user("admin")
    assert _call(a, "delete") is not None
