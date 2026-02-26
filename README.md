<img width="2048" height="2048" alt="API-LOGO" src="https://github.com/user-attachments/assets/61739b97-e3ab-4335-a127-5a1370111a5a" />

![Node.js](https://img.shields.io/badge/Node.js-18.19.1-339933?style=flat&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Backend-Express_4.22.1-000000?style=flat&logo=express&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12.3-3776AB?style=flat&logo=python&logoColor=white)
![PrusaSlicer](https://img.shields.io/badge/Slicer-PrusaSlicer_2.8.1-orange?style=flat)
![Docker](https://img.shields.io/badge/Container-Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Swagger](https://img.shields.io/badge/API_Docs-swagger--ui--express_5.0.1-85EA2D?style=flat&logo=swagger&logoColor=black)
![Deployment](https://img.shields.io/badge/Deployment-VPS_24%2F7-4CAF50?style=flat&logo=linux&logoColor=white)
![Status](https://img.shields.io/badge/Status-Live_Production-success?style=flat)


# 3D Printer Slicer API (FDM & SLA)

An automated 3D slicing and pricing API built with `Node.js` and `Python` that seamlessly converts various 2D and 3D file formats into ready-to-print models using the PrusaSlicer engine. It provides automated part orientation, intelligent slicing, and dynamic cost estimation for both **FDM** and **SLA** printing technologies.

Built for **Zero-Downtime deployment**, this API is designed to serve as the backend engine for **automated 3D printing hubs**, quoting systems, and e-commerce manufacturing platforms.

---

## ✨ Enterprise-Grade Features
- 🔄 **Universal File Conversion:** Automatically handles standard 3D meshes, CAD assemblies, vector graphics (extruding 2D to 3D), and image lithophanes.

- ⚖️ **Algorithmic Auto-Orientation:** Utilizes Python-based physical simulations (`Trimesh` & `Gmsh`) to calculate the most stable printing pose, minimizing Z-height and print time.

- 💰 **Dynamic Pricing Engine:** Extracts exact material usage and estimated print times from G-code/SL1 files to generate precise cost estimations based on customizable hourly rates.

- 🛡️ **Robust Pre-Flight Checks:** Validates request structure and processing constraints before CPU-intensive slicing starts.

- 🚦 **Abuse Protection:** Per-IP rate limiting and bounded in-memory slicing queue protect CPU/RAM from request floods.

- 🧨 **ZIP Bomb Guard:** ZIP uploads are validated before extraction (entry-count, uncompressed-size, path traversal, encrypted ZIP rejection).

- 📦 **Automated Resource Management:** Self-cleaning infrastructure with ZIP archive extraction and scheduled `.gcode` / `.sl1` file purging.

---

## 📂 Supported File Formats

The API accepts single files or `.zip` archives containing any of the following formats:

| Category        | Extensions                          | Processing Method |
|----------------|--------------------------------------|-------------------|
| **Direct 3D**  | `.stl`, `.obj`, `.3mf`               | Scene merging & manifold validation. |
| **NURBS / CAD**| `.stp`, `.step`, `.igs`, `.iges`     | Converted via Gmsh and meshed as-is (invalid geometry is rejected). |
| **Vector**     | `.dxf`, `.svg`, `.eps`, `.pdf`       | Polygon extraction and parameterized Z-extrusion (open/invalid geometry is rejected, no auto-fix). |
| **Image**      | `.jpg`, `.jpeg`, `.png`, `.bmp`      | Grayscale heightmap generation (Lithophane style); invalid/non-image source files are rejected (no auto-fix). |

---

## 🧠 Learn how to use the API

Pricing is now **persistent** and loaded from `configs/pricing.json` at startup.

If `configs/pricing.json` does not exist, the API auto-creates it with default FDM/SLA pricing.

All API examples and payloads below are production-compatible with the current backend behavior.

### Pricing Management Endpoint (Public)

- `GET /pricing`
  - Returns full pricing object.

### Pricing Management Endpoints (Admin-Protected)

> Material identifiers are matched case-insensitively (`PLA`, `pla`, `pLa` are treated as the same material key).

#### `POST /pricing/FDM`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Body: `{ "material": "ASA", "price": 1200 }`
  - Creates a new FDM material.

#### `POST /pricing/SLA`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Body: `{ "material": "High-Temp", "price": 2600 }`
  - Creates a new SLA material.

#### `PATCH /pricing/FDM/:material`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Body: `{ "price": 950 }`
  - Updates an existing FDM material price.
  - Returns `400` if the material does not exist.

#### `PATCH /pricing/SLA/:material`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Body: `{ "price": 1800 }`
  - Updates an existing SLA material price.
  - Returns `400` if the material does not exist.

#### `DELETE /pricing/FDM/:material`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Deletes FDM material pricing entry.

#### `DELETE /pricing/SLA/:material`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Deletes SLA material pricing entry.


### Slicing Endpoints (Public)

#### `POST /slice/FDM`
Generate an FDM slicing profile and price estimate by uploading one supported input file (`direct`, `CAD`, `vector`, `image`, or `.zip`).

```bash
curl -X POST http://localhost:3000/slice/FDM \
  -H "Accept: application/json" \
  -F "choosenFile=@/path/to/your/model.stl" \
  -F "layerHeight=0.2" \
  -F "material=PLA" \
  -F "infill=20"
```

**JSON Response:**

```json
{
  "success": true,
  "technology": "FDM",
  "material": "PETG",
  "infill": "20%",
  "hourly_rate": 900,
  "stats": {
    "print_time_seconds": 5400,
    "print_time_readable": "1h 30m",
    "material_used_m": 12.45,
    "object_height_mm": 45.2,
    "estimated_price_huf": 1350
  }
}
```

#### `POST /slice/SLA`
Generate an SLA slicing profile and price estimate by uploading one supported input file.

```bash
curl -X POST http://localhost:3000/slice/SLA \
  -H "Accept: application/json" \
  -F "choosenFile=@/path/to/your/model.stl" \
  -F "layerHeight=0.05" \
  -F "material=Standard"
```

**JSON Response:**

```json
{
  "success": true,
  "technology": "SLA",
  "material": "Standard",
  "infill": "20%",
  "hourly_rate": 1800,
  "stats": {
    "print_time_seconds": 1990,
    "print_time_readable": "0h 33m (Est.)",
    "material_used_m": 0,
    "object_height_mm": 8.5,
    "estimated_price_huf": 1000
  }
}
```

### Admin Operational Endpoints (Protected)

#### `GET /admin/output-files`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Lists generated artifacts currently present under the `output/` directory.

**JSON Response:**

```json
{
  "success": true,
  "total": 2,
  "files": [
    {
      "fileName": "Cactus-output-1772126605107.gcode",
      "sizeBytes": 409600,
      "createdAt": "2026-02-24T15:10:00.000Z",
      "modifiedAt": "2026-02-24T15:10:01.000Z"
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
- `configs/pricing.json` (auto-created with defaults if missing)

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

Detailed version history and retroactive tag notes are maintained in [`CHANGELOG.md`](https://github.com/hajdu-patrik/3D-Printer-Slicer-API/blob/main/CHANGELOG.md).
