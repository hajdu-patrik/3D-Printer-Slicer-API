# 3D Printer Slicer API - System Context & Agent Instructions

## 1. Architecture & Stack
- **Backend:** Node.js (Express) + Python 3.12.
- **Engines:** PrusaSlicer (for FDM & SLA) and OrcaSlicer (for FDM only).
- **Core Pattern:** Dual independent endpoints (`/prusa/slice` and `/orca/slice`).
- **Data Flow:** Accept file -> Validate -> Queue (FIFO) -> Orient (Python) -> Slice (Prusa/Orca) -> Return Pricing/Stats.

## 2. Strict Technical Constraints (MUST FOLLOW)
- **Directory Structure:** All runtime folders (`input/`, `output/`, `configs/`) are STRICTLY ROOT-SCOPED. Do NEVER use `app/input`, `app/output`, or `app/configs`.
- **API Security:** All admin endpoints (Pricing modifications, `GET /admin/output-files`) require the `x-api-key` header matching `ADMIN_API_KEY` from `.env`.
- **Model Integrity:** NEVER suggest auto-healing or shape-correcting invalid/non-printable source data. The policy is "fail-fast" with `INVALID_SOURCE_GEOMETRY`.
- **Rate Limiting & Queueing:** CPU-heavy requests are queued. Avoid suggesting concurrent heavy requests without handling HTTP 429 and Retry-After logic.

## 3. Supported Parameters & Workflows
- Prusa layer heights: `0.025`, `0.05` (SLA); `0.1`, `0.2`, `0.3` (FDM).
- Orca layer heights: `0.1`, `0.2`, `0.3` (FDM only).
- Orca relies on matching Machine & Process profiles (`printerProfile`, `processProfile`).
- Pricing relies on `configs/pricing.json`.

## 4. Agent Operational Directives
- If writing tests, append to `tests/testing-scripts/`. Write reports to `results/`.
- If debugging deployment, rely on `docker-compose.yml` and explicitly check `$SLICER_CONTAINER_USER` permissions.
- Do not hallucinate package installations; always check `package.json` or `requirements.txt` first.

## 5. Agent Skills (Slash Commands)
To perform operations safely, you MUST use the provided agent skills located in the `.agents/skills/` directory. 
- Use the `/docker` command (see `.agents/skills/slicer-docker-ops/SKILL.md`) for ANY container lifecycle management.
- Use the `/test` command (see `.agents/skills/slicer-api-testing/SKILL.md`) to run regression matrices and validate your code changes. Always read the generated report afterward.