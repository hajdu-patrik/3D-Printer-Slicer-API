const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

// --- SERVER SETUP ---
const app = express();
app.use(cors());

// Output folder public access
app.use('/download', express.static(path.join(__dirname, 'output')));

// Directories setup
const HELP_FILES_DIR = path.join(__dirname, 'input');
const OUTPUT_DIR = path.join(__dirname, 'output');
const LOGS_DIR = path.join(__dirname, 'logs');

// Ensure necessary directories exist
if (!fs.existsSync(HELP_FILES_DIR)) fs.mkdirSync(HELP_FILES_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

// Multer setup for file uploads
const upload = multer({ 
    dest: HELP_FILES_DIR,
    limits: { 
        fileSize: 1024 * 1024 * 1024
    } 
});


// --- LOGGER FUNCTION ---
function logError(errorData) {
    const logFile = path.join(LOGS_DIR, 'log.json');
    const now = new Date();
    
    const newLogEntry = {
        timestamp: now.toISOString(),
        error: errorData.message || 'Unknown Error',
        details: errorData.stderr || errorData.stack || 'No details',
        path: errorData.path || 'N/A'
    };

    let logs = [];
    
    if (fs.existsSync(logFile)) {
        try {
            const fileContent = fs.readFileSync(logFile, 'utf8');
            logs = JSON.parse(fileContent);
        } catch (err) {
            console.error("Error reading log file, starting fresh.");
        }
    }

    logs.push(newLogEntry);

    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    logs = logs.filter(log => new Date(log.timestamp) > sevenDaysAgo);

    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
}


// --- SWAGGER DOCUMENTATION ---
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: '3D Printer Slicer API for FDM and SLA',
    version: '1.0.0',
    description: 'Automated 3D slicing and pricing engine for FDM and SLA technologies.'
  },
  paths: {
    '/slice': {
      post: {
        summary: 'Upload 2D/3D files and get slicing results with price estimation.',
        description: 'Supported Files: <br>* **3D Model Files:** .stl, .obj, .3mf, .stp, .step, .igs, .iges, .zip <br>* **Image Files:** .jpg, .jpeg, .png, .bmp <br>* **Vector Files:** .dxf, .svg, .eps, .pdf<br>* **ZIP Archives:** Must contain at least one supported file type. The first valid file found will be processed.',
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
                    description: 'The file to slice and to estimate price!'
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
                    description: 'Infill percentage *0% to 100%*. </br>**Only affects FDM print time and material usage**!'
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
          },
          400: { description: 'Bad Request' },
          500: { description: 'Server Error' }
        }
      }
    }
  }
};

// Serve Swagger UI
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


// --- HELPER FUNCTIONS ---
function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 1024 * 10000 }, (error, stdout, stderr) => {
            if (stdout) console.log(`[CMD LOG]:\n${stdout}`);
            if (stderr) console.error(`[CMD ERR]:\n${stderr}`);

            if (error) {
                console.error(`[EXEC ERROR] Command failed: ${cmd}`);
                // Attach stderr to the error object for API response
                error.stderr = stderr || stdout || error.message;
                return reject(error);
            }
            resolve({ stdout, stderr }); 
        });
    });
}


async function getModelInfo(filePath) {
    try {
        const { stdout } = await runCommand(`prusa-slicer --info "${filePath}"`);
        let height = 0;
        const sizeMatch = stdout.match(/size:.*,\s*([0-9.]+)/i); // Z size usually last
        const boundsMatch = stdout.match(/max_z\s*=\s*([0-9.]+)/i);
        
        if (sizeMatch) height = parseFloat(sizeMatch[1]);
        else if (boundsMatch) height = parseFloat(boundsMatch[1]);
        
        return { height_mm: height };
    } catch (err) {
        console.warn(`[WARN] Could not get model info: ${err.message}`);
        return { height_mm: 0 };
    }
}


