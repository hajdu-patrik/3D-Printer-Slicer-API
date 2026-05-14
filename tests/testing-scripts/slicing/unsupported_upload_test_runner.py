"""Focused regression tests for unsupported upload rejection.

Validates that removed 2D artwork upload paths are rejected with stable API
error codes while model/CAD-only slicing remains the supported contract.
"""

from __future__ import annotations

import sys
import tempfile
import time
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_ROOT.parent))
PROJECT_ROOT = SCRIPT_ROOT.parent.parent.parent
RESULTS_DIR = SCRIPT_ROOT.parent / "results"
REPORT_PATH = RESULTS_DIR / "unsupported_upload_test_result.md"

from common.env_utils import resolve_base_url
from common.http_utils import curl_multipart_slice

SLICE_ENDPOINT = "/prusa/slice"
LAYER_HEIGHT = 0.2
MATERIAL = "PLA"
MAX_ATTEMPTS = 3
DEFAULT_RETRY_WAIT_SECONDS = 20


@dataclass(frozen=True)
class UnsupportedUploadCase:
    """Single unsupported upload scenario."""

    name: str
    file_path: Path
    expected_status: int
    expected_error_code: str


@dataclass(frozen=True)
class UnsupportedUploadResult:
    """Observed result for one unsupported upload scenario."""

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


def run_case(base_url: str, test_case: UnsupportedUploadCase) -> UnsupportedUploadResult:
    """Run an unsupported upload case with bounded 429 retry."""
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

    return UnsupportedUploadResult(
        name=test_case.name,
        file_name=test_case.file_path.name,
        http_status=status,
        error_code=error_code,
        success=success,
        duration_sec=total_duration,
    )


def create_unsupported_cases(temp_dir: Path) -> list[UnsupportedUploadCase]:
    """Create temporary former-2D files for rejection tests."""
    direct_file = temp_dir / "unsupported_artwork.png"
    direct_file.write_bytes(b"not-a-supported-model")

    archive_file = temp_dir / "unsupported_artwork.zip"
    with zipfile.ZipFile(archive_file, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("unsupported_artwork.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>")

    return [
        UnsupportedUploadCase(
            name="Direct former artwork upload is rejected by upload filter",
            file_path=direct_file,
            expected_status=400,
            expected_error_code="UNSUPPORTED_FILE_FORMAT",
        ),
        UnsupportedUploadCase(
            name="Archive containing former artwork upload is rejected by ZIP guard",
            file_path=archive_file,
            expected_status=400,
            expected_error_code="INVALID_SOURCE_ARCHIVE",
        ),
    ]


def write_report(base_url: str, results: list[UnsupportedUploadResult]) -> None:
    """Write markdown report for unsupported upload regression results."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()
    success_count = sum(1 for result in results if result.success)

    lines = [
        "# Unsupported Upload Test Report",
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
    with tempfile.TemporaryDirectory(prefix="unsupported-upload-") as temp_dir_name:
        test_cases = create_unsupported_cases(Path(temp_dir_name))
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