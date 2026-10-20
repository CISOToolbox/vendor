"""Where a generated vendor-questionnaire link points.

The questionnaire is encrypted into the link's fragment (``#data=v1gz.…``,
password sent apart): the portal that opens it needs no server and never sees
the content. Most suite deployments are internal, so a link built from the
deployment's own address cannot be opened by the vendor — the link points at
the public static portal by default.

``VENDOR_PORTAL_URL``:
- unset            → the public portal (``DEFAULT_PORTAL_URL``);
- empty            → the deployment's own portal (the app builds it);
- an https:// URL  → that portal (self-hosted);
- anything else    → refused, logged once, and the deployment's own portal:
                     the operator meant another portal than the public one,
                     so a refused value never falls back to the third party.
"""
from __future__ import annotations

import logging
import os
from typing import Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends

from src.auth import get_current_user
from src.models import User

logger = logging.getLogger(__name__)
_warned: set[str] = set()

DEFAULT_PORTAL_URL = "https://vendor.cisotoolbox.org/portal/"

router = APIRouter(prefix="/api", tags=["portal"])


def portal_base_url() -> str:
    """The portal base for generated links; "" means the deployment's own."""
    raw = os.getenv("VENDOR_PORTAL_URL")
    if raw is None:
        return DEFAULT_PORTAL_URL
    value = raw.strip()
    if value == "":
        return ""
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.netloc or parts.query or parts.fragment or "#" in value:
        if value not in _warned:
            _warned.add(value)
            logger.warning("VENDOR_PORTAL_URL %r is not an https:// URL without query or fragment: "
                           "the deployment's own portal is used", value)
        return ""
    return value if value.endswith("/") else value + "/"


@router.get("/settings/portal")
async def get_portal_settings(user: Optional[User] = Depends(get_current_user)) -> dict:
    """The portal base for generated questionnaire links. No `user is None`
    guard: None means auth is disabled (the 401 already happened otherwise)."""
    return {"base_url": portal_base_url()}
