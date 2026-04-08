# 3D Printer Slicer API - Copilot Instructions

Last synchronized: 2026-04-07

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
- GET /health/detailed
- GET /pricing
- POST /prusa/slice
- POST /orca/slice
- GET /openapi.json
- GET /docs
- GET /

Admin protected (x-api-key):
- POST /pricing/FDM
- POST /pricing/SLA
- PATCH /pricing/:technology/:material
- DELETE /pricing/:technology/:material
- GET /admin/output-files

## Non-negotiable Constraints
- Keep runtime folders root-scoped: input/, output/, configs/.
- Never use app/input, app/output, or app/configs.
- Keep fail-fast policy for invalid geometry (INVALID_SOURCE_GEOMETRY).
- Never suggest auto-healing source models.
- Preserve queue and rate-limit protections for slicing endpoints.

## Queue and Rate Defaults
- 3 requests / 60s / IP for slicing routes
- MAX_CONCURRENT_SLICES default: 1
- MAX_SLICE_QUEUE_LENGTH default: 100
- MAX_SLICE_QUEUE_WAIT_MS default: 300000
- Slice command timeout default: 600000 ms

## Engine Boundaries
Prusa:
- Layer heights: 0.025, 0.05, 0.1, 0.2, 0.3
- SLA inferred for 0.025 and 0.05

Orca:
- FDM only
- Layer heights: 0.1, 0.2, 0.3
- Machine/process profile compatibility is mandatory

## Security Rules
- ADMIN_API_KEY must be present at startup.
- Admin routes require x-api-key equal to ADMIN_API_KEY.

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
- JSON_BODY_LIMIT
- FORM_BODY_LIMIT
- MAX_UPLOAD_BYTES
- SLICE_RATE_LIMIT_WINDOW_MS
- SLICE_RATE_LIMIT_MAX_REQUESTS
- MAX_CONCURRENT_SLICES
- MAX_SLICE_QUEUE_LENGTH
- MAX_SLICE_QUEUE_WAIT_MS
- MAX_ZIP_ENTRIES
- MAX_ZIP_UNCOMPRESSED_BYTES
- SLICE_COMMAND_TIMEOUT_MS
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3

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