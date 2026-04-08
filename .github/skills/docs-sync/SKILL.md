---
name: docs-sync
description: Synchronize repository documentation and agent instruction files after architecture, endpoint, security, workflow, or configuration changes.
---

Use this skill when code or behavior changes require instruction and documentation updates.

Full agent definition with file ownership, responsibilities, execution checklist, and scope boundaries is in `.github/agents/docs-syncer.md`.
Read that file for complete context before performing documentation synchronization.

## Required Sync Targets
- CLAUDE.md
- .claude/CLAUDE.md
- .github/copilot-instructions.md
- README.md
- app/CLAUDE.md
- configs/CLAUDE.md
- tests/testing-scripts/CLAUDE.md
- .github/instructions/repository.instructions.md
- .github/instructions/app.instructions.md
- .github/instructions/configs.instructions.md
- .github/instructions/testing-scripts.instructions.md
- .github/instructions/github.instructions.md

## When to Run
- New endpoint added, modified, or removed.
- Security/auth/rate-limit/queue behavior changed.
- Slicing pipeline flow or error-code behavior changed.
- Environment variables, config keys, profile rules, or defaults changed.
- Folder ownership or workflow conventions changed.

## Guardrails
- Do not invent endpoints, env keys, or workflows not present in code.
- Do not leave Copilot and Claude docs in conflicting states.
- Prefer additive edits and preserve existing structure.
