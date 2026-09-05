from __future__ import annotations

import logging
import os

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from src.database import engine, async_session
from src.default_project import DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME
from src.models import Base, Project
from src.routes.ai import router as ai_router
from src.routes.auth import router as auth_router
from src.routes.projects import router as projects_router
from src.routes.users import router as users_router
from src.routes.directory_proxy import router as directory_router
from src.routes.internal import router as internal_router
from src.routes.verify import router as verify_router
from src.routes.vendors import router as vendors_router
from src.routes.vendor_measures import router as vendor_measures_router
from src.routes.vendor_risks import router as vendor_risks_router
from src.routes.vendor_documents import router as vendor_documents_router
from src.routes.vendor_assessments import router as vendor_assessments_router
from src.routes.dora import router as dora_router
from src.version_common import version_payload

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vendor-backend")

app = FastAPI(title="Vendor TPRM Backend", version="0.1.0")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        # NGX-04: ExcelJS is vendored under app/js/vendor/, so no CDN origin is
        # needed in script-src / connect-src any more.
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.gleif.org"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # Same cache policy as the suite proxy (nginx $cache_policy): without
        # Cache-Control, a standalone deployment (no proxy) leaves the browser
        # on heuristic caching — old JS on a new backend, the most confusing
        # failure class there is (mismatched API formats).
        # Does not touch routes that already set their own policy.
        if "cache-control" not in response.headers:
            ct = response.headers.get("content-type", "")
            if ct.startswith(("image/", "font/")):
                response.headers["Cache-Control"] = "public, max-age=3600"
            else:
                response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response


app.add_middleware(SecurityHeadersMiddleware)
# Generic write journal (FEAT-30 P1.6): every mutating /api request is
# journaled; routes with richer in-handler entries are excluded.
from src.audit import install_write_journal_middleware
install_write_journal_middleware(app, exclude=[
    ("PUT", r"/api/projects/[^/]+"), ("DELETE", r"/api/projects/[^/]+"),
    ("POST", r"/api/projects/import"),
    # Read-only probes that happen to be POSTs — not writes (FEAT-30 P3).
    ("POST", r"/api/(verify-url|probe-vendor-urls)"),
])

APP_URL = os.environ.get("APP_URL", "http://localhost:8086")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[APP_URL],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(auth_router)
app.include_router(projects_router)
app.include_router(vendors_router)
app.include_router(vendor_measures_router)
app.include_router(vendor_risks_router)
app.include_router(vendor_documents_router)
app.include_router(vendor_assessments_router)
app.include_router(dora_router)
app.include_router(ai_router)
app.include_router(users_router)
app.include_router(verify_router)
app.include_router(directory_router)
app.include_router(internal_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}



@app.get("/api/version")
async def version():
    """Version identity (FEAT-29): public, used for backup
    compatibility checks before restore."""
    async with async_session() as db:
        return await version_payload("vendor", Base.metadata, db)

@app.on_event("startup")
async def on_startup():
    # Fail closed unless AUTH_MODE=none is explicit (see auth_common.assert_auth_posture).
    from src.auth import assert_auth_posture
    assert_auth_posture()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created")
    await _ensure_default_project()


async def _ensure_default_project():
    """Single-project model (docs/CHANTIER_PROJET_UNIQUE.md): guarantee the
    canonical project row exists. Idempotent — the collapse migration creates
    it on existing databases; this seeds it on a fresh one."""
    async with async_session() as db:
        if await db.get(Project, DEFAULT_PROJECT_ID) is None:
            db.add(Project(id=DEFAULT_PROJECT_ID, name=DEFAULT_PROJECT_NAME))
            await db.commit()
            logger.info("Seeded canonical project %s", DEFAULT_PROJECT_ID)


app.mount("/", StaticFiles(directory="app", html=True), name="static")
