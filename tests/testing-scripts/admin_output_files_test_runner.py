"""Integration test for protected output file listing endpoint.

Validates:
- Unauthorized request is rejected
- Authorized request succeeds
- Response structure includes total + files array
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_ROOT.parent.parent
RESULTS_DIR = SCRIPT_ROOT / "results"
REPORT_PATH = RESULTS_DIR / "admin_output_files_test_result.md"
LEGACY_REPORT_FILES = (
    RESULTS_DIR / "admin_output_files_test_report.json",
    RESULTS_DIR / "admin_output_files_test_report.md",
)
from common.env_utils import resolve_admin_key_candidates, resolve_base_url
from common.http_utils import curl_json

OUTPUT_FILES_ENDPOINT = "/admin/output-files"
UNAUTHORIZED_ALLOWED = {401, 503}


def read_admin_api_key_candidates() -> list[str]:
    candidates = resolve_admin_key_candidates(PROJECT_ROOT)
    if not candidates:
        raise RuntimeError("ADMIN_API_KEY not found in .env or process environment.")
    return candidates


def write_report(*, base_url: str, success: bool, details: dict) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    for legacy_path in LEGACY_REPORT_FILES:
        if legacy_path.exists():
            legacy_path.unlink()

    generated_at = datetime.now(timezone.utc).isoformat()

    lines = [
        "# Admin Output Files Test Report",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Base URL: **{base_url}**",
        f"Success: **{success}**",
        "",
        "## Details",
        "",
        f"- Unauthorized status: `{details.get('unauthorized_status')}`",
        f"- Authorized status: `{details.get('authorized_status')}`",
        f"- Total files: `{details.get('total_files')}`",
    ]
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_report_details(*, unauthorized_status: int | None, authorized_status: int | None, total_files: int | None) -> dict:
    return {
        "unauthorized_status": unauthorized_status,
        "authorized_status": authorized_status,
        "total_files": total_files,
    }


def run_unauthorized_check(base_url: str) -> tuple[bool, int, dict | str | None]:
    status, body = curl_json(method="GET", base_url=base_url, endpoint=OUTPUT_FILES_ENDPOINT)
    return status in UNAUTHORIZED_ALLOWED, status, body


def run_authorized_check(base_url: str, api_keys: list[str]) -> tuple[int, dict | str | None]:
    status, body = 0, None
    for api_key in api_keys:
        status, body = curl_json(method="GET", base_url=base_url, endpoint=OUTPUT_FILES_ENDPOINT, api_key=api_key)
        if status == 200:
            break
    return status, body


def validate_authorized_payload(body: dict | str | None) -> tuple[bool, int | None, str | None]:
    if not isinstance(body, dict):
        return False, None, "expected 200 with JSON body"

    if body.get("success") is not True:
        return False, None, "success flag is not true"

    files = body.get("files")
    total = body.get("total")
    if not isinstance(files, list) or not isinstance(total, int):
        return False, None, "invalid schema"

    if total != len(files):
        return False, total, f"total mismatch. total={total} len(files)={len(files)}"

    if files:
        sample = files[0]
        required = {"fileName", "sizeBytes", "createdAt", "modifiedAt"}
        if not isinstance(sample, dict) or not required.issubset(sample.keys()):
            return False, total, f"file item schema mismatch. sample={sample}"

    return True, total, None


def main() -> int:
    base_url = resolve_base_url(PROJECT_ROOT)

    try:
        api_keys = read_admin_api_key_candidates()
    except Exception as exc:
        print(f"[ADMIN OUTPUT TEST] ERROR: {exc}")
        return 1

    unauthorized_ok, unauthorized_status, unauthorized_body = run_unauthorized_check(base_url)
    if not unauthorized_ok:
        write_report(
            base_url=base_url,
            success=False,
            details=build_report_details(
                unauthorized_status=unauthorized_status,
                authorized_status=None,
                total_files=None,
            ),
        )
        print(f"[ADMIN OUTPUT TEST] FAIL: expected 401/503 without key, got {unauthorized_status}. body={unauthorized_body}")
        return 1

    status, body = run_authorized_check(base_url, api_keys)

    if status != 200:
        write_report(
            base_url=base_url,
            success=False,
            details=build_report_details(
                unauthorized_status=unauthorized_status,
                authorized_status=status,
                total_files=None,
            ),
        )
        print(f"[ADMIN OUTPUT TEST] DEBUG base_url={base_url} tried_keys={len(api_keys)}")
        print(f"[ADMIN OUTPUT TEST] FAIL: expected 200 with JSON body, got {status}. body={body}")
        return 1

    payload_ok, total, payload_error = validate_authorized_payload(body)
    if not payload_ok:
        write_report(
            base_url=base_url,
            success=False,
            details=build_report_details(
                unauthorized_status=unauthorized_status,
                authorized_status=status,
                total_files=total,
            ),
        )
        print(f"[ADMIN OUTPUT TEST] FAIL: {payload_error}. body={body}")
        return 1

    write_report(
        base_url=base_url,
        success=True,
        details=build_report_details(
            unauthorized_status=401,
            authorized_status=200,
            total_files=total,
        ),
    )

    print(f"[ADMIN OUTPUT TEST] PASS: listed {total} output file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
