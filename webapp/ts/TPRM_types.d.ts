/**
 * TPRM (Vendor) — types of the D data model + app globals.
 * Pure type file (no emit). Reference schema:
 * backend-clients/demo-docker/vendor/src/assessment_validation.py
 * ("DATA MODEL CONTRACT" docstring) + actual usage in TPRM_app.js,
 * TPRM_dora.js, TPRM_dora_export.js, VendorPortal_app.js.
 */

/* ── Assessments V2 ─────────────────────────────────────────────── */

/** R3 — closed set. null = not filled in yet. */
type TprmCoverage = "covered" | "partial" | "not_covered" | "not_applicable" | null;

/**
 * R5 — V2 statuses (draft|in_progress|pending_approval|validated|rejected)
 * + "completed" used by the legacy flow (25+5 questionnaire with no
 * template_snapshot).
 */
type TprmAssessmentStatus =
    | "draft" | "in_progress" | "pending_approval" | "validated" | "rejected"
    | "completed";

type TprmQuestionType = "free_text" | "single_choice" | "multi_choice" | "file_upload";
type TprmCriticality = "info" | "major" | "blocker";
type TprmTemplateKind = "questionnaire" | "audit";

/** File answer (file_upload): data = base64. */
interface TprmFileAnswer { name: string; size: number; data: string; }

/** answer: str | string[] (multi_choice) | file | null. */
type TprmAnswer = string | string[] | TprmFileAnswer | null;

interface TprmActionPlan {
    id: string;
    title: string;
    description: string;
    target_date: string;
    owner: string;
    status?: "proposed" | "in_progress" | "done";
}

interface TprmResponse {
    question_id: string;
    coverage?: TprmCoverage;
    answer?: TprmAnswer;
    comment?: string;
    action_plans?: TprmActionPlan[];
    justification?: string;
    /** Legacy flow (25+5 questionnaire): compliant|partial|non_compliant|na. */
    documents?: string[];
}

interface TprmTemplateQuestion {
    id: string;
    text?: string;
    description?: string;
    expected?: string;
    type?: TprmQuestionType;
    /** 0..100 (V2 templates); weight 1..10 on the legacy questionnaire. */
    weight?: number;
    criticality?: TprmCriticality;
    options?: string[];
}

/** Question flattened by _allQuestions (adds the section context). */
interface TprmFlatQuestion extends TprmTemplateQuestion {
    section_id?: string;
    section_title?: string;
}

interface TprmTemplateSection {
    id: string;
    title: string;
    description?: string;
    questions: TprmTemplateQuestion[];
}

/**
 * Questionnaire/audit template. Also serves as the TYPE of the
 * template_snapshot (R1: the snapshot is a deep copy frozen at assessment
 * creation — IMMUTABLE afterwards; immutability is a runtime/backend rule,
 * not expressible by the type system without breaking the
 * iso-functionality of the native flow's local writes).
 */
interface TprmTemplate {
    id: string;
    name: string;
    kind: TprmTemplateKind;
    version: number;
    language?: string;
    description?: string;
    sections: TprmTemplateSection[];
    created_at?: string;
    updated_at?: string;
}

type TprmTemplateSnapshot = TprmTemplate;

/**
 * Assessment (V2 if template_snapshot is present, legacy otherwise — R9).
 * score / completion_rate: 0..100, recomputed by _touchAssessment
 * (same formulas as the backend: _computeAssessmentV2Score /
 * _assessmentStats).
 */
interface TprmAssessment {
    id: string;
    vendor_id: string;
    type?: string;             // periodic | onboarding | ...
    date?: string;
    due_date?: string;
    template_id?: string;      // frozen at creation
    template_version?: number; // frozen at creation
    template_snapshot?: TprmTemplateSnapshot; // R1 — immutable
    status?: TprmAssessmentStatus;
    responses?: TprmResponse[];
    self_validation?: boolean;
    self_validated_at?: string | null;
    submitted_at?: string | null;
    approved_at?: string | null;
    approved_by?: string | null;
    rejected_reason?: string | null;
    score?: number | null;
    completion_rate?: number;
    /** Maturity weighting (vendor-level aggregate). */
    weight_override?: number;
    excluded?: boolean;
}

