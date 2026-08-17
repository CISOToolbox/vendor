"""Unit tests for _normalize_status from routes/internal.py."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from routes.internal import _normalize_status


class TestNormalizeStatus:
    """All French/English status variants must map to their canonical English form."""

    def test_completed_english(self):
        assert _normalize_status("completed") == "completed"

    def test_termine_lowercase(self):
        assert _normalize_status("termine") == "completed"

    def test_termine_accented(self):
        assert _normalize_status("Terminé") == "completed"

    def test_en_cours(self):
        assert _normalize_status("en_cours") == "in_progress"

    def test_en_cours_title_case(self):
        assert _normalize_status("En cours") == "in_progress"

    def test_planifie_lowercase(self):
        assert _normalize_status("planifie") == "planned"

    def test_planifie_accented_upper(self):
        assert _normalize_status("Planifié") == "planned"

    def test_planifie_accented_lower(self):
        assert _normalize_status("planifié") == "planned"

    def test_unknown_passthrough(self):
        assert _normalize_status("something_else") == "something_else"

    def test_empty_string_passthrough(self):
        assert _normalize_status("") == ""

    def test_in_progress_already_canonical(self):
        """in_progress is not explicitly in the mapping but should still work
        if present or pass through unchanged."""
        result = _normalize_status("in_progress")
        # Not in the mapping keys, so it passes through as-is
        assert result == "in_progress"
