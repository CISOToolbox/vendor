# -----------------------------------------------------------------------------
# REPLICATED from the private shared repository (shared/python/default_project.py).
# DO NOT EDIT HERE - changes will be overwritten by the next propagation run.
# Fix the master in the shared repository and re-propagate. See CONTRIBUTING.md.
# -----------------------------------------------------------------------------
"""Canonical single-project identity for the suite.

Design decision (docs/CHANTIER_PROJET_UNIQUE.md): one suite deployment =
one client / one IS = ONE project. Multi-client isolation is achieved by
separate deployments (forked per-client repos), not by per-module
``project_id`` partitioning. So every module seeds a single project with
this well-known UUID, and Pilot uses the same id — "the project" is the
same object everywhere.

The DB schema keeps ``project_id`` as a (composite) primary key; it is
simply always equal to ``DEFAULT_PROJECT_ID``. Non-destructive, reversible.

Copied verbatim into each module's ``src/default_project.py`` (same manual
mechanism as ``connectors_common.py`` / ``auth_common.py``). Never hard-code
this UUID anywhere else — import the constant.
"""
from __future__ import annotations

import uuid

# Fixed, shared across Pilot + Access + Asset + Vendor + Compliance.
DEFAULT_PROJECT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
DEFAULT_PROJECT_ID_STR = str(DEFAULT_PROJECT_ID)
DEFAULT_PROJECT_NAME = "Projet principal"
