---
applyTo: "**"
---

# Repository Wide Instructions

Last synchronized: 2026-04-07

## Architecture
- Backend stack is Node.js + Express + Python helper scripts.
- Slicing engines: PrusaSlicer (FDM/SLA) and OrcaSlicer (FDM only).
- Public slicing endpoints: /prusa/slice and /orca/slice.

## Hard Constraints
- Runtime directories must remain root-scoped: input/, output/, configs/.
- Do not introduce app/input, app/output, or app/configs.
- Fail-fast model policy: reject invalid source geometry with INVALID_SOURCE_GEOMETRY.
- Keep queueing and rate-limiting active for CPU-heavy slicing work.

## Security
- ADMIN_API_KEY is mandatory at startup.
- Admin routes require x-api-key header.

## Testing
- Use Python test runners under tests/testing-scripts/.
- Always read generated markdown report from tests/testing-scripts/results/ after runs.

## Multi-agent Sync
When changing architecture/domain policies, keep synchronized:
- .github/copilot-instructions.md
- CLAUDE.md
- .claude/CLAUDE.md
- .github/skills/*
- .claude/skills/*
