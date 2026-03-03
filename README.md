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

---

## 📦 Release Log

Detailed version history is maintained in [`CHANGELOG.md`](CHANGELOG.md).
