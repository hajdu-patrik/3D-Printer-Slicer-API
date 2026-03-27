---
name: slicer-api-testing
description: Execute Python-based validation and regression test suites for the 3D Printer Slicer API (Prusa/Orca). Use this when asked to run tests, verify endpoint behavior, check queue concurrency, or validate pricing lifecycles.
---

Use this skill whenever API endpoints, slicing logic, pricing, or queue concurrency needs to be tested.

Objective:
- Ensure all test executions are performed using the official Python test runners.
- Prevent hallucination of test commands (e.g., do not use `pytest` or `npm test` for integration logic).
- Automatically read the generated markdown reports to verify test outcomes.

Repository context and defaults:
- All commands MUST be executed from the repository root.
- All test scripts are located in `tests/testing-scripts/`.
- All generated reports are saved to `tests/testing-scripts/results/`.
- Supported endpoints tested: `/orca/slice`, `/prusa/slice`, `/pricing/*`, `/admin/output-files`.

Available Test Runners & Workflows:

1. Full Suite Wrapper (Recommended for general validation)
   Command: `python "tests/testing-scripts/full_api_test_runner.py"`
   Report: `tests/testing-scripts/results/full_api_test_result.md`

2. Slicer-Specific Matrix Runs
   - Orca FDM: `python "tests/testing-scripts/full_api_orca_fdm_test_runner.py"`
   - Prusa FDM: `python "tests/testing-scripts/full_api_prusa_fdm_test_runner.py"`
   - Prusa SLA: `python "tests/testing-scripts/full_api_prusa_sl1_test_runner.py"`

3. Isolated Feature Tests
   - Pricing Lifecycle: `python "tests/testing-scripts/pricing_cycle_test_runner.py"` (Create -> Verify -> Update -> Verify -> Delete)
   - Admin Outputs: `python "tests/testing-scripts/admin_output_files_test_runner.py"`

4. Queue Concurrency / Load Testing
   Command: `python "tests/testing-scripts/queue_concurrency_test_runner.py" --count <N> --retry-on-429 3`
   Note: Requires `--endpoint /prusa/slice` or `--endpoint /orca/slice`. Tests arrival-order and staggered completion.

Implementation workflow:
1. Identify the specific subsystem the user wants to test (e.g., just Orca, just pricing, or the full suite).
2. Execute the exact corresponding python script from the root.
3. Wait for the script to finish.
4. IMMEDIATELY read the corresponding `..._result.md` file from the `results/` folder to analyze the outcome.
5. Report the parsed results back to the user.

Troubleshooting:
- If tests fail due to authorization, ensure `ADMIN_API_KEY` is set in the `.env` file.