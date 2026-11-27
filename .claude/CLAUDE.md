# 3D Printer Slicer API - Claude Instructions

Last synchronized: 2026-11-27

## Architecture Notice
Claude is the primary agentic tool for this repository. Guidance lives in Markdown guides only;
agent definitions, skill packs, and Copilot instruction overlays were retired.
If rules are changed here, synchronize with:
- CLAUDE.md
- app/CLAUDE.md
- configs/CLAUDE.md
- tests/testing-scripts/CLAUDE.md

## Goal
Keep slicing behavior safe, deterministic, and production-friendly while preserving strict domain constraints.

## Technology Baseline
- Node.js + Express API
- Python 3.12 preprocessing/orientation scripts
- PrusaSlicer for FDM and SLA
- OrcaSlicer for FDM
- Docker Compose runtime

## Data Flow
Request upload -> IP rate limit -> queue pre-check -> upload -> option validation -> FIFO queue -> converter -> preprocess.py (normalize, optional orientation, metrics) -> transform/bounds check -> slicer execution -> output parsing -> pricing response (result cache may short-circuit with `cache_hit: true`).

Async variant: POST /prusa/slice/jobs and /orca/slice/jobs return 202 `{success, jobId, status:'queued', statusUrl}`; GET /slice/jobs/:jobId returns `queued|processing|done{result}|failed{error:{status, body}}`.

## Endpoint Reference
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

Admin endpoints (x-api-key required):
- GET /health/detailed
- GET /metrics
- POST /pricing/FDM
- POST /pricing/SLA
- PUT /pricing/:technology/setup-fee
- PATCH /pricing/:technology/:material
- DELETE /pricing/:technology/:material
- GET /admin/output-files
- GET /admin/download/:fileName

## Hard Rules
- Use only root-scoped runtime directories: input/, output/, configs/.
- Never switch to app/input, app/output, or app/configs.
- Fail-fast on invalid geometry with INVALID_SOURCE_GEOMETRY.
- Do not auto-repair or mutate invalid user geometry.
- Keep queue and rate-limiting active for slicing.

## Preprocessing, Stats and Pricing
- app/preprocess.py (modes `preprocess`, `transform`, `preview`) emits `@@RESULT@@{json}` geometry metrics; at most 2 Python spawns per request; `prusa-slicer --info` no longer used for dimensions.
- orient.py is overhang-aware; cad2stl.py uses curvature-adaptive meshing with OCC healing off (no-healing policy unchanged).
- Request options: `autoOrient` (default true, INVALID_AUTO_ORIENT), `quantity` (1..1000, default 1, INVALID_QUANTITY), `includePreview` (default false, INVALID_INCLUDE_PREVIEW; isometric PNG via app/preview_render.py).
- SLA time/material from `.sl1` config.ini (`printTime`, `usedMaterial`), heuristic fallback only; FDM prefers seconds-accurate comments over M73; G-code read head/tail 256 KB only.
- Price per request: `ceil((setupFee + quantity * (max(hours, 0.25) * hourlyRate + materialAmount * materialCostPerUnit)) / 10) * 10` (HUF). materialAmount is grams for FDM and millilitres for SLA.
- Optional pricing.json sections `materialCost` (`FDM`: HUF/g, `SLA`: HUF/ml per material) and `setupFee` (`FDM`/`SLA` flat HUF per order); files without them stay valid (cost 0).
- Admin pricing API accepts optional `materialCostPerUnit` on POST /pricing/FDM|SLA and PATCH /pricing/:technology/:material (`price` is optional on PATCH when `materialCostPerUnit` is given); PUT /pricing/:technology/setup-fee takes `{setupFee}`.
- GET /pricing returns the hourly maps plus `materialCost` and `setupFee`.
- Slice responses add `quantity`, `price_breakdown`, `cache_hit`, `model_geometry`, optional `preview` and stats fields `print_time_source` (`slicer`|`estimate`), `material_used_g`, `material_used_ml`.
- Result cache key: SHA-256 of file + options except `quantity` + profile/material file mtime/size; `SLICE_RESULT_CACHE_TTL_MS=0` disables it.
- Output retention sweep and admin GET /metrics (Prometheus text) are active.

