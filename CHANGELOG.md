# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Removed

- Retired the dual-tool agentic asset set. Deleted `.github/agents/*` (7 agent definitions), `.github/skills/*` (4 skill packs), `.github/instructions/*` (5 Copilot instruction overlays), `.github/copilot-instructions.md`, `.claude/agents/*` (7 mirrored agent definitions), `.claude/skills/*` (4 mirrored skill packs), and `.claude/.mcp.template.json`. `.github/workflows/deploy.yml` is the only remaining `.github` asset, so CI/CD is unaffected: the workflow file itself, its triggers, its validation steps, and its deploy script are untouched.
- The mirrored-asset maintenance burden goes with them: guidance now lives only in the Markdown guides (`CLAUDE.md`, `.claude/CLAUDE.md`, `app/CLAUDE.md`, `configs/CLAUDE.md`, `tests/testing-scripts/CLAUDE.md`) plus the public `README.md` / `tests/README.md`.

### Documentation

- Rewrote the sections in `CLAUDE.md` and `.claude/CLAUDE.md` that referenced the removed assets: the Architecture Notice now lists only the Markdown guides as sync targets, the Skill Routing / Skill Packs and Agent Definitions sections are replaced by a standalone `Workflow Gates` section (same gates, phrased without agent delegation), the MCP template note became a `Local-Only Files` section, and both files gained a `CI/CD` section describing `.github/workflows/deploy.yml` as the only retained `.github` asset.
- Updated the documentation-synchronization bullet in `README.md`, which pointed at `.github/instructions/*`.
- Verified no file outside `CHANGELOG.md` history still references a deleted path or agent name.

### Notes

- No source file, test runner, dependency, or configuration key changed, so `package.json` stays at `3.1.5`.

## v3.1.5 (2026-09-22)

### Dependencies

- Updated npm dependencies within their existing declared version ranges: `helmet` 8.1.0 -> 8.3.0, `multer` 2.1.1 -> 2.4.0, `yauzl` 3.3.0 -> 3.4.0. `cors` and `swagger-ui-express` were already at the newest version permitted by their existing ranges; only `package-lock.json` resolutions moved for those.
- Upgraded `express` 4.22.3 -> 5.2.1 (major). The only code change required was in `app/server.js`: the catch-all unknown-route handler `app.all('*', ...)` became `app.all('/*splat', ...)`, because Express 5's path-to-regexp v8 rejects a bare unnamed wildcard at route-registration time. Every other documented Express 5 breaking change was checked against this codebase and does not apply here: `req.query` is only ever read, never assigned; `req.body` is always defined because `express.json()`/`express.urlencoded()` are registered globally ahead of every route; `req.param()`, `app.del()`, legacy `res.sendfile()`, `res.redirect('back')`, and the removed two-argument/status-only forms of `res.send()`/`res.json()` are not used anywhere; `express.static()` is not used; every route parameter is a plain named `:param` (no optional `?` params); and the global error-handling middleware in `app/middleware/errorHandler.js` matches errors structurally rather than depending on Express-version-specific behavior. `multer` declares no `express` peer dependency; `swagger-ui-express` declares `peerDependencies.express: ">=4.0.0 || >=5.0.0-beta"`, explicitly admitting Express 5; `helmet` and `cors` are framework-agnostic and unaffected by the Express major.
- Upgraded `dotenv` 17.3.1 -> 18.0.1 (major). Evaluated against the documented v18 breaking changes: the new CLI, `.env.vault` support removal, and preload-flag removal are all unused by this app (only `require('dotenv').config()` with no arguments is called, in `app/server.js`); the fast-parser opt-in (`{ fast: true }`) is not enabled; default option values (`override`, `quiet`, `debug`, `encoding`, `path`) and parsing rules (quoting, backticks, multiline double-quoted values, `#` comments, no implicit variable expansion) are unchanged between 17.4.2 and 18.0.1. The one observed behavior change: the informational startup line (`injected env (N) from .env`) moved from stdout to stderr and dropped its rotating promotional tip suffix - confirmed harmless because nothing in this codebase parses its own stdout/stderr, and the reported variable count was identical (13) before and after.
- Evaluated `archiver` 7.0.1 -> 8.0.0 (major) and held it back: `archiver@8.0.0` declares `"type": "module"` with a single `"./index.js"` export and no `require` condition, i.e. it is ESM-only, while `app/routes/system.routes.js` loads it via `const archiver = require('archiver')` and `package.json` declares no `"type": "module"` (this is a CommonJS project). `require()` of an ESM-only package only works starting Node 22.12 (`require(esm)`); the pinned production runtime is Node 20, so archiver 8 would crash the container at boot with `ERR_REQUIRE_ESM` despite passing a boot smoke on this machine's newer local Node. Kept at `^7.0.1`.
- `npm audit --omit=dev`: 4 advisories before this update (1 low, 1 moderate, 2 high, all `fixAvailable` via the in-range/major bumps above) now report 0.

