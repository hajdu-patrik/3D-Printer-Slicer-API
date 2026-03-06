"""Run Prusa SL1 (SLA) full API matrix for all files under tests/testing-files."""

from __future__ import annotations

from pathlib import Path

from common.slice_matrix_runner import PRUSA_SLICE_ENDPOINT, SliceScenario, run_scenario

SCRIPTS_ROOT = Path(__file__).resolve().parent

PRUSA_SL1_SCENARIO = SliceScenario(
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
)


def main() -> int:
    try:
        run_scenario(SCRIPTS_ROOT, PRUSA_SL1_SCENARIO)
    except Exception as exc:
        print(f"[PRUSA SL1 TEST] ERROR: {exc}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
