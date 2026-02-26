"""Concurrent queue behavior test runner for /slice endpoints.

Goal:
- Fire multiple POST requests at the same time.
- Observe whether responses are completed in staggered order (expected when MAX_CONCURRENT_SLICES=1).
- Produce JSON/Markdown reports under tests/testing scripts/results/.

Notes:
- This is a black-box runtime test; exact CPU core usage cannot be guaranteed from API responses alone.
"""

from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from common.env_utils import resolve_admin_keys, resolve_base_url
from common.http_utils import curl_multipart_slice

SCRIPTS_ROOT = Path(__file__).resolve().parent
TESTS_ROOT = SCRIPTS_ROOT.parent / "testing-files"
PROJECT_ROOT = SCRIPTS_ROOT.parent.parent
RESULTS_DIR = SCRIPTS_ROOT / "results"
SUPPORTED_EXTENSIONS = {
    ".zip", ".stl", ".obj", ".3mf", ".ply",
    ".stp", ".step", ".igs", ".iges",
    ".dxf", ".svg", ".eps", ".pdf",
    ".jpg", ".jpeg", ".png", ".bmp"
}

def resolve_runtime_env() -> tuple[str, str | None]:
    base_url = resolve_base_url(PROJECT_ROOT)
    env_key, dotenv_key = resolve_admin_keys(PROJECT_ROOT)
    admin_api_key = dotenv_key or env_key
    return base_url, admin_api_key


@dataclass
class QueueRequestResult:
    index: int
    file: str
    attempts: int
    started_at: float
    ended_at: float
    duration_sec: float
    http_status: int
    success: bool
    error_code: str | None
    error_message: str | None
    raw_body: dict | str | None


def discover_supported_files(root: Path) -> list[Path]:
    files = []
    for path in root.rglob("*"):
        if not path.is_file() or "results" in path.parts:
            continue
        if path.suffix.lower() in SUPPORTED_EXTENSIONS:
            files.append(path)
    return sorted(files)


def discover_queue_candidate_files(root: Path) -> list[Path]:
    """Prefer files that are historically stable for slicing queue tests."""
    all_files = discover_supported_files(root)

    deny_names = {
        "Akkor.jpg",
        "Bone.eps",
        "Lamp.pdf",
        "PS5.svg",
        "Window.dxf",
        "Screw.igs",
        "Thrower.stp",
    }

    preferred_paths = [
        root / "archive" / "Test.zip",
        root / "cad" / "L4G.iges",
        root / "cad" / "Mythics.step",
        root / "direct" / "Jaagub.stl",
        root / "direct" / "SocConv.obj",
        root / "direct" / "Stampo.stl",
        root / "direct" / "Valentin.3mf",
    ]

    chosen: list[Path] = []
    seen: set[Path] = set()
    for candidate in preferred_paths:
        if candidate.exists() and candidate.is_file() and candidate not in seen:
            chosen.append(candidate)
            seen.add(candidate)

    for path in all_files:
        if path in seen:
            continue
        if path.name in deny_names:
            continue
        if "image" in path.parts or "vector" in path.parts:
            continue
        chosen.append(path)
        seen.add(path)

    return chosen


def choose_input_files(explicit_file: str | None, count: int) -> list[Path]:
    if explicit_file:
        path = Path(explicit_file).resolve()
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(f"Input file does not exist: {path}")
        return [path for _ in range(count)]

    all_files = discover_queue_candidate_files(TESTS_ROOT)
    if not all_files:
        raise FileNotFoundError("No supported input files found under tests/.")

    if count <= len(all_files):
        return all_files[:count]

    # If count is larger than available unique files, cycle deterministically.
    result: list[Path] = []
    index = 0
    while len(result) < count:
        result.append(all_files[index % len(all_files)])
        index += 1
    return result


def run_one_request(
    index: int,
    endpoint: str,
    file_path: Path,
    layer_height: float,
    material: str,
    base_url: str,
    retry_on_429: int,
) -> QueueRequestResult:
    attempts = 0
    started = time.perf_counter()
    status = 0
    body: dict | str | None = None

    while attempts < max(1, retry_on_429):
        attempts += 1
        status, body, _ = curl_multipart_slice(
            base_url=base_url,
            endpoint=endpoint,
            file_path=file_path,
            layer_height=layer_height,
            material=material,
        )

        if status != 429:
            break

        retry_after = 2
        if isinstance(body, dict):
            retry_after = int(body.get("retryAfterSeconds") or 2)
        time.sleep(max(1, retry_after))

    ended = time.perf_counter()

    if isinstance(body, dict):
        success = bool(body.get("success")) and (200 <= status < 300)
        error_code = body.get("errorCode")
        error_message = body.get("error")
    else:
        success = 200 <= status < 300
        error_code = None
        error_message = str(body) if body else None

    return QueueRequestResult(
        index=index,
        file=str(file_path.relative_to(TESTS_ROOT)).replace("\\", "/") if TESTS_ROOT in file_path.parents else str(file_path),
        attempts=attempts,
        started_at=started,
        ended_at=ended,
        duration_sec=round(ended - started, 3),
        http_status=status,
        success=success,
        error_code=error_code,
        error_message=error_message,
        raw_body=body,
    )


