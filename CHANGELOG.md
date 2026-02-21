# Changelog

All notable changes to this project are documented in this file.

## v2.1.1 (2026-02-21)

### Changed

- Standardized OpenAPI/Swagger pricing paths to canonical uppercase technology routes:
  - `POST /pricing/FDM`
  - `POST /pricing/SLA`
  - `PATCH /pricing/FDM/:material`
  - `PATCH /pricing/SLA/:material`
  - `DELETE /pricing/FDM/:material`
  - `DELETE /pricing/SLA/:material`
- Added npm runtime scripts for faster local process start:
  - `npm start`
  - `npm run dev`

### Documentation

- Clarified in README that pricing technology path segments are case-sensitive and canonicalized as uppercase (`FDM`, `SLA`).
- Added optional local Node runtime instructions (`npm start`, `npm run dev`) to README.

## v2.1.0 (2026-02-20)

### Changed

- Removed legacy `POST /slice` endpoint from the API routing layer.
- Removed deprecated `/slice` operation from OpenAPI/Swagger documentation.
- Kept slicing contract explicit with dedicated endpoints only:
  - `POST /slice/fdm`
  - `POST /slice/sla`

### Documentation

- Updated endpoint documentation to reflect explicit FDM/SLA routing.
- Added retroactive release notes for historical tags.

## v2.0.0 (2026-02-20)

### Stable release

- Stabilized v2 baseline and refreshed release documentation.
- Strengthened public deployment/security guidance in docs.
- Tag message: `v2.0.0 stable release`.

## v1.1.2 (2026-02-19)

### Docs patch (v1.1.2)

- README patch release.
- Tag message: `README.md patch v1.1.2`.

## v1.1.1 (2026-02-19)

### Docs patch (v1.1.1)

- README patch release.
- Tag message: `README.md patch v1.1.1`.

## v1.1.0 (2026-02-19)

### Added

- Endpoint expansion and API structure improvements.
- Public README and project branding update (logo).

### Changed (v1.1.0)

- Refactored large `server.js` into a modular ecosystem.
- Tag message: `Important update v1.1.0: decoupled the big server.js file into a whole ecosystem! New endpoints added!`.

## v1.0.0 (2026-02-19)

### Release

- First stable release for FDM/SLA workflows on CAD and direct 3D inputs.
- Added logging system and GitHub Actions VPS deployment workflow.
- Tag message: `v1.0.0 release`.

## v0.9.2 (2026-02-18)

### Milestone (v0.9.2)

- Added `.zip` input support (first valid supported file in archive is processed).
- Continued work on `.igs/.iges`, vector, and image input handling.
- Tag message: `v0.9.2 milestone`.

## v0.9.1 (2026-02-17)

### Milestone (v0.9.1)

- Accepted `.obj` flow with conversion of incoming models to `.stl`.
- Tag message: `v0.9.1 milestone`.

## v0.9.0 (2026-02-17)

### Milestone (v0.9.0)

- Early SLA price prediction support for `.stl`, `.3mf`, and `.obj`.
- Tag message: `v0.9.0 milestone`.
