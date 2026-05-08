// ──────────────────────────────────────────────────────────────────
// TPRM DORA RoI — client-side soft validation utilities
// ──────────────────────────────────────────────────────────────────
//
// Mirrors the rules enforced by the backend in
// backend-clients/demo-docker/vendor/src/dora_validation.py for the
// opensource (browser-local) variant where there is no server. The
// validators are non-blocking: callers decide how to surface the
// result (red border, tooltip, export cell flag, etc.).
//
// Exposed as window._doraValid.{...} to keep the global namespace
// tidy and let the export module (Phase 6) iterate over the rules.

(function() {
    "use strict";

    var ISO4217_RE = /^[A-Z]{3}$/;
    var ISO3166_RE = /^[A-Z]{2}$/;
    var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    var REPORTING_PERIOD_RE = /^\d{4}-12-31$/;
    var LEI_RE = /^[A-Z0-9]{18}[0-9]{2}$/;

    // ISO 17442 mod-97-10 checksum: convert each letter A..Z to 10..35,
    // then take the 20-digit string modulo 97. Valid LEIs satisfy ≡ 1.
    function leiChecksumOk(lei) {
        var expanded = "";
        for (var i = 0; i < lei.length; i++) {
            var c = lei.charCodeAt(i);
            if (c >= 48 && c <= 57) expanded += lei.charAt(i);
            else if (c >= 65 && c <= 90) expanded += String(c - 55);
            else return false;
        }
        // Compute mod 97 in chunks (JS Number safe up to 2^53).
        var rem = 0;
        for (var j = 0; j < expanded.length; j += 7) {
            rem = parseInt(String(rem) + expanded.substr(j, 7), 10) % 97;
        }
        return rem === 1;
    }

    function leiValid(s) {
        if (!s || typeof s !== "string") return false;
        var v = s.toUpperCase();
        return LEI_RE.test(v) && leiChecksumOk(v);
    }

    function countryValid(s) {
        return !!(s && typeof s === "string" && ISO3166_RE.test(s.toUpperCase()));
    }

    function currencyValid(s) {
        return !!(s && typeof s === "string" && ISO4217_RE.test(s.toUpperCase()));
    }

    function dateValid(s) {
        if (!s || typeof s !== "string" || !DATE_RE.test(s)) return false;
        var d = new Date(s + "T00:00:00Z");
        return !isNaN(d.getTime()) && s === d.toISOString().slice(0, 10);
    }

    function reportingPeriodValid(s) {
        return !!(s && typeof s === "string" && REPORTING_PERIOD_RE.test(s) && dateValid(s));
    }

    function nonNegative(v) {
        if (v === null || v === undefined || v === "") return true; // empty is OK; "required" is a separate check
        var n = (typeof v === "number") ? v : parseFloat(v);
        return !isNaN(n) && n >= 0;
    }

    // EBA codelist membership. Each codelist entry is an object with
    // either an `eba_code` (preferred) or `code` field plus a `label_*`
    // map. Match is case-insensitive on both candidate keys.
    function ebaCodeValid(value, codelistKey) {
        if (!value || typeof value !== "string") return false;
        var lists = window._doraCodelists;
        if (!lists || !lists[codelistKey]) return false;
        var v = value.toUpperCase().trim();
        var arr = lists[codelistKey];
        for (var i = 0; i < arr.length; i++) {
            var entry = arr[i];
            if (!entry) continue;
            if (entry.eba_code && String(entry.eba_code).toUpperCase() === v) return true;
            if (entry.code && String(entry.code).toUpperCase() === v) return true;
        }
        return false;
    }

    window._doraValid = {
        lei: leiValid,
        leiChecksum: leiChecksumOk,
        country: countryValid,
        currency: currencyValid,
        date: dateValid,
        reportingPeriod: reportingPeriodValid,
        nonNegative: nonNegative,
        ebaCode: ebaCodeValid
    };
})();
