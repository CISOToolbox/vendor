"""Classification 'non évalué' vs 0 (FEAT-54)

Revision ID: 018_classification_unassessed
Revises: 017_nonconformities
Create Date: 2026-10-07

A classification indicator (ops_impact, processes, replace_difficulty,
data_sensitivity, integration, regulatory_impact) is now nullable: null means
"not assessed", 0..4 means assessed — 0 being a real "no impact" rating. Until
now 0 was the default and stood for "not set", so every stored 0 is coerced to
null here (decided: existing 0 -> non évalué, no silent promotion to "low").

The derived exposure axes are recomputed with the all-or-nothing rule: an axis
(dependance = ops/processes/replace_difficulty, penetration =
data_sensitivity/integration/regulatory_impact) is null unless its three
indicators are all assessed.

Downgrade maps null back to 0 (the pre-FEAT-54 "unset" value); it cannot tell a
deliberate 0 from a null, so it is a best-effort reverse.
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "018_classification_unassessed"
down_revision = "017_nonconformities"
branch_labels = None
depends_on = None

_CLS_KEYS = ["ops_impact", "processes", "replace_difficulty",
             "data_sensitivity", "integration", "regulatory_impact"]
_DEP = ["ops_impact", "processes", "replace_difficulty"]
_PEN = ["data_sensitivity", "integration", "regulatory_impact"]


def _axis_mean(cls: dict, keys: list[str]):
    vals = []
    for k in keys:
        v = cls.get(k)
        if v is None:
            return None
        vals.append(float(v))
    return round(sum(vals) / len(vals), 1)


def _rewrite(zero_to_null: bool) -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT project_id, id, classification, exposure FROM vendors")
    ).fetchall()
    for project_id, vid, cls, exp in rows:
        cls = dict(cls or {})
        exp = dict(exp or {})
        for k in _CLS_KEYS:
            if zero_to_null:
                if cls.get(k) == 0:
                    cls[k] = None
            else:
                if cls.get(k) is None:
                    cls[k] = 0
        exp["dependance"] = _axis_mean(cls, _DEP)
        exp["penetration"] = _axis_mean(cls, _PEN)
        conn.execute(
            sa.text("UPDATE vendors SET classification = CAST(:cls AS jsonb), "
                    "exposure = CAST(:exp AS jsonb) "
                    "WHERE project_id = :pid AND id = :vid"),
            {"cls": json.dumps(cls), "exp": json.dumps(exp),
             "pid": project_id, "vid": vid},
        )


def upgrade() -> None:
    _rewrite(zero_to_null=True)


def downgrade() -> None:
    _rewrite(zero_to_null=False)
