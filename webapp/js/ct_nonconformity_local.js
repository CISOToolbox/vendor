// -----------------------------------------------------------------------------
// Generated file - do not edit.
// It is overwritten at every release; a change made here is lost.
// See CONTRIBUTING.md.
// -----------------------------------------------------------------------------
// ct_nonconformity_local — the register's rules, without a server (FEAT-45).
//
// A webapp has no backend: the records live in the blob next to the rest of
// the analysis, and the person in front of the screen is at once declarant,
// qualifier and approver ("local approval"). The rules below are the twin of
// the server-side register — same states, same validation, same exclusivity —
// written once here so every webapp shares one behaviour. A divergence
// between the two is a bug in one of them.
//
// The module supplies where the records live, who acts, and its own items and
// measures; everything else is the same as in the suite.
(function () {
    "use strict";
    var NC_SOURCES = ["observation", "report", "informal_review", "incident"];
    var NC_SEVERITIES = ["low", "medium", "high", "critical"];
    // Same transitions as the server: a state the module cannot leave is a
    // state the UI must not offer.
    var NC_TRANSITIONS = {
        to_qualify: ["open", "rejected", "derogated"],
        open: ["in_remediation", "derogated", "closed"],
        in_remediation: ["open", "derogated", "closed"],
        derogated: ["open", "in_remediation", "closed"],
        closed: [], rejected: [],
    };
    function _today() { return new Date().toISOString().slice(0, 10); }
    function _now() { return new Date().toISOString(); }
    function _fail(msg) { throw new Error(msg); }
    // What leaves the adapter is a copy: the register reads it, and the blob's
    // own objects are only ever written through the operations below.
    function _copy(row) { return Object.assign({}, row); }
    function _daysLeft(d) {
        if (d.status !== "approved" || !d.valid_until)
            return null;
        return _days(_today(), d.valid_until);
    }
    function _uid() {
        var c = window.crypto;
        if (c && typeof c.randomUUID === "function")
            return c.randomUUID();
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {
            var r = Math.random() * 16 | 0;
            return (ch === "x" ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }
    function _reference(prefix, taken) {
        var year = new Date().getFullYear();
        var head = prefix + "-" + year + "-";
        var n = 0;
        taken.forEach(function (ref) {
            if ((ref || "").indexOf(head) !== 0)
                return;
            var i = parseInt(ref.substring(head.length), 10);
            if (i > n)
                n = i;
        });
        return head + String(n + 1).padStart(3, "0");
    }
    function _days(from, to) {
        return Math.round((new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime()) / 86400000);
    }
    function _liveOn(spec, subjectType, subjectId) {
        return spec.derogations().filter(function (d) {
            return d.subject_type === subjectType && d.subject_id === subjectId
                && (d.status === "pending_approval" || d.status === "approved");
        })[0] || null;
    }
    // A decision on the record settles what covered it: the same rule as the
    // server's `revoke_for_subject`.
    function _settle(spec, subjectType, subjectId, reason) {
        spec.derogations().forEach(function (d) {
            if (d.subject_type !== subjectType || d.subject_id !== subjectId)
                return;
            if (d.status === "approved") {
                d.status = "revoked";
                d.revoked_reason = reason;
                d.decided_at = _now();
                if (spec.releaseSubject)
                    spec.releaseSubject(d, "revoked");
            }
            else if (d.status === "pending_approval") {
                d.status = "rejected";
                d.decision_note = reason;
                d.decided_at = _now();
            }
        });
    }
    function _nc(spec, id) {
        var nc = spec.records().filter(function (r) { return r.id === id; })[0];
        return nc || _fail(t("nc.err_not_found"));
    }
    function _der(spec, id) {
        var d = spec.derogations().filter(function (r) { return r.id === id; })[0];
        return d || _fail(t("nc.err_not_found"));
    }
    function _check(spec, nc, to) {
        if ((NC_TRANSITIONS[nc.status] || []).indexOf(to) < 0) {
            _fail(t("nc.err_transition", { from: t("nc.status." + nc.status), to: t("nc.status." + to) }));
        }
    }
    function _itemLabel(spec, id) {
        var o = (spec.items ? spec.items.options() : []).filter(function (x) { return x.id === id; })[0];
        return o ? o.label : "";
    }
    // Past its end of validity, a derogation expires and the item it covered
    // comes back: the webapp does at load what the scheduler does in the suite.
    function expire(spec) {
        var today = _today(), n = 0;
        spec.derogations().forEach(function (d) {
            if (d.status !== "approved" || !d.valid_until || d.valid_until >= today)
                return;
            d.status = "expired";
            n++;
            if (d.subject_type === "nonconformity") {
                var nc = spec.records().filter(function (r) { return r.id === d.subject_id; })[0];
                if (nc && nc.status === "derogated") {
                    nc.status = "open";
                    nc.derogation_id = null;
                }
            }
            else if (spec.releaseSubject) {
                spec.releaseSubject(d, "expired");
            }
        });
        if (n)
            spec.save("derogation");
        return n;
    }
    function options(spec) {
        var kind = spec.subjectType;
        function subjectLabel(subjectType, subjectId) {
            if (subjectType === "none")
                return "";
            if (subjectType === "nonconformity") {
                var nc = _nc(spec, subjectId);
                if (["to_qualify", "open", "in_remediation"].indexOf(nc.status) < 0) {
                    _fail(t("nc.err_subject_state", { status: t("nc.status." + nc.status) }));
                }
                return nc.reference + " — " + nc.title;
            }
            var label = _itemLabel(spec, subjectId);
            return label || _fail(t("nc.err_not_found"));
        }
        return {
            listNc: function (status) {
                var rows = spec.records().filter(function (r) { return !status || r.status === status; });
                return Promise.resolve({ items: rows.slice().reverse().map(_copy) });
            },
            listDer: function (filters) {
                var f = filters || {};
                var rows = spec.derogations().filter(function (d) {
                    return (!f.status || d.status === f.status)
                        && (!f.subject_type || d.subject_type === f.subject_type)
                        && (!f.subject_id || d.subject_id === f.subject_id);
                });
                // `days_left` is what the register shows next to an approved
                // derogation; the server computes it, so does this.
                return Promise.resolve({ items: rows.slice().reverse().map(function (d) {
                        var out = _copy(d);
                        out.days_left = _daysLeft(d);
                        return out;
                    }) });
            },
            createNc: function (body) {
                var title = String(body.title || "").trim();
                if (title.length < 3)
                    _fail(t("nc.err_title"));
                if ((body.observed_at || "") > _today())
                    _fail(t("nc.err_observed_future"));
                var subjects = [];
                (body.subjects || []).forEach(function (sub) {
                    if (!sub || !sub.id || subjects.some(function (x) { return x.id === sub.id; }))
                        return;
                    subjectLabel(sub.type || kind, sub.id); // throws when unknown
                    subjects.push({ type: sub.type || kind, id: sub.id });
                });
                var nc = {
                    id: _uid(), reference: _reference("NC", spec.records().map(function (r) { return r.reference; })),
                    source: body.source || "observation", severity: body.severity || "medium",
                    observed_at: body.observed_at || _today(), observed_by: body.observed_by || spec.actor(),
                    declared_by: spec.actor(), title: title, description: body.description || "",
                    evidence: body.evidence || [], domain: body.domain || "", requirement_ref: body.requirement_ref || "",
                    subjects: subjects, subject_type: subjects.length ? subjects[0].type : "",
                    subject_id: subjects.length ? subjects[0].id : "",
                    measure_ids: [], status: "to_qualify", created_at: _now(), updated_at: _now(),
                };
                spec.records().push(nc);
                spec.save("nonconformity");
                return Promise.resolve(_copy(nc));
            },
            patchNc: function (id, body) {
                var nc = _nc(spec, id);
                if (nc.status === "closed" || nc.status === "rejected")
                    _fail(t("nc.err_frozen", { status: t("nc.status." + nc.status) }));
                if (body.title !== undefined) {
                    if (String(body.title).trim().length < 3)
                        _fail(t("nc.err_title"));
                    nc.title = String(body.title).trim();
                }
                ["description", "domain", "requirement_ref", "observed_by", "source", "severity"].forEach(function (f) {
                    if (body[f] !== undefined)
                        nc[f] = body[f];
                });
                if (body.observed_at !== undefined && body.observed_at) {
                    if (body.observed_at > _today())
                        _fail(t("nc.err_observed_future"));
                    nc.observed_at = body.observed_at;
                }
                if (body.evidence !== undefined)
                    nc.evidence = body.evidence;
                if (body.subjects !== undefined) {
                    var key = function (subs) { return subs.map(function (x) { return x.type + ":" + x.id; }).join(","); };
                    var wanted = [];
                    (body.subjects || []).forEach(function (sub) {
                        if (!sub || !sub.id || wanted.some(function (x) { return x.id === sub.id; }))
                            return;
                        wanted.push({ type: sub.type || kind, id: sub.id });
                    });
                    if (key(wanted) !== key(nc.subjects || [])) {
                        // Granted on those items, a derogation freezes them.
                        if (nc.derogation_id || _liveOn(spec, "nonconformity", nc.id))
                            _fail(t("nc.err_subject_frozen"));
                        wanted.forEach(function (sub) { subjectLabel(sub.type, sub.id); });
                        nc.subjects = wanted;
                        nc.subject_type = wanted.length ? wanted[0].type : "";
                        nc.subject_id = wanted.length ? wanted[0].id : "";
                    }
                }
                if (body.measure_ids !== undefined) {
                    var ids = [];
                    (body.measure_ids || []).forEach(function (m) { if (m && ids.indexOf(m) < 0)
                        ids.push(m); });
                    var known = (spec.measures ? spec.measures.options() : []).map(function (o) { return o.id; });
                    var missing = ids.filter(function (m) { return known.indexOf(m) < 0; });
                    if (missing.length)
                        _fail(t("nc.err_unknown_measures", { ids: missing.join(", ") }));
                    if (nc.status === "in_remediation" && !ids.length)
                        _fail(t("nc.err_measures_required"));
                    nc.measure_ids = ids;
                    if (ids.length && nc.status === "open")
                        nc.status = "in_remediation";
                }
                nc.updated_at = _now();
                spec.save("nonconformity");
                return Promise.resolve(_copy(nc));
            },
            qualifyNc: function (id, body) {
                var nc = _nc(spec, id);
                _check(spec, nc, "open");
                if (body.severity)
                    nc.severity = body.severity;
                if (body.domain !== undefined)
                    nc.domain = body.domain;
                nc.status = "open";
                nc.qualified_by = spec.actor();
                nc.qualified_at = _now();
                nc.updated_at = _now();
                spec.save("nonconformity");
                return Promise.resolve(_copy(nc));
            },
            rejectNc: function (id, note) {
                var nc = _nc(spec, id);
                _check(spec, nc, "rejected");
                if (String(note || "").trim().length < 3)
                    _fail(t("nc.err_note"));
                nc.status = "rejected";
                nc.rejection_note = note;
                nc.qualified_by = spec.actor();
                nc.qualified_at = _now();
                nc.updated_at = _now();
                _settle(spec, "nonconformity", nc.id, "non-conformity rejected");
                spec.save("nonconformity");
                return Promise.resolve(_copy(nc));
            },
            closeNc: function (id, evidence) {
                var nc = _nc(spec, id);
                _check(spec, nc, "closed");
                if (String(evidence || "").trim().length < 3)
                    _fail(t("nc.err_note"));
                var states = spec.measures ? spec.measures.options() : [];
                var pending = (nc.measure_ids || []).filter(function (m) {
                    var o = states.filter(function (x) { return x.id === m; })[0];
                    return o ? !o.done : false;
                });
                if (pending.length)
                    _fail(t("nc.close_blocked", { n: pending.length }));
                nc.status = "closed";
                nc.closure_evidence = evidence;
                nc.closed_at = _now();
                nc.updated_at = _now();
                _settle(spec, "nonconformity", nc.id, "non-conformity closed");
                spec.save("nonconformity");
                return Promise.resolve(_copy(nc));
            },
            createDer: function (body) {
                var subjectType = body.subject_type || "none";
                var subjectId = subjectType === "none" ? "" : String(body.subject_id || "");
                if (subjectType !== "none" && !subjectId)
                    _fail(t("der.err_subject"));
                var need = function (key, v, min) {
                    if (String(v || "").trim().length < min)
                        _fail(t("nc.err_required", { f: t(key) }));
                };
                need("der.f.title", body.title, 3);
                need("der.f.justification", body.justification, 3);
                need("der.f.risk_owner", body.risk_owner, 1);
                need("der.f.approver", body.approver, 1);
                var from = body.valid_from || _today();
                var until = body.valid_until || "";
                need("der.f.valid_until", until, 1);
                if (until <= from)
                    _fail(t("der.err_until_order"));
                if (_days(from, until) > spec.maxDays())
                    _fail(t("der.err_too_long", { n: spec.maxDays() }));
                var live = subjectType === "none" ? null : _liveOn(spec, subjectType, subjectId);
                if (live)
                    _fail(t("der.already", { ref: live.reference, status: t("der.status." + live.status) }));
                var label = subjectType === "none" ? "" : subjectLabel(subjectType, subjectId);
                var d = {
                    id: _uid(), reference: _reference("DER", spec.derogations().map(function (r) { return r.reference; })),
                    subject_type: subjectType, subject_id: subjectId, subject_label: label,
                    title: String(body.title).trim(), justification: String(body.justification).trim(),
                    risk_owner: body.risk_owner, approver: body.approver,
                    valid_from: from, valid_until: until, review_at: body.review_at || null,
                    status: "pending_approval", requested_by: spec.actor(), requested_at: _now(),
                    renews_id: body.renews_id || null, created_at: _now(),
                };
                spec.derogations().push(d);
                spec.save("derogation");
                return Promise.resolve(_copy(d));
            },
            decideDer: function (id, approve, note) {
                var d = _der(spec, id);
                if (d.status !== "pending_approval")
                    _fail(t("der.err_decided", { status: t("der.status." + d.status) }));
                if (!approve && String(note || "").trim().length < 3)
                    _fail(t("nc.err_note"));
                d.status = approve ? "approved" : "rejected";
                d.decided_by = spec.actor();
                d.decided_at = _now();
                d.decision_note = note || "";
                if (approve) {
                    if (d.subject_type === "nonconformity") {
                        var nc = _nc(spec, d.subject_id);
                        _check(spec, nc, "derogated");
                        // Approving the derogation accepts the record: it is qualified by the same act.
                        if (nc.status === "to_qualify") {
                            nc.qualified_by = spec.actor();
                            nc.qualified_at = _now();
                        }
                        nc.status = "derogated";
                        nc.derogation_id = d.id;
                        nc.updated_at = _now();
                    }
                    else if (d.subject_type !== "none") {
                        if (!_itemLabel(spec, d.subject_id))
                            _fail(t("der.err_subject_gone"));
                        if (spec.applySubject)
                            spec.applySubject(d);
                    }
                }
                spec.save("derogation");
                return Promise.resolve(_copy(d));
            },
            revokeDer: function (id, reason) {
                var d = _der(spec, id);
                if (d.status !== "approved")
                    _fail(t("der.err_not_approved"));
                if (String(reason || "").trim().length < 3)
                    _fail(t("nc.err_note"));
                d.status = "revoked";
                d.revoked_reason = reason;
                d.decided_by = spec.actor();
                d.decided_at = _now();
                if (d.subject_type === "nonconformity") {
                    var nc = spec.records().filter(function (r) { return r.id === d.subject_id; })[0];
                    if (nc && nc.status === "derogated") {
                        nc.status = "open";
                        nc.derogation_id = null;
                        nc.updated_at = _now();
                    }
                }
                else if (spec.releaseSubject) {
                    spec.releaseSubject(d, "revoked");
                }
                spec.save("derogation");
                return Promise.resolve(_copy(d));
            },
            getSettings: function () { return Promise.resolve({ max_derogation_days: spec.maxDays() }); },
            saveSettings: function (days) { spec.setMaxDays(days); spec.save("settings"); return Promise.resolve(null); },
            // No accounts here: whoever holds the file declares, qualifies and
            // approves. The record keeps who and when, which is what it is for.
            isAdmin: function () { return true; },
            canWrite: function () { return true; },
            actor: spec.actor,
            subjectTypes: [kind],
            items: spec.items,
            measures: spec.measures,
            // `onChange` is left to the module: every write is already
            // persisted by `save`, what remains is the module's own redraw.
        };
    }
    // The module's own treatment overtakes an acceptance — deleting the object
    // it covered, for instance. Published so every local app applies the rule
    // once, the way the server-backed modules share `revoke_for_subject`.
    function settle(spec, subjectId, reason) {
        var before = spec.derogations().filter(function (d) {
            return d.subject_type === spec.subjectType && d.subject_id === subjectId
                && (d.status === "approved" || d.status === "pending_approval");
        }).length;
        if (!before)
            return 0;
        _settle(spec, spec.subjectType, subjectId, reason);
        spec.save("derogation");
        return before;
    }
    window.ct_nonconformity_local = { options: options, expire: expire, settle: settle };
})();
_registerTranslations("fr", {
    "nc.err_not_found": "Introuvable.",
    "nc.err_transition": "Transition impossible : {from} → {to}.",
    "nc.err_frozen": "La non-conformité est {status}.",
    "nc.err_observed_future": "La date d'observation ne peut pas être dans le futur.",
    "nc.err_subject_frozen": "Une dérogation couvre la non-conformité : ses objets ne changent plus.",
    "nc.err_subject_state": "La non-conformité est {status}, pas ouverte.",
    "nc.err_unknown_measures": "Mesure(s) inconnue(s) : {ids}",
    "nc.err_required": "Champ obligatoire : {f}.",
    "nc.err_measures_required": "Une non-conformité en traitement garde au moins une mesure.",
    "der.err_too_long": "Durée supérieure au maximum de {n} jours.",
    "der.err_decided": "La demande est déjà {status}.",
    "der.err_not_approved": "Seule une dérogation approuvée se révoque.",
    "der.err_subject_gone": "L'objet n'est plus à traiter : rien à déroger.",
});
_registerTranslations("en", {
    "nc.err_not_found": "Not found.",
    "nc.err_transition": "Impossible transition: {from} → {to}.",
    "nc.err_frozen": "The non-conformity is {status}.",
    "nc.err_observed_future": "The observation date cannot be in the future.",
    "nc.err_subject_frozen": "A derogation covers the non-conformity: its items no longer change.",
    "nc.err_subject_state": "The non-conformity is {status}, not open.",
    "nc.err_unknown_measures": "Unknown measure(s): {ids}",
    "nc.err_required": "Required field: {f}.",
    "nc.err_measures_required": "A non-conformity under remediation keeps at least one measure.",
    "der.err_too_long": "Longer than the maximum of {n} days.",
    "der.err_decided": "The request is already {status}.",
    "der.err_not_approved": "Only an approved derogation can be revoked.",
    "der.err_subject_gone": "The item is no longer to be handled: nothing to derogate.",
});
