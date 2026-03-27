---
name: slicer-docker-ops
description: Docker compose runbook for the 3D Printer Slicer API. Use this when asked to start, stop, restart, monitor, or clean up the containerized backend environment.
---

Use this skill for all Docker environment management in this repository.

Objective:
- Maintain correct usage of profiles (e.g., monitoring requires a specific profile).
- Differentiate between standard execution, dev-mode execution, and cleanup flows.
- Prevent stuck containers and permission issues.

Repository context and defaults:
- Directory: Execute all commands from the project root (where `docker-compose.yml` is located).
- Main backend service: `slicer-api` (Port: 3002).
- Monitoring service: `uptime-kuma` (Port: 3003).

Workflow Command Matrix:

1. Standard Backend (Start / Stop / Logs)
   - Start: `docker compose up -d --build`
   - Stop: `docker compose down`
   - Logs: `docker compose logs -f slicer-api`
   - Quick Health: `curl http://127.0.0.1:3002/health`

2. Live Development Mode (Mounts local app/ folders)
   - Start: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`
   - Stop: `docker compose -f docker-compose.yml -f docker-compose.dev.yml down`

3. Monitoring Mode (Starts backend + Uptime Kuma)
   - Start: `docker compose --profile monitoring up -d --build`
   - Stop Kuma only: `docker compose stop uptime-kuma`

4. Safe Partial Cleanup (Preferred)
   Run these sequentially to remove orphans and unused local assets:
   ```bash
   docker compose down -v --remove-orphans
   docker image prune -f
   docker network prune -f
   ```

5. Global Nuke (Destructive - ask first)
   ```bash
   docker compose down -v --remove-orphans
   docker system prune -a --volumes -f
   ```

Troubleshooting & Diagnostics:
- Symptom: EACCES permission errors writing to `/app/configs/pricing.json` or /`app/logs/...`.
   - Cause: Bind-mount permission mismatches on Windows/Linux host vs non-root container user.
   - Action: Remind the user they can override the runtime user via `.env` (e.g., `SLICER_CONTAINER_USER=1001:1001`), then rebuild with `docker compose up -d --build slicer-api`.
- Symptom: Monitoring UI not accessible on 3003.
   - Action: Verify the `--profile monitoring` flag was actually used during startup.

Safety rule:
- Do NOT run "Global Nuke" (`docker system prune -a`) unless explicitly asked, as it affects Docker resources used by other projects on the host machine. Always default to the Safe Partial Cleanup.