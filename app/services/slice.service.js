/**
 * End-to-end slicing service:
 * file intake, conversion, orientation, slicing, estimation, and response mapping.
 */

const { exec } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { MAX_BUILD_VOLUMES, EXTENSIONS } = require('../config/constants');
const { OUTPUT_DIR, CONFIGS_DIR } = require('../config/paths');
const { logError } = require('../utils/logger');
const { getRate } = require('./pricing.service');

const DEBUG_COMMAND_LOGS = process.env.DEBUG_COMMAND_LOGS === 'true';
const MAX_LOG_OUTPUT = 4000;

function truncateLogOutput(text) {
    if (!text || text.length <= MAX_LOG_OUTPUT) return text;
    return `${text.slice(0, MAX_LOG_OUTPUT)}\n...[truncated]`;
}

/**
 * Execute shell command with bounded timeout and buffer.
 * @param {string} cmd Command line to execute.
 * @returns {Promise<{stdout: string, stderr: string}>} Command output streams.
 */
function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 1024 * 10000, timeout: 600000 }, (error, stdout, stderr) => {
            if (DEBUG_COMMAND_LOGS && stdout) console.log(`[CMD LOG]:\n${truncateLogOutput(stdout)}`);
            if (DEBUG_COMMAND_LOGS && stderr) console.error(`[CMD ERR]:\n${truncateLogOutput(stderr)}`);

            if (error) {
                if (error.killed) {
                    error.message = 'The slicing process timed out after 10 minutes.';
                }

                console.error(`[EXEC ERROR] Command failed: ${cmd}`);
                if (stderr || stdout) {
                    console.error(`[EXEC OUTPUT]:\n${truncateLogOutput(stderr || stdout)}`);
                }
                error.stderr = stderr || stdout || error.message;
                return reject(error);
            }
            resolve({ stdout, stderr });
        });
    });
}

/**
 * Read model dimensions from `prusa-slicer --info` output.
 * @param {string} filePath Path to mesh file.
 * @returns {Promise<{x: number, y: number, z: number, height_mm: number}>} Parsed size metrics.
 */
async function getModelInfo(filePath) {
    try {
        const { stdout } = await runCommand(`prusa-slicer --info "${filePath}"`);
        let x = 0, y = 0, z = 0;

        const matchX = /size_x\s*=\s*([0-9.]+)/i.exec(stdout);
        const matchY = /size_y\s*=\s*([0-9.]+)/i.exec(stdout);
        const matchZ = /size_z\s*=\s*([0-9.]+)/i.exec(stdout);

        if (matchX) x = Number.parseFloat(matchX[1]);
        if (matchY) y = Number.parseFloat(matchY[1]);
        if (matchZ) z = Number.parseFloat(matchZ[1]);

        return { x, y, z, height_mm: z };
    } catch (err) {
        console.warn(`[WARN] Could not get model info: ${err.message}`);
        return { x: 0, y: 0, z: 0, height_mm: 0 };
    }
}

/**
 * Parse human-readable duration (e.g. `1h 30m`) to seconds.
 * @param {string} timeStr Time expression from slicer metadata.
 * @returns {number} Duration in seconds.
 */
function parseTimeString(timeStr) {
    let seconds = 0;
    if (/^\d+$/.test(timeStr)) return Number.parseInt(timeStr, 10);
    const days = /(\d+)d/.exec(timeStr);
    const hours = /(\d+)h/.exec(timeStr);
    const mins = /(\d+)m/.exec(timeStr);
    const secs = /(\d+)s/.exec(timeStr);
    if (days) seconds += Number.parseInt(days[1], 10) * 86400;
    if (hours) seconds += Number.parseInt(hours[1], 10) * 3600;
    if (mins) seconds += Number.parseInt(mins[1], 10) * 60;
    if (secs) seconds += Number.parseInt(secs[1], 10);
    return seconds;
}

