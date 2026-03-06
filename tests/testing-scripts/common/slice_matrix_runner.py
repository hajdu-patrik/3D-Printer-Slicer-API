"""Shared slice matrix runner helpers for API integration tests.

This module centralizes request execution, response validation, and markdown
report rendering for per-engine/per-technology full-matrix test runners.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import cycle
from pathlib import Path
from typing import Iterable, Sequence

from common.env_utils import resolve_admin_keys, resolve_base_url
from common.http_utils import curl_json, curl_multipart_slice

PRUSA_SLICE_ENDPOINT = "/prusa/slice"
ORCA_SLICE_ENDPOINT = "/orca/slice"
SUPPORTED_EXTENSIONS = {
    ".zip", ".stl", ".obj", ".3mf", ".ply",
    ".stp", ".step", ".igs", ".iges",
    ".dxf", ".svg", ".eps", ".pdf",
    ".jpg", ".jpeg", ".png", ".bmp",
}


@dataclass(frozen=True)
class SliceScenario:
    """Single scenario configuration for matrix execution."""

    key: str
    report_title: str
    endpoint: str
    technology: str
    material: str
    layer_heights: tuple[float, ...]
    report_filename: str
    legacy_report_files: tuple[str, ...] = ()


@dataclass
class TestCaseResult:
    """Outcome of one API request in the matrix."""

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


@dataclass
class ScenarioRunResult:
    """Summary information for one scenario run."""

    scenario: SliceScenario
    base_url: str
    report_path: Path
    generated_at: str
    total: int
    success_count: int
    failed_count: int


def resolve_engine_name(endpoint: str) -> str:
    """Resolve human-readable slicer engine name from endpoint path."""
    return "Orca" if endpoint == ORCA_SLICE_ENDPOINT else "Prusa"


def _resolve_runtime_env(project_root: Path) -> tuple[str, bool]:
    """Resolve base URL and whether an admin key is configured."""
    base_url = resolve_base_url(project_root)
    env_key, dotenv_key = resolve_admin_keys(project_root)
    has_admin_key = bool(env_key or dotenv_key)
    return base_url, has_admin_key


def format_layer_height_token(layer_height: float) -> str:
    """Render layer height with compact trailing-zero trimming."""
    return f"{layer_height:.3f}".rstrip("0").rstrip(".")


def build_extra_fields(endpoint: str, technology: str, layer_height: float) -> dict[str, str]:
    """Build multipart extra fields expected by slice endpoints."""
    layer_token = format_layer_height_token(layer_height)
    fields: dict[str, str] = {
        "sizeUnit": "mm",
        "keepProportions": "true",
        "scalePercent": "100",
        "rotationX": "0",
        "rotationY": "0",
        "rotationZ": "0",
    }

    if endpoint == ORCA_SLICE_ENDPOINT:
        fields["printerProfile"] = "Bambu_P1S_0.4_nozzle.json"
        fields["processProfile"] = f"FDM_{layer_token}mm.json"
    else:
        fields["printerProfile"] = f"{technology}_{layer_token}mm.ini"

    return fields


def discover_test_files(root: Path) -> list[Path]:
    """Discover supported test input files under tests/testing-files."""
    files = []
    for path in root.rglob("*"):
        if not path.is_file() or "results" in path.parts:
            continue
        if path.suffix.lower() in SUPPORTED_EXTENSIONS:
            files.append(path)
    return sorted(files)


def classify(path: Path) -> str:
    """Classify test input file by category folder."""
    parts = set(path.parts)
    for category in ("archive", "cad", "direct", "image", "vector"):
        if category in parts:
            return category
    return "unknown"


def expected_hint_for_category(category: str) -> str:
    """Return category-level expectation hint used in reports."""
    if category in {"cad", "direct", "archive"}:
        return "expected_success"
    if category == "image":
        return "expected_fail_invalid_input"
    if category == "vector":
        return "mixed_expected_some_fail"
    return "unknown"


def run_slice_request(
    base_url: str,
    endpoint: str,
    file_path: Path,
    layer_height: float,
    material: str,
    extra_fields: dict[str, str] | None = None,
) -> tuple[int, dict | str | None, float]:
    """Execute one multipart slicing request."""
    return curl_multipart_slice(
        base_url=base_url,
        endpoint=endpoint,
        file_path=file_path,
        layer_height=layer_height,
        material=material,
        extra_fields=extra_fields,
    )


def run_slice_request_with_retry(
    base_url: str,
    endpoint: str,
    file_path: Path,
    layer_height: float,
    material: str,
    extra_fields: dict[str, str] | None = None,
    retry_on_429: int = 3,
    retry_wait_seconds: int = 20,
) -> tuple[int, dict | str | None, float]:
    """Execute slicing request with bounded retry for 429 responses."""
    total_duration = 0.0
    status = 0
    body: dict | str | None = None

    max_attempts = max(1, retry_on_429)
    for attempt in range(1, max_attempts + 1):
        status, body, duration = run_slice_request(
            base_url,
            endpoint,
            file_path,
            layer_height,
            material,
            extra_fields,
        )
        total_duration += duration

        if status != 429:
            return status, body, total_duration

        if attempt < max_attempts:
            print(
                f"[RUNNER]    got 429, retrying in {retry_wait_seconds}s "
                f"(attempt {attempt + 1}/{max_attempts})"
            )
            time.sleep(retry_wait_seconds)

    return status, body, total_duration


def _normalize_material(material: str) -> str:
    return str(material or "").strip().lower()


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
    """Read active pricing matrix from the API runtime."""
    status, body = curl_json(method="GET", base_url=base_url, endpoint="/pricing")
    if status != 200 or not isinstance(body, dict):
        print(f"[RUNNER] WARNING: Could not read live pricing via /pricing (status={status}).")
        return None
    return body


def _validate_new_field_payload(
    *,
    body: dict,
    endpoint: str,
    expected_fields: dict[str, str],
) -> tuple[bool, str | None]:
    model_transform = body.get("model_transform")
    if not isinstance(model_transform, dict):
        return False, "Missing model_transform in success response"

    build_volume_limits = body.get("build_volume_limits_mm")
    if not isinstance(build_volume_limits, dict):
        return False, "Missing build_volume_limits_mm in success response"

    if not isinstance(build_volume_limits.get("min"), dict) or not isinstance(build_volume_limits.get("max"), dict):
        return False, "build_volume_limits_mm must include min/max objects"

    expected_unit = expected_fields.get("sizeUnit", "mm").lower()
    if str(model_transform.get("size_unit", "")).lower() != expected_unit:
        return False, (
            f"model_transform.size_unit mismatch: expected {expected_unit}, "
            f"got {model_transform.get('size_unit')}"
        )

    expected_keep = expected_fields.get("keepProportions", "true").strip().lower() == "true"
    if bool(model_transform.get("keep_proportions")) != expected_keep:
        return False, (
            f"model_transform.keep_proportions mismatch: expected {expected_keep}, "
            f"got {model_transform.get('keep_proportions')}"
        )

    profiles = body.get("profiles")
    if not isinstance(profiles, dict):
        return False, "Missing profiles object in success response"

    if endpoint == ORCA_SLICE_ENDPOINT:
        if not profiles.get("machine_profile") or not profiles.get("process_profile"):
            return False, "Orca response must include machine_profile and process_profile"
    elif not profiles.get("prusa_profile"):
        return False, "Prusa response must include prusa_profile"

    return True, None


def evaluate_slice_response(
    *,
    body: dict | str | None,
    status: int,
    technology: str,
    material: str,
    pricing_map: dict | None,
    endpoint: str,
    expected_fields: dict[str, str],
) -> tuple[bool, str | None, str | None, float | None, float | None, bool | None]:
    """Evaluate response payload and derive normalized success fields."""
    if not isinstance(body, dict):
        success = 200 <= status < 300
        error_message = str(body) if body else None
        return success, None, error_message, None, None, None

    success = bool(body.get("success")) and (200 <= status < 300)
    error_code = body.get("errorCode")
    error_message = body.get("error")
    expected_hourly_rate = _resolve_expected_rate(pricing_map, technology, material)
    actual_rate_raw = body.get("hourly_rate")

    try:
        actual_hourly_rate = float(actual_rate_raw) if actual_rate_raw is not None else None
    except Exception:
        actual_hourly_rate = None

    hourly_rate_matches = None
    if success and expected_hourly_rate is not None and actual_hourly_rate is not None:
        hourly_rate_matches = abs(expected_hourly_rate - actual_hourly_rate) < 1e-9
        if not hourly_rate_matches:
            success = False
            error_code = error_code or "PRICING_SOURCE_MISMATCH"
            error_message = (
                f"hourly_rate mismatch: expected {expected_hourly_rate} from /pricing, "
                f"got {actual_hourly_rate}"
            )

    if success:
        payload_valid, payload_error = _validate_new_field_payload(
            body=body,
            endpoint=endpoint,
            expected_fields=expected_fields,
        )
        if not payload_valid:
            success = False
            error_code = error_code or "NEW_FIELDS_VALIDATION_FAILED"
            error_message = payload_error

    return success, error_code, error_message, expected_hourly_rate, actual_hourly_rate, hourly_rate_matches


def markdown_summary(report_title: str, results: Iterable[TestCaseResult], generated_at: str, base_url: str) -> str:
    """Render markdown report for one scenario."""
    rows = list(results)
    total = len(rows)
    ok = sum(1 for row in rows if row.success)
    bad = total - ok

    lines = [
        f"# {report_title}",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Base URL: **{base_url}**",
        f"Total requests: **{total}**",
        f"Success: **{ok}**",
        f"Failed: **{bad}**",
        "",
        "| # | Engine | Tech | Endpoint | File | Layer | Status | Success | RateFromPricing | ErrorCode |",
        "|---:|:------:|:----:|:---------|:-----|------:|------:|:-------:|:--------------:|:---------|",
    ]

    def rate_match_icon(result: TestCaseResult) -> str:
        if result.hourly_rate_matches_pricing_json is True:
            return "✅"
        if result.hourly_rate_matches_pricing_json is False:
            return "❌"
        return "n/a"

    for row in rows:
        lines.append(
            f"| {row.index} | {resolve_engine_name(row.endpoint)} | {row.technology} | "
            f"`{row.endpoint}` | `{row.file}` | {row.layer_height} | {row.http_status} | "
            f"{'✅' if row.success else '❌'} | {rate_match_icon(row)} | {row.error_code or '-'} |"
        )

    return "\n".join(lines) + "\n"


def run_scenario(
    scripts_root: Path,
    scenario: SliceScenario,
    *,
    sleep_seconds: int = 12,
    retry_on_429: int = 3,
    retry_wait_seconds: int = 20,
) -> ScenarioRunResult:
    """Execute one complete scenario against all test inputs and write markdown report."""
    tests_root = scripts_root.parent / "testing-files"
    project_root = scripts_root.parent.parent
    results_dir = scripts_root / "results"
    report_path = results_dir / scenario.report_filename

    results_dir.mkdir(parents=True, exist_ok=True)
    for legacy_filename in scenario.legacy_report_files:
        legacy_path = results_dir / legacy_filename
        if legacy_path.exists():
            legacy_path.unlink()

    base_url, has_admin_key = _resolve_runtime_env(project_root)
    print(
        f"[RUNNER:{scenario.key}] endpoint={scenario.endpoint} tech={scenario.technology} "
        f"material={scenario.material} admin_api_key_found={has_admin_key}"
    )

    files = discover_test_files(tests_root)
    if not files:
        raise FileNotFoundError(f"No supported input files found under {tests_root}.")

    pricing_map = fetch_pricing_map(base_url)
    layer_cycle = cycle(scenario.layer_heights)

    rows: list[TestCaseResult] = []
    req_index = 1

    print(f"[RUNNER:{scenario.key}] Found {len(files)} input files. Starting...")

    for file_path in files:
        layer_height = next(layer_cycle)
        category = classify(file_path)
        expected_hint = expected_hint_for_category(category)
        extra_fields = build_extra_fields(scenario.endpoint, scenario.technology, layer_height)

        print(
            f"[RUNNER:{scenario.key}] #{req_index} -> {resolve_engine_name(scenario.endpoint)}/"
            f"{scenario.technology} | {file_path.relative_to(tests_root)} | layer={layer_height}"
        )

        status, body, duration = run_slice_request_with_retry(
            base_url,
            scenario.endpoint,
            file_path,
            layer_height,
            scenario.material,
            extra_fields,
            retry_on_429=retry_on_429,
            retry_wait_seconds=retry_wait_seconds,
        )

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
            technology=scenario.technology,
            material=scenario.material,
            pricing_map=pricing_map,
            endpoint=scenario.endpoint,
            expected_fields=extra_fields,
        )

        rows.append(
            TestCaseResult(
                index=req_index,
                endpoint=scenario.endpoint,
                technology=scenario.technology,
                file=str(file_path.relative_to(tests_root)).replace("\\", "/"),
                category=category,
                layer_height=layer_height,
                material=scenario.material,
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

        print(f"[RUNNER:{scenario.key}]    status={status} success={success} duration={duration:.2f}s")

        req_index += 1
        time.sleep(sleep_seconds)

    generated_at = datetime.now(timezone.utc).isoformat()
    report_text = markdown_summary(
        scenario.report_title,
        rows,
        generated_at,
        base_url,
    )
    report_path.write_text(report_text, encoding="utf-8")

    total = len(rows)
    success_count = sum(1 for row in rows if row.success)
    failed_count = total - success_count

    print(
        f"[RUNNER:{scenario.key}] Completed. total={total} "
        f"success={success_count} failed={failed_count}"
    )
    print(f"[RUNNER:{scenario.key}] Report: {report_path}")

    return ScenarioRunResult(
        scenario=scenario,
        base_url=base_url,
        report_path=report_path,
        generated_at=generated_at,
        total=total,
        success_count=success_count,
        failed_count=failed_count,
    )


def build_suite_summary_markdown(
    *,
    suite_title: str,
    generated_at: str,
    scenario_results: Sequence[ScenarioRunResult],
) -> str:
    """Render summary markdown for multiple scenario runs."""
    total_requests = sum(item.total for item in scenario_results)
    total_success = sum(item.success_count for item in scenario_results)
    total_failed = sum(item.failed_count for item in scenario_results)
    base_url = scenario_results[0].base_url if scenario_results else "n/a"

    lines = [
        f"# {suite_title}",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Base URL: **{base_url}**",
        f"Total requests: **{total_requests}**",
        f"Success: **{total_success}**",
        f"Failed: **{total_failed}**",
        "",
        "| Scenario | Engine | Tech | Endpoint | Total | Success | Failed | Report |",
        "|:---------|:------:|:----:|:---------|------:|--------:|-------:|:-------|",
    ]

    for item in scenario_results:
        scenario = item.scenario
        lines.append(
            f"| {scenario.key} | {resolve_engine_name(scenario.endpoint)} | {scenario.technology} | "
            f"`{scenario.endpoint}` | {item.total} | {item.success_count} | {item.failed_count} | "
            f"`{item.report_path.name}` |"
        )

    return "\n".join(lines) + "\n"
