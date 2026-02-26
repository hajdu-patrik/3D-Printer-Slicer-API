# API Testing

## For validation and regression testing, run the Python test runners from the repository root.

- `python "tests/testing-scripts/full_api_test_runner.py"`
	- Recommended for full regression verification.
	- Executes the complete FDM/SLA matrix for all supported inputs under `tests/testing-files/`.

- `python "tests/testing-scripts/pricing_cycle_test_runner.py"`
	- Runs pricing lifecycle validation for both FDM and SLA in one cycle.
	- Performs create → verify → update → verify → delete → verify using admin API key read from `.env` (with env fallback).

- `python "tests/testing-scripts/admin_output_files_test_runner.py"`
	- Validates protected `GET /admin/output-files` behavior.
	- Checks unauthorized rejection and authorized success response schema (tries `.env` key first, then env key).


- `python "tests/testing-scripts/queue_concurrency_test_runner.py" --count 5 --retry-on-429 3`
	- Runs queue behavior test with `N` concurrent slicing POST requests.
	- Uses `N` supported files from `tests/testing-files/` (or `--file` to force one file).
	- Automatically retries `429` responses (`Retry-After`) so higher `N` still testable under rate limit.
	- Verifies whether completion order follows arrival order (queue semantics).

---

## Test reports are written to `tests/testing-scripts/results/`:
- `admin_output_files_test_report.json`
- `admin_output_files_test_report.md`
	- Structured outputs from admin output-files endpoint validation.

- `full_api_test_report.json`
- `full_api_test_report.md`
	- Structured outputs from full-matrix regression runs.

- `pricing_cycle_test_report.json`
- `pricing_cycle_test_report.md`
	- Structured outputs from pricing lifecycle integration runs.

- `queue_concurrency_test_report.json`
- `queue_concurrency_test_report.md`
	- Concurrent queue behavior outputs (arrival-order + staggered completion analysis).