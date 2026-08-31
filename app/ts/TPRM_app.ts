/**
 * CISO Toolbox — Vendor Risk Management (TPRM)
 *
 * Uses shared libraries: cisotoolbox.js (esc, _da, showStatus), i18n.js (t),
 * TPRM_questions.js (questions, tier matrix, categories).
 *
 * Data model stored in D (global, used by cisotoolbox.js autosave):
 *   vendors[], risks[], assessments[], documents[]
 */

// CT_CONFIG — cisotoolbox framework integration
var TPRM_INIT_DATA: TprmData = {
    vendors: [],
    risks: [],
    assessments: [],
    documents: [],
    questionnaire_templates: [],
    maturity_config: {
        weight_by_kind: { questionnaire: 1.0, audit: 1.5 },
        weight_by_template: {},
        decay_per_quarter: 0.0,
        min_effective_weight: 0.1
    },
    metadata: { organization: "", created: "" }
};
window.CT_CONFIG = {
    edition: "suite",
    module: "vendor",
    deployed: ["risk", "compliance", "audit", "vendor", "asset", "pilot", "appsec", "surface", "access", "watch"],
    autosaveKey: "tprm_autosave",
    initDataVar: "TPRM_INIT_DATA",
    filePrefix: "TPRM",
    labelKey: "toolbar.subtitle",
    getSociete: function(data) { return (data.metadata && data.metadata.organization) || ""; },
    getDate: function(data) { return (data.metadata && data.metadata.created) || ""; }
};

// FEAT-36 — schema versioning: rev 2 = assessments V2 (BUG-17 migration
// becomes link 1→2 of the chain; the ad hoc call in _initDataAndRender is gone).
window.SCHEMA_REV = 2;
window.SCHEMA_MIGRATIONS = { 1: function() { _migrateAllLegacyAssessments(); } };


var _panel = "dashboard";
var D: TprmData = JSON.parse(JSON.stringify(TPRM_INIT_DATA));
var _selectedVendor: number | null = null;
var _vendorTab = "info";
// Top-level tab on the Vendors page: "vendors" (default list) | "subcontractors" (DORA global subs)
var _vendorListTab = "vendors";

// ═══════════════════════════════════════════════════════════════
// SIDEBAR + NAVIGATION
// ═══════════════════════════════════════════════════════════════

// Badges Vendor. Deux natures, deux primitives (spec §2) : un NIVEAU se mappe
// sur un ton fermé, une RÉFÉRENCE (le cadre réglementaire, le type de modèle)
// est une identité et prend .ct-ref.
var _VENDOR_TONES: Record<string, string> = {
    critical: "critical", high: "high", medium: "medium", low: "low",
    blocker: "critical", major: "high", info: "info",
};

function _vendorTone(v?: string | null): string {
    return _VENDOR_TONES[(v || "").toString()] || "neutral";
}

function selectPanel(id: any) {
    _panel = id;
    _selectedVendor = null;
    document.querySelector(".ct-rail, .sidebar")?.classList.remove("open");
    _updateSidebarAccordion(id);
    renderPanel();
}

window.selectVendorListTab = function(tab: any) {
    _vendorListTab = tab;
    // Make sure the DORA tree is loaded before showing the subs tab —
    // _renderSubcontractors reads _doraTree.subcontractors directly.
    if (tab === "subcontractors" && window.DoraData && !window.DoraData.getTree()) {
        window.DoraData.ensureLoaded(function() { renderPanel(); });
    }
    renderPanel();
};

// SVG icons: _icon(name) is provided by shared/js/cisotoolbox.js

function renderPanel() {
    var c = document.getElementById("content");
    _docsTableCounter = 0;
    // Measure edit form takes priority
    // Handle broken logo images — fallback to initials
    setTimeout(function() {
        document.querySelectorAll(".vendor-logo-img").forEach(function(img) {
            img.addEventListener("error", function() {
                var initials = img.getAttribute("data-initials") || "?";
                var fallback = document.createElement("span");
                fallback.className = "vendor-initials";
                fallback.textContent = initials;
                img.replaceWith(fallback);
            });
        });
    }, 50);
    switch (_panel) {
        case "dashboard": c!.innerHTML = renderDashboard(); break;
        case "vendors": c!.innerHTML = _selectedVendor !== null ? renderVendorDetail() : renderVendorList(); break;
        case "risks": c!.innerHTML = renderRiskList(); break;
        case "measures": c!.innerHTML = renderGlobalMeasures(); break;
        case "assessments": c!.innerHTML = _selectedVendor !== null ? renderVendorDetail() : renderVendorList(); _vendorTab = "assessments"; break;
        case "documents": c!.innerHTML = renderDocList(); break;
        case "templates":
            if (_editingTemplateId) { c!.innerHTML = renderTemplateEditor(_editingTemplateId); }
            else { c!.innerHTML = renderTemplateList(); }
            break;
        case "dora":
            if (typeof renderDoraPanel === "function") {
                c!.innerHTML = '<div id="dora-root"></div>';
                renderDoraPanel(document.getElementById("dora-root")!);
            } else {
                c!.innerHTML = '<h2>' + t("nav.dora") + '</h2><p>' + t("dora.unavailable") + '</p>';
            }
            break;
        default: c!.innerHTML = renderDashboard();
    }
    _initSliders();
    _initTimelineDrag();
    // Setup column hide/show and resize for all tables in current view
    _setupTable("risk-list-table");
    _setupTable("vendor-risks-table");
    _setupTable("vendor-measures-table");
    _setupTable("global-measures-table");
    // Docs tables use auto-incrementing IDs
    for (var _dti = 0; _dti < _docsTableCounter; _dti++) _setupTable("docs-table-" + _dti);
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

function renderDashboard() {
    var v = D.vendors, r = D.risks, a = D.assessments;
    var criticalCount = v.filter(function(x) { var tier = _getTier(x); return tier === "critical"; }).length;
    var highRiskCount = r.filter(function(x) { var sc = (x.impact||0) * (x.likelihood||0); return sc >= 15; }).length;
    var openRisks = r.filter(function(x) { return x.status === "needs_treatment" || x.status === "active"; }).length;
    var pendingAssess = a.filter(function(x) { return x.status !== "completed"; }).length;
    var expiring = _getExpiringItems().length;

    var h = '<h2>' + t("dashboard.title") + '</h2>';
    // Cards
    h += '<div class="ct-kpigrid ct-mb-4">';
    h += _card(v.length, t("dashboard.total_vendors"), "");
    h += _card(criticalCount, t("dashboard.critical_vendors"), _kpiTone(criticalCount, { bad: 1 }));
    h += _card(highRiskCount, t("dashboard.critical_risks"), _kpiTone(highRiskCount, { bad: 1 }));
    h += _card(pendingAssess, t("dashboard.pending_assessments"), _kpiTone(pendingAssess, { warn: 1 }));
    h += _card(openRisks, t("dashboard.open_risks"), _kpiTone(openRisks, { bad: 1 }));
    h += _card(expiring, t("dashboard.expiring_soon", { days: _deadlineDays }), _kpiTone(expiring, { warn: 1 }));
    h += '</div>';

    // Row 1: Two matrices side by side
    h += '<div class="dash-risk-row">';
    var _today = new Date().toISOString().split("T")[0];
    var _todayLabel = _today.split("-").reverse().join("/");
    h += '<div class="risk-matrix-container dash-matrix"><h3 class="ct-text-data ct-mb-1">' + t("dashboard.risk_matrix") + ' <span class="ct-normal ct-text-meta ct-journal-sep">(' + esc(_todayLabel) + ')</span></h3>';
    h += _renderResidualMatrix(null);
    h += '</div>';
    var _endDate = _getLastMeasureDate();
    var _endLabel = _endDate ? _endDate.split("-").reverse().join("/") : _todayLabel;
    h += '<div class="risk-matrix-container dash-matrix"><h3 class="ct-text-data ct-mb-1"><span id="residual-matrix-title">' + t("dashboard.residual_matrix") + '</span> <span id="residual-date-label" class="ct-normal ct-text-meta ct-journal-sep">(' + esc(_endLabel) + ')</span></h3>';
    h += '<div id="residual-matrix-svg">' + _renderResidualMatrix(_endDate || null) + '</div>';
    h += '</div>';
    h += '</div>';

    // Row 2: Timeline full width
    if (r.length > 0) {
        h += '<div class="risk-matrix-container dash-timeline ct-mb-3">';
        h += '<h3 class="ct-text-data ct-mb-1">' + t("dashboard.risk_timeline") + '</h3>';
        h += _renderRiskTimeline();
        h += '</div>';
    }

    // Row 3: Top risks + Upcoming deadlines side by side
    h += '<div class="dash-grid-2col ct-grid ct-grid-2 ct-gap-4">';
    h += '<div class="ct-bg-surface ct-bordered ct-r-lg ct-p-3">';
    h += '<h3 class="ct-text-data ct-mb-2">' + t("dashboard.top_risks") + '</h3>';
    var topR = r.filter(function(x) { return x.status !== "closed" && x.status !== "archived"; })
        .sort(function(a, b) { return (b.impact * b.likelihood) - (a.impact * a.likelihood); }).slice(0, 5);
    if (!topR.length) h += '<div class="ct-muted ct-text-meta">' + t("risk.empty") + '</div>';
    topR.forEach(function(ri) {
        var vn = _vendorName(ri.vendor_id);
        var sc = ri.impact * ri.likelihood;
        h += '<div class="ct-flex ct-items-center ct-gap-2 ct-py-1 ct-px-0 ct-text-meta">';
        h += '<span class="' + _scoreClass(sc) + '" style="font-weight:700;min-width:24px">' + sc + '</span>';
        h += '<span class="ct-flex-1">' + esc(ri.title) + '</span>';
        h += '<span class="ct-muted ct-text-label">' + esc(vn) + '</span>';
        h += '</div>';
    });
    h += '</div>';

    h += '<div class="ct-bg-surface ct-bordered ct-r-lg ct-p-3">';
    h += '<div class="ct-flex ct-items-center ct-gap-2 ct-mb-2">';
    h += '<h3 class="ct-text-data ct-m-0 ct-flex-1">' + t("dashboard.upcoming_deadlines") + '</h3>';
    h += '<div class="ct-flex ct-gap-1">';
    [30, 60, 90].forEach(function(d) {
        var active = _deadlineDays === d ? "background:var(--ct-accent);color:white" : "background:var(--ct-canvas);color:var(--ct-ink-2)";
        h += '<button style="border:none;padding:3px 8px;border-radius:4px;font-size:var(--ct-text-label);font-weight:600;cursor:pointer;' + active + '" data-click="setDeadlineDays" data-args=\'[' + d + ']\'>' + d + 'j</button>';
    });
    h += '</div></div>';
    var deadlines = _getExpiringItems();
    if (!deadlines.length) h += '<div class="ct-muted ct-text-meta">-</div>';
    deadlines.slice(0, 8).forEach(function(d) {
        h += '<div class="ct-flex ct-items-center ct-gap-2 ct-py-1 ct-px-0 ct-text-meta">';
        h += '<span class="ct-text-high ct-strong ct-minw-80">' + esc(d.date) + '</span>';
        h += '<span class="ct-flex-1">' + esc(d.label) + '</span>';
        h += '</div>';
    });
    h += '</div>';
    h += '</div>';

    return h;
}

function _renderRiskTimeline() {
    var risks = D.risks.filter(function(r) { return r.status !== "closed" && r.status !== "archived"; });
    if (!risks.length) return '<div class="ct-muted ct-text-meta">-</div>';

    // Collect all measure deadlines as transition dates
    var dates = [];
    var now = new Date();
    var today = now.toISOString().split("T")[0];
    dates.push(today);

    // Find min/max dates for the timeline
    D.vendors.forEach(function(v) {
        (v.measures || []).forEach(function(m) {
            if (m.echeance) dates.push(m.echeance);
        });
    });
    risks.forEach(function(r) {
        if (r.treatment && r.treatment.due_date) dates.push(r.treatment.due_date);
    });

    if (dates.length < 2) return '<div class="ct-muted ct-text-meta">-</div>';

    dates.sort();
    // Timeline: from 6 months ago to 12 months ahead
    var startDate = new Date(now.getTime() - 180 * 86400000);
    var endDate = new Date(now.getTime() + 365 * 86400000);
    var startStr = startDate.toISOString().split("T")[0];
    var endStr = endDate.toISOString().split("T")[0];

    // Build monthly time points
    var points = [];
    var d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (d <= endDate) {
        points.push(d.toISOString().split("T")[0]);
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }

    // Matrix color lookup — same colors as the risk matrices
    var _matColors = [
        ["var(--ct-low-fill)","var(--ct-low-fill)","var(--ct-medium-fill)","var(--ct-high-fill)","var(--ct-critical-fill)"],
        ["var(--ct-low-fill)","var(--ct-medium-fill)","var(--ct-high-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)"],
        ["var(--ct-medium-fill)","var(--ct-high-fill)","var(--ct-high-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)"],
        ["var(--ct-high-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)"],
        ["var(--ct-critical-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)","var(--tprm-extreme)"]
    ];
    function _matColor(imp: any, lik: any) {
        return _matColors[Math.min(Math.max(lik, 1), 5) - 1][Math.min(Math.max(imp, 1), 5) - 1];
    }

    // Timeline levels = distinct matrix colors (ordered from critical to low)
    var levels = [
        { label: t("vendor.exposure_critical"), color: "var(--tprm-extreme)" },
        { label: t("vendor.exposure_high"), color: "var(--ct-critical-fill)" },
        { label: t("vendor.exposure_moderate"), color: "var(--ct-critical-fill)" },
        { label: "", color: "var(--ct-high-fill)" },
        { label: "", color: "var(--ct-medium-fill)" },
        { label: t("vendor.exposure_low"), color: "var(--ct-low-fill)" }
    ];

    var series = levels.map(function(): number[] { return []; });

    points.forEach(function(dateStr) {
        var counts = levels.map(function() { return 0; });
        risks.forEach(function(r) {
            var imp = r.impact || 1, lik = r.likelihood || 1;
            var resI = r.residual_impact || 0, resL = r.residual_likelihood || 0;
            var hasResidual = resI > 0 && resL > 0;
            var measuresApplied = false;

            if (hasResidual) {
                var v = D.vendors.find(function(x) { return x.id === r.vendor_id; });
                if (v && v.measures) {
                    var linkedIds = (r.linked_measures || "").split(",").map(function(s) { return s.trim().split(" - ")[0].trim(); }).filter(Boolean);
                    var allMeasuresDone = linkedIds.length > 0 && linkedIds.every(function(mid) {
                        var m = v!.measures!.find(function(x) { return x.id === mid; });
                        return m && m.echeance && m.echeance <= dateStr;
                    });
                    if (allMeasuresDone) measuresApplied = true;
                }
                if (r.treatment && r.treatment.due_date && r.treatment.due_date <= dateStr) measuresApplied = true;
            }

            var eImp = measuresApplied ? resI : imp;
            var eLik = measuresApplied ? resL : lik;
            var color = _matColor(eImp, eLik);

            for (var li = 0; li < levels.length; li++) {
                if (color === levels[li].color) { counts[li]++; break; }
            }
        });
        for (var li = 0; li < levels.length; li++) series[li].push(counts[li]);
    });

    // SVG stacked area chart
    var W = 600, H = 200, ML = 30, MR = 10, MT = 10, MB = 40;
    var cW = W - ML - MR, cH = H - MT - MB;
    var maxVal = 0;
    points.forEach(function(_, pi) {
        var sum = 0;
        for (var li = 0; li < levels.length; li++) sum += series[li][pi];
        if (sum > maxVal) maxVal = sum;
    });
    if (maxVal === 0) maxVal = 1;

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ct-w-full">';

    // Grid lines
    for (var g = 0; g <= 4; g++) {
        var gy = MT + cH - (g / 4 * cH);
        svg += '<line x1="' + ML + '" y1="' + gy + '" x2="' + (W - MR) + '" y2="' + gy + '" stroke="var(--ct-line)" stroke-width="0.5"/>';
        svg += '<text x="' + (ML - 4) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="8" fill="#94a3b8">' + Math.round(g / 4 * maxVal) + '</text>';
    }

    // Draggable date line
    var todayIdx = -1;
    for (var pi = 0; pi < points.length; pi++) {
        if (points[pi] >= today) { todayIdx = pi; break; }
    }
    // Store timeline metadata for drag handler
    var _tlMeta = { ML: ML, MR: MR, MT: MT, MB: MB, W: W, H: H, cW: cW, points: points, startDate: startDate, endDate: endDate };
    window._timelineMeta = _tlMeta;
    var initTx = todayIdx >= 0 ? ML + (todayIdx / (points.length - 1)) * cW : ML;
    // Fixed "today" dashed line
    if (todayIdx >= 0) {
        svg += '<line x1="' + initTx + '" y1="' + MT + '" x2="' + initTx + '" y2="' + (H - MB) + '" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,3" style="pointer-events:none"/>';
        svg += '<text x="' + initTx + '" y="' + (MT - 3) + '" text-anchor="middle" font-size="7" fill="#94a3b8">' + t("dashboard.today") + '</text>';
    }
    // Invisible drag zone (wide hit area)
    svg += '<rect id="tl-drag-zone" x="' + ML + '" y="' + MT + '" width="' + cW + '" height="' + (H - MT - MB) + '" fill="transparent" style="cursor:col-resize"/>';
    // Draggable blue line
    svg += '<line id="tl-dateline" x1="' + initTx + '" y1="' + MT + '" x2="' + initTx + '" y2="' + (H - MB) + '" stroke="var(--ct-accent)" stroke-width="2" style="pointer-events:none"/>';
    svg += '<text id="tl-dateline-label" x="' + initTx + '" y="' + (H - MB + 12) + '" text-anchor="middle" font-size="8" fill="var(--ct-accent)" font-weight="600">' + t("dashboard.today") + '</text>';

    // Smooth lines per risk level (cardinal spline)
    for (var li = 0; li < levels.length; li++) {
        var pts = [];
        for (var pi = 0; pi < points.length; pi++) {
            pts.push({
                x: ML + (pi / (points.length - 1)) * cW,
                y: MT + cH - (series[li][pi] / maxVal * cH)
            });
        }
        if (pts.length < 2) continue;
        var pathD = "M" + pts[0].x + "," + pts[0].y;
        for (var i = 0; i < pts.length - 1; i++) {
            var p0 = pts[Math.max(i - 1, 0)];
            var p1 = pts[i];
            var p2 = pts[i + 1];
            var p3 = pts[Math.min(i + 2, pts.length - 1)];
            var cp1x = p1.x + (p2.x - p0.x) / 6;
            var cp1y = Math.min(p1.y + (p2.y - p0.y) / 6, MT + cH);
            var cp2x = p2.x - (p3.x - p1.x) / 6;
            var cp2y = Math.min(p2.y - (p3.y - p1.y) / 6, MT + cH);
            pathD += " C" + cp1x.toFixed(1) + "," + cp1y.toFixed(1) + " " + cp2x.toFixed(1) + "," + cp2y.toFixed(1) + " " + p2.x.toFixed(1) + "," + p2.y.toFixed(1);
        }
        svg += '<path d="' + pathD + '" fill="none" stroke="' + levels[li].color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    }

    // X axis labels (months)
    points.forEach(function(dateStr, pi) {
        if (pi % 2 !== 0 && pi !== points.length - 1) return;
        var x = ML + (pi / (points.length - 1)) * cW;
        var parts = dateStr.split("-");
        var label = parts[1] + "/" + parts[0].substring(2);
        svg += '<text x="' + x + '" y="' + (H - MB + 22) + '" text-anchor="middle" font-size="7" fill="#94a3b8">' + label + '</text>';
    });

    svg += '</svg>';

    // Legend (same as matrices)
    svg += '<div class="matrix-legend ct-flex ct-gap-2 ct-justify-center ct-mt-1 ct-text-label">';
    svg += '<span class="ct-flex ct-items-center ct-gap-1"><span style="width:14px;height:3px;border-radius:1px;background:var(--ct-low-fill)"></span>' + t("vendor.exposure_low") + '</span>';
    svg += '<span class="ct-flex ct-items-center ct-gap-1"><span style="width:14px;height:3px;border-radius:1px;background:var(--ct-medium-fill)"></span>' + t("vendor.exposure_moderate") + '</span>';
    svg += '<span class="ct-flex ct-items-center ct-gap-1"><span style="width:14px;height:3px;border-radius:1px;background:var(--ct-high-fill)"></span>' + t("vendor.exposure_significant") + '</span>';
    svg += '<span class="ct-flex ct-items-center ct-gap-1"><span style="width:14px;height:3px;border-radius:1px;background:var(--ct-critical-fill)"></span>' + t("vendor.exposure_high") + '</span>';
    svg += '<span class="ct-flex ct-items-center ct-gap-1"><span style="width:14px;height:3px;border-radius:1px;background:var(--ct-critical-fill)"></span>' + t("vendor.exposure_critical") + '</span>';
    svg += '<span class="ct-flex ct-items-center ct-gap-1"><span style="width:14px;height:3px;border-radius:1px;background:var(--tprm-extreme)"></span>' + t("vendor.exposure_extreme") + '</span>';
    svg += '</div>';

    return svg;
}

function _card(val: string | number, label: any, cls: any) {
    var tone = cls === "warning" ? "medium" : (cls === "critical" || cls === "high" || cls === "medium" || cls === "low" || cls === "info" ? cls : "");
    var a = tone ? ' data-emphasis="value" data-tone="' + tone + '"' : '';
    return '<div class="ct-kpi"' + a + '><div class="ct-kpi-tone"></div><div class="ct-kpi-body"><div class="ct-kpi-label">' + esc(label) + '</div><div class="ct-kpi-value">' + val + '</div></div></div>';
}

var _deadlineDays = 90;

function setDeadlineDays(days: any) {
    _deadlineDays = parseInt(days) || 90;
    renderPanel();
}
window.setDeadlineDays = setDeadlineDays;

function _getExpiringItems() {
    var items: { date: string; label: string }[] = [], now = new Date(), limit = new Date(now.getTime() + _deadlineDays * 86400000);
    D.vendors.forEach(function(v) {
        if (v.contract && v.contract.end_date) {
            var d = new Date(v.contract.end_date);
            if (d > now && d < limit) items.push({ date: v.contract.end_date, label: v.name + " — " + t("vendor.contract_end") });
        }
        if (v.contract && v.contract.review_date) {
            var dr = new Date(v.contract.review_date);
            if (dr > now && dr < limit) items.push({ date: v.contract.review_date, label: v.name + " — " + t("vendor.review_date") });
        }
        (v.certifications || []).forEach(function(c) {
            if (c.expiry_date) {
                var d2 = new Date(c.expiry_date);
                if (d2 > now && d2 < limit) items.push({ date: c.expiry_date, label: v.name + " — " + c.name });
            }
        });
    });
    items.sort(function(a, b) { return a.date.localeCompare(b.date); });
    return items;
}

// ═══════════════════════════════════════════════════════════════
// RISK MATRIX (SVG)
// ═══════════════════════════════════════════════════════════════

function _getLastMeasureDate() {
    var last = "";
    D.vendors.forEach(function(v) {
        (v.measures || []).forEach(function(m) {
            if (m.echeance && m.echeance > last) last = m.echeance;
        });
    });
    D.risks.forEach(function(r) {
        if (r.treatment && r.treatment.due_date && r.treatment.due_date > last) last = r.treatment.due_date;
    });
    return last || "";
}

function _renderResidualMatrix(atDate: any) {
    var active = D.risks.filter(function(r) { return r.status !== "closed" && r.status !== "archived"; });
    var checkDate = atDate || new Date().toISOString().split("T")[0];
    var grid: Record<string, any> = {};
    active.forEach(function(r) {
        var imp = r.impact || 1, lik = r.likelihood || 1;
        var resI = r.residual_impact || 0, resL = r.residual_likelihood || 0;
        var hasResidual = resI > 0 && resL > 0;

        if (hasResidual) {
            var measuresApplied = false;
            var v = D.vendors.find(function(x) { return x.id === r.vendor_id; });
            if (v && v.measures) {
                var linkedIds = (r.linked_measures || "").split(",").map(function(s) { return s.trim().split(" - ")[0].trim(); }).filter(Boolean);
                var allDone = linkedIds.length > 0 && linkedIds.every(function(mid) {
                    var m = v!.measures!.find(function(x) { return x.id === mid; });
                    return m && m.echeance && m.echeance <= checkDate;
                });
                if (allDone) measuresApplied = true;
            }
            if (r.treatment && r.treatment.due_date && r.treatment.due_date <= checkDate) measuresApplied = true;
            if (measuresApplied) { imp = resI; lik = resL; }
        }

        var k = imp + "-" + lik;
        if (!grid[k]) grid[k] = [];
        grid[k].push({ id: r.id, label: r.title, impact: imp, likelihood: lik, vendor_id: r.vendor_id });
    });
    return ctRenderMatrix({
        levels: 5,
        xLabel: t("risk.impact"),
        yLabel: t("risk.likelihood"),
        grid: grid,
        // Token-based colors (theme-aware) instead of the hard-coded light
        // pastels of CT_COLORS.matrix5 — same mapping as the dashboard
        // timeline (_matColors): -tint per severity, solid critical for max.
        colors: [
            ["var(--ct-low-fill)","var(--ct-low-fill)","var(--ct-medium-fill)","var(--ct-high-fill)","var(--ct-critical-fill)"],
            ["var(--ct-low-fill)","var(--ct-medium-fill)","var(--ct-high-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)"],
            ["var(--ct-medium-fill)","var(--ct-high-fill)","var(--ct-high-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)"],
            ["var(--ct-high-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)"],
            ["var(--ct-critical-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)","var(--ct-critical-fill)","var(--tprm-extreme)"]
        ],
        legend: [
            { label: t("matrix.low") || "Faible", color: "var(--ct-low-fill)" },
            { label: t("matrix.moderate") || "Moyen", color: "var(--ct-medium-fill)" },
            { label: t("matrix.significant") || "Significatif", color: "var(--ct-high-fill)" },
            { label: t("matrix.high") || "Eleve", color: "var(--ct-critical-fill)" },
            { label: t("matrix.critical") || "Critique", color: "var(--ct-critical-fill)" },
            { label: t("matrix.extreme") || "Extreme", color: "var(--tprm-extreme)" }
        ],
        // CtMatrixItem (decl shared) n'a pas d'index signature — les items
        // portent impact/likelihood/vendor_id en plus : annotation locale any[].
        tooltipFn: function(items: any[]) {
            return items.map(function(r) {
                var sc = (r.impact || 1) * (r.likelihood || 1);
                return '<div class="ct-flex ct-gap-1 ct-items-center ct-py-1 ct-px-0">'
                    + '<span class="' + _scoreClass(sc) + '" style="font-weight:700;min-width:18px">' + sc + '</span>'
                    + '<span class="ct-flex-1">' + esc(r.label || "") + '</span>'
                    + '<span class="ct-ink-2 ct-text-meta">' + esc(_vendorName(r.vendor_id)) + '</span>'
                    + '</div>';
            }).join("");
        }
    });
}

function _initTimelineDrag() {
    var zone = document.getElementById("tl-drag-zone");
    if (!zone) return;
    var svg = zone.closest("svg");
    var line = document.getElementById("tl-dateline");
    var label = document.getElementById("tl-dateline-label");
    var meta = window._timelineMeta;
    if (!svg || !line || !meta) return;

    function _xToDate(clientX: any) {
        var rect = svg!.getBoundingClientRect();
        var svgX = (clientX - rect.left) / rect.width * meta!.W;
        var pct = Math.max(0, Math.min(1, (svgX - meta!.ML) / meta!.cW));
        var ms = meta!.startDate.getTime() + pct * (meta!.endDate.getTime() - meta!.startDate.getTime());
        return new Date(ms);
    }

    function _moveTo(clientX: any) {
        var rect = svg!.getBoundingClientRect();
        var svgX = (clientX - rect.left) / rect.width * meta!.W;
        svgX = Math.max(meta!.ML, Math.min(meta!.ML + meta!.cW, svgX));
        line!.setAttribute("x1", String(svgX));
        line!.setAttribute("x2", String(svgX));
        label!.setAttribute("x", String(svgX));
        var d = _xToDate(clientX);
        var dateStr = d.toISOString().split("T")[0];
        label!.textContent = dateStr;
        // Update residual matrix
        var container = document.getElementById("residual-matrix-svg");
        if (container) container.innerHTML = _renderResidualMatrix(dateStr);
        var dateLabel = document.getElementById("residual-date-label");
        if (dateLabel) dateLabel.textContent = "(" + dateStr + ")";
        var titleEl = document.getElementById("residual-matrix-title");
        var today = new Date().toISOString().split("T")[0];
        if (titleEl) titleEl.textContent = dateStr < today ? t("dashboard.past_matrix") : t("dashboard.residual_matrix");
    }

    var dragging = false;
    zone.addEventListener("mousedown", function(e) { dragging = true; _moveTo(e.clientX); e.preventDefault(); });
    zone.addEventListener("touchstart", function(e) { dragging = true; _moveTo(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
    document.addEventListener("mousemove", function(e) { if (dragging) _moveTo(e.clientX); });
    document.addEventListener("touchmove", function(e) { if (dragging) _moveTo(e.touches[0].clientX); }, { passive: false });
    document.addEventListener("mouseup", function() { dragging = false; });
    document.addEventListener("touchend", function() { dragging = false; });
    // Click anywhere on timeline also moves the line
    zone.addEventListener("click", function(e) { _moveTo(e.clientX); });
}

// ═══════════════════════════════════════════════════════════════
// VENDOR LIST
// ═══════════════════════════════════════════════════════════════

var _vendorFilter = "";
var _vendorStatusFilter = "";
var _subFilter = "";

function filterVendors(val: string) { _vendorFilter = (val || "").toLowerCase(); renderPanel(); }
window.filterVendors = filterVendors;
function filterVendorStatus(val: string) { _vendorStatusFilter = val || ""; renderPanel(); }
window.filterVendorStatus = filterVendorStatus;
window.filterSubs = function(val: string) { _subFilter = (val || "").toLowerCase(); renderPanel(); };

// Card-based listing of project-wide subcontractors (DORA global identities).
// Mirrors the vendor list visual language (header + search + cards) so users
// move between Vendors and Sous-traitants without context switch.
function renderSubcontractorList() {
    if (!window.DoraData || !window.DoraData.getTree()) {
        // Tree still loading — selectVendorListTab triggered ensureLoaded.
        return '<div class="ct-empty-state">' + esc(t("dora.unavailable")) + '</div>';
    }
    var tree = window.DoraData.getTree();
    var subs = (tree!.subcontractors || []).slice();
    var links = tree!.subcontractor_links || [];
    var arrs = tree!.arrangements || [];
    var arrById: Record<string, any> = {}; arrs.forEach(function(a) { arrById[a.id] = a; });
    var vById: Record<string, any> = {}; (D.vendors || []).forEach(function(v) { vById[v.id] = v; });
    var linksBySub: Record<string, any> = {};
    links.forEach(function(l) {
        if (!linksBySub[l.subcontractor_id]) linksBySub[l.subcontractor_id] = [];
        linksBySub[l.subcontractor_id].push(l);
    });

    var h = '<div class="ct-row ct-row-between ct-mb-3">';
    h += '<h2 class="ct-m-0">' + t("vendor.subs_title") + '</h2>';
    h += '<div class="ct-flex ct-gap-2">';
    h += '<button class="ct-btn" data-variant="primary" data-size="xs" data-click="doraAddSub">' + t("dora.add_subcontractor") + '</button>';
    h += '</div></div>';

    h += '<p class="ct-panel-desc" style="margin:0 0 var(--ct-s3) 0">' + esc(t("dora.subs.intro")) + '</p>';

    // Search bar (mirrors vendor list).
    h += '<div class="ct-flex ct-gap-2 ct-mb-3 ct-row-wrap">';
    h += '<input type="text" placeholder="🔍 ' + esc(t("vendor.search")) + '" value="' + esc(_subFilter) + '" class="ct-flex-1 ct-minw-180 ct-py-1 ct-px-2 ct-bordered ct-r-md ct-text-meta" data-input="filterSubs" data-pass-value>';
    h += '</div>';

    if (!subs.length) return h + '<div class="ct-empty-state">' + esc(t("dora.subs.empty")) + '</div>';

    var q = _subFilter;
    var count = 0;
    subs.forEach(function(s) {
        if (q) {
            var hay = ((s.name || "") + " " + (s.lei || "") + " " + (s.country_iso2 || "") + " " + (s.sector || "") + " " + (s.id || "")).toLowerCase();
            if (hay.indexOf(q) < 0) return;
        }
        count++;
        var subLinks = linksBySub[s.id] || [];
        var critN = subLinks.filter(function(l: any) { return l.is_critical_function_support; }).length;
        // Distinct vendors served via these links.
        var vSet: Record<string, any> = {};
        subLinks.forEach(function(l: any) {
            var a = arrById[l.arrangement_id];
            if (a && a.vendor_id) vSet[a.vendor_id] = true;
        });
        var vendorNames = Object.keys(vSet).map(function(vid) {
            var v = vById[vid]; return v ? v.name : vid;
        });

        h += '<div class="vendor-card" data-click="doraOpenSubIdentityModal" data-args=\'["' + esc(s.id) + '"]\'>';
        // Left: name, LEI, country, sector
        h += '<div class="vendor-card-left">';
        h += '<span class="vendor-name">' + esc(s.name || s.id) + '</span>';
        if (s.lei) h += '<code class="ct-text-label ct-muted">' + esc(s.lei) + '</code>';
        if (s.country_iso2) h += '<span class="ct-text-label ct-muted">' + esc(s.country_iso2) + '</span>';
        if (s.sector) h += '<span class="ct-badge ct-bg-alt ct-muted" data-tone="neutral">' + esc(s.sector) + '</span>';
        if (critN > 0) h += '<span class="ct-ref ct-bg-high-tint ct-text-high-ink" data-size="sm">★ ' + critN + ' CIF</span>';
        h += '</div>';
        // Right: link counts + vendor badges
        h += '<div class="vendor-card-right">';
        if (subLinks.length === 0) {
            h += '<span class="ct-muted">' + esc(t("dora.subs.no_links_short")) + '</span>';
        } else {
            h += '<span class="ct-ink ct-strong">' + subLinks.length + ' ' + esc(t("dora.subs.linked_arrangements_short")) + '</span>';
            if (vendorNames.length > 0) {
                h += '<span class="vendor-card-sep">·</span>';
                h += '<span class="ct-muted">' + esc(vendorNames.slice(0, 3).join(", ")) + (vendorNames.length > 3 ? " +" + (vendorNames.length - 3) : "") + '</span>';
            }
        }
        h += '</div>';
        h += '</div>';
    });
    if (count === 0 && q) {
        h += '<div class="ct-empty-state">' + esc(t("vendor.no_results")) + '</div>';
    }
    return h;
}

function renderVendorList() {
    // Lazy-load the DORA tree so we can show DORA badges on vendor cards.
    if (window.DoraData && !window.DoraData.getTree()) {
        window.DoraData.ensureLoaded(function(tree) {
            if (tree) renderPanel();   // re-render once the tree is ready
        });
    }
    // Tab bar: Vendors | Subcontractors (global DORA subs).
    // Segmented-control style — same visual language as the vendor detail tabs.
    var tabsH = '<div class="ct-inline-flex ct-bg-alt ct-bordered ct-r-lg ct-p-1 ct-mb-4 ct-gap-1">';
    var _mkTab = function(id: any, label: any, count: any) {
        var active = _vendorListTab === id;
        var bg = active ? "var(--ct-surface)" : "transparent";
        var color = active ? "var(--ct-ink)" : "var(--ct-ink-2)";
        var shadow = active ? "0 1px 3px rgba(0,0,0,0.08)" : "none";
        var weight = active ? "700" : "500";
        var countHtml = (count != null) ? ' <span style="opacity:0.7;font-weight:500">(' + count + ')</span>' : '';
        return '<button data-click="selectVendorListTab" data-args=\'["' + id + '"]\' '
             + 'style="padding:8px 18px;font-size:var(--ct-text-data);font-weight:' + weight + ';color:' + color + ';background:' + bg + ';border:none;border-radius:6px;cursor:pointer;box-shadow:' + shadow + ';transition:all 0.15s">'
             + esc(label) + countHtml + '</button>';
    };
    var _vendorCount = (D.vendors || []).length;
    var _subCount = (window.DoraData && window.DoraData.getTree()) ? ((window.DoraData.getTree()!.subcontractors || []).length) : 0;
    tabsH += _mkTab("vendors", t("vendor.tab_vendors"), _vendorCount);
    tabsH += _mkTab("subcontractors", t("vendor.tab_subcontractors"), _subCount);
    tabsH += '</div>';

    if (_vendorListTab === "subcontractors") {
        return tabsH + renderSubcontractorList();
    }

    var h = tabsH;
    h += '<div class="ct-row ct-row-between ct-mb-3">';
    h += '<h2 class="ct-m-0">' + t("vendor.title") + '</h2>';
    h += '<div class="ct-flex ct-gap-2">';
    h += '<button class="ct-btn" data-variant="primary" data-size="xs" data-click="addVendor">' + t("vendor.add") + '</button>';
    h += '</div></div>';

    // Search + filter bar
    h += '<div class="ct-flex ct-gap-2 ct-mb-3 ct-row-wrap">';
    h += '<input type="text" placeholder="🔍 ' + esc(t("vendor.search")) + '" value="' + esc(_vendorFilter) + '" class="ct-flex-1 ct-minw-180 ct-py-1 ct-px-2 ct-bordered ct-r-md ct-text-meta" data-input="filterVendors" data-pass-value>';
    h += '<select class="ct-filter" data-change="filterVendorStatus" data-pass-value>';
    h += '<option value="">' + t("vendor.filter_all") + '</option>';
    h += '<option value="active"' + (_vendorStatusFilter === "active" ? ' selected' : '') + '>' + t("vendor.status_active") + '</option>';
    h += '<option value="prospect"' + (_vendorStatusFilter === "prospect" ? ' selected' : '') + '>' + t("vendor.status_prospect") + '</option>';
    h += '<option value="review"' + (_vendorStatusFilter === "review" ? ' selected' : '') + '>' + t("vendor.status_review") + '</option>';
    h += '<option value="offboarded"' + (_vendorStatusFilter === "offboarded" ? ' selected' : '') + '>' + t("vendor.status_offboarded") + '</option>';
    h += '</select>';
    h += '</div>';

    if (!D.vendors.length) return h + '<div class="ct-empty-state">' + t("vendor.empty") + '</div>';

    var q = _vendorFilter;
    var sf = _vendorStatusFilter;
    var count = 0;

    D.vendors.forEach(function(v, i) {
        // Filter by status
        if (sf && v.status !== sf) return;
        // Filter by search
        if (q) {
            var haystack = ((v.name || "") + " " + (v.sector || "") + " " + (v.legal_entity || "") + " " + (v.id || "")).toLowerCase();
            if (haystack.indexOf(q) < 0) return;
        }
        count++;

        var tier = _getTier(v);
        var statusLabel = t("vendor.status_" + (v.status || "prospect"));
        var statusColor = v.status === "active" ? "var(--ct-low)" : v.status === "offboarded" ? "var(--ct-ink-2)" : v.status === "review" ? "var(--ct-high)" : "var(--ct-accent)";

        // Assessment progress
        var assessments = D.assessments.filter(function(a) { return a.vendor_id === v.id; });
        var lastAssess = assessments.length > 0 ? assessments[assessments.length - 1] : null;
        var completion = lastAssess && lastAssess.completion_rate != null ? lastAssess.completion_rate : null;

        // Next review
        var reviewDate = (v.contract || {}).review_date || "";

        var hasCompletedAssess = assessments.some(function(a) { return a.status === "completed"; });
        var riskCount = D.risks.filter(function(r) { return r.vendor_id === v.id && r.status !== "closed"; }).length;

        h += '<div class="vendor-card" data-click="openVendor" data-args=\'' + _da(i) + '\'>';

        // Left: logo, name, status, tier, DORA/PII badges
        h += '<div class="vendor-card-left">';
        h += _vendorAvatar(v);
        h += '<span class="vendor-name">' + esc(v.name || "") + '</span>';
        h += '<span style="font-size:var(--ct-text-label);font-weight:600;color:' + statusColor + '">' + esc(statusLabel) + '</span>';
        h += '<span class="ct-badge" data-tone="' + _vendorTone(tier) + '">' + t("vendor.tier_" + tier) + '</span>';
        if (_isDoraICTCritical(v.classification)) h += '<span class="ct-ref" data-size="sm">DORA</span>';
        if (v.classification && v.classification.gdpr_subprocessor) h += '<span class="ct-ref" data-size="sm">PII</span>';
        h += '</div>';

        // Right: metrics
        var metrics = [];
        if (riskCount > 0) metrics.push('<span class="ct-text-critical ct-strong">' + riskCount + ' ' + t("nav.risks").toLowerCase() + '</span>');
        if (!hasCompletedAssess) {
            metrics.push('<span class="ct-text-high ct-strong">' + t("vendor.no_assessment") + '</span>');
        } else if (completion != null) {
            metrics.push('<span class="ct-muted">' + t("assessment.completion") + ' ' + completion + '%</span>');
        }
        if (reviewDate) {
            var daysLeft = Math.ceil((new Date(reviewDate).getTime() - new Date().getTime()) / 86400000);
            var rdColor = daysLeft < 0 ? "var(--ct-critical)" : daysLeft < 30 ? "var(--ct-high)" : "var(--ct-ink-2)";
            metrics.push('<span style="color:' + rdColor + '">' + esc(reviewDate) + '</span>');
        }
        // DORA badges (arrangement count, RoI incompleteness)
        if (window.DoraData && window.DoraData.getTree()) {
            var arrs = window.DoraData.arrangementsForVendor(v.id);
            if (arrs.length > 0) {
                var critN = arrs.filter(function(a) { return a.is_critical_function_support; }).length;
                var lbl = arrs.length + " " + t("dora.bridge.arr_short");
                if (critN > 0) lbl += " (" + critN + "★)";
                metrics.push('<span class="ct-ink ct-strong" title="' + esc(t("dora.bridge.arr_tooltip")) + '">DORA · ' + esc(lbl) + '</span>');
            }
            var roi = window.DoraData.roiStatus(v);
            if (!roi.complete && (arrs.length > 0 || _isDoraICTCritical(v.classification))) {
                metrics.push('<span class="ct-text-high-ink ct-strong" title="' + esc(t("dora.bridge.roi_missing") + " : " + roi.missing.join(", ")) + '">⚠ ' + t("dora.bridge.roi_incomplete") + '</span>');
            }
        }
        if (metrics.length) h += '<div class="vendor-card-right">' + metrics.join('<span class="vendor-card-sep">·</span>') + '</div>';

        h += '</div>';
    });

    if (count === 0 && (q || sf)) {
        h += '<div class="ct-empty-state">' + t("vendor.no_results") + '</div>';
    }

    return h;
}

function openVendor(idx: any) {
    _selectedVendor = parseInt(idx);
    _vendorTab = "info";
    renderPanel();
}
window.openVendor = openVendor;

// ═══════════════════════════════════════════════════════════════
// VENDOR DETAIL
// ═══════════════════════════════════════════════════════════════

function renderVendorDetail() {
    var v = D.vendors[_selectedVendor!];
    if (!v) return renderVendorList();
    var tier = _getTier(v);
    // Compute risk scores for header
    var _hdrRisks = D.risks.filter(function(r) { return r.vendor_id === v.id; });
    var _hdrInherent = 0, _hdrResidual = 0, _hdrDueDate = "";
    if (_hdrRisks.length > 0) {
        _hdrInherent = Math.max.apply(null, _hdrRisks.map(function(r) { return (r.impact || 1) * (r.likelihood || 1); }));
        _hdrResidual = Math.max.apply(null, _hdrRisks.map(function(r) {
            var ri = r.residual_impact || r.impact || 1;
            var rl = r.residual_likelihood || r.likelihood || 1;
            return ri * rl;
        }));
        (v.measures || []).filter(function(m: any) { return m.statut !== "termine"; }).forEach(function(m: any) {
            if (m.echeance && m.echeance > _hdrDueDate) _hdrDueDate = m.echeance;
        });
    }

    var h = '<div class="ct-flex ct-items-center ct-gap-2 ct-mb-1 ct-row-wrap">';
    h += '<button class="ct-btn" data-variant="ghost" data-size="sm" data-click="backToVendors">&laquo; ' + t("nav.vendors") + '</button>';
    h += '<h2 class="ct-m-0">' + esc(v.name) + '</h2>';
    h += '<span class="ct-badge" data-tone="' + _vendorTone(tier) + '">' + t("vendor.tier_" + tier) + '</span>';
    if (_isDoraICTCritical(v.classification)) h += '<span class="ct-ref" data-size="sm">DORA</span>';
    if (v.classification && v.classification.gdpr_subprocessor) h += '<span class="ct-ref" data-size="sm">PII</span>';
    h += '<span class="ct-flex-1"></span>';
    h += '<button class="ct-btn" data-variant="danger" data-size="sm" data-click="deleteVendor" data-args=\'' + _da(_selectedVendor) + '\'>' + t("vendor.delete") + '</button>';
    h += '</div>';
    // Info bar: threat level + risk scores
    var ex = v.exposure || {};
    var menace = _computeExposure(ex);
    h += '<div id="vendor-info-bar" class="ct-flex ct-items-center ct-gap-3 ct-mb-2 ct-text-label ct-muted ct-row-wrap">';
    if (menace > 0) {
        h += '<span id="vendor-menace-display">' + t("vendor.threat_level") + ' <strong class="' + _exposureClass(menace) + '">' + menace + ' — ' + _exposureLabel(menace) + '</strong></span>';
    }
    if (_hdrRisks.length > 0) {
        if (menace > 0) h += '<span style="width:1px;height:14px;background:var(--ct-line)"></span>';
        h += '<span>' + t("vendor.inherent_risk") + ' <strong class="' + _scoreClass(_hdrInherent) + '">' + _hdrInherent + '/25</strong></span>';
        h += '<span>' + t("vendor.residual_risk") + ' <strong class="' + _scoreClass(_hdrResidual) + '">' + _hdrResidual + '/25</strong></span>';
        if (_hdrDueDate) h += '<span>' + t("vendor.target_date") + ' <strong>' + esc(_hdrDueDate) + '</strong></span>';
    }
    h += '</div>';

    // Tabs
    h += '<div class="vendor-tabs">';
    ["info", "risks", "assessments", "documents", "dora"].forEach(function(tab) {
        h += '<button class="vendor-tab' + (_vendorTab === tab ? ' active' : '') + '" data-click="setVendorTab" data-args=\'' + _da(tab) + '\'>' + t("vendor.tab_" + tab) + '</button>';
    });
    h += '</div>';

    switch (_vendorTab) {
        case "info": h += _renderVendorForm(v); break;
        case "risks": h += _renderVendorRisks(v); break;
        // measures integrated into risks tab
        case "assessments": h += _renderVendorAssessments(v); break;
        case "documents": h += _renderVendorDocs(v); break;
        case "dora": h += _renderVendorDoraTab(v); break;
    }
    return h;
}

// ── DORA RoI tab inside the vendor edit modal ───────────────────────
// Shows the 9 RoI fields (LEI, legal name latin, country ISO-2,
// person type, entity nature, additional id triplet, ultimate parent)
// + a read-only list of arrangements where the vendor is the TPSP.

function _renderVendorDoraTab(v: any) {
    // Lazy-load the DORA tree on first visit (also pulls codelists).
    if (window.DoraData && !window.DoraData.getTree()) {
        window.DoraData.ensureLoaded(function() { renderPanel(); });
    }
    var cl = (window.DoraData && window.DoraData.codelists()) || {};
    var personType = cl.person_type || [];
    var idTypes = cl.additional_id_type || [];
    var countries = cl.country_iso3166_1 || [];

    // Render an <option> list with translated labels (i18n) and English
    // codes as values. Persistence and Excel export keep ITS codes.
    function _opts(key: any, items: any, current: any) {
        var html = '<option value="">— —</option>';
        items.forEach(function(it: any) {
            var code = it.code !== undefined ? it.code : it;
            var fallback = it.label !== undefined ? it.label : code;
            var label = t("dora.cl." + key + "." + code) || fallback;
            // t() returns the key when missing — guard against that.
            if (label === "dora.cl." + key + "." + code) label = fallback;
            var sel = (current === code) ? " selected" : "";
            html += '<option value="' + esc(code) + '"' + sel + '>' + esc(label) + '</option>';
        });
        return html;
    }

    var roi = (window.DoraData && window.DoraData.roiStatus(v)) || { complete: true, missing: [] };
    var statusBadge = roi.complete
        ? '<span class="ct-ref ct-bg-low-tint ct-text-low-ink" data-size="sm">' + esc(t("dora.bridge.roi_complete")) + '</span>'
        : '<span class="ct-ref ct-bg-high-tint ct-text-high-ink" data-size="sm">⚠ ' + esc(t("dora.bridge.roi_incomplete")) + ' (' + roi.missing.length + ')</span>';

    var h = '<div class="ct-tprm-form" style="max-width:900px">';
    h += '<div class="ct-flex ct-items-center ct-gap-2 ct-mb-1">';
    h += '<h3 class="ct-m-0">' + esc(t("dora.vtab.title")) + '</h3>' + statusBadge;
    h += '</div>';
    h += '<p style="color:var(--ct-ink-2);font-size:var(--ct-text-meta);margin:0 0 var(--ct-s2)">' + esc(t("dora.vtab.intro")) + '</p>';

    // ── Identity (RoI) ──
    h += '<div class="form-section">' + esc(t("dora.vtab.section_identity")) + '</div>';
    h += '<div class="ct-form-grid">';

    var hasAddId = !!(v.additional_id_type || v.additional_id_value);
    var addIdShown = hasAddId || _vroiAddIdOpen === v.id;
    // LEI (full width) with GLEIF lookup trigger + discreet checkbox
    // below to reveal the optional additional-id pair.
    var gleifBtn = (window.DoraData && DoraData.gleifTriggerHtml) ? DoraData.gleifTriggerHtml("vroi-lei") : "";
    h += '<div class="ct-form-row ct-col-span-2"><label>' + esc(t("dora.vtab.lei")) + '</label>';
    h += '<div class="ct-flex ct-items-center ct-gap-1">';
    h += '<input id="vroi-lei" value="' + esc(v.lei || "") + '" placeholder="20 chars, mod-97-10" data-input="patchVendorRoi" data-args=\'' + _da("lei") + '\' data-pass-value class="ct-flex-1">' + gleifBtn;
    h += '</div>';
    h += '<label style="display:inline-flex;align-items:center;gap:var(--ct-s1);margin-top:var(--ct-s1);font-size:var(--ct-text-label);line-height:1.2;white-space:nowrap;color:var(--ct-ink-2);cursor:pointer">';
    h += '<input type="checkbox" id="vroi-add-id-toggle" data-click="toggleVendorRoiAddId"' + (addIdShown ? ' checked' : '') + ' style="margin:0;transform:scale(0.85)">';
    h += esc(t("dora.vtab.add_additional_id"));
    h += '</label>';
    h += '</div>';

    // Optional additional ID pair — appears right under the LEI block
    // when toggled on. Spans both columns to keep the fields aligned
    // with the rest of the grid.
    if (addIdShown) {
        h += '<div class="ct-form-row ct-col-span-2"><label>' + esc(t("dora.vtab.additional_id_type")) + '</label>';
        h += '<select data-change="patchVendorRoi" data-args=\'' + _da("additional_id_type") + '\' data-pass-value>' + _opts("additional_id_type", idTypes, v.additional_id_type) + '</select></div>';
        h += '<div class="ct-form-row"><label>' + esc(t("dora.vtab.additional_id_value")) + '</label>';
        h += '<input value="' + esc(v.additional_id_value || "") + '" data-input="patchVendorRoi" data-args=\'' + _da("additional_id_value") + '\' data-pass-value></div>';
    }

    // Legal name (full width).
    h += '<div class="ct-form-row ct-col-span-2"><label>' + esc(t("dora.vtab.legal_name_latin")) + '</label>';
    h += '<input value="' + esc(v.legal_name_latin || "") + '" data-input="patchVendorRoi" data-args=\'' + _da("legal_name_latin") + '\' data-pass-value></div>';

    // Country (ISO 3166-1 alpha-2 dropdown — sourced from DORA codelist).
    h += _vendorRoiCountryField(v.country_iso2, countries);

    // Person type (translated labels, ITS code value).
    h += '<div class="ct-form-row"><label>' + esc(t("dora.vtab.person_type")) + '</label>';
    h += '<select data-change="patchVendorRoi" data-args=\'' + _da("person_type") + '\' data-pass-value>' + _opts("person_type", personType, v.person_type) + '</select></div>';

    // Ultimate parent (other vendors in same project).
    var parentOpts = '<option value="">— —</option>';
    D.vendors.forEach(function(otherV) {
        if (otherV.id === v.id) return;
        var sel = (v.ultimate_parent_id === otherV.id) ? " selected" : "";
        parentOpts += '<option value="' + esc(otherV.id) + '"' + sel + '>' + esc(otherV.name || otherV.id) + (otherV.lei ? " (" + esc(otherV.lei) + ")" : "") + '</option>';
    });
    h += '<div class="ct-form-row ct-col-span-2"><label>' + esc(t("dora.vtab.ultimate_parent_id")) + '</label>';
    h += '<select data-change="patchVendorRoi" data-args=\'' + _da("ultimate_parent_id") + '\' data-pass-value>' + parentOpts + '</select></div>';
    h += '</div>';   // end ct-form-grid (identity)

    // Rich per-vendor DORA card: arrangements (clickable), functions,
    // signers, sub-contractors (clickable), informal sub_contractors.
    // Edits go through ct_modal flows in TPRM_dora.js.
    h += '<div class="form-section">' + esc(t("dora.vtab.arrangements")) + '</div>';
    if (window.DoraData && typeof window.DoraData.renderVendorCard === "function") {
        h += window.DoraData.renderVendorCard(v, { embedded: true });
    } else {
        h += '<p class="ct-muted">' + esc(t("dora.vtab.no_arrangements")) + '</p>';
    }
    h += '</div>';
    return h;
}

// Tracks whether the optional additional-id triplet is shown for a
// given vendor id (sticky across re-renders within the session). Set
// when the user manually checks the toggle on a vendor that has no
// stored additional_id_* values.
var _vroiAddIdOpen: string | null = null;

window.toggleVendorRoiAddId = function() {
    var v = D.vendors[_selectedVendor!];
    if (!v) return;
    var hasAddId = !!(v.additional_id_type || v.additional_id_value);
    if (hasAddId) {
        // Collapsing wipes the optional pair so the export drops it.
        ["additional_id_type", "additional_id_value"].forEach(function(f) {
            v[f] = "";
            if (typeof _persist === "function") {
                var p: Record<string, any> = {}; p[f] = "";
                _persist("vendor_roi", v.id, p);
            }
        });
        _vroiAddIdOpen = null;
    } else {
        _vroiAddIdOpen = (_vroiAddIdOpen === v.id) ? null : v.id;
    }
    renderPanel();
};

// Country dropdown for the vendor RoI tab — uses the DORA ISO 3166-1
// codelist (loaded with the tree). Falls back to a free-text input
// while the codelist is still loading.
function _vendorRoiCountryField(value: string, list: any) {
    if (!list || !list.length) {
        if (window.DoraData && typeof DoraData.ensureCodelists === "function") {
            DoraData.ensureCodelists(function() { renderPanel(); });
        }
        return '<div class="ct-form-row"><label>' + esc(t("dora.vtab.country_iso2")) + '</label>'
             + '<input value="' + esc(value || "") + '" placeholder="ISO-3166-1 alpha-2" maxlength="2" data-input="patchVendorRoi" data-args=\'' + _da("country_iso2") + '\' data-pass-value class="ct-upper"></div>';
    }
    var cur = (value || "").toUpperCase();
    var h = '<div class="ct-form-row"><label>' + esc(t("dora.vtab.country_iso2")) + '</label>';
    h += '<select data-change="patchVendorRoi" data-args=\'' + _da("country_iso2") + '\' data-pass-value>';
    h += '<option value="">' + esc(t("dora.vtab.country_placeholder")) + '</option>';
    list.forEach(function(it: any) {
        var code = it && it.code !== undefined ? it.code : it;
        var label = it && it.label !== undefined ? it.label : it;
        var sel = code === cur ? " selected" : "";
        h += '<option value="' + esc(code) + '"' + sel + '>' + esc(code) + ' — ' + esc(label) + '</option>';
    });
    h += '</select></div>';
    return h;
}

var _vroiRenderTimer: ReturnType<typeof setTimeout> | null = null;
window.patchVendorRoi = function(field: string, value: string) {
    var v = D.vendors[_selectedVendor!];
    if (!v) return;
    v[field] = value;
    var payload: Record<string, any> = {};
    payload[field] = value;
    // Route through the standard granular adapter (entity type "vendor_roi"
    // maps to PATCH /vendors/{id}/roi via vendor_api.js).
    if (typeof _persist === "function") {
        _persist("vendor_roi", v.id, payload);
    }
    // Defer the re-render so we don't destroy the focused input on every
    // keystroke. A full renderPanel() rebuilds the form, which would
    // (a) drop focus and (b) cause subsequent keystrokes to land on a
    // freshly-created input that is not what the user is typing into,
    // making the field appear "not to persist". The badge / completeness
    // indicators catch up once the user pauses typing or tabs out.
    if (_vroiRenderTimer) clearTimeout(_vroiRenderTimer);
    _vroiRenderTimer = setTimeout(function() { renderPanel(); }, 700);
};

// ── Informal subcontractors (vendor.sub_contractors list) ──
// These live OUTSIDE the formal DORA tree (no arrangement, no link row).
// They reference an existing global subcontractor identity by name (the
// only thing persisted in vendor.sub_contractors[] is the name string).
// Free-text entry is intentionally NOT supported — users must first
// declare the subcontractor in the global subs list (DORA tab) so we
// keep a single source of truth for sub identity.

window.vendorOpenInformalSubModal = function(vendorId: string) {
    if (typeof window.ct_modal === "undefined") return;
    var v = D.vendors.find(function(x) { return x.id === vendorId; });
    if (!v) return;

    var existing: string[] = Array.isArray(v.sub_contractors) ? v.sub_contractors.map(String) : [];
    var tree = (window.DoraData && typeof window.DoraData.getTree === "function") ? window.DoraData.getTree() : null;
    var globalSubs = (tree && Array.isArray(tree.subcontractors)) ? tree.subcontractors : [];
    // Filter out subs already declared informally on this vendor (case-insensitive).
    var existingLc = existing.map(function(s) { return s.toLowerCase().trim(); });
    var available = globalSubs.filter(function(s) {
        return s && s.name && existingLc.indexOf(String(s.name).toLowerCase().trim()) === -1;
    });

    var bodyHtml = '<div style="display:flex;flex-direction:column;gap:var(--ct-s2);min-width:380px">';
    bodyHtml += '<div class="ct-strong">' + esc(t("dora.modal.informal_pick_existing")) + '</div>';
    if (available.length === 0) {
        bodyHtml += '<div class="ct-muted ct-text-data">' + esc(t("dora.modal.informal_pick_none")) + '</div>';
    } else {
        bodyHtml += '<select id="informal-pick-existing" class="ct-w-full">';
        bodyHtml += '<option value="">— —</option>';
        available.forEach(function(s) {
            bodyHtml += '<option value="' + esc(s.name) + '">' + esc(s.name) + (s.lei ? ' (' + esc(s.lei) + ')' : '') + '</option>';
        });
        bodyHtml += '</select>';
    }
    bodyHtml += '</div>';

    var buttons: any[] = [{ id: "cancel", label: t("common.cancel") || "Cancel" }];
    if (available.length > 0) {
        buttons.push({ id: "save", label: t("dora.modal.informal_pick_add"), primary: true, result: function() {
            var pick = ((document.getElementById("informal-pick-existing") || {}) as HTMLSelectElement).value || "";
            if (!pick) {
                window.alert(t("dora.modal.informal_pick_required") || t("dora.modal.informal_pick_existing"));
                return false;
            }
            // Avoid duplicates (case-insensitive).
            if (existingLc.indexOf(pick.toLowerCase().trim()) !== -1) return "saved";
            var newList = existing.concat([pick]);
            v!.sub_contractors = newList;
            if (typeof _persist === "function") {
                _persist("vendor", v!.id, { sub_contractors: newList });
            } else if (typeof _autoSave === "function") {
                _autoSave();
            }
            // The embedded vendor card is re-rendered by renderPanel() which
            // calls DoraData.renderVendorCard(v) for the active vendor's DORA tab.
            if (typeof renderPanel === "function") try { renderPanel(); } catch (e) {}
            return "saved";
        }});
    }

    window.ct_modal.open({
        title: t("dora.modal.informal_pick_title"),
        body: bodyHtml,
        size: "md",
        buttons: buttons
    });
};

window.vendorRemoveInformalSub = function(vendorId: string, idx: number) {
    var v = D.vendors.find(function(x) { return x.id === vendorId; });
    if (!v || !Array.isArray(v.sub_contractors)) return;
    if (idx < 0 || idx >= v.sub_contractors.length) return;
    var newList = v.sub_contractors.slice();
    newList.splice(idx, 1);
    v.sub_contractors = newList;
    if (typeof _persist === "function") {
        _persist("vendor", v.id, { sub_contractors: newList });
    } else if (typeof _autoSave === "function") {
        _autoSave();
    }
    if (typeof renderPanel === "function") try { renderPanel(); } catch (e) {}
};

function _renderVendorForm(v: any) {
    var c = v.classification || {};
    var ct = v.contract || {};
    var co = v.contact || {};
    var ic = v.internal_contact || {};
    var ex = v.exposure || {};
    var h = '<div class="ct-tprm-form">';

    // ── Identity ──
    h += '<div class="ct-form-grid">';
    h += _field("vendor.name", "v-name", v.name);
    h += _field("vendor.legal_entity", "v-legal", v.legal_entity);
    h += _vendorCountryField(v.country);
    h += _vendorSectorField(v.sector);
    h += _field("vendor.website", "v-website", v.website);
    h += _field("vendor.siret", "v-siret", v.siret);
    h += '</div>';
    // Logo
    h += '<div class="ct-form-row"><label>' + t("vendor.logo") + '</label>';
    h += '<div class="ct-flex ct-gap-2 ct-items-center">';
    h += _vendorAvatar(v);
    h += '<input type="url" id="v-logo-url" placeholder="https://example.com/logo.png" class="ct-flex-1">';
    h += '<button class="ct-btn ct-nowrap ct-m-0" data-variant="primary" data-click="_fetchLogo">' + t("vendor.logo_fetch") + '</button>';
    h += '</div>';
    if (v.logo && v.logo.startsWith("data:")) {
        h += '<div class="ct-text-label ct-text-low ct-mt-1">' + t("vendor.logo_stored") + '</div>';
    }
    h += '</div>';

    // ── Status ──
    h += '<div class="ct-form-grid">';
    h += _select("vendor.status", "v-status", v.status || "prospect", [
        ["prospect", t("vendor.status_prospect")], ["active", t("vendor.status_active")],
        ["review", t("vendor.status_review")], ["offboarded", t("vendor.status_offboarded")]
    ]);
    h += '</div>';

    // ── Vendor contact ──
    h += '<div class="form-section">' + t("vendor.section_contacts") + '</div>';
    h += '<div class="ct-form-grid">';
    h += _field("vendor.contact_name", "v-cname", co.name);
    h += _field("vendor.contact_email", "v-cemail", co.email);
    h += '</div>';
    h += '<div class="ct-form-grid">';
    // Le selecteur d'annuaire travaille sur l'EMAIL et resout le nom : en mode
    // suite, internal_contact.name fait double emploi avec l'annuaire de Pilot.
    // Il reste alimente pour l'export et pour le mode autonome, ou _dirPicker
    // retombe de lui-meme sur un champ texte.
    h += '<div class="ct-form-row"><label>' + t("vendor.internal_contact") + '</label>'
       + _dirPicker(ic.email || "", "updateVendorInternalContact", _da(_selectedVendor))
       + '</div>';
    h += '</div>';

    // ── Contract ──
    h += '<div class="form-section">' + t("vendor.section_contract") + '</div>';
    h += '<div class="ct-form-row"><label>' + t("vendor.services") + '</label>';
    h += '<textarea id="v-services" rows="3" class="w-full" data-input="_autoSaveVendorField">' + esc(ct.services || "") + '</textarea></div>';
    h += '<div class="ct-form-grid">';
    h += _field("vendor.contract_start", "v-cstart", ct.start_date, "date");
    h += _field("vendor.contract_end", "v-cend", ct.end_date, "date");
    h += _field("vendor.review_date", "v-creview", ct.review_date, "date");
    h += '</div>';

    // ── Classification (2 columns: Dépendance | Pénétration) ──
    h += '<div class="form-section">' + t("vendor.section_classification") + '</div>';
    h += '<div class="cls-columns">';
    h += '<div class="cls-col">';
    h += '<div class="cls-col-title">' + t("vendor.dependance") + '</div>';
    h += _slider("vendor.cls_ops_impact", "v-cls-ops", c.ops_impact || 0, 4);
    h += _slider("vendor.cls_processes", "v-cls-proc", c.processes || 0, 4);
    h += _slider("vendor.cls_replace_difficulty", "v-cls-repl", c.replace_difficulty || 0, 4);
    h += '</div>';
    h += '<div class="cls-col">';
    h += '<div class="cls-col-title">' + t("vendor.penetration") + '</div>';
    h += _slider("vendor.cls_data_sensitivity", "v-cls-data", c.data_sensitivity || 0, 4);
    h += _slider("vendor.cls_integration", "v-cls-integ", c.integration || 0, 4);
    h += _slider("vendor.cls_regulatory", "v-cls-reg", c.regulatory_impact || 0, 4);
    h += '</div>';
    h += '</div>';

    // Hidden inputs for computed values used by _computeExposure
    var dep = _avgSliders([c.ops_impact, c.processes, c.replace_difficulty]);
    var pen = _avgSliders([c.data_sensitivity, c.integration, c.regulatory_impact]);
    h += '<input type="hidden" id="v-dep" value="' + dep + '">';
    h += '<input type="hidden" id="v-pen" value="' + pen + '">';
    h += '<input type="hidden" id="v-mat" value="' + (ex.maturite || 0) + '">';
    h += '<input type="hidden" id="v-conf" value="' + (ex.confiance || 0) + '">';

    // Threat level result
    var menace = _computeExposure({ dependance: dep, penetration: pen, maturite: ex.maturite || 0, confiance: ex.confiance || 0 });
    var clsScore = _computeClassificationScore(c);
    var isDoraCritical = _isDoraICTCritical(c);
    h += '<div class="exposure-result" id="threat-result">';
    h += '<span>' + t("vendor.threat_level") + ' : </span>';
    h += '<strong class="' + _exposureClass(menace) + '">' + menace + '/4</strong>';
    h += ' — <span class="' + _exposureClass(menace) + '">' + _exposureLabel(menace) + '</span>';
    if (isDoraCritical) h += ' <span class="ct-ref" data-size="sm">' + t("vendor.dora_critical") + '</span>';
    h += '</div>';
    h += '<div class="ct-text-label ct-muted ct-mt-1">';
    h += t("vendor.dependance") + ' : <strong>' + dep + '/4</strong>';
    h += ' — ' + t("vendor.penetration") + ' : <strong>' + pen + '/4</strong>';
    if (ex.maturite || ex.confiance) {
        h += ' — ' + t("vendor.maturite") + ' : <strong>' + (ex.maturite || 0) + '/4</strong>';
        h += ' — ' + t("vendor.confiance") + ' : <strong>' + (ex.confiance || 0) + '/4</strong>';
    }
    h += '</div>';

    // GDPR checkbox only
    h += '<div style="margin:var(--ct-s2) 0">';
    h += '<label class="ct-inline-flex ct-items-center ct-gap-1 ct-clickable ct-text-meta ct-strong ct-m-0">';
    h += '<input type="checkbox" id="v-gdpr"' + (c.gdpr_subprocessor ? ' checked' : '') + ' data-change="_autoSaveVendorField">';
    h += '<span>' + t("vendor.gdpr_subprocessor") + '</span>';
    h += '</label>';
    h += '</div>';

    // ── Notes ──
    h += '<div class="ct-form-row"><label>' + t("vendor.notes") + '</label><textarea id="v-notes" rows="4" class="w-full" data-input="_autoSaveVendorField">' + esc(v.notes || "") + '</textarea></div>';

    // Auto-save — no save button needed
    h += '</div>';
    return h;
}

// ── Exposure helpers (same formula as PP in Risk) ──
function _computeExposure(ex: any) {
    if (!ex) return 0;
    var d = ex.dependance || 0, p = ex.penetration || 0, m = ex.maturite || 0, c = ex.confiance || 0;
    if (!d || !p || !m || !c) return 0;
    return Math.round((d * p) / (m * c) * 100) / 100;
}

function _refreshThreatDisplay() {
    var v = _selectedVendor !== null ? D.vendors[_selectedVendor!] : null;
    if (!v) return;
    var ex = v.exposure || {};
    var menace = _computeExposure(ex);
    // Update hidden inputs
    var matEl = document.getElementById("v-mat"); if (matEl) (matEl as HTMLInputElement).value = String(ex.maturite || 0);
    var confEl = document.getElementById("v-conf"); if (confEl) (confEl as HTMLInputElement).value = String(ex.confiance || 0);
    // Update threat display
    var threatEl = document.getElementById("threat-result");
    if (threatEl) {
        var cls = v.classification || {};
        var dora = _isDoraICTCritical(cls);
        threatEl.innerHTML = '<span>' + t("vendor.threat_level") + ' : </span>' +
            '<strong class="' + _exposureClass(menace) + '">' + menace + '</strong>' +
            ' — <span class="' + _exposureClass(menace) + '">' + _exposureLabel(menace) + '</span>' +
            (dora ? ' <span class="ct-ref" data-size="sm">' + t("vendor.dora_critical") + '</span>' : '');
        // Deux gardes sur des identifiants d'en-tete absents de tout gabarit ont
        // ete retirees ici : elles etaient toujours fausses. Le tier est rendu par
        // la carte fournisseur, le marqueur DORA juste au-dessus.
        var detailEl = threatEl.nextElementSibling as HTMLElement | null;
        if (detailEl && detailEl.style && detailEl.style.fontSize === "0.78em") {
            detailEl.innerHTML = t("vendor.dependance") + ' : <strong>' + (ex.dependance || 0) + '/4</strong>' +
                ' — ' + t("vendor.penetration") + ' : <strong>' + (ex.penetration || 0) + '/4</strong>' +
                ' — ' + t("vendor.maturite") + ' : <strong>' + (ex.maturite || 0) + '/4</strong>' +
                ' — ' + t("vendor.confiance") + ' : <strong>' + (ex.confiance || 0) + '/4</strong>';
        }
    }
    // Update the info bar at top of vendor detail
    var menaceSpan = document.getElementById("vendor-menace-display");
    if (menaceSpan) {
        if (menace > 0) {
            menaceSpan.innerHTML = t("vendor.threat_level") + ' <strong class="' + _exposureClass(menace) + '">' + menace + ' — ' + _exposureLabel(menace) + '</strong>';
            menaceSpan.style.display = "";
        } else {
            menaceSpan.style.display = "none";
        }
    }
}

function _exposureClass(level: any) {
    if (level >= 4) return "score-critical";
    if (level >= 2) return "score-high";
    if (level >= 1) return "score-medium";
    return "score-low";
}

function _exposureLabel(level: any) {
    if (level >= 4) return t("vendor.exposure_critical");
    if (level >= 2) return t("vendor.exposure_high");
    if (level >= 1) return t("vendor.exposure_moderate");
    return t("vendor.exposure_low");
}

function _avgSliders(vals: any) {
    var sum = 0;
    vals.forEach(function(v: any) { sum += (v || 0); });
    return Math.round(sum / vals.length * 10) / 10;
}

function _computeClassificationScore(c: any) {
    if (!c) return 0;
    var all = [c.ops_impact, c.processes, c.replace_difficulty, c.data_sensitivity, c.integration, c.regulatory_impact];
    var sum = 0;
    all.forEach(function(v) { sum += (v || 0); });
    return Math.round(sum / all.length * 10) / 10;
}

function _isDoraICTCritical(c: any) {
    if (!c || !_isDoraEnabled()) return false;
    var th = _getDoraThresholds();
    var vals = [c.ops_impact || 0, c.processes || 0, c.replace_difficulty || 0, c.data_sensitivity || 0, c.integration || 0, c.regulatory_impact || 0];
    var maxed = vals.filter(function(v) { return v === 4; }).length;
    var avg = vals.reduce(function(a, b) { return a + b; }, 0) / vals.length;
    return maxed >= th.maxCriteria || avg >= th.avgScore;
}

function _slider(labelKey: any, id: any, value: string | number | undefined, max: any) {
    var h = '<div class="ct-form-row">';
    h += '<label>' + t(labelKey) + '</label>';
    h += '<div class="ct-flex ct-items-center ct-gap-2">';
    h += '<input type="range" id="' + id + '" min="0" max="' + max + '" value="' + (value || 0) + '" class="slider-input ct-flex-1" data-invert data-input="_onSliderChange" data-pass-el>';
    h += '<span id="' + id + '-val" class="slider-label" style="min-width:20px">' + (value || 0) + '</span>';
    h += '</div></div>';
    return h;
}

function _onSliderChange(el: any) {
    var valSpan = document.getElementById(el.id + "-val");
    if (valSpan) valSpan.textContent = el.value;
    _applySliderStyle(el);
    // Recompute D/P from classification sliders and save to vendor
    var v = _selectedVendor !== null ? D.vendors[_selectedVendor!] : null;
    if (v) {
        var _el = function(id: any) { var e = document.getElementById(id); return e ? parseInt((e as HTMLInputElement).value) || 0 : 0; };
        var cls = {
            ops_impact: _el("v-cls-ops"), processes: _el("v-cls-proc"), replace_difficulty: _el("v-cls-repl"),
            data_sensitivity: _el("v-cls-data"), integration: _el("v-cls-integ"), regulatory_impact: _el("v-cls-reg")
        };
        v.classification = cls;
        if (!v.exposure) v.exposure = {};
        v.exposure.dependance = _avgSliders([cls.ops_impact, cls.processes, cls.replace_difficulty]);
        v.exposure.penetration = _avgSliders([cls.data_sensitivity, cls.integration, cls.regulatory_impact]);
        _refreshThreatDisplay();
    }
    _autoSaveVendorField();
}
window._onSliderChange = _onSliderChange;

var _vrefCounter = 1000;

function _renderVendorRisks(v: any) {
    if (!v.measures) v.measures = [];
    var risks = D.risks.filter(function(r) { return r.vendor_id === v.id; });
    // Align header styling with the Assessments and Documents tabs:
    // single flex row with the title count on the left and the action
    // buttons on the right. The contextual help previously shown as a
    // <p class="ct-panel-desc"> is reachable from the sidebar Help item.
    var h = '<div class="ct-flex ct-items-center ct-gap-2 ct-mb-2">';
    h += '<strong>' + t("risk.title") + ' (' + risks.length + ')</strong>';
    h += '<span class="ct-flex-1"></span>';
    if (typeof _aiIsEnabled === "function" && _aiIsEnabled()) {
        h += '<button class="ct-btn btn-ai" data-variant="primary" data-size="xs" data-click="openAiRiskAssistant" data-args=\'' + _da(_selectedVendor) + '\'>&#10024; ' + t("ai.generate_risks") + '</button>';
    }
    h += '<button class="ct-btn" data-variant="primary" data-size="xs" data-click="addRiskForVendor" data-args=\'' + _da(v.id) + '\'>' + t("risk.add") + '</button>';
    h += '</div>';
    if (!risks.length) return h + '<div class="ct-muted ct-text-meta ct-mt-2">' + t("risk.empty") + '</div>';

    // Split measures into "en place" (terminé) and "prévues" (planifié/en_cours)
    var measEnPlace = v.measures.filter(function(m: any) { return m.statut === "termine"; });
    var measPrevues = v.measures.filter(function(m: any) { return m.statut !== "termine"; });
    var optsEnPlace = measEnPlace.map(function(m: any) { return { id: m.id, label: (m.mesure || "").substring(0, 50) }; });
    var optsPrevues = measPrevues.map(function(m: any) { return { id: m.id, label: (m.mesure || "").substring(0, 50) }; });

    h += colsButton("vendor-risks-table");
    h += '<table id="vendor-risks-table"><thead><tr>';
    h += '<th' + hd("id") + '>ID</th>';
    h += '<th' + hd("title") + '>' + t("risk.risk_title") + '</th>';
    h += '<th' + hd("cat") + '>' + t("risk.category") + '</th>';
    h += '<th' + hd("impact") + ' class="ct-w-40">' + t("risk.impact_short") + '</th>';
    h += '<th' + hd("likelihood") + ' class="ct-w-40">' + t("risk.likelihood_short") + '</th>';
    h += '<th' + hd("initial") + ' class="ct-w-40">' + t("risk.initial") + '</th>';
    h += '<th' + hd("mip") + '>' + t("risk.measures_in_place") + '</th>';
    h += '<th' + hd("mpl") + '>' + t("risk.measures_planned") + '</th>';
    h += '<th' + hd("treat") + ' class="ct-w-80">' + t("risk.treatment") + '</th>';
    h += '<th' + hd("resi") + ' class="ct-w-40">' + t("risk.res_impact") + '</th>';
    h += '<th' + hd("resl") + ' class="ct-w-40">' + t("risk.res_likelihood") + '</th>';
    h += '<th' + hd("resscore") + ' class="ct-w-40">' + t("risk.residual") + '</th>';
    h += '<th class="ct-w-30"></th>';
    h += '</tr></thead><tbody>';

    risks.forEach(function(r) {
        var riskIdx = D.risks.indexOf(r);
        var sc = (r.impact || 1) * (r.likelihood || 1);

        // Split linked measures by status
        var linkedIds = (r.linked_measures || "").split(",").map(function(s) { return s.trim().split(" - ")[0].trim(); }).filter(Boolean);
        var inPlaceIds: string[] = [], prevueIds: string[] = [];
        linkedIds.forEach(function(id) {
            var m = v.measures.find(function(x: any) { return x.id === id; });
            if (m && m.statut === "termine") inPlaceIds.push(id);
            else prevueIds.push(id);
        });
        var inPlaceVal = inPlaceIds.map(function(id) { var m = v.measures.find(function(x: any) { return x.id === id; }); return id + " - " + (m ? (m.mesure || "").substring(0, 40) : ""); }).join(", ");
        var prevueVal = prevueIds.map(function(id) { var m = v.measures.find(function(x: any) { return x.id === id; }); return id + " - " + (m ? (m.mesure || "").substring(0, 40) : ""); }).join(", ");

        // Residual: user-defined if set, otherwise defaults to initial
        var resI = r.residual_impact || 0;
        var resL = r.residual_likelihood || 0;
        var resSc = resI && resL ? resI * resL : sc;

        // Detect if re-evaluation is needed: measures in place but residual not yet adjusted
        var needsReeval = inPlaceIds.length > 0 && (!resI || !resL);

        h += '<tr' + (needsReeval ? ' class="ct-bg-medium-tint"' : '') + '>';
        h += '<td' + hd("id") + ' class="fw-600">' + esc(r.id) + '</td>';
        h += '<td' + hd("title") + '><input type="text" value="' + esc(r.title || "") + '" class="w-full ct-text-meta" data-change="updateRiskField" data-args=\'' + _da(riskIdx, "title") + '\' data-pass-value></td>';
        h += '<td' + hd("cat") + '><select class="ct-text-label" data-change="updateRiskField" data-args=\'' + _da(riskIdx, "category") + '\' data-pass-value>';
        ["CYBER","OPS","FIN","COMP","STRAT","REP","GEO"].forEach(function(cat) {
            h += '<option value="' + cat + '"' + (r.category === cat ? ' selected' : '') + '>' + cat + '</option>';
        });
        h += '</select></td>';

        // Impact initial (editable 1-5)
        h += '<td' + hd("impact") + '><select class="ct-text-meta ct-bold ct-w-40" data-change="updateRiskField" data-args=\'' + _da(riskIdx, "impact") + '\' data-pass-value>';
        for (var ii = 1; ii <= 5; ii++) h += '<option value="' + ii + '"' + (r.impact == ii ? ' selected' : '') + '>' + ii + '</option>';
        h += '</select></td>';

        // Likelihood initial (editable 1-5)
        h += '<td' + hd("likelihood") + '><select class="ct-text-meta ct-bold ct-w-40" data-change="updateRiskField" data-args=\'' + _da(riskIdx, "likelihood") + '\' data-pass-value>';
        for (var li = 1; li <= 5; li++) h += '<option value="' + li + '"' + (r.likelihood == li ? ' selected' : '') + '>' + li + '</option>';
        h += '</select></td>';

        // Inherent score (auto)
        h += '<td' + hd("initial") + ' class="ct-bold ct-ta-c ' + _scoreClass(sc) + '">' + sc + '</td>';

        // Measures in place
        var uidInPlace = "vref" + (_vrefCounter++);
        ctRefRegister(uidInPlace, {
            single: false,
            emptyText: t("measure.click_to_link"),
            labelFor: function(id) { var m = (v.measures || []).find(function(x: any) { return x.id === id; }); return m ? (m.mesure || "").substring(0, 50) : ""; },
            tagClick: function(u, optId) { var _mi = -1; if (v.measures) { for (var _k = 0; _k < v.measures.length; _k++) { if (v.measures[_k].id === optId) { _mi = _k; break; } } } if (_mi >= 0) editMeasure(_selectedVendor, _mi, "risks"); },
            onToggle: function() {},
            onRemove: function() {},
            onFlush: function() {},
        });
        h += '<td' + hd("mip") + ' class="ct-minw-120">' + ctRefSelect(uidInPlace, inPlaceVal, optsEnPlace, { placeholder: t("measure.filter"), emptyText: t("measure.click_to_link"), tagClick: true }) + '</td>';

        // Measures planned + add + AI
        var uidPlanned = "vref" + (_vrefCounter++);
        ctRefRegister(uidPlanned, {
            single: false,
            emptyText: t("measure.click_to_link"),
            labelFor: function(id) { var m = (v.measures || []).find(function(x: any) { return x.id === id; }); return m ? (m.mesure || "").substring(0, 50) : ""; },
            tagClick: function(u, optId) { var _mi = -1; if (v.measures) { for (var _k = 0; _k < v.measures.length; _k++) { if (v.measures[_k].id === optId) { _mi = _k; break; } } } if (_mi >= 0) editMeasure(_selectedVendor, _mi, "risks"); },
            onToggle: (function(ri) { return function(u, ids, el) { var r = D.risks[ri]; if (!r) return; var vn = D.vendors[_selectedVendor!]; var labels = ids.map(function(id) { var m = (vn && vn.measures || []).find(function(x: any) { return x.id === id; }); return id + " - " + (m ? (m.mesure || "").substring(0, 40) : ""); }); r.linked_measures = labels.join(", "); _persist("risk", r.id, { linked_measures: r.linked_measures }); }; })(riskIdx),
            onRemove: (function(ri) { return function(u, measureId) { var r = D.risks[ri]; if (!r) return; var parts = (r.linked_measures || "").split(",").map(function(s) { return s.trim(); }); parts = parts.filter(function(p) { return p.split(" - ")[0].trim() !== measureId; }); r.linked_measures = parts.join(", "); _persist("risk", r.id, { linked_measures: r.linked_measures }); renderPanel(); }; })(riskIdx),
            onFlush: function() { renderPanel(); },
        });
        h += '<td' + hd("mpl") + ' class="ct-minw-120">';
        h += ctRefSelect(uidPlanned, prevueVal, optsPrevues, { placeholder: t("measure.filter"), emptyText: t("measure.click_to_link"), tagClick: true });
        h += '<div class="ct-flex ct-gap-1 ct-mt-1">';
        h += '<button class="ct-btn" data-variant="primary" data-size="xs" data-click="addMeasureForRisk" data-args=\'' + _da(_selectedVendor, riskIdx) + '\'>' + t("measure.add") + '</button>';
        if (typeof _aiIsEnabled === "function" && _aiIsEnabled()) {
            h += '<button class="ct-btn btn-ai" data-size="xs" data-click="suggestMeasuresForRisk" data-args=\'' + _da(_selectedVendor, riskIdx) + '\' title="' + esc(t("ai.btn")) + '">&#10024;</button>';
        }
        h += '</div></td>';

        // Treatment
        h += '<td' + hd("treat") + '><select class="ct-text-label" data-change="updateRiskField" data-args=\'' + _da(riskIdx, "treatment.response") + '\' data-pass-value>';
        ["mitigate","transfer","accept","avoid"].forEach(function(tr) {
            var sel = (r.treatment && r.treatment.response === tr) ? ' selected' : '';
            h += '<option value="' + tr + '"' + sel + '>' + t("risk.treatment_" + tr) + '</option>';
        });
        h += '</select></td>';

        // Residual impact (editable, capped at initial impact — locked for accept/avoid)
        var resIStyle = needsReeval ? 'background:var(--ct-medium-tint);border:2px solid var(--ct-high)' : '';
        var treatmentLocked = r.treatment && (r.treatment.response === "accept" || r.treatment.response === "avoid");
        var maxResI = r.impact || 5;
        h += '<td' + hd("resi") + '><select style="font-size:var(--ct-text-meta);font-weight:700;width:40px;' + resIStyle + '"' + (treatmentLocked ? ' disabled title="' + esc(t("risk.locked_by_treatment")) + '"' : '') + ' data-change="updateRiskField" data-args=\'' + _da(riskIdx, "residual_impact") + '\' data-pass-value>';
        h += '<option value="0"' + (!resI ? ' selected' : '') + '>-</option>';
        for (var ri = 1; ri <= maxResI; ri++) h += '<option value="' + ri + '"' + (resI == ri ? ' selected' : '') + '>' + ri + '</option>';
        h += '</select></td>';

        // Residual likelihood (editable, capped at initial likelihood — locked for accept/avoid)
        var maxResL = r.likelihood || 5;
        h += '<td' + hd("resl") + '><select style="font-size:var(--ct-text-meta);font-weight:700;width:40px;' + resIStyle + '"' + (treatmentLocked ? ' disabled title="' + esc(t("risk.locked_by_treatment")) + '"' : '') + ' data-change="updateRiskField" data-args=\'' + _da(riskIdx, "residual_likelihood") + '\' data-pass-value>';
        h += '<option value="0"' + (!resL ? ' selected' : '') + '>-</option>';
        for (var rl = 1; rl <= maxResL; rl++) h += '<option value="' + rl + '"' + (resL == rl ? ' selected' : '') + '>' + rl + '</option>';
        h += '</select></td>';

        // Residual score (auto from residual I×L, or "⚠" if not set)
        if (resI && resL) {
            h += '<td' + hd("resscore") + ' class="ct-bold ct-ta-c ' + _scoreClass(resSc) + '">' + resSc + '</td>';
        } else if (needsReeval) {
            h += '<td' + hd("resscore") + ' class="ct-ta-c ct-text-section" title="' + esc(t("risk.needs_reeval")) + '">⚠️</td>';
        } else {
            h += '<td' + hd("resscore") + ' class="ct-ta-c ct-muted">-</td>';
        }

        h += '<td><button class="ct-btn" data-variant="danger" data-size="xs" data-click="deleteRisk" data-args=\'' + _da(riskIdx) + '\' data-icon>' + _icon("trash", 14) + '</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';

    // Measures registry below the risk table — use the same header style
    // as the other vendor tabs (flex row, count next to title).
    if (v.measures.length > 0) {
        h += '<div style="margin-top:var(--ct-s4);padding-top:12px;border-top:1px solid var(--ct-line)">';
        h += '<div class="ct-flex ct-items-center ct-gap-2 ct-mb-1">';
        h += '<strong>' + t("measure.registry") + ' (' + v.measures.length + ')</strong>';
        h += '<span class="ct-flex-1"></span>';
        h += '</div>';
        h += colsButton("vendor-measures-table");
        h += '<table id="vendor-measures-table" class="ct-text-label ct-mt-1"><thead><tr>';
        h += '<th' + hd("id") + ' class="ct-w-70">ID</th><th' + hd("mesure") + '>' + t("measure.col_mesure") + '</th><th' + hd("type") + '>' + t("measure.col_type") + '</th>';
        h += '<th' + hd("statut") + '>' + t("measure.col_statut") + '</th><th' + hd("resp") + '>' + t("measure.col_responsable") + '</th>';
        h += '<th' + hd("deadline") + '>' + t("measure.col_echeance") + '</th><th class="ct-w-30"></th></tr></thead><tbody>';
        v.measures.forEach(function(m: any, mi: any) {
            var statColor = m.statut === "termine" ? "var(--ct-low)" : m.statut === "en_cours" ? "var(--ct-high)" : "var(--ct-ink-2)";
            h += '<tr><td' + hd("id") + ' class="fw-600">' + esc(m.id) + '</td>';
            h += '<td' + hd("mesure") + '><input type="text" value="' + esc(m.mesure || "") + '" class="w-full" data-change="updateVendorMeasure" data-args=\'' + _da(_selectedVendor, mi, "mesure") + '\' data-pass-value></td>';
            h += '<td' + hd("type") + '><select data-change="updateVendorMeasure" data-args=\'' + _da(_selectedVendor, mi, "type") + '\' data-pass-value>';
            ["Contractuelle","Technique","Organisationnelle","Surveillance"].forEach(function(tp) {
                h += '<option value="' + tp + '"' + (m.type === tp ? ' selected' : '') + '>' + tp + '</option>';
            });
            h += '</select></td>';
            h += '<td' + hd("statut") + '><select data-change="updateVendorMeasure" data-args=\'' + _da(_selectedVendor, mi, "statut") + '\' data-pass-value>';
            [["planifie",t("measure.planifie")],["en_cours",t("measure.en_cours")],["termine",t("measure.termine")]].forEach(function(s) {
                h += '<option value="' + s[0] + '"' + (m.statut === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
            });
            h += '</select></td>';
            h += '<td' + hd("resp") + '>' + _dirPicker(m.responsable || "", "updateVendorMeasure", _da(_selectedVendor, mi, "responsable")) + '</td>';
            h += '<td' + hd("deadline") + '><input type="date" value="' + esc(m.echeance || "") + '" data-change="updateVendorMeasure" data-args=\'' + _da(_selectedVendor, mi, "echeance") + '\' data-pass-value></td>';
            h += '<td><button class="ct-btn" data-variant="danger" data-size="xs" data-click="deleteVendorMeasure" data-args=\'' + _da(_selectedVendor, mi) + '\' data-icon>' + _icon("trash", 14) + '</button></td></tr>';
        });
        h += '</tbody></table></div>';
    }

    return h;
}

function _vendorMeasureModalOpts() {
    return {
        typeOptions: ["Contractuelle", "Technique", "Organisationnelle", "Surveillance"]
            .map(function(x) { return { value: x, label: x }; }),
        statusOptions: [
            { value: "planifie", label: t("measure.planifie") || "Planifié" },
            { value: "en_cours", label: t("measure.en_cours") || "En cours" },
            { value: "termine",  label: t("measure.termine")  || "Terminé" }
        ]
    };
}

function _nextVendorRiskId(v: any): string {
    // Meme regle que _nextVendorMeasureId : on saute les numeros liberes par
    // une suppression, sinon un nouveau risque reprend l'identifiant d'un
    // ancien et les mesures qui le referencaient basculent dessus.
    var mine = (D.risks || []).filter(function(r: any) { return r.vendor_id === v.id; });
    var n = mine.length + 1;
    var mk = function(i: number) { return v.id + "-R" + String(i).padStart(2, "0"); };
    while ((D.risks || []).some(function(r: any) { return r.id === mk(n); })) n++;
    return mk(n);
}

function _nextVendorMeasureId(v: any): string {
    // FEAT-32 unified format; skip over ids freed by deletions.
    var n = (v.measures || []).length + 1;
    var mk = function(i: number) { return v.id + ":MES-" + String(i).padStart(2, "0"); };
    while ((v.measures || []).some(function(m: any) { return m.id === mk(n); })) n++;
    return mk(n);
}

function addMeasureForRisk(vendorIdx: any, riskIdx: any) {
    var v = D.vendors[vendorIdx];
    var r = D.risks[riskIdx];
    if (!v || !r || !window.ct_measure_modal) return;
    var opts = _vendorMeasureModalOpts();
    var draft = { mesure: "", details: "", type: "Contractuelle", statut: "planifie",
                  responsable: "", echeance: "", ref_socle: "", effet: "" };
    ct_measure_modal.open(draft, {
        title: t("measure.new_title") + " — " + v.name,
        fieldMap: { title: "mesure", description: "details" },
        typeOptions: opts.typeOptions,
        statusOptions: opts.statusOptions,
        defaultStatus: "planifie",
        ownerPicker: { pickerId: "vendor-measure-owner", directoryUrl: "api/directory" },
        extraFields: [
            { key: "ref_socle", label: t("measure.ref_socle") || "Ref socle", type: "text", value: "" },
            { key: "effet",     label: t("measure.effet")     || "Effet",     type: "textarea", rows: 2, value: "" }
        ]
    }).then(function(result: any) {
        if (!result || result.__deleted || !(result.mesure || "").trim()) return;
        if (!v.measures) v.measures = [];
        var mId = _nextVendorMeasureId(v);
        var newM: TprmMeasure = {
            id: mId, vendor_id: v.id, mesure: result.mesure.trim(),
            details: result.details || "", type: result.type || "Contractuelle",
            statut: result.statut || "planifie", responsable: result.responsable || "",
            echeance: result.echeance || "", ref_socle: result.ref_socle || "",
            effet: result.effet || ""
        };
        v.measures.push(newM);
        _persistCreate("measure", newM);
        var newRef = mId + " - " + newM.mesure;
        r.linked_measures = (r.linked_measures ? r.linked_measures + ", " : "") + newRef;
        _persist("risk", r.id, { linked_measures: r.linked_measures });
        showStatus(t("measure.saved") || "Mesure enregistrée");
        renderPanel();
    });
}
window.addMeasureForRisk = addMeasureForRisk;

// ═══════════════════════════════════════════════════════════════
// MEASURES (same format as Risk ecosystem measures)
// ═══════════════════════════════════════════════════════════════

function updateVendorMeasure(vendorIdx: any, measureIdx: any, field: string, value: string) {
    var v = D.vendors[vendorIdx];
    if (!v || !v.measures || !v.measures[measureIdx]) return;
    var m = v.measures[measureIdx];
    m[field] = value;
    var patch: Record<string, any> = {};
    patch[field] = value;
    _persist("measure", m.id, patch);
    if (field === "echeance" || field === "statut") {
        renderPanel();
    }
}
window.updateVendorMeasure = updateVendorMeasure;

function deleteVendorMeasure(vendorIdx: any, measureIdx: any) {
    var v = D.vendors[vendorIdx];
    if (!v || !v.measures) return;
    if (!confirm(t("measure.confirm_delete"))) return;
    var removed = v.measures[measureIdx];
    v.measures.splice(measureIdx, 1);
    if (removed && removed.id) _persistDelete("measure", removed.id);
    renderPanel();
}
window.deleteVendorMeasure = deleteVendorMeasure;

// ── Métier endpoint helper: POST structured data, the server owns the
//    TPRM methodology prompt. See docs/CHANTIER_IA_BACKEND.md §Phase 2.
function _aiPost(path: string, payload: any): Promise<any> {
    return fetch("api/ai/" + path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    }).then(function(resp) {
        if (!resp.ok) {
            return resp.text().then(function(txt) {
                var detail = (txt || "").substring(0, 300);
                // Surface FastAPI's {"detail":"..."} cleanly — covers
                // explicit refusals (422) from _parse_lax_or_refuse.
                try { var j = JSON.parse(txt || ""); if (j && j.detail) detail = j.detail; } catch (_) {}
                throw new Error(detail);
            });
        }
        return resp.json();
    });
}

// Store context for accept handler
var _aiSuggestions: any[] = [];
var _aiSuggestContext: any = {};

function suggestMeasuresForRisk(vendorIdx: any, riskIdx: any) {
    var v = D.vendors[vendorIdx];
    var r = D.risks[riskIdx];
    if (!v || !r || typeof _aiIsEnabled !== "function" || !_aiIsEnabled()) return;

    _aiSuggestContext = { vendorIdx: vendorIdx, riskIdx: riskIdx, type: "risk_measures" };

    _aiShowLoading("✨ " + t("measure.ai_suggest") + " — " + esc(r.title || r.id));

    _aiPost("vendor/suggest-measures", {
        mode: "risk",
        language: _locale === "en" ? "en" : "fr",
        vendor_name: v.name || "",
        vendor_sector: v.sector || "",
        existing_measures: (v.measures || []).map(function(m) { return m.mesure; }),
        risk: { title: r.title, category: r.category, impact: r.impact, likelihood: r.likelihood, description: r.description }
    }).then(function(jr: any) {
        var suggestions = jr.result;
        if (!Array.isArray(suggestions)) suggestions = [suggestions];
        _aiSuggestions = suggestions;
        _renderAiCards();
    }).catch(function(e: any) {
        _aiShowError("AI", e.message);
    });
}
window.suggestMeasuresForRisk = suggestMeasuresForRisk;

function openAiRiskAssistant(vendorIdx: any) {
    var v = D.vendors[vendorIdx];
    if (!v) return;
    var risks = D.risks.filter(function(r) { return r.vendor_id === v.id; });

    var p = _aiEnsurePanel();
    p.title.textContent = "IA — " + v.name;

    var h = '<div class="ct-p-1">';

    // Option 1: Propose risks
    h += '<div class="settings-section">';
    h += '<div class="settings-label">' + t("ai.option_risks") + '</div>';
    h += '<p class="fs-xs text-muted ct-mb-2">' + t("ai.option_risks_hint") + '</p>';
    h += '<textarea class="settings-input ct-w-full ct-mb-2" id="ai-risk-prompt" rows="2" placeholder="' + esc(t("ai.custom_prompt_placeholder")) + '"></textarea>';
    h += '<button class="ct-btn btn-ai ct-w-full" data-click="aiRunRiskSuggestion" data-args=\'' + _da(vendorIdx) + '\'>&#10024; ' + t("ai.generate_risks") + '</button>';
    h += '</div>';

    // Option 2: Add measures for a risk
    if (risks.length > 0) {
        h += '<div class="settings-section">';
        h += '<div class="settings-label">' + t("ai.option_measures") + '</div>';
        h += '<p class="fs-xs text-muted ct-mb-2">' + t("ai.option_measures_hint") + '</p>';
        h += '<select class="settings-input ct-w-full ct-mb-2" id="ai-risk-select">';
        risks.forEach(function(r, i) {
            var rIdx = D.risks.indexOf(r);
            var score = (r.impact || 1) * (r.likelihood || 1);
            h += '<option value="' + rIdx + '">' + esc(r.id + ' — ' + r.title + ' (' + score + ')') + '</option>';
        });
        h += '</select>';
        h += '<textarea class="settings-input ct-w-full ct-mb-2" id="ai-measure-prompt" rows="2" placeholder="' + esc(t("ai.custom_prompt_placeholder")) + '"></textarea>';
        h += '<button class="ct-btn btn-ai ct-w-full" data-click="aiRunMeasureSuggestion" data-args=\'' + _da(vendorIdx) + '\'>&#10024; ' + t("ai.generate_measures") + '</button>';
        h += '</div>';
    } else {
        h += '<div class="settings-section">';
        h += '<div class="settings-label">' + t("ai.option_measures") + '</div>';
        h += '<p class="fs-xs text-muted">' + t("ai.no_risks_yet") + '</p>';
        h += '</div>';
    }

    h += '</div>';

    p.body.innerHTML = h;
    p.footer.innerHTML = '<button class="ct-btn ai-btn-close" id="ai-assist-close">' + t("common.close") + '</button>';
    _aiOpenPanel();
    document.getElementById("ai-assist-close")!.onclick = _aiClosePanel;
}
window.openAiRiskAssistant = openAiRiskAssistant;

function aiRunRiskSuggestion(vendorIdx: any) {
    var customPrompt = ((document.getElementById("ai-risk-prompt") as HTMLInputElement | null) || ({} as HTMLInputElement)).value || "";
    _aiClosePanel();
    if (customPrompt.trim()) {
        _aiSuggestRisksCustom(vendorIdx, customPrompt.trim());
    } else {
        aiSuggestRisksAndMeasures(vendorIdx);
    }
}
window.aiRunRiskSuggestion = aiRunRiskSuggestion;

function aiRunMeasureSuggestion(vendorIdx: any) {
    var riskIdx = parseInt(((document.getElementById("ai-risk-select") as HTMLInputElement | null) || ({} as HTMLInputElement)).value);
    var customPrompt = ((document.getElementById("ai-measure-prompt") as HTMLInputElement | null) || ({} as HTMLInputElement)).value || "";
    _aiClosePanel();
    if (customPrompt.trim()) {
        _aiSuggestMeasuresCustom(vendorIdx, riskIdx, customPrompt.trim());
    } else {
        suggestMeasuresForRisk(vendorIdx, riskIdx);
    }
}
window.aiRunMeasureSuggestion = aiRunMeasureSuggestion;

function _aiSuggestRisksCustom(vendorIdx: any, prompt: any) {
    var v = D.vendors[vendorIdx];
    if (!v || typeof _aiIsEnabled !== "function" || !_aiIsEnabled()) return;

    _aiSuggestContext = { vendorIdx: vendorIdx, type: "risks_and_measures" };
    _aiShowLoading("✨ " + esc(prompt.substring(0, 50)));

    _aiPost("vendor/suggest-risks", {
        mode: "custom",
        language: _locale === "en" ? "en" : "fr",
        vendor_name: v.name || "",
        vendor_sector: v.sector || "",
        vendor_services: (v.contract || {}).services || "",
        custom_request: prompt
    }).then(function(jr: any) {
        var suggestions = jr.result;
        if (!Array.isArray(suggestions)) suggestions = [suggestions];
        _aiSuggestions = suggestions;
        _renderAiCards();
    }).catch(function(e: any) { _aiShowError("AI", e.message); });
}

function _aiSuggestMeasuresCustom(vendorIdx: any, riskIdx: any, prompt: any) {
    var v = D.vendors[vendorIdx];
    var r = D.risks[riskIdx];
    if (!v || !r || typeof _aiIsEnabled !== "function" || !_aiIsEnabled()) return;

    _aiSuggestContext = { vendorIdx: vendorIdx, riskIdx: riskIdx, type: "risk_measures" };
    _aiShowLoading("✨ " + esc(prompt.substring(0, 50)));

    _aiPost("vendor/suggest-measures", {
        mode: "custom",
        language: _locale === "en" ? "en" : "fr",
        vendor_name: v.name || "",
        custom_request: prompt,
        risk: { title: r.title, impact: r.impact, likelihood: r.likelihood }
    }).then(function(jr: any) {
        var suggestions = jr.result;
        if (!Array.isArray(suggestions)) suggestions = [suggestions];
        _aiSuggestions = suggestions;
        _renderAiCards();
    }).catch(function(e: any) { _aiShowError("AI", e.message); });
}

function aiSuggestRisksAndMeasures(vendorIdx: any) {
    var v = D.vendors[vendorIdx];
    if (!v || typeof _aiIsEnabled !== "function" || !_aiIsEnabled()) return;

    var existingRisks = D.risks.filter(function(r) { return r.vendor_id === v.id; });

    _aiSuggestContext = { vendorIdx: vendorIdx, type: "risks_and_measures" };
    _aiShowLoading("✨ " + t("measure.ai_suggest") + " — " + esc(v.name));

    _aiPost("vendor/suggest-risks", {
        mode: "auto",
        language: _locale === "en" ? "en" : "fr",
        vendor_name: v.name || "",
        vendor_sector: v.sector || "",
        vendor_services: (v.contract || {}).services || "",
        vendor_website: v.website || "",
        classification: v.classification || {},
        tier: _getTier(v),
        dora_critical: _isDoraICTCritical(v.classification),
        gdpr_subprocessor: !!(v.classification && v.classification.gdpr_subprocessor),
        existing_risks: existingRisks.map(function(r) { return r.title; })
    }).then(function(jr: any) {
        var suggestions = jr.result;
        if (!Array.isArray(suggestions)) suggestions = [suggestions];
        _aiSuggestions = suggestions;
        _renderAiCards();
    }).catch(function(e: any) {
        _aiShowError("AI", e.message);
    });
}
window.aiSuggestRisksAndMeasures = aiSuggestRisksAndMeasures;

// ═══════════════════════════════════════════════════════════════
// AI SUGGESTION CARDS (slide-in panel like Risk)
// ═══════════════════════════════════════════════════════════════

function _renderAiCards() {
    if (!_aiSuggestions.length) {
        var p = _aiEnsurePanel();
        p.body.innerHTML = '<div class="ct-ta-c ct-p-5 ct-muted">' + t("measure.ai_no_suggestions") + '</div>';
        p.footer.innerHTML = '<button class="ct-btn ai-btn-close" id="ai-cards-close">' + t("common.close") + '</button>';
        _aiOpenPanel();
        document.getElementById("ai-cards-close")!.onclick = _aiClosePanel;
        return;
    }

    var isRiskMode = _aiSuggestContext.type === "risks_and_measures";

    window._aiRenderCards!({
        suggestions: _aiSuggestions,
        acceptLabel: t("measure.accept"),
        ignoreLabel: t("measure.ignore"),
        acceptAllLabel: t("measure.accept_all"),
        closeLabel: t("common.close"),
        doneLabel: t("measure.all_done"),
        renderCard: function(s, i) {
            var h = "";
            if (isRiskMode) {
                // Risk + measures card
                h += '<div class="ai-card-title ct-text-critical">' + esc(s.title || "Risk " + (i + 1)) + '</div>';
                h += '<div class="ct-text-label ct-mb-1">';
                h += '<span class="ct-bg-info-tint ct-py-1 ct-px-1 ct-r-sm">' + esc(s.category || "CYBER") + '</span>';
                h += ' Impact: ' + (s.impact || 3) + ' | ' + t("risk.likelihood") + ': ' + (s.likelihood || 3);
                h += '</div>';
                if (s.description) h += '<div class="ai-card-details">' + esc(s.description) + '</div>';
                if (s.measures && s.measures.length) {
                    h += '<div style="margin-top:var(--ct-s1);padding-top:6px;border-top:1px solid var(--ct-line)">';
                    h += '<div class="ct-text-label ct-strong ct-muted ct-mb-1">' + t("measure.title") + ':</div>';
                    s.measures.forEach(function(m: any) {
                        h += '<div class="ct-text-label ct-py-1 ct-px-0">• ' + esc(m.mesure || "") + ' <span class="ct-muted">(' + esc(m.type || "") + ')</span></div>';
                    });
                    h += '</div>';
                }
            } else {
                // Measure card
                h += '<div class="ai-card-title">' + esc(s.mesure || s.measure || "Measure " + (i + 1)) + '</div>';
                if (s.details) h += '<div class="ai-card-details">' + esc(s.details) + '</div>';
                h += '<div class="ct-text-label ct-muted ct-mt-1">';
                if (s.type) h += '<span style="background:var(--ct-info-tint);padding:var(--ct-s1) var(--ct-s1);border-radius:var(--ct-r-sm);margin-right:var(--ct-s1)">' + esc(s.type) + '</span>';
                if (s.responsable) h += esc(s.responsable);
                h += '</div>';
            }
            return h;
        },
        onAccept: function(s, _i) {
            var ctx = _aiSuggestContext;
            var v = D.vendors[ctx.vendorIdx];
            if (!v) return;
            if (!v.measures) v.measures = [];

            if (ctx.type === "risks_and_measures") {
                // Create risk + linked measures
                var riskId = _nextVendorRiskId(v);
                var risk = {
                    id: riskId, vendor_id: v.id, title: s.title || "", description: s.description || "",
                    category: s.category || "CYBER", impact: s.impact || 3, likelihood: s.likelihood || 3,
                    treatment: { response: "mitigate", details: "", due_date: "" },
                    residual_impact: 0, residual_likelihood: 0, status: "needs_treatment",
                    linked_measures: ""
                };
                D.risks.push(risk);
                (s.measures || []).forEach(function(m: any) {
                    var mId = _nextVendorMeasureId(v);
                    var newM = {
                        id: mId, vendor_id: v.id, mesure: m.mesure || m.measure || "", details: m.details || "",
                        type: m.type || "Contractuelle", statut: "planifie",
                        responsable: m.responsable || "", echeance: "", ref_socle: "", effet: ""
                    };
                    v.measures!.push(newM);
                    _persistCreate("measure", newM);
                    risk.linked_measures = _csvAppendRef(risk.linked_measures || "", mId, m.mesure || "");
                });
                _persistCreate("risk", risk);
            } else {
                // Create measure and link to risk
                var mId = _nextVendorMeasureId(v);
                var newM2 = {
                    id: mId, vendor_id: v.id, mesure: s.mesure || s.measure || "", details: s.details || "",
                    type: s.type || "Contractuelle", statut: "planifie",
                    responsable: s.responsable || "", echeance: "", ref_socle: "", effet: ""
                };
                v.measures.push(newM2);
                _persistCreate("measure", newM2);
                if (ctx.riskIdx != null) {
                    var r = D.risks[ctx.riskIdx];
                    if (r) {
                        r.linked_measures = _csvAppendRef(r.linked_measures || "", mId, s.mesure || "");
                        _persist("risk", r.id, { linked_measures: r.linked_measures });
                    }
                }
            }
        },
        onChange: function() {
            showStatus(t("measure.accepted"));
            renderPanel();
        }
    });
}

// ── AI: suggest answers for a specific domain ──
function _renderVendorAssessments(v: any) {
    var assessments = D.assessments.filter(function(a) { return a.vendor_id === v.id; });
    var h = '<div class="ct-flex ct-row-between ct-mb-2">';
    h += '<strong>' + t("assessment.title") + ' (' + assessments.length + ')</strong>';
    h += '<button class="ct-btn" data-variant="primary" data-click="newAssessment" data-args=\'' + _da(v.id) + '\'>' + t("assessment.new") + '</button>';
    h += '</div>';

    // Weighted maturity detail (only when at least one validated assessment exists)
    h += _renderVendorMaturityDetail(v);

    if (!assessments.length) return h + '<div class="ct-muted ct-text-meta">' + t("assessment.empty") + '</div>';
    assessments.forEach(function(a) {
        var comp = a.completion_rate != null ? a.completion_rate : 0;
        var compColor = comp === 100 ? "var(--ct-low)" : comp > 50 ? "var(--ct-high)" : "var(--ct-ink-2)";
        var scoreColor = a.score != null ? (a.score >= 80 ? "var(--ct-low)" : a.score >= 50 ? "var(--ct-high)" : "var(--ct-critical)") : "var(--ct-ink-2)";
        var statusKey = a.status || "draft";
        var label = _assessmentStatusLabel(statusKey);
        // Template-driven assessments display the template name; legacy ones keep the type.
        var title = a.template_snapshot ? (a.template_snapshot.name || a.id) : t("assessment.type_" + (a.type || "periodic"));

        h += '<div class="question-card ct-clickable" data-click="openAssessmentFromVendor" data-args=\'' + _da(a.id, _selectedVendor) + '\'>';
        h += '<div class="ct-flex ct-row-between ct-items-center ct-gap-2 ct-row-wrap">';
        h += '<div class="ct-flex ct-items-center ct-gap-2 ct-row-wrap">';
        h += '<span class="ct-strong">' + esc(a.id) + '</span>';
        h += '<span class="ct-text-label ct-ink-1">' + esc(title) + '</span>';
        h += '<span class="evalv2-status evalv2-status-' + esc(statusKey) + '">' + esc(label) + '</span>';
        h += '</div>';
        h += '<div class="ct-flex ct-items-center ct-gap-2">';
        h += '<span class="ct-text-label ct-ink-1">' + esc(a.date || "") + '</span>';
        h += '<button class="ct-btn ct-py-1 ct-px-2 ct-text-label" data-variant="danger" data-size="sm" data-click="deleteAssessment" data-args=\'' + _da(a.id) + '\' data-stop title="' + esc(t("vendor.delete")) + '">\u00d7</button>';
        h += '</div>';
        h += '</div>';
        // Progress bar + score
        h += '<div class="ct-flex ct-items-center ct-gap-2 ct-mt-1">';
        h += '<div style="flex:1;height:6px;background:var(--ct-canvas);border-radius:var(--ct-r-sm);overflow:hidden">';
        h += '<div style="width:' + comp + '%;height:100%;background:' + compColor + ';border-radius:3px"></div>';
        h += '</div>';
        h += '<span style="font-size:var(--ct-text-label);font-weight:600;color:' + compColor + '">' + comp + '%</span>';
        if (a.score != null) {
            h += '<span style="font-size:var(--ct-text-label);font-weight:700;color:' + scoreColor + '"> ' + t("assessment.score") + ': ' + a.score + '%</span>';
        }
        h += '</div>';
        h += '</div>';
    });
    return h;
}

// Safe lookup for the localized label of any assessment status (legacy and V2).
function _assessmentStatusLabel(statusKey: string) {
    var key = "assessment.status_" + statusKey;
    var label = t(key);
    // If the translation key is missing, t() returns the key itself — fall back
    // to a title-cased version of the status so the UI stays readable.
    if (label === key) return statusKey.replace(/_/g, " ");
    return label;
}

function _renderVendorDocs(v: any) {
    var docs = D.documents.filter(function(d) { return d.vendor_id === v.id; });
    var h = '<div class="ct-flex ct-items-center ct-gap-2"><strong>' + t("doc.title") + ' (' + docs.length + ')</strong>';
    h += '<button class="ct-btn" data-variant="primary" data-size="xs" data-click="addDocument">' + t("doc.add") + '</button>';
    if (typeof _aiIsEnabled === "function" && _aiIsEnabled()) {
        h += '<button class="ct-btn btn-ai" data-size="xs" data-click="aiCollectDocs">&#10024; ' + t("ai.collect_docs") + '</button>';
    }
    h += '</div>';
    if (!docs.length) {
        h += '<div class="ct-muted ct-text-meta ct-mt-2">' + t("doc.empty") + '</div>';
    } else {
        h += _renderDocsTable(docs);
    }
    // Global confidence selector
    var conf = (v.exposure && v.exposure.confiance != null) ? v.exposure.confiance : "";
    h += '<div class="ct-mt-3 ct-p-3 ct-bg-canvas ct-r-md ct-flex ct-items-center ct-gap-2">';
    h += '<label class="ct-text-label ct-strong ct-m-0">' + t("doc.confidence") + '</label>';
    h += '<select data-change="updateVendorConfiance" data-pass-el class="ct-select">';
    for (var i = 0; i <= 4; i++) {
        h += '<option value="' + i + '"' + (conf === i ? ' selected' : '') + '>' + i + ' — ' + esc(t("doc.confidence_" + i)) + '</option>';
    }
    h += '</select>';
    h += '<span class="ct-text-label ct-muted">' + t("doc.confidence_hint") + '</span>';
    h += '</div>';
    return h;
}

var _docsTableCounter = 0;
function _renderDocsTable(docs: any, tableId?: string) {
    if (!tableId) tableId = "docs-table-" + (_docsTableCounter++);
    var h = colsButton(tableId);
    h += '<table id="' + tableId + '" class="ct-mt-2"><thead><tr>';
    h += '<th' + hd("name") + '>' + t("doc.name") + '</th><th' + hd("type") + '>' + t("doc.type") + '</th><th' + hd("url") + '>URL</th><th' + hd("expiry") + '>' + t("doc.expiry") + '</th><th></th>';
    h += '</tr></thead><tbody>';
    var docTypes = ["trust_center","audit_report","certification","dpa","privacy","whitepaper","status_page","bug_bounty","other"];
    docs.forEach(function(d: any) {
        var statusCls = "";
        if (d.expiry_date) {
            var ds = ctDateStatus(d.expiry_date, 30);
            statusCls = ds === "expired" ? "doc-status-expired" : ds === "soon" ? "doc-status-expiring" : "doc-status-valid";
        }
        h += '<tr>';
        // Name (editable)
        h += '<td' + hd("name") + '><input type="text" value="' + esc(d.name) + '" style="font-weight:600;border:none;background:transparent;width:100%;font-size:inherit;font-family:inherit" data-change="updateDocField" data-args=\'' + _da(d.id, "name") + '\' data-pass-value></td>';
        // Type (select)
        h += '<td' + hd("type") + '><select data-change="updateDocField" data-args=\'' + _da(d.id, "type") + '\' data-pass-value>';
        docTypes.forEach(function(tp) {
            h += '<option value="' + tp + '"' + (d.type === tp ? ' selected' : '') + '>' + esc(_docTypeLabel(tp)) + '</option>';
        });
        h += '</select></td>';
        // URL (editable + link)
        h += '<td' + hd("url") + ' class="ct-text-label"><div class="ct-flex ct-items-center ct-gap-1">';
        h += '<input type="url" value="' + esc(d.url || "") + '" placeholder="https://..." style="flex:1;border:1px solid var(--ct-line);border-radius:var(--ct-r-sm);padding:var(--ct-s1) var(--ct-s1);font-size:inherit;min-width:80px" data-change="updateDocField" data-args=\'' + _da(d.id, "url") + '\' data-pass-value>';
        if (d.url) h += '<a href="' + esc(d.url) + '" target="_blank" rel="noopener" class="ct-text-accent" data-stop>&#8599;</a>';
        h += '</div></td>';
        // Expiry date
        h += '<td' + hd("expiry") + ' class="' + statusCls + '"><input type="date" value="' + esc(d.expiry_date || "") + '" class="ct-input" data-change="updateDocField" data-args=\'' + _da(d.id, "expiry_date") + '\' data-pass-value></td>';
        h += '<td><button class="ct-btn" data-variant="danger" data-size="xs" data-click="deleteDoc" data-args=\'' + _da(d.id) + '\' data-icon>' + _icon("trash", 14) + '</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
}

function _docTypeLabel(type: any) {
    var map: Record<string, string> = {
        trust_center: "Trust Center", audit_report: "Rapport d'audit", certification: "Certification",
        dpa: "DPA", privacy: "Politique de confidentialite", whitepaper: "Whitepaper",
        status_page: "Status Page", bug_bounty: "Bug Bounty", other: "Autre"
    };
    return map[type] || type || "Autre";
}

function updateDocField(docId: string, field: string, value: string) {
    var doc = D.documents.find(function(d) { return d.id === docId; });
    if (!doc) return;
    doc[field] = value;
    _persist("document", docId, _obj(field, value));
    if (field === "expiry_date") renderPanel();
}
window.updateDocField = updateDocField;

function addDocument() {
    var v = D.vendors[_selectedVendor!];
    if (!v) return;
    var name = prompt(t("doc.prompt_name"));
    if (!name) return;
    var docId = _nextSeqId("DOC", D.documents);
    var newDoc = {
        id: docId, vendor_id: v.id, name: name, type: "other",
        url: "", expiry_date: "", source: "manual"
    };
    D.documents.push(newDoc);
    _persistCreate("document", newDoc);
    renderPanel();
}
window.addDocument = addDocument;

function deleteDoc(docId: string) {
    D.documents = D.documents.filter(function(d) { return d.id !== docId; });
    _persistDelete("document", docId);
    renderPanel();
}
window.deleteDoc = deleteDoc;

function updateVendorConfiance(el: any) {
    var v = D.vendors[_selectedVendor!];
    if (!v) return;
    if (!v.exposure) v.exposure = {};
    v.exposure.confiance = parseInt(el.value) || 0;
    _persist("vendor", v.id, { exposure: v.exposure });
    _refreshThreatDisplay();
}
window.updateVendorConfiance = updateVendorConfiance;

// ═══════════════════════════════════════════════════════════════
// RISK LIST (global)
// ═══════════════════════════════════════════════════════════════

var _riskFilterVendor = "";
var _riskFilterCategory = "";
var _riskFilterStatus = "";
var _riskSearch = "";

function renderRiskList() {
    var h = '<h2>' + t("risk.title") + '</h2>';
    if (!D.risks.length) return h + '<div class="ct-empty-state">' + t("risk.empty") + '</div>';

    // Filters bar
    h += '<div class="ct-flex ct-gap-2 ct-row-wrap ct-mb-2 ct-items-center">';
    // Search
    h += '<input type="text" id="risk-search" placeholder="' + esc(t("common.search")) + '" value="' + esc(_riskSearch) + '" class="ct-flex-1 ct-minw-150 ct-py-1 ct-px-2 ct-bordered ct-r-md ct-text-meta" data-input="_onRiskFilterChange">';
    // Vendor filter
    h += '<select id="risk-filter-vendor" class="ct-filter" data-change="_onRiskFilterChange">';
    h += '<option value="">' + t("risk.all_vendors") + '</option>';
    D.vendors.forEach(function(v) {
        h += '<option value="' + esc(v.id) + '"' + (_riskFilterVendor === v.id ? ' selected' : '') + '>' + esc(v.name) + '</option>';
    });
    h += '</select>';
    // Category filter
    h += '<select id="risk-filter-category" class="ct-filter" data-change="_onRiskFilterChange">';
    h += '<option value="">' + t("risk.all_categories") + '</option>';
    var cats = ["CYBER","OPS","FIN","COMP","STRAT","REP","GEO"];
    cats.forEach(function(c) { h += '<option value="' + c + '"' + (_riskFilterCategory === c ? ' selected' : '') + '>' + c + '</option>'; });
    h += '</select>';
    // Status filter
    h += '<select id="risk-filter-status" class="ct-filter" data-change="_onRiskFilterChange">';
    h += '<option value="">' + t("risk.all_statuses") + '</option>';
    ["needs_treatment","active","closed","archived"].forEach(function(s) {
        h += '<option value="' + s + '"' + (_riskFilterStatus === s ? ' selected' : '') + '>' + t("risk.status_" + s) + '</option>';
    });
    h += '</select>';
    h += '</div>';

    // Filter risks
    var filtered = D.risks.filter(function(r) {
        if (_riskFilterVendor && r.vendor_id !== _riskFilterVendor) return false;
        if (_riskFilterCategory && r.category !== _riskFilterCategory) return false;
        if (_riskFilterStatus && r.status !== _riskFilterStatus) return false;
        if (_riskSearch) {
            var q = _riskSearch.toLowerCase();
            var match = (r.title || "").toLowerCase().indexOf(q) >= 0 ||
                        (r.id || "").toLowerCase().indexOf(q) >= 0 ||
                        (r.description || "").toLowerCase().indexOf(q) >= 0 ||
                        _vendorName(r.vendor_id).toLowerCase().indexOf(q) >= 0;
            if (!match) return false;
        }
        return true;
    });

    if (!filtered.length) return h + '<div class="ct-muted ct-text-meta ct-p-2">' + t("vendor.no_results") + '</div>';

    h += colsButton("risk-list-table");
    h += '<div class="ct-scroll-x"><table id="risk-list-table"><thead><tr><th' + hd("id") + '>ID</th><th' + hd("vendor") + '>' + t("risk.vendor") + '</th><th' + hd("title") + '>' + t("risk.risk_title") + '</th>';
    h += '<th' + hd("cat") + '>' + t("risk.category") + '</th><th' + hd("inherent") + '>' + t("risk.inherent_score") + '</th>';
    h += '<th' + hd("residual") + '>' + t("risk.residual_score") + '</th><th' + hd("status") + '>' + t("risk.status") + '</th></tr></thead><tbody>';
    filtered.sort(function(a, b) { return (b.impact * b.likelihood) - (a.impact * a.likelihood); });
    filtered.forEach(function(r) {
        var sc = r.impact * r.likelihood;
        var rsc = (r.residual_impact || 0) * (r.residual_likelihood || 0);
        var vendorIdx = D.vendors.findIndex(function(v) { return v.id === r.vendor_id; });
        h += '<tr class="ct-clickable" data-click="goToRisk" data-args=\'' + _da(r.vendor_id) + '\'>';
        h += '<td' + hd("id") + '>' + esc(r.id) + '</td><td' + hd("vendor") + '>' + esc(_vendorName(r.vendor_id)) + '</td>';
        h += '<td' + hd("title") + '>' + esc(r.title) + '</td><td' + hd("cat") + '>' + esc(r.category) + '</td>';
        h += '<td' + hd("inherent") + ' class="ct-bold ' + _scoreClass(sc) + '">' + sc + '</td>';
        h += '<td' + hd("residual") + ' class="' + _scoreClass(rsc) + '">' + (rsc || "-") + '</td>';
        h += '<td' + hd("status") + '>' + esc(t("risk.status_" + r.status)) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="ct-text-label ct-muted ct-mt-1">' + filtered.length + '/' + D.risks.length + ' ' + t("nav.risks").toLowerCase() + '</div>';
    return h;
}

function _onRiskFilterChange() {
    _riskSearch = ((document.getElementById("risk-search") as HTMLInputElement | null) || ({} as HTMLInputElement)).value || "";
    _riskFilterVendor = ((document.getElementById("risk-filter-vendor") as HTMLInputElement | null) || ({} as HTMLInputElement)).value || "";
    _riskFilterCategory = ((document.getElementById("risk-filter-category") as HTMLInputElement | null) || ({} as HTMLInputElement)).value || "";
    _riskFilterStatus = ((document.getElementById("risk-filter-status") as HTMLInputElement | null) || ({} as HTMLInputElement)).value || "";
    var c = document.getElementById("content");
    if (c) c.innerHTML = renderRiskList();
}
window._onRiskFilterChange = _onRiskFilterChange;

function goToRisk(vendorId: string) {
    var idx = D.vendors.findIndex(function(v) { return v.id === vendorId; });
    if (idx < 0) return;
    _selectedVendor = idx;
    _vendorTab = "risks";
    _panel = "vendors";
    // Update sidebar active state
    _updateSidebarAccordion("vendors");
    renderPanel();
}
window.goToRisk = goToRisk;

// ═══════════════════════════════════════════════════════════════
// ASSESSMENT LIST + DETAIL
// ═══════════════════════════════════════════════════════════════

function renderDocList() {
    var h = '<h2>' + t("doc.title") + '</h2>';
    if (!D.documents.length) return h + '<div class="ct-empty-state">' + t("doc.empty") + '</div>';
    // Group by vendor
    var byVendor: Record<string, any> = {};
    D.documents.forEach(function(d) {
        if (!byVendor[d.vendor_id]) byVendor[d.vendor_id] = [];
        byVendor[d.vendor_id].push(d);
    });
    for (var vid in byVendor) {
        h += '<h3 style="margin:var(--ct-s4) 0 var(--ct-s1);font-size:var(--ct-text-ui)">' + esc(_vendorName(vid)) + '</h3>';
        h += _renderDocsTable(byVendor[vid]);
    }
    return h;
}

// ═══════════════════════════════════════════════════════════════
// ASSESSMENT DETAIL (Questionnaire)
// ═══════════════════════════════════════════════════════════════

function openAssessmentDispatch(assessId: string) {
    // V2-only: legacy V1 assessments are migrated on the fly by openAssessmentV2.
    openAssessmentV2(assessId);
}
window.openAssessmentDispatch = openAssessmentDispatch;

function openAssessmentFromVendor(assessId: string, vendorIdx: any) {
    _assessReturnToVendor = vendorIdx;
    _assessmentV2Returning = vendorIdx;
    openAssessmentV2(assessId);
}
window.openAssessmentFromVendor = openAssessmentFromVendor;

function deleteAssessment(assessId: string) {
    if (!confirm(t("assessment.confirm_delete"))) return;
    var idx = D.assessments.findIndex(function(a) { return a.id === assessId; });
    if (idx < 0) return;
    D.assessments.splice(idx, 1);
    _persistDelete("assessment", assessId);
    renderPanel();
    showStatus(t("assessment.deleted"));
}
window.deleteAssessment = deleteAssessment;

// ═══════════════════════════════════════════════════════════════
// EXCEL EXPORT / IMPORT (CSV fallback — no SheetJS dependency)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// CRUD OPERATIONS
// ═══════════════════════════════════════════════════════════════

function addVendor() {
    var name = prompt(t("vendor.prompt_name"));
    if (!name) return;
    var website = "";
    var aiEnabled = typeof _aiIsEnabled === "function" && _aiIsEnabled();
    var nextId = _nextSeqId("PP", D.vendors);
    D.vendors.push({
        id: nextId, name: name, legal_entity: "", country: "", sector: "", website: website, siret: "",
        logo: "",
        contact: { name: "", email: "", phone: "" },
        internal_contact: { name: "", email: "" },
        contract: { services: "", start_date: "", end_date: "", review_date: "" },
        classification: {
            ops_impact: 0, processes: 0, replace_difficulty: 0,
            data_sensitivity: 0, integration: 0, regulatory_impact: 0,
            gdpr_subprocessor: false
        },
        exposure: { dependance: 0, penetration: 0, maturite: 0, confiance: 0 },
        certifications: [], dpa_signed: false, sub_contractors: [],
        status: "prospect",
        measures: [],
        notes: ""
    });
    _selectedVendor = D.vendors.length - 1;
    _vendorTab = "info";
    _persistCreate("vendor", D.vendors[_selectedVendor!]);
    renderPanel();
    // Auto-collect via AI if enabled
    if (aiEnabled && (name || website)) {
        setTimeout(function() { aiCollectInfo(); }, 200);
    }
}
window.addVendor = addVendor;

var _vendorSaveTimer: ReturnType<typeof setTimeout> | null = null;

function _autoSaveVendorField() {
    // Debounced auto-save: collect all fields and save
    if (_vendorSaveTimer) clearTimeout(_vendorSaveTimer);
    _vendorSaveTimer = setTimeout(function() {
        var v = D.vendors[_selectedVendor!];
        if (!v) return;
        var el = function(id: any) { var e = document.getElementById(id); return e ? (e as HTMLInputElement).value.trim() : ""; };
        var chk = function(id: any) { var e = document.getElementById(id); return e ? (e as HTMLInputElement).checked : false; };
        v.name = el("v-name");
        v.legal_entity = el("v-legal");
        v.country = el("v-country");
        v.sector = el("v-sector");
        v.website = el("v-website");
        v.siret = el("v-siret");
        // v.logo is managed by _fetchLogo (stored as base64)
        v.contact = { name: el("v-cname"), email: el("v-cemail") };
        // internal_contact est ecrit par updateVendorInternalContact des la
        // selection dans l'annuaire. Le relire ici l'ecraserait par "" : el()
        // rend une chaine vide pour un element absent, sans rien signaler.
        v.contract = { services: el("v-services"), start_date: el("v-cstart"), end_date: el("v-cend"), review_date: el("v-creview") };
        v.classification = {
            ops_impact: parseInt(el("v-cls-ops")) || 0,
            processes: parseInt(el("v-cls-proc")) || 0,
            replace_difficulty: parseInt(el("v-cls-repl")) || 0,
            data_sensitivity: parseInt(el("v-cls-data")) || 0,
            integration: parseInt(el("v-cls-integ")) || 0,
            regulatory_impact: parseInt(el("v-cls-reg")) || 0,
            gdpr_subprocessor: chk("v-gdpr")
        };
        if (!v.exposure) v.exposure = {};
        var cc = v.classification;
        v.exposure.dependance = _avgSliders([cc.ops_impact, cc.processes, cc.replace_difficulty]);
        v.exposure.penetration = _avgSliders([cc.data_sensitivity, cc.integration, cc.regulatory_impact]);
        v.exposure.maturite = parseInt(el("v-mat")) || 0;
        v.exposure.confiance = parseInt(el("v-conf")) || 0;
        v.status = el("v-status");
        v.notes = el("v-notes");
        _persist("vendor", v.id, {
            name: v.name, legal_entity: v.legal_entity, country: v.country,
            sector: v.sector, website: v.website, siret: v.siret,
            contact: v.contact, internal_contact: v.internal_contact,
            contract: v.contract, classification: v.classification,
            exposure: v.exposure, status: v.status, notes: v.notes
        });
        // Update header subtitle
        var sub = document.getElementById("header-subtitle");
        if (sub) sub.textContent = v.name || "";
    }, 400);
}
window._autoSaveVendorField = _autoSaveVendorField;

// Keep saveVendor for backward compat but it just triggers immediate save
function saveVendor() { _autoSaveVendorField(); }
window.saveVendor = saveVendor;

function deleteVendor(idx: any) {
    if (!confirm(t("vendor.confirm_delete"))) return;
    var v = D.vendors[idx];
    if (v) {
        D.risks = D.risks.filter(function(r) { return r.vendor_id !== v.id; });
        D.assessments = D.assessments.filter(function(a) { return a.vendor_id !== v.id; });
        // Les documents portent aussi vendor_id : sans ce filtre ils restaient
        // dans D.documents, invisibles (toutes les vues filtrent par fournisseur)
        // mais comptes dans les indicateurs et reexportes.
        D.documents = (D.documents || []).filter(function(d: any) { return d.vendor_id !== v.id; });
    }
    var vid = v ? v.id : null;
    D.vendors.splice(idx, 1);
    _selectedVendor = null;
    if (vid) _persistDelete("vendor", vid);
    else _autoSave();
    renderPanel();
}
window.deleteVendor = deleteVendor;

function addRiskForVendor(vendorId: string) {
    var riskId = _nextVendorRiskId({ id: vendorId });
    var newRisk = {
        id: riskId, vendor_id: vendorId, title: "", description: "",
        category: "CYBER", impact: 3, likelihood: 3,
        treatment: { response: "mitigate", details: "", due_date: "" },
        residual_impact: 0, residual_likelihood: 0,
        status: "needs_treatment"
    };
    D.risks.push(newRisk);
    _persistCreate("risk", newRisk);
    renderPanel();
}
window.addRiskForVendor = addRiskForVendor;

function updateRiskField(riskIdx: any, field: string, value: string) {
    var r = D.risks[riskIdx];
    if (!r) return;
    if (field === "treatment.response") {
        if (!r.treatment) r.treatment = { response: "mitigate", details: "", due_date: "" };
        r.treatment.response = value;
        if (value === "accept") {
            r.residual_impact = r.impact || 0;
            r.residual_likelihood = r.likelihood || 0;
        } else if (value === "avoid") {
            r.residual_impact = 1;
            r.residual_likelihood = 1;
        }
    } else if (field === "impact" || field === "likelihood" || field === "residual_impact" || field === "residual_likelihood") {
        var val = parseInt(value) || 0;
        r[field] = val;
        if (field === "impact" && r.residual_impact! > val) r.residual_impact = val;
        if (field === "likelihood" && r.residual_likelihood! > val) r.residual_likelihood = val;
        if (field === "residual_impact" && val > (r.impact || 5)) r.residual_impact = r.impact || 5;
        if (field === "residual_likelihood" && val > (r.likelihood || 5)) r.residual_likelihood = r.likelihood || 5;
    } else {
        r[field] = value;
    }
    _persist("risk", r.id, { treatment: r.treatment, impact: r.impact, likelihood: r.likelihood, residual_impact: r.residual_impact, residual_likelihood: r.residual_likelihood, category: r.category, title: r.title, description: r.description, status: r.status });
    renderPanel();
}
window.updateRiskField = updateRiskField;

function deleteRisk(riskIdx: any) {
    if (!confirm(t("risk.confirm_delete"))) return;
    var rid = D.risks[riskIdx] ? D.risks[riskIdx].id : null;
    D.risks.splice(riskIdx, 1);
    if (rid) _persistDelete("risk", rid);
    else _autoSave();
    renderPanel();
}
window.deleteRisk = deleteRisk;

function newAssessment(vendorId: string) {
    _ensureDefaultTemplate();
    var templates = D.questionnaire_templates || [];
    // Group templates by kind with an <optgroup> each.
    var questionnaires = templates.filter(function(tp) { return (tp.kind || "questionnaire") === "questionnaire"; });
    var audits = templates.filter(function(tp) { return tp.kind === "audit"; });
    var tplOptions = "";
    function _opt(tp: any) {
        var sCount = (tp.sections || []).length;
        var qCount = (tp.sections || []).reduce(function(n: any, s: any) { return n + (s.questions || []).length; }, 0);
        return '<option value="' + esc(tp.id) + '">' + esc(tp.name) + '  —  ' + sCount + ' ' + esc(t("template.col_sections").toLowerCase()) + ', ' + qCount + ' ' + esc(t("template.col_questions").toLowerCase()) + '</option>';
    }
    if (questionnaires.length) {
        tplOptions += '<optgroup label="' + esc(t("template.kind_questionnaire")) + '">' + questionnaires.map(_opt).join("") + '</optgroup>';
    }
    if (audits.length) {
        tplOptions += '<optgroup label="' + esc(t("template.kind_audit")) + '">' + audits.map(_opt).join("") + '</optgroup>';
    }

    _showModal(
        '<h3>' + t("assessment.new") + '</h3>' +
        '<p class="ct-text-meta ct-ink-1 ct-mb-3">' + esc(_vendorName(vendorId)) + '</p>' +
        // Option 1: from template
        '<div class="ct-bg-canvas ct-bordered ct-r-md ct-p-3 ct-mb-2">' +
            '<div class="ct-overline ct-mb-2">' + esc(t("assessment.from_template")) + '</div>' +
            '<label class="ct-block ct-text-label ct-strong ct-mb-1">' + esc(t("assessment.choose_template")) + '</label>' +
            '<select id="na-template" class="ct-journal-body ct-py-1 ct-px-2 ct-bordered-line-strong ct-r-sm ct-font-inherit ct-mb-2">' + tplOptions + '</select>' +
            '<label class="ct-block ct-text-label ct-strong ct-mb-1">' + esc(t("assessment.due_date")) + '</label>' +
            '<input type="date" id="na-due-date" class="ct-journal-body ct-py-1 ct-px-2 ct-bordered-line-strong ct-r-sm ct-font-inherit ct-mb-2">' +
            '<button class="ct-btn ct-w-full" data-variant="primary" data-click="_newAssessmentFromTemplate" data-args=\'' + _da(vendorId) + '\'>' + esc(t("assessment.start_assessment")) + '</button>' +
        '</div>' +
        // Option 2: import response
        '<div class="ct-bg-canvas ct-bordered ct-r-md ct-p-3 ct-mb-2">' +
            '<div class="ct-overline ct-mb-2">' + esc(t("assessment.import_vendor_response")) + '</div>' +
            '<p class="ct-text-label ct-ink-1 ct-mb-2">' + esc(t("assessment.import_hint")) + '</p>' +
            '<button class="ct-btn ct-w-full" data-variant="primary" data-click="_importAssessmentResponse" data-args=\'' + _da(vendorId) + '\'>' + esc(t("assessment.import_file")) + '</button>' +
        '</div>'
        // BUG-17: V1 legacy creation (manual + Excel) removed — assessments are V2-only.
    );

    // Default due date = today + 30 days
    setTimeout(function() {
        var el = document.getElementById("na-due-date");
        if (el) {
            var d = new Date(); d.setDate(d.getDate() + 30);
            (el as HTMLInputElement).value = d.toISOString().split("T")[0];
        }
    }, 0);
}
window.newAssessment = newAssessment;

function backToVendors() { _selectedVendor = null; renderPanel(); }
window.backToVendors = backToVendors;

// ═══════════════════════════════════════════════════════════════
// QUESTIONNAIRE TEMPLATES
// ═══════════════════════════════════════════════════════════════
//
// Data model (mono-language, stored in D.questionnaire_templates):
//   {
//     id, name, description, language, version,
//     created_at, updated_at,
//     sections: [
//       {
//         id, title, description,
//         questions: [
//           {
//             id, type, text, description, expected,
//             weight, criticality, options
//           }
//         ]
//       }
//     ]
//   }
//
// Question types: yes_no, scale_1_5, single_choice, multi_choice,
// free_text, file_upload
// Criticality: info, major, blocker
// ═══════════════════════════════════════════════════════════════

var _editingTemplateId: string | null = null;

// Templates only support free_text questions now. The constant is kept
// for backwards compat and documentation; the editor no longer exposes
// a dropdown and the legacy types are healed to free_text at load time.
var QUESTION_TYPES = ["free_text"];
var CRITICALITY_LEVELS = ["info", "major", "blocker"];
var TEMPLATE_KINDS = ["questionnaire", "audit"];

function _nextTemplateId() {
    var n = (D.questionnaire_templates || []).length + 1;
    var id: string;
    do {
        id = "TPL-" + String(n).padStart(3, "0");
        n++;
    } while ((D.questionnaire_templates || []).some(function(t0) { return t0.id === id; }));
    return id;
}

function _nextSectionId(tpl: any) {
    var n = (tpl.sections || []).length + 1;
    var id: string;
    do {
        id = "SEC-" + String(n).padStart(3, "0");
        n++;
    } while ((tpl.sections || []).some(function(s: any) { return s.id === id; }));
    return id;
}

// Question IDs are unique at the TEMPLATE level (not the section level)
// so response lookups never collide between sections.
function _nextQuestionId(tpl: any) {
    var existing: Record<string, any> = {};
    (tpl.sections || []).forEach(function(s: any) {
        (s.questions || []).forEach(function(q: any) { if (q.id) existing[q.id] = true; });
    });
    var n = Object.keys(existing).length + 1;
    var id: string;
    do {
        id = "Q-" + String(n).padStart(3, "0");
        n++;
    } while (existing[id]);
    return id;
}

// Ensure a template has globally unique question IDs. Called on load
// to heal templates that were created before the fix.
function _normalizeTemplateQuestionIds(tpl: any) {
    if (!tpl || !tpl.sections) return false;
    var seen: Record<string, boolean> = {}, changed = false, mapping: Record<string, string> = {};
    var n = 1;
    tpl.sections.forEach(function(s: any) {
        (s.questions || []).forEach(function(q: any) {
            if (!q.id || seen[q.id]) {
                var oldId = q.id;
                var id: string;
                do {
                    id = "Q-" + String(n).padStart(3, "0");
                    n++;
                } while (seen[id]);
                if (oldId) mapping[oldId] = id;
                q.id = id;
                changed = true;
            }
            seen[q.id] = true;
            // Increment n beyond existing numeric suffix to keep things monotonic
            var m = /^Q-(\d+)$/.exec(q.id);
            if (m) { var num = parseInt(m[1], 10); if (num >= n) n = num + 1; }
        });
    });
    return changed;
}

function _today() { return new Date().toISOString().split("T")[0]; }

// Migrate legacy TPRM_QUESTIONS into a default template on first load.
// Called from renderPanel before rendering templates (or any assessments).
function _ensureDefaultTemplate() {
    if (!D.questionnaire_templates) D.questionnaire_templates = [];
    // Heal any existing templates:
    // - section-scoped IDs (pre-fix) may cause duplicate question ids
    // - missing `kind` field → default to "questionnaire"
    // - legacy question types → free_text (only supported type now)
    var healed = false;
    D.questionnaire_templates.forEach(function(tpl) {
        if (_normalizeTemplateQuestionIds(tpl)) healed = true;
        if (!tpl.kind) { tpl.kind = "questionnaire"; healed = true; }
        (tpl.sections || []).forEach(function(s) {
            (s.questions || []).forEach(function(q) {
                if (q.type !== "free_text") { q.type = "free_text"; healed = true; }
                if (q.options && q.options.length) { q.options = []; healed = true; }
            });
        });
    });
    // Heal maturity_config on projects created before phase 0 / step 4
    if (!D.maturity_config) {
        D.maturity_config = {
            weight_by_kind: { questionnaire: 1.0, audit: 1.5 },
            weight_by_template: {},
            decay_per_quarter: 0.0,
            min_effective_weight: 0.1
        };
        healed = true;
    }
    if (healed) _autoSave();

    var lang = (typeof _locale === "string" && _locale === "en") ? "en" : "fr";
    var added = false;

    // Seed the default vendor questionnaire if absent
    if (!D.questionnaire_templates.some(function(tp) { return tp.id === "TPL-001"; })) {
        if (typeof TPRM_QUESTIONS !== "undefined" && TPRM_QUESTIONS.length) {
            D.questionnaire_templates.push(_buildDefaultQuestionnaireTemplate(lang));
            added = true;
        }
    }
    // Seed the default audit template (ANSSI — 42 hygiene rules)
    if (!D.questionnaire_templates.some(function(tp) { return tp.id === "TPL-002"; })) {
        D.questionnaire_templates.push(_buildAnssi42AuditTemplate(lang));
        added = true;
    }
    if (added) _autoSave();
}

function _buildDefaultQuestionnaireTemplate(lang: string) {
    var tpl: TprmTemplate = {
        id: "TPL-001",
        name: lang === "en" ? "Standard vendor questionnaire" : "Questionnaire fournisseur standard",
        description: lang === "en"
            ? "Default security questionnaire (30 essential questions covering governance, access, cloud, DORA, etc.)."
            : "Questionnaire de securite par defaut (30 questions essentielles couvrant gouvernance, acces, cloud, DORA, etc.).",
        kind: "questionnaire",
        language: lang,
        version: 1,
        created_at: _today(),
        updated_at: _today(),
        sections: []
    };

    var domainTitles: Record<string, Record<string, string>> = {
        governance:     { fr: "Gouvernance et organisation",      en: "Governance and organization" },
        access:         { fr: "Controle d'acces",                 en: "Access control" },
        network:        { fr: "Securite reseau",                  en: "Network security" },
        dev:            { fr: "Developpement securise",           en: "Secure development" },
        data:           { fr: "Protection des donnees",           en: "Data protection" },
        endpoint:       { fr: "Securite des postes",              en: "Endpoint security" },
        detection:      { fr: "Detection et supervision",         en: "Detection and monitoring" },
        continuity:     { fr: "Continuite d'activite",            en: "Business continuity" },
        supply_chain:   { fr: "Chaine d'approvisionnement",       en: "Supply chain" },
        audit:          { fr: "Audit et conformite",              en: "Audit and compliance" },
        hr:             { fr: "Ressources humaines",              en: "Human resources" },
        physical:       { fr: "Securite physique",                en: "Physical security" },
        cloud:          { fr: "Securite cloud",                   en: "Cloud security" },
        incidents:      { fr: "Gestion des incidents",            en: "Incident management" },
        compliance:     { fr: "Conformite reglementaire",         en: "Regulatory compliance" },
        dora:           { fr: "DORA - Prestataire TIC critique",  en: "DORA - Critical ICT provider" }
    };

    var sectionMap: Record<string, any> = {};
    var globalQIdx = 0;
    TPRM_QUESTIONS.forEach(function(q) {
        var domain = q.domain || "other";
        if (!sectionMap.hasOwnProperty(domain)) {
            var title = (domainTitles[domain] && domainTitles[domain][lang]) || domain;
            tpl.sections.push({
                id: _nextSectionId(tpl),
                title: title,
                description: "",
                questions: []
            });
            sectionMap[domain] = tpl.sections.length - 1;
        }
        var section = tpl.sections[sectionMap[domain]];
        globalQIdx++;
        section.questions.push({
            id: "Q-" + String(globalQIdx).padStart(3, "0"),
            type: "free_text",
            text: lang === "en" ? (q.text_en || q.text_fr || "") : (q.text_fr || q.text_en || ""),
            description: "",
            expected: lang === "en" ? (q.expected_en || "") : (q.expected_fr || ""),
            weight: q.weight || 5,
            criticality: "major",
            options: []
        });
    });
    return tpl;
}

// ANSSI — 42 règles d'hygiène informatique
// Source: https://cyber.gouv.fr/publications/guide-dhygiene-informatique
// Organized in 10 thematic groups.
var ANSSI_42_RULES: { n: number; group: string; fr: string; en: string; [k: string]: any }[] = [
    // 1. Sensibiliser et former
    { n: 1, group: "training", fr: "Former les equipes operationnelles a la securite des systemes d'information", en: "Train operational teams on information system security" },
    { n: 2, group: "training", fr: "Sensibiliser les utilisateurs aux bonnes pratiques elementaires de securite informatique", en: "Raise user awareness of basic IT security practices" },
    { n: 3, group: "training", fr: "Maitriser les risques de l'infogerance", en: "Control the risks of outsourcing" },
    // 2. Connaitre le SI
    { n: 4, group: "inventory", fr: "Identifier les informations et serveurs les plus sensibles et maintenir un schema du reseau", en: "Identify the most sensitive information and servers and maintain a network diagram" },
    { n: 5, group: "inventory", fr: "Disposer d'un inventaire exhaustif des comptes privilegies et le maintenir a jour", en: "Maintain a complete and up-to-date inventory of privileged accounts" },
    { n: 6, group: "inventory", fr: "Organiser les procedures d'arrivee, de depart et de changement de fonction des utilisateurs", en: "Organize onboarding, offboarding and role change procedures" },
    { n: 7, group: "inventory", fr: "Autoriser la connexion au reseau de l'entite aux seuls equipements maitrises", en: "Only allow controlled devices to connect to the entity's network" },
    // 3. Authentifier et controler les acces
    { n: 8, group: "access", fr: "Identifier nommement chaque personne accedant au systeme et distinguer les roles utilisateur/administrateur", en: "Identify each user by name and separate user/administrator roles" },
    { n: 9, group: "access", fr: "Attribuer les bons droits sur les ressources sensibles du systeme d'information", en: "Grant appropriate rights on sensitive information system resources" },
    { n: 10, group: "access", fr: "Definir et verifier des regles de choix et de dimensionnement des mots de passe", en: "Define and enforce password selection and sizing rules" },
    { n: 11, group: "access", fr: "Proteger les mots de passe stockes sur les systemes", en: "Protect passwords stored on systems" },
    { n: 12, group: "access", fr: "Changer les elements d'authentification par defaut sur les equipements et services", en: "Change default authentication credentials on equipment and services" },
    { n: 13, group: "access", fr: "Privilegier lorsque c'est possible une authentification forte", en: "Favor strong authentication whenever possible" },
    // 4. Securiser les postes
    { n: 14, group: "endpoint", fr: "Mettre en place un niveau de securite minimal sur l'ensemble du parc informatique", en: "Establish a minimum security baseline across the IT estate" },
    { n: 15, group: "endpoint", fr: "Se proteger des menaces relatives a l'utilisation de supports amovibles", en: "Protect against threats from removable media" },
    { n: 16, group: "endpoint", fr: "Utiliser un outil de gestion centralise afin d'homogeneiser les politiques de securite", en: "Use centralized management to homogenize security policies" },
    { n: 17, group: "endpoint", fr: "Activer et configurer le pare-feu local des postes de travail", en: "Enable and configure local workstation firewalls" },
    { n: 18, group: "endpoint", fr: "Chiffrer les donnees sensibles transmises par voie Internet", en: "Encrypt sensitive data transmitted over the Internet" },
    // 5. Securiser le reseau
    { n: 19, group: "network", fr: "Segmenter le reseau et mettre en place un cloisonnement entre ces zones", en: "Segment the network and partition between zones" },
    { n: 20, group: "network", fr: "S'assurer de la securite des reseaux d'acces Wi-Fi et de la separation des usages", en: "Ensure Wi-Fi access network security and separation of uses" },
    { n: 21, group: "network", fr: "Utiliser des protocoles reseaux securises des qu'ils existent", en: "Use secure network protocols whenever available" },
    { n: 22, group: "network", fr: "Mettre en place une passerelle d'acces securise a Internet", en: "Implement a secure Internet access gateway" },
    { n: 23, group: "network", fr: "Cloisonner les services visibles depuis Internet du reste du systeme d'information", en: "Isolate Internet-facing services from the rest of the IS" },
    { n: 24, group: "network", fr: "Proteger sa messagerie professionnelle", en: "Protect the corporate email system" },
    { n: 25, group: "network", fr: "Securiser les interconnexions reseau dediees avec les partenaires", en: "Secure dedicated network interconnections with partners" },
    { n: 26, group: "network", fr: "Controler et proteger l'acces aux salles serveurs et aux locaux techniques", en: "Control and protect access to server rooms and technical premises" },
    // 6. Securiser l'administration
    { n: 27, group: "admin", fr: "Interdire l'acces a Internet depuis les comptes ou depuis les machines utilisees pour l'administration", en: "Forbid Internet access from admin accounts or admin machines" },
    { n: 28, group: "admin", fr: "Utiliser un reseau dedie et cloisonne pour l'administration du systeme d'information", en: "Use a dedicated and partitioned network for IS administration" },
    { n: 29, group: "admin", fr: "Limiter au strict besoin operationnel les droits d'administration sur les postes de travail", en: "Limit workstation admin rights to operational necessity" },
    // 7. Gerer le nomadisme
    { n: 30, group: "mobility", fr: "Prendre des mesures de securisation physique des terminaux nomades", en: "Take physical security measures for mobile devices" },
    { n: 31, group: "mobility", fr: "Chiffrer les donnees sensibles, en particulier sur le materiel potentiellement perdable", en: "Encrypt sensitive data, especially on devices that could be lost" },
    { n: 32, group: "mobility", fr: "Securiser la connexion reseau des postes utilises en situation de nomadisme", en: "Secure the network connection of mobile endpoints" },
    { n: 33, group: "mobility", fr: "Adopter des politiques de securite dediees aux terminaux mobiles", en: "Adopt dedicated security policies for mobile devices" },
    // 8. Maintenir le SI a jour
    { n: 34, group: "update", fr: "Definir une politique de mise a jour des composants du systeme d'information", en: "Define an IS component update policy" },
    { n: 35, group: "update", fr: "Anticiper la fin de la maintenance des logiciels et systemes et limiter les adherences logicielles", en: "Anticipate end-of-life of software and systems and limit dependencies" },
    // 9. Superviser, auditer, reagir
    { n: 36, group: "monitor", fr: "Activer et configurer les journaux des composants les plus importants", en: "Enable and configure logging for the most important components" },
    { n: 37, group: "monitor", fr: "Definir et appliquer une politique de sauvegarde des composants critiques", en: "Define and apply a backup policy for critical components" },
    { n: 38, group: "monitor", fr: "Proceder a des controles et audits de securite reguliers puis appliquer les actions correctives associees", en: "Carry out regular security checks and audits then apply corrective actions" },
    { n: 39, group: "monitor", fr: "Designer un point de contact en securite des systemes d'information et s'assurer de sa formation", en: "Appoint a security contact and ensure they are trained" },
    { n: 40, group: "monitor", fr: "Definir une procedure de gestion des incidents de securite", en: "Define a security incident management procedure" },
    // 10. Pour aller plus loin
    { n: 41, group: "advanced", fr: "Mener une analyse formelle des risques pesant sur le systeme d'information", en: "Conduct a formal risk analysis of the information system" },
    { n: 42, group: "advanced", fr: "Privilegier l'usage de produits et de services qualifies par l'ANSSI", en: "Prefer products and services certified by ANSSI" }
];

function _buildAnssi42AuditTemplate(lang: string) {
    var groupTitles: Record<string, Record<string, string>> = {
        training:  { fr: "1. Sensibiliser et former",               en: "1. Raise awareness and train" },
        inventory: { fr: "2. Connaitre le systeme d'information",   en: "2. Know the information system" },
        access:    { fr: "3. Authentifier et controler les acces",  en: "3. Authenticate and control access" },
        endpoint:  { fr: "4. Securiser les postes",                 en: "4. Secure workstations" },
        network:   { fr: "5. Securiser le reseau",                  en: "5. Secure the network" },
        admin:     { fr: "6. Securiser l'administration",           en: "6. Secure administration" },
        mobility:  { fr: "7. Gerer le nomadisme",                   en: "7. Manage mobility" },
        update:    { fr: "8. Maintenir le SI a jour",               en: "8. Keep the IS up to date" },
        monitor:   { fr: "9. Superviser, auditer, reagir",          en: "9. Monitor, audit, respond" },
        advanced:  { fr: "10. Pour aller plus loin",                en: "10. Going further" }
    };

    var tpl: TprmTemplate = {
        id: "TPL-002",
        name: lang === "en" ? "Audit - ANSSI 42 hygiene rules" : "Audit - 42 regles d'hygiene ANSSI",
        description: lang === "en"
            ? "Audit template based on the ANSSI 42 IT hygiene rules, organized into 10 thematic groups. Designed to be filled by an internal or external auditor against the vendor's environment."
            : "Modele d'audit base sur les 42 regles d'hygiene informatique ANSSI, organisees en 10 groupes thematiques. Destine a etre rempli par un auditeur interne ou externe pour le perimetre du fournisseur.",
        kind: "audit",
        language: lang,
        version: 1,
        created_at: _today(),
        updated_at: _today(),
        sections: []
    };

    var sectionIdx: Record<string, any> = {};
    ANSSI_42_RULES.forEach(function(rule, i) {
        if (!sectionIdx.hasOwnProperty(rule.group)) {
            tpl.sections.push({
                id: _nextSectionId(tpl),
                title: groupTitles[rule.group][lang],
                description: "",
                questions: []
            });
            sectionIdx[rule.group] = tpl.sections.length - 1;
        }
        var section = tpl.sections[sectionIdx[rule.group]];
        // Rule 1–42 directly as question IDs (stable across languages)
        var label = "R" + String(rule.n).padStart(2, "0") + " — " + rule[lang];
        section.questions.push({
            id: "Q-" + String(rule.n).padStart(3, "0"),
            type: "free_text",
            text: label,
            description: "",
            expected: "",
            weight: 5,
            criticality: "major",
            options: []
        });
    });
    return tpl;
}

// ── List view ──────────────────────────────────────────────────
function renderTemplateList() {
    _ensureDefaultTemplate();
    var templates = D.questionnaire_templates || [];
    var h = '<div class="tpl-header">';
    h += '<h2>' + t("template.title") + '</h2>';
    h += '<span class="ct-flex-1"></span>';
    h += '<div class="tpl-header-actions">';
    h += '<button class="ct-btn" data-variant="primary" data-size="sm" data-click="createTemplate" data-args=\'["questionnaire"]\'>' + _icon("plus") + '<span>' + t("template.new_questionnaire_short") + '</span></button>';
    h += '<button class="ct-btn" data-variant="primary" data-size="sm" data-click="createTemplate" data-args=\'["audit"]\'>' + _icon("plus") + '<span>' + t("template.new_audit_short") + '</span></button>';
    h += '<button class="ct-btn" data-variant="ghost" data-size="sm" data-click="importTemplateFromExcel" title="' + esc(t("template.import_excel_hint")) + '">' + _icon("upload") + '<span>' + t("template.import_excel") + '</span></button>';
    h += '<button class="ct-btn" data-variant="ghost" data-size="sm" data-click="downloadTemplateExcelExample" title="' + esc(t("template.download_example_hint")) + '">' + _icon("download") + '<span>' + t("template.download_example") + '</span></button>';
    h += '</div>';
    h += '</div>';
    h += '<p class="ct-panel-desc">' + t("template.intro") + '</p>';

    if (!templates.length) {
        return h + '<div class="ct-empty-state">' + t("template.empty") + '</div>';
    }

    templates.forEach(function(tpl) {
        var kind = tpl.kind || "questionnaire";
        var qCount = (tpl.sections || []).reduce(function(acc, s) { return acc + (s.questions || []).length; }, 0);
        var sCount = (tpl.sections || []).length;
        var kindIcon = kind === "audit" ? _icon("shield") : _icon("clipboard");
        h += '<div class="tpl-card" data-click="editTemplate" data-args=\'' + _da(tpl.id) + '\' role="button" tabindex="0" aria-label="' + esc(t("common.edit")) + ' ' + esc(tpl.name || tpl.id) + '">';
        h += '<div class="tpl-card-icon tpl-icon-' + kind + '">' + kindIcon + '</div>';
        h += '<div class="tpl-card-body">';
        h += '<div class="tpl-card-name">' + esc(tpl.name || "") + '  <span class="ct-ref" data-size="sm">' + esc(t("template.kind_" + kind)) + '</span></div>';
        h += '<div class="tpl-card-desc">' + esc(tpl.description || tpl.id) + '</div>';
        h += '</div>';
        h += '<div class="tpl-card-stats">';
        h += '<span><strong>' + sCount + '</strong> ' + t("template.col_sections").toLowerCase() + '</span>';
        h += '<span><strong>' + qCount + '</strong> ' + t("template.col_questions").toLowerCase() + '</span>';
        h += '<span>' + esc((tpl.language || "").toUpperCase()) + '</span>';
        h += '<span>v' + (tpl.version || 1) + '</span>';
        h += '</div>';
        h += '<div class="tpl-card-actions">';
        h += '<button class="ct-btn" data-size="xs" data-click="duplicateTemplate" data-args=\'' + _da(tpl.id) + '\' title="' + esc(t("common.duplicate")) + '" data-tooltip="' + esc(t("common.duplicate")) + '" aria-label="' + esc(t("common.duplicate")) + '" data-icon>' + _icon("copy") + '</button>';
        h += '<button class="ct-btn" data-variant="danger" data-size="xs" data-click="deleteTemplate" data-args=\'' + _da(tpl.id) + '\' title="' + esc(t("common.delete")) + '" data-tooltip="' + esc(t("common.delete")) + '" aria-label="' + esc(t("common.delete")) + '" data-icon>' + _icon("trash") + '</button>';
        h += '</div>';
        h += '</div>';
    });
    return h;
}

function createTemplate(kind: any) {
    var lang = (typeof _locale === "string" && _locale === "en") ? "en" : "fr";
    var k: TprmTemplateKind = (kind === "audit" ? "audit" : "questionnaire");
    var tpl: TprmTemplate = {
        id: _nextTemplateId(),
        name: lang === "en" ? (k === "audit" ? "New audit template" : "New template") : (k === "audit" ? "Nouveau modele d'audit" : "Nouveau template"),
        description: "",
        kind: k,
        language: lang,
        version: 1,
        created_at: _today(),
        updated_at: _today(),
        sections: []
    };
    if (!D.questionnaire_templates) D.questionnaire_templates = [];
    D.questionnaire_templates.push(tpl);
    _autoSave();
    _editingTemplateId = tpl.id;
    renderPanel();
}
window.createTemplate = createTemplate;

function editTemplate(tplId: string) {
    _editingTemplateId = tplId;
    renderPanel();
}
window.editTemplate = editTemplate;

function duplicateTemplate(tplId: string) {
    var src = (D.questionnaire_templates || []).find(function(tp) { return tp.id === tplId; });
    if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = _nextTemplateId();
    copy.name = src.name + " (copy)";
    copy.version = 1;
    copy.created_at = _today();
    copy.updated_at = _today();
    D.questionnaire_templates.push(copy);
    _autoSave();
    renderPanel();
}
window.duplicateTemplate = duplicateTemplate;

function deleteTemplate(tplId: string) {
    if (!confirm(t("template.confirm_delete"))) return;
    D.questionnaire_templates = (D.questionnaire_templates || []).filter(function(tp) { return tp.id !== tplId; });
    _autoSave();
    renderPanel();
}
window.deleteTemplate = deleteTemplate;

// ── Editor view ────────────────────────────────────────────────
function renderTemplateEditor(tplId: string) {
    var tpl = (D.questionnaire_templates || []).find(function(tp) { return tp.id === tplId; });
    if (!tpl) { _editingTemplateId = null; return renderTemplateList(); }

    var kind = tpl.kind || "questionnaire";
    var h = '<div class="tpl-header">';
    // Bouton de retour : ghost, comme partout ailleurs. En .btn-add il portait
    // l'aplat accent d'une action primaire, alors qu'il ne fait que sortir de
    // l'écran — la hiérarchie visuelle annonçait l'inverse de ce qu'il fait.
    h += '<button class="ct-btn" data-variant="ghost" data-click="closeTemplateEditor">&laquo; ' + t("template.back") + '</button>';
    h += '<h2>' + esc(tpl.name || "") + '</h2>';
    h += '<span class="ct-ref" data-size="sm">' + esc(t("template.kind_" + kind)) + '</span>';
    h += '<span class="tpl-meta">' + esc(tpl.id) + ' &middot; v' + (tpl.version || 1) + '</span>';
    h += '</div>';

    // Template metadata block — reuse .tprm-form design from vendor/measure forms
    h += '<div class="ct-tprm-form tpl-editor-meta">';
    h += '<div class="ct-form-grid">';
    h += '<div class="ct-form-row"><label>' + t("template.name") + '</label>';
    h += '<input type="text" value="' + esc(tpl.name || "") + '" data-input="_onTemplateFieldChange" data-args=\'' + _da(tpl.id, "name") + '\' data-pass-value></div>';
    h += '<div class="ct-form-row"><label>' + t("template.kind") + '</label>';
    h += '<select data-change="_onTemplateFieldChange" data-args=\'' + _da(tpl.id, "kind") + '\' data-pass-value>';
    TEMPLATE_KINDS.forEach(function(k) {
        h += '<option value="' + k + '"' + (kind === k ? " selected" : "") + '>' + esc(t("template.kind_" + k)) + '</option>';
    });
    h += '</select></div>';
    h += '</div>';
    h += '<div class="ct-form-grid">';
    h += '<div class="ct-form-row"><label>' + t("template.language") + '</label>';
    h += '<select data-change="_onTemplateFieldChange" data-args=\'' + _da(tpl.id, "language") + '\' data-pass-value>';
    h += '<option value="fr"' + (tpl.language === "fr" ? " selected" : "") + '>Francais</option>';
    h += '<option value="en"' + (tpl.language === "en" ? " selected" : "") + '>English</option>';
    h += '</select></div>';
    h += '<div class="ct-form-row"></div>'; // spacer for grid
    h += '</div>';
    h += '<div class="ct-form-row"><label>' + t("template.description") + '</label>';
    h += '<textarea rows="3" data-input="_onTemplateFieldChange" data-args=\'' + _da(tpl.id, "description") + '\' data-pass-value>' + esc(tpl.description || "") + '</textarea></div>';
    h += '</div>';

    // Sections header + add button
    var sections = tpl.sections || [];
    h += '<div class="tpl-header ct-mt-4 ct-mb-2">';
    h += '<span class="tpl-section-count">' + t("template.sections") + ' &middot; ' + sections.length + '</span>';
    h += '<span class="ct-flex-1"></span>';
    h += '<button class="ct-btn" data-variant="primary" data-size="xs" data-click="addSection" data-args=\'' + _da(tpl.id) + '\'>' + t("template.add_section") + '</button>';
    h += '</div>';

    if (!sections.length) {
        h += '<div class="ct-empty-state">' + t("template.no_sections") + '</div>';
    } else {
        sections.forEach(function(section, si) {
            h += _renderTemplateSection(tpl, section, si, sections.length);
        });
    }

    return h;
}

function _renderTemplateSection(tpl: any, section: any, si: any, total: any) {
    var h = '<div class="tpl-section">';
    // Section header
    h += '<div class="tpl-section-header">';
    h += '<span class="tpl-section-id">' + esc(section.id) + '</span>';
    h += '<input type="text" class="tpl-section-title" value="' + esc(section.title || "") + '" placeholder="' + esc(t("template.section_title")) + '" data-input="_onSectionFieldChange" data-args=\'' + _da(tpl.id, section.id, "title") + '\' data-pass-value>';
    h += '<button class="ct-btn" data-size="xs"' + (si === 0 ? ' disabled' : '') + ' data-click="moveSection" data-args=\'' + _da(tpl.id, section.id, -1) + '\' title="' + esc(t("common.move_up")) + '" data-icon>&uarr;</button>';
    h += '<button class="ct-btn" data-size="xs"' + (si === total - 1 ? ' disabled' : '') + ' data-click="moveSection" data-args=\'' + _da(tpl.id, section.id, 1) + '\' title="' + esc(t("common.move_down")) + '" data-icon>&darr;</button>';
    h += '<button class="ct-btn" data-variant="danger" data-size="sm" data-click="deleteSection" data-args=\'' + _da(tpl.id, section.id) + '\' title="' + esc(t("common.delete")) + '">&#x1F5D1;</button>';
    h += '</div>';
    // Section description
    h += '<textarea class="tpl-section-desc" rows="1" placeholder="' + esc(t("template.section_description")) + '" data-input="_onSectionFieldChange" data-args=\'' + _da(tpl.id, section.id, "description") + '\' data-pass-value>' + esc(section.description || "") + '</textarea>';

    // Questions
    var questions = section.questions || [];
    h += '<div class="tpl-section-questions-header">';
    h += '<span class="tpl-section-questions-label">' + t("template.questions") + ' &middot; ' + questions.length + '</span>';
    h += '<button class="ct-btn ct-text-label ct-py-1 ct-px-2" data-variant="primary" data-size="xs" data-click="addQuestion" data-args=\'' + _da(tpl.id, section.id) + '\'>' + t("template.add_question") + '</button>';
    h += '</div>';

    if (!questions.length) {
        h += '<div class="ct-journal-sep ct-text-label ct-p-3 ct-ta-c ct-bg-canvas ct-r-sm">' + t("template.no_questions") + '</div>';
    } else {
        questions.forEach(function(q: any, qi: any) {
            h += _renderTemplateQuestion(tpl, section, q, qi, questions.length);
        });
    }

    h += '</div>';
    return h;
}

function _renderTemplateQuestion(tpl: any, section: any, q: any, qi: any, total: any) {
    var h = '<div class="tpl-question crit-q-' + (q.criticality || "major") + '">';
    // Header row: id + criticality + weight + controls
    // Type dropdown removed — only free_text is supported now.
    h += '<div class="tpl-question-header">';
    h += '<span class="tpl-question-id">' + esc(q.id) + '</span>';
    // Le ton passe par data-tone, comme partout ailleurs : la couleur n'est plus
    // portee par le nom de la classe.
    var critTone = _vendorTone(q.criticality || "major");
    h += '<select class="tpl-criticality" data-tone="' + critTone + '" data-change="_onQuestionFieldChange" data-args=\'' + _da(tpl.id, section.id, q.id, "criticality") + '\' data-pass-value>';
    CRITICALITY_LEVELS.forEach(function(cr) {
        h += '<option value="' + cr + '"' + (q.criticality === cr ? " selected" : "") + '>' + esc(t("criticality." + cr)) + '</option>';
    });
    h += '</select>';
    h += '<label class="tpl-question-weight">' + t("template.weight");
    h += '<input type="number" min="0" max="100" value="' + (q.weight || 0) + '" data-input="_onQuestionFieldChange" data-args=\'' + _da(tpl.id, section.id, q.id, "weight") + '\' data-pass-value>';
    h += '</label>';
    h += '<span class="ct-flex-1"></span>';
    h += '<button class="ct-btn" data-size="xs"' + (qi === 0 ? ' disabled' : '') + ' data-click="moveQuestion" data-args=\'' + _da(tpl.id, section.id, q.id, -1) + '\' title="' + esc(t("common.move_up")) + '" data-icon>&uarr;</button>';
    h += '<button class="ct-btn" data-size="xs"' + (qi === total - 1 ? ' disabled' : '') + ' data-click="moveQuestion" data-args=\'' + _da(tpl.id, section.id, q.id, 1) + '\' title="' + esc(t("common.move_down")) + '" data-icon>&darr;</button>';
    h += '<button class="ct-btn" data-variant="danger" data-size="xs" data-click="deleteQuestion" data-args=\'' + _da(tpl.id, section.id, q.id) + '\' title="' + esc(t("common.delete")) + '" data-icon>' + _icon("trash", 14) + '</button>';
    h += '</div>';
    // Question text
    h += '<textarea class="tpl-question-text" rows="2" placeholder="' + esc(t("template.question_text")) + '" data-input="_onQuestionFieldChange" data-args=\'' + _da(tpl.id, section.id, q.id, "text") + '\' data-pass-value>' + esc(q.text || "") + '</textarea>';
    // Expected answer / evidence
    h += '<textarea class="tpl-question-expected" rows="1" placeholder="' + esc(t("template.question_expected")) + '" data-input="_onQuestionFieldChange" data-args=\'' + _da(tpl.id, section.id, q.id, "expected") + '\' data-pass-value>' + esc(q.expected || "") + '</textarea>';
    h += '</div>';
    return h;
}

function closeTemplateEditor() {
    _editingTemplateId = null;
    renderPanel();
}
window.closeTemplateEditor = closeTemplateEditor;

// ── Template/section/question edit handlers ────────────────────
function _findTemplate(tplId: string) {
    return (D.questionnaire_templates || []).find(function(tp) { return tp.id === tplId; });
}
function _findSection(tpl: any, sectionId: string) {
    if (!tpl || !tpl.sections) return null;
    return tpl.sections.find(function(s: any) { return s.id === sectionId; });
}
function _findQuestion(section: any, questionId: string) {
    if (!section || !section.questions) return null;
    return section.questions.find(function(q: any) { return q.id === questionId; });
}
function _touchTemplate(tpl: any) {
    tpl.updated_at = _today();
    _autoSave();
}

function _onTemplateFieldChange(tplId: string, field: string, value: string) {
    var tpl = _findTemplate(tplId);
    if (!tpl) return;
    (tpl as any)[field] = value;
    _touchTemplate(tpl);
    // Update title in header live
    if (field === "name") {
        var h2 = document.querySelector("#content h2");
        if (h2) h2.textContent = value;
    }
}
window._onTemplateFieldChange = _onTemplateFieldChange;

function _onSectionFieldChange(tplId: string, sectionId: string, field: string, value: string) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    if (!section) return;
    section[field] = value;
    _touchTemplate(tpl);
}
window._onSectionFieldChange = _onSectionFieldChange;

function _onQuestionFieldChange(tplId: string, sectionId: string, questionId: string, field: string, value: string) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    var q = _findQuestion(section, questionId);
    if (!q) return;
    if (field === "weight") {
        var n = parseInt(value, 10);
        q.weight = isNaN(n) ? 0 : Math.max(0, Math.min(100, n));
    } else {
        q[field] = value;
    }
    _touchTemplate(tpl);
    // Re-render on type change (options editor appears/disappears) and on
    // criticality change (select tone + question left-border follow the level)
    if (field === "type" || field === "criticality") renderPanel();
}
window._onQuestionFieldChange = _onQuestionFieldChange;

function addSection(tplId: string) {
    var tpl = _findTemplate(tplId);
    if (!tpl) return;
    if (!tpl.sections) tpl.sections = [];
    tpl.sections.push({
        id: _nextSectionId(tpl),
        title: t("template.new_section"),
        description: "",
        questions: []
    });
    _touchTemplate(tpl);
    renderPanel();
}
window.addSection = addSection;

function deleteSection(tplId: string, sectionId: string) {
    if (!confirm(t("template.confirm_delete_section"))) return;
    var tpl = _findTemplate(tplId);
    if (!tpl) return;
    tpl.sections = tpl.sections.filter(function(s) { return s.id !== sectionId; });
    _touchTemplate(tpl);
    renderPanel();
}
window.deleteSection = deleteSection;

function moveSection(tplId: string, sectionId: string, delta: number) {
    var tpl = _findTemplate(tplId);
    if (!tpl || !tpl.sections) return;
    var idx = tpl.sections.findIndex(function(s) { return s.id === sectionId; });
    var newIdx = idx + delta;
    if (idx < 0 || newIdx < 0 || newIdx >= tpl.sections.length) return;
    var tmp = tpl.sections[idx];
    tpl.sections[idx] = tpl.sections[newIdx];
    tpl.sections[newIdx] = tmp;
    _touchTemplate(tpl);
    renderPanel();
}
window.moveSection = moveSection;

function addQuestion(tplId: string, sectionId: string) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    if (!section) return;
    if (!section.questions) section.questions = [];
    section.questions.push({
        id: _nextQuestionId(tpl),
        type: "free_text",
        text: "",
        description: "",
        expected: "",
        weight: 5,
        criticality: "major",
        options: []
    });
    _touchTemplate(tpl);
    renderPanel();
}
window.addQuestion = addQuestion;

function deleteQuestion(tplId: string, sectionId: string, questionId: string) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    if (!section) return;
    section.questions = section.questions.filter(function(q: any) { return q.id !== questionId; });
    _touchTemplate(tpl);
    renderPanel();
}
window.deleteQuestion = deleteQuestion;

function moveQuestion(tplId: string, sectionId: string, questionId: string, delta: number) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    if (!section || !section.questions) return;
    var idx = section.questions.findIndex(function(q: any) { return q.id === questionId; });
    var newIdx = idx + delta;
    if (idx < 0 || newIdx < 0 || newIdx >= section.questions.length) return;
    var tmp = section.questions[idx];
    section.questions[idx] = section.questions[newIdx];
    section.questions[newIdx] = tmp;
    _touchTemplate(tpl);
    renderPanel();
}
window.moveQuestion = moveQuestion;

// ═══════════════════════════════════════════════════════════════
// ASSESSMENTS V2 (template-driven)
// ═══════════════════════════════════════════════════════════════
//
// Extended assessment data model (stored in D.assessments[], alongside
// legacy assessments). A template-driven assessment carries:
//
//   {
//     id, vendor_id, type: "periodic",
//     date, due_date,                                 (new)
//     template_id, template_version, template_snapshot,  (new — snapshot
//                                                         is frozen at
//                                                         creation so the
//                                                         assessment stays
//                                                         valid if the
//                                                         template later
//                                                         evolves)
//     status: draft | in_progress | pending_approval | validated | rejected
//     responses: [                                    (new shape)
//       {
//         question_id,
//         coverage: covered | partial | not_covered | not_applicable,
//         answer,                                      (type-dependent:
//                                                       yes_no: "yes"/"no"
//                                                       scale_1_5: 1..5
//                                                       single_choice: string
//                                                       multi_choice: string[]
//                                                       free_text: string
//                                                       file_upload: {name,size,hash})
//         comment,
//         action_plans: [                              (required when
//           { id, title, description, target_date, owner, status }
//         ],
//         justification                                (optional when
//                                                       partial/not_covered
//                                                       and no action plan)
//       }
//     ],
//     self_validation: false,
//     self_validated_at: null,
//     score, completion_rate,
//     approved_at, approved_by, rejected_reason
//   }
//
// Legacy assessments (without template_id) continue to work via the old
// openAssessment / setAnswer / saveAssessment functions.
// ═══════════════════════════════════════════════════════════════

var _assessmentV2Returning: number | null = null; // vendorIdx to return to after save

// Numerotation par le MAXIMUM existant, jamais par la longueur du tableau :
// apres une suppression, la longueur redonne un identifiant deja pris, et le
// nouvel objet se confond alors avec un ancien. _nextAssessmentId fait de meme
// en bouclant ; ce helper generalise le principe aux autres collections.
function _nextSeqId(prefix: string, items: any[], field?: string): string {
    var f = field || "id";
    var max = 0;
    (items || []).forEach(function(it: any) {
        var m = String((it && it[f]) || "").match(/(\d+)/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return prefix + "-" + String(max + 1).padStart(3, "0");
}

// Appele par _dirPicker avec l'email choisi. Le nom est resolu depuis
// l'annuaire quand il est disponible, sinon on conserve ce qui est saisi —
// en mode autonome, _dirPicker rend un champ texte libre.
function updateVendorInternalContact(vendorIdx: number, email: string) {
    var v = D.vendors[vendorIdx];
    if (!v) return;
    var resolved = (typeof (window as any)._dirResolve === "function")
        ? (window as any)._dirResolve(email) : "";
    v.internal_contact = { name: resolved || email || "", email: email || "" };
    _persist("vendor", v.id, { internal_contact: v.internal_contact });
}

function _nextAssessmentId() {
    var n = (D.assessments || []).length + 1;
    var id: string;
    do {
        id = "EVAL-" + String(n).padStart(3, "0");
        n++;
    } while ((D.assessments || []).some(function(a) { return a.id === id; }));
    return id;
}

function _getAssessmentTemplate(a: any) {
    if (a.template_snapshot) return a.template_snapshot;
    if (!a.template_id) return null;
    return (D.questionnaire_templates || []).find(function(tp) { return tp.id === a.template_id; }) || null;
}

// Returns the "kind" (questionnaire | audit) for an assessment,
// defaulting to "questionnaire" for legacy data.
function _assessmentKind(a: any) {
    var tpl = _getAssessmentTemplate(a);
    return (tpl && tpl.kind) || "questionnaire";
}

// Pick the right i18n key based on the assessment kind. Falls back to the
// generic key if the kind-specific one is missing.
function _tk(a: any, baseKey: string) {
    var kind = _assessmentKind(a);
    var specific = baseKey + "_" + kind;
    var val = t(specific);
    if (val && val !== specific) return val;
    return t(baseKey);
}

function _allQuestions(tpl: any) {
    if (!tpl || !tpl.sections) return [];
    var out: any[] = [];
    tpl.sections.forEach(function(s: any) {
        (s.questions || []).forEach(function(q: any) { out.push(Object.assign({}, q, { section_id: s.id, section_title: s.title })); });
    });
    return out;
}

function _newAssessmentFromTemplate(vendorId: string) {
    var tplSelect = document.getElementById("na-template");
    var dueEl = document.getElementById("na-due-date");
    if (!tplSelect || !dueEl) return;
    var tplId = (tplSelect as HTMLInputElement).value;
    var tpl = (D.questionnaire_templates || []).find(function(tp) { return tp.id === tplId; });
    if (!tpl) return;

    var assessId = _nextAssessmentId();
    // Pre-populate responses with empty objects for each question
    var responses = _allQuestions(tpl).map(function(q) {
        return {
            question_id: q.id,
            coverage: null,
            answer: q.type === "multi_choice" ? [] : null,
            comment: "",
            action_plans: [],
            justification: ""
        };
    });

    var newAssess: TprmAssessment = {
        id: assessId,
        vendor_id: vendorId,
        type: "periodic",
        date: _today(),
        due_date: (dueEl as HTMLInputElement).value || "",
        template_id: tpl.id,
        template_version: tpl.version || 1,
        template_snapshot: JSON.parse(JSON.stringify(tpl)),
        status: "draft",
        responses: responses,
        self_validation: false,
        self_validated_at: null,
        score: null,
        completion_rate: 0
    };
    D.assessments.push(newAssess);
    _persistCreate("assessment", newAssess as unknown as VendorApiPayload);
    closeModal();
    if (_selectedVendor !== null) _assessmentV2Returning = _selectedVendor;
    openAssessmentV2(assessId);
}
window._newAssessmentFromTemplate = _newAssessmentFromTemplate;

// ── Renderer ──────────────────────────────────────────────────
function openAssessmentV2(assessId: string) {
    var a = D.assessments.find(function(x) { return x.id === assessId; });
    if (!a) return;
    if (!a.template_snapshot) _migrateAssessmentToV2(a); // legacy V1 → V2 on the fly
    if (!a.template_snapshot) return; // migration impossible (no default template)
    // Recompute stats every time we render — covers cases where the assessment
    // was touched before the latest stats algorithm change.
    _touchAssessment(a);
    var v = D.vendors.find(function(x) { return x.id === a!.vendor_id; });
    var tpl = a.template_snapshot;
    var qs = _allQuestions(tpl);
    var totalQ = qs.length;

    var stats = _assessmentStats(a);
    var answered = stats.answered;
    var completion = totalQ > 0 ? Math.round((answered / totalQ) * 100) : 0;
    var score = _computeAssessmentV2Score(a);

    // ── Header ──
    var kind = _assessmentKind(a);
    var h = '<div class="tpl-header">';
    h += '<button class="ct-btn" data-variant="ghost" data-size="sm" data-click="_backFromAssessmentV2">&laquo; ' + t("nav.assessments") + '</button>';
    h += '<h2>' + esc(a.id) + ' — ' + esc(_vendorName(a.vendor_id)) + '</h2>';
    h += '<span class="ct-ref" data-size="sm">' + esc(t("template.kind_" + kind)) + '</span>';
    h += '<span class="tpl-meta">' + esc(tpl.name) + ' v' + (a.template_version || 1) + '</span>';
    h += '</div>';

    // Status + due date + score
    h += '<div class="ct-flex ct-gap-2 ct-items-center ct-row-wrap ct-mb-2 ct-text-label ct-ink-1">';
    h += '<span>' + esc(t("assessment.status")) + ' <strong class="evalv2-status evalv2-status-' + esc(a.status || "draft") + '">' + esc(t("assessment.status_" + (a.status || "draft"))) + '</strong></span>';
    if (a.due_date) h += '<span>' + esc(t("assessment.due_date")) + ' <strong>' + esc(a.due_date) + '</strong></span>';
    h += '<span class="ct-flex-1"></span>';
    h += '<div class="score-gauge"><span class="score-val ' + _scoreColorClass(score) + '">' + score + '%</span></div>';
    h += '</div>';

    // Progress
    h += '<div id="evalv2-progress-wrap" class="ct-mb-3">';
    h += '<div class="ct-flex ct-items-center ct-gap-2">';
    h += '<div class="ct-flex-1 ct-h-8 ct-bg-canvas ct-r-sm ct-overflow-hidden">';
    h += '<div id="evalv2-progress-bar" style="width:' + completion + '%;height:100%;background:' + (completion === 100 ? 'var(--ct-low)' : 'var(--ct-accent)') + ';border-radius:4px;transition:width 0.3s"></div>';
    h += '</div>';
    h += '<span id="evalv2-progress-label" style="font-size:var(--ct-text-label);font-weight:600;color:' + (completion === 100 ? 'var(--ct-low)' : 'var(--ct-ink-1)') + '">' + completion + '% (' + answered + '/' + totalQ + ')</span>';
    h += '</div>';
    // Completeness hints
    h += '<div id="evalv2-hints">' + _renderAssessmentHints(stats) + '</div>';
    h += '</div>';

    // Actions toolbar
    h += '<div class="ct-flex ct-gap-1 ct-row-wrap ct-mb-3">';
    h += '<button class="ct-btn" data-variant="primary" data-click="_exportAssessmentJSON" data-args=\'' + _da(a.id) + '\'>' + esc(t("assessment.export_json")) + '</button>';
    // Portal link only makes sense for questionnaires sent to vendors.
    // For audits the auditor fills the questionnaire with their own tools,
    // so the link flow does not apply.
    if (kind !== "audit") {
        h += '<button class="ct-btn" data-variant="primary" data-click="_exportAssessmentLink" data-args=\'' + _da(a.id) + '\'>' + esc(t("assessment.export_link")) + '</button>';
    }
    h += '<button class="ct-btn" data-variant="primary" data-click="_exportAssessmentExcel" data-args=\'' + _da(a.id) + '\'>' + esc(_tk(a, "assessment.export_excel")) + '</button>';
    h += '<button class="ct-btn" data-variant="primary" data-click="_importAssessmentIntoExisting" data-args=\'' + _da(a.id) + '\'>' + esc(_tk(a, "assessment.import_response")) + '</button>';
    h += '<span class="ct-flex-1"></span>';
    if (a.status === "pending_approval") {
        h += '<button class="ct-btn" data-variant="primary" data-click="_approveAssessment" data-args=\'' + _da(a.id) + '\'>' + esc(t("assessment.approve")) + '</button>';
        h += '<button class="ct-btn" data-variant="danger" data-size="sm" data-click="_rejectAssessment" data-args=\'' + _da(a.id) + '\'>' + esc(t("assessment.reject")) + '</button>';
    }
    h += '</div>';
    // Review hint: when a submitted response carries vendor-proposed action plans,
    // make it explicit that approving turns them into tracked measures (editable
    // in the responses below beforehand).
    if (a.status === "pending_approval") {
        var _apN = (a.responses || []).reduce(function(n: number, r: any) { return n + ((r.action_plans || []).length); }, 0);
        if (_apN > 0) {
            h += '<div class="ct-hint ct-mb-3">' + esc(t("assessment.approve_materialize_hint", { n: _apN })) + '</div>';
        }
    }

    // ── Sections + questions ──
    tpl.sections.forEach(function(section) {
        h += '<div class="tpl-section">';
        h += '<div class="tpl-section-header">';
        h += '<span class="tpl-section-id">' + esc(section.id) + '</span>';
        h += '<span class="tpl-section-title">' + esc(section.title) + '</span>';
        if (typeof _aiIsEnabled === "function" && _aiIsEnabled() && a!.status !== "validated") {
            h += '<button class="ct-btn btn-ai ct-ml-auto" data-size="xs" data-click="aiSuggestSectionV2" data-args=\'' + _da(a!.id, section.id) + '\' title="' + esc(t("ai.btn")) + '">&#10024;</button>';
        }
        h += '</div>';
        if (section.description) {
            h += '<div class="ct-text-meta ct-ink-1 ct-mb-2">' + esc(section.description) + '</div>';
        }
        (section.questions || []).forEach(function(q) {
            var resp = (a!.responses || []).find(function(r) { return r.question_id === q.id; }) || ({} as TprmResponse);
            h += _renderAssessmentQuestion(a, section, q, resp);
        });
        h += '</div>';
    });

    // Self-validation
    var canValidate = completion === 100;
    var validationBlockStyle = canValidate ? "border-color:var(--ct-accent)" : "border-color:var(--ct-line-strong);opacity:0.75";
    h += '<div id="evalv2-validation-block" class="tpl-section" style="' + validationBlockStyle + '">';
    h += '<div class="tpl-section-header">';
    h += '<span class="tpl-section-title">' + esc(_tk(a, "assessment.self_validation_title")) + '</span>';
    h += '</div>';
    h += '<p style="font-size:var(--ct-text-meta);color:var(--ct-ink-1);margin:0 0 var(--ct-s2)">' + esc(_tk(a, "assessment.self_validation_hint")) + '</p>';
    var cursor = canValidate ? "pointer" : "not-allowed";
    var labelTitle = canValidate ? "" : ' title="' + esc(t("assessment.complete_all_questions")) + '"';
    h += '<label id="evalv2-validation-label" style="display:flex;align-items:center;gap:8px;font-size:var(--ct-text-data);font-weight:600;cursor:' + cursor + '"' + labelTitle + '>';
    h += '<input type="checkbox" id="evalv2-validation-check"' + (a.self_validation ? " checked" : "") + (canValidate ? "" : " disabled") + ' data-change="_toggleSelfValidation" data-args=\'' + _da(a.id) + '\' data-pass-checked>';
    h += '<span>' + esc(_tk(a, "assessment.self_validation_label")) + '</span>';
    h += '</label>';
    // Helper text when disabled
    h += '<div id="evalv2-validation-helper" style="font-size:var(--ct-text-label);color:var(--ct-high);margin-top:var(--ct-s1);display:' + (canValidate ? "none" : "block") + '">';
    h += '&#9888; ' + esc(t("assessment.complete_all_questions"));
    h += '</div>';
    if (a.self_validated_at) {
        h += '<div id="evalv2-validated-on" class="ct-text-label ct-ink-1 ct-mt-1">' + esc(t("assessment.self_validated_on")) + ' ' + esc(a.self_validated_at) + '</div>';
    }
    h += '</div>';

    // Footer: Save + Submit for approval
    h += '<div class="form-actions">';
    h += '<button class="ct-btn" data-variant="ghost" data-size="sm" data-click="_backFromAssessmentV2">' + esc(t("common.close")) + '</button>';
    h += '<span id="evalv2-submit-wrap">' + _renderSubmitButton(a, completion) + '</span>';
    h += '</div>';

    var c = document.getElementById("content");
    c!.innerHTML = h;
}
window.openAssessmentV2 = openAssessmentV2;

// BUG-17: AI assist INSIDE a V2 assessment. Fills coverage + justification for a
// section's questions in the V2 schema (coverage/justification), so an
// AI-assisted questionnaire behaves exactly like a manually-filled one — same
// renderer, scoring, action plans and validation cycle. Replaces the V1-only
// aiSuggestDomain path.
function aiSuggestSectionV2(assessId: string, sectionId: string) {
    var a = _findAssessment(assessId);
    if (!a || !a.template_snapshot || typeof _aiIsEnabled !== "function" || !_aiIsEnabled()) return;
    if (a.status === "validated") return;
    var v = D.vendors.find(function(x) { return x.id === a!.vendor_id; });
    var section = (a.template_snapshot.sections || []).find(function(s: any) { return s.id === sectionId; });
    if (!section) return;
    var questions = section.questions || [];
    if (!questions.length) return;

    var lang = typeof _locale !== "undefined" ? _locale : "fr";
    // The suggest-assessment endpoint owns the assessor methodology prompt and
    // returns {question_id, answer: compliant|partial|non_compliant|na, comment}.
    // Map answer → V2 coverage so the V2 schema (coverage/justification) is fed.
    var ANS2COV: Record<string, string> = { compliant: "covered", partial: "partial", non_compliant: "not_covered", na: "not_applicable" };

    showStatus(t("measure.ai_loading"));
    _aiPost("vendor/suggest-assessment", {
        language: lang === "en" ? "en" : "fr",
        vendor_name: (v || {}).name || "",
        vendor_sector: (v || {}).sector || "",
        vendor_website: (v || {}).website || "",
        certifications: (v || {}).certifications || [],
        questions: questions.map(function(q: any) {
            return { id: q.id, text: (q.text || "") + (q.expected ? " [expected: " + q.expected + "]" : "") };
        })
    }).then(function(jr: any) {
        var suggestions = jr.result;
        if (!Array.isArray(suggestions)) suggestions = [suggestions];
        if (!a!.responses) a!.responses = [];
        var COV = ["covered", "partial", "not_covered", "not_applicable"];
        var n = 0;
        suggestions.forEach(function(s: any) {
            if (!s || !s.question_id) return;
            if (!questions.some(function(q: any) { return q.id === s.question_id; })) return;
            var cov = s.coverage || ANS2COV[s.answer];
            if (COV.indexOf(cov) < 0) return;
            var resp: any = a!.responses!.find(function(r) { return r.question_id === s.question_id; });
            if (!resp) {
                resp = { question_id: s.question_id, coverage: null, answer: null, comment: "", action_plans: [], justification: "" };
                a!.responses!.push(resp);
            }
            resp.coverage = cov;
            if (s.comment && !resp.comment) resp.comment = String(s.comment);
            if (cov === "covered" || cov === "not_applicable") {
                resp.action_plans = [];
                resp.justification = "";
            } else if (!(resp.justification || "").trim()) {
                // R4: partial / not_covered need an action plan OR a justification.
                resp.justification = String(s.justification || s.comment || "");
            }
            n++;
        });
        _touchAssessment(a);
        openAssessmentV2(assessId);
        showStatus(n + " " + t("assessment.ai_suggested"));
    }).catch(function(e: any) { showStatus(t("measure.ai_error") + ": " + e.message); });
}
window.aiSuggestSectionV2 = aiSuggestSectionV2;

// BUG-17 ménage: migrate a legacy V1 assessment (responses[].answer, no
// template_snapshot) to the V2 schema (template_snapshot + coverage). V1
// question ids are "Q01".."Q25" (TPRM_QUESTIONS order); V2 template ids are
// "Q-001".."Q-025" in the same order, so we match by the numeric part. The
// backend accepts a snapshot on a legacy row (first-time creation, see
// assessment_validation._enforce_snapshot_immutability), so the migration is
// persisted, not just in-memory.
function _migrateAssessmentToV2(a: any): any {
    if (!a || a.template_snapshot) return a; // already V2 or invalid
    if (typeof _ensureDefaultTemplate === "function") _ensureDefaultTemplate();
    var tpl: any = (D.questionnaire_templates || []).find(function(tp) { return tp.id === "TPL-001"; })
        || (D.questionnaire_templates || [])[0];
    if (!tpl) return a;
    var covMap: Record<string, string> = { compliant: "covered", partial: "partial", non_compliant: "not_covered", na: "not_applicable" };
    var oldByNum: Record<string, any> = {};
    (a.responses || []).forEach(function(r: any) {
        var m = String(r.question_id || "").match(/(\d+)/);
        if (m) oldByNum[String(parseInt(m[1], 10))] = r;
    });
    a.template_id = tpl.id;
    a.template_version = tpl.version || 1;
    a.template_snapshot = JSON.parse(JSON.stringify(tpl));
    a.responses = _allQuestions(a.template_snapshot).map(function(q: any) {
        var resp: any = { question_id: q.id, coverage: null, answer: q.type === "multi_choice" ? [] : null, comment: "", action_plans: [], justification: "" };
        var m = String(q.id).match(/(\d+)/);
        var old = m ? oldByNum[String(parseInt(m[1], 10))] : null;
        if (old) {
            var cov = covMap[old.answer];
            if (cov) resp.coverage = cov;
            resp.comment = old.comment || "";
            if (cov === "partial" || cov === "not_covered") resp.justification = old.comment || "Migré depuis V1 — à confirmer.";
        }
        return resp;
    });
    if (a.self_validation == null) a.self_validation = false;
    if (a.status === "completed") a.status = "validated";
    else if (!a.status) a.status = "in_progress";
    if (typeof _touchAssessment === "function") _touchAssessment(a);
    // Persist the snapshot too (_touchAssessment only sends score/completion/status/responses).
    if (typeof _persist === "function") _persist("assessment", a.id, {
        template_snapshot: a.template_snapshot, template_id: a.template_id,
        template_version: a.template_version, self_validation: a.self_validation
    });
    return a;
}
function _migrateAllLegacyAssessments(): number {
    var n = 0;
    (D.assessments || []).forEach(function(a: any) {
        if (a && !a.template_snapshot) { _migrateAssessmentToV2(a); n++; }
    });
    return n;
}

function _renderAssessmentQuestion(a: any, section: any, q: any, resp: any) {
    var h = '<div class="tpl-question">';
    // Header
    h += '<div class="tpl-question-header">';
    h += '<span class="tpl-question-id">' + esc(q.id) + '</span>';
    var crit = q.criticality || "major";
    h += '<span class="ct-badge" data-tone="' + _vendorTone(crit) + '">' + esc(t("criticality." + crit)) + '</span>';
    h += '<span class="tpl-question-id" style="min-width:auto;border:none;background:var(--ct-surface-2)">' + esc(t("qtype." + (q.type || "free_text"))) + '</span>';
    h += '</div>';
    // Question text
    h += '<div style="font-weight:600;font-size:var(--ct-text-ui);margin:var(--ct-s1) 0">' + esc(q.text || "") + '</div>';
    if (q.expected) {
        h += '<details class="ct-mb-2"><summary class="ct-text-label ct-text-accent ct-clickable">' + esc(t("assessment.expected")) + '</summary>';
        h += '<div class="ct-text-label ct-ink-1 ct-py-1 ct-px-0">' + esc(q.expected) + '</div>';
        h += '</details>';
    }
    // Type-specific input
    h += _renderAnswerInput(a.id, q, resp);
    // Coverage pills
    h += '<div class="ct-mt-2">';
    h += '<div class="ct-overline ct-mb-1">' + esc(t("assessment.coverage")) + '</div>';
    h += '<div class="answer-pills">';
    ["covered", "partial", "not_covered", "not_applicable"].forEach(function(cov) {
        var sel = resp.coverage === cov ? " selected" : "";
        var cls = cov === "covered" ? "compliant" : (cov === "partial" ? "partial" : (cov === "not_covered" ? "non_compliant" : ""));
        h += '<div class="answer-pill ' + cls + sel + '" data-click="_setCoverage" data-args=\'' + _da(a.id, q.id, cov) + '\'>' + esc(t("coverage." + cov)) + '</div>';
    });
    h += '</div>';
    h += '</div>';
    // Comment
    h += '<div class="ct-mt-2">';
    h += '<textarea rows="2" class="tpl-question-expected" placeholder="' + esc(t("assessment.comment")) + '" data-input="_onAssessmentCommentChange" data-args=\'' + _da(a.id, q.id) + '\' data-pass-value>' + esc(resp.comment || "") + '</textarea>';
    h += '</div>';
    // Action plans (only when partial / not_covered)
    if (resp.coverage === "partial" || resp.coverage === "not_covered") {
        var hasAction = (resp.action_plans && resp.action_plans.length > 0 &&
            resp.action_plans.some(function(ap: any) { return (ap.title || "").trim().length > 0; }));
        var hasJust = (resp.justification || "").trim().length > 0;
        var satisfied = hasAction || hasJust;
        var blockColor = satisfied ? "var(--ct-low)" : "var(--ct-high)";
        var blockBg = satisfied ? "var(--ct-low-tint)" : "var(--ct-high-tint)";
        h += '<div id="actionblk-' + esc(a.id) + '-' + esc(q.id) + '" style="margin-top:var(--ct-s2);padding:12px;background:' + blockBg + ';border-radius:4px;border-left:4px solid ' + blockColor + '">';
        // Explicit banner
        if (!satisfied) {
            h += '<div class="ct-flex ct-items-start ct-gap-2 ct-mb-2">';
            h += '<span style="color:var(--ct-high);font-size:var(--ct-text-section);line-height:1">&#9888;</span>';
            h += '<div>';
            h += '<div class="ct-text-meta ct-bold ct-text-high-ink">' + esc(_tk(a, "assessment.action_required_title")) + '</div>';
            h += '<div class="ct-text-label ct-text-high-ink ct-mt-1">' + esc(resp.coverage === "partial" ? _tk(a, "assessment.action_required_partial") : _tk(a, "assessment.action_required_not_covered")) + '</div>';
            h += '</div>';
            h += '</div>';
        } else {
            h += '<div class="ct-flex ct-items-center ct-gap-2 ct-mb-2 ct-text-low-ink ct-text-label ct-strong">';
            h += '<span>&#10003;</span>';
            h += esc(hasAction ? _tk(a, "assessment.action_recorded") : _tk(a, "assessment.justification_recorded"));
            h += '</div>';
        }
        // Action list
        if (resp.action_plans && resp.action_plans.length) {
            h += '<div class="ct-overline ct-mb-1">' + esc(_tk(a, "assessment.action_plan_required")) + '</div>';
            resp.action_plans.forEach(function(ap: any, api: number) {
                h += _renderActionPlanForm(a, q.id, ap, api);
            });
        }
        h += '<div class="ct-flex ct-gap-2 ct-mt-1 ct-row-wrap">';
        // La variante porte l'état : primaire quand l'exigence est satisfaite,
        // avertissement sinon. Un fond posé en style inline ne suit pas le thème
        // et échappe au data-variant du socle.
        h += '<button class="ct-btn ct-m-0" data-size="xs" data-variant="' + (satisfied ? "primary" : "neutral") + '" data-click="_addActionPlan" data-args=\'' + _da(a.id, q.id) + '\'>+ ' + esc(_tk(a, "assessment.add_action_plan")) + '</button>';
        h += '</div>';
        // Justification (alternative)
        h += '<div class="ct-mt-2">';
        h += '<label class="ct-text-label ct-strong ct-ink-1 ct-block ct-mb-1">' + esc(_tk(a, "assessment.justification_or")) + '</label>';
        h += '<textarea rows="2" class="tpl-question-expected" placeholder="' + esc(_tk(a, "assessment.justification_placeholder")) + '" data-input="_onAssessmentJustificationChange" data-args=\'' + _da(a.id, q.id) + '\' data-pass-value>' + esc(resp.justification || "") + '</textarea>';
        h += '</div>';
        h += '</div>';
    }
    h += '</div>';
    return h;
}

function _renderAnswerInput(assessId: string, q: any, resp: any) {
    // Templates only carry free_text questions now. We keep this function
    // because it is still called once per question; rendering a textarea
    // is the only path.
    var val = resp.answer;
    return '<textarea rows="3" class="tpl-question-text" placeholder="' + esc(t("assessment.your_answer")) + '" data-input="_setAnswerV2Text" data-args=\'' + _da(assessId, q.id) + '\' data-pass-value>' + esc(val || "") + '</textarea>';
}

function _renderActionPlanForm(a: any, qId: any, ap: any, api: number) {
    var assessId = a.id;
    var h = '<div class="ct-bg-surface ct-bordered ct-r-sm ct-py-2 ct-px-2 ct-mb-1">';
    h += '<div class="ct-flex ct-gap-1 ct-mb-1">';
    h += '<input type="text" value="' + esc(ap.title || "") + '" placeholder="' + esc(_tk(a, "assessment.ap_title")) + '" class="ct-flex-1 ct-py-1 ct-px-2 ct-bordered-line-strong ct-r-sm ct-text-meta" data-input="_updateActionPlanField" data-args=\'' + _da(assessId, qId, api, "title") + '\' data-pass-value>';
    h += '<input type="date" value="' + esc(ap.target_date || "") + '" class="ct-input" data-input="_updateActionPlanField" data-args=\'' + _da(assessId, qId, api, "target_date") + '\' data-pass-value>';
    h += _dirPicker(ap.owner || "", "_updateActionPlanField", _da(assessId, qId, api, "owner"));
    h += '<button class="ct-btn" data-variant="danger" data-size="xs" data-click="_removeActionPlan" data-args=\'' + _da(assessId, qId, api) + '\' title="' + esc(t("common.delete")) + '" data-icon>' + _icon("trash", 14) + '</button>';
    h += '</div>';
    h += '<textarea rows="2" placeholder="' + esc(_tk(a, "assessment.ap_description")) + '" class="ct-journal-body ct-py-1 ct-px-2 ct-bordered-line-strong ct-r-sm ct-text-meta ct-font-inherit ct-box ct-resize-y" data-input="_updateActionPlanField" data-args=\'' + _da(assessId, qId, api, "description") + '\' data-pass-value>' + esc(ap.description || "") + '</textarea>';
    h += '</div>';
    return h;
}

// ── Handlers ──────────────────────────────────────────────────
function _findAssessment(assessId: string) {
    return (D.assessments || []).find(function(a) { return a.id === assessId; });
}

function _findAssessmentResp(a: any, questionId: string) {
    if (!a || !a.responses) return null;
    return a.responses.find(function(r: any) { return r.question_id === questionId; });
}

function _renderSubmitButton(a: any, completion: number) {
    var canSubmit = a.self_validation && completion === 100 && a.status !== "validated" && a.status !== "pending_approval";
    var reason = "";
    if (a.status === "validated") reason = t("assessment.already_validated");
    else if (a.status === "pending_approval") reason = t("assessment.already_submitted");
    else if (completion < 100) reason = t("assessment.complete_all_questions");
    else if (!a.self_validation) reason = t("assessment.check_self_validation");
    if (canSubmit) {
        return '<button class="ct-btn" data-variant="primary" data-click="_submitForApproval" data-args=\'' + _da(a.id) + '\'>' + esc(t("assessment.submit_for_approval")) + '</button>';
    }
    return '<button class="ct-btn" style="cursor:not-allowed" disabled data-tooltip="' + esc(reason) + '" title="' + esc(reason) + '">' + esc(t("assessment.submit_for_approval")) + '</button>';
}

function _renderAssessmentHints(stats: any) {
    if (stats.missingCoverage === 0 && stats.missingActionPlan === 0) return "";
    var h = '<div style="font-size:var(--ct-text-label);margin-top:var(--ct-s1);padding:var(--ct-s2) var(--ct-s3);background:var(--ct-high-tint);border:1px solid var(--ct-high-tint);border-radius:var(--ct-r-sm);color:var(--ct-high-ink)">';
    if (stats.missingCoverage > 0) {
        h += '<div style="margin-bottom:' + (stats.missingActionPlan > 0 ? "4px" : "0") + '">';
        h += '<span class="ct-bold">&#9888; ' + stats.missingCoverage + ' ' + esc(t("assessment.without_coverage")) + '</span>';
        h += '</div>';
    }
    if (stats.missingActionPlan > 0) {
        h += '<div>';
        h += '<span class="ct-bold">&#9888; ' + stats.missingActionPlan + ' ' + esc(t("assessment.without_action_plan_long")) + '</span>';
        h += '</div>';
    }
    h += '</div>';
    return h;
}

// Stats for an assessment — unique source of truth used everywhere.
function _assessmentStats(a: any) {
    var total = (a.responses || []).length;
    var answered = 0, missingCoverage = 0, missingActionPlan = 0;
    (a.responses || []).forEach(function(r: any) {
        if (!r.coverage) { missingCoverage++; return; }
        if (r.coverage === "covered" || r.coverage === "not_applicable") { answered++; return; }
        if (r.coverage === "partial" || r.coverage === "not_covered") {
            var hasAction = (r.action_plans && r.action_plans.length > 0 &&
                r.action_plans.some(function(ap: any) { return (ap.title || "").trim().length > 0; }));
            var hasJust = (r.justification || "").trim().length > 0;
            if (hasAction || hasJust) answered++;
            else missingActionPlan++;
        }
    });
    return { total: total, answered: answered, missingCoverage: missingCoverage, missingActionPlan: missingActionPlan };
}

// Heal the template snapshot of an assessment that was created with
// section-scoped (duplicated) question IDs. Must remap responses so that
// coverage/answers stay attached to the right question.
function _healAssessmentQuestionIds(a: any) {
    if (!a || !a.template_snapshot || !a.template_snapshot.sections) return;
    // Collect (sectionId, oldIdx) → oldId mapping, then renormalize, then remap.
    var oldIds: string[] = [];
    a.template_snapshot.sections.forEach(function(s: any) {
        (s.questions || []).forEach(function(q: any) { oldIds.push(q.id); });
    });
    var changed = _normalizeTemplateQuestionIds(a.template_snapshot);
    if (!changed) return;
    var newIds: string[] = [];
    a.template_snapshot.sections.forEach(function(s: any) {
        (s.questions || []).forEach(function(q: any) { newIds.push(q.id); });
    });
    // Build mapping by position (they are iterated in the same order)
    var map: Record<string, any> = {};
    for (var i = 0; i < oldIds.length; i++) map[oldIds[i]] = newIds[i];
    // Responses might have duplicate entries for the same old id. Keep the
    // first non-empty one for each new id.
    var remapped: Record<string, any> = {};
    (a.responses || []).forEach(function(r: any) {
        var newId = map[r.question_id] || r.question_id;
        if (!remapped[newId]) { remapped[newId] = Object.assign({}, r, { question_id: newId }); }
    });
    a.responses = newIds.map(function(nid) {
        return remapped[nid] || {
            question_id: nid, coverage: null, answer: null,
            comment: "", action_plans: [], justification: ""
        };
    });
}

function _touchAssessment(a: any) {
    _healAssessmentQuestionIds(a);
    var stats = _assessmentStats(a);
    a.completion_rate = stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0;
    a.score = _computeAssessmentV2Score(a);
    if (a.completion_rate > 0 && a.status === "draft") a.status = "in_progress";
    _persist("assessment", a.id, { score: a.score, completion_rate: a.completion_rate, status: a.status, responses: a.responses });
}

function _setCoverage(assessId: string, questionId: string, coverage: string) {
    var a = _findAssessment(assessId);
    var resp = _findAssessmentResp(a, questionId);
    if (!resp) return;
    resp.coverage = coverage;
    if (coverage === "covered" || coverage === "not_applicable") {
        resp.action_plans = [];
        resp.justification = "";
    }
    _touchAssessment(a);
    openAssessmentV2(assessId);
}
window._setCoverage = _setCoverage;

function _setAnswerV2Text(assessId: string, questionId: string, value: string) {
    var a = _findAssessment(assessId);
    var resp = _findAssessmentResp(a, questionId);
    if (!resp) return;
    resp.answer = value;
    _refreshAssessmentLiveState(assessId, questionId);
}
window._setAnswerV2Text = _setAnswerV2Text;

// Live-update the parts of the DOM that depend on completion without
// re-rendering the whole panel (to preserve input focus while typing).
function _refreshAssessmentLiveState(assessId: string, questionId: string) {
    var a = _findAssessment(assessId);
    if (!a) return;
    _touchAssessment(a);
    var stats = _assessmentStats(a);
    var completion = stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0;

    // 1. Progress bar + label
    var bar = document.getElementById("evalv2-progress-bar");
    var label = document.getElementById("evalv2-progress-label");
    if (bar) {
        bar.style.width = completion + "%";
        bar.style.background = completion === 100 ? "var(--ct-low)" : "var(--ct-accent)";
    }
    if (label) {
        label.textContent = completion + "% (" + stats.answered + "/" + stats.total + ")";
        label.style.color = completion === 100 ? "var(--ct-low)" : "var(--ct-ink-1)";
    }
    var hints = document.getElementById("evalv2-hints");
    if (hints) hints.innerHTML = _renderAssessmentHints(stats);

    // 2. Single question action block: update background + banner
    if (questionId) {
        var resp = _findAssessmentResp(a, questionId);
        var block = document.getElementById("actionblk-" + a.id + "-" + questionId);
        if (resp && block && (resp.coverage === "partial" || resp.coverage === "not_covered")) {
            var hasAction = (resp.action_plans && resp.action_plans.length > 0 &&
                resp.action_plans.some(function(ap: any) { return (ap.title || "").trim().length > 0; }));
            var hasJust = (resp.justification || "").trim().length > 0;
            var satisfied = hasAction || hasJust;
            block.style.background = satisfied ? "var(--ct-low-tint)" : "var(--ct-high-tint)";
            block.style.borderLeftColor = satisfied ? "var(--ct-low)" : "var(--ct-high)";
            // Replace the banner (first child is always the banner div)
            var banner = block.firstElementChild;
            if (banner) {
                if (satisfied) {
                    banner.innerHTML = '<div class="ct-flex ct-items-center ct-gap-2 ct-mb-2 ct-text-low-ink ct-text-label ct-strong">'
                        + '<span>&#10003;</span>'
                        + esc(hasAction ? _tk(a, "assessment.action_recorded") : _tk(a, "assessment.justification_recorded"))
                        + '</div>';
                } else {
                    banner.innerHTML = '<div class="ct-flex ct-items-start ct-gap-2 ct-mb-2">'
                        + '<span style="color:var(--ct-high);font-size:var(--ct-text-section);line-height:1">&#9888;</span>'
                        + '<div>'
                        + '<div class="ct-text-meta ct-bold ct-text-high-ink">' + esc(_tk(a, "assessment.action_required_title")) + '</div>'
                        + '<div class="ct-text-label ct-text-high-ink ct-mt-1">' + esc(resp.coverage === "partial" ? _tk(a, "assessment.action_required_partial") : _tk(a, "assessment.action_required_not_covered")) + '</div>'
                        + '</div>'
                        + '</div>';
                }
            }
        }
    }

    // 3. Self-validation checkbox: enable/disable based on completion
    var check = document.getElementById("evalv2-validation-check");
    var checkLabel = document.getElementById("evalv2-validation-label");
    var checkHelper = document.getElementById("evalv2-validation-helper");
    var validationBlock = document.getElementById("evalv2-validation-block");
    if (check && checkLabel && checkHelper && validationBlock) {
        if (completion === 100) {
            (check as HTMLInputElement).disabled = false;
            checkLabel.style.cursor = "pointer";
            checkLabel.removeAttribute("title");
            checkHelper.style.display = "none";
            validationBlock.style.borderColor = "var(--ct-accent)";
            validationBlock.style.opacity = "1";
        } else {
            (check as HTMLInputElement).disabled = true;
            // If the user had it checked but now completion dropped, uncheck it
            if ((check as HTMLInputElement).checked) {
                (check as HTMLInputElement).checked = false;
                a.self_validation = false;
                a.self_validated_at = null;
                _persist("assessment", a.id, { self_validation: a.self_validation, self_validated_at: a.self_validated_at });
            }
            checkLabel.style.cursor = "not-allowed";
            checkLabel.setAttribute("title", t("assessment.complete_all_questions"));
            checkHelper.style.display = "block";
            validationBlock.style.borderColor = "var(--ct-line-strong)";
            validationBlock.style.opacity = "0.75";
        }
    }

    // 4. Submit button
    var submitWrap = document.getElementById("evalv2-submit-wrap");
    if (submitWrap) submitWrap.innerHTML = _renderSubmitButton(a, completion);
}

function _onAssessmentCommentChange(assessId: string, questionId: string, value: string) {
    var a = _findAssessment(assessId);
    var resp = _findAssessmentResp(a, questionId);
    if (!resp) return;
    resp.comment = value;
    _persist("assessment", a!.id, { responses: a!.responses });
    // comment doesn't affect completion, no live refresh needed
}
window._onAssessmentCommentChange = _onAssessmentCommentChange;

function _onAssessmentJustificationChange(assessId: string, questionId: string, value: string) {
    var a = _findAssessment(assessId);
    var resp = _findAssessmentResp(a, questionId);
    if (!resp) return;
    resp.justification = value;
    _refreshAssessmentLiveState(assessId, questionId);
}
window._onAssessmentJustificationChange = _onAssessmentJustificationChange;

function _addActionPlan(assessId: string, questionId: string) {
    var a = _findAssessment(assessId);
    var resp = _findAssessmentResp(a, questionId);
    if (!resp) return;
    if (!resp.action_plans) resp.action_plans = [];
    resp.action_plans.push({
        id: _nextSeqId("AP", resp.action_plans),
        title: "",
        description: "",
        target_date: "",
        owner: "",
        status: "proposed"
    });
    _touchAssessment(a);
    openAssessmentV2(assessId);
}
window._addActionPlan = _addActionPlan;

function _removeActionPlan(assessId: string, questionId: string, apIdx: number) {
    var a = _findAssessment(assessId);
    var resp = _findAssessmentResp(a, questionId);
    if (!resp || !resp.action_plans) return;
    resp.action_plans.splice(apIdx, 1);
    _touchAssessment(a);
    openAssessmentV2(assessId);
}
window._removeActionPlan = _removeActionPlan;

function _updateActionPlanField(assessId: string, questionId: string, apIdx: number, field: string, value: string) {
    var a = _findAssessment(assessId);
    var resp = _findAssessmentResp(a, questionId);
    if (!resp || !resp.action_plans || !resp.action_plans[apIdx]) return;
    resp.action_plans[apIdx][field] = value;
    _refreshAssessmentLiveState(assessId, questionId);
}
window._updateActionPlanField = _updateActionPlanField;

function _toggleSelfValidation(assessId: string, checked: any) {
    var a = _findAssessment(assessId);
    if (!a) return;
    a.self_validation = !!checked;
    a.self_validated_at = checked ? new Date().toISOString() : null;
    _persist("assessment", a.id, { self_validation: a.self_validation, self_validated_at: a.self_validated_at });
    openAssessmentV2(assessId);
}
window._toggleSelfValidation = _toggleSelfValidation;

function _submitForApproval(assessId: string) {
    var a = _findAssessment(assessId);
    if (!a) return;
    if (!a.self_validation) { alert(t("assessment.self_validation_required")); return; }
    a.status = "pending_approval";
    a.submitted_at = new Date().toISOString();
    _persist("assessment", a.id, { status: a.status, submitted_at: a.submitted_at });
    showStatus(t("assessment.submitted"));
    _backFromAssessmentV2();
}
window._submitForApproval = _submitForApproval;

function _approveAssessment(assessId: string) {
    var a = _findAssessment(assessId);
    if (!a) return;
    a.status = "validated";
    a.approved_at = new Date().toISOString();
    // Create vendor action plan items from approved responses
    _materializeActionPlans(a);
    // Update vendor's maturity from the weighted aggregate of all validated assessments
    _refreshVendorMaturity(a.vendor_id);
    _persist("assessment", a.id, { status: a.status, approved_at: a.approved_at });
    openAssessmentV2(assessId);
    showStatus(t("assessment.approved"));
}
window._approveAssessment = _approveAssessment;

function _rejectAssessment(assessId: string) {
    var a = _findAssessment(assessId);
    if (!a) return;
    var reason = prompt(t("assessment.reject_reason_prompt"));
    if (reason === null) return;
    a.status = "rejected";
    a.rejected_reason = reason || "";
    _persist("assessment", a.id, { status: a.status, rejected_reason: a.rejected_reason });
    openAssessmentV2(assessId);
    showStatus(t("assessment.rejected"));
}
window._rejectAssessment = _rejectAssessment;

function _materializeActionPlans(a: any) {
    // For every action plan in the approved assessment, add a measure to the vendor
    var v = D.vendors.find(function(x) { return x.id === a.vendor_id; });
    if (!v) return;
    if (!v.measures) v.measures = [];
    (a.responses || []).forEach(function(r: any) {
        (r.action_plans || []).forEach(function(ap: any) {
            var existingId = v!.id + "-AP-" + r.question_id + "-" + ap.id;
            if (v!.measures!.some(function(m) { return m.id === existingId; })) return;
            var newM = {
                id: existingId,
                vendor_id: v!.id,
                mesure: ap.title || ("Action plan " + r.question_id),
                details: ap.description || "",
                type: "Organisationnelle",
                responsable: ap.owner || "",
                echeance: ap.target_date || "",
                statut: "planifie",
                source: "vendor_engagement",
                source_assessment_id: a.id,
                source_question_id: r.question_id
            };
            v!.measures!.push(newM);
            _persistCreate("measure", newM);
        });
    });
}

function _backFromAssessmentV2() {
    if (_assessmentV2Returning !== null) {
        _selectedVendor = _assessmentV2Returning;
        _vendorTab = "assessments";
        _assessmentV2Returning = null;
    }
    _panel = "vendors";
    renderPanel();
}
window._backFromAssessmentV2 = _backFromAssessmentV2;

// ── Scoring V2 ────────────────────────────────────────────────
function _computeAssessmentV2Score(a: any) {
    var tpl = _getAssessmentTemplate(a);
    if (!tpl) return 0;
    var qs = _allQuestions(tpl);
    var total = 0, max = 0;
    (a.responses || []).forEach(function(r: any) {
        if (r.coverage === "not_applicable") return;
        var q = qs.find(function(x) { return x.id === r.question_id; });
        if (!q) return;
        var w = q.weight || 1;
        max += w;
        if (r.coverage === "covered") total += w;
        else if (r.coverage === "partial") total += w * 0.5;
        // not_covered or null → 0
    });
    return max > 0 ? Math.round((total / max) * 100) : 0;
}

// ═══════════════════════════════════════════════════════════════
// WEIGHTED MATURITY SCORE (vendor-level aggregation)
// ═══════════════════════════════════════════════════════════════
//
// Instead of reflecting only the last validated assessment, the vendor's
// maturity score is now a weighted average of every validated assessment
// attached to that vendor. Each assessment contributes according to:
//
//   - a base weight derived from:
//       * weight_override (per-assessment manual value) if set,
//       * otherwise weight_by_template[template_id] if set,
//       * otherwise weight_by_kind[kind] (defaults 1.0 questionnaire,
//         1.5 audit),
//       * otherwise 1.0
//   - a temporal decay, if maturity_config.decay_per_quarter > 0:
//         effective = base * (1 - decay * quartersAgo),
//         floored at maturity_config.min_effective_weight
//   - excluded assessments (a.excluded === true) are skipped entirely.
//
// Legacy assessments (no template_id) are treated as kind = "questionnaire"
// so they keep contributing to the score even after migration.
// ═══════════════════════════════════════════════════════════════

function _maturityConfig() {
    var cfg = D.maturity_config || {};
    return {
        weight_by_kind: cfg.weight_by_kind || { questionnaire: 1.0, audit: 1.5 },
        weight_by_template: cfg.weight_by_template || {},
        decay_per_quarter: typeof cfg.decay_per_quarter === "number" ? cfg.decay_per_quarter : 0.0,
        min_effective_weight: typeof cfg.min_effective_weight === "number" ? cfg.min_effective_weight : 0.1
    };
}

function _quartersBetween(dateStr: string | undefined, now: any) {
    if (!dateStr) return 0;
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return 0;
    var ref = now || new Date();
    var months = (ref.getFullYear() - d.getFullYear()) * 12 + (ref.getMonth() - d.getMonth());
    return Math.max(0, Math.floor(months / 3));
}

// Returns the detail of the weighted maturity score for a vendor.
// Shape:
//   { score: 0..100, rows: [
//       { assessment, base, decay, effective, excluded, contribution }
//     ], sum_weights, sum_weighted }
function _computeVendorMaturityDetail(vendorId: string) {
    var cfg = _maturityConfig();
    var all = (D.assessments || []).filter(function(a) {
        return a.vendor_id === vendorId && a.status === "validated";
    });
    var now = new Date();
    var rows: any[] = [];
    var sumW = 0, sumS = 0;

    all.forEach(function(a) {
        var tpl = _getAssessmentTemplate(a);
        var kind = (tpl && tpl.kind) || "questionnaire";
        var base;
        if (typeof a.weight_override === "number") {
            base = a.weight_override;
        } else if (tpl && cfg.weight_by_template[tpl.id] != null) {
            base = cfg.weight_by_template[tpl.id];
        } else {
            base = cfg.weight_by_kind[kind] != null ? cfg.weight_by_kind[kind] : 1.0;
        }
        var quarters = _quartersBetween(a.approved_at || a.submitted_at || a.date, now);
        var decayMult = 1 - (cfg.decay_per_quarter || 0) * quarters;
        if (decayMult < 0) decayMult = 0;
        var effective = Math.max(cfg.min_effective_weight, base * decayMult);
        var score = typeof a.score === "number" ? a.score : 0;
        var row = {
            assessment: a,
            kind: kind,
            base: base,
            quarters: quarters,
            decay_mult: decayMult,
            effective: a.excluded ? 0 : effective,
            excluded: !!a.excluded,
            score: score,
            contribution: a.excluded ? 0 : score * effective
        };
        rows.push(row);
        if (!a.excluded) {
            sumW += effective;
            sumS += score * effective;
        }
    });

    var finalScore = sumW > 0 ? Math.round(sumS / sumW) : 0;
    return { score: finalScore, rows: rows, sum_weights: sumW, sum_weighted: sumS };
}

function _maturityRowTemplateName(row: any) {
    var a = row.assessment;
    if (a.template_snapshot) return a.template_snapshot.name || "";
    if (a.template_id) {
        var tpl = (D.questionnaire_templates || []).find(function(tp) { return tp.id === a.template_id; });
        if (tpl) return tpl.name;
    }
    return t("assessment.type_" + (a.type || "periodic"));
}

// Render the weighted maturity detail panel (collapsed by default on vendor detail)
function _renderVendorMaturityDetail(v: any) {
    var detail = _computeVendorMaturityDetail(v.id);
    if (!detail.rows.length) return "";
    var cfg = _maturityConfig();
    var h = '<details class="maturity-detail">';
    h += '<summary style="padding:var(--ct-s2) var(--ct-s3);cursor:pointer;font-weight:600;font-size:var(--ct-text-data);list-style:none;display:flex;align-items:center;gap:var(--ct-s2)">';
    h += '<span>' + esc(t("maturity.detail_title")) + '</span>';
    h += '<span class="ct-flex-1"></span>';
    h += '<span class="ct-text-label ct-ink-1 ct-normal">' + detail.rows.length + ' ' + esc(t("maturity.validated_count")) + '</span>';
    h += '<span class="score-val ' + _scoreColorClass(detail.score) + ' ct-text-page">' + detail.score + '%</span>';
    h += '</summary>';
    h += '<div style="padding:0 var(--ct-s3) var(--ct-s3)">';
    h += '<p style="font-size:var(--ct-text-label);color:var(--ct-ink-1);margin:0 0 var(--ct-s2)">' + esc(t("maturity.detail_intro")) + '</p>';

    // Global config block
    h += '<div class="ct-py-2 ct-px-3 ct-bg-canvas ct-r-md ct-mb-3">';
    h += '<div class="ct-overline ct-mb-2">' + esc(t("maturity.global_config")) + '</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--ct-s2)">';
    h += '<div><label class="ct-block ct-text-label ct-strong ct-mb-1">' + esc(t("maturity.weight_questionnaire")) + '</label>';
    h += '<input type="number" step="0.1" min="0" value="' + (cfg.weight_by_kind.questionnaire || 1) + '" class="ct-input" data-input="_updateMaturityConfig" data-args=\'["weight_by_kind.questionnaire"]\' data-pass-value></div>';
    h += '<div><label class="ct-block ct-text-label ct-strong ct-mb-1">' + esc(t("maturity.weight_audit")) + '</label>';
    h += '<input type="number" step="0.1" min="0" value="' + (cfg.weight_by_kind.audit || 1.5) + '" class="ct-input" data-input="_updateMaturityConfig" data-args=\'["weight_by_kind.audit"]\' data-pass-value></div>';
    h += '<div><label class="ct-block ct-text-label ct-strong ct-mb-1">' + esc(t("maturity.decay_per_quarter")) + '</label>';
    h += '<input type="number" step="0.05" min="0" max="1" value="' + (cfg.decay_per_quarter || 0) + '" class="ct-input" data-input="_updateMaturityConfig" data-args=\'["decay_per_quarter"]\' data-pass-value></div>';
    h += '</div>';
    h += '</div>';

    // Table of contributing assessments
    h += '<table class="ct-journal-body ct-text-label ct-collapse">';
    h += '<thead><tr class="ct-bg-canvas ct-ink-1 ct-upper ct-text-label">';
    h += '<th class="ct-ta-l ct-py-1 ct-px-2">ID</th>';
    h += '<th class="ct-ta-l ct-py-1 ct-px-2">' + esc(t("maturity.col_template")) + '</th>';
    h += '<th class="ct-ta-c ct-py-1 ct-px-2">' + esc(t("maturity.col_kind")) + '</th>';
    h += '<th class="ct-ta-r ct-py-1 ct-px-2">' + esc(t("maturity.col_score")) + '</th>';
    h += '<th class="ct-ta-r ct-py-1 ct-px-2">' + esc(t("maturity.col_base_weight")) + '</th>';
    h += '<th class="ct-ta-r ct-py-1 ct-px-2">' + esc(t("maturity.col_decay")) + '</th>';
    h += '<th class="ct-ta-r ct-py-1 ct-px-2">' + esc(t("maturity.col_effective_weight")) + '</th>';
    h += '<th class="ct-ta-c ct-py-1 ct-px-2">' + esc(t("maturity.col_excluded")) + '</th>';
    h += '</tr></thead><tbody>';
    detail.rows.forEach(function(row) {
        var a = row.assessment;
        var tplName = _maturityRowTemplateName(row);
        var kindLabel = t("template.kind_" + row.kind);
        var rowStyle = row.excluded ? "opacity:0.4;text-decoration:line-through" : "";
        h += '<tr style="border-top:1px solid var(--ct-line);' + rowStyle + '">';
        h += '<td class="ct-py-1 ct-px-2 ct-strong">' + esc(a.id) + '</td>';
        h += '<td class="ct-py-1 ct-px-2">' + esc(tplName) + '</td>';
        h += '<td class="ct-ta-c ct-py-1 ct-px-2"><span class="ct-ref" data-size="sm">' + esc(kindLabel) + '</span></td>';
        h += '<td class="ct-ta-r ct-py-1 ct-px-2 ct-strong">' + row.score + '%</td>';
        h += '<td class="ct-ta-r ct-py-1 ct-px-2">';
        h += '<input type="number" step="0.1" min="0" value="' + row.base.toFixed(2) + '" class="ct-w-70 ct-py-1 ct-px-1 ct-bordered-line-strong ct-r-sm ct-ta-r" data-input="_updateAssessmentWeightOverride" data-args=\'' + _da(a.id) + '\' data-pass-value>';
        h += '</td>';
        h += '<td class="ct-ta-r ct-py-1 ct-px-2 ct-ink-1 ct-text-label">';
        if (row.quarters > 0 && cfg.decay_per_quarter > 0) {
            h += '-' + Math.round((1 - row.decay_mult) * 100) + '% (' + row.quarters + 'q)';
        } else {
            h += '–';
        }
        h += '</td>';
        h += '<td class="ct-ta-r ct-py-1 ct-px-2 ct-strong">' + row.effective.toFixed(2) + '</td>';
        h += '<td class="ct-ta-c ct-py-1 ct-px-2">';
        h += '<input type="checkbox"' + (row.excluded ? " checked" : "") + ' data-change="_toggleAssessmentExcluded" data-args=\'' + _da(a.id) + '\' data-pass-checked>';
        h += '</td>';
        h += '</tr>';
    });
    h += '<tr style="border-top:2px solid var(--ct-line);background:var(--ct-canvas)">';
    h += '<td colspan="6" class="ct-p-2 ct-ta-r ct-bold">' + esc(t("maturity.weighted_score")) + '</td>';
    h += '<td class="ct-p-2 ct-ta-r ct-bold">' + detail.sum_weights.toFixed(2) + '</td>';
    h += '<td class="ct-p-2 ct-ta-c ct-bold ' + _scoreColorClass(detail.score) + '">' + detail.score + '%</td>';
    h += '</tr>';
    h += '</tbody></table>';
    h += '</div>';
    h += '</details>';
    return h;
}

function _updateMaturityConfig(path: string, value: string) {
    if (!D.maturity_config) D.maturity_config = {};
    var v = parseFloat(value);
    if (isNaN(v)) return;
    var parts = path.split(".");
    var obj = D.maturity_config;
    for (var i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = v;
    _autoSave();
    // Recompute maturity for all vendors that have validated assessments
    (D.vendors || []).forEach(function(vd) { _refreshVendorMaturity(vd.id); });
    renderPanel();
}
window._updateMaturityConfig = _updateMaturityConfig;

function _updateAssessmentWeightOverride(assessId: string, value: string) {
    var a = (D.assessments || []).find(function(x) { return x.id === assessId; });
    if (!a) return;
    var v = parseFloat(value);
    if (isNaN(v)) { delete a.weight_override; }
    else { a.weight_override = v; }
    _refreshVendorMaturity(a.vendor_id);
    _persist("assessment", a.id, { weight_override: a.weight_override });
    renderPanel();
}
window._updateAssessmentWeightOverride = _updateAssessmentWeightOverride;

function _toggleAssessmentExcluded(assessId: string, checked: any) {
    var a = (D.assessments || []).find(function(x) { return x.id === assessId; });
    if (!a) return;
    a.excluded = !!checked;
    _refreshVendorMaturity(a.vendor_id);
    _persist("assessment", a.id, { excluded: a.excluded });
    renderPanel();
}
window._toggleAssessmentExcluded = _toggleAssessmentExcluded;

// Apply the weighted maturity score to the vendor's exposure.maturite
// (0..4 scale). Idempotent. Call whenever an assessment is validated,
// excluded, weight-overridden, or its score changes.
function _refreshVendorMaturity(vendorId: string) {
    var v = D.vendors.find(function(x) { return x.id === vendorId; });
    if (!v) return;
    var detail = _computeVendorMaturityDetail(vendorId);
    if (!v.exposure) v.exposure = {};
    // If no validated assessment, leave the existing value untouched so
    // vendors with hand-entered maturity still work.
    if (detail.rows.length > 0) {
        v.exposure.maturite = _scoreToMaturite(detail.score);
        v.maturity_score = detail.score; // raw 0..100 for display
    }
}

// ═══════════════════════════════════════════════════════════════
// ASSESSMENTS V2 — EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════════

function _buildExportPayload(a: any) {
    // Only export what is strictly needed by the vendor to fill in the questionnaire.
    // Keeps the payload minimal and auditable.
    return {
        format: "ciso_toolbox_vendor_assessment",
        version: 1,
        assessment_id: a.id,
        vendor_id: a.vendor_id,
        vendor_name: _vendorName(a.vendor_id),
        date: a.date,
        due_date: a.due_date || "",
        template: a.template_snapshot,
        responses: a.responses || [],
        exported_at: new Date().toISOString()
    };
}

function _exportAssessmentJSON(assessId: string) {
    var a = _findAssessment(assessId);
    if (!a) return;

    _showModal(
        '<h3>' + esc(t("assessment.export_json_title")) + '</h3>' +
        '<p class="ct-text-meta ct-ink-1 ct-mb-3">' + esc(t("assessment.export_json_file_hint")) + '</p>' +

        '<label class="ct-block ct-text-label ct-strong ct-mb-1">' + esc(t("assessment.encryption_password_label_optional")) + '</label>' +
        '<input type="password" id="exp-password" placeholder="' + esc(t("assessment.encryption_password_optional")) + '" class="ct-journal-body ct-py-1 ct-px-2 ct-bordered-line-strong ct-r-sm ct-font-inherit ct-mb-3">' +

        '<div class="ct-flex ct-gap-2 ct-justify-end">' +
        '<button class="ct-btn" data-click="closeModal">' + esc(t("common.cancel")) + '</button>' +
        '<button class="ct-btn" data-variant="primary" data-click="_doExportJSONAuto" data-args=\'' + _da(assessId) + '\'>' + esc(t("assessment.export")) + '</button>' +
        '</div>'
    );
}
window._exportAssessmentJSON = _exportAssessmentJSON;

// Unified export: reads the optional password and picks plain vs encrypted.
function _doExportJSONAuto(assessId: string) {
    var pwd = ((document.getElementById("exp-password") as HTMLInputElement | null) || ({} as HTMLInputElement)).value || "";
    _doExportJSON(assessId, !!pwd);
}
window._doExportJSONAuto = _doExportJSONAuto;

// Dedicated modal for generating a portal link.
function _exportAssessmentLink(assessId: string) {
    var a = _findAssessment(assessId);
    if (!a) return;

    _showModal(
        '<h3>' + esc(t("assessment.export_link_title")) + '</h3>' +
        '<p class="ct-text-meta ct-ink-1 ct-mb-3">' + esc(t("assessment.export_link_hint")) + '</p>' +

        '<label class="ct-block ct-text-label ct-strong ct-mb-1">' + esc(t("assessment.encryption_password_label_required")) + '</label>' +
        '<input type="password" id="exp-password" placeholder="' + esc(t("assessment.encryption_password_required")) + '" class="ct-journal-body ct-py-1 ct-px-2 ct-bordered-line-strong ct-r-sm ct-font-inherit ct-mb-2">' +

        '<button class="ct-btn ct-w-full" data-variant="primary" data-click="_generatePortalLink" data-args=\'' + _da(assessId) + '\'>' + esc(t("assessment.generate_link")) + '</button>' +

        '<div id="exp-link-result" class="ct-mt-3 ct-hidden"></div>'
    );
}
window._exportAssessmentLink = _exportAssessmentLink;

function _doExportJSON(assessId: string, encrypted: any) {
    var a = _findAssessment(assessId);
    if (!a) return;
    var payload = _buildExportPayload(a);
    var json = JSON.stringify(payload, null, 2);
    var baseName = (a.id + "_" + _vendorName(a.vendor_id).replace(/\s+/g, "_") + "_questionnaire").replace(/[^a-z0-9_.-]/gi, "");

    if (encrypted) {
        var pwd = ((document.getElementById("exp-password") as HTMLInputElement | null) || ({} as HTMLInputElement)).value || "";
        if (!pwd) { alert(t("assessment.password_required")); return; }
        _encryptData(json, pwd).then(function(buf) {
            var blob = new Blob([buf], { type: "application/octet-stream" });
            _triggerDownload(blob, baseName + ".ctenc");
            closeModal();
            showStatus(t("assessment.exported"));
        }).catch(function(e) { alert("Encryption failed: " + e.message); });
    } else {
        var blob = new Blob([json], { type: "application/json" });
        _triggerDownload(blob, baseName + ".json");
        closeModal();
        showStatus(t("assessment.exported"));
    }
}
window._doExportJSON = _doExportJSON;

// ═══════════════════════════════════════════════════════════════
// PORTAL LINK GENERATION
// ═══════════════════════════════════════════════════════════════
//
// Builds a compact self-contained URL that the vendor can click to
// open the portal with the questionnaire pre-loaded. The payload is:
//   1. JSON-stringified,
//   2. gzip-compressed via CompressionStream (or lz-string fallback),
//   3. AES-256-GCM encrypted using the operator's password,
//   4. base64url-encoded and placed in the URL fragment (#data=...).
//
// The password is never embedded in the link — the operator shares
// it out-of-band (SMS, voice, messenger, separate email).
//
// Size thresholds:
//   - <=  8 000 chars  → green  "compatible with every email client"
//   - <= 12 000 chars  → orange "may be truncated by legacy Outlook"
//   - >  12 000 chars  → red    "too long — switch to encrypted file"
// ═══════════════════════════════════════════════════════════════

var LINK_SIZE_GREEN = 8000;
var LINK_SIZE_YELLOW = 12000;

async function _gzipCompress(text: any) {
    if (typeof CompressionStream === "undefined") {
        // Very old browsers: just skip compression
        return new TextEncoder().encode(text);
    }
    var stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
}

function _bytesToBase64(bytes: any) {
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function _bytesToBase64Url(bytes: any) {
    return _bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Builds the URL that should open the portal at the same origin / path.
function _portalBaseURL() {
    var loc = window.location;
    // window.location.pathname may end with /index.html or /.
    // We want the current folder + "portal/".
    var folder = loc.pathname.replace(/\/[^/]*$/, "/"); // keep trailing /
    return loc.origin + folder + "portal/";
}

async function _generatePortalLink(assessId: string) {
    var a = _findAssessment(assessId);
    if (!a) return;
    var pwd = ((document.getElementById("exp-password") as HTMLInputElement | null) || ({} as HTMLInputElement)).value || "";
    if (!pwd) { alert(t("assessment.password_required")); return; }

    var payload = _buildExportPayload(a);
    var json = JSON.stringify(payload);

    try {
        // 1. compress
        var compressed = await _gzipCompress(json);
        // 2. base64-encode the compressed bytes so the AES plaintext is
        //    pure ASCII (no UTF-8 round-trip surprises on binary bytes).
        var compressedB64 = _bytesToBase64(compressed);
        // 3. encrypt the ASCII-safe payload
        var enc = await _encryptData(compressedB64, pwd);
        // 4. base64url the final ciphertext
        var b64 = _bytesToBase64Url(enc);
        // 5. build URL with a version tag so the portal knows how to
        //    decode (v1gz = base64(gzip(json)) then encrypted).
        var url = _portalBaseURL() + "#data=v1gz." + b64;

        // Compute thresholds
        var size = url.length;
        var statusKey, statusColor, statusBg;
        if (size <= LINK_SIZE_GREEN) {
            statusKey = "assessment.link_status_green";
            statusColor = "var(--ct-low-ink)";
            statusBg = "var(--ct-low-tint)";
        } else if (size <= LINK_SIZE_YELLOW) {
            statusKey = "assessment.link_status_yellow";
            statusColor = "var(--ct-high-ink)";
            statusBg = "var(--ct-high-tint)";
        } else {
            statusKey = "assessment.link_status_red";
            statusColor = "var(--ct-critical-ink)";
            statusBg = "var(--ct-critical-tint)";
        }

        var resultEl = document.getElementById("exp-link-result");
        if (!resultEl) return;
        var h = '<div style="background:' + statusBg + ';border:1px solid ' + statusColor + ';border-radius:6px;padding:10px 12px;color:' + statusColor + '">';
        h += '<div class="ct-text-label ct-bold ct-mb-1">' + esc(t(statusKey)) + '</div>';
        h += '<div class="ct-text-label">' + esc(t("assessment.link_size")) + ': ' + size.toLocaleString() + ' ' + esc(t("assessment.chars")) + '</div>';
        h += '</div>';
        // Link + copy buttons
        h += '<div class="ct-flex ct-gap-1 ct-mt-2">';
        h += '<input type="text" id="exp-link-url" readonly value="' + esc(url) + '" style="flex:1;padding:var(--ct-s1) var(--ct-s2);border:1px solid var(--ct-line-strong);border-radius:var(--ct-r-sm);font-family:ui-monospace,monospace;font-size:var(--ct-text-label)">';
        h += '<button class="ct-btn ct-m-0" data-variant="primary" data-click="_copyPortalLink">' + esc(t("assessment.copy_link")) + '</button>';
        h += '</div>';
        h += '<button class="ct-btn ct-mt-2" data-variant="primary" data-click="_copyEmailTemplate" data-args=\'' + _da(assessId) + '\'>' + esc(t("assessment.copy_email_template")) + '</button>';
        h += '<p class="ct-text-label ct-ink-1 ct-mt-2">' + esc(t("assessment.link_password_hint")) + '</p>';
        resultEl.innerHTML = h;
        resultEl.style.display = "block";
    } catch (e: any) {
        console.error("Link generation failed:", e);
        alert("Link generation failed: " + (e && e.message ? e.message : e));
    }
}
window._generatePortalLink = _generatePortalLink;

function _copyPortalLink() {
    var el = document.getElementById("exp-link-url") as HTMLInputElement | null;
    if (!el) return;
    el.select();
    try {
        navigator.clipboard.writeText((el as HTMLInputElement).value).then(function() {
            showStatus(t("assessment.link_copied"));
        });
    } catch (e) {
        document.execCommand("copy");
        showStatus(t("assessment.link_copied"));
    }
}
window._copyPortalLink = _copyPortalLink;

function _copyEmailTemplate(assessId: string) {
    var a = _findAssessment(assessId);
    if (!a) return;
    var el = document.getElementById("exp-link-url");
    if (!el) return;
    var link = (el as HTMLInputElement).value;
    var tpl = _getAssessmentTemplate(a);
    var vendorName = _vendorName(a.vendor_id);
    var templateName = tpl ? tpl.name : "";
    var dueDate = a.due_date || "-";
    var subject = t("assessment.email_subject").replace("{vendor}", vendorName);
    var bodyTemplate = t("assessment.email_body")
        .replace("{template}", templateName)
        .replace("{due_date}", dueDate);

    // Plain text version (fallback): the link appears as raw URL
    var plainBody = bodyTemplate.replace("{link}", link);
    var plainClipboard = subject + "\n\n" + plainBody;

    // HTML version: the link appears as an actual clickable hyperlink
    // with a visible label ("Ouvrir le questionnaire"). Most email
    // clients that accept a paste (Outlook Desktop, Gmail Web,
    // Thunderbird, Apple Mail, New Outlook) preserve the anchor.
    // Build order matters:
    //   1. Replace {link} with a unique placeholder that won't appear in
    //      the body and won't be mangled by HTML escaping.
    //   2. Escape the entire body.
    //   3. Wrap lines in <p> or <br>.
    //   4. Substitute the placeholder with the real <a href="...">.
    var PLACEHOLDER = "\u0001LINK\u0001";
    var htmlSource = bodyTemplate.replace("{link}", PLACEHOLDER);
    var anchor = '<a href="' + esc(link) + '">' + esc(t("assessment.email_link_label")) + '</a>';
    var htmlBody = esc(htmlSource)
        .split("\n")
        .map(function(line) { return line === "" ? "<br>" : "<p style=\"margin:0 0 8px\">" + line + "</p>"; })
        .join("")
        .replace(PLACEHOLDER, anchor);
    var htmlClipboard =
        '<p style="margin:0 0 var(--ct-s2);font-weight:bold">' + esc(subject) + '</p>' +
        htmlBody;

    // Try the rich-text path first (two MIME types); fall back to plain.
    try {
        if (typeof ClipboardItem !== "undefined" && navigator.clipboard && navigator.clipboard.write) {
            var item = new ClipboardItem({
                "text/plain": new Blob([plainClipboard], { type: "text/plain" }),
                "text/html":  new Blob([htmlClipboard],  { type: "text/html"  })
            });
            navigator.clipboard.write([item]).then(function() {
                showStatus(t("assessment.email_template_copied"));
            }).catch(function() {
                // Safari / Firefox may reject ClipboardItem → fall back
                navigator.clipboard.writeText(plainClipboard).then(function() {
                    showStatus(t("assessment.email_template_copied"));
                });
            });
            return;
        }
        navigator.clipboard.writeText(plainClipboard).then(function() {
            showStatus(t("assessment.email_template_copied"));
        });
    } catch (e) {
        showStatus(t("assessment.email_template_copied"));
    }
}
window._copyEmailTemplate = _copyEmailTemplate;

function _triggerDownload(blob: any, filename: string) {
    _downloadBlob(blob, _safeFileName(filename));
}

function _exportAssessmentExcel(assessId: string) {
    var a = _findAssessment(assessId);
    if (!a) return;
    var tpl = _getAssessmentTemplate(a);
    if (!tpl) return;
    _loadExcelJS().then(function() {
        var wb = new ExcelJS.Workbook();
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
            t("assessment.instructions_id") + ": " + a!.id,
            t("assessment.instructions_vendor") + ": " + _vendorName(a!.vendor_id),
            t("assessment.instructions_template") + ": " + tpl.name + " v" + (a!.template_version || 1),
            t("assessment.instructions_due_date") + ": " + (a!.due_date || "-")
        ].forEach(function(line) { ws1.addRow([line]); });
        ws1.getRow(1).font = { bold: true, size: 14 };

        // Sheet 2: Questionnaire (simplified — only free_text questions)
        var ws2 = wb.addWorksheet(t("assessment.questionnaire_sheet"));
        ws2.columns = [
            { header: "ID", key: "id", width: 10 },
            { header: t("assessment.col_section"), key: "section", width: 22 },
            { header: t("assessment.col_question"), key: "question", width: 50 },
            { header: t("assessment.col_expected"), key: "expected", width: 40 },
            { header: t("assessment.col_answer"), key: "answer", width: 40 },
            { header: t("assessment.col_coverage"), key: "coverage", width: 16 },
            { header: t("assessment.col_comment"), key: "comment", width: 30 },
            { header: t("assessment.col_ap_title"), key: "ap_title", width: 30 },
            { header: t("assessment.col_ap_desc"), key: "ap_desc", width: 30 },
            { header: t("assessment.col_ap_date"), key: "ap_date", width: 14 },
            { header: t("assessment.col_ap_owner"), key: "ap_owner", width: 20 },
            { header: t("assessment.col_justification"), key: "justification", width: 30 }
        ];
        // Header style: dark navy background, bold white text, frozen first row
        ws2.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
        ws2.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        ws2.getRow(1).alignment = { vertical: "middle" };
        ws2.views = [{ state: "frozen", ySplit: 1 }];

        // Column indices (1-based)
        var COL_ID = 1;
        var COL_SECTION = 2;
        var COL_QUESTION = 3;
        var COL_EXPECTED = 4;
        var COL_ANSWER = 5;
        var COL_COVERAGE = 6;
        var COL_COMMENT = 7;
        var COL_AP_TITLE = 8;
        var COL_AP_DESC = 9;
        var COL_AP_DATE = 10;
        var COL_AP_OWNER = 11;
        var COL_JUSTIFICATION = 12;

        var COVERAGE_OPTIONS = ["covered", "partial", "not_covered", "not_applicable"];

        function _setListValidation(cell: any, values: any, errorMsg?: any) {
            cell.dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ['"' + values.join(",") + '"'],
                showErrorMessage: true,
                errorStyle: "warning",
                errorTitle: "Valeur invalide",
                error: errorMsg || "Choisissez une valeur dans la liste."
            };
        }

        // Lock the question metadata columns (id, section, question, expected)
        // — those are filled by the client and must not be edited by the
        // vendor. We do not enable sheet protection (would require a
        // password); the locked attribute simply communicates intent.
        function _lockCell(cell: any) {
            cell.protection = { locked: true };
            cell.font = Object.assign({}, cell.font, { color: { argb: "FF1E293B" } });
        }

        (tpl.sections || []).forEach(function(section: any) {
            (section.questions || []).forEach(function(q: any) {
                var r = _findAssessmentResp(a, q.id) || {};
                var firstAp = (r.action_plans && r.action_plans[0]) || {};
                var answerStr = "";
                if (Array.isArray(r.answer)) answerStr = r.answer.join("; ");
                else if (r.answer && typeof r.answer === "object" && r.answer.name) answerStr = r.answer.name;
                else if (r.answer != null) answerStr = String(r.answer);
                var row = ws2.addRow({
                    id: q.id,
                    section: section.title,
                    question: q.text,
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
                row.alignment = { vertical: "top", wrapText: true };

                // Lock metadata columns
                _lockCell(row.getCell(COL_ID));
                _lockCell(row.getCell(COL_SECTION));
                _lockCell(row.getCell(COL_QUESTION));
                _lockCell(row.getCell(COL_EXPECTED));

                // Coverage dropdown — every row gets the same list
                _setListValidation(row.getCell(COL_COVERAGE), COVERAGE_OPTIONS);

                // Date format on ap_date
                row.getCell(COL_AP_DATE).numFmt = "yyyy-mm-dd";
            });
        });

        // Conditional formatting: highlight ap_title and justification cells
        // when coverage is "partial" or "not_covered" AND both fields are
        // empty. The formula uses ISBLANK() and absolute column references on
        // the coverage column ($F = 6th column) so each row evaluates
        // independently.
        var lastRow = ws2.rowCount;
        if (lastRow > 1) {
            var coverageColLetter = "F"; // 6th column
            var apTitleColLetter = "H";  // 8th column
            var justColLetter = "L";     // 12th column

            // Range covering ap_title cells from row 2 to lastRow
            var apTitleRange = apTitleColLetter + "2:" + apTitleColLetter + lastRow;
            var justRange = justColLetter + "2:" + justColLetter + lastRow;

            // Formula: TRUE when coverage ∈ {partial, not_covered} AND both
            // ap_title (H) and justification (L) are blank on the same row.
            // The reference uses $F2 (relative row, fixed column) so Excel
            // re-evaluates per row.
            var needAction = 'AND(OR($' + coverageColLetter + '2="partial",$' + coverageColLetter + '2="not_covered"),'
                + 'TRIM($' + apTitleColLetter + '2)="",'
                + 'TRIM($' + justColLetter + '2)="")';

            ws2.addConditionalFormatting({
                ref: apTitleRange + " " + justRange,
                rules: [
                    {
                        type: "expression",
                        formulae: [needAction],
                        style: {
                            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEE2E2" } },
                            font: { color: { argb: "FF7F1D1D" }, bold: true },
                            border: {
                                left:   { style: "thin", color: { argb: "FFB91C1C" } },
                                right:  { style: "thin", color: { argb: "FFB91C1C" } },
                                top:    { style: "thin", color: { argb: "FFB91C1C" } },
                                bottom: { style: "thin", color: { argb: "FFB91C1C" } }
                            }
                        }
                    }
                ]
            });

            // Bonus: also highlight the coverage cell itself in green when
            // it is "covered" or "not_applicable" (visual confirmation).
            ws2.addConditionalFormatting({
                ref: coverageColLetter + "2:" + coverageColLetter + lastRow,
                rules: [
                    {
                        type: "expression",
                        formulae: ['OR($' + coverageColLetter + '2="covered",$' + coverageColLetter + '2="not_applicable")'],
                        style: {
                            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD1FAE5" } },
                            font: { color: { argb: "FF065F46" } }
                        }
                    },
                    {
                        type: "expression",
                        formulae: ['OR($' + coverageColLetter + '2="partial",$' + coverageColLetter + '2="not_covered")'],
                        style: {
                            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEF3C7" } },
                            font: { color: { argb: "FF92400E" } }
                        }
                    }
                ]
            });
        }

        // Sheet 3: Self validation
        var ws3 = wb.addWorksheet(t("assessment.self_validation_sheet"));
        ws3.columns = [{ width: 80 }];
        ws3.addRow([t("assessment.self_validation_title")]);
        ws3.addRow([t("assessment.self_validation_hint")]);
        ws3.addRow([""]);
        ws3.addRow([t("assessment.self_validation_check_label") + ": [   ]  " + t("assessment.self_validation_tick_hint")]);
        ws3.getRow(1).font = { bold: true, size: 14 };

        wb.xlsx.writeBuffer().then(function(buf) {
            var blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            var baseName = (a!.id + "_" + _vendorName(a!.vendor_id).replace(/\s+/g, "_") + "_questionnaire").replace(/[^a-z0-9_.-]/gi, "");
            _triggerDownload(blob, baseName + ".xlsx");
            showStatus(t("assessment.exported"));
        });
    }).catch(function(e) { alert("Excel export failed: " + e.message); });
}
window._exportAssessmentExcel = _exportAssessmentExcel;

// ── Import ───────────────────────────────────────────────────
function _importAssessmentResponse(vendorId: string) {
    closeModal();
    _pickAssessmentFile(null, vendorId);
}
window._importAssessmentResponse = _importAssessmentResponse;

function _importAssessmentIntoExisting(assessId: string) {
    _pickAssessmentFile(assessId, null);
}
window._importAssessmentIntoExisting = _importAssessmentIntoExisting;

function _pickAssessmentFile(existingAssessId: string | null, vendorId: string | null) {
    var fi = document.createElement("input");
    fi.type = "file";
    fi.accept = ".json,.ctenc,.xlsx";
    fi.onchange = function() {
        if (!fi.files![0]) return;
        var file = fi.files![0];
        var name = file.name.toLowerCase();
        if (name.endsWith(".ctenc")) {
            _promptPasswordAndDecrypt(file, function(text: any) {
                _handleImportedJSON(text, existingAssessId, vendorId);
            });
        } else if (name.endsWith(".json")) {
            var reader = new FileReader();
            reader.onload = function(e) { _handleImportedJSON(e.target!.result, existingAssessId, vendorId); };
            reader.readAsText(file);
        } else if (name.endsWith(".xlsx")) {
            _handleImportedExcel(file, existingAssessId, vendorId);
        } else {
            alert(t("assessment.unsupported_format"));
        }
    };
    fi.click();
}

function _promptPasswordAndDecrypt(file: any, onSuccess: any) {
    // Use the masked-input modal (#pwd-overlay) from cisotoolbox.js
    // instead of window.prompt(), which would show the password in plain
    // text. Falls back to native prompt if the overlay is not present.
    _promptPassword(t("assessment.decryption_password")).then(function(pwd) {
        if (pwd === null || pwd === undefined) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            _decryptData(e.target!.result as ArrayBuffer, pwd).then(onSuccess).catch(function() {
                alert(t("assessment.decryption_failed"));
            });
        };
        reader.readAsArrayBuffer(file);
    });
}

function _handleImportedJSON(text: any, existingAssessId: string | null, vendorId: string | null) {
    var payload;
    try { payload = JSON.parse(text); }
    catch (e) { alert(t("assessment.invalid_json")); return; }
    if (!payload || payload.format !== "ciso_toolbox_vendor_assessment") {
        alert(t("assessment.invalid_payload"));
        return;
    }
    _applyImportedPayload(payload, existingAssessId, vendorId);
}

function _applyImportedPayload(payload: any, existingAssessId: string | null, vendorId: string | null) {
    var a: TprmAssessment | undefined;
    if (existingAssessId) {
        a = _findAssessment(existingAssessId);
        if (!a) { alert("Assessment not found"); return; }
    } else {
        // Look up by payload assessment_id first
        a = _findAssessment(payload.assessment_id);
        if (!a) {
            // Create a new assessment anchored to the vendor
            var targetVendor = vendorId || payload.vendor_id;
            a = {
                id: _nextAssessmentId(),
                vendor_id: targetVendor,
                type: "periodic",
                date: payload.date || _today(),
                due_date: payload.due_date || "",
                template_id: payload.template && payload.template.id,
                template_version: payload.template && payload.template.version,
                template_snapshot: payload.template,
                status: "pending_approval",
                responses: [],
                self_validation: true,
                self_validated_at: payload.exported_at || new Date().toISOString(),
                score: null,
                completion_rate: 0
            };
            D.assessments.push(a);
        }
    }
    // Merge responses from payload
    a.responses = (payload.responses || []).map(function(r: any) { return JSON.parse(JSON.stringify(r)); });
    a.status = "pending_approval";
    if (!a.template_snapshot && payload.template) a.template_snapshot = payload.template;
    _touchAssessment(a);
    showStatus(t("assessment.imported"));
    if (_selectedVendor !== null) _assessmentV2Returning = _selectedVendor;
    openAssessmentV2(a.id);
}

// Extract a plain string from an ExcelJS cell value. ExcelJS can return
// numbers, Date objects, rich text, hyperlinks, formula results, etc. —
// this normalizes everything into a trimmed string.
function _xlCellText(cell: any) {
    if (!cell) return "";
    var v = cell.value;
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (v instanceof Date) return v.toISOString().split("T")[0];
    // Rich text: { richText: [ { text: "..." }, ... ] }
    if (v.richText) return v.richText.map(function(p: any) { return p.text || ""; }).join("").trim();
    // Hyperlink: { text: "...", hyperlink: "..." }
    if (v.text) return String(v.text).trim();
    // Formula: { formula: "...", result: "..." }
    if (v.result != null) return _xlCellText({ value: v.result });
    try { return String(v).trim(); } catch (e) { return ""; }
}

function _handleImportedExcel(file: any, existingAssessId: string | null, vendorId: string | null) {
    _loadExcelJS().then(function() {
        var reader = new FileReader();
        reader.onload = function(e) {
            var wb = new ExcelJS.Workbook();
            wb.xlsx.load(e.target!.result as ArrayBuffer).then(function() {
                // Find the questionnaire sheet — try the localized name first,
                // then any sheet named "Questionnaire" (FR or EN), then the
                // first sheet that has an ID column in its header.
                var ws = wb.getWorksheet(t("assessment.questionnaire_sheet"));
                if (!ws) ws = wb.getWorksheet("Questionnaire");
                if (!ws) {
                    ws = wb.worksheets.find(function(w) {
                        if (w.rowCount < 2) return false;
                        var first = w.getRow(1).getCell(1);
                        return _xlCellText(first).toLowerCase() === "id";
                    });
                }
                if (!ws) { alert(t("assessment.invalid_excel")); return; }

                // Build a { header → columnIndex } map. ExcelJS columns are
                // 1-based; eachCell also yields 1-based indices.
                var headerIdx: Record<string, any> = {}; // lowercased header → col index (1-based)
                ws.getRow(1).eachCell(function(cell, col) {
                    var txt = _xlCellText(cell).toLowerCase();
                    if (txt) headerIdx[txt] = col;
                });

                // Column resolver with FR / EN synonyms — the Excel template
                // uses the localized header at export time, so we must accept
                // both locales at import time.
                function col(key: any, fallbacks?: any) {
                    var candidates = [key].concat(fallbacks || []);
                    for (var i = 0; i < candidates.length; i++) {
                        if (headerIdx[candidates[i]] != null) return headerIdx[candidates[i]];
                    }
                    return null;
                }
                // Map by internal key → Excel column index
                var cIdx = {
                    id:            col("id"),
                    coverage:      col("coverage", ["couverture"]),
                    answer:        col("answer", ["réponse", "reponse"]),
                    comment:       col("comment", ["commentaire"]),
                    justification: col("justification"),
                    ap_title:      col("ap_title", ["action - intitulé", "action - intitule", "plan d'action - titre", "action plan - title", "action - title"]),
                    ap_desc:       col("ap_desc", ["action - description", "plan d'action - description", "action plan - description"]),
                    ap_date:       col("ap_date", ["action - date cible", "plan d'action - date cible", "action plan - target date", "action - target date"]),
                    ap_owner:      col("ap_owner", ["action - responsable", "plan d'action - responsable", "action plan - owner", "action - owner"])
                };

                if (cIdx.id == null) { alert(t("assessment.invalid_excel")); return; }

                // Build response map
                var respByQ: Record<string, any> = {};
                for (var r = 2; r <= ws.rowCount; r++) {
                    var row = ws.getRow(r);
                    var qid = _xlCellText(row.getCell(cIdx.id));
                    if (!qid) continue;
                    var entry = {
                        coverage: cIdx.coverage ? _normalizeCoverage(_xlCellText(row.getCell(cIdx.coverage))) : null,
                        answer: cIdx.answer ? _xlCellText(row.getCell(cIdx.answer)) : "",
                        comment: cIdx.comment ? _xlCellText(row.getCell(cIdx.comment)) : "",
                        justification: cIdx.justification ? _xlCellText(row.getCell(cIdx.justification)) : "",
                        action_plans: [] as any[]
                    };
                    var apTitle = cIdx.ap_title ? _xlCellText(row.getCell(cIdx.ap_title)) : "";
                    if (apTitle) {
                        entry.action_plans.push({
                            id: "AP-001",
                            title: apTitle,
                            description: cIdx.ap_desc ? _xlCellText(row.getCell(cIdx.ap_desc)) : "",
                            target_date: cIdx.ap_date ? _xlCellText(row.getCell(cIdx.ap_date)) : "",
                            owner: cIdx.ap_owner ? _xlCellText(row.getCell(cIdx.ap_owner)) : "",
                            status: "proposed"
                        });
                    }
                    respByQ[qid] = entry;
                }

                // Apply to existing assessment if provided, otherwise try to
                // match an existing one by scanning question IDs.
                var a;
                if (existingAssessId) a = _findAssessment(existingAssessId);
                if (!a) {
                    // Heuristic: find an assessment whose responses intersect
                    // with the imported question ids. This lets the user
                    // import "from scratch" from the vendor detail without
                    // having opened a specific assessment first.
                    var qIds = Object.keys(respByQ);
                    var candidate = (D.assessments || []).find(function(x) {
                        if (!x.template_snapshot) return false;
                        if (vendorId && x.vendor_id !== vendorId) return false;
                        return (x.responses || []).some(function(rr) { return qIds.indexOf(rr.question_id) >= 0; });
                    });
                    if (candidate) a = candidate;
                }
                if (!a) {
                    alert(t("assessment.excel_need_existing"));
                    return;
                }

                var matched = 0;
                (a.responses || []).forEach(function(resp) {
                    var imported = respByQ[resp.question_id];
                    if (!imported) return;
                    matched++;
                    if (imported.coverage) resp.coverage = imported.coverage;
                    if (imported.answer != null && imported.answer !== "") resp.answer = imported.answer;
                    if (imported.comment) resp.comment = imported.comment;
                    if (imported.justification) resp.justification = imported.justification;
                    if (imported.action_plans && imported.action_plans.length) resp.action_plans = imported.action_plans;
                });

                if (matched === 0) {
                    alert(t("assessment.excel_no_match"));
                    return;
                }

                a.status = "pending_approval";
                a.self_validation = true;
                a.self_validated_at = new Date().toISOString();
                _touchAssessment(a);
                showStatus(t("assessment.imported") + " (" + matched + ")");
                if (_selectedVendor !== null) _assessmentV2Returning = _selectedVendor;
                openAssessmentV2(a.id);
            }).catch(function(err) {
                console.error("Excel import failed:", err);
                alert(t("assessment.invalid_excel") + " — " + (err && err.message ? err.message : err));
            });
        };
        reader.onerror = function() { alert(t("assessment.invalid_excel")); };
        reader.readAsArrayBuffer(file);
    }).catch(function(err) {
        console.error("ExcelJS load failed:", err);
        alert(t("assessment.invalid_excel"));
    });
}

// ── Template Excel: download example + import ────────────────────
function downloadTemplateExcelExample() {
    _loadExcelJS().then(function() {
        var wb = new ExcelJS.Workbook();

        // Sheet 1 — Instructions
        var ws1 = wb.addWorksheet(t("template.xlsx_instructions_sheet"));
        ws1.columns = [{ width: 110 }];
        [
            t("template.xlsx_instructions_title"),
            "",
            t("template.xlsx_instructions_line1"),
            t("template.xlsx_instructions_line2"),
            t("template.xlsx_instructions_line3"),
            t("template.xlsx_instructions_line4"),
            "",
            t("template.xlsx_instructions_cols"),
            t("template.xlsx_instructions_col_section"),
            t("template.xlsx_instructions_col_question"),
            t("template.xlsx_instructions_col_expected"),
            t("template.xlsx_instructions_col_criticality"),
            t("template.xlsx_instructions_col_weight"),
            "",
            t("template.xlsx_instructions_note")
        ].forEach(function(line) { ws1.addRow([line]); });
        ws1.getRow(1).font = { bold: true, size: 14 };

        // Sheet 2 — Questions
        var ws2 = wb.addWorksheet(t("template.xlsx_questions_sheet"));
        ws2.columns = [
            { header: t("template.xlsx_col_section"), key: "section", width: 28 },
            { header: t("template.xlsx_col_question"), key: "question", width: 60 },
            { header: t("template.xlsx_col_expected"), key: "expected", width: 40 },
            { header: t("template.xlsx_col_criticality"), key: "criticality", width: 16 },
            { header: t("template.xlsx_col_weight"), key: "weight", width: 10 }
        ];
        ws2.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F3A" } };
        ws2.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        ws2.views = [{ state: "frozen", ySplit: 1 }];

        // Example rows
        var examples = [
            ["Gouvernance", "Avez-vous une politique de securite de l'information documentee et approuvee par la direction ?", "Politique SSI signee, derniere revue < 12 mois", "major", 5],
            ["Gouvernance", "Un responsable de la securite (RSSI ou equivalent) est-il designe ?", "Nom, fonction, rattachement hierarchique", "major", 5],
            ["Gestion des acces", "Appliquez-vous le principe du moindre privilege sur les comptes utilisateurs ?", "Procedure de revue d'acces, frequence, peripherique couvert", "blocker", 8],
            ["Gestion des acces", "L'authentification multi-facteur (MFA) est-elle activee pour les acces a privileges ?", "Liste des systemes proteges, type de MFA", "blocker", 8],
            ["Protection des donnees", "Les donnees sensibles sont-elles chiffrees au repos et en transit ?", "Algorithmes, gestion des cles", "major", 7],
            ["Protection des donnees", "Des sauvegardes testees regulierement sont-elles en place ?", "Frequence, retention, test de restauration", "major", 6],
            ["Incidents", "Disposez-vous d'un plan de reponse aux incidents de securite ?", "Plan documente, exercices annuels", "major", 5],
            ["Sous-traitance", "Evaluez-vous la securite de vos propres sous-traitants critiques ?", "Process d'evaluation, frequence", "info", 3]
        ];
        examples.forEach(function(row) { ws2.addRow(row); });

        // Data validation on criticality column (col 4)
        var CRITS = ["info", "major", "blocker"];
        for (var r = 2; r <= 200; r++) {
            ws2.getCell(r, 4).dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: ['"' + CRITS.join(",") + '"']
            };
            ws2.getCell(r, 5).dataValidation = {
                type: "whole",
                operator: "between",
                allowBlank: true,
                formulae: ["0", "100"],
                errorTitle: t("template.xlsx_weight_error_title"),
                error: t("template.xlsx_weight_error")
            };
        }

        wb.xlsx.writeBuffer().then(function(buf) {
            var blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            _triggerDownload(blob, "template_questionnaire_example.xlsx");
        });
    }).catch(function(err) {
        console.error("ExcelJS load failed:", err);
        alert(t("assessment.invalid_excel"));
    });
}
window.downloadTemplateExcelExample = downloadTemplateExcelExample;

function importTemplateFromExcel() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx";
    input.onchange = function(e) {
        var file = (e.target as HTMLInputElement).files && (e.target as HTMLInputElement).files![0];
        if (file) _handleImportedTemplateExcel(file);
    };
    input.click();
}
window.importTemplateFromExcel = importTemplateFromExcel;
window._handleImportedTemplateExcel = _handleImportedTemplateExcel;

function _handleImportedTemplateExcel(file: any) {
    _loadExcelJS().then(function() {
        var reader = new FileReader();
        reader.onload = function(e) {
            var wb = new ExcelJS.Workbook();
            wb.xlsx.load(e.target!.result as ArrayBuffer).then(function() {
                // Find the questions sheet: localized name, "Questions", or first
                // sheet with a recognizable header row.
                var ws = wb.getWorksheet(t("template.xlsx_questions_sheet"));
                if (!ws) ws = wb.getWorksheet("Questions");
                if (!ws) {
                    ws = wb.worksheets.find(function(w) {
                        if (w.rowCount < 2) return false;
                        var firstText = _xlCellText(w.getRow(1).getCell(1)).toLowerCase();
                        return firstText === "section" || firstText === t("template.xlsx_col_section").toLowerCase();
                    });
                }
                if (!ws) ws = wb.worksheets[0];
                if (!ws || ws.rowCount < 2) {
                    alert(t("template.xlsx_import_empty"));
                    return;
                }

                // Build header → column map
                var headerIdx: Record<string, any> = {};
                ws.getRow(1).eachCell(function(cell, col) {
                    var txt = _xlCellText(cell).toLowerCase().trim();
                    if (txt) headerIdx[txt] = col;
                });
                function col(key: any, fallbacks?: any) {
                    var candidates = [key].concat(fallbacks || []);
                    for (var i = 0; i < candidates.length; i++) {
                        if (headerIdx[candidates[i]] != null) return headerIdx[candidates[i]];
                    }
                    return null;
                }
                var cIdx = {
                    section:     col("section"),
                    question:    col("question", ["text", "texte", "intitule", "intitulé"]),
                    expected:    col("expected", ["reponse attendue", "réponse attendue", "preuve attendue", "attendu"]),
                    criticality: col("criticality", ["criticite", "criticité"]),
                    weight:      col("weight", ["poids"])
                };

                if (cIdx.section == null || cIdx.question == null) {
                    alert(t("template.xlsx_import_missing_cols"));
                    return;
                }

                // Build sections array preserving order
                var sectionsByTitle: Record<string, any> = {};
                var sectionsOrder = [];
                var totalQ = 0;

                for (var r = 2; r <= ws.rowCount; r++) {
                    var row = ws.getRow(r);
                    var secTitle = _xlCellText(row.getCell(cIdx.section)).trim();
                    var qText = _xlCellText(row.getCell(cIdx.question)).trim();
                    if (!secTitle || !qText) continue;

                    if (!sectionsByTitle[secTitle]) {
                        sectionsByTitle[secTitle] = {
                            id: "SEC-" + String(sectionsOrder.length + 1).padStart(3, "0"),
                            title: secTitle,
                            description: "",
                            questions: []
                        };
                        sectionsOrder.push(secTitle);
                    }
                    var sec = sectionsByTitle[secTitle];
                    var crit = cIdx.criticality ? _xlCellText(row.getCell(cIdx.criticality)).toLowerCase().trim() : "";
                    if (["info", "major", "blocker"].indexOf(crit) < 0) crit = "major";
                    var w = cIdx.weight ? parseInt(_xlCellText(row.getCell(cIdx.weight)), 10) : 5;
                    if (isNaN(w) || w < 1) w = 5;
                    if (w > 100) w = 100;

                    sec.questions.push({
                        id: "Q-" + String(sec.questions.length + 1).padStart(3, "0"),
                        type: "free_text",
                        text: qText,
                        description: "",
                        expected: cIdx.expected ? _xlCellText(row.getCell(cIdx.expected)) : "",
                        weight: w,
                        criticality: crit,
                        options: []
                    });
                    totalQ++;
                }

                if (totalQ === 0) {
                    alert(t("template.xlsx_import_empty"));
                    return;
                }

                var lang = (typeof _locale === "string" && _locale === "en") ? "en" : "fr";
                var baseName = (file.name || "").replace(/\.[^.]+$/, "") || t("template.imported_default_name");
                var tpl: TprmTemplate = {
                    id: _nextTemplateId(),
                    name: baseName,
                    description: t("template.imported_desc"),
                    kind: "questionnaire",
                    language: lang,
                    version: 1,
                    created_at: _today(),
                    updated_at: _today(),
                    sections: sectionsOrder.map(function(title) { return sectionsByTitle[title]; })
                };
                // Normalize question IDs to be globally unique within the template
                _normalizeTemplateQuestionIds(tpl);

                if (!D.questionnaire_templates) D.questionnaire_templates = [];
                D.questionnaire_templates.push(tpl);
                _autoSave();
                showStatus(t("template.imported") + " (" + totalQ + ")");
                _editingTemplateId = tpl.id;
                renderPanel();
            }).catch(function(err) {
                console.error("Template Excel import failed:", err);
                alert(t("template.xlsx_import_error") + " — " + (err && err.message ? err.message : err));
            });
        };
        reader.onerror = function() { alert(t("template.xlsx_import_error")); };
        reader.readAsArrayBuffer(file);
    }).catch(function(err) {
        console.error("ExcelJS load failed:", err);
        alert(t("template.xlsx_import_error"));
    });
}

function _normalizeCoverage(raw: any) {
    if (!raw) return null;
    var s = String(raw).toLowerCase().trim();
    if (["covered", "couverte", "c"].indexOf(s) >= 0) return "covered";
    if (["partial", "partielle", "partiellement", "p"].indexOf(s) >= 0) return "partial";
    if (["not_covered", "non couverte", "non-couverte", "nc"].indexOf(s) >= 0) return "not_covered";
    if (["not_applicable", "non applicable", "na", "n/a"].indexOf(s) >= 0) return "not_applicable";
    return null;
}

// ═══════════════════════════════════════════════════════════════
// GLOBAL MEASURES REGISTRY
// ═══════════════════════════════════════════════════════════════


function _vendorMeasureStatusBadge(statut: any) {
    var palette: Record<string, string> = {
        planifie:  "background:var(--ct-info-tint);color:var(--ct-info-ink)",
        en_cours:  "background:var(--ct-medium-tint);color:var(--ct-medium-ink)",
        termine:   "background:var(--ct-low-tint);color:var(--ct-low-ink)"
    };
    var style = palette[statut] || palette.planifie;
    var label = t("measure." + (statut || "planifie")) || statut || "";
    return '<span class="ct-badge" data-tone="neutral" style="' + style + '">' + esc(label) + '</span>';
}

function renderGlobalMeasures(): string {
    var allMeasures: any[] = [];
    D.vendors.forEach(function(v, vi) {
        (v.measures || []).forEach(function(m, mi) {
            allMeasures.push({
                id: m.id,
                vendor: v.name,
                vendor_id: v.id,
                vendorIdx: vi,
                measureIdx: mi,
                mesure: m.mesure || "",
                type: m.type || "",
                statut: m.statut || "",
                responsable: m.responsable || "",
                echeance: m.echeance || ""
            });
        });
    });

    // Count unlinked measures
    var unlinkedCount = 0;
    D.vendors.forEach(function(v) {
        var vendorRisks = D.risks.filter(function(r) { return r.vendor_id === v.id; });
        var allLinkedIds: Record<string, any> = {};
        vendorRisks.forEach(function(r) {
            (r.linked_measures || "").split(",").forEach(function(s) { var id = s.trim().split(" - ")[0].trim(); if (id) allLinkedIds[id] = true; });
        });
        (v.measures || []).forEach(function(m) { if (!allLinkedIds[m.id]) unlinkedCount++; });
    });

    var h = '<div class="ct-flex ct-row-between ct-items-center ct-mb-2">';
    h += '<h2>' + t("nav.measures") + ' (' + allMeasures.length + ')</h2>';
    h += '<div class="ct-flex ct-gap-2">';
    h += '<button class="ct-btn" data-variant="primary" data-click="_refreshMeasures" title="Rafraîchir">&#x21bb;</button>';
    if (unlinkedCount > 0) {
        h += '<button class="ct-btn" data-variant="danger" data-size="sm" data-click="deleteUnlinkedMeasures">' + t("measure.delete_unlinked") + ' (' + unlinkedCount + ')</button>';
    }
    h += '</div></div>';
    if (!allMeasures.length) return h + '<div class="ct-empty-state">' + t("measure.empty") + '</div>';

    h += ct_table.render({
        rows: allMeasures,
        rowKey: "id",
        onRowClick: "_editVendorMeasureRow",
        bulk: { scope: "vendor-measures" },
        columns: [
            { key: "vendor", label: t("nav.vendors"),
              render: function(r: any) { return '<span class="fw-600">' + esc(r.vendor) + '</span>'; } },
            { key: "id", label: "ID", width: "110px" },
            { key: "mesure", label: t("measure.col_mesure"),
              render: function(r: any) { return esc(r.mesure); } },
            { key: "type", label: t("measure.col_type"), width: "140px",
              render: function(r: any) { return esc(r.type); } },
            { key: "statut", label: t("measure.col_statut"), width: "120px",
              render: function(r: any) { return _vendorMeasureStatusBadge(r.statut); } },
            { key: "responsable", label: t("measure.col_responsable"),
              render: function(r: any) { return esc(r.responsable); } },
            { key: "echeance", label: t("measure.col_echeance"), width: "120px",
              render: function(r: any) { return esc(r.echeance); } }
        ]
    });

    setTimeout(function() {
        if (!window.ct_bulkbar) return;
        ct_bulkbar.attach({
            scope: "vendor-measures",
            label: t("measure.selected_n") || "{n} mesure(s) sélectionnée(s)",
            actions: [
                { id: "done", icon: "check", label: t("measure.termine") || "Terminé", variant: "success",
                  onClick: "_bulkVendorMeasuresDone" },
                { id: "delete", icon: "trash", label: t("btn_delete") || "Supprimer", danger: true,
                  onClick: "_bulkVendorMeasuresDelete",
                  confirm: { title: "Supprimer {n} mesure(s) ?", message: "Cette action est irréversible." } }
            ]
        });
        ct_bulkbar.update("vendor-measures");
    }, 0);

    return h;
}

window._refreshMeasures = function() {
    // Vendor stores measures inside each vendor blob; the simplest
    // reliable refresh is to re-fetch the project payload.
    var pid = (typeof getActiveProjectId === "function") ? getActiveProjectId() : null;
    if (pid && window.VendorAPI && VendorAPI.get) {
        VendorAPI.get(pid).then(function(proj: any) {
            if (proj && proj.data) {
                // Preserve reactive references by replacing in place
                Object.keys(proj.data).forEach(function(k) { D[k] = proj.data[k]; });
            }
            showStatus("Données rafraîchies");
            renderPanel();
        }).catch(function(e: any) { showStatus("Erreur : " + (e.message || e), true); });
    } else {
        window.location.reload();
    }
};

window._editVendorMeasureRow = function(row: any) {
    if (!window.ct_measure_modal) return;
    var v = D.vendors[row.vendorIdx];
    if (!v || !v.measures || !v.measures[row.measureIdx]) return;
    var m = v.measures[row.measureIdx];

    var opts = _vendorMeasureModalOpts();
    var typeOpts = opts.typeOptions;
    var statusOpts = opts.statusOptions;

    ct_measure_modal.open(m, {
        title: m.id + " — " + v.name,
        fieldMap: { title: "mesure", description: "details" },
        typeOptions: typeOpts,
        statusOptions: statusOpts,
        defaultStatus: "planifie",
        ownerPicker: { pickerId: "vendor-measure-owner", directoryUrl: "api/directory" },
        onAddNote: function(_entry, fullLog) {
            (m as Record<string, any>).progress_log = fullLog;
            if (typeof _persist === "function") _persist("measure", m.id, { progress_log: fullLog });
        },
        extraFields: [
            { key: "ref_socle", label: t("measure.ref_socle") || "Ref socle", type: "text", value: m.ref_socle || "" },
            { key: "effet",     label: t("measure.effet")     || "Effet",     type: "textarea", rows: 2, value: m.effet || "" }
        ],
        onDelete: function() {
            ct_modal.confirm({
                title: t("measure.confirm_delete") || "Supprimer cette mesure ?",
                message: "Cette action est irréversible.",
                danger: true
            }).then(function(ok: any) {
                if (!ok) return;
                v.measures!.splice(row.measureIdx, 1);
                if (typeof _persistDelete === "function") _persistDelete("measure", m.id);
                showStatus("Mesure supprimée");
                renderPanel();
            });
        }
    }).then(function(result: any) {
        if (!result || result.__deleted) return;
        var patch: Record<string, any> = {};
        ["mesure", "details", "type", "statut", "responsable", "echeance", "ref_socle", "effet", "progress_log"].forEach(function(k) {
            if (result[k] !== undefined && result[k] !== m[k]) { m[k] = result[k]; patch[k] = result[k]; }
        });
        if (Object.keys(patch).length) _persist("measure", m.id, patch);
        showStatus(t("measure.saved") || "Mesure enregistrée");
        renderPanel();
    });
};

window._bulkVendorMeasuresDone = function(scope: string) {
    var ids = Array.from(ct_bulkbar.getSelection(scope));
    if (!ids.length) return;
    var count = 0;
    D.vendors.forEach(function(v) {
        (v.measures || []).forEach(function(m) {
            if (ids.indexOf(m.id) >= 0) {
                m.statut = "termine";
                count++;
                _persist("measure", m.id, { statut: "termine" });
            }
        });
    });
    ct_bulkbar.clear(scope);
    showStatus(count + " mesure(s) marquée(s) terminée(s)");
    renderPanel();
};

window._bulkVendorMeasuresDelete = function(scope: string) {
    var ids = Array.from(ct_bulkbar.getSelection(scope));
    if (!ids.length) return;
    var count = 0;
    D.vendors.forEach(function(v) {
        if (!v.measures) return;
        var before = v.measures.length;
        v.measures = v.measures.filter(function(m) { return ids.indexOf(m.id) < 0; });
        count += before - v.measures.length;
    });
    if (typeof _persistDelete === "function") {
        ids.forEach(function(mid) { _persistDelete("measure", mid); });
    }
    ct_bulkbar.clear(scope);
    showStatus(count + " mesure(s) supprimée(s)");
    renderPanel();
};

function deleteUnlinkedMeasures() {
    var count = 0;
    D.vendors.forEach(function(v) {
        if (!v.measures || !v.measures.length) return;
        var vendorRisks = D.risks.filter(function(r) { return r.vendor_id === v.id; });
        var allLinkedIds: Record<string, any> = {};
        vendorRisks.forEach(function(r) {
            (r.linked_measures || "").split(",").forEach(function(s) {
                var id = s.trim().split(" - ")[0].trim();
                if (id) allLinkedIds[id] = true;
            });
        });
        var before = v.measures.length;
        v.measures = v.measures.filter(function(m) { return allLinkedIds[m.id]; });
        if (v.measures.length < before) _persist("vendor", v.id, { measures: v.measures });
        count += before - v.measures.length;
    });
    if (count > 0) {
        renderPanel();
        showStatus(count + " " + t("measure.deleted_unlinked"));
    }
}
window.deleteUnlinkedMeasures = deleteUnlinkedMeasures;

function editMeasure(vendorIdx: any, measureIdx: any, _returnTo?: any) {
    // Shared modal everywhere — the legacy full-page form is gone.
    if (window._editVendorMeasureRow) window._editVendorMeasureRow({ vendorIdx: vendorIdx, measureIdx: measureIdx });
}
window.editMeasure = editMeasure;

var _assessReturnToVendor: number | null = null;

function setVendorTab(tab: any) { _vendorTab = tab; renderPanel(); }
window.setVendorTab = setVendorTab;

// ═══════════════════════════════════════════════════════════════
// PP EXPORT / IMPORT (EBIOS RM interop)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ═══════════════════════════════════════════════════════════════

// ExcelJS 4.4.0, vendored under js/vendor/ (same build as risk/). Served from
// our own origin so script-src stays 'self' — no CDN in the CSP, and no
// third-party availability/tampering dependency at export time. SRI is not
// needed for a same-origin asset shipped in the image.
function _loadExcelJS() {
    return _loadScript("js/vendor/exceljs.min.js");
}


// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function _getTier(v: any) {
    var ex = v.exposure || {};
    var menace = _computeExposure(ex);
    if (menace >= 4) return "critical";
    if (menace >= 2) return "high";
    if (menace >= 1) return "medium";
    return "low";
}

function _scoreToMaturite(score: any) {
    return score >= 80 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : score >= 20 ? 1 : 0;
}

function _verifyAndAddDoc(vendorId: string, doc: any) {
    // Verify URL server-side (HEAD request, no CORS issues, real HTTP status)
    if (typeof VendorAPI !== "undefined" && VendorAPI.verifyUrl) {
        VendorAPI.verifyUrl(doc.url).then(function(result: any) {
            if (!result.reachable) return;
            var alreadyExists = D.documents.find(function(d) { return d.url === doc.url && d.vendor_id === vendorId; });
            if (alreadyExists) return;
            var newDoc = {
                id: _nextSeqId("DOC", D.documents),
                vendor_id: vendorId,
                name: doc.name,
                type: doc.type || "other",
                url: doc.url,
                expiry_date: "",
                source: "ai",
                verified: true
            };
            D.documents.push(newDoc);
            if (typeof _persistCreate === "function") _persistCreate("document", newDoc);
            else if (typeof _autoSave === "function") _autoSave();
        }).catch(function() {});
    } else {
        fetch(doc.url, { method: "GET", mode: "no-cors", redirect: "follow" }).then(function() {
            var alreadyExists = D.documents.find(function(d) { return d.url === doc.url && d.vendor_id === vendorId; });
            if (alreadyExists) return;
            var newDoc2 = {
                id: _nextSeqId("DOC", D.documents),
                vendor_id: vendorId,
                name: doc.name,
                type: doc.type || "other",
                url: doc.url,
                expiry_date: "",
                source: "ai",
                verified: true
            };
            D.documents.push(newDoc2);
            if (typeof _persistCreate === "function") _persistCreate("document", newDoc2);
            else if (typeof _autoSave === "function") _autoSave();
        }).catch(function() {});
    }
}

function _fetchLogo() {
    if (_selectedVendor === null) return;
    var v = D.vendors[_selectedVendor!];
    if (!v) return;
    var urlEl = document.getElementById("v-logo-url");
    var url = urlEl ? (urlEl as HTMLInputElement).value.trim() : "";
    if (!url) return;

    showStatus(t("vendor.logo_loading"));
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function() {
        // Resize to max 64x64 and convert to base64
        var canvas = document.createElement("canvas");
        var size = 64;
        var w = img.width, h = img.height;
        if (w > h) { canvas.width = size; canvas.height = Math.round(h * size / w); }
        else { canvas.height = size; canvas.width = Math.round(w * size / h); }
        var ctx = canvas.getContext("2d");
        ctx!.drawImage(img, 0, 0, canvas.width, canvas.height);
        v.logo = canvas.toDataURL("image/png");
        _persist("vendor", v.id, { logo: v.logo });
        renderPanel();
        showStatus(t("vendor.logo_saved"));
    };
    img.onerror = function() {
        showStatus(t("vendor.logo_error"));
    };
    img.src = url;
}
window._fetchLogo = _fetchLogo;

function _vendorInitials(name: any) {
    if (!name) return "?";
    var words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
}

function _vendorAvatar(v: any) {
    var initials = _vendorInitials(v.name);
    if (v.logo) {
        return '<img class="vendor-logo-img" src="' + esc(v.logo) + '" data-initials="' + esc(initials) + '" alt="">';
    }
    return '<span class="vendor-initials">' + esc(initials) + '</span>';
}

function _vendorName(id: any) {
    var v = D.vendors.find(function(x) { return x.id === id; });
    return v ? v.name : id;
}

function _scoreClass(score: any) {
    if (score >= 16) return "score-critical";
    if (score >= 10) return "score-high";
    if (score >= 5) return "score-medium";
    return "score-low";
}

function _scoreColorClass(pct: any) {
    if (pct >= 80) return "score-low";
    if (pct >= 60) return "score-medium";
    if (pct >= 40) return "score-high";
    return "score-critical";
}

// Vendor identity country field — uses the DORA ISO 3166-1 codelist when
// available (loaded once DORA panel or DoraData.ensureCodelists() is called),
// falling back to a free-text input so the field stays usable on a fresh load.
function _vendorCountryField(value: string | undefined) {
    var list = window.DoraData && typeof DoraData.getCodelist === "function" ? DoraData.getCodelist("country_iso3166_1") : null;
    if (!list || !list.length) {
        // Trigger a background load so the next render shows the dropdown.
        if (window.DoraData && typeof DoraData.ensureCodelists === "function") {
            DoraData.ensureCodelists(function() {
                var el = document.getElementById("v-country");
                if (!el) return;
                // Re-render the row in place.
                el.outerHTML = _vendorCountryField(value).replace(/^<div class="ct-form-row">[^<]*<label>[^<]*<\/label>/, "");
            });
        }
        return _field("vendor.country", "v-country", value);
    }
    var h = '<div class="ct-form-row"><label>' + t("vendor.country") + '</label>';
    h += '<select id="v-country" data-change="_autoSaveVendorField"><option value=""></option>';
    var cur = (value || "").toUpperCase();
    list.forEach(function(it: any) {
        var code = it && it.code !== undefined ? it.code : it;
        var label = it && it.label !== undefined ? it.label : it;
        var sel = code === cur ? " selected" : "";
        h += '<option value="' + esc(code) + '"' + sel + '>' + esc(code) + ' — ' + esc(label) + '</option>';
    });
    h += '</select></div>';
    return h;
}

// Vendor sector field — autocomplete bound to the NACE Rev. 2 datalist
// when DORA codelists are loaded; falls back to a free-text input so
// existing free-form values keep working. The datalist is embedded
// alongside the input (one vendor form open at a time).
function _vendorSectorField(value: string | undefined) {
    var list = window.DoraData && typeof DoraData.getCodelist === "function" ? DoraData.getCodelist("nace_rev2") : null;
    if (!list || !list.length) {
        if (window.DoraData && typeof DoraData.ensureCodelists === "function") {
            DoraData.ensureCodelists(function() {
                var el = document.getElementById("v-sector");
                if (!el) return;
                // Inject datalist + bind list attr now that codelist is loaded.
                if (!document.getElementById("nace-list")) {
                    el.insertAdjacentHTML("afterend", _naceDatalistHtml());
                }
                el.setAttribute("list", "nace-list");
            });
        }
        return _field("vendor.sector", "v-sector", value);
    }
    var ph = t("vendor.sector_ph") || "";
    var h = '<div class="ct-form-row"><label>' + t("vendor.sector") + '</label>';
    h += '<input type="text" id="v-sector" list="nace-list" value="' + esc(value || "") + '" data-input="_autoSaveVendorField" placeholder="' + esc(ph) + '">';
    h += _naceDatalistHtml();
    h += '</div>';
    return h;
}

// Build NACE Rev. 2 <datalist> HTML from DORA codelists. Empty if
// codelists not loaded yet.
function _naceDatalistHtml() {
    if (window.DoraData && typeof DoraData.naceDatalist === "function") {
        return DoraData.naceDatalist();
    }
    return '';
}

function _field(labelKey: any, id: any, value: string | undefined, type?: any) {
    return '<div class="ct-form-row"><label>' + t(labelKey) + '</label><input type="' + (type || "text") + '" id="' + id + '" value="' + esc(value || "") + '" data-input="_autoSaveVendorField"></div>';
}

function _select(labelKey: any, id: any, value: string | undefined, options: any) {
    var h = '<div class="ct-form-row"><label>' + t(labelKey) + '</label><select id="' + id + '" data-change="_autoSaveVendorField">';
    options.forEach(function(o: any) {
        h += '<option value="' + o[0] + '"' + (value === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    });
    h += '</select></div>';
    return h;
}

function _showModal(content: any) {
    var existing = document.getElementById("tprm-modal");
    if (existing) existing.remove();
    var bg = document.createElement("div");
    bg.id = "tprm-modal";
    bg.className = "ct-pwd-overlay";
    bg.style.display = "flex";
    bg.innerHTML = '<div class="ct-pwd-panel" style="max-width:460px;width:90%">' + content + '</div>';
    bg.onclick = function(e) { if (e.target === bg) closeModal(); };
    document.body.appendChild(bg);
}

function closeModal() {
    var m = document.getElementById("tprm-modal");
    if (m) m.remove();
}
window.closeModal = closeModal;


// ═══════════════════════════════════════════════════════════════
// SETTINGS (placeholder — uses shared ai_common.js pattern)
// ═══════════════════════════════════════════════════════════════

// openSettings is provided by ai_common.js (loaded after this file)

function _isDoraEnabled() {
    return localStorage.getItem("tprm_dora_enabled") !== "false";
}

function _getDoraThresholds() {
    return {
        maxCriteria: parseInt(localStorage.getItem("tprm_dora_max_criteria")!) || 3,
        avgScore: parseFloat(localStorage.getItem("tprm_dora_avg_score")!) || 3.5
    };
}

function _doraSettingsHTML() {
    var th = _getDoraThresholds();
    var doraOn = _isDoraEnabled();
    return '<div class="settings-section" style="margin-top:var(--ct-s4);border-top:1px solid var(--ct-line);padding-top:16px">' +
        '<div class="settings-label">' + t("settings.dora_section") + '</div>' +
        '<div class="ct-flex ct-items-center ct-gap-2 ct-mb-2">' +
            '<label class="settings-toggle"><input type="checkbox" id="settings-dora-toggle"' + (doraOn ? " checked" : "") + '><span class="settings-toggle-slider"></span></label>' +
            '<span class="fs-sm">' + t("settings.dora_enable") + '</span>' +
        '</div>' +
        '<div id="settings-dora-fields" style="' + (doraOn ? '' : 'display:none') + '">' +
            '<p class="fs-xs text-muted ct-mb-2">' + t("settings.dora_hint") + '</p>' +
            '<div class="ct-flex ct-gap-3">' +
                '<div class="ct-flex-1"><div class="settings-label fs-sm ct-mb-1">' + t("settings.dora_max_criteria") + '</div>' +
                '<input type="number" class="settings-input ct-w-full" id="settings-dora-criteria" value="' + th.maxCriteria + '" min="1" max="6" step="1"></div>' +
                '<div class="ct-flex-1"><div class="settings-label fs-sm ct-mb-1">' + t("settings.dora_avg_score") + '</div>' +
                '<input type="number" class="settings-input ct-w-full" id="settings-dora-avg" value="' + th.avgScore + '" min="0.5" max="4" step="0.5"></div>' +
            '</div>' +
        '</div>' +
    '</div>';
}

function _wireDoraSettings() {
    var toggle = document.getElementById("settings-dora-toggle");
    if (toggle) toggle.onchange = function() {
        document.getElementById("settings-dora-fields")!.style.display = (this as HTMLInputElement).checked ? "" : "none";
    };
}

function _saveDoraSettings() {
    var toggle = document.getElementById("settings-dora-toggle");
    if (toggle) localStorage.setItem("tprm_dora_enabled", (toggle as HTMLInputElement).checked ? "true" : "false");
    var c = document.getElementById("settings-dora-criteria");
    var a = document.getElementById("settings-dora-avg");
    if (c) localStorage.setItem("tprm_dora_max_criteria", (c as HTMLInputElement).value);
    if (a) localStorage.setItem("tprm_dora_avg_score", (a as HTMLInputElement).value);
}

// _autoSave, _loadAutoSave, newAnalysis provided by cisotoolbox.js

function _initDataAndRender(cb: any) {
    // FEAT-36 — normalize + replay schema migrations on EVERY load path
    // (file, snapshot, session, API): idempotent, refuses future revs.
    if (typeof ctSchemaMigrate === "function") {
        try { ctSchemaMigrate(D); } catch (e: any) { alert(e && e.message ? e.message : String(e)); }
    }
    _panel = "dashboard";
    _selectedVendor = null;
    renderAll();
    if (cb) cb();
}

// ═══════════════════════════════════════════════════════════════
// AI ASSISTANT — Auto-collect vendor information
// ═══════════════════════════════════════════════════════════════

window.AI_APP_CONFIG = {
    storagePrefix: "tprm",
    // Le bloc démo se compose ici comme dans Risk et Compliance. Vendor
    // enregistrait bien ses propres sections (DORA, questionnaire) mais
    // n'avait jamais ajouté celle-ci : le bouton de chargement des données
    // de test manquait donc au panneau réglages du seul module Vendor.
    settingsExtraHTML: function() { return _doraSettingsHTML() + _customQuestionnaireHTML()
        + (typeof _demoSettingsHTML === "function" ? _demoSettingsHTML() : ""); },
    onSettingsRendered: function() { _wireDoraSettings(); _wireCustomQuestionnaire();
        if (typeof _wireDemoSettings === "function") _wireDemoSettings(); },
    onSettingsSaved: function() { _saveDoraSettings(); renderAll(); }
};

// ── Custom questionnaire (admin only) ─────────────────────────

function _customQuestionnaireHTML() {
    // In backend mode: admin only. In opensource mode (no _currentUser): show to everyone
    if (window._currentUser && window._currentUser.role !== "admin") return "";
    if (typeof _isAdmin === "function" && !_isAdmin()) return "";
    var count = (D._custom_questionnaire || []).length;
    var h = '<div class="settings-section" style="margin-top:var(--ct-s4);border-top:1px solid var(--ct-line);padding-top:16px">';
    h += '<div class="settings-label">' + t("settings.custom_questionnaire") + '</div>';
    if (count > 0) {
        h += '<p class="fs-xs ct-text-low ct-mb-2">\u2713 ' + t("settings.custom_questionnaire_active", {count: count}) + '</p>';
        h += '<button class="ct-btn ai-btn-ignore ct-text-label ct-mb-2" id="settings-clear-questionnaire">' + t("settings.custom_questionnaire_clear") + '</button> ';
    }
    h += '<div class="ct-flex ct-gap-1 ct-items-center">';
    h += '<input type="file" id="settings-questionnaire-file" accept=".csv,.tsv,.txt" class="settings-input ct-flex-1 ct-font-inherit">';
    h += '</div>';
    h += '<p class="fs-xs text-muted ct-mt-1">' + t("settings.custom_questionnaire_hint") + '</p>';
    h += '<a href="#" class="ct-text-label ct-text-accent" data-click="downloadQuestionnaireTemplate">' + t("settings.custom_questionnaire_template") + '</a>';
    h += '</div>';
    return h;
}

function _wireCustomQuestionnaire() {
    var fileEl = document.getElementById("settings-questionnaire-file");
    if (fileEl) fileEl.onchange = function() {
        if (!(fileEl as HTMLInputElement).files![0]) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            _importCustomQuestionnaire(e.target!.result as string);
        };
        reader.readAsText((fileEl as HTMLInputElement).files![0]);
    };
    var clearBtn = document.getElementById("settings-clear-questionnaire");
    if (clearBtn) clearBtn.onclick = function() {
        D._custom_questionnaire = [];
        _autoSave();
        if (typeof openSettings === "function") openSettings();
        showStatus(t("settings.custom_questionnaire_cleared"));
    };
}

function _importCustomQuestionnaire(csvText: string) {
    var parsed = _parseCSV(csvText);
    var headers = parsed.headers;
    var rows = parsed.rows;
    if (!headers.length || !rows.length) { showStatus(t("settings.custom_questionnaire_error")); return; }

    var idIdx = headers.indexOf("id");
    var domainIdx = headers.indexOf("domain");
    if (domainIdx < 0) domainIdx = headers.indexOf("domaine");
    var textIdx = headers.indexOf("question");
    if (textIdx < 0) textIdx = headers.indexOf("text");
    var expectedIdx = headers.indexOf("expected");
    if (expectedIdx < 0) expectedIdx = headers.indexOf("attendu");
    var redIdx = headers.indexOf("red_flags");
    if (redIdx < 0) redIdx = headers.indexOf("alertes");
    var evidenceIdx = headers.indexOf("evidence");
    if (evidenceIdx < 0) evidenceIdx = headers.indexOf("preuves");
    var weightIdx = headers.indexOf("weight");
    if (weightIdx < 0) weightIdx = headers.indexOf("poids");

    if (textIdx < 0) { showStatus(t("settings.custom_questionnaire_error_col")); return; }

    var questions = [];
    for (var j = 0; j < rows.length; j++) {
        var i = j + 1;
        var cols = rows[j];
        if (cols.length <= textIdx || !cols[textIdx]) continue;
        questions.push({
            id: idIdx >= 0 && cols[idIdx] ? cols[idIdx] : "CQ" + String(i).padStart(2, "0"),
            domain: domainIdx >= 0 ? cols[domainIdx] : "custom",
            text_fr: cols[textIdx],
            text_en: cols[textIdx],
            expected_fr: expectedIdx >= 0 ? (cols[expectedIdx] || "") : "",
            expected_en: expectedIdx >= 0 ? (cols[expectedIdx] || "") : "",
            red_flags_fr: redIdx >= 0 ? (cols[redIdx] || "") : "",
            red_flags_en: redIdx >= 0 ? (cols[redIdx] || "") : "",
            evidence_fr: evidenceIdx >= 0 ? (cols[evidenceIdx] || "") : "",
            evidence_en: evidenceIdx >= 0 ? (cols[evidenceIdx] || "") : "",
            weight: weightIdx >= 0 ? (parseInt(cols[weightIdx]) || 10) : 10
        });
    }

    if (questions.length === 0) { showStatus(t("settings.custom_questionnaire_error")); return; }

    D._custom_questionnaire = questions;
    _autoSave(); // _autoSave hook handles the undo-stack push
    if (typeof openSettings === "function") openSettings();
    showStatus(t("settings.custom_questionnaire_imported", {count: questions.length}));
}

function downloadQuestionnaireTemplate() {
    var header = "id;domain;question;expected;red_flags;evidence;weight";
    var ex1 = "CQ01;governance;Politique de securite (PSSI);PSSI formalisee et approuvee;Pas de PSSI;PSSI signee;15";
    var ex2 = "CQ02;access;Gestion des acces et SSO;SSO SAML/OIDC deploye;Comptes partages;Configuration SSO;10";
    _downloadCSV("questionnaire_template.csv", header, [ex1, ex2]);
}
window.downloadQuestionnaireTemplate = downloadQuestionnaireTemplate;

function aiCollectInfo() {
    if (!_selectedVendor && _selectedVendor !== 0) return;
    var v = D.vendors[_selectedVendor!];
    if (!v) return;

    if (typeof _aiIsEnabled !== "function" || !_aiIsEnabled()) {
        _showModal('<h3>' + t("ai.not_configured") + '</h3><div class="ct-mt-3"><button class="ct-btn" data-variant="primary" data-click="closeModal">' + t("common.close") + '</button></div>');
        return;
    }

    if (!v.name || !v.name.trim()) {
        alert(t("vendor.name") + " required");
        return;
    }

    // Show loading state
    _showModal('<div class="ct-ta-c ct-p-8"><div class="ct-text-page ct-mb-2">&#10024;</div><div class="ct-strong">' + t("ai.collecting") + '...</div><div class="ct-text-meta ct-muted ct-mt-1">' + esc(v.name) + '</div></div>');

    var lang = typeof _locale !== "undefined" ? _locale : "fr";

    // Métier endpoint: the TPRM collection methodology prompt is built
    // server-side (POST /api/ai/vendor/collect-info).
    _aiPost("vendor/collect-info", {
        language: lang === "en" ? "en" : "fr",
        vendor_name: v.name || "",
        vendor_website: v.website || "",
        vendor_sector: v.sector || "",
        vendor_services: (v.contract && v.contract.services) || ""
    }).then(function(jr: any) {
        closeModal();
        var data = jr.result;
        if (!data) {
            showStatus(t("ai.error"));
            _showModal('<h3 class="ct-text-critical">' + t("ai.error") + '</h3><p class="ct-text-meta">La requete IA n\'a pas retourne de reponse.</p><div class="ct-mt-3"><button class="ct-btn" data-variant="primary" data-click="closeModal">' + t("common.close") + '</button></div>');
            return;
        }
        _applyAiData(v, data);
        _autoSave();
        renderPanel();
        // If AI didn't find the website, ask the user and re-run
        if (!v.website && (!data.website || data.website === "null")) {
            var userWebsite = prompt(t("vendor.ai_no_website"));
            if (userWebsite && userWebsite.trim()) {
                v.website = userWebsite.trim();
                _autoSave();
                renderPanel();
                setTimeout(function() { aiCollectInfo(); }, 200);
                return;
            }
        }
        showStatus(t("ai.collected"));
    }).catch(function(err: any) {
        closeModal();
        showStatus(t("ai.error"));
        _showModal('<h3 class="ct-text-critical">' + t("ai.error") + '</h3><p class="ct-text-meta">' + esc(String(err && err.message || err)) + '</p><div class="ct-mt-3"><button class="ct-btn" data-variant="primary" data-click="closeModal">' + t("common.close") + '</button></div>');
    });
}
window.aiCollectInfo = aiCollectInfo;

function aiCollectDocs() {
    if (!_selectedVendor && _selectedVendor !== 0) return;
    var v = D.vendors[_selectedVendor!];
    if (!v || !v.name || !v.name.trim()) return;

    if (typeof _aiIsEnabled !== "function" || !_aiIsEnabled()) {
        _showModal('<h3>' + t("ai.not_configured") + '</h3><div class="ct-mt-3"><button class="ct-btn" data-variant="primary" data-click="closeModal">' + t("common.close") + '</button></div>');
        return;
    }

    var existingUrls = D.documents.filter(function(d) { return d.vendor_id === v.id; }).map(function(d) { return d.url; }).filter(Boolean);
    var vendorId = v.id;

    _showModal('<div class="ct-ta-c ct-p-8"><div class="ct-text-page ct-mb-2">&#128269;</div><div class="ct-strong">' + t("ai.collecting_docs") + '</div><div class="ct-text-meta ct-muted ct-mt-1">' + esc(v.name) + '</div><div id="doc-collect-status" class="ct-text-label ct-muted ct-mt-3"></div></div>');

    var statusEl = function() { return document.getElementById("doc-collect-status"); };
    var totalAdded = 0;

    // Phase 1: Probe common URL patterns on vendor website (fast, server-side)
    var probePromise;
    if (v.website && typeof VendorAPI !== "undefined" && VendorAPI.probeVendorUrls) {
        if (statusEl()) statusEl()!.textContent = t("ai.docs_phase_probe");
        probePromise = VendorAPI.probeVendorUrls(v.website).then(function(results: any) {
            results.forEach(function(r: any) {
                if (existingUrls.indexOf(r.url) >= 0) return;
                existingUrls.push(r.url);
                _verifyAndAddDoc(vendorId, { url: r.url, name: r.name, type: r.type });
                totalAdded++;
            });
        }).catch(function() {});
    } else {
        probePromise = Promise.resolve();
    }

    // Phase 2: Métier endpoint — the documentation-research methodology
    // prompt (taxonomy + rules) is built server-side
    // (POST /api/ai/vendor/collect-docs).
    probePromise.then(function() {
        if (statusEl()) statusEl()!.textContent = t("ai.docs_phase_ai");
        var lang = typeof _locale !== "undefined" ? _locale : "fr";
        return _aiPost("vendor/collect-docs", {
            language: lang === "en" ? "en" : "fr",
            vendor_name: v.name || "",
            vendor_website: v.website || "",
            vendor_sector: v.sector || "",
            existing_urls: existingUrls
        });
    }).then(function(jr: any) {
        var docs = jr && jr.result;
        if (!Array.isArray(docs)) docs = [];
        docs.forEach(function(doc: any) {
            if (!doc.url || !doc.name) return;
            if (existingUrls.indexOf(doc.url) >= 0) return;
            existingUrls.push(doc.url);
            _verifyAndAddDoc(vendorId, doc);
            totalAdded++;
        });
        closeModal();
        _autoSave();
        renderPanel();
        showStatus(totalAdded + " " + t("ai.docs_found"));
    }).catch(function(err: any) {
        closeModal();
        showStatus(t("ai.error"));
        _showModal('<h3 class="ct-text-critical">' + t("ai.error") + '</h3><p class="ct-text-meta">' + esc(String(err && err.message || err)) + '</p><div class="ct-mt-3"><button class="ct-btn" data-variant="primary" data-click="closeModal">' + t("common.close") + '</button></div>');
    });
}
window.aiCollectDocs = aiCollectDocs;

function _applyAiData(v: any, data: any) {
    // logo_url from AI is unreliable — we use favicon from website instead
    if (data.legal_entity && !v.legal_entity) v.legal_entity = data.legal_entity;
    if (data.country && !v.country) v.country = data.country;
    if (data.sector && !v.sector) v.sector = data.sector;
    if (data.website && !v.website) v.website = data.website;
    if (data.services && (!v.contract || !v.contract.services)) {
        if (!v.contract) v.contract = {};
        v.contract.services = data.services;
    }
    if (data.certifications && data.certifications.length) {
        if (!v.certifications) v.certifications = [];
        data.certifications.forEach(function(c: any) {
            if (!v.certifications.find(function(x: any) { return x.name === c; })) {
                v.certifications.push({ name: c, expiry_date: "" });
            }
        });
    }
    if (data.dpa_available != null) v.dpa_signed = data.dpa_available;
    if (data.sub_contractors && data.sub_contractors.length) {
        v.sub_contractors = data.sub_contractors;
    }
    if (data.notes) v.notes = (v.notes ? v.notes + "\n\n" : "") + "IA: " + data.notes;
    if (data.known_incidents) v.notes = (v.notes ? v.notes + "\n\n" : "") + "Incidents connus: " + data.known_incidents;
    if (data.data_location) v.notes = (v.notes ? v.notes + "\n\n" : "") + "Localisation des donnees: " + data.data_location;

    // Persist the AI-applied vendor fields through the granular adapter
    // right away. Relying only on the blob _autoSave fallback loses the
    // data when nothing else is touched afterwards (see CLAUDE.md
    // persistence-adapter contract — every D mutation must call _persist).
    // The child entities below persist themselves via _persistCreate, same
    // as _verifyAndAddDoc does for documents.
    if (typeof _persist === "function") {
        _persist("vendor", v.id, {
            legal_entity: v.legal_entity, country: v.country, sector: v.sector,
            website: v.website, contract: v.contract, certifications: v.certifications,
            dpa_signed: v.dpa_signed, sub_contractors: v.sub_contractors, notes: v.notes
        });
    }

    // Public documentation links → verify each URL then add to documents
    if (data.public_docs && data.public_docs.length) {
        data.public_docs.forEach(function(doc: any) {
            if (!doc.url || !doc.name) return;
            var exists = D.documents.find(function(d) { return d.url === doc.url && d.vendor_id === v.id; });
            if (exists) return;
            // Verify URL exists with a HEAD request
            _verifyAndAddDoc(v.id, doc);
        });
    }

    // Pre-fill a V2 (template-driven) assessment from the AI security review.
    // BUG-17: onboarding via the AI assistant must produce the SAME V2 format
    // as a manual questionnaire (template_snapshot + coverage), never the
    // legacy V1 shape (answer/Q01..Q10, no snapshot). The AI returns a coarse
    // per-domain verdict (compliant/partial/non_compliant/unknown) which we map
    // to coverage and apply to the template section(s) matching the domain.
    if (data.security_assessment) {
        if (typeof _ensureDefaultTemplate === "function") _ensureDefaultTemplate();
        var _tpl: any = (D.questionnaire_templates || []).find(function(tp) { return tp.id === "TPL-001"; })
            || (D.questionnaire_templates || [])[0];
        if (_tpl) {
            // Reuse an existing non-validated V2 assessment, else create one.
            // Legacy V1 assessments (no template_snapshot) are never touched.
            var assessment: any = D.assessments.find(function(a) {
                return a.vendor_id === v.id && a.status !== "validated" && (a as any).template_snapshot;
            });
            var _assessmentIsNew = false;
            if (!assessment) {
                var assessId = _nextAssessmentId();
                assessment = {
                    id: assessId, vendor_id: v.id, type: "onboarding", date: _today(), due_date: "",
                    template_id: _tpl.id, template_version: _tpl.version || 1,
                    template_snapshot: JSON.parse(JSON.stringify(_tpl)), status: "in_progress",
                    responses: _allQuestions(_tpl).map(function(q: any) {
                        return { question_id: q.id, coverage: null, answer: q.type === "multi_choice" ? [] : null, comment: "", action_plans: [], justification: "" };
                    }),
                    self_validation: false, self_validated_at: null, score: null, completion_rate: 0
                };
                D.assessments.push(assessment);
                _assessmentIsNew = true;
                if (typeof _persistCreate === "function") _persistCreate("assessment", assessment as unknown as VendorApiPayload);
            }
            var _cov: Record<string, string> = { compliant: "covered", partial: "partial", non_compliant: "not_covered" };
            var _domainKw: Record<string, string[]> = {
                governance: ["gouvernance", "governance"],
                access_management: ["acces", "access"], privileged_access: ["acces", "access"],
                vulnerability_mgmt: ["poste", "endpoint", "vuln"],
                dev_security: ["developp", "secure dev", "development"],
                data_protection: ["donnee", "data"], endpoint_protection: ["poste", "endpoint"],
                continuity: ["continuit", "continuity"], supply_chain: ["approvisionnement", "supply"],
                audit: ["audit", "conformit", "compliance"]
            };
            (assessment.template_snapshot.sections || []).forEach(function(section: any) {
                var title = String(section.title || "").toLowerCase();
                for (var domain in data.security_assessment) {
                    var cov = _cov[data.security_assessment[domain]];
                    if (!cov) continue; // unknown / unmapped → leave null
                    var kws = _domainKw[domain] || [domain];
                    if (!kws.some(function(k) { return title.indexOf(k) >= 0; })) continue;
                    (section.questions || []).forEach(function(q: any) {
                        var resp: any = assessment.responses.find(function(r: any) { return r.question_id === q.id; });
                        if (!resp) { resp = { question_id: q.id, coverage: null, answer: null, comment: "", action_plans: [], justification: "" }; assessment.responses.push(resp); }
                        if (resp.coverage) return; // never overwrite an existing verdict
                        resp.coverage = cov;
                        resp.comment = "IA: auto-evaluation";
                        if (cov === "partial" || cov === "not_covered") resp.justification = "IA: ecart auto-detecte, a confirmer.";
                    });
                    break; // one matching domain per section
                }
            });
            if (typeof _touchAssessment === "function") _touchAssessment(assessment);
            else if (typeof _persist === "function") _persist("assessment", assessment.id, { responses: assessment.responses });
        }
    }

    // Create risks from AI suggestions
    if (data.risks && data.risks.length) {
        data.risks.forEach(function(r: any) {
            var newRisk = {
                id: _nextVendorRiskId(v),
                vendor_id: v.id, title: r.title, description: r.description || "",
                category: r.category || "CYBER",
                impact: r.impact || 3, likelihood: r.likelihood || 3,
                treatment: { response: "mitigate", details: "", due_date: "" },
                residual_impact: 0, residual_likelihood: 0,
                status: "needs_treatment"
            };
            D.risks.push(newRisk);
            if (typeof _persistCreate === "function") _persistCreate("risk", newRisk);
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// HELP
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

// Install the shared undo hook: every _autoSave() pushes the previous
// state onto _undoStack so undo/redo work without manual _saveState()
// calls. Provided by shared/js/cisotoolbox_local.js.
if (typeof _installUndoHook === "function") _installUndoHook();

function renderAll() {
    var tr = document.getElementById("toolbar-right");
    if (tr) {
        // Preserve auth buttons (injected by _initAuth), only inject settings button once
        var existing = tr.querySelector(".toolbar-settings");
        if (!existing) {
            var settingsHtml = _getSettingsButtonHTML();
            if (settingsHtml) tr.insertAdjacentHTML("afterbegin", '<span class="toolbar-settings">' + settingsHtml + '</span>');
        }
    }
    _applyStaticTranslations();
    renderPanel();
    if (typeof _updateUndoButtons === "function") _updateUndoButtons();
}

// Init: if catalog is present, defer to _appInitCallback; otherwise render directly
window.selectPanel = selectPanel;
if (typeof window._appInitCallback === "function") {
    window._appInitCallback();
} else {
    renderAll();
    _checkAutoSaveBanner();
}
