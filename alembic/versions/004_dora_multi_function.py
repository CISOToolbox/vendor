"""DORA: support multiple functions per arrangement

Replaces the single-valued `function_id` column on `dora_arrangements`
with a junction table `dora_arrangement_functions`. Existing
`function_id` values (if any) are migrated into the junction before
the column is dropped.

Reasoning: an EBA RoI arrangement (B_03.02) can cover multiple
critical/important functions (B_02.02). Modeling this as a single
foreign key forced artificial duplicates and lost the many-to-many
nature of the contractual relation.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "004_dora_multi_function"
down_revision = "003_dora_roi"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create the junction table.
    op.create_table(
        "dora_arrangement_functions",
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("arrangement_id", sa.String(30), nullable=False),
        sa.Column("function_id", sa.String(50), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id", "arrangement_id"],
            ["dora_arrangements.project_id", "dora_arrangements.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "function_id"],
            ["dora_functions.project_id", "dora_functions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "arrangement_id", "function_id"),
    )

    # 2. Migrate existing single-valued function_id rows.
    op.execute(
        """
        INSERT INTO dora_arrangement_functions (project_id, arrangement_id, function_id)
        SELECT project_id, id, function_id
        FROM dora_arrangements
        WHERE function_id IS NOT NULL AND function_id <> ''
        ON CONFLICT DO NOTHING
        """
    )

    # 3. Drop the old index, FK constraint, and column.
    op.drop_index("ix_dora_arrangements_function", table_name="dora_arrangements")
    op.drop_constraint(
        "dora_arrangements_project_id_function_id_fkey",
        "dora_arrangements",
        type_="foreignkey",
    )
    op.drop_column("dora_arrangements", "function_id")


def downgrade() -> None:
    # Restore the column (nullable, no default).
    op.add_column(
        "dora_arrangements",
        sa.Column("function_id", sa.String(50), nullable=True),
    )
    op.create_foreign_key(
        "dora_arrangements_project_id_function_id_fkey",
        "dora_arrangements",
        "dora_functions",
        ["project_id", "function_id"],
        ["project_id", "id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_dora_arrangements_function",
        "dora_arrangements",
        ["project_id", "function_id"],
    )
    # Best-effort backfill: pick first function from the junction.
    op.execute(
        """
        UPDATE dora_arrangements a
           SET function_id = f.function_id
          FROM (
              SELECT DISTINCT ON (project_id, arrangement_id)
                     project_id, arrangement_id, function_id
                FROM dora_arrangement_functions
            ORDER BY project_id, arrangement_id, function_id
          ) f
         WHERE a.project_id = f.project_id
           AND a.id = f.arrangement_id
        """
    )
    op.drop_table("dora_arrangement_functions")
