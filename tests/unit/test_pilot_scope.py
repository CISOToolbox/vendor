"""Le périmètre VENDOR_IN_SCOPE doit tenir sur TOUS les canaux vers Pilot.

L'audit du 2026-09-02 a montré le filtre posé sur /internal/measures (pull)
mais absent de /internal/stats et des deux canaux push (PATCH mesure, bulk
notify au renommage de projet) : la posture Pilot comptait prospects et
anciens fournisseurs, et l'offboarding repoussait dans le cache Pilot chaque
mesure qu'il venait d'abandonner.

Contrôles par AST sur le code source — l'invariant est invisible dans un diff.
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
    # 5 lectures : total, tiers, mesures, posture, pending — chacune scopée.
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
    # Le filtre doit apparaître dans la requête qui alimente le bulk.
    window = src[max(0, idx - 200): idx + 1500]
    assert "VENDOR_IN_SCOPE" in window, (
        "the project-rename bulk notify must only push in-scope vendors")
