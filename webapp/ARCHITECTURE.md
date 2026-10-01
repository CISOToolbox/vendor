# Vendor (TPRM) Module — Architecture Document

## 1. Overview

**Vendor** is a Third-Party Risk Management (TPRM) application within the CISO Toolbox suite. It enables CISOs and security teams to inventory vendors, classify their exposure, assess their security posture with questionnaire and audit templates, track risks with mitigation measures, manage compliance documentation and maintain a DORA Register of Information.

- **URL**: https://vendor.cisotoolbox.org
- **Architecture**: 100% client-side vanilla JavaScript, no framework, no build step to run it (module code is written in TypeScript under `ts/`, the compiled `js/` is committed)
- **Data storage**: Browser localStorage (autosave) + JSON file download for persistence
- **Encryption**: AES-256-GCM with PBKDF2 for saved files and snapshots (key derivation and encryption in `cisotoolbox.js`, file and snapshot handling in `cisotoolbox_local.js`)

---

## 2. File Structure

The application lives under `webapp/` in the repository. Files marked *generated* are identical across the CISO Toolbox apps, carry a "Generated file - do not edit" header and are rewritten at every release.

| File | Purpose |
|------|---------|
| `index.html` | Single HTML page: app bar (File menu, language, theme, settings), navigation rail, content container, overlays (help, confirm, password) |
| `css/cisotoolbox.css` | *Generated* — shared stylesheet: app shell, rail, tables, buttons, forms, sliders |
| `css/tprm.css` | App-specific styles |
| `js/TPRM_app.js` | Main application: navigation, rendering, CRUD, formulas, templates and assessments, Vendor Portal links, Excel import/export, AI integration, settings, non-conformity register wiring |
| `js/TPRM_questions.js` | Default questionnaire definitions (`TPRM_QUESTIONS`, 25 questions; `TPRM_DORA_QUESTIONS`, 5 questions), risk categories, certification names |
| `js/TPRM_i18n_fr.js` | French translations of the module |
| `js/TPRM_i18n_en.js` | English translations of the module |
| `js/TPRM_dora.js` | DORA Register of Information panel, `DoraData` API, GLEIF LEI lookup |
| `js/TPRM_dora_validation.js` | Non-blocking RoI validators (`window._doraValid`) |
| `js/TPRM_dora_export.js` | RoI export to an EBA RoI ITS XLSX workbook (`window._doraExportEBA`) |
| `js/dora_codelists.js` | EBA DORA codelists (DPM v4.0), published as `window._doraCodelists` |
| `js/dora_codelists_i18n.js` | *Generated* — FR / EN labels of the DORA codelists |
| `js/cisotoolbox.js` | *Generated* — shared library: `esc()`, `_da()`, event delegation, AES-256-GCM encryption, undo/redo, sliders, column hide/show/resize, matrix rendering, SVG icons, language and theme toggles, `_loadScript()` |
| `js/cisotoolbox_local.js` | *Generated* — browser persistence: autosave, persistence adapter (`_persist*`), file open/save, restore banner, snapshots, demo loader |
| `js/i18n.js` | *Generated* — i18n engine: `t()`, `_registerTranslations()`, `switchLang()`, `_applyStaticTranslations()` |
| `js/i18n_core_fr.js`, `js/i18n_core_en.js` | *Generated* — translation keys common to all apps |
| `js/ct_schema.js` | *Generated* — schema revision stamp and migration on load (`ctSchemaStamp`, `ctSchemaMigrate`) |
| `js/ai_common.js` | *Generated* — AI providers (Anthropic, OpenAI, Google Gemini, AWS Bedrock): API calls, settings, suggestion panel |
| `js/ct_settings.js` | *Generated* — settings panel |
| `js/ct_refselect.js` | *Generated* — multi-select dropdown widget with tags |
| `js/ct_modal.js` | *Generated* — dialogs |
| `js/ct_measure_modal.js` | *Generated* — measure edit dialog |
| `js/ct_userpicker.js` | *Generated* — person field |
| `js/ct_nonconformity.js`, `js/ct_nonconformity_local.js` | *Generated* — non-conformity and derogation register (rendering, local rules) |
| `js/ct_table.js`, `js/ct_bulkbar.js` | *Generated* — tables and bulk actions |
| `js/vendor/exceljs.min.js` | ExcelJS (third-party library), loaded on demand by `_loadExcelJS()` |
| `ts/` | TypeScript sources of the module code (`TPRM_*.ts`, `dora_codelists.ts`, `TPRM_types.d.ts`) and the generated type declarations of the shared files (`ts/types/`) |
| `portal/` | Vendor Portal: `index.html`, `css/portal.css`, `js/VendorPortal_app.js`, `js/VendorPortal_i18n_fr.js`, `js/VendorPortal_i18n_en.js` (sources in `portal/ts/`); it loads the shared scripts and stylesheets from `../js/` and `../css/` |
| `demo-fr.json`, `demo-en.json` | Fictional demo dataset (MedSecure), loadable from the settings panel |
| `.htaccess.example`, `nginx-security.conf.example` | Security headers (CSP and others) for Apache / nginx |
| `favicon.svg` | App icon |

---

## 3. Architecture Diagram

