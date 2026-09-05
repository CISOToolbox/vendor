"""The VENDOR_IN_SCOPE scope must hold on ALL channels toward Pilot.

The 2026-09-02 audit showed the filter present on /internal/measures (pull)
but absent from /internal/stats and from both push channels (measure PATCH,
bulk notify on project rename): the Pilot posture counted prospects and
former vendors, and offboarding re-pushed into the Pilot cache every
measure it had just abandoned.

AST checks on the source code — the invariant is invisible in a diff.
"""
import ast
import os

ROUTES = os.path.join(os.path.dirname(__file__), "..", "..", "src", "routes")


def _function_source(path: str, name: str) -> str:
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.unparse(node)
    raise AssertionError(f"{name} not found in {path}")


def test_internal_stats_is_scoped_everywhere():
    src = _function_source(os.path.join(ROUTES, "internal.py"), "internal_stats")
    # 5 reads: total, tiers, measures, posture, pending — each one scoped.
    assert src.count("VENDOR_IN_SCOPE") >= 5, (
        "internal_stats must scope every query with VENDOR_IN_SCOPE — an "
        "unscoped one silently skews the Pilot posture")


def test_internal_stats_gives_cancelled_measures_no_bucket():
    src = _function_source(os.path.join(ROUTES, "internal.py"), "internal_stats")
    assert "annule" in src, (
        "a cancelled measure must not fall into the planned/overdue buckets")


def test_the_patch_push_channel_honours_the_scope():
    src = _function_source(os.path.join(ROUTES, "vendor_measures.py"), "update_measure")
    assert "VENDOR_IN_SCOPE" in src and "notify_pilot_measure_deleted" in src, (
        "PATCHing an out-of-scope vendor's measure must withdraw it from the "
        "Pilot cache, not upsert it")


def test_the_bulk_push_channel_honours_the_scope():
    with open(os.path.join(ROUTES, "projects.py"), encoding="utf-8") as f:
        src = f.read()
    idx = src.find("notify_pilot_measures_bulk")
    assert idx != -1
    # The filter must appear in the query that feeds the bulk.
    window = src[max(0, idx - 200): idx + 1500]
    assert "VENDOR_IN_SCOPE" in window, (
        "the project-rename bulk notify must only push in-scope vendors")
