"""Run Orca FDM full API matrix for all files under tests/testing-files."""

from __future__ import annotations

from pathlib import Path

from common.slice_matrix_runner import ORCA_SLICE_ENDPOINT, SliceScenario, run_scenario

SCRIPTS_ROOT = Path(__file__).resolve().parent

ORCA_FDM_SCENARIO = SliceScenario(
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
)


def main() -> int:
    try:
        run_scenario(SCRIPTS_ROOT, ORCA_FDM_SCENARIO)
    except Exception as exc:
        print(f"[ORCA FDM TEST] ERROR: {exc}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