```
+-------------------------------------------------------------------+
|  Browser                                                          |
|                                                                   |
|  index.html                                                       |
|  +-------------------------------------------------------------+ |
|  | App bar  [File menu] [Status] [Lang] [Theme] [Settings]     | |
|  +-------------------------------------------------------------+ |
|  | Rail            | Main Content (#content)                   | |
|  | +-------------+ | +---------------------------------------+ | |
|  | | Dashboard   | | | renderPanel() switch on _panel        | | |
|  | | Vendors     | | |   dashboard, vendors, risks,          | | |
|  | | Risks       | | |   measures, documents,                | | |
|  | | Measures    | | |   nonconformities, templates,         | | |
|  | | Documents   | | |   history, dora                       | | |
|  | | Non-conf.   | | +---------------------------------------+ | |
|  | | Templates   | |                                           | |
|  | | DORA        | |                                           | |
|  | | Help        | |                                           | |
|  | | Snapshots   | |                                           | |
|  | +-------------+ |                                           | |
|  +--------------------------------------------------------------+ |
|                                                                   |
|  +------------------+  +-------------------+  +-----------------+ |
|  | cisotoolbox.js   |  | i18n.js           |  | ai_common.js    | |
|  | - esc(), _da()   |  | - t(), switchLang |  | - API calls     | |
|  | - AES encrypt    |  | i18n_core_*.js    |  | - AI panel      | |
|  | - matrix SVG     |  | TPRM_i18n_fr.js   |  +-----------------+ |
|  | - event dispatch |  | TPRM_i18n_en.js   |  | ct_settings.js  | |
|  | - undo/redo      |  +-------------------+  +-----------------+ |
|  +------------------+  +-------------------+  +-----------------+ |
|  | cisotoolbox_local|  | TPRM_questions.js |  | TPRM_dora*.js   | |
|  |   .js            |  | ct_*.js widgets   |  | dora_codelists* | |
|  | - autosave       |  +-------------------+  +-----------------+ |
|  | - _persist*      |                                             |
|  | - files, snaps   |                                             |
|  +------------------+                                             |
|                                                                   |
|  Data layer: D (global object)                                    |
|  +------------------------------------------------------------+  |
|  | D.vendors[] D.risks[] D.assessments[] D.documents[]        |  |
|  | D.questionnaire_templates[] D.maturity_config D.dora       |  |
|  | D.nonconformities[] D.derogations[] D.metadata             |  |
|  +------------------------------------------------------------+  |
|          |                    |                                    |
|  localStorage (autosave)     JSON file (save/load + AES-256)     |
+-------------------------------------------------------------------+
```

---

## 4. Data Model

All data lives in the global `D` object, initialized from `TPRM_INIT_DATA` (top of `TPRM_app.js`). The full type definitions are in `ts/TPRM_types.d.ts`.

| Key | Content |
|-----|---------|
| `vendors[]` | Vendors (see below) |
| `risks[]` | Risks, linked to a vendor |
| `assessments[]` | Template-driven assessments |
| `documents[]` | Vendor documents |
| `questionnaire_templates[]` | Questionnaire and audit templates |
| `maturity_config` | Weighting of the vendor maturity score |
| `dora` | DORA Register of Information tree |
| `metadata` | `{organization, created}` |
| `nonconformities[]`, `derogations[]` | Non-conformity and derogation register, created on load when missing |
| `_custom_questionnaire[]` | Optional, set by the custom questionnaire CSV import in the settings panel |

The schema revision is `window.SCHEMA_REV = 2` (rev 2 = assessments V2); `ct_schema.js` stamps it on every autosave and replays `window.SCHEMA_MIGRATIONS` on every load path.

### D.metadata

```javascript
{
    organization: "",  // Organization name
    created: ""        // Creation date (ISO)
}
```

### D.vendors[]

Each vendor object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID, format `PP-001` |
| `name` | string | Vendor display name |
| `legal_entity` | string | Legal entity name |
| `country` | string | Country |
| `sector` | string | Business sector |
| `website` | string | Vendor website URL |
| `siret` | string | SIRET / company registration number |
| `logo` | string | Base64-encoded image (max 64x64) or empty |
| `status` | string | `prospect` / `active` / `review` / `offboarded` |
| `contact` | object | `{name, email}` -- vendor contact |
| `internal_contact` | object | `{name, email}` -- internal owner |
| `contract` | object | `{services, start_date, end_date, review_date}` |
| `classification` | object | 6 criteria (0-4 each): `ops_impact`, `processes`, `replace_difficulty`, `data_sensitivity`, `integration`, `regulatory_impact`, plus `gdpr_subprocessor` (boolean) |
| `exposure` | object | `{dependance, penetration, maturite, confiance}` |
| `certifications` | array | `[{name, expiry_date}]` |
| `dpa_signed` | boolean | DPA signed |
| `sub_contractors` | array | Informally declared sub-contractors (names) |
| `measures` | array | Mitigation measures (see below) |
| `notes` | string | Free-text notes |
| `lei`, `legal_name_latin`, `country_iso2`, `person_type`, `additional_id_type`, `additional_id_value`, `ultimate_parent_id` | string | DORA RoI identity fields, edited in the vendor's DORA tab |

**Vendor measures** (in `vendor.measures[]`):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Format `PP-001:MES-01` |
| `mesure` | string | Short title |
| `details` | string | Implementation steps |
| `type` | string | Measure type |
| `statut` | string | `planifie` / `en_cours` / `termine` |
| `responsable` | string | Owner |
| `echeance` | string | Due date (ISO) |
| `ref_socle` | string | Reference standard |
| `effet` | string | Expected effect |
| `source`, `source_assessment_id`, `source_question_id` | string | Set when the measure comes from an approved assessment's action plan (`source: "vendor_engagement"`) |

### D.risks[]

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Format `PP-001-R01` |
| `vendor_id` | string | Links to `vendor.id` |
| `title` | string | Risk title |
| `description` | string | Detailed description |
| `category` | string | `CYBER` / `OPS` / `FIN` / `COMP` / `STRAT` / `REP` / `GEO` |
| `impact` | int | 1-5 (inherent) |
| `likelihood` | int | 1-5 (inherent) |
| `treatment` | object | `{response, details, due_date}` -- a new risk starts with `response: "mitigate"` |
| `residual_impact` | int | 0-5 (0 = not evaluated) |
| `residual_likelihood` | int | 0-5 (0 = not evaluated) |
| `status` | string | `identified` / `needs_treatment` / `active` / `closed` / `archived` (a new risk starts at `needs_treatment`) |
| `linked_measures` | string | Linked measures |

### D.questionnaire_templates[]

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Format `TPL-001` |
| `name`, `description` | string | Display name and description |
| `kind` | string | `questionnaire` (filled by the vendor) / `audit` (filled internally) |
| `version` | int | Template version |
| `language` | string | `fr` / `en` |
| `sections[]` | array | `{id, title, description, questions[]}` -- section ids `SEC-001` |
| `sections[].questions[]` | array | `{id, type, text, description, expected, weight, criticality, options}` -- `type` is `free_text`, `weight` 0-100, `criticality` `info` / `major` / `blocker` |

