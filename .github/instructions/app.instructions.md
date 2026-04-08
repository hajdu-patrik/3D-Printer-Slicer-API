---
applyTo: "app/**"
---

# App Folder Instructions

Last synchronized: 2026-04-07

## Responsibilities
- app/server.js handles bootstrap, middleware, routes, docs, and static output serving.
- app/routes should stay lightweight and delegate to services.
- app/services/slice/ contains modular pipeline logic (options, queue, transform, profiles, errors).

## Endpoint Rules
- Keep upload field name as choosenFile.
- Keep endpoint contracts stable:
  - POST /prusa/slice
  - POST /orca/slice
  - GET /pricing
  - GET /health and GET /health/detailed

## Safety Rules
- Preserve queue and rate-limit protections.
- Preserve error code names used by clients.
- Do not auto-heal invalid geometry.
