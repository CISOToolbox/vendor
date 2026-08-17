# Vendor (TPRM) Module — Architecture Document

## 1. Overview

**Vendor** is a Third-Party Risk Management (TPRM) application within the CISO Toolbox suite. It enables CISOs and security teams to inventory vendors, classify their exposure, assess their security posture via questionnaires, track risks with mitigation measures, and manage compliance documentation.

- **URL**: https://vendor.cisotoolbox.org
- **Architecture**: 100% client-side vanilla JavaScript, no framework, no build step
- **Data storage**: Browser localStorage (autosave) + JSON file download for persistence
- **Encryption**: AES-256-GCM with PBKDF2 for saved files (provided by cisotoolbox.js)

---

## 2. File Structure

All application files reside under `vendor/app/`.

| File | Size | Purpose |
|------|------|---------|
| `index.html` | 6 KB | Single HTML page: toolbar, sidebar, content container, overlays (help, confirm, password) |
| `css/cisotoolbox.css` | 18 KB | Shared stylesheet: toolbar, sidebar, tables, buttons, layout, responsive, sliders |
| `css/tprm.css` | 12 KB | App-specific styles: dashboard cards, vendor cards, tier badges, assessment pills, risk matrix, forms, help overlay, responsive overrides |
| `js/TPRM_app.js` | 206 KB | Main application: all navigation, rendering, CRUD, formulas, AI integration, export/import |
| `js/TPRM_questions.js` | 28 KB | Security questionnaire definitions: 25 essential + 5 DORA questions, risk categories, certifications list |
| `js/TPRM_i18n_fr.js` | 40 KB | French translations (loaded at startup) |
| `js/TPRM_i18n_en.js` | 36 KB | English translations (lazy-loaded on demand) |
| `js/cisotoolbox.js` | 41 KB | Shared library: `esc()`, `_da()`, event delegation, file I/O, AES-256 encryption, undo/redo, autosave, sliders, column hide/show/resize, matrix rendering |
| `js/cisotoolbox_local.js` | 15 KB | Local-only extensions: autosave banner, localStorage management |
| `js/i18n.js` | 12 KB | Bilingual system: `t()`, `_registerTranslations()`, `switchLang()`, lazy-loading |
| `js/ai_common.js` | 36 KB | AI providers (Anthropic Claude, OpenAI GPT): API calls, settings panel, key validation |
| `js/ct_refselect.js` | 6 KB | Multi-select dropdown widget with tags, search, deferred re-render |
| `js/referentiels_catalog.js` | 3 KB | Compliance frameworks catalog (shared across apps) |
| `favicon.svg` | 5 KB | App icon |

---

## 3. Architecture Diagram

```
+-------------------------------------------------------------------+
|  Browser                                                          |
|                                                                   |
|  index.html                                                       |
|  +-------------------------------------------------------------+ |
|  | Toolbar  [File menu] [Status] [Settings/Lang/AI]            | |
|  +-------------------------------------------------------------+ |
|  | Sidebar         | Main Content (#content)                   | |
|  | +-----------+   | +---------------------------------------+ | |
|  | | Dashboard |   | | renderPanel() switch:                 | | |
|  | | Vendors   |   | |   dashboard  -> renderDashboard()     | | |
|  | | Risks     |   | |   vendors    -> renderVendorList()    | | |
|  | | Measures  |   | |              -> renderVendorDetail()   | | |
|  | | Documents |   | |   risks      -> renderRiskList()      | | |
|  | | --------- |   | |   measures   -> renderGlobalMeasures()| | |
|  | | Methodo   |   | |   documents  -> renderDocList()       | | |
|  | | Usage     |   | +---------------------------------------+ | |
|  | +-----------+                                                | |
|  +--------------------------------------------------------------+ |
|                                                                   |
|  +------------------+  +-------------------+  +-----------------+ |
|  | cisotoolbox.js   |  | i18n.js           |  | ai_common.js    | |
|  | - esc(), _da()   |  | - t(), switchLang |  | - API calls     | |
|  | - autosave       |  | - translations    |  | - settings      | |
|  | - AES encrypt    |  +---------+---------+  | - key mgmt      | |
|  | - matrix SVG     |            |            +-----------------+ |
|  | - event dispatch |  +---------+---------+                      |
|  | - column mgmt    |  | TPRM_i18n_fr.js  |                      |
|  +------------------+  | TPRM_i18n_en.js  |                      |
|                        +-------------------+                      |
|  +------------------+  +-------------------+                      |
|  | TPRM_questions.js|  | ct_refselect.js  |                      |
|  | - 25 questions   |  | - tag dropdowns  |                      |
|  | - 5 DORA Q's     |  +-------------------+                      |
|  | - risk categories|                                             |
|  | - certifications |                                             |
|  +------------------+                                             |
|                                                                   |
|  Data layer: D (global object)                                    |
|  +------------------------------------------------------------+  |
|  | D.vendors[]  D.risks[]  D.assessments[]  D.documents[]     |  |
|  | D.metadata   D._custom_questionnaire[]                     |  |
|  +------------------------------------------------------------+  |
|          |                    |                                    |
|  localStorage (autosave)     JSON file (save/load + AES-256)     |
+-------------------------------------------------------------------+
```

