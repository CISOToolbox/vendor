"""collapse to a single canonical project

Revision ID: 012_canonical_project
Revises: 011_dora_eba_completeness
Create Date: 2026-05-29

Single-project model (docs/CHANTIER_PROJET_UNIQUE.md): one client / one IS =
ONE project, with a well-known UUID shared across every module and Pilot.
Collapses an existing per-deployment random project onto the canonical id,
non-destructively (data repointed, not dropped).

  - 0 projects  → insert the canonical project.
  - 1 project, already canonical → no-op (idempotent).
  - 1 project, other id → rename to canonical, repoint every child table.
  - >1 projects → ABORT loudly (manual merge required).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "012_canonical_project"
down_revision = "011_dora_eba_completeness"
branch_labels = None
depends_on = None

CANONICAL = "00000000-0000-0000-0000-000000000001"

CHILD_TABLES = [
    "project_metadata",
    "vendors",
    "vendor_measures",
    "vendor_risks",
    "vendor_documents",
    "vendor_assessments",
    "dora_entities",
    "dora_functions",
    "dora_branches",
    "dora_consolidation_scope",
    "dora_arrangements",
    "dora_arrangement_services",
    "dora_arrangement_functions",
    "dora_arrangement_rfes",
    "dora_signers",
    "dora_subcontractors",
    "dora_arrangement_subcontractors",
]


def upgrade() -> None:
    conn = op.get_bind()
    ids = [str(r[0]) for r in conn.execute(sa.text("SELECT id FROM projects")).fetchall()]

    if CANONICAL in ids:
        others = [i for i in ids if i != CANONICAL]
        if others:
            raise RuntimeError(
                f"Canonical project coexists with {len(others)} other project(s) "
                f"({others}); manual merge required before this migration."
            )
        return

    if len(ids) == 0:
        conn.execute(
            sa.text("INSERT INTO projects (id, name) VALUES (:c, 'Projet principal')"),
            {"c": CANONICAL},
        )
        return

    if len(ids) > 1:
        raise RuntimeError(
            f"{len(ids)} projects found ({ids}); the single-project collapse requires "
            "exactly one. Merge them manually, then re-run."
        )

    old = ids[0]
    # Composite FKs + no ON UPDATE CASCADE → disable FK trigger enforcement for
    # THIS transaction only (SET LOCAL auto-reverts), rename the project id and
    # repoint every child. Requires DB superuser (suite per-module roles are).
    conn.execute(sa.text("SET LOCAL session_replication_role = 'replica'"))
    conn.execute(
        sa.text("UPDATE projects SET id = :c WHERE id = :old"),
        {"c": CANONICAL, "old": old},
    )
    for tbl in CHILD_TABLES:
        conn.execute(
            sa.text(f"UPDATE {tbl} SET project_id = :c WHERE project_id = :old"),
            {"c": CANONICAL, "old": old},
        )


def downgrade() -> None:
    # Irreversible by design (original random id not recoverable). No-op.
    pass
