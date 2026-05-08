/**
 * DORA RoI XLSX export — strict EBA Data Model alignment (browser port).
 *
 * Faithful client-side port of backend dora_export.py (962 lines). Each
 * sheet mirrors the official EBA template (B_01.01 … B_07.01) using
 * the EBA Data Point Model (DPM v4.0, March 2025) codelists, the
 * official 4-digit column IDs and labels from the EBA Data Model for
 * DORA RoI (Nov 2024), and Commission Implementing Regulation
 * (EU) 2024/2956.
 *
 * Public entry point:
 *   window._doraExportEBA(tree, codelists, targetCurrency)
 */
(function() {
"use strict";

// ── Static FX rates (EUR base). Production should override via
//    tree.metadata.fx_rates. Mirrors _FX_TO_EUR in dora_export.py.
var _FX_TO_EUR = {
    "EUR": 1.0, "USD": 0.92, "GBP": 1.17, "CHF": 1.04, "JPY": 0.0061,
    "CNY": 0.13, "CAD": 0.67, "AUD": 0.61, "NZD": 0.55, "SEK": 0.087,
    "NOK": 0.085, "DKK": 0.134, "PLN": 0.23, "CZK": 0.040, "HUF": 0.0026,
    "RON": 0.20, "BGN": 0.51, "HRK": 0.133, "ISK": 0.0066, "TRY": 0.027,
    "ILS": 0.25, "RUB": 0.010, "UAH": 0.022, "INR": 0.011, "SGD": 0.68,
    "HKD": 0.117, "TWD": 0.029, "KRW": 0.00067, "THB": 0.026, "IDR": 0.000058,
    "MYR": 0.20, "PHP": 0.016, "VND": 0.000037, "ZAR": 0.049, "EGP": 0.019,
    "AED": 0.25, "SAR": 0.245, "QAR": 0.252, "KWD": 3.00, "MAD": 0.092,
    "BRL": 0.16, "MXN": 0.046, "ARS": 0.001, "CLP": 0.00094, "COP": 0.00021,
    "PEN": 0.24
};

// Active FX map, set per export call (merge of defaults + tree metadata).
var _fx = _FX_TO_EUR;

function _convert(amount, src, target) {
    if (amount === null || amount === undefined || amount === "") return null;
    var n = parseFloat(amount);
    if (isNaN(n)) return null;
    src = String(src || "EUR").toUpperCase();
    target = String(target || "EUR").toUpperCase();
    if (src === target) return n;
    var srcEur = _fx[src];
    var tgtEur = _fx[target];
    if (srcEur === undefined || srcEur === null || tgtEur === undefined || tgtEur === null || tgtEur === 0) return null;
    return n * srcEur / tgtEur;
}

// ── EBA codelists (DPM v4.0, March 2025) ──────────────────────────
var _EBA_ENTITY_TYPE = {
    "credit_institution": "eba_CT:x12",
    "payment_institution": "eba_CT:x300",
    "account_information_service_provider": "eba_CT:x301",
    "electronic_money_institution": "eba_CT:x302",
    "crypto_asset_service_provider": "eba_CT:x303",
    "central_securities_depository": "eba_CT:x304",
    "trading_venue": "eba_CT:x305",
    "trade_repository": "eba_CT:x306",
    "alternative_investment_fund_manager": "eba_CT:x307",
    "data_reporting_service_provider": "eba_CT:x308",
    "insurance_undertaking": "eba_CT:x309",
    "reinsurance_undertaking": "eba_CT:x309",
    "issuer_asset_referenced_token": "eba_CT:x310",
    "ior_pension_institution": "eba_CT:x311",
    "credit_rating_agency": "eba_CT:x312",
    "benchmark_administrator": "eba_CT:x313",
    "crowdfunding_service_provider": "eba_CT:x314",
    "securitisation_repository": "eba_CT:x315",
    "other": "eba_CT:x316",
    "ict_intra_group_provider": "eba_CT:x317",
    "ict_third_party_service_provider": "eba_CT:x318",
    "subcontractor_ict_tpp": "eba_CT:x318",
    "insurance_intermediary": "eba_CT:x320",
    "ucits_management_company": "eba_CT:x639",
    "investment_firm": "eba_CT:x599",
    "central_counterparty": "eba_CT:x643"
};

var _EBA_HIERARCHY = {
    "sole_entity": "eba_RP:x21",
    "parent": "eba_RP:x53",
    "ultimate_parent": "eba_RP:x53",
    "subsidiary": "eba_RP:x56",
    "intermediate_parent": "eba_RP:x551",
    "outsourcing": "eba_RP:x210",
    "branch": ""
};

var _EBA_ARRANGEMENT_TYPE = {
    "standalone": "eba_CO:x1",
    "overarching": "eba_CO:x2",
    "subsequent": "eba_CO:x3"
};

var _EBA_TERMINATION_REASON = {
    "expired_not_renewed": "eba_CO:x4",
    "breach_of_law": "eba_CO:x5",
    "impediments": "eba_CO:x6",
    "data_security_weakness": "eba_CO:x7",
    "competent_authority": "eba_CO:x8",
    "other": "eba_CO:x9"
};

var _EBA_PERSON_TYPE = {
    "legal": "eba_CT:x212",
    "natural": "eba_CT:x213"
};

var _EBA_SUBSTITUTABILITY = {
    "not_substitutable": "eba_ZZ:x959",
    "highly_complex": "eba_ZZ:x960",
    "medium_complexity": "eba_ZZ:x961",
    "easy": "eba_ZZ:x962"
};

var _EBA_SUBSTITUTABILITY_REASON = {
    "no_alternatives": "eba_ZZ:x963",
    "migration_difficulties": "eba_ZZ:x964",
    "both": "eba_ZZ:x965"
};

var _EBA_REINTEGRATION_LEVEL = {
    "easy": "eba_ZZ:x798",
    "difficult": "eba_ZZ:x966",
    "highly_complex": "eba_ZZ:x967",
    "not_applicable": "eba_ZZ:x0"
};

// Data sensitivity — LISTB02020170 (B_02.02.0170). EBA exposes only
// Low / Medium / High; the legacy 4-level scale (public/internal/
// confidential/strictly_confidential) is collapsed by design — same
// mapping as the backend dora_export.py.
var _EBA_DATA_SENSITIVITY = {
    "public": "eba_ZZ:x791",
    "internal": "eba_ZZ:x791",
    "low": "eba_ZZ:x791",
    "confidential": "eba_ZZ:x792",
    "medium": "eba_ZZ:x792",
    "strictly_confidential": "eba_ZZ:x793",
    "high": "eba_ZZ:x793"
};

var _EBA_RELIANCE_LEVEL = {
    "not_significant": "eba_ZZ:x794",
    "low": "eba_ZZ:x795",
    "material": "eba_ZZ:x796",
    "full": "eba_ZZ:x797"
};

var _EBA_IMPACT_LEVEL = {
    "low": "eba_ZZ:x791",
    "medium": "eba_ZZ:x792",
    "high": "eba_ZZ:x793",
    "not_assessed": "eba_ZZ:x799"
};

var _EBA_IS_BRANCH = {
    "branch": "eba_ZZ:x838",
    "not_branch": "eba_ZZ:x839"
};

var _EBA_TYPE_OF_CODE = {
    "LEI": "eba_qCO:qx2000",
    "lei": "eba_qCO:qx2000",
    "national_id": "eba_qCO:qx2001",
    "EUID": "eba_qCO:qx2002",
    "euid": "eba_qCO:qx2002",
    "CRN": "eba_qCO:qx2003",
    "crn": "eba_qCO:qx2003",
    "VAT": "eba_qCO:qx2004",
    "vat": "eba_qCO:qx2004",
    "tax_id": "eba_qCO:qx2004",
    "passport": "eba_qCO:qx2005"
};

// ICT service taxonomy — LISTB02020110 / B_07.01.0040. Maps the
// internal 21-item S_01..S_21 catalog to the EBA 19-item taxonomy.
// Several internal codes legitimately collapse to the same EBA code
// (S_07 / S_09 / S_17 → S07) — this is the EBA DPM v4.0 mapping,
// identical to backend dora_export.py. S_10 (training) and S_21
// (other) have no EBA equivalent and are dropped.
var _EBA_ICT_SERVICE = {
    "S_01": "eba_TA:S01",
    "S_02": "eba_TA:S02",
    "S_03": "eba_TA:S03",
    "S_04": "eba_TA:S04",
    "S_05": "eba_TA:S05",
    "S_06": "eba_TA:S14",
    "S_07": "eba_TA:S07",
    "S_08": "eba_TA:S15",
    "S_09": "eba_TA:S07",
    "S_11": "eba_TA:S06",
    "S_12": "eba_TA:S16",
    "S_13": "eba_TA:S08",
    "S_14": "eba_TA:S09",
    "S_15": "eba_TA:S11",
    "S_16": "eba_TA:S10",
    "S_17": "eba_TA:S07",
    "S_18": "eba_TA:S17",
    "S_19": "eba_TA:S18",
    "S_20": "eba_TA:S19"
};

function _eba(table, value) {
    if (value === null || value === undefined || value === "") return "";
    var s = String(value).replace(/^\s+|\s+$/g, "");
    if (table.hasOwnProperty(s)) return table[s];
    var lo = s.toLowerCase();
    if (table.hasOwnProperty(lo)) return table[lo];
    return "";
}

function _eba_yesno(v) {
    if (v === null || v === undefined || v === "") return "";
    return v ? "eba_BT:x28" : "eba_BT:x29";
}

function _eba_yesno_or_na(v) {
    if (v === null || v === undefined || v === "") return "eba_BT:x21";
    return v ? "eba_BT:x28" : "eba_BT:x29";
}

function _eba_country(iso2) {
    if (iso2 === null || iso2 === undefined || iso2 === "") return "";
    var s = String(iso2).replace(/^\s+|\s+$/g, "").toUpperCase();
    return s.length === 2 ? "eba_GA:" + s : "";
}

function _eba_currency(iso3) {
    if (iso3 === null || iso3 === undefined || iso3 === "") return "";
    var s = String(iso3).replace(/^\s+|\s+$/g, "").toUpperCase();
    return s.length === 3 ? "eba_CU:" + s : "";
}

function _eba_type_of_code_for_lei(lei, fallback_type) {
    if (lei) return "eba_qCO:qx2000";
    if (fallback_type) return _eba(_EBA_TYPE_OF_CODE, fallback_type);
    return "";
}

// ── Column specs (id, title) per EBA Data Model ───────────────────
var _COLS_B0101 = [
    ["0010", "LEI of the entity maintaining the register of information"],
    ["0020", "Name of the entity"],
    ["0030", "Country of the entity"],
    ["0040", "Type of entity"],
    ["0050", "Competent Authority"],
    ["0060", "Date of the reporting"]
];

var _COLS_B0102 = [
    ["0010", "LEI of the entity"],
    ["0020", "Name of the entity"],
    ["0030", "Country of the entity"],
    ["0040", "Type of entity"],
    ["0050", "Hierarchy of the entity within the group (where applicable)"],
    ["0060", "LEI of the direct parent undertaking of the financial entity"],
    ["0070", "Date of last update"],
    ["0080", "Date of integration in the Register of information"],
    ["0090", "Date of deletion in the Register of information"],
    ["0100", "Currency"],
    ["0110", "Value of total assets - of the financial entity"]
];

var _COLS_B0103 = [
    ["0010", "Identification code of the branch"],
    ["0020", "LEI of the financial entity head office of the branch"],
    ["0030", "Name of the branch"],
    ["0040", "Country of the branch"]
];

var _COLS_B0201 = [
    ["0010", "Contractual arrangement reference number"],
    ["0020", "Type of contractual arrangement"],
    ["0030", "Overarching contractual arrangement reference number"],
    ["0040", "Currency of the amount reported"],
    ["0050", "Annual expense or estimated cost of the contractual arrangement for the past year"]
];

var _COLS_B0202 = [
    ["0010", "Contractual arrangement reference number"],
    ["0020", "LEI of the financial entity making use of the ICT service"],
    ["0030", "Identification code of the third-party service provider"],
    ["0040", "Type of code to identify the third-party service provider"],
    ["0050", "Function identifier"],
    ["0060", "Type of ICT services"],
    ["0070", "Start date of the contractual arrangement"],
    ["0080", "End date of the contractual arrangement"],
    ["0090", "Reason of the termination or ending of the contractual arrangement"],
    ["0100", "Notice period for the financial entity"],
    ["0110", "Notice period for the ICT third-party service provider"],
    ["0120", "Country of the governing law of the contractual arrangement"],
    ["0130", "Country of provision of the ICT services"],
    ["0140", "Storage of data"],
    ["0150", "Location of the data at rest (storage)"],
    ["0160", "Location of management of the data (processing)"],
    ["0170", "Sensitiveness of the data stored by the ICT third-party service provider"],
    ["0180", "Level of reliance on the ICT service supporting the critical or important function"]
];

var _COLS_B0203 = [
    ["0010", "Contractual arrangement with ICT intra-group service provider"],
    ["0020", "Linked contractual arrangement with ICT third-party service provider"]
];

var _COLS_B0301 = [
    ["0010", "Contractual arrangement reference number"],
    ["0020", "LEI of the entity signing the contractual arrangement"]
];

var _COLS_B0302 = [
    ["0010", "Contractual arrangement reference number"],
    ["0020", "Identification code of the third-party service provider"],
    ["0030", "Type of code of the third-party service provider"]
];

var _COLS_B0303 = [
    ["0010", "Contractual arrangement reference number"],
    ["0020", "LEI of the intra-group entity providing ICT service"]
];

var _COLS_B0401 = [
    ["0010", "Contractual arrangement reference number"],
    ["0020", "LEI of the financial entity"],
    ["0030", "Is the entity making use of the ICT services a branch of a financial entity?"],
    ["0040", "Identification code of the branch"]
];

var _COLS_B0501 = [
    ["0010", "Identification code of the third-party service provider"],
    ["0020", "Type of code of the third-party service provider"],
    ["0030", "Additional identification code of the third-party service provider"],
    ["0040", "Type of additional identification code of the third-party service provider"],
    ["0050", "Legal name of the third-party service provider"],
    ["0060", "Name of the ICT third-party service provider in Latin alphabet"],
    ["0070", "Type of person of the third-party service provider"],
    ["0080", "Country of the third-party service provider's headquarters"],
    ["0090", "Currency of the amount reported"],
    ["0100", "Total annual expense or estimated cost of the third-party service provider"],
    ["0110", "Identification code of the third-party service provider's ultimate parent undertaking"],
    ["0120", "Type of code of the third-party service provider's ultimate parent undertaking"]
];

var _COLS_B0502 = [
    ["0010", "Contractual arrangement reference number"],
    ["0020", "Type of ICT services"],
    ["0030", "Identification code of the third-party service provider"],
    ["0040", "Type of code of the third-party service provider"],
    ["0050", "Rank"],
    ["0060", "Identification code of the recipient of sub-contracted ICT services"],
    ["0070", "Type of code of the recipient of sub-contracted ICT services"]
];

var _COLS_B0601 = [
    ["0010", "Function identifier"],
    ["0020", "Licenced activity"],
    ["0030", "Function name"],
    ["0040", "LEI of the financial entity"],
    ["0050", "Criticality or importance assessment"],
    ["0060", "Reasons for criticality or importance"],
    ["0070", "Date of the last assessment of criticality or importance"],
    ["0080", "Recovery time objective of the function"],
    ["0090", "Recovery point objective of the function"],
    ["0100", "Impact of discontinuing the function"]
];

var _COLS_B0701 = [
    ["0010", "Contractual arrangement reference number"],
    ["0020", "Identification code of the third-party service provider"],
    ["0030", "Type of code of the third-party service provider"],
    ["0040", "Type of ICT services"],
    ["0050", "Substitutability of the ICT third-party service provider"],
    ["0060", "Reason if the ICT third-party service provider is considered not substitutable or difficult to be substitutable"],
    ["0070", "Date of the last audit on the ICT third-party service provider"],
    ["0080", "Existence of an exit plan"],
    ["0090", "Possibility of reintegration of the contracted ICT service"],
    ["0100", "Impact of discontinuing the ICT services"],
    ["0110", "Are there alternative ICT third-party service providers identified?"],
    ["0120", "Identification of alternative ICT TPP"]
];

var _COLS_B9901 = [
    ["0010", "id"],
    ["0020", "kind"],
    ["0030", "lei"],
    ["0040", "name"],
    ["0050", "country_iso2"],
    ["0060", "parent_ref"]
];

var _TEMPLATE_TITLES = [
    ["B_01.01", "Financial entity maintaining the register of information"],
    ["B_01.02", "List of financial entities within the scope of the register of information"],
    ["B_01.03", "List of branches"],
    ["B_02.01", "Contractual arrangements — General information"],
    ["B_02.02", "Contractual arrangements — Specific information"],
    ["B_02.03", "List of intra-group contractual arrangements"],
    ["B_03.01", "Entities signing the contractual arrangements (FE side)"],
    ["B_03.02", "Third-party service providers signing the contractual arrangements"],
    ["B_03.03", "Entities signing the contractual arrangements for providing ICT services"],
    ["B_04.01", "Financial entities making use of the ICT services"],
    ["B_05.01", "ICT third-party service provider"],
    ["B_05.02", "ICT service supply chains"],
    ["B_06.01", "Functions identification"],
    ["B_07.01", "Assessment of the ICT services"],
    ["B_99.01", "Entity definitions (non-normative consolidated registry)"]
];

// ── Sheet writer ──────────────────────────────────────────────────
function _writeSheet(wb, name, cols, rows) {
    var ws = wb.addWorksheet(String(name).slice(0, 31));
    var titles = [];
    var codes = [];
    for (var i = 0; i < cols.length; i++) {
        titles.push(cols[i][1]);
        codes.push(cols[i][0]);
    }
    ws.addRow(titles);
    ws.addRow(codes);
    var hdrRow1 = ws.getRow(1);
    hdrRow1.height = 32;
    hdrRow1.eachCell(function(cell) {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } };
        cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    });
    var hdrRow2 = ws.getRow(2);
    hdrRow2.eachCell(function(cell) {
        cell.font = { bold: true, italic: true, color: { argb: "FF666666" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
        cell.alignment = { horizontal: "left", vertical: "middle" };
    });
    for (var r = 0; r < rows.length; r++) {
        ws.addRow(rows[r]);
    }
    // Column widths — mirror Python: max(len(title), 6) and (len(cell), 14..60).
    for (var c = 0; c < titles.length; c++) {
        var maxLen = String(titles[c]).length;
        if (maxLen < 6) maxLen = 6;
        for (var rr = 0; rr < rows.length; rr++) {
            var v = rows[rr][c];
            if (v === null || v === undefined) continue;
            var l = String(v).length;
            if (l > maxLen) maxLen = l;
        }
        var w = maxLen + 2;
        if (w < 14) w = 14;
        if (w > 60) w = 60;
        ws.getColumn(c + 1).width = w;
    }
    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 2 }];
}

