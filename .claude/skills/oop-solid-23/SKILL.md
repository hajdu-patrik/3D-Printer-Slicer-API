---
name: oop-solid-23
description: Iterative OOP/SOLID quality-improvement workflow using a 23-point engineering checklist.
---

Use this skill when asked to improve code architecture, readability, OOP design, SOLID compliance, or refactor for maintainability.

Full agent definition with checklist, constraints, and iterative workflow is in `.claude/agents/quality-architect.md`.
Read that file before running broad refactors.

## Recommended Iteration Loop
1. Identify 1-3 highest-impact quality hotspots.
2. Apply minimal refactors with stable public behavior.
3. Validate with relevant test runners and syntax checks.
4. Sync docs if behavior/config changed.
5. Report checklist score delta and next iteration backlog.

## Guardrails
- Preserve endpoint and error-code contracts.
- Preserve root runtime folders (`input/`, `output/`, `configs/`).
- Keep queue and rate-limit protections active.
- Avoid one-shot large rewrites; ship in safe iterations.
