"""Unit tests for DORA XLSX export — currency conversion and helpers."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from dora_export import _convert


class TestCurrencyConversion:
    def test_same_currency_passthrough(self):
        assert _convert(100.0, "EUR", "EUR") == 100.0

    def test_eur_to_usd_positive(self):
        v = _convert(100.0, "EUR", "USD")
        assert v is not None and v > 0

    def test_unknown_source_returns_none(self):
        assert _convert(100.0, "ZZZ", "EUR") is None

    def test_unknown_target_returns_none(self):
        assert _convert(100.0, "EUR", "ZZZ") is None

    def test_none_amount_returns_none(self):
        assert _convert(None, "EUR", "USD") is None

    def test_default_source_treated_as_eur(self):
        # When src is None or empty, treated as EUR base
        v = _convert(50.0, None, "EUR")
        assert v == 50.0