## Security
- ADMIN_API_KEY must be configured to start API.
- Admin operations require matching x-api-key header.
- Admin API key comparison uses crypto.timingSafeEqual (constant-time).
- Admin auth failures are rate-limited and logged with requestId + resolved client IP.
- X-Forwarded-For is only trusted when TRUST_PROXY=true and TRUST_PROXY_CIDRS is configured.
- Browser-origin requests to /admin/* are restricted by ADMIN_CORS_ALLOWED_ORIGINS.
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation at upload time.
- /admin/download/:fileName enforces extension checks, path containment checks, non-symlink target checks, and realpath containment checks.
- /admin/download/ALL returns a ZIP stream of all valid output files while preserving the same containment/symlink safety checks plus MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.

## Engine Constraints
Prusa:
- Supports layer heights: 0.025, 0.05, 0.1, 0.2, 0.3
- `--center` computed from profile bed_shape (fallback 100,100); material overlays configs/prusa/materials/ merged into the runtime profile (unknown material -> base profile).
- FDM profiles: 256x256 bed, max_print_height 256 (fallback build volume 256x256x256); SLA: 120x120 bed, max_print_height 150.

Orca:
- FDM only
- Supports layer heights: 0.1, 0.2, 0.3
- Requires compatible machine/process profile pairing
- Uses per-request isolated output directories before final output-file alignment.
- Runs with `--arrange 1 --orient 0` and `--load-filaments` configs/orca/materials/FDM_<MAT>.json.
- Printer profiles: Prusa `printerProfile=MK4_FDM_<layer>mm.ini` (Original Prusa MK4 IS, 250x210x220; MK4-specific overlays configs/prusa/materials/MK4_FDM_<MAT>.ini are preferred via the profile-name prefix); Orca `printerProfile=Bambu_A1_0.4_nozzle.json` (256^3) or `Bambu_A1_mini_0.4_nozzle.json` (180^3), compatible with the default process profiles. All generated from the official PrusaSlicer 2.8.1 / OrcaSlicer 2.3.1 presets.

## Queue and Rate Defaults
- Slice rate limit: 3 requests per minute per IP
- Admin rate limit: 30 requests per minute per IP
- MAX_CONCURRENT_SLICES: 1
- MAX_SLICE_QUEUE_LENGTH: 100
- MAX_SLICE_QUEUE_PER_IP: 5
- MAX_SLICE_QUEUE_WAIT_MS: 300000
- Job status polling: 60 requests per minute per IP
- Slice timeout: 600000 ms
- MAX_ZIP_ENTRIES: 500
- MAX_ZIP_UNCOMPRESSED_BYTES: 524288000

Queue and rate behavior:
- Slice/admin rate-limit responses return HTTP 429 with Retry-After and retryAfterSeconds.
- Rate-limit buckets are periodically pruned (max(windowMs * 2, 60000)).
- SLICE_QUEUE_FULL returns HTTP 503.
- SLICE_QUEUE_CLIENT_LIMIT returns HTTP 429.
- SLICE_QUEUE_TIMEOUT returns HTTP 503.
- Queue pre-check middleware returns SLICE_QUEUE_FULL / SLICE_QUEUE_CLIENT_LIMIT before the upload body is accepted.
- Job errors: INVALID_JOB_ID (400), JOB_NOT_FOUND (404), JOB_STORE_FULL (503), JOB_POLL_RATE_LIMIT_EXCEEDED (429).

## Python Runtime Resolution
- PYTHON_EXECUTABLE is optional but must be an existing absolute path when set.
- Without PYTHON_EXECUTABLE, runtime resolver checks VIRTUAL_ENV/bin/python3 and VIRTUAL_ENV/Scripts/python.exe.
- Additional absolute fallbacks: /opt/venv/bin/python3, /usr/local/bin/python3, /usr/bin/python3.
- Server startup fails if no valid absolute Python executable can be resolved.
- DEBUG_COMMAND_LOGS=true enables verbose subprocess command logs.

## Environment Keys
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

## Workflow Gates
- Run fast syntax validation (`node --check`, `python -m py_compile`) and the Node unit suite (`npm test`, runs `node --test` on tests/unit/*.test.js) before integration suites when source files change.
- Review non-trivial source changes against OOP/SOLID and the decomposition guardrails before running integration suites.
- Run the smallest matching Python runner first; run full slicing validation when slicing behavior changes or the user explicitly asks for full validation.
- Update the Markdown guides last, keeping every file in the Documentation Topology consistent.
- Perform changelog/version/tag work only after validation is green.

## Local-Only Files
- `.claude/.mcp.json` is local-only and must not be committed.
- `.env` holds runtime secrets and stays untracked; `.env.example` documents the keys.

## Testing Rule
Fast pre-check: `npm test` (Node `node --test`, tests/unit/*.test.js; also run in CI). Repeated identical slice requests return `cache_hit: true` unless SLICE_RESULT_CACHE_TTL_MS=0.

After running any Python test runner in tests/testing-scripts/, always read matching markdown report in tests/testing-scripts/results/.

Focused test runners:
- tests/testing-scripts/slicing/unsupported_upload_test_runner.py
- tests/testing-scripts/slicing/invalid_geometry_test_runner.py
- tests/testing-scripts/admin/admin_output_files_test_runner.py
- tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py

Test organization:
- Keep focused runners small and behavior-oriented.
- Split oversized runners by domain and avoid mixing unrelated assertions.
- Leave stable deterministic runners unchanged unless endpoint behavior changes.

## Documentation Topology
Global:
- CLAUDE.md
- .claude/CLAUDE.md

Folder-local:
- app/CLAUDE.md
- configs/CLAUDE.md
- tests/testing-scripts/CLAUDE.md

Public docs:
- README.md
- tests/README.md

## CI/CD
- `.github/workflows/ci.yml` ("CI") is the only `.github` asset kept: it validates JS/Python syntax on push to `main` and on manual dispatch. There is no automated deployment and the workflow uses no repository secrets.
- Keep the workflow deterministic and minimal.
