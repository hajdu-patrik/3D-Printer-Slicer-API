# Changelog

All notable changes to this project are documented in this file.

## v3.0.3 (2026-03-12)

### Added

- Added comprehensive `GET /health/detailed` endpoint for subsystem diagnostics:
  - returns slicer configuration availability (Prusa, Orca paths)
  - checks Python subprocess availability and version string
  - reports queue status (length, active jobs, concurrency limits)
  - HTTP `200 OK` when all subsystems healthy, `503 DEGRADED` on failure
  - includes timestamp, uptime, and detailed subsystem breakdown
- Added `requirements.lock` file with pinned Python package versions for reproducible builds:
  - captures exact trimesh, numpy, manifold3d, and geometry library versions
- Enhanced `.env.example` with comprehensive documentation:
  - ADMIN_API_KEY, PORT, body limits, rate limiting, queue configuration
  - Python path override, logging level, optional feature flags

### Changed

- Hardened dependency security via `npm audit fix`:
  - resolved high-severity multer vulnerability (DoS via incomplete cleanup and resource exhaustion)
  - updated multer from `<=2.1.0` to latest patched version
- Exported `getQueueStatus()` function from `app/services/slice/queue.js` for health check integration

### Validation

- Verified `/health` endpoint returns uptime (existing behavior preserved)
- Verified `/health/detailed` endpoint:
  - returns `HTTP 200` with `status: OK` when all subsystems available
  - returns `HTTP 503` with `status: DEGRADED` when Python subprocess unavailable (expected Windows condition)
  - includes valid queue status reporting (length, active jobs, limits)
  - includes valid slicer path and storage directory checks

## v3.0.2 (2026-03-65)

### Changed

- Decomposed large orchestration blocks for maintainability:
  - `app/services/slice.service.js` (pipeline helpers + response builder extraction)
  - `tests/testing-scripts/admin_output_files_test_runner.py` (validation helpers)
  - `tests/testing-scripts/pricing_cycle_test_runner.py` (shared mutation/verification step helpers)
- Split full API matrix testing into dedicated per-engine/per-technology runners:
  - `tests/testing-scripts/full_api_orca_fdm_test_runner.py`
  - `tests/testing-scripts/full_api_prusa_fdm_test_runner.py`
  - `tests/testing-scripts/full_api_prusa_sl1_test_runner.py`
  - kept `tests/testing-scripts/full_api_test_runner.py` as a suite wrapper that executes all three and writes a consolidated summary
- Hardened runtime image contents in `Dockerfile` without changing app behavior:
  - removed npm CLI (`npm` / `npx` / `corepack`) from final runtime stage
  - removed build-only runtime tools (`curl`, `gnupg`) after Node installation in final stage
- Updated API testing guide for the split full API runners and report outputs:
  - `tests/testing-scripts/API Test.md`

### Validation

- Verified syntax/quality checks on updated service and test files.
- Verified one end-to-end FDM slicing smoke request after slice service decomposition (`HTTP 200`).
- Verified rebuilt backend container reached healthy state after Dockerfile hardening changes.

## v3.0.1 (2026-03-05)

### Changed

- Hardened Prusa runtime INI update logic in `app/services/slice/profiles.js`:
  - replaced fragile regex line replacement with line-based key upsert
  - normalized mixed line ending handling (`CRLF` / `LF` / `CR`)
- Updated Python geometry dependency stack in `requirements.txt`:
  - added `mapbox-earcut==1.0.1`
  - updated `manifold3d` to `3.4.0` (Python 3.12-compatible)
- Reduced duplicated endpoint literals in test runners by introducing constants:
  - `tests/testing-scripts/full_api_test_runner.py`
  - `tests/testing-scripts/queue_concurrency_test_runner.py`
- Hardened value parsing against unsafe object stringification:
  - `app/services/slice/value-parsers.js`
  - `app/services/slice/profiles.js`
- Confirmed request-time model transform controls in slicing flow:
  - target size configuration on `X`, `Y`, `Z` axes
  - rotation configuration on `X`, `Y`, `Z` axes
  - orientation preprocessing applied before slicing

### Fixed

- Fixed Prusa SLA runtime profile corruption that produced merged INI keys (e.g. `printer_technology = SLA\rlayer_height = ...`) and caused SLA slicing 500 errors.
- Fixed Docker build failure caused by malformed concatenated requirement line in `requirements.txt`.
- Fixed Docker build dependency resolution error for unavailable `manifold3d==0.0.6` on Python 3.12.

### Validation

- Verified targeted SLA-only manual runs for both supported SLA layer heights:
  - `0.05` -> successful `200` responses with `.sl1` creation
  - `0.025` -> successful `200` responses with `.sl1` creation (after rate-limit cooldown)

## v3.0.0 (2026-03-03)

### Added

- Added dedicated dual-slicer public endpoints:
  - `POST /prusa/slice`
  - `POST /orca/slice`
- Added Orca runtime profile support with separated machine/process configs:
  - `configs/orca/Bambu_P1S_0.4_nozzle.json`
  - `configs/orca/FDM_0.1mm.json`
  - `configs/orca/FDM_0.2mm.json`
  - `configs/orca/FDM_0.3mm.json`
- Refactored deployment channel:
  - `Dockerfile` (Ubuntu 24.04 base)
  - `docker-compose.yml` (side-by-side rollout porting)

### Changed

- Updated slicing architecture from legacy fixed-technology routes to engine-based routing:
  - removed old client contract dependence on `POST /slice/FDM` and `POST /slice/SLA`
  - introduced engine-aware processing (`prusa` / `orca`)
- Updated layer-height validation policy:
  - Prusa endpoint allows `0.025`, `0.05`, `0.1`, `0.2`, `0.3`
  - Orca endpoint allows `0.1`, `0.2`, `0.3`
- Added material-to-technology guardrails for all slice requests:
  - invalid pairings now return explicit mismatch validation errors
- Updated response payload contract for slicing success:
  - includes `slicer_engine` in response
- Reworked runtime path model for slicer configs:
  - Prusa profiles moved under `configs/prusa/`
  - Orca profiles under `configs/orca/`

### Validation

- Verified next-channel runtime with full regression suite:
  - full API matrix runner
  - queue concurrency runner
  - pricing lifecycle runner
  - admin output-files runner

### Documentation

- Refreshed README endpoint documentation to the new API behavior (`/prusa/slice`, `/orca/slice`).
- Updated badges to include OrcaSlicer and next Ubuntu channel visibility.

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
