"""Pricing API cycle integration test.

Runs a full lifecycle for both FDM and SLA pricing materials:
- create material
- update material price
- verify via GET /pricing
- delete material
- verify deletion via GET /pricing

Auth:
- Reads ADMIN_API_KEY from environment first
- Falls back to parsing project .env file
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

TESTS_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = TESTS_ROOT.parent.parent
RESULTS_DIR = TESTS_ROOT / "results"
PRICING_ENDPOINT = "/pricing"
REPORT_PATH = RESULTS_DIR / "pricing_cycle_test_result.md"
LEGACY_REPORT_FILES = (
    RESULTS_DIR / "pricing_cycle_test_report.json",
    RESULTS_DIR / "pricing_cycle_test_report.md",
)
from common.env_utils import resolve_admin_key_candidates, resolve_base_url
from common.http_utils import curl_json


@dataclass
class StepResult:
    technology: str
    material: str
    step: str
    method: str
    endpoint: str
    expected_status: int
    http_status: int
    success: bool
    details: str
    body: dict | str | None


def _read_admin_api_key_candidates() -> list[str]:
    candidates = resolve_admin_key_candidates(PROJECT_ROOT)
    if not candidates:
        raise RuntimeError("ADMIN_API_KEY not found in .env or process environment.")
    return candidates


def _curl_request(base_url: str, method: str, endpoint: str, body: dict | None = None, api_key: str | None = None) -> tuple[int, dict | str | None]:
    return curl_json(
        method=method,
        base_url=base_url,
        endpoint=endpoint,
        json_body=body,
        api_key=api_key,
    )


def _authorized_request_with_fallback(base_url: str, method: str, endpoint: str, body: dict | None, api_keys: list[str]) -> tuple[int, dict | str | None]:
    status, payload = 0, None
    for key in api_keys:
        status, payload = _curl_request(base_url, method, endpoint, body=body, api_key=key)
        if status != 401:
            return status, payload
    return status, payload


def _record(results: list[StepResult], *, technology: str, material: str, step: str, method: str, endpoint: str, expected_status: int, actual_status: int, ok: bool, details: str, body: dict | str | None) -> None:
    results.append(
        StepResult(
            technology=technology,
            material=material,
            step=step,
            method=method,
            endpoint=endpoint,
            expected_status=expected_status,
            http_status=actual_status,
            success=ok,
            details=details,
            body=body,
        )
    )


def _exists_in_pricing(pricing_body: dict | str | None, technology: str, material: str) -> bool:
    if not isinstance(pricing_body, dict):
        return False

    tech_map = pricing_body.get(technology)
    if not isinstance(tech_map, dict):
        return False

    lowered = {str(key).lower(): key for key in tech_map.keys()}
    return material.lower() in lowered


def _get_price(pricing_body: dict | str | None, technology: str, material: str) -> float | None:
    if not isinstance(pricing_body, dict):
        return None

    tech_map = pricing_body.get(technology)
    if not isinstance(tech_map, dict):
        return None

    for key, value in tech_map.items():
        if str(key).lower() == material.lower():
            try:
                return float(value)
            except Exception:
                return None

    return None


def _execute_authorized_mutation_step(
    *,
    results: list[StepResult],
    base_url: str,
    api_keys: list[str],
    technology: str,
    material: str,
    step: str,
    method: str,
    endpoint: str,
    body: dict | None,
    expected_status: int,
    details: str,
) -> tuple[int, dict | str | None]:
    status, payload = _authorized_request_with_fallback(base_url, method, endpoint, body, api_keys)
    ok = status == expected_status and isinstance(payload, dict) and bool(payload.get("success"))
    _record(
        results,
        technology=technology,
        material=material,
        step=step,
        method=method,
        endpoint=endpoint,
        expected_status=expected_status,
        actual_status=status,
        ok=ok,
        details=details,
        body=payload,
    )
    return status, payload


def _execute_pricing_verification_step(
    *,
    results: list[StepResult],
    base_url: str,
    technology: str,
    material: str,
    step: str,
    details: str,
    expected_price: float | None,
    should_exist: bool,
) -> tuple[int, dict | str | None]:
    status, body = _curl_request(base_url, "GET", PRICING_ENDPOINT)
    exists = _exists_in_pricing(body, technology, material)
    current_price = _get_price(body, technology, material)

    if should_exist:
        ok = status == 200 and exists and current_price == expected_price
    else:
        ok = status == 200 and not exists

    _record(
        results,
        technology=technology,
        material=material,
        step=step,
        method="GET",
        endpoint=PRICING_ENDPOINT,
        expected_status=200,
        actual_status=status,
        ok=ok,
        details=details,
        body=body,
    )

    return status, body


def run_cycle_for_technology(base_url: str, technology: str, base_material: str, create_price: int, update_price: int, api_keys: list[str]) -> list[StepResult]:
    results: list[StepResult] = []
    suffix = f"{int(time.time())}_{secrets.token_hex(3)}"
    material = f"{base_material}_{suffix}"

    create_endpoint = f"/pricing/{technology}"
    patch_endpoint = f"/pricing/{technology}/{material}"

    _execute_authorized_mutation_step(
        results=results,
        base_url=base_url,
        api_keys=api_keys,
        technology=technology,
        material=material,
        step="create",
        method="POST",
        endpoint=create_endpoint,
        body={"material": material, "price": create_price},
        expected_status=201,
        details="Create new material",
    )

    _execute_pricing_verification_step(
        results=results,
        base_url=base_url,
        technology=technology,
        material=material,
        step="verify_create",
        details=f"Material exists with price={create_price}",
        expected_price=float(create_price),
        should_exist=True,
    )

    _execute_authorized_mutation_step(
        results=results,
        base_url=base_url,
        api_keys=api_keys,
        technology=technology,
        material=material,
        step="update",
        method="PATCH",
        endpoint=patch_endpoint,
        body={"price": update_price},
        expected_status=200,
        details=f"Update material price to {update_price}",
    )

    _execute_pricing_verification_step(
        results=results,
        base_url=base_url,
        technology=technology,
        material=material,
        step="verify_update",
        details=f"Material price changed to {update_price}",
        expected_price=float(update_price),
        should_exist=True,
    )

    _execute_authorized_mutation_step(
        results=results,
        base_url=base_url,
        api_keys=api_keys,
        technology=technology,
        material=material,
        step="delete",
        method="DELETE",
        endpoint=patch_endpoint,
        body=None,
        expected_status=200,
        details="Delete created material",
    )

    _execute_pricing_verification_step(
        results=results,
        base_url=base_url,
        technology=technology,
        material=material,
        step="verify_delete",
        details="Material removed from pricing map",
        expected_price=None,
        should_exist=False,
    )

    return results


def _write_report(base_url: str, results: list[StepResult]) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    for legacy_path in LEGACY_REPORT_FILES:
        if legacy_path.exists():
            legacy_path.unlink()

    generated_at = datetime.now(timezone.utc).isoformat()
    success_count = sum(1 for item in results if item.success)
    fail_count = len(results) - success_count

    lines = [
        "# Pricing Cycle Test Report",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Base URL: **{base_url}**",
        f"Total steps: **{len(results)}**",
        f"Success: **{success_count}**",
        f"Failed: **{fail_count}**",
        "",
        "| # | Tech | Material | Step | Method | Endpoint | Exp | Got | Success |",
        "|---:|:-----:|:---------|:------|:------:|:---------|---:|---:|:-------:|",
    ]

    for idx, item in enumerate(results, start=1):
        lines.append(
            f"| {idx} | {item.technology} | `{item.material}` | {item.step} | {item.method} | `{item.endpoint}` | {item.expected_status} | {item.http_status} | {'✅' if item.success else '❌'} |"
        )

    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return REPORT_PATH


def main() -> int:
    base_url = resolve_base_url(PROJECT_ROOT)

    try:
        api_keys = _read_admin_api_key_candidates()
    except Exception as exc:
        print(f"[PRICING TEST] ERROR: {exc}")
        return 1

    print("[PRICING TEST] Running pricing lifecycle test for FDM and SLA...")

    results: list[StepResult] = []
    results.extend(run_cycle_for_technology(base_url, "FDM", "COPILOT_FDM", 1111, 1222, api_keys))
    results.extend(run_cycle_for_technology(base_url, "SLA", "COPILOT_SLA", 2111, 2333, api_keys))

    report_path = _write_report(base_url, results)

    failed = [item for item in results if not item.success]
    print(f"[PRICING TEST] Completed. total={len(results)} failed={len(failed)}")
    print(f"[PRICING TEST] Report: {report_path}")
    if failed:
        print(f"[PRICING TEST] DEBUG base_url={base_url} tried_keys={len(api_keys)}")

    if failed:
        for item in failed:
            print(
                f"[PRICING TEST] FAIL {item.technology} {item.step} {item.endpoint} "
                f"expected={item.expected_status} got={item.http_status}"
            )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
