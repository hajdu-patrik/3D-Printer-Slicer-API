"""Focused regression tests for invalid source geometry handling.

Validates the fail-fast geometry policy: corrupted CAD/mesh uploads must be
rejected with stable 4xx client error codes and never surface as generic
server-side failures, and no automatic model healing is performed.
"""

from __future__ import annotations

import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT.parent))
PROJECT_ROOT = SCRIPT_ROOT.parent.parent.parent
RESULTS_DIR = SCRIPT_ROOT.parent / "results"
REPORT_PATH = RESULTS_DIR / "invalid_geometry_test_result.md"

from common.env_utils import resolve_base_url
from common.http_utils import curl_multipart_slice

SLICE_ENDPOINT = "/prusa/slice"
LAYER_HEIGHT = 0.2
MATERIAL = "PLA"
MAX_ATTEMPTS = 3
DEFAULT_RETRY_WAIT_SECONDS = 20


@dataclass(frozen=True)
class InvalidGeometryCase:
    """Single corrupted upload scenario."""

    name: str
    file_path: Path
    expected_status: int
    expected_error_code: str


@dataclass(frozen=True)
class InvalidGeometryResult:
    """Observed result for one corrupted upload scenario."""

    name: str
    file_name: str
    http_status: int
    error_code: str | None
    success: bool
    duration_sec: float


def _retry_wait_seconds(body: dict | str | None) -> int:
    if isinstance(body, dict):
        try:
            parsed = int(body.get("retryAfterSeconds") or DEFAULT_RETRY_WAIT_SECONDS)
        except (TypeError, ValueError):
            parsed = DEFAULT_RETRY_WAIT_SECONDS
        return max(1, parsed)
    return DEFAULT_RETRY_WAIT_SECONDS


def run_case(base_url: str, test_case: InvalidGeometryCase) -> InvalidGeometryResult:
    """Run one corrupted upload case with bounded 429 retry."""
    total_duration = 0.0
    status = 0
    body: dict | str | None = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        status, body, duration = curl_multipart_slice(
            base_url=base_url,
            endpoint=SLICE_ENDPOINT,
            file_path=test_case.file_path,
            layer_height=LAYER_HEIGHT,
            material=MATERIAL,
        )
        total_duration += duration

        if status != 429 or attempt == MAX_ATTEMPTS:
            break

        wait_seconds = _retry_wait_seconds(body)
        print(f"[RUNNER] got 429, retrying in {wait_seconds}s (attempt {attempt + 1}/{MAX_ATTEMPTS})")
        time.sleep(wait_seconds)

    error_code = body.get("errorCode") if isinstance(body, dict) else None
    success = status == test_case.expected_status and error_code == test_case.expected_error_code

    return InvalidGeometryResult(
        name=test_case.name,
        file_name=test_case.file_path.name,
        http_status=status,
        error_code=error_code,
        success=success,
        duration_sec=total_duration,
    )


def create_invalid_geometry_cases(temp_dir: Path) -> list[InvalidGeometryCase]:
    """Create temporary corrupted model files for fail-fast rejection tests."""
    step_file = temp_dir / "corrupted_cad.step"
    step_file.write_text(
        "ISO-10303-21;\nHEADER;\nGARBAGE_NOT_A_REAL_STEP;\nENDSEC;\nEND-ISO-10303-21;\n",
        encoding="ascii",
    )

    obj_file = temp_dir / "corrupted_mesh.obj"
    obj_file.write_text("this file contains no mesh geometry\n" * 8, encoding="ascii")

    threemf_file = temp_dir / "corrupted_mesh.3mf"
    threemf_file.write_bytes(b"PK\x03\x04garbage-not-a-real-3mf-archive")

    ply_file = temp_dir / "corrupted_mesh.ply"
    ply_file.write_text("ply\nnot-a-valid-header\n", encoding="ascii")

    stl_file = temp_dir / "corrupted_direct.stl"
    stl_file.write_text("solid empty\nendsolid empty\n", encoding="ascii")

    return [
        InvalidGeometryCase(
            name="Corrupted STEP upload is rejected fail-fast by CAD converter",
            file_path=step_file,
            expected_status=400,
            expected_error_code="INVALID_SOURCE_GEOMETRY",
        ),
        InvalidGeometryCase(
            name="Corrupted OBJ upload is rejected fail-fast by mesh converter",
            file_path=obj_file,
            expected_status=400,
            expected_error_code="INVALID_SOURCE_GEOMETRY",
        ),
        InvalidGeometryCase(
            name="Corrupted 3MF upload is rejected fail-fast by mesh converter",
            file_path=threemf_file,
            expected_status=400,
            expected_error_code="INVALID_SOURCE_GEOMETRY",
        ),
        InvalidGeometryCase(
            name="Corrupted PLY upload is rejected fail-fast by mesh converter",
            file_path=ply_file,
            expected_status=400,
            expected_error_code="INVALID_SOURCE_GEOMETRY",
        ),
        InvalidGeometryCase(
            name="Empty STL upload is rejected before slicing by dimension check",
            file_path=stl_file,
            expected_status=422,
            expected_error_code="MODEL_DIMENSIONS_UNAVAILABLE",
        ),
    ]


def write_report(base_url: str, results: list[InvalidGeometryResult]) -> None:
    """Write markdown report for invalid geometry regression results."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()
    success_count = sum(1 for result in results if result.success)

    lines = [
        "# Invalid Geometry Test Report",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Base URL: **{base_url}**",
        f"Total cases: **{len(results)}**",
        f"Successful cases: **{success_count}**",
        f"Failed cases: **{len(results) - success_count}**",
        "",
        "## Cases",
        "",
        "| Case | File | HTTP status | Error code | Success | Duration (s) |",
        "| --- | --- | ---: | --- | --- | ---: |",
    ]

    for result in results:
        lines.append(
            "| "
            f"{result.name} | `{result.file_name}` | `{result.http_status}` | "
            f"`{result.error_code}` | `{result.success}` | `{result.duration_sec:.2f}` |"
        )

    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    base_url = resolve_base_url(PROJECT_ROOT)
    with tempfile.TemporaryDirectory(prefix="invalid-geometry-") as temp_dir_name:
        test_cases = create_invalid_geometry_cases(Path(temp_dir_name))
        results = [run_case(base_url, test_case) for test_case in test_cases]

    write_report(base_url, results)
    for result in results:
        print(
            f"[RESULT] {result.name}: status={result.http_status}, "
            f"errorCode={result.error_code}, success={result.success}"
        )

    return 0 if all(result.success for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
