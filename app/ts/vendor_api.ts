/**
 * Vendor TPRM — REST API Client Layer
 *
 * Replaces localStorage with REST API calls.
 * Handles single-project persistence (auto-load, autosave).
 * Load BEFORE ai_common.js and TPRM_app.js.
 */

(function() {
"use strict";

var BASE = "api";
var _activeId: string | null = null;
var _saveTimer: ReturnType<typeof setTimeout> | null = null;
// When true, the next _fetch call adds `keepalive: true` so the
// request survives page navigation. Toggled by the beforeunload
// handler around _doFlush so pending PATCHes are not dropped.
var _persistKeepalive = false;

/** Options acceptées par _fetch : RequestInit dont le body peut être un
 * objet brut (sérialisé en JSON) ou un FormData (envoyé tel quel). */
interface VFetchOpts extends Omit<RequestInit, "body" | "headers"> {
    headers?: Record<string, string>;
    body?: VendorApiPayload | FormData | string;
}

async function _fetch(url: string, opts?: VFetchOpts): Promise<any> {
    opts = opts || {};
    opts.headers = opts.headers || {};
    opts.credentials = "same-origin";
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(opts.body);
    }
    // beforeunload flush asks for `keepalive` so the request survives
    // page navigation and the last edit is not lost.
    if (_persistKeepalive) {
        opts.keepalive = true;
    }
    var resp = await fetch(BASE + url, opts as RequestInit);
    if (resp.status === 401) {
        var _rp = window.location.pathname.replace(/[^/]*$/, ""); window.location.href = "/login.html?redirect=" + encodeURIComponent(_rp);
        throw new Error("Not authenticated");
    }
    if (resp.status === 403) {
        var errBody = "";
        try { errBody = await resp.text(); } catch(e) {}
        if (errBody.indexOf("pending") >= 0) {
            window.location.href = "/login.html?error=pending";
            throw new Error("Account pending");
        }
    }
    if (resp.status === 204) return null;
    if (!resp.ok) {
        var errText = "";
        try { errText = await resp.text(); } catch(e) {}
        // Surface server-side assessment validation errors (403 / 409 /
        // 422) to the user via a toast. These come from
        // src/assessment_validation.py and carry a human-readable
        // `detail` string that we display as-is. For every other code
        // we fall back to the generic log-only behavior.
        if (resp.status === 403 || resp.status === 409 || resp.status === 422) {
            var msg = errText;
            try {
                var parsed: { detail?: unknown } = JSON.parse(errText);
                if (parsed && parsed.detail) {
                    msg = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
                }
            } catch (e) {}
            if (typeof showStatus === "function") {
                showStatus("⚠ " + msg.substring(0, 200));
            }
        }
        throw new Error("API " + resp.status + ": " + errText.substring(0, 200));
    }
    return resp.json();
}

// ═══════════════════════════════════════════════════════════════
// API — project-level (legacy + blob fallback)
// ═══════════════════════════════════════════════════════════════

window.VendorAPI = {
    list: function() { return _fetch("/projects"); },
    get: function(id) { return _fetch("/projects/" + id); },
    create: function(data) { return _fetch("/projects", { method: "POST", body: data || { name: "", data: {} } }); },
    update: function(id, data) { return _fetch("/projects/" + id, { method: "PUT", body: data }); },
    del: function(id) { return _fetch("/projects/" + id, { method: "DELETE" }); },
    importFile: function(file) {
        var formData = new FormData();
        formData.append("file", file);
        return _fetch("/projects/import", { method: "POST", body: formData, headers: {} });
    },
    exportUrl: function(id) { return BASE + "/projects/" + id + "/export"; },

    // ── Blob fallback (import, undo/redo, bulk operations) ──
    saveFull: function(projectId, data) {
        return _fetch("/projects/" + projectId, {
            method: "PUT",
            body: { name: (data.metadata && data.metadata.organization) || "", data: data }
        });
    },

    // ── Vendors ──
    listVendors: function(projectId) { return _fetch("/projects/" + projectId + "/vendors"); },
    createVendor: function(projectId, data) { return _fetch("/projects/" + projectId + "/vendors", { method: "POST", body: data }); },
    patchVendor: function(projectId, vendorId, fields) { return _fetch("/projects/" + projectId + "/vendors/" + vendorId, { method: "PATCH", body: fields }); },
    deleteVendor: function(projectId, vendorId) { return _fetch("/projects/" + projectId + "/vendors/" + vendorId, { method: "DELETE" }); },

    // ── Measures ──
    createMeasure: function(projectId, vendorId, data) { return _fetch("/projects/" + projectId + "/vendors/" + vendorId + "/measures", { method: "POST", body: data }); },
    patchMeasure: function(projectId, measureId, fields) { return _fetch("/projects/" + projectId + "/measures/" + measureId, { method: "PATCH", body: fields }); },
    deleteMeasure: function(projectId, measureId) { return _fetch("/projects/" + projectId + "/measures/" + measureId, { method: "DELETE" }); },

    // ── Risks ──
    createRisk: function(projectId, data) { return _fetch("/projects/" + projectId + "/risks", { method: "POST", body: data }); },
    patchRisk: function(projectId, riskId, fields) { return _fetch("/projects/" + projectId + "/risks/" + riskId, { method: "PATCH", body: fields }); },
    deleteRisk: function(projectId, riskId) { return _fetch("/projects/" + projectId + "/risks/" + riskId, { method: "DELETE" }); },

    // ── Documents ──
    createDocument: function(projectId, data) { return _fetch("/projects/" + projectId + "/documents", { method: "POST", body: data }); },
    patchDocument: function(projectId, docId, fields) { return _fetch("/projects/" + projectId + "/documents/" + docId, { method: "PATCH", body: fields }); },
    deleteDocument: function(projectId, docId) { return _fetch("/projects/" + projectId + "/documents/" + docId, { method: "DELETE" }); },

    // ── Assessments ──
    createAssessment: function(projectId, data) { return _fetch("/projects/" + projectId + "/assessments", { method: "POST", body: data }); },
    patchAssessment: function(projectId, assessId, fields) { return _fetch("/projects/" + projectId + "/assessments/" + assessId, { method: "PATCH", body: fields }); },
    deleteAssessment: function(projectId, assessId) { return _fetch("/projects/" + projectId + "/assessments/" + assessId, { method: "DELETE" }); },

    // ── Utility ──
    verifyUrl: function(url) { return _fetch("/verify-url", { method: "POST", body: { url: url } }); },
    probeVendorUrls: function(website) { return _fetch("/probe-vendor-urls", { method: "POST", body: { website: website } }); },

    // ── AI ──
    aiComplete: function(systemPrompt, userPrompt, provider, model) {
        return _fetch("/ai/complete", {
            method: "POST",
            body: { system: systemPrompt, user: userPrompt, provider: provider || (window._aiRuntime && window._aiRuntime.provider) || "anthropic", model: model || (window._aiRuntime && window._aiRuntime.model) || "claude-sonnet-4-6" }
        });
    },
    aiConfig: function() { return _fetch("/ai/config"); },
    aiGetKeys: function() { return _fetch("/ai/keys"); },
    aiSetKeys: function(data) { return _fetch("/ai/keys", { method: "PUT", body: data }); },

    // ── Auth ──
    authMe: function() { return fetch("auth/me", { credentials: "same-origin" }).then(function(r) { return r.ok ? r.json() : null; }); },
    authProviders: function() { return fetch("auth/providers").then(function(r) { return r.json(); }); },
    // Logout clears module cookie then redirects through Pilot's /auth/logout
    // which invalidates the shared pilot_token cookie.
    authLogout: function() { return fetch("auth/logout", { method: "POST", credentials: "same-origin" }).finally(function() { window.location.href = "/auth/logout"; }); },

    // ── User admin ──
    listUsers: function() { return _fetch("/users"); },
    updateUser: function(id, data) { return _fetch("/users/" + id, { method: "PUT", body: data }); },

    // ── DORA Register of Information ────────────────────────────
    doraCodelists: function() { return _fetch("/dora/codelists"); },
    doraTree: function(projectId) { return _fetch("/projects/" + projectId + "/dora"); },
    doraValidate: function(projectId) { return _fetch("/projects/" + projectId + "/dora/validate"); },
    doraExportUrl: function(projectId, currency) {
        var q = currency ? ("?target_currency=" + encodeURIComponent(currency)) : "";
        return BASE + "/projects/" + projectId + "/dora/export.xlsx" + q;
    },
    patchVendorRoi: function(projectId, vendorId, fields) {
        return _fetch("/projects/" + projectId + "/vendors/" + vendorId + "/roi", { method: "PATCH", body: fields });
    },
    // RFE entities
    listDoraEntities: function(p) { return _fetch("/projects/" + p + "/dora/entities"); },
    createDoraEntity: function(p, d) { return _fetch("/projects/" + p + "/dora/entities", { method: "POST", body: d }); },
    patchDoraEntity: function(p, id, f) { return _fetch("/projects/" + p + "/dora/entities/" + id, { method: "PATCH", body: f }); },
    deleteDoraEntity: function(p, id) { return _fetch("/projects/" + p + "/dora/entities/" + id, { method: "DELETE" }); },
    // Functions
    listDoraFunctions: function(p) { return _fetch("/projects/" + p + "/dora/functions"); },
    createDoraFunction: function(p, d) { return _fetch("/projects/" + p + "/dora/functions", { method: "POST", body: d }); },
    patchDoraFunction: function(p, id, f) { return _fetch("/projects/" + p + "/dora/functions/" + id, { method: "PATCH", body: f }); },
    deleteDoraFunction: function(p, id) { return _fetch("/projects/" + p + "/dora/functions/" + id, { method: "DELETE" }); },
    // Branches
    listDoraBranches: function(p) { return _fetch("/projects/" + p + "/dora/branches"); },
    createDoraBranch: function(p, d) { return _fetch("/projects/" + p + "/dora/branches", { method: "POST", body: d }); },
    patchDoraBranch: function(p, id, f) { return _fetch("/projects/" + p + "/dora/branches/" + id, { method: "PATCH", body: f }); },
    deleteDoraBranch: function(p, id) { return _fetch("/projects/" + p + "/dora/branches/" + id, { method: "DELETE" }); },
    // Consolidation
    listDoraCs: function(p) { return _fetch("/projects/" + p + "/dora/consolidation"); },
    createDoraCs: function(p, d) { return _fetch("/projects/" + p + "/dora/consolidation", { method: "POST", body: d }); },
    patchDoraCs: function(p, id, f) { return _fetch("/projects/" + p + "/dora/consolidation/" + id, { method: "PATCH", body: f }); },
    deleteDoraCs: function(p, id) { return _fetch("/projects/" + p + "/dora/consolidation/" + id, { method: "DELETE" }); },
    // Arrangements
    listDoraArrangements: function(p) { return _fetch("/projects/" + p + "/dora/arrangements"); },
    createDoraArrangement: function(p, d) { return _fetch("/projects/" + p + "/dora/arrangements", { method: "POST", body: d }); },
    patchDoraArrangement: function(p, id, f) { return _fetch("/projects/" + p + "/dora/arrangements/" + id, { method: "PATCH", body: f }); },
    deleteDoraArrangement: function(p, id) { return _fetch("/projects/" + p + "/dora/arrangements/" + id, { method: "DELETE" }); },
    linkDoraArrangementRfe: function(p, aid, rid) { return _fetch("/projects/" + p + "/dora/arrangements/" + aid + "/rfes", { method: "POST", body: { rfe_id: rid } }); },
    unlinkDoraArrangementRfe: function(p, aid, rid) { return _fetch("/projects/" + p + "/dora/arrangements/" + aid + "/rfes/" + rid, { method: "DELETE" }); },
    // Signers
    createDoraSigner: function(p, aid, d) { return _fetch("/projects/" + p + "/dora/arrangements/" + aid + "/signers", { method: "POST", body: d }); },
    patchDoraSigner: function(p, aid, id, f) { return _fetch("/projects/" + p + "/dora/arrangements/" + aid + "/signers/" + id, { method: "PATCH", body: f }); },
    deleteDoraSigner: function(p, aid, id) { return _fetch("/projects/" + p + "/dora/arrangements/" + aid + "/signers/" + id, { method: "DELETE" }); },
    // Subcontractors — global identity (project-scoped)
    listDoraSubs: function(p) { return _fetch("/projects/" + p + "/dora/subcontractors"); },
    createDoraSub: function(p, d) { return _fetch("/projects/" + p + "/dora/subcontractors", { method: "POST", body: d }); },
    patchDoraSub: function(p, id, f) { return _fetch("/projects/" + p + "/dora/subcontractors/" + id, { method: "PATCH", body: f }); },
    deleteDoraSub: function(p, id) { return _fetch("/projects/" + p + "/dora/subcontractors/" + id, { method: "DELETE" }); },
    // Subcontractor ↔ arrangement junction (per-link RoI fields)
    linkDoraSub: function(p, aid, d) { return _fetch("/projects/" + p + "/dora/arrangements/" + aid + "/subcontractors", { method: "POST", body: d }); },
    patchDoraSubLink: function(p, aid, sid, f) { return _fetch("/projects/" + p + "/dora/arrangements/" + aid + "/subcontractors/" + sid, { method: "PATCH", body: f }); },
    unlinkDoraSub: function(p, aid, sid) { return _fetch("/projects/" + p + "/dora/arrangements/" + aid + "/subcontractors/" + sid, { method: "DELETE" }); }
} satisfies VendorApiClient;

// ═══════════════════════════════════════════════════════════════
// ACTIVE PROJECT ID GETTER
// ═══════════════════════════════════════════════════════════════

window.getActiveProjectId = function() { return _activeId; };



// ═══════════════════════════════════════════════════════════════
// PERSISTENCE ADAPTER
// ═══════════════════════════════════════════════════════════════
//
// Backend implementation of the shared _persist / _persistCreate /
// _persistDelete contract. Each call accumulates a PATCH delta per
// entity, flushed in a single batch after a 500ms debounce. Calls
// that don't go through _persist (import, undo/redo, template edits)
// still fall through to _autoSave which does a full blob PUT.
//
// See shared/js/cisotoolbox_local.js for the no-op opensource version
// and CLAUDE.md § "Persistence adapter" for the full contract.
// ═══════════════════════════════════════════════════════════════

var _dataReady = false;
window._setDataReady = function() { _dataReady = true; };

var _dirty: Record<string, VendorApiPayload> = {};
var _flushTimer: ReturnType<typeof setTimeout> | null = null;
// In-flight create POSTs keyed by "type:id". A debounced PATCH for a
// freshly created entity must wait for its create to commit, otherwise it
// races the POST and hits a 404 that .catch() swallows silently — the edit
// is lost while the row itself (created by the POST) persists.
var _pendingCreates: Record<string, Promise<unknown>> = {};

function _obj(k: string, v: unknown): Record<string, unknown> { var o: Record<string, unknown> = {}; o[k] = v; return o; }
// Shared persistence-adapter helper (contract: provided by the
// persistence layer). The legacy JS kept it IIFE-private, which made
// updateDocField() throw a ReferenceError — fixed by exposing it.
window._obj = _obj;

type VPatchFn = (id: string, f: VendorApiPayload) => Promise<unknown>;

var _PATCH_FNS: Record<TprmPersistType, VPatchFn> = {
    vendor:     function(id, f) { return VendorAPI.patchVendor(_activeId!, id, f); },
    measure:    function(id, f) { return VendorAPI.patchMeasure(_activeId!, id, f); },
    risk:       function(id, f) { return VendorAPI.patchRisk(_activeId!, id, f); },
    document:   function(id, f) { return VendorAPI.patchDocument(_activeId!, id, f); },
    assessment: function(id, f) { return VendorAPI.patchAssessment(_activeId!, id, f); },
    // DORA RoI
    vendor_roi:        function(id, f) { return VendorAPI.patchVendorRoi(_activeId!, id, f); },
    dora_entity:       function(id, f) { return VendorAPI.patchDoraEntity(_activeId!, id, f); },
    dora_function:     function(id, f) { return VendorAPI.patchDoraFunction(_activeId!, id, f); },
    dora_branch:       function(id, f) { return VendorAPI.patchDoraBranch(_activeId!, id, f); },
    dora_cs:           function(id, f) { return VendorAPI.patchDoraCs(_activeId!, id, f); },
    dora_arrangement:  function(id, f) { return VendorAPI.patchDoraArrangement(_activeId!, id, f); },
    // Composite ids "{arrangement_id}/{entity_id}" for arrangement-scoped entities
    dora_signer:       function(id, f) { var p = id.split("/"); return VendorAPI.patchDoraSigner(_activeId!, p[0], p[1], f); },
    // Sub identity: id is the global sub_id
    dora_subcontractor:function(id, f) { return VendorAPI.patchDoraSub(_activeId!, id, f); },
    // Sub link: composite "{arrangement_id}/{sub_id}"
    dora_sub_link:     function(id, f) { var p = id.split("/"); return VendorAPI.patchDoraSubLink(_activeId!, p[0], p[1], f); },
};

function _doFlush() {
    if (!_activeId || !_dataReady) return;
    var batch = _dirty;
    _dirty = {};
    Object.keys(batch).forEach(function(key) {
        var parts = key.split(":");
        var type = parts[0] as TprmPersistType, id = parts[1];
        var fn = _PATCH_FNS[type];
        if (!fn) return;
        var fields = batch[key];
        var fail = function(e: unknown) { console.error("PATCH " + type + " " + id + " failed:", e); };
        var pending = _pendingCreates[key];
        if (pending) {
            pending.then(function() { return fn(id, fields); }).catch(fail);
        } else {
            fn(id, fields).catch(fail);
        }
    });
}

function _flushDirty() {
    if (_flushTimer) clearTimeout(_flushTimer);
    _flushTimer = setTimeout(_doFlush, 500);
}

// Flush any pending PATCHes synchronously before the page unloads so
// fast typing + refresh does not lose the last edit. Uses
// `keepalive: true` (set in _fetch via opts.keepalive) so the in-flight
// requests survive navigation.
window.addEventListener("beforeunload", function() {
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
    if (Object.keys(_dirty).length > 0) {
        _persistKeepalive = true;
        try { _doFlush(); } finally { _persistKeepalive = false; }
    }
});

window._persist = function(entityType: string, entityId: string | number, fields: VendorApiPayload) {
    if (!_dataReady || !_activeId) return;
    var key = entityType + ":" + entityId;
    if (!_dirty[key]) _dirty[key] = {};
    Object.assign(_dirty[key], fields);
    _flushDirty();
};

window._persistCreate = function(entityType: string, data: VendorApiPayload) {
    if (!_dataReady || !_activeId) return;
    var CREATE_FNS: Partial<Record<TprmPersistType, (d: VendorApiPayload) => Promise<unknown>>> = {
        vendor:     function(d) { return VendorAPI.createVendor(_activeId!, d); },
        measure:    function(d) { return VendorAPI.createMeasure(_activeId!, (d.vendor_id as string) || "", d); },
        risk:       function(d) { return VendorAPI.createRisk(_activeId!, d); },
        document:   function(d) { return VendorAPI.createDocument(_activeId!, d); },
        assessment: function(d) { return VendorAPI.createAssessment(_activeId!, d); },
        // DORA RoI
        dora_entity:       function(d) { return VendorAPI.createDoraEntity(_activeId!, d); },
        dora_function:     function(d) { return VendorAPI.createDoraFunction(_activeId!, d); },
        dora_branch:       function(d) { return VendorAPI.createDoraBranch(_activeId!, d); },
        dora_cs:           function(d) { return VendorAPI.createDoraCs(_activeId!, d); },
        dora_arrangement:  function(d) { return VendorAPI.createDoraArrangement(_activeId!, d); },
        dora_signer:       function(d) { return VendorAPI.createDoraSigner(_activeId!, d.arrangement_id as string, d); },
        dora_subcontractor:function(d) { return VendorAPI.createDoraSub(_activeId!, d); },
        dora_sub_link:     function(d) { return VendorAPI.linkDoraSub(_activeId!, d.arrangement_id as string, d); },
    };
    var fn = CREATE_FNS[entityType as TprmPersistType];
    if (!fn) return Promise.resolve();
    var p = fn(data).catch(function(e: unknown) {
        console.error("POST " + entityType + " failed:", e);
        throw e;
    });
    // Register the in-flight create so _doFlush chains any debounced PATCH
    // for the same entity after the row exists (see _pendingCreates).
    var key = entityType + ":" + ((data && data.id) || "");
    _pendingCreates[key] = p;
    var clear = function() { if (_pendingCreates[key] === p) delete _pendingCreates[key]; };
    p.then(clear, clear);
    return p;
};

// entityId élargi string | number pour matcher le contrat _persistDelete
// (les ids vendor sont toujours des strings au runtime — cast localisé).
window._persistDelete = function(entityType: string, entityId: string | number) {
    if (!_dataReady || !_activeId) return;
    var DELETE_FNS: Partial<Record<TprmPersistType, (id: string) => Promise<unknown>>> = {
        vendor:     function(id) { return VendorAPI.deleteVendor(_activeId!, id); },
        measure:    function(id) { return VendorAPI.deleteMeasure(_activeId!, id); },
        risk:       function(id) { return VendorAPI.deleteRisk(_activeId!, id); },
        document:   function(id) { return VendorAPI.deleteDocument(_activeId!, id); },
        assessment: function(id) { return VendorAPI.deleteAssessment(_activeId!, id); },
        // DORA RoI
        dora_entity:       function(id) { return VendorAPI.deleteDoraEntity(_activeId!, id); },
        dora_function:     function(id) { return VendorAPI.deleteDoraFunction(_activeId!, id); },
        dora_branch:       function(id) { return VendorAPI.deleteDoraBranch(_activeId!, id); },
        dora_cs:           function(id) { return VendorAPI.deleteDoraCs(_activeId!, id); },
        dora_arrangement:  function(id) { return VendorAPI.deleteDoraArrangement(_activeId!, id); },
        dora_signer:       function(id) { var p = id.split("/"); return VendorAPI.deleteDoraSigner(_activeId!, p[0], p[1]); },
        dora_subcontractor:function(id) { return VendorAPI.deleteDoraSub(_activeId!, id); },
        dora_sub_link:     function(id) { var p = id.split("/"); return VendorAPI.unlinkDoraSub(_activeId!, p[0], p[1]); },
    };
    var fn = DELETE_FNS[entityType as TprmPersistType];
    if (fn) fn(entityId as string).catch(function(e: unknown) { console.error("DELETE " + entityType + " " + entityId + " failed:", e); });
};

// Blob PUT fallback — used by import, undo/redo, template edits,
// and any mutation site that hasn't been migrated to _persist() yet.
// FEAT-33 — server_rev seen at load; sent with the blob PUT (409 = a
// server-initiated write happened since: reload instead of overwrite).
var _serverRev = 0;

// FEAT-33 — a stale blob PUT was refused: warn (blocking) then reload the
// authoritative server state. The stale bulk change is lost by design.
function _staleConflict(): void {
    alert(t("chrome.stale_conflict"));
    window.location.reload();
}

window._autoSave = function() {
    if (!_dataReady) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() {
        _saveTimer = null;  // FEAT-33: a fired timer must not keep blocking the focus refresh
        if (!_activeId) return;
        var name = (D.metadata && D.metadata.organization) || "";
        VendorAPI.update(_activeId, { name: name, data: JSON.parse(JSON.stringify(D)),
                              expected_server_rev: _serverRev } as any)
            .catch(function(err: any) {
                if (err && String(err.message || "").indexOf("API 409") === 0) { _staleConflict(); return; }
                console.error("Autosave failed:", err);
            });
    }, 500);
};

