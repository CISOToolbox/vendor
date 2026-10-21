"""RoI columns Vendor could not fill (BUG-112)

Revision ID: 019_roi_export_complete
Revises: 018_classification_unassessed
Create Date: 2026-10-21

- dora_consolidation_scope: entity_type (B_01.02.0040) and hierarchy
  (B_01.02.0050), from the same codelists as the reporting entities.
- dora_arrangements: open_ended (B_02.02.0080 exported as 9999-12-31),
  data_stored (B_02.02.0140; NULL keeps the former rule — derived from the
  storage country) and linked_arrangement_id (B_02.03.0020).
- dora_functions.rfe_id (B_06.01.0040: the entity performing the function;
  NULL keeps the register holder).
- dora_arrangements.exit_strategy_documented becomes nullable (B_07.01.0080:
  NULL = not stated, exported empty instead of "No"); existing values kept.
- dora_functions.impact_tolerance_description: a value outside the
  impact_level codelist (old free text) becomes "not_assessed".
All nullable or defaulted: existing rows export as before until filled.
"""
from alembic import op
import sqlalchemy as sa

revision = "019_roi_export_complete"
down_revision = "018_classification_unassessed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dora_consolidation_scope", sa.Column("entity_type", sa.String(50), nullable=True, server_default=""))
    op.add_column("dora_consolidation_scope", sa.Column("hierarchy", sa.String(50), nullable=True, server_default=""))
    op.add_column("dora_arrangements", sa.Column("open_ended", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("dora_arrangements", sa.Column("data_stored", sa.Boolean(), nullable=True))
    op.add_column("dora_arrangements", sa.Column("linked_arrangement_id", sa.String(30), nullable=True))
    op.add_column("dora_functions", sa.Column("rfe_id", sa.String(20), nullable=True))
    op.alter_column("dora_arrangements", "exit_strategy_documented", existing_type=sa.Boolean(), nullable=True)
    # A code written with another case or spaces is normalised (it exported
    # fine before); anything else becomes not_assessed.
    op.execute("UPDATE dora_functions SET impact_tolerance_description = LOWER(TRIM(impact_tolerance_description)) "
               "WHERE LOWER(TRIM(impact_tolerance_description)) IN ('low', 'medium', 'high', 'not_assessed')")
    op.execute("UPDATE dora_functions SET impact_tolerance_description = 'not_assessed' "
               "WHERE COALESCE(impact_tolerance_description, '') <> '' "
               "AND impact_tolerance_description NOT IN ('low', 'medium', 'high', 'not_assessed')")


def downgrade() -> None:
    op.execute("UPDATE dora_arrangements SET exit_strategy_documented = false WHERE exit_strategy_documented IS NULL")
    op.alter_column("dora_arrangements", "exit_strategy_documented", existing_type=sa.Boolean(), nullable=False)
    op.drop_column("dora_functions", "rfe_id")
    op.drop_column("dora_arrangements", "linked_arrangement_id")
    op.drop_column("dora_arrangements", "data_stored")
    op.drop_column("dora_arrangements", "open_ended")
    op.drop_column("dora_consolidation_scope", "hierarchy")
    op.drop_column("dora_consolidation_scope", "entity_type")