Two default templates are seeded by `_ensureDefaultTemplate()` when missing: `TPL-001`, the standard vendor questionnaire built from the 25 `TPRM_QUESTIONS`, and `TPL-002`, an audit template based on the 42 ANSSI hygiene rules.

### D.assessments[]

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Format `EVAL-001` |
| `vendor_id` | string | Links to `vendor.id` |
| `type`, `date`, `due_date` | string | Assessment type, date and due date |
| `template_id`, `template_version` | string, int | Template the assessment was created from |
| `template_snapshot` | object | Deep copy of the template frozen at creation |
| `status` | string | `draft` / `in_progress` / `pending_approval` / `validated` / `rejected` |
| `responses` | array | `[{question_id, coverage, answer, comment, action_plans, justification}]` |
| `self_validation`, `self_validated_at` | bool, string | Self-validation required before submission |
| `submitted_at`, `approved_at`, `rejected_reason` | string | Approval workflow |
| `score` | int/null | Weighted score 0-100 |
| `completion_rate` | int | Percentage 0-100 |
| `weight_override`, `excluded` | number, bool | Per-assessment adjustments of the vendor maturity score |

**Responses**: `coverage` is one of `covered`, `partial`, `not_covered`, `not_applicable` (or `null` while not filled). A `partial` or `not_covered` response counts as answered only with an action plan or a justification.

### D.documents[]

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Format `DOC-001` |
| `vendor_id` | string | Links to `vendor.id` |
| `name` | string | Document name |
| `type` | string | `trust_center` / `audit_report` / `certification` / `dpa` / `privacy` / `whitepaper` / `status_page` / `bug_bounty` / `other` |
| `url` | string | Document URL |
| `expiry_date` | string | Expiry date (ISO) |
| `source` | string | `manual` / `ai` |
| `verified` | boolean | URL verification status |

### D.maturity_config

```javascript
{
    weight_by_kind: { questionnaire: 1.0, audit: 1.5 },
    weight_by_template: {},       // template id -> weight
    decay_per_quarter: 0.0,
    min_effective_weight: 0.1
}
```

### D.dora

The DORA Register of Information tree (EBA Reg. (EU) 2024/2956), created by `_doraInitEmpty()`:

```javascript
{
    entities: [], functions: [], branches: [], consolidation: [],
    arrangements: [], signers: [], subcontractors: [], subcontractor_links: [],
    metadata: { reporting_period: "", currency: "EUR", fx_rates: {} }
}
```

`_doraMigrate(D)` adds any missing key after a file load, without overwriting existing data. See §13.

---

## 5. Navigation

### Panel System

Navigation is rail-driven. The current panel is stored in `_panel` (string). Line numbers in §5 to §7 refer to `js/TPRM_app.js`.

**`selectPanel(id)`** (line 98): Sets `_panel`, resets `_selectedVendor` to null, updates the rail active state, calls `renderPanel()`.

**`renderPanel()`** (line 106): Central render dispatcher. Switches on `_panel`:

| Panel ID | Renderer | Notes |
|----------|----------|-------|
| `dashboard` | `renderDashboard()` | KPI cards, risk matrices, timeline, deadlines |
| `vendors` | `renderVendorList()` or `renderVendorDetail()` | List if `_selectedVendor` is null; detail with tabs otherwise |
| `risks` | `renderRiskList()` | Global risk register with filters |
| `measures` | `renderGlobalMeasures()` | Cross-vendor measure registry |
| `documents` | `renderDocList()` | All documents grouped by vendor |
| `nonconformities` | `renderNonconformities()` | Non-conformity and derogation register |
| `templates` | `renderTemplateList()` or `renderTemplateEditor(id)` | Template list, or the editor when a template is being edited |
| `history` | `renderHistory()` | Snapshots panel |
| `dora` | `renderDoraPanel()` | DORA Register of Information (from `TPRM_dora.js`) |

After rendering, `renderPanel()` also:
- Initializes sliders (`_initSliders()`)
- Sets up the timeline drag handler (`_initTimelineDrag()`)
- Configures column hide/show/resize for the tables (`_setupTable()`)

### Vendor Detail Tabs

Within vendor detail, `_vendorTab` controls which sub-view renders:

| Tab | Function | Content |
|-----|----------|---------|
| `info` | `_renderVendorForm(v)` | Identity, contacts, contract, classification sliders, exposure, notes |
| `risks` | `_renderVendorRisks(v)` | Risk table with linked measures |
| `assessments` | `_renderVendorAssessments(v)` | Weighted maturity detail and assessment list |
| `documents` | `_renderVendorDocs(v)` | Documents table, confidence selector |
| `dora` | `_renderVendorDoraTab(v)` | DORA RoI identity fields and arrangements of the vendor |

---

## 6. Key Formulas

### Threat Level (Menace)

Computed by `_computeExposure(ex)` (line 1202) on the factors returned by `_fullExposure(v)` (line 1221):

```
Threat = round((Dependency x Penetration) / (Maturity x Confidence), 2)
```

Where:
- **Dependency** = average of `ops_impact`, `processes`, `replace_difficulty` (each 0-4), rounded to 1 decimal
- **Penetration** = average of `data_sensitivity`, `integration`, `regulatory_impact` (each 0-4), rounded to 1 decimal
- **Maturity** (1-4): derived from the vendor's weighted maturity score via `_scoreToMaturite()` when it has at least one validated assessment; otherwise the stored `exposure.maturite`, or 1
- **Confidence** (1-4): manual rating set in the Documents tab, 1 when not set

Maturity and confidence floor at 1. The threat is `null` ("not assessed") when Dependency or Penetration is 0.

### Exposure Thresholds

Used by `_getTier(v)` (line 5609), `_exposureClass(level)` (line 1280) and `_exposureLabel(level)` (line 1291):

| Threat Value | Tier | CSS Class |
|-------------|------|-----------|
| null | Not assessed (`unassessed`) | `score-unknown` |
| >= 4 | Critical | `score-critical` |
| >= 2 | High | `score-high` |
| >= 1 | Medium | `score-medium` |
| < 1 | Low | `score-low` |

### Dependency and Penetration Scores

Computed by `_avgSliders()` (line 1302):

```
Dependency  = round(avg(ops_impact, processes, replace_difficulty) * 10) / 10
Penetration = round(avg(data_sensitivity, integration, regulatory_impact) * 10) / 10
```

