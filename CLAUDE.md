# 3D Printer Slicer API - Claude Operating Guide

Last synchronized: 2026-11-27

## Architecture Notice
Claude is the primary agentic tool for this repository. Guidance lives in Markdown guides only;
there are no agent definitions, skill packs, or Copilot instruction overlays to mirror.
When architecture rules or domain constraints change in this file, keep these files synchronized:
- .claude/CLAUDE.md
- app/CLAUDE.md
- configs/CLAUDE.md
- tests/testing-scripts/CLAUDE.md

## Goal
Provide a reliable slicing and pricing API for 3D printing workflows with strict safety and predictable behavior.

## Technology Baseline
- Backend: Node.js + Express
- Processing: Python 3.12 helper scripts
- Engines: PrusaSlicer (FDM and SLA), OrcaSlicer (FDM only)
- Containerization: Docker Compose

## Runtime Layout (Non-negotiable)
Use root-scoped runtime folders only:
- input/
- output/
- configs/

Do not introduce app/input, app/output, or app/configs.

## Main Data Flow
1. Receive multipart upload (field name: choosenFile).
2. Validate extension and request options.
3. Apply rate limit, run the queue pre-check (SLICE_QUEUE_FULL / SLICE_QUEUE_CLIENT_LIMIT before the upload body is accepted), then enqueue in FIFO queue.
4. Convert source to STL when needed (STEP/IGES via cad2stl.py first).
5. Preprocess via app/preprocess.py (single Python call: STL normalization, optional orientation when `autoOrient` is true, geometry metrics).
6. Apply transform/scale/rotation (preprocess.py `transform` mode) and bounds validation.
7. Slice with selected engine/profile (material overlay merged into the runtime profile).
8. Parse generated output stats (G-code head/tail metadata, SL1 config.ini).
9. Return stats, `price_breakdown` and calculated price; identical requests may be served from the result cache (`cache_hit`).

Async variant: POST /prusa/slice/jobs and /orca/slice/jobs return 202 `{success, jobId, status:'queued', statusUrl}`; GET /slice/jobs/:jobId reports `queued|processing|done{result}|failed{error:{status, body}}`.

## API Endpoint Snapshot
Public endpoints:
- GET /health
- GET /pricing
- POST /prusa/slice
- POST /orca/slice
- POST /prusa/slice/jobs
- POST /orca/slice/jobs
- GET /slice/jobs/:jobId
- GET /openapi.json
- GET /docs
- GET /

Admin-protected endpoints (x-api-key required):
- GET /health/detailed
- GET /metrics
- POST /pricing/FDM
- POST /pricing/SLA
- PUT /pricing/:technology/setup-fee
- PATCH /pricing/:technology/:material
- DELETE /pricing/:technology/:material
- GET /admin/output-files
- GET /admin/download/:fileName

## Preprocessing, Stats and Pricing
- app/preprocess.py has modes `preprocess`, `transform` and `preview` (isometric PNG via app/preview_render.py, Pillow, only when `includePreview=true`) and prints a `@@RESULT@@{json}` line (x, y, z, volume_mm3, surface_area_mm2, is_watertight, triangle_count); at most 2 Python spawns per request; `prusa-slicer --info` is no longer used for dimensions.
- app/orient.py scores orientation candidates overhang-aware; cad2stl.py uses curvature-adaptive meshing with OCC healing options explicitly off.
- Request options: `autoOrient` (bool, default true, INVALID_AUTO_ORIENT), `quantity` (int 1..1000, default 1, INVALID_QUANTITY) and `includePreview` (bool, default false, INVALID_INCLUDE_PREVIEW).
- SLA print time/material come from `.sl1` config.ini (`printTime`, `usedMaterial`), heuristic only as fallback; FDM time prefers seconds-accurate G-code comments over M73; G-code is read head/tail 256 KB only (app/services/slice/gcode-metadata.js, sla-stats.js).
- Price per request: `ceil((setupFee + quantity * (max(hours, 0.25) * hourlyRate + materialAmount * materialCostPerUnit)) / 10) * 10` (HUF). materialAmount is grams for FDM and millilitres for SLA.
- Optional pricing.json sections `materialCost` (`FDM`: HUF/g, `SLA`: HUF/ml per material) and `setupFee` (`FDM`/`SLA` flat HUF per order); files without them stay valid (cost 0).
- Admin pricing API accepts optional `materialCostPerUnit` on POST /pricing/FDM|SLA and PATCH /pricing/:technology/:material (`price` is optional on PATCH when `materialCostPerUnit` is given); PUT /pricing/:technology/setup-fee takes `{setupFee}`.
- GET /pricing returns the hourly maps plus `materialCost` and `setupFee`.
- Slice responses add `quantity`, `price_breakdown`, `cache_hit`, `model_geometry` (volume_cm3 or null when not watertight, surface_area_cm2, is_watertight, triangle_count of the final model), optional `preview` (base64 PNG) and stats fields `print_time_source` (`slicer`|`estimate`), `material_used_g`, `material_used_ml`.
- Result cache (app/services/slice/result-cache.js): key is SHA-256 of file bytes + engine + options except `quantity` + profile/material file mtime/size; hits return `cache_hit: true`, recompute price, and create no new output file. `SLICE_RESULT_CACHE_TTL_MS=0` disables it.
- Output retention sweep (app/services/output-retention.service.js) removes old output artifacts and stale upload temp files (OUTPUT_RETENTION_HOURS, UPLOAD_TEMP_RETENTION_MINUTES, OUTPUT_CLEANUP_INTERVAL_MS).
- GET /metrics (admin) exposes Prometheus text metrics.

