![Node.js](https://img.shields.io/badge/Node.js-18.x%2B-339933?style=flat&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Backend-Express_4.x-000000?style=flat&logo=express&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.x-3776AB?style=flat&logo=python&logoColor=white)
![PrusaSlicer](https://img.shields.io/badge/Slicer-PrusaSlicer_2.8.x-orange?style=flat)
![Docker](https://img.shields.io/badge/Container-Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Swagger](https://img.shields.io/badge/API_Docs-Swagger_OpenAPI-85EA2D?style=flat&logo=swagger&logoColor=black)
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
| **Python Converters** | Geometry Processors | Specialized scripts (`cad2stl.py`, `vector2stl.py`, etc.) powered by Gmsh and Shapely to normalize any input into valid STLs. |
| **PrusaSlicer CLI** | The Slicing Engine | Headless execution of PrusaSlicer for toolpath generation, support creation, and rasterization. |
| **Docker (Ubuntu)** | The Sandbox        | An isolated, dependency-rich environment containing X11 libraries, C++ binaries, and Node/Python runtimes. |


---

## 📂 Supported File Formats

The API accepts single files or `.zip` archives containing any of the following formats:

| Category        | Extensions                          | Processing Method |
|----------------|--------------------------------------|-------------------|
| **Direct 3D**  | `.stl`, `.obj`, `.3mf`               | Scene merging & manifold validation. |
| **NURBS / CAD**| `.stp`, `.step`, `.igs`, `.iges`     | Converted via Gmsh, healed, and meshed. |
| **Comming soon!**     | `.dxf`, `.svg`, `.eps`, `.pdf`       | Polygon extraction and parameterized Z-extrusion. |
| **Comming soon!**      | `.jpg`, `.jpeg`, `.png`, `.bmp`      | Grayscale heightmap generation (Lithophane style). |

---

## 🚀 Getting Started

### **1. Prerequisites**
- Docker Engine & Docker Compose
- Minimum 4GB RAM (Swap space recommended for heavy CAD operations)

### **2. Deployment**

The API is containerized for instant deployment.
```bash
# Clone the repository
git clone https://github.com/your-org/3D-Printer-Slicer-API-for-FDM-and-SLA_JS.git

cd 3D-Printer-Slicer-API-for-FDM-and-SLA_JS

# Build and start the service in detached mode
docker-compose up -d --build
```

### **Admin API Key**

Pricing mutations are protected via `x-api-key`.

- `ADMIN_API_KEY` must be injected from environment (not hardcoded in Git).
- Recommended: create a local `ADMIN_API_KEY.env` file (already ignored by Git):

```bash
ADMIN_API_KEY=change_this_to_a_long_random_secret
```

- Then run:

```bash
docker-compose up -d --build
```

- On VPS, keep `ADMIN_API_KEY.env` with strict permissions:

```bash
chmod 600 ADMIN_API_KEY.env
```

### **3. Verify Health**

Ensure the service is running and ready to accept connections:

```bash
curl http://localhost:3000/health
# Response: {"status":"OK","uptime":14.32}
```

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

- `PATCH /pricing/:technology/:material`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Body: `{ "price": 950 }`
  - Technology is validated as `FDM` or `SLA` (case-insensitive).
  - Price must be a positive number.

- `DELETE /pricing/:technology/:material`
  - Header: `x-api-key: <ADMIN_API_KEY>`
  - Deletes a material pricing entry.
  - `default` material is protected and cannot be deleted.

### Example (Update PETG)

```bash
curl -X PATCH http://localhost:3000/pricing/FDM/PETG \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_ADMIN_API_KEY>" \
  -d '{"price":950}'
```

---

## 💻 Integration Example

**Endpoint:** `POST /slice`
Generate a slicing profile and price estimate by uploading a file.

**cURL Request:**

```bash
curl -X POST http://localhost:3000/slice \
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

---

## ⚙️ Configuration & Limits

You can customize pricing, security, and slicing behavior without changing endpoint contracts.

- **Pricing Matrix:** Persisted in `configs/pricing.json` (managed via `/pricing` endpoints).
- **Admin Security:** `ADMIN_API_KEY` environment variable controls access to pricing updates/deletes.
- **Fail-Fast Security:** Server startup is blocked if `ADMIN_API_KEY` is missing.
- **Build Volumes:** Pre-flight checks protect the server from processing models that exceed physical dimensions.
  - *Default FDM:* 250 x 210 x 210 mm
  - *Default SLA:* 120 x 120 x 150 mm
- **Slicer Profiles:** Stored in `configs/*.ini` (e.g. `FDM_0.2mm.ini`, `SLA_0.05mm.ini`).
- **Timeouts:** Internal 10-minute kill-switches prevent infinite loops during complex CAD healing operations.