# 3D Printer Slicer API - Copilot Instructions

Last synchronized: 2026-04-21

## Architecture Notice
This project uses both GitHub Copilot and Claude as primary agentic tools.
If architecture/domain rules change in this file, synchronize changes in:
- CLAUDE.md
- .claude/CLAUDE.md
- .github/skills/*
- .claude/skills/*
- .github/instructions/*

## Goal
Provide a stable and secure slicing API with strict fail-fast validation and production-safe queue controls.

## Technology Baseline
- Backend: Node.js + Express
- Processing: Python 3.12
- Engines: PrusaSlicer (FDM and SLA), OrcaSlicer (FDM only)
- Runtime: Docker Compose

## Repository Surface
- app/: server bootstrap, routes, middleware, services, python converters
- configs/: pricing and slicer profile configuration
- input/: temporary request input workspace
- output/: generated .gcode/.sl1 artifacts
- tests/testing-scripts/: Python integration tests and report generation
- .github/: CI workflow + Copilot instructions + skill mirrors + instruction overlays

## Runtime Flow
Accept upload -> validate options -> rate limit -> queue -> convert/orient -> transform -> slice -> parse stats -> compute pricing -> return response.

## Endpoint Snapshot
Public:
- GET /health
- GET /pricing
- POST /prusa/slice
- POST /orca/slice
- GET /openapi.json
- GET /docs
- GET /

Admin protected (x-api-key):
- GET /health/detailed
- POST /pricing/FDM
- POST /pricing/SLA
- PATCH /pricing/:technology/:material
- DELETE /pricing/:technology/:material
- GET /admin/output-files
- GET /admin/download/:fileName

## Non-negotiable Constraints
- Keep runtime folders root-scoped: input/, output/, configs/.
- Never use app/input, app/output, or app/configs.
- Keep fail-fast policy for invalid geometry (INVALID_SOURCE_GEOMETRY).
- Never suggest auto-healing source models.
- Preserve queue and rate-limit protections for slicing endpoints.

## Queue and Rate Defaults
- 3 requests / 60s / IP for slicing routes
- 30 requests / 60s / IP for admin routes
- MAX_CONCURRENT_SLICES default: 1
- MAX_SLICE_QUEUE_LENGTH default: 100
- MAX_SLICE_QUEUE_PER_IP default: 5
- MAX_SLICE_QUEUE_WAIT_MS default: 300000
- Slice command timeout default: 600000 ms

## Queue and Rate Behavior Details
- Slice and admin throttling return HTTP 429 with Retry-After and retryAfterSeconds.
- Expired in-memory rate-limit buckets are periodically removed at max(windowMs * 2, 60000).
- Queue overflow returns SLICE_QUEUE_FULL (HTTP 503).
- Per-client queue cap returns SLICE_QUEUE_CLIENT_LIMIT (HTTP 429).
- Queue wait timeout returns SLICE_QUEUE_TIMEOUT (HTTP 503).

## Engine Boundaries
Prusa:
- Layer heights: 0.025, 0.05, 0.1, 0.2, 0.3
- SLA inferred for 0.025 and 0.05

Orca:
- FDM only
- Layer heights: 0.1, 0.2, 0.3
- Machine/process profile compatibility is mandatory
- Output mapping uses per-request isolated output directories to avoid cross-request artifact races.

## Security Rules
- ADMIN_API_KEY must be present at startup.
- Admin routes require x-api-key equal to ADMIN_API_KEY.
- Admin API key comparison uses crypto.timingSafeEqual (constant-time).
- Admin middleware applies rate limiting and logs failures with requestId + resolved client IP.
- X-Forwarded-For is only trusted when TRUST_PROXY=true and TRUST_PROXY_CIDRS is configured.
- Browser-origin requests to /admin/* are restricted through ADMIN_CORS_ALLOWED_ORIGINS.
- /admin/download/:fileName must enforce extension validation, path containment checks, non-symlink checks, and realpath containment checks.
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation at upload time.

## Python Runtime Resolution
- PYTHON_EXECUTABLE is optional but must be an existing absolute path when set.
- Fallback resolution checks VIRTUAL_ENV/bin/python3 and VIRTUAL_ENV/Scripts/python.exe.
- Additional fallback candidates are absolute paths: /opt/venv/bin/python3, /usr/local/bin/python3, /usr/bin/python3.
- Server startup fails if no valid absolute Python executable can be resolved.
- DEBUG_COMMAND_LOGS=true enables verbose subprocess command logging.

## Preferred Skills
Skills (thin command references pointing to agent definitions):
- .github/skills/docker-ops/SKILL.md
- .github/skills/testing/SKILL.md
- .github/skills/docs-sync/SKILL.md

## Agent Definitions
Mirrored in `.github/agents/` and `.claude/agents/`:
- orchestrator — plans multi-domain tasks and delegates to sub-agents in parallel
- js-developer — Node.js + Express code in app/
- python-developer — Python converters, orientation, scaling scripts
- test-engineer — Python integration test runners and reports
- docs-syncer — documentation and instruction file synchronization
- docker-specialist — Dockerfile, docker-compose, container lifecycle

For multi-domain tasks, use the orchestrator agent workflow to plan and delegate.

## Test Execution Rule
After every test run, read the generated markdown report under tests/testing-scripts/results/ before concluding.

## Environment and Config Keys
- ADMIN_API_KEY
- PORT
- ADMIN_CORS_ALLOWED_ORIGINS
- JSON_BODY_LIMIT
- FORM_BODY_LIMIT
- MAX_UPLOAD_BYTES
- SLICE_RATE_LIMIT_WINDOW_MS
- SLICE_RATE_LIMIT_MAX_REQUESTS
- ADMIN_RATE_LIMIT_WINDOW_MS
- ADMIN_RATE_LIMIT_MAX_REQUESTS
- MAX_CONCURRENT_SLICES
- MAX_SLICE_QUEUE_LENGTH
- MAX_SLICE_QUEUE_PER_IP
- MAX_SLICE_QUEUE_WAIT_MS
- MAX_ZIP_ENTRIES
- MAX_ZIP_UNCOMPRESSED_BYTES
- SLICE_COMMAND_TIMEOUT_MS
- DEFAULT_RELIEF_DEPTH_MAX_MM
- DEBUG_COMMAND_LOGS
- PYTHON_EXECUTABLE
- VIRTUAL_ENV
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- TRUST_PROXY
- TRUST_PROXY_CIDRS
- SLICER_BASE_URL

## Documentation Layout
Global:
- .github/copilot-instructions.md
- CLAUDE.md
- .claude/CLAUDE.md

Folder-local:
- app/CLAUDE.md
- configs/CLAUDE.md
- tests/testing-scripts/CLAUDE.md

Instruction overlays:
- .github/instructions/repository.instructions.md
- .github/instructions/app.instructions.md
- .github/instructions/configs.instructions.md
- .github/instructions/testing-scripts.instructions.md
- .github/instructions/github.instructions.md