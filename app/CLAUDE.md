# App Folder - Local Claude Guide

Last synchronized: 2026-05-01

## Scope
This document describes the application runtime inside app/.

## Runtime Summary
- HTTP stack: Express + helmet + cors + request-id middleware + global error handler.
- Upload flow: route-level multer single-file upload on choosenFile, then option validation, queueing, conversion/orientation, transform, slicing, stats parsing, and pricing response.
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
  - Exposes sliceRateLimiter and adminRateLimiter.
  - Returns HTTP 429 + Retry-After + retryAfterSeconds on limit exceed.
  - Periodically prunes expired buckets.
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
  - Applies sliceRateLimiter before multer upload.
  - Enforces upload.single('choosenFile') and extension whitelist.
- app/routes/pricing.routes.js
  - Declares GET /pricing (public).
  - Declares admin mutation routes for create/update/delete pricing entries.
  - Applies adminRateLimiter + requireAdmin middleware chain on admin pricing routes.
- app/routes/system.routes.js
  - Declares GET /health and GET /health/detailed.
  - Declares GET /admin/output-files and GET /admin/download/:fileName.
  - Hardened file download path validation includes extension allowlist, path containment, lstat non-symlink checks, and realpath containment checks.

### Services: top-level
- app/services/pricing.service.js
  - Facade service that coordinates pricing load/save lifecycle and exposes stable pricing APIs to routes and slicer modules.
  - Delegates persistence to repository and material/domain logic to catalog modules.
- app/services/pricing/repository.js
  - File-system repository for pricing payload read/write and candidate-file discovery.
  - Handles primary/legacy pricing source resolution.
- app/services/pricing/catalog.js
  - In-memory pricing domain catalog for normalization, material lookup, and rate calculation logic.
  - Encapsulates technology/material rules and mutation operations.
- app/services/slice.service.js
  - Central orchestrator for slice requests.
  - Validates upload, parses options, enqueues job by client IP, preprocesses model, runs slicer command, parses stats, computes pricing, and returns response.
  - Maps queue-layer failures into stable API error codes and status codes.

### Services: slice submodules
- app/services/slice/command.js
  - Runs external binaries via execFile with argument arrays.
  - Enforces SLICE_COMMAND_TIMEOUT_MS and optional DEBUG_COMMAND_LOGS output.
- app/services/slice/common.js
  - Shared helpers for supported extensions, deterministic output naming, isolated Orca output dirs, file alignment, and cleanup.
- app/services/slice/engine.js
  - Resolves slicer executable name by engine.
  - Builds argument arrays for Prusa and Orca commands.
- app/services/slice/errors.js
  - Classifies pipeline failures (geometry, zip, timeout, unsupported format, Orca profile mismatch).
  - Converts exceptions to stable API error responses.
- app/services/slice/input-processing.js
  - Converts source inputs (CAD/image/vector/mesh) to STL via Python scripts.
  - Runs orientation optimization with graceful fallback.
- app/services/slice/model-stats.js
  - Reads model dimensions and parses slicer outputs for print-time/material stats.
  - Builds SLA print-time estimates when metadata is absent.
- app/services/slice/number-utils.js
  - Shared positive-integer parsing helper for queue/zip settings.
- app/services/slice/options.js
  - Validates request fields: layerHeight, material, infill, depth, size/scale/rotation, unit, and profile overrides.
  - Enforces engine/technology layer constraints and material-technology compatibility.
- app/services/slice/profiles.js
  - Resolves Prusa and Orca profile selection.
  - Validates profile existence.
  - Creates runtime profile variants and resolves build-volume limits from profile metadata.
- app/services/slice/response.js
  - Composes successful slice response payloads.
  - Encapsulates pricing and profile payload mapper strategies for engine/technology-specific response shaping.
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
- app/utils/logger.js
  - Provides structured error logging helper for processing failures.
- app/docs/swagger-docs.js
  - Generates OpenAPI document used by /openapi.json and Swagger UI /docs.

## Python Helper Scripts in app/
- app/cad2stl.py: CAD-to-STL conversion.
- app/img2stl.py: image-to-relief STL conversion.
- app/mesh2stl.py: mesh normalization to STL.
- app/vector2stl.py: vector-to-relief STL conversion.
- app/orient.py: orientation optimization for printability.
- app/scale_model.py: scale/rotation transform execution.

## Endpoint Behavior Notes
- Upload field name must stay choosenFile (multer single-file mode with extension filter).
- /prusa/slice allows FDM and SLA based on layerHeight.
- /orca/slice is FDM-only and profile compatibility aware.
- /orca/slice resolves generated output from per-request isolated output directory before final filename alignment.
- /health/detailed requires admin API key and exposes subsystem diagnostics including queue and Python availability.
- /admin/download/:fileName requires valid admin API key and applies path safety guards.
- /admin/download/:fileName supports ALL token for ZIP bulk download while preserving extension allowlist and path/symlink containment checks.
- Unsupported routes return JSON 404 with ROUTE_NOT_FOUND.

## Endpoint and Middleware Chain Map
Public endpoints:
- GET /health -> handler
- GET /pricing -> handler
- POST /prusa/slice -> sliceRateLimiter -> multer.single(choosenFile) -> handleSlicePrusa
- POST /orca/slice -> sliceRateLimiter -> multer.single(choosenFile) -> handleSliceOrca
- GET /openapi.json -> handler
- GET /docs -> swagger-ui middleware chain
- GET / -> redirect to /docs

Admin-protected endpoints:
- GET /health/detailed -> adminRateLimiter -> requireAdmin -> handler
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

## Local Rules
- Keep route handlers thin; put logic in services/.
- Keep error code vocabulary stable for clients.
- Keep queueing and rate-limit protections active.
- Preserve per-client queue fairness cap (MAX_SLICE_QUEUE_PER_IP).
- Keep admin throttling and requestId logging behavior active on admin routes.
- Do not bypass geometry validation rules.
