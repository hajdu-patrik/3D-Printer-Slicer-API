# App Folder - Local Claude Guide

Last synchronized: 2026-11-27

## Scope

This document describes the application runtime inside app/.

## Runtime Summary

- HTTP stack: Express + helmet + cors + request-id middleware + global error handler.
- Upload flow: sliceRateLimiter, queue pre-check, multer single-file upload on choosenFile (app/middleware/upload.js), then option validation, queueing, conversion, preprocess.py (normalize/orient/metrics), transform, slicing, stats parsing, and pricing response; the result cache can short-circuit slicing (`cache_hit`).
- Async variant: job routes return 202 + jobId and the result is polled via GET /slice/jobs/:jobId.
- Slicing engines: PrusaSlicer (FDM/SLA) and OrcaSlicer (FDM only).
- Runtime folder contract: root-scoped input/, output/, configs/ only.

## Detailed JavaScript File Responsibilities

### Bootstrap and wiring

- app/server.js
  - Starts the Express app, enforces mandatory ADMIN_API_KEY at startup, and initializes required directories and pricing cache.
  - Applies helmet policies (standard for API, dedicated CSP for /docs and /openapi.json).
  - Resolves trust proxy from TRUST_PROXY + TRUST_PROXY_CIDRS.
  - Applies dynamic CORS policy and requestId propagation via X-Request-Id.
  - Registers JSON and urlencoded body limits, Swagger endpoints, business routes, 404 handler, and global error handler.

### Configuration modules

- app/config/constants.js
  - Defines DEFAULTS for rate limits, queue limits, upload limits, timeouts, layer heights, and default materials.
  - Defines extension groups, Orca process-profile defaults, and default pricing matrix.
- app/config/paths.js
  - Resolves absolute runtime paths for input/, output/, configs/, and pricing files.
  - Ensures required directories exist before request processing.
- app/config/python.js
  - Resolves PYTHON_EXECUTABLE securely.
  - Requires absolute existing executable when explicitly configured.
  - Falls back via VIRTUAL_ENV and known absolute runtime paths.

### Middleware

- app/middleware/rateLimit.js
  - Implements in-memory per-IP throttling with configurable window/limit.
  - Exposes sliceRateLimiter, adminRateLimiter and jobPollRateLimiter (default 60 requests / 60 s per IP for job status polling).
  - Returns HTTP 429 + Retry-After + retryAfterSeconds on limit exceed.
  - Periodically prunes expired buckets.
- app/middleware/queuePrecheck.js
  - Advisory queue capacity check (assertSliceQueueCapacity) executed before multer so SLICE_QUEUE_FULL / SLICE_QUEUE_CLIENT_LIMIT are returned before the upload body is accepted.
- app/middleware/upload.js
  - Shared multer single-file upload (choosenFile, MAX_UPLOAD_BYTES, extension whitelist) used by sync and job routes.
- app/middleware/requireAdmin.js
  - Enforces x-api-key for admin-protected operations.
  - Uses timing-safe comparison to reduce timing side-channel risk.
  - Logs unauthorized attempts with resolved client IP + requestId.
- app/middleware/errorHandler.js
  - Normalizes CORS, payload parse/size, and multer upload errors.
  - Keeps stable JSON error payload shape for clients.

### Routes

- app/routes/slice.routes.js
  - Declares POST /prusa/slice and POST /orca/slice.
  - Applies sliceRateLimiter and sliceQueuePrecheck before multer upload.
  - Enforces upload.single('choosenFile') and extension whitelist.
- app/routes/jobs.routes.js
  - Declares POST /prusa/slice/jobs, POST /orca/slice/jobs (202 {success, jobId, status:'queued', statusUrl}) and GET /slice/jobs/:jobId (jobPollRateLimiter).
- app/routes/pricing.routes.js
  - Declares GET /pricing (public).
  - Declares admin mutation routes for create/update/delete pricing entries, optional `materialCostPerUnit` on create/PATCH, and PUT /pricing/:technology/setup-fee.
  - GET /pricing returns hourly maps plus materialCost and setupFee.
  - Applies adminRateLimiter + requireAdmin middleware chain on admin pricing routes.
- app/routes/system.routes.js
  - Declares GET /health, GET /health/detailed and admin GET /metrics (Prometheus text).
  - Declares GET /admin/output-files and GET /admin/download/:fileName.
  - Delegates hardened output listing/download validation to app/services/admin-output.service.js.

### Services: top-level

- app/services/pricing.service.js
  - Facade service that coordinates pricing load/save lifecycle and exposes stable pricing APIs to routes and slicer modules.
  - Delegates persistence to repository and material/domain logic to catalog modules.
- app/services/pricing/repository.js
  - File-system repository for pricing payload read/write and candidate-file discovery.
  - Handles primary/legacy pricing source resolution.
- app/services/pricing/normalize.js
  - Validation/normalization of the optional materialCost and setupFee pricing sections (invalid entries dropped).
- app/services/pricing/catalog.js
  - In-memory pricing domain catalog for normalization, material lookup, and rate calculation logic.
  - Encapsulates technology/material rules and mutation operations.
