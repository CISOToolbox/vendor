"""The vendor-questionnaire portal a generated link points at.

Most suite deployments are internal: a link built from the deployment's own
address cannot be opened by the vendor. The link therefore points at the
public static portal by default; an operator who hosts their own sets
VENDOR_PORTAL_URL, and an empty value keeps the deployment's own portal.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from src.routes.portal import DEFAULT_PORTAL_URL, portal_base_url  # noqa: E402


def test_default_is_the_public_static_portal(monkeypatch):
    monkeypatch.delenv("VENDOR_PORTAL_URL", raising=False)
    assert portal_base_url() == DEFAULT_PORTAL_URL == "https://vendor.cisotoolbox.org/portal/"


def test_an_empty_value_keeps_the_deployment_portal(monkeypatch):
    monkeypatch.setenv("VENDOR_PORTAL_URL", "")
    assert portal_base_url() == ""


@pytest.mark.parametrize("value,expected", [
    ("https://portal.example.org/vendor", "https://portal.example.org/vendor/"),
    ("https://portal.example.org/vendor/", "https://portal.example.org/vendor/"),
    ("  https://portal.example.org/  ", "https://portal.example.org/"),
])
def test_an_operator_portal_is_used(monkeypatch, value, expected):
    monkeypatch.setenv("VENDOR_PORTAL_URL", value)
    assert portal_base_url() == expected


# A refused value means the operator wanted another portal than the public
# one: it never falls back to the third party, the deployment's own is used.
@pytest.mark.parametrize("value", ["http://portal.intranet/", "javascript:alert(1)", "portal.example.org", "https://", "None"])
def test_anything_but_an_https_url_keeps_the_deployment_portal(monkeypatch, value):
    monkeypatch.setenv("VENDOR_PORTAL_URL", value)
    assert portal_base_url() == ""


def test_a_url_carrying_a_fragment_or_query_keeps_the_deployment_portal(monkeypatch):
    # The questionnaire travels in the fragment the app appends: the base must not carry one.
    for value in ("https://portal.example.org/#x", "https://portal.example.org/?a=1"):
        monkeypatch.setenv("VENDOR_PORTAL_URL", value)
        assert portal_base_url() == ""


def test_a_refused_value_is_logged_once(monkeypatch, caplog):
    monkeypatch.setenv("VENDOR_PORTAL_URL", "http://once.example/")
    for _ in range(3):
        portal_base_url()
    assert sum("once.example" in r.getMessage() for r in caplog.records) == 1