### Classification Score

Computed by `_computeClassificationScore(c)` (line 1307): average of the 6 classification criteria, rounded to 1 decimal.

### Score to Maturity Mapping

`_scoreToMaturite(score)` (line 5621):

| Maturity Score | Maturity Level |
|-----------------|---------------|
| 80-100 | 4 |
| 60-79 | 3 |
| 40-59 | 2 |
| 0-39 | 1 |

### Assessment Score

`_computeAssessmentV2Score(a)` (line 4074), over the questions of the assessment's template:

```
Score = round(sum(answered_weight) / sum(applicable_weight) * 100)

Where per question (weight = question weight, 1 if not set):
  - covered        -> full weight
  - partial        -> 50% weight
  - not_covered    -> 0
  - not filled     -> 0
  - not_applicable -> excluded from both numerator and denominator
```

### Vendor Maturity Score

`_computeVendorMaturityDetail(vendorId)` (line 4142) averages the scores of the vendor's **validated** assessments, each weighted by:

- `weight_override` on the assessment if set, else `maturity_config.weight_by_template[template id]` if set, else `maturity_config.weight_by_kind[kind]` (1.0 if not set);
- a temporal decay when `decay_per_quarter` > 0: `effective = max(min_effective_weight, base x (1 - decay x quarters))`, the age being counted from `approved_at`, `submitted_at` or `date`;
- assessments with `excluded: true` do not count.

### Risk Score

```
Inherent Score = Impact x Likelihood  (range 1-25)
Residual Score = Residual_Impact x Residual_Likelihood
```

Score thresholds (used by `_scoreClass()`, line 5732):

| Score | Level |
|-------|-------|
| >= 16 | Critical |
| >= 10 | High |
| >= 5 | Medium |
| < 5 | Low |

### DORA ICT Critical Detection

`_isDoraICTCritical(c)` (line 1315):

A vendor is flagged as DORA ICT critical when **DORA mode is enabled** AND either:
- Number of classification criteria at maximum value (4) >= threshold (default 3), OR
- Average of the 6 classification criteria >= threshold (default 3.5)

DORA mode is on unless disabled in Settings. Mode and thresholds are stored in localStorage (`tprm_dora_enabled`, `tprm_dora_max_criteria`, `tprm_dora_avg_score`).

---

## 7. Functions Reference

Line numbers refer to `js/TPRM_app.js`.

### Navigation

| Function | Line | Purpose |
|----------|------|---------|
| `selectPanel(id)` | 98 | Set active panel, reset vendor selection, re-render |
| `renderPanel()` | 106 | Central render dispatcher (switch/case on `_panel`) |
| `renderAll()` | 6686 | Full render: toolbar settings button, static translations, panel, undo buttons |
| `setVendorTab(tab)` | 5591 | Switch vendor detail tab |
| `backToVendors()` | 2501 | Clear vendor selection, re-render vendor list |
| `goToRisk(vendorId)` | 2212 | Navigate to vendor's risk tab from global risk list |

### Dashboard

| Function | Line | Purpose |
|----------|------|---------|
| `renderDashboard()` | 182 | Render KPI cards, matrices, timeline, deadlines |
| `_renderRiskTimeline()` | 262 | SVG chart of risk levels over time with draggable date line |
| `_card(val, label, cls)` | 440 | Render a single dashboard KPI card |
| `setDeadlineDays(days)` | 446 | Change deadline horizon (30/60/90 days) and re-render |
| `_getExpiringItems()` | 451 | Collect items expiring within the deadline horizon |
| `_getLastMeasureDate()` | 478 | Find latest measure deadline across all vendors |
| `_initTimelineDrag()` | 561 | Setup drag on timeline date line; updates residual matrix |

### Risk Matrix

| Function | Line | Purpose |
|----------|------|---------|
| `_renderResidualMatrix(atDate)` | 492 | SVG 5x5 risk matrix at a given date |

### Vendor List

| Function | Line | Purpose |
|----------|------|---------|
| `renderVendorList()` | 717 | Render vendor cards with search, status filter |
| `renderSubcontractorList()` | 632 | Card listing of the DORA subcontractors |
| `filterVendors(val)` | 619 | Set text filter, re-render |
| `filterVendorStatus(val)` | 621 | Set status filter, re-render |
| `openVendor(idx)` | 842 | Select vendor by index, switch to detail view |

### Vendor Detail

| Function | Line | Purpose |
|----------|------|---------|
| `renderVendorDetail()` | 851 | Render vendor header + tab content |
| `_renderVendorForm(v)` | 1092 | Identity form, contacts, contract, classification sliders, exposure result |
| `_renderVendorRisks(v)` | 1357 | Risk table with linked measures |
| `_renderVendorAssessments(v)` | 1953 | Weighted maturity detail and assessment list |
| `_renderVendorDocs(v)` | 2007 | Documents table + confidence selector |
| `_renderVendorDoraTab(v)` | 934 | DORA RoI identity fields and arrangements of the vendor |
| `_vendorAvatar(v)` | 5721 | Render logo image or initials fallback |
| `_vendorInitials(name)` | 5713 | Extract initials from vendor name |

### Classification / Exposure

| Function | Line | Purpose |
|----------|------|---------|
| `_computeExposure(ex)` | 1202 | Threat formula: (D x P) / (M x C), `null` when not assessed |
| `_fullExposure(v)` | 1221 | Recompute the four exposure factors from classification and validated assessments |
| `_refreshThreatDisplay()` | 1241 | Update threat level display without full re-render |
| `_exposureClass(level)` | 1280 | CSS class for exposure level |
| `_exposureLabel(level)` | 1291 | Translated label for exposure level |
| `_avgSliders(vals)` | 1302 | Average of slider values (rounded to 1 decimal) |
| `_computeClassificationScore(c)` | 1307 | Average of the 6 classification criteria |
| `_isDoraICTCritical(c)` | 1315 | Check DORA ICT critical thresholds |
| `_slider(labelKey, id, value, max)` | 1324 | Render a slider input with value label |
| `_onSliderChange(el)` | 1333 | Handle slider change: recompute D/P, save, refresh display |
| `_getTier(v)` | 5609 | Vendor tier from exposure: critical/high/medium/low/unassessed |
| `_scoreToMaturite(score)` | 5621 | Convert maturity score (0-100) to maturity (1-4) |

