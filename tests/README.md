# Tests

This folder contains integration test assets and test runners for the 3D Printer Slicer API.

## Structure

- `testing-files/`: Sample input files used by the runners.
- `testing-scripts/`: Python test runners and shared test utilities.

## Notes

- Test result reports are generated under `testing-scripts/results/`.
- Large sample files and generated reports are intentionally gitignored.

---

## Prerequisites

Start the API before running integration tests:

```bash
docker compose up -d --build
curl -sS http://127.0.0.1:3000/health
```

Run all commands from the repository root.

## How To Run Individual Tests

### Full Slice Matrix (all engines/technologies)

```bash
python tests/testing-scripts/slicing/full_api_test_runner.py
```

What it does:

- Runs the complete slicing matrix (Orca FDM, Prusa FDM, Prusa SLA).
- Validates status codes, response contract fields, and pricing consistency.
- Writes summary report to `tests/testing-scripts/results/full_api_test_result.md`.

### Orca FDM Scenario Only

```bash
python tests/testing-scripts/slicing/full_api_orca_fdm_test_runner.py
```

What it does:

- Tests only `/orca/slice` with FDM input combinations.
- Confirms Orca-specific profile handling and successful output responses.

### Prusa FDM Scenario Only

```bash
python tests/testing-scripts/slicing/full_api_prusa_fdm_test_runner.py
```

What it does:

- Tests `/prusa/slice` with FDM inputs and layer profiles.
- Validates end-to-end Prusa FDM flow and response payload consistency.

### Prusa SLA Scenario Only

```bash
python tests/testing-scripts/slicing/full_api_prusa_sl1_test_runner.py
```

What it does:

- Tests `/prusa/slice` with SLA material/layer settings.
- Verifies SLA flow, including explicit fail-fast bound checks when expected.

### Unsupported Upload Rejection

```bash
python tests/testing-scripts/slicing/unsupported_upload_test_runner.py
```

What it does:

- Verifies removed 2D artwork upload paths are rejected.
- Checks stable error codes for direct unsupported upload and ZIP archive rejection.

### Pricing Lifecycle

```bash
python tests/testing-scripts/pricing/pricing_cycle_test_runner.py
```

What it does:

- Exercises create, read, update, and delete operations for FDM and SLA pricing.
- Ensures pricing updates are visible through `/pricing`.

### Admin Output Files

```bash
python tests/testing-scripts/admin/admin_output_files_test_runner.py
```

What it does:

- Tests `/admin/output-files` and `/admin/download/:fileName` authorization and behavior.
- Validates `/admin/download/ALL` handling with configured bulk ZIP limits.

### Queue Concurrency

```bash
python tests/testing-scripts/queue/queue_concurrency_test_runner.py --count 3 --retry-on-429 3
```

What it does:

- Sends concurrent slice requests and checks queue serialization behavior.
- Uses staggered completion as the primary black-box queue signal.

### Rate Limit Regression

```bash
python tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py
```

What it does:

- Probes admin and slicing endpoints until rate-limit responses appear.
- Verifies 429 semantics, `Retry-After`, and expected API error codes.

---

## Reports

- All runners write markdown reports to `tests/testing-scripts/results/`.
- Always read the generated report after each run.
