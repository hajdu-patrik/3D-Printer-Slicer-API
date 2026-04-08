# App Folder - Local Claude Guide

Last synchronized: 2026-04-08

## Scope
This document describes the application runtime inside app/.

## Structure and Responsibilities
- app/server.js
  - Express bootstrap
  - Middleware registration (helmet, cors, body parser, global error handler)
  - Swagger/OpenAPI endpoints
  - Route registration
  - JSON catch-all for unknown routes

- app/config/
  - constants.js: defaults, layer presets, limits, extensions
  - paths.js: filesystem path mapping and required folder creation

- app/routes/
  - slice.routes.js: /prusa/slice and /orca/slice
  - pricing.routes.js: /pricing and admin pricing mutations
  - system.routes.js: /health, /health/detailed, /admin/output-files, /admin/download/:fileName, favicon

- app/middleware/
  - rateLimit.js: in-memory per-IP limiter for slicing with periodic expired-bucket cleanup (shared client IP resolver)
  - requireAdmin.js: x-api-key auth for admin endpoints (timing-safe comparison + shared client IP logs)
  - errorHandler.js: global Express error handler for CORS, parse, limit, and multer errors

- app/services/
  - pricing.service.js: load/normalize/save pricing map
  - slice.service.js: top-level orchestration
  - slice/*: modular slicing pipeline (options, queue, transform, profiles, errors, stats)

- app/*.py
  - cad2stl.py, mesh2stl.py, img2stl.py, vector2stl.py: format converters
  - orient.py: orientation optimization
  - scale_model.py: scaling support

- app/docs/swagger-docs.js
  - OpenAPI document generation from runtime pricing context

- app/utils/logger.js
  - error logging helper for processing failures

- app/utils/client-ip.js
  - shared client IP resolver; only trusts X-Forwarded-For when TRUST_PROXY=true

## Endpoint Behavior Notes
- Upload field name must stay choosenFile (multer single-file mode with extension filter).
- /prusa/slice allows FDM and SLA based on layerHeight.
- /orca/slice is FDM-only and profile compatibility aware.
- /orca/slice resolves generated output from per-request isolated output directory before final filename alignment.
- /health/detailed requires admin API key (exposes subsystem diagnostics).
- /admin/download/:fileName requires valid admin API key.
- Unsupported routes return JSON 404 with ROUTE_NOT_FOUND.

## Local Rules
- Keep route handlers thin; put logic in services/.
- Keep error code vocabulary stable for clients.
- Keep queueing and rate-limit protections active.
- Do not bypass geometry validation rules.
