"""Non-conformities and derogations (FEAT-45)

Revision ID: 017_nonconformities
Revises: 016_owner_set_null
Create Date: 2026-09-22

Two new tables shared in shape with every module: declared non-conformities
(with every item they concern) and time-boxed derogations. Here a derogation
covers a gap of a vendor assessment through its key
(project, assessment, question); nothing is written on the questionnaire —
the "under derogation" state is derived from the approved derogations, so the
assessment's answers stay exactly what the third party stated.

A record belongs to the project it was declared in; a record with no project
came from the console and stays module-level.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "017_nonconformities"
down_revision = "016_owner_set_null"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "nonconformities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("reference", sa.String(20), nullable=False, unique=True),
        sa.Column("source", sa.String(30), nullable=False, server_default="observation"),
        sa.Column("observed_at", sa.Date(), nullable=False),
        sa.Column("observed_by", sa.String(255), server_default=""),
        sa.Column("declared_by", sa.String(255), server_default=""),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), server_default=""),
        sa.Column("severity", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("evidence", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("domain", sa.String(100), server_default=""),
        sa.Column("requirement_ref", sa.String(200), server_default=""),
        sa.Column("subject_type", sa.String(50), server_default=""),
        sa.Column("subject_id", sa.String(200), server_default=""),
        sa.Column("subjects", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(30), nullable=False, server_default="to_qualify"),
        sa.Column("qualified_by", sa.String(255), server_default=""),
        sa.Column("qualified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_note", sa.Text(), server_default=""),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closure_evidence", sa.Text(), server_default=""),
        sa.Column("measure_ids", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("derogation_id", UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", sa.String(64), server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("ix_nonconformities_status", "nonconformities", ["status"])
    op.create_table(
        "derogations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("reference", sa.String(20), nullable=False, unique=True),
        sa.Column("subject_type", sa.String(50), nullable=False),
        sa.Column("subject_id", sa.String(200), nullable=False),
        sa.Column("subject_label", sa.String(500), server_default=""),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("justification", sa.Text(), nullable=False),
        sa.Column("risk_owner", sa.String(255), nullable=False),
        sa.Column("approver", sa.String(255), nullable=False),
        sa.Column("compensating_measure_ids", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=False),
        sa.Column("review_at", sa.Date(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending_approval"),
        sa.Column("requested_by", sa.String(255), server_default=""),
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("decided_by", sa.String(255), server_default=""),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), server_default=""),
        sa.Column("revoked_reason", sa.Text(), server_default=""),
        sa.Column("renews_id", UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", sa.String(64), server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )
    op.create_index("ix_derogations_status", "derogations", ["status"])
    op.create_index("ix_derogations_subject", "derogations", ["subject_type", "subject_id"])


def downgrade() -> None:
    op.drop_index("ix_derogations_subject", table_name="derogations")
    op.drop_index("ix_derogations_status", table_name="derogations")
    op.drop_table("derogations")
    op.drop_index("ix_nonconformities_status", table_name="nonconformities")
    op.drop_table("nonconformities")