// ═══════════════════════════════════════════════════════════════
// FILE IMPORT HOOK (blob save)
// ═══════════════════════════════════════════════════════════════

var _origLoadBuffer = window._loadBuffer;
if (_origLoadBuffer) {
    // Le hook source est synchrone (ne renvoie rien) alors que la décl globale
    // de _loadBuffer est async (Promise<true | null>) — cast hérité du port risk.
    (window as any)._loadBuffer = function(buffer: ArrayBuffer, filename: string) {
        _origLoadBuffer(buffer, filename);
        setTimeout(function() {
            if (_activeId) {
                VendorAPI.saveFull(_activeId, D);
            } else {
                VendorAPI.create({
                    name: (D.metadata && D.metadata.organization) || "",
                    data: JSON.parse(JSON.stringify(D))
                }).then(function(project) {
                    _activeId = project.id;
            _serverRev = (project as any).server_rev || 0;
                    localStorage.setItem("tprm_active_project", _activeId);
                });
            }
        }, 200);
    };
}

// ═══════════════════════════════════════════════════════════════
// INIT: LOAD PROJECT FROM API
// ═══════════════════════════════════════════════════════════════

window._appInitCallback = function() {
    // Retry a transient failure with backoff before giving up — the backend can
    // be briefly unreachable (e.g. while a redeploy restarts the container).
    function _retry<T>(fn: () => Promise<T>, attempts: number, delay: number): Promise<T> {
        return fn().catch(function(err: unknown) {
            if (attempts <= 1) throw err;
            return new Promise<void>(function(res) { setTimeout(res, delay); })
                .then(function() { return _retry(fn, attempts - 1, delay * 2); });
        });
    }

    // Non-destructive boot failure. Creating an empty project on a transient
    // outage produced a spurious second project that HID the real one (the
    // project list is updated_at desc, so the new empty project sorts first).
    // On persistent failure we surface an error + reload instead — never create.
    function _bootFailed() {
        var msg = "Impossible de charger le projet (serveur momentanément indisponible). "
                + "Vos données sont intactes — rechargez la page.";
        if (typeof showStatus === "function") showStatus(msg);
        if (document.getElementById("vendor-boot-error")) return;
        var b = document.createElement("div");
        b.id = "vendor-boot-error";
        b.setAttribute("role", "alert");
        b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;"
            + "color:#fff;padding:12px 16px;text-align:center;font-size:0.9em";
        b.textContent = msg + " ";
        var btn = document.createElement("button");
        btn.textContent = "Recharger";
        btn.style.cssText = "margin-left:8px;background:var(--ct-surface);color:#dc2626;border:none;border-radius:4px;"
            + "padding:4px 12px;cursor:pointer;font-weight:600";
        btn.addEventListener("click", function() { window.location.reload(); });
        b.appendChild(btn);
        document.body.appendChild(b);
    }

    function _loadAndRender(id: string) {
        _retry(function() { return VendorAPI.get(id); }, 4, 500).then(function(project) {
            _activeId = project.id;
            _serverRev = (project as any).server_rev || 0;
            localStorage.setItem("tprm_active_project", _activeId);
            var pdata = typeof project.data === "string" ? JSON.parse(project.data) : (project.data || {});
            Object.keys(D).forEach(function(k) { delete D[k]; });
            Object.assign(D, pdata);
            if (typeof _setDataReady === "function") _setDataReady();
            if (typeof renderAll === "function") renderAll();
            _handleDeepLink();
        }).catch(_bootFailed);
    }

    function _createAndRender() {
        var initData = typeof TPRM_INIT_DATA !== "undefined" ? JSON.parse(JSON.stringify(TPRM_INIT_DATA)) : {};
        VendorAPI.create({ name: "", data: initData }).then(function(project) {
            _activeId = project.id;
            _serverRev = (project as any).server_rev || 0;
            localStorage.setItem("tprm_active_project", _activeId);
            Object.keys(D).forEach(function(k) { delete D[k]; });
            Object.assign(D, initData);
            if (typeof _setDataReady === "function") _setDataReady();
            if (typeof renderAll === "function") renderAll();
            _handleDeepLink();
        }).catch(_bootFailed);
    }

    // Single-project model (docs/CHANTIER_PROJET_UNIQUE.md): always load the
    // canonical project from the API. Create a project ONLY when the list call
    // SUCCEEDS and is genuinely empty (true first run) — never on a transient
    // error, which used to spawn a spurious empty project hiding the real one.
    _retry(function() { return VendorAPI.list(); }, 4, 500).then(function(items) {
        if (items.length > 0) {
            _loadAndRender(items[0].id);
        } else {
            _createAndRender();
        }
    }).catch(_bootFailed);
};

