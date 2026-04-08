---
applyTo: "app/**"
---

# App Folder Instructions

Last synchronized: 2026-04-08

## Responsibilities
- app/server.js handles bootstrap, middleware, routes, docs, and static output serving.
- app/routes should stay lightweight and delegate to services.
- app/services/slice/ contains modular pipeline logic (options, queue, transform, profiles, errors).
- app/middleware uses shared client IP parsing (TRUST_PROXY-aware) for consistent security and rate logs.
- app/middleware/requireAdmin.js uses timing-safe API key comparison.
- app/middleware/rateLimit.js includes periodic expired-bucket cleanup.

## Endpoint Rules
- Keep upload field name as choosenFile.
- Keep endpoint contracts stable:
  - POST /prusa/slice
  - POST /orca/slice
  - GET /pricing
  - GET /health (public) and GET /health/detailed (admin-protected)

## Safety Rules
- Preserve queue and rate-limit protections.
- Preserve Orca per-request isolated output directory handling.
- Preserve error code names used by clients.
- Do not auto-heal invalid geometry.