### Templates

| Function | Line | Purpose |
|----------|------|---------|
| `_ensureDefaultTemplate()` | 2605 | Heal existing templates and seed the default templates `TPL-001` / `TPL-002` |
| `renderTemplateList()` | 2834 | Template list view |
| `createTemplate(kind)` | 2876 | Create a questionnaire or audit template |
| `duplicateTemplate(tplId)` | 2903 | Duplicate a template |
| `deleteTemplate(tplId)` | 2918 | Delete a template |
| `renderTemplateEditor(tplId)` | 2927 | Template editor: sections and questions |
| `downloadTemplateExcelExample()` | 5121 | Generate the example `.xlsx` for template import (ExcelJS) |
| `importTemplateFromExcel()` | 5196 | Create a template from an `.xlsx` file |

### Assessment

| Function | Line | Purpose |
|----------|------|---------|
| `newAssessment(vendorId)` | 2453 | Dialog: choose the template of a new assessment |
| `_newAssessmentFromTemplate(vendorId)` | 3284 | Create the assessment with a snapshot of the chosen template |
| `openAssessmentDispatch(assessId)` | 2247 | Open an assessment |
| `openAssessmentFromVendor(assessId, vendorIdx)` | 2252 | Open an assessment with return-to-vendor context |
| `openAssessmentV2(assessId)` | 3330 | Render the assessment: questions, coverage, action plans, workflow buttons |
| `_migrateAssessmentToV2(a)` | 3535 | Migrate a legacy assessment to the template-based format |
| `_setCoverage(assessId, questionId, coverage)` | 3809 | Set the coverage of a response |
| `_toggleSelfValidation(assessId, checked)` | 3979 | Self-validation, required before submission |
| `_submitForApproval(assessId)` | 3989 | Status `pending_approval` |
| `_approveAssessment(assessId)` | 4004 | Status `validated`, action plans become vendor measures |
| `_rejectAssessment(assessId)` | 4019 | Status `rejected` with a reason |
| `_materializeActionPlans(a)` | 4033 | Add a vendor measure for each action plan of an approved assessment |
| `_computeAssessmentV2Score(a)` | 4074 | Weighted score: covered=100%, partial=50%, not applicable excluded |
| `_assessmentStats(a)` | 3738 | Count answered responses, missing coverage and missing action plans |
| `_computeVendorMaturityDetail(vendorId)` | 4142 | Weighted maturity score of a vendor |
| `deleteAssessment(assessId)` | 2258 | Delete assessment |
| `_scoreColorClass(pct)` | 5741 | CSS class from percentage (>= 80 low, >= 60 medium, >= 40 high, else critical) |

### Vendor Portal and Assessment Import / Export

| Function | Line | Purpose |
|----------|------|---------|
| `_exportAssessmentJSON(assessId)` | 4362 | Export an assessment as `.json` / `.ctenc` |
| `_exportAssessmentExcel(assessId)` | 4619 | Export an assessment as `.xlsx` (ExcelJS) |
| `_generatePortalLink(assessId)` | 4470 | Build the Vendor Portal link: gzip, AES-256-GCM, base64url in the URL hash |
| `_copyEmailTemplate(assessId)` | 4551 | Copy the HTML email template for the vendor |
| `_importAssessmentIntoExisting(assessId)` | 4829 | Import a vendor response into an existing assessment |
| `_handleImportedJSON(text, existingAssessId, vendorId)` | 4877 | Import a `.json` / `.ctenc` response |
| `_handleImportedExcel(file, existingAssessId, vendorId)` | 4968 | Import an `.xlsx` response (ExcelJS) |
| `_loadExcelJS()` | 5603 | Load ExcelJS on demand from `js/vendor/` (same origin) through `_loadScript()` |

### Risk

| Function | Line | Purpose |
|----------|------|---------|
| `renderRiskList()` | 2132 | Global risk register with filters |
| `_onRiskFilterChange()` | 2202 | Update filter state from DOM, re-render risk list |
| `addRiskForVendor(vendorId)` | 2390 | Create empty risk linked to vendor |
| `updateRiskField(riskIdx, field, value)` | 2405 | Update risk field |
| `deleteRisk(riskIdx)` | 2441 | Delete risk |

### Measures

| Function | Line | Purpose |
|----------|------|---------|
| `renderGlobalMeasures()` | 5365 | Cross-vendor measures registry table |
| `addMeasureForRisk(vendorIdx, riskIdx)` | 1577 | Create a measure linked to a risk (shared measure dialog) |
| `updateVendorMeasure(vendorIdx, measureIdx, field, value)` | 1622 | Update measure field |
| `deleteVendorMeasure(vendorIdx, measureIdx)` | 1636 | Delete measure with confirmation |
| `deleteUnlinkedMeasures()` | 5551 | Bulk delete measures not linked to any risk |
| `editMeasure(vendorIdx, measureIdx, _returnTo)` | 5577 | Open the shared measure dialog |

### Documents

| Function | Line | Purpose |
|----------|------|---------|
| `renderDocList()` | 2227 | Global documents view grouped by vendor |
| `_renderDocsTable(docs, tableId)` | 2035 | Render editable documents table |
| `_docTypeLabel(type)` | 2072 | Human-readable document type label |
| `addDocument()` | 2090 | Add document with prompt for name |
| `deleteDoc(docId)` | 2107 | Delete document |
| `updateDocField(docId, field, value)` | 2080 | Update document field |
| `updateVendorConfiance(el)` | 2113 | Set vendor confidence level from documents tab |
| `_verifyAndAddDoc(vendorId, doc)` | 5625 | Verify URL then add document (server-side check when a backend API is present, `no-cors` fetch otherwise) |

### AI Integration

