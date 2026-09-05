"""Design regression (H4 phase 5): vendor migrated to the shared AI proxy.

routes/ai.py dropped from 922 to ~489 lines (provider plumbing now in
src/ai_proxy_common.py). Vendor keeps its five TPRM business endpoints and their
prompt builders. This confirms the router still exposes the common endpoints
plus all five business ones.
"""
import os
import sys

os.environ.setdefault("MODULE_NAME", "vendor")
os.environ.setdefault("JWT_SECRET", "test-secret")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from src.routes.ai import router  # noqa: E402


def test_router_exposes_common_and_all_metier_endpoints():
    paths = {r.path for r in router.routes}
    for p in (
        "/api/ai/complete", "/api/ai/runtime", "/api/ai/config",
        "/api/ai/keys", "/api/ai/validate-key",            # common
        "/api/ai/vendor/suggest-measures",
        "/api/ai/vendor/suggest-risks",
        "/api/ai/vendor/suggest-assessment",
        "/api/ai/vendor/collect-info",
        "/api/ai/vendor/collect-docs",                     # vendor business
    ):
        assert p in paths, f"missing endpoint: {p}"
