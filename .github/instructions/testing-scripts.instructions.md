---
applyTo: "tests/testing-scripts/**"
---

# Testing Scripts Instructions

Last synchronized: 2026-04-07

## Test Entry Points
- full_api_test_runner.py
- full_api_orca_fdm_test_runner.py
- full_api_prusa_fdm_test_runner.py
- full_api_prusa_sl1_test_runner.py
- pricing_cycle_test_runner.py
- admin_output_files_test_runner.py
- queue_concurrency_test_runner.py

## Reporting Rules
- Write reports to tests/testing-scripts/results/.
- After running tests, read markdown reports and summarize outcomes.

## Environment Inputs
- SLICER_BASE_URL
- ADMIN_API_KEY for admin endpoint tests