## Security and Validation Rules
- ADMIN_API_KEY must exist or server startup is refused.
- Admin operations must pass x-api-key header matching ADMIN_API_KEY.
- Admin API key comparison uses crypto.timingSafeEqual (constant-time).
- Admin authorization failures are rate-limited and logged with requestId + resolved client IP.
- X-Forwarded-For is only trusted when TRUST_PROXY=true and TRUST_PROXY_CIDRS is configured.
- Browser-origin requests to /admin/* must match ADMIN_CORS_ALLOWED_ORIGINS.
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation at upload time.
- /admin/download/:fileName must pass filename extension validation (.gcode/.sl1), path containment checks, lstat non-symlink checks, and realpath containment checks.
- /admin/download/ALL returns a ZIP stream of all valid output files and must preserve the same containment/symlink safety guarantees plus MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.
- Fail-fast geometry policy: invalid geometry returns INVALID_SOURCE_GEOMETRY.
- No automatic model healing/correction is allowed.

## Queue and Rate Protection
Defaults:
- Slicing rate limit: 3 requests per 60 seconds per IP
- Admin rate limit: 30 requests per 60 seconds per IP
- Max concurrent slice jobs: 1
- Max queue length: 100
- Max queued+active slice jobs per client IP: 5
- Max queue wait: 300000 ms
- Job status polling: 60 requests per 60 seconds per IP (JOB_POLL_RATE_LIMIT_EXCEEDED)
- Slice command timeout: 600000 ms (10 minutes)
- ZIP entry limit: 500 files
- ZIP cumulative size limit: 500 MB

Behavior:
- Slice and admin rate limit responses return HTTP 429 with Retry-After and retryAfterSeconds.
- Expired in-memory rate-limit buckets are cleaned periodically at max(windowMs * 2, 60000).
- Queue overflow returns SLICE_QUEUE_FULL (HTTP 503).
- Per-client queue cap returns SLICE_QUEUE_CLIENT_LIMIT (HTTP 429).
- Queue wait timeout returns SLICE_QUEUE_TIMEOUT (HTTP 503).

Return and preserve queue/rate errors:
- RATE_LIMIT_EXCEEDED
- ADMIN_RATE_LIMIT_EXCEEDED
- SLICE_QUEUE_FULL
- SLICE_QUEUE_CLIENT_LIMIT
- SLICE_QUEUE_TIMEOUT
- FILE_PROCESSING_TIMEOUT
- JOB_POLL_RATE_LIMIT_EXCEEDED (HTTP 429)
- JOB_STORE_FULL (HTTP 503), JOB_NOT_FOUND (404), INVALID_JOB_ID (400)

## Python Runtime Resolution
- PYTHON_EXECUTABLE (optional) must be an absolute path and must exist when provided.
- If PYTHON_EXECUTABLE is not set, runtime resolution checks VIRTUAL_ENV/bin/python3 and VIRTUAL_ENV/Scripts/python.exe.
- Additional absolute-path fallbacks: /opt/venv/bin/python3, /usr/local/bin/python3, /usr/bin/python3.
- Startup fails fast when no valid absolute Python executable can be resolved.
- DEBUG_COMMAND_LOGS=true enables converter/slicer stdout/stderr command logging.

## Engine Boundaries
Prusa:
- SLA layer heights: 0.025, 0.05
- FDM layer heights: 0.1, 0.2, 0.3
- `--center` is computed from the profile bed_shape (fallback 100,100).
- Material overlays configs/prusa/materials/FDM_<MAT>.ini and SLA_<MAT>_<layer>mm.ini are merged into the runtime profile (safe-name check; unknown material falls back to the base profile).
- FDM Prusa profiles use a 256x256 bed with max_print_height 256 (FDM fallback build volume 256x256x256); SLA profiles use 120x120 bed and max_print_height 150.

Orca:
- FDM only
- Allowed layer heights: 0.1, 0.2, 0.3
- Requires machine profile + process profile compatibility
- Uses per-request isolated output directories before final artifact alignment.
- Runs with `--arrange 1 --orient 0` (orientation is done once by orient.py) and `--load-filaments` with configs/orca/materials/FDM_<MAT>.json.
- Printer profiles: Prusa `printerProfile=MK4_FDM_<layer>mm.ini` (Original Prusa MK4 IS, 250x210x220; MK4-specific overlays configs/prusa/materials/MK4_FDM_<MAT>.ini are preferred via the profile-name prefix); Orca `printerProfile=Bambu_A1_0.4_nozzle.json` (256^3) or `Bambu_A1_mini_0.4_nozzle.json` (180^3), compatible with the default process profiles. All generated from the official PrusaSlicer 2.8.1 / OrcaSlicer 2.3.1 presets.

## Configuration Keys
Core keys from .env:
- ADMIN_API_KEY
- PORT
- ADMIN_CORS_ALLOWED_ORIGINS
- JSON_BODY_LIMIT
- FORM_BODY_LIMIT
- MAX_UPLOAD_BYTES
- SLICE_RATE_LIMIT_WINDOW_MS
- SLICE_RATE_LIMIT_MAX_REQUESTS
- SLICE_RATE_LIMIT_BURST_CAPACITY
- ADMIN_RATE_LIMIT_WINDOW_MS
- ADMIN_RATE_LIMIT_MAX_REQUESTS
- MAX_CONCURRENT_SLICES
- MAX_SLICE_QUEUE_LENGTH
- MAX_SLICE_QUEUE_PER_IP
- MAX_SLICE_QUEUE_WAIT_MS
- MAX_ZIP_ENTRIES
- MAX_ZIP_UNCOMPRESSED_BYTES
- SLICE_COMMAND_TIMEOUT_MS
- DEBUG_COMMAND_LOGS
- PYTHON_EXECUTABLE
- VIRTUAL_ENV
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- TRUST_PROXY
- TRUST_PROXY_CIDRS
- JOB_RESULT_TTL_MS
- JOB_MAX_ENTRIES
- JOB_POLL_RATE_LIMIT_WINDOW_MS
- JOB_POLL_RATE_LIMIT_MAX_REQUESTS
- SLICE_RESULT_CACHE_TTL_MS
- SLICE_RESULT_CACHE_MAX_ENTRIES
- OUTPUT_RETENTION_HOURS
- UPLOAD_TEMP_RETENTION_MINUTES
- OUTPUT_CLEANUP_INTERVAL_MS
- SLICER_BASE_URL

## Testing Policy
Use Python test runners in tests/testing-scripts/.
After each run, read corresponding markdown report in tests/testing-scripts/results/.

Primary suite:
- python tests/testing-scripts/slicing/full_api_test_runner.py

Focused suites:
- python tests/testing-scripts/slicing/full_api_orca_fdm_test_runner.py
- python tests/testing-scripts/slicing/full_api_prusa_fdm_test_runner.py
- python tests/testing-scripts/slicing/full_api_prusa_sl1_test_runner.py
- python tests/testing-scripts/slicing/unsupported_upload_test_runner.py
- python tests/testing-scripts/slicing/invalid_geometry_test_runner.py
- python tests/testing-scripts/pricing/pricing_cycle_test_runner.py
- python tests/testing-scripts/admin/admin_output_files_test_runner.py
- python tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py
- python tests/testing-scripts/queue/queue_concurrency_test_runner.py --count <N> --retry-on-429 3

Unit suite: `npm test` (Node `node --test` on tests/unit/*.test.js) is the fast pre-check and also runs in CI. Repeated identical slice requests now return `cache_hit: true` unless SLICE_RESULT_CACHE_TTL_MS=0.

Test organization:
- Keep focused runners small and domain-specific (admin output, rate-limit, queue, pricing).
- Split oversized runners into focused suites instead of appending unrelated checks.
- Preserve stable, deterministic runners unless changed endpoint behavior requires updates.

## Workflow Gates
- Run fast syntax validation (`node --check`, `python -m py_compile`) and the Node unit suite (`npm test`, runs `node --test` on tests/unit/*.test.js) before integration suites when source files change.
- Review non-trivial source changes against OOP/SOLID and the decomposition guardrails before running integration suites.
- Run the smallest matching Python runner first; run full slicing validation when slicing behavior changes or the user explicitly asks for full validation.
- Update the Markdown guides last, keeping every file in the Documentation Scope Map consistent.
- Perform changelog/version/tag work only after validation is green.

## Documentation Scope Map
- Global Claude guidance: CLAUDE.md and .claude/CLAUDE.md
- Folder-local docs:
  - app/CLAUDE.md
  - configs/CLAUDE.md
  - tests/testing-scripts/CLAUDE.md
- Repository README: README.md
- Test runner reference: tests/README.md

## CI/CD
- `.github/workflows/ci.yml` ("CI") is the only `.github` asset kept: it validates JS/Python syntax on push to `main` and on manual dispatch. There is no automated deployment and the workflow uses no repository secrets.
- Keep the workflow deterministic and minimal.