---

## 4. Data Model

All data lives in the global `D` object, initialized from `TPRM_INIT_DATA`.

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
| `country` | string | Country code (FR, US, DE...) |
| `sector` | string | Business sector |
| `website` | string | Vendor website URL |
| `siret` | string | SIRET / company registration number |
| `logo` | string | Base64-encoded PNG (max 64x64) or empty |
| `status` | string | `prospect` / `active` / `review` / `offboarded` |
| `contact` | object | `{name, email}` -- vendor contact |
| `internal_contact` | object | `{name, email}` -- internal owner |
| `contract` | object | `{services, start_date, end_date, review_date}` |
| `classification` | object | 6 criteria (0-4 each): `ops_impact`, `processes`, `replace_difficulty`, `data_sensitivity`, `integration`, `regulatory_impact`, `gdpr_subprocessor` (boolean) |
| `exposure` | object | `{dependance, penetration, maturite, confiance}` -- computed from classification + assessment |
| `certifications` | array | `[{name, expiry_date}]` |
| `dpa_signed` | boolean | DPA signed |
| `sub_contractors` | array | Known sub-contractors (strings) |
| `measures` | array | Mitigation measures (see below) |
| `notes` | string | Free-text notes |

**Vendor measures** (in `vendor.measures[]`):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Format `PP-001-M01` |
| `mesure` | string | Short title |
| `details` | string | Implementation steps |
| `type` | string | `Contractuelle` / `Technique` / `Organisationnelle` / `Surveillance` |
| `statut` | string | `planifie` / `en_cours` / `termine` |
| `responsable` | string | Owner |
| `echeance` | string | Due date (ISO) |
| `ref_socle` | string | Reference standard (ISO 27001 A.x.x, ANSSI...) |
| `effet` | string | Expected effect |

### D.risks[]

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Format `PP-001-R01` |
| `vendor_id` | string | Links to `vendor.id` |
| `title` | string | Risk title (client impact, not vendor weakness) |
| `description` | string | Detailed description |
| `category` | string | `CYBER` / `OPS` / `FIN` / `COMP` / `STRAT` / `REP` / `GEO` |
| `impact` | int | 1-5 (inherent) |
| `likelihood` | int | 1-5 (inherent) |
| `treatment` | object | `{response, details, due_date}` -- response: `mitigate` / `transfer` / `accept` / `avoid` |
| `residual_impact` | int | 0-5 (0 = not evaluated; capped at impact) |
| `residual_likelihood` | int | 0-5 (0 = not evaluated; capped at likelihood) |
| `status` | string | `needs_treatment` / `active` / `closed` / `archived` |
| `linked_measures` | string | Comma-separated `"PP-001-M01 - title, PP-001-M02 - title"` |

### D.assessments[]

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Format `EVAL-001` |
| `vendor_id` | string | Links to `vendor.id` |
| `type` | string | `periodic` / `onboarding` |
| `date` | string | Assessment date (ISO) |
| `status` | string | `draft` / `in_progress` / `completed` |
| `responses` | array | `[{question_id, answer, comment}]` |
| `score` | int/null | Weighted score 0-100 |
| `completion_rate` | int | Percentage 0-100 |

**Responses**: `answer` is one of `compliant`, `partial`, `non_compliant`, `na`.

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

### D._custom_questionnaire[]

Optional custom questionnaire replacing the defaults. Same structure as `TPRM_QUESTIONS` items. Stored in the project JSON file. Imported via CSV in settings.

---

## 5. Navigation

### Panel System

Navigation is sidebar-driven. The current panel is stored in `_panel` (string).

**`selectPanel(id)`** (line ~31): Sets `_panel`, resets `_selectedVendor` to null, updates sidebar active state, calls `renderPanel()`.