// ═══════════════════════════════════════════════════════════════
// AUTH + TOOLBAR
// ═══════════════════════════════════════════════════════════════

// ─── Toolbar user pill (name + admin + logout) ──────────────────
function _initAuth() {
    fetch("auth/providers").then(function(r) { return r.json(); }).then(function(data: { auth_enabled?: boolean }) {
        if (!data.auth_enabled) return;
        fetch("auth/me", { credentials: "same-origin" }).then(function(r): Promise<VendorApiUser | undefined> | undefined {
            if (!r.ok) { var _rp = window.location.pathname.replace(/[^/]*$/, ""); window.location.href = "/login.html?redirect=" + encodeURIComponent(_rp); return; }
            return r.json();
        }).then(function(user) {
            if (!user) return;
            window._currentUser = user;
            var right = document.getElementById("toolbar-right");
            if (!right) return;
            var h = "";
            h += '<span style="color:var(--ct-ink-1);font-size:var(--ct-text-label);margin:0 var(--ct-s1)">' + esc(user.name || user.email) + '</span>';
            h += '<button class="ct-text-label ct-muted ct-bg-none ct-no-border ct-clickable ct-py-1 ct-px-2" data-click="_logout" title="Sign out">&#x23FB;</button>';
            var container = document.createElement("span");
            container.className = "ct-toolbar-right";
            container.style.cssText = "display:flex;align-items:center;gap:4px;margin-left:auto";
            container.innerHTML = h;
            right.parentNode!.insertBefore(container, right);
            fetch("auth/role", { credentials: "same-origin" }).then(function(rr) {
                return rr.ok ? rr.json() : {};
            }).then(function(roleInfo: { role?: string }) {
                var role = roleInfo.role || "";
                window._moduleRole = role;
                if (role) document.body.classList.add("ct-role-" + role);
                if (user.role === "admin") document.body.classList.add("ct-role-admin");
            }).catch(function() {});
        });
    }).catch(function() {});
}
window._logout = function() {
    fetch("auth/logout", { method: "POST", credentials: "same-origin" })
        .finally(function() { window.location.href = "/auth/logout"; });
};

