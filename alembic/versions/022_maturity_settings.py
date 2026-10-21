"""Vendor-maturity settings are saved (BUG-115)

Revision ID: 022_maturity_settings
Revises: 021_subcontractor_additional_id
Create Date: 2026-10-21

- vendor_assessments.weight_override (nullable) and excluded (false): an
  assessment's weight in the vendor's maturity, and whether it counts.
- project_metadata.maturity_config (JSONB, nullable): weights by kind and by
  template, decay per quarter, minimum weight. NULL keeps the app defaults.
Before, the server dropped all three: they were lost on reload.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "022_maturity_settings"
down_revision = "021_subcontractor_additional_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vendor_assessments", sa.Column("weight_override", sa.Float(), nullable=True))
    op.add_column("vendor_assessments", sa.Column("excluded", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("project_metadata", sa.Column("maturity_config", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("project_metadata", "maturity_config")
    op.drop_column("vendor_assessments", "excluded")
    op.drop_column("vendor_assessments", "weight_override")
