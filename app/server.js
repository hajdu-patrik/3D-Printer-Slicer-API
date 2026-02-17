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

// --- CHANGE: Upload to specific subfolder to keep root clean ---
const HELP_FILES_DIR = path.join(__dirname, 'input', 'slicing-helper-files');
// Ensure directory exists
if (!fs.existsSync(HELP_FILES_DIR)) {
    fs.mkdirSync(HELP_FILES_DIR, { recursive: true });
}

const upload = multer({ dest: HELP_FILES_DIR });

// --- SWAGGER CONFIGURATION ---
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Rocket3D Slicer API',
    version: '1.2.0',
    description: 'Automated 3D slicing and pricing engine for FDM and SLA technologies.'
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local Server'
    }
  ],
  paths: {
    paths: {
    '/slice': {
      post: {
        summary: 'Upload 2D/3D files and get slicing results with price estimation',
        description: 'Supported Files: 3D Model Files: .stl, .obj, .3mf, .stp, .step, .igs, .iges,.zip | Image Files: .jpg/.jpeg/.png/.bmp | Vector Files: .dxf/.svg/.eps/.pdf',
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
                    description: 'Layer height (<= 0.05 triggers SLA, > 0.05 triggers FDM)'
                  },
                  materials: {
                    type: 'string',
                    default: 'PLA',
                    description: 'Available materials for FDM technology: PLA, ABS, PETG, TPU | Available materials for SLA technology: Standard, ABS-Like, Flexible'
                  }
                },
                required: ['choosenFile', 'layerHeight', 'materials']
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
  }
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get('/', (req, res) => res.redirect('/docs'));

// --- PRICING CONFIGURATION (HUF/hour) ---
const PRICING = {
    base_fee: 500, 
    FDM: { PLA: 800, ABS: 800, PETG: 900, TPU: 900, default: 800 },
    SLA: { Standard: 1800, 'ABS-Like': 1800, Flexible: 2400, default: 1800 }
};

// --- SUPPORTED EXTENSIONS ---
const EXTENSIONS = {
    direct: ['.stl', '.obj', '.3mf'],
    cad: ['.stp', '.step', '.igs', '.iges'], 
    image: ['.png', '.jpg', '.jpeg', '.bmp'],
    vector: ['.dxf', '.svg', '.eps', '.pdf'],
    archive: ['.zip']
};

/**
 * Main Slicing Endpoint
 */
app.post('/slice', upload.single('choosenFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let inputFile = req.file.path;
    const originalName = req.file.originalname.toLowerCase();
    const originalExt = path.extname(originalName);
    
    const layerHeight = parseFloat(req.body.layerHeight || '0.2');
    const material = req.body.material || 'PLA';

    let technology = 'FDM';
    if (layerHeight <= 0.05) technology = 'SLA';

    console.log(`[INFO] Processing: ${originalName} | Tech: ${technology}`);

    const tempFileWithExt = inputFile + originalExt;
    fs.renameSync(inputFile, tempFileWithExt);
    inputFile = tempFileWithExt;

    try {
        let processableFile = inputFile;

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

        const currentExt = path.extname(processableFile).toLowerCase();

        // 2. Image Conversion
        if (EXTENSIONS.image.includes(currentExt)) {
            const convertedStl = processableFile + '.stl';
            await runCommand(`python3 img2stl.py "${processableFile}" "${convertedStl}"`);
            processableFile = convertedStl;
        }

        // 3. Vector Conversion
        if (EXTENSIONS.vector.includes(currentExt)) {
            const convertedStl = processableFile + '.stl';
            await runCommand(`python3 vector2stl.py "${processableFile}" "${convertedStl}" 2.0`);
            processableFile = convertedStl;
        }

        // 4. Model Info
        const modelInfo = await getModelInfo(processableFile);
        
        // 5. Slicing
        const outputFilename = `output-${Date.now()}.${technology === 'SLA' ? 'sl1' : 'gcode'}`;
        const outputPath = path.join(__dirname, 'output', outputFilename);
        const configFile = path.join(__dirname, 'configs', `${technology}_${layerHeight}mm.ini`);

        if (!fs.existsSync(configFile)) throw new Error(`Missing config: ${path.basename(configFile)}`);

        let slicerArgs = `--load "${configFile}"`;
        if (technology === 'SLA') {
            slicerArgs += ` --export-sla --output "${outputPath}"`;
        } else {
            slicerArgs += ` --gcode-flavor marlin --export-gcode --output "${outputPath}"`;
        }
        
        const command = `prusa-slicer ${slicerArgs} "${processableFile}"`;
        await runCommand(command);

        // 6. Analysis
        const stats = await parseOutputDetailed(outputPath, technology, layerHeight, modelInfo.height_mm);
        
        // Cleanup Logic (Updated for help-files)
        try {
            // Delete the input file (which is in help-files)
            if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);

            // Delete unzip directory if it exists
            const unzipDirMatch = processableFile.match(/(.*unzip_\d+)/);
            if (unzipDirMatch) {
                fs.rmSync(unzipDirMatch[1], { recursive: true, force: true });
            } 
            // Delete intermediate converted files (if not in unzip dir and different from input)
            else if (processableFile !== inputFile && fs.existsSync(processableFile)) {
                fs.unlinkSync(processableFile);
            }
            
            // Cleanup potential residual .sl1 next to input
            const residual = inputFile.replace(/\.[^/.]+$/, ".sl1");
            if (fs.existsSync(residual)) fs.unlinkSync(residual);

        } catch (cleanupErr) {
            console.error("[CLEANUP WARNING]", cleanupErr.message);
        }

        const hourlyRate = (PRICING[technology][material]) || PRICING[technology].default;
        const printHours = stats.print_time_seconds / 3600;
        const calcHours = printHours > 0 ? printHours : 0.25;
        const totalPrice = Math.ceil((PRICING.base_fee + (calcHours * hourlyRate)) / 10) * 10;

        res.json({
            success: true,
            technology: technology,
            material: material,
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
/**
 * Uses PrusaSlicer's --info command to extract model height. This is crucial for SLA time estimation.
 * It first tries to find the height from the "size" output, and if not available, it looks for "max_z" in bounds.
 * If both fail, it returns 0, which will lead to a fallback time estimation for SLA.
 */
async function getModelInfo(filePath) {
    try {
        const { stdout } = await runCommand(`prusa-slicer --info "${filePath}"`);
        let height = 0;
        const sizeMatch = stdout.match(/size:.*,\s*([0-9.]+)/i);
        const boundsMatch = stdout.match(/max_z\s*=\s*([0-9.]+)/i);
        if (sizeMatch) height = parseFloat(sizeMatch[1]);
        else if (boundsMatch) height = parseFloat(boundsMatch[1]);
        return { height_mm: height };
    } catch (e) {
        return { height_mm: 0 };
    }
}

/**
 * Executes a shell command and returns a promise with stdout and stderr.
 * Uses a larger buffer to accommodate verbose slicer outputs.
 */
function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 1024 * 10000 }, (error, stdout, stderr) => {
            resolve({ stdout, stderr }); 
        });
    });
}

/**
 * Parses the slicer output file to extract print time, material usage, and object height.
 * For FDM, it looks for M73 commands or comments. For SLA, it estimates based on height and layer count.
 */
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
                if (m73Match) stats.print_time_seconds = parseInt(m73Match[1]) * 60;
                
                if (stats.print_time_seconds === 0) {
                    const timeMatch = content.match(/; estimated printing time = (.*)/i);
                    if (timeMatch) {
                        stats.print_time_readable = timeMatch[1].trim();
                        stats.print_time_seconds = parseTimeString(stats.print_time_readable);
                    }
                }
                const filMatch = content.match(/; filament used \[mm\] = ([0-9.]+)/i);
                if (filMatch) stats.material_used_m = parseFloat(filMatch[1]) / 1000;
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

/**
 * Parses a time string like "1h 30m" or "90m" into total seconds.
 * If the string is purely numeric, it treats it as minutes.
 */
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

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Rocket3D Slicer Engine running on port ${PORT}`);
    console.log(`Swagger Docs available at http://localhost:${PORT}/docs`);
});