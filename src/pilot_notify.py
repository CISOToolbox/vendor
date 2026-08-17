"""Fire-and-forget notification to Pilot when a measure changes.

Used by measures.py, findings.py (triage) and internal.py (write-back)
to keep Pilot's MeasureCache in sync without waiting for the next
full /measures/sync pull.

No-op in standalone mode (PILOT_URL not set) or when SERVICE_TOKEN is
missing — the module works independently either way.
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

PILOT_URL = os.getenv("PILOT_URL", "")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN", "")
MODULE_NAME = os.getenv("MODULE_NAME", "vendor")


async def notify_pilot_measure(measure_data: dict) -> None:
    """POST the measure payload to Pilot's /api/measures/notify.
    Fire-and-forget: exceptions are logged and swallowed."""
    if not PILOT_URL or not SERVICE_TOKEN:
        return
    payload = dict(measure_data)
    payload.setdefault("module", MODULE_NAME)
    payload.setdefault("source_module", MODULE_NAME)
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                PILOT_URL.rstrip("/") + "/api/measures/notify",
                headers={"X-Service-Token": SERVICE_TOKEN, "Content-Type": "application/json"},
                json=payload,
            )
    except Exception:
        logger.debug("notify_pilot_measure failed for %s (fire-and-forget)", payload.get("source_id"))


async def notify_pilot_measures_bulk(entries: list[dict]) -> None:
    """Batch variant of notify_pilot_measure: one POST to Pilot's
    /api/measures/notify-bulk for many measures, instead of one request +
    one client per measure. Fire-and-forget."""
    if not PILOT_URL or not SERVICE_TOKEN or not entries:
        return
    payload_entries = []
    for e in entries:
        p = dict(e)
        p.setdefault("module", MODULE_NAME)
        p.setdefault("source_module", MODULE_NAME)
        payload_entries.append(p)
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                PILOT_URL.rstrip("/") + "/api/measures/notify-bulk",
                headers={"X-Service-Token": SERVICE_TOKEN, "Content-Type": "application/json"},
                json={"entries": payload_entries},
            )
    except Exception:
        logger.debug("notify_pilot_measures_bulk failed (%d entries, fire-and-forget)", len(payload_entries))


async def notify_pilot_measure_deleted(source_id: str) -> None:
    """Notify Pilot that a measure was deleted locally."""
    if not PILOT_URL or not SERVICE_TOKEN:
        return
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                PILOT_URL.rstrip("/") + "/api/measures/notify",
                headers={"X-Service-Token": SERVICE_TOKEN, "Content-Type": "application/json"},
                json={"module": MODULE_NAME, "source_id": source_id, "deleted": True},
            )
    except Exception:
        logger.debug("notify_pilot_measure_deleted failed for %s", source_id)


# ── Evidences (FEAT-08) — same fire-and-forget pattern as measures ──

async def notify_pilot_evidence(evidence_data: dict) -> None:
    """POST the evidence payload to Pilot's /api/evidences/notify."""
    if not PILOT_URL or not SERVICE_TOKEN:
        return
    payload = dict(evidence_data)
    payload.setdefault("module", MODULE_NAME)
    payload.setdefault("source_module", MODULE_NAME)
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                PILOT_URL.rstrip("/") + "/api/evidences/notify",
                headers={"X-Service-Token": SERVICE_TOKEN, "Content-Type": "application/json"},
                json=payload,
            )
    except Exception:
        logger.debug("notify_pilot_evidence failed for %s (fire-and-forget)", payload.get("source_id"))


async def notify_pilot_evidence_deleted(source_id: str) -> None:
    """Notify Pilot that an evidence was deleted locally."""
    if not PILOT_URL or not SERVICE_TOKEN:
        return
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                PILOT_URL.rstrip("/") + "/api/evidences/notify",
                headers={"X-Service-Token": SERVICE_TOKEN, "Content-Type": "application/json"},
                json={"module": MODULE_NAME, "source_id": source_id, "deleted": True},
            )
    except Exception:
        logger.debug("notify_pilot_evidence_deleted failed for %s", source_id)
