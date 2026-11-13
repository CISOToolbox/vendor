"""The language asked of the model is read whatever its spelling.

`fr-FR` is what a browser sends and ` fr ` what a setting may hold: both are
French, like `fr` and `FR`. Anything else is English. The routes are called
too: each one hands the language of its request to the prompt.
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest

os.environ.setdefault("MODULE_NAME", "vendor")
os.environ.setdefault("JWT_SECRET", "test-secret")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from src.routes import ai  # noqa: E402
from src.routes.ai import (  # noqa: E402
    _lang_name, _measure_suggest_system, _risk_suggest_system,
)

FRENCH = ["fr", "FR", "fr-FR", "fr_FR", " fr ", "Fr-fr"]
ENGLISH = ["en", "EN", "en-GB", "", None, "de"]

BUILDERS = [_measure_suggest_system, _risk_suggest_system]


@pytest.mark.parametrize("language", FRENCH)
def test_a_french_spelling_is_french(language):
    assert _lang_name(language) == "French"


@pytest.mark.parametrize("language", ENGLISH)
def test_anything_else_is_english(language):
    assert _lang_name(language) == "English"


@pytest.mark.parametrize("build", BUILDERS)
@pytest.mark.parametrize("language", FRENCH)
def test_the_suggestions_are_asked_in_french(build, language):
    system = build("vendor", "Acme", language)
    assert "French" in system and "English" not in system


@pytest.mark.parametrize("build", BUILDERS)
@pytest.mark.parametrize("language", ENGLISH)
def test_the_suggestions_are_asked_in_english(build, language):
    system = build("vendor", "Acme", language)
    assert "English" in system and "French" not in system


# What a route receives: the spelling is read by the tests above.
SENT_FRENCH = ["fr-FR", " FR "]
SENT_ENGLISH = ["en", "", "de"]


class _Asked(Exception):
    """Raised by the fake provider: the handler stops once its prompt is known."""


def _asked_by(monkeypatch, handler, body, db=None):
    """The text the route hands to the model for `body`."""
    asked = {}

    async def provider_model(_db):
        return "anthropic", "a-model"

    async def complete(_db, system, user_prompt, _provider, _model):
        asked["text"] = system + "\n" + user_prompt
        raise _Asked

    monkeypatch.setattr(ai, "_check_ai_access", lambda _user: None)
    monkeypatch.setattr(ai, "_check_rate_limit", lambda _key: None)
    monkeypatch.setattr(ai, "_runtime_provider_model", provider_model)
    monkeypatch.setattr(ai, "_provider_complete", complete)
    with pytest.raises(_Asked):
        asyncio.run(handler(body, user=None, db=db))
    return asked["text"]


# The five prompts of the module, and every mode of the two that have several.
ROUTES = [
    (ai.vendor_suggest_measures, ai.MeasureSuggestRequest, {"mode": "vendor"}),
    (ai.vendor_suggest_measures, ai.MeasureSuggestRequest, {"mode": "risk"}),
    (ai.vendor_suggest_measures, ai.MeasureSuggestRequest, {"mode": "custom"}),
    (ai.vendor_suggest_risks, ai.RiskSuggestRequest, {"mode": "auto"}),
    (ai.vendor_suggest_risks, ai.RiskSuggestRequest, {"mode": "custom"}),
    (ai.vendor_suggest_assessment, ai.AssessmentSuggestRequest, {}),
    (ai.vendor_collect_info, ai.CollectInfoRequest, {}),
    (ai.vendor_collect_docs, ai.CollectDocsRequest, {}),
]


@pytest.mark.parametrize("handler,request_model,fields", ROUTES)
@pytest.mark.parametrize("language", SENT_FRENCH)
def test_a_route_asks_for_french(monkeypatch, handler, request_model, fields, language):
    body = request_model(vendor_name="Acme", language=language, **fields)
    asked = _asked_by(monkeypatch, handler, body)
    assert "French" in asked and "English" not in asked


@pytest.mark.parametrize("handler,request_model,fields", ROUTES)
@pytest.mark.parametrize("language", SENT_ENGLISH)
def test_a_route_asks_for_english(monkeypatch, handler, request_model, fields, language):
    body = request_model(vendor_name="Acme", language=language, **fields)
    asked = _asked_by(monkeypatch, handler, body)
    assert "English" in asked and "French" not in asked


@pytest.mark.parametrize("handler,request_model,fields", ROUTES)
def test_a_route_without_a_language_asks_for_english(monkeypatch, handler, request_model, fields):
    asked = _asked_by(monkeypatch, handler, request_model(vendor_name="Acme", **fields))
    assert "English" in asked and "French" not in asked
