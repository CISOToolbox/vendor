"""Unit tests for pilot_notify.py."""
import sys
import os
from unittest.mock import patch, AsyncMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))


class TestModuleName:

    def test_module_name_default(self):
        from pilot_notify import MODULE_NAME
        assert MODULE_NAME == "vendor"


class TestNotifyPilotNoOp:
    """When PILOT_URL or SERVICE_TOKEN is empty, notify_pilot_measure is a no-op."""

    @pytest.mark.asyncio
    async def test_noop_when_pilot_url_empty(self):
        with patch.dict(os.environ, {"PILOT_URL": "", "SERVICE_TOKEN": "tok123"}, clear=False):
            # Re-import to pick up patched env
            import importlib
            import pilot_notify
            importlib.reload(pilot_notify)
            result = await pilot_notify.notify_pilot_measure({"source_id": "m1", "title": "Test"})
            assert result is None

    @pytest.mark.asyncio
    async def test_noop_when_service_token_empty(self):
        with patch.dict(os.environ, {"PILOT_URL": "http://pilot:8000", "SERVICE_TOKEN": ""}, clear=False):
            import importlib
            import pilot_notify
            importlib.reload(pilot_notify)
            result = await pilot_notify.notify_pilot_measure({"source_id": "m1", "title": "Test"})
            assert result is None

    @pytest.mark.asyncio
    async def test_noop_when_both_empty(self):
        with patch.dict(os.environ, {"PILOT_URL": "", "SERVICE_TOKEN": ""}, clear=False):
            import importlib
            import pilot_notify
            importlib.reload(pilot_notify)
            result = await pilot_notify.notify_pilot_measure({"source_id": "m1"})
            assert result is None


class TestNotifyPilotPayload:
    """When PILOT_URL and SERVICE_TOKEN are set, verify the HTTP call."""

    @pytest.mark.asyncio
    async def test_payload_includes_module(self):
        with patch.dict(os.environ, {
            "PILOT_URL": "http://pilot:8000",
            "SERVICE_TOKEN": "secret",
            "MODULE_NAME": "vendor",
        }, clear=False):
            import importlib
            import pilot_notify
            importlib.reload(pilot_notify)

            mock_response = AsyncMock()
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)

            with patch("httpx.AsyncClient", return_value=mock_client):
                await pilot_notify.notify_pilot_measure({
                    "source_id": "m42",
                    "title": "Fix firewall",
                    "status": "in_progress",
                })

            mock_client.post.assert_called_once()
            call_args = mock_client.post.call_args
            assert call_args[0][0] == "http://pilot:8000/api/measures/notify"
            payload = call_args[1]["json"]
            assert payload["source_id"] == "m42"
            assert payload["title"] == "Fix firewall"
            assert payload["module"] == "vendor"
            assert payload["source_module"] == "vendor"

    @pytest.mark.asyncio
    async def test_headers_include_service_token(self):
        with patch.dict(os.environ, {
            "PILOT_URL": "http://pilot:8000",
            "SERVICE_TOKEN": "my-secret-token",
            "MODULE_NAME": "vendor",
        }, clear=False):
            import importlib
            import pilot_notify
            importlib.reload(pilot_notify)

            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=AsyncMock())
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)

            with patch("httpx.AsyncClient", return_value=mock_client):
                await pilot_notify.notify_pilot_measure({"source_id": "m1"})

            call_args = mock_client.post.call_args
            headers = call_args[1]["headers"]
            assert headers["X-Service-Token"] == "my-secret-token"

    @pytest.mark.asyncio
    async def test_pilot_url_trailing_slash_stripped(self):
        with patch.dict(os.environ, {
            "PILOT_URL": "http://pilot:8000/",
            "SERVICE_TOKEN": "tok",
            "MODULE_NAME": "vendor",
        }, clear=False):
            import importlib
            import pilot_notify
            importlib.reload(pilot_notify)

            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=AsyncMock())
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)

            with patch("httpx.AsyncClient", return_value=mock_client):
                await pilot_notify.notify_pilot_measure({"source_id": "m1"})

            url = mock_client.post.call_args[0][0]
            assert url == "http://pilot:8000/api/measures/notify"

    @pytest.mark.asyncio
    async def test_exception_swallowed(self):
        with patch.dict(os.environ, {
            "PILOT_URL": "http://pilot:8000",
            "SERVICE_TOKEN": "tok",
            "MODULE_NAME": "vendor",
        }, clear=False):
            import importlib
            import pilot_notify
            importlib.reload(pilot_notify)

            with patch("httpx.AsyncClient", side_effect=Exception("connection refused")):
                # Should not raise
                await pilot_notify.notify_pilot_measure({"source_id": "m1"})
