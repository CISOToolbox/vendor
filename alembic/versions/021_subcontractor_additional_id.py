"""Additional identifier of a subcontractor (BUG-114)

Revision ID: 021_subcontractor_additional_id
Revises: 020_subcontractor_person_type
Create Date: 2026-10-21

- dora_subcontractors.additional_id_type / additional_id_value
  (B_05.01.0030 / 0040): a subcontractor without a LEI is identified by them
  in B_05.01.0010 and B_05.02.0030 / 0060, as a vendor is. Nullable.
"""
from alembic import op
import sqlalchemy as sa

revision = "021_subcontractor_additional_id"
down_revision = "020_subcontractor_person_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dora_subcontractors", sa.Column("additional_id_type", sa.String(50), nullable=True))
    op.add_column("dora_subcontractors", sa.Column("additional_id_value", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("dora_subcontractors", "additional_id_value")
    op.drop_column("dora_subcontractors", "additional_id_type")
