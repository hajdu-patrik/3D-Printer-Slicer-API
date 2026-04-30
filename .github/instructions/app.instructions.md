---
applyTo: "app/**"
---

# App Folder Instructions

Last synchronized: 2026-04-21

## Responsibilities
- app/server.js handles bootstrap, middleware, routes, docs, and static output serving.
- app/routes should stay lightweight and delegate to services.
- app/services/pricing.service.js remains the facade API; pricing persistence and pricing-domain logic live in app/services/pricing/ submodules.
- app/services/slice/ contains modular pipeline logic (options, queue, transform, profiles, errors).
- app/middleware uses shared client IP parsing based on Express trust-proxy configuration (TRUST_PROXY + TRUST_PROXY_CIDRS).
- app/middleware/requireAdmin.js uses timing-safe API key comparison.
- app/middleware/rateLimit.js includes periodic expired-bucket cleanup and separate admin throttling middleware.

## Endpoint Rules
- Keep upload field name as choosenFile.
- Keep endpoint contracts stable:
  - POST /prusa/slice
  - POST /orca/slice
  - GET /pricing
  - GET /health (public) and GET /health/detailed (admin-protected)
  - POST /pricing/FDM (admin-protected)
  - POST /pricing/SLA (admin-protected)
  - PATCH /pricing/:technology/:material (admin-protected)
  - DELETE /pricing/:technology/:material (admin-protected)
  - GET /admin/output-files (admin-protected)
  - GET /admin/download/:fileName (admin-protected)

## Safety Rules
- Preserve queue and rate-limit protections.
- Preserve per-client queue fairness cap (MAX_SLICE_QUEUE_PER_IP).
- Preserve queue/status mapping: SLICE_QUEUE_FULL (503), SLICE_QUEUE_CLIENT_LIMIT (429), SLICE_QUEUE_TIMEOUT (503).
- Preserve rate-limit response shape and Retry-After behavior for slice/admin throttling.
- Preserve Orca per-request isolated output directory handling.
- Preserve error code names used by clients.
- Do not auto-heal invalid geometry.
