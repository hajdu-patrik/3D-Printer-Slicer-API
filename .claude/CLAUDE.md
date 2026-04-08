# 3D Printer Slicer API - Claude Instructions

Last synchronized: 2026-04-07

## Architecture Notice
This repository uses both GitHub Copilot and Claude as primary agentic tools.
If rules are changed here, synchronize with:
- CLAUDE.md
- .github/copilot-instructions.md
- .github/skills/*
- .claude/skills/*
- .github/instructions/*

## Goal
Keep slicing behavior safe, deterministic, and production-friendly while preserving strict domain constraints.

## Technology Baseline
- Node.js + Express API
- Python 3.12 preprocessing/orientation scripts
- PrusaSlicer for FDM and SLA
- OrcaSlicer for FDM
- Docker Compose runtime

## Data Flow
Request upload -> option validation -> IP rate limit -> FIFO queue -> converter/orientation -> transform/bounds check -> slicer execution -> output parsing -> pricing response.

## Endpoint Reference
Public endpoints:
- GET /health
- GET /health/detailed
- GET /pricing
- POST /prusa/slice
- POST /orca/slice
- GET /openapi.json
- GET /docs
- GET /

Admin endpoints (x-api-key required):
- POST /pricing/FDM
- POST /pricing/SLA
- PATCH /pricing/:technology/:material
- DELETE /pricing/:technology/:material
- GET /admin/output-files

## Hard Rules
- Use only root-scoped runtime directories: input/, output/, configs/.
- Never switch to app/input, app/output, or app/configs.
- Fail-fast on invalid geometry with INVALID_SOURCE_GEOMETRY.
- Do not auto-repair or mutate invalid user geometry.
- Keep queue and rate-limiting active for slicing.

## Security
- ADMIN_API_KEY must be configured to start API.
- Admin operations require matching x-api-key header.

## Engine Constraints
Prusa:
- Supports layer heights: 0.025, 0.05, 0.1, 0.2, 0.3

Orca:
- FDM only
- Supports layer heights: 0.1, 0.2, 0.3
- Requires compatible machine/process profile pairing

## Queue and Rate Defaults
- Slice rate limit: 3 requests per minute per IP
- MAX_CONCURRENT_SLICES: 1
- MAX_SLICE_QUEUE_LENGTH: 100
- MAX_SLICE_QUEUE_WAIT_MS: 300000
- Slice timeout: 600000 ms

## Skill Packs
Claude skills (thin command references pointing to agent definitions):
- .claude/skills/docker-ops/SKILL.md
- .claude/skills/testing/SKILL.md
- .claude/skills/docs-sync/SKILL.md

## Agent Definitions
Mirrored in `.claude/agents/` and `.github/agents/`:
- orchestrator — plans multi-domain tasks and delegates to sub-agents in parallel
- js-developer — Node.js + Express code in app/
- python-developer — Python converters, orientation, scaling scripts
- test-engineer — Python integration test runners and reports
- docs-syncer — documentation and instruction file synchronization
- docker-specialist — Dockerfile, docker-compose, container lifecycle

For multi-domain tasks, use the orchestrator agent workflow to plan and delegate.

## Testing Rule
After running any Python test runner in tests/testing-scripts/, always read matching markdown report in tests/testing-scripts/results/.

## Documentation Topology
Global:
- CLAUDE.md
- .claude/CLAUDE.md
- .github/copilot-instructions.md

Folder-local:
- app/CLAUDE.md
- configs/CLAUDE.md
- tests/testing-scripts/CLAUDE.md

Copilot instruction overlays:
- .github/instructions/repository.instructions.md
- .github/instructions/app.instructions.md
- .github/instructions/configs.instructions.md
- .github/instructions/testing-scripts.instructions.md
- .github/instructions/github.instructions.md