- app/services/slice.service.js
  - Central orchestrator for slice requests.
  - Validates upload, parses options, checks the result cache, enqueues job by client IP, preprocesses model, runs slicer command, parses stats, computes pricing, and returns response (`cache_hit` true/false).
  - Exposes the pipeline pieces reused by the async job service.
  - Maps queue-layer failures into stable API error codes and status codes.
- app/services/jobs/job-store.js, app/services/jobs/slice-jobs.service.js
  - In-memory async job store (JOB_RESULT_TTL_MS, JOB_MAX_ENTRIES) and submit/status handlers; errors INVALID_JOB_ID, JOB_NOT_FOUND, JOB_STORE_FULL.
- app/services/metrics.service.js
  - Prometheus text-format counters/gauges for slices, queue rejections, jobs and cache.
- app/services/output-retention.service.js
  - Periodic cleanup of old output artifacts and stale upload temp files (OUTPUT_RETENTION_HOURS, UPLOAD_TEMP_RETENTION_MINUTES, OUTPUT_CLEANUP_INTERVAL_MS).
- app/services/admin-output.service.js
  - Validates generated output artifacts for admin listing, single-file download, and ALL-token ZIP export.
  - Applies extension allowlist, path containment, non-symlink target checks, realpath containment, and bulk ZIP resource limits.

### Services: slice submodules

- app/services/slice/command.js
  - Runs external binaries via execFile with argument arrays.
  - Enforces SLICE_COMMAND_TIMEOUT_MS and optional DEBUG_COMMAND_LOGS output.
- app/services/slice/common.js
  - Shared helpers for supported extensions, deterministic output naming, isolated Orca output dirs, file alignment, and cleanup.
- app/services/slice/engine.js
  - Resolves slicer executable name by engine.
  - Builds argument arrays for Prusa (`--center` from profile bed_shape, fallback 100,100) and Orca (`--arrange 1 --orient 0`, `--load-filaments` material JSON) commands.
- app/services/slice/errors.js
  - Classifies pipeline failures (geometry, zip, timeout, unsupported format, Orca profile mismatch).
  - Converts exceptions to stable API error responses.
- app/services/slice/input-processing.js
  - Converts supported model/CAD inputs to STL via Python scripts (cad2stl.py for STEP/IGES first).
  - Runs preprocess.py once (normalize, optional orientation per `autoOrient`, geometry metrics); at most 2 Python spawns per request.
  - renderPreview runs the `preview` mode on the final STL when `includePreview=true`; failures are logged and never fail the slice.
- app/services/slice/model-stats.js
  - Parses slicer outputs for print-time/material stats (`print_time_source`, `material_used_g`, `material_used_ml`).
  - Falls back to a print-time heuristic only when slicer metadata is absent.
- app/services/slice/gcode-metadata.js
  - Reads G-code head/tail (256 KB each) for print time (seconds-accurate comments preferred over M73) and material usage.
- app/services/slice/sla-stats.js
  - Reads `printTime` and `usedMaterial` from the `.sl1` config.ini.
- app/services/slice/result-cache.js
  - In-memory LRU+TTL result cache (SLICE_RESULT_CACHE_TTL_MS, SLICE_RESULT_CACHE_MAX_ENTRIES); key excludes `quantity`.
- app/services/slice/number-utils.js
  - Shared positive-integer parsing helper for queue/zip settings.
- app/services/slice/options.js
  - Validates request fields: layerHeight, material, infill, size/scale/rotation, unit, autoOrient, quantity, includePreview, and profile overrides.
  - Enforces engine/technology layer constraints and material-technology compatibility.
- app/services/slice/profiles.js
  - Resolves Prusa and Orca profile selection.
  - Validates profile existence.
  - Creates runtime profile variants (merging configs/prusa/materials overlays and selecting configs/orca/materials filament JSON) and resolves build-volume limits and Prusa bed center from profile metadata.
- app/services/slice/response.js
  - Composes successful slice response payloads.
  - Builds `model_geometry` (final model metrics) and the optional `preview` payload.
  - Encapsulates pricing (setup fee, material cost, quantity, `price_breakdown`) and profile payload mapper strategies for engine/technology-specific response shaping.
- app/services/slice/queue.js
  - Implements bounded FIFO queue with MAX_CONCURRENT_SLICES, MAX_SLICE_QUEUE_LENGTH, MAX_SLICE_QUEUE_PER_IP, and MAX_SLICE_QUEUE_WAIT_MS.
  - Applies per-client fairness and timeout rejection semantics.
  - Emits typed queue-domain errors and centralized queue-to-API error mapping metadata.
- app/services/slice/transform.js
  - Builds transform plan (scale/rotation), applies model transform via Python script, and validates final bounds against build-volume limits.
- app/services/slice/value-parsers.js
  - Normalizes numeric/boolean/unit inputs and sanitizes profile override filenames.
- app/services/slice/zip.js
  - Performs ZIP guard checks (entry count, cumulative uncompressed size, path safety, encryption rejection, exact single supported source file requirement).

