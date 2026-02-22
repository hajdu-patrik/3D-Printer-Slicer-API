<img width="2048" height="2048" alt="API-LOGO" src="https://github.com/user-attachments/assets/61739b97-e3ab-4335-a127-5a1370111a5a" />

![Node.js](https://img.shields.io/badge/Node.js-18.19.1-339933?style=flat&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Backend-Express_4.22.1-000000?style=flat&logo=express&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12.3-3776AB?style=flat&logo=python&logoColor=white)
![PrusaSlicer](https://img.shields.io/badge/Slicer-PrusaSlicer_2.8.1-orange?style=flat)
![Docker](https://img.shields.io/badge/Container-Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Swagger](https://img.shields.io/badge/API_Docs-swagger--ui--express_5.0.1-85EA2D?style=flat&logo=swagger&logoColor=black)
![Deployment](https://img.shields.io/badge/Deployment-VPS_24%2F7-4CAF50?style=flat&logo=linux&logoColor=white)
![Status](https://img.shields.io/badge/Status-Live_Production-success?style=flat)


# 3D Printer Slicer & Pricing API (FDM & SLA)

An automated 3D slicing and pricing API built with `Node.js` and `Python` that seamlessly converts various 2D and 3D file formats into ready-to-print models using the PrusaSlicer engine. It provides automated part orientation, intelligent slicing, and dynamic cost estimation for both **FDM** and **SLA** printing technologies.

Built for **Zero-Downtime deployment**, this API is designed to serve as the backend engine for **automated 3D printing hubs**, quoting systems, and e-commerce manufacturing platforms.

---

## ✨ Enterprise-Grade Features
- 🔄 **Universal File Conversion:** Automatically handles standard 3D meshes, CAD assemblies, vector graphics (extruding 2D to 3D), and image lithophanes.

- ⚖️ **Algorithmic Auto-Orientation:** Utilizes Python-based physical simulations (`Trimesh` & `Gmsh`) to calculate the most stable printing pose, minimizing Z-height and print time.

- 💰 **Dynamic Pricing Engine:** Extracts exact material usage and estimated print times from G-code/SL1 files to generate precise cost estimations based on customizable hourly rates.

- 🛡️ **Robust Pre-Flight Checks:** Prevents server crashes by validating physical dimensions against maximum build volumes before initiating CPU-intensive slicing.

- 🚦 **Abuse Protection:** Per-IP rate limiting and bounded in-memory slicing queue protect CPU/RAM from request floods.

- 🧨 **ZIP Bomb Guard:** ZIP uploads are validated before extraction (entry-count, uncompressed-size, path traversal, encrypted ZIP rejection).

- 📦 **Automated Resource Management:** Self-cleaning infrastructure with ZIP archive extraction and scheduled `.gcode` / `.sl1` file purging.

---

## 🏗️ Architecture & Component Breakdown

The solution follows a modular, containerized architecture ensuring high availability and fault tolerance during heavy CAD operations.

### Component / Role / Description

| Component          | Role               | Description |
|-------------------|--------------------|-------------|
| **server.js**     | Bootstrap Layer    | Minimal Express startup file that wires middleware, Swagger, routes, and startup initialization. |
| **routes/**       | HTTP Routing Layer | Endpoint separation by concern (`slice.routes.js`, `pricing.routes.js`, `system.routes.js`). |
| **services/**     | Business Logic     | Slicing pipeline and dynamic pricing persistence (`slice.service.js`, `pricing.service.js`). |
| **middleware/**   | Security Layer     | API-key authorization middleware for admin-only pricing mutations. |
| **docs/**         | API Schema         | Centralized OpenAPI document (`swagger-docs.js`) served by Swagger UI. |
| **config/**       | Runtime Config     | Shared constants and filesystem paths used across modules. |
| **Python Converters** | Geometry Processors | Specialized scripts (`cad2stl.py`, `vector2stl.py`, etc.) powered by Gmsh and Shapely with strict model-fidelity mode (no automatic geometry repair). |
| **PrusaSlicer CLI** | The Slicing Engine | Headless execution of PrusaSlicer for toolpath generation, support creation, and rasterization. |
| **Docker (node:20-bookworm-slim)** | The Sandbox        | An isolated, dependency-rich runtime containing PrusaSlicer, Node.js, Python, and geometry conversion libraries. |


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

## 🚀 Getting Started

### **1. Prerequisites**
- Docker Engine & Docker Compose
- Minimum 4GB RAM (Swap space recommended for heavy CAD operations)

### **2. Deployment**

The API is containerized for instant deployment.
```bash
# Clone the repository
git clone https://github.com/hajdu-patrik/3D-Printer-Slicer-API.git

cd 3D-Printer-Slicer-API

# Build and start the service in detached mode
docker compose up -d --build

# Optional: start monitoring profile (Uptime Kuma)
docker compose --profile monitoring up -d
```

### **Local Node Runtime (Optional)**

If you want to run the API process directly (outside Docker), use the built-in npm scripts:

```bash
npm start
# or
npm run dev
```

### **Admin API Key**

Pricing mutations are protected via `x-api-key`.

- `ADMIN_API_KEY` must be injected from environment (not hardcoded in Git).
- Recommended: create a local `.env` file (already ignored by Git):

```bash
ADMIN_API_KEY=change_this_to_a_long_random_secret
```

- Then run:

```bash
docker compose up -d --build
```

- On VPS, keep `.env` with strict permissions:

```bash
chmod 600 .env
```

### **3. Verify Health**

Ensure the service is running and ready to accept connections:

```bash
curl http://localhost:3000/health
# Response: {"status":"OK","uptime":14.32}
```

### **4. Monitoring Hardening (Uptime Kuma behind Basic Auth)**

The monitor setup script now requires Basic Auth credentials and protects the Nginx monitor vhost by default.

```bash
MONITOR_BASIC_AUTH_USER=admin \
MONITOR_BASIC_AUTH_PASSWORD='StrongPassword123!' \
sudo bash ops/monitoring/setup-monitoring.sh monitor.example.com /path/to/project
```

> Recommended in production: keep Cloudflare Access (Zero Trust) in front of this endpoint as an extra layer.

---

## 🔌 API Documentation (Swagger)

A fully interactive OpenAPI 3.0 documentation is automatically served. Once the container is running, visit:
👉 http://localhost:3000/docs

---

## 💵 Pricing Management API (Runtime CRUD)

Pricing is now **persistent** and loaded from `configs/pricing.json` at startup.

If `configs/pricing.json` does not exist, the API auto-creates it with default FDM/SLA pricing.

### Public Endpoint

- `GET /pricing`
  - Returns full pricing object.

### Admin-Protected Endpoints

> Pricing technology path segment is **case-sensitive** and canonicalized as uppercase (`FDM`, `SLA`).

- `POST /pricing/FDM`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Body: `{ "material": "ASA", "price": 1200 }`
  - Creates a new FDM material.

- `POST /pricing/SLA`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Body: `{ "material": "High-Temp", "price": 2600 }`
  - Creates a new SLA material.

- `PATCH /pricing/FDM/:material`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Body: `{ "price": 950 }`
  - Updates FDM material price.

- `PATCH /pricing/SLA/:material`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Body: `{ "price": 1800 }`
  - Updates SLA material price.

- `DELETE /pricing/FDM/:material`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Deletes FDM material pricing entry.

- `DELETE /pricing/SLA/:material`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Deletes SLA material pricing entry.

### Example (Create new FDM material)

```bash
curl -X POST http://localhost:3000/pricing/FDM \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_ADMIN_API_KEY>" \
  -d '{"material":"ASA","price":1200}'
```

### Example (Update PETG)

```bash
curl -X PATCH http://localhost:3000/pricing/FDM/PETG \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_ADMIN_API_KEY>" \
  -d '{"price":950}'
```

---

## 💻 Integration Example

**Endpoint (FDM):** `POST /slice/FDM`
Generate an FDM slicing profile and price estimate by uploading a file.

**cURL Request:**

```bash
curl -X POST http://localhost:3000/slice/FDM \
  -H "Accept: application/json" \
  -F "choosenFile=@/path/to/your/model.step" \
  -F "layerHeight=0.2" \
  -F "material=PETG" \
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
  },
  "download_url": "/download/output-1771529853699.gcode"
}
```

**Endpoint (SLA):** `POST /slice/SLA`

```bash
curl -X POST http://localhost:3000/slice/SLA \
  -H "Accept: application/json" \
  -F "choosenFile=@/path/to/your/model.stl" \
  -F "layerHeight=0.05" \
  -F "material=Standard"
```

---

## ⚙️ Configuration & Limits

You can customize pricing, security, and slicing behavior without changing endpoint contracts.

- **Pricing Matrix:** Persisted in `configs/pricing.json` (managed via `/pricing` endpoints).
- **Admin Security:** `ADMIN_API_KEY` environment variable controls access to pricing updates/deletes.
- **Fail-Fast Security:** Server startup is blocked if `ADMIN_API_KEY` is missing.
- **Build Volumes:** Pre-flight checks protect the server from processing models that exceed physical dimensions.
  - *Default FDM:* 250 x 210 x 210 mm
  - *Default SLA:* 120 x 120 x 150 mm
- **Request Rate Limit:** Slicing endpoints are IP-rate-limited (default `5` requests / `60s`).
- **Slicing Queue:** CPU-heavy slice jobs are queued and processed with bounded concurrency (`MAX_CONCURRENT_SLICES`, default = CPU cores).
- **Queue Safety Limits:** Queue length and wait timeout are bounded (`MAX_SLICE_QUEUE_LENGTH`, `MAX_SLICE_QUEUE_WAIT_MS`).
- **Upload Body Limit:** Multipart upload size is capped (`MAX_UPLOAD_BYTES`, default `100MB`).
- **ZIP Safety Limits:** ZIP extraction is guarded by max entries and max cumulative extracted size (`MAX_ZIP_ENTRIES`, `MAX_ZIP_UNCOMPRESSED_BYTES`).
- **Body Parser Limits:** JSON/form payload size is capped (`JSON_BODY_LIMIT`, `FORM_BODY_LIMIT`, default `1mb`).
- **Slicer Profiles:** Stored in `configs/*.ini` (e.g. `FDM_0.2mm.ini`, `SLA_0.05mm.ini`).
- **Timeouts:** Internal 10-minute kill-switches prevent infinite loops during complex conversion/slicing operations.
- **Model Fidelity Policy:** Uploaded model/image/vector data is never auto-healed or shape-corrected; invalid/non-printable source data is rejected with a clear error.

---

## 📦 Release Log

Detailed version history and retroactive tag notes are maintained in [`CHANGELOG.md`](https://github.com/hajdu-patrik/3D-Printer-Slicer-API/blob/main/CHANGELOG.md).