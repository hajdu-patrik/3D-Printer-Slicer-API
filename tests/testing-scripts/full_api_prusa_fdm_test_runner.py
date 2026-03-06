"""Run Prusa FDM full API matrix for all files under tests/testing-files."""

from __future__ import annotations

from pathlib import Path

from common.slice_matrix_runner import PRUSA_SLICE_ENDPOINT, SliceScenario, run_scenario

SCRIPTS_ROOT = Path(__file__).resolve().parent

PRUSA_FDM_SCENARIO = SliceScenario(
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
)


def main() -> int:
    try:
        run_scenario(SCRIPTS_ROOT, PRUSA_FDM_SCENARIO)
    except Exception as exc:
        print(f"[PRUSA FDM TEST] ERROR: {exc}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
