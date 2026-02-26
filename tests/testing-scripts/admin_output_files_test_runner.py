"""Integration test for protected output file listing endpoint.

Validates:
- Unauthorized request is rejected
- Authorized request succeeds
- Response structure includes total + files array
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_ROOT.parent.parent
RESULTS_DIR = SCRIPT_ROOT / "results"
from common.env_utils import resolve_admin_key_candidates, resolve_base_url
from common.http_utils import curl_json


def read_admin_api_key_candidates() -> list[str]:
    candidates = resolve_admin_key_candidates(PROJECT_ROOT)
    if not candidates:
        raise RuntimeError("ADMIN_API_KEY not found in .env or process environment.")
    return candidates


def write_report(*, base_url: str, success: bool, details: dict) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()

    json_path = RESULTS_DIR / "admin_output_files_test_report.json"
    md_path = RESULTS_DIR / "admin_output_files_test_report.md"

    payload = {
        "generated_at": generated_at,
        "base_url": base_url,
        "success": success,
        "details": details,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

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
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    base_url = resolve_base_url(PROJECT_ROOT)

    try:
        api_keys = read_admin_api_key_candidates()
    except Exception as exc:
        print(f"[ADMIN OUTPUT TEST] ERROR: {exc}")
        return 1

    endpoint = "/admin/output-files"

    # 1) Unauthorized should fail
    status, body = curl_json(method="GET", base_url=base_url, endpoint=endpoint)
    if status not in (401, 503):
        write_report(
            base_url=base_url,
            success=False,
            details={
                "unauthorized_status": status,
                "authorized_status": None,
                "total_files": None,
            },
        )
        print(f"[ADMIN OUTPUT TEST] FAIL: expected 401/503 without key, got {status}. body={body}")
        return 1

    # 2) Authorized should succeed
    status, body = 0, None
    for api_key in api_keys:
        status, body = curl_json(method="GET", base_url=base_url, endpoint=endpoint, api_key=api_key)
        if status == 200:
            break

    if status != 200 or not isinstance(body, dict):
        write_report(
            base_url=base_url,
            success=False,
            details={
                "unauthorized_status": status,
                "authorized_status": status,
                "total_files": None,
            },
        )
        print(f"[ADMIN OUTPUT TEST] DEBUG base_url={base_url} tried_keys={len(api_keys)}")
        print(f"[ADMIN OUTPUT TEST] FAIL: expected 200 with JSON body, got {status}. body={body}")
        return 1

    if body.get("success") is not True:
        write_report(
            base_url=base_url,
            success=False,
            details={
                "unauthorized_status": status,
                "authorized_status": status,
                "total_files": None,
            },
        )
        print(f"[ADMIN OUTPUT TEST] FAIL: success flag is not true. body={body}")
        return 1

    files = body.get("files")
    total = body.get("total")

    if not isinstance(files, list) or not isinstance(total, int):
        write_report(
            base_url=base_url,
            success=False,
            details={
                "unauthorized_status": status,
                "authorized_status": status,
                "total_files": None,
            },
        )
        print(f"[ADMIN OUTPUT TEST] FAIL: invalid schema. body={body}")
        return 1

    if total != len(files):
        write_report(
            base_url=base_url,
            success=False,
            details={
                "unauthorized_status": status,
                "authorized_status": status,
                "total_files": total,
            },
        )
        print(f"[ADMIN OUTPUT TEST] FAIL: total mismatch. total={total} len(files)={len(files)}")
        return 1

    if files:
        sample = files[0]
        required = {"fileName", "sizeBytes", "createdAt", "modifiedAt"}
        if not isinstance(sample, dict) or not required.issubset(sample.keys()):
            write_report(
                base_url=base_url,
                success=False,
                details={
                    "unauthorized_status": status,
                    "authorized_status": status,
                    "total_files": total,
                },
            )
            print(f"[ADMIN OUTPUT TEST] FAIL: file item schema mismatch. sample={sample}")
            return 1

    write_report(
        base_url=base_url,
        success=True,
        details={
            "unauthorized_status": 401,
            "authorized_status": 200,
            "total_files": total,
        },
    )

    print(f"[ADMIN OUTPUT TEST] PASS: listed {total} output file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
