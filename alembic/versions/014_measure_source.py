"""measure provenance (assessment → measure)

Revision ID: 014_measure_source
Revises: 013_measure_progress_log
Create Date: 2026-08-03

Adds provenance columns so a measure materialised from a vendor's assessment
action plan links back to its origin (assessment + question). Previously the
approval flow set these fields client-side but they were dropped by the schema.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "014_measure_source"
down_revision = "013_measure_progress_log"
branch_labels = None
depends_on = None

_COLS = ("source", "source_assessment_id", "source_question_id")


def upgrade() -> None:
    from sqlalchemy import inspect
    existing = {c["name"] for c in inspect(op.get_bind()).get_columns("vendor_measures")}
    for col in _COLS:
        if col not in existing:
            op.add_column(
                "vendor_measures",
                sa.Column(col, sa.String(50), nullable=True, server_default=""),
            )


def downgrade() -> None:
    for col in reversed(_COLS):
        op.drop_column("vendor_measures", col)
