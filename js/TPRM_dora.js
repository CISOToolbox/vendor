/* DORA Register of Information panel.
 *
 * Loads the full RoI tree from the backend (GET /api/projects/{id}/dora),
 * organised in four top-level sections that mirror the EBA RoI workbook
 * (B_01..B_04) plus an export action. All edits go through the granular
 * persistence adapter (_persist / _persistCreate / _persistDelete) —
 * never the blob PUT autosave.
 *
 * EBA RoI ITS (Reg. (EU) 2024/2956) — UI section keys vs export sheets:
 *   UI key b01 (B_01 — RoI scope)
 *     B_01.02 → entities (RFE) + consolidation rows (same sheet)
 *     B_01.03 → branches
 *   UI key b02 (B_02 — Contractual arrangements)
 *     B_02.01/02 → arrangements (general + specific info)
 *     B_02.03    → intra-group arrangements (derived at export)
 *   UI key b03 — labelled "B_06 — Functions" in the UI; the internal
 *               key stays "b03" for backwards compatibility but the
 *               functions list maps to B_06.01 in the export.
 *   UI key b04 — labelled "B_05 — Supply chains"; signer rows (B_03.01/
 *               B_03.02), FE-user rows (B_04.01) and TPSP catalog
 *               (B_05.01) are derived at export time. Editable here:
 *               signers (sub-tab) and subcontractors → B_05.02.
 *
 *   Derived at export time and never directly edited by the user:
 *     B_01.01 (RoI metadata), B_03.02 (TPSP signers), B_03.03 (intra-
 *     group ICT), B_04.01 (FE users), B_05.01 (TPSP catalog), B_07.01
 *     (services assessment).
 *
 *   Vendors RoI fields (legal name latin, LEI, country, person type,
 *   entity nature, additional id, ultimate parent) → vendor edit form
 *   under the Vendors panel (PATCH /vendors/{id}/roi).
 */