/**
 * Build normalized print statistics from generated slicer output.
 * @param {string} filePath Output path to `.gcode` or `.sl1` artifact.
 * @param {'FDM' | 'SLA'} technology Active print technology.
 * @param {number|string} layerHeight Requested layer height.
 * @param {number} knownHeight Known model height in millimeters.
 * @returns {Promise<{print_time_seconds: number, print_time_readable: string, material_used_m: number, object_height_mm: number, estimated_price_huf: number}>}
 */
async function parseOutputDetailed(filePath, technology, layerHeight, knownHeight) {
    const stats = {
        print_time_seconds: 0,
        print_time_readable: 'Unknown',
        material_used_m: 0,
        object_height_mm: knownHeight || 0,
        estimated_price_huf: 0
    };

    if (technology === 'FDM' && fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const m73Match = /M73 P0 R(\d+)/.exec(content);
            if (m73Match) stats.print_time_seconds = Number.parseInt(m73Match[1], 10) * 60;

            if (stats.print_time_seconds === 0) {
                const timeMatch = /; estimated printing time = (.*)/i.exec(content);
                if (timeMatch) {
                    stats.print_time_readable = timeMatch[1].trim();
                    stats.print_time_seconds = parseTimeString(stats.print_time_readable);
                }
            }

            const filMatch = /; filament used \[mm\] = ([0-9.]+)/i.exec(content);
            if (filMatch) stats.material_used_m = Number.parseFloat(filMatch[1]) / 1000;
        } catch (e) {
            console.error('[PARSER ERROR]', e.message);
        }
    }

    if (technology === 'SLA' && stats.print_time_seconds === 0 && stats.object_height_mm > 0) {
        const totalLayers = Math.ceil(stats.object_height_mm / Math.max(Number.parseFloat(layerHeight), 0.025));
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

function normalizeLayerHeight(layerHeightRaw) {
    const parsed = Number.parseFloat(layerHeightRaw || '0.2');
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function validateLayerHeightForTechnology(technology, layerHeight) {
    const allowed = technology === 'SLA' ? [0.025, 0.05] : [0.1, 0.2, 0.3];
    return allowed.some((value) => Math.abs(value - layerHeight) < 1e-9);
}

/**
 * Delete temporary files/directories created during request processing.
 * @param {string[]} fileList Absolute/relative paths to clean.
 * @returns {void}
 */
function cleanupFiles(fileList) {
    fileList.forEach((file) => {
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

/**
 * Detect converter-origin geometry failures from error payload.
 * @param {{message?: string, stderr?: string}} err Error object from command execution.
 * @returns {boolean} True when error indicates invalid source geometry.
 */
function isSourceGeometryError(err) {
    const combined = `${err?.message || ''}\n${err?.stderr || ''}`.toLowerCase();

    const failedConverter = (
        combined.includes('vector2stl.py') ||
        combined.includes('cad2stl.py') ||
        combined.includes('mesh2stl.py') ||
        combined.includes('img2stl.py')
    );

    const geometryHints = [
        'critical error',
        'no 2d geometry found',
        'no closed 2d geometry',
        'invalid polygon geometry',
        'could not create any geometry',
        'scene is empty',
        'mesh generation failed',
        'conversion failed',
        'cannot identify image file',
        'failed to load path geometry',
        'no 2d geometry found'
    ];

    return failedConverter && geometryHints.some((hint) => combined.includes(hint));
}

/**
 * Main slicing request handler for multipart model uploads.
 * @param {import('express').Request} req Express request with uploaded file and options.
 * @param {import('express').Response} res Express response object.
 * @returns {Promise<import('express').Response | void>} JSON response containing result or error.
 */
async function processSlice(req, res, forcedTechnology = null) {
    const file = req.files ? req.files.find((f) => f.fieldname === 'choosenFile') : null;
    if (!file) return res.status(400).json({ error: 'No file uploaded (use key "choosenFile")' });

    let inputFile = file.path;
    const originalName = file.originalname.toLowerCase();
    const originalExt = path.extname(originalName);

    const tempFileWithExt = inputFile + originalExt;
    fs.renameSync(inputFile, tempFileWithExt);
    inputFile = tempFileWithExt;

    const filesCleanupList = [inputFile];

    const layerHeight = normalizeLayerHeight(req.body.layerHeight || '0.2');
    if (!layerHeight) {
        return res.status(400).json({
            success: false,
            error: 'Invalid layerHeight value.',
            errorCode: 'INVALID_LAYER_HEIGHT'
        });
    }

    const material = req.body.material || 'PLA';
    const depth = Number.parseFloat(req.body.depth || '2.0');

    let infillRaw = Number.parseInt(req.body.infill, 10);
    if (Number.isNaN(infillRaw)) infillRaw = 20;
    infillRaw = Math.max(0, Math.min(100, infillRaw));
    const infillPercentage = `${infillRaw}%`;

    const technology = forcedTechnology || (layerHeight <= 0.05 ? 'SLA' : 'FDM');

    if (forcedTechnology && !validateLayerHeightForTechnology(forcedTechnology, layerHeight)) {
        const allowedMessage = forcedTechnology === 'SLA' ? '0.025, 0.05' : '0.1, 0.2, 0.3';
        return res.status(400).json({
            success: false,
            error: `Invalid layerHeight for ${forcedTechnology}. Allowed values: ${allowedMessage}`,
            errorCode: 'INVALID_LAYER_HEIGHT_FOR_TECHNOLOGY'
        });
    }

    console.log(`[INFO] Request: ${originalName} | Tech: ${technology} | Mat: ${material}`);

    try {
        let processableFile = inputFile;
        let currentExt = path.extname(processableFile).toLowerCase();
        let finalStlPath = processableFile;
        let unzipDir = null;

        if (currentExt === '.zip') {
            console.log('[INFO] Extracting ZIP...');
            unzipDir = path.join(path.dirname(inputFile), `unzip_${Date.now()}`);
            if (!fs.existsSync(unzipDir)) fs.mkdirSync(unzipDir);

            filesCleanupList.push(unzipDir);

            await runCommand(`unzip -o "${inputFile}" -d "${unzipDir}"`);

            const files = fs.readdirSync(unzipDir);
            const supportedExts = new Set([...EXTENSIONS.direct, ...EXTENSIONS.cad, ...EXTENSIONS.image, ...EXTENSIONS.vector]);

            const foundFile = files.find((f) => supportedExts.has(path.extname(f).toLowerCase()));

            if (!foundFile) throw new Error('ZIP does not contain a supported 3D/Image/Vector file.');

            console.log(`[INFO] Found in ZIP: ${foundFile}`);
            processableFile = path.join(unzipDir, foundFile);
            currentExt = path.extname(processableFile).toLowerCase();
        }

        if (EXTENSIONS.image.includes(currentExt)) {
            console.log(`[INFO] Converting Image to STL (Depth: ${depth}mm)...`);
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 img2stl.py "${processableFile}" "${finalStlPath}" ${depth}`);
        } else if (EXTENSIONS.vector.includes(currentExt)) {
            console.log(`[INFO] Converting Vector to STL (Depth: ${depth}mm)...`);
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 vector2stl.py "${processableFile}" "${finalStlPath}" ${depth}`);
        } else if (['.obj', '.3mf', '.ply'].includes(currentExt)) {
            console.log('[INFO] Converting Mesh to STL...');
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 mesh2stl.py "${processableFile}" "${finalStlPath}"`);
        } else if (EXTENSIONS.cad.includes(currentExt)) {
            console.log('[INFO] Converting CAD to STL...');
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 cad2stl.py "${processableFile}" "${finalStlPath}"`);
        } else if (currentExt === '.stl') {
            finalStlPath = processableFile;
        }

        processableFile = finalStlPath;

        console.log(`[INFO] Optimizing orientation for ${technology}...`);

        const orientedStlPath = processableFile.replace('.stl', '_oriented.stl');

        try {
            await runCommand(`python3 orient.py "${processableFile}" "${orientedStlPath}" ${technology}`);

            if (fs.existsSync(orientedStlPath)) {
                filesCleanupList.push(orientedStlPath);
                processableFile = orientedStlPath;
            }
        } catch (error_) {
            console.warn(`[WARN] Orientation optimization failed, proceeding with original. Error: ${error_.message}`);
        }

        const modelInfo = await getModelInfo(processableFile);

        const limits = MAX_BUILD_VOLUMES[technology];
        if (modelInfo.x > limits.x || modelInfo.y > limits.y || modelInfo.z > limits.z) {
            throw new Error(`MODEL_TOO_LARGE|The model size (${modelInfo.x.toFixed(1)} x ${modelInfo.y.toFixed(1)} x ${modelInfo.z.toFixed(1)} mm) exceeds the maximum build volume for ${technology} (${limits.x} x ${limits.y} x ${limits.z} mm).`);
        }

        const outputFilename = `output-${Date.now()}.${technology === 'SLA' ? 'sl1' : 'gcode'}`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        const configFile = path.join(CONFIGS_DIR, `${technology}_${layerHeight}mm.ini`);

        if (!fs.existsSync(configFile)) throw new Error(`Missing config file: ${path.basename(configFile)}`);

        console.log(`[INFO] Slicing with ${path.basename(configFile)}...`);

        let slicerArgs = `--load "${configFile}"`;

        slicerArgs += ' --center 100,100';

        if (technology === 'SLA') {
            slicerArgs += ` --export-sla --output "${outputPath}"`;
        } else {
            slicerArgs += ' --support-material --support-material-auto';
            slicerArgs += ` --gcode-flavor marlin --export-gcode --output "${outputPath}" --fill-density ${infillPercentage}`;
        }

        await runCommand(`prusa-slicer ${slicerArgs} "${processableFile}"`);

        const stats = await parseOutputDetailed(outputPath, technology, layerHeight, modelInfo.height_mm);

        const hourlyRate = getRate(technology, material);
        const printHours = stats.print_time_seconds / 3600;

        const calcHours = Math.max(printHours, 0.25);
        const totalPrice = Math.ceil((calcHours * hourlyRate) / 10) * 10;

        cleanupFiles(filesCleanupList);

        res.json({
            success: true,
            technology,
            material,
            infill: infillPercentage,
            hourly_rate: hourlyRate,
            stats: {
                ...stats,
                estimated_price_huf: totalPrice
            },
            download_url: `/download/${outputFilename}`
        });
    } catch (err) {
        console.error('[CRITICAL ERROR]', err.message);
        cleanupFiles(filesCleanupList);

        if (err.message.startsWith('MODEL_TOO_LARGE|')) {
            const cleanMessage = err.message.split('|')[1];
            return res.status(400).json({
                success: false,
                error: cleanMessage,
                errorCode: 'MODEL_EXCEEDS_BUILD_VOLUME'
            });
        }

        if (isSourceGeometryError(err)) {
            return res.status(400).json({
                success: false,
                error: 'Uploaded model/image/vector contains invalid or non-printable source data. Automatic repair is disabled to preserve exact model fidelity. Please upload a corrected source file.',
                errorCode: 'INVALID_SOURCE_GEOMETRY'
            });
        }

        logError({
            message: err.message,
            stderr: err.stderr,
            stack: err.stack,
            path: inputFile
        });

        res.status(500).json({
            success: false,
            error: 'Slicing failed. The error has been logged for review.',
            errorCode: 'INTERNAL_PROCESSING_ERROR'
        });
    }
}

async function handleSliceFDM(req, res) {
    return processSlice(req, res, 'FDM');
}

async function handleSliceSLA(req, res) {
    return processSlice(req, res, 'SLA');
}

module.exports = {
    handleSliceFDM,
    handleSliceSLA
};