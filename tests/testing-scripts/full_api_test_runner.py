"""Run full API slicing test matrix against all files under tests/.

Behavior:
- Sends every discovered test file to both endpoints: /slice/FDM and /slice/SLA
- Rotates valid layer heights per technology
- Sleeps ~10s between requests (configurable)
- Writes JSON + Markdown reports under tests/testing scripts/results/
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from itertools import cycle
from pathlib import Path
from typing import Iterable
from common.env_utils import resolve_admin_keys, resolve_base_url
from common.http_utils import curl_multipart_slice

SCRIPTS_ROOT = Path(__file__).resolve().parent
TESTS_ROOT = SCRIPTS_ROOT.parent / "testing-files"
PROJECT_ROOT = SCRIPTS_ROOT.parent.parent
RESULTS_DIR = SCRIPTS_ROOT / "results"
SLEEP_SECONDS = 12
RETRY_ON_429 = 3
RETRY_WAIT_SECONDS = 20

FDM_LAYER_HEIGHTS = [0.1, 0.2, 0.3]
SLA_LAYER_HEIGHTS = [0.05, 0.025]
SUPPORTED_EXTENSIONS = {
    ".zip", ".stl", ".obj", ".3mf", ".ply",
    ".stp", ".step", ".igs", ".iges",
    ".dxf", ".svg", ".eps", ".pdf",
    ".jpg", ".jpeg", ".png", ".bmp"
}

def resolve_runtime_env() -> tuple[str, bool]:
    base_url = resolve_base_url(PROJECT_ROOT)
    env_key, dotenv_key = resolve_admin_keys(PROJECT_ROOT)
    has_admin_key = bool(env_key or dotenv_key)
    return base_url, has_admin_key


@dataclass
class TestCaseResult:
    index: int
    endpoint: str
    technology: str
    file: str
    category: str
    layer_height: float
    material: str
    http_status: int
    success: bool
    duration_sec: float
    expected_hint: str
    error_code: str | None
    error_message: str | None
    raw_body: dict | str | None


def discover_test_files(root: Path) -> list[Path]:
    files = []
    for path in root.rglob("*"):
        if not path.is_file() or "results" in path.parts:
            continue
        if path.suffix.lower() in SUPPORTED_EXTENSIONS:
            files.append(path)
    return sorted(files)


def classify(path: Path) -> str:
    parts = set(path.parts)
    for category in ("archive", "cad", "direct", "image", "vector"):
        if category in parts:
            return category
    return "unknown"


def expected_hint_for_category(category: str) -> str:
    if category in {"cad", "direct", "archive"}:
        return "expected_success"
    if category == "image":
        return "expected_fail_invalid_input"
    if category == "vector":
        return "mixed_expected_some_fail"
    return "unknown"


def run_slice_request(base_url: str, endpoint: str, file_path: Path, layer_height: float, material: str) -> tuple[int, dict | str | None, float]:
    return curl_multipart_slice(
        base_url=base_url,
        endpoint=endpoint,
        file_path=file_path,
        layer_height=layer_height,
        material=material,
    )


def run_slice_request_with_retry(base_url: str, endpoint: str, file_path: Path, layer_height: float, material: str) -> tuple[int, dict | str | None, float]:
    total_duration = 0.0
    for attempt in range(1, RETRY_ON_429 + 1):
        status, body, duration = run_slice_request(base_url, endpoint, file_path, layer_height, material)
        total_duration += duration

        if status != 429:
            return status, body, total_duration

        if attempt < RETRY_ON_429:
            print(f"[RUNNER]    got 429, retrying in {RETRY_WAIT_SECONDS}s (attempt {attempt + 1}/{RETRY_ON_429})")
            time.sleep(RETRY_WAIT_SECONDS)

    return status, body, total_duration


def markdown_summary(results: Iterable[TestCaseResult], generated_at: str) -> str:
    rows = list(results)
    total = len(rows)
    ok = sum(1 for r in rows if r.success)
    bad = total - ok

    lines = [
        "# Full API Test Report",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Total requests: **{total}**",
        f"Success: **{ok}**",
        f"Failed: **{bad}**",
        "",
        "| # | Tech | Endpoint | File | Layer | Status | Success | ErrorCode |",
        "|---:|:----:|:---------|:-----|------:|------:|:-------:|:---------|",
    ]

    for r in rows:
        lines.append(
            f"| {r.index} | {r.technology} | `{r.endpoint}` | `{r.file}` | {r.layer_height} | {r.http_status} | {'✅' if r.success else '❌'} | {r.error_code or '-'} |"
        )

    return "\n".join(lines) + "\n"


def main() -> int:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    base_url, has_admin_key = resolve_runtime_env()

    files = discover_test_files(TESTS_ROOT)
    if not files:
        print("No test files found under tests/.")
        return 1

    fdm_cycle = cycle(FDM_LAYER_HEIGHTS)
    sla_cycle = cycle(SLA_LAYER_HEIGHTS)

    results: list[TestCaseResult] = []
    req_index = 1

    print(f"[RUNNER] Found {len(files)} input files. Starting full matrix...")

    for file_path in files:
        category = classify(file_path)
        expected_hint = expected_hint_for_category(category)

        plan = [
            ("/slice/FDM", "FDM", next(fdm_cycle), "PLA"),
            ("/slice/SLA", "SLA", next(sla_cycle), "Standard"),
        ]

        for endpoint, technology, layer_height, material in plan:
            print(
                f"[RUNNER] #{req_index} -> {technology} | {file_path.relative_to(TESTS_ROOT)} | layer={layer_height}"
            )
            status, body, duration = run_slice_request_with_retry(base_url, endpoint, file_path, layer_height, material)

            if isinstance(body, dict):
                success = bool(body.get("success")) and (200 <= status < 300)
                error_code = body.get("errorCode")
                error_message = body.get("error")
            else:
                success = 200 <= status < 300
                error_code = None
                error_message = str(body) if body else None

            results.append(
                TestCaseResult(
                    index=req_index,
                    endpoint=endpoint,
                    technology=technology,
                    file=str(file_path.relative_to(TESTS_ROOT)).replace("\\", "/"),
                    category=category,
                    layer_height=layer_height,
                    material=material,
                    http_status=status,
                    success=success,
                    duration_sec=round(duration, 3),
                    expected_hint=expected_hint,
                    error_code=error_code,
                    error_message=error_message,
                    raw_body=body,
                )
            )

            req_index += 1
            print(f"[RUNNER]    status={status} success={success} duration={duration:.2f}s")

            time.sleep(SLEEP_SECONDS)

    generated_at = datetime.now(timezone.utc).isoformat()

    report_json_path = RESULTS_DIR / "full_api_test_report.json"
    report_md_path = RESULTS_DIR / "full_api_test_report.md"

    report_json_path.write_text(
        json.dumps(
            {
                "generated_at": generated_at,
                "base_url": base_url,
                "admin_api_key_found": has_admin_key,
                "sleep_seconds": SLEEP_SECONDS,
                "total_requests": len(results),
                "success_count": sum(1 for r in results if r.success),
                "failed_count": sum(1 for r in results if not r.success),
                "results": [asdict(r) for r in results],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    report_md_path.write_text(markdown_summary(results, generated_at), encoding="utf-8")

    print("[RUNNER] Completed.")
    print(f"[RUNNER] JSON: {report_json_path}")
    print(f"[RUNNER] MD:   {report_md_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
