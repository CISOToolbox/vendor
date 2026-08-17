/**
 * TPRM (Vendor) — types du modèle de données D + globals d'app.
 * Fichier de types pur (pas d'emit). Schéma de référence :
 * backend-clients/demo-docker/vendor/src/assessment_validation.py
 * (docstring "DATA MODEL CONTRACT") + usages réels de TPRM_app.js,
 * TPRM_dora.js, TPRM_dora_export.js, VendorPortal_app.js.
 */

/* ── Assessments V2 ─────────────────────────────────────────────── */

/** R3 — closed set. null = pas encore renseigné. */
type TprmCoverage = "covered" | "partial" | "not_covered" | "not_applicable" | null;

/**
 * R5 — statuts V2 (draft|in_progress|pending_approval|validated|rejected)
 * + "completed" utilisé par le flux legacy (questionnaire 25+5 sans
 * template_snapshot).
 */
type TprmAssessmentStatus =
    | "draft" | "in_progress" | "pending_approval" | "validated" | "rejected"
    | "completed";

type TprmQuestionType = "free_text" | "single_choice" | "multi_choice" | "file_upload";
type TprmCriticality = "info" | "major" | "blocker";
type TprmTemplateKind = "questionnaire" | "audit";

/** Réponse fichier (file_upload) : data = base64. */
interface TprmFileAnswer { name: string; size: number; data: string; }

/** answer : str | string[] (multi_choice) | fichier | null. */
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
    /** Flux legacy (questionnaire 25+5) : compliant|partial|non_compliant|na. */
    documents?: string[];
}

interface TprmTemplateQuestion {
    id: string;
    text?: string;
    description?: string;
    expected?: string;
    type?: TprmQuestionType;
    /** 0..100 (templates V2) ; poids 1..10 côté questionnaire legacy. */
    weight?: number;
    criticality?: TprmCriticality;
    options?: string[];
}