(function() {
"use strict";

var _doraTree = null;
var _doraCodelists = null;
var _doraExportCurrency = "EUR";

function _doraT(key, fallback) {
    var v = (typeof t === "function") ? t(key) : null;
    if (v && v !== key) return v;
    return fallback || key;
}

function _newId(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Sequential reference generator (ARR-0001, ARR-0002, ...).
// Scans existing arrangement_references for the same prefix and picks
// max+1, zero-padded to 4 digits. Falls back to ARR-0001 when empty.
function _doraNextRef(prefix) {
    var arrangements = (_doraTree && _doraTree.arrangements) || [];
    var re = new RegExp("^" + prefix + "-(\\d+)$");
    var maxN = 0;
    for (var i = 0; i < arrangements.length; i++) {
        var ref = String(arrangements[i].arrangement_reference || "");
        var m = ref.match(re);
        if (m) {
            var n = parseInt(m[1], 10);
            if (n > maxN) maxN = n;
        }
    }
    var next = maxN + 1;
    return prefix + "-" + ("0000" + next).slice(-4);
}

function _esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _loadTree(host) {
    // Opensource: D.dora is the in-memory tree (single-doc browser app).
    // The codelists were loaded synchronously by index.html as window._doraCodelists.
    if (typeof D === "undefined" || !D || !D.dora) {
        host.innerHTML = '<h2>' + _esc(_doraT("nav.dora", "DORA Register")) + '</h2>'
            + '<p>' + _esc(_doraT("dora.no_project", "Open or create a project first.")) + '</p>';
        return;
    }
    _doraTree = D.dora;
    _doraCodelists = window._doraCodelists || _doraCodelists;
    _publishCache();
    _render(host);
}

// ── Cache exposed to other modules (TPRM_app.js) ──────────────────
// Once the DORA tree is loaded (either by visiting the panel or by
// calling DoraData.ensureLoaded()), other modules can read the
// cached arrangements / sub-contractors / signers.

function _publishCache() {
    window._doraTreeCache = _doraTree;
}

window.DoraData = {
    // Returns the cached tree, or null if not loaded yet.
    getTree: function() { return _doraTree; },

    // Force-load (or refresh) the tree. Opensource: synchronous, reads D.dora.
    ensureLoaded: function(cb) {
        if (_doraTree) { if (cb) cb(_doraTree); return; }
        if (typeof D === "undefined" || !D || !D.dora) { if (cb) cb(null); return; }
        _doraTree = D.dora;
        _doraCodelists = window._doraCodelists || _doraCodelists;
        _publishCache();
        if (cb) cb(_doraTree);
    },

    // Invalidate the cache (called after vendor.dora_* mutations from elsewhere).
    invalidate: function() {
        _doraTree = null;
        window._doraTreeCache = null;
    },

    // List of arrangements where the given vendor is the TPSP.
    arrangementsForVendor: function(vid) {
        if (!_doraTree) return [];
        return (_doraTree.arrangements || []).filter(function(a) { return a.vendor_id === vid; });
    },

    // Sub-contractors declared under any arrangement of the given vendor.
    // Returns enriched rows that join sub identity (name, lei, country)
    // with the per-link junction (arrangement_id, tier, service_provided, …).
    subcontractorsForVendor: function(vid) {
        if (!_doraTree) return [];
        var arrIds = this.arrangementsForVendor(vid).map(function(a) { return a.id; });
        var links = (_doraTree.subcontractor_links || []).filter(function(l) { return arrIds.indexOf(l.arrangement_id) >= 0; });
        var subById = {};
        (_doraTree.subcontractors || []).forEach(function(s) { subById[s.id] = s; });
        return links.map(function(l) {
            var ident = subById[l.subcontractor_id] || { id: l.subcontractor_id, name: "" };
            return {
                arrangement_id: l.arrangement_id,
                subcontractor_id: l.subcontractor_id,
                id: l.subcontractor_id, // legacy alias for callers using s.id
                tier: l.tier,
                service_provided: l.service_provided,
                is_critical_function_support: l.is_critical_function_support,
                parent_subcontractor_id: l.parent_subcontractor_id,
                sort_order: l.sort_order,
                name: ident.name,
                lei: ident.lei,
                country_iso2: ident.country_iso2,
            };
        });
    },

    // All arrangement links of one global subcontractor (project-wide).
    arrangementsForSubcontractor: function(subId) {
        if (!_doraTree) return [];
        return (_doraTree.subcontractor_links || []).filter(function(l) { return l.subcontractor_id === subId; });
    },

    // Vendors that share at least one arrangement with the given sub.
    vendorsForSubcontractor: function(subId) {
        if (!_doraTree) return [];
        var arrIds = this.arrangementsForSubcontractor(subId).map(function(l) { return l.arrangement_id; });
        var arrById = {};
        (_doraTree.arrangements || []).forEach(function(a) { arrById[a.id] = a; });
        var seen = {};
        var out = [];
        arrIds.forEach(function(aid) {
            var a = arrById[aid]; if (!a) return;
            if (!seen[a.vendor_id]) { seen[a.vendor_id] = true; out.push(a.vendor_id); }
        });
        return out;
    },

    // Signers declared under any arrangement of the given vendor.
    signersForVendor: function(vid) {
        if (!_doraTree) return [];
        var arrIds = this.arrangementsForVendor(vid).map(function(a) { return a.id; });
        return (_doraTree.signers || []).filter(function(s) { return arrIds.indexOf(s.arrangement_id) >= 0; });
    },

    // RoI completeness check for a vendor record. Returns
    // { complete: bool, missing: [field…] }.
    roiStatus: function(v) {
        if (!v) return { complete: false, missing: ["vendor"] };
        var required = ["lei", "country_iso2", "person_type"];
        var miss = [];
        required.forEach(function(f) {
            if (!v[f] || String(v[f]).trim() === "") miss.push(f);
        });
        return { complete: miss.length === 0, missing: miss };
    },

    // Codelists (currency/country/etc.) — null if not loaded yet.
    codelists: function() { return _doraCodelists; },

    // Render the rich DORA card for a single vendor (used in the vendor
    // edit modal's DORA tab). opts.embedded === true → no border/header.
    renderVendorCard: function(v, opts) { return _renderVendorCard(v, opts); },

    // Render the global subcontractors table (project-wide identities +
    // their linked arrangements). Used in the Vendors page "Sous-traitants"
    // tab so the user manages global subs alongside vendors.
    renderSubcontractors: function() { return _renderSubcontractors(); },

    // Return a <datalist id="nace-list"> populated with the 88 NACE Rev. 2
    // divisions. Embed once per form; bind inputs via list="nace-list".
    naceDatalist: function() { return _naceDatalist(); }
};

function _codelistOptions(key, current) {
    var items = (_doraCodelists && _doraCodelists[key]) || [];
    var h = '<option value=""></option>';
    items.forEach(function(it) {
        var code = it.code !== undefined ? it.code : it;
        var label = it.label !== undefined ? it.label : it;
        var display = _doraCodeI18n(key, String(code), String(label));
        var sel = (current === code) ? " selected" : "";
        h += '<option value="' + _esc(code) + '"' + sel + '>' + _esc(display) + '</option>';
    });
    return h;
}

// ISO-3166-1 alpha-2 country picker — same UI as Vendor RoI tab. Uses
// the dora codelist `country_iso3166_1` so the option label combines
// the ISO code and the country name (search-by-code or search-by-name).
function _countryOptions(current) {
    var items = (_doraCodelists && _doraCodelists.country_iso3166_1) || [];
    var cur = (current || "").toUpperCase();
    var h = '<option value=""></option>';
    items.forEach(function(it) {
        var code = it.code !== undefined ? it.code : it;
        var label = it.label !== undefined ? it.label : it;
        var sel = (String(code).toUpperCase() === cur) ? " selected" : "";
        h += '<option value="' + _esc(code) + '"' + sel + '>' + _esc(code) + ' — ' + _esc(label) + '</option>';
    });
    return h;
}

// NACE Rev. 2 datalist — 88 divisions from EU Reg. CE 1893/2006. The
// <input list="nace-list"> binding gives autocomplete + free text, so
// existing free-form sector values keep working.
function _naceDatalist() {
    var items = (_doraCodelists && _doraCodelists.nace_rev2) || [];
    var h = '<datalist id="nace-list">';
    items.forEach(function(it) {
        h += '<option value="' + _esc(it.label) + '"></option>';
    });
    h += '</datalist>';
    return h;
}

// ── Entity-level overview (B_01 / B_03) ──────────────────
// Replaces the section-tabs UI for the data that is general to the
// reporting financial entity itself (declarant entities, branches,
// supported functions, consolidation perimeter). B_02 (arrangements)
// and B_04 (subcontractors) are entered through the vendor and
// subcontractor screens — they only appear in the raw-tables block
// at the bottom of the page.
function _renderEntityOverview() {
    var rfes = _doraTree.entities || [];
    var branches = _doraTree.branches || [];
    var fns = _doraTree.functions || [];
    var conso = _doraTree.consolidation || [];
    var arrs = _doraTree.arrangements || [];

    // How many arrangements reference each function — used to show
    // a usage hint on each function card.
    var fnUsage = {};
    arrs.forEach(function(a) {
        (a.function_ids || []).forEach(function(fid) {
            if (fid) fnUsage[fid] = (fnUsage[fid] || 0) + 1;
        });
    });

    // Layout helpers — kept consistent with the form-row pattern used
    // in the Vendor RoI tab and the existing modals (cisotoolbox.css /
    // tprm.css already style .form-row, label, input, select).
    function _section(legendHtml, bodyHtml) {
        return '<fieldset class="dora-overview-section">'
             + '<legend>' + legendHtml + '</legend>'
             + bodyHtml + '</fieldset>';
    }
    // Section help — a "?" button sits next to each section title and
    // toggles a hidden blue help paragraph. Hints are off by default to
    // keep the form lean.
    function _hint(key, s) {
        return '<p class="panel-desc dora-hint" id="dora-hint-' + key + '" style="display:none;margin:0 0 10px">' + _esc(s) + '</p>';
    }
    function _helpBtn(key) {
        return '<button type="button" class="dora-help-btn" data-click="doraToggleHint" data-args=\'["' + key + '"]\' title="' + _esc(_doraT("dora.help.toggle", "Afficher / masquer l'aide")) + '" aria-label="' + _esc(_doraT("dora.help.toggle", "Afficher / masquer l'aide")) + '">?</button>';
    }
    function _emptyBlock(s) {
        return '<div class="dora-empty-block">' + _esc(s) + '</div>';
    }
    function _fld(label, controlHtml) {
        return '<div class="form-row"><label>' + _esc(label) + '</label>' + controlHtml + '</div>';
    }
    function _cardOpen(titleEscapedHtml, deleteClick, deleteArgs) {
        var h = '<article class="dora-overview-card">';
        h += '<header class="dora-overview-card-h">';
        h += '<div class="dora-overview-card-title">' + titleEscapedHtml + '</div>';
        if (deleteClick) {
            h += '<button class="btn-danger" data-click="' + deleteClick + '" data-args=\'' + deleteArgs + '\' title="' + _esc(_doraT("btn_delete", "Delete")) + '">×</button>';
        }
        h += '</header>';
        return h;
    }
    function _grid(inner) {
        return '<div class="dora-overview-grid">' + inner + '</div></article>';
    }

    var h = '';
    h += '<p class="panel-desc dora-hint" id="dora-hint-intro" style="display:none">' + _esc(_doraT("dora.overview.intro", "Saisie centralisée des informations générales de votre entité financière : entités déclarantes, succursales, périmètre de consolidation et fonctions opérationnelles. Les accords contractuels et sous-traitants se gèrent dans les fiches PSTI et sous-traitants.")) + '</p>';

    // ── B_01 — Identité de l'entité financière déclarante ──
    var b01Body = '';
    // RFE block
    b01Body += '<div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 6px">'
            +   '<h4 style="margin:0;font-size:0.95em;display:flex;align-items:center;gap:6px">' + _esc(_doraT("dora.overview.subtitle_rfe", "Entités déclarantes")) + ' <span style="color:var(--text-muted);font-weight:400">(' + rfes.length + ')</span>' + _helpBtn("rfe") + '</h4>'
            +   '<button class="btn-add" data-click="doraAddEntity" style="margin:0">+ ' + _esc(_doraT("dora.overview.add_rfe", "Ajouter une entité")) + '</button>'
            + '</div>'
            + _hint("rfe", _doraT("dora.overview.hint_rfe", "Entités juridiques de votre groupe soumises à DORA (au moins une). La période de reporting est demandée au moment de l'export."));
    if (rfes.length === 0) {
        b01Body += _emptyBlock(_doraT("dora.overview.no_rfe", "Aucune entité déclarante. Ajoutez les entités juridiques soumises à DORA."));
    } else {
        rfes.forEach(function(r) {
            var titleH = _esc(r.name || r.id) + ' <code class="dora-overview-id">' + _esc(r.id) + '</code>';
            b01Body += _cardOpen(titleH, "doraDelEntity", '["' + _esc(r.id) + '"]');
            // R11: parent_lei only meaningful when hierarchy === "subsidiary"
            // (a "parent" / "sole_entity" RFE has no parent LEI to declare).
            // For "branch" we also expose it because branches inherit a
            // parent. Otherwise the field is hidden to keep the form lean.
            var needsParent = (r.hierarchy === "subsidiary" || r.hierarchy === "branch");
            var parentField = needsParent
                ? _fld(_doraT("dora.overview.f.parent_lei", "LEI de la maison-mère (B_01.02.0060)"),
                    '<div style="display:flex;gap:2px;align-items:center"><input id="rfe-plei-' + _esc(r.id) + '" value="' + _esc(r.parent_lei || "") + '" maxlength="20" data-input="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","parent_lei"]\' data-pass-value style="flex:1;font-family:monospace;text-transform:uppercase">' + _gleifTriggerHtml("rfe-plei-" + r.id) + '</div>')
                : '';
            // B_01.02.0100 / 0110 — currency + total assets. EBA RoI requires
            // both at the RFE level for the consolidated balance-sheet view.
            var _curCodes = (_doraCodelists && _doraCodelists.currency_iso4217) || ["EUR"];
            var _curSelRfe = r.total_assets_currency || "EUR";
            var _curOpts = _curCodes.map(function(c) {
                var code = c && c.code !== undefined ? c.code : c;
                return '<option value="' + _esc(code) + '"' + (_curSelRfe === code ? " selected" : "") + '>' + _esc(code) + '</option>';
            }).join("");
            b01Body += _grid(''
                + _fld(_doraT("dora.overview.f.legal_name", "Nom légal (B_01.02.0020)"), '<input value="' + _esc(r.name || "") + '" data-input="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","name"]\' data-pass-value>')
                + _fld(_doraT("dora.overview.f.lei", "LEI (B_01.02.0010)"), '<div style="display:flex;gap:2px;align-items:center"><input id="rfe-lei-' + _esc(r.id) + '" value="' + _esc(r.lei || "") + '" maxlength="20" data-input="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","lei"]\' data-pass-value style="flex:1;font-family:monospace;text-transform:uppercase">' + _gleifTriggerHtml("rfe-lei-" + r.id) + '</div>')
                + _fld(_doraT("dora.overview.f.country_rfe", "Pays (B_01.02.0030)"), '<select data-change="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","country_iso2"]\' data-pass-value>' + _countryOptions(r.country_iso2) + '</select>')
                + _fld(_doraT("dora.overview.f.entity_type", "Type d'entité (B_01.02.0040)"), '<select data-change="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","entity_type"]\' data-pass-value>' + _codelistOptions("entity_type", r.entity_type) + '</select>')
                + _fld(_doraT("dora.overview.f.competent_authority", "Autorité compétente (B_01.01.0050)"), '<input value="' + _esc(r.competent_authority || "") + '" data-input="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","competent_authority"]\' data-pass-value placeholder="' + _esc(_doraT("dora.overview.ph.competent_authority", "ex. ACPR, AMF, BaFin, ECB, FCA…")) + '">')
                + _fld(_doraT("dora.overview.f.hierarchy", "Hiérarchie (B_01.02.0050)"), '<select data-change="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","hierarchy"]\' data-pass-value>' + _codelistOptions("hierarchy", r.hierarchy) + '</select>')
                + parentField
                + _fld(_doraT("dora.overview.f.total_assets_currency", "Devise (B_01.02.0100)"), '<select data-change="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","total_assets_currency"]\' data-pass-value>' + _curOpts + '</select>')
                + _fld(_doraT("dora.overview.f.total_assets", "Total bilan (B_01.02.0110)"), '<input type="number" step="0.01" value="' + _esc(r.total_assets != null ? r.total_assets : "") + '" data-input="doraPatchEntityNum" data-args=\'["' + _esc(r.id) + '","total_assets"]\' data-pass-value placeholder="' + _esc(_doraT("dora.overview.ph.total_assets", "Montant en devise comptable")) + '">')
            );
        });
    }
    // Branches block — build the RFE-select options once per row so the
    // current value is marked selected via a simple per-iteration build.
    function _rfeOptsForBranch(currentRfeId) {
        var out = '<option value=""></option>';
        rfes.forEach(function(e) {
            var sel = (e.id === currentRfeId) ? " selected" : "";
            out += '<option value="' + _esc(e.id) + '"' + sel + '>' + _esc((e.name || e.id) + (e.country_iso2 ? " — " + e.country_iso2 : "")) + '</option>';
        });
        return out;
    }
    var rfeNameById = {}; rfes.forEach(function(e) { rfeNameById[e.id] = e.name || e.id; });
    b01Body += '<div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 6px">'
            +   '<h4 style="margin:0;font-size:0.95em;display:flex;align-items:center;gap:6px">' + _esc(_doraT("dora.overview.subtitle_branches", "Succursales")) + ' <span style="color:var(--text-muted);font-weight:400">(' + branches.length + ')</span>' + _helpBtn("branches") + '</h4>'
            +   '<button class="btn-add" data-click="doraAddBranch" style="margin:0"' + (rfes.length === 0 ? " disabled" : "") + '>+ ' + _esc(_doraT("dora.overview.add_branch", "Ajouter une succursale")) + '</button>'
            + '</div>'
            + _hint("branches", _doraT("dora.overview.hint_branches", "Succursales (filiales sans personnalité juridique propre) rattachées à une entité déclarante. À déclarer uniquement si elles consomment des services PSTI distincts."));
    if (rfes.length === 0) {
        b01Body += _emptyBlock(_doraT("dora.need_rfe", "Ajoutez d'abord une entité déclarante."));
    } else if (branches.length === 0) {
        b01Body += _emptyBlock(_doraT("dora.overview.no_branches", "Aucune succursale déclarée."));
    } else {
        branches.forEach(function(r) {
            var rfeName = rfeNameById[r.rfe_id] || r.rfe_id || "—";
            var titleH = _esc(r.name || r.id) + ' <span class="dora-overview-parent">↳ ' + _esc(rfeName) + '</span> <code class="dora-overview-id">' + _esc(r.id) + '</code>';
            b01Body += _cardOpen(titleH, "doraDelBranch", '["' + _esc(r.id) + '"]');
            b01Body += _grid(''
                + _fld(_doraT("dora.overview.f.branch_parent_rfe", "Entité déclarante de rattachement (B_01.03.0020)"), '<select data-change="doraPatchBranch" data-args=\'["' + _esc(r.id) + '","rfe_id"]\' data-pass-value>' + _rfeOptsForBranch(r.rfe_id) + '</select>')
                + _fld(_doraT("dora.overview.f.branch_name", "Nom de la succursale (B_01.03.0030)"), '<input value="' + _esc(r.name || "") + '" data-input="doraPatchBranch" data-args=\'["' + _esc(r.id) + '","name"]\' data-pass-value>')
                + _fld(_doraT("dora.overview.f.country_branch", "Pays (B_01.03.0040)"), '<select data-change="doraPatchBranch" data-args=\'["' + _esc(r.id) + '","country_iso2"]\' data-pass-value>' + _countryOptions(r.country_iso2) + '</select>')
                + _fld(_doraT("dora.overview.f.branch_code", "Code interne (B_01.03.0010)"), '<input value="' + _esc(r.branch_code || "") + '" data-input="doraPatchBranch" data-args=\'["' + _esc(r.id) + '","branch_code"]\' data-pass-value>')
            );
        });
    }
    h += _section(_esc(_doraT("dora.overview.title_b01", "Identité de l'entité financière déclarante")), b01Body);

    // ── B_03 — Fonctions opérationnelles ──
    var b03Body = '';
    b03Body += '<div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 6px">'
            +   '<span style="color:var(--text-muted)">' + fns.length + ' ' + _esc(fns.length > 1 ? _doraT("dora.overview.functions_pl", "fonctions") : _doraT("dora.overview.functions_sg", "fonction")) + '</span>'
            +   '<button class="btn-add" data-click="doraOpenFunctionModal" data-args=\'[null]\' style="margin:0">+ ' + _esc(_doraT("dora.overview.add_function", "Nouvelle fonction")) + '</button>'
            + '</div>'
            + _hint("functions", _doraT("dora.overview.hint_functions", "Fonctions opérationnelles (services ou processus métier) susceptibles d'être supportées par un PSTI. Les fonctions critiques ou importantes (★) déclenchent un reporting renforcé. Cliquez une carte pour éditer tous les champs ITS (RTO, RPO, ligne métier, code LoU…)."));
    if (fns.length === 0) {
        b03Body += _emptyBlock(_doraT("dora.overview.no_functions", "Aucune fonction déclarée. Ajoutez-en au moins une avant de la rattacher à un accord contractuel."));
    } else {
        b03Body += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px">';
        fns.forEach(function(f) {
            var usage = fnUsage[f.id] || 0;
            var critBadge = f.is_critical_or_important
                ? '<span style="background:var(--orange);color:#fff;font-size:0.74em;padding:1px 6px;border-radius:3px;margin-left:6px">★ ' + _esc(_doraT("dora.byvendor.critical", "critique")) + '</span>'
                : '';
            b03Body += '<div class="dora-card-hover" data-click="doraOpenFunctionModal" data-args=\'["' + _esc(f.id) + '"]\' style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;background:var(--bg,#fff);cursor:pointer;transition:background 0.15s,border-color 0.15s">';
            b03Body += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'
                    +   '<strong>' + _esc(f.name || f.id) + '</strong>' + critBadge
                    +   '<span style="flex:1"></span>'
                    +   '<code style="font-size:0.74em;color:var(--text-muted)">' + _esc(f.id) + '</code>'
                    + '</div>';
            var meta = [];
            if (f.business_line) meta.push('<span>' + _esc(_doraT("dora.fn.business_line", "Ligne métier")) + ': ' + _esc(_doraCodeLabel("licenced_activity", f.business_line)) + '</span>');
            if (f.recovery_time_objective_h != null) meta.push('<span>RTO ' + _esc(f.recovery_time_objective_h) + 'h</span>');
            if (f.recovery_point_objective_h != null) meta.push('<span>RPO ' + _esc(f.recovery_point_objective_h) + 'h</span>');
            meta.push('<span style="color:var(--text-muted)">' + _esc(_doraT("dora.overview.fn_used_by", "Utilisée par")) + ' ' + usage + ' ' + _esc(usage > 1 ? _doraT("dora.overview.arrangements_pl", "accords") : _doraT("dora.overview.arrangements_sg", "accord")) + '</span>');
            b03Body += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:0.85em">' + meta.join("") + '</div>';
            b03Body += '</div>';
        });
        b03Body += '</div>';
    }
    h += _section(_esc(_doraT("dora.overview.title_b03", "Fonctions opérationnelles")) + ' ' + _helpBtn("functions"), b03Body);

    // ── B_01.02 — Périmètre de consolidation ──
    // Reported INSIDE the B_01.02 sheet at export time (relationship_to_rfe
    // column on each row), but kept as a distinct UI block here so the
    // user can edit consolidation entities separately from the RFEs.
    var b05Body = '';
    b05Body += '<div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 6px">'
            +   '<span style="color:var(--text-muted)">' + conso.length + ' ' + _esc(conso.length > 1 ? _doraT("dora.overview.entities_pl", "entités") : _doraT("dora.overview.entities_sg", "entité")) + '</span>'
            +   '<button class="btn-add" data-click="doraAddCs" style="margin:0">+ ' + _esc(_doraT("dora.overview.add_consolidation", "Ajouter une entité")) + '</button>'
            + '</div>'
            + _hint("consolidation", _doraT("dora.overview.hint_consolidation", "Entités juridiques composant le groupe consolidant des entités déclarantes (au sens IFRS 10 / CRR). Cette liste permet à l'autorité de recouper le RoI avec les comptes consolidés du groupe."));
    if (conso.length === 0) {
        b05Body += _emptyBlock(_doraT("dora.overview.no_consolidation", "Aucune entité du groupe consolidant déclarée."));
    } else {
        conso.forEach(function(r) {
            var titleH = _esc(r.entity_name || r.id) + ' <code class="dora-overview-id">' + _esc(r.id) + '</code>';
            b05Body += _cardOpen(titleH, "doraDelCs", '["' + _esc(r.id) + '"]');
            b05Body += _grid(''
                + _fld(_doraT("dora.overview.f.cs_name", "Nom de l'entité (B_01.02.0020)"), '<input value="' + _esc(r.entity_name || "") + '" data-input="doraPatchCs" data-args=\'["' + _esc(r.id) + '","entity_name"]\' data-pass-value>')
                + _fld(_doraT("dora.overview.f.lei", "LEI (B_01.02.0010)"), '<input value="' + _esc(r.entity_lei || "") + '" maxlength="20" data-input="doraPatchCs" data-args=\'["' + _esc(r.id) + '","entity_lei"]\' data-pass-value style="font-family:monospace;text-transform:uppercase">')
                + _fld(_doraT("dora.overview.f.country_cs", "Pays (B_01.02.0030)"), '<select data-change="doraPatchCs" data-args=\'["' + _esc(r.id) + '","country_iso2"]\' data-pass-value>' + _countryOptions(r.country_iso2) + '</select>')
            );
        });
    }
    h += _section(_esc(_doraT("dora.overview.title_b05", "Périmètre de consolidation")) + ' ' + _helpBtn("consolidation"), b05Body);

    return h;
}

function _render(host) {
    var helpTitle = _esc(_doraT("dora.help.toggle", "Afficher / masquer l'aide"));
    var h = '<div class="dora-overview-header">';
    h += '<h2 style="margin:0;display:flex;align-items:center;gap:8px">'
       + _esc(_doraT("nav.dora", "DORA Register of Information"))
       + '<button type="button" class="dora-help-btn" data-click="doraToggleHint" data-args=\'["intro"]\' title="' + helpTitle + '" aria-label="' + helpTitle + '">?</button>'
       + '</h2>';
    h += '</div>';

    // Entity-level input is the only on-screen view; the XLSX export
    // is triggered from the File menu (window.doraOpenExportModal),
    // which collects the reporting period and target currency before
    // calling the backend.
    h += _renderEntityOverview();

    host.innerHTML = h;
}

// ── Per-vendor card ──────────────────────────────────────────────
// Groups all DORA-relevant rows (arrangements, signers, subcontractors,
// supported functions, informal vendor.sub_contractors) under one card.
// Used inside each vendor's DORA tab via DoraData.renderVendorCard(v).
// Edits flow through the modal handlers; persistence stays in the EBA
// view.

// Render the rich DORA card for a single vendor.
// opts.embedded === true → no outer card border (the vendor tab already has a frame),
// no header (vendor name shown elsewhere). Default: full standalone card.
function _renderVendorCard(v, opts) {
    if (!v) return "";
    opts = opts || {};
    var embedded = !!opts.embedded;
    var fns = _doraTree.functions || [];
    var fnById = {};
    fns.forEach(function(f) { fnById[f.id] = f; });

    var vArrs = (_doraTree.arrangements || []).filter(function(a) { return a.vendor_id === v.id; });
    var critN = vArrs.filter(function(a) { return a.is_critical_function_support; }).length;
    var fnIds = {};
    vArrs.forEach(function(a) { (a.function_ids || []).forEach(function(id) { if (id) fnIds[id] = true; }); });
    var fnList = Object.keys(fnIds).map(function(id) {
        var f = fnById[id]; return f ? (f.name || f.id) + (f.is_critical_or_important ? " ★" : "") : id;
    });
    var signers = window.DoraData.signersForVendor(v.id);
    var subs = window.DoraData.subcontractorsForVendor(v.id);
    var roi = window.DoraData.roiStatus(v);

    var cardStyle = embedded
        ? 'display:block;padding:0'
        : 'display:block;padding:14px 16px;border:1px solid var(--border);border-radius:8px;background:var(--bg-elev,#fff)';
    var h = '<div class="vendor-card" style="' + cardStyle + '">';

    // Header (skipped when embedded — vendor edit modal already shows name + RoI badge)
    if (!embedded) {
        h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">';
        h += '<strong style="font-size:1.05em">' + _esc(v.name || v.id) + '</strong>';
        if (v.lei) h += '<code style="font-size:0.78em;color:var(--text-muted)">' + _esc(v.lei) + '</code>';
        if (v.country_iso2) h += '<span style="font-size:0.85em;color:var(--text-muted)">' + _esc(v.country_iso2) + '</span>';
        if (roi.complete) {
            h += '<span class="dora-badge" style="background:var(--green)">' + _esc(_doraT("dora.bridge.roi_complete", "RoI complete")) + '</span>';
        } else {
            h += '<a href="javascript:void(0)" data-click="doraOpenVendorRoi" data-args=\'["' + _esc(v.id) + '"]\' class="dora-badge" style="background:var(--orange);text-decoration:none" title="' + _esc(roi.missing.join(", ")) + '">⚠ ' + _esc(_doraT("dora.bridge.roi_incomplete", "RoI incomplete")) + '</a>';
        }
        h += '<span style="flex:1"></span>';
        h += '<button class="btn-secondary" data-click="doraOpenArrangementModal" data-args=\'[null,"' + _esc(v.id) + '",true]\' style="font-size:0.85em;padding:2px 8px">+ ' + _esc(_doraT("dora.byvendor.add_arrangement", "Add arrangement")) + '</button>';
        h += '<a href="javascript:void(0)" data-click="doraOpenVendorRoi" data-args=\'["' + _esc(v.id) + '"]\' style="font-size:0.85em">' + _esc(_doraT("dora.byvendor.open_vendor", "Open vendor file")) + ' →</a>';
        h += '</div>';
    } else {
        // Embedded: green add-arrangement button matching the app's
        // standard button style (.btn-add).
        h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">';
        h += '<button class="btn-add" data-click="doraOpenArrangementModal" data-args=\'[null,"' + _esc(v.id) + '",true]\' style="margin-top:0">+ ' + _esc(_doraT("dora.byvendor.add_arrangement", "Add arrangement")) + '</button>';
        h += '</div>';
    }

    // ── Arrangements section ───────────────────────────────────
    // Each arrangement is a fully clickable card (click anywhere = edit).
    // The "+ Subcontractor" button stops propagation so it doesn't
    // bubble up to open the arrangement modal.
    var subsByArr = {};
    subs.forEach(function(s) { (subsByArr[s.arrangement_id] = subsByArr[s.arrangement_id] || []).push(s); });

    h += '<div style="font-weight:600;font-size:0.95em;margin:6px 0 6px 0">' + _esc(_doraT("dora.byvendor.arrangements", "Arrangements")) + ' <span style="color:var(--text-muted);font-weight:400">(' + vArrs.length + (critN ? ', ' + critN + '★' : '') + ')</span></div>';

    if (vArrs.length === 0) {
        h += '<div style="padding:12px;border:1px dashed var(--border);border-radius:6px;color:var(--text-muted);text-align:center;font-size:0.9em">' + _esc(_doraT("dora.byvendor.no_arrangements", "No arrangements yet — add one to track contractual ICT services for this vendor.")) + '</div>';
    } else {
        h += '<div style="display:flex;flex-direction:column;gap:8px">';
        vArrs.forEach(function(a) {
            var aSubs = subsByArr[a.id] || [];
            var aFns = (a.function_ids || []).map(function(id) {
                var f = fnById[id]; return f ? (f.name || f.id) + (f.is_critical_or_important ? " ★" : "") : id;
            });
            // Whole card is clickable — edit modal opens via the data-click
            // delegate. Inner anchors/buttons use data-stop to keep their
            // own behavior (sub modal, +Subcontractor) without triggering
            // the parent arrangement edit.
            h += '<div class="dora-arrangement-card dora-card-hover" data-click="doraOpenArrangementModal" data-args=\'["' + _esc(a.id) + '",null,true]\' style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;background:var(--bg,#fff);cursor:pointer;transition:background 0.15s,border-color 0.15s">';
            // Header row: reference + badges + sub action
            h += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
            h += '<span style="font-weight:600">' + _esc(a.arrangement_reference || a.id) + '</span>';
            if (a.arrangement_type) h += '<span style="font-size:0.78em;color:var(--text-muted);background:var(--bg-elev,#f3f3f5);padding:1px 6px;border-radius:3px">' + _esc(_doraCodeLabel("arrangement_type", a.arrangement_type)) + '</span>';
            if (a.is_critical_function_support) h += '<span style="font-size:0.78em;background:var(--orange);color:#fff;padding:1px 6px;border-radius:3px">★ ' + _esc(_doraT("dora.byvendor.critical", "critical")) + '</span>';
            h += '<span style="flex:1"></span>';
            h += '<button class="btn-add" data-click="doraOpenSubcontractorModal" data-args=\'["' + _esc(a.id) + '",null]\' data-stop style="font-size:0.78em;padding:3px 10px;margin:0" title="' + _esc(_doraT("dora.byvendor.add_subcontractor", "Add subcontractor")) + '">+ ' + _esc(_doraT("dora.byvendor.subcontractor_short", "Subcontractor")) + '</button>';
            h += '</div>';
            // Body: functions + subcontractors
            if (aFns.length || aSubs.length) {
                h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;font-size:0.85em">';
                // Functions
                h += '<div><span style="color:var(--text-muted)">' + _esc(_doraT("dora.byvendor.functions", "Functions")) + ':</span> ';
                if (aFns.length === 0) h += '<span style="color:var(--text-muted);font-style:italic">—</span>';
                else h += aFns.map(function(name) { return '<span style="display:inline-block;padding:1px 6px;margin:1px;background:var(--bg-elev,#eef);border-radius:3px;font-size:0.95em">' + _esc(name) + '</span>'; }).join("");
                h += '</div>';
                // Subcontractors (each link stops propagation so it opens
                // its own modal instead of the parent arrangement edit).
                h += '<div><span style="color:var(--text-muted)">' + _esc(_doraT("dora.byvendor.subcontractors", "Subcontractors")) + ' (' + aSubs.length + '):</span> ';
                if (aSubs.length === 0) h += '<span style="color:var(--text-muted);font-style:italic">—</span>';
                else {
                    h += aSubs.map(function(s) {
                        return '<a href="javascript:void(0)" data-click="doraOpenSubcontractorModal" data-args=\'["' + _esc(s.arrangement_id) + '","' + _esc(s.id) + '"]\' data-stop style="margin-right:6px">' + _esc(s.name || s.id) + '<sub style="color:var(--text-muted);font-size:0.75em"> t' + (s.tier || 1) + '</sub></a>';
                    }).join("");
                }
                h += '</div>';
                h += '</div>';
            }
            h += '</div>';
        });
        h += '</div>';
    }

    // ── Sidebar summary: functions/signers across all arrangements ──
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;font-size:0.85em">';
    h += '<div><div style="font-weight:600;color:var(--text-muted);margin-bottom:2px">' + _esc(_doraT("dora.byvendor.functions_supported", "Supported functions")) + ' (' + fnList.length + ')</div>';
    if (fnList.length) h += fnList.map(function(name) { return '<span style="display:inline-block;padding:1px 6px;margin:1px;background:var(--bg-elev,#eef);border-radius:3px">' + _esc(name) + '</span>'; }).join("");
    else h += '<span style="color:var(--text-muted)">—</span>';
    h += '</div>';
    h += '<div><div style="font-weight:600;color:var(--text-muted);margin-bottom:2px">' + _esc(_doraT("dora.byvendor.signers", "Signers")) + ' (' + signers.length + ')</div>';
    if (signers.length) {
        h += signers.map(function(s) { return _esc(s.signer_name || "") + (s.signer_role ? ' <span style="color:var(--text-muted)">(' + _esc(s.signer_role) + ')</span>' : ''); }).join('<br>');
    } else h += '<span style="color:var(--text-muted)">—</span>';
    h += '</div>';
    h += '</div>';

    h += '</div>';   // end vendor card

    // ── Informal subcontractors (own zone, outside formal arrangements) ──
    // Legacy free-text list (vendor.sub_contractors). The "+ Associate"
    // button opens a picker (existing global subs + free text).
    var informal = Array.isArray(v.sub_contractors) ? v.sub_contractors.filter(function(x) { return x && String(x).trim() !== ""; }) : [];
    h += '<div style="margin-top:14px">';
    h += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">';
    h += '<div style="font-weight:600;font-size:0.95em">' + _esc(_doraT("dora.byvendor.informal_subs_title", "Informal subcontractors")) + ' <span style="color:var(--text-muted);font-weight:400">(' + informal.length + ')</span></div>';
    h += '<span style="flex:1"></span>';
    h += '<button class="btn-add" data-click="vendorOpenInformalSubModal" data-args=\'["' + _esc(v.id) + '"]\' style="margin-top:0">+ ' + _esc(_doraT("dora.byvendor.informal_subs_add", "Associate a subcontractor")) + '</button>';
    h += '</div>';
    h += '<p style="margin:0 0 6px;font-size:0.8em;color:var(--text-muted)">' + _esc(_doraT("dora.byvendor.informal_subs_hint", "Subcontractors declared outside the formal DORA arrangements (legacy free-text field).")) + '</p>';
    if (informal.length === 0) {
        h += '<div style="padding:10px;border:1px dashed var(--border);border-radius:6px;color:var(--text-muted);text-align:center;font-size:0.85em">' + _esc(_doraT("dora.byvendor.informal_subs_empty", "No informal subcontractor associated.")) + '</div>';
    } else {
        h += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
        informal.forEach(function(name, idx) {
            h += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 4px 3px 10px;background:var(--bg-elev,#eef);border-radius:14px;font-size:0.85em">';
            h += _esc(String(name));
            h += '<button data-click="vendorRemoveInformalSub" data-args=\'["' + _esc(v.id) + '",' + idx + ']\' title="' + _esc(_doraT("dora.byvendor.informal_subs_remove", "Remove")) + '" style="border:none;background:transparent;cursor:pointer;color:var(--text-muted);font-size:1.1em;line-height:1;padding:0 4px">×</button>';
            h += '</span>';
        });
        h += '</div>';
    }
    h += '</div>';

    return h;
}

// ── Entities (RFE) ───────────────────────────────────────────────

function _renderEntities() {
    // B_01.02 — List of FEs in scope. Column codes (0010..0110) match
    // _COLS_B0102 in dora_export.py. Auto-derived columns (0070 last
    // update, 0080 created_at, 0090 deletion) are not editable and are
    // omitted from the input table.
    var rows = (_doraTree.entities || []);
    var h = '<button class="btn-primary" data-click="doraAddEntity">+ ' + _doraT("dora.add_rfe", "Add RFE") + '</button>';
    h += '<table class="ct-table" style="margin-top:12px;width:100%"><thead><tr>'
       + '<th>id</th>'
       + '<th title="B_01.02.0010">0010 LEI</th>'
       + '<th title="B_01.02.0020">0020 Name</th>'
       + '<th title="B_01.02.0030">0030 Country</th>'
       + '<th title="B_01.02.0040">0040 Type</th>'
       + '<th title="B_01.02.0050">0050 Hierarchy</th>'
       + '<th title="B_01.02.0060">0060 Parent LEI</th>'
       + '<th title="B_01.02.0100">0100 ' + _esc(_doraT("dora.b0102.col_currency", "Currency")) + '</th>'
       + '<th title="B_01.02.0110">0110 ' + _esc(_doraT("dora.b0102.col_total_assets", "Total assets")) + '</th>'
       + '<th></th>'
       + '</tr></thead><tbody>';
    rows.forEach(function(r) {
        h += '<tr>';
        h += '<td>' + _esc(r.id) + '</td>';
        h += '<td><div style="display:flex;align-items:center;gap:2px"><input id="rfe-lei-tbl-' + _esc(r.id) + '" value="' + _esc(r.lei || "") + '" data-input="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","lei"]\' data-pass-value style="width:160px">' + _gleifTriggerHtml("rfe-lei-tbl-" + r.id) + '</div></td>';
        h += '<td><input value="' + _esc(r.name || "") + '" data-input="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","name"]\' data-pass-value></td>';
        h += '<td><input value="' + _esc(r.country_iso2 || "") + '" data-input="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","country_iso2"]\' data-pass-value style="width:50px;text-transform:uppercase"></td>';
        h += '<td><select data-change="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","entity_type"]\' data-pass-value>' + _codelistOptions("entity_type", r.entity_type) + '</select></td>';
        h += '<td><select data-change="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","hierarchy"]\' data-pass-value>' + _codelistOptions("hierarchy", r.hierarchy) + '</select></td>';
        h += '<td><div style="display:flex;align-items:center;gap:2px"><input id="rfe-plei-tbl-' + _esc(r.id) + '" value="' + _esc(r.parent_lei || "") + '" data-input="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","parent_lei"]\' data-pass-value style="width:160px">' + _gleifTriggerHtml("rfe-plei-tbl-" + r.id) + '</div></td>';
        h += '<td><select data-change="doraPatchEntity" data-args=\'["' + _esc(r.id) + '","total_assets_currency"]\' data-pass-value style="width:80px">';
        var _b0102Curs = (_doraCodelists && _doraCodelists.currency_iso4217) || ["EUR"];
        var _curSel = r.total_assets_currency || "EUR";
        _b0102Curs.forEach(function(c) {
            var code = c && c.code !== undefined ? c.code : c;
            h += '<option value="' + _esc(code) + '"' + (_curSel === code ? " selected" : "") + '>' + _esc(code) + '</option>';
        });
        h += '</select></td>';
        h += '<td><input type="number" step="0.01" value="' + _esc(r.total_assets != null ? r.total_assets : "") + '" data-input="doraPatchEntityNum" data-args=\'["' + _esc(r.id) + '","total_assets"]\' data-pass-value style="width:130px"></td>';
        h += '<td><button class="btn-danger" data-click="doraDelEntity" data-args=\'["' + _esc(r.id) + '"]\'>×</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
}

window.doraAddEntity = function() {
    var id = _newId("RFE");
    var row = { id: id, sort_order: (_doraTree.entities || []).length, lei: "", name: "", country_iso2: "" };
    _doraTree.entities.push(row);
    _persistCreate("dora_entity", row);
    _render(document.getElementById("dora-root"));
};

window.doraPatchEntity = function(id, field, value) {
    var r = _doraTree.entities.find(function(x) { return x.id === id; });
    if (r) r[field] = value;
    var f = {}; f[field] = value;
    _persist("dora_entity", id, f);
    // Hierarchy drives whether the parent_lei field is shown — re-render
    // the overview so the conditional row appears/disappears immediately.
    if (field === "hierarchy") {
        _render(document.getElementById("dora-root"));
    }
};

window.doraPatchEntityNum = function(id, field, value) {
    var v = value === "" ? null : parseFloat(value);
    var r = _doraTree.entities.find(function(x) { return x.id === id; });
    if (r) r[field] = v;
    var f = {}; f[field] = v;
    _persist("dora_entity", id, f);
};

window.doraDelEntity = function(id) {
    _doraTree.entities = _doraTree.entities.filter(function(x) { return x.id !== id; });
    _persistDelete("dora_entity", id);
    _render(document.getElementById("dora-root"));
};

// ── Functions ────────────────────────────────────────────────────

function _renderFunctions() {
    // B_06.01 — column codes match _COLS_B0601 in dora_export.py.
    // The "0040 LEI of FE" is auto-filled with the register holder's
    // LEI at export. "0070 Date of last assessment" is not modelled.
    var rows = (_doraTree.functions || []);
    var h = '<button class="btn-primary" data-click="doraAddFn">+ ' + _doraT("dora.add_function", "Add function") + '</button>';
    h += '<table class="ct-table" style="margin-top:12px;width:100%"><thead><tr>'
       + '<th>id</th>'
       + '<th title="B_06.01.0010">0010 Code</th>'
       + '<th title="B_06.01.0020">0020 Licensed activity</th>'
       + '<th title="B_06.01.0030">0030 Name</th>'
       + '<th title="B_06.01.0050">0050 Critical</th>'
       + '<th title="B_06.01.0060">0060 Reasons</th>'
       + '<th title="B_06.01.0080">0080 RTO h</th>'
       + '<th title="B_06.01.0090">0090 RPO h</th>'
       + '<th title="B_06.01.0100">0100 Impact tolerance</th>'
       + '<th></th></tr></thead><tbody>';
    rows.forEach(function(r) {
        h += '<tr>';
        h += '<td>' + _esc(r.id) + '</td>';
        h += '<td><input value="' + _esc(r.code || "") + '" maxlength="50" data-input="doraPatchFn" data-args=\'["' + _esc(r.id) + '","code"]\' data-pass-value style="width:120px;font-family:monospace"></td>';
        h += '<td><select data-change="doraPatchFn" data-args=\'["' + _esc(r.id) + '","business_line"]\' data-pass-value>' + _codelistOptions("licenced_activity", r.business_line) + '</select></td>';
        h += '<td><input value="' + _esc(r.name || "") + '" data-input="doraPatchFn" data-args=\'["' + _esc(r.id) + '","name"]\' data-pass-value></td>';
        h += '<td><input type="checkbox"' + (r.is_critical_or_important ? " checked" : "") + ' data-change="doraPatchFnBool" data-args=\'["' + _esc(r.id) + '","is_critical_or_important"]\'></td>';
        h += '<td><input value="' + _esc(r.criticality_rationale || "") + '" data-input="doraPatchFn" data-args=\'["' + _esc(r.id) + '","criticality_rationale"]\' data-pass-value></td>';
        h += '<td><input type="number" value="' + _esc(r.recovery_time_objective_h || "") + '" data-input="doraPatchFnNum" data-args=\'["' + _esc(r.id) + '","recovery_time_objective_h"]\' data-pass-value style="width:80px"></td>';
        h += '<td><input type="number" value="' + _esc(r.recovery_point_objective_h || "") + '" data-input="doraPatchFnNum" data-args=\'["' + _esc(r.id) + '","recovery_point_objective_h"]\' data-pass-value style="width:80px"></td>';
        h += '<td><select data-change="doraPatchFn" data-args=\'["' + _esc(r.id) + '","impact_tolerance_description"]\' data-pass-value>' + _codelistOptions("impact_level", r.impact_tolerance_description) + '</select></td>';
        h += '<td><button class="btn-danger" data-click="doraDelFn" data-args=\'["' + _esc(r.id) + '"]\'>×</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
}

window.doraAddFn = function() {
    var id = _newId("FN");
    var row = { id: id, sort_order: (_doraTree.functions || []).length, name: "", is_critical_or_important: false };
    _doraTree.functions.push(row);
    _persistCreate("dora_function", row);
    _render(document.getElementById("dora-root"));
};

window.doraPatchFn = function(id, field, value) {
    var r = _doraTree.functions.find(function(x) { return x.id === id; });
    if (r) r[field] = value;
    var f = {}; f[field] = value;
    _persist("dora_function", id, f);
};

window.doraPatchFnBool = function(id, field, evt, el) {
    var v = el.checked;
    var r = _doraTree.functions.find(function(x) { return x.id === id; });
    if (r) r[field] = v;
    var f = {}; f[field] = v;
    _persist("dora_function", id, f);
};

window.doraPatchFnNum = function(id, field, value) {
    var v = value === "" ? null : parseFloat(value);
    var r = _doraTree.functions.find(function(x) { return x.id === id; });
    if (r) r[field] = v;
    var f = {}; f[field] = v;
    _persist("dora_function", id, f);
};

window.doraDelFn = function(id) {
    _doraTree.functions = _doraTree.functions.filter(function(x) { return x.id !== id; });
    _persistDelete("dora_function", id);
    _render(document.getElementById("dora-root"));
};

// ── Branches ─────────────────────────────────────────────────────

function _renderBranches() {
    var rows = _doraTree.branches || [];
    var rfes = _doraTree.entities || [];
    var rfeOpts = '<option value=""></option>' + rfes.map(function(e) {
        return '<option value="' + _esc(e.id) + '">' + _esc(e.id + " " + (e.name || "")) + '</option>';
    }).join("");
    // B_01.03 — column codes match _COLS_B0103 in dora_export.py.
    // The exported "0020 LEI of head office" is auto-derived from the
    // parent RFE's LEI; the branch's own LEI is internal-only.
    var rfeNameById = {}; rfes.forEach(function(e) { rfeNameById[e.id] = e.name || e.id; });
    var h = '<button class="btn-primary" data-click="doraAddBranch">+ ' + _doraT("dora.add_branch", "Add branch") + '</button>';
    h += '<table class="ct-table" style="margin-top:12px;width:100%"><thead><tr>'
       + '<th>id</th>'
       + '<th title="B_01.03.0010">0010 Code</th>'
       + '<th title="B_01.03.0020 (auto)">0020 Head LEI</th>'
       + '<th title="B_01.03.0030">0030 Name</th>'
       + '<th title="B_01.03.0040">0040 Country</th>'
       + '<th></th></tr></thead><tbody>';
    rows.forEach(function(r) {
        h += '<tr>';
        h += '<td>' + _esc(r.id) + '</td>';
        h += '<td><input value="' + _esc(r.branch_code || "") + '" data-input="doraPatchBranch" data-args=\'["' + _esc(r.id) + '","branch_code"]\' data-pass-value></td>';
        h += '<td>' + _esc(rfeNameById[r.rfe_id] || r.rfe_id || "—") + '</td>';
        h += '<td><input value="' + _esc(r.name || "") + '" data-input="doraPatchBranch" data-args=\'["' + _esc(r.id) + '","name"]\' data-pass-value></td>';
        h += '<td><input value="' + _esc(r.country_iso2 || "") + '" data-input="doraPatchBranch" data-args=\'["' + _esc(r.id) + '","country_iso2"]\' data-pass-value style="width:50px;text-transform:uppercase"></td>';
        h += '<td><button class="btn-danger" data-click="doraDelBranch" data-args=\'["' + _esc(r.id) + '"]\'>×</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';
    if (rfes.length === 0) {
        h += '<p style="color:#a33;margin-top:8px">' + _doraT("dora.need_rfe", "Add an RFE first.") + '</p>';
    }
    return h;
}

window.doraAddBranch = function() {
    var rfes = _doraTree.entities || [];
    if (!rfes.length) { showStatus(_doraT("dora.need_rfe", "Add an RFE first.")); return; }
    var rfe_id = rfes[0].id;
    var id = _newId("BR");
    var row = { id: id, rfe_id: rfe_id, sort_order: (_doraTree.branches || []).length, country_iso2: "" };
    _doraTree.branches.push(row);
    _persistCreate("dora_branch", row);
    _render(document.getElementById("dora-root"));
};

window.doraPatchBranch = function(id, field, value) {
    var r = _doraTree.branches.find(function(x) { return x.id === id; });
    if (r) r[field] = value;
    var f = {}; f[field] = value;
    _persist("dora_branch", id, f);
};

window.doraDelBranch = function(id) {
    _doraTree.branches = _doraTree.branches.filter(function(x) { return x.id !== id; });
    _persistDelete("dora_branch", id);
    _render(document.getElementById("dora-root"));
};

// ── Consolidation ────────────────────────────────────────────────

function _renderConsolidation() {
    // Consolidation rows go to the same B_01.02 sheet as RFE rows. The
    // export populates only LEI (0010), name (0020), country (0030) and
    // leaves type/hierarchy/parent_lei empty (see dora_export.py:670-676).
    var rows = _doraTree.consolidation || [];
    var h = '<button class="btn-primary" data-click="doraAddCs">+ ' + _doraT("dora.add_cs", "Add entry") + '</button>';
    h += '<table class="ct-table" style="margin-top:12px;width:100%"><thead><tr>'
       + '<th>id</th>'
       + '<th title="B_01.02.0010">0010 LEI</th>'
       + '<th title="B_01.02.0020">0020 Name</th>'
       + '<th title="B_01.02.0030">0030 Country</th>'
       + '<th></th></tr></thead><tbody>';
    rows.forEach(function(r) {
        h += '<tr>';
        h += '<td>' + _esc(r.id) + '</td>';
        h += '<td><input value="' + _esc(r.entity_lei || "") + '" data-input="doraPatchCs" data-args=\'["' + _esc(r.id) + '","entity_lei"]\' data-pass-value style="width:160px"></td>';
        h += '<td><input value="' + _esc(r.entity_name || "") + '" data-input="doraPatchCs" data-args=\'["' + _esc(r.id) + '","entity_name"]\' data-pass-value></td>';
        h += '<td><input value="' + _esc(r.country_iso2 || "") + '" data-input="doraPatchCs" data-args=\'["' + _esc(r.id) + '","country_iso2"]\' data-pass-value style="width:50px;text-transform:uppercase"></td>';
        h += '<td><button class="btn-danger" data-click="doraDelCs" data-args=\'["' + _esc(r.id) + '"]\'>×</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
}

window.doraAddCs = function() {
    var id = _newId("CS");
    var row = { id: id, sort_order: (_doraTree.consolidation || []).length, entity_lei: "" };
    _doraTree.consolidation.push(row);
    _persistCreate("dora_cs", row);
    _render(document.getElementById("dora-root"));
};

window.doraPatchCs = function(id, field, value) {
    var r = _doraTree.consolidation.find(function(x) { return x.id === id; });
    if (r) r[field] = value;
    var f = {}; f[field] = value;
    _persist("dora_cs", id, f);
};

window.doraDelCs = function(id) {
    _doraTree.consolidation = _doraTree.consolidation.filter(function(x) { return x.id !== id; });
    _persistDelete("dora_cs", id);
    _render(document.getElementById("dora-root"));
};

// ── Arrangements ─────────────────────────────────────────────────

function _renderArrangements() {
    var rows = _doraTree.arrangements || [];
    var vendors = (window.D && D.vendors) || [];
    var fns = _doraTree.functions || [];
    // Enriched vendor option: name + LEI + country + ⚠ if RoI incomplete.
    function _vendorOptHtml(v, current) {
        var roi = window.DoraData.roiStatus(v);
        var bits = [v.name || v.id];
        if (v.lei) bits.push(v.lei);
        else if (!roi.complete) bits.push("⚠ " + _doraT("dora.bridge.roi_incomplete", "RoI incomplete"));
        if (v.country_iso2) bits.push(v.country_iso2);
        var sel = (current === v.id) ? " selected" : "";
        return '<option value="' + _esc(v.id) + '"' + sel + '>' + _esc(bits.join(" · ")) + '</option>';
    }
    function _vendorOpts(current) {
        var html = '<option value=""></option>';
        vendors.forEach(function(v) { html += _vendorOptHtml(v, current); });
        return html;
    }
    var fnNameById = {};
    fns.forEach(function(f) { fnNameById[f.id] = (f.name || f.id) + (f.is_critical_or_important ? " ★" : ""); });
    var h = '<button class="btn-primary" data-click="doraAddArrangement">+ ' + _doraT("dora.add_arrangement", "Add arrangement") + '</button>';
    h += ' <button class="btn-secondary" data-click="doraOpenArrangementModal" data-args=\'[null,null]\'>✎ ' + _doraT("dora.modal.arr_title_new", "New contractual arrangement") + '</button>';
    h += '<table class="ct-table" style="margin-top:12px;width:100%"><thead><tr>'
       + '<th>id</th><th>reference</th><th>vendor</th><th>type</th><th>function</th>'
       + '<th>critical-fn</th><th>start</th><th>end</th><th>cost</th><th>currency</th><th></th><th></th></tr></thead><tbody>';
    rows.forEach(function(r) {
        var rFnIds = r.function_ids || [];
        var fnSummary = rFnIds.length === 0
            ? '<span style="color:var(--text-muted);font-style:italic">—</span>'
            : rFnIds.map(function(id) { return '<span class="dora-tag" style="display:inline-block;padding:1px 6px;margin:1px;background:var(--bg-elev,#eef);border-radius:3px;font-size:0.85em">' + _esc(fnNameById[id] || id) + '</span>'; }).join("");
        // Vendor cell — enriched dropdown with inline jump-to-fix link if RoI incomplete.
        var vendorObj = vendors.find(function(x) { return x.id === r.vendor_id; });
        var roi = vendorObj ? window.DoraData.roiStatus(vendorObj) : { complete: true, missing: [] };
        var vendorCell = '<select data-change="doraPatchArr" data-args=\'["' + _esc(r.id) + '","vendor_id"]\' data-pass-value style="max-width:230px">' + _vendorOpts(r.vendor_id) + '</select>';
        if (vendorObj && !roi.complete) {
            vendorCell += ' <a href="javascript:void(0)" data-click="doraOpenVendorRoi" data-args=\'["' + _esc(vendorObj.id) + '"]\' style="color:var(--orange);font-size:0.85em;font-weight:600" title="' + _esc(_doraT("dora.bridge.roi_missing", "RoI fields missing") + ": " + roi.missing.join(", ")) + '">⚠ ' + _esc(_doraT("dora.bridge.complete_roi", "Complete RoI")) + '</a>';
        }
        h += '<tr>';
        h += '<td>' + _esc(r.id) + '</td>';
        h += '<td><input value="' + _esc(r.arrangement_reference || "") + '" data-input="doraPatchArr" data-args=\'["' + _esc(r.id) + '","arrangement_reference"]\' data-pass-value></td>';
        h += '<td>' + vendorCell + '</td>';
        h += '<td><select data-change="doraPatchArr" data-args=\'["' + _esc(r.id) + '","arrangement_type"]\' data-pass-value>' + _codelistOptions("arrangement_type", r.arrangement_type) + '</select></td>';
        h += '<td><div style="max-width:240px">' + fnSummary + ' <button class="btn-secondary" data-click="doraOpenArrangementModal" data-args=\'["' + _esc(r.id) + '"]\' style="font-size:0.8em;padding:1px 6px" title="' + _esc(_doraT("dora.byvendor.edit", "Edit")) + '">✎</button></div></td>';
        h += '<td><input type="checkbox"' + (r.is_critical_function_support ? " checked" : "") + ' data-change="doraPatchArrBool" data-args=\'["' + _esc(r.id) + '","is_critical_function_support"]\'></td>';
        h += '<td><input value="' + _esc(r.start_date || "") + '" placeholder="YYYY-MM-DD" data-input="doraPatchArr" data-args=\'["' + _esc(r.id) + '","start_date"]\' data-pass-value style="width:110px"></td>';
        h += '<td><input value="' + _esc(r.end_date || "") + '" placeholder="YYYY-MM-DD" data-input="doraPatchArr" data-args=\'["' + _esc(r.id) + '","end_date"]\' data-pass-value style="width:110px"></td>';
        h += '<td><input type="number" value="' + _esc(r.annual_cost_amount || "") + '" data-input="doraPatchArrNum" data-args=\'["' + _esc(r.id) + '","annual_cost_amount"]\' data-pass-value style="width:100px"></td>';
        h += '<td><select data-change="doraPatchArr" data-args=\'["' + _esc(r.id) + '","currency"]\' data-pass-value>';
        var currencies = (_doraCodelists && _doraCodelists.currency_iso4217) || ["EUR"];
        currencies.forEach(function(c) {
            var code = c && c.code !== undefined ? c.code : c;
            h += '<option value="' + _esc(code) + '"' + (r.currency === code ? " selected" : "") + '>' + _esc(code) + '</option>';
        });
        h += '</select></td>';
        h += '<td><button class="btn-secondary" data-click="doraOpenArrangementModal" data-args=\'["' + _esc(r.id) + '"]\' title="' + _esc(_doraT("dora.byvendor.edit", "Edit")) + '">✎</button></td>';
        h += '<td><button class="btn-danger" data-click="doraDelArr" data-args=\'["' + _esc(r.id) + '"]\'>×</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';
    if (vendors.length === 0) {
        h += '<p style="color:#a33;margin-top:8px">' + _doraT("dora.need_vendor", "Add a vendor first.") + '</p>';
    }
    return h;
}

window.doraAddArrangement = function() {
    var vendors = (window.D && D.vendors) || [];
    if (!vendors.length) { showStatus(_doraT("dora.need_vendor", "Add a vendor first.")); return; }
    var vendor_id = vendors[0].id;
    var id = _newId("ARR");
    var ref = _doraNextRef("ARR");
    var row = { id: id, vendor_id: vendor_id, arrangement_reference: ref, sort_order: (_doraTree.arrangements || []).length, currency: "EUR", rfe_ids: [] };
    _doraTree.arrangements.push(row);
    _persistCreate("dora_arrangement", row);
    _render(document.getElementById("dora-root"));
};

window.doraPatchArr = function(id, field, value) {
    var r = _doraTree.arrangements.find(function(x) { return x.id === id; });
    if (r) r[field] = value;
    var f = {}; f[field] = value;
    _persist("dora_arrangement", id, f);
};

window.doraPatchArrBool = function(id, field, evt, el) {
    var v = el.checked;
    var r = _doraTree.arrangements.find(function(x) { return x.id === id; });
    if (r) r[field] = v;
    var f = {}; f[field] = v;
    _persist("dora_arrangement", id, f);
};

window.doraPatchArrNum = function(id, field, value) {
    var v = value === "" ? null : parseFloat(value);
    var r = _doraTree.arrangements.find(function(x) { return x.id === id; });
    if (r) r[field] = v;
    var f = {}; f[field] = v;
    _persist("dora_arrangement", id, f);
};

window.doraDelArr = function(id) {
    _doraTree.arrangements = _doraTree.arrangements.filter(function(x) { return x.id !== id; });
    _persistDelete("dora_arrangement", id);
    _render(document.getElementById("dora-root"));
};

// Jump from any DORA tab to the Vendor edit modal on its DORA RoI tab.
window.doraOpenVendorRoi = function(vendorId) {
    var vendors = (window.D && D.vendors) || [];
    var idx = -1;
    for (var i = 0; i < vendors.length; i++) {
        if (vendors[i].id === vendorId) { idx = i; break; }
    }
    if (idx < 0) return;
    if (typeof window.selectPanel === "function") window.selectPanel("vendors");
    if (typeof window._selectedVendor !== "undefined") window._selectedVendor = idx;
    if (typeof window._vendorTab !== "undefined") window._vendorTab = "dora";
    // Use the openVendor helper which sets the index then renders.
    if (typeof window.openVendor === "function") {
        window.openVendor(idx);
        // openVendor resets _vendorTab to "info" — override and re-render.
        if (typeof window.setVendorTab === "function") window.setVendorTab("dora");
    }
};

// ── Signers ──────────────────────────────────────────────────────

function _renderSigners() {
    var rows = _doraTree.signers || [];
    var arrs = _doraTree.arrangements || [];
    var arrOpts = arrs.map(function(a) {
        return '<option value="' + _esc(a.id) + '">' + _esc(a.id + " " + (a.arrangement_reference || "")) + '</option>';
    }).join("");
    var h = '<select id="dora-signer-arr">' + arrOpts + '</select> ';
    h += '<button class="btn-primary" data-click="doraAddSigner">+ ' + _doraT("dora.add_signer", "Add signer") + '</button>';
    h += '<table class="ct-table" style="margin-top:12px;width:100%"><thead><tr>'
       + '<th>arrangement</th><th>id</th><th>LEI</th><th>name</th><th>role</th><th></th></tr></thead><tbody>';
    rows.forEach(function(r) {
        var compositeId = r.arrangement_id + "/" + r.id;
        h += '<tr>';
        h += '<td>' + _esc(r.arrangement_id) + '</td>';
        h += '<td>' + _esc(r.id) + '</td>';
        h += '<td><input value="' + _esc(r.signer_lei || "") + '" data-input="doraPatchSigner" data-args=\'["' + _esc(compositeId) + '","signer_lei"]\' data-pass-value style="width:160px"></td>';
        h += '<td><input value="' + _esc(r.signer_name || "") + '" data-input="doraPatchSigner" data-args=\'["' + _esc(compositeId) + '","signer_name"]\' data-pass-value></td>';
        h += '<td><select data-change="doraPatchSigner" data-args=\'["' + _esc(compositeId) + '","signer_role"]\' data-pass-value>' + _codelistOptions("signer_role", r.signer_role) + '</select></td>';
        h += '<td><button class="btn-danger" data-click="doraDelSigner" data-args=\'["' + _esc(compositeId) + '"]\'>×</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';
    if (arrs.length === 0) {
        h += '<p style="color:#a33;margin-top:8px">' + _doraT("dora.need_arrangement", "Add an arrangement first.") + '</p>';
    }
    return h;
}

window.doraAddSigner = function() {
    var sel = document.getElementById("dora-signer-arr");
    if (!sel || !sel.value) return;
    var aid = sel.value;
    var id = _newId("SIG");
    var row = { id: id, arrangement_id: aid, sort_order: 0, signer_name: "" };
    _doraTree.signers.push(row);
    _persistCreate("dora_signer", row);
    _render(document.getElementById("dora-root"));
};

window.doraPatchSigner = function(compositeId, field, value) {
    var p = compositeId.split("/");
    var aid = p[0], sid = p[1];
    var r = _doraTree.signers.find(function(x) { return x.arrangement_id === aid && x.id === sid; });
    if (r) r[field] = value;
    var f = {}; f[field] = value;
    _persist("dora_signer", compositeId, f);
};

window.doraDelSigner = function(compositeId) {
    var p = compositeId.split("/");
    var aid = p[0], sid = p[1];
    _doraTree.signers = _doraTree.signers.filter(function(x) { return !(x.arrangement_id === aid && x.id === sid); });
    _persistDelete("dora_signer", compositeId);
    _render(document.getElementById("dora-root"));
};

// ── Per-arrangement signers (used inside the arrangement modal) ─────
//
// Two modes are exposed in the arrangement modal:
//   - vendor_self: the PSTI signs in its own name. Exclusive — at save
//     time we delete every other signer attached to this arrangement
//     and create a single mirror row built from the vendor identity.
//   - other: any number of signers attached to the arrangement, each
//     with its own LEI / name / role. Existing signers from other
//     arrangements of the same vendor can be picked from a dropdown
//     to avoid retyping.

function _doraVendorSelfSignerRow(vendor, arrangementId, sortOrder) {
    return {
        id: _newId("SIG"),
        arrangement_id: arrangementId,
        sort_order: sortOrder || 0,
        signer_lei: (vendor && vendor.lei) || "",
        signer_name: (vendor && (vendor.legal_name_latin || vendor.name)) || "",
        signer_role: "tpp"
    };
}

function _doraIsVendorSelfSigner(s, vendor) {
    if (!s || !vendor) return false;
    var vLei = (vendor.lei || "").trim();
    var vName = (vendor.legal_name_latin || vendor.name || "").trim();
    var sLei = (s.signer_lei || "").trim();
    var sName = (s.signer_name || "").trim();
    if (vLei && sLei) return vLei.toUpperCase() === sLei.toUpperCase();
    if (!vLei && !sLei) return vName !== "" && vName === sName;
    return false;
}

// Returns distinct signer identities (lei, name, role) collected from
// every arrangement of `vendorId`, except `excludeArrId`. Used to feed
// the "Pick from this vendor's other signers" dropdown.
function _doraDistinctSignersForVendor(vendorId, excludeArrId) {
    var arrs = (_doraTree.arrangements || []).filter(function(a) {
        return a.vendor_id === vendorId && a.id !== excludeArrId;
    });
    var arrIds = {};
    arrs.forEach(function(a) { arrIds[a.id] = true; });
    var seen = {};
    var out = [];
    (_doraTree.signers || []).forEach(function(s) {
        if (!arrIds[s.arrangement_id]) return;
        var key = ((s.signer_lei || "").trim().toUpperCase()) + "|" + ((s.signer_name || "").trim().toLowerCase());
        if (key === "|") return;
        if (seen[key]) return;
        seen[key] = true;
        out.push({
            signer_lei: s.signer_lei || "",
            signer_name: s.signer_name || "",
            signer_role: s.signer_role || ""
        });
    });
    return out;
}

// Add a signer to the open arrangement modal by cloning identity from
// a previously-known signer of the same vendor. arrangementId must be
// the id of an already-saved arrangement (button is hidden on new).
window.doraAddSignerByExisting = function(arrangementId) {
    var sel = document.getElementById("arr-signer-pick");
    if (!sel || !sel.value) return;
    var vendor = (_doraTree.arrangements || []).find(function(a) { return a.id === arrangementId; });
    vendor = vendor ? ((window.D && D.vendors) || []).find(function(v) { return v.id === vendor.vendor_id; }) : null;
    var src = _doraDistinctSignersForVendor(vendor ? vendor.id : "", null)
        .filter(function(x) {
            var key = ((x.signer_lei || "").trim().toUpperCase()) + "|" + ((x.signer_name || "").trim().toLowerCase());
            return key === sel.value;
        })[0];
    if (!src) return;
    var existing = (_doraTree.signers || []).filter(function(s) { return s.arrangement_id === arrangementId; });
    var row = {
        id: _newId("SIG"),
        arrangement_id: arrangementId,
        sort_order: existing.length,
        signer_lei: src.signer_lei || "",
        signer_name: src.signer_name || "",
        signer_role: src.signer_role || ""
    };
    _doraTree.signers = (_doraTree.signers || []).concat([row]);
    _persistCreate("dora_signer", row);
    _doraRefreshArrSignerSection(arrangementId);
};

window.doraRemoveSignerFromArr = function(compositeId) {
    var p = compositeId.split("/");
    var aid = p[0], sid = p[1];
    _doraTree.signers = (_doraTree.signers || []).filter(function(x) { return !(x.arrangement_id === aid && x.id === sid); });
    _persistDelete("dora_signer", compositeId);
    _doraRefreshArrSignerSection(aid);
};

window.doraPatchArrSigner = function(compositeId, field, value) {
    var p = compositeId.split("/");
    var aid = p[0], sid = p[1];
    var r = (_doraTree.signers || []).find(function(x) { return x.arrangement_id === aid && x.id === sid; });
    if (r) r[field] = value;
    var f = {}; f[field] = value;
    _persist("dora_signer", compositeId, f);
};

window.doraOnSignerModeChange = function(arrangementId) {
    _doraRefreshArrSignerSection(arrangementId);
};

// Re-render the in-modal signer block in place (no global render).
function _doraRefreshArrSignerSection(arrangementId) {
    var slot = document.getElementById("arr-signer-slot");
    if (!slot) return;
    slot.innerHTML = _doraRenderArrSignerSlot(arrangementId);
}

// Render the inner content of the signer section. Pure HTML.
// `modeOverride` lets the caller force a mode when the radios aren't
// in the DOM yet (initial modal build): without it, querySelector
// returns null and we fall back to "other" — which then masks a
// freshly-detected "vendor_self" mode and shows the table instead of
// the self-mirror banner.
function _doraRenderArrSignerSlot(arrangementId, modeOverride) {
    var mode;
    if (modeOverride === "vendor_self" || modeOverride === "other") {
        mode = modeOverride;
    } else {
        var modeEl = document.querySelector('input[name="arr-signer-mode"]:checked');
        mode = modeEl ? modeEl.value : "other";
    }
    var arr = (_doraTree.arrangements || []).find(function(a) { return a.id === arrangementId; });
    var vendorId = arr ? arr.vendor_id : (window._doraArrEditCtx && window._doraArrEditCtx.vendorIdHint) || "";
    var vendor = vendorId ? ((window.D && D.vendors) || []).find(function(v) { return v.id === vendorId; }) : null;

    if (mode === "vendor_self") {
        var label = vendor ? (vendor.legal_name_latin || vendor.name || vendor.id) : "—";
        var leiTxt = (vendor && vendor.lei) ? vendor.lei : "";
        return '<div style="padding:8px 10px;background:var(--bg-elev,#f3f3f5);border:1px solid var(--border);border-radius:4px;font-size:0.9em">'
             + '<strong>' + _esc(label) + '</strong>'
             + (leiTxt ? ' <span style="color:var(--text-muted);font-family:monospace;margin-left:6px">' + _esc(leiTxt) + '</span>' : '')
             + '<div style="color:var(--text-muted);margin-top:4px;font-size:0.85em">'
             + _esc(_doraT("dora.modal.signer_self_hint", "On save, every other signer attached to this arrangement will be removed and replaced by a single signer mirroring this vendor."))
             + '</div></div>';
    }

    // mode === "other"
    var rows = (_doraTree.signers || []).filter(function(s) { return s.arrangement_id === arrangementId; });
    var h = '';
    if (!arrangementId || !arr) {
        h += '<div style="color:var(--text-muted);font-size:0.85em;padding:6px 0">'
           + _esc(_doraT("dora.modal.signer_save_first", "Save the arrangement first to attach signers."))
           + '</div>';
        return h;
    }
    if (rows.length === 0) {
        h += '<div style="color:var(--text-muted);font-size:0.85em;padding:4px 0 8px">'
           + _esc(_doraT("dora.modal.signer_none", "No signer attached yet."))
           + '</div>';
    } else {
        h += '<table class="ct-table" style="width:100%;font-size:0.9em;margin-bottom:8px"><thead><tr>'
           + '<th style="width:170px">' + _esc(_doraT("dora.signer.lei", "LEI (B_03.03.0020)")) + '</th>'
           + '<th>' + _esc(_doraT("dora.signer.name", "Name")) + '</th>'
           + '<th style="width:170px">' + _esc(_doraT("dora.signer.role", "Role")) + '</th>'
           + '<th style="width:36px"></th></tr></thead><tbody>';
        rows.forEach(function(r) {
            var cid = r.arrangement_id + "/" + r.id;
            h += '<tr>'
               + '<td><input value="' + _esc(r.signer_lei || "") + '" data-input="doraPatchArrSigner" data-args=\'["' + _esc(cid) + '","signer_lei"]\' data-pass-value style="width:100%;font-family:monospace"></td>'
               + '<td><input value="' + _esc(r.signer_name || "") + '" data-input="doraPatchArrSigner" data-args=\'["' + _esc(cid) + '","signer_name"]\' data-pass-value style="width:100%"></td>'
               + '<td><select data-change="doraPatchArrSigner" data-args=\'["' + _esc(cid) + '","signer_role"]\' data-pass-value style="width:100%">' + _codelistOptions("signer_role", r.signer_role) + '</select></td>'
               + '<td><button type="button" class="btn-danger" data-click="doraRemoveSignerFromArr" data-args=\'["' + _esc(cid) + '"]\' title="' + _esc(_doraT("btn_delete", "Delete")) + '">×</button></td>'
               + '</tr>';
        });
        h += '</tbody></table>';
    }

    // Add controls: pick from vendor's other signers + new signer
    var distinct = vendorId ? _doraDistinctSignersForVendor(vendorId, arrangementId) : [];
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
    if (distinct.length > 0) {
        var opts = '<option value="">' + _esc(_doraT("dora.modal.signer_pick_ph", "Pick from this vendor's other signers…")) + '</option>';
        distinct.forEach(function(d) {
            var key = ((d.signer_lei || "").trim().toUpperCase()) + "|" + ((d.signer_name || "").trim().toLowerCase());
            var label = d.signer_name + (d.signer_lei ? " — " + d.signer_lei : "");
            opts += '<option value="' + _esc(key) + '">' + _esc(label) + '</option>';
        });
        h += '<select id="arr-signer-pick" style="flex:1;min-width:220px">' + opts + '</select>';
        h += '<button type="button" class="btn-secondary" data-click="doraAddSignerByExisting" data-args=\'["' + _esc(arrangementId) + '"]\'>+ ' + _esc(_doraT("dora.modal.signer_pick_add", "Add picked")) + '</button>';
    }
    h += '<button type="button" class="btn-add" data-click="doraOpenSignerModalForArr" data-args=\'["' + _esc(arrangementId) + '"]\'>+ ' + _esc(_doraT("dora.modal.signer_new", "New signer")) + '</button>';
    h += '</div>';
    return h;
}

// Open the signer-create modal as a child of the arrangement modal.
// Snapshots the arrangement form, then on save/cancel reopens the
// arrangement modal with the snapshot as prefill (mirrors the function
// modal stack pattern).
window.doraOpenSignerModalForArr = function(arrangementId) {
    var ctx = window._doraArrEditCtx;
    if (!ctx) {
        window.doraOpenSignerCreateModal(arrangementId);
        return;
    }
    var snapshot = null;
    try { if (typeof ctx.collect === "function") snapshot = ctx.collect(); }
    catch (e) { snapshot = null; }
    var savedCtx = {
        arrangementId: ctx.arrangementId,
        inProgressId: ctx.inProgressId,
        vendorIdHint: ctx.vendorIdHint,
        lockVendor: ctx.lockVendor,
        isNew: ctx.isNew,
        snapshot: snapshot
    };
    var p = window.doraOpenSignerCreateModal(arrangementId);
    function _reopenArr() {
        var prefill = savedCtx.snapshot ? Object.assign({}, savedCtx.snapshot) : null;
        if (savedCtx.isNew && savedCtx.inProgressId) {
            if (!prefill) prefill = {};
            prefill.id = savedCtx.inProgressId;
        }
        window.doraOpenArrangementModal(savedCtx.arrangementId, savedCtx.vendorIdHint, savedCtx.lockVendor, prefill);
    }
    if (p && typeof p.then === "function") {
        p.then(_reopenArr, _reopenArr);
    } else {
        setTimeout(_reopenArr, 0);
    }
};

// Pure signer-create modal — collects LEI/name/role, persists granularly,
// and resolves its Promise so the caller can chain.
window.doraOpenSignerCreateModal = function(arrangementId) {
    if (typeof window.ct_modal === "undefined") return null;
    var bodyHtml = ''
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:0.9em">'
        + '  <label style="grid-column:span 2">' + _esc(_doraT("dora.signer.name", "Name")) + ' *<input id="sig-name" required style="width:100%"></label>'
        + '  <label>' + _esc(_doraT("dora.signer.lei", "LEI (B_03.03.0020)")) + '<div style="display:flex;align-items:center;gap:2px"><input id="sig-lei" maxlength="20" style="flex:1;font-family:monospace;text-transform:uppercase">' + _gleifTriggerHtml("sig-lei") + '</div></label>'
        + '  <label>' + _esc(_doraT("dora.signer.role", "Role")) + '<select id="sig-role" style="width:100%">' + _codelistOptions("signer_role", "") + '</select></label>'
        + '</div>';
    var buttons = [
        { id: "cancel", label: _doraT("btn_cancel", "Cancel") },
        { id: "save", label: _doraT("btn_save", "Save"), primary: true, result: function() {
            var name = (document.getElementById("sig-name") || {}).value || "";
            name = name.trim();
            if (!name) { showStatus(_doraT("dora.signer.name_required", "Signer name is required.")); return false; }
            var lei = ((document.getElementById("sig-lei") || {}).value || "").trim().toUpperCase();
            var role = (document.getElementById("sig-role") || {}).value || "";
            var existing = (_doraTree.signers || []).filter(function(s) { return s.arrangement_id === arrangementId; });
            var row = {
                id: _newId("SIG"),
                arrangement_id: arrangementId,
                sort_order: existing.length,
                signer_lei: lei,
                signer_name: name,
                signer_role: role
            };
            _doraTree.signers = (_doraTree.signers || []).concat([row]);
            _persistCreate("dora_signer", row);
            return "saved";
        }}
    ];
    return window.ct_modal.open({
        title: _doraT("dora.signer.title_new", "New signer"),
        body: bodyHtml,
        size: "md",
        buttons: buttons
    });
};

// ── Subcontractors (global identity + arrangement junction) ─────

function _renderSubcontractors() {
    var subs = _doraTree.subcontractors || [];
    var links = _doraTree.subcontractor_links || [];
    var arrs = _doraTree.arrangements || [];
    var arrById = {}; arrs.forEach(function(a) { arrById[a.id] = a; });
    var vById = {}; ((window.D && D.vendors) || []).forEach(function(v) { vById[v.id] = v; });

    // Group links by sub.
    var linksBySub = {};
    links.forEach(function(l) {
        if (!linksBySub[l.subcontractor_id]) linksBySub[l.subcontractor_id] = [];
        linksBySub[l.subcontractor_id].push(l);
    });

    var h = '<p style="color:var(--text-muted);font-size:0.9em;margin-bottom:8px">'
          + _doraT("dora.subs.intro", "Project-wide subcontractor entities. Link a subcontractor to one or more arrangements via the arrangement edit modal.")
          + '</p>';
    h += '<button class="btn-primary" data-click="doraAddSub">+ ' + _doraT("dora.add_subcontractor", "Add subcontractor") + '</button>';
    h += '<table class="ct-table" style="margin-top:12px;width:100%"><thead><tr>'
       + '<th>' + _doraT("dora.subs.id", "id") + '</th>'
       + '<th>' + _doraT("dora.subs.name", "Name") + '</th>'
       + '<th>' + _doraT("dora.subs.lei", "LEI") + '</th>'
       + '<th>' + _doraT("dora.subs.country", "Country") + '</th>'
       + '<th>' + _doraT("dora.subs.linked_arrangements", "Linked arrangements") + '</th>'
       + '<th></th><th></th></tr></thead><tbody>';
    subs.forEach(function(s) {
        var subLinks = linksBySub[s.id] || [];
        h += '<tr>';
        h += '<td>' + _esc(s.id) + '</td>';
        h += '<td><input value="' + _esc(s.name || "") + '" data-input="doraPatchSub" data-args=\'["' + _esc(s.id) + '","name"]\' data-pass-value></td>';
        h += '<td><input value="' + _esc(s.lei || "") + '" data-input="doraPatchSub" data-args=\'["' + _esc(s.id) + '","lei"]\' data-pass-value style="width:160px"> '
           + (window.DoraData.gleifTriggerHtml ? window.DoraData.gleifTriggerHtml("sub-row-lei-" + s.id, function(rec) {
                 // GLEIF picker callback: updates the input via data-click handler.
             }) : '')
           + '</td>';
        h += '<td><input value="' + _esc(s.country_iso2 || "") + '" data-input="doraPatchSub" data-args=\'["' + _esc(s.id) + '","country_iso2"]\' data-pass-value style="width:50px;text-transform:uppercase"></td>';
        h += '<td>';
        if (subLinks.length === 0) {
            h += '<span style="color:var(--text-muted)">' + _doraT("dora.subs.no_links", "—") + '</span>';
        } else {
            subLinks.forEach(function(l) {
                var a = arrById[l.arrangement_id];
                var v = a ? vById[a.vendor_id] : null;
                var label = (a && a.arrangement_reference) ? a.arrangement_reference : l.arrangement_id;
                var vendorBadge = v ? (' <span style="color:var(--text-muted);font-size:0.85em">(' + _esc(v.name) + ')</span>') : '';
                h += '<a href="javascript:void(0)" data-click="doraOpenArrangementModal" data-args=\'["' + _esc(l.arrangement_id) + '"]\' style="margin-right:8px;display:inline-block">'
                   + _esc(label) + '<sub style="color:var(--text-muted);font-size:0.75em"> t' + (l.tier || 1) + '</sub>' + vendorBadge + '</a>';
            });
        }
        h += '</td>';
        h += '<td><button class="btn-secondary" data-click="doraOpenSubIdentityModal" data-args=\'["' + _esc(s.id) + '"]\' title="' + _esc(_doraT("dora.byvendor.edit", "Edit")) + '">✎</button></td>';
        h += '<td><button class="btn-danger" data-click="doraDelSub" data-args=\'["' + _esc(s.id) + '"]\' title="' + _esc(_doraT("dora.subs.delete_warn", "Delete subcontractor (also unlinks from all arrangements)")) + '">×</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
}

window.doraAddSub = function() {
    var id = _newId("SUB");
    var row = { id: id, sort_order: 0, name: "" };
    _doraTree.subcontractors = _doraTree.subcontractors || [];
    _doraTree.subcontractors.push(row);
    _persistCreate("dora_subcontractor", row);
    var host = document.getElementById("dora-root");
    if (host) {
        _render(host);
    } else if (typeof window.renderPanel === "function") {
        try { window.renderPanel(); } catch (e) {}
    }
    // Open the identity modal so the user can fill name/LEI immediately.
    setTimeout(function() { window.doraOpenSubIdentityModal && window.doraOpenSubIdentityModal(id); }, 50);
};

// Inline-create flow from the arrangement↔sub link modal:
// close the link modal → create a new sub identity → open identity modal
// → after it closes (save / cancel / delete), re-open the link modal with
// the new sub pre-selected in the picker. If the user deleted it from the
// identity modal, the picker will simply not list it.
window.doraNewSubFromLink = function(arrangementId) {
    if (!arrangementId) return;
    if (window.ct_modal && typeof window.ct_modal.close === "function") {
        try { window.ct_modal.close(); } catch (e) {}
    }
    var id = _newId("SUB");
    var row = { id: id, sort_order: (_doraTree.subcontractors || []).length, name: "" };
    _doraTree.subcontractors = _doraTree.subcontractors || [];
    _doraTree.subcontractors.push(row);
    _persistCreate("dora_subcontractor", row);
    setTimeout(function() {
        if (!window.doraOpenSubIdentityModal) return;
        // Chain on the identity modal's Promise (returned by ct_modal.open).
        // When the user closes/saves/deletes, re-open the link modal with the
        // new sub pre-selected (unless the user deleted it from inside).
        var p = window.doraOpenSubIdentityModal(id);
        var reopenLink = function() {
            var stillExists = (_doraTree.subcontractors || []).some(function(s) { return s.id === id; });
            window.doraOpenSubcontractorModal(arrangementId, null, stillExists ? id : "");
        };
        if (p && typeof p.then === "function") {
            p.then(reopenLink, reopenLink);
        } else {
            // Defensive fallback if doraOpenSubIdentityModal returns undefined
            // (e.g. ct_modal not loaded). Skip the chain rather than poll.
            reopenLink();
        }
    }, 60);
};

window.doraPatchSub = function(subId, field, value) {
    var r = (_doraTree.subcontractors || []).find(function(x) { return x.id === subId; });
    if (r) r[field] = value;
    var f = {}; f[field] = value;
    _persist("dora_subcontractor", subId, f);
};

window.doraDelSub = function(subId) {
    if (!confirm(_doraT("dora.subs.delete_confirm", "Delete this subcontractor and unlink it from every arrangement?"))) return;
    _doraTree.subcontractors = (_doraTree.subcontractors || []).filter(function(x) { return x.id !== subId; });
    _doraTree.subcontractor_links = (_doraTree.subcontractor_links || []).filter(function(l) { return l.subcontractor_id !== subId; });
    // Also drop from per-arrangement embedded lists.
    (_doraTree.arrangements || []).forEach(function(a) {
        if (a.subcontractor_links) {
            a.subcontractor_links = a.subcontractor_links.filter(function(l) { return l.subcontractor_id !== subId; });
        }
    });
    _persistDelete("dora_subcontractor", subId);
    _render(document.getElementById("dora-root"));
};

// Per-link patch helpers (junction CRUD). cid = "{arrangement_id}/{sub_id}"
window.doraPatchSubLink = function(cid, field, value) {
    var p = cid.split("/"); var aid = p[0], sid = p[1];
    var l = (_doraTree.subcontractor_links || []).find(function(x) { return x.arrangement_id === aid && x.subcontractor_id === sid; });
    if (l) l[field] = value;
    var f = {}; f[field] = value;
    _persist("dora_sub_link", cid, f);
};

window.doraPatchSubLinkBool = function(cid, field, evt, el) {
    window.doraPatchSubLink(cid, field, !!el.checked);
};

window.doraPatchSubLinkNum = function(cid, field, value) {
    var v = value === "" ? null : parseInt(value, 10);
    window.doraPatchSubLink(cid, field, v);
};

window.doraUnlinkSub = function(cid) {
    var p = cid.split("/"); var aid = p[0], sid = p[1];
    _doraTree.subcontractor_links = (_doraTree.subcontractor_links || []).filter(function(x) { return !(x.arrangement_id === aid && x.subcontractor_id === sid); });
    var a = (_doraTree.arrangements || []).find(function(x) { return x.id === aid; });
    if (a && a.subcontractor_links) {
        a.subcontractor_links = a.subcontractor_links.filter(function(x) { return x.subcontractor_id !== sid; });
    }
    _persistDelete("dora_sub_link", cid);
    _render(document.getElementById("dora-root"));
};

window.doraLinkSub = function(arrangementId, subId, perLinkFields) {
    perLinkFields = perLinkFields || {};
    var row = Object.assign({
        arrangement_id: arrangementId,
        subcontractor_id: subId,
        sort_order: 0,
        tier: 1,
        service_provided: "",
        is_critical_function_support: false,
        parent_subcontractor_id: null
    }, perLinkFields);
    _doraTree.subcontractor_links = _doraTree.subcontractor_links || [];
    _doraTree.subcontractor_links.push(row);
    // Note: per-arrangement shadow array `a.subcontractor_links` is no longer
    // maintained — the canonical list lives on _doraTree, the export reads
    // it exclusively, and DoraData.subcontractorsForVendor / arrangementsForSubcontractor
    // already query the canonical list. Avoiding the shadow prevents silent
    // divergence under shared object references.
    _persistCreate("dora_sub_link", row);
};

// ── Export ───────────────────────────────────────────────────────

// Default reporting period: any RFE that already has one wins, otherwise
// the current calendar year as YYYY-12-31 (EBA RT.01.01 format).
function _doraDefaultReportingPeriod() {
    var rfes = (_doraTree && _doraTree.entities) || [];
    for (var i = 0; i < rfes.length; i++) {
        if (rfes[i].reporting_period) return rfes[i].reporting_period;
    }
    return new Date().getFullYear() + "-12-31";
}

// Open the DORA export modal. Triggered from the File menu — collects
// the reporting period and target currency, persists the reporting
// period on every declarant entity (the EBA model attaches it per RFE)
// then triggers the XLSX download. Available even when the DORA panel
// is not the active view: ensures the tree and codelists are loaded
// first via DoraData.ensureLoaded().
window.doraOpenExportModal = function() {
    // Opensource: single-doc app — D is the project. Guard on D.dora presence.
    if (typeof D === "undefined" || !D || !D.dora) {
        if (typeof showStatus === "function") {
            showStatus(_doraT("dora.no_project", "Open or create a project first."));
        }
        return;
    }
    var open = function() {
        var currencies = (_doraCodelists && _doraCodelists.currency_iso4217) || ["EUR","USD","GBP"];
        var rp = _doraDefaultReportingPeriod();
        var body = '<p class="panel-desc" style="margin:0 0 12px">'
                 + _esc(_doraT("dora.export.modal_intro", "Génère un classeur XLSX au format EBA RoI ITS (un onglet par table B_xx). La période de reporting est enregistrée sur chaque entité déclarante avant export."))
                 + '</p>';
        body += '<div class="form-row">'
              +   '<label>' + _esc(_doraT("dora.export.reporting_period", "Période de reporting")) + '</label>'
              +   '<input id="dora-export-rp" value="' + _esc(rp) + '" placeholder="' + new Date().getFullYear() + '-12-31" maxlength="10" style="width:140px;font-family:monospace">'
              + '</div>';
        body += '<div class="form-row">'
              +   '<label>' + _esc(_doraT("dora.export.target_currency", "Devise cible")) + '</label>'
              +   '<select id="dora-export-cur" style="width:120px">';
        currencies.forEach(function(c) {
            var code = c && c.code !== undefined ? c.code : c;
            body += '<option value="' + _esc(code) + '"' + (_doraExportCurrency === code ? " selected" : "") + '>' + _esc(code) + '</option>';
        });
        body += '</select></div>';
        body += '<p style="margin-top:10px;font-size:0.85em;color:var(--text-muted)">'
              + _esc(_doraT("dora.export.note", "Les accords contractuels en devises étrangères sont conservés dans leur devise d'origine — une colonne normalisée fournit la conversion vers la devise cible."))
              + '</p>';
        window.ct_modal.open({
            title: _doraT("dora.export.modal_title", "Export RoI DORA"),
            body: body,
            size: "md",
            buttons: [
                { id: "cancel", label: _doraT("btn_cancel", "Annuler") },
                { id: "ok", label: _doraT("dora.export.download", "Télécharger XLSX"), primary: true, result: function() {
                    var sel = document.getElementById("dora-export-cur");
                    if (sel) _doraExportCurrency = sel.value;
                    var rpInput = document.getElementById("dora-export-rp");
                    var rpVal = rpInput ? (rpInput.value || "").trim() : "";
                    if (rpVal && !/^\d{4}-12-31$/.test(rpVal)) {
                        showStatus(_doraT("dora.export.bad_period", "La période doit être au format YYYY-12-31."));
                        return false; // keep modal open
                    }
                    var trigger = function() {
                        // Opensource: ExcelJS-based EBA export is implemented in Phase 6.
                        if (typeof window._doraExportEBA === "function") {
                            window._doraExportEBA(_doraTree, _doraCodelists, _doraExportCurrency);
                        } else {
                            showStatus(_doraT("dora.export.pending", "Export EBA RoI : module non chargé."));
                        }
                    };
                    if (rpVal) {
                        (_doraTree.entities || []).forEach(function(r) {
                            if (r.reporting_period !== rpVal) {
                                r.reporting_period = rpVal;
                                _persist("dora_entity", r.id, { reporting_period: rpVal });
                            }
                        });
                    }
                    trigger();
                    return "ok";
                }}
            ]
        });
    };
    if (_doraTree && _doraCodelists) { open(); return; }
    window.DoraData.ensureLoaded(function(tree) {
        if (!tree) {
            showStatus(_doraT("dora.export.load_error", "Impossible de charger les données DORA."));
            return;
        }
        open();
    });
};

// ── Edit modals (arrangements + subcontractors) ─────────────────
// Built on top of ct_modal.open() — collects values on save and
// routes them through _persist / _persistCreate so persistence stays
// granular per entity.

// Item-list builders for ctRefSelect-based searchable dropdowns.
// Each returns [{id, label}] tuples suitable for ctRefSelect.

// Returns the translated label for an ITS code if a `dora.cl.{key}.{code}`
// i18n entry exists; otherwise falls back to the JSON label, then the code.
// The stored / exported value is always the ITS code — only the display
// is localised.
function _doraCodeI18n(key, code, jsonLabel) {
    if (!code) return jsonLabel || "";
    var i18nKey = "dora.cl." + key + "." + code;
    var translated = (typeof t === "function") ? t(i18nKey) : null;
    if (translated && translated !== i18nKey) return translated;
    return jsonLabel || code;
}

function _doraCodeItems(key) {
    var items = (_doraCodelists && _doraCodelists[key]) || [];
    return items.map(function(it) {
        var code = it.code !== undefined ? it.code : it;
        var label = it.label !== undefined ? it.label : it;
        return { id: String(code), label: _doraCodeI18n(key, String(code), String(label)) };
    });
}

function _doraCodeLabel(key, code) {
    if (!code) return "";
    var items = (_doraCodelists && _doraCodelists[key]) || [];
    var jsonLabel = code;
    for (var i = 0; i < items.length; i++) {
        if (String(items[i].code) === String(code)) { jsonLabel = items[i].label || code; break; }
    }
    return _doraCodeI18n(key, String(code), jsonLabel);
}

function _doraCurrencyItems() {
    var currencies = (_doraCodelists && _doraCodelists.currency_iso4217) || ["EUR"];
    return currencies.map(function(c) {
        var code = c.code !== undefined ? c.code : c;
        var label = c.label !== undefined ? c.label : c;
        return { id: String(code), label: String(label) };
    });
}

function _doraVendorItems() {
    var vendors = (window.D && D.vendors) || [];
    return vendors.map(function(v) {
        var label = (v.name || v.id) + (v.lei ? " · " + v.lei : "") + (v.country_iso2 ? " · " + v.country_iso2 : "");
        return { id: v.id, label: label };
    });
}

function _doraFunctionItems() {
    var fns = _doraTree.functions || [];
    return fns.map(function(f) {
        return { id: f.id, label: (f.name || f.id) + (f.is_critical_or_important ? " ★" : "") };
    });
}

function _doraRfeItems() {
    var ents = _doraTree.entities || [];
    return ents.map(function(e) { return { id: e.id, label: e.name || e.legal_name || e.id }; });
}

// Read the currently selected value(s) from a ctRefSelect dropdown.
function _doraRefValue(uid) {
    var dd = document.getElementById(uid + "-dd");
    if (!dd) return "";
    var c = dd.querySelector("input:checked");
    return c ? c.value : "";
}

function _doraRefValues(uid) {
    var dd = document.getElementById(uid + "-dd");
    if (!dd) return [];
    var out = [];
    dd.querySelectorAll("input:checked").forEach(function(c) { out.push(c.value); });
    return out;
}

// Manually refresh the tags strip after a programmatic uncheck (no shared
// internal access — we rebuild the strip ourselves).
function _doraRefRefreshTags(uid, items, emptyText) {
    var wrap = document.getElementById(uid);
    var dd = document.getElementById(uid + "-dd");
    if (!wrap || !dd) return;
    var tagsEl = wrap.querySelector(".ref-tags");
    if (!tagsEl) return;
    var ids = [];
    dd.querySelectorAll("input:checked").forEach(function(c) { ids.push(c.value); });
    if (ids.length === 0) {
        tagsEl.innerHTML = '<span class="text-muted fs-xs">' + _esc(emptyText || "—") + '</span>';
        return;
    }
    var html = "";
    ids.forEach(function(id) {
        var m = items.find(function(x) { return x.id === id; });
        var disp = m ? _esc(id + " - " + m.label) : _esc(id);
        html += '<span class="ref-tag">' + disp + '<span class="ref-tag-x" data-click="ctRefRemove" data-args=\'' + _da(uid, id) + '\' data-stop>x</span></span>';
    });
    tagsEl.innerHTML = html;
}

// Build a searchable dropdown (single or multi-select) from an items list.
// Registers callbacks so the "x" on tags clears the underlying input and
// refreshes the tags strip without needing a full panel re-render.
function _doraRefSelect(uid, current, items, opts) {
    opts = opts || {};
    if (typeof window.ctRefRegister !== "function" || typeof window.ctRefSelect !== "function") {
        // Fallback: native <select> (degraded mode if ct_refselect not loaded).
        var html = '<select id="' + _esc(uid) + (opts.multi ? '" multiple' : '"') + '>';
        if (!opts.multi) html += '<option value=""></option>';
        var picks = (current || "").split(",").map(function(s) { return s.trim(); });
        items.forEach(function(it) {
            var sel = (opts.multi ? picks.indexOf(it.id) >= 0 : current === it.id) ? " selected" : "";
            html += '<option value="' + _esc(it.id) + '"' + sel + '>' + _esc(it.label) + '</option>';
        });
        html += '</select>';
        return html;
    }
    var emptyText = opts.emptyText || "—";
    var hideId = !!opts.hideId;
    window.ctRefRegister(uid, {
        single: !opts.multi,
        emptyText: emptyText,
        hideId: hideId,
        labelFor: function(id) { var m = items.find(function(x) { return x.id === id; }); return m ? m.label : ""; },
        onToggle: opts.onToggle || function() {},
        onRemove: function(u, optId) {
            // Clear the underlying input and rebuild the tags strip.
            var dd = document.getElementById(u + "-dd");
            if (dd) {
                var inps = dd.querySelectorAll('input[value]');
                for (var i = 0; i < inps.length; i++) {
                    if (inps[i].value === optId) { inps[i].checked = false; break; }
                }
            }
            _doraRefRefreshTags(u, items, emptyText);
            if (opts.onRemove) opts.onRemove(u, optId);
        },
        onFlush: opts.onFlush || function() {}
    });
    return window.ctRefSelect(uid, current || "", items, {
        single: !opts.multi,
        placeholder: opts.placeholder || _doraT("dora.modal.search_ph", "Search…"),
        emptyText: emptyText,
        hideId: hideId
    });
}

// Open the full DORA function modal (RTO, RPO, business line, criticality
// rationale, impact tolerance description, LoU code). When called from the
// arrangement modal via doraOpenFunctionModalForArr, the saved function is
// auto-selected in the arr-fn multi-pick and the user lands back on the
// arrangement modal.
window.doraOpenFunctionModal = function(functionId, opts) {
    if (typeof window.ct_modal === "undefined") return;
    opts = opts || {};
    var isNew = !functionId;
    var f = isNew
        ? {
            id: _newId("FN"),
            code: "",
            sort_order: (_doraTree.functions || []).length,
            name: opts.prefillName || "",
            description: "",
            is_critical_or_important: false,
            criticality_rationale: "",
            business_line: "",
            recovery_time_objective_h: null,
            recovery_point_objective_h: null,
            impact_tolerance_description: ""
        }
        : ((_doraTree.functions || []).find(function(x) { return x.id === functionId; }) || null);
    if (!f) return;

    function _fld(label, controlHtml, span) {
        return '<div' + (span ? ' style="grid-column:span ' + span + '"' : '') + '><div style="margin-bottom:2px">' + label + '</div>' + controlHtml + '</div>';
    }
    var bodyHtml = ''
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:0.9em">'
        + _fld(_doraT("dora.fn.code", "Function identifier (B_06.01.0010)"), '<input id="fn-code" value="' + _esc(f.code || "") + '" maxlength="50" pattern="[A-Za-z0-9_\\-]{1,50}" placeholder="' + _esc(_doraT("dora.fn.code_placeholder", "Free identifier, e.g. F-PAY-001")) + '" style="width:100%">', 2)
        + _fld(_doraT("dora.fn.name", "Function name (B_06.01.0030)"), '<input id="fn-name" value="' + _esc(f.name || "") + '" required style="width:100%">', 2)
        + _fld(_doraT("dora.fn.description", "Description"), '<textarea id="fn-desc" rows="2" style="width:100%">' + _esc(f.description || "") + '</textarea>', 2)
        + '<label style="grid-column:span 2;display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="fn-crit"' + (f.is_critical_or_important ? " checked" : "") + '> ' + _doraT("dora.fn.critical", "Critical or important function (B_06.01.0050)") + '</label>'
        + _fld(_doraT("dora.fn.crit_rationale", "Reasons for criticality or importance (B_06.01.0060)"), '<textarea id="fn-crit-rat" rows="2" style="width:100%">' + _esc(f.criticality_rationale || "") + '</textarea>', 2)
        + _fld(_doraT("dora.fn.business_line", "Licenced activity / Business line (B_06.01.0020)"), _doraRefSelect("fn-bl", f.business_line, _doraCodeItems("licenced_activity")))
        + _fld(_doraT("dora.fn.rto", "RTO hours (B_06.01.0080)"), '<input id="fn-rto" type="number" step="0.5" value="' + _esc(f.recovery_time_objective_h != null ? f.recovery_time_objective_h : "") + '" style="width:100%">')
        + _fld(_doraT("dora.fn.rpo", "RPO hours (B_06.01.0090)"), '<input id="fn-rpo" type="number" step="0.5" value="' + _esc(f.recovery_point_objective_h != null ? f.recovery_point_objective_h : "") + '" style="width:100%">')
        + _fld(_doraT("dora.fn.impact_tolerance", "Impact of discontinuing the function (B_06.01.0100)"), _doraRefSelect("fn-impact", f.impact_tolerance_description, _doraCodeItems("impact_level")), 2)
        + _fld(_doraT("dora.fn.last_assessment", "Date of last assessment (B_06.01.0070)"), '<input id="fn-last-assess" type="date" value="' + _esc(f.last_assessment_date || "") + '" style="width:100%">')
        + '</div>';

    function _v(id) { var el = document.getElementById(id); return el ? el.value : ""; }
    function _b(id) { var el = document.getElementById(id); return el ? !!el.checked : false; }
    function _n(v) { return v === "" || v == null ? null : Number(v); }

    var buttons = [{ id: "cancel", label: _doraT("btn_cancel", "Cancel") }];
    if (!isNew) {
        buttons.push({ id: "delete", label: _doraT("btn_delete", "Delete"), danger: true, result: function() {
            if (!window.confirm(_doraT("dora.fn.confirm_delete", "Delete this function?"))) return false;
            _doraTree.functions = (_doraTree.functions || []).filter(function(x) { return x.id !== f.id; });
            _persistDelete("dora_function", f.id);
            var host = document.getElementById("dora-root");
            if (host) _render(host);
            return "deleted";
        }});
    }
    buttons.push({ id: "save", label: _doraT("btn_save", "Save"), primary: true, result: function() {
        var name = _v("fn-name").trim();
        if (!name) { showStatus(_doraT("dora.fn.name_required", "Function name is required.")); return false; }
        var code = _v("fn-code").trim();
        if (code && !/^[A-Za-z0-9_\-]{1,50}$/.test(code)) {
            showStatus(_doraT("dora.fn.code_invalid", "Function identifier must contain only letters, digits, _ or - (max 50 chars)."));
            return false;
        }
        var data = {
            code: code,
            name: name,
            description: _v("fn-desc"),
            is_critical_or_important: _b("fn-crit"),
            criticality_rationale: _v("fn-crit-rat"),
            business_line: _doraRefValue("fn-bl"),
            recovery_time_objective_h: _n(_v("fn-rto")),
            recovery_point_objective_h: _n(_v("fn-rpo")),
            impact_tolerance_description: _doraRefValue("fn-impact"),
            last_assessment_date: _v("fn-last-assess") || null
        };
        if (isNew) {
            var row = Object.assign({ id: f.id, sort_order: f.sort_order }, data);
            _doraTree.functions = _doraTree.functions || [];
            _doraTree.functions.push(row);
            _persistCreate("dora_function", row);
            // Stash the created id so the caller (e.g. doraOpenFunctionModalForArr)
            // can auto-select the new function when reopening its parent modal.
            window._doraFnCreatedId = row.id;
            // Auto-select in the parent arrangement picker if it's still open
            // (no-op when we're stacked on top of a closed parent modal).
            var slot = document.getElementById("arr-fn-slot");
            if (slot) {
                var existing = _doraRefValues("arr-fn") || [];
                if (existing.indexOf(row.id) === -1) existing.push(row.id);
                slot.innerHTML = _doraRefSelect("arr-fn", existing.join(","), _doraFunctionItems(), { multi: true });
            }
        } else {
            Object.assign(f, data);
            _persist("dora_function", f.id, data);
            // Re-render the parent picker to reflect the new label/criticality.
            var slot2 = document.getElementById("arr-fn-slot");
            if (slot2) {
                var current = _doraRefValues("arr-fn") || [];
                slot2.innerHTML = _doraRefSelect("arr-fn", current.join(","), _doraFunctionItems(), { multi: true });
            }
        }
        var host = document.getElementById("dora-root");
        if (host) _render(host);
        return "saved";
    }});

    return window.ct_modal.open({
        title: isNew ? _doraT("dora.fn.title_new", "New function") : _doraT("dora.fn.title_edit", "Edit function"),
        body: bodyHtml,
        size: "lg",
        buttons: buttons
    });
};

// Wrapper invoked from the arrangement modal "+ New function" button.
// Always opens in create mode; on save/cancel, the arrangement modal is
// reopened with the user's in-progress edits preserved (and the newly
// created function auto-selected in arr-fn).
window.doraOpenFunctionModalForArr = function() {
    var ctx = window._doraArrEditCtx;
    if (!ctx) {
        window.doraOpenFunctionModal(null);
        return;
    }
    // Snapshot the in-progress arrangement form before ct_modal.open
    // closes the arrangement modal silently.
    var snapshot = null;
    try { if (typeof ctx.collect === "function") snapshot = ctx.collect(); }
    catch (e) { snapshot = null; }
    var savedCtx = {
        arrangementId: ctx.arrangementId,
        inProgressId: ctx.inProgressId,
        vendorIdHint: ctx.vendorIdHint,
        lockVendor: ctx.lockVendor,
        isNew: ctx.isNew,
        snapshot: snapshot
    };
    window._doraFnCreatedId = null;
    var p = window.doraOpenFunctionModal(null);
    function _reopenArr() {
        var prefill = savedCtx.snapshot ? Object.assign({}, savedCtx.snapshot) : null;
        if (prefill && window._doraFnCreatedId) {
            var fnIds = (prefill.function_ids || []).slice();
            if (fnIds.indexOf(window._doraFnCreatedId) === -1) fnIds.push(window._doraFnCreatedId);
            prefill.function_ids = fnIds;
        }
        if (savedCtx.isNew && savedCtx.inProgressId) {
            if (!prefill) prefill = {};
            prefill.id = savedCtx.inProgressId;
        }
        window._doraFnCreatedId = null;
        window.doraOpenArrangementModal(savedCtx.arrangementId, savedCtx.vendorIdHint, savedCtx.lockVendor, prefill);
    }
    if (p && typeof p.then === "function") {
        p.then(_reopenArr, _reopenArr);
    } else {
        // Defensive: if for some reason ct_modal didn't return a promise,
        // reopen on next tick so the user isn't stranded.
        setTimeout(_reopenArr, 0);
    }
};

// Listener for the substitutability-level dropdown: shows/hides the
// "reason" sub-dropdown per ITS B.07.01.0060 (mandatory only when level
// ∈ {not_substitutable, highly_complex}).
// Kept for backwards-compatibility: the substitutability_reason slot is
// always visible now (the user couldn't discover the field when hidden).
// _collect() in the arrangement modal clears the value at save time when
// the level does not require a reason.
window.doraOnSubLvlChange = function() {};

// Tier=1 = direct subcontractor (no upstream sibling), so the parent picker
// is meaningless — hide it and clear any stale value. Re-shown for tier ≥ 2.
window.doraOnLinkTierChange = function() {
    var el = document.getElementById("link-tier");
    var slot = document.getElementById("link-parent-slot");
    if (!el || !slot) return;
    var tier = Number(el.value) || 1;
    if (tier > 1) {
        slot.style.display = "block";
    } else {
        slot.style.display = "none";
        var ref = document.getElementById("link-parent");
        if (ref && ref.dataset) ref.dataset.value = "";
        var input = document.querySelector('[data-ref-input="link-parent"]');
        if (input) input.value = "";
    }
};

// Open the arrangement edit modal. arrangementId === null → create flow.
// lockVendor === true when opened from a vendor context (vendor card / vendor RoI panel)
//   → the vendor field is rendered read-only because changing it would re-parent the
//     arrangement under another vendor, which is meaningless from inside a vendor view.
window.doraOpenArrangementModal = function(arrangementId, vendorIdHint, lockVendor, prefill) {
    if (typeof window.ct_modal === "undefined") return;
    var isNew = !arrangementId;
    var a = isNew
        ? { id: _newId("ARR"), vendor_id: vendorIdHint || "", arrangement_reference: _doraNextRef("ARR"), currency: "EUR", rfe_ids: [], function_ids: [], sort_order: (_doraTree.arrangements || []).length }
        : (_doraTree.arrangements.find(function(x) { return x.id === arrangementId; }) || null);
    if (!a) return;
    // When reopened from a child modal (e.g. function create flow), restore the
    // in-progress edits the user had typed before the sub-modal hijacked the
    // overlay. For new arrangements we also preserve the freshly-generated id
    // so we don't accidentally allocate a second arrangement.
    if (prefill && typeof prefill === "object") {
        if (isNew && prefill.id) a.id = prefill.id;
        Object.keys(prefill).forEach(function(k) {
            if (k === "id") return;
            if (prefill[k] !== undefined && prefill[k] !== null) a[k] = prefill[k];
        });
    }
    var vendorLocked = !!lockVendor && !!a.vendor_id;
    var vendorObjLocked = vendorLocked
        ? ((window.D && D.vendors) || []).find(function(v) { return v.id === a.vendor_id; })
        : null;

    function _fld(label, controlHtml, span) {
        return '<div' + (span ? ' style="grid-column:span ' + span + '"' : '') + '><div style="margin-bottom:2px">' + label + '</div>' + controlHtml + '</div>';
    }
    var rfeIdsCsv = (a.rfe_ids || []).join(",");

    function _section(titleKey, fallback, gridHtml) {
        return '<fieldset style="border:1px solid var(--border);border-radius:6px;padding:8px 12px 12px;margin:0 0 12px">'
             + '<legend style="padding:0 6px;font-weight:600;font-size:0.9em;color:var(--text-muted)">' + _esc(_doraT(titleKey, fallback)) + '</legend>'
             + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:0.9em">'
             + gridHtml
             + '</div></fieldset>';
    }

    // B_07.01.0060 (substitutability_reason) is always shown so users can
    // discover the field. _collect() below clears it if the level doesn't
    // require it (R: only kept for not_substitutable / highly_complex).

    // ── Section 1: Identification ──
    var sectionIdentity = ''
        + '<div><div style="margin-bottom:2px">' + _doraT("dora.modal.arr_ref", "Reference (B_02.01.0010)") + '</div><input id="arr-ref" value="' + _esc(a.arrangement_reference || "") + '" required style="width:100%"></div>'
        + _fld(_doraT("dora.modal.arr_vendor", "Vendor / TPSP (B_02.02.0030)"),
            vendorLocked
                ? '<input type="hidden" id="arr-vendor-locked" value="' + _esc(a.vendor_id) + '"><div style="padding:6px 8px;background:var(--bg-elev,#f3f3f5);border:1px solid var(--border);border-radius:4px;color:var(--text-muted)" title="' + _esc(_doraT("dora.modal.vendor_locked", "Vendor cannot be changed from a vendor context")) + '">' + _esc((vendorObjLocked && vendorObjLocked.name) || a.vendor_id) + '</div>'
                : _doraRefSelect("arr-vendor", a.vendor_id, _doraVendorItems()))
        + _fld(_doraT("dora.modal.arr_type", "Type of contractual arrangement (B_02.01.0020)"), _doraRefSelect("arr-type", a.arrangement_type, _doraCodeItems("arrangement_type")), 2);

    // ── Section 2: Scope (functions + nature) ──
    var sectionScope = ''
        + _fld(
            _doraT("dora.modal.arr_function", "Supported functions (B_02.02.0050)")
                + ' <button type="button" class="btn-add" data-click="doraOpenFunctionModalForArr" data-args=\'[null]\' style="font-size:0.8em;padding:1px 8px;margin-left:6px">+ ' + _esc(_doraT("dora.modal.arr_function_create", "New function")) + '</button>',
            '<div id="arr-fn-slot">' + _doraRefSelect("arr-fn", (a.function_ids || []).join(","), _doraFunctionItems(), { multi: true }) + '</div>'
              + '<div style="margin-top:4px;font-size:0.8em;color:var(--text-muted)">' + _esc(_doraT("dora.modal.arr_function_hint", "Pick existing functions or click + New function to declare one with full ITS fields (RTO, RPO, business line…).")) + '</div>',
            2
        )
        + _fld(
            _doraT("dora.modal.arr_services", "Type of ICT services (B_02.02.0060)"),
            _doraRefSelect("arr-services", (a.service_codes || []).join(","), _doraCodeItems("ict_service_type"), { multi: true })
              + '<div style="margin-top:4px;font-size:0.8em;color:var(--text-muted)">' + _esc(_doraT("dora.modal.arr_services_hint", "Pick one or more ICT service types — one B_02.02 row will be emitted per service.")) + '</div>',
            2
        )
        + _fld(_doraT("dora.modal.arr_rfes", "Reporting financial entities (B_02.02.0020)"), _doraRefSelect("arr-rfes", rfeIdsCsv, _doraRfeItems(), { multi: true, hideId: true }), 2);

    // ── Section 3: Lifecycle ──
    // B_02.01.0030 parent arrangement picker — only meaningful when this
    // is a "subsequent" arrangement of an overarching one. Built as a
    // plain <select> with all other project arrangements as options.
    var _otherArrs = ((window._doraTree && _doraTree.arrangements) || []).filter(function(x) { return x.id !== a.id; });
    var _parentOpts = '<option value="">—</option>' + _otherArrs.map(function(p) {
        var sel = (a.parent_arrangement_id === p.id) ? " selected" : "";
        var lab = (p.arrangement_reference || p.id);
        return '<option value="' + _esc(p.id) + '"' + sel + '>' + _esc(lab) + '</option>';
    }).join("");
    var sectionLifecycle = ''
        + '<div><div style="margin-bottom:2px">' + _doraT("dora.modal.arr_start", "Start date (B_02.02.0070)") + '</div><input id="arr-start" type="date" value="' + _esc(a.start_date || "") + '" style="width:100%"></div>'
        + '<div><div style="margin-bottom:2px">' + _doraT("dora.modal.arr_end", "End date (B_02.02.0080)") + '</div><input id="arr-end" type="date" value="' + _esc(a.end_date || "") + '" style="width:100%"></div>'
        + '<div><div style="margin-bottom:2px">' + _doraT("dora.modal.arr_notice", "FE notice period in days (B_02.02.0100)") + '</div><input id="arr-notice" type="number" value="' + _esc(a.notice_period_days != null ? a.notice_period_days : "") + '" style="width:100%"></div>'
        + '<div><div style="margin-bottom:2px">' + _doraT("dora.modal.arr_notice_tpsp", "TPSP notice period in days (B_02.02.0110)") + '</div><input id="arr-notice-tpsp" type="number" value="' + _esc(a.notice_period_tpsp_days != null ? a.notice_period_tpsp_days : "") + '" style="width:100%"></div>'
        + '<div><div style="margin-bottom:2px">' + _doraT("dora.modal.arr_last_audit", "Last audit (B_07.01.0070)") + '</div><input id="arr-audit" type="date" value="' + _esc(a.last_audit_date || "") + '" style="width:100%"></div>'
        + _fld(_doraT("dora.modal.arr_termination", "Termination reason (B_02.02.0090)"), _doraRefSelect("arr-term", a.termination_reason, _doraCodeItems("termination_reason")))
        + _fld(_doraT("dora.modal.arr_parent", "Overarching arrangement (B_02.01.0030)"), '<select id="arr-parent" style="width:100%">' + _parentOpts + '</select>', 2)
        + _fld(_doraT("dora.modal.arr_gov", "Governing law country (B_02.02.0120)"), _doraRefSelect("arr-gov", a.governing_law_country, _doraCodeItems("country_iso3166_1")))
        + _fld(_doraT("dora.modal.arr_juris", "Country of provision of the ICT services (B_02.02.0130)"), _doraRefSelect("arr-juris", a.jurisdiction_country, _doraCodeItems("country_iso3166_1")));

    // ── Section 4: Cost & data ──
    var sectionCostData = ''
        + '<div><div style="margin-bottom:2px">' + _doraT("dora.modal.arr_cost", "Annual cost (B_02.01.0050)") + '</div><input id="arr-cost" type="number" step="0.01" value="' + _esc(a.annual_cost_amount != null ? a.annual_cost_amount : "") + '" style="width:100%"></div>'
        + _fld(_doraT("dora.modal.arr_currency", "Currency (B_02.01.0040)"), _doraRefSelect("arr-currency", a.currency || "EUR", _doraCurrencyItems()))
        + _fld(_doraT("dora.modal.arr_reliance", "Level of reliance (B_02.02.0180)"), _doraRefSelect("arr-reliance", a.reliance_level, _doraCodeItems("reliance_level")))
        + _fld(_doraT("dora.modal.arr_sensitivity", "Data sensitivity (B_02.02.0170)"), _doraRefSelect("arr-sens", a.data_sensitivity, _doraCodeItems("data_sensitivity")))
        + _fld(_doraT("dora.modal.arr_storage", "Data storage country (B_02.02.0150)"), _doraRefSelect("arr-storage", a.data_storage_country, _doraCodeItems("country_iso3166_1")))
        + _fld(_doraT("dora.modal.arr_processing", "Data processing country (B_02.02.0160)"), _doraRefSelect("arr-processing", a.data_processing_country, _doraCodeItems("country_iso3166_1")));

    // ── Section 5: Substitutability & exit (ITS B.07.01) ──
    var sectionSubsExit = ''
        + _fld(_doraT("dora.modal.arr_substitutability", "Substitutability of the TPP (B_07.01.0050)"), _doraRefSelect("arr-sub-lvl", a.substitutability_level, _doraCodeItems("substitutability")))
        + _fld(_doraT("dora.modal.arr_reintegration", "Possibility of reintegration (B_07.01.0090)"), _doraRefSelect("arr-reint-lvl", a.reintegration_level, _doraCodeItems("reintegration_level")))
        + '<div id="arr-sub-rsn-slot" style="grid-column:span 2">'
        +   '<div style="margin-bottom:2px">' + _doraT("dora.modal.arr_substitutability_reason", "Reason if non/hard substitutable (B_07.01.0060)") + '</div>'
        +   _doraRefSelect("arr-sub-rsn", a.substitutability_reason, _doraCodeItems("substitutability_reason"))
        +   '<div style="margin-top:4px;font-size:0.8em;color:var(--text-muted)">' + _esc(_doraT("dora.modal.arr_substitutability_reason_hint", "Exporté uniquement si le niveau ci-dessus est « non substituable » ou « hautement complexe ».")) + '</div>'
        + '</div>'
        + _fld(_doraT("dora.modal.arr_impact", "Impact of discontinuing (B_07.01.0100)"), _doraRefSelect("arr-impact", a.impact_discontinuing_level, _doraCodeItems("impact_level")))
        + _fld(_doraT("dora.modal.arr_alt_tpp", "Identification of alternative ICT TPP (B_07.01.0110/0120)"), '<input id="arr-alt-tpp" value="' + _esc(a.alternative_tpp_id || "") + '" placeholder="' + _esc(_doraT("dora.modal.arr_alt_tpp_ph", "LEI or name — leave empty if none identified")) + '" style="width:100%">')
        + '<label style="grid-column:span 2;display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="arr-exit"' + (a.exit_strategy_documented ? " checked" : "") + '> ' + _doraT("dora.modal.arr_exit", "Exit plan documented (B_07.01.0080)") + '</label>';

    // ── Section 1bis: Signers (B_03.03) ──
    // Determine the initial mode from the existing signer rows attached
    // to this arrangement: if there is exactly one and it mirrors the
    // vendor identity → vendor_self; otherwise → other (the most common
    // case, including "no signer yet").
    var existingSignersForArr = (_doraTree.signers || []).filter(function(s) { return s.arrangement_id === a.id; });
    var vendorObjForSigner = vendorObjLocked
        || ((window.D && D.vendors) || []).find(function(v) { return v.id === a.vendor_id; })
        || null;
    var initialMode = "other";
    if (existingSignersForArr.length === 1 && _doraIsVendorSelfSigner(existingSignersForArr[0], vendorObjForSigner)) {
        initialMode = "vendor_self";
    }
    var modeRadios = ''
        + '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:18px">'
        +   '<input type="radio" name="arr-signer-mode" value="vendor_self"'
        +     (initialMode === "vendor_self" ? " checked" : "")
        +     ' data-change="doraOnSignerModeChange" data-args=\'["' + _esc(a.id) + '"]\'>'
        +   _esc(_doraT("dora.modal.signer_mode_self", "PSTI signs in its own name")) + '</label>'
        + '<label style="display:inline-flex;align-items:center;gap:6px">'
        +   '<input type="radio" name="arr-signer-mode" value="other"'
        +     (initialMode === "other" ? " checked" : "")
        +     ' data-change="doraOnSignerModeChange" data-args=\'["' + _esc(a.id) + '"]\'>'
        +   _esc(_doraT("dora.modal.signer_mode_other", "Another entity signs")) + '</label>';
    var sectionSignersBody = '<div style="grid-column:span 2">'
        + '<div style="margin-bottom:8px">' + modeRadios + '</div>'
        + '<div id="arr-signer-slot">' + (isNew && initialMode !== "vendor_self"
            ? '<div style="color:var(--text-muted);font-size:0.85em;padding:6px 0">'
              + _esc(_doraT("dora.modal.signer_save_first", "Save the arrangement first to attach signers."))
              + '</div>'
            : _doraRenderArrSignerSlot(a.id, initialMode))
        + '</div></div>';

    var bodyHtml = ''
        + _section("dora.modal.arr_section_identity", "Identification", sectionIdentity)
        + _section("dora.modal.arr_section_signers", "Signataires (B_03.03)", sectionSignersBody)
        + _section("dora.modal.arr_section_scope", "Scope", sectionScope)
        + _section("dora.modal.arr_section_lifecycle", "Lifecycle", sectionLifecycle)
        + _section("dora.modal.arr_section_costdata", "Cost & data", sectionCostData)
        + _section("dora.modal.arr_section_subsexit", "Substitutability & exit", sectionSubsExit);

    // ── Linked subcontractors (junction) — only on existing arrangements ──
    if (!isNew) {
        var arrLinks = (_doraTree.subcontractor_links || []).filter(function(x) { return x.arrangement_id === a.id; });
        var subByIdLocal = {}; (_doraTree.subcontractors || []).forEach(function(s) { subByIdLocal[s.id] = s; });
        var linksTbl = '';
        if (arrLinks.length === 0) {
            linksTbl = '<div style="color:var(--text-muted);font-size:0.9em;padding:6px 0">' + _doraT("dora.modal.arr_no_subs", "No subcontractors linked yet.") + '</div>';
        } else {
            linksTbl = '<table class="ct-table" style="width:100%;font-size:0.9em;margin-top:6px"><thead><tr>'
                     + '<th>' + _doraT("dora.subs.name", "Name") + '</th>'
                     + '<th>' + _doraT("dora.subs.tier", "Tier") + '</th>'
                     + '<th>' + _doraT("dora.subs.service", "Service") + '</th>'
                     + '<th>' + _doraT("dora.modal.arr_sub_critical_short", "CIF") + '</th>'
                     + '<th></th>'
                     + '</tr></thead><tbody>';
            arrLinks.forEach(function(lk) {
                var sId = subByIdLocal[lk.subcontractor_id] || { name: lk.subcontractor_id };
                linksTbl += '<tr>'
                          + '<td>' + _esc(sId.name || lk.subcontractor_id) + '</td>'
                          + '<td>' + _esc(lk.tier || 1) + '</td>'
                          + '<td>' + _esc(_doraCodeLabel("ict_service_type", lk.service_provided) || lk.service_provided || "") + '</td>'
                          + '<td>' + (lk.is_critical_function_support ? "✓" : "") + '</td>'
                          + '<td><button class="btn-secondary" data-click="doraOpenSubcontractorModal" data-args=\'["' + _esc(a.id) + '","' + _esc(lk.subcontractor_id) + '"]\' title="' + _esc(_doraT("dora.byvendor.edit", "Edit")) + '">✎</button></td>'
                          + '</tr>';
            });
            linksTbl += '</tbody></table>';
        }
        bodyHtml += '<hr style="margin:14px 0;border:none;border-top:1px solid var(--border)">'
                  + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
                  + '  <strong>' + _doraT("dora.modal.arr_linked_subs", "Linked subcontractors") + '</strong>'
                  + '  <button type="button" class="btn-add" data-click="doraOpenSubcontractorModal" data-args=\'["' + _esc(a.id) + '",null]\'>+ ' + _doraT("dora.modal.arr_link_sub", "Link a subcontractor") + '</button>'
                  + '</div>'
                  + linksTbl;
    }

    function _collect() {
        function _v(id) { var el = document.getElementById(id); return el ? el.value : ""; }
        function _b(id) { var el = document.getElementById(id); return el ? !!el.checked : false; }
        function _nFromV(v) { return v === "" || v == null ? null : Number(v); }
        var subLvl = _doraRefValue("arr-sub-lvl") || "";
        var reintLvl = _doraRefValue("arr-reint-lvl") || "";
        var subRsn = _doraRefValue("arr-sub-rsn") || "";
        // R: substitutability_reason only kept when level requires it.
        if (subLvl !== "not_substitutable" && subLvl !== "highly_complex") subRsn = "";
        return {
            arrangement_reference: _v("arr-ref"),
            vendor_id: vendorLocked ? a.vendor_id : _doraRefValue("arr-vendor"),
            arrangement_type: _doraRefValue("arr-type"),
            function_ids: _doraRefValues("arr-fn"),
            // is_critical_function_support is server-derived from linked
            // functions; do not send a client value.
            start_date: _v("arr-start"),
            end_date: _v("arr-end"),
            notice_period_days: _nFromV(_v("arr-notice")),
            notice_period_tpsp_days: _nFromV(_v("arr-notice-tpsp")),
            termination_reason: _doraRefValue("arr-term") || null,
            parent_arrangement_id: _v("arr-parent") || null,
            last_audit_date: _v("arr-audit"),
            governing_law_country: _doraRefValue("arr-gov"),
            jurisdiction_country: _doraRefValue("arr-juris"),
            annual_cost_amount: _nFromV(_v("arr-cost")),
            currency: _doraRefValue("arr-currency") || "EUR",
            reliance_level: _doraRefValue("arr-reliance") || null,
            service_codes: _doraRefValues("arr-services"),
            data_sensitivity: _doraRefValue("arr-sens"),
            data_storage_country: _doraRefValue("arr-storage"),
            data_processing_country: _doraRefValue("arr-processing"),
            substitutability_level: subLvl,
            substitutability_reason: subRsn,
            reintegration_level: reintLvl,
            impact_discontinuing_level: _doraRefValue("arr-impact") || null,
            alternative_tpp_id: _v("arr-alt-tpp") || null,
            exit_strategy_documented: _b("arr-exit"),
            rfe_ids: _doraRefValues("arr-rfes")
        };
    }

    // Expose the in-progress edit context so child modals (e.g. the
    // "+ New function" flow) can snapshot the form before being opened
    // and reopen the arrangement modal afterwards with values preserved.
    window._doraArrEditCtx = {
        arrangementId: arrangementId,
        inProgressId: a.id,
        vendorIdHint: vendorIdHint,
        lockVendor: lockVendor,
        isNew: isNew,
        collect: _collect
    };

    var buttons = [
        { id: "cancel", label: _doraT("btn_cancel", "Cancel") }
    ];
    if (!isNew) {
        buttons.push({ id: "delete", label: _doraT("btn_delete", "Delete"), danger: true, result: function() {
            if (!window.confirm(_doraT("dora.modal.confirm_delete", "Delete this arrangement?"))) return false;
            _doraTree.arrangements = _doraTree.arrangements.filter(function(x) { return x.id !== a.id; });
            _persistDelete("dora_arrangement", a.id);
            var host = document.getElementById("dora-root");
            if (host) _render(host);
            // Also re-render the active panel (vendor list / vendor detail) if open.
            if (typeof window.renderPanel === "function") try { window.renderPanel(); } catch (e) {}
            return "deleted";
        }});
    }
    buttons.push({ id: "save", label: _doraT("btn_save", "Save"), primary: true, result: function() {
        var data = _collect();
        if (!data.arrangement_reference || !data.vendor_id) {
            window.alert(_doraT("dora.modal.required_fields", "Reference and vendor are required."));
            return false;
        }
        var arrCreateP = null;
        if (isNew) {
            var row = Object.assign({ id: a.id, sort_order: a.sort_order }, data);
            _doraTree.arrangements.push(row);
            arrCreateP = _persistCreate("dora_arrangement", row);
        } else {
            Object.assign(a, data);
            _persist("dora_arrangement", a.id, data);
        }
        // ── Reconcile signer mode (B_03.03) ──
        var signerModeEl = document.querySelector('input[name="arr-signer-mode"]:checked');
        var signerMode = signerModeEl ? signerModeEl.value : "other";
        if (signerMode === "vendor_self") {
            var vForSign = ((window.D && D.vendors) || []).find(function(v) { return v.id === data.vendor_id; }) || null;
            var keep = (_doraTree.signers || []).filter(function(s) {
                return s.arrangement_id === a.id && _doraIsVendorSelfSigner(s, vForSign);
            });
            // If exactly one mirror row already exists, do nothing.
            // Otherwise: delete all current rows, then create one mirror.
            var current = (_doraTree.signers || []).filter(function(s) { return s.arrangement_id === a.id; });
            if (!(keep.length === 1 && current.length === 1)) {
                current.forEach(function(s) {
                    _persistDelete("dora_signer", s.arrangement_id + "/" + s.id);
                });
                _doraTree.signers = (_doraTree.signers || []).filter(function(s) { return s.arrangement_id !== a.id; });
                var mirror = _doraVendorSelfSignerRow(vForSign, a.id, 0);
                _doraTree.signers.push(mirror);
                // For new arrangements, chain the signer POST on the arrangement
                // POST promise so the FK is satisfied before the signer insert
                // (replaces a fragile setTimeout-based race window).
                if (isNew && arrCreateP && typeof arrCreateP.then === "function") {
                    arrCreateP.then(function() {
                        _persistCreate("dora_signer", mirror);
                    }, function() {
                        // Arrangement POST failed — drop the in-memory mirror
                        // so the UI reflects backend state on next render.
                        _doraTree.signers = (_doraTree.signers || []).filter(function(s) {
                            return !(s.arrangement_id === mirror.arrangement_id && s.id === mirror.id);
                        });
                    });
                } else {
                    _persistCreate("dora_signer", mirror);
                }
            }
        }
        var host = document.getElementById("dora-root");
        if (host) _render(host);
        if (typeof window.renderPanel === "function") try { window.renderPanel(); } catch (e) {}
        return "saved";
    }});

    window.ct_modal.open({
        title: isNew
            ? _doraT("dora.modal.arr_title_new", "New contractual arrangement")
            : _doraT("dora.modal.arr_title_edit", "Edit contractual arrangement"),
        body: bodyHtml,
        size: "lg",
        buttons: buttons
    });
};

// Open the global subcontractor IDENTITY modal (project-wide entity).
// Edits identity fields only (name, LEI, country, sector). The list of
// arrangements where this sub appears is shown read-only — to add/remove
// links, use the arrangement modal's "Linked subcontractors" block.
window.doraOpenSubIdentityModal = function(subId) {
    if (typeof window.ct_modal === "undefined") return;
    var s = (_doraTree.subcontractors || []).find(function(x) { return x.id === subId; });
    if (!s) return;
    function _fld(label, controlHtml, span) {
        return '<div' + (span ? ' style="grid-column:span ' + span + '"' : '') + '><div style="margin-bottom:2px">' + label + '</div>' + controlHtml + '</div>';
    }
    // Build read-only "Linked arrangements" listing.
    var links = window.DoraData.arrangementsForSubcontractor(s.id);
    var arrById = {}; (_doraTree.arrangements || []).forEach(function(a) { arrById[a.id] = a; });
    var vById = {}; ((window.D && D.vendors) || []).forEach(function(v) { vById[v.id] = v; });
    var linksHtml = '';
    if (links.length === 0) {
        linksHtml = '<div style="color:var(--text-muted);font-size:0.9em">' + _doraT("dora.subs.no_links_hint", "Not linked to any arrangement yet. Open an arrangement and use its Subcontractors block to link this entity.") + '</div>';
    } else {
        linksHtml = '<table class="ct-table" style="width:100%;font-size:0.9em"><thead><tr>'
                  + '<th>' + _doraT("dora.subs.linked_vendor", "Vendor") + '</th>'
                  + '<th>' + _doraT("dora.subs.linked_arr", "Arrangement") + '</th>'
                  + '<th>' + _doraT("dora.subs.tier", "Tier") + '</th>'
                  + '<th>' + _doraT("dora.subs.service", "Service") + '</th>'
                  + '</tr></thead><tbody>';
        links.forEach(function(l) {
            var a = arrById[l.arrangement_id];
            var v = a ? vById[a.vendor_id] : null;
            linksHtml += '<tr>'
                       + '<td>' + _esc(v ? v.name : "—") + '</td>'
                       + '<td><a href="javascript:void(0)" data-click="doraOpenArrangementModal" data-args=\'["' + _esc(l.arrangement_id) + '"]\'>' + _esc((a && a.arrangement_reference) || l.arrangement_id) + '</a></td>'
                       + '<td>' + _esc(l.tier || 1) + '</td>'
                       + '<td>' + _esc(_doraCodeLabel("ict_service_type", l.service_provided) || l.service_provided || "") + '</td>'
                       + '</tr>';
        });
        linksHtml += '</tbody></table>';
    }

    var bodyHtml = ''
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:0.9em">'
        + '  <label style="grid-column:span 2">' + _doraT("dora.modal.sub_name", "Name") + '<input id="sub-id-name" value="' + _esc(s.name || "") + '" required></label>'
        + '  <label>' + _doraT("dora.modal.sub_lei", "LEI") + '<div style="display:flex;align-items:center;gap:2px"><input id="sub-id-lei" value="' + _esc(s.lei || "") + '" style="flex:1">' + _gleifTriggerHtml("sub-id-lei") + '</div></label>'
        + _fld(_doraT("dora.modal.sub_country", "Country"), _doraRefSelect("sub-id-country", s.country_iso2, _doraCodeItems("country_iso3166_1")))
        + '</div>'
        + '<hr style="margin:14px 0;border:none;border-top:1px solid var(--border)">'
        + '<div style="font-weight:600;margin-bottom:6px">' + _doraT("dora.subs.linked_arrangements", "Linked arrangements") + '</div>'
        + linksHtml;

    function _collect() {
        function _v(id) { var el = document.getElementById(id); return el ? el.value : ""; }
        return {
            name: _v("sub-id-name"),
            lei: _v("sub-id-lei"),
            country_iso2: _doraRefValue("sub-id-country")
        };
    }

    var buttons = [{ id: "cancel", label: _doraT("btn_cancel", "Cancel") }];
    buttons.push({ id: "delete", label: _doraT("btn_delete", "Delete"), danger: true, result: function() {
        if (!window.confirm(_doraT("dora.subs.delete_confirm", "Delete this subcontractor and unlink it from every arrangement?"))) return false;
        window.doraDelSub(s.id);
        return "deleted";
    }});
    buttons.push({ id: "save", label: _doraT("btn_save", "Save"), primary: true, result: function() {
        var data = _collect();
        if (!data.name) {
            window.alert(_doraT("dora.modal.sub_name_required", "Name is required."));
            return false;
        }
        Object.assign(s, data);
        _persist("dora_subcontractor", s.id, data);
        var host = document.getElementById("dora-root");
        if (host) _render(host);
        if (typeof window.renderPanel === "function") try { window.renderPanel(); } catch (e) {}
        return "saved";
    }});

    return window.ct_modal.open({
        title: _doraT("dora.modal.sub_id_title", "Edit subcontractor identity"),
        body: bodyHtml,
        size: "lg",
        buttons: buttons
    });
};

// Open the arrangement↔subcontractor LINK modal (junction row).
// Edits per-link fields only. To change the sub's identity, use
// doraOpenSubIdentityModal. subId === null → "link a sub" flow with picker.
window.doraOpenSubcontractorModal = function(arrangementId, subId, preselect) {
    if (typeof window.ct_modal === "undefined") return;
    if (!arrangementId) return;
    var isNew = !subId;
    var allLinks = (_doraTree.subcontractor_links || []).filter(function(l) { return l.arrangement_id === arrangementId; });
    var l = isNew
        ? { arrangement_id: arrangementId, subcontractor_id: "", tier: 1, sort_order: allLinks.length, service_provided: "", is_critical_function_support: false, parent_subcontractor_id: null }
        : (allLinks.find(function(x) { return x.subcontractor_id === subId; }) || null);
    if (!l) return;

    function _fld(label, controlHtml, span) {
        return '<div' + (span ? ' style="grid-column:span ' + span + '"' : '') + '><div style="margin-bottom:2px">' + label + '</div>' + controlHtml + '</div>';
    }
    // Sub picker (only when adding a new link): global subs not yet linked to this arrangement.
    var alreadyLinked = {}; allLinks.forEach(function(x) { alreadyLinked[x.subcontractor_id] = true; });
    var pickerItems = (_doraTree.subcontractors || [])
        .filter(function(s) { return !alreadyLinked[s.id]; })
        .map(function(s) { return { id: s.id, label: (s.name || s.id) + (s.lei ? " — " + s.lei : "") }; });
    // Parent picker: sibling subs already linked to this arrangement (excluding self).
    var subById = {}; (_doraTree.subcontractors || []).forEach(function(s) { subById[s.id] = s; });
    var parentItems = allLinks
        .filter(function(sib) { return sib.subcontractor_id !== l.subcontractor_id; })
        .map(function(sib) {
            var sId = subById[sib.subcontractor_id];
            return { id: sib.subcontractor_id, label: ((sId && sId.name) || sib.subcontractor_id) + " (tier " + (sib.tier || 1) + ")" };
        });

    var subHeader;
    if (isNew) {
        subHeader = ''
            + '<div style="grid-column:span 2"><div style="margin-bottom:2px">' + _doraT("dora.modal.link_pick_sub", "Subcontractor") + '</div>'
            + '  <div style="display:flex;gap:8px;align-items:flex-start">'
            + '    <div style="flex:1">' + _doraRefSelect("link-sub-pick", preselect || "", pickerItems) + '</div>'
            + '    <button type="button" class="btn-secondary" data-click="doraNewSubFromLink" data-args=\'["' + _esc(arrangementId) + '"]\' style="white-space:nowrap">+ ' + _doraT("dora.modal.link_new_sub", "New subcontractor") + '</button>'
            + '  </div>'
            + '</div>';
    } else {
        subHeader = '<div style="grid-column:span 2;padding:6px 8px;background:var(--bg-elev,#f3f3f5);border:1px solid var(--border);border-radius:4px"><strong>' + _esc((subById[l.subcontractor_id] && subById[l.subcontractor_id].name) || l.subcontractor_id) + '</strong> <span style="color:var(--text-muted);font-size:0.85em">' + _esc(l.subcontractor_id) + '</span> <a href="javascript:void(0)" data-click="doraOpenSubIdentityModal" data-args=\'["' + _esc(l.subcontractor_id) + '"]\' style="margin-left:10px;font-size:0.85em">' + _doraT("dora.modal.link_edit_identity", "Edit identity") + ' →</a></div>';
    }

    var initTier = Number(l.tier) || 1;
    var parentDisplay = (initTier > 1) ? "block" : "none";

    function _section(titleKey, fallback, gridHtml) {
        return ''
            + '<fieldset style="border:1px solid var(--border);border-radius:6px;padding:8px 12px 12px;margin:0 0 10px">'
            + '  <legend style="padding:0 6px;font-size:0.82em;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">' + _doraT(titleKey, fallback) + '</legend>'
            + '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:0.9em">' + gridHtml + '</div>'
            + '</fieldset>';
    }

    var bodyHtml = ''
        + _section("dora.modal.link_section_identity", "Subcontractor",
              subHeader)
        + _section("dora.modal.link_section_position", "Position in chain",
              '  <label>' + _doraT("dora.modal.sub_tier", "Tier (1 = direct)") + '<input id="link-tier" type="number" min="1" max="20" value="' + _esc(initTier) + '" data-input="doraOnLinkTierChange"></label>'
            + '<div id="link-parent-slot" style="display:' + parentDisplay + '">'
            +   '<div style="margin-bottom:2px">' + _doraT("dora.modal.sub_parent", "Parent subcontractor") + '</div>'
            +   _doraRefSelect("link-parent", l.parent_subcontractor_id || "", parentItems)
            + '</div>')
        + _section("dora.modal.link_section_scope", "Scope of the link",
              _fld(_doraT("dora.modal.sub_service", "Service provided"), _doraRefSelect("link-service", l.service_provided || "", _doraCodeItems("ict_service_type")))
            + '  <label style="display:flex;align-items:center;gap:6px;margin-top:18px"><input type="checkbox" id="link-crit"' + (l.is_critical_function_support ? " checked" : "") + '> ' + _doraT("dora.modal.sub_critical", "Supports a critical/important function") + '</label>');

    function _collect() {
        function _v(id) { var el = document.getElementById(id); return el ? el.value : ""; }
        function _b(id) { var el = document.getElementById(id); return el ? !!el.checked : false; }
        function _nFromV(v) { return v === "" || v == null ? null : Number(v); }
        var tier = _nFromV(_v("link-tier")) || 1;
        return {
            tier: tier,
            // Parent only meaningful for tier ≥ 2 (sub-of-sub).
            parent_subcontractor_id: (tier > 1 ? (_doraRefValue("link-parent") || null) : null),
            service_provided: _doraRefValue("link-service"),
            is_critical_function_support: _b("link-crit")
        };
    }

    var buttons = [{ id: "cancel", label: _doraT("btn_cancel", "Cancel") }];
    if (!isNew) {
        buttons.push({ id: "unlink", label: _doraT("dora.modal.link_unlink", "Unlink"), danger: true, result: function() {
            if (!window.confirm(_doraT("dora.modal.confirm_unlink", "Unlink this subcontractor from this arrangement?"))) return false;
            window.doraUnlinkSub(arrangementId + "/" + l.subcontractor_id);
            return "deleted";
        }});
    }
    buttons.push({ id: "save", label: _doraT("btn_save", "Save"), primary: true, result: function() {
        var data = _collect();
        if (isNew) {
            var sid = _doraRefValue("link-sub-pick");
            if (!sid) {
                window.alert(_doraT("dora.modal.link_pick_required", "Please pick a subcontractor to link."));
                return false;
            }
            window.doraLinkSub(arrangementId, sid, data);
        } else {
            Object.assign(l, data);
            _persist("dora_sub_link", arrangementId + "/" + l.subcontractor_id, data);
        }
        var host = document.getElementById("dora-root");
        if (host) _render(host);
        if (typeof window.renderPanel === "function") try { window.renderPanel(); } catch (e) {}
        return "saved";
    }});

    window.ct_modal.open({
        title: isNew
            ? _doraT("dora.modal.link_title_new", "Link subcontractor to arrangement")
            : _doraT("dora.modal.link_title_edit", "Edit subcontractor link"),
        body: bodyHtml,
        size: "md",
        buttons: buttons
    });
};

// ── GLEIF LEI lookup ─────────────────────────────────────────────
// Public, CORS-enabled, no auth. Used by both this module (subcontractor
// modal, RFE table, ultimate-parent LEI) and TPRM_app.js (vendor sheet LEI).

var _gleifPopoverEl = null;

function _gleifClosePopover() {
    if (_gleifPopoverEl) { try { _gleifPopoverEl.remove(); } catch (e) {} }
    _gleifPopoverEl = null;
    document.removeEventListener("mousedown", _gleifOutsideClick, true);
}

function _gleifOutsideClick(ev) {
    if (!_gleifPopoverEl) return;
    if (_gleifPopoverEl.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest("[data-gleif-trigger]")) return;
    _gleifClosePopover();
}

function _gleifRenderResults(records) {
    if (!records || records.length === 0) {
        return '<div style="padding:10px;color:var(--text-muted);font-size:0.85em">' + _esc(_doraT("gleif.no_results", "No matching LEI found.")) + '</div>';
    }
    var h = '';
    records.forEach(function(rec) {
        var attrs = (rec && rec.attributes) || {};
        var ent = attrs.entity || {};
        var legalName = (ent.legalName && ent.legalName.name) || "";
        var country = (ent.legalAddress && ent.legalAddress.country) || "";
        var status = ent.status || "";
        var lei = attrs.lei || rec.id || "";
        h += '<div class="gleif-row" data-lei="' + _esc(lei) + '" data-name="' + _esc(legalName) + '" data-country="' + _esc(country) + '" style="padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer">'
           + '<div style="font-weight:600">' + _esc(legalName || "—") + '</div>'
           + '<div style="font-size:0.8em;color:var(--text-muted)"><code>' + _esc(lei) + '</code> · ' + _esc(country) + (status ? ' · ' + _esc(status) : '') + '</div>'
           + '</div>';
    });
    return h;
}

// Open a GLEIF lookup popover anchored to the trigger button.
// targetInput: the <input> element receiving the chosen LEI.
// onPick(record): optional callback with the full chosen record (legal name, country…).
function _gleifOpenPopover(triggerEl, targetInput, onPick) {
    _gleifClosePopover();
    var rect = triggerEl.getBoundingClientRect();
    var pop = document.createElement("div");
    pop.className = "gleif-popover";
    pop.style.cssText = "position:fixed;z-index:9999;top:" + (rect.bottom + 4) + "px;left:" + Math.max(8, rect.right - 380) + "px;width:380px;max-height:340px;overflow:auto;background:var(--bg,#fff);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,0.18);font-size:0.9em";
    pop.innerHTML = ''
        + '<div style="padding:8px;border-bottom:1px solid var(--border);background:var(--bg-elev,#f7f7f8)">'
        + '  <input class="gleif-q" placeholder="' + _esc(_doraT("gleif.search_ph", "Search by legal name or LEI…")) + '" style="width:100%;padding:5px 7px">'
        + '</div>'
        + '<div class="gleif-results"><div style="padding:10px;color:var(--text-muted);font-size:0.85em">' + _esc(_doraT("gleif.tip", "Type at least 2 characters.")) + '</div></div>'
        + '<div style="padding:5px 8px;font-size:0.72em;color:var(--text-muted);border-top:1px solid var(--border)">' + _esc(_doraT("gleif.attribution", "Source: GLEIF (api.gleif.org)")) + '</div>';
    document.body.appendChild(pop);
    _gleifPopoverEl = pop;

    var input = pop.querySelector(".gleif-q");
    var results = pop.querySelector(".gleif-results");
    // Pre-fill from current target value if any.
    if (targetInput && targetInput.value) input.value = targetInput.value;
    try { input.focus(); input.select(); } catch (e) {}

    var debounceTimer = null;
    function search() {
        var q = (input.value || "").trim();
        if (q.length < 2) {
            results.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:0.85em">' + _esc(_doraT("gleif.tip", "Type at least 2 characters.")) + '</div>';
            return;
        }
        // Heuristic: 20-char alphanumeric → exact LEI lookup; else search by name.
        var url;
        var isLEI = /^[A-Z0-9]{20}$/i.test(q);
        if (isLEI) {
            url = "https://api.gleif.org/api/v1/lei-records/" + encodeURIComponent(q.toUpperCase());
        } else {
            url = "https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalName%5D=" + encodeURIComponent(q) + "&page%5Bsize%5D=10";
        }
        results.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:0.85em">' + _esc(_doraT("gleif.searching", "Searching…")) + '</div>';
        fetch(url, { headers: { "Accept": "application/vnd.api+json" } })
            .then(function(r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.json();
            })
            .then(function(j) {
                var data = j && j.data;
                var arr = Array.isArray(data) ? data : (data ? [data] : []);
                results.innerHTML = _gleifRenderResults(arr);
                // Stash records so click can pick up the full attributes.
                results.__gleifRecords = arr;
            })
            .catch(function(e) {
                results.innerHTML = '<div style="padding:10px;color:var(--red,#c33);font-size:0.85em">' + _esc(_doraT("gleif.error", "Lookup failed:")) + ' ' + _esc(String(e.message || e)) + '</div>';
            });
    }
    input.addEventListener("input", function() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(search, 350);
    });
    input.addEventListener("keydown", function(ev) {
        if (ev.key === "Escape") _gleifClosePopover();
    });

    results.addEventListener("click", function(ev) {
        var row = ev.target.closest(".gleif-row");
        if (!row) return;
        var lei = row.getAttribute("data-lei") || "";
        var name = row.getAttribute("data-name") || "";
        var country = row.getAttribute("data-country") || "";
        var arr = results.__gleifRecords || [];
        var record = arr.find(function(r) { return (r.attributes && r.attributes.lei) === lei; }) || null;
        if (targetInput) {
            targetInput.value = lei;
            // Fire input event so the granular adapter persists the change.
            try { targetInput.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
            try { targetInput.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
        }
        if (typeof onPick === "function") onPick({ lei: lei, name: name, country: country, record: record });
        _gleifClosePopover();
    });

    // Run an initial search if pre-filled.
    if (input.value && input.value.trim().length >= 2) search();
    setTimeout(function() { document.addEventListener("mousedown", _gleifOutsideClick, true); }, 0);
}

// Click handler for the inline "🔍" buttons. data-args=[targetInputId]
window.gleifOpenLookup = function(targetInputId) {
    var input = targetInputId ? document.getElementById(targetInputId) : null;
    var trigger = document.querySelector('[data-gleif-trigger="' + targetInputId + '"]');
    if (!trigger) return;
    _gleifOpenPopover(trigger, input, null);
};

// Renders an inline "🔍" button next to a LEI input. The host page is
// responsible for placing the input itself; the button is a sibling.
function _gleifTriggerHtml(targetInputId, opts) {
    opts = opts || {};
    var title = opts.title || _doraT("gleif.lookup", "Lookup LEI on GLEIF");
    return '<button type="button" class="btn-secondary" data-gleif-trigger="' + _esc(targetInputId) + '" data-click="gleifOpenLookup" data-args=\'["' + _esc(targetInputId) + '"]\' title="' + _esc(title) + '" style="padding:2px 8px;font-size:0.85em;margin-left:4px">🔍</button>';
}

// Public hook so TPRM_app.js can render the trigger and trigger lookups.
window.DoraData = window.DoraData || {};
window.DoraData.gleifTriggerHtml = _gleifTriggerHtml;
window.DoraData.gleifOpenLookup = function(triggerEl, targetInput, onPick) {
    return _gleifOpenPopover(triggerEl, targetInput, onPick);
};

// Expose codelists/countries to other modules so the vendor sheet can
// share the DORA ISO 3166-1 list without duplicating it.
window.DoraData.getCodelist = function(key) {
    return (_doraCodelists && _doraCodelists[key]) || null;
};
window.DoraData.ensureCodelists = function(cb) {
    if (_doraCodelists) { if (cb) cb(_doraCodelists); return; }
    if (window._doraCodelists) { _doraCodelists = window._doraCodelists; if (cb) cb(_doraCodelists); return; }
    if (cb) cb(null);
};

// ── Public entry ─────────────────────────────────────────────────

window.renderDoraPanel = function(host) {
    _loadTree(host);
};

// Toggle a single section's help paragraph. Each section title carries a
// "?" button bound to this handler with its hint key (intro, rfe,
// branches, functions, consolidation).
window.doraToggleHint = function(key) {
    var el = document.getElementById("dora-hint-" + key);
    if (!el) return;
    el.style.display = (el.style.display === "none" || !el.style.display) ? "block" : "none";
};

})();
