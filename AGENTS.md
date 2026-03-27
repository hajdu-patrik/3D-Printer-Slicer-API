# 3D Printer Slicer API – Agent & Developer Guide

The repository context you didn't know you needed. This document serves as the **single source of truth** for AI Agents (Cursor, Copilot, Claude) and developers working on the 3D Printer Slicer API. It outlines the architecture, hard constraints, directory structures, and the agent skill framework.

---

## Repository Purpose

An automated 3D slicing and pricing API built with **Node.js** and **Python**. It converts multiple 2D/3D input types into printable outputs (`.gcode`, `.sl1`) with validated pricing.

Built for **zero-downtime rollout**, the API routes requests through two independent slicer engines (**Prusa** & **Orca**) via dedicated endpoints. It is fortified with bounded queues, rate limiters, and ZIP safety checks to handle CPU-heavy workloads safely.

---

## Architecture & Stack

- **Core Backend:** Node.js 24 + Express 
- **Processing & Orientation:** Python 3.12 scripts 
- **Slicing Engines:** - PrusaSlicer 2.8.1 (FDM & SLA) 
  - OrcaSlicer 2.3.1 (FDM only) 
- **Environment:** Fully containerized via Docker (Ubuntu 24.04 base) 
- **Data Flow:** Accept file → Validate → Queue (FIFO) → Orient (Python) → Slice (Engine) → Return Pricing/Stats 

---

## Repository Structure

```text
3D-Printer-Slicer-API/
├── .agents/
│   └── skills/
│       ├── slicer-api-testing/
│       │   └── SKILL.md
│       └── slicer-docker-ops/
│           └── SKILL.md
├── .claude/
│   └── CLAUDE.md
├── .github/
│   ├── workflows/
│   │   └── deploy.yml
│   └── copilot-instructions.md
├── app/
│   ├── config/
│   ├── docs/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   │   ├── slice/
│   │   ├── pricing.service.js
│   │   └── slice.service.js
│   ├── static/
│   ├── utils/
│   ├── cad2stl.py
│   ├── img2stl.py
│   ├── mesh2stl.py
│   ├── orient.py
│   ├── scale_model.py
│   ├── vector2stl.py
│   └── server.js
├── configs/
│   ├── orca/
│   │   ├── Bambu_P1S_0.4_nozzle.json
│   │   └── FDM_0.Xmm.json
│   ├── prusa/
│   │   ├── FDM_0.Xmm.ini
│   │   └── SLA_0.XXmm.ini
│   ├── pricing.example.json
│   └── pricing.json
├── input/
├── output/
├── ops/
│   └── monitoring/
│       ├── nginx-monitor.template.conf
│       └── setup-monitoring.sh
├── tests/
│   ├── testing-files/
│   └── testing-scripts/
│       ├── results/
│       └── *_test_runner.py
├── docker-compose.yml
├── docker-compose.dev.yml
├── Dockerfile
├── package.json
├── requirements.txt
└── AGENTS.md

--- 

## Agent Skills Framework

To prevent hallucinations and standardize workflows, AI agents must use the following declarative skills defined in `.agents/skills/`.

---

### 1. Docker Operations (`/docker`)

Manages the local containerized environment cleanly.

| Command         | Description |
|-----------------|------------|
| `/docker start` | Standard backend boot (`docker compose up -d --build`) |
| `/docker dev`   | Live-mount boot for development |
| `/docker monitor` | Boots backend + Uptime Kuma monitoring service |
| `/docker clean` | Safe partial cleanup (removes orphans/networks) |
| `/docker nuke`  | Destructive global prune (**requires explicit user confirmation**) |

---

### 2. Automated Testing (`/test`)

Runs Python-based test matrices.

**Agent Directive:**  
After executing any test command, you **MUST automatically read** the generated markdown report in `tests/testing-scripts/results/`.

| Command         | Description |
|-----------------|------------|
| `/test all`     | Full API regression (Prusa + Orca matrix) |
| `/test orca`    | Orca FDM matrix only |
| `/test prusa`   | Prusa FDM/SLA matrix only |
| `/test pricing` | Pricing lifecycle validation (CRUD operations) |
| `/test queue`   | Rate-limit and concurrency queue testing with N requests |

---

## Strict Technical Constraints  
*(Anti-Patterns & Rules)*

When modifying this codebase, agents **MUST adhere to these rules**. Do not bypass them.

---

### 1. Directory Anti-Pattern: Local App Folders

❌ **Never use** `app/input`, `app/output`, or `app/configs`  
✔ **Use** root-scoped `input/`, `output/`, `configs/` for both local and Docker execution  

---

### 2. Model Integrity Policy (Fail-Fast)

Uploaded 3D/CAD/vector files are **never auto-healed**.  

Invalid geometry → immediate rejection with `INVALID_SOURCE_GEOMETRY`

---

### 3. Queue & Resource Protection

- Slicing is **CPU-bound**
- Never suggest concurrent unqueued slicing
- Never remove rate-limiter (`429 Retry-After`)
- Internal timeouts kill processes >10 minutes (`FILE_PROCESSING_TIMEOUT`)

---

### 4. Slicer Engine Boundaries

**Prusa:**
- SLA: `0.025`, `0.05`
- FDM: `0.1`, `0.2`, `0.3`

**Orca:**
- FDM only: `0.1`, `0.2`, `0.3`
- Requires matching `printerProfile` + `processProfile`

---

### 5. Admin Security

Endpoints modifying prices or accessing files require:

```bash
x-api-key: <ADMIN_API_KEY>
```

Server refuses startup if key missing.

---

### 6. Windows vs Docker Permissions


Be aware of Windows bind-mount permission issues.  

`docker-compose.yml` uses:

```yaml
user: ${SLICER_CONTAINER_USER:-0:0}
```

to avoid EACCES errors.

---

## Agent Workflow: Adding Features or Debugging

1. **Understand Intent**:
Determine if change affects **Prusa, Orca, Pricing, or Queue logic**.
2. **Do Not Hallucinate Dependencies**:
Always check `package.json` or `requirements.txt`.
3. **Apply Changes**:
Update Node.js endpoints or Python orientation scripts.
4. **Verify via Skill**:
Run `/test all` or specific `/test <target>`.
5. **Analyze Report**:
Read markdown in `tests/testing-scripts/results/`.
6. **Update Docs** :
If API contracts or env vars change → update `README.md`.