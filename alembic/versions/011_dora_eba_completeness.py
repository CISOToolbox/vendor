"""DORA: arrangement + function fields required for full EBA RoI export.

Audit of dora_export.py vs the EBA RoI ITS revealed several columns
emitted as empty strings ("not modelled" comments) because no model
column backed them. This migration closes those gaps:

Arrangement-level (sheet B_02.01, B_02.02, B_07.01):
- ``reliance_level``                  B_02.02.0180 — eba_ZZ:x794..x797
- ``impact_discontinuing_level``      B_07.01.0100 — eba_ZZ:x791..x793/x799
- ``alternative_tpp_id``              B_07.01.0110 — free identifier of the alternative TPSP
- ``notice_period_tpsp_days``         B_02.02.0110 — TPSP-side notice period (days)
- ``termination_reason``              B_02.02.0090 — eba_CO:x4..x9
- ``parent_arrangement_id``           B_02.01.0030 — reference of the overarching arrangement

Function-level (sheet B_06.01):
- ``last_assessment_date``            B_06.01.0070 — YYYY-MM-DD

All columns are nullable; existing rows simply default to NULL/empty
in the export, matching today's behavior. No backfill needed.

Revision ID: 011_dora_eba_completeness
Revises: 010_dora_arr_services
Create Date: 2026-05-06

"""

from alembic import op
import sqlalchemy as sa


revision = "011_dora_eba_completeness"
down_revision = "010_dora_arr_services"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dora_arrangements", sa.Column("reliance_level", sa.String(length=30), nullable=True))
    op.add_column("dora_arrangements", sa.Column("impact_discontinuing_level", sa.String(length=30), nullable=True))
    op.add_column("dora_arrangements", sa.Column("alternative_tpp_id", sa.String(length=200), nullable=True))
    op.add_column("dora_arrangements", sa.Column("notice_period_tpsp_days", sa.Integer(), nullable=True))
    op.add_column("dora_arrangements", sa.Column("termination_reason", sa.String(length=30), nullable=True))
    op.add_column("dora_arrangements", sa.Column("parent_arrangement_id", sa.String(length=30), nullable=True))

    op.add_column("dora_functions", sa.Column("last_assessment_date", sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column("dora_functions", "last_assessment_date")
    op.drop_column("dora_arrangements", "parent_arrangement_id")
    op.drop_column("dora_arrangements", "termination_reason")
    op.drop_column("dora_arrangements", "notice_period_tpsp_days")
    op.drop_column("dora_arrangements", "alternative_tpp_id")
    op.drop_column("dora_arrangements", "impact_discontinuing_level")
    op.drop_column("dora_arrangements", "reliance_level")