def evaluate_order(results: list[QueueRequestResult]) -> dict:
    if len(results) < 2:
        return {"arrival_order_kept": None, "reason": "at least 2 requests required"}

    if any(r.attempts > 1 for r in results):
        return {
            "arrival_order_kept": None,
            "reason": "one or more requests were rate-limited and retried; accepted-arrival order is inconclusive",
        }

    ordered_start = sorted(results, key=lambda r: r.started_at)
    ordered_end = sorted(results, key=lambda r: r.ended_at)
    completion_order = [r.index for r in ordered_end]
    expected_order = [r.index for r in ordered_start]
    arrival_order_kept = completion_order == expected_order

    first_end = ordered_end[0].ended_at
    last_end = ordered_end[-1].ended_at
    spread = last_end - first_end
    min_duration = min(r.duration_sec for r in results)
    expected_min_spread = max(0.0, min_duration * (len(results) - 1) * 0.35)
    staggered = spread >= expected_min_spread

    return {
        "arrival_order_kept": arrival_order_kept,
        "completion_order": completion_order,
        "expected_arrival_order": expected_order,
        "staggered": staggered,
        "spread_sec": round(spread, 3),
        "min_single_duration_sec": round(min_duration, 3),
        "expected_min_spread_sec": round(expected_min_spread, 3),
        "note": "Heuristic black-box check. With MAX_CONCURRENT_SLICES=1, completion order should match arrival order.",
    }


def markdown_summary(results: Iterable[QueueRequestResult], generated_at: str, endpoint: str, order_check: dict, base_url: str) -> str:
    rows = list(results)
    total = len(rows)
    ok = sum(1 for r in rows if r.success)
    bad = total - ok

    lines = [
        "# Queue Concurrency Test Report",
        "",
        f"Generated at (UTC): **{generated_at}**",
        f"Base URL: **{base_url}**",
        f"Endpoint: **{endpoint}**",
        f"Total concurrent requests: **{total}**",
        f"Success: **{ok}**",
        f"Failed: **{bad}**",
        f"Arrival order kept: **{order_check.get('arrival_order_kept')}**",
        f"Staggered completion: **{order_check.get('staggered')}**",
        "",
        "| # | File | Attempts | Status | Success | Duration(s) | ErrorCode |",
        "|---:|:-----|---------:|------:|:-------:|-----------:|:---------|",
    ]

    for r in rows:
        lines.append(
            f"| {r.index} | `{r.file}` | {r.attempts} | {r.http_status} | {'✅' if r.success else '❌'} | {r.duration_sec} | {r.error_code or '-'} |"
        )

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="/slice/FDM", choices=["/slice/FDM", "/slice/SLA"])
    parser.add_argument("--count", type=int, default=3, help="number of concurrent requests")
    parser.add_argument("--layer-height", type=float, default=0.2)
    parser.add_argument("--material", default="PLA")
    parser.add_argument("--file", default=None, help="optional explicit input file path")
    parser.add_argument("--retry-on-429", type=int, default=3, help="max attempts per request when 429 is returned")
    args = parser.parse_args()

    if args.count <= 0:
        print("[QUEUE TEST] count must be > 0")
        return 1

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    base_url, admin_api_key = resolve_runtime_env()

    try:
        input_files = choose_input_files(args.file, args.count)
    except Exception as exc:
        print(f"[QUEUE TEST] ERROR: {exc}")
        return 1

    print(f"[QUEUE TEST] endpoint={args.endpoint} count={args.count} files={len(input_files)}")
    print(f"[QUEUE TEST] admin_api_key_found={bool(admin_api_key)}")

    started_wall = time.perf_counter()
    results: list[QueueRequestResult] = []

    with ThreadPoolExecutor(max_workers=args.count) as executor:
        futures = [
            executor.submit(
                run_one_request,
                index,
                args.endpoint,
                input_files[index - 1],
                args.layer_height,
                args.material,
                base_url,
                args.retry_on_429,
            )
            for index in range(1, args.count + 1)
        ]

        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            print(
                f"[QUEUE TEST] req#{result.index} status={result.http_status} success={result.success} duration={result.duration_sec}s"
            )

    ended_wall = time.perf_counter()

    results_sorted = sorted(results, key=lambda r: r.index)
    success_count = sum(1 for r in results_sorted if r.success)
    fail_count = len(results_sorted) - success_count

    order_check = evaluate_order(results_sorted)

    generated_at = datetime.now(timezone.utc).isoformat()
    report = {
        "generated_at": generated_at,
        "base_url": base_url,
        "endpoint": args.endpoint,
        "count": args.count,
        "input_files": [
            str(path.relative_to(TESTS_ROOT)).replace("\\", "/") if TESTS_ROOT in path.parents else str(path)
            for path in input_files
        ],
        "layer_height": args.layer_height,
        "material": args.material,
        "admin_api_key_found": bool(admin_api_key),
        "wall_duration_sec": round(ended_wall - started_wall, 3),
        "success_count": success_count,
        "fail_count": fail_count,
        "order_check": order_check,
        "results": [asdict(r) for r in results_sorted],
    }

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = RESULTS_DIR / "queue_concurrency_test_report.json"
    report_md_path = RESULTS_DIR / "queue_concurrency_test_report.md"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    report_md_path.write_text(
        markdown_summary(results_sorted, generated_at, args.endpoint, order_check, base_url),
        encoding="utf-8",
    )

    print(f"[QUEUE TEST] Report: {report_path}")
    print(f"[QUEUE TEST] Report: {report_md_path}")
    print(f"[QUEUE TEST] Success={success_count} Fail={fail_count}")
    if order_check.get("arrival_order_kept") is not None:
        print(
            f"[QUEUE TEST] Arrival order kept: {order_check['arrival_order_kept']} "
            f"| staggered={order_check.get('staggered')} | spread={order_check.get('spread_sec')}s"
        )

    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
