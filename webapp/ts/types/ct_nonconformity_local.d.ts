// -----------------------------------------------------------------------------
// Generated file - do not edit.
// It is overwritten at every release; a change made here is lost.
// See CONTRIBUTING.md.
// -----------------------------------------------------------------------------
interface CtNcLocalSpec {
    /** The blob arrays holding the register (created by the app's ensureKeys). */
    records: () => CtNcRecord[];
    derogations: () => CtDerRecord[];
    /** Persist and redraw: the app's `_persist*` + its own render. */
    save: (what: string) => void;
    /** Who acts here — the evaluator named in the analysis. */
    actor: () => string;
    /** The kind of item this module attaches records to ("control", "vendor"…). */
    subjectType: string;
    items?: CtNcAssoc;
    measures?: CtNcAssoc;
    /** Maximum derogation duration, kept in the blob like any other setting. */
    maxDays: () => number;
    setMaxDays: (days: number) => void;
    /** The item enters or leaves its derogated state, when the module holds one.
     *  Modules that derive it from the derogation list (Compliance) pass none. */
    applySubject?: (d: CtDerRecord) => void;
    releaseSubject?: (d: CtDerRecord, reason: string) => void;
}
interface Window {
    ct_nonconformity_local?: {
        options: (spec: CtNcLocalSpec) => CtNcOptions;
        expire: (spec: CtNcLocalSpec) => number;
        /** The module removed the object itself: what covered it falls too. */
        settle: (spec: CtNcLocalSpec, subjectId: string, reason: string) => number;
    };
}
