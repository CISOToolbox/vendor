"""Add DORA Register of Information tables (EBA Reg. (EU) 2024/2956)

Adds 8 new tables for the granular DORA RoI data model:
  - dora_entities          (RFE — reporting financial entity)
  - dora_functions         (B_02.02)
  - dora_branches          (B_01.03)
  - dora_consolidation_scope (B_01.01 / B_01.02)
  - dora_arrangements      (B_03.02 — ICT contractual arrangement)
  - dora_arrangement_rfes  (junction RFE × Arrangement)
  - dora_signers           (B_03.03 — signers of the arrangement)
  - dora_subcontractors    (B_04.01 — sub-contracting chain)

Plus 9 additive nullable columns on `vendors` for RoI reporting:
  lei, legal_name_latin, person_type, entity_nature,
  additional_id_type, additional_id_value, additional_id_issuer,
  ultimate_parent_id, country_iso2.

Granular persistence rationale: every column is mutated via a
targeted PATCH/POST/DELETE in routes/dora.py. The legacy blob
PUT /api/projects/{id} path NEVER touches these tables.

If a developer DB still has revision '003_dora_persistence' from the
prior reverted attempt in alembic_version, run:
    DELETE FROM alembic_version WHERE version_num='003_dora_persistence';
before `alembic upgrade head`.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "003_dora_roi"
down_revision = "002_assessment_phase0b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Vendors: RoI additive columns ──
    op.add_column("vendors", sa.Column("lei", sa.String(20), nullable=True))
    op.add_column("vendors", sa.Column("legal_name_latin", sa.String(255), nullable=True))
    op.add_column("vendors", sa.Column("person_type", sa.String(20), nullable=True))
    op.add_column("vendors", sa.Column("entity_nature", sa.String(50), nullable=True))
    op.add_column("vendors", sa.Column("additional_id_type", sa.String(50), nullable=True))
    op.add_column("vendors", sa.Column("additional_id_value", sa.String(100), nullable=True))
    op.add_column("vendors", sa.Column("additional_id_issuer", sa.String(255), nullable=True))
    op.add_column("vendors", sa.Column("ultimate_parent_id", sa.String(20), nullable=True))
    op.add_column("vendors", sa.Column("country_iso2", sa.String(2), nullable=True))
    op.create_index("ix_vendors_project_lei", "vendors", ["project_id", "lei"])

    # ── dora_functions ──
    op.create_table(
        "dora_functions",
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id", sa.String(50), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column("description", sa.Text, nullable=True, server_default=""),
        sa.Column("is_critical_or_important", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("criticality_rationale", sa.Text, nullable=True, server_default=""),
        sa.Column("business_line", sa.String(255), nullable=True, server_default=""),
        sa.Column("lou_code", sa.String(50), nullable=True, server_default=""),
        sa.Column("recovery_time_objective_h", sa.Float, nullable=True),
        sa.Column("recovery_point_objective_h", sa.Float, nullable=True),
        sa.Column("impact_tolerance_description", sa.Text, nullable=True, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
    )

    # ── dora_entities (RFE) ──
    op.create_table(
        "dora_entities",
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id", sa.String(20), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("lei", sa.String(20), nullable=False, server_default=""),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column("country_iso2", sa.String(2), nullable=False, server_default=""),
        sa.Column("competent_authority", sa.String(255), nullable=True, server_default=""),
        sa.Column("entity_type", sa.String(50), nullable=True, server_default=""),
        sa.Column("hierarchy", sa.String(50), nullable=True, server_default=""),
        sa.Column("parent_lei", sa.String(20), nullable=True),
        sa.Column("total_assets", sa.Float, nullable=True),
        sa.Column("reporting_period", sa.String(10), nullable=True, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
    )
    op.create_index("ix_dora_entities_project_lei", "dora_entities", ["project_id", "lei"])

    # ── dora_branches ──
    op.create_table(
        "dora_branches",
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id", sa.String(20), nullable=False),
        sa.Column("rfe_id", sa.String(20), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("name", sa.String(255), nullable=True, server_default=""),
        sa.Column("country_iso2", sa.String(2), nullable=False, server_default=""),
        sa.Column("lei", sa.String(20), nullable=True),
        sa.Column("branch_code", sa.String(50), nullable=True, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["project_id", "rfe_id"],
            ["dora_entities.project_id", "dora_entities.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "id"),
    )
    op.create_index("ix_dora_branches_rfe", "dora_branches", ["project_id", "rfe_id"])

    # ── dora_consolidation_scope ──
    op.create_table(
        "dora_consolidation_scope",
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id", sa.String(20), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("entity_lei", sa.String(20), nullable=False, server_default=""),
        sa.Column("entity_name", sa.String(255), nullable=True, server_default=""),
        sa.Column("relation_to_rfe", sa.String(50), nullable=True, server_default=""),
        sa.Column("inclusion_method", sa.String(30), nullable=True, server_default=""),
        sa.Column("country_iso2", sa.String(2), nullable=True, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "id"),
    )

    # ── dora_arrangements ──
    op.create_table(
        "dora_arrangements",
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id", sa.String(30), nullable=False),
        sa.Column("vendor_id", sa.String(20), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("arrangement_reference", sa.String(100), nullable=False, server_default=""),
        sa.Column("arrangement_type", sa.String(50), nullable=True, server_default=""),
        sa.Column("function_id", sa.String(50), nullable=True),
        sa.Column("is_critical_function_support", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("start_date", sa.String(10), nullable=True, server_default=""),
        sa.Column("end_date", sa.String(10), nullable=True, server_default=""),
        sa.Column("notice_period_days", sa.Integer, nullable=True),
        sa.Column("governing_law_country", sa.String(2), nullable=True, server_default=""),
        sa.Column("jurisdiction_country", sa.String(2), nullable=True, server_default=""),
        sa.Column("annual_cost_amount", sa.Float, nullable=True),
        sa.Column("currency", sa.String(3), nullable=True, server_default="EUR"),
        sa.Column("nature_of_service", sa.Text, nullable=True, server_default=""),
        sa.Column("data_sensitivity", sa.String(50), nullable=True, server_default=""),
        sa.Column("data_storage_country", sa.String(2), nullable=True, server_default=""),
        sa.Column("data_processing_country", sa.String(2), nullable=True, server_default=""),
        sa.Column("is_substitutable", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("exit_strategy_documented", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("reintegration_possible", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("last_audit_date", sa.String(10), nullable=True, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["project_id", "vendor_id"],
            ["vendors.project_id", "vendors.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "function_id"],
            ["dora_functions.project_id", "dora_functions.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("project_id", "id"),
    )
    op.create_index("ix_dora_arrangements_vendor", "dora_arrangements", ["project_id", "vendor_id"])
    op.create_index("ix_dora_arrangements_function", "dora_arrangements", ["project_id", "function_id"])
    op.create_index(
        "ix_dora_arrangements_ref",
        "dora_arrangements",
        ["project_id", "arrangement_reference"],
        unique=True,
    )

    # ── dora_arrangement_rfes (junction) ──
    op.create_table(
        "dora_arrangement_rfes",
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("arrangement_id", sa.String(30), nullable=False),
        sa.Column("rfe_id", sa.String(20), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id", "arrangement_id"],
            ["dora_arrangements.project_id", "dora_arrangements.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "rfe_id"],
            ["dora_entities.project_id", "dora_entities.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "arrangement_id", "rfe_id"),
    )

    # ── dora_signers ──
    op.create_table(
        "dora_signers",
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("arrangement_id", sa.String(30), nullable=False),
        sa.Column("id", sa.String(30), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("signer_lei", sa.String(20), nullable=True),
        sa.Column("signer_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("signer_role", sa.String(30), nullable=True, server_default=""),
        sa.Column("signed_on", sa.String(10), nullable=True, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(
            ["project_id", "arrangement_id"],
            ["dora_arrangements.project_id", "dora_arrangements.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "arrangement_id", "id"),
    )

    # ── dora_subcontractors ──
    op.create_table(
        "dora_subcontractors",
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("arrangement_id", sa.String(30), nullable=False),
        sa.Column("id", sa.String(30), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("parent_subcontractor_id", sa.String(30), nullable=True),
        sa.Column("tier", sa.Integer, nullable=False, server_default="1"),
        sa.Column("lei", sa.String(20), nullable=True),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column("country_iso2", sa.String(2), nullable=True, server_default=""),
        sa.Column("service_provided", sa.Text, nullable=True, server_default=""),
        sa.Column("is_critical_function_support", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("data_country", sa.String(2), nullable=True, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(
            ["project_id", "arrangement_id"],
            ["dora_arrangements.project_id", "dora_arrangements.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("project_id", "arrangement_id", "id"),
    )
    op.create_index(
        "ix_dora_subcontractors_arr_tier",
        "dora_subcontractors",
        ["project_id", "arrangement_id", "tier"],
    )


def downgrade() -> None:
    op.drop_index("ix_dora_subcontractors_arr_tier", table_name="dora_subcontractors")
    op.drop_table("dora_subcontractors")
    op.drop_table("dora_signers")
    op.drop_table("dora_arrangement_rfes")
    op.drop_index("ix_dora_arrangements_ref", table_name="dora_arrangements")
    op.drop_index("ix_dora_arrangements_function", table_name="dora_arrangements")
    op.drop_index("ix_dora_arrangements_vendor", table_name="dora_arrangements")
    op.drop_table("dora_arrangements")
    op.drop_table("dora_consolidation_scope")
    op.drop_index("ix_dora_branches_rfe", table_name="dora_branches")
    op.drop_table("dora_branches")
    op.drop_index("ix_dora_entities_project_lei", table_name="dora_entities")
    op.drop_table("dora_entities")
    op.drop_table("dora_functions")
    op.drop_index("ix_vendors_project_lei", table_name="vendors")
    op.drop_column("vendors", "country_iso2")
    op.drop_column("vendors", "ultimate_parent_id")
    op.drop_column("vendors", "additional_id_issuer")
    op.drop_column("vendors", "additional_id_value")
    op.drop_column("vendors", "additional_id_type")
    op.drop_column("vendors", "entity_nature")
    op.drop_column("vendors", "person_type")
    op.drop_column("vendors", "legal_name_latin")
    op.drop_column("vendors", "lei")