**`renderPanel()`** (line ~39): Central render dispatcher. Switches on `_panel`:

| Panel ID | Renderer | Notes |
|----------|----------|-------|
| `dashboard` | `renderDashboard()` | KPI cards, dual risk matrices, timeline, top risks, deadlines |
| `vendors` | `renderVendorList()` or `renderVendorDetail()` | List if `_selectedVendor` is null; detail with tabs otherwise |
| `risks` | `renderRiskList()` | Global risk register with filters |
| `measures` | `renderGlobalMeasures()` | Cross-vendor measure registry |
| `documents` | `renderDocList()` | All documents grouped by vendor |

After rendering, `renderPanel()` also:
- Initializes sliders (`_initSliders()`)
- Sets up timeline drag handler (`_initTimelineDrag()`)
- Configures column hide/show/resize for all tables (`_setupTable()`)

### Vendor Detail Tabs

Within vendor detail, `_vendorTab` controls which sub-view renders:

| Tab | Function | Content |
|-----|----------|---------|
| `info` | `_renderVendorForm(v)` | Identity, contacts, contract, classification sliders, exposure, GDPR, notes |
| `risks` | `_renderVendorRisks(v)` | Risk table with linked measures (in-place + planned), measures registry below |
| `assessments` | `_renderVendorAssessments(v)` | Assessment list with progress bars, score display |
| `documents` | `_renderVendorDocs(v)` | Documents table, confidence selector |

---

## 6. Key Formulas

### Threat Level (Menace)

Computed by `_computeExposure(ex)` (line ~779):

```
Threat = (Dependency x Penetration) / (Maturity x Confidence)
```

Where:
- **Dependency** = average of `ops_impact`, `processes`, `replace_difficulty` (each 0-4)
- **Penetration** = average of `data_sensitivity`, `integration`, `regulatory_impact` (each 0-4)
- **Maturity** (0-4): derived from the latest assessment score via `_scoreToMaturite()`
- **Confidence** (0-4): manual rating set in the Documents tab

Returns 0 if any denominator component is 0 (incomplete data).

### Exposure Thresholds

Used by `_getTier(v)` (line ~3034) and `_exposureClass(level)` (line ~828):

| Threat Value | Tier | CSS Class |
|-------------|------|-----------|
| >= 3 | Critical | `score-critical` |
| >= 2 | High | `score-high` |
| >= 1 | Medium | `score-medium` |
| < 1 | Low | `score-low` |

Note: `_exposureClass` and `_exposureLabel` use slightly different thresholds (>=4 for critical, >=2 for high, >=1 for moderate) for display labels.

### Dependency Score

Computed by `_avgSliders()` (line ~842):

```
Dependency = round(avg(ops_impact, processes, replace_difficulty) * 10) / 10
```

### Penetration Score

```
Penetration = round(avg(data_sensitivity, integration, regulatory_impact) * 10) / 10
```

### Classification Score

Computed by `_computeClassificationScore(c)` (line ~848): average of all 6 classification criteria.

### Score to Maturity Mapping

`_scoreToMaturite(score)` (line ~3043):

| Assessment Score | Maturity Level |
|-----------------|---------------|
| 80-100% | 4 |
| 60-79% | 3 |
| 40-59% | 2 |
| 20-39% | 1 |
| 0-19% | 0 |

### Assessment Score

`_computeAssessmentScore(a, questions)` (line ~2037):

```
Score = sum(answered_weight) / sum(applicable_weight) * 100

Where per question:
  - compliant  -> full weight
  - partial    -> 50% weight
  - non_compliant -> 0
  - na         -> excluded from both numerator and denominator
```

### Risk Score

```
Inherent Score = Impact x Likelihood  (range 1-25)
Residual Score = Residual_Impact x Residual_Likelihood  (range 1-25)
```

Score thresholds (used by `_scoreClass()`, line ~3146):

| Score | Level |
|-------|-------|
| >= 16 | Critical |
| >= 10 | High |
| >= 5 | Medium |
| < 5 | Low |

### DORA ICT Critical Detection

`_isDoraICTCritical(c)` (line ~856):

A vendor is flagged as DORA ICT critical when **DORA mode is enabled** AND either:
- Number of classification criteria at maximum value (4) >= threshold (default 3), OR
- Average of all 6 classification criteria >= threshold (default 3.5)

Thresholds are configurable in Settings (stored in localStorage).

---

## 7. Functions Reference

### Navigation

