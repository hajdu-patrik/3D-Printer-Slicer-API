from __future__ import annotations

import os
from pathlib import Path


def read_dotenv(project_root: Path) -> dict[str, str]:
    env_map: dict[str, str] = {}
    env_path = project_root / ".env"
    if not env_path.exists():
        return env_map

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env_map[key.strip()] = value.strip().strip('"').strip("'")

    return env_map


def resolve_base_url(project_root: Path) -> str:
    dotenv = read_dotenv(project_root)
    return os.getenv("SLICER_BASE_URL") or dotenv.get("SLICER_BASE_URL") or "http://127.0.0.1:3000"


def resolve_admin_keys(project_root: Path) -> tuple[str | None, str | None]:
    dotenv = read_dotenv(project_root)
    env_key = os.getenv("ADMIN_API_KEY", "").strip() or None
    dotenv_key = (dotenv.get("ADMIN_API_KEY") or "").strip() or None
    return env_key, dotenv_key


def resolve_admin_key_candidates(project_root: Path) -> list[str]:
    env_key, dotenv_key = resolve_admin_keys(project_root)
    ordered = [dotenv_key, env_key]
    seen: set[str] = set()
    candidates: list[str] = []

    for key in ordered:
        if not key or key in seen:
            continue
        candidates.append(key)
        seen.add(key)

    return candidates


def get_preferred_admin_key(project_root: Path) -> str:
    candidates = resolve_admin_key_candidates(project_root)
    if candidates:
        return candidates[0]
    raise RuntimeError("ADMIN_API_KEY not found in .env or process environment.")
