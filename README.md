<img width="2048" height="2048" alt="API-LOGO" src="https://github.com/user-attachments/assets/61739b97-e3ab-4335-a127-5a1370111a5a" />

![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=flat&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Backend-Express_4.18.2-000000?style=flat&logo=express&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat&logo=python&logoColor=white)
![PrusaSlicer](https://img.shields.io/badge/Slicer-PrusaSlicer_2.8.1-orange?style=flat)
![OrcaSlicer](https://img.shields.io/badge/Slicer-OrcaSlicer_2.3.1-8A2BE2?style=flat)
![Docker](https://img.shields.io/badge/Container-Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Ubuntu Next](https://img.shields.io/badge/Next-Ubuntu_24.04-E95420?style=flat&logo=ubuntu&logoColor=white)
![API](https://img.shields.io/badge/API-Prusa%2FOrca_Endpoints-success?style=flat)

# 3D Printer Slicer API (FDM & SLA)

An automated 3D slicing and pricing API built with `Node.js` and `Python` that converts multiple 2D/3D input types into printable outputs with validated pricing.

Built for zero-downtime rollout, this API now supports two slicer engines through separate public endpoints.

---

## ✨ Core Features

- 🔄 **Universal input processing:** direct 3D, CAD, vector, image, and ZIP first-supported extraction.
- ⚖️ **Auto-orientation:** Python-based orientation optimization before slicing.
- 🧮 **Pricing engine:** dynamic hourly-rate calculation from persisted pricing map.
- 🚦 **Queue + rate protection:** bounded queue and endpoint rate limiting for CPU-heavy requests.
- 🧨 **ZIP safety checks:** entry/size/path validation and encrypted ZIP rejection.
- 🧵 **Dual slicer routing:** Prusa and Orca engines behind dedicated endpoints.

---

## 📂 Supported File Formats

| Category | Extensions |
|---|---|
| Direct 3D | `.stl`, `.obj`, `.3mf` |
| NURBS / CAD | `.stp`, `.step`, `.igs`, `.iges`, `.ply` |
| Vector | `.dxf`, `.svg`, `.eps`, `.pdf` |
| Image | `.jpg`, `.jpeg`, `.png`, `.bmp` |
| Archive | `.zip` |

---

## 🔑 Authentication

Admin-protected endpoints require:

- Header: `x-api-key: <ADMIN_API_KEY>`

Public endpoints do not require admin key.

---

## 🌐 Endpoints

### Public

- `GET /health`
- `GET /pricing`
- `POST /prusa/slice`
- `POST /orca/slice`
- `GET /openapi.json`
- `GET /docs`

### Admin-protected

- `GET /health/detailed`
- `POST /pricing/FDM`
- `POST /pricing/SLA`
- `PATCH /pricing/:technology/:material`
- `DELETE /pricing/:technology/:material`
- `GET /admin/output-files`
- `GET /admin/download/:fileName`

---

## 🧩 Application Module Map (app/*.js)

### Bootstrap

- `app/server.js` - Express bootstrap, startup guards, helmet/cors, request-id propagation, docs mounting, routes, and global error handling.

### Configuration

- `app/config/constants.js` - runtime defaults, layer presets, limits, and extension groups.
- `app/config/paths.js` - root-scoped runtime path resolution (`input/`, `output/`, `configs/`) and directory creation.
- `app/config/python.js` - secure Python executable resolver (`PYTHON_EXECUTABLE` + `VIRTUAL_ENV` fallbacks).

### Middleware

- `app/middleware/rateLimit.js` - in-memory IP throttling for slice and admin routes (`Retry-After` aware responses).
- `app/middleware/requireAdmin.js` - timing-safe x-api-key guard + unauthorized attempt logging.
- `app/middleware/errorHandler.js` - centralized request/upload/parser error normalization.

### Routes

- `app/routes/slice.routes.js` - `POST /prusa/slice`, `POST /orca/slice` with rate-limit and single-file upload middleware.
- `app/routes/pricing.routes.js` - public pricing read + admin pricing mutations.
- `app/routes/system.routes.js` - health endpoints and admin artifact listing/download endpoints.

### Services

- `app/services/pricing.service.js` - pricing load/save/migration/lookup logic.
- `app/services/slice.service.js` - end-to-end slicing orchestrator and queue error mapping.
- `app/services/slice/command.js` - subprocess execution via `execFile` with timeout and optional debug logs.
- `app/services/slice/common.js` - output naming, isolated Orca output dirs, cleanup utilities.
- `app/services/slice/engine.js` - slicer argument construction (Prusa vs Orca).
- `app/services/slice/errors.js` - error classification and API error responses.
- `app/services/slice/input-processing.js` - conversion/orientation preprocessing pipeline.
- `app/services/slice/model-stats.js` - metadata/stat parsing from slicer outputs.
- `app/services/slice/number-utils.js` - shared numeric parser helpers.
- `app/services/slice/options.js` - strict request option validation/parsing.
- `app/services/slice/profiles.js` - profile selection, runtime profile generation, build-volume limits.
- `app/services/slice/queue.js` - FIFO queue + per-client fairness + timeout enforcement.
- `app/services/slice/transform.js` - transform planning/execution and bounds validation.
- `app/services/slice/value-parsers.js` - safe parsing and profile filename sanitization.
- `app/services/slice/zip.js` - ZIP safety inspection and safe extraction.

### Utilities and API docs

- `app/utils/client-ip.js` - trust-proxy-aware client IP normalization.
- `app/utils/logger.js` - structured processing error logging.
- `app/docs/swagger-docs.js` - OpenAPI generation for `/docs` and `/openapi.json`.

---

## 🧠 Slicing API Behavior

Both slicing endpoints accept `multipart/form-data` with required file field:

- `choosenFile`

Optional fields:

- `layerHeight`
- `material`
- `infill` (`0`-`100`)
- `depth`
- `sizeUnit` (`mm` or `inch`)
- `keepProportions` (`true`/`false`, default `true`)
- `targetSizeX`, `targetSizeY`, `targetSizeZ` (target dimensions in selected unit)
- `scalePercent` (uniform scale; cannot be combined with `targetSizeX/Y/Z`)
- `rotationX`, `rotationY`, `rotationZ` (degrees)
- `printerProfile` (profile override filename)
- `processProfile` (Orca only process profile override filename)

`depth` must be within `0 < depth <= DEFAULT_RELIEF_DEPTH_MAX_MM` (default `25mm`).

### `POST /prusa/slice`

Uses `prusa-slicer`.

- Auto-selects technology by `layerHeight`:
  - `0.025`, `0.05` → `SLA`
  - `0.1`, `0.2`, `0.3` → `FDM`
- Rejects invalid `layerHeight` values outside `0.025, 0.05, 0.1, 0.2, 0.3`
- Validates material/technology compatibility
- Supports size preprocessing before slicing:
  - mm/inch target dimensions
  - aspect-ratio lock (`keepProportions=true`)
  - free X/Y/Z sizing (`keepProportions=false`)
  - optional X/Y/Z rotation
- Validates final model size against selected printer profile limits (`min`/`max` build volume)
- You can override profile file with `printerProfile` from `configs/prusa`

Example:

```bash
curl -X POST http://localhost:3000/prusa/slice \
  -H "Accept: application/json" \
  -F "choosenFile=@/path/to/model.stl" \
  -F "layerHeight=0.2" \
  -F "material=PLA" \
  -F "infill=20" \
  -F "sizeUnit=mm" \
  -F "keepProportions=true" \
  -F "targetSizeZ=120"
```

### `POST /orca/slice`

Uses `orca-slicer`.

- Forced `FDM` processing
- Allowed `layerHeight`: `0.1`, `0.2`, `0.3`
- Rejects SLA-only materials
- Runs with Orca arrange/orient flow and machine+process profile pair
  - Machine profile file is resolved from `.env` via `ORCA_MACHINE_PROFILE` (default: `Bambu_P1S_0.4_nozzle.json`)
- Process profile file is selected by `layerHeight` (`0.1/0.2/0.3`) and can be overridden via `.env`:
  - `ORCA_PROCESS_PROFILE_0_1`
  - `ORCA_PROCESS_PROFILE_0_2`
  - `ORCA_PROCESS_PROFILE_0_3`
- Request-level profile overrides are supported:
  - `printerProfile` → machine profile from `configs/orca`
  - `processProfile` → process profile from `configs/orca`
- Output artifacts are resolved through a per-request isolated output directory before final filename alignment.
- Supports same size preprocessing options as Prusa endpoint (`sizeUnit`, `keepProportions`, `targetSizeX/Y/Z`, `scalePercent`, rotations)
- Validates final model size against selected machine profile build-volume limits

Example:

```bash
curl -X POST http://localhost:3000/orca/slice \
  -H "Accept: application/json" \
  -F "choosenFile=@/path/to/model.stl" \
  -F "layerHeight=0.2" \
  -F "material=PLA" \
  -F "infill=20" \
  -F "printerProfile=Bambu_P1S_0.4_nozzle.json" \
  -F "processProfile=FDM_0.2mm.json" \
  -F "sizeUnit=inch" \
  -F "keepProportions=false" \
  -F "targetSizeX=8.0" \
  -F "targetSizeY=8.0" \
  -F "targetSizeZ=5.0"
```

### Common successful response

```json
{
  "success": true,
  "slicer_engine": "prusa",
  "technology": "FDM",
  "material": "PLA",
  "infill": "20%",
  "profiles": {
    "prusa_profile": "FDM_0.2mm.ini"
  },
  "model_transform": {
    "size_unit": "mm",
    "keep_proportions": true,
    "requested_size": {
      "x": null,
      "y": null,
      "z": 120
    },
    "scale_percent": null,
    "scale_factors": {
      "x": 1.5,
      "y": 1.5,
      "z": 1.5
    },
    "rotation_deg": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "original_dimensions_mm": {
      "x": 80,
      "y": 60,
      "z": 80
    },
    "final_dimensions_mm": {
      "x": 120,
      "y": 90,
      "z": 120
    }
  },
  "build_volume_limits_mm": {
    "min": {
      "x": 1,
      "y": 1,
      "z": 1
    },
    "max": {
      "x": 256,
      "y": 256,
      "z": 210
    },
    "source_profile": "FDM_0.2mm.ini"
  },
  "hourly_rate": 800,
  "stats": {
    "print_time_seconds": 5400,
    "print_time_readable": "1h 30m",
    "material_used_m": 12.45,
    "object_height_mm": 45.2,
    "estimated_price_huf": 1350
  }
}
```

### Common slicing error codes

- `INVALID_LAYER_HEIGHT`
- `INVALID_LAYER_HEIGHT_FOR_ENGINE`
- `INVALID_LAYER_HEIGHT_FOR_TECHNOLOGY`
- `INVALID_MATERIAL_FOR_TECHNOLOGY`
- `MATERIAL_TECHNOLOGY_MISMATCH`
- `RATE_LIMIT_EXCEEDED`
- `ADMIN_RATE_LIMIT_EXCEEDED`
- `INVALID_SOURCE_ARCHIVE`
- `INVALID_SOURCE_GEOMETRY`
- `UNSUPPORTED_FILE_FORMAT`
- `ORCA_PROFILE_INCOMPATIBLE`
- `INVALID_SIZE_UNIT`
- `INVALID_KEEP_PROPORTIONS`
- `INVALID_DEPTH`
- `INVALID_SIZE_OPTIONS`
- `INVALID_ROTATION_OPTIONS`
- `CONFLICTING_SIZE_OPTIONS`
- `INVALID_PROFILE_NAME`
- `PROFILE_NOT_FOUND`
- `MODEL_DIMENSIONS_UNAVAILABLE`
- `MODEL_OUT_OF_PRINTER_BOUNDS`
- `FILE_PROCESSING_TIMEOUT`
- `SLICE_QUEUE_FULL`
- `SLICE_QUEUE_CLIENT_LIMIT`
- `SLICE_QUEUE_TIMEOUT`
- `QUEUE_INTERNAL_ERROR`
- `INTERNAL_PROCESSING_ERROR`

### Queue and rate-limit response semantics

- `RATE_LIMIT_EXCEEDED` -> HTTP `429`, includes `Retry-After` and `retryAfterSeconds`.
- `ADMIN_RATE_LIMIT_EXCEEDED` -> HTTP `429`, includes `Retry-After` and `retryAfterSeconds`.
- `SLICE_QUEUE_FULL` -> HTTP `503`.
- `SLICE_QUEUE_CLIENT_LIMIT` -> HTTP `429`.
- `SLICE_QUEUE_TIMEOUT` -> HTTP `503`.
- `FILE_PROCESSING_TIMEOUT` -> HTTP `422`.

---

## 💰 Pricing API

### `GET /pricing`

Returns full pricing object.

### `POST /pricing/FDM` / `POST /pricing/SLA` (admin)

Create new material for selected technology.

```json
{
  "material": "ASA",
  "price": 1200
}
```

### `PATCH /pricing/:technology/:material` (admin)

Update existing material price only.

```json
{
  "price": 950
}
```

### `DELETE /pricing/:technology/:material` (admin)

Delete existing material from selected technology.

---

## 🛠️ Admin Endpoint

### `GET /admin/output-files` (admin)

Lists generated `.gcode` / `.sl1` files from `output/`.

```json
{
  "success": true,
  "total": 2,
  "files": [
    {
      "fileName": "model-output-1741285245000.gcode",
      "downloadUrl": "/admin/download/model-output-1741285245000.gcode",
      "sizeBytes": 182734,
      "createdAt": "2026-03-05T10:07:25.000Z",
      "modifiedAt": "2026-03-05T10:07:27.000Z"
    },
    {
      "fileName": "model-output-1741285301000.sl1",
      "downloadUrl": "/admin/download/model-output-1741285301000.sl1",
      "sizeBytes": 941282,
      "createdAt": "2026-03-05T10:08:21.000Z",
      "modifiedAt": "2026-03-05T10:08:24.000Z"
    }
  ]
}
```

Generated artifacts are stored with the following convention for clarity and traceability:

- `InputName-output-<timestamp>.gcode`
- `InputName-output-<timestamp>.sl1`

Common slicing error responses:
- `INVALID_SOURCE_ARCHIVE` → uploaded ZIP is invalid or does not contain a supported file.
- `INVALID_SOURCE_GEOMETRY` → uploaded source geometry is invalid/non-printable and auto-repair is disabled.
- `FILE_PROCESSING_TIMEOUT` (HTTP `422`) → processing exceeded 10 minutes for the uploaded file.

---

## 🔏 Learn how to setup the `.env`, configs, input/output

#### 1. Create your env file from template:

```bash
cp .env.example .env
```

#### 2. Create your pricing configuration file from the template:

```bash
cp configs/pricing.example.json configs/pricing.json
```

*Default `pricing.example.json` structure:*

```json
{
  "FDM": {
    "PLA": 1000,
    "ABS": 1000,
    "PETG": 1100,
    "TPU": 1100
  },
  "SLA": {
    "Standard": 2000,
    "ABS-Like": 2000,
    "Flexible": 2800
  }
}
```

#### 3. Set at least `ADMIN_API_KEY` in `.env`.

#### 4. Start the app:
  - local: `npm start`
  - docker: `docker compose up -d --build`

#### 5. The app now reads `.env` automatically on local startup via `dotenv`, and Docker reads it via `env_file`.

### Runtime folders used by the program

- `input/` → temporary working input directory used during conversion/slicing pipeline.
- `output/` → generated output artifacts (`.gcode`, `.sl1`, etc.).
- `configs/` → slicer profile `.ini` files + persistent `pricing.json`.

Runtime paths are root-scoped in both local and Docker execution.
No app-local runtime folders are used (`app/input`, `app/output`, `app/configs` are intentionally not used).

### Config files you can use out-of-the-box

- Prusa process/printer profiles (`.ini`):
  - `configs/prusa/FDM_0.1mm.ini`
  - `configs/prusa/FDM_0.2mm.ini`
  - `configs/prusa/FDM_0.3mm.ini`
  - `configs/prusa/SLA_0.025mm.ini`
  - `configs/prusa/SLA_0.05mm.ini`
- Orca machine/process profiles (`.json`):
  - `configs/orca/Bambu_P1S_0.4_nozzle.json`
  - `configs/orca/FDM_0.1mm.json`
  - `configs/orca/FDM_0.2mm.json`
  - `configs/orca/FDM_0.3mm.json`

You can add your own profiles (for example 2 FDM + 2 SLA for Prusa, or multiple Orca machine profiles), then select them per request with `printerProfile` (and `processProfile` for Orca).

Different printer/process profiles produce different G-code behavior in practice (speed, accelerations, cooling, supports, extrusion strategy), even for the same model.

---

## ⚙️ Configuration & Limits

You can customize pricing, security, and slicing behavior without changing endpoint contracts.

- **Pricing Matrix:** Persisted in `configs/pricing.json` (managed via `/pricing` endpoints).
- **Admin Security:** `ADMIN_API_KEY` environment variable controls access to pricing updates/deletes.
- **Admin Browser CORS Control:** `/admin/*` browser-origin requests are constrained by `ADMIN_CORS_ALLOWED_ORIGINS`.
- **Admin File Listing:** `GET /admin/output-files` requires `ADMIN_API_KEY` and returns generated output artifacts.
- **Admin File Download:** `GET /admin/download/:fileName` requires `ADMIN_API_KEY` and allows downloading `.gcode` / `.sl1` artifacts.
- **Fail-Fast Security:** Server startup is blocked if `ADMIN_API_KEY` is missing.
- **Security Logging:** Admin auth failures log client IP with forwarded-header-aware parsing (requires `TRUST_PROXY=true` behind proxy).
- **Timing-Safe Auth:** Admin API key comparison uses constant-time comparison to prevent timing side-channel attacks.
- **Upload Validation:** Multer accepts only a single file on the `choosenFile` field with file extension validation at upload time.
- **Request Rate Limit:** Slicing endpoints are IP-rate-limited (default `3` requests / `60s`). Expired rate-limit buckets are automatically pruned.
- **Admin Rate Limit:** Admin endpoints are IP-rate-limited (default `30` requests / `60s`) to reduce brute-force API-key attempts.
- **Proxy Trust:** Set `TRUST_PROXY=true` only behind a reverse proxy and configure `TRUST_PROXY_CIDRS` to trusted proxy CIDRs/names; forwarded headers are ignored otherwise.
- **Slicing Queue:** CPU-heavy slice jobs are queued in arrival order and processed FIFO (`MAX_CONCURRENT_SLICES`, default `1`).
- **Queue Fairness:** Per-client queue ownership is bounded (`MAX_SLICE_QUEUE_PER_IP`) so one client cannot monopolize all pending capacity.
- **Queue Safety Limits:** Queue length and wait timeout are bounded (`MAX_SLICE_QUEUE_LENGTH`, `MAX_SLICE_QUEUE_WAIT_MS`).
- **Upload Body Limit:** Multipart upload size is capped (`MAX_UPLOAD_BYTES`, default `500MB`).
- **ZIP Safety Limits:** ZIP extraction is guarded by max entries (`MAX_ZIP_ENTRIES`, default `10`) and max cumulative extracted size (`MAX_ZIP_UNCOMPRESSED_BYTES`, default `500MB`).
- **ZIP Content Rule:** ZIP uploads must contain exactly one supported source file; unsupported or suspicious ZIP contents are rejected and cleaned up.
- **Body Parser Limits:** JSON/form payload size is capped (`JSON_BODY_LIMIT`, `FORM_BODY_LIMIT`, default `1mb`).
- **Slicer Profiles:** Stored in `configs/prusa/*.ini` and `configs/orca/*.json`.
- **Timeouts:** Internal 10-minute kill-switches prevent infinite loops during complex conversion/slicing operations and return `FILE_PROCESSING_TIMEOUT` when exceeded.
- **Model Fidelity Policy:** Uploaded model/image/vector data is never auto-healed or shape-corrected; invalid/non-printable source data is rejected with a clear error.
- **Supply-Chain Integrity:** Docker build pins and verifies SHA256 checksums for downloaded PrusaSlicer and OrcaSlicer AppImages.
- **Python Resolver Security:** `PYTHON_EXECUTABLE` must be absolute and existing when set; fallback resolution uses `VIRTUAL_ENV` and known absolute runtime paths.
- **Command Debugging:** `DEBUG_COMMAND_LOGS=true` enables verbose converter/slicer stdout/stderr logging.

---

## 📝 Security and Runtime Change Snapshot (2026-04-21)

This repository currently includes the following synchronized changes across implementation and docs:

1. **Admin security hardening**
- Mandatory startup guard for `ADMIN_API_KEY`.
- Timing-safe API key verification for admin routes.
- Request-id-aware unauthorized logging.

2. **Rate-limit controls**
- Dedicated admin limiter (`ADMIN_RATE_LIMIT_EXCEEDED`).
- Public slicing limiter (`RATE_LIMIT_EXCEEDED`).
- Retry-After-aware 429 responses.

3. **Proxy trust controls**
- Forwarded header trust only when `TRUST_PROXY=true` and `TRUST_PROXY_CIDRS` is configured.
- Shared normalized client IP resolution.

4. **Queue fairness and resilience**
- FIFO queue with bounded concurrency.
- Per-client queued+active cap (`MAX_SLICE_QUEUE_PER_IP`).
- Queue wait timeout and explicit queue error codes.

5. **Admin output download hardening**
- Extension allowlist (`.gcode`, `.sl1`).
- Path containment checks, non-symlink checks, and realpath containment checks.

6. **Python subprocess execution hardening**
- Centralized Python executable resolution.
- Absolute-path validation and startup fail-fast behavior.
- Shared secure subprocess execution path for converter/orientation/transform scripts.

7. **Docker supply-chain validation**
- Build-time SHA256 verification for slicer AppImages.

8. **Documentation synchronization**
- Global guides (`CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`).
- Folder-local guides (`app/CLAUDE.md`, `configs/CLAUDE.md`, `tests/testing-scripts/CLAUDE.md`).
- Instruction overlays under `.github/instructions/*`.

---

## 🧪 Test publication policy

- `tests/testing-scripts/` is intended to be public and versioned.
- `tests/testing-files/` sample payloads are intentionally excluded from repository publication.
- `tests/testing-scripts/results/` generated reports are runtime artifacts and are ignored.

---

## 📦 Release Log

Detailed version history is maintained in [`CHANGELOG.md`](CHANGELOG.md).

---

## ❤️ Sponsor Options

If this project helps your workflow, you can support ongoing development here:

- Buy Me a Coffee: https://www.buymeacoffee.com/3D.Printer.Slicer.API
- GitHub Sponsors: https://github.com/sponsors/hajdu-patrik
