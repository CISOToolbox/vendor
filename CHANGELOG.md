# Changelog

Every release has its section here, written at release time from the
changes since the previous one and published as the GitHub release notes.

## 1.5.0 — 2026-10-22

### Upgrade

- Five database migrations run at start-up: 019 (RoI columns), 020 (subcontractor type of person), 021 (subcontractor additional identifier), 022 (vendor-maturity settings), 023 (questionnaire templates).
- Questionnaire links now open on the public vendor portal by default; set `VENDOR_PORTAL_URL` to keep them on a self-hosted portal.
- New routes: `PATCH /projects/{id}/maturity-config`; a version conflict (409) carries the header `X-CT-Conflict: stale`.

### Added

- PATCH /projects/{id}/maturity-config writes the maturity configuration alone (R11)
- The subcontractor identity offers an additional identifier
- Subcontractor type of person, linked arrangement only for intra-group providers, rank checked against the subcontractors served, a LEI-only parent shown with what is missing
- The RoI screens offer the new fields and no value without an EBA code
- Consolidation type and hierarchy, open-ended, data stored and linked arrangement fields (migration 019)
- In the RoI Excel export, a cell left empty although the EBA data model requires it is red
- A questionnaire's Excel export is written in its own language
- Each default questionnaire exists in French and in English, identical question for question
- A questionnaire link opens on the public vendor portal by default, VENDOR_PORTAL_URL to self-host

### Fixed

- One file opened at a time, and a save due goes out when the file cannot be read
- No project save or focus refresh while a file is being opened
- A file whose save fails leaves the project as it was
- A file opened into the project is saved once loaded, with its own DORA register
- The project save never writes back the DORA register loaded with the page
- Template version and question weight are escaped when rendered
- A restore clears a value of the wrong type and drops a template of the wrong shape
- Questionnaire templates are saved with the project (migration 023) — the whole-project save carried them, the server dropped them
- DORA rows are written table by table in foreign-key order — Postgres refused a branch before its entity, failing a restore or a whole-project save
- A restored or imported project goes through the input checks — values outside their lists and orphan references cleared, orphan rows dropped; a new project refuses two records with one code
- A 403 keeps its reason (the body is read once); a save refused for lack of rights is said in red, without an alert or a reload
- A refused save says the server's reason; only a version conflict shows the reload message; refused or failed edits shown in red
- The version-conflict 409 carries X-CT-Conflict: stale
- The maturity-config PATCH requires its field — an omitted one is refused, null resets
- The maturity configuration is written through its own route, sent when the page is left
- Maturity edits are written at once again — the shared save timer dropped chained edits and edits on leaving the page; an emptied setting shows its value once left
- The header follows the maturity while typing; escaped selectors; marks and emptied weights resynced; saves once typing pauses
- Maturity fields carry stable ids, the focus survives the one-off DORA re-render
- Maturity numbers apply as typed and refresh the computed cells in place; the field is marked when out of range; the panel keeps the state the user left it in
- Maturity numbers are saved when left, the panel stays open, the risk filter keeps the hidden columns
- A composed character is dispatched once in the Firefox and Safari event order too (socle)
- A character composed with a dead key or an IME is dispatched once, complete (socle)
- A maturity number out of range is marked and not kept
- A restored backup goes through the maturity-settings rule
- A cleared weight override is sent as null
- An assessment's weight override and exclusion, and the project's maturity configuration, are saved
- The vendor tab is not rebuilt under a field being edited; the taken message goes with the edit
- A stored identifier type without an EBA code does not block an unrelated change
- A taken code is said on the field it was set in (GLEIF too), no half-typed LEI or identifier kept, a refused project save is said and reloads
- Only a code a record gains is refused, by the EBA code of its type; the project save checks subcontractors; types without an EBA code refused
- A taken code is said under the field, in the vendor tab and the subcontractors table
- A code another vendor or subcontractor carries is refused on screen and not kept
- The project save refuses a new duplicate vendor code too
- A subcontractor without a LEI is identified by its additional identifier; a code another record carries is refused
- The parents of a vendor signing for a provider are reported in B_05.01
- The screen compares LEIs as the server does
- One LEI key for export, server and screen; a vendor signing for a provider is reported in full
- An arrangement keeps its vendor on screen; a new one offers the linked arrangement until its vendor is picked
- One spelling per LEI key, one row per code in B_01.02, B_05.01 and B_05.02, a provider's signing entity reported in B_05.01
- A subcontractor LEI is one key in B_05.01 and B_05.02, whatever its case
- The overarching and linked arrangement pickers list the register's arrangements
- RoI export passes the EBA key checks
- Resolve the three RoI model flags the data model leaves unreadable
- A rank n-1 of another rank is refused on screen; one B_03.02 row per key, empty ones too; a former LEI parent in upper case; linked arrangements of a removed vendor cleared
- No internal id or duplicate key in B_03.02, a removed parent is never exported as a LEI, the cited parent has its own B_05.01 row, unknown storage shows red, rank n-1 checked, orphan references cleared
- A list value with no EBA code key is not offered either
- RoI values that were wrong though present — rank n-1 recipient, entity performing a function, exit plan not stated, alternative not assessed, impact from the list
- The RoI export fills every required column the EBA FAQ settles — open dates, Not Applicable, own code without a group, intra-group rows, no internal ids
- A vendor's ultimate parent picked among the project's vendors is saved
- B_02.02 0160–0180 belong to B_02.02 in the EBA model; the export's columns are checked against it; the legend says what empty means
- No duplicate default template id after a language edit; the vendor e-mail and the Excel validation messages in the questionnaire's language
- A portal setting that is refused or cannot be read keeps links on the deployment's own portal; the help says where links open
- A DORA load invalidated meanwhile no longer writes its tree to the cache
- A DORA load's callers run on their own; invalidate forgets a load in flight
- The list re-rendered once the DORA tree arrives keeps the typing; one DORA load at a time
- The vendor, subcontractor and risk filters keep the focus while typing
- One lock predicate for approved and legacy completed assessments; exports of a locked legacy one carry what the screen shows
- Opening a locked legacy assessment does not heal or save the templates
- A locked legacy assessment opens on a copy, never written; no delete or import into an approved one; a lock refusal says so
- An approved assessment is locked — no change through PATCH or the project save, not removable, read-only in the app

