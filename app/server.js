const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

const app = express();
app.use(cors());

app.use('/download', express.static(path.join(__dirname, 'output')));

const HELP_FILES_DIR = path.join(__dirname, 'input', 'slicing-helper-files');

if (!fs.existsSync(HELP_FILES_DIR)) fs.mkdirSync(HELP_FILES_DIR, { recursive: true });

const upload = multer({ dest: HELP_FILES_DIR });

// --- SWAGGER DOCUMENTATION ---
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Rocket3D Slicer API',
    version: '1.0.0',
    description: 'Automated 3D slicing and pricing engine for FDM and SLA technologies.'
  },
  /*
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local Server'
    }
  ],
  */
  paths: {
    '/slice': {
      post: {
        summary: 'Upload 2D/3D files and get slicing results with price estimation',
        description: 'Supported Files: <br>* **3D Model Files:** .stl, .obj, .3mf, .stp, .step, .igs, .iges, .zip <br>* **Image Files:** .jpg, .jpeg, .png, .bmp <br>* **Vector Files:** .dxf, .svg, .eps, .pdf',
        consumes: ['multipart/form-data'],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  choosenFile: {
                    type: 'string',
                    format: 'binary',
                    description: 'The file to slice and to estimate price'
                  },
                  layerHeight: {
                    type: 'string',
                    enum: ['0.025', '0.05', '0.1', '0.2', '0.3'],
                    default: '0.2',
                    description: 'Layer height **<= 0.05** triggers SLA <br>Layer height **> 0.05** triggers FDM)'
                  },
                  material: {
                    type: 'string',
                    default: 'PLA',
                    description: 'Available materials for FDM technology: **PLA**, **ABS**, **PETG**, **TPU** <br>Available materials for SLA technology: **Standard**, **ABS-Like**, **Flexible**'
                  },
                  infill: {
                    type: 'integer',
                    default: 20,
                    minimum: 0,
                    maximum: 100,
                    description: 'Infill percentage (*0%-100%*). </br>Only affects FDM print time and material usage!'
                  }
                },
                required: ['choosenFile', 'layerHeight', 'material']
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Slicing successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    technology: { type: 'string', example: 'FDM' },
                    hourly_rate: { type: 'number', example: 800 },
                    stats: {
                      type: 'object',
                      properties: {
                        print_time_readable: { type: 'string', example: '1h 30m' },
                        estimated_price_huf: { type: 'number', example: 1250 }
                      }
                    },
                    download_url: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get('/', (req, res) => res.redirect('/docs'));


// Pricing structure with hourly rates based on technology and material.
const PRICING = {
    FDM: { PLA: 800, ABS: 800, PETG: 900, TPU: 900, default: 800 },
    SLA: { Standard: 1800, 'ABS-Like': 1800, Flexible: 2400, default: 1800 }
};


// Supported file extensions
const EXTENSIONS = {
    direct: ['.stl', '.obj', '.3mf'],
    cad: ['.stp', '.step', '.igs', '.iges'], 
    image: ['.png', '.jpg', '.jpeg', '.bmp'],
    vector: ['.dxf', '.svg', '.eps', '.pdf'],
    archive: ['.zip']
};


// --- MAIN SLICING ENDPOINTS ---
app.post('/slice', upload.any(), async (req, res) => {
    const file = req.files ? req.files.find(f => f.fieldname === 'choosenFile') : null;

    if (!file) return res.status(400).json({ error: 'No file uploaded or wrong field name (expected "choosenFile")' });

    req.file = file;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let inputFile = req.file.path;
    const originalName = req.file.originalname.toLowerCase();
    const originalExt = path.extname(originalName);
    
    const layerHeight = Number.parseFloat(req.body.layerHeight || '0.2');
    const material = req.body.material || 'PLA';
    
    let infillRaw = Number.parseInt(req.body.infill);
    if (Number.isNaN(infillRaw)) infillRaw = 20;
    if (infillRaw < 0) infillRaw = 0;
    if (infillRaw > 100) infillRaw = 100;
    const infillPercentage = `${infillRaw}%`;

    let technology = 'FDM';
    if (layerHeight <= 0.05) technology = 'SLA';

    console.log(`[INFO] Processing: ${originalName} | Tech: ${technology} | Infill: ${infillPercentage}`);

    const tempFileWithExt = inputFile + originalExt;
    fs.renameSync(inputFile, tempFileWithExt);
    inputFile = tempFileWithExt;

    try {
        let processableFile = inputFile;

        const currentExt = path.extname(processableFile).toLowerCase();
        let finalStlPath = processableFile;

        // 1. ZIP Extraction
        if (originalExt === '.zip') {
            const unzipDir = path.join(path.dirname(inputFile), `unzip_${Date.now()}`);
            fs.mkdirSync(unzipDir);
            await runCommand(`unzip -o "${inputFile}" -d "${unzipDir}"`);
            const files = fs.readdirSync(unzipDir);
            const foundFile = files.find(f => {
                const ext = path.extname(f).toLowerCase();
                return Object.values(EXTENSIONS).flat().includes(ext);
            });
            if (!foundFile) throw new Error("ZIP does not contain a supported file.");
            processableFile = path.join(unzipDir, foundFile);
        }

        // 2. Direct STL
        else if (currentExt === '.stl') {
            console.log("[INFO] File is already STL. Proceeding...");
            finalStlPath = processableFile;
        }

        // 3. Image Conversion
        else if (EXTENSIONS.image.includes(currentExt)) {
            console.log(`[INFO] Converting Image (${currentExt}) to STL...`);
            finalStlPath = processableFile + '.stl';
            await runCommand(`python3 img2stl.py "${processableFile}" "${finalStlPath}"`);
        }

        // 3. Vector Conversion
        else if (EXTENSIONS.vector.includes(currentExt)) {
            console.log(`[INFO] Converting Vector (${currentExt}) to STL...`);
            finalStlPath = processableFile + '.stl';
            await runCommand(`python3 vector2stl.py "${processableFile}" "${finalStlPath}" 2.0`);
        }
        
        // 4. Mesh Conversion
        else if (['.obj', '.3mf', '.ply'].includes(currentExt)) {
            console.log(`[INFO] Converting Mesh (${currentExt}) to STL...`);
            finalStlPath = processableFile + '.stl';
            await runCommand(`python3 mesh2stl.py "${processableFile}" "${finalStlPath}"`);
        }

        // 5. CAD Conversion
        else if (EXTENSIONS.cad.includes(currentExt)) {
            console.log(`[INFO] Converting CAD (${currentExt}) to STL using PrusaSlicer...`);
            finalStlPath = processableFile + '.stl';
            // PrusaSlicer parancs csak konvertálásra:
            await runCommand(`prusa-slicer --export-stl --output "${finalStlPath}" "${processableFile}"`);
        }

        processableFile = finalStlPath;

        // 6. Model Info
        const modelInfo = await getModelInfo(processableFile);
        
        // 7. Slicing
        const outputFilename = `output-${Date.now()}.${technology === 'SLA' ? 'sl1' : 'gcode'}`;
        const outputPath = path.join(__dirname, 'output', outputFilename);
        const configFile = path.join(__dirname, 'configs', `${technology}_${layerHeight}mm.ini`);

        if (!fs.existsSync(configFile)) throw new Error(`Missing config: ${path.basename(configFile)}`);

        let slicerArgs = `--load "${configFile}"`;

        if (technology === 'SLA') {
            slicerArgs += ` --export-sla --output "${outputPath}"`;
        } else {
            slicerArgs += ` --gcode-flavor marlin --export-gcode --output "${outputPath}" --fill-density ${infillPercentage}`;
        }
        
        const command = `prusa-slicer ${slicerArgs} "${processableFile}"`;
        await runCommand(command);

        // 8. Analysis
        const stats = await parseOutputDetailed(outputPath, technology, layerHeight, modelInfo.height_mm);
        
        // Cleanup Logic
        try {
            if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);

            const unzipDirMatch = processableFile.match(/(.*unzip_\d+)/);
            if (unzipDirMatch) {
                fs.rmSync(unzipDirMatch[1], { recursive: true, force: true });
            } 
            else if (processableFile !== inputFile && fs.existsSync(processableFile)) {
                fs.unlinkSync(processableFile);
            }
            
            const residual = inputFile.replace(/\.[^/.]+$/, ".sl1");
            if (fs.existsSync(residual)) fs.unlinkSync(residual);

        } catch (err) {
            console.error("[CLEANUP WARNING]", err.message);
        }

        const hourlyRate = (PRICING[technology][material]) || PRICING[technology].default;
        const printHours = stats.print_time_seconds / 3600;

        const calcHours = printHours > 0 ? printHours : 0.25; 
        
        const totalPrice = Math.ceil((calcHours * hourlyRate) / 10) * 10;

        res.json({
            success: true,
            technology: technology,
            material: material,
            infill: infillPercentage,
            hourly_rate: hourlyRate,
            stats: { ...stats, estimated_price_huf: totalPrice },
            download_url: `/download/${outputFilename}`
        });

    } catch (err) {
        console.error("[ERROR]", err);
        res.status(500).json({ error: err.message, details: err.stderr || '' });
    }
});


// --- HELPER FUNCTIONS ---
async function getModelInfo(filePath) {
    try {
        console.log(`[DEBUG] Getting info for: ${filePath}`); // <--- ÚJ SOR
        const { stdout } = await runCommand(`prusa-slicer --info "${filePath}"`);
        
        console.log(`[DEBUG] Slicer Info Output:\n${stdout}`); // <--- ÚJ SOR (Ez a legfontosabb!)

        let height = 0;
        // Kicsit lazítottam a Regex-en, hogy rugalmasabb legyen
        const sizeMatch = stdout.match(/size:.*,\s*([0-9.]+)/i);
        const boundsMatch = stdout.match(/max_z\s*=\s*([0-9.]+)/i);

        if (sizeMatch) {
            height = Number.parseFloat(sizeMatch[1]);
            console.log(`[DEBUG] Height found via 'size': ${height}`);
        }
        else if (boundsMatch) {
            height = Number.parseFloat(boundsMatch[1]);
            console.log(`[DEBUG] Height found via 'max_z': ${height}`);
        } else {
            console.log(`[DEBUG] ❌ No height found in output!`);
        }

        return { height_mm: height };
    } catch (e) {
        console.error(`[DEBUG] Info Error: ${e.message}`);
        return { height_mm: 0 };
    }
}

function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 1024 * 10000 }, (error, stdout, stderr) => {
            resolve({ stdout, stderr }); 
        });
    });
}