/* ── Vendors / risks / measures / documents ─────────────────────── */

interface TprmContact { name?: string; email?: string; phone?: string; }

interface TprmContract {
    services?: string;
    start_date?: string;
    end_date?: string;
    review_date?: string;
}

interface TprmClassification {
    ops_impact?: number;
    processes?: number;
    replace_difficulty?: number;
    data_sensitivity?: number;
    integration?: number;
    regulatory_impact?: number;
    gdpr_subprocessor?: boolean;
    [k: string]: unknown;
}

/** Threat exposure (0..4 sliders) — convention "" = not filled in. */
interface TprmExposure {
    dependance?: number | "";
    penetration?: number | "";
    maturite?: number | "";
    confiance?: number | "";
}

interface TprmCertification {
    name: string;
    expiry_date?: string;
    [k: string]: unknown;
}

interface TprmMeasure {
    id: string;
    vendor_id?: string;
    mesure?: string;
    /** historical aliases met in imports / AI output */
    measure?: string;
    details?: string;
    type?: string;
    effet?: string;
    responsable?: string;
    echeance?: string;
    statut?: string;          // planifie | en_cours | termine
    ref_socle?: string;
    source?: string;
    source_assessment_id?: string;
    source_question_id?: string;
    [k: string]: unknown;
}

interface TprmVendor {
    id: string;
    name: string;
    legal_entity?: string;
    country?: string;
    sector?: string;
    website?: string;
    siret?: string;
    status?: string;          // active | prospect | review | offboarded
    logo?: string;
    contact?: TprmContact;
    internal_contact?: TprmContact;
    contract?: TprmContract;
    classification?: TprmClassification;
    exposure?: TprmExposure;
    certifications?: TprmCertification[];
    dpa_signed?: boolean;
    sub_contractors?: unknown[];
    measures?: TprmMeasure[];
    notes?: string;
    /** Aggregated maturity score 0..100 (displayed; derived). */
    maturity_score?: number;
    /* DORA RoI (B_01.02) — patched dynamically by patchVendorRoi */
    lei?: string;
    legal_name_latin?: string;
    country_iso2?: string;
    person_type?: string;
    additional_id_type?: string;
    additional_id_value?: string;
    ultimate_parent_id?: string;
    [k: string]: any;
}

interface TprmTreatment {
    response?: string;
    details?: string;
    due_date?: string;
}

interface TprmRisk {
    id: string;
    vendor_id: string;
    title: string;
    description?: string;
    category?: string;
    impact: number;
    likelihood: number;
    treatment?: TprmTreatment;
    residual_impact?: number;
    residual_likelihood?: number;
    status?: string;          // identified | needs_treatment | active | closed | archived
    linked_measures?: string;
    [k: string]: unknown;
}

interface TprmDocument {
    id: string;
    vendor_id: string;
    name: string;
    type?: string;
    url?: string;
    expiry_date?: string;
    source?: string;
    verified?: boolean;
    [k: string]: unknown;
}

interface TprmMaturityConfig {
    weight_by_kind?: Record<string, number>;
    weight_by_template?: Record<string, number>;
    decay_per_quarter?: number;
    min_effective_weight?: number;
    [k: string]: any;
}

/* ── DORA RoI tree (EBA Reg. (EU) 2024/2956) ────────────────────── */

/**
 * RoI records carry dozens of ITS fields driven by the EBA codelists and
 * patched dynamically (doraPatch*). Minimal structural type + index
 * signature.
 */
interface DoraRecord {
    id: string;
    [field: string]: any;
}