### Tests

- Failed file save, DORA left out or null
- File opening saves its DORA once loaded; wrong types are cleared
- Wrong types, template shapes, DORA kept by the project save
- DORA rows are restored in foreign-key order (SQLite foreign keys on)
- A stored type is kept on rename, a new one without an EBA code refused; BUG-114 confirmation review
- One row per empty key, upper-case former parent, linked arrangements cleared, rank n-1 refused on screen; BUG-112 re-reviews
- The red marking on a B_02.02 sheet; FEAT-60 review

### Maintenance

- BUG-120 one file at a time (propagation)
- BUG-120 file opening holds the project save (propagation)
- BUG-120 failed file save (propagation)
- BUG-120 file opening (propagation)
- BUG-120 review fixes (propagation)
- Socle composition dedup (propagation)

## 1.4.0 — 2026-10-20

### Added

- The AI assistant toggle and the module's AI provider in one section, fields usable once the assistant is on (settings)
- One Save button for every section, sections in an exclusive accordion, unsaved changes guarded (settings)
- Remove a provider's saved keys from the settings drawer (ai)
- The settings drawer lets a standalone module's admin set its AI provider, model and keys (ai)
- A standalone module runs its AI on its server, set by its admin; Pilot's in the suite (ai)
- The local account is shown fixed; without an identity provider the section says the module has one account (users)
- The module's key opens one local account, its admin; other accounts come from an identity provider (auth)
- One shared sign-in router for the nine backend modules — identity providers everywhere (auth)
- Users section in the settings of the backend modules (settings)
- User administration router for standalone modules — module roles, pending, disabled, last admin kept (users)
- Standalone accounts await approval, and their role is read from the module on every request (auth)
- Outbound proxy section in the settings of the backend modules (settings)
- The outbound proxy is settable in the module itself when Pilot is absent (proxy)
- SMTP settings in the standalone modules (shared)
- Redirect policy in the target dialog
- Export_proxy, for a proxy kept outside the proxy.* rows (Pilot's own) (shared)
- Distinguish "not assessed" from 0 in the criticality formula
- Refresh the AI model catalogue (ai)

### Fixed

- No multi-tenant Entra default — an unset tenant is empty, and the README says it is required (auth)
- A module menu opened before the module learns it is standalone is closed (chrome)
- A standalone module lists only itself in the module switcher (chrome)
- Ask about pending settings before the questionnaire is imported or cleared
- A given-up section drops its error; AI provider input typed while the assistant is off is discarded (settings)
- A questionnaire import redraws the settings only once pending edits are kept or dropped
- Every way out of the panel asks before unsaved edits go; one save at a time; a refused or declined change stays pending (settings)
- The module honours ALLOW_INSECURE_CUSTOM_LLM_ENDPOINT at call and at save (ai)
- AI settings are stored as they were checked (ai)
- Pilot's push is stored as Pilot checked it; a module admin's endpoint is checked as the call checks it; keys in clear without ENCRYPTION_KEY (ai)
- One email_verified rule for Google and OIDC; tests for OIDC and the account lock (auth)
- An address the identity provider has not verified is refused (auth)
- Only the key's own account is local; the key never revives an account; account creation serialised (auth)
- Every module's write journal records what a route says changed; one journal implementation
- A provider sign-in marks the account as the provider's; the token closes once such an admin exists (auth)
- A role change says what changed to the module's write journal (users)
- The last-admin guard locks the admin rows; one journal entry per change (users)
- A refused sign-in says why — awaiting approval, disabled, domain not allowed (login)
- Exact masking docstring; contract checks proxy_common never forces allow_private (proxy)
- Mask a token user name with an empty password, redact credentials in any case, contract reads the validator's AST (proxy)
- Mask a token-only proxy userinfo, keep credentials out of refusals, leave omitted fields as they are (proxy)
- The settings router reads proxy_common at call time (proxy)
- SMTP credentials from the environment never go to a host saved in the app (shared)
- SMTP host checked with ssrf_guard; an empty host clears the saved config (shared)
- SMTP settings help says what an empty host really does (shared)
- Honour hideAI in the managed settings drawer (shared)
- The custom LLM endpoint check follows the proxy, Watch's assistant reaches the custom LLM
- The AI agent reaches a custom LLM through the outbound proxy
- Status line errors are styled and stay long enough to read
- Pilot's proxy exempts every registry host once normalized, never '*' or a list, and the default modules even when the database is not ready
- A database not ready at start-up still leaves a readable NO_PROXY
- A database not ready at start-up still leaves a readable NO_PROXY (shared)
- A lowercase deployment proxy exempts the internal services too
- A lowercase deployment proxy exempts the internal services too (shared)
- An IPv6 range in the deployment's NO_PROXY is left out, it breaks httpx
- An IPv6 range in the deployment's NO_PROXY is left out, it breaks httpx (shared)
- APP_URL is not internal, a deployment's range is kept as written
- APP_URL is not internal, a deployment's range is kept as written (shared)
- The deployment's own proxy is the base Pilot overrides, never erased
- The deployment's own proxy is the base Pilot overrides, never erased (shared)
- A clear message for an IPv6 exception with a port
- A clear message for an IPv6 exception with a port (shared)
- Proxy exceptions take a port or an underscore, refuse ranges, log an unreadable one
- Proxy exceptions take a port or an underscore, refuse ranges, log an unreadable one (shared)
- Validate proxy exceptions, match ranges and wildcards, keep the deployment's NO_PROXY
- Validate proxy exceptions, match ranges and wildcards, keep the deployment's NO_PROXY (shared)
- Internal services bypass the pushed proxy, and an empty push clears a stale row
- Internal services bypass the pushed proxy, and an empty push clears a stale row (shared)
- Refuse a proxy value that is not one URL, and say when a stored one cannot be decrypted
- A proxy value is one URL, and an unreadable one is not announced restored (shared)
- Keep the pushed proxy across restarts, and let Pilot clear it
- Store the outbound proxy pushed by Pilot and restore it at start-up (shared)
- Store the custom LLM label sent with the AI keys (ai)
- Tolerate only the missing suite-only file
- Start without the suite-only routes
- Reposition modal dropdowns on scroll; drop audit webapp orphan (ui)
- Keep B_07.01.0060 reason in step with the substitutability level
- Actions filter, project form and action modal UX
- Distinguish the most-severe level from the next on charts (ui)
- Remove a connector's dashboard footprint when its config is cleared

### Changed

- The region check at save reuses _safe_bedrock_region (ai)
- One proxy URL validator in proxy_common, shared by the internal routes and Pilot (proxy)
- Drop pushed_proxy, the scanners no longer need it
- Drop pushed_proxy, the scanners no longer need it (shared)
- Drop bypasses_proxy, and read the deployment's NO_PROXY at start-up in the test
- Drop bypasses_proxy, only the scanners would use it (shared)

### Documentation

- What the shared token allows, translated refusals in the users section (users)

### Tests

- Every proxy_common copy, Pilot's included, passes allow_private on to ssrf_guard (contracts)
- Proxy exception refusals name the entry at fault
- A database not ready at start-up leaves a readable NO_PROXY, external URLs are not internal
- A restart starts from the stored rows, a lowercase deployment proxy exempts the internal services
- An IPv6 range in the deployment's NO_PROXY is left out, logged
- APP_URL is not internal, a deployment's range is kept, the shell's proxy never leaks in
- The deployment's own proxy is the base Pilot overrides, http_proxy covered too
- Proxy exceptions with a port or an underscore are kept, ranges are refused, an unreadable one is logged
- Proxy exceptions are validated, matched with ranges and wildcards, and the deployment's kept
- Internal services bypass the pushed proxy, a stale row clears, logs hold the host only
- A proxy value is one URL, and an unreadable one is not announced restored
- The pushed proxy is stored, restored at start-up and clearable

### Maintenance

- Proxy_common gains export_proxy (unused here)

## 1.3.2 — 2026-10-05

### Maintenance

- `constraints.txt` no longer pins semgrep (dropped with the AppSec Opengrep migration); the image content is unchanged.

## 1.3.1 — 2026-10-03

### Maintenance

- `constraints.txt` pins semgrep 1.179.0 and `tests/check-deps-drift.sh` no longer carries a PyJWT exception; the image content is unchanged.

## 1.3.0 — 2026-10-03

### Added

- Non-conformity and derogation register: declare a non-conformity on one or several items, carry its remediation with corrective measures, or grant a time-boxed derogation; a derogation never counts as compliant.
- Register actions follow the module role and the projects the user may read; a read-only account writes nothing.
- Linked measures show their status, open for editing from the record, and must be done before the record closes.
- The non-conformity register on third parties; removing a third party settles what covered it.

### Fixed

- The default questionnaire states its real size (25 questions across 13 domains) and every section has its title.
- A record's tabs scroll on a narrow screen and the active tab stays in view.
- The supplier portal drops unused shared-library copies.
- Forms lay out on the shared form grid and collapse to one column below 768 px; checkboxes sit on the line of their label.
- Muted text keeps AA contrast on every background; one shared signed-in user block in the toolbar.
- Picking a person closes the result list.
- Security updates: PyJWT 2.15.0 (GHSA-42vr-xj54-vc7v), anyio 4.14.2 (GHSA-82r6-8w77-94w6).

### Changed

- The image installs a complete dependency lock with hashes (`requirements-lock.txt`), transitive dependencies included; the unit tests run on that same lock.

### Documentation

- Comments and documentation point only at files shipped in this repository.
