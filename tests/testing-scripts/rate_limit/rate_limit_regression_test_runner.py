"""Rate-limit regression test runner.

Validates:
- Admin rate limiting on /admin/download/ALL.
- Admin 429 payload shape and Retry-After semantics.
- Slice rate limiting on /prusa/slice (request-level limiter behavior).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request

import sys as _sys
_sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from common.env_utils import read_dotenv, resolve_admin_key_candidates, resolve_base_url

SCRIPT_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_ROOT.parent.parent.parent
RESULTS_DIR = SCRIPT_ROOT.parent / "results"
REPORT_PATH = RESULTS_DIR / "rate_limit_regression_test_result.md"
LEGACY_REPORT_FILES = (
    RESULTS_DIR / "rate_limit_regression_test_report.json",
    RESULTS_DIR / "rate_limit_regression_test_report.md",
)

DEFAULTS = {
    "SLICE_RATE_LIMIT_WINDOW_MS": 60_000,
    "SLICE_RATE_LIMIT_MAX_REQUESTS": 3,
    "SLICE_RATE_LIMIT_BURST_CAPACITY": 5,
    "ADMIN_RATE_LIMIT_WINDOW_MS": 60_000,
    "ADMIN_RATE_LIMIT_MAX_REQUESTS": 30,
}

ADMIN_ENDPOINT = "/admin/download/ALL"
SLICE_ENDPOINT = "/prusa/slice"


@dataclass
class ProbeResult:
    label: str
    endpoint: str
    attempts_sent: int
    first_429_attempt: int | None
    expected_upper_bound: int
    observed_statuses: list[int]
    error_code: str | None
    retry_after_header: str | None
    retry_after_seconds: int | None
    success: bool
    failure_reason: str | None


def parse_positive_int(value: str | int | float | None, fallback: int) -> int:
    try:
        parsed = int(value) if value is not None else fallback
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def resolve_rate_limit_config() -> dict[str, int]:
    env_map = read_dotenv(PROJECT_ROOT)
    config: dict[str, int] = {}
    for key, fallback in DEFAULTS.items():
        config[key] = parse_positive_int(env_map.get(key), fallback)
    return config


def parse_body_text(text: str) -> dict | str | None:
    payload = text.strip()
    if not payload:
        return None

    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return payload


def send_http_request(
    *,
    method: str,
    base_url: str,
    endpoint: str,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], dict | str | None]:
    req = request.Request(f"{base_url}{endpoint}", method=method)
    for header_name, header_value in (headers or {}).items():
        req.add_header(header_name, header_value)

    try:
        with request.urlopen(req, timeout=20) as resp:
            headers = dict(resp.headers.items())
            content_type = (headers.get("Content-Type") or "").lower()

            if "application/zip" in content_type or "application/octet-stream" in content_type:
                return resp.getcode(), headers, None

            body_text = resp.read().decode("utf-8", errors="replace")
            return resp.getcode(), headers, parse_body_text(body_text)
    except error.HTTPError as http_err:
        headers = dict(http_err.headers.items())
        content_type = (headers.get("Content-Type") or "").lower()

        if "application/zip" in content_type or "application/octet-stream" in content_type:
            return http_err.code, headers, None

        body_text = http_err.read().decode("utf-8", errors="replace")
        return http_err.code, headers, parse_body_text(body_text)
    except Exception as exc:  # pragma: no cover - network/runtime failure path
        return 0, {}, {"error": str(exc)}


def parse_retry_after_header(headers: dict[str, str]) -> tuple[str | None, int | None]:
    retry_after_value = None
    for key, value in headers.items():
        if key.lower() == "retry-after":
            retry_after_value = value
            break

    if retry_after_value is None:
        return None, None

    parsed = parse_positive_int(retry_after_value, 0)
    return retry_after_value, (parsed if parsed > 0 else None)


def parse_retry_after_body(body: dict | str | None) -> int | None:
    if not isinstance(body, dict):
        return None

    parsed = parse_positive_int(body.get("retryAfterSeconds"), 0)
    return parsed if parsed > 0 else None


def parse_error_code(body: dict | str | None) -> str | None:
    if not isinstance(body, dict):
        return None

    code = body.get("errorCode")
    return code if isinstance(code, str) and code else None


def evaluate_rate_limit_hit(
    *,
    label: str,
    endpoint: str,
    attempt: int,
    expected_upper_bound: int,
    expected_error_code: str,
    observed_statuses: list[int],
    response_headers: dict[str, str],
    body: dict | str | None,
) -> ProbeResult:
    retry_after_header_value, retry_after_header_seconds = parse_retry_after_header(response_headers)
    retry_after_body_seconds = parse_retry_after_body(body)
    error_code = parse_error_code(body)

    if error_code != expected_error_code:
        return ProbeResult(
            label=label,
            endpoint=endpoint,
            attempts_sent=attempt,
            first_429_attempt=attempt,
            expected_upper_bound=expected_upper_bound,
            observed_statuses=observed_statuses,
            error_code=error_code,
            retry_after_header=retry_after_header_value,
            retry_after_seconds=retry_after_body_seconds,
            success=False,
            failure_reason=f"expected errorCode {expected_error_code}, got {error_code}",
        )

    if retry_after_header_seconds is None:
        return ProbeResult(
            label=label,
            endpoint=endpoint,
            attempts_sent=attempt,
            first_429_attempt=attempt,
            expected_upper_bound=expected_upper_bound,
            observed_statuses=observed_statuses,
            error_code=error_code,
            retry_after_header=retry_after_header_value,
            retry_after_seconds=retry_after_body_seconds,
            success=False,
            failure_reason="missing/invalid Retry-After header on 429 response",
        )

    if retry_after_body_seconds is None:
        return ProbeResult(
            label=label,
            endpoint=endpoint,
            attempts_sent=attempt,
            first_429_attempt=attempt,
            expected_upper_bound=expected_upper_bound,
            observed_statuses=observed_statuses,
            error_code=error_code,
            retry_after_header=retry_after_header_value,
            retry_after_seconds=retry_after_body_seconds,
            success=False,
            failure_reason="missing/invalid retryAfterSeconds value on 429 response body",
        )

    if attempt > expected_upper_bound:
        return ProbeResult(
            label=label,
            endpoint=endpoint,
            attempts_sent=attempt,
            first_429_attempt=attempt,
            expected_upper_bound=expected_upper_bound,
            observed_statuses=observed_statuses,
            error_code=error_code,
            retry_after_header=retry_after_header_value,
            retry_after_seconds=retry_after_body_seconds,
            success=False,
            failure_reason=(
                "rate limit triggered too late "
                f"(attempt={attempt}, expected_upper_bound={expected_upper_bound})"
            ),
        )

    return ProbeResult(
        label=label,
        endpoint=endpoint,
        attempts_sent=attempt,
        first_429_attempt=attempt,
        expected_upper_bound=expected_upper_bound,
        observed_statuses=observed_statuses,
        error_code=error_code,
        retry_after_header=retry_after_header_value,
        retry_after_seconds=retry_after_body_seconds,
        success=True,
        failure_reason=None,
    )


def probe_until_rate_limited(
    *,
    label: str,
    base_url: str,
    endpoint: str,
    method: str,
    headers: dict[str, str] | None,
    max_attempts: int,
    expected_upper_bound: int,
    expected_error_code: str,
) -> ProbeResult:
    observed_statuses: list[int] = []

    for attempt in range(1, max_attempts + 1):
        status, response_headers, body = send_http_request(
            method=method,
            base_url=base_url,
            endpoint=endpoint,
            headers=headers,
        )
        observed_statuses.append(status)

        if status == 429:
            return evaluate_rate_limit_hit(
                label=label,
                endpoint=endpoint,
                attempt=attempt,
                expected_upper_bound=expected_upper_bound,
                expected_error_code=expected_error_code,
                observed_statuses=observed_statuses,
                response_headers=response_headers,
                body=body,
            )

        if status == 0:
            return ProbeResult(
                label=label,
                endpoint=endpoint,
                attempts_sent=attempt,
                first_429_attempt=None,
                expected_upper_bound=expected_upper_bound,
                observed_statuses=observed_statuses,
                error_code=parse_error_code(body),
                retry_after_header=None,
                retry_after_seconds=None,
                success=False,
                failure_reason=f"request failure while probing rate limit: {body}",
            )

    return ProbeResult(
        label=label,
        endpoint=endpoint,
        attempts_sent=max_attempts,
        first_429_attempt=None,
        expected_upper_bound=expected_upper_bound,
        observed_statuses=observed_statuses,
        error_code=None,
        retry_after_header=None,
        retry_after_seconds=None,
        success=False,
        failure_reason=(
            "did not observe HTTP 429 within expected attempt budget "
            f"(max_attempts={max_attempts})"
        ),
    )


def write_report(
    *,
    base_url: str,
    config: dict[str, int],
    admin_probe: ProbeResult,
    slice_probe: ProbeResult,
) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    for legacy_path in LEGACY_REPORT_FILES:
        if legacy_path.exists():
            legacy_path.unlink()

    success = admin_probe.success and slice_probe.success
    generated_at = datetime.now(timezone.utc).isoformat()

    lines = [
        "# Rate Limit Regression Test Report",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Base URL: **{base_url}**",
        f"Success: **{success}**",
        "",
        "## Configuration",
        "",
        f"- SLICE_RATE_LIMIT_WINDOW_MS: `{config['SLICE_RATE_LIMIT_WINDOW_MS']}`",
        f"- SLICE_RATE_LIMIT_MAX_REQUESTS: `{config['SLICE_RATE_LIMIT_MAX_REQUESTS']}`",
        f"- SLICE_RATE_LIMIT_BURST_CAPACITY: `{config['SLICE_RATE_LIMIT_BURST_CAPACITY']}`",
        f"- ADMIN_RATE_LIMIT_WINDOW_MS: `{config['ADMIN_RATE_LIMIT_WINDOW_MS']}`",
        f"- ADMIN_RATE_LIMIT_MAX_REQUESTS: `{config['ADMIN_RATE_LIMIT_MAX_REQUESTS']}`",
        "",
        "## Probe Results",
        "",
    ]

    for probe in (admin_probe, slice_probe):
        lines.extend(
            [
                f"### {probe.label}",
                "",
                f"- Endpoint: `{probe.endpoint}`",
                f"- Success: `{probe.success}`",
                f"- Attempts sent: `{probe.attempts_sent}`",
                f"- First 429 attempt: `{probe.first_429_attempt}`",
                f"- Expected upper bound: `{probe.expected_upper_bound}`",
                f"- Observed statuses: `{probe.observed_statuses}`",
                f"- errorCode on 429: `{probe.error_code}`",
                f"- Retry-After header: `{probe.retry_after_header}`",
                f"- retryAfterSeconds body field: `{probe.retry_after_seconds}`",
                f"- Failure reason: `{probe.failure_reason}`",
                "",
            ]
        )

    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    base_url = resolve_base_url(PROJECT_ROOT)
    config = resolve_rate_limit_config()

    admin_keys = resolve_admin_key_candidates(PROJECT_ROOT)
    if not admin_keys:
        print("[RATE LIMIT TEST] ERROR: ADMIN_API_KEY not found in .env or process environment.")
        return 1

    admin_headers = {"x-api-key": admin_keys[0]}

    admin_probe = probe_until_rate_limited(
        label="Admin limiter on /admin/download/ALL",
        base_url=base_url,
        endpoint=ADMIN_ENDPOINT,
        method="GET",
        headers=admin_headers,
        max_attempts=config["ADMIN_RATE_LIMIT_MAX_REQUESTS"] + 3,
        expected_upper_bound=config["ADMIN_RATE_LIMIT_MAX_REQUESTS"] + 1,
        expected_error_code="ADMIN_RATE_LIMIT_EXCEEDED",
    )

    slice_probe = probe_until_rate_limited(
        label="Slice limiter on /prusa/slice",
        base_url=base_url,
        endpoint=SLICE_ENDPOINT,
        method="POST",
        headers=None,
        max_attempts=config["SLICE_RATE_LIMIT_BURST_CAPACITY"] + 5,
        expected_upper_bound=config["SLICE_RATE_LIMIT_BURST_CAPACITY"] + 2,
        expected_error_code="RATE_LIMIT_EXCEEDED",
    )

    write_report(
        base_url=base_url,
        config=config,
        admin_probe=admin_probe,
        slice_probe=slice_probe,
    )

    if admin_probe.success and slice_probe.success:
        print("[RATE LIMIT TEST] PASS: admin and slice limiters returned expected 429 semantics.")
        return 0

    if not admin_probe.success:
        print(f"[RATE LIMIT TEST] FAIL (admin): {admin_probe.failure_reason}")
    if not slice_probe.success:
        print(f"[RATE LIMIT TEST] FAIL (slice): {slice_probe.failure_reason}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
