---
name: testing
description: Execute Python-based validation and regression test suites for the 3D Printer Slicer API (Prusa/Orca). Use this when asked to run tests, verify endpoint behavior, check queue concurrency, or validate pricing lifecycles.
---

Use this skill whenever API endpoints, slicing logic, pricing, or queue concurrency needs to be tested.

Full agent definition with scope, responsibilities, hard rules, and scope boundaries is in `.claude/agents/test-engineer.md`.
Read that file for complete context when writing new tests or extending existing ones.

## Quick Command Reference

1. Full suite wrapper
   - Command: `python tests/testing-scripts/full_api_test_runner.py`
   - Report: `tests/testing-scripts/results/full_api_test_result.md`

2. Engine-specific matrix runners
   - Orca FDM: `python tests/testing-scripts/full_api_orca_fdm_test_runner.py`
   - Prusa FDM: `python tests/testing-scripts/full_api_prusa_fdm_test_runner.py`
   - Prusa SLA: `python tests/testing-scripts/full_api_prusa_sl1_test_runner.py`

3. Isolated feature tests
   - Pricing lifecycle: `python tests/testing-scripts/pricing_cycle_test_runner.py`
   - Admin output listing: `python tests/testing-scripts/admin_output_files_test_runner.py`

4. Queue and concurrency test
   - Command: `python tests/testing-scripts/queue_concurrency_test_runner.py --count <N> --retry-on-429 3`

## Workflow
1. Identify which subsystem must be validated.
2. Run the exact matching test script.
3. Wait for completion.
4. Immediately read the generated report in `tests/testing-scripts/results/`.
5. Summarize pass/fail details and notable findings.

## Troubleshooting
- If admin tests fail with 401/403, verify `ADMIN_API_KEY` in .env matches the running server.
- If slice tests fail with connection errors, verify API health endpoint before rerun.
