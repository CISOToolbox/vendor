"""DORA: add DoraEntity.total_assets_currency (B_01.02.0100).

The EBA RoI ITS pairs the value of total assets (B_01.02.0110) with its
currency (B_01.02.0100). Until now we only stored ``total_assets`` and
emitted an empty string in column 0100 of the export, which broke
consumers expecting the paired currency. This adds the column with a
sensible "EUR" default for existing rows.

Revision ID: 009_dora_entity_currency
Revises: 008_dora_ids_fn_code
Create Date: 2026-05-06

"""

from alembic import op
import sqlalchemy as sa


revision = "009_dora_entity_currency"
down_revision = "008_dora_ids_fn_code"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "dora_entities",
        sa.Column(
            "total_assets_currency",
            sa.String(length=3),
            nullable=True,
            server_default=sa.text("'EUR'"),
        ),
    )
    op.execute(
        "UPDATE dora_entities SET total_assets_currency = 'EUR' "
        "WHERE total_assets_currency IS NULL"
    )


def downgrade() -> None:
    op.drop_column("dora_entities", "total_assets_currency")
