# 3D Printer Slicer API - Claude Operating Guide

Last synchronized: 2026-04-08

## Architecture Notice
This repository uses both GitHub Copilot and Claude as primary agentic tools.
When architecture rules or domain constraints change in this file, keep these files synchronized:
- .github/copilot-instructions.md
- .claude/CLAUDE.md
- .github/skills/*
- .claude/skills/*

## Goal
Provide a reliable slicing and pricing API for 3D printing workflows with strict safety and predictable behavior.

## Technology Baseline
- Backend: Node.js + Express
- Processing: Python 3.12 helper scripts
- Engines: PrusaSlicer (FDM and SLA), OrcaSlicer (FDM only)
- Containerization: Docker Compose

## Runtime Layout (Non-negotiable)
Use root-scoped runtime folders only:
- input/
- output/
- configs/

Do not introduce app/input, app/output, or app/configs.

## Main Data Flow
1. Receive multipart upload (field name: choosenFile).
2. Validate extension and request options.
3. Apply rate limit and enqueue in FIFO queue.
4. Convert source to STL when needed.
5. Run orientation optimization.
6. Apply transform/scale/rotation and bounds validation.
7. Slice with selected engine/profile.
8. Parse generated output stats.
9. Return stats and calculated price.

## API Endpoint Snapshot
Public endpoints:
- GET /health
- GET /pricing
- POST /prusa/slice
- POST /orca/slice
- GET /openapi.json
- GET /docs
- GET /

Admin-protected endpoints (x-api-key required):
- GET /health/detailed
- POST /pricing/FDM
- POST /pricing/SLA
- PATCH /pricing/:technology/:material
- DELETE /pricing/:technology/:material
- GET /admin/output-files
- GET /admin/download/:fileName

## Security and Validation Rules
- ADMIN_API_KEY must exist or server startup is refused.
- Admin operations must pass x-api-key header matching ADMIN_API_KEY.
- Admin API key comparison uses crypto.timingSafeEqual (constant-time).
- Admin authorization logging resolves client IP with forwarded-header-aware parsing (requires TRUST_PROXY=true).
- X-Forwarded-For is only trusted when TRUST_PROXY=true is explicitly configured.
- Browser-origin requests to /admin/* must match ADMIN_CORS_ALLOWED_ORIGINS.
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation at upload time.
- Fail-fast geometry policy: invalid geometry returns INVALID_SOURCE_GEOMETRY.
- No automatic model healing/correction is allowed.

## Queue and Rate Protection
Defaults:
- Slicing rate limit: 3 requests per 60 seconds per IP
- Max concurrent slice jobs: 1
- Max queue length: 100
- Max queue wait: 300000 ms
- Slice command timeout: 600000 ms (10 minutes)

Return and preserve queue/rate errors:
- RATE_LIMIT_EXCEEDED
- SLICE_QUEUE_FULL
- SLICE_QUEUE_TIMEOUT
- FILE_PROCESSING_TIMEOUT

## Engine Boundaries
Prusa:
- SLA layer heights: 0.025, 0.05
- FDM layer heights: 0.1, 0.2, 0.3

Orca:
- FDM only
- Allowed layer heights: 0.1, 0.2, 0.3
- Requires machine profile + process profile compatibility
- Uses per-request isolated output directories before final artifact alignment.

## Configuration Keys
Core keys from .env:
- ADMIN_API_KEY
- PORT
- ADMIN_CORS_ALLOWED_ORIGINS
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
- TRUST_PROXY

## Testing Policy
Use Python test runners in tests/testing-scripts/.
After each run, read corresponding markdown report in tests/testing-scripts/results/.

Primary suite:
- python tests/testing-scripts/full_api_test_runner.py

Focused suites:
- python tests/testing-scripts/full_api_orca_fdm_test_runner.py
- python tests/testing-scripts/full_api_prusa_fdm_test_runner.py
- python tests/testing-scripts/full_api_prusa_sl1_test_runner.py
- python tests/testing-scripts/pricing_cycle_test_runner.py
- python tests/testing-scripts/queue_concurrency_test_runner.py --count <N> --retry-on-429 3

## Skill Routing
Prefer mirrored skills:
- .github/skills/docker-ops/SKILL.md
- .github/skills/testing/SKILL.md
- .github/skills/docs-sync/SKILL.md
- .claude/skills/docker-ops/SKILL.md
- .claude/skills/testing/SKILL.md
- .claude/skills/docs-sync/SKILL.md

Skills are thin command references that point to their corresponding agent definitions for full context.

## Agent Definitions
Mirrored in `.claude/agents/` and `.github/agents/`:
- orchestrator — plans multi-domain tasks and delegates to sub-agents in parallel
- js-developer — Node.js + Express code in app/
- python-developer — Python converters, orientation, scaling scripts
- test-engineer — Python integration test runners and reports
- docs-syncer — documentation and instruction file synchronization
- docker-specialist — Dockerfile, docker-compose, container lifecycle

For multi-domain tasks (new features, endpoint changes, cross-cutting fixes), use the orchestrator agent workflow to plan and delegate.

## Documentation Scope Map
- Global Copilot instructions: .github/copilot-instructions.md
- Global Claude guidance: CLAUDE.md and .claude/CLAUDE.md
- Folder-local docs:
  - app/CLAUDE.md
  - configs/CLAUDE.md
  - tests/testing-scripts/CLAUDE.md
- Additional Copilot instruction packs: .github/instructions/