// ── Helpers ───────────────────────────────────────────────────────
function _todayIso() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart ? String(d.getMonth() + 1).padStart(2, "0") : ("0" + (d.getMonth() + 1)).slice(-2);
    var dd = String(d.getDate()).padStart ? String(d.getDate()).padStart(2, "0") : ("0" + d.getDate()).slice(-2);
    return y + "-" + m + "-" + dd;
}

function _stamp() {
    var d = new Date();
    function pad(n) { return ("0" + n).slice(-2); }
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
        + "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function _say(msg) {
    if (typeof showStatus === "function") {
        try { showStatus(msg); } catch (e) {}
    }
}

// ── Main entry point ──────────────────────────────────────────────
function _doraExportEBA(tree, codelists, targetCurrency) {
    if (!tree) {
        _say("DORA export: empty data");
        return;
    }
    var loader = (typeof window._loadExcelJS === "function") ? window._loadExcelJS : (typeof _loadExcelJS === "function" ? _loadExcelJS : null);
    if (!loader) {
        _say("DORA export: ExcelJS loader missing");
        return;
    }
    _say("DORA export: building workbook…");

    return loader().then(function() {
        return _build(tree, codelists, targetCurrency);
    }, function(err) {
        _say("DORA export: ExcelJS load failed");
        if (window.console && console.error) console.error(err);
        throw err;
    }).then(function() {
        _say("DORA export: done");
    }, function(e) {
        _say("DORA export error: " + (e && e.message ? e.message : e));
        if (window.console && console.error) console.error(e);
    });
}