### Utilities and docs generation

- app/utils/client-ip.js
  - Provides normalized client IP retrieval using Express trust-proxy behavior.
- app/utils/env.js
  - Shared environment integer parsing helpers.
- app/utils/logger.js
  - Provides structured error logging helper for processing failures.
- app/docs/swagger-docs.js
  - Generates OpenAPI document used by /openapi.json and Swagger UI /docs.

## Python Helper Scripts in app/

- app/cad2stl.py: CAD-to-STL conversion (curvature-adaptive meshing sized from bbox diagonal, OCC healing options off).
- app/mesh2stl.py: mesh normalization to STL.
- app/orient.py: overhang-aware orientation candidate scoring.
- app/preprocess.py: `preprocess`, `transform` and `preview` modes; prints `@@RESULT@@{json}` (x, y, z, volume_mm3, surface_area_mm2, is_watertight, triangle_count; preview: width, height, format). No model healing.
- app/preview_render.py: isometric PNG renderer (Pillow painter's algorithm, vertex-clustering LOD above 40k faces; preview only, never used for slicing).
- app/scale_model.py: scale/rotation transform execution.

## Endpoint Behavior Notes

- Upload field name must stay choosenFile (multer single-file mode with extension filter).
- /prusa/slice allows FDM and SLA based on layerHeight.
- /orca/slice is FDM-only and profile compatibility aware.
- /orca/slice resolves generated output from per-request isolated output directory before final filename alignment.
- /health/detailed requires admin API key and exposes subsystem diagnostics including queue and Python availability.
- /admin/download/:fileName requires valid admin API key and applies path safety guards.
- /admin/download/:fileName supports ALL token for ZIP bulk download while preserving extension allowlist, path/symlink containment checks, and MAX_ZIP_ENTRIES/MAX_ZIP_UNCOMPRESSED_BYTES limits.
- Cache hits return `cache_hit: true`, recompute price, and create no new output file; `quantity` only affects pricing.
- Unsupported routes return JSON 404 with ROUTE_NOT_FOUND.

## Endpoint and Middleware Chain Map

Public endpoints:

- GET /health -> handler
- GET /pricing -> handler
- POST /prusa/slice -> sliceRateLimiter -> sliceQueuePrecheck -> multer.single(choosenFile) -> handleSlicePrusa
- POST /orca/slice -> sliceRateLimiter -> sliceQueuePrecheck -> multer.single(choosenFile) -> handleSliceOrca
- POST /prusa/slice/jobs -> sliceRateLimiter -> sliceQueuePrecheck -> multer.single(choosenFile) -> submitPrusaSliceJob (202)
- POST /orca/slice/jobs -> sliceRateLimiter -> sliceQueuePrecheck -> multer.single(choosenFile) -> submitOrcaSliceJob (202)
- GET /slice/jobs/:jobId -> jobPollRateLimiter -> getSliceJobStatus
- GET /openapi.json -> handler
- GET /docs -> swagger-ui middleware chain
- GET / -> redirect to /docs

Admin-protected endpoints:

- GET /health/detailed -> adminRateLimiter -> requireAdmin -> handler
- GET /metrics -> adminRateLimiter -> requireAdmin -> handler
- PUT /pricing/:technology/setup-fee -> adminRateLimiter -> requireAdmin -> handler
- POST /pricing/FDM -> adminRateLimiter -> requireAdmin -> handler
- POST /pricing/SLA -> adminRateLimiter -> requireAdmin -> handler
- PATCH /pricing/:technology/:material -> adminRateLimiter -> requireAdmin -> handler
- DELETE /pricing/:technology/:material -> adminRateLimiter -> requireAdmin -> handler
- GET /admin/output-files -> adminRateLimiter -> requireAdmin -> handler
- GET /admin/download/:fileName -> adminRateLimiter -> requireAdmin -> handler

Queue and rate status semantics:

- RATE_LIMIT_EXCEEDED -> HTTP 429
- ADMIN_RATE_LIMIT_EXCEEDED -> HTTP 429
- SLICE_QUEUE_FULL -> HTTP 503
- SLICE_QUEUE_CLIENT_LIMIT -> HTTP 429
- SLICE_QUEUE_TIMEOUT -> HTTP 503
- FILE_PROCESSING_TIMEOUT -> HTTP 422
- JOB_POLL_RATE_LIMIT_EXCEEDED -> HTTP 429
- JOB_STORE_FULL -> HTTP 503, JOB_NOT_FOUND -> HTTP 404, INVALID_JOB_ID -> HTTP 400

## Local Rules

- Keep route handlers thin; put logic in services/.
- Keep error code vocabulary stable for clients.
- Keep queueing and rate-limit protections active.
- Preserve per-client queue fairness cap (MAX_SLICE_QUEUE_PER_IP).
- Keep admin throttling and requestId logging behavior active on admin routes.
- Do not bypass geometry validation rules.
- Keep the cache key free of pricing-only fields (`quantity`) and sensitive to every slicing-relevant option.