interface DoraSubLink {
    arrangement_id: string;
    subcontractor_id: string;
    tier?: number | string;
    service_provided?: string;
    is_critical_function_support?: boolean;
    parent_subcontractor_id?: string;
    sort_order?: number;
    [field: string]: any;
}

interface DoraMetadata {
    reporting_period: string;
    currency: string;
    fx_rates: Record<string, number>;
    [k: string]: any;
}

interface DoraTree {
    entities: DoraRecord[];
    functions: DoraRecord[];
    branches: DoraRecord[];
    consolidation: DoraRecord[];
    arrangements: DoraRecord[];
    signers: DoraRecord[];
    subcontractors: DoraRecord[];
    subcontractor_links: DoraSubLink[];
    metadata: DoraMetadata;
    [k: string]: any;
}

/** EBA codelist entry ({code,label,eba_code}) or raw code. */
interface DoraCodeEntry {
    code: string;
    label?: string;
    eba_code?: string;
    [k: string]: any;
}

type DoraCodelists = Record<string, any>;

/* ── Legacy questionnaire (TPRM_questions.js) ───────────────────── */

interface TprmLegacyQuestion {
    id: string;
    domain: string;
    text_fr: string;
    text_en?: string;
    expected_fr?: string;
    expected_en?: string;
    red_flags_fr?: string;
    red_flags_en?: string;
    evidence_fr?: string;
    evidence_en?: string;
    weight: number;
    [k: string]: any;
}

/* ── D root ─────────────────────────────────────────────────────── */

interface TprmData {
    vendors: TprmVendor[];
    risks: TprmRisk[];
    assessments: TprmAssessment[];
    documents: TprmDocument[];
    questionnaire_templates: TprmTemplate[];
    maturity_config: TprmMaturityConfig;
    dora: DoraTree;
    metadata: { organization: string; created: string; [k: string]: any };
    [k: string]: any;
}

/* ── DoraData API (published by TPRM_dora.js, IIFE) ─────────────── */

interface DoraSubRowJoined extends DoraSubLink {
    id: string;
    name?: string;
    lei?: string;
    country_iso2?: string;
}

interface DoraDataApi {
    getTree(): DoraTree | null;
    ensureLoaded(cb?: (tree: DoraTree | null) => void): void;
    invalidate(): void;
    arrangementsForVendor(vid: string): DoraRecord[];
    subcontractorsForVendor(vid: string): DoraSubRowJoined[];
    arrangementsForSubcontractor(subId: string): DoraSubLink[];
    vendorsForSubcontractor(subId: string): string[];
    signersForVendor(vid: string): DoraRecord[];
    roiStatus(v: TprmVendor | null | undefined): { complete: boolean; missing: string[] };
    codelists(): DoraCodelists | null;
    renderVendorCard(v: TprmVendor, opts?: { embedded?: boolean }): string;
    renderSubcontractors(): string;
    naceDatalist(): string;
    /* set at the end of TPRM_dora.js */
    gleifTriggerHtml?: (targetInputId: string, opts?: any) => string;
    gleifOpenLookup?: (triggerEl: Element, targetInput: HTMLInputElement, onPick?: (rec: any) => void) => void;
    getCodelist?: (key: string) => DoraCodeEntry[];
    ensureCodelists?: (cb?: (cl: DoraCodelists | null) => void) => void;
}

/** Soft RoI validators (TPRM_dora_validation.js). */
interface DoraValidApi {
    lei(s: unknown): boolean;
    leiChecksum(lei: string): boolean;
    country(s: unknown): boolean;
    currency(s: unknown): boolean;
    date(s: unknown): boolean;
    reportingPeriod(s: unknown): boolean;
    nonNegative(v: unknown): boolean;
    ebaCode(value: unknown, codelistKey: string): boolean;
}

