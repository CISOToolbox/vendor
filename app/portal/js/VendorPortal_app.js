/**
 * Vendor Portal — opensource questionnaire viewer / editor for vendors.
 *
 * Mono-questionnaire application:
 *  - load a .json / .ctenc / .xlsx file from the client
 *  - fill the questionnaire (same UX as the Vendor app editor)
 *  - export back as JSON (plain/encrypted) or Excel
 *
 * 100% client-side. No backend. No account. Everything in localStorage
 * under the "vp_" prefix so it never collides with the Vendor app data.
 */
// ═══════════════════════════════════════════════════════════════
// Password prompt — masked input, CSP-safe modal
// ═══════════════════════════════════════════════════════════════
//
// Native window.prompt() never masks characters (it always shows them
// in plain text). This helper builds a minimal overlay with a type=
// "password" input so the vendor's password is masked during entry.
// Returns a Promise<string|null> (null when cancelled).
// ═══════════════════════════════════════════════════════════════
function _isOverdue(dateStr) {
    if (!dateStr)
        return false;
    var d = new Date(dateStr);
    if (isNaN(d.getTime()))
        return false;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return d.getTime() < today.getTime();
}
function _portalPromptPassword(titleKey) {
    return new Promise(function (resolve) {
        var existing = document.getElementById("portal-pwd-overlay");
        if (existing)
            existing.remove();
        var overlay = document.createElement("div");
        overlay.id = "portal-pwd-overlay";
        overlay.className = "help-overlay open";
        var panel = document.createElement("div");
        panel.className = "help-panel";
        panel.style.maxWidth = "420px";
        panel.style.padding = "24px 28px";
        panel.innerHTML =
            '<h1 style="font-size:1.1em;margin:0 0 10px;border:none;padding:0">' + esc(t(titleKey)) + '</h1>' +
                '<p style="font-size:0.85em;color:var(--ct-ink-1);margin:0 0 12px">' + esc(t("portal.password_prompt_hint")) + '</p>' +
                '<input type="password" id="portal-pwd-input" style="width:100%;padding:8px 10px;border:1px solid var(--ct-line-strong);border-radius:4px;font-size:0.95em;font-family:inherit" autocomplete="off" autocapitalize="off" spellcheck="false">' +
                '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">' +
                '<button class="ct-btn" id="portal-pwd-cancel" data-variant="neutral">' + esc(t("common.cancel")) + '</button>' +
                '<button class="ct-btn" id="portal-pwd-ok">' + esc(t("common.ok")) + '</button>' +
                '</div>';
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        var input = document.getElementById("portal-pwd-input");
        var btnOk = document.getElementById("portal-pwd-ok");
        var btnCancel = document.getElementById("portal-pwd-cancel");
        function cleanup(value) {
            overlay.remove();
            document.removeEventListener("keydown", onKey);
            resolve(value);
        }
        function onKey(e) {
            if (e.key === "Enter") {
                e.preventDefault();
                cleanup(input.value);
            }
            else if (e.key === "Escape") {
                e.preventDefault();
                cleanup(null);
            }
        }
        btnOk.addEventListener("click", function () { cleanup(input.value); });
        btnCancel.addEventListener("click", function () { cleanup(null); });
        document.addEventListener("keydown", onKey);
        setTimeout(function () { input.focus(); }, 50);
    });
}
// ═══════════════════════════════════════════════════════════════
// ExcelJS lazy loader (CDN)
// ═══════════════════════════════════════════════════════════════
function _loadExcelJS() {
    return new Promise(function (resolve, reject) {
        if (typeof ExcelJS !== "undefined")
            return resolve();
        var s = document.createElement("script");
        // The portal is served from vendor/app/portal/, one level below the module's
        // js/ directory — hence "../js/vendor/". Vendoring keeps the CSP at
        // script-src 'self' and lets the portal work with no Internet access.
        s.src = "../js/vendor/exceljs.min.js";
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error("ExcelJS load error")); };
        document.head.appendChild(s);
    });
}
// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
// Single assessment-like object. Same shape as Vendor app:
//   {
//     assessment_id, vendor_id, vendor_name, date, due_date,
//     template (the full snapshot),
//     responses: [{ question_id, coverage, answer, comment,
//                   action_plans: [], justification }],
//     exported_at
//   }
var Q = null;
var LS_KEY = "vp_questionnaire"; // localStorage key (prefixed as agreed)
var _autosaveTimer = null;
// Session password — held in RAM only for the lifetime of the current
// tab. It is set when the vendor opens an encrypted link (or an encrypted
// .ctenc file), and reused when exporting the response so the vendor does
// not have to type a new secret. Never written to localStorage, cookies,
// sessionStorage or any other persistent storage.
var _sessionPassword = null;
// ═══════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", function () {
    // Language button reflects the target to switch to
    _updateLangButton();
    // If the URL hash carries an encrypted payload, decode it first.
    // Otherwise, try to reload any work in progress.
    if (_hasHashPayload()) {
        _renderHashLoading();
        _decodeHashPayload();
    }
    else {
        _loadFromLocalStorage();
        _render();
    }
});
// Detect the presence of a `#data=v1gz.xxxxx` fragment on the URL.
function _hasHashPayload() {
    var h = window.location.hash || "";
    return h.indexOf("#data=") === 0;
}
function _renderHashLoading() {
    var c = document.getElementById("content");
    c.innerHTML = '<div class="portal-welcome"><h1>' + esc(t("portal.loading_title")) + '</h1>'
        + '<p class="subtitle">' + esc(t("portal.loading_hint")) + '</p></div>';
}
// Decode #data=v1gz.<base64url> → prompt password → decrypt → gunzip → load Q
function _decodeHashPayload() {
    var frag = window.location.hash.replace(/^#data=/, "");
    // Clear the hash immediately so the encrypted payload stops being
    // visible in the address bar once we've grabbed it.
    try {
        history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    catch (e) { }
    var prefix, b64;
    var dotIdx = frag.indexOf(".");
    if (dotIdx > 0) {
        prefix = frag.substring(0, dotIdx);
        b64 = frag.substring(dotIdx + 1);
    }
    else {
        prefix = "v1";
        b64 = frag;
    }
    var bytes;
    try {
        bytes = _base64UrlToBytes(b64);
    }
    catch (e) {
        alert(t("portal.invalid_link"));
        Q = null;
        _render();
        return;
    }
    _portalPromptPassword("portal.password_prompt").then(function (pwd) {
        if (pwd === null) {
            Q = null;
            _render();
            return;
        }
        _decryptData(bytes.buffer, pwd).then(function (plain) {
            // For v1gz: the encrypted plaintext is a base64 string of gzipped
            // bytes. Decode base64 → bytes → gunzip → JSON text.
            var jsonPromise;
            if (prefix === "v1gz") {
                var gzBytes = _base64ToBytes(plain);
                jsonPromise = _gunzip(gzBytes);
            }
            else {
                jsonPromise = Promise.resolve(plain);
            }
            return jsonPromise;
        }).then(function (jsonText) {
            // Remember the password in RAM for the export flow
            _sessionPassword = pwd;
            _handleJSONText(jsonText);
        }).catch(function (err) {
            console.error("Hash payload decoding failed:", err);
            alert(t("portal.password_wrong"));
            Q = null;
            _render();
        });
    }); // close _portalPromptPassword().then
}
function _base64UrlToBytes(b64url) {
    // Restore standard base64 padding and characters
    var b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4)
        b64 += "=";
    return _base64ToBytes(b64);
}
function _base64ToBytes(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
async function _gunzip(bytes) {
    if (typeof DecompressionStream === "undefined") {
        // Fallback: try to interpret bytes as plain UTF-8 (old browser,
        // should never happen on a link built by a modern browser).
        return new TextDecoder().decode(bytes);
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    var buf = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(buf);
}
function _render() {
    var c = document.getElementById("content");
    if (!Q)
        c.innerHTML = _renderWelcome();
    else
        c.innerHTML = _renderQuestionnaire();
    // After render, handle broken/missing elements for the upload inputs
    _wireFileInputs();
    // Keep the language button state in sync with Q (forced when loaded)
    _updateLangButton();
}
function _wireFileInputs() {
    var fi = document.getElementById("portal-file-json");
    if (fi)
        fi.addEventListener("change", _onFileJSON, { once: true });
    var dz = document.getElementById("portal-dropzone");
    if (dz) {
        dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("drag-over"); });
        dz.addEventListener("dragleave", function () { dz.classList.remove("drag-over"); });
        dz.addEventListener("drop", function (e) {
            e.preventDefault();
            dz.classList.remove("drag-over");
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                var fakeEvent = { target: { files: [e.dataTransfer.files[0]] } };
                _onFileJSON(fakeEvent);
            }
        });
    }
}
// ═══════════════════════════════════════════════════════════════
// WELCOME SCREEN
// ═══════════════════════════════════════════════════════════════
function _renderWelcome() {
    var h = '<div class="portal-welcome">';
    h += '<h1>' + esc(t("portal.welcome_title")) + '</h1>';
    h += '<p class="subtitle">' + esc(t("portal.welcome_subtitle")) + '</p>';
    // Primary path — the vendor should have received a link
    h += '<div class="portal-primary-info">';
    h += '<div class="icon">&#x1F517;</div>';
    h += '<div class="title">' + esc(t("portal.primary_title")) + '</div>';
    h += '<div class="desc">' + esc(t("portal.primary_desc")) + '</div>';
    h += '</div>';
    // Divider
    h += '<div class="portal-or">' + esc(t("portal.or")) + '</div>';
    // Secondary path — drop a file
    h += '<label class="portal-import-card" id="portal-dropzone" for="portal-file-json">';
    h += '<div class="icon">&#x1F4C4;</div>';
    h += '<div class="title">' + esc(t("portal.import_json_title")) + '</div>';
    h += '<div class="desc">' + esc(t("portal.import_json_desc")) + '</div>';
    h += '<input type="file" id="portal-file-json" accept=".json,.ctenc">';
    h += '</label>';
    h += '<div class="portal-privacy">' + t("portal.privacy_notice") + '</div>';
    h += '</div>';
    return h;
}
// ═══════════════════════════════════════════════════════════════
// FILE IMPORT
// ═══════════════════════════════════════════════════════════════
function _onFileJSON(e) {
    var file = e.target.files && e.target.files[0];
    if (!file)
        return;
    var name = file.name.toLowerCase();
    if (name.endsWith(".ctenc")) {
        _portalPromptPassword("portal.password_prompt").then(function (pwd) {
            if (pwd === null) {
                _render();
                return;
            }
            var reader = new FileReader();
            reader.onload = function (ev) {
                _decryptData(ev.target.result, pwd).then(function (text) {
                    // Remember the password in RAM for the export flow
                    _sessionPassword = pwd;
                    _handleJSONText(text);
                }).catch(function () {
                    alert(t("portal.password_wrong"));
                    _render();
                });
            };
            reader.readAsArrayBuffer(file);
        });
    }
    else if (name.endsWith(".json")) {
        var reader2 = new FileReader();
        reader2.onload = function (ev) { _handleJSONText(ev.target.result); };
        reader2.readAsText(file);
    }
    else {
        alert(t("portal.unsupported_format"));
        _render();
    }
}
function _handleJSONText(text) {
    var payload;
    try {
        payload = JSON.parse(text);
    }
    catch (e) {
        alert(t("portal.invalid_json"));
        _render();
        return;
    }
    if (!payload || payload.format !== "ciso_toolbox_vendor_assessment" || !payload.template) {
        alert(t("portal.invalid_payload"));
        _render();
        return;
    }
    Q = {
        assessment_id: payload.assessment_id,
        vendor_id: payload.vendor_id,
        vendor_name: payload.vendor_name,
        client_organization: payload.client_organization || payload.organization || "",
        date: payload.date,
        due_date: payload.due_date || "",
        template: payload.template,
        responses: (payload.responses || []).map(_hydrateResponse),
        self_validation: !!payload.self_validation,
        self_validated_at: payload.self_validated_at || null,
        exported_at: payload.exported_at || ""
    };
    _ensureResponsesForTemplate(Q);
    // Set the UI locale to the template language the first time the
    // questionnaire is loaded. The user can still toggle manually after
    // that (in case they prefer the other locale).
    _applyInitialLocaleFromQuestionnaire();
    _saveToLocalStorage();
    showStatus(t("portal.file_loaded"));
    _render();
}
window._handleJSONText = _handleJSONText;
// Called once when a questionnaire is loaded (link, file, or resumed
// from localStorage). Sets the UI locale to match the template language
// as a sensible default, but does NOT prevent the user from toggling
// afterwards.
function _applyInitialLocaleFromQuestionnaire() {
    if (!Q || !Q.template)
        return;
    var lang = (Q.template.language || "fr").toLowerCase();
    if (lang !== "fr" && lang !== "en")
        lang = "fr";
    if (typeof switchLang === "function" && typeof _locale !== "undefined" && _locale !== lang) {
        switchLang(lang);
    }
    _updateLangButton();
}
function _hydrateResponse(r) {
    return {
        question_id: r.question_id,
        coverage: r.coverage || null,
        answer: r.answer == null ? null : r.answer,
        comment: r.comment || "",
        action_plans: Array.isArray(r.action_plans) ? r.action_plans.map(function (ap) {
            return {
                id: ap.id || "AP-001",
                title: ap.title || "",
                description: ap.description || "",
                target_date: ap.target_date || "",
                owner: ap.owner || "",
                status: ap.status || "proposed"
            };
        }) : [],
        justification: r.justification || ""
    };
}
// Make sure every question in the template has a corresponding response.
// Defensive: the client could send a payload with partial responses.
function _ensureResponsesForTemplate(q) {
    if (!q || !q.template || !q.template.sections)
        return;
    if (!Array.isArray(q.responses))
        q.responses = [];
    var byId = {};
    q.responses.forEach(function (r) { byId[r.question_id] = r; });
    var out = [];
    q.template.sections.forEach(function (s) {
        (s.questions || []).forEach(function (qu) {
            out.push(byId[qu.id] || {
                question_id: qu.id,
                coverage: null,
                answer: qu.type === "multi_choice" ? [] : null,
                comment: "",
                action_plans: [],
                justification: ""
            });
        });
    });
    q.responses = out;
}
// ═══════════════════════════════════════════════════════════════
// QUESTIONNAIRE VIEW (re-implementation focused on the vendor side)
// ═══════════════════════════════════════════════════════════════
var QUESTION_TYPES = ["yes_no", "scale_1_5", "single_choice", "multi_choice", "free_text", "file_upload"];
function _renderQuestionnaire() {
    var tpl = Q.template;
    var stats = _computeStats();
    var h = '<div class="portal-header">';
    h += '<button class="ct-btn" data-click="_portalBackHome">&laquo; ' + esc(t("portal.back_to_home")) + '</button>';
    h += '<div style="flex:1;min-width:0">';
    h += '<h2>' + esc(tpl.name || "") + '</h2>';
    var meta = [];
    if (Q.vendor_name)
        meta.push(esc(t("portal.header_for")) + " <strong>" + esc(Q.vendor_name) + "</strong>");
    if (Q.due_date) {
        var overdue = _isOverdue(Q.due_date);
        var dueHtml = esc(t("portal.header_due")) + " <strong>" + esc(Q.due_date) + "</strong>";
        if (overdue) {
            dueHtml = '<span class="vp-due-overdue" title="' + esc(t("portal.due_overdue")) + '">&#9888; ' + dueHtml + ' &mdash; ' + esc(t("portal.due_overdue")) + '</span>';
        }
        meta.push(dueHtml);
    }
    h += '<div class="portal-header-meta">' + meta.join(" &middot; ") + '</div>';
    h += '</div>';
    h += '</div>';
    // Progress bar
    var completion = stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0;
    h += '<div id="vp-progress-wrap" style="margin-bottom:14px">';
    h += '<div style="display:flex;align-items:center;gap:10px">';
    h += '<div style="flex:1;height:8px;background:var(--ct-canvas);border-radius:4px;overflow:hidden">';
    h += '<div id="vp-progress-bar" style="width:' + completion + '%;height:100%;background:' + (completion === 100 ? 'var(--ct-low)' : 'var(--ct-accent)') + ';border-radius:4px;transition:width 0.3s"></div>';
    h += '</div>';
    h += '<span id="vp-progress-label" style="font-size:0.82em;font-weight:600;color:' + (completion === 100 ? 'var(--ct-low)' : 'var(--ct-ink-1)') + '">' + completion + '% (' + stats.answered + '/' + stats.total + ')</span>';
    h += '</div>';
    h += '<div id="vp-hints">' + _renderHints(stats) + '</div>';
    h += '</div>';
    // Export buttons moved to the bottom (rendered after the self-validation
    // block, and only once all prerequisites are met — see _renderExportActions).
    // Sections + questions
    (tpl.sections || []).forEach(function (section) {
        h += '<div class="tpl-section">';
        h += '<div class="tpl-section-header">';
        h += '<span class="tpl-section-id">' + esc(section.id) + '</span>';
        h += '<span class="tpl-section-title" style="border:none;font-size:1em;font-weight:700">' + esc(section.title) + '</span>';
        h += '</div>';
        if (section.description) {
            h += '<div style="font-size:0.85em;color:var(--ct-ink-1);margin-bottom:10px">' + esc(section.description) + '</div>';
        }
        (section.questions || []).forEach(function (q) {
            var resp = _findResp(q.id);
            h += _renderQuestion(section, q, resp);
        });
        h += '</div>';
    });
    // Self-validation
    var canValidate = completion === 100;
    var blockStyle = canValidate ? "border-color:var(--ct-accent)" : "border-color:var(--ct-line-strong);opacity:0.75";
    h += '<div id="vp-validation-block" class="tpl-section" style="' + blockStyle + '">';
    h += '<div class="tpl-section-header">';
    h += '<span class="tpl-section-title" style="border:none;font-size:1em;font-weight:700">' + esc(_vpTk("assessment.self_validation_title")) + '</span>';
    h += '</div>';
    h += '<p style="font-size:0.85em;color:var(--ct-ink-1);margin:0 0 10px">' + esc(_vpTk("assessment.self_validation_hint")) + '</p>';
    var cursor = canValidate ? "pointer" : "not-allowed";
    h += '<label id="vp-validation-label" style="display:flex;align-items:center;gap:8px;font-size:0.9em;font-weight:600;cursor:' + cursor + '">';
    h += '<input type="checkbox" id="vp-validation-check"' + (Q.self_validation ? " checked" : "") + (canValidate ? "" : " disabled") + ' data-change="_portalToggleSelfValidation" data-pass-checked>';
    h += '<span>' + esc(_vpTk("assessment.self_validation_label")) + '</span>';
    h += '</label>';
    h += '<div id="vp-validation-helper" style="font-size:0.78em;color:var(--ct-high);margin-top:6px;display:' + (canValidate ? "none" : "block") + '">';
    h += '&#9888; ' + esc(t("assessment.complete_all_questions") || "Répondez à toutes les questions");
    h += '</div>';
    h += '</div>';
    // Export — at the bottom, shown only once every prerequisite is met
    // (questionnaire complete + self-validation ticked). Otherwise a hint.
    h += '<div class="portal-actions" id="vp-export-actions" style="margin-top:16px;justify-content:flex-end">';
    h += _renderExportActionsInner(stats, completion);
    h += '</div>';
    return h;
}
// Prerequisites for exporting/submitting a filled response. completion===100
// already implies every partial/not_covered answer carries an action plan or a
// justification (see _computeStats), so it + self-validation is the full gate.
function _exportReady(stats, completion) {
    return completion === 100 && !!(Q && Q.self_validation);
}
function _renderExportActionsInner(stats, completion) {
    if (_exportReady(stats, completion)) {
        return '<button class="ct-btn" data-variant="primary" data-click="_portalExportJSON">' + esc(t("portal.export_json")) + '</button>'
            + '<button class="ct-btn" data-variant="primary" data-click="_portalExportExcel">' + esc(t("portal.export_excel")) + '</button>';
    }
    return '<span class="ct-hint">' + esc(_vpTk("portal.export_prereq_hint")) + '</span>';
}
function _renderQuestion(section, q, resp) {
    var kind = (Q.template && Q.template.kind) || "questionnaire";
    var h = '<div class="tpl-question" style="background:white">';
    // Header
    h += '<div class="tpl-question-header">';
    h += '<span class="tpl-question-id">' + esc(q.id) + '</span>';
    h += '<span class="tpl-question-id" style="min-width:auto;border:none;background:var(--ct-surface-2)">' + esc(t("qtype." + (q.type || "free_text"))) + '</span>';
    h += '</div>';
    h += '<div style="font-weight:600;font-size:0.95em;margin:6px 0">' + esc(q.text || "") + '</div>';
    if (q.expected) {
        h += '<details style="margin-bottom:8px"><summary style="font-size:0.78em;color:var(--ct-accent);cursor:pointer">' + esc(t("assessment.expected")) + '</summary>';
        h += '<div style="font-size:0.82em;color:var(--ct-ink-1);padding:6px 0">' + esc(q.expected) + '</div>';
        h += '</details>';
    }
    // Type-specific input
    h += _renderAnswerInput(q, resp);
    // Coverage pills
    h += '<div style="margin-top:10px">';
    h += '<div style="font-size:0.74em;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--ct-ink-1);margin-bottom:4px">' + esc(t("assessment.coverage")) + '</div>';
    h += '<div class="answer-pills">';
    ["covered", "partial", "not_covered", "not_applicable"].forEach(function (cov) {
        var sel = resp.coverage === cov ? " selected" : "";
        var cls = cov === "covered" ? "compliant" : (cov === "partial" ? "partial" : (cov === "not_covered" ? "non_compliant" : ""));
        h += '<div class="answer-pill ' + cls + sel + '" data-click="_portalSetCoverage" data-args=\'' + _da(q.id, cov) + '\'>' + esc(t("coverage." + cov)) + '</div>';
    });
    h += '</div>';
    h += '</div>';
    // Comment
    h += '<div style="margin-top:8px">';
    h += '<textarea rows="2" class="tpl-question-expected" placeholder="' + esc(t("assessment.comment")) + '" data-input="_portalOnCommentChange" data-args=\'' + _da(q.id) + '\' data-pass-value>' + esc(resp.comment || "") + '</textarea>';
    h += '</div>';
    // Action plans (only when partial / not_covered)
    if (resp.coverage === "partial" || resp.coverage === "not_covered") {
        var hasAction = (resp.action_plans && resp.action_plans.length > 0 &&
            resp.action_plans.some(function (ap) { return (ap.title || "").trim().length > 0; }));
        var hasJust = (resp.justification || "").trim().length > 0;
        var satisfied = hasAction || hasJust;
        var blockColor = satisfied ? "var(--ct-low)" : "var(--ct-high)";
        var blockBg = satisfied ? "#ecfdf5" : "#fff7ed";
        h += '<div id="vp-actionblk-' + esc(q.id) + '" style="margin-top:10px;padding:12px;background:' + blockBg + ';border-radius:4px;border-left:4px solid ' + blockColor + '">';
        if (!satisfied) {
            h += '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px">';
            h += '<span style="color:var(--ct-high);font-size:1.1em;line-height:1">&#9888;</span>';
            h += '<div>';
            h += '<div style="font-size:0.85em;font-weight:700;color:#7c2d12">' + esc(t("assessment.action_required_title")) + '</div>';
            h += '<div style="font-size:0.78em;color:#7c2d12;margin-top:2px">' + esc(resp.coverage === "partial" ? t("assessment.action_required_partial") : t("assessment.action_required_not_covered")) + '</div>';
            h += '</div>';
            h += '</div>';
        }
        else {
            h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;color:#166534;font-size:0.82em;font-weight:600">';
            h += '<span>&#10003;</span>';
            h += esc(hasAction ? t("assessment.action_recorded") : t("assessment.justification_recorded"));
            h += '</div>';
        }
        if (resp.action_plans && resp.action_plans.length) {
            resp.action_plans.forEach(function (ap, api) {
                h += _renderActionPlanForm(q.id, ap, api);
            });
        }
        h += '<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">';
        h += '<button class="ct-btn" data-variant="primary" data-size="sm" data-click="_portalAddActionPlan" data-args=\'' + _da(q.id) + '\'>+ ' + esc(t("assessment.add_action_plan")) + '</button>';
        h += '</div>';
        h += '<div style="margin-top:10px">';
        h += '<label style="font-size:0.78em;font-weight:600;color:var(--ct-ink-1);display:block;margin-bottom:3px">' + esc(t("assessment.justification_or")) + '</label>';
        h += '<textarea rows="2" class="tpl-question-expected" placeholder="' + esc(t("assessment.justification_placeholder")) + '" data-input="_portalOnJustificationChange" data-args=\'' + _da(q.id) + '\' data-pass-value>' + esc(resp.justification || "") + '</textarea>';
        h += '</div>';
        h += '</div>';
    }
    h += '</div>';
    return h;
}
function _renderAnswerInput(q, resp) {
    // Templates only carry free_text questions now.
    var val = resp.answer;
    return '<textarea rows="3" class="tpl-question-text" placeholder="' + esc(t("assessment.your_answer")) + '" data-input="_portalSetAnswerText" data-args=\'' + _da(q.id) + '\' data-pass-value>' + esc(val || "") + '</textarea>';
}
function _renderActionPlanForm(qid, ap, api) {
    var h = '<div style="background:white;border:1px solid var(--ct-line);border-radius:4px;padding:8px 10px;margin-bottom:6px">';
    h += '<div style="display:flex;gap:6px;margin-bottom:6px">';
    h += '<input type="text" value="' + esc(ap.title || "") + '" placeholder="' + esc(t("assessment.ap_title")) + '" style="flex:1;padding:4px 8px;border:1px solid var(--ct-line-strong);border-radius:4px;font-size:0.85em" data-input="_portalUpdateAP" data-args=\'' + _da(qid, api, "title") + '\' data-pass-value>';
    h += '<input type="date" value="' + esc(ap.target_date || "") + '" style="padding:4px 8px;border:1px solid var(--ct-line-strong);border-radius:4px;font-size:0.85em" data-input="_portalUpdateAP" data-args=\'' + _da(qid, api, "target_date") + '\' data-pass-value>';
    h += '<input type="text" value="' + esc(ap.owner || "") + '" placeholder="' + esc(t("assessment.ap_owner")) + '" style="width:120px;padding:4px 8px;border:1px solid var(--ct-line-strong);border-radius:4px;font-size:0.85em" data-input="_portalUpdateAP" data-args=\'' + _da(qid, api, "owner") + '\' data-pass-value>';
    h += '<button class="tpl-icon-btn danger" data-click="_portalRemoveAP" data-args=\'' + _da(qid, api) + '\' title="' + esc(t("common.delete")) + '">&times;</button>';
    h += '</div>';
    h += '<textarea rows="2" placeholder="' + esc(t("assessment.ap_description")) + '" style="width:100%;padding:4px 8px;border:1px solid var(--ct-line-strong);border-radius:4px;font-size:0.85em;font-family:inherit;box-sizing:border-box;resize:vertical" data-input="_portalUpdateAP" data-args=\'' + _da(qid, api, "description") + '\' data-pass-value>' + esc(ap.description || "") + '</textarea>';
    h += '</div>';
    return h;
}
function _renderHints(stats) {
    if (stats.missingCoverage === 0 && stats.missingActionPlan === 0)
        return "";
    var h = '<div style="font-size:0.8em;margin-top:6px;padding:8px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;color:#7c2d12">';
    if (stats.missingCoverage > 0) {
        h += '<div style="margin-bottom:' + (stats.missingActionPlan > 0 ? "4px" : "0") + '">';
        h += '<span style="font-weight:700">&#9888; ' + stats.missingCoverage + ' ' + esc(t("assessment.without_coverage")) + '</span>';
        h += '</div>';
    }
    if (stats.missingActionPlan > 0) {
        h += '<div>';
        h += '<span style="font-weight:700">&#9888; ' + stats.missingActionPlan + ' ' + esc(t("assessment.without_action_plan_long")) + '</span>';
        h += '</div>';
    }
    h += '</div>';
    return h;
}
// ═══════════════════════════════════════════════════════════════
// HANDLERS (all window.* so data-click can dispatch)
// ═══════════════════════════════════════════════════════════════
function _findResp(questionId) {
    if (!Q || !Q.responses)
        return null;
    return Q.responses.find(function (r) { return r.question_id === questionId; });
}
function _computeStats() {
    var total = (Q && Q.responses && Q.responses.length) || 0;
    var answered = 0, missingCoverage = 0, missingActionPlan = 0;
    (Q && Q.responses || []).forEach(function (r) {
        if (!r.coverage) {
            missingCoverage++;
            return;
        }
        if (r.coverage === "covered" || r.coverage === "not_applicable") {
            answered++;
            return;
        }
        if (r.coverage === "partial" || r.coverage === "not_covered") {
            var hasAction = (r.action_plans && r.action_plans.length > 0 &&
                r.action_plans.some(function (ap) { return (ap.title || "").trim().length > 0; }));
            var hasJust = (r.justification || "").trim().length > 0;
            if (hasAction || hasJust)
                answered++;
            else
                missingActionPlan++;
        }
    });
    return { total: total, answered: answered, missingCoverage: missingCoverage, missingActionPlan: missingActionPlan };
}
function _portalSetCoverage(qid, cov) {
    var r = _findResp(qid);
    if (!r)
        return;
    r.coverage = cov;
    if (cov === "covered" || cov === "not_applicable") {
        r.action_plans = [];
        r.justification = "";
    }
    _saveToLocalStorage();
    _render();
}
window._portalSetCoverage = _portalSetCoverage;
function _portalSetAnswer(qid, value) {
    var r = _findResp(qid);
    if (!r)
        return;
    r.answer = value;
    _saveToLocalStorage();
    _refreshLiveState(qid);
}
window._portalSetAnswer = _portalSetAnswer;
function _portalSetAnswerText(qid, value) {
    var r = _findResp(qid);
    if (!r)
        return;
    r.answer = value;
    _saveToLocalStorage();
    _refreshLiveState(qid);
}
window._portalSetAnswerText = _portalSetAnswerText;
function _portalToggleMulti(qid, opt) {
    var r = _findResp(qid);
    if (!r)
        return;
    if (!Array.isArray(r.answer))
        r.answer = [];
    var idx = r.answer.indexOf(opt);
    if (idx >= 0)
        r.answer.splice(idx, 1);
    else
        r.answer.push(opt);
    _saveToLocalStorage();
    _render();
}
window._portalToggleMulti = _portalToggleMulti;
function _portalUploadFile(qid, el) {
    if (!el.files || !el.files[0])
        return;
    var file = el.files[0];
    if (file.size > 500 * 1024) {
        alert(t("assessment.file_too_large"));
        el.value = "";
        return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
        var bytes = new Uint8Array(e.target.result);
        var binary = "";
        for (var i = 0; i < bytes.length; i++)
            binary += String.fromCharCode(bytes[i]);
        var r = _findResp(qid);
        if (!r)
            return;
        r.answer = { name: file.name, size: file.size, data: btoa(binary) };
        _saveToLocalStorage();
        _render();
    };
    reader.readAsArrayBuffer(file);
}
window._portalUploadFile = _portalUploadFile;
function _portalClearFile(qid) {
    var r = _findResp(qid);
    if (!r)
        return;
    r.answer = null;
    _saveToLocalStorage();
    _render();
}
window._portalClearFile = _portalClearFile;
function _portalOnCommentChange(qid, value) {
    var r = _findResp(qid);
    if (!r)
        return;
    r.comment = value;
    _saveToLocalStorage();
}
window._portalOnCommentChange = _portalOnCommentChange;
function _portalOnJustificationChange(qid, value) {
    var r = _findResp(qid);
    if (!r)
        return;
    r.justification = value;
    _saveToLocalStorage();
    _refreshLiveState(qid);
}
window._portalOnJustificationChange = _portalOnJustificationChange;
function _portalAddActionPlan(qid) {
    var r = _findResp(qid);
    if (!r)
        return;
    if (!r.action_plans)
        r.action_plans = [];
    r.action_plans.push({
        id: "AP-" + String(r.action_plans.length + 1).padStart(3, "0"),
        title: "", description: "", target_date: "", owner: "", status: "proposed"
    });
    _saveToLocalStorage();
    _render();
}
window._portalAddActionPlan = _portalAddActionPlan;
function _portalRemoveAP(qid, apIdx) {
    var r = _findResp(qid);
    if (!r || !r.action_plans)
        return;
    r.action_plans.splice(apIdx, 1);
    _saveToLocalStorage();
    _render();
}
window._portalRemoveAP = _portalRemoveAP;
function _portalUpdateAP(qid, apIdx, field, value) {
    var r = _findResp(qid);
    if (!r || !r.action_plans || !r.action_plans[apIdx])
        return;
    r.action_plans[apIdx][field] = value;
    _saveToLocalStorage();
    _refreshLiveState(qid);
}
window._portalUpdateAP = _portalUpdateAP;
function _portalToggleSelfValidation(checked) {
    Q.self_validation = !!checked;
    Q.self_validated_at = checked ? new Date().toISOString() : null;
    _saveToLocalStorage();
    _render();
}
window._portalToggleSelfValidation = _portalToggleSelfValidation;
// Live state refresh (no full re-render; keeps focus while typing)
function _refreshLiveState(qid) {
    var stats = _computeStats();
    var completion = stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0;
    var bar = document.getElementById("vp-progress-bar");
    var label = document.getElementById("vp-progress-label");
    if (bar) {
        bar.style.width = completion + "%";
        bar.style.background = completion === 100 ? "var(--ct-low)" : "var(--ct-accent)";
    }
    if (label) {
        label.textContent = completion + "% (" + stats.answered + "/" + stats.total + ")";
        label.style.color = completion === 100 ? "var(--ct-low)" : "var(--ct-ink-1)";
    }
    var hints = document.getElementById("vp-hints");
    if (hints)
        hints.innerHTML = _renderHints(stats);
    if (qid) {
        var r = _findResp(qid);
        var block = document.getElementById("vp-actionblk-" + qid);
        if (r && block && (r.coverage === "partial" || r.coverage === "not_covered")) {
            var hasAction = (r.action_plans && r.action_plans.length > 0 &&
                r.action_plans.some(function (ap) { return (ap.title || "").trim().length > 0; }));
            var hasJust = (r.justification || "").trim().length > 0;
            var satisfied = hasAction || hasJust;
            block.style.background = satisfied ? "#ecfdf5" : "#fff7ed";
            block.style.borderLeftColor = satisfied ? "var(--ct-low)" : "var(--ct-high)";
            var banner = block.firstElementChild;
            if (banner) {
                if (satisfied) {
                    banner.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;color:#166534;font-size:0.82em;font-weight:600">'
                        + '<span>&#10003;</span>'
                        + esc(hasAction ? t("assessment.action_recorded") : t("assessment.justification_recorded"))
                        + '</div>';
                }
                else {
                    banner.innerHTML = '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px">'
                        + '<span style="color:var(--ct-high);font-size:1.1em;line-height:1">&#9888;</span>'
                        + '<div>'
                        + '<div style="font-size:0.85em;font-weight:700;color:#7c2d12">' + esc(t("assessment.action_required_title")) + '</div>'
                        + '<div style="font-size:0.78em;color:#7c2d12;margin-top:2px">' + esc(r.coverage === "partial" ? t("assessment.action_required_partial") : t("assessment.action_required_not_covered")) + '</div>'
                        + '</div>'
                        + '</div>';
                }
            }
        }
    }
    // Validation block
    var check = document.getElementById("vp-validation-check");
    var labelEl = document.getElementById("vp-validation-label");
    var helper = document.getElementById("vp-validation-helper");
    var blockV = document.getElementById("vp-validation-block");
    if (check && labelEl && helper && blockV) {
        if (completion === 100) {
            check.disabled = false;
            labelEl.style.cursor = "pointer";
            helper.style.display = "none";
            blockV.style.borderColor = "var(--ct-accent)";
            blockV.style.opacity = "1";
        }
        else {
            check.disabled = true;
            if (check.checked) {
                check.checked = false;
                Q.self_validation = false;
                Q.self_validated_at = null;
                _saveToLocalStorage();
            }
            labelEl.style.cursor = "not-allowed";
            helper.style.display = "block";
            blockV.style.borderColor = "var(--ct-line-strong)";
            blockV.style.opacity = "0.75";
        }
    }
    // Export block: appears once complete + self-validated. (Ticking the
    // self-validation box re-renders fully, so this only needs to react to
    // completion changes from answering questions.)
    var exportBlk = document.getElementById("vp-export-actions");
    if (exportBlk)
        exportBlk.innerHTML = _renderExportActionsInner(stats, completion);
}
// Kind-specific i18n shim: Q.template.kind may be "audit" or "questionnaire".
function _vpTk(baseKey) {
    var kind = (Q && Q.template && Q.template.kind) || "questionnaire";
    var specific = baseKey + "_" + kind;
    var v = t(specific);
    if (v && v !== specific)
        return v;
    return t(baseKey);
}
// ═══════════════════════════════════════════════════════════════
// BACK / NEW / EXPORT
// ═══════════════════════════════════════════════════════════════
function _portalBackHome() {
    if (!confirm(t("portal.confirm_new")))
        return;
    Q = null;
    _sessionPassword = null;
    try {
        localStorage.removeItem(LS_KEY);
    }
    catch (e) { }
    _render();
}
window._portalBackHome = _portalBackHome;
// Export flow — dispatches to either a confirmation modal (session
// password available) or a full password prompt modal (no session
// password). Both modals offer:
//   - export encrypted with the session/entered password (primary)
//   - export in plain (for local archiving)
//   - use a different password (opens a sub-prompt)
//   - cancel
function _portalExportJSON() {
    if (_sessionPassword)
        _showExportConfirmModal();
    else
        _showExportPromptModal();
}
window._portalExportJSON = _portalExportJSON;
function _showExportConfirmModal() {
    var existing = document.getElementById("portal-pwd-overlay");
    if (existing)
        existing.remove();
    var overlay = document.createElement("div");
    overlay.id = "portal-pwd-overlay";
    overlay.className = "help-overlay open";
    var panel = document.createElement("div");
    panel.className = "help-panel";
    panel.style.maxWidth = "460px";
    panel.style.padding = "24px 28px";
    panel.innerHTML =
        '<h1 style="font-size:1.1em;margin:0 0 10px;border:none;padding:0">' + esc(t("portal.export_modal_title")) + '</h1>' +
            '<p style="font-size:0.85em;color:var(--ct-ink-1);margin:0 0 14px">' + esc(t("portal.export_session_hint")) + '</p>' +
            '<div style="display:flex;flex-direction:column;gap:8px">' +
            '<button class="ct-btn" id="portal-exp-session" data-variant="primary" style="width:100%">' + esc(t("portal.export_encrypted_session")) + '</button>' +
            '<button class="ct-btn" id="portal-exp-plain" style="width:100%">' + esc(t("portal.export_plain")) + '</button>' +
            '<button class="ct-btn" id="portal-exp-other" data-variant="neutral" style="width:100%">' + esc(t("portal.export_other_password")) + '</button>' +
            '</div>' +
            '<div style="margin-top:14px;text-align:right">' +
            '<button class="ct-btn" id="portal-exp-cancel" data-variant="ghost">' + esc(t("common.cancel")) + '</button>' +
            '</div>';
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    function close() { overlay.remove(); }
    document.getElementById("portal-exp-session").addEventListener("click", function () {
        close();
        _doExportWithPassword(_sessionPassword);
    });
    document.getElementById("portal-exp-plain").addEventListener("click", function () {
        close();
        _doExportWithPassword(null);
    });
    document.getElementById("portal-exp-other").addEventListener("click", function () {
        close();
        _portalPromptPassword("portal.password_prompt_export_custom").then(function (pwd) {
            if (pwd === null)
                return;
            _doExportWithPassword(pwd || null);
        });
    });
    document.getElementById("portal-exp-cancel").addEventListener("click", close);
}
function _showExportPromptModal() {
    // Same as _portalPromptPassword but with an extra "plain" button.
    var existing = document.getElementById("portal-pwd-overlay");
    if (existing)
        existing.remove();
    var overlay = document.createElement("div");
    overlay.id = "portal-pwd-overlay";
    overlay.className = "help-overlay open";
    var panel = document.createElement("div");
    panel.className = "help-panel";
    panel.style.maxWidth = "460px";
    panel.style.padding = "24px 28px";
    panel.innerHTML =
        '<h1 style="font-size:1.1em;margin:0 0 10px;border:none;padding:0">' + esc(t("portal.export_modal_title")) + '</h1>' +
            '<p style="font-size:0.85em;color:var(--ct-ink-1);margin:0 0 12px">' + esc(t("portal.export_prompt_hint")) + '</p>' +
            '<input type="password" id="portal-exp-input" style="width:100%;padding:8px 10px;border:1px solid var(--ct-line-strong);border-radius:4px;font-size:0.95em;font-family:inherit" autocomplete="off" autocapitalize="off" spellcheck="false">' +
            '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
            '<button class="ct-btn" id="portal-exp-encrypted" data-variant="primary" style="flex:1">' + esc(t("portal.export_encrypted")) + '</button>' +
            '<button class="ct-btn" id="portal-exp-plain2">' + esc(t("portal.export_plain")) + '</button>' +
            '</div>' +
            '<div style="margin-top:10px;text-align:right">' +
            '<button class="ct-btn" id="portal-exp-cancel2" data-variant="ghost">' + esc(t("common.cancel")) + '</button>' +
            '</div>';
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    var input = document.getElementById("portal-exp-input");
    function close() {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
    }
    function submitEncrypted() {
        var pwd = input.value;
        if (!pwd) {
            input.style.borderColor = "var(--ct-critical)";
            input.focus();
            return;
        }
        close();
        _doExportWithPassword(pwd);
    }
    function submitPlain() {
        close();
        _doExportWithPassword(null);
    }
    function onKey(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            submitEncrypted();
        }
        else if (e.key === "Escape") {
            e.preventDefault();
            close();
        }
    }
    document.getElementById("portal-exp-encrypted").addEventListener("click", submitEncrypted);
    document.getElementById("portal-exp-plain2").addEventListener("click", submitPlain);
    document.getElementById("portal-exp-cancel2").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    setTimeout(function () { input.focus(); }, 50);
}
// Actually build the payload and write the blob.
function _doExportWithPassword(pwd) {
    var payload = _buildExportPayload();
    var json = JSON.stringify(payload, null, 2);
    var baseName = (payload.assessment_id + "_response").replace(/[^a-z0-9_.-]/gi, "");
    if (pwd) {
        _encryptData(json, pwd).then(function (buf) {
            var blob = new Blob([buf], { type: "application/octet-stream" });
            _triggerDownload(blob, baseName + ".ctenc");
            showStatus(t("portal.export_done"));
        }).catch(function (e) { alert("Encryption failed: " + e.message); });
    }
    else {
        var blob = new Blob([json], { type: "application/json" });
        _triggerDownload(blob, baseName + ".json");
        showStatus(t("portal.export_done"));
    }
}
function _buildExportPayload() {
    return {
        format: "ciso_toolbox_vendor_assessment",
        version: 1,
        assessment_id: Q.assessment_id,
        vendor_id: Q.vendor_id,
        vendor_name: Q.vendor_name,
        date: Q.date,
        due_date: Q.due_date || "",
        template: Q.template,
        responses: Q.responses || [],
        self_validation: !!Q.self_validation,
        self_validated_at: Q.self_validated_at || null,
        exported_at: new Date().toISOString()
    };
}
function _triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
function _portalExportExcel() {
    _loadExcelJS().then(function () {
        var wb = new ExcelJS.Workbook();
        var tpl = Q.template;
        // Sheet 1: Instructions
        var ws1 = wb.addWorksheet(t("assessment.instructions_sheet"));
        ws1.columns = [{ width: 100 }];
        [
            t("assessment.instructions_line1"),
            "",
            t("assessment.instructions_line2"),
            t("assessment.instructions_line3"),
            t("assessment.instructions_line4"),
            t("assessment.instructions_line5"),
            "",
            t("assessment.instructions_line6"),
            "",
            t("assessment.instructions_coverage_covered"),
            t("assessment.instructions_coverage_partial"),
            t("assessment.instructions_coverage_not_covered"),
            t("assessment.instructions_coverage_not_applicable"),
            "",
            t("assessment.instructions_id") + ": " + (Q.assessment_id || ""),
            t("assessment.instructions_vendor") + ": " + (Q.vendor_name || ""),
            t("assessment.instructions_template") + ": " + (tpl.name || ""),
            t("assessment.instructions_due_date") + ": " + (Q.due_date || "-")
        ].forEach(function (line) { ws1.addRow([line]); });
        ws1.getRow(1).font = { bold: true, size: 14 };
        // Sheet 2: Questionnaire
        var ws2 = wb.addWorksheet(t("assessment.questionnaire_sheet"));
        ws2.columns = [
            { header: "ID", key: "id", width: 10 },
            { header: t("assessment.col_section"), key: "section", width: 22 },
            { header: t("assessment.col_question"), key: "question", width: 50 },
            { header: t("assessment.col_type"), key: "type", width: 14 },
            { header: t("assessment.col_options"), key: "options", width: 30 },
            { header: t("assessment.col_expected"), key: "expected", width: 40 },
            { header: t("assessment.col_answer"), key: "answer", width: 30 },
            { header: t("assessment.col_coverage"), key: "coverage", width: 14 },
            { header: t("assessment.col_comment"), key: "comment", width: 30 },
            { header: t("assessment.col_ap_title"), key: "ap_title", width: 30 },
            { header: t("assessment.col_ap_desc"), key: "ap_desc", width: 30 },
            { header: t("assessment.col_ap_date"), key: "ap_date", width: 14 },
            { header: t("assessment.col_ap_owner"), key: "ap_owner", width: 20 },
            { header: t("assessment.col_justification"), key: "justification", width: 30 }
        ];
        ws2.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
        ws2.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        var COL_TYPE = 4, COL_ANSWER = 7, COL_COVERAGE = 8;
        var COVERAGE_OPTIONS = ["covered", "partial", "not_covered", "not_applicable"];
        function _setListValidation(cell, values) {
            cell.dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ['"' + values.join(",") + '"'],
                showErrorMessage: true,
                errorStyle: "warning"
            };
        }
        (tpl.sections || []).forEach(function (section) {
            (section.questions || []).forEach(function (q) {
                var r = _findResp(q.id) || {};
                var firstAp = (r.action_plans && r.action_plans[0]) || {};
                var answerStr = "";
                if (Array.isArray(r.answer))
                    answerStr = r.answer.join("; ");
                else if (r.answer && typeof r.answer === "object" && r.answer.name)
                    answerStr = r.answer.name;
                else if (r.answer != null)
                    answerStr = String(r.answer);
                var row = ws2.addRow({
                    id: q.id,
                    section: section.title,
                    question: q.text,
                    type: q.type,
                    options: (q.options || []).join(" | "),
                    expected: q.expected || "",
                    answer: answerStr,
                    coverage: r.coverage || "",
                    comment: r.comment || "",
                    ap_title: firstAp.title || "",
                    ap_desc: firstAp.description || "",
                    ap_date: firstAp.target_date || "",
                    ap_owner: firstAp.owner || "",
                    justification: r.justification || ""
                });
                _setListValidation(row.getCell(COL_COVERAGE), COVERAGE_OPTIONS);
                row.getCell(COL_TYPE).protection = { locked: true };
                row.getCell(COL_TYPE).font = { color: { argb: "FF64748B" } };
                var aCell = row.getCell(COL_ANSWER);
                if (q.type === "yes_no")
                    _setListValidation(aCell, ["yes", "no"]);
                else if (q.type === "scale_1_5")
                    _setListValidation(aCell, ["1", "2", "3", "4", "5"]);
                else if (q.type === "single_choice" && q.options && q.options.length) {
                    var joined = q.options.join(",");
                    if (joined.length <= 250 && q.options.every(function (o) { return o.indexOf(",") < 0; })) {
                        _setListValidation(aCell, q.options);
                    }
                }
                row.getCell(12).numFmt = "yyyy-mm-dd";
            });
        });
        wb.xlsx.writeBuffer().then(function (buf) {
            var blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            var baseName = (Q.assessment_id + "_response").replace(/[^a-z0-9_.-]/gi, "");
            _triggerDownload(blob, baseName + ".xlsx");
            showStatus(t("portal.export_done"));
        });
    }).catch(function (e) { alert("Excel export failed: " + e.message); });
}
window._portalExportExcel = _portalExportExcel;
// ═══════════════════════════════════════════════════════════════
// LOCAL STORAGE (auto-save)
// ═══════════════════════════════════════════════════════════════
function _saveToLocalStorage() {
    if (_autosaveTimer)
        clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(function () {
        try {
            if (Q)
                localStorage.setItem(LS_KEY, JSON.stringify(Q));
            else
                localStorage.removeItem(LS_KEY);
        }
        catch (e) {
            console.warn("portal: localStorage save failed", e);
        }
    }, 200);
}
function _loadFromLocalStorage() {
    try {
        var raw = localStorage.getItem(LS_KEY);
        if (!raw)
            return;
        Q = JSON.parse(raw);
        _ensureResponsesForTemplate(Q);
        _applyInitialLocaleFromQuestionnaire();
    }
    catch (e) {
        Q = null;
    }
}
// ═══════════════════════════════════════════════════════════════
// HELP OVERLAY
// ═══════════════════════════════════════════════════════════════
function _portalShowHelp() {
    var hc = document.getElementById("help-content");
    if (!hc)
        return;
    var h = '<h1>' + esc(t("portal.help_title")) + '</h1>';
    h += '<h2>' + esc(t("portal.help_principle_h")) + '</h2>';
    h += '<p>' + esc(t("portal.help_principle_p1")) + '</p>';
    h += '<p>' + esc(t("portal.help_principle_p2")) + '</p>';
    h += '<p>' + esc(t("portal.help_principle_p3")) + '</p>';
    h += '<h2>' + esc(t("portal.help_steps_h")) + '</h2>';
    h += '<h3>' + esc(t("portal.help_step1_h")) + '</h3>';
    h += '<p>' + esc(t("portal.help_step1_p")) + '</p>';
    h += '<h3>' + esc(t("portal.help_step2_h")) + '</h3>';
    h += '<p>' + esc(t("portal.help_step2_p")) + '</p>';
    h += '<h3>' + esc(t("portal.help_step3_h")) + '</h3>';
    h += '<p>' + esc(t("portal.help_step3_p")) + '</p>';
    h += '<ul>';
    h += '<li>' + esc(t("portal.help_step3_ul1")) + '</li>';
    h += '<li>' + t("portal.help_step3_ul2") + '</li>'; // contains inline <code>
    h += '<li>' + esc(t("portal.help_step3_ul3")) + '</li>';
    h += '</ul>';
    h += '<p>' + t("portal.help_step3_p2") + '</p>'; // contains inline <strong>
    h += '<h3>' + esc(t("portal.help_step4_h")) + '</h3>';
    h += '<p>' + esc(t("portal.help_step4_p")) + '</p>';
    h += '<h3>' + esc(t("portal.help_step5_h")) + '</h3>';
    h += '<p>' + esc(t("portal.help_step5_p")) + '</p>';
    h += '<h2>' + esc(t("portal.help_save_h")) + '</h2>';
    h += '<p>' + esc(t("portal.help_save_p")) + '</p>';
    h += '<h2>' + esc(t("portal.help_security_h")) + '</h2>';
    h += '<ul>';
    h += '<li>' + esc(t("portal.help_security_ul1")) + '</li>';
    h += '<li>' + esc(t("portal.help_security_ul2")) + '</li>';
    h += '<li>' + esc(t("portal.help_security_ul3")) + '</li>';
    h += '<li>' + esc(t("portal.help_security_ul4")) + '</li>';
    h += '</ul>';
    h += '<h2>' + esc(t("portal.help_contact_h")) + '</h2>';
    h += '<p>' + esc(t("portal.help_contact_p")) + '</p>';
    hc.innerHTML = h;
    document.getElementById("help-overlay").classList.add("open");
}
window._portalShowHelp = _portalShowHelp;
function _portalCloseHelp() {
    var ov = document.getElementById("help-overlay");
    if (ov)
        ov.classList.remove("open");
}
window._portalCloseHelp = _portalCloseHelp;
// ═══════════════════════════════════════════════════════════════
// LANGUAGE TOGGLE
// ═══════════════════════════════════════════════════════════════
function _portalToggleLang() {
    var next = (typeof _locale === "string" && _locale === "fr") ? "en" : "fr";
    if (typeof switchLang === "function")
        switchLang(next);
    _updateLangButton();
    _render();
}
window._portalToggleLang = _portalToggleLang;
function _updateLangButton() {
    var btn = document.getElementById("portal-lang-btn");
    if (!btn)
        return;
    btn.textContent = (typeof _locale === "string" && _locale === "fr") ? "EN" : "FR";
}
