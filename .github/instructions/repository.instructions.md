---
applyTo: "**"
---

# Repository Wide Instructions

Last synchronized: 2026-04-21

## Architecture
- Backend stack is Node.js + Express + Python helper scripts.
- Slicing engines: PrusaSlicer (FDM/SLA) and OrcaSlicer (FDM only).
- Public slicing endpoints: /prusa/slice and /orca/slice.

## Hard Constraints
- Runtime directories must remain root-scoped: input/, output/, configs/.
- Do not introduce app/input, app/output, or app/configs.
- Fail-fast model policy: reject invalid source geometry with INVALID_SOURCE_GEOMETRY.
- Keep queueing and rate-limiting active for CPU-heavy slicing work.
- Keep Orca output mapping deterministic via per-request isolated output directory handling.

## Security
- ADMIN_API_KEY is mandatory at startup.
- Admin routes require x-api-key header (timing-safe comparison).
- Admin routes are IP-rate-limited to reduce brute-force API key attempts.
- X-Forwarded-For is only trusted when TRUST_PROXY=true and TRUST_PROXY_CIDRS is configured.
- Unauthorized admin access logging must include requestId + forwarded-header-aware client IP parsing.
- Python executable resolution must use absolute validated paths (PYTHON_EXECUTABLE or trusted fallbacks).
- Admin output download must preserve extension allowlist and path/symlink containment checks.
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation.

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