| Function | Line | Purpose |
|----------|------|---------|
| `selectPanel(id)` | ~31 | Set active panel, reset vendor selection, re-render |
| `renderPanel()` | ~39 | Central render dispatcher (switch/case on `_panel`) |
| `renderAll()` | ~3811 | Full render: toolbar settings button, static translations, panel |
| `setVendorTab(tab)` | ~2576 | Switch vendor detail tab |
| `backToVendors()` | ~2383 | Clear vendor selection, re-render vendor list |
| `backToAssessments()` | ~2563 | Return to assessments (vendor or global) |
| `goToRisk(vendorId)` | ~1821 | Navigate to vendor's risk tab from global risk list |

### Dashboard

| Function | Line | Purpose |
|----------|------|---------|
| `renderDashboard()` | ~80 | Render KPI cards, dual matrices, timeline, top risks, deadlines |
| `_renderRiskTimeline()` | ~162 | SVG stacked line chart: risk levels over time with draggable date line |
| `_card(val, label, cls)` | ~344 | Render a single dashboard KPI card |
| `setDeadlineDays(days)` | ~350 | Change deadline horizon (30/60/90 days) and re-render |
| `_getExpiringItems()` | ~356 | Collect contracts, reviews, certifications expiring within N days |
| `_getLastMeasureDate()` | ~382 | Find latest measure deadline across all vendors |
| `_initTimelineDrag()` | ~441 | Setup mouse/touch drag on timeline date line; updates residual matrix |

### Risk Matrix

| Function | Line | Purpose |
|----------|------|---------|
| `_renderResidualMatrix(atDate)` | ~395 | SVG 5x5 risk matrix; applies residual values if measures are due by `atDate` |

### Vendor List

| Function | Line | Purpose |
|----------|------|---------|
| `renderVendorList()` | ~501 | Render vendor cards with search, status filter |
| `filterVendors(val)` | ~496 | Set text filter, re-render |
| `filterVendorStatus(val)` | ~498 | Set status filter, re-render |
| `openVendor(idx)` | ~589 | Select vendor by index, switch to detail view |

### Vendor Detail

| Function | Line | Purpose |
|----------|------|---------|
| `renderVendorDetail()` | ~600 | Render vendor header (tier, DORA, PII badges, risk scores) + tab content |
| `_renderVendorForm(v)` | ~660 | Identity form, contacts, contract, classification sliders, exposure result |
| `_renderVendorRisks(v)` | ~899 | Risk table with inline editing, linked measures (in-place/planned), measure registry |
| `_renderVendorAssessments(v)` | ~1585 | Assessment list with progress bars and scores |
| `_renderVendorDocs(v)` | ~1617 | Documents table + confidence selector |
| `_vendorAvatar(v)` | ~3133 | Render logo image or initials fallback |
| `_vendorInitials(name)` | ~3126 | Extract 1-2 letter initials from vendor name |

### Classification / Exposure

| Function | Line | Purpose |
|----------|------|---------|
| `_computeExposure(ex)` | ~779 | Threat formula: (D x P) / (M x C) |
| `_refreshThreatDisplay()` | ~786 | Update threat level display without full re-render |
| `_exposureClass(level)` | ~828 | CSS class for exposure level |
| `_exposureLabel(level)` | ~835 | Translated label for exposure level |
| `_avgSliders(vals)` | ~842 | Average of slider values (rounded to 1 decimal) |
| `_computeClassificationScore(c)` | ~848 | Average of all 6 classification criteria |
| `_isDoraICTCritical(c)` | ~856 | Check DORA ICT critical thresholds |
| `_slider(labelKey, id, value, max)` | ~864 | Render a slider input with value label |
| `_onSliderChange(el)` | ~875 | Handle slider change: recompute D/P, save, refresh display |
| `_getTier(v)` | ~3034 | Vendor tier from exposure: critical/high/medium/low |
| `_scoreToMaturite(score)` | ~3043 | Convert assessment score (0-100) to maturity (0-4) |

### Assessment