### Docker and Supply Chain

- Moved the production container runtime from Node.js 20 (end-of-life 2026-04-30) to Node.js 24 LTS: `Dockerfile`'s NodeSource repository line changed from `node_20.x` to `node_24.x` in both the `builder` and final runtime stages. The built runtime image resolves to Node.js `24.21.0` (via `node -v` inside the container). Ubuntu 24.04, Python 3.12, and the pinned PrusaSlicer 2.8.1 / OrcaSlicer 2.3.1 AppImages and their SHA256 checksums are unchanged.
- Updated `.github/workflows/deploy.yml` to match: `actions/setup-node`'s `node-version` `'20'` -> `'24'`. Also bumped GitHub Action majors to the newest stable tag of each, verified via `git ls-remote --tags` on 2026-09-19: `actions/checkout` v4 -> v7, `actions/setup-node` v4 -> v7, `actions/setup-python` v5 -> v7, and `appleboy/ssh-action` v1.0.0 -> v1.2.5 (newest stable release within the v1 line; no v2+ major line exists for this action). Secrets, the deploy script, and the `concurrency` block are unchanged.
- Re-evaluated `archiver` 7.0.1 -> 8.0.0 now that the runtime can `require()` an ESM-only package (Node's `require(esm)` support, available since 22.12). Built the real Node 24 image and booted it: startup itself is clean, with no `ERR_REQUIRE_ESM`. However `GET /admin/download/ALL` (the only route using `archiver`, in `app/routes/system.routes.js`) failed at request time with `TypeError: archiver is not a function`. Root cause, confirmed by inspecting the resolved package directly: `archiver@8.0.0`'s CommonJS-visible export is no longer a single callable zip-factory function but an object of named classes (`Archiver`, `JsonArchive`, `TarArchive`, `ZipArchive`) with no `default` either - a genuine breaking API redesign, not just an ESM-packaging detail, and one that a static `npm view`/`require()`-resolves check cannot reveal. Kept at `^7.0.1`; adopting 8.x would require rewriting the ZIP-building call site against the new API, which is out of scope for a runtime/dependency update.
- Re-ran `npm outdated` against the Node 24-adopted tree: `archiver` remains the only outdated direct dependency (latest `8.0.0`, held back per above). Every other direct dependency (`cors`, `dotenv`, `express`, `helmet`, `multer`, `swagger-ui-express`, `yauzl`) is already at its newest published version, so the Node 24 runtime does not unblock anything else.
- Synced the Node.js version mentioned in `.claude/agents/docker-specialist.md` and its `.github/agents/docker-specialist.md` mirror ("20.x from NodeSource" -> "24.x from NodeSource").

### Fixed

- Corrupted model uploads now fail fast with a client error instead of a generic server error. `isSourceGeometryError()` in `app/services/slice/errors.js` only matched a fixed list of converter output hints, none of which covered the messages the converters actually emit for unreadable input, so every corrupted CAD/mesh upload fell through to `500` / `INTERNAL_PROCESSING_ERROR`. Reproduced against the Docker runtime with corrupted `.step`, `.obj`, `.3mf`, and `.ply` uploads (all `500` before the fix, all `400` / `INVALID_SOURCE_GEOMETRY` after). Root cause detail: `runCommand()` sets `error.stderr = stderr || stdout`, so when gmsh writes to stderr (`Error   : Could not read file '<path>'`) the Python converter's own stdout message never reaches the classifier; the hint list now covers both streams. Added hints: `could not read file`, `is not a valid cad file`, `could not convert this cad file`, `invalid mesh file`, `does not contain mesh geometry`, `could not convert this mesh file`. The `failedConverter` guard is unchanged, so matching is still restricted to `cad2stl.py` / `mesh2stl.py` failures and cannot reclassify unrelated internal errors. Verified that a valid `Camera.step` upload still returns `200` and that an empty STL still returns its existing `422` / `MODEL_DIMENSIONS_UNAVAILABLE` (that path never reaches a converter and is unchanged).

### Added (Tests)

- `tests/testing-scripts/slicing/invalid_geometry_test_runner.py` — focused regression runner for the fail-fast geometry policy. Generates corrupted STEP/OBJ/3MF/PLY uploads (expect `400` / `INVALID_SOURCE_GEOMETRY`) and an empty STL (expect `422` / `MODEL_DIMENSIONS_UNAVAILABLE`), reuses the shared `common/` helpers and the bounded 429-retry pattern of `unsupported_upload_test_runner.py`, and writes `results/invalid_geometry_test_result.md`.

### Validation

- Verified every adopted dependency's `engines.node` admits Node 20 (the pinned production runtime), plus a full recursive `node_modules/**/package.json` scan (108 packages declaring `engines.node`, all admitting `20.20.2`) using npm's own bundled `semver` module.
- Verified `node --check` on every `app/**/*.js` file (32 files) and a clean `npm ci --omit=dev --ignore-scripts` install matching the Dockerfile's install step.
- Verified the Express 5 upgrade with a local boot smoke (no Docker): booted the API on a loopback port before and after the upgrade and compared `GET /health`, `GET /docs`, `GET /openapi.json`, `GET /pricing`, an unknown route, `GET`/`PATCH`/`DELETE` against every parameterized and admin-protected route without credentials, a CORS preflight `OPTIONS` request, and a malformed-JSON request body — all thirteen probes returned identical status codes and response bodies before and after, with no deprecation warnings or errors in server output. Repeated the identical thirteen-probe boot smoke for the `dotenv` 18 upgrade (stdout and stderr captured separately this time) with the same result: byte-for-byte identical status codes and bodies, and the only stdout/stderr difference was the expected relocated startup line described above.
- Scanned the final installed tree for ESM-only packages that a `require()` on the boot path would fail to load under Node 20: exactly 5 (`ansi-regex@6.3.0`, `ansi-styles@6.2.3`, `string-width@5.1.2`, `strip-ansi@7.2.0`, `wrap-ansi@8.1.0`), all already present with the same identity in the pre-upgrade lockfile (transitive siblings of `archiver@7`'s own dependency chain that ship pre-built CommonJS-safe `*-cjs` aliases for anything that actually `require()`s them) - no new ESM-only package was introduced by this update.
- Verified the Node 24 runtime move for real in Docker (not previously possible): built two images from clean `git archive` exports - never the working tree, so the owner's local-only files (`.env`, the real `configs/pricing.json`, `input/`, `output/`, `.venv/`) never entered an image - one from this repository's previous state (Node 20) and one from the Node-24 work tree, each with a throwaway test `configs/pricing.json` seeded from the tracked `configs/pricing.example.json` schema and a random test `ADMIN_API_KEY`. Ran an identical verification matrix against both, published on loopback-only test ports:
  - Both containers reach Docker `healthy` status within 10 seconds of starting; `node -v`, `python3 -V`, `prusa-slicer --help`, and `orca-slicer --help` all run correctly as the non-root `slicer` user (`id` reports `uid=999(slicer)`).
  - `GET /health` (200), the Swagger UI route (`/docs` -> 301 -> 200), `GET /openapi.json` (200), `GET /pricing` (200), an unknown route (404 `ROUTE_NOT_FOUND`), every admin/parameterized route without credentials (401), the same routes with the test key (2xx), the admin pricing create/PATCH/delete cycle, the root redirect (302), a CORS preflight (204), and a malformed-JSON body (400) all matched between the two images.
  - Ran one real slicing request per supported technology (FDM via PrusaSlicer, FDM via OrcaSlicer, SLA via PrusaSlicer) against both images with a generated 20 mm binary STL cube and diffed the full JSON responses: identical on every field (profiles, transform, build-volume limits, print time, material usage, price) once the two images' independently generated output filenames/timestamps are set aside - those never appear inside the slice response body itself. The generated `.gcode`/`.sl1` files were byte-identical in size between Node 20 and Node 24 (290461, 348312, and 161211 bytes).
  - Downloaded the `/admin/download/ALL` ZIP bulk export from both images and listed it with `python -m zipfile -l`: both contain the same three files at the same sizes; total archive size differs by 1 byte (93039 vs 93038 bytes), consistent with ZIP local-header timestamp encoding rather than a functional difference.
  - `docker logs` on the Node 24 container contain no deprecation warnings, no `ExperimentalWarning`, and no stack traces; a line-by-line diff against the Node 20 container's logs differs only in random upload hashes, PIDs, thread addresses, requestIds, and timestamps.
  - This also supplies evidence that was missing after the previous update: the Express 5 / dotenv 18 state introduced above had never been booted under any Node runtime inside a real Docker container (only via a local `node` process). The Node 20 (`pre_sha`) image built and passed this same matrix cleanly, closing that gap.
- Ran the full Python regression set against the Docker runtime (`docker compose up -d slicer-api`, image rebuilt from this work tree) after the geometry fix: `full_api_test_runner.py` 21/21 (Orca FDM 7/7, Prusa FDM 7/7, Prusa SL1 7/7, including the expected `422` / `MODEL_OUT_OF_PRINTER_BOUNDS` SLA bounds rejection), `invalid_geometry_test_runner.py` 5/5, `unsupported_upload_test_runner.py` 2/2, `pricing_cycle_test_runner.py` 12/12, `admin_output_files_test_runner.py` pass, `queue_concurrency_test_runner.py --count 5` 5/5 with staggered completion confirming serialized queue processing, and `rate_limit_regression_test_runner.py` pass (slice limiter first `429` at attempt 6 with `RATE_LIMIT_EXCEEDED`, admin limiter first `429` at attempt 31 with `ADMIN_RATE_LIMIT_EXCEEDED`, both carrying `Retry-After` and `retryAfterSeconds`). Reports written to `tests/testing-scripts/results/`.
- Verified the remaining endpoints by hand against the same runtime: `GET /` (302 to `/docs`), `GET /docs` (Swagger UI renders and lists the Pricing/Slicing/Admin operations), `GET /openapi.json`, `GET /health`, `GET /health/detailed` (all subsystems `OK`, Python 3.12.3, both slicer config paths present), unknown route (`404` / `ROUTE_NOT_FOUND`), admin endpoints without and with a wrong `x-api-key` (`401`), and the slice option guards (`NO_FILE_UPLOADED`, `UNEXPECTED_FILE_FIELD`, `INVALID_LAYER_HEIGHT_FOR_ENGINE`, `INVALID_MATERIAL_FOR_TECHNOLOGY`, `MATERIAL_TECHNOLOGY_MISMATCH`, `INVALID_PROFILE_NAME` for a path-traversal profile name, `CONFLICTING_SIZE_OPTIONS`, `INVALID_SIZE_OPTIONS`, `INVALID_SIZE_UNIT`, `INVALID_ROTATION_OPTIONS`, and `422` / `MODEL_OUT_OF_PRINTER_BOUNDS` for an oversized scale).
- Verified `GET /admin/download/:fileName` guards on a throwaway container with an isolated output directory: single-file download `200`, missing file `404` / `OUTPUT_FILE_NOT_FOUND`, non-allowlisted extension `400` / `INVALID_OUTPUT_FILE`, encoded traversal attempts (`..%2F..%2Fetc%2Fpasswd`, `%2e%2e%2f%2e%2e%2fpackage.json`) and nested paths all `400` / `INVALID_OUTPUT_FILE`, and `GET /admin/download/ALL` `200` streaming a valid ZIP whose entries matched the directory listing (the repository's own `output/` directory holds 183 artifacts and therefore legitimately returns `413` against the configured bulk limits).

### Documentation

- Updated the README Express badge from `4.18.2` to `5.2.1` to match the upgraded dependency.
- Updated the README Node.js badge from `20.20.2` to `24.21.0` to match the new runtime, using the exact version the built image reports via `node -v`.
- Bumped package and OpenAPI metadata from `3.1.4` to `3.1.5` (`package.json`, `package-lock.json`, `app/docs/swagger-docs.js`); `GET /openapi.json` and the Swagger UI header now report `3.1.5`.
- Registered the new invalid-geometry runner across the mirrored documentation set (`CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`, `.github/instructions/testing-scripts.instructions.md`, `tests/testing-scripts/CLAUDE.md`, `tests/README.md`, both `test-engineer` agent definitions, and both `testing` skill packs).

### Notes

- The dependency updates and the Node 24 runtime move in this release carry no behavior change of their own: both were verified to produce byte-for-byte identical API responses. They ship here bundled with the release rather than as a standalone version bump, matching every prior version in this project's history (`v2.0.0` through `v3.1.4`), where dependency work always shipped inside a feature, security, or behavioral release.
- The geometry error-classification fix **is** a client-visible behavior change (`500` / `INTERNAL_PROCESSING_ERROR` -> `400` / `INVALID_SOURCE_GEOMETRY` for corrupted uploads), and it is what makes this a versioned patch release. Clients that treated a corrupted upload as a retryable server error must now treat it as a permanent client error; no successful-slice response shape changed.

## v3.1.4 (2026-05-14)

### Added

- Added `tests/testing-scripts/slicing/unsupported_upload_test_runner.py` to verify former 2D artwork uploads are rejected with stable error codes for both direct upload and ZIP archive paths.
- Kept `scipy` as an explicit Python dependency because stable-pose orientation for supported 3D models depends on it; this preserves post-orientation build-volume validation after removing the former broad `trimesh[easy]` dependency set.

### Removed

- Removed image-to-STL and vector-to-STL slicing support from the public upload pipeline.
  - Deleted the former 2D-to-3D converter scripts and removed raster/vector extensions from upload, ZIP extraction, test discovery, Docker, and CI validation paths.
  - Removed the conversion-specific request option and matching environment configuration because they only applied to the former 2D artwork workflow.
  - Reason: the API is now intentionally model-focused. Accepting 2D artwork as printable geometry created a different product workflow with ambiguous geometry expectations, higher conversion dependency surface, and weaker alignment with the fail-fast model-fidelity policy. Users should upload explicit 3D/CAD source geometry instead.

### Fixed

- Hardened `/admin/download/ALL` by enforcing `MAX_ZIP_ENTRIES` and `MAX_ZIP_UNCOMPRESSED_BYTES` before ZIP streaming begins.
- Corrected admin output listing to reuse the same validated output-file path, symlink, extension, and realpath checks as downloads.
- Updated the admin output test runner to accept HTTP `413` with `BULK_DOWNLOAD_LIMIT_EXCEEDED` when the current output set exceeds configured bulk ZIP limits.
- Updated the full API slice matrix to treat explicitly declared fail-fast geometry/bounds rejections as passing behavior when the status and `errorCode` match exactly.
- Clarified the queue concurrency report so client start-order matching is informational and staggered completion remains the black-box queue serialization signal.
- Aligned `package-lock.json` root metadata with `package.json` and corrected the package `main` entry to `app/server.js`.

### Changed

- Added `app/services/admin-output.service.js` to keep admin output listing/download validation outside route handlers.
- Updated `MAX_ZIP_ENTRIES` default to `500` across runtime constants and `.env.example`, matching the documented bulk export default.
- Bumped package and OpenAPI metadata to `3.1.4`.
- Refined README markdown formatting, endpoint listing, ZIP upload wording, and admin `ALL` bulk-limit documentation.

### Agentic Workflow

- Added explicit tool allowlists to mirrored `.github/agents/*` and `.claude/agents/*` agent definitions.
- Improved orchestrator workflow gates for fast validation, quality review, scoped test selection, docs-sync, and release/tag sequencing.
- Added `.claude/.mcp.template.json` as a credential-free optional Docker MCP template and ignored local `.claude/.mcp.json`.
- Synchronized mirrored skills and docs-sync guidance for agent/skill/MCP workflow assets.

### Validation

- `node --check` passed for all `app/**/*.js` files.
- `python -m py_compile` passed for all `app/**/*.py` and `tests/testing-scripts/**/*.py` files.
- `npm audit --audit-level=high` reported 0 vulnerabilities.
- Docker Compose rebuild completed and `GET /health` returned HTTP 200.
- Pricing, admin output, queue concurrency, rate-limit regression, and full API slicing runners were refreshed with current markdown reports.
- Full API split suite passed 24/24 expected outcomes, including the expected Prusa SLA `MODEL_OUT_OF_PRINTER_BOUNDS` fail-fast rejection for `direct/Creeper.stl`.

## v3.1.3 (2026-05-01)

### Added

- Added `/admin/download/ALL` special token support for ZIP bulk download of all generated output files.
  - Streams a ZIP archive via `archiver` (v7.0.1) added as new runtime dependency.
  - Preserves the same extension allowlist, path containment, symlink, and realpath safety checks as single-file download.
  - Returns `application/zip` content-type with a timestamped `output-files-<timestamp>.zip` filename.
  - Enforces `MAX_ZIP_ENTRIES` and `MAX_ZIP_UNCOMPRESSED_BYTES` limits to prevent resource exhaustion.
  - Added `MAX_ZIP_ENTRIES` and `MAX_ZIP_UNCOMPRESSED_BYTES` environment keys (defaults: 500 entries / 500 MB).

### Changed

- Reorganized test runners from flat `tests/testing-scripts/` layout into domain-specific subdirectories:
  - `tests/testing-scripts/slicing/` — full suite wrapper and engine-specific matrix runners
  - `tests/testing-scripts/admin/` — admin output listing and download tests
  - `tests/testing-scripts/pricing/` — pricing lifecycle tests
  - `tests/testing-scripts/queue/` — queue concurrency tests
  - `tests/testing-scripts/rate_limit/` — rate-limit regression tests
- Extracted `resolveOutputDirectoryPaths()` and `resolveValidatedOutputFile()` helpers in `app/routes/system.routes.js` to reduce inline path-validation duplication.
- Updated OpenAPI definition in `app/docs/swagger-docs.js` to document ALL token behavior, dual content-type response, and fileName parameter description.
- Updated version metadata to `3.1.3` in project manifests and OpenAPI definition.

### Added (Tests)

- Extended `tests/testing-scripts/admin/admin_output_files_test_runner.py` with ALL-token download checks:
  - Unauthorized access to `/admin/download/ALL` is rejected (401/503).
  - Authorized access returns 200 ZIP when output files exist, or 404 when empty.
- Added new focused runner `tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py`:
  - Probes `/admin/download/ALL` until 429 and validates `ADMIN_RATE_LIMIT_EXCEEDED` + `Retry-After` semantics.
  - Probes `/prusa/slice` until 429 and validates `RATE_LIMIT_EXCEEDED` + `Retry-After` semantics.
  - Reads rate-limit configuration from `.env` with environment defaults as fallback.

### Documentation

- Synced all instruction and guidance files with new paths and ALL-token security rules:
  - `CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`
  - `.github/instructions/repository.instructions.md`, `.github/instructions/app.instructions.md`
  - `.github/instructions/testing-scripts.instructions.md`
  - `app/CLAUDE.md`, `tests/testing-scripts/CLAUDE.md`
  - Both `SKILL.md` testing mirrors and both `test-engineer.md` agent definitions
  - `README.md` — added `/admin/download/:fileName` section with ALL token docs and curl examples

## v3.1.2 (2026-04-30)

### Added

- Added adaptive slice rate limiting with token-bucket behavior to better support short legitimate request bursts while preserving VPS protection limits.
- Added configurable `SLICE_RATE_LIMIT_BURST_CAPACITY` (default `5`) to tune burst handling independently from per-window request limits.
- Added `quality-architect` agent in both agent registries:
  - `.github/agents/quality-architect.md`
  - `.claude/agents/quality-architect.md`
- Added mirrored best-practice quality workflow skill:
  - `.github/skills/best-practice/SKILL.md`
  - `.claude/skills/best-practice/SKILL.md`

### Changed

- Refactored `app/middleware/rateLimit.js` to a class-based OOP design with separated limiter strategies:
  - `FixedWindowRateLimiter` for admin controls
  - `TokenBucketRateLimiter` for slice controls
  - shared middleware wrapper with stable 429 payload contract
- Renamed the mirrored quality skill to `best-practice` and rewrote mirrored skill files as operational playbooks (workflow, guardrails, validation checklists).
- Refactored `app/services/slice/queue.js` to use typed queue-domain errors with centralized queue-to-HTTP mapping metadata (replacing prefix-string control flow).
- Extracted slice success payload composition from `app/services/slice.service.js` into `app/services/slice/response.js` with strategy-style profile and pricing mappers.
- Decomposed `processSlice` in `app/services/slice.service.js` into smaller stage helpers for request parsing, output target resolution, profile resolution, model preparation, and slicer execution.
- Refactored `app/middleware/errorHandler.js` from condition-heavy branching to declarative known-error strategy rules with stable response mapping.
- Refactored `app/routes/pricing.routes.js` by extracting shared technology/material/price validators and persistence helpers to reduce duplicated route control flow.
- Refactored `app/services/pricing.service.js` into a facade delegating persistence to `app/services/pricing/repository.js` and domain/material logic to `app/services/pricing/catalog.js`.
- Preserved public pricing service API contracts for route and slicer modules while introducing explicit repository/catalog boundaries.
- Updated orchestration docs to include the new quality-focused phase between tests and final documentation sync.
- Updated version metadata to `3.1.2` in project manifests and OpenAPI definition.

### Fixed

- `app/server.js`: hardened trust-proxy fallback behavior to avoid risky forwarded-header trust when CIDRs are not configured.
- `app/services/slice.service.js`: ensured temp upload cleanup on invalid option parsing failures.
- `app/services/slice/options.js`: corrected technology-aware default material selection for SLA/FDM paths.

### Documentation

- Synced core instruction files and mirrored guidance (`CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`) with:
  - new quality agent/skill references
  - updated environment key list including burst capacity
  - refreshed synchronization metadata

## v3.1.1 (2026-04-21)

### Security Hardening

- Added dedicated admin endpoint throttling (`ADMIN_RATE_LIMIT_EXCEEDED`) and applied it across all admin-protected routes.
- Hardened admin artifact download path in `app/routes/system.routes.js`:
  - strict extension allowlist (`.gcode`, `.sl1`)
  - parent-path containment checks
  - `lstat` non-symlink target enforcement
  - `realpath` containment verification
- Strengthened forwarded-header trust model:
  - Express trust-proxy now resolved via `TRUST_PROXY` + `TRUST_PROXY_CIDRS`
  - client IP resolution normalized and delegated to Express trust-proxy behavior
- Added request correlation support with propagated `X-Request-Id` and requestId-aware admin/security logs.

### Runtime and Queue Controls

- Added per-client queue fairness cap (`MAX_SLICE_QUEUE_PER_IP`) to prevent single-client queue monopolization.
- Added explicit queue error mapping for client cap violations (`SLICE_QUEUE_CLIENT_LIMIT`, HTTP 429).
- Preserved bounded FIFO behavior with wait-time expiration (`SLICE_QUEUE_TIMEOUT`) and queue-cap protection (`SLICE_QUEUE_FULL`).
- Added configurable admin rate-limit defaults and env controls:
  - `ADMIN_RATE_LIMIT_WINDOW_MS`
  - `ADMIN_RATE_LIMIT_MAX_REQUESTS`

### Python Execution Safety

- Introduced centralized Python runtime resolver in `app/config/python.js`.
- Enforced absolute-path validation when `PYTHON_EXECUTABLE` is set.
- Added safe fallback lookup via `VIRTUAL_ENV` and trusted absolute runtime paths.
- Updated all converter/orientation/transform subprocess calls to use validated `PYTHON_EXECUTABLE`.

### Request Validation

- Added a bounded validation guard for the legacy conversion option parser.

### Docker and Supply Chain

- Added SHA256 verification for downloaded PrusaSlicer and OrcaSlicer AppImages during Docker build.

### Documentation

- Completed full documentation synchronization across:
  - `CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`
  - folder-local guides (`app/CLAUDE.md`, `configs/CLAUDE.md`, `tests/testing-scripts/CLAUDE.md`)
  - instruction overlays in `.github/instructions/*`
- Expanded `README.md` with:
  - detailed `app/*.js` module map
  - queue/rate-limit response semantics by HTTP status
  - consolidated security/runtime change snapshot

### Validation

- Docker-first verification completed against running compose environment.
- Integration test evidence (reports under `tests/testing-scripts/results/`):
  - `pricing_cycle_test_result.md`: 12/12 success
  - `admin_output_files_test_result.md`: pass
  - `queue_concurrency_test_result.md`: 4/4 success

## v3.1.0 (2026-04-08)

### Security Hardening

- **Shell command injection prevention:** Replaced `child_process.exec()` with `child_process.execFile()` across all command execution paths. Python converter/orientation/transform calls, `prusa-slicer --info`, and slicer invocations now use argument arrays instead of string interpolation — eliminates shell injection via crafted filenames or parameters.
  - `app/services/slice/command.js` — core `runCommand()` signature changed from `(cmd: string)` to `(executable, args[])`
  - `app/services/slice/input-processing.js` — all 5 converter/orientation calls updated
  - `app/services/slice/transform.js` — `scale_model.py` call updated
  - `app/services/slice/model-stats.js` — `prusa-slicer --info` call updated
  - `app/services/slice/engine.js` — `buildSlicerCommandArgs()` now returns `string[]` instead of concatenated string
  - `app/services/slice.service.js` — slicer invocation uses spread args

- **Timing-safe admin key comparison:** Admin API key verification in `app/middleware/requireAdmin.js` now uses `crypto.timingSafeEqual()` with fixed-length buffer handling to prevent timing side-channel attacks.

- **IP spoofing prevention:** `app/utils/client-ip.js` now only trusts `X-Forwarded-For` header when `TRUST_PROXY=true` is explicitly configured in environment. Default behavior ignores the header, preventing rate-limit bypass via header spoofing.

- **Rate-limit memory leak fix:** `app/middleware/rateLimit.js` now runs periodic cleanup (`setInterval` with `.unref()`) to evict expired IP buckets, preventing unbounded memory growth under sustained traffic.

- **Upload restriction hardening:** `app/routes/slice.routes.js` changed from `upload.any()` to `upload.single('choosenFile')` with a `fileFilter` that validates file extensions against the known-good set before writing to disk. Prevents arbitrary file field flooding and rejects unsupported formats at upload time.

- **Information disclosure fixes:**
  - `GET /health/detailed` now requires `requireAdmin` middleware — no longer publicly exposes queue state, Python version, or filesystem accessibility
  - Removed internal filesystem `path` fields from `/health/detailed` subsystem response (slicer paths, output directory path)
  - All 500 error responses in `app/routes/system.routes.js` now return generic messages and log details server-side only

- **Multer error handling hardening:** `app/middleware/errorHandler.js` now handles `LIMIT_UNEXPECTED_FILE` (returns 400 with `UNEXPECTED_FILE_FIELD`) and generic `MulterError` (returns 400 with `UPLOAD_ERROR`) instead of falling through as 500 Internal Server Error.

### Changed

- `GET /health/detailed` moved from public to admin-protected endpoint (requires `x-api-key` header)
- `app/services/slice.service.js` — `findUploadedModelFile()` updated for `req.file` (singular) API from `upload.single()`
- Added `TRUST_PROXY` to environment configuration keys across all instruction files

### Documentation

- Updated endpoint classification in all instruction/documentation files (15 files):
  - `README.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`
  - `app/CLAUDE.md`, `.github/instructions/app.instructions.md`, `.github/instructions/repository.instructions.md`
  - `.claude/agents/js-developer.md`, `.github/agents/js-developer.md`
- Added security documentation to `README.md`: timing-safe auth, proxy trust, upload validation, rate-limit cleanup
- Updated `VPS settings.md`: added `TRUST_PROXY=true` to `.env` guide, added `X-Forwarded-For` and `X-Forwarded-Proto` proxy headers to Nginx config
- Updated `app/CLAUDE.md`: errorHandler middleware entry, client-ip TRUST_PROXY note, /health/detailed admin note

## v3.0.5 (2026-04-08)

### Added

- Added agentic orchestration workflow with 6 specialized agent definitions:
  - `orchestrator` — plans multi-domain tasks and delegates to parallel sub-agents
  - `js-developer` — owns Node.js + Express code in `app/`
  - `python-developer` — owns Python converters, orientation, and scaling scripts
  - `test-engineer` — owns Python integration test runners and report generation
  - `docs-syncer` — owns all documentation and instruction file synchronization
  - `docker-specialist` — owns Dockerfile, docker-compose, and container lifecycle
- Agent definitions mirrored in `.claude/agents/` and `.github/agents/`
- Added folder-local `CLAUDE.md` instruction files:
  - `app/CLAUDE.md` — app folder structure, endpoint behavior, local rules
  - `configs/CLAUDE.md` — config folder scope, safety constraints, related env keys
  - `tests/testing-scripts/CLAUDE.md` — test runner groups, shared helpers, reporting contract
- Added Copilot instruction overlays for folder-scoped context:
  - `.github/instructions/repository.instructions.md`
  - `.github/instructions/app.instructions.md`
  - `.github/instructions/configs.instructions.md`
  - `.github/instructions/testing-scripts.instructions.md`
  - `.github/instructions/github.instructions.md`

### Changed

- Restructured skill files (`docker-ops`, `testing`, `docs-sync`) into thin command references that point to their corresponding agent definitions for full context
- Migrated orchestration from skill to agent definition (`.claude/agents/orchestrator.md`)
- Rewrote `.claude/CLAUDE.md` and `.github/copilot-instructions.md` from legacy format to standardized multi-agent instruction structure with endpoint snapshots, engine constraints, queue defaults, skill/agent routing, and documentation topology
- Added `GET /`, `GET /health/detailed`, `GET /openapi.json`, `GET /docs` to Copilot and Claude instruction endpoint lists (were missing)
- Added missing environment keys to `.github/copilot-instructions.md`: `JSON_BODY_LIMIT`, `FORM_BODY_LIMIT`, `MAX_UPLOAD_BYTES`, `MAX_ZIP_ENTRIES`, `MAX_ZIP_UNCOMPRESSED_BYTES`

### Fixed

- Fixed README Node.js badge version: `24.11.1` → `20.x` (matches Dockerfile NodeSource repo)
- Fixed README `MAX_UPLOAD_BYTES` default: `250MB` → `100MB` (matches `constants.js`)
- Fixed README `MAX_ZIP_UNCOMPRESSED_BYTES` default: `250MB` → `500MB` (matches `zip.js`)
- Fixed README missing public endpoints: added `GET /health/detailed`, `GET /openapi.json`, `GET /docs`
- Fixed Dockerfile HEALTHCHECK misalignment with docker-compose.yml: `start_period` `5s` → `30s`, `retries` `3` → `5`

### Removed

- Removed legacy `.agents/skills/` directory (replaced by `.claude/agents/` and `.github/agents/`)
- Removed `AGENTS.md` (replaced by agent definitions in agents/ folders)
- Removed stale references to `.github/CLAUDE.md` (file never existed) from all instruction files
- Removed stale references to `.agents/skills/` from all instruction files

## v3.0.4 (2026-03-27)

### Added

- Added clean `requirements.txt` to root for dedicated Python runtime dependency tracking:
  - specifically targets geometry conversion dependencies used by the runtime pipeline
  - enables reliable Docker caching for the Python layer

### Changed

- Deeply optimized `Dockerfile` for size, security, and build speed (2026 DevOps Best Practices):
  - merged system dependencies (`apt-get`) and locale generation into a single layer
  - eliminated `chown -R` duplication by using `COPY --chown=slicer:slicer` for massive size reduction
  - enforced Read-Only dependencies: `/opt/venv` and `node_modules` remain root-owned for security
  - aggregated aggressive cleanup (removal of `npm`, `curl`, `gnupg`, manpages) into a single final layer
  - reorganized user creation (`slicer`) to the beginning of the runtime stage
- Restructured `docker-compose.yml` and `server.js` runtime paths for "Agentic" workflows:
  - redirected all intermediate conversion/extraction files to `uploads/help-files/` to maintain a clean root `uploads/` directory
  - implemented strict cleanup logic ensuring `help-files/` is emptied immediately after slicing
- Cleaned up legacy converter scripts for SonarLint and Pylance compliance:
  - removed unused variables and implicit imports
  - tightened exception handling with specific classes (e.g., `ValueError`)

### Removed

- Removed `requirements.lock` from the root directory:
  - eliminated documentation-specific (MkDocs) dependencies from the production build path to prevent bloatware

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
- Continued work on `.igs/.iges` and archive input handling.
- Tag message: `v0.9.2 milestone`.

## v0.9.1 (2026-02-17)

### Milestone (v0.9.1)

- Accepted `.obj` flow with conversion of incoming models to `.stl`.
- Tag message: `v0.9.1 milestone`.

## v0.9.0 (2026-02-17)

### Milestone (v0.9.0)

- Early SLA price prediction support for `.stl`, `.3mf`, and `.obj`.
- Tag message: `v0.9.0 milestone`.
