---
name: best-practice
description: Apply iterative best-practice refactors (OOP, SOLID, readability, maintainability) using the quality-architect checklist while preserving behavior.
---

Use this skill whenever code quality, architecture, naming, or maintainability must be improved without changing public behavior.

Slash entrypoint:
- Use `/best-practice` to run the quality-focused refactor workflow.

Full agent definitions with the complete checklist and execution workflow are mirrored in `.github/agents/quality-architect.md` and `.claude/agents/quality-architect.md`.
Read that file before broad or multi-file refactors.

## Scope

- Improve cohesion, readability, and testability in small safe steps.
- Reduce duplication and hidden coupling in touched areas.
- Keep endpoint contracts, queue/rate protections, and runtime folder policy unchanged.

## Decomposition Guardrails

- Source files over 500 lines require a split plan before adding new responsibilities.
- Test runners over 250 lines should be split by scenario when behavior changes require edits.
- Service modules over 300 lines should be split by responsibility when new behavior appears.
- Functions over 60 lines should be decomposed when extraction improves readability or testability.
- Apply SOLID/OOP/GoF ideas only when they reduce real complexity, duplication, or coupling.

## Recommended Iteration Loop

1. Identify 1-3 highest-impact quality hotspots.
2. Propose minimal refactor slices and call out risk for each slice.
3. Apply one slice at a time with stable public behavior.
4. Validate with relevant tests or targeted checks after each slice.
5. Sync docs if behavior, workflow, or config references changed.
6. Report checklist score delta and remaining backlog.

## Guardrails

- Preserve endpoint and error-code contracts.
- Preserve root runtime folders (`input/`, `output/`, `configs/`).
- Keep queue and rate-limit protections active.
- Avoid one-shot rewrites; ship in safe iterations.
- Prefer evidence-driven refactors over speculative abstractions.

## Validation Checklist

- [ ] Public behavior stayed stable for touched features.
- [ ] Duplication or complexity is measurably reduced.
- [ ] Queue/rate-limit safeguards remain intact.
- [ ] Relevant tests/checks were executed and summarized.
