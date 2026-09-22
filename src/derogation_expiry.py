"""FEAT-45 — derogations end by the calendar, so the module needs a heartbeat.

Every other module already runs a periodic job (scanner, notifier) and expires
its derogations on that tick. Vendor is purely request-driven: without this
loop an approved derogation would keep covering its gap long after its end of
validity, because nobody would ever ask. One task, one hourly pass, no state
of its own.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from src.database import async_session

logger = logging.getLogger("vendor.derogation-expiry")

INTERVAL_SECONDS = 3600


async def run_once() -> int:
    """approved → expired for every derogation past its end date. Returns how
    many were expired; never raises."""
    try:
        from src.models import Derogation, Nonconformity
        from src.nonconformity_common import expire_derogations
        from src.routes.nonconformities import GAP_HOOK

        async with async_session() as db:
            n = await expire_derogations(db, Derogation, GAP_HOOK, Nonconformity)
        if n:
            logger.info("derogations expired: %d", n)
        return n
    except Exception:  # noqa: BLE001 — a failed pass must not kill the loop
        logger.exception("derogation expiry failed")
        return 0


async def loop() -> None:
    while True:
        await run_once()
        await asyncio.sleep(INTERVAL_SECONDS)


# The event loop keeps only a weak reference to a task: without one of our own
# the heartbeat could be collected mid-flight and stop silently.
_task: Optional[asyncio.Task] = None


def start() -> None:
    """Start the heartbeat once, at application startup."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(loop())
