"""DORA: widen entity/branch ID columns and add DoraFunction.code.

Two changes, both motivated by the EBA RoI ITS:

1. ``DoraEntity.id`` and ``DoraBranch.id`` (plus the ``DoraBranch.rfe_id``
   FK column that points back to ``DoraEntity.id``) were declared as
   ``String(20)``. The ITS does not impose a hard length on the user-
   chosen identifier but the closest analogue (LEI) is 20 chars, and
   the ``arrangement_reference`` column is already ``String(100)``. To
   give users room to type meaningful codes (e.g. ``RFE-MEDSECURE-FR``,
   ``BR-PARIS-LADEFENSE``) we widen all three to ``String(50)``.

2. Add ``DoraFunction.code`` (``String(50)``, nullable). The internal
   primary key ``DoraFunction.id`` is auto-generated (``FN-<rand>``)
   and is not user-friendly. We expose a separate ``code`` field that
   the user can edit — exported in the RoI as B_06.01.0010 "Function
   identifier". When empty, the ``id`` is used as a fallback so the
   existing data keeps exporting without manual intervention.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "008_dora_ids_fn_code"
down_revision = "007_dora_arr_its_alignment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Widen DoraEntity.id and FK columns referencing it.
    #    PostgreSQL requires dropping the FK before altering either side
    #    of the constraint. Two FKs point at dora_entities (project_id, id):
    #      - dora_branches_project_id_rfe_id_fkey
    #      - dora_arrangement_rfes_project_id_rfe_id_fkey
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Discover the actual constraint names — they vary slightly between
    # PostgreSQL versions and depending on whether the table was created
    # with explicit names. Filter by referenced columns.
    def _find_fk(table: str, local_cols: tuple[str, ...]) -> str | None:
        for fk in inspector.get_foreign_keys(table):
            if (
                fk.get("referred_table") == "dora_entities"
                and tuple(fk.get("constrained_columns") or ()) == local_cols
            ):
                return fk.get("name")
        return None

    branch_fk = _find_fk("dora_branches", ("project_id", "rfe_id")) \
        or "dora_branches_project_id_rfe_id_fkey"
    arr_rfe_fk = _find_fk("dora_arrangement_rfes", ("project_id", "rfe_id")) \
        or "dora_arrangement_rfes_project_id_rfe_id_fkey"

    op.drop_constraint(branch_fk, "dora_branches", type_="foreignkey")
    op.drop_constraint(arr_rfe_fk, "dora_arrangement_rfes", type_="foreignkey")

    op.alter_column(
        "dora_entities",
        "id",
        existing_type=sa.String(length=20),
        type_=sa.String(length=50),
        existing_nullable=False,
    )
    op.alter_column(
        "dora_branches",
        "id",
        existing_type=sa.String(length=20),
        type_=sa.String(length=50),
        existing_nullable=False,
    )
    op.alter_column(
        "dora_branches",
        "rfe_id",
        existing_type=sa.String(length=20),
        type_=sa.String(length=50),
        existing_nullable=False,
    )
    op.alter_column(
        "dora_arrangement_rfes",
        "rfe_id",
        existing_type=sa.String(length=20),
        type_=sa.String(length=50),
        existing_nullable=False,
    )

    op.create_foreign_key(
        "dora_branches_project_id_rfe_id_fkey",
        "dora_branches",
        "dora_entities",
        ["project_id", "rfe_id"],
        ["project_id", "id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "dora_arrangement_rfes_project_id_rfe_id_fkey",
        "dora_arrangement_rfes",
        "dora_entities",
        ["project_id", "rfe_id"],
        ["project_id", "id"],
        ondelete="CASCADE",
    )

    # 2. Add DoraFunction.code (user-editable RoI function identifier).
    op.add_column(
        "dora_functions",
        sa.Column("code", sa.String(length=50), nullable=True, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("dora_functions", "code")

    op.drop_constraint(
        "dora_branches_project_id_rfe_id_fkey",
        "dora_branches",
        type_="foreignkey",
    )
    op.drop_constraint(
        "dora_arrangement_rfes_project_id_rfe_id_fkey",
        "dora_arrangement_rfes",
        type_="foreignkey",
    )
    op.alter_column(
        "dora_arrangement_rfes",
        "rfe_id",
        existing_type=sa.String(length=50),
        type_=sa.String(length=20),
        existing_nullable=False,
    )
    op.alter_column(
        "dora_branches",
        "rfe_id",
        existing_type=sa.String(length=50),
        type_=sa.String(length=20),
        existing_nullable=False,
    )
    op.alter_column(
        "dora_branches",
        "id",
        existing_type=sa.String(length=50),
        type_=sa.String(length=20),
        existing_nullable=False,
    )
    op.alter_column(
        "dora_entities",
        "id",
        existing_type=sa.String(length=50),
        type_=sa.String(length=20),
        existing_nullable=False,
    )
    op.create_foreign_key(
        "dora_branches_project_id_rfe_id_fkey",
        "dora_branches",
        "dora_entities",
        ["project_id", "rfe_id"],
        ["project_id", "id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "dora_arrangement_rfes_project_id_rfe_id_fkey",
        "dora_arrangement_rfes",
        "dora_entities",
        ["project_id", "rfe_id"],
        ["project_id", "id"],
        ondelete="CASCADE",
    )
