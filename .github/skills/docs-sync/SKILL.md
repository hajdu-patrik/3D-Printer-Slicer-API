---
name: docs-sync
description: Synchronize repository documentation and agent instruction files after architecture, endpoint, security, workflow, or configuration changes.
---

Use this skill to bring all mirrored documentation and instruction files in sync with the current codebase state.

Slash entrypoint:
- Use `/docs-sync` to run the full synchronization workflow.

Full agent definition with file ownership, responsibilities, execution checklist, and scope boundaries is in `.github/agents/docs-syncer.md`.
Read that file for complete context before performing documentation synchronization.

## Files To Synchronize

Each CLAUDE guide has a mirrored Copilot counterpart and both must describe the same behavior:

| CLAUDE guide | Copilot counterpart |
|--------------|---------------------|
| `CLAUDE.md` | `.github/copilot-instructions.md` |
| `app/CLAUDE.md` | `.github/instructions/app.instructions.md` |
| `configs/CLAUDE.md` | `.github/instructions/configs.instructions.md` |
| `tests/testing-scripts/CLAUDE.md` | `.github/instructions/testing-scripts.instructions.md` |

Also keep these aligned when relevant:
- `.github/instructions/repository.instructions.md`
- `.github/instructions/github.instructions.md`
- `README.md`
- `.claude/CLAUDE.md`

## Analysis Workflow

1. Read source files for the changed areas first. Do not infer behavior from stale docs.
2. Capture the concrete deltas: endpoints, security, queue/rate behavior, env keys, workflows.
3. Update all mirrored docs in one pass.
4. Re-check touched docs for contradiction or drift.

## When To Run

- New endpoint added, modified, or removed.
- Security/auth/rate-limit/queue behavior changed.
- Slicing pipeline flow or error-code behavior changed.
- Environment variables, config keys, profile rules, or defaults changed.
- Folder ownership or workflow conventions changed.

## Guardrails

- Do not invent endpoints, env keys, or workflows not present in code.
- Do not leave Copilot and Claude docs in conflicting states.
- Prefer additive edits and preserve existing structure.
- Keep synchronization metadata lines up to date when docs are touched.

## Validation Checklist

- [ ] Root docs and mirrored instructions agree on changed behavior.
- [ ] Endpoint/security/env-key references are current.
- [ ] No stale path or file references remain after renames.