| Function | Line | Purpose |
|----------|------|---------|
| `renderAssessmentList()` | ~1840 | Global assessment list table |
| `openAssessment(assessId)` | ~1892 | Render full questionnaire with answer pills, domain headers, AI buttons |
| `openAssessmentFromVendor(assessId, vendorIdx)` | ~1886 | Open assessment with return-to-vendor context |
| `setAnswer(assessId, questionId, answer)` | ~1967 | Set answer, update completion/score, update vendor maturity |
| `saveAssessment(assessId)` | ~1992 | Save comments, recalculate score, return to vendor or list |
| `_computeAssessmentScore(a, questions)` | ~2037 | Weighted score: compliant=100%, partial=50%, na=excluded |
| `newAssessment(vendorId)` | ~2306 | Modal: choose manual or CSV import |
| `_newAssessmentManual(vendorId)` | ~2319 | Create empty assessment and open it |
| `_newAssessmentImport(vendorId)` | ~2333 | Create assessment from CSV file import |
| `deleteAssessment(assessId)` | ~2049 | Delete assessment with confirmation |
| `_scoreColorClass(pct)` | ~3153 | CSS class from percentage (green >= 80, red < 40) |

### Risk

| Function | Line | Purpose |
|----------|------|---------|
| `renderRiskList()` | ~1742 | Global risk register with search, vendor/category/status filters |
| `_onRiskFilterChange()` | ~1811 | Update filter state from DOM, re-render risk list |
| `addRiskForVendor(vendorId)` | ~2254 | Create empty risk linked to vendor |
| `updateRiskField(riskIdx, field, value)` | ~2269 | Update risk field; handles treatment auto-residual, capping |
| `deleteRisk(riskIdx)` | ~2298 | Delete risk with confirmation |

### Measures

| Function | Line | Purpose |
|----------|------|---------|
| `renderGlobalMeasures()` | ~2392 | Cross-vendor measures registry table |
| `addMeasureForRisk(vendorIdx, riskIdx)` | ~1085 | Create measure and link to specific risk |
| `addVendorMeasure(vendorIdx)` | ~1111 | Add empty measure to vendor |
| `updateVendorMeasure(vendorIdx, measureIdx, field, value)` | ~1126 | Update measure field |
| `deleteVendorMeasure(vendorIdx, measureIdx)` | ~1138 | Delete measure with confirmation |
| `deleteUnlinkedMeasures()` | ~2450 | Bulk delete measures not linked to any risk |
| `editMeasure(vendorIdx, measureIdx, returnTo)` | ~2474 | Open measure edit form |
| `_renderMeasureEditForm()` | ~2486 | Full edit form for a single measure |
| `saveMeasureEdit()` | ~2530 | Save measure edit form, return to context |

### Documents

| Function | Line | Purpose |
|----------|------|---------|
| `renderDocList()` | ~1866 | Global documents view grouped by vendor |
| `_renderDocsTable(docs, tableId)` | ~1645 | Render editable documents table |
| `_docTypeLabel(type)` | ~1683 | Human-readable document type label |
| `addDocument()` | ~1701 | Add document with prompt for name |
| `deleteDoc(docId)` | ~1716 | Delete document |
| `updateDocField(docId, field, value)` | ~1692 | Update document field |
| `updateVendorConfiance(el)` | ~1723 | Set vendor confidence level from documents tab |
| `_verifyAndAddDoc(vendorId, doc)` | ~3055 | Verify URL then add document (with backend or no-cors fallback) |

### Import / Export

| Function | Line | Purpose |
|----------|------|---------|
| `exportExcel()` | ~2600 | Full Excel export (6 sheets) via vendored ExcelJS |
| `_loadExcelJS()` | ~2588 | Lazy-load ExcelJS from `js/vendor/` (same origin) |
| `exportPP()` | ~2848 | Export vendors as PP format (EBIOS RM interop) |
| `importPPFromRisk()` | ~3754 | Import vendors from EBIOS RM file |
| `triggerImportRisk()` | ~2874 | Trigger file input for Risk import |
| `importRiskFile(event)` | ~2879 | Parse EBIOS RM JSON: create vendors, risks, measures with cross-references |
| `_importPP(ppList)` | ~3011 | Import PP list into vendors (simpler format) |
| `exportAssessmentExcel(assessId)` | ~2065 | Export single assessment as CSV |
| `importAssessmentExcel()` | ~2099 | Import assessment answers from CSV |
| `_parseCSVLine(line, sep)` | ~2141 | CSV parser with quote handling |

### AI Integration

