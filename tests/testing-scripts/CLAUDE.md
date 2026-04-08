# Testing Scripts - Local Claude Guide

Last synchronized: 2026-04-07

## Scope
This folder contains API-level Python integration and workflow tests.

## Main Runner Groups
- Full suite wrapper
  - full_api_test_runner.py

- Slicer matrix runners
  - full_api_orca_fdm_test_runner.py
  - full_api_prusa_fdm_test_runner.py
  - full_api_prusa_sl1_test_runner.py

- Focused validations
  - pricing_cycle_test_runner.py
  - admin_output_files_test_runner.py
  - queue_concurrency_test_runner.py

## Shared Helpers
Located in tests/testing-scripts/common/:
- env_utils.py
- http_utils.py
- slice_matrix_runner.py

## Reporting Contract
All test outputs must be written to tests/testing-scripts/results/.
After execution, always read the generated markdown report file.

## Runtime Inputs
- SLICER_BASE_URL from .env, fallback to default local base URL.
- ADMIN_API_KEY required for admin endpoint tests.

## Local Rules
- Prefer existing runner patterns over adding ad-hoc scripts.
- Keep reports deterministic and easy to diff.
- Preserve endpoint coverage when endpoint behavior changes.
