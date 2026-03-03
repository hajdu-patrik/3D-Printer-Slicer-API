"""Run full API slicing test matrix against all files under tests/.

Behavior:
- Sends every discovered test file through: /prusa/slice (FDM), /prusa/slice (SLA), /orca/slice (FDM)
- Rotates valid layer heights per technology
- Sleeps ~10s between requests (configurable)
- Writes JSON + Markdown reports under tests/testing scripts/results/
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import cycle
from pathlib import Path
from typing import Iterable
from common.env_utils import resolve_admin_keys, resolve_base_url
from common.http_utils import curl_json, curl_multipart_slice

SCRIPTS_ROOT = Path(__file__).resolve().parent
TESTS_ROOT = SCRIPTS_ROOT.parent / "testing-files"
PROJECT_ROOT = SCRIPTS_ROOT.parent.parent
RESULTS_DIR = SCRIPTS_ROOT / "results"
REPORT_PATH = RESULTS_DIR / "full_api_test_result.md"
LEGACY_REPORT_FILES = (
    RESULTS_DIR / "full_api_test_report.json",
    RESULTS_DIR / "full_api_test_report.md",
)
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


def resolve_engine_name(endpoint: str) -> str:
    return "Orca" if endpoint == "/orca/slice" else "Prusa"


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
    expected_hourly_rate: float | None
    actual_hourly_rate: float | None
    hourly_rate_matches_pricing_json: bool | None


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


def _normalize_material(material: str) -> str:
    return str(material or '').strip().lower()


def _resolve_expected_rate(pricing_map: dict | None, technology: str, material: str) -> float | None:
    if not isinstance(pricing_map, dict):
        return None

    tech_map = pricing_map.get(technology)
    if not isinstance(tech_map, dict):
        return None

    target = _normalize_material(material)
    for key, value in tech_map.items():
        if _normalize_material(str(key)) == target:
            try:
                return float(value)
            except Exception:
                return None

    for value in tech_map.values():
        try:
            numeric = float(value)
        except Exception:
            continue
        if numeric > 0:
            return numeric

    return None


def fetch_pricing_map(base_url: str) -> dict | None:
    status, body = curl_json(method='GET', base_url=base_url, endpoint='/pricing')
    if status != 200 or not isinstance(body, dict):
        print(f"[RUNNER] WARNING: Could not read live pricing via /pricing (status={status}).")
        return None
    return body


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
        "| # | Engine | Tech | Endpoint | File | Layer | Status | Success | RateFromPricing | ErrorCode |",
        "|---:|:------:|:----:|:---------|:-----|------:|------:|:-------:|:--------------:|:---------|",
    ]

    def rate_match_icon(result: TestCaseResult) -> str:
        if result.hourly_rate_matches_pricing_json is True:
            return '✅'
        if result.hourly_rate_matches_pricing_json is False:
            return '❌'
        return 'n/a'

    for r in rows:
        engine = resolve_engine_name(r.endpoint)
        lines.append(
            f"| {r.index} | {engine} | {r.technology} | `{r.endpoint}` | `{r.file}` | {r.layer_height} | {r.http_status} | {'✅' if r.success else '❌'} | {rate_match_icon(r)} | {r.error_code or '-'} |"
        )

    return "\n".join(lines) + "\n"


def build_test_plan(fdm_cycle, sla_cycle) -> list[tuple[str, str, float, str]]:
    return [
        ("/prusa/slice", "FDM", next(fdm_cycle), "PLA"),
        ("/prusa/slice", "SLA", next(sla_cycle), "Standard"),
        ("/orca/slice", "FDM", next(fdm_cycle), "PLA"),
    ]


def evaluate_slice_response(
    *,
    body: dict | str | None,
    status: int,
    technology: str,
    material: str,
    pricing_map: dict | None,
) -> tuple[bool, str | None, str | None, float | None, float | None, bool | None]:
    if not isinstance(body, dict):
        success = 200 <= status < 300
        error_message = str(body) if body else None
        return success, None, error_message, None, None, None

    success = bool(body.get("success")) and (200 <= status < 300)
    error_code = body.get("errorCode")
    error_message = body.get("error")
    expected_hourly_rate = _resolve_expected_rate(pricing_map, technology, material)
    actual_rate_raw = body.get('hourly_rate')

    try:
        actual_hourly_rate = float(actual_rate_raw) if actual_rate_raw is not None else None
    except Exception:
        actual_hourly_rate = None

    hourly_rate_matches = None
    if success and expected_hourly_rate is not None and actual_hourly_rate is not None:
        hourly_rate_matches = abs(expected_hourly_rate - actual_hourly_rate) < 1e-9
        if not hourly_rate_matches:
            success = False
            error_code = error_code or 'PRICING_SOURCE_MISMATCH'
            error_message = (
                f"hourly_rate mismatch: expected {expected_hourly_rate} from /pricing, got {actual_hourly_rate}"
            )

    return success, error_code, error_message, expected_hourly_rate, actual_hourly_rate, hourly_rate_matches


def run_file_plan(
    *,
    base_url: str,
    file_path: Path,
    category: str,
    expected_hint: str,
    req_index_start: int,
    plan: list[tuple[str, str, float, str]],
    pricing_map: dict | None,
) -> tuple[list[TestCaseResult], int]:
    results: list[TestCaseResult] = []
    req_index = req_index_start

    for endpoint, technology, layer_height, material in plan:
        engine = resolve_engine_name(endpoint)
        print(
            f"[RUNNER] #{req_index} -> {engine}/{technology} | {file_path.relative_to(TESTS_ROOT)} | layer={layer_height}"
        )
        status, body, duration = run_slice_request_with_retry(base_url, endpoint, file_path, layer_height, material)

        (
            success,
            error_code,
            error_message,
            expected_hourly_rate,
            actual_hourly_rate,
            hourly_rate_matches,
        ) = evaluate_slice_response(
            body=body,
            status=status,
            technology=technology,
            material=material,
            pricing_map=pricing_map,
        )

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
                expected_hourly_rate=expected_hourly_rate,
                actual_hourly_rate=actual_hourly_rate,
                hourly_rate_matches_pricing_json=hourly_rate_matches,
            )
        )

        req_index += 1
        print(f"[RUNNER]    status={status} success={success} duration={duration:.2f}s")
        time.sleep(SLEEP_SECONDS)

    return results, req_index


def main() -> int:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    for legacy_path in LEGACY_REPORT_FILES:
        if legacy_path.exists():
            legacy_path.unlink()

    base_url, _ = resolve_runtime_env()

    files = discover_test_files(TESTS_ROOT)
    if not files:
        print("No test files found under tests/.")
        return 1

    fdm_cycle = cycle(FDM_LAYER_HEIGHTS)
    sla_cycle = cycle(SLA_LAYER_HEIGHTS)
    pricing_map = fetch_pricing_map(base_url)

    results: list[TestCaseResult] = []
    req_index = 1

    print(f"[RUNNER] Found {len(files)} input files. Starting full matrix...")

    for file_path in files:
        category = classify(file_path)
        expected_hint = expected_hint_for_category(category)
        plan = build_test_plan(fdm_cycle, sla_cycle)
        file_results, req_index = run_file_plan(
            base_url=base_url,
            file_path=file_path,
            category=category,
            expected_hint=expected_hint,
            req_index_start=req_index,
            plan=plan,
            pricing_map=pricing_map,
        )
        results.extend(file_results)

    generated_at = datetime.now(timezone.utc).isoformat()

    REPORT_PATH.write_text(markdown_summary(results, generated_at), encoding="utf-8")

    print("[RUNNER] Completed.")
    print(f"[RUNNER] Report: {REPORT_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