/** Question aplatie par _allQuestions (ajout du contexte section). */
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
 * Template de questionnaire/audit. Sert aussi de TYPE du
 * template_snapshot (R1 : le snapshot est une copie profonde figée à la
 * création de l'évaluation — IMMUABLE ensuite ; l'immutabilité est une
 * règle runtime/backend, pas exprimable par le système de types sans
 * casser l'iso-fonctionnalité des écritures locales du flux natif).
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
 * Évaluation (V2 si template_snapshot présent, legacy sinon — R9).
 * score / completion_rate : 0..100, recalculés par _touchAssessment
 * (mêmes formules que le backend : _computeAssessmentV2Score /
 * _assessmentStats).
 */
interface TprmAssessment {
    id: string;
    vendor_id: string;
    type?: string;             // periodic | onboarding | ...
    date?: string;
    due_date?: string;
    template_id?: string;      // figé à la création
    template_version?: number; // figé à la création
    template_snapshot?: TprmTemplateSnapshot; // R1 — immuable
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
    /** Pondération maturité (agrégat fournisseur). */
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

/** Exposition menace (sliders 0..4) — convention "" = non renseigné. */
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
    /** alias historiques rencontrés dans les imports/IA */
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
    /** Score maturité agrégé 0..100 (affiché ; dérivé). */
    maturity_score?: number;
    /* RoI DORA (B_01.02) — patchés dynamiquement par patchVendorRoi */
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
 * Les enregistrements RoI portent des dizaines de champs ITS pilotés
 * par les codelists EBA et patchés dynamiquement (doraPatch*). Type
 * structurel minimal + index signature.
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

/** Entrée de codelist EBA ({code,label,eba_code}) ou code brut. */
interface DoraCodeEntry {
    code: string;
    label?: string;
    eba_code?: string;
    [k: string]: any;
}

type DoraCodelists = Record<string, any>;

/* ── Questionnaire legacy (TPRM_questions.js) ───────────────────── */

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

/* ── Racine D ───────────────────────────────────────────────────── */

interface TprmData {
    vendors: TprmVendor[];
    risks: TprmRisk[];
    assessments: TprmAssessment[];
    documents: TprmDocument[];
    questionnaire_templates: TprmTemplate[];
    maturity_config: TprmMaturityConfig;
    /** Variante backend : l'arbre DORA vit en base (API /dora), pas dans D. */
    dora?: DoraTree;
    metadata: { organization: string; created: string; [k: string]: any };
    [k: string]: any;
}

/* ── API DoraData (publiée par TPRM_dora.js, IIFE) ──────────────── */

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
    /* posés en fin de TPRM_dora.js */
    gleifTriggerHtml?: (targetInputId: string, opts?: any) => string;
    gleifOpenLookup?: (triggerEl: Element, targetInput: HTMLInputElement, onPick?: (rec: any) => void) => void;
    getCodelist?: (key: string) => DoraCodeEntry[];
    ensureCodelists?: (cb?: (cl: DoraCodelists | null) => void) => void;
}

/** Validateurs RoI soft (TPRM_dora_validation.js). */
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

/* ── Globals shared déclarés Window-only dans les .d.ts générés ────
 * ai_common / ct_settings / ct_table / ct_bulkbar / ct_modal /
 * ct_measure_modal n'exposent leurs APIs que sur l'interface Window
 * (propriétés optionnelles). TPRM_app.js les appelle en globals nus —
 * déclarations ambiantes locales (aucun impact sur le js émis).
 * VendorAPI / getActiveProjectId / _isAdmin n'existent que dans la
 * variante backend (vendor_api.js) : déclarés `| undefined`, le code
 * opensource les garde derrière des guards typeof. */
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
/** Posé par TPRM_dora.js (window.renderDoraPanel) — guard typeof requis. */
declare var renderDoraPanel: ((host: HTMLElement) => void) | undefined;
/** Posé par TPRM_dora.js (window.DoraData). */
declare var DoraData: DoraDataApi;
/** Couche API backend (vendor_api.ts) — typée ci-dessous. */
declare var VendorAPI: VendorApiClient;
declare var getActiveProjectId: (() => string | null) | undefined;
declare var _isAdmin: (() => boolean) | undefined;

/* ── Couche persistance backend (vendor_api.ts) ─────────────────────
 * Remplace cisotoolbox_local.js (non chargé en demo-docker). Le contrat
 * _persist/_persistCreate/_persistDelete/_obj est posé sur window par
 * vendor_api.js AVANT TPRM_app.js ; déclarés ici en globals nus. */

/** Types d'entité du contrat de persistance (clés de _PATCH_FNS). */
type TprmPersistType =
    | "vendor" | "measure" | "risk" | "document" | "assessment"
    | "vendor_roi" | "dora_entity" | "dora_function" | "dora_branch"
    | "dora_cs" | "dora_arrangement" | "dora_signer"
    | "dora_subcontractor" | "dora_sub_link";

/** Payload générique de PATCH/POST (champs partiels d'une entité). */
type VendorApiPayload = Record<string, unknown>;

declare function _persist(entityType: string, entityId: string | number, fields: VendorApiPayload): void;
declare function _persistCreate(entityType: string, data: VendorApiPayload): Promise<unknown> | void;
declare function _persistDelete(entityType: string, entityId: string | number): void;
declare function _obj(k: string, v: any): Record<string, any>;
declare function _autoSave(): void;
declare function _setDataReady(): void;
/** Fournis par cisotoolbox_local.js en opensource — ABSENTS en backend
 * (toujours appelés derrière un guard typeof dans TPRM_app.js). */
declare var _installUndoHook: (() => void) | undefined;
declare var _renderSnapshotsPanel: ((opts: any) => Promise<void>) | undefined;

/* ── Client REST VendorAPI (vendor_api.ts) ──────────────────────── */

interface VendorApiProjectSummary {
    id: string;
    name: string;
    [k: string]: any;
}

/** Projet complet ; data arrive en objet ou en chaîne JSON selon la route. */
interface VendorApiProject extends VendorApiProjectSummary {
    data?: TprmData | Record<string, unknown> | string;
}

interface VendorApiUser {
    id: string;
    name?: string;
    email?: string;
    role?: string;            // admin | user | viewer | pending
    picture?: string;
    ai_enabled?: string;      // "true" | "false" (stocké en str côté backend)
    last_login?: string;
    [k: string]: any;
}

interface VendorApiClient {
    /* projets (legacy + blob fallback) */
    list(): Promise<VendorApiProjectSummary[]>;
    get(id: string): Promise<VendorApiProject>;
    create(data?: { name: string; data: Record<string, unknown> }): Promise<VendorApiProject>;
    update(id: string, data: { name: string; data: unknown }): Promise<unknown>;
    del(id: string): Promise<null>;
    importFile(file: File): Promise<VendorApiProject>;
    exportUrl(id: string): string;
    saveFull(projectId: string, data: TprmData): Promise<unknown>;
    /* vendors */
    listVendors(projectId: string): Promise<TprmVendor[]>;
    createVendor(projectId: string, data: VendorApiPayload): Promise<unknown>;
    patchVendor(projectId: string, vendorId: string, fields: VendorApiPayload): Promise<unknown>;
    deleteVendor(projectId: string, vendorId: string): Promise<null>;
    /* measures */
    createMeasure(projectId: string, vendorId: string, data: VendorApiPayload): Promise<unknown>;
    patchMeasure(projectId: string, measureId: string, fields: VendorApiPayload): Promise<unknown>;
    deleteMeasure(projectId: string, measureId: string): Promise<null>;
    /* risks */
    createRisk(projectId: string, data: VendorApiPayload): Promise<unknown>;
    patchRisk(projectId: string, riskId: string, fields: VendorApiPayload): Promise<unknown>;
    deleteRisk(projectId: string, riskId: string): Promise<null>;
    /* documents */
    createDocument(projectId: string, data: VendorApiPayload): Promise<unknown>;
    patchDocument(projectId: string, docId: string, fields: VendorApiPayload): Promise<unknown>;
    deleteDocument(projectId: string, docId: string): Promise<null>;
    /* assessments (règles serveur : assessment_validation.py R1..R9) */
    createAssessment(projectId: string, data: VendorApiPayload): Promise<unknown>;
    patchAssessment(projectId: string, assessId: string, fields: VendorApiPayload): Promise<unknown>;
    deleteAssessment(projectId: string, assessId: string): Promise<null>;
    /* utilitaires */
    verifyUrl(url: string): Promise<unknown>;
    probeVendorUrls(website: string): Promise<unknown>;
    /* IA (mode managé Pilot) */
    aiComplete(systemPrompt: string, userPrompt: string, provider?: string, model?: string): Promise<unknown>;
    aiConfig(): Promise<unknown>;
    aiGetKeys(): Promise<unknown>;
    aiSetKeys(data: VendorApiPayload): Promise<unknown>;
    /* auth */
    authMe(): Promise<VendorApiUser | null>;
    authProviders(): Promise<any>;
    authLogout(): Promise<unknown>;
    /* admin utilisateurs */
    listUsers(): Promise<VendorApiUser[]>;
    updateUser(id: string, data: VendorApiPayload): Promise<unknown>;
    /* DORA RoI */
    doraCodelists(): Promise<DoraCodelists>;
    doraTree(projectId: string): Promise<DoraTree>;
    doraValidate(projectId: string): Promise<{ ok: boolean; errors: Array<Record<string, string>> }>;
    doraExportUrl(projectId: string, currency?: string): string;
    patchVendorRoi(projectId: string, vendorId: string, fields: VendorApiPayload): Promise<unknown>;
    listDoraEntities(p: string): Promise<DoraRecord[]>;
    createDoraEntity(p: string, d: VendorApiPayload): Promise<unknown>;
    patchDoraEntity(p: string, id: string, f: VendorApiPayload): Promise<unknown>;
    deleteDoraEntity(p: string, id: string): Promise<null>;
    listDoraFunctions(p: string): Promise<DoraRecord[]>;
    createDoraFunction(p: string, d: VendorApiPayload): Promise<unknown>;
    patchDoraFunction(p: string, id: string, f: VendorApiPayload): Promise<unknown>;
    deleteDoraFunction(p: string, id: string): Promise<null>;
    listDoraBranches(p: string): Promise<DoraRecord[]>;
    createDoraBranch(p: string, d: VendorApiPayload): Promise<unknown>;
    patchDoraBranch(p: string, id: string, f: VendorApiPayload): Promise<unknown>;
    deleteDoraBranch(p: string, id: string): Promise<null>;
    listDoraCs(p: string): Promise<DoraRecord[]>;
    createDoraCs(p: string, d: VendorApiPayload): Promise<unknown>;
    patchDoraCs(p: string, id: string, f: VendorApiPayload): Promise<unknown>;
    deleteDoraCs(p: string, id: string): Promise<null>;
    listDoraArrangements(p: string): Promise<DoraRecord[]>;
    createDoraArrangement(p: string, d: VendorApiPayload): Promise<unknown>;
    patchDoraArrangement(p: string, id: string, f: VendorApiPayload): Promise<unknown>;
    deleteDoraArrangement(p: string, id: string): Promise<null>;
    linkDoraArrangementRfe(p: string, aid: string, rid: string): Promise<unknown>;
    unlinkDoraArrangementRfe(p: string, aid: string, rid: string): Promise<null>;
    createDoraSigner(p: string, aid: string, d: VendorApiPayload): Promise<unknown>;
    patchDoraSigner(p: string, aid: string, id: string, f: VendorApiPayload): Promise<unknown>;
    deleteDoraSigner(p: string, aid: string, id: string): Promise<null>;
    listDoraSubs(p: string): Promise<DoraRecord[]>;
    createDoraSub(p: string, d: VendorApiPayload): Promise<unknown>;
    patchDoraSub(p: string, id: string, f: VendorApiPayload): Promise<unknown>;
    deleteDoraSub(p: string, id: string): Promise<null>;
    linkDoraSub(p: string, aid: string, d: VendorApiPayload): Promise<unknown>;
    patchDoraSubLink(p: string, aid: string, sid: string, f: VendorApiPayload): Promise<unknown>;
    unlinkDoraSub(p: string, aid: string, sid: string): Promise<null>;
}

/* ── Divers ─────────────────────────────────────────────────────── */

/** Métadonnées du graphe timeline (drag de la ligne de date). */
interface TprmTimelineMeta {
    ML: number; MR: number; MT: number; MB: number;
    W: number; H: number; cW: number;
    points: string[];
    startDate: Date;
    endDate: Date;
}

/** Suggestion IA (risque ou mesure) en attente d'acceptation. */
interface TprmAiSuggestion {
    kind: "risk" | "measure";
    [k: string]: any;
}

interface Window {
    /** Tree DORA en cache, publié par TPRM_dora.js. */
    _doraTreeCache?: DoraTree | null;
    _doraCodelists?: DoraCodelists;
    _doraValid?: DoraValidApi;
    _validateDoraROI?: () => Promise<{ ok: boolean; errors: Array<Record<string, string>> }>;
    _showDoraValidationModal?: (errors: Array<Record<string, string>>, onProceed?: () => void) => void;
    _doraList?: (key: string) => Array<{ id: string; label: string }>;
    DORA_REF?: DoraCodelists | null;
    DoraData?: DoraDataApi;
    /** Export EBA XLSX (TPRM_dora_export.js). */
    _doraExportEBA?: (tree: DoraTree, codelists: DoraCodelists | null, targetCurrency?: string) => void;
    _timelineMeta?: TprmTimelineMeta;
    /** Hook d'init optionnel (variante backend). */
    _appInitCallback?: () => void;
    /** Utilisateur connecté (variante backend uniquement). */
    _currentUser?: VendorApiUser;
    /** Couche API backend (vendor_api.ts). */
    VendorAPI: VendorApiClient;
    /** Contrat de persistance backend, posé par vendor_api.ts. */
    _persist?: typeof _persist;
    _persistCreate?: typeof _persistCreate;
    _persistDelete?: typeof _persistDelete;
    _obj?: typeof _obj;
    _setDataReady?: () => void;
    getActiveProjectId?: () => string | null;
    /** Rôle module (auth/role) posé par _initAuth de vendor_api.ts. */
    _moduleRole?: string;
    _logout?: () => void;
    /** Section DORA à ouvrir (posée par TPRM_dora.js). */
    doraSection?: (section: string) => void;
    ExcelJS?: typeof ExcelJS;
    /**
     * Index dynamique : ré-exports data-click (window.foo = foo) et
     * globals d'app — même convention que EBIOS_RM_types.d.ts (risk).
     */
    [k: string]: any;
}

declare var _dirPicker: (currentValue: string | null | undefined, handler: string, argsJson: string) => string;

// Hooks du panneau démo : définis dans cisotoolbox_local.js, que les apps
// backend ne chargent pas — le garde typeof dans AI_APP_CONFIG renvoie ""
// dans ce cas. Donc possiblement indéfinis, comme dans Compliance.
declare var _demoSettingsHTML: (() => string) | undefined;
declare var _wireDemoSettings: (() => void) | undefined;
