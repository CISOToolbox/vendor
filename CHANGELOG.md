# Changelog

Every release has its section here, written at release time from the
changes since the previous one and published as the GitHub release notes.

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
