# Changelog

All notable changes to this project are documented in this file.

## v2.3.0 (2026-02-26)

### Changed

- Finalized Docker ↔ local workspace synchronization for active runtime paths:
  - shared bind mounts for `input/`, `output/`, and `configs/`
  - shared app-source mounts for JS/PY runtime code in development compose
- Enforced root-only runtime directory policy:
  - removed legacy app-local runtime folders (`app/input`, `app/output`, `app/configs`)
  - removed legacy app-local pricing file (`app/config/pricing.json`)
  - runtime now uses root `configs/pricing.json` as the single pricing source of truth
- Removed project-level logs folder coupling:
  - deleted `./logs:/app/logs` compose binds
  - removed `/app/logs` creation from image build
- Clarified and enforced generated output naming convention:
  - `InputName-output-<timestamp>.gcode`
  - `InputName-output-<timestamp>.sl1`
- Continued decomposition of the earlier oversized slicing flow (`slicing.js` legacy concept) into focused modules:
  - `app/services/slice.service.js`
  - `app/services/slice/command.js`
  - `app/services/slice/queue.js`
  - `app/services/slice/zip.js`

### Repository policy

- Publishing policy updated for tests and runtime artifact folders:
  - `tests/testing-scripts/` remains publishable
  - `tests/testing-files/` is excluded from publication
  - `input/` and `output/` are kept as empty tracked folders (`.gitkeep` only)

### Documentation

- Updated README and test documentation to reflect:
  - new output filename convention
  - root runtime folders and pricing persistence path
  - test publication/ignore behavior and corrected `testing-files` path naming

## v2.2.2 (2026-02-25)

### Added

- Published previously private API testing scripts as public repository assets.
- Added unified shared test helpers:
  - `tests/testing scripts/common/env_utils.py`
  - `tests/testing scripts/common/http_utils.py`
- Added standardized JSON and Markdown report outputs for test runners under:
  - `tests/testing scripts/results/`

### Changed

- Reorganized test assets into dedicated public structure:
  - `tests/testing scripts/` for runners and docs
  - `tests/testing files/` for sample inputs
- Refactored slicing internals by decomposing large service logic into focused modules:
  - queue handling (`app/services/slice/queue.js`)
  - command execution (`app/services/slice/command.js`)
  - ZIP processing (`app/services/slice/zip.js`)
- Improved Docker runtime path resolution for configuration profiles and pricing persistence.
- Fixed pricing persistence in containerized runtime by writing `pricing.json` to writable config storage (`/app/configs/pricing.json`).
- Restored Docker slicing stability by fixing runtime config profile lookup (`FDM_*.ini`, `SLA_*.ini`).

### Validation

- Verified Docker-based integration runs for:
  - admin output-files flow
  - pricing lifecycle flow
  - queue concurrency flow

## v2.2.1 (2026-02-25)

### Added

- Added `.env.template` with required and optional runtime variables.

### Changed

- Added `dotenv` integration so local `npm start` also loads `.env` values.
- Updated package version to `2.2.1`.

### Documentation

- Added a quick setup section to README covering:
  - how to wire `.env.template` into `.env`
  - runtime `input/`, `output/`, and `configs/` folder roles
  - available built-in config profiles (`FDM`/`SLA` `.ini`) and `pricing.json` behavior

## v2.2.0 (2026-02-24)

### Added

- Added protected admin endpoint for generated artifact discovery:
  - `GET /admin/output-files`
  - requires `x-api-key` (`ADMIN_API_KEY` must be configured)
  - returns file metadata from `output/` (`fileName`, `sizeBytes`, `createdAt`, `modifiedAt`)
- Added integration test runner for admin output file listing:
  - `tests/admin_output_files_test_runner.py`

### Changed

- Updated slicing response contract:
  - removed `download_url` from `POST /slice/FDM` and `POST /slice/SLA` success payloads.
- Tightened slice endpoint flood control:
  - default slice rate limit is now `3 requests / 60 seconds / IP`.
  - applies only to slicing POST endpoints (`POST /slice/FDM`, `POST /slice/SLA`).
- Updated slice queue execution policy:
  - requests are accepted and processed in FIFO arrival order.
  - default queue concurrency is now `1` (`MAX_CONCURRENT_SLICES`).
- Updated pricing PATCH behavior:
  - `PATCH /pricing/:technology/:material` now updates existing materials only.
  - returns `400` when material does not exist for the selected technology.
- Standardized pricing material matching behavior:
  - create/update/delete matching is case-insensitive (`PLA`, `pla`, `pLa` are equivalent).
  - new material keys are stored in canonical uppercase form.
- Improved docs and test guidance:
  - README updated for new admin endpoint and response contract changes.
  - `tests/API Test.md` updated with new admin endpoint test workflow.

### Documentation

- OpenAPI/Swagger updated with:
  - admin endpoint schema for `GET /admin/output-files`
  - PATCH summary/validation notes for existing-material-only updates.

## v2.1.2 (2026-02-23)

### Changed

- Refactored slicing error handling and response mapping for clearer API behavior:
  - invalid archive input now returns `INVALID_SOURCE_ARCHIVE`
  - invalid/non-printable source geometry now returns `INVALID_SOURCE_GEOMETRY`
  - 10-minute processing timeout now returns `FILE_PROCESSING_TIMEOUT` with HTTP `422`
- Hardened ZIP processing with runtime path resolution and retry logic to prevent transient `ENOENT` failures on upload extraction.
- Disabled model-size preflight slicing stop. Requests are no longer rejected solely due to build-volume dimension checks.
- Reduced cognitive complexity in `slice.service.js` by extracting request parsing, ZIP extraction, conversion, orientation, slicer argument building, and error handling into focused helper functions.
- Improved Docker runtime compatibility:
  - fixed Python script/runtime path consistency
- Removed filesystem logging dependency on `/logs`:
  - removed `LOGS_DIR` and `RUNTIME_PRICING_FILE` path usage
  - removed `pricing.runtime.json` fallback/write target
  - switched error logger to console-only structured logging

### Documentation

- Updated README API usage wording and examples for clarity and consistency.
- Updated README behavior notes to reflect current slicing policy (no preflight build-volume stop).
- Added README notes on Python test runner execution and interpreting `tests/results` outputs.

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
- Added IP-based rate limiting for slicing endpoints (`/slice/FDM`, `/slice/SLA`) with configurable limits.
- Added bounded in-memory slicing queue with configurable concurrency, queue length, and queue timeout.
- Added ZIP archive guard logic to mitigate zip bombs and path traversal:
  - max ZIP entries
  - max cumulative uncompressed size
  - encrypted ZIP rejection
  - unsafe path rejection (`../`, absolute paths)
- Added request size hardening:
  - multipart upload limit for model uploads
  - JSON and urlencoded body size limits
- Hardened monitoring exposure by adding Nginx Basic Auth requirement in `ops/monitoring/setup-monitoring.sh` and monitor vhost template.

### Documentation

- Clarified in README that pricing technology path segments are case-sensitive and canonicalized as uppercase (`FDM`, `SLA`).
- Added optional local Node runtime instructions (`npm start`, `npm run dev`) to README.
- Added security/hardening configuration details to README (rate limit, queue settings, ZIP limits, body/upload limits, monitoring Basic Auth usage).

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