// ═══════════════════════════════════════════════════════════════
// ADMIN PANEL — user rights management only
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// I18N
// ═══════════════════════════════════════════════════════════════

_registerTranslations("fr", {
    "admin.title": "Gestion des utilisateurs",
    "admin.user": "Utilisateur",
    "admin.role": "Rôle",
    "admin.ai": "IA",
    "admin.last_login": "Connexion",
    "admin.no_users": "Aucun utilisateur",
    "admin.ai_toggled": "Accès IA mis à jour",
    "admin.role_updated": "Rôle mis à jour"
});

_registerTranslations("en", {
    "admin.title": "User management",
    "admin.user": "User",
    "admin.role": "Role",
    "admin.ai": "AI",
    "admin.last_login": "Last login",
    "admin.no_users": "No users",
    "admin.ai_toggled": "AI access updated",
    "admin.role_updated": "Role updated"
});

// FEAT-13 — open the deep-linked measure in the native editor (shared
// reception in cisotoolbox.js; highlight fallback lives there too).
function _handleDeepLink() {
    if (typeof window.ct_handleMeasureDeepLink !== "function") return;
    window.ct_handleMeasureDeepLink({ open: function(mid: string) {
        var vendors = (D && D.vendors) || [];
        for (var vi = 0; vi < vendors.length; vi++) {
            var ms = vendors[vi].measures || [];
            for (var mi = 0; mi < ms.length; mi++) {
                if (ms[mi].id !== mid) continue;
                if (typeof selectPanel === "function") selectPanel("measures");
                if (typeof window._editVendorMeasureRow === "function") {
                    window._editVendorMeasureRow({ vendorIdx: vi, measureIdx: mi });
                }
                return true;
            }
        }
        return false;
    } });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _initAuth);
else _initAuth();


// FEAT-33 — refresh on tab focus when a server-initiated write happened
// while the tab was hidden. Skipped while local edits are in flight.
document.addEventListener("visibilitychange", function() {
    if (document.visibilityState !== "visible" || !_activeId || _saveTimer) return;
    if (typeof _dirty !== "undefined" && Object.keys(_dirty).length) return;
    VendorAPI.get(_activeId).then(function(project: any) {
        if (!project || (project.server_rev || 0) === _serverRev) return;
        _serverRev = project.server_rev || 0;
        var pdata = typeof project.data === "string" ? JSON.parse(project.data) : (project.data || {});
        Object.keys(D).forEach(function(k) { delete (D as unknown as Record<string, unknown>)[k]; });
        Object.assign(D, pdata);
        if (typeof renderAll === "function") renderAll();
        showStatus(t("chrome.stale_refreshed"));
    }).catch(function() { /* offline — ignore */ });
});

})();
