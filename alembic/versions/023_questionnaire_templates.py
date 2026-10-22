"""Questionnaire templates are saved with the project (BUG-120)

Revision ID: 023_questionnaire_templates
Revises: 022_maturity_settings
Create Date: 2026-10-22

- project_metadata.questionnaire_templates (JSONB, nullable): the project's
  questionnaire and audit templates. The whole-project save carried them, the
  server dropped them: a template created or duplicated was lost on reload.
  NULL keeps the app defaults.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "023_questionnaire_templates"
down_revision = "022_maturity_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("project_metadata", sa.Column("questionnaire_templates", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("project_metadata", "questionnaire_templates")
