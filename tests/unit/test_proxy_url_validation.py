"""Unit tests for _validate_proxy_url from routes/internal.py."""
import sys
import os
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from fastapi import HTTPException
from routes.internal import _validate_proxy_url


class TestValidSchemes:
    def test_https_url_passes(self):
        with patch("socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("93.184.216.34", 0)),
        ]):
            _validate_proxy_url("https://example.com:8080/proxy")

    def test_http_url_passes(self):
        with patch("socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("93.184.216.34", 0)),
        ]):
            _validate_proxy_url("http://proxy.corp.com:3128")


class TestRejectedSchemes:
    def test_file_scheme_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("file:///etc/passwd")
        assert exc.value.status_code == 400

    def test_ftp_scheme_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("ftp://evil.com/file")
        assert exc.value.status_code == 400

    def test_javascript_scheme_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("javascript:alert(1)")
        assert exc.value.status_code == 400

    def test_data_scheme_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("data:text/html,<h1>hi</h1>")
        assert exc.value.status_code == 400


class TestPrivateIPsRejected:
    def test_loopback_127(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("http://127.0.0.1:8080")
        assert exc.value.status_code == 400
        # The exact wording belongs to ssrf_guard: we check the refusal and
        # that it carries a reason, not the phrasing, otherwise the test
        # breaks on every rewording of the shared message.
        assert exc.value.detail

    def test_private_10(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("http://10.0.0.1:3128")
        assert exc.value.status_code == 400

    def test_private_192_168(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("http://192.168.1.1")
        assert exc.value.status_code == 400

    def test_private_172_16(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("http://172.16.0.1")
        assert exc.value.status_code == 400


class TestLinkLocalRejected:
    def test_metadata_ip(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("http://169.254.169.254/latest/meta-data")
        assert exc.value.status_code == 400


class TestBlockedHostnames:
    def test_metadata_google_internal(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("http://metadata.google.internal/computeMetadata")
        assert exc.value.status_code == 400

    def test_metadata_internal(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("http://metadata.internal/something")
        assert exc.value.status_code == 400

    def test_169_254_in_blocked_hosts(self):
        with pytest.raises(HTTPException) as exc:
            _validate_proxy_url("http://169.254.169.254/")
        assert exc.value.status_code == 400


class TestDNSRebinding:
    def test_hostname_resolving_to_private_ip(self):
        """A hostname that resolves to a private IP must be rejected."""
        with patch("socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("10.0.0.5", 0)),
        ]):
            with pytest.raises(HTTPException) as exc:
                _validate_proxy_url("https://evil.attacker.com/proxy")
            assert exc.value.status_code == 400
            assert exc.value.detail

    def test_hostname_resolving_to_loopback(self):
        with patch("socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("127.0.0.1", 0)),
        ]):
            with pytest.raises(HTTPException) as exc:
                _validate_proxy_url("https://rebind.attacker.com/proxy")
            assert exc.value.status_code == 400

    def test_hostname_resolving_to_link_local(self):
        with patch("socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("169.254.1.1", 0)),
        ]):
            with pytest.raises(HTTPException) as exc:
                _validate_proxy_url("https://rebind.attacker.com/proxy")
            assert exc.value.status_code == 400

    def test_hostname_with_mixed_ips_one_private(self):
        """If any resolved IP is private, reject."""
        with patch("socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("93.184.216.34", 0)),
            (2, 1, 6, "", ("10.0.0.1", 0)),
        ]):
            with pytest.raises(HTTPException) as exc:
                _validate_proxy_url("https://dual-stack.example.com/proxy")
            assert exc.value.status_code == 400

    def test_dns_failure_is_refused(self):
        """A name that does not resolve must be REFUSED, not waved through.

        This test used to assert the opposite — the local validator swallowed
        socket.gaierror, so an unresolvable host passed. That is fail-open, and
        the value goes straight into the process-wide HTTP_PROXY afterwards.
        The shared ssrf_guard fails closed; the expectation follows it.
        """
        import socket
        with patch("socket.getaddrinfo", side_effect=socket.gaierror("Name resolution failed")):
            with pytest.raises(HTTPException) as exc:
                _validate_proxy_url("https://unresolvable.example.com/proxy")
            assert exc.value.status_code == 400
