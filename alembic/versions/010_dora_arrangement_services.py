"""DORA: junction dora_arrangement_services for multi-ICT-service arrangements.

EBA RoI B_02.02.0060 (Type of ICT services) is a typology where a
single contractual arrangement may declare multiple service codes.
Until now we only stored a single ``nature_of_service`` string on
the arrangement; the export emitted one row per arrangement × RFE ×
function with that single value, losing any multi-service detail.

This migration:

1. Creates ``dora_arrangement_services`` (project_id, arrangement_id,
   service_code) — composite PK, FK cascade on the arrangement.
2. Backfills the junction from the legacy ``nature_of_service`` column
   so existing arrangements keep declaring exactly the service they
   already had.

The legacy ``dora_arrangements.nature_of_service`` column is kept
for now (read-only fallback). It can be dropped in a later migration
once all clients have migrated.

Revision ID: 010_dora_arr_services
Revises: 009_dora_entity_currency
Create Date: 2026-05-06

"""

from alembic import op
import sqlalchemy as sa


revision = "010_dora_arr_services"
down_revision = "009_dora_entity_currency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dora_arrangement_services",
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("arrangement_id", sa.String(length=30), nullable=False),
        sa.Column("service_code", sa.String(length=10), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id", "arrangement_id"],
            ["dora_arrangements.project_id", "dora_arrangements.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "arrangement_id", "service_code"),
    )

    # Backfill from nature_of_service. Only insert when the value
    # looks like a service code (S_xx) — freeform text is not migrated.
    op.execute(
        """
        INSERT INTO dora_arrangement_services (project_id, arrangement_id, service_code)
        SELECT project_id, id, nature_of_service
        FROM dora_arrangements
        WHERE nature_of_service IS NOT NULL
          AND nature_of_service ~ '^S_[0-9]{2}$'
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("dora_arrangement_services")
