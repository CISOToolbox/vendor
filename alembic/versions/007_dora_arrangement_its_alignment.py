"""DORA: align dora_arrangements with the EBA RoI ITS.

Two changes:

1. ``arrangement_type`` previously held EBA Annex III ``S_01..S_21``
   codes ("Type of ICT services") which actually belong to the FUNCTION
   level (B.02.02.0050), not the contractual arrangement level. The
   correct closed list for B.02.01.0020 ("Type of contractual
   arrangement") is the 3-value set ``standalone | overarching |
   subsequent``. We blank any ``S_*`` value found in this column and
   leave it ``NULL`` for the admin to set the right value.

2. Add the three categorical fields the ITS prescribes for B.07.01:

   * ``substitutability_level``  (B.07.01.0050 — closed list of 4)
   * ``substitutability_reason`` (B.07.01.0060 — closed list of 3,
     conditional on level in {``not_substitutable``, ``highly_complex``})
   * ``reintegration_level``     (B.07.01.0090 — closed list of 3)

   Best-effort backfill from the legacy boolean fields:

   * ``is_substitutable=True``   → ``substitutability_level='easy'``
   * ``is_substitutable=False``  → ``substitutability_level='not_substitutable'``
   * ``reintegration_possible=True``  → ``reintegration_level='easy'``
   * ``reintegration_possible=False`` → ``reintegration_level='difficult'``

   The legacy booleans are kept (server-derived from the new fields).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "007_dora_arr_its_alignment"
down_revision = "006_dora_entity_nature_its"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns.
    op.add_column(
        "dora_arrangements",
        sa.Column("substitutability_level", sa.String(length=30), nullable=True, server_default=""),
    )
    op.add_column(
        "dora_arrangements",
        sa.Column("substitutability_reason", sa.String(length=30), nullable=True, server_default=""),
    )
    op.add_column(
        "dora_arrangements",
        sa.Column("reintegration_level", sa.String(length=30), nullable=True, server_default=""),
    )

    # Best-effort backfill from the legacy booleans.
    op.execute(
        "UPDATE dora_arrangements SET substitutability_level='easy' "
        "WHERE is_substitutable=true AND (substitutability_level IS NULL OR substitutability_level='')"
    )
    op.execute(
        "UPDATE dora_arrangements SET substitutability_level='not_substitutable' "
        "WHERE is_substitutable=false AND (substitutability_level IS NULL OR substitutability_level='')"
    )
    op.execute(
        "UPDATE dora_arrangements SET reintegration_level='easy' "
        "WHERE reintegration_possible=true AND (reintegration_level IS NULL OR reintegration_level='')"
    )
    op.execute(
        "UPDATE dora_arrangements SET reintegration_level='difficult' "
        "WHERE reintegration_possible=false AND (reintegration_level IS NULL OR reintegration_level='')"
    )

    # Blank ``arrangement_type`` rows where the value was a S_* ICT-service code.
    op.execute(
        "UPDATE dora_arrangements SET arrangement_type='' "
        "WHERE arrangement_type LIKE 'S\\_%' ESCAPE '\\'"
    )


def downgrade() -> None:
    op.drop_column("dora_arrangements", "reintegration_level")
    op.drop_column("dora_arrangements", "substitutability_reason")
    op.drop_column("dora_arrangements", "substitutability_level")
