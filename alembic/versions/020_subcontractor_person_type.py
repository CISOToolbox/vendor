"""Type of person of a subcontractor (BUG-113)

Revision ID: 020_subcontractor_person_type
Revises: 019_roi_export_complete
Create Date: 2026-10-21

- dora_subcontractors.person_type (B_05.01.0070): a subcontractor of the
  supply chain is reported in B_05.01 like a direct provider. Nullable:
  existing subcontractors show red until it is entered.
"""
from alembic import op
import sqlalchemy as sa

revision = "020_subcontractor_person_type"
down_revision = "019_roi_export_complete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dora_subcontractors", sa.Column("person_type", sa.String(50), nullable=True, server_default=""))


def downgrade() -> None:
    op.drop_column("dora_subcontractors", "person_type")