async function parseOutputDetailed(filePath, technology, layerHeight, knownHeight) {
    const stats = {
        print_time_seconds: 0,
        print_time_readable: "Unknown",
        material_used_m: 0,
        object_height_mm: knownHeight || 0,
        estimated_price_huf: 0
    };

    if (technology === 'FDM' && fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            // Try M73 (accurate time)
            const m73Match = content.match(/M73 P0 R(\d+)/);
            if (m73Match) stats.print_time_seconds = parseInt(m73Match[1]) * 60;
            
            // Fallback to comments
            if (stats.print_time_seconds === 0) {
                const timeMatch = content.match(/; estimated printing time = (.*)/i);
                if (timeMatch) {
                    stats.print_time_readable = timeMatch[1].trim();
                    stats.print_time_seconds = parseTimeString(stats.print_time_readable);
                }
            }
            
            const filMatch = content.match(/; filament used \[mm\] = ([0-9.]+)/i);
            if (filMatch) stats.material_used_m = parseFloat(filMatch[1]) / 1000;
            
        } catch (e) { console.error("[PARSER ERROR]", e.message); }
    }

    // SLA Calculation Fallback (Time based on Layers)
    if (technology === 'SLA' && (stats.print_time_seconds === 0) && stats.object_height_mm > 0) {
        const totalLayers = Math.ceil(stats.object_height_mm / Math.max(parseFloat(layerHeight), 0.025));
        const secondsPerLayer = 11; // Approx exposure + movement
        const baseTime = 120; // Initial lift
        stats.print_time_seconds = baseTime + (totalLayers * secondsPerLayer);
    }
    
    // Format readable time if missing
    if (stats.print_time_seconds > 0) {
        const h = Math.floor(stats.print_time_seconds / 3600);
        const m = Math.floor((stats.print_time_seconds % 3600) / 60);
        stats.print_time_readable = `${h}h ${m}m ${technology === 'SLA' ? '(Est.)' : ''}`;
    }

    return stats;
}


function parseTimeString(timeStr) {
    let seconds = 0;
    if (/^\d+$/.test(timeStr)) return parseInt(timeStr);
    const days = timeStr.match(/(\d+)d/);
    const hours = timeStr.match(/(\d+)h/);
    const mins = timeStr.match(/(\d+)m/);
    const secs = timeStr.match(/(\d+)s/);
    if (days) seconds += parseInt(days[1]) * 86400;
    if (hours) seconds += parseInt(hours[1]) * 3600;
    if (mins) seconds += parseInt(mins[1]) * 60;
    if (secs) seconds += parseInt(secs[1]);
    return seconds;
}


function cleanupFiles(fileList) {
    fileList.forEach(file => {
        if (file && fs.existsSync(file)) {
            try {
                if (fs.lstatSync(file).isDirectory()) {
                    fs.rmSync(file, { recursive: true, force: true });
                    console.log(`[CLEANUP] Deleted directory: ${file}`);
                } else {
                    fs.unlinkSync(file);
                    console.log(`[CLEANUP] Deleted file: ${file}`);
                }
            } catch (err) {
                console.error(`[CLEANUP ERROR] Could not delete ${file}: ${err.message}`);
            }
        }
    });
}


