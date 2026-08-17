"""DORA: align vendor.entity_nature with EBA ITS terminology.

Remaps the legacy custom codes onto the two ITS values used in
B_05.01 "Type of relationship with the ICT third-party service
provider":

  * ``ict_intra_group``  → ``intragroup``
  * ``ict_external``     → ``non_intragroup``
  * ``non_ict_relevant`` → ``non_intragroup`` (closest fallback;
    EBA RoI does not include non-ICT entities, so an admin should
    revisit those rows manually)

The frontend displays translated labels (FR/EN) but always persists
and exports the ITS codes verbatim.
"""
from __future__ import annotations

from alembic import op


revision = "006_dora_entity_nature_its"
down_revision = "005_dora_subcontractor_global"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE vendors SET entity_nature='intragroup' "
        "WHERE entity_nature='ict_intra_group'"
    )
    op.execute(
        "UPDATE vendors SET entity_nature='non_intragroup' "
        "WHERE entity_nature IN ('ict_external', 'non_ict_relevant')"
    )


def downgrade() -> None:
    # Best-effort reverse mapping. ``non_ict_relevant`` cannot be
    # recovered (collapsed onto ``non_intragroup`` upstream).
    op.execute(
        "UPDATE vendors SET entity_nature='ict_intra_group' "
        "WHERE entity_nature='intragroup'"
    )
    op.execute(
        "UPDATE vendors SET entity_nature='ict_external' "
        "WHERE entity_nature='non_intragroup'"
    )