function _build(tree, codelists, targetCurrency) {
    var Excel = window.ExcelJS;
    if (!Excel) throw new Error("ExcelJS not loaded");

    var meta = tree.metadata || {};
    targetCurrency = String(targetCurrency || meta.currency || "EUR").toUpperCase();

    // Merge defaults with user-supplied FX rates.
    _fx = {};
    var k;
    for (k in _FX_TO_EUR) if (_FX_TO_EUR.hasOwnProperty(k)) _fx[k] = _FX_TO_EUR[k];
    if (meta.fx_rates && typeof meta.fx_rates === "object") {
        for (k in meta.fx_rates) {
            if (meta.fx_rates.hasOwnProperty(k)) {
                var v = parseFloat(meta.fx_rates[k]);
                if (!isNaN(v)) _fx[String(k).toUpperCase()] = v;
            }
        }
    }

    var entities = (tree.entities || []).slice();
    var functions_ = (tree.functions || []).slice();
    var branches = (tree.branches || []).slice();
    var consolidation = (tree.consolidation || []).slice();
    var arrangements = (tree.arrangements || []).slice();
    var signers = (tree.signers || []).slice();
    var subcontractors = (tree.subcontractors || []).slice();
    var subLinks = (tree.subcontractor_links || []).slice();

    // Vendors live in window.D.vendors (not in the dora tree).
    var vendors = (window.D && window.D.vendors) ? window.D.vendors.slice() : [];

    // Indexes
    var vendorById = {};
    var vendorByLei = {};
    var i;
    for (i = 0; i < vendors.length; i++) {
        vendorById[vendors[i].id] = vendors[i];
        if (vendors[i].lei) vendorByLei[String(vendors[i].lei).toUpperCase()] = vendors[i];
    }
    var fnById = {};
    for (i = 0; i < functions_.length; i++) fnById[functions_[i].id] = functions_[i];
    var rfeById = {};
    for (i = 0; i < entities.length; i++) rfeById[entities[i].id] = entities[i];
    var subById = {};
    for (i = 0; i < subcontractors.length; i++) subById[subcontractors[i].id] = subcontractors[i];
    var arrById = {};
    for (i = 0; i < arrangements.length; i++) arrById[arrangements[i].id] = arrangements[i];

    // Used vendor ids
    var usedVendorIds = {};
    for (i = 0; i < arrangements.length; i++) {
        if (arrangements[i].vendor_id) usedVendorIds[arrangements[i].vendor_id] = true;
    }

    // Cumulative annual expense per vendor (B_05.01 0100), in vendor's
    // most-frequent arrangement currency (mirrors Python).
    var vendorTotalById = {};
    var vendorCurById = {};
    var curCount = {};
    for (i = 0; i < arrangements.length; i++) {
        var a = arrangements[i];
        if (a.annual_cost_amount === null || a.annual_cost_amount === undefined || a.annual_cost_amount === "") continue;
        var amt = parseFloat(a.annual_cost_amount);
        if (isNaN(amt)) continue;
        vendorTotalById[a.vendor_id] = (vendorTotalById[a.vendor_id] || 0) + amt;
        var cur = String(a.currency || "EUR").toUpperCase();
        if (!curCount[a.vendor_id]) curCount[a.vendor_id] = {};
        curCount[a.vendor_id][cur] = (curCount[a.vendor_id][cur] || 0) + 1;
    }
    for (var vid in curCount) {
        if (!curCount.hasOwnProperty(vid)) continue;
        var bucket = curCount[vid];
        var best = "", bestN = -1;
        for (var c in bucket) {
            if (bucket.hasOwnProperty(c) && bucket[c] > bestN) { best = c; bestN = bucket[c]; }
        }
        vendorCurById[vid] = best;
    }

    // ── Workbook + Cover sheet ────────────────────────────────────
    var wb = new Excel.Workbook();
    wb.creator = "CISO Toolbox — Vendor (DORA RoI export)";
    wb.created = new Date();

    var cover = wb.addWorksheet("Cover");
    cover.getCell("A1").value = "DORA Register of Information";
    cover.getCell("A1").font = { bold: true, size: 14 };
    cover.getCell("A3").value = "Project";
    cover.getCell("B3").value = (window.D && window.D.organisation) || (window.D && window.D.project_name) || "";
    cover.getCell("A4").value = "Reporting period";
    cover.getCell("B4").value = (entities[0] && entities[0].reporting_period) ? entities[0].reporting_period : (meta.reporting_period || "");
    cover.getCell("A5").value = "Target currency (illustrative FX)";
    cover.getCell("B5").value = targetCurrency;
    cover.getCell("A6").value = "EBA reference";
    cover.getCell("B6").value = "Reg. (EU) 2024/2956 — EBA Data Model for DORA RoI";
    cover.getCell("A8").value = "Templates";
    cover.getCell("A8").font = { bold: true };
    for (i = 0; i < _TEMPLATE_TITLES.length; i++) {
        var rIdx = 9 + i;
        cover.getCell("A" + rIdx).value = _TEMPLATE_TITLES[i][0];
        cover.getCell("B" + rIdx).value = _TEMPLATE_TITLES[i][1];
    }
    cover.getColumn(1).width = 12;
    cover.getColumn(2).width = 80;

    var today = _todayIso();

    // ── B_01.01 — Entity maintaining the register (1 row) ─────────
    var holder = null;
    for (i = 0; i < entities.length; i++) {
        if ((entities[i].hierarchy || "") === "parent") { holder = entities[i]; break; }
    }
    if (!holder && entities.length > 0) holder = entities[0];
    var holderRows = [];
    if (holder) {
        holderRows.push([
            holder.lei || "",
            holder.name || "",
            _eba_country(holder.country_iso2),
            _eba(_EBA_ENTITY_TYPE, holder.entity_type),
            holder.competent_authority || "",
            holder.reporting_period || today
        ]);
    }
    _writeSheet(wb, "B_01.01", _COLS_B0101, holderRows);

    // ── B_01.02 — List of FEs in scope ────────────────────────────
    var b0102 = [];
    for (i = 0; i < entities.length; i++) {
        var e = entities[i];
        var totalAssetsRaw = (e.total_assets !== null && e.total_assets !== undefined && e.total_assets !== "") ? e.total_assets : null;
        b0102.push([
            e.lei || "",
            e.name || "",
            _eba_country(e.country_iso2),
            _eba(_EBA_ENTITY_TYPE, e.entity_type),
            _eba(_EBA_HIERARCHY, e.hierarchy),
            e.parent_lei || "",
            (e.updated_at ? String(e.updated_at).slice(0, 10) : ""),
            (e.created_at ? String(e.created_at).slice(0, 10) : ""),
            "",
            totalAssetsRaw !== null ? _eba_currency(e.total_assets_currency || "EUR") : "",
            totalAssetsRaw !== null ? totalAssetsRaw : ""
        ]);
    }
    for (i = 0; i < consolidation.length; i++) {
        var co = consolidation[i];
        b0102.push([
            co.entity_lei || "",
            co.entity_name || "",
            _eba_country(co.country_iso2),
            "", "", "",
            "", "", "", "", ""
        ]);
    }
    _writeSheet(wb, "B_01.02", _COLS_B0102, b0102);

    // ── B_01.03 — Branches ────────────────────────────────────────
    var b0103 = [];
    for (i = 0; i < branches.length; i++) {
        var b = branches[i];
        var headRfe = b.rfe_id ? rfeById[b.rfe_id] : null;
        b0103.push([
            b.branch_code || b.id,
            (headRfe ? (headRfe.lei || "") : ""),
            b.name || "",
            _eba_country(b.country_iso2)
        ]);
    }
    _writeSheet(wb, "B_01.03", _COLS_B0103, b0103);

    // ── B_02.01 — Contractual arrangements (general info) ─────────
    var arrRefById = {};
    for (i = 0; i < arrangements.length; i++) {
        arrRefById[arrangements[i].id] = arrangements[i].arrangement_reference || arrangements[i].id;
    }
    var b0201 = [];
    for (i = 0; i < arrangements.length; i++) {
        var aa = arrangements[i];
        var parentRef = "";
        if (aa.parent_arrangement_id) {
            parentRef = arrRefById[aa.parent_arrangement_id] || aa.parent_arrangement_id;
        }
        var costRaw = (aa.annual_cost_amount !== null && aa.annual_cost_amount !== undefined && aa.annual_cost_amount !== "") ? aa.annual_cost_amount : "";
        b0201.push([
            aa.arrangement_reference || aa.id,
            _eba(_EBA_ARRANGEMENT_TYPE, aa.arrangement_type),
            parentRef,
            _eba_currency(aa.currency),
            costRaw
        ]);
    }
    _writeSheet(wb, "B_02.01", _COLS_B0201, b0201);

    // ── B_02.02 — Contractual arrangements (specific info) ────────
    // PK: (ref, FE LEI, TPSP id, function id) → cartesian product.
    var b0202 = [];
    for (i = 0; i < arrangements.length; i++) {
        var ar = arrangements[i];
        var v = vendorById[ar.vendor_id];
        var rfes = (ar.rfe_ids && ar.rfe_ids.length) ? ar.rfe_ids : [null];
        var fns = (ar.function_ids && ar.function_ids.length) ? ar.function_ids : [null];
        var svcCodes = (ar.service_codes && ar.service_codes.length) ? ar.service_codes : (ar.nature_of_service ? [ar.nature_of_service] : [null]);
        for (var ri = 0; ri < rfes.length; ri++) {
            for (var fi = 0; fi < fns.length; fi++) {
                for (var si = 0; si < svcCodes.length; si++) {
                    var rfeId = rfes[ri];
                    var fnId = fns[fi];
                    var svc = svcCodes[si];
                    var rfe = rfeId ? rfeById[rfeId] : null;
                    var fnCode = "";
                    if (fnId) {
                        var fnObj = fnById[fnId];
                        fnCode = fnObj ? ((fnObj.code || "") || fnId) : fnId;
                    }
                    b0202.push([
                        ar.arrangement_reference || ar.id,
                        rfe ? (rfe.lei || "") : "",
                        v ? (v.lei || v.id || "") : "",
                        _eba_type_of_code_for_lei(v ? v.lei : null),
                        fnCode,
                        svc ? _eba(_EBA_ICT_SERVICE, svc) : "",
                        ar.start_date || "",
                        ar.end_date || "",
                        _eba(_EBA_TERMINATION_REASON, ar.termination_reason),
                        (ar.notice_period_days !== null && ar.notice_period_days !== undefined && ar.notice_period_days !== "") ? ar.notice_period_days : "",
                        (ar.notice_period_tpsp_days !== null && ar.notice_period_tpsp_days !== undefined && ar.notice_period_tpsp_days !== "") ? ar.notice_period_tpsp_days : "",
                        _eba_country(ar.governing_law_country),
                        _eba_country(ar.jurisdiction_country),
                        _eba_yesno(!!ar.data_storage_country),
                        _eba_country(ar.data_storage_country),
                        _eba_country(ar.data_processing_country),
                        _eba(_EBA_DATA_SENSITIVITY, ar.data_sensitivity),
                        _eba(_EBA_RELIANCE_LEVEL, ar.reliance_level)
                    ]);
                }
            }
        }
    }
    _writeSheet(wb, "B_02.02", _COLS_B0202, b0202);

    // ── B_02.03 — Intra-group arrangements ────────────────────────
    var rfeLeiSet = {};
    for (i = 0; i < entities.length; i++) {
        if (entities[i].lei) rfeLeiSet[String(entities[i].lei).toUpperCase()] = true;
    }
    var b0203 = [];
    for (i = 0; i < arrangements.length; i++) {
        var ar2 = arrangements[i];
        var v2 = vendorById[ar2.vendor_id];
        if (!v2) continue;
        var isIntra = false;
        if (v2.ultimate_parent_id) {
            var pv = vendorById[v2.ultimate_parent_id];
            if (pv && pv.lei && rfeLeiSet[String(pv.lei).toUpperCase()]) isIntra = true;
        }
        if (!isIntra) continue;
        b0203.push([
            ar2.arrangement_reference || ar2.id,
            ""
        ]);
    }
    _writeSheet(wb, "B_02.03", _COLS_B0203, b0203);

    // ── B_03.01 — Entities signing (FE side) ──────────────────────
    var b0301 = [];
    for (i = 0; i < signers.length; i++) {
        var s = signers[i];
        if (String(s.signer_role || "").toLowerCase() === "tpp") continue;
        var aSig = arrById[s.arrangement_id];
        b0301.push([
            aSig ? (aSig.arrangement_reference || aSig.id) : s.arrangement_id,
            s.signer_lei || ""
        ]);
    }
    _writeSheet(wb, "B_03.01", _COLS_B0301, b0301);

    // ── B_03.02 — TPSP signers ────────────────────────────────────
    var b0302 = [];
    for (i = 0; i < arrangements.length; i++) {
        var ar3 = arrangements[i];
        var v3 = vendorById[ar3.vendor_id];
        if (v3) {
            b0302.push([
                ar3.arrangement_reference || ar3.id,
                v3.lei || v3.id || "",
                _eba_type_of_code_for_lei(v3.lei, v3.additional_id_type)
            ]);
        }
    }
    for (i = 0; i < signers.length; i++) {
        var st = signers[i];
        if (String(st.signer_role || "").toLowerCase() !== "tpp") continue;
        var aSt = arrById[st.arrangement_id];
        b0302.push([
            aSt ? (aSt.arrangement_reference || aSt.id) : st.arrangement_id,
            st.signer_lei || "",
            _eba_type_of_code_for_lei(st.signer_lei)
        ]);
    }
    _writeSheet(wb, "B_03.02", _COLS_B0302, b0302);

    // ── B_03.03 — Intra-group entity providing ICT (placeholder) ──
    _writeSheet(wb, "B_03.03", _COLS_B0303, []);

    // ── B_04.01 — Entities making use of ICT services ─────────────
    var b0401 = [];
    for (i = 0; i < arrangements.length; i++) {
        var arU = arrangements[i];
        var rfeIds = arU.rfe_ids || [];
        for (var rj = 0; rj < rfeIds.length; rj++) {
            var rfeU = rfeById[rfeIds[rj]];
            b0401.push([
                arU.arrangement_reference || arU.id,
                rfeU ? (rfeU.lei || "") : "",
                _EBA_IS_BRANCH["not_branch"],
                ""
            ]);
        }
    }
    _writeSheet(wb, "B_04.01", _COLS_B0401, b0401);

    // ── B_05.01 — TPSP catalog ────────────────────────────────────
    var b0501 = [];
    for (i = 0; i < vendors.length; i++) {
        var vc = vendors[i];
        if (!usedVendorIds[vc.id]) continue;
        var ult = vc.ultimate_parent_id ? vendorById[vc.ultimate_parent_id] : null;
        b0501.push([
            vc.lei || vc.id || "",
            _eba_type_of_code_for_lei(vc.lei),
            vc.additional_id_value || "",
            _eba(_EBA_TYPE_OF_CODE, vc.additional_id_type),
            vc.name || "",
            vc.legal_name_latin || "",
            _eba(_EBA_PERSON_TYPE, vc.person_type),
            _eba_country(vc.country_iso2),
            _eba_currency(vendorCurById[vc.id] || ""),
            (vendorTotalById[vc.id] !== undefined ? vendorTotalById[vc.id] : ""),
            (ult && ult.lei ? ult.lei : (vc.ultimate_parent_id || "")),
            _eba_type_of_code_for_lei(ult ? ult.lei : null)
        ]);
    }
    _writeSheet(wb, "B_05.01", _COLS_B0501, b0501);

    // ── B_05.02 — Supply chains ───────────────────────────────────
    var b0502 = [];
    for (i = 0; i < subLinks.length; i++) {
        var lk = subLinks[i];
        var aL = arrById[lk.arrangement_id];
        var vL = aL ? vendorById[aL.vendor_id] : null;
        var subL = subById[lk.subcontractor_id];
        b0502.push([
            aL ? (aL.arrangement_reference || aL.id) : lk.arrangement_id,
            _eba(_EBA_ICT_SERVICE, lk.service_provided),
            vL ? (vL.lei || vL.id || "") : "",
            _eba_type_of_code_for_lei(vL ? vL.lei : null),
            (lk.tier !== null && lk.tier !== undefined && lk.tier !== "") ? lk.tier : "",
            (subL && subL.lei) ? subL.lei : (subL ? subL.id : lk.subcontractor_id),
            _eba_type_of_code_for_lei(subL ? subL.lei : null)
        ]);
    }
    _writeSheet(wb, "B_05.02", _COLS_B0502, b0502);

    // ── B_06.01 — Functions identification ────────────────────────
    var holderLei = (holder && holder.lei) ? holder.lei : "";
    var b0601 = [];
    for (i = 0; i < functions_.length; i++) {
        var f = functions_[i];
        b0601.push([
            (f.code || "") || f.id,
            f.business_line || "",
            f.name || "",
            holderLei,
            _eba_yesno_or_na(f.is_critical_or_important),
            f.criticality_rationale || "",
            f.last_assessment_date || "",
            (f.recovery_time_objective_h !== null && f.recovery_time_objective_h !== undefined && f.recovery_time_objective_h !== "") ? f.recovery_time_objective_h : "",
            (f.recovery_point_objective_h !== null && f.recovery_point_objective_h !== undefined && f.recovery_point_objective_h !== "") ? f.recovery_point_objective_h : "",
            f.impact_tolerance_description || ""
        ]);
    }
    _writeSheet(wb, "B_06.01", _COLS_B0601, b0601);

    // ── B_07.01 — Assessment of the ICT services ──────────────────
    var b0701 = [];
    for (i = 0; i < arrangements.length; i++) {
        var ar7 = arrangements[i];
        var v7 = vendorById[ar7.vendor_id];
        var svcCodes7 = (ar7.service_codes && ar7.service_codes.length) ? ar7.service_codes : (ar7.nature_of_service ? [ar7.nature_of_service] : [null]);
        var altPresent = !!(ar7.alternative_tpp_id && String(ar7.alternative_tpp_id).replace(/^\s+|\s+$/g, ""));
        for (var s7 = 0; s7 < svcCodes7.length; s7++) {
            var svc7 = svcCodes7[s7];
            b0701.push([
                ar7.arrangement_reference || ar7.id,
                v7 ? (v7.lei || v7.id || "") : "",
                _eba_type_of_code_for_lei(v7 ? v7.lei : null),
                svc7 ? _eba(_EBA_ICT_SERVICE, svc7) : "",
                _eba(_EBA_SUBSTITUTABILITY, ar7.substitutability_level),
                _eba(_EBA_SUBSTITUTABILITY_REASON, ar7.substitutability_reason),
                ar7.last_audit_date || "",
                _eba_yesno(!!ar7.exit_strategy_documented),
                _eba(_EBA_REINTEGRATION_LEVEL, ar7.reintegration_level),
                _eba(_EBA_IMPACT_LEVEL, ar7.impact_discontinuing_level),
                _eba_yesno_or_na(altPresent),
                ar7.alternative_tpp_id || ""
            ]);
        }
    }
    _writeSheet(wb, "B_07.01", _COLS_B0701, b0701);

    // ── B_99.01 — Non-normative consolidated registry ─────────────
    var b9901 = [];
    for (i = 0; i < entities.length; i++) {
        var er = entities[i];
        b9901.push([er.id, "RFE", er.lei || "", er.name || "", er.country_iso2 || "", er.parent_lei || ""]);
    }
    for (i = 0; i < branches.length; i++) {
        var br = branches[i];
        b9901.push([br.id, "Branch", br.lei || "", br.name || "", br.country_iso2 || "", ""]);
    }
    for (i = 0; i < consolidation.length; i++) {
        var cn = consolidation[i];
        b9901.push([cn.id, "ConsolidationScope", cn.entity_lei || "", cn.entity_name || "", cn.country_iso2 || "", ""]);
    }
    for (i = 0; i < vendors.length; i++) {
        var vv = vendors[i];
        b9901.push([vv.id, "TPSP", vv.lei || "", vv.name || "", vv.country_iso2 || "", vv.ultimate_parent_id || ""]);
    }
    for (i = 0; i < subcontractors.length; i++) {
        var su = subcontractors[i];
        b9901.push([su.id, "Subcontractor", su.lei || "", su.name || "", su.country_iso2 || "", ""]);
    }
    _writeSheet(wb, "B_99.01", _COLS_B9901, b9901);

    // ── Generate file & trigger download ──────────────────────────
    return wb.xlsx.writeBuffer().then(function(buf) {
        var blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "RoI_" + _stamp() + ".xlsx";
        document.body.appendChild(a);
        a.click();
        setTimeout(function() {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 0);
    });
}

window._doraExportEBA = _doraExportEBA;

})();
