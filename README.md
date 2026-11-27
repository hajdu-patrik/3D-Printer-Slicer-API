# 3D Printer Slicer API (FDM & SLA)

![3D Printer Slicer API logo](https://github.com/user-attachments/assets/61739b97-e3ab-4335-a127-5a1370111a5a)

![Node.js](https://img.shields.io/badge/Node.js-24.21.0-339933?style=flat&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Backend-Express_5.2.1-000000?style=flat&logo=express&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat&logo=python&logoColor=white)
![PrusaSlicer](https://img.shields.io/badge/Slicer-PrusaSlicer_2.8.1-orange?style=flat)
![OrcaSlicer](https://img.shields.io/badge/Slicer-OrcaSlicer_2.3.1-8A2BE2?style=flat)
![Docker](https://img.shields.io/badge/Container-Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Ubuntu Next](https://img.shields.io/badge/Next-Ubuntu_24.04-E95420?style=flat&logo=ubuntu&logoColor=white)
![API](https://img.shields.io/badge/API-Prusa%2FOrca_Endpoints-success?style=flat)
![License](https://img.shields.io/badge/License-Proprietary-red?style=flat)

An automated 3D slicing and pricing API built with `Node.js` and `Python` that converts supported 3D model and CAD inputs into printable outputs with validated pricing.

Built for zero-downtime rollout, this API now supports two slicer engines through separate public endpoints.

---

## ✨ Core Features

- 🔄 **Model-focused input processing:** direct 3D, CAD, and ZIP uploads with exactly one supported model source file.
- ⚖️ **Auto-orientation:** overhang-aware Python orientation optimization before slicing (`autoOrient`, default `true`).
- 🧮 **Pricing engine:** hourly rate + material cost + setup fee + quantity, with a `price_breakdown` in every response.
- ⏱️ **Slicer-accurate stats:** print time and material usage are read from G-code / SL1 metadata (`print_time_source`), heuristic only as fallback.
- 🗂️ **Result cache:** identical requests are served from an in-memory cache (`cache_hit`), price recomputed.
- 🔁 **Async jobs:** submit with `POST /prusa/slice/jobs` / `POST /orca/slice/jobs`, poll `GET /slice/jobs/:jobId`.
- 🚦 **Queue + rate protection:** bounded queue and endpoint rate limiting for CPU-heavy requests.
- 🧨 **ZIP safety checks:** entry/size/path validation and encrypted ZIP rejection.
- 🧵 **Dual slicer routing:** Prusa and Orca engines behind dedicated endpoints.

---

## 📂 Supported File Formats

| Category | Extensions |
| --- | --- |
| Direct 3D | `.stl`, `.obj`, `.3mf` |
| NURBS / CAD | `.stp`, `.step`, `.igs`, `.iges`, `.ply` |
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
- `POST /prusa/slice/jobs`
- `POST /orca/slice/jobs`
- `GET /slice/jobs/:jobId`
- `GET /openapi.json`
- `GET /docs`
- `GET /`

### Admin-protected

- `GET /health/detailed`
- `GET /metrics` (Prometheus text format)
- `POST /pricing/FDM`
- `POST /pricing/SLA`
- `PUT /pricing/:technology/setup-fee`
- `PATCH /pricing/:technology/:material`
- `DELETE /pricing/:technology/:material`
- `GET /admin/output-files`
- `GET /admin/download/:fileName`

---

## 📂 Application Module Map (app/*.js)

### Bootstrap

- `app/server.js` - Express bootstrap, startup guards, helmet/cors, request-id propagation, docs mounting, routes, and global error handling.

### Configuration

- `app/config/constants.js` - runtime defaults, layer presets, limits, and extension groups.
- `app/config/paths.js` - root-scoped runtime path resolution (`input/`, `output/`, `configs/`) and directory creation.
- `app/config/python.js` - secure Python executable resolver (`PYTHON_EXECUTABLE` + `VIRTUAL_ENV` fallbacks).

### Middleware

- `app/middleware/rateLimit.js` - in-memory IP throttling for slice and admin routes (`Retry-After` aware responses).
- `app/middleware/queuePrecheck.js` - advisory queue capacity check before the upload body is accepted (`SLICE_QUEUE_FULL` / `SLICE_QUEUE_CLIENT_LIMIT`).
- `app/middleware/upload.js` - shared multer single-file upload (`choosenFile`, extension whitelist, size limit).
- `app/middleware/requireAdmin.js` - timing-safe x-api-key guard + unauthorized attempt logging.
- `app/middleware/errorHandler.js` - centralized request/upload/parser error normalization.

### Routes

- `app/routes/slice.routes.js` - `POST /prusa/slice`, `POST /orca/slice` with rate-limit, queue pre-check and single-file upload middleware.
- `app/routes/jobs.routes.js` - async `POST /prusa/slice/jobs`, `POST /orca/slice/jobs`, `GET /slice/jobs/:jobId`.
- `app/routes/pricing.routes.js` - public pricing read + admin pricing mutations.
- `app/routes/system.routes.js` - health endpoints and admin artifact listing/download endpoints.

### Services

- `app/services/pricing.service.js` - pricing load/save/migration/lookup logic.
- `app/services/pricing/catalog.js` - in-memory pricing catalog: normalization, material lookup, and rate calculation.
- `app/services/pricing/normalize.js` - validation/normalization of the optional `materialCost` and `setupFee` sections.
- `app/services/pricing/repository.js` - file-system pricing repository with primary/legacy pricing file resolution.
- `app/services/admin-output.service.js` - validated admin output listing/download helpers and `ALL` ZIP bulk limit checks.
- `app/services/slice.service.js` - end-to-end slicing orchestrator, result-cache lookup and queue error mapping.
- `app/services/jobs/job-store.js`, `app/services/jobs/slice-jobs.service.js` - in-memory async job store and submit/status handlers.
- `app/services/metrics.service.js` - Prometheus text-format metrics.
- `app/services/output-retention.service.js` - periodic cleanup of old outputs and stale upload temp files.
- `app/services/slice/command.js` - subprocess execution via `execFile` with timeout and optional debug logs.
- `app/services/slice/common.js` - output naming, isolated Orca output dirs, cleanup utilities.
- `app/services/slice/engine.js` - slicer argument construction (Prusa vs Orca).
- `app/services/slice/errors.js` - error classification and API error responses.
- `app/services/slice/gcode-metadata.js` - G-code head/tail (256 KB) print-time and material metadata parsing.
- `app/services/slice/input-processing.js` - conversion and `preprocess.py` preprocessing pipeline.
- `app/services/slice/model-stats.js` - metadata/stat parsing from slicer outputs.
- `app/services/slice/number-utils.js` - shared numeric parser helpers.
- `app/services/slice/options.js` - strict request option validation/parsing.
- `app/services/slice/profiles.js` - profile selection, runtime profile generation, build-volume limits.
- `app/services/slice/queue.js` - FIFO queue + per-client fairness + timeout enforcement.
- `app/services/slice/response.js` - successful slice response composition and price calculation strategies.
- `app/services/slice/result-cache.js` - in-memory LRU/TTL slice result cache.
- `app/services/slice/sla-stats.js` - SL1 `config.ini` print-time/material parsing.
- `app/services/slice/transform.js` - transform planning/execution and bounds validation.
- `app/services/slice/value-parsers.js` - safe parsing and profile filename sanitization.
- `app/services/slice/zip.js` - ZIP safety inspection and safe extraction.

### Utilities and API docs

- `app/utils/client-ip.js` - trust-proxy-aware client IP normalization.
- `app/utils/env.js` - environment integer parsing helpers.
- `app/utils/logger.js` - structured processing error logging.
- `app/docs/swagger-docs.js` - OpenAPI generation for `/docs` and `/openapi.json`.

### Python helpers

- `app/preprocess.py` - `preprocess` / `transform` / `preview` modes; prints `@@RESULT@@{json}` with geometry metrics (no model healing). At most 2 Python spawns per request, plus one for `preview` when `includePreview=true`.
- `app/preview_render.py` - isometric PNG preview renderer (Pillow, painter's algorithm, vertex-clustering LOD for dense meshes; no OpenGL needed).
- `app/orient.py` - overhang-aware orientation candidate scoring.
- `app/cad2stl.py` - STEP/IGES to STL with curvature-adaptive meshing (OCC healing options off).
- `app/mesh2stl.py`, `app/scale_model.py` - mesh normalization and scale/rotation.

---

## 🧠 Slicing API Behavior

Both slicing endpoints accept `multipart/form-data` with required file field:

- `choosenFile`

Optional fields:

- `layerHeight`
- `material`
- `infill` (`0`-`100`)
- `sizeUnit` (`mm` or `inch`)
- `keepProportions` (`true`/`false`, default `true`)
- `targetSizeX`, `targetSizeY`, `targetSizeZ` (target dimensions in selected unit)
- `scalePercent` (uniform scale; cannot be combined with `targetSizeX/Y/Z`)
- `rotationX`, `rotationY`, `rotationZ` (degrees)
- `autoOrient` (`true`/`false`, default `true`; invalid value returns `INVALID_AUTO_ORIENT`)
- `quantity` (integer `1`-`1000`, default `1`; invalid value returns `INVALID_QUANTITY`; affects price only)
- `includePreview` (`true`/`false`, default `false`; adds a 512×512 isometric PNG preview as base64 in `preview`; invalid value returns `INVALID_INCLUDE_PREVIEW`)
- `printerProfile` (profile override filename)
- `processProfile` (Orca only process profile override filename)

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
  - Original Prusa MK4 (Input Shaper, 0.4 mm): `MK4_FDM_0.1mm.ini`, `MK4_FDM_0.2mm.ini`, `MK4_FDM_0.3mm.ini` (250×210×220 mm). Pick the file that matches `layerHeight`; MK4-specific material overlays `configs/prusa/materials/MK4_FDM_<MAT>.ini` are used automatically.
- `--center` is derived from the profile `bed_shape`; material overlays from `configs/prusa/materials/` are merged into the runtime profile (unknown material falls back to the base profile)

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
- Runs with `--arrange 1 --orient 0` (orientation is done once by `orient.py`), loads the material filament preset `configs/orca/materials/FDM_<MAT>.json` via `--load-filaments`, and uses a machine+process profile pair
  - Machine profile file is resolved from `.env` via `ORCA_MACHINE_PROFILE` (default: `Bambu_P1S_0.4_nozzle.json`)
- Process profile file is selected by `layerHeight` (`0.1/0.2/0.3`) and can be overridden via `.env`:
  - `ORCA_PROCESS_PROFILE_0_1`
  - `ORCA_PROCESS_PROFILE_0_2`
  - `ORCA_PROCESS_PROFILE_0_3`
- Request-level profile overrides are supported:
  - `printerProfile` → machine profile from `configs/orca`: `Bambu_P1S_0.4_nozzle.json` (default, 256³ mm), `Bambu_A1_0.4_nozzle.json` (256³ mm), `Bambu_A1_mini_0.4_nozzle.json` (180³ mm). The default process profiles are compatible with all three.
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

### Async jobs

`POST /prusa/slice/jobs` and `POST /orca/slice/jobs` accept the same multipart fields as the synchronous endpoints and return `202`:

```json
{ "success": true, "jobId": "<uuid>", "status": "queued", "statusUrl": "/slice/jobs/<uuid>" }
```

`GET /slice/jobs/:jobId` returns `status` = `queued`, `processing`, `done` (with `result`, the same body as the synchronous response) or `failed` (with `error: { status, body }`). Polling is limited to 60 requests / 60 s per IP. Errors: `INVALID_JOB_ID` (400), `JOB_NOT_FOUND` (404), `JOB_STORE_FULL` (503), `JOB_POLL_RATE_LIMIT_EXCEEDED` (429). Finished jobs are kept for `JOB_RESULT_TTL_MS`.

### Result cache

Cache key: SHA-256 of the file bytes + engine + all slicing options except `quantity` + profile/material file mtime and size. A hit returns `"cache_hit": true`, recomputes the price from current pricing and creates no new output file. Set `SLICE_RESULT_CACHE_TTL_MS=0` to disable.

### Common successful response

```json
{
  "success": true,
  "cache_hit": false,
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
  "model_geometry": {
    "volume_cm3": 13.6,
    "surface_area_cm2": 54.8,
    "is_watertight": true,
    "triangle_count": 24
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
      "z": 256
    },
    "source_profile": "FDM_0.2mm.ini"
  },
  "hourly_rate": 800,
  "quantity": 1,
  "price_breakdown": {
    "time_cost_huf": 1200,
    "material_cost_huf": 120,
    "setup_fee_huf": 0,
    "per_piece_huf": 1320,
    "quantity": 1,
    "total_huf": 1320,
    "material_unit": "g",
    "material_cost_per_unit": 12
  },
  "stats": {
    "print_time_seconds": 5400,
    "print_time_readable": "1h 30m",
    "print_time_source": "slicer",
    "material_used_m": 12.45,
    "material_used_g": 10,
    "material_used_ml": 0,
    "object_height_mm": 45.2,
    "estimated_price_huf": 1320
  }
}
```

Notes:

- `print_time_source` is `slicer` when time comes from slicer output (SLA: `.sl1` `config.ini`; FDM: seconds-accurate G-code comments preferred over `M73`) and `estimate` when the heuristic fallback was used.
- `material_used_g` is used for FDM pricing, `material_used_ml` for SLA pricing.
- `model_geometry` describes the final (oriented and transformed) model: solid volume (`null` when the mesh is not watertight), surface area and triangle count. The printed material mass, including infill and supports, is `stats.material_used_g`.
- With `includePreview=true` the response also contains `preview: { "format": "png", "width": 512, "height": 512, "data_base64": "..." }`, an isometric render of the model exactly as it is sliced. A preview rendering failure never fails the slice; the field is then omitted.

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
- `INVALID_SIZE_OPTIONS`
- `INVALID_ROTATION_OPTIONS`
- `INVALID_AUTO_ORIENT`
- `INVALID_QUANTITY`
- `INVALID_JOB_ID`
- `JOB_NOT_FOUND`
- `JOB_STORE_FULL`
- `JOB_POLL_RATE_LIMIT_EXCEEDED`
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
- Queue capacity (`SLICE_QUEUE_FULL`, `SLICE_QUEUE_CLIENT_LIMIT`) is pre-checked before the upload body is accepted.

---

## 💰 Pricing API

### `GET /pricing`

Returns the full pricing object: hourly rates per material plus the optional `materialCost` (HUF/g for FDM, HUF/ml for SLA) and `setupFee` (flat HUF per order) sections.

Price formula (HUF):

```
total = ceil((setupFee + quantity * (max(hours, 0.25) * hourlyRate + materialAmount * materialCostPerUnit)) / 10) * 10
```

`materialAmount` is grams for FDM and millilitres for SLA.

### `POST /pricing/FDM` / `POST /pricing/SLA` (admin)

Create new material for selected technology.

```json
{
  "material": "ASA",
  "price": 1200,
  "materialCostPerUnit": 14
}
```

`materialCostPerUnit` is optional.

### `PATCH /pricing/:technology/:material` (admin)

Update an existing material's hourly price and/or material cost. `price` is optional when `materialCostPerUnit` is supplied.

```json
{
  "price": 950,
  "materialCostPerUnit": 13
}
```

### `PUT /pricing/:technology/setup-fee` (admin)

Set the flat per-order setup fee for `FDM` or `SLA`.

```json
{
  "setupFee": 500
}
```

### `DELETE /pricing/:technology/:material` (admin)

Delete existing material from selected technology.

---

## 🛠️ Admin Endpoint

### `GET /metrics` (admin)

Prometheus text-format metrics (slice outcomes, queue rejections, job states, cache size).

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

### `GET /admin/download/:fileName` (admin)

Downloads a generated `.gcode` / `.sl1` artifact by file name.

Special token support:

- `ALL` -> returns an `application/zip` stream that contains every currently valid output artifact.

Bulk `ALL` downloads are validated before streaming and return HTTP `413` with `BULK_DOWNLOAD_LIMIT_EXCEEDED` if the current output set exceeds `MAX_ZIP_ENTRIES` or `MAX_ZIP_UNCOMPRESSED_BYTES`.

Examples:

```bash
curl -L -H "x-api-key: <ADMIN_API_KEY>" \
  http://localhost:3000/admin/download/Cover-output-1777587775846.sl1 \
  -o Cover-output-1777587775846.sl1
```

```bash
curl -L -H "x-api-key: <ADMIN_API_KEY>" \
  http://localhost:3000/admin/download/ALL \
  -o output-files.zip
```

Common slicing error responses:

- `INVALID_SOURCE_ARCHIVE` → uploaded ZIP is invalid or does not contain a supported file.
- `INVALID_SOURCE_GEOMETRY` → uploaded source geometry is invalid/non-printable and auto-repair is disabled.
- `FILE_PROCESSING_TIMEOUT` (HTTP `422`) → processing exceeded 10 minutes for the uploaded file.

---

## ⚙️ Learn how to set up the `.env`, configs, input/output

### 1. Create your env file from template

```bash
cp .env.example .env
```

### 2. Create your pricing configuration file from the template

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
  },
  "materialCost": {
    "FDM": { "PLA": 12, "ABS": 12, "PETG": 14, "TPU": 18 },
    "SLA": { "Standard": 45, "ABS-Like": 45, "Flexible": 60 }
  },
  "setupFee": {
    "FDM": 500,
    "SLA": 1000
  }
}
```

`materialCost` and `setupFee` are optional; files without them keep working (cost and fee `0`).

### 3. Set at least `ADMIN_API_KEY` in `.env`

### 4. Start the app

- local: `npm start`
- docker: `docker compose up -d --build`

### 5. Runtime environment loading

The app reads `.env` automatically on local startup via `dotenv`, and Docker reads it via `env_file`.

### Runtime folders used by the program

- `input/` → temporary working input directory used during conversion/slicing pipeline.
- `output/` → generated output artifacts (`.gcode`, `.sl1`, etc.).
- `configs/` → slicer profiles (`prusa/*.ini`, `orca/*.json`), material overlays (`prusa/materials/`, `orca/materials/`) + persistent `pricing.json`.

Runtime paths are root-scoped in both local and Docker execution.
No app-local runtime folders are used (`app/input`, `app/output`, `app/configs` are intentionally not used).

### Config files you can use out-of-the-box

- Prusa process/printer profiles (`.ini`):
  - `configs/prusa/FDM_0.1mm.ini`
  - `configs/prusa/FDM_0.2mm.ini`
  - `configs/prusa/FDM_0.3mm.ini`
  - `configs/prusa/SLA_0.025mm.ini`
  - `configs/prusa/SLA_0.05mm.ini`
  - `configs/prusa/MK4_FDM_0.1mm.ini`, `MK4_FDM_0.2mm.ini`, `MK4_FDM_0.3mm.ini` (Original Prusa MK4)
  - `configs/prusa/materials/FDM_<MAT>.ini`, `SLA_<MAT>_<layer>mm.ini` (material overlays)
  - `configs/prusa/materials/MK4_FDM_<MAT>.ini` (MK4-specific material overlays)
- Orca machine/process profiles (`.json`):
  - `configs/orca/Bambu_P1S_0.4_nozzle.json`
  - `configs/orca/Bambu_A1_0.4_nozzle.json`, `configs/orca/Bambu_A1_mini_0.4_nozzle.json`
  - `configs/orca/FDM_0.1mm.json`
  - `configs/orca/FDM_0.2mm.json`
  - `configs/orca/FDM_0.3mm.json`
  - `configs/orca/materials/FDM_<MAT>.json` (filament presets)

Material overlay values are taken from the official slicer presets bundled with the pinned slicer versions: PrusaSlicer 2.8.1 `Generic PLA/PETG/ABS/FLEX` filaments and the SL1S `Prusament Resin Tough` / `Flex80` resins, and OrcaSlicer 2.3.1 BBL `Generic PLA/PETG/ABS/TPU`. Each Prusa overlay names its source preset in its header comment.

Printer profiles are generated from the official presets of the same slicer versions:

- MK4 profiles: printer `Original Prusa MK4 Input Shaper 0.4 nozzle`, print presets `0.10mm FAST DETAIL @MK4IS 0.4` / `0.20mm SPEED @MK4IS 0.4` / `0.30mm DRAFT @MK4 0.4` (no MK4IS 0.30 preset exists), filament overlays from `Generic PLA|PETG @PGIS` and `Generic ABS|FLEX @MK4`. For headless use `binary_gcode` is `0` and thumbnails are disabled.
- A1 / A1 mini: Orca BBL `Bambu Lab A1 0.4 nozzle` / `Bambu Lab A1 mini 0.4 nozzle`, with `time_lapse_gcode` and `change_filament_gcode` removed. Those Bambu blocks reset E (`G92 E0`) every layer, which corrupts the absolute-E G-code Orca writes for local presets.

You can add your own profiles (for example 2 FDM + 2 SLA for Prusa, or multiple Orca machine profiles), then select them per request with `printerProfile` (and `processProfile` for Orca).

Different printer/process profiles produce different G-code behavior in practice (speed, accelerations, cooling, supports, extrusion strategy), even for the same model.

---

## ⚙️ Configuration & Limits

You can customize pricing, security, and slicing behavior without changing endpoint contracts.

- **Pricing Matrix:** Persisted in `configs/pricing.json` (managed via `/pricing` endpoints), including optional `materialCost` and `setupFee` sections.
- **Admin Security:** `ADMIN_API_KEY` environment variable controls access to pricing updates/deletes.
- **Admin Browser CORS Control:** `/admin/*` browser-origin requests are constrained by `ADMIN_CORS_ALLOWED_ORIGINS`.
- **Admin File Listing:** `GET /admin/output-files` requires `ADMIN_API_KEY` and returns generated output artifacts.
- **Admin File Download:** `GET /admin/download/:fileName` requires `ADMIN_API_KEY`, allows downloading a single `.gcode` / `.sl1` artifact, and supports `ALL` for ZIP download of all valid output files within configured ZIP limits.
- **Fail-Fast Security:** Server startup is blocked if `ADMIN_API_KEY` is missing.
- **Security Logging:** Admin auth failures log client IP with forwarded-header-aware parsing (requires `TRUST_PROXY=true` behind proxy).
- **Timing-Safe Auth:** Admin API key comparison uses constant-time comparison to prevent timing side-channel attacks.
- **Upload Validation:** Multer accepts only a single file on the `choosenFile` field with file extension validation at upload time.
- **Request Rate Limit:** Slicing endpoints are IP-rate-limited (default `3` requests / `60s`). Expired rate-limit buckets are automatically pruned.
- **Admin Rate Limit:** Admin endpoints are IP-rate-limited (default `30` requests / `60s`) to reduce brute-force API-key attempts.
- **Proxy Trust:** Set `TRUST_PROXY=true` only behind a reverse proxy and configure `TRUST_PROXY_CIDRS` to trusted proxy CIDRs/names; forwarded headers are ignored otherwise.
- **Async Jobs:** `JOB_RESULT_TTL_MS` (default 1 h), `JOB_MAX_ENTRIES` (1000), `JOB_POLL_RATE_LIMIT_WINDOW_MS` / `JOB_POLL_RATE_LIMIT_MAX_REQUESTS` (60 per 60 s per IP).
- **Result Cache:** `SLICE_RESULT_CACHE_TTL_MS` (default 24 h, `0` disables) and `SLICE_RESULT_CACHE_MAX_ENTRIES` (500).
- **Retention:** `OUTPUT_RETENTION_HOURS` (default 168), `UPLOAD_TEMP_RETENTION_MINUTES` (60) and `OUTPUT_CLEANUP_INTERVAL_MS` (1 h) control periodic cleanup of `output/` and stale upload temp files in `input/`.
- **Slicing Queue:** CPU-heavy slice jobs are queued in arrival order and processed FIFO (`MAX_CONCURRENT_SLICES`, default `1`).
- **Queue Fairness:** Per-client queue ownership is bounded (`MAX_SLICE_QUEUE_PER_IP`) so one client cannot monopolize all pending capacity.
- **Queue Safety Limits:** Queue length and wait timeout are bounded (`MAX_SLICE_QUEUE_LENGTH`, `MAX_SLICE_QUEUE_WAIT_MS`).
- **Upload Body Limit:** Multipart upload size is capped (`MAX_UPLOAD_BYTES`, default `500MB`).
- **ZIP Safety Limits:** ZIP upload inspection and admin `ALL` bulk export are guarded by max entries (`MAX_ZIP_ENTRIES`, default `500`) and max cumulative size (`MAX_ZIP_UNCOMPRESSED_BYTES`, default `500MB`).
- **ZIP Content Rule:** ZIP uploads must contain exactly one supported source file; unsupported or suspicious ZIP contents are rejected and cleaned up.
- **Body Parser Limits:** JSON/form payload size is capped (`JSON_BODY_LIMIT`, `FORM_BODY_LIMIT`, default `1mb`).
- **Slicer Profiles:** Stored in `configs/prusa/*.ini` and `configs/orca/*.json`.
- **Timeouts:** Internal 10-minute kill-switches prevent infinite loops during complex conversion/slicing operations and return `FILE_PROCESSING_TIMEOUT` when exceeded.
- **Model Fidelity Policy:** Uploaded model data is never auto-healed or shape-corrected; invalid/non-printable source data is rejected with a clear error. Orientation (`autoOrient`) only rotates the model.
- **Supply-Chain Integrity:** Docker build pins and verifies SHA256 checksums for downloaded PrusaSlicer and OrcaSlicer AppImages.
- **Python Resolver Security:** `PYTHON_EXECUTABLE` must be absolute and existing when set; fallback resolution uses `VIRTUAL_ENV` and known absolute runtime paths.
- **Command Debugging:** `DEBUG_COMMAND_LOGS=true` enables verbose converter/slicer stdout/stderr logging.

---

## 📝 Security & Runtime Change Snapshot (2026-04-21)

This repository currently includes the following synchronized changes across implementation and docs:

- **Admin security hardening:** mandatory startup guard for `ADMIN_API_KEY`, timing-safe API key verification, and request-id-aware unauthorized logging.
- **Rate-limit controls:** dedicated admin limiter (`ADMIN_RATE_LIMIT_EXCEEDED`), public slicing limiter (`RATE_LIMIT_EXCEEDED`), and Retry-After-aware 429 responses.
- **Proxy trust controls:** forwarded header trust only when `TRUST_PROXY=true` and `TRUST_PROXY_CIDRS` is configured, with shared normalized client IP resolution.
- **Queue fairness and resilience:** FIFO queue with bounded concurrency, per-client queued+active cap (`MAX_SLICE_QUEUE_PER_IP`), queue wait timeout, and explicit queue error codes.
- **Admin output download hardening:** extension allowlist (`.gcode`, `.sl1`), `ALL` ZIP bulk download support, path/symlink/realpath checks, and pre-stream bulk ZIP resource limits.
- **Python subprocess execution hardening:** centralized Python executable resolution, absolute-path validation, startup fail-fast behavior, and secure converter/orientation/transform subprocess execution.
- **Docker supply-chain validation:** build-time SHA256 verification for slicer AppImages.
- **Documentation synchronization:** global Claude guides (`CLAUDE.md`, `.claude/CLAUDE.md`) and folder-local guides under `app/`, `configs/`, and `tests/testing-scripts/`.

---

## 🧪 Tests

- Fast unit suite: `npm test` (Node `node --test`, `tests/unit/*.test.js`), also run in CI.
- Integration runners: see [`tests/README.md`](tests/README.md). Repeated identical slice requests return `cache_hit: true` unless `SLICE_RESULT_CACHE_TTL_MS=0`.

## 🧪 Test publication policy

- `tests/testing-scripts/` is intended to be public and versioned.
- `tests/testing-files/` sample payloads are intentionally excluded from repository publication.
- `tests/testing-scripts/results/` generated reports are runtime artifacts and are ignored.

---

## 📦 Release Log

Detailed version history is maintained in [`CHANGELOG.md`](CHANGELOG.md).

---

## 📄 License

Copyright (c) Hajdú Patrik Zsolt. All rights reserved.

Proprietary, commissioned work published for demonstration and portfolio purposes only. No rights to use, copy, modify or distribute it are granted. See [LICENSE.md](LICENSE.md) for the full terms.