async function parseOutputDetailed(filePath, technology, layerHeight, knownHeight) {
    const stats = {
        print_time_seconds: 0,
        print_time_readable: "Unknown",
        material_used_m: 0,
        object_height_mm: knownHeight || 0
    };

    if (technology === 'FDM') {
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                const m73Match = content.match(/M73 P0 R(\d+)/);
                if (m73Match) stats.print_time_seconds = Number.parseInt(m73Match[1]) * 60;
                
                if (stats.print_time_seconds === 0) {
                    const timeMatch = content.match(/; estimated printing time = (.*)/i);
                    if (timeMatch) {
                        stats.print_time_readable = timeMatch[1].trim();
                        stats.print_time_seconds = parseTimeString(stats.print_time_readable);
                    }
                }
                const filMatch = content.match(/; filament used \[mm\] = ([0-9.]+)/i);
                if (filMatch) stats.material_used_m = Number.parseFloat(filMatch[1]) / 1000;
            }
        } catch (e) { console.error("[PARSER ERROR]", e.message); }
    }

    if (technology === 'SLA' && stats.print_time_seconds === 0 && stats.object_height_mm > 0) {
        const totalLayers = Math.ceil(stats.object_height_mm / layerHeight);
        const secondsPerLayer = 11; 
        const baseTime = 120;
        stats.print_time_seconds = baseTime + (totalLayers * secondsPerLayer);
    }
    
    if (stats.print_time_seconds > 0) {
        const h = Math.floor(stats.print_time_seconds / 3600);
        const m = Math.floor((stats.print_time_seconds % 3600) / 60);
        stats.print_time_readable = `${h}h ${m}m ${technology === 'SLA' ? '(Est.)' : ''}`;
    }

    return stats;
}

function parseTimeString(timeStr) {
    let seconds = 0;
    if (/^\d+$/.test(timeStr)) return Number.parseInt(timeStr);
    const days = timeStr.match(/(\d+)d/);
    const hours = timeStr.match(/(\d+)h/);
    const mins = timeStr.match(/(\d+)m/);
    const secs = timeStr.match(/(\d+)s/);
    if (days) seconds += Number.parseInt(days[1]) * 86400;
    if (hours) seconds += Number.parseInt(hours[1]) * 3600;
    if (mins) seconds += Number.parseInt(mins[1]) * 60;
    if (secs) seconds += Number.parseInt(secs[1]);
    return seconds;
}

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Rocket3D Slicer Engine running on port ${PORT}`);
    console.log(`Swagger Docs available at http://localhost:${PORT}/docs`);
});