"""Vendor assessment validation and integrity enforcement.

This module is the **single source of truth** for all server-side rules
that an assessment must respect. Both the granular PATCH route
(`routes/vendor_assessments.py`) and the blob PUT route
(`routes/projects.py`) delegate to the helpers defined here so the
rules cannot be bypassed by switching transports.

─────────────────────────────────────────────────────────────────────────
WHY THIS EXISTS
─────────────────────────────────────────────────────────────────────────

Up to phase 0b, assessment validation was purely client-side:
completeness, action-plan-or-justification, status transitions, and
score computation all lived in `TPRM_app.js`. A user bypassing the UI
(DevTools, curl, a compromised browser extension) could:

  1. Mark an assessment `pending_approval` / `validated` with zero
     responses or with partial/not_covered coverage lacking action
     plans or justifications.
  2. Rewrite `template_snapshot.criticality` or `template_snapshot.*.
     weight` to fudge the aggregated maturity score.
  3. Inject arbitrary response entries against fake question ids.
  4. Push a hand-crafted `score` / `completion_rate`.
  5. Set `approved_at` / `approved_by` themselves.

This module blocks all of the above at the HTTP layer. Client-side
checks remain in place for UX (they give immediate feedback), but the
backend is now the authoritative gate.

─────────────────────────────────────────────────────────────────────────
DATA MODEL CONTRACT (must stay in sync with TPRM_app.js)
─────────────────────────────────────────────────────────────────────────

Assessment dict (simplified):

    {
      id: str,
      vendor_id: str,
      template_id: str,                       # frozen at creation
      template_version: int,                  # frozen at creation
      template_snapshot: {                    # frozen at creation — immutable
          id, name, kind: "questionnaire"|"audit",
          version, language,
          sections: [
              { id, title, questions: [
                  { id, text, expected, type,
                    weight: int (0..100),
                    criticality: "info"|"major"|"blocker",
                    options: [...] },
                  ...
              ]},
              ...
          ]
      },
      status: "draft" | "in_progress" | "pending_approval"
            | "validated" | "rejected",
      responses: [
          {
              question_id: str,
              coverage: "covered"|"partial"|"not_covered"
                      |"not_applicable" | null,
              answer: str | int | list | dict | None,
              comment: str,
              action_plans: [
                  { id, title, description, target_date, owner,
                    status: "proposed"|"in_progress"|"done" },
                  ...
              ],
              justification: str,
              documents: [str, ...],   # evidence document ids (≤50)
          },
          ...
      ],
      self_validation: bool,
      self_validated_at: ISO datetime | null,
      submitted_at: ISO datetime | null,
      approved_at: ISO datetime | null,
      approved_by: str | null,
      rejected_reason: str | null,
      score: int (0..100),                    # recomputed server-side
      completion_rate: int (0..100),          # recomputed server-side
    }

`type`, `title`, `date`, `due_date`, `vendor_id` are user-editable
through the assessment metadata form.

─────────────────────────────────────────────────────────────────────────
RULES ENFORCED
─────────────────────────────────────────────────────────────────────────

R1. **template_snapshot is immutable after creation.**
    Any PATCH or blob PUT that alters ANY field inside
    `template_snapshot` (including nested `criticality`, `weight`,
    `text`, section order, question ids) is rejected with 403. Only
    the creation request (POST) can set the snapshot.

R2. **responses[].question_id must exist in template_snapshot.**
    Injection of fake question ids is rejected with 422.

R3. **Coverage values are closed-set.**
    coverage ∈ {covered, partial, not_covered, not_applicable, null}.

R4. **Partial / not_covered requires remediation.**
    A response with coverage ∈ {partial, not_covered} must carry
    at least one action_plan with a non-empty title, OR a non-empty
    justification. This is checked on every save for the entries it
    touches (warning only) AND strictly enforced when transitioning
    to `pending_approval` / `validated`.

R5. **Status transitions are linear and gated.**
        draft ─┐
        in_progress ─┤─► pending_approval ─┬─► validated (terminal)
                     │                    └─► rejected ─► draft
    Any other transition → 409.
    `validated` is terminal: no further PATCH accepted except by an
    admin reset (not exposed via this module).

R6. **pending_approval requires full completeness.**
    Transition to pending_approval requires:
    (a) every question in template_snapshot has a response entry,
    (b) every response has a valid coverage,
    (c) every partial/not_covered response is remediated (R4),
    (d) self_validation = true.

R7. **Reviewer fields are server-assigned.**
    `submitted_at`, `approved_at`, `approved_by`, `rejected_reason`
    are set by the backend from the current request context, never
    read from the client body. The client may send them; we ignore
    them on write.

R8. **score and completion_rate are recomputed server-side.**
    Using the same formulas as TPRM_app.js:
      - completion_rate = round(answered / total * 100)
      - score = round(weighted_sum / max_weight * 100)
        where
          covered        → full weight
          partial        → 0.5 * weight
          not_covered    → 0
          not_applicable → excluded from both numerator AND denominator
    Whatever the client sends for `score` / `completion_rate` is
    ignored; we replace it with the computed value.

R9. **Legacy assessments (no template_snapshot) are exempt.**
    Assessments without `template_snapshot` are the pre-phase-0b
    format. They still pass through the routes unchanged — rules
    R1-R8 apply only when `template_snapshot` is present.

─────────────────────────────────────────────────────────────────────────
PUBLIC API
─────────────────────────────────────────────────────────────────────────

- validate_on_create(body) -> dict
    Normalize the payload of POST /assessments. Strips reviewer
    fields, accepts template_snapshot, recomputes score. Raises
    HTTPException on invalid input.

- validate_on_update(stored, body) -> dict
    Normalize the payload of PATCH /assessments/{id}. Enforces R1
    (snapshot immutability), R5 (status transitions), R7 (reviewer
    field stripping). Recomputes score. Returns the sanitized dict
    to pass to setattr() on the SQLAlchemy model.

- validate_blob(assessments, stored_map) -> list[dict]
    Normalize the `data.assessments` array of a blob PUT, validated
    against the currently-stored assessments for the same project.
    Returns the sanitized list. Raises HTTPException on any failure.

- HTTPException codes:
    400 — malformed input (missing id, bad type…)
    403 — immutability violation (template_snapshot, reviewer fields)
    409 — invalid status transition
    422 — semantic validation failure (missing responses, bad coverage,
          missing remediation, injected question_id…)
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable

from fastapi import HTTPException


# ═══════════════════════════════════════════════════════════════════════
# Constants
# ═══════════════════════════════════════════════════════════════════════

COVERAGE_VALUES = {"covered", "partial", "not_covered", "not_applicable"}
CRITICALITY_VALUES = {"info", "major", "blocker"}
ACTION_STATUS_VALUES = {"proposed", "in_progress", "done"}
STATUS_VALUES = {"draft", "in_progress", "pending_approval", "validated", "rejected"}

# Allowed transitions. Key = current status, value = set of statuses the
# client is permitted to set next. See R5. `validated` is terminal.
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"draft", "in_progress", "pending_approval"},
    "in_progress": {"draft", "in_progress", "pending_approval"},
    "pending_approval": {"pending_approval", "validated", "rejected"},
    "rejected": {"draft", "in_progress"},
    "validated": {"validated"},  # terminal: only self-idempotent
}

# Fields the client is NEVER allowed to set directly. Always stripped
# from PATCH bodies before assignment. See R7.
SERVER_ASSIGNED_FIELDS = {
    "submitted_at",
    "approved_at",
    "approved_by",
    "rejected_reason",
}


# ═══════════════════════════════════════════════════════════════════════
# Low-level helpers
# ═══════════════════════════════════════════════════════════════════════

def _err(code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _is_template_snapshot(tpl: Any) -> bool:
    return isinstance(tpl, dict) and isinstance(tpl.get("sections"), list)


def _stable_hash(obj: Any) -> str:
    """Deterministic hash of a JSON-serializable object."""
    payload = json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def _collect_questions(tpl: dict) -> list[dict]:
    """Return the flat list of questions of a template snapshot."""
    out: list[dict] = []
    for section in tpl.get("sections") or []:
        if not isinstance(section, dict):
            continue
        for q in section.get("questions") or []:
            if isinstance(q, dict) and q.get("id"):
                out.append(q)
    return out


# ═══════════════════════════════════════════════════════════════════════
# Response + template shape validation (R2, R3, R4)
# ═══════════════════════════════════════════════════════════════════════

def _validate_action_plan(ap: Any, context: str) -> dict:
    if not isinstance(ap, dict):
        raise _err(422, f"{context}: action_plan must be an object")
    status = ap.get("status", "proposed")
    if status not in ACTION_STATUS_VALUES:
        raise _err(422, f"{context}: invalid action_plan status '{status}'")
    return {
        "id": str(ap.get("id", "")),
        "title": str(ap.get("title", "")),
        "description": str(ap.get("description", "")),
        "target_date": str(ap.get("target_date", "")),
        "owner": str(ap.get("owner", "")),
        "status": status,
    }


def _validate_response_entry(entry: Any, valid_qids: set[str]) -> dict:
    """Validate one entry from assessment.responses. Raises on failure."""
    if not isinstance(entry, dict):
        raise _err(422, "responses[*] must be an object")
    qid = entry.get("question_id")
    if not qid or not isinstance(qid, str):
        raise _err(422, "responses[*].question_id is required")
    if qid not in valid_qids:
        # R2: cannot inject unknown question ids
        raise _err(422, f"responses[*]: unknown question_id '{qid}' (not in template_snapshot)")
    coverage = entry.get("coverage")
    if coverage is not None and coverage not in COVERAGE_VALUES:
        # R3
        raise _err(422, f"responses[{qid}]: invalid coverage '{coverage}'")
    action_plans_raw = entry.get("action_plans") or []
    if not isinstance(action_plans_raw, list):
        raise _err(422, f"responses[{qid}]: action_plans must be a list")
    action_plans = [_validate_action_plan(ap, f"responses[{qid}]") for ap in action_plans_raw]
    return {
        "question_id": qid,
        "coverage": coverage,
        # `answer` is type-dependent (string / number / list / dict). We
        # preserve it as-is after shallow validation: the template type
        # drives rendering and scoring, not the backend. We still reject
        # callables / binary though.
        "answer": _sanitize_answer(entry.get("answer")),
        "comment": str(entry.get("comment", "")),
        "action_plans": action_plans,
        "justification": str(entry.get("justification", "")),
        # Evidence document references attached by the vendor (frontend
        # contract TPRM_types.d.ts responses[].documents). String ids only —
        # dropping them silently on restore was audit finding FEAT-30 P1.
        "documents": [str(d) for d in entry.get("documents") or [] if isinstance(d, (str, int))][:50],
    }


def _sanitize_answer(val: Any) -> Any:
    if val is None or isinstance(val, (str, int, float, bool)):
        return val
    if isinstance(val, list):
        return [_sanitize_answer(x) for x in val]
    if isinstance(val, dict):
        return {str(k): _sanitize_answer(v) for k, v in val.items()}
    # Reject anything else (callables, classes, bytes)
    raise _err(422, f"responses[*].answer: unsupported type {type(val).__name__}")


def _response_is_remediated(entry: dict) -> bool:
    """True if a partial/not_covered response carries an action plan
    with a non-empty title OR a non-empty justification."""
    has_action = any(
        (ap.get("title") or "").strip()
        for ap in (entry.get("action_plans") or [])
    )
    has_just = bool((entry.get("justification") or "").strip())
    return has_action or has_just


# ═══════════════════════════════════════════════════════════════════════
# Completeness + scoring (R6, R8)
# ═══════════════════════════════════════════════════════════════════════

def _assessment_stats(template_snapshot: dict, responses: list[dict]) -> dict:
    """Match TPRM_app.js `_assessmentStats`: count how many questions
    are fully answered (R4-compliant). Used to gate transitions to
    `pending_approval` (R6)."""
    total = len(responses)
    answered = 0
    missing_coverage: list[str] = []
    missing_remediation: list[str] = []
    for r in responses:
        cov = r.get("coverage")
        if not cov:
            missing_coverage.append(r.get("question_id", "?"))
            continue
        if cov in ("covered", "not_applicable"):
            answered += 1
            continue
        if cov in ("partial", "not_covered"):
            if _response_is_remediated(r):
                answered += 1
            else:
                missing_remediation.append(r.get("question_id", "?"))
    return {
        "total": total,
        "answered": answered,
        "missing_coverage": missing_coverage,
        "missing_remediation": missing_remediation,
    }


def _compute_score(template_snapshot: dict, responses: list[dict]) -> int:
    """Match TPRM_app.js `_computeAssessmentV2Score`:
        covered        → full weight
        partial        → 0.5 * weight
        not_covered    → 0
        not_applicable → excluded from numerator AND denominator
    """
    q_by_id = {q["id"]: q for q in _collect_questions(template_snapshot)}
    total = 0.0
    max_w = 0.0
    for r in responses:
        if r.get("coverage") == "not_applicable":
            continue
        q = q_by_id.get(r.get("question_id"))
        if not q:
            continue
        w = q.get("weight") or 1
        try:
            w = float(w)
        except (TypeError, ValueError):
            w = 1.0
        max_w += w
        cov = r.get("coverage")
        if cov == "covered":
            total += w
        elif cov == "partial":
            total += w * 0.5
        # not_covered / None → 0
    return round((total / max_w) * 100) if max_w > 0 else 0


def _compute_completion(stats: dict) -> int:
    total = stats["total"]
    answered = stats["answered"]
    return round((answered / total) * 100) if total > 0 else 0


def _ensure_complete_for_submission(template_snapshot: dict, responses: list[dict]) -> None:
    """R6: a transition to pending_approval requires a response for every
    question in the template and every partial/not_covered response
    remediated.
    """
    template_qids = {q["id"] for q in _collect_questions(template_snapshot)}
    response_qids = {r.get("question_id") for r in responses}
    missing_questions = sorted(template_qids - response_qids)
    if missing_questions:
        raise _err(
            422,
            f"assessment is incomplete: missing responses for {len(missing_questions)} "
            f"question(s): {', '.join(missing_questions[:5])}"
            + (" …" if len(missing_questions) > 5 else ""),
        )
    stats = _assessment_stats(template_snapshot, responses)
    if stats["missing_coverage"]:
        raise _err(
            422,
            f"assessment is incomplete: {len(stats['missing_coverage'])} "
            f"question(s) without a coverage status",
        )
    if stats["missing_remediation"]:
        raise _err(
            422,
            f"assessment is incomplete: {len(stats['missing_remediation'])} "
            f"partial/not-covered question(s) without action plan nor justification: "
            f"{', '.join(stats['missing_remediation'][:5])}"
            + (" …" if len(stats["missing_remediation"]) > 5 else ""),
        )


# ═══════════════════════════════════════════════════════════════════════
# Status transition enforcement (R5)
# ═══════════════════════════════════════════════════════════════════════

def _enforce_transition(old: str | None, new: str | None) -> str:
    """Return the valid next status given `old` (DB) and `new` (client)."""
    if not new:
        return old or "draft"
    if new not in STATUS_VALUES:
        raise _err(422, f"invalid status '{new}'")
    current = old or "draft"
    if new == current:
        return new
    allowed = ALLOWED_TRANSITIONS.get(current, set())
    if new not in allowed:
        raise _err(
            409,
            f"invalid status transition '{current}' → '{new}'. "
            f"Allowed: {sorted(allowed - {current})}",
        )
    return new


# ═══════════════════════════════════════════════════════════════════════
# Immutability checks (R1)
# ═══════════════════════════════════════════════════════════════════════

def _enforce_snapshot_immutability(
    stored_snapshot: Any,
    incoming_snapshot: Any,
) -> Any:
    """R1: template_snapshot is frozen at creation time. Reject any
    PATCH / blob PUT that changes it. Returns the snapshot to store
    (always the existing one once an assessment exists).
    """
    if incoming_snapshot is None:
        return stored_snapshot
    if stored_snapshot is None:
        # First time the snapshot is set (creation path).
        return incoming_snapshot
    if _stable_hash(stored_snapshot) != _stable_hash(incoming_snapshot):
        raise _err(
            403,
            "template_snapshot is immutable after creation "
            "(criticality, weight, question text, section order and "
            "all other template fields are frozen)",
        )
    return stored_snapshot


# ═══════════════════════════════════════════════════════════════════════
# Public API
# ═══════════════════════════════════════════════════════════════════════

def validate_on_create(body: dict) -> dict:
    """Normalize the payload of POST /assessments. The caller is
    responsible for passing the dict extracted from VendorAssessmentCreate.
    Returns the sanitized dict ready for persistence.
    """
    out = dict(body)  # shallow copy, we mutate
    # Strip reviewer fields (R7)
    for f in SERVER_ASSIGNED_FIELDS:
        out.pop(f, None)
    # Legacy assessment: no template_snapshot → pass-through (R9)
    tpl = out.get("template_snapshot")
    if not _is_template_snapshot(tpl):
        return out
    # Validate responses against the template
    valid_qids = {q["id"] for q in _collect_questions(tpl)}
    responses_in = out.get("responses") or []
    if not isinstance(responses_in, list):
        raise _err(422, "responses must be a list")
    responses = [_validate_response_entry(r, valid_qids) for r in responses_in]
    out["responses"] = responses
    # Status must start as draft or in_progress on creation.
    status = out.get("status") or "draft"
    if status not in ("draft", "in_progress"):
        raise _err(409, f"new assessment cannot be created with status '{status}'")
    out["status"] = status
    # Recompute score + completion (R8)
    out["score"] = _compute_score(tpl, responses)
    stats = _assessment_stats(tpl, responses)
    out["completion_rate"] = _compute_completion(stats)
    return out


def validate_on_update(stored: Any, body: dict) -> dict:
    """Normalize the payload of PATCH /assessments/{id}.

    `stored` is the SQLAlchemy VendorAssessment row currently in DB.
    `body` is the already-Pydantic-parsed update dict
    (`model_dump(exclude_unset=True)`).

    Returns a dict ready to pass to setattr() on `stored`. The caller
    must still set `updated_at`.
    """
    incoming = dict(body)
    # Strip reviewer fields the client should not be able to set (R7)
    for f in SERVER_ASSIGNED_FIELDS:
        incoming.pop(f, None)
    # Access stored snapshot + responses. These are JSONB, so they
    # come back as dict/list directly.
    stored_snapshot = getattr(stored, "template_snapshot", None)
    stored_responses = getattr(stored, "responses", None) or []
    # R1: snapshot immutability
    if "template_snapshot" in incoming:
        incoming["template_snapshot"] = _enforce_snapshot_immutability(
            stored_snapshot, incoming["template_snapshot"]
        )
    # Legacy row (no snapshot, no incoming snapshot) → skip most checks
    effective_snapshot = (
        incoming.get("template_snapshot")
        if "template_snapshot" in incoming
        else stored_snapshot
    )
    if not _is_template_snapshot(effective_snapshot):
        # Legacy pass-through (R9). Still strip reviewer fields and
        # honour status transitions, but no response-shape validation.
        if "status" in incoming:
            incoming["status"] = _enforce_transition(
                getattr(stored, "status", None), incoming["status"]
            )
        return incoming

    valid_qids = {q["id"] for q in _collect_questions(effective_snapshot)}

    # Validate responses if present in the update (R2, R3, R4-shape)
    if "responses" in incoming:
        resp_in = incoming["responses"]
        if not isinstance(resp_in, list):
            raise _err(422, "responses must be a list")
        incoming["responses"] = [_validate_response_entry(r, valid_qids) for r in resp_in]
        effective_responses = incoming["responses"]
    else:
        effective_responses = stored_responses

    # Status transition (R5) + completeness gate for pending_approval (R6)
    if "status" in incoming:
        incoming["status"] = _enforce_transition(
            getattr(stored, "status", None), incoming["status"]
        )
        if incoming["status"] == "pending_approval":
            # R6: self_validation must be true before submission
            self_val = incoming.get("self_validation", getattr(stored, "self_validation", False))
            if not self_val:
                raise _err(422, "self_validation must be true before submitting for approval")
            _ensure_complete_for_submission(effective_snapshot, effective_responses)

    # R8: score and completion are recomputed server-side on EVERY write.
    #
    # This used to be conditional on "responses" or "template_snapshot" being
    # present in the payload, which contradicted the documented rule and left a
    # hole: neither field is in SERVER_ASSIGNED_FIELDS, so a PATCH carrying only
    # {"score": 100, "completion_rate": 100} skipped the branch entirely and was
    # written verbatim — then flowed up to the Pilot dashboard as if it had been
    # earned. Recompute whenever there is a snapshot to compute against; without
    # one there is nothing to score, so the client values are dropped rather
    # than trusted.
    if effective_snapshot:
        incoming["score"] = _compute_score(effective_snapshot, effective_responses)
        stats = _assessment_stats(effective_snapshot, effective_responses)
        incoming["completion_rate"] = _compute_completion(stats)
    else:
        incoming.pop("score", None)
        incoming.pop("completion_rate", None)

    return incoming


def validate_blob(
    assessments_in: Iterable[Any],
    stored_by_id: dict[str, dict],
) -> list[dict]:
    """Validate the `data.assessments` array coming from a blob PUT.

    `stored_by_id` maps assessment.id → the full dict currently stored
    server-side (either freshly-read from the granular tables or from
    the previously-stored blob). New ids (not in `stored_by_id`) are
    validated as creations.

    Returns the sanitized list. Each element is a dict ready to be
    re-persisted as the new blob content.
    """
    if not isinstance(assessments_in, (list, tuple)):
        raise _err(422, "assessments must be a list")

    out: list[dict] = []
    for raw in assessments_in:
        if not isinstance(raw, dict):
            raise _err(422, "assessments[*] must be an object")
        aid = raw.get("id")
        if not aid or not isinstance(aid, str):
            raise _err(422, "assessments[*].id is required")
        stored = stored_by_id.get(aid)
        if stored is None:
            # Treat as creation
            out.append(validate_on_create(raw))
            continue
        # Treat as update: use the same rules as PATCH but against the
        # stored dict rather than a SQLAlchemy row. We emulate `getattr`
        # via a tiny proxy so we can reuse validate_on_update.
        proxy = _DictAsObj(stored)
        sanitized = validate_on_update(proxy, raw)
        # validate_on_update only returned the *changes*. Merge them
        # into the stored dict so the blob contains the full record.
        merged = dict(stored)
        merged.update(sanitized)
        out.append(merged)
    return out


class _DictAsObj:
    """Tiny attribute-access proxy over a dict so `validate_on_update`
    can use `getattr(stored, 'template_snapshot', None)` uniformly
    against both SQLAlchemy rows and plain dicts from a JSONB blob."""

    def __init__(self, data: dict) -> None:
        self._data = data

    def __getattr__(self, name: str) -> Any:
        return self._data.get(name)


# ═══════════════════════════════════════════════════════════════════════
# Restore path (Pilot backup → module)
# ═══════════════════════════════════════════════════════════════════════

def validate_on_restore(assessments_in: Iterable[Any]) -> list[dict]:
    """Sanitize the ``assessments`` array coming from a Pilot backup.

    Restore semantics differ from create/update:
      * The backup is authoritative for workflow state — reviewer fields
        (``submitted_at``, ``approved_at``, ``approved_by``,
        ``rejected_reason``), ``status``, ``self_validation`` and the
        legacy snapshot are preserved as-is. Workflow rules R4/R5/R6
        are NOT re-applied: an assessment that was legitimately
        ``validated`` at backup time must come back ``validated``.
      * Structural rules R2/R3 are still enforced so a tampered backup
        cannot inject responses for nonexistent ``question_id`` values
        nor unknown coverage strings.
      * R8 (server-side recomputation of ``score`` /
        ``completion_rate``) is re-applied as defence-in-depth so a
        backup with mangled scores is normalized on restore.
      * Legacy assessments with no ``template_snapshot`` (pre-phase-0b)
        are passed through untouched (R9).

    Returns the sanitized list, ready for ``_decompose_data``.
    """
    if not isinstance(assessments_in, (list, tuple)):
        raise _err(422, "assessments must be a list")

    out: list[dict] = []
    for raw in assessments_in:
        if not isinstance(raw, dict):
            raise _err(422, "assessments[*] must be an object")
        record = dict(raw)
        tpl = record.get("template_snapshot")
        if not _is_template_snapshot(tpl):
            # Legacy row (R9): trust the backup verbatim.
            out.append(record)
            continue
        # R2/R3: structural validation of responses.
        valid_qids = {q["id"] for q in _collect_questions(tpl)}
        responses_in = record.get("responses") or []
        if not isinstance(responses_in, list):
            raise _err(422, "responses must be a list")
        responses = [_validate_response_entry(r, valid_qids) for r in responses_in]
        record["responses"] = responses
        # R8: recompute score / completion from the snapshot.
        record["score"] = _compute_score(tpl, responses)
        stats = _assessment_stats(tpl, responses)
        record["completion_rate"] = _compute_completion(stats)
        out.append(record)
    return out