// --- MAIN ROUTE ---
app.post('/slice', upload.any(), async (req, res) => {
    // 1. File Upload Handling
    const file = req.files ? req.files.find(f => f.fieldname === 'choosenFile') : null;
    if (!file) return res.status(400).json({ error: 'No file uploaded (use key "choosenFile")' });

    let inputFile = file.path;
    const originalName = file.originalname.toLowerCase();
    let originalExt = path.extname(originalName);

    const tempFileWithExt = inputFile + originalExt;
    fs.renameSync(inputFile, tempFileWithExt);
    inputFile = tempFileWithExt;

    let filesCleanupList = [inputFile]; 

    // 2. Parameters
    const layerHeight = parseFloat(req.body.layerHeight || '0.2');
    const material = req.body.material || 'PLA';
    const depth = parseFloat(req.body.depth || '2.0');
    
    let infillRaw = parseInt(req.body.infill);
    if (isNaN(infillRaw)) infillRaw = 20;
    infillRaw = Math.max(0, Math.min(100, infillRaw));
    const infillPercentage = `${infillRaw}%`;

    let technology = (layerHeight <= 0.05) ? 'SLA' : 'FDM';

    console.log(`[INFO] Request: ${originalName} | Tech: ${technology} | Mat: ${material}`);

    try {
        let processableFile = inputFile;
        let currentExt = path.extname(processableFile).toLowerCase();
        let finalStlPath = processableFile;
        let unzipDir = null;

        // --- STEP A: ZIP EXTRACTION ---
        if (currentExt === '.zip') {
            console.log(`[INFO] Extracting ZIP...`);
            unzipDir = path.join(path.dirname(inputFile), `unzip_${Date.now()}`);
            if (!fs.existsSync(unzipDir)) fs.mkdirSync(unzipDir);
            
            filesCleanupList.push(unzipDir);

            await runCommand(`unzip -o "${inputFile}" -d "${unzipDir}"`);
            
            const files = fs.readdirSync(unzipDir);
            const supportedExts = [...EXTENSIONS.direct, ...EXTENSIONS.cad, ...EXTENSIONS.image, ...EXTENSIONS.vector];
            
            const foundFile = files.find(f => supportedExts.includes(path.extname(f).toLowerCase()));
            
            if (!foundFile) throw new Error("ZIP does not contain a supported 3D/Image/Vector file.");
            
            console.log(`[INFO] Found in ZIP: ${foundFile}`);
            processableFile = path.join(unzipDir, foundFile);
            currentExt = path.extname(processableFile).toLowerCase();
        }

        // --- STEP B: CONVERSIONS ---
        
        // 1. Image -> STL
        if (EXTENSIONS.image.includes(currentExt)) {
            console.log(`[INFO] Converting Image to STL (Depth: ${depth}mm)...`);
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 img2stl.py "${processableFile}" "${finalStlPath}" ${depth}`);
        }
        // 2. Vector -> STL
        else if (EXTENSIONS.vector.includes(currentExt)) {
            console.log(`[INFO] Converting Vector to STL (Depth: ${depth}mm)...`);
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 vector2stl.py "${processableFile}" "${finalStlPath}" ${depth}`);
        }
        // 3. Mesh Formats (OBJ, 3MF) -> STL
        else if (['.obj', '.3mf', '.ply'].includes(currentExt)) {
            console.log(`[INFO] Converting Mesh to STL...`);
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 mesh2stl.py "${processableFile}" "${finalStlPath}"`);
        }
        // 4. CAD (STEP, IGES) -> STL (Gmsh)
        else if (EXTENSIONS.cad.includes(currentExt)) {
            console.log(`[INFO] Converting CAD to STL...`);
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 cad2stl.py "${processableFile}" "${finalStlPath}"`);
        }
        // 5. Already STL
        else if (currentExt === '.stl') {
            finalStlPath = processableFile;
        }

        processableFile = finalStlPath;

        // --- STEP C: ORIENTATION OPTIMATIZATION ---
        console.log(`[INFO] Optimizing orientation for ${technology}...`);
        
        const orientedStlPath = processableFile.replace('.stl', '_oriented.stl');
        
        try {
            await runCommand(`python3 orient.py "${processableFile}" "${orientedStlPath}" ${technology}`);
            
            if (fs.existsSync(orientedStlPath)) {
                filesCleanupList.push(orientedStlPath);
                processableFile = orientedStlPath;
            }
        } catch (orientErr) {
            console.warn(`[WARN] Orientation optimization failed, proceeding with original. Error: ${orientErr.message}`);
        }

        // --- STEP D: GET MODEL INFO ---
        const modelInfo = await getModelInfo(processableFile);

        // --- STEP E: SLICING ---
        const outputFilename = `output-${Date.now()}.${technology === 'SLA' ? 'sl1' : 'gcode'}`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        const configFile = path.join(__dirname, 'configs', `${technology}_${layerHeight}mm.ini`);

        if (!fs.existsSync(configFile)) throw new Error(`Missing config file: ${path.basename(configFile)}`);

        console.log(`[INFO] Slicing with ${path.basename(configFile)}...`);
        
        let slicerArgs = `--load "${configFile}"`;

        slicerArgs += ` --center 100,100`;

        if (technology === 'SLA') {
            slicerArgs += ` --export-sla --output "${outputPath}"`;
        } else {
            slicerArgs += ` --support-material --support-material-auto`;
            slicerArgs += ` --gcode-flavor marlin --export-gcode --output "${outputPath}" --fill-density ${infillPercentage}`;
        }

        await runCommand(`prusa-slicer ${slicerArgs} "${processableFile}"`);

        // --- STEP F: PRICING & STATS ---
        const stats = await parseOutputDetailed(outputPath, technology, layerHeight, modelInfo.height_mm);
        
        const hourlyRate = (PRICING[technology][material]) || PRICING[technology].default;
        const printHours = stats.print_time_seconds / 3600;
        
        // Minimum 15 minutes charge
        const calcHours = Math.max(printHours, 0.25); 
        const totalPrice = Math.ceil((calcHours * hourlyRate) / 10) * 10;

        // --- CLEANUP ---
        cleanupFiles(filesCleanupList);

        // --- RESPONSE ---
        res.json({
            success: true,
            technology: technology,
            material: material,
            infill: infillPercentage,
            hourly_rate: hourlyRate,
            stats: { 
                ...stats, 
                estimated_price_huf: totalPrice 
            },
            download_url: `/download/${outputFilename}`
        });
    } catch (err) {
        console.error("[CRITICAL ERROR]", err.message);

        cleanupFiles(filesCleanupList);

        logError({
            message: err.message,
            stderr: err.stderr,
            stack: err.stack,
            path: inputFile
        });

        res.status(500).json({ 
            success: false,
            error: "Slicing failed. The error has been logged for review.",
            errorCode: "INTERNAL_PROCESSING_ERROR" 
        });
    }
});


// Redirect all other routes to Swagger Docs
app.use('*', (req, res) => {
    res.redirect('/docs');
});


// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`FDM and SLA Slicer Engine running on port ${PORT}`);
    console.log(`Swagger Docs available at http://localhost:${PORT}/docs`);
});