| Function | Line | Purpose |
|----------|------|---------|
| `aiCollectInfo()` | 6047 | AI auto-fill of vendor information |
| `aiCollectDocs()` | 6148 | AI-powered document URL discovery |
| `_applyAiData(v, data)` | 6263 | Apply AI response to vendor object |
| `suggestMeasuresForRisk(vendorIdx, riskIdx)` | 1662 | AI-suggest measures for a specific risk |
| `aiSuggestRisksAndMeasures(vendorIdx)` | 1806 | AI-suggest risks + measures for a vendor |
| `_aiSuggestRisksCustom(vendorIdx, prompt)` | 1757 | Custom prompt risk suggestion |
| `_aiSuggestMeasuresCustom(vendorIdx, riskIdx, prompt)` | 1782 | Custom prompt measure suggestion |
| `openAiRiskAssistant(vendorIdx)` | 1690 | Open AI assistant panel with risk/measure generation options |
| `aiRunRiskSuggestion(vendorIdx)` | 1734 | Execute risk suggestion |
| `aiRunMeasureSuggestion(vendorIdx)` | 1745 | Execute measure suggestion |
| `aiSuggestSectionV2(assessId, sectionId)` | 3457 | AI-suggest coverage and justification for the questions of an assessment section |
| `_renderAiCards()` | 1842 | Render AI suggestion cards in the panel |

### Settings

| Function | Line | Purpose |
|----------|------|---------|
| `_isDoraEnabled()` | 5784 | Check DORA mode from localStorage |
| `_getDoraThresholds()` | 5787 | Read DORA thresholds from localStorage |
| `_doraSettingsHTML()` | 5793 | Render DORA settings section (toggle + thresholds) |
| `_wireDoraSettings()` | 5813 | Wire DORA toggle show/hide |
| `_saveDoraSettings()` | 5820 | Save DORA settings to localStorage |
| `_customQuestionnaireHTML()` | 5885 | Render custom questionnaire settings section |
| `_wireCustomQuestionnaire()` | 5906 | Wire file input and clear button |
| `_importCustomQuestionnaire(csvText)` | 5928 | Parse CSV into `D._custom_questionnaire` |
| `downloadQuestionnaireTemplate()` | 5989 | Download CSV template for custom questionnaires |
| `_initDataAndRender(cb)` | 5832 | After a load: schema migration, DORA migration, register setup, reset state, render |

The settings panel sections are declared in `window.AI_APP_CONFIG.settingsExtraHTML`: DORA, custom questionnaire, and the demo loader (`_demoSettingsHTML()` / `_wireDemoSettings()` from `cisotoolbox_local.js`).

### Helpers

| Function | Line | Purpose |
|----------|------|---------|
| `_vendorName(id)` | 5728 | Resolve vendor ID to display name |
| `_scoreClass(score)` | 5732 | CSS class from risk score (1-25) |
| `_field(labelKey, id, value, type)` | 5750 | Render a form field with label and auto-save |
| `_select(labelKey, id, value, options)` | 5753 | Render a select field with label and auto-save |
| `_showModal(content)` | 5761 | Display modal overlay with content |
| `closeModal()` | 5774 | Remove modal overlay |
| `_autoSaveVendorField()` | 2311 | Debounced (400ms) auto-save: collect all form fields into vendor object |
| `saveVendor()` | 2365 | Alias for `_autoSaveVendorField()` |
| `addVendor()` | 2276 | Create vendor with prompt, auto-trigger AI collection if enabled |
| `deleteVendor(idx)` | 2367 | Delete vendor + its risks and assessments, settle its register records |
| `_fetchLogo()` | 5674 | Load logo from URL, resize to 64x64, store as base64 |
| `renderHistory()` | 6422 | Snapshots panel (delegates to `_renderSnapshotsPanel()`) |
| `renderNonconformities()` | 6545 | Non-conformity and derogation register panel |

---

## 8. Questionnaire System

### Templates

Assessments are driven by templates (`D.questionnaire_templates`), edited on the **Templates** page or imported from an `.xlsx` file. A template is a `questionnaire` (filled by the vendor, possibly through the Vendor Portal) or an `audit` (filled internally). Its questions are free text, each with a weight (0-100) and a criticality (`info` / `major` / `blocker`).

When an assessment is created, the chosen template is copied into `template_snapshot`, so later edits of the template do not affect it.

### Default Questions

Defined in `TPRM_questions.js`:

**`TPRM_QUESTIONS`** (25 questions): Essential security assessment covering 13 domains. They seed the default template `TPL-001` (one section per domain).

| Domain | Questions | Key Topics |
|--------|-----------|------------|
| `governance` | Q01-Q03 | ISSP, risk analysis, CISO |
| `access_management` | Q04-Q06 | SSO/SCIM, MFA/PAM, access reviews |
| `network` | Q07 | Network segmentation |
| `vulnerability_mgmt` | Q08-Q09 | Patch management, pentesting |
| `dev_security` | Q10-Q11 | Env isolation, SAST/DAST/SCA |
| `data_protection` | Q12-Q14 | Encryption, GDPR, classification |
| `endpoint_protection` | Q15 | EDR + SIEM |
| `incident_response` | Q16-Q17 | IR plan, notification timelines |
| `continuity` | Q18-Q19 | Backup/RTO/RPO, HA architecture |
| `supply_chain` | Q20 | 4th-party inventory |
| `hr_security` | Q21-Q22 | Security training, background checks |
| `cloud_security` | Q23-Q24 | Hosting model, logging |
| `compliance` | Q25 | Certifications validity |

**`TPRM_DORA_QUESTIONS`** (5 questions, D01-D05) are also defined:

| ID | Domain | Topic |
|----|--------|-------|
| D01 | `dora_resilience` | Digital operational resilience testing (TLPT) |
| D02 | `dora_exit` | Exit plan / data reversibility |
| D03 | `dora_notification` | Major incident notification process |
| D04 | `dora_subcontracting` | ICT subcontracting chain control |
| D05 | `dora_location` | Data/processing location, EU transfers |

Each default question has `id`, `domain`, bilingual `text_*`, `expected_*`, `red_flags_*`, `evidence_*` fields and a `weight` (6, 8 or 10). The seeded template takes the text in the current language.

The audit template `TPL-002` is built by `_buildAnssi42AuditTemplate()` from the 42 ANSSI hygiene rules, in 10 groups.

### Scoring

`_computeAssessmentV2Score()` calculates a weighted percentage (see §6). The vendor maturity score aggregates the validated assessments and feeds the Maturity factor of the threat formula through `_scoreToMaturite()`.

### Custom Questionnaire (settings)

The settings panel offers a CSV/TSV import (columns `id`, `domain`, `question`, `expected`, `red_flags`, `evidence`, `weight`; template downloadable from the panel). The parsed questions are stored in `D._custom_questionnaire` and the panel shows their count; assessments themselves are built from templates.

### Supporting Data

- **`TPRM_RISK_CATEGORIES`**: 7 risk categories (CYBER, OPS, FIN, COMP, STRAT, REP, GEO) with bilingual labels
- **`TPRM_CERTIFICATIONS`**: 14 certification names (ISO 27001, SOC 2, HDS, PCI DSS, etc.)

---

## 9. Shared Libraries

Key functions from the shared files used by TPRM:

| Function | File | Purpose |
|----------|------|---------|
| `esc(v)` | `cisotoolbox.js` | HTML-escape user data (prevents XSS) |
| `_da(...)` | `cisotoolbox.js` | JSON-encode data-args for event delegation |
| `showStatus(msg)` | `cisotoolbox.js` | Display status message in toolbar |
| `_saveState()` | `cisotoolbox.js` | Push undo snapshot |
| `ctRenderMatrix(opts)` | `cisotoolbox.js` | Render SVG risk matrix |
| `ctBadge(text, colorName)` | `cisotoolbox.js` | Render a colored badge |
| `colsButton(tableId)` | `cisotoolbox.js` | Render column visibility toggle button |
| `hd(key)` | `cisotoolbox.js` | Generate `data-col` attribute for column hide/show |
| `_setupTable(tableId)` | `cisotoolbox.js` | Initialize column hide/show and resize for a table |
| `_initSliders()` | `cisotoolbox.js` | Apply color styling to range inputs |
| `_applySliderStyle(el)` | `cisotoolbox.js` | Style a single slider based on value |
| `badge(text, color)` | `cisotoolbox.js` | Simple colored badge |
| `toggleHelp(tab)` | `cisotoolbox.js` | Open/close help overlay |
| `switchHelpTab(tab)` | `cisotoolbox.js` | Switch between help tabs (methodology, usage, DORA) |
| `toggleMenu()` | `cisotoolbox.js` | Toggle toolbar dropdown menus |
| `_menuAction(fnName)` | `cisotoolbox.js` | Dispatch File menu actions |
| `toggleSidebar()` | `cisotoolbox.js` | Collapse/expand sidebar |
| `_toggleSidebarMobile()` | `cisotoolbox.js` | Mobile hamburger menu |
| `_updateSidebarAccordion(panelId)` | `cisotoolbox.js` | Update active rail item |
| `_icon(name)` | `cisotoolbox.js` | Inline SVG icon |
| `_loadScript(url, opts)` | `cisotoolbox.js` | Load a script once, returns a Promise |
| `_autoSave()` | `cisotoolbox_local.js` | Save `D` to localStorage |
| `_persist()`, `_persistCreate()`, `_persistDelete()` | `cisotoolbox_local.js` | Persistence adapter; in this app each call is an `_autoSave()` |
| `_loadAutoSave()` | `cisotoolbox_local.js` | Restore from localStorage |
| `_checkAutoSaveBanner()` | `cisotoolbox_local.js` | Show restore banner if autosave exists |
| `_installUndoHook()` | `cisotoolbox_local.js` | Push the previous state on the undo stack at each `_autoSave()` |
| `_renderSnapshotsPanel(opts)` | `cisotoolbox_local.js` | Snapshots panel (create, encrypt, restore, export, delete) |
| `saveJSON()`, `openFile()`, `loadJSON(event)` | `cisotoolbox_local.js` | Save / open a project file |
| `ctRefRegister(uid, cfg)` | `ct_refselect.js` | Register a ct-ref-select dropdown instance |
| `ctRefSelect(uid, value, options, opts)` | `ct_refselect.js` | Render multi-select dropdown with tags |

### CT_CONFIG Integration

TPRM registers with cisotoolbox.js via `window.CT_CONFIG`:

```javascript
{
    autosaveKey: "tprm_autosave",
    initDataVar: "TPRM_INIT_DATA",
    filePrefix: "TPRM",
    labelKey: "toolbar.subtitle",
    getSociete: function (data) { return (data.metadata && data.metadata.organization) || ""; },
    getDate: function (data) { return (data.metadata && data.metadata.created) || ""; }
}
```

---

## 10. Event System

TPRM uses the `data-click` / `data-change` / `data-input` event delegation system from cisotoolbox.js. No inline `onclick=` handlers.

### Event Attributes

| Attribute | Trigger | Example |
|-----------|---------|---------|
| `data-click="fnName"` | click | `<button data-click="addVendor">` |
| `data-change="fnName"` | change (select, checkbox) | `<select data-change="_autoSaveVendorField">` |
| `data-input="fnName"` | input (real-time typing) | `<input data-input="_onSliderChange">` |
| `data-args='[...]'` | JSON array of arguments | `data-args='["dashboard"]'` |
| `data-pass-value` | Pass element's `.value` as last arg | On inputs and selects |
| `data-pass-el` | Pass the DOM element as last arg | On sliders |
| `data-stop` | Call `event.stopPropagation()` | On nested clickable elements |
| `data-click-self="fnName"` | Click only on the element itself (not children) | Help overlay background |

### Dispatch Mechanism

cisotoolbox.js uses `_safeDispatch()` which:
1. Refuses names on a blocklist of dangerous functions (`eval`, `Function`, `fetch`, `open`, `alert`, etc.)
2. Calls `window[fnName]` if it is a function, with the arguments assembled from `data-args` and, when present, `data-pass-value` / `data-pass-el`

### Window Exports

Public functions are explicitly exported to `window` to be reachable by the event system:
```javascript
window.deleteVendor = deleteVendor;
window.editMeasure = editMeasure;
// etc.
```

---

## 11. Security

### Content Security Policy

The app ships no headers of its own; `.htaccess.example` (Apache) and `nginx-security.conf.example` (nginx) set them:
- `script-src 'self'` -- no inline scripts, no `unsafe-eval`
- `style-src 'self' 'unsafe-inline'` -- inline styles allowed (for dynamic styling)
- `connect-src 'self' https://api.anthropic.com https://api.openai.com https://api.gleif.org`
- `frame-ancestors 'none'` -- no iframe embedding
- `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`; the nginx file also sets HSTS

### XSS Prevention

- User data passes through `esc()` before insertion into HTML strings (HTML entity encoding)
- **`_da()`** JSON-encodes arguments for `data-args`
- `tEsc()` escapes translations looked up with a dynamic key
- `data-i18n-html` content is filtered by `_applyStaticTranslations()` (dangerous tags, event attributes and URL schemes removed) and is reserved for developer-authored help content
- **No `onclick=`** -- all event handling via `data-click` delegation with blocklist validation

### Encryption

- **AES-256-GCM** with PBKDF2 (250,000 iterations, SHA-256) for saved files, encrypted snapshots and Vendor Portal links
- Password prompt via overlay (not `prompt()`)
- Key derivation and encryption in `cisotoolbox.js` (`_deriveKey`, `_encryptData`, `_decryptData`); file save/open in `cisotoolbox_local.js` (`saveJSON()` / `openFile()`)

### API Key Security

- AI API keys stored in `localStorage` only (`tprm_ai_apikey`), never in saved files
- A privacy warning is displayed when the AI assistant is enabled in the settings

### Parsing

- JSON parsing uses standard `JSON.parse()` -- no custom deserialization

---

## 12. i18n System

### Architecture

- **Both languages are loaded at startup**: `index.html` includes `i18n_core_en.js`, `i18n_core_fr.js`, `TPRM_i18n_fr.js` and `TPRM_i18n_en.js` as static `<script>` tags; `i18n.js` marks `fr` and `en` as loaded
- **Initial language**: the stored preference `localStorage["ct_lang"]`, else the browser language when it is available, else the base language, English (`_baseLang`, overridable with `window._CT_BASE_LANG`)
- Global `_locale` variable tracks the current language (`"fr"` or `"en"`)
- Each translation file registers its keys with `_registerTranslations(lang, dict)`

### Translation Functions

| Function | Usage |
|----------|-------|
| `t("key")` | Get translated string; falls back to the base language, then to the key itself |
| `t("key", {var: val})` | With interpolation: `{var}` replaced by `val` |
| `tEsc("key")` | HTML-escaped `t()`, for dynamic keys rendered as HTML |
| `_rt(obj, field)` | Bilingual field: `obj[field + "_en"]` when the locale is English and it exists, else `obj[field]` |
| `data-i18n="key"` | HTML attribute: text translated by `_applyStaticTranslations()` |
| `data-i18n-html="key"` | HTML attribute: translated as filtered innerHTML (help pages) |
| `data-i18n-title`, `data-i18n-placeholder` | HTML attributes: translated `title` / `placeholder` |

### Key Naming Convention

Keys follow the pattern `{section}.{item}`:
- `nav.dashboard`, `nav.vendors`, `nav.risks`, `nav.measures`, `nav.documents`, `nav.templates`, `nav.dora`
- `vendor.name`, `vendor.status_active`, `vendor.tier_critical`
- `risk.impact`, `risk.treatment_mitigate`
- `assessment.score`, `coverage.covered`, `coverage.not_covered`
- `template.new`
- `measure.planifie`, `measure.en_cours`, `measure.termine`
- `dashboard.total_vendors`, `dashboard.critical_risks`
- `ai.collecting`, `ai.generate_risks`
- `settings.dora_section`, `settings.custom_questionnaire`
- `dora.export.reporting_period`

### Language Switching

The globe button of the app bar (`ct_toggleLang`) opens a menu of the available languages; choosing one calls `ct_setLang(lang)`, which calls `switchLang(lang, renderAll)`. The settings panel (`ct_settings.js`) also calls `switchLang()`.

`switchLang(lang, cb)` (from i18n.js):
1. Calls `_loadI18nFile(lang)`, which returns at once since both languages are already loaded
2. Sets `_locale` and stores the choice in `localStorage["ct_lang"]`
3. Calls `_applyStaticTranslations()` to update the `data-i18n*` elements
4. Calls `renderAll()` to rebuild dynamic content, then the callback

The language button is hidden when a single language is available.

### Bilingual Data

The default questions carry both `text_fr`/`text_en`, `expected_fr`/`expected_en`, etc. When the default templates are seeded, the text of the current language is copied into the template; templates and their assessments are single-language (`template.language`).

---

## 13. DORA Register of Information

- **Storage**: the RoI lives in `D.dora` (see §4), in the same autosave and project file as the rest of the data. `TPRM_dora.js` binds its tree to `D.dora` (`_loadTree()`, `DoraData.ensureLoaded()`); its edits call `_persist()` / `_persistCreate()` / `_persistDelete()`, which in this app all perform an `_autoSave()` of `D`. After a file load, `_initDataAndRender()` runs `_doraMigrate(D)` and `DoraData.invalidate()` so the panel binds to the new tree.
- **Vendor identity fields** for the register (LEI, legal name, country, etc.) are stored on the vendor objects and edited in the vendor's DORA tab.
- **`window.DoraData`**: read API used by `TPRM_app.js` (`getTree`, `ensureLoaded`, `invalidate`, `arrangementsForVendor`, `subcontractorsForVendor`, `signersForVendor`, `roiStatus`, `renderVendorCard`, `renderSubcontractors`, …).
- **Codelists**: `dora_codelists.js` publishes the EBA codelists (DPM v4.0) as `window._doraCodelists`; `dora_codelists_i18n.js` registers their FR / EN labels. The stored value is the code, the label is translated.
- **Validation**: `TPRM_dora_validation.js` exposes non-blocking validators as `window._doraValid` (LEI and its checksum, country, currency, date, reporting period, EBA code).
- **LEI lookup**: from LEI fields, `TPRM_dora.js` queries the GLEIF API (`https://api.gleif.org/api/v1/lei-records`).
- **Export**: File menu → DORA RoI export (`doraOpenExportModal`) asks for the reporting period and target currency, then `window._doraExportEBA(tree, codelists, targetCurrency)` (`TPRM_dora_export.js`) builds an XLSX workbook with one sheet per table from B_01.01 to B_07.01, using ExcelJS loaded through `_loadExcelJS()`.
