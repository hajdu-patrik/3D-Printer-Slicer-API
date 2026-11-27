# Testing Scripts - Local Claude Guide

Last synchronized: 2026-11-27

## Scope

This folder contains API-level Python integration and workflow tests.

## Fast Pre-Check

Before running Python runners, run the Node unit suite from the repository root: `npm test` (`node --test` on tests/unit/*.test.js). It needs no running API.

## Main Runner Groups

- `slicing/` — Full suite and slicer matrix runners
  - slicing/full_api_test_runner.py
  - slicing/full_api_orca_fdm_test_runner.py
  - slicing/full_api_prusa_fdm_test_runner.py
  - slicing/full_api_prusa_sl1_test_runner.py
  - slicing/unsupported_upload_test_runner.py
  - slicing/invalid_geometry_test_runner.py

- `admin/` — Admin endpoint validations
  - admin/admin_output_files_test_runner.py

- `pricing/` — Pricing lifecycle validations
  - pricing/pricing_cycle_test_runner.py

- `queue/` — Queue concurrency validations
  - queue/queue_concurrency_test_runner.py

- `rate_limit/` — Rate-limit regression validations
  - rate_limit/rate_limit_regression_test_runner.py

## Shared Helpers

Located in tests/testing-scripts/common/:

- env_utils.py
- http_utils.py
- slice_matrix_runner.py

## Reporting Contract

All test outputs must be written to tests/testing-scripts/results/.
After execution, always read the generated markdown report file.

## Execution Policy

- Prefer Docker-based API runtime for integration validations.
- Repeated identical slice requests now return `cache_hit: true` (and create no new output file) unless SLICE_RESULT_CACHE_TTL_MS=0; set it to 0 for runs that must exercise the slicer every time.
- Keep test runners deterministic and avoid changing endpoint contracts through tests.

## Runtime Inputs

- SLICER_BASE_URL from .env, fallback to default local base URL.
- ADMIN_API_KEY required for admin endpoint tests.

## Local Rules

- Prefer existing runner patterns over adding ad-hoc scripts.
- Keep reports deterministic and easy to diff.
- Preserve endpoint coverage when endpoint behavior changes.
- Keep focused runners behavior-specific; split oversized runners into domain-focused suites.
- Keep stable deterministic runners unchanged unless changed endpoint behavior requires edits.
- Full slice matrix reports may mark explicitly declared fail-fast rejections as passing only when status and `errorCode` match the expected case exactly.
- Queue concurrency reports use staggered completion as the black-box signal for serialized queue processing; client start-order matching is informational.
