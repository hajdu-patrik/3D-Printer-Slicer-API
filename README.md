<img width="2048" height="2048" alt="API-LOGO" src="https://github.com/user-attachments/assets/61739b97-e3ab-4335-a127-5a1370111a5a" />

![Node.js](https://img.shields.io/badge/Node.js-18.19.1-339933?style=flat&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Backend-Express_4.22.1-000000?style=flat&logo=express&logoColor=white)
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
| Direct 3D | `.stl`, `.obj`, `.3mf`, `.ply` |
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

### Admin-protected

- `POST /pricing/FDM`
- `POST /pricing/SLA`
- `PATCH /pricing/:technology/:material`
- `DELETE /pricing/:technology/:material`
- `GET /admin/output-files`

---

## 🧠 Slicing API Behavior

Both slicing endpoints accept `multipart/form-data` with required file field:

- `choosenFile`

Optional fields:

- `layerHeight`
- `material`
- `infill` (`0`-`100`)
- `depth`

### `POST /prusa/slice`

Uses `prusa-slicer`.

- Auto-selects technology by `layerHeight`:
  - `0.025`, `0.05` → `SLA`
  - `0.1`, `0.2`, `0.3` → `FDM`
- Rejects invalid `layerHeight` values outside `0.025, 0.05, 0.1, 0.2, 0.3`
- Validates material/technology compatibility

Example:

```bash
curl -X POST http://localhost:3000/prusa/slice \
  -H "Accept: application/json" \
  -F "choosenFile=@/path/to/model.stl" \
  -F "layerHeight=0.2" \
  -F "material=PLA" \
  -F "infill=20"
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

Example:

```bash
curl -X POST http://localhost:3000/orca/slice \
  -H "Accept: application/json" \
  -F "choosenFile=@/path/to/model.stl" \
  -F "layerHeight=0.2" \
  -F "material=PLA" \
  -F "infill=20"
```

### Common successful response

```json
{
  "success": true,
  "slicer_engine": "prusa",
  "technology": "FDM",
  "material": "PLA",
  "infill": "20%",
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
- `INVALID_SOURCE_ARCHIVE`
- `INVALID_SOURCE_GEOMETRY`
- `ORCA_PROFILE_INCOMPATIBLE`
- `FILE_PROCESSING_TIMEOUT`
- `SLICE_QUEUE_FULL`
- `SLICE_QUEUE_TIMEOUT`

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
  "files": [
    {
      "filename": "model_20240915_153045.gcode",
      "technology": "FDM",
      "material": "PLA",
      "layerHeight": 0.2,
      "infill": 20,
      "slicer_engine": "prusa",
      "created_at": "2024-09-15T15:30:45Z"
    },
    {
      "filename": "model_20240915_154200.sl1",
      "technology": "SLA",
      "material": "Resin_X",
      "layerHeight": 0.05,
      "slicer_engine": "orca",
      "created_at": "2024-09-15T15:42:00Z"
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

1. Create your env file from template:

```bash
cp .env.template .env
```

2. Set at least `ADMIN_API_KEY` in `.env`.

3. Start the app:
  - local: `npm start`
  - docker: `docker compose up -d --build`

4. The app now reads `.env` automatically on local startup via `dotenv`, and Docker reads it via `env_file`.

### Runtime folders used by the program

- `input/` → temporary working input directory used during conversion/slicing pipeline.
- `output/` → generated output artifacts (`.gcode`, `.sl1`, etc.).
- `configs/` → slicer profile `.ini` files + persistent `pricing.json`.

Runtime paths are root-scoped in both local and Docker execution.
No app-local runtime folders are used (`app/input`, `app/output`, `app/configs` are intentionally not used).

### Config files you can use out-of-the-box

- `configs/FDM_0.1mm.ini`
- `configs/FDM_0.2mm.ini`
- `configs/FDM_0.3mm.ini`
- `configs/SLA_0.025mm.ini`
- `configs/SLA_0.05mm.ini`

---

## ⚙️ Configuration & Limits

You can customize pricing, security, and slicing behavior without changing endpoint contracts.

- **Pricing Matrix:** Persisted in `configs/pricing.json` (managed via `/pricing` endpoints).
- **Admin Security:** `ADMIN_API_KEY` environment variable controls access to pricing updates/deletes.
- **Admin File Listing:** `GET /admin/output-files` requires `ADMIN_API_KEY` and returns generated output artifacts.
- **Fail-Fast Security:** Server startup is blocked if `ADMIN_API_KEY` is missing.
- **Request Rate Limit:** Slicing endpoints are IP-rate-limited (default `3` requests / `60s`).
- **Slicing Queue:** CPU-heavy slice jobs are queued in arrival order and processed FIFO (`MAX_CONCURRENT_SLICES`, default `1`).
- **Queue Safety Limits:** Queue length and wait timeout are bounded (`MAX_SLICE_QUEUE_LENGTH`, `MAX_SLICE_QUEUE_WAIT_MS`).
- **Upload Body Limit:** Multipart upload size is capped (`MAX_UPLOAD_BYTES`, default `500MB`).
- **ZIP Safety Limits:** ZIP extraction is guarded by max entries and max cumulative extracted size (`MAX_ZIP_ENTRIES`, `MAX_ZIP_UNCOMPRESSED_BYTES`).
- **Body Parser Limits:** JSON/form payload size is capped (`JSON_BODY_LIMIT`, `FORM_BODY_LIMIT`, default `1mb`).
- **Slicer Profiles:** Stored in `configs/*.ini` (e.g. `FDM_0.2mm.ini`, `SLA_0.05mm.ini`).
- **Timeouts:** Internal 10-minute kill-switches prevent infinite loops during complex conversion/slicing operations and return `FILE_PROCESSING_TIMEOUT` when exceeded.
- **Model Fidelity Policy:** Uploaded model/image/vector data is never auto-healed or shape-corrected; invalid/non-printable source data is rejected with a clear error.

---

## 🧪 Test publication policy

- `tests/testing-scripts/` is intended to be public and versioned.
- `tests/testing-files/` sample payloads are intentionally excluded from repository publication.
- `tests/testing-scripts/results/` generated reports are runtime artifacts and are ignored.
---

## 📦 Release Log

Detailed version history is maintained in [`CHANGELOG.md`](CHANGELOG.md).