| Function | Line | Purpose |
|----------|------|---------|
| `aiCollectInfo()` | ~3431 | AI auto-fill vendor info from name/website (legal entity, sector, certifications, docs, risks) |
| `aiCollectDocs()` | ~3533 | AI-powered document URL discovery (probe + LLM phases) |
| `aiAddVendor()` | ~3643 | Add vendor by name, trigger AI auto-collect |
| `_applyAiData(v, data)` | ~3670 | Apply AI response to vendor object (fill blanks, add certs, docs, risks) |
| `suggestVendorMeasures(vendorIdx)` | ~1149 | AI-suggest measures for a vendor based on exposure and risks |
| `suggestMeasuresForRisk(vendorIdx, riskIdx)` | ~1208 | AI-suggest measures for a specific risk |
| `aiSuggestRisksAndMeasures(vendorIdx)` | ~1367 | AI-suggest risks + measures for a vendor |
| `_aiSuggestRisksCustom(vendorIdx, prompt)` | ~1312 | Custom prompt risk suggestion |
| `_aiSuggestMeasuresCustom(vendorIdx, riskIdx, prompt)` | ~1340 | Custom prompt measure suggestion |
| `openAiRiskAssistant(vendorIdx)` | ~1240 | Open AI assistant panel with risk/measure generation options |
| `aiRunRiskSuggestion(vendorIdx)` | ~1289 | Execute risk suggestion (custom or standard) |
| `aiRunMeasureSuggestion(vendorIdx)` | ~1300 | Execute measure suggestion (custom or standard) |
| `aiSuggestDomain(assessId, domain)` | ~1545 | AI-suggest answers for a questionnaire domain |
| `_renderAiCards()` | ~1408 | Render AI suggestion cards in slide-in panel |
| `acceptAiSuggestion(idx)` | ~1461 | Accept a single AI suggestion (create risk/measure) |
| `ignoreAiSuggestion(idx)` | ~1520 | Dismiss a single AI suggestion |
| `acceptAllAiSuggestions()` | ~1527 | Accept all remaining AI suggestions |
| `_checkAiEmpty()` | ~1536 | Check if all AI cards are handled, show completion message |

### Settings

| Function | Line | Purpose |
|----------|------|---------|
| `_isDoraEnabled()` | ~3198 | Check DORA mode from localStorage |
| `_getDoraThresholds()` | ~3202 | Read DORA thresholds from localStorage |
| `_doraSettingsHTML()` | ~3209 | Render DORA settings section (toggle + thresholds) |
| `_wireDoraSettings()` | ~3230 | Wire DORA toggle show/hide |
| `_saveDoraSettings()` | ~3237 | Save DORA settings to localStorage |
| `_customQuestionnaireHTML()` | ~3275 | Render custom questionnaire settings section |
| `_wireCustomQuestionnaire()` | ~3295 | Wire file input and clear button |
| `_importCustomQuestionnaire(csvText)` | ~3314 | Parse CSV into custom questionnaire objects |
| `downloadQuestionnaireTemplate()` | ~3365 | Download CSV template for custom questionnaires |
| `_initDataAndRender(cb)` | ~3248 | Handle PP import on file open, reset state, render |

### Helpers

| Function | Line | Purpose |
|----------|------|---------|
| `_vendorName(id)` | ~3141 | Resolve vendor ID to display name |
| `_scoreClass(score)` | ~3146 | CSS class from risk score (1-25) |
| `_field(labelKey, id, value, type)` | ~3160 | Render a form field with label and auto-save |
| `_select(labelKey, id, value, options)` | ~3164 | Render a select field with label and auto-save |
| `_showModal(content)` | ~3173 | Display modal overlay with content |
| `closeModal()` | ~3185 | Remove modal overlay |
| `_getQuestions(v)` | ~3047 | Get questions: custom if set, else default + DORA if critical |
| `_autoSaveVendorField()` | ~2193 | Debounced (400ms) auto-save: collect all form fields into vendor object |
| `saveVendor()` | ~2237 | Alias for `_autoSaveVendorField()` (backward compat) |
| `addVendor()` | ~2157 | Create vendor with prompt, auto-trigger AI if enabled |
| `deleteVendor(idx)` | ~2240 | Delete vendor + cascade delete risks, assessments |
| `_fetchLogo()` | ~3094 | Download logo from URL, resize to 64x64, store as base64 |

---

## 8. Questionnaire System

### Built-in Questions

Defined in `TPRM_questions.js`:

**`TPRM_QUESTIONS`** (25 questions): Essential security assessment covering 15 domains:

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

**`TPRM_DORA_QUESTIONS`** (5 questions, D01-D05): Additional questions for DORA-regulated entities:

| ID | Domain | Topic |
|----|--------|-------|
| D01 | `dora_resilience` | Digital operational resilience testing (TLPT) |
| D02 | `dora_exit` | Exit plan / data reversibility |
| D03 | `dora_notification` | Major incident notification process |
| D04 | `dora_subcontracting` | ICT subcontracting chain control |
| D05 | `dora_location` | Data/processing location, EU transfers |