/* ── Shared globals declared Window-only in the generated .d.ts ────
 * ai_common / ct_settings / ct_table / ct_bulkbar / ct_modal /
 * ct_measure_modal only expose their APIs on the Window interface
 * (optional properties). TPRM_app.js calls them as bare globals —
 * local ambient declarations (no impact on the emitted js).
 * VendorAPI / getActiveProjectId / _isAdmin only exist in the backend
 * variant (vendor_api.js): declared `| undefined`, the opensource code
 * keeps them behind typeof guards. */
declare function _aiIsEnabled(): boolean;
declare function _aiGetApiKey(): string;
declare function _aiCallAPI(systemPrompt: string, userPrompt: string): Promise<string>;
declare function _aiParseJSON(raw: string): any;
declare function _aiEnsurePanel(): { title: HTMLElement; body: HTMLElement; footer: HTMLElement };
declare function _aiOpenPanel(): void;
declare function _aiClosePanel(): void;
declare function _aiShowLoading(title: string): void;
declare function _aiShowError(title: string, errMsg: string): void;
declare function openSettings(): void;
declare var ct_table: CtTableApi;
declare var ct_bulkbar: CtBulkbarApi;
declare var ct_modal: CtModalApi;
declare var ct_measure_modal: CtMeasureModalApi;
/** Set by TPRM_dora.js (window.renderDoraPanel) — typeof guard required. */
declare var renderDoraPanel: ((host: HTMLElement) => void) | undefined;
/** Set by TPRM_dora.js (window.DoraData). */
declare var DoraData: DoraDataApi;
/** Backend variant only (vendor_api.js) — absent in opensource. */
declare var VendorAPI: any;
declare var getActiveProjectId: (() => string | null) | undefined;
declare var _isAdmin: (() => boolean) | undefined;

/* ── Misc ───────────────────────────────────────────────────────── */

/** Timeline chart metadata (drag of the date line). */
interface TprmTimelineMeta {
    ML: number; MR: number; MT: number; MB: number;
    W: number; H: number; cW: number;
    points: string[];
    startDate: Date;
    endDate: Date;
}

/** AI suggestion (risk or measure) awaiting acceptance. */
interface TprmAiSuggestion {
    kind: "risk" | "measure";
    [k: string]: any;
}

interface Window {
    /** DORA informal subcontractors (TPRM_app.js) — pick/attach and removal. */
    vendorOpenInformalSubModal?: (vendorId: string) => void;
    vendorRemoveInformalSub?: (vendorId: string, idx: number) => void;
    /** Cached DORA tree, published by TPRM_dora.js. */
    _doraTreeCache?: DoraTree | null;
    _doraCodelists?: DoraCodelists;
    _doraValid?: DoraValidApi;
    DoraData?: DoraDataApi;
    /** Export EBA XLSX (TPRM_dora_export.js). */
    _doraExportEBA?: (tree: DoraTree, codelists: DoraCodelists | null, targetCurrency?: string) => void;
    _timelineMeta?: TprmTimelineMeta;
    /** Optional init hook (backend variant). */
    _appInitCallback?: () => void;
    /** Logged-in user (backend variant only). */
    _currentUser?: { name?: string; email?: string; role?: string };
    /** Backend API layer (demo-docker variant) — absent in opensource. */
    VendorAPI?: any;
    /** DORA section to open (set by TPRM_dora.js). */
    doraSection?: (section: string) => void;
    ExcelJS?: typeof ExcelJS;
    /**
     * Dynamic index: data-click re-exports (window.foo = foo) and app
     * globals — same convention as EBIOS_RM_types.d.ts (risk).
     */
    [k: string]: any;
}

// Demo panel hooks: defined in cisotoolbox_local.js, which the backend apps
// do not load — the typeof guard in AI_APP_CONFIG then returns "". So they
// may be undefined, as in Compliance.
declare var _demoSettingsHTML: (() => string) | undefined;
declare var _wireDemoSettings: (() => void) | undefined;
