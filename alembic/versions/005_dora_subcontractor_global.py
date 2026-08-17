"""DORA: globalize subcontractor identity, add arrangement junction

Splits ``dora_subcontractors`` into two tables:

  * ``dora_subcontractors`` keeps only the **identity** of the legal
    entity (project-scoped: ``project_id`` + ``id`` + ``name`` + ``lei``
    + ``country_iso2`` + ``sector`` + ``additional_info``).

  * ``dora_arrangement_subcontractors`` (new junction) holds the
    **per-link** attributes that vary across arrangements: ``tier``,
    ``service_provided``, ``is_critical_function_support``,
    ``parent_subcontractor_id``, ``data_country``, ``sort_order``.

Reasoning: in the EBA RoI ITS, the same legal entity (a hyperscaler,
Stripe, Twilio…) routinely appears as sub-processor under multiple
arrangements — sometimes for different vendors. The previous one-to-many
shape forced creating a new identity row per arrangement, generating
duplicate LEIs and preventing cross-arrangement navigation.

Data migration strategy: existing ``id`` values are unique only within
``(project_id, arrangement_id)``. To globalize them inside a project we
prefix the id with the arrangement id (``A1-SUB-001``). ``parent_subcontractor_id``
references are rewritten with the same prefix.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "005_dora_subcontractor_global"
down_revision = "004_dora_multi_function"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create the junction table without the sub-FK (we add it after
    #    we have prefixed sub ids in step 2).
    op.create_table(
        "dora_arrangement_subcontractors",
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("arrangement_id", sa.String(30), nullable=False),
        sa.Column("subcontractor_id", sa.String(30), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tier", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("service_provided", sa.Text(), nullable=True),
        sa.Column(
            "is_critical_function_support",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("FALSE"),
        ),
        sa.Column("parent_subcontractor_id", sa.String(30), nullable=True),
        sa.Column("data_country", sa.String(2), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "arrangement_id"],
            ["dora_arrangements.project_id", "dora_arrangements.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "arrangement_id", "subcontractor_id"),
    )

    # 2. Prefix existing sub ids with arrangement_id so they become
    #    unique within the project. Rewrite parent_subcontractor_id
    #    references with the same prefix BEFORE rewriting id, otherwise
    #    we'd lose the source mapping.
    op.execute(
        """
        UPDATE dora_subcontractors
           SET parent_subcontractor_id = arrangement_id || '-' || parent_subcontractor_id
         WHERE parent_subcontractor_id IS NOT NULL
           AND parent_subcontractor_id <> ''
        """
    )
    op.execute("UPDATE dora_subcontractors SET id = arrangement_id || '-' || id")

    # 3. Copy the per-link attributes into the junction.
    op.execute(
        """
        INSERT INTO dora_arrangement_subcontractors
          (project_id, arrangement_id, subcontractor_id, sort_order, tier,
           service_provided, is_critical_function_support,
           parent_subcontractor_id, data_country, created_at, updated_at)
        SELECT project_id, arrangement_id, id, sort_order, tier,
               service_provided, is_critical_function_support,
               parent_subcontractor_id, data_country, created_at, updated_at
          FROM dora_subcontractors
        """
    )

    # 4. Drop the (project_id, arrangement_id) FK and its companion index.
    op.drop_index("ix_dora_subcontractors_arr_tier", table_name="dora_subcontractors")
    op.drop_constraint(
        "dora_subcontractors_project_id_arrangement_id_fkey",
        "dora_subcontractors",
        type_="foreignkey",
    )

    # 5. Change PK from (project_id, arrangement_id, id) to (project_id, id).
    op.execute("ALTER TABLE dora_subcontractors DROP CONSTRAINT dora_subcontractors_pkey")
    op.create_primary_key(
        "dora_subcontractors_pkey",
        "dora_subcontractors",
        ["project_id", "id"],
    )

    # 6. Drop the columns that moved into the junction.
    op.drop_column("dora_subcontractors", "arrangement_id")
    op.drop_column("dora_subcontractors", "tier")
    op.drop_column("dora_subcontractors", "service_provided")
    op.drop_column("dora_subcontractors", "is_critical_function_support")
    op.drop_column("dora_subcontractors", "parent_subcontractor_id")
    op.drop_column("dora_subcontractors", "data_country")
    # Keep dora_subcontractors.sort_order — it now orders the global sub list.

    # 7. Add the FK from the junction to the now-globalized identity.
    op.create_foreign_key(
        "dora_arr_subs_sub_fkey",
        "dora_arrangement_subcontractors",
        "dora_subcontractors",
        ["project_id", "subcontractor_id"],
        ["project_id", "id"],
        ondelete="CASCADE",
    )

    # 8. Useful indexes on the junction.
    op.create_index(
        "ix_dora_arrangement_subcontractors_arr_tier",
        "dora_arrangement_subcontractors",
        ["project_id", "arrangement_id", "tier"],
    )
    op.create_index(
        "ix_dora_arrangement_subcontractors_sub",
        "dora_arrangement_subcontractors",
        ["project_id", "subcontractor_id"],
    )

    # 9. Add an optional `sector` column to the global identity (EBA
    #    RoI does not strictly require it, but vendors often track it).
    op.add_column(
        "dora_subcontractors",
        sa.Column("sector", sa.String(100), nullable=True),
    )


def downgrade() -> None:
    # Re-add the per-link columns on dora_subcontractors.
    op.drop_column("dora_subcontractors", "sector")
    op.add_column(
        "dora_subcontractors",
        sa.Column("data_country", sa.String(2), nullable=True),
    )
    op.add_column(
        "dora_subcontractors",
        sa.Column(
            "is_critical_function_support",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("FALSE"),
        ),
    )
    op.add_column(
        "dora_subcontractors",
        sa.Column("service_provided", sa.Text(), nullable=True),
    )
    op.add_column(
        "dora_subcontractors",
        sa.Column("tier", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "dora_subcontractors",
        sa.Column("parent_subcontractor_id", sa.String(30), nullable=True),
    )
    op.add_column(
        "dora_subcontractors",
        sa.Column("arrangement_id", sa.String(30), nullable=True),
    )

    # Best-effort restore: pick the first arrangement for each sub.
    op.execute(
        """
        UPDATE dora_subcontractors s
           SET arrangement_id = j.arrangement_id,
               tier = j.tier,
               service_provided = j.service_provided,
               is_critical_function_support = j.is_critical_function_support,
               parent_subcontractor_id = j.parent_subcontractor_id,
               data_country = j.data_country
          FROM (
              SELECT DISTINCT ON (project_id, subcontractor_id)
                     project_id, subcontractor_id, arrangement_id, tier,
                     service_provided, is_critical_function_support,
                     parent_subcontractor_id, data_country
                FROM dora_arrangement_subcontractors
            ORDER BY project_id, subcontractor_id, tier
          ) j
         WHERE s.project_id = j.project_id
           AND s.id = j.subcontractor_id
        """
    )

    op.alter_column("dora_subcontractors", "arrangement_id", nullable=False)

    op.drop_index(
        "ix_dora_arrangement_subcontractors_sub",
        table_name="dora_arrangement_subcontractors",
    )
    op.drop_index(
        "ix_dora_arrangement_subcontractors_arr_tier",
        table_name="dora_arrangement_subcontractors",
    )

    op.execute("ALTER TABLE dora_subcontractors DROP CONSTRAINT dora_subcontractors_pkey")
    op.create_primary_key(
        "dora_subcontractors_pkey",
        "dora_subcontractors",
        ["project_id", "arrangement_id", "id"],
    )
    op.create_foreign_key(
        "dora_subcontractors_project_id_arrangement_id_fkey",
        "dora_subcontractors",
        "dora_arrangements",
        ["project_id", "arrangement_id"],
        ["project_id", "id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_dora_subcontractors_arr_tier",
        "dora_subcontractors",
        ["project_id", "arrangement_id", "tier"],
    )

    op.drop_table("dora_arrangement_subcontractors")
