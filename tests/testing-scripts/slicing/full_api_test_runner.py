"""Run split full API suite (Orca FDM, Prusa FDM, Prusa SL1).

This runner executes the three dedicated matrix scenarios and writes:
- per-scenario markdown reports
- one consolidated suite summary (`full_api_test_result.md`)
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

_TESTING_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TESTING_SCRIPTS))

from common.slice_matrix_runner import (
    ORCA_SLICE_ENDPOINT,
    PRUSA_SLICE_ENDPOINT,
    SliceScenario,
    build_suite_summary_markdown,
    run_scenario,
)

SCRIPTS_ROOT = _TESTING_SCRIPTS
RESULTS_DIR = SCRIPTS_ROOT / "results"
REPORT_PATH = RESULTS_DIR / "full_api_test_result.md"
LEGACY_REPORT_FILES = (
    RESULTS_DIR / "full_api_test_report.json",
    RESULTS_DIR / "full_api_test_report.md",
)

FULL_API_SCENARIOS = (
    SliceScenario(
        key="orca_fdm",
        report_title="Full API Orca FDM Test Report",
        endpoint=ORCA_SLICE_ENDPOINT,
        technology="FDM",
        material="PLA",
        layer_heights=(0.1, 0.2, 0.3),
        report_filename="full_api_orca_fdm_test_result.md",
        legacy_report_files=(
            "full_api_orca_fdm_test_report.json",
            "full_api_orca_fdm_test_report.md",
        ),
    ),
    SliceScenario(
        key="prusa_fdm",
        report_title="Full API Prusa FDM Test Report",
        endpoint=PRUSA_SLICE_ENDPOINT,
        technology="FDM",
        material="PLA",
        layer_heights=(0.1, 0.2, 0.3),
        report_filename="full_api_prusa_fdm_test_result.md",
        legacy_report_files=(
            "full_api_prusa_fdm_test_report.json",
            "full_api_prusa_fdm_test_report.md",
        ),
    ),
    SliceScenario(
        key="prusa_sl1",
        report_title="Full API Prusa SL1 Test Report",
        endpoint=PRUSA_SLICE_ENDPOINT,
        technology="SLA",
        material="Standard",
        layer_heights=(0.05, 0.025),
        report_filename="full_api_prusa_sl1_test_result.md",
        legacy_report_files=(
            "full_api_prusa_sl1_test_report.json",
            "full_api_prusa_sl1_test_report.md",
        ),
    ),
)


def _cleanup_legacy_suite_reports() -> None:
    for legacy_path in LEGACY_REPORT_FILES:
        if legacy_path.exists():
            legacy_path.unlink()


def main() -> int:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    _cleanup_legacy_suite_reports()

    scenario_results = []

    for scenario in FULL_API_SCENARIOS:
        try:
            scenario_results.append(run_scenario(SCRIPTS_ROOT, scenario))
        except Exception as exc:
            print(f"[FULL API SUITE] ERROR in {scenario.key}: {exc}")
            return 1

    generated_at = datetime.now(timezone.utc).isoformat()
    suite_summary = build_suite_summary_markdown(
        suite_title="Full API Split Suite Report",
        generated_at=generated_at,
        scenario_results=scenario_results,
    )
    REPORT_PATH.write_text(suite_summary, encoding="utf-8")

    total = sum(item.total for item in scenario_results)
    failed = sum(item.failed_count for item in scenario_results)
    print(f"[FULL API SUITE] Completed. total={total} failed={failed}")
    print(f"[FULL API SUITE] Summary report: {REPORT_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