### Question Structure

Each question has:
- `id`, `domain` -- identification
- `text_fr`, `text_en` -- bilingual question text
- `expected_fr`, `expected_en` -- expected compliant answer
- `red_flags_fr`, `red_flags_en` -- non-compliance indicators
- `evidence_fr`, `evidence_en` -- expected evidence
- `weight` (6-10) -- scoring weight

### Scoring

`_computeAssessmentScore()` calculates a weighted percentage:
- **Compliant** = full weight
- **Partial** = 50% weight
- **Non-compliant** = 0
- **N/A** = excluded from denominator

The score automatically feeds back into the vendor's `exposure.maturite` via `_scoreToMaturite()`, which affects the threat level formula.

### Custom Questionnaires

Administrators can import a custom CSV questionnaire that **replaces** the default 25+5 questions entirely:

1. Go to Settings > Custom Questionnaire
2. Upload a CSV/TSV with columns: `id`, `domain`, `question`, `expected`, `red_flags`, `evidence`, `weight`
3. Download the template via the provided link

The custom questionnaire is stored in `D._custom_questionnaire` and persists with the project JSON. `_getQuestions(v)` checks for custom questions first.

### Question Selection Logic

`_getQuestions(v)` (line ~3047):
1. If `D._custom_questionnaire` has entries, use those exclusively
2. Otherwise: `TPRM_QUESTIONS` + `TPRM_DORA_QUESTIONS` (only if vendor is DORA ICT critical)

### Supporting Data

- **`TPRM_RISK_CATEGORIES`**: 7 risk categories (CYBER, OPS, FIN, COMP, STRAT, REP, GEO) with bilingual labels
- **`TPRM_CERTIFICATIONS`**: 14 certification names for autocomplete (ISO 27001, SOC 2, HDS, PCI DSS, etc.)

---

## 9. Shared Library (cisotoolbox.js)

Key functions from the shared library used by TPRM:

| Function | Purpose |
|----------|---------|
| `esc(v)` | HTML-escape user data (prevents XSS) |
| `_da(...)` | JSON-encode data-args for event delegation |
| `showStatus(msg)` | Display status message in toolbar |
| `_autoSave()` | Debounced save to localStorage |
| `_loadAutoSave()` | Restore from localStorage |
| `_saveState()` | Push undo snapshot |
| `_checkAutoSaveBanner()` | Show restore banner if autosave exists |
| `ctRenderMatrix(opts)` | Render SVG risk matrix with tooltips |
| `ctRefRegister(uid, opts)` | Register a ref-select dropdown instance |
| `ctRefSelect(uid, val, opts, config)` | Render multi-select dropdown with tags |
| `ctBadge(text, color)` | Render a colored badge |
| `colsButton(tableId)` | Render column visibility toggle button |
| `hd(colId)` | Generate `data-col` attribute for column hide/show |
| `_setupTable(tableId)` | Initialize column hide/show and resize for a table |
| `_initSliders()` | Apply inverted color styling to range inputs |
| `_applySliderStyle(el)` | Style a single slider based on value |
| `badge(text, color)` | Simple colored badge |
| `toggleHelp(tab)` | Open/close help overlay |
| `switchHelpTab(tab)` | Switch between methodology and usage help tabs |
| `toggleMenu(event)` | Toggle toolbar dropdown menus |
| `_menuAction(action)` | Dispatch menu actions (new, open, save, export) |
| `toggleSidebar()` | Collapse/expand sidebar |
| `_toggleSidebarMobile()` | Mobile hamburger menu |
| `_updateSidebarAccordion(panelId)` | Update active sidebar item |

### CT_CONFIG Integration

TPRM registers with cisotoolbox.js via `window.CT_CONFIG`:

```javascript
{
    autosaveKey: "tprm_autosave",
    initDataVar: "TPRM_INIT_DATA",
    filePrefix: "TPRM",
    labelKey: "toolbar.subtitle",
    getSociete: function(data) { return data.metadata.organization || ""; },
    getDate: function(data) { return data.metadata.created || ""; }
}
```

---

## 10. Event System

TPRM uses the `data-click` / `data-change` / `data-input` event delegation system from cisotoolbox.js. No inline `onclick=` handlers.

### Event Attributes

