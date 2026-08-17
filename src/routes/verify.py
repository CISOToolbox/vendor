from __future__ import annotations

from urllib.parse import urlparse

from pydantic import BaseModel

import httpx
from fastapi import APIRouter, Depends

from src.auth import get_current_user
from src.models import User
from src.ssrf_guard import resolve_safe_url

router = APIRouter(prefix="/api", tags=["verify"])


class VerifyUrlRequest(BaseModel):
    url: str


class VerifyUrlResponse(BaseModel):
    url: str
    reachable: bool
    status: int | None = None


class ProbeVendorRequest(BaseModel):
    website: str


class ProbeResult(BaseModel):
    url: str
    type: str
    name: str


# Common paths to probe on vendor websites
_PROBE_PATHS = [
    ("/security", "trust_center", "Security"),
    ("/trust", "trust_center", "Trust Center"),
    ("/trust-center", "trust_center", "Trust Center"),
    ("/compliance", "certification", "Compliance"),
    ("/privacy", "privacy", "Privacy Policy"),
    ("/privacy-policy", "privacy", "Privacy Policy"),
    ("/legal/privacy", "privacy", "Privacy Policy"),
    ("/gdpr", "dpa", "GDPR"),
    ("/dpa", "dpa", "Data Processing Agreement"),
    ("/legal/dpa", "dpa", "Data Processing Agreement"),
    ("/subprocessors", "dpa", "Sub-processors"),
    ("/bug-bounty", "bug_bounty", "Bug Bounty"),
    ("/responsible-disclosure", "bug_bounty", "Responsible Disclosure"),
    ("/security/bug-bounty", "bug_bounty", "Bug Bounty"),
    ("/.well-known/security.txt", "bug_bounty", "security.txt"),
    ("/status", "status_page", "Status Page"),
    ("/sla", "sla", "SLA"),
]

# Common subdomains
_PROBE_SUBDOMAINS = [
    ("status", "status_page", "Status Page"),
    ("trust", "trust_center", "Trust Center"),
]


def _extract_domain(website: str) -> str | None:
    url = website.strip()
    if not url.startswith("http"):
        url = "https://" + url
    parsed = urlparse(url)
    # `hostname`, not `netloc`: drops any `user:pass@` prefix, which would
    # otherwise let a crafted "domain" smuggle a different authority into
    # the probe URLs built below.
    host = (parsed.hostname or "").lower()
    if not host:
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    # Keeping an arbitrary port turned this endpoint into a port scanner run
    # from the server's IP: every probe below is https, so a caller supplying
    # ":22" or ":5432" learned whether that port answers on a public host —
    # ~18 probes per call, and the SSRF guard has nothing to say about it
    # because the target is legitimately public. Only the HTTPS port survives.
    if port not in (None, 443):
        return None
    return host


# SSRF: these two endpoints take a user-supplied URL and report whether it
# answers — a network-mapping oracle if left unguarded. Every outbound call
# below therefore goes through `resolve_safe_url()` (validate the host, pin
# the connection to the IP resolved at validation time) and runs with
# `follow_redirects=False`, because a redirect target is a fresh URL that
# never passed the guard. A blocked target is reported as unreachable, the
# same way an unreachable public URL is — the caller learns nothing about
# why. Public vendor URLs keep working unchanged.
_USER_AGENT = "CISO-Toolbox-Vendor/1.0"
# Redirects are not followed, but a 3xx on a document URL still means the
# resource exists; treat it as reachable.
_REACHABLE_MAX_STATUS = 400


@router.post("/verify-url", response_model=VerifyUrlResponse)
async def verify_url(
    body: VerifyUrlRequest,
    user: User = Depends(get_current_user),
):
    url = body.url.strip()
    if not url.startswith("https://") and not url.startswith("http://"):
        return VerifyUrlResponse(url=url, reachable=False)

    try:
        pinned_url, host_headers, extensions = resolve_safe_url(url)
    except ValueError:
        # Private / loopback / metadata / unresolvable target — refuse
        # without leaking whether anything is listening.
        return VerifyUrlResponse(url=url, reachable=False)

    headers = {"User-Agent": _USER_AGENT, **host_headers}
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
        try:
            resp = await client.head(pinned_url, headers=headers, extensions=extensions)
            return VerifyUrlResponse(
                url=url,
                reachable=resp.status_code < _REACHABLE_MAX_STATUS,
                status=resp.status_code,
            )
        except httpx.RequestError:
            return VerifyUrlResponse(url=url, reachable=False)


async def _probe_head(
    client: httpx.AsyncClient, url: str, max_hops: int = 3,
) -> tuple[int, str] | None:
    """HEAD `url` with redirects followed *manually*.

    httpx never follows a redirect for us (`follow_redirects=False` on the
    client), so every hop goes back through `resolve_safe_url()` before we
    connect: a public URL cannot bounce us to 127.0.0.1 or the metadata
    service. Returns `(status, final_url)`, or None when the target is
    blocked / unreachable.
    """
    current = url
    for _ in range(max_hops + 1):
        try:
            pinned_url, host_headers, extensions = resolve_safe_url(current)
        except ValueError:
            return None
        try:
            resp = await client.head(
                pinned_url,
                headers={"User-Agent": _USER_AGENT, **host_headers},
                extensions=extensions,
            )
        except httpx.RequestError:
            return None
        if resp.status_code in (301, 302, 303, 307, 308):
            location = resp.headers.get("location", "")
            if not location:
                return resp.status_code, current
            current = str(httpx.URL(current).join(location))
            continue
        return resp.status_code, current
    return None  # redirect loop / too many hops


@router.post("/probe-vendor-urls", response_model=list[ProbeResult])
async def probe_vendor_urls(
    body: ProbeVendorRequest,
    user: User = Depends(get_current_user),
):
    domain = _extract_domain(body.website)
    if not domain:
        return []

    base = f"https://{domain}"
    urls_to_check: list[tuple[str, str, str]] = []

    for path, doc_type, name in _PROBE_PATHS:
        urls_to_check.append((f"{base}{path}", doc_type, name))

    # Strip www. for subdomain probes
    bare_domain = domain.removeprefix("www.")
    for sub, doc_type, name in _PROBE_SUBDOMAINS:
        urls_to_check.append((f"https://{sub}.{bare_domain}", doc_type, name))

    found: list[ProbeResult] = []
    seen_urls: set[str] = set()

    async with httpx.AsyncClient(timeout=8.0, follow_redirects=False) as client:
        for url, doc_type, name in urls_to_check:
            if url in seen_urls:
                continue
            seen_urls.add(url)
            probed = await _probe_head(client, url)
            if probed is None:
                continue
            status, final_url = probed
            if status >= 400:
                continue
            # Skip if redirected to homepage (same as base)
            if final_url.rstrip("/") == base.rstrip("/"):
                continue
            if final_url not in seen_urls:
                seen_urls.add(final_url)
                found.append(ProbeResult(url=final_url, type=doc_type, name=name))

    return found
