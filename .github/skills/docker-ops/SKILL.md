---
name: docker-ops
description: Docker compose runbook for the 3D Printer Slicer API. Use this when asked to start, stop, restart, monitor, or clean up the containerized backend environment.
---

Use this skill for container lifecycle operations in this repository.

Slash entrypoint:
- Use `/docker-ops` for startup, restart, logs, health checks, and cleanup operations.

Full agent definition with architecture context, security configuration, hard rules, and scope boundaries is in `.github/agents/docker-specialist.md`.
Read that file for complete context before performing Docker operations.

## Quick Command Reference

1. Standard backend
   - Start: `docker compose up -d --build`
   - Stop: `docker compose down`
   - Logs: `docker compose logs -f slicer-api`
   - Health check: `curl http://127.0.0.1:3000/health`

2. Development mode (live mount)
   - Start: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`
   - Stop: `docker compose -f docker-compose.yml -f docker-compose.dev.yml down`

3. Monitoring mode
   - Start: `docker compose --profile monitoring up -d --build`
   - Stop monitoring only: `docker compose stop uptime-kuma`

4. Safe partial cleanup (preferred)
   - `docker compose down -v --remove-orphans`
   - `docker image prune -f`
   - `docker network prune -f`

5. Global cleanup (destructive, explicit user approval required)
   - `docker compose down -v --remove-orphans`
   - `docker system prune -a --volumes -f`

## Execution Workflow

1. Identify requested operation scope (standard, dev, monitoring, or cleanup).
2. Run the minimal command set needed for that scope.
3. Verify health with `GET /health` and targeted logs.
4. Report service status and any follow-up actions.

## Safety Rules

- Never run `docker system prune -a` unless user explicitly requests destructive global cleanup.
- If EACCES errors appear on mounted files, review `SLICER_CONTAINER_USER` in .env and rebuild.
- If monitoring UI is unreachable, verify startup used `--profile monitoring`.

## Validation Checklist

- [ ] Requested containers are up (or cleanly stopped) with expected profiles.
- [ ] Health endpoint and logs reflect expected state.
- [ ] No destructive cleanup executed without explicit approval.
