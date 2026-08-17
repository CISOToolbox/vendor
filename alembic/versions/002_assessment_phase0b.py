"""Add phase 0b columns to vendor_assessments

New fields to support template-driven assessments, coverage statuses,
action plans, maturity pondération and the approval workflow. See
src/assessment_validation.py for the complete data contract and the
server-side rules that enforce immutability / completeness / status
transitions.

Columns added (all nullable so legacy assessments stay valid):
  - type               String(30) default 'periodic'
  - due_date           String(20)
  - template_id        String(30)
  - template_version   Integer
  - template_snapshot  JSONB       (frozen at creation — see R1)
  - self_validation    Boolean     default false
  - self_validated_at  String(40)
  - submitted_at       String(40)  (server-assigned — see R7)
  - approved_at        String(40)  (server-assigned)
  - approved_by        String(255) (server-assigned)
  - rejected_reason    Text
  - completion_rate    Integer     default 0
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision = "002_assessment_phase0b"
down_revision = "001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vendor_assessments", sa.Column("type", sa.String(30), nullable=True, server_default="periodic"))
    op.add_column("vendor_assessments", sa.Column("due_date", sa.String(20), nullable=True, server_default=""))
    op.add_column("vendor_assessments", sa.Column("template_id", sa.String(30), nullable=True))
    op.add_column("vendor_assessments", sa.Column("template_version", sa.Integer(), nullable=True))
    op.add_column("vendor_assessments", sa.Column("template_snapshot", JSONB(), nullable=True))
    op.add_column(
        "vendor_assessments",
        sa.Column("self_validation", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("vendor_assessments", sa.Column("self_validated_at", sa.String(40), nullable=True))
    op.add_column("vendor_assessments", sa.Column("submitted_at", sa.String(40), nullable=True))
    op.add_column("vendor_assessments", sa.Column("approved_at", sa.String(40), nullable=True))
    op.add_column("vendor_assessments", sa.Column("approved_by", sa.String(255), nullable=True))
    op.add_column("vendor_assessments", sa.Column("rejected_reason", sa.Text(), nullable=True))
    op.add_column(
        "vendor_assessments",
        sa.Column("completion_rate", sa.Integer(), nullable=True, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("vendor_assessments", "completion_rate")
    op.drop_column("vendor_assessments", "rejected_reason")
    op.drop_column("vendor_assessments", "approved_by")
    op.drop_column("vendor_assessments", "approved_at")
    op.drop_column("vendor_assessments", "submitted_at")
    op.drop_column("vendor_assessments", "self_validated_at")
    op.drop_column("vendor_assessments", "self_validation")
    op.drop_column("vendor_assessments", "template_snapshot")
    op.drop_column("vendor_assessments", "template_version")
    op.drop_column("vendor_assessments", "template_id")
    op.drop_column("vendor_assessments", "due_date")
    op.drop_column("vendor_assessments", "type")
