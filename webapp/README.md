# Vendor (TPRM) — Third-Party Risk Management

> Part of [CISO Toolbox](https://www.cisotoolbox.org) — open-source security tools for CISOs.


> **This is the browser-only version** — everything runs in your browser,
> data never leaves it (localStorage + JSON export). Perfect for solo use,
> evaluation, consulting on client data, or air-gapped contexts. Need
> accounts, a shared database, an API and multi-user work? The **standalone
> backend** of the same module lives at the [root of this repository](../)
> — same features, same data format, a JSON export moves your work from one
> to the other. See *One repository, two versions* in the main README.

## Features

### Registry and risk scoring
- Vendor registry with **6-axis classification** (operational impact, process dependency, replacement difficulty, data sensitivity, system integration, regulatory exposure)
- Threat level calculation `(Dependence × Penetration) / (Maturity × Trust)` aligned with EBIOS RM methodology
- Automatic **tier** derivation (critical / high / medium / low) and **DORA critical ICT provider** detection
- 5×5 inherent and residual risk matrix with a timeline slider

### Templates and assessments
- **Modèles d'évaluation** — customizable templates for questionnaires (vendor-filled) or audits (internally-filled). Default templates created on first visit, including the **42 ANSSI hygiene rules** as a ready-to-use audit template.
- Template editor: sections, free-text questions, criticality (info / major / blocker), weight (0–100)
- **Import templates from Excel** (downloadable `.xlsx` example with data validation) or create them in the graphical editor
- Template-driven assessments with **coverage status** (`Covered` / `Partial` / `Not covered` / `N/A`), mandatory **corrective actions or justification** on partial / not-covered, per-question progress, submit-for-approval workflow
- **Weighted maturity score** aggregating multiple approved assessments (per-question criticality, per-kind weight, temporal decay, manual overrides)

### Vendor Portal (companion app at `/portal/`)
- Standalone single-page app for vendors to fill questionnaires in their own browser
- **Direct link sharing** via gzipped + AES-256 encrypted URL hash (small questionnaires)
- File-based sharing (`.json`, `.ctenc`, `.xlsx`) with a ready-to-send HTML email template
- Overdue due-date badge, per-question live status, autosave in `localStorage`
- Vendor re-exports the filled response (encrypted JSON or Excel) and emails it back; you re-import it into the matching assessment

### DORA Register of Information (RoI)

- **DORA Register module** built in, aligned with EU Reg. 2024/2956 and the EBA RoI ITS (DPM v4.0)
- Supported tables: **B_01.01 to B_07.01** (reporting entities, branches, hierarchy, contractual arrangements, signatories, subcontractors, supported functions, substitutability)
- **Official EBA codelists** (licenced activity, ICT service type, arrangement type, termination reason, currency, country…) with localised FR / EN labels; the ITS code (e.g. `eba_TA:x182`) is preserved in storage and emitted as-is on export
- **GLEIF LEI lookup** from every LEI field (entities, signatories, subcontractors)
- **RoI export** (File → DORA RoI export): generates an EBA RoI ITS XLSX workbook (one sheet per B_xx table) with reporting period and target currency selection — amounts in foreign currencies are kept and complemented by a normalised column
- **Per-vendor DORA tab**: aggregated card of declared arrangements, signatories, subcontractors and supported functions
- **Subcontractor management** (4th parties) directly from the vendor list (Subcontractors tab) or from each arrangement (arrangement ↔ subcontractor link with rank and provided service)

### Data and history
- Document registry with expiry alerts, URL verification, confidence scoring
- **Undo / redo** (Ctrl+Z / Ctrl+Y) and **snapshots** panel with optional AES-256 encryption
- AES-256-GCM with PBKDF2 (250k iterations) for encrypted files and snapshots
- Bilingual FR / EN with lazy-loaded English translations

### AI assistant (optional)
- Suggest vendor-specific risks and mitigating measures (Anthropic Claude or OpenAI GPT)
- AI collection of public vendor documentation with URL verification
- Answer suggestion for questionnaires

## Quick start

1. Visit [vendor.cisotoolbox.org](https://vendor.cisotoolbox.org) or clone this repo
2. Open `index.html` in a browser
3. Start a new vendor register — the repository ships no demo dataset for now (new ones will be generated later)
4. No backend, no account required

## Vendor Portal

The portal is a separate standalone page under `portal/`, served at [vendor.cisotoolbox.org/portal/](https://vendor.cisotoolbox.org/portal/).

- **Vendor workflow**: click the link you received, enter the password shared out of band, fill the questionnaire, export the response. Data stays in the browser at every step.
- **Your workflow (issuer)**: open an assessment, click **Copier modèle email** or **Lien direct**, send the vendor the link + password through separate channels, then import the returned file.

## Architecture

- 100% client-side vanilla JS — no framework, no build step, no `node_modules`
- Data in the browser (localStorage autosave + downloadable JSON/Excel for persistence)
- Event delegation via `data-click` / `data-change` / `data-input` (CSP-compliant, no inline handlers)
- AES-256-GCM encryption for saved files and snapshots
- Shared libraries from `../../shared/` copied at deploy time: `cisotoolbox.js`, `cisotoolbox_local.js`, `i18n.js`, `ai_common.js`, `ct_refselect.js`, `cisotoolbox.css`
- Reuses the shared **SVG icon helper** (`_icon(name)` from `cisotoolbox.js`), the shared **snapshots panel** (`_renderSnapshotsPanel()` from `cisotoolbox_local.js`) and the shared **undo hook** (`_installUndoHook()`)
- `<body class="ct-app-shell">` enables the fixed toolbar + sidebar + internal-scroll layout; the portal omits that class for natural document scroll

## Import / export

| Action | Where | Format | Notes |
|---|---|---|---|
| Save / Open analysis | File menu | `.json` / `.ctenc` | Encrypted with AES-256-GCM |
| Export assessment | On an assessment | `.xlsx` | Prebuilt workbook with locked identity columns and conditional formatting |
| Export assessment | On an assessment | `.json` / `.ctenc` | Plain or encrypted |
| Assessment link | On an assessment | URL hash | Gzipped + AES-256 encrypted payload for the Vendor Portal |
| Import assessment | On an assessment | `.xlsx` / `.json` / `.ctenc` | Re-imports the vendor's response into the existing assessment |
| Import template | On the Modèles d'évaluation page | `.xlsx` | Create a template from a structured sheet (Section, Question, Expected, Criticality, Weight). A downloadable example file is provided. |

## Links

- Website: https://vendor.cisotoolbox.org
- Vendor Portal: https://vendor.cisotoolbox.org/portal/
- CISO Toolbox: https://www.cisotoolbox.org

## Need more than a browser app?

This app is intentionally **100% browser-local** — your data never leaves
your machine. If you outgrow it, the same module exists in two server-backed
flavours:

- **Standalone backend** (accounts, PostgreSQL, REST API, Docker):
  the `-standalone` distribution of this repo — see `STANDALONE.md` /
  `ghcr.io/cisotoolbox/ciso-vendor:latest`.
- **Governance suite**: all CISO Toolbox modules integrated behind Pilot
  (SSO, shared user directory, consolidated action plan, centralized
  backups and point-in-time restore) — see https://www.cisotoolbox.org.

Your JSON exports from this app import as-is into both.

## Running it locally

This is a static, frontend-only application — no backend, no account, no build
step.

```bash
git clone <this repo>
cd vendor
python3 -m http.server 8080      # any static file server will do
```

Then open <http://127.0.0.1:8080/>.

Opening `index.html` directly from the filesystem (`file://`) works for the
basic UI, but the browser blocks `fetch()` on local files, so `demo-*.json` and
the lazy-loaded frameworks will not load. Prefer a static server.

## Deploying behind a web server

The app ships with **no security headers of its own** — they belong to the web
server that serves the files. Two ready-to-use configs are included so a
deployment is never published bare:

- **Apache**: copy `.htaccess.example` to `.htaccess`. It sets a strict
  Content-Security-Policy (`script-src 'self'`, no framing), `X-Frame-Options`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  blocks dotfiles, and redirects HTTP to HTTPS. `.htaccess` itself is
  git-ignored because the HTTP→HTTPS rule is host-specific — the `.example` is
  the versioned source.
- **nginx**: `include` the provided `nginx-security.conf.example` inside the
  `server{}` block that serves the app (see the header of that file). Same CSP
  and headers as the Apache config — keep the two in sync if you edit the CSP.

Without one of these, the browser runs the app with no CSP: do not expose the
static files directly. The `python3 -m http.server` above is for local use only.

## Where your data lives

| What | Where | Lifetime |
|------|-------|----------|
| Work in progress (autosave) | `localStorage["tprm_autosave"]` | Until you clear the browser storage |
| Snapshots | `localStorage["tprm_autosave_snapshots"]` (optionally AES-256-GCM encrypted) | Same |
| UI preferences | `localStorage["ct_lang"]`, `localStorage["ct_theme"]` | Same |
| Your real deliverable | **A file on your own disk**, via *File → Save* | Yours |
| AI provider API key (optional) | `localStorage`, sent only to the provider you configured | Until you clear it |

**Persistence is file-based.** The browser copy is a convenience buffer, not a
backup: a cleared profile, a private window or a different machine means an
empty app. Save to a `.json` (or AES-256-GCM encrypted `.ctenc`) file and keep
that file wherever you keep your other security deliverables. Nothing is ever
sent to a server — there is no server.

## Repository layout

```
css/                  # 2 files
e2e/                  # 4 files
js/                   # 22 files
portal/               # 17 files
skill/                # 1 file
ts/                   # 23 files
.replicated-files
ARCHITECTURE.md
CONTRIBUTING.md
LICENSE
README-FR.md
README.md
SECURITY.md
favicon.svg
index.html
tsconfig.json
```

## Replicated files

The design system and the cross-module libraries (`js/cisotoolbox*.js`,
`js/i18n.js`, `js/ai_common.js`, `js/ct_*.js`, `css/cisotoolbox.css`,
`ts/types/*.d.ts`) are **replicated from a private shared repository** and
carry a `REPLICATED … do not edit here` banner. They are regenerated and
overwritten on each sync — see [`.replicated-files`](.replicated-files) for the
exact list and [CONTRIBUTING.md](CONTRIBUTING.md) for what to do if you find a
bug in one of them.

## Tests

```bash
cd e2e && npm install && npx playwright install chromium && npm test
```

See [`e2e/README.md`](e2e/README.md).

## Contributing / Security

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md) — please report vulnerabilities privately
- Licence: MIT, see [LICENSE](LICENSE)
