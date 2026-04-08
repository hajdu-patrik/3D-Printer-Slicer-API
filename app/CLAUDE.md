# App Folder - Local Claude Guide

Last synchronized: 2026-04-07

## Scope
This document describes the application runtime inside app/.

## Structure and Responsibilities
- app/server.js
  - Express bootstrap
  - Middleware registration (cors, body parser)
  - Swagger/OpenAPI endpoints
  - Route registration
  - Static output download exposure

- app/config/
  - constants.js: defaults, layer presets, limits, extensions
  - paths.js: filesystem path mapping and required folder creation

- app/routes/
  - slice.routes.js: /prusa/slice and /orca/slice
  - pricing.routes.js: /pricing and admin pricing mutations
  - system.routes.js: /health, /health/detailed, /admin/output-files, favicon

- app/middleware/
  - rateLimit.js: in-memory per-IP limiter for slicing
  - requireAdmin.js: x-api-key auth for admin endpoints

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

## Endpoint Behavior Notes
- Upload field name must stay choosenFile.
- /prusa/slice allows FDM and SLA based on layerHeight.
- /orca/slice is FDM-only and profile compatibility aware.
- On unsupported routes, server redirects to /docs.

## Local Rules
- Keep route handlers thin; put logic in services/.
- Keep error code vocabulary stable for clients.
- Keep queueing and rate-limit protections active.
- Do not bypass geometry validation rules.