| Attribute | Trigger | Example |
|-----------|---------|---------|
| `data-click="fnName"` | click | `<button data-click="addVendor">` |
| `data-change="fnName"` | change (select, checkbox) | `<select data-change="updateRiskField">` |
| `data-input="fnName"` | input (real-time typing) | `<input data-input="filterVendors">` |
| `data-args='[...]'` | JSON array of arguments | `data-args='["dashboard"]'` |
| `data-pass-value` | Pass element's `.value` as last arg | On inputs and selects |
| `data-pass-el` | Pass the DOM element as last arg | On sliders |
| `data-stop` | Call `event.stopPropagation()` | On nested clickable elements |
| `data-click-self="fnName"` | Click only on the element itself (not children) | Help overlay background |

### Dispatch Mechanism

cisotoolbox.js uses `_safeDispatch()` which:
1. Looks up the function name on `window`
2. Validates against a blocklist of dangerous names (`eval`, `fetch`, `open`, `alert`, etc.)
3. Parses `data-args` JSON
4. Appends value/element if `data-pass-value` or `data-pass-el` is present
5. Calls the function with the assembled arguments

### Window Exports

All public functions are explicitly exported to `window` to be reachable by the event system:
```javascript
window.openVendor = openVendor;
window.addVendor = addVendor;
// etc.
```

---

## 11. Security

### Content Security Policy

Enforced via `.htaccess`:
- `script-src 'self'` -- no inline scripts, no `unsafe-eval`
- `style-src 'self' 'unsafe-inline'` -- inline styles allowed (for dynamic styling)
- `frame-ancestors 'none'` -- no iframe embedding
- HSTS, X-Content-Type-Options, Referrer-Policy

### XSS Prevention

- **All user data** passes through `esc()` before DOM insertion (HTML entity encoding for `&`, `<`, `>`, `"`, `'`)
- **`_da()`** JSON-encodes arguments and escapes single quotes for `data-args`
- **No `innerHTML` with raw user input** -- all string-built HTML uses `esc()` for dynamic values
- **No `onclick=`** -- all event handling via `data-click` delegation with blocklist validation
- **No `eval()`, `Function()`, `document.write()`**

### Encryption

- **AES-256-GCM** with PBKDF2 (250,000 iterations) for saved JSON files
- Password prompt via overlay (not `prompt()`)
- Provided by cisotoolbox.js `saveJSON()` / `openFile()`

### API Key Security

- AI API keys stored in `localStorage` only (never in saved files)
- Privacy warning displayed when AI is first activated
- Keys validated before use (`_aiGetApiKey()`)

### Prototype Pollution

- JSON parsing uses standard `JSON.parse()` -- no custom deserialization
- Object creation uses explicit property assignment, not `Object.assign()` from untrusted sources

---

## 12. i18n System

### Architecture

- **French is default** -- loaded at startup from `TPRM_i18n_fr.js`
- **English is lazy-loaded** on demand from `TPRM_i18n_en.js`
- Global `_locale` variable tracks current language (`"fr"` or `"en"`)

### Translation Functions

| Function | Usage |
|----------|-------|
| `t("key")` | Get translated string by dot-notation key |
| `t("key", {var: val})` | With interpolation: `{var}` replaced by `val` |
| `_rt(obj, field)` | Get bilingual field: tries `field_fr`/`field_en` based on locale |
| `data-i18n="key"` | HTML attribute: auto-translated by `_applyStaticTranslations()` |
| `data-i18n-html="key"` | HTML attribute: translated as innerHTML (for rich content like help pages) |

### Key Naming Convention

Keys follow the pattern `{section}.{item}`:
- `nav.dashboard`, `nav.vendors`, `nav.risks`, `nav.measures`, `nav.documents`
- `vendor.name`, `vendor.status_active`, `vendor.tier_critical`
- `risk.impact`, `risk.treatment_mitigate`
- `assessment.answer_compliant`, `assessment.score`
- `measure.planifie`, `measure.en_cours`, `measure.termine`
- `dashboard.total_vendors`, `dashboard.critical_risks`
- `ai.collecting`, `ai.generate_risks`
- `settings.dora_section`, `settings.custom_questionnaire`

### Language Switching

`switchLang()` (from i18n.js):
1. Toggles `_locale` between `"fr"` and `"en"`
2. Lazy-loads English file if needed
3. Calls `_applyStaticTranslations()` to update `data-i18n` elements
4. Calls `renderAll()` to rebuild dynamic content

### Bilingual Data

Questionnaire questions have both `text_fr`/`text_en`, `expected_fr`/`expected_en`, etc. The rendering code selects the appropriate field:
```javascript
q["text_" + lang] || q.text_fr
```
