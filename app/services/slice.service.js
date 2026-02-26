/**
 * End-to-end slicing service:
 * file intake, conversion, orientation, slicing, estimation, and response mapping.
 */

const fs = require('node:fs');
const path = require('node:path');
const { EXTENSIONS } = require('../config/constants');
const { OUTPUT_DIR, CONFIGS_DIR } = require('../config/paths');
const { logError } = require('../utils/logger');
const { getRate } = require('./pricing.service');
const { enqueueSliceJob } = require('./slice/queue');
const { extractFirstSupportedFromZip } = require('./slice/zip');
const { runCommand } = require('./slice/command');

function sanitizeOutputBaseName(fileName) {
    const parsedName = path.parse(fileName || '').name;
    const normalized = parsedName
        .trim()
        .replaceAll(/[^a-zA-Z0-9]+/g, '-')
        .replaceAll(/(^-+)|(-+$)/g, '');

    return normalized || 'output';
}

function buildOutputFilename(originalFileName, technology) {
    const extension = technology === 'SLA' ? 'sl1' : 'gcode';
    const baseName = sanitizeOutputBaseName(originalFileName);
    const uniqueSuffix = Date.now();

    return `${baseName}-output-${uniqueSuffix}.${extension}`;
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

    parseFdmOutputStats(stats, technology, filePath);
    applySlaEstimateIfNeeded(stats, technology, layerHeight);
    finalizeReadableTime(stats, technology);

    return stats;
}

function parseFdmOutputStats(stats, technology, filePath) {
    if (technology !== 'FDM' || !fs.existsSync(filePath)) return;

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
    } catch (error_) {
        console.error('[PARSER ERROR]', error_.message);
    }
}

function applySlaEstimateIfNeeded(stats, technology, layerHeight) {
    if (technology !== 'SLA' || stats.print_time_seconds > 0 || stats.object_height_mm <= 0) return;

    const totalLayers = Math.ceil(stats.object_height_mm / Math.max(Number.parseFloat(layerHeight), 0.025));
    const secondsPerLayer = 11;
    const baseTime = 120;
    stats.print_time_seconds = baseTime + (totalLayers * secondsPerLayer);
}

function finalizeReadableTime(stats, technology) {
    if (stats.print_time_seconds <= 0) return;

    const h = Math.floor(stats.print_time_seconds / 3600);
    const m = Math.floor((stats.print_time_seconds % 3600) / 60);
    stats.print_time_readable = `${h}h ${m}m ${technology === 'SLA' ? '(Est.)' : ''}`;
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
        'no 2d geometry found',
        'could not be parsed into closed shapes',
        'contains open curves/paths',
        'contains invalid shapes',
        'not supported or is corrupted',
        'impossible to mesh periodic surface',
        'invalid file'
    ];

    return failedConverter && geometryHints.some((hint) => combined.includes(hint));
}

/**
 * Detect ZIP input archive errors that should be returned as user-facing 400.
 * @param {{message?: string, stderr?: string}} err Error object from processing.
 * @returns {boolean} True when error indicates invalid archive input.
 */
function isZipInputError(err) {
    const combined = `${err?.message || ''}\n${err?.stderr || ''}`.toLowerCase();
    return (
        combined.includes('zip_guard|') ||
        combined.includes('zip does not contain a supported') ||
        combined.includes('encrypted zip files are not supported') ||
        combined.includes('zip contains unsafe file paths') ||
        combined.includes('zip contains too many files') ||
        combined.includes('zip extracted size exceeds allowed limit') ||
        (combined.includes('enoent') && combined.includes('.zip'))
    );
}

function isProcessingTimeoutError(err) {
    const combined = `${err?.message || ''}\n${err?.stderr || ''}`.toLowerCase();
    return (
        combined.includes('timed out after 10 minutes') ||
        combined.includes('etimedout') ||
        err?.killed === true
    );
}

function parseSliceOptions(req, forcedTechnology) {
    const layerHeight = normalizeLayerHeight(req.body.layerHeight || '0.2');
    if (!layerHeight) {
        return {
            isValid: false,
            response: {
                success: false,
                error: 'Invalid layerHeight value.',
                errorCode: 'INVALID_LAYER_HEIGHT'
            }
        };
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
        return {
            isValid: false,
            response: {
                success: false,
                error: `Invalid layerHeight for ${forcedTechnology}. Allowed values: ${allowedMessage}`,
                errorCode: 'INVALID_LAYER_HEIGHT_FOR_TECHNOLOGY'
            }
        };
    }

    return {
        isValid: true,
        options: {
            layerHeight,
            material,
            depth,
            infillPercentage,
            technology
        }
    };
}


async function convertInputToStl(processableFile, depth, filesCleanupList) {
    const currentExt = path.extname(processableFile).toLowerCase();
    let finalStlPath = processableFile;

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
    }

    return finalStlPath;
}

async function tryOptimizeOrientation(processableFile, technology, filesCleanupList) {
    console.log(`[INFO] Optimizing orientation for ${technology}...`);
    const orientedStlPath = processableFile.replace('.stl', '_oriented.stl');

    try {
        await runCommand(`python3 orient.py "${processableFile}" "${orientedStlPath}" ${technology}`);
        if (fs.existsSync(orientedStlPath)) {
            filesCleanupList.push(orientedStlPath);
            return orientedStlPath;
        }
    } catch (error_) {
        console.warn(`[WARN] Orientation optimization failed, proceeding with original. Error: ${error_.message}`);
    }

    return processableFile;
}

function buildSlicerCommandArgs(technology, configFile, outputPath, infillPercentage) {
    let slicerArgs = `--load "${configFile}"`;
    slicerArgs += ' --center 100,100';

    if (technology === 'SLA') {
        slicerArgs += ` --export-sla --output "${outputPath}"`;
    } else {
        slicerArgs += ' --support-material --support-material-auto';
        slicerArgs += ` --gcode-flavor marlin --export-gcode --output "${outputPath}" --fill-density ${infillPercentage}`;
    }

    return slicerArgs;
}

function handleProcessingError(err, res, filesCleanupList, inputFile) {
    console.error('[CRITICAL ERROR]', err.message);
    cleanupFiles(filesCleanupList);

    if (isProcessingTimeoutError(err)) {
        return res.status(422).json({
            success: false,
            error: 'Processing exceeded 10 minutes. The uploaded file may be too complex or invalid for automatic slicing. Please simplify or correct the file and try again.',
            errorCode: 'FILE_PROCESSING_TIMEOUT'
        });
    }

    if (isSourceGeometryError(err)) {
        return res.status(400).json({
            success: false,
            error: 'Uploaded model/image/vector contains invalid or non-printable source data. Automatic repair is disabled to preserve exact model fidelity. Please upload a corrected source file.',
            errorCode: 'INVALID_SOURCE_GEOMETRY'
        });
    }

    if (isZipInputError(err)) {
        return res.status(400).json({
            success: false,
            error: 'Uploaded ZIP file is invalid or does not contain a supported model/image/vector file.',
            errorCode: 'INVALID_SOURCE_ARCHIVE'
        });
    }

    try {
        logError({
            message: err.message,
            stderr: err.stderr,
            stack: err.stack,
            path: inputFile
        });
    } catch (error_) {
        console.error(`[LOGGER ERROR] ${error_.message}`);
    }

    return res.status(500).json({
        success: false,
        error: 'Slicing failed. The error has been logged for review.',
        errorCode: 'INTERNAL_PROCESSING_ERROR'
    });
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
    const originalName = file.originalname;
    const originalExt = path.extname(originalName);
    const filesCleanupList = [];

    const parsedRequest = parseSliceOptions(req, forcedTechnology);
    if (!parsedRequest.isValid) return res.status(400).json(parsedRequest.response);
    const {
        layerHeight,
        material,
        depth,
        infillPercentage,
        technology
    } = parsedRequest.options;

    console.log(`[INFO] Request: ${originalName} | Tech: ${technology} | Mat: ${material}`);

    try {
        const tempFileWithExt = inputFile + originalExt;
        fs.renameSync(inputFile, tempFileWithExt);
        inputFile = tempFileWithExt;
        filesCleanupList.push(inputFile);

        let processableFile = inputFile;
        if (path.extname(processableFile).toLowerCase() === '.zip') {
            processableFile = await extractFirstSupportedFromZip(inputFile, filesCleanupList);
        }

        processableFile = await convertInputToStl(processableFile, depth, filesCleanupList);
        processableFile = await tryOptimizeOrientation(processableFile, technology, filesCleanupList);

        const modelInfo = await getModelInfo(processableFile);

        const outputFilename = buildOutputFilename(originalName, technology);
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        const configFile = path.join(CONFIGS_DIR, `${technology}_${layerHeight}mm.ini`);

        if (!fs.existsSync(configFile)) throw new Error(`Missing config file: ${path.basename(configFile)}`);

        console.log(`[INFO] Slicing with ${path.basename(configFile)}...`);

        const slicerArgs = buildSlicerCommandArgs(technology, configFile, outputPath, infillPercentage);

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
            }
        });
    } catch (err) {
        return handleProcessingError(err, res, filesCleanupList, inputFile);
    }
}

async function handleSliceFDM(req, res) {
    try {
        return await enqueueSliceJob(() => processSlice(req, res, 'FDM'));
    } catch (err) {
        if (err.message.startsWith('QUEUE_FULL|')) {
            return res.status(503).json({
                success: false,
                error: err.message.split('|')[1],
                errorCode: 'SLICE_QUEUE_FULL'
            });
        }

        if (err.message.startsWith('QUEUE_TIMEOUT|')) {
            return res.status(503).json({
                success: false,
                error: err.message.split('|')[1],
                errorCode: 'SLICE_QUEUE_TIMEOUT'
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Queue processing failed.',
            errorCode: 'QUEUE_INTERNAL_ERROR'
        });
    }
}

async function handleSliceSLA(req, res) {
    try {
        return await enqueueSliceJob(() => processSlice(req, res, 'SLA'));
    } catch (err) {
        if (err.message.startsWith('QUEUE_FULL|')) {
            return res.status(503).json({
                success: false,
                error: err.message.split('|')[1],
                errorCode: 'SLICE_QUEUE_FULL'
            });
        }

        if (err.message.startsWith('QUEUE_TIMEOUT|')) {
            return res.status(503).json({
                success: false,
                error: err.message.split('|')[1],
                errorCode: 'SLICE_QUEUE_TIMEOUT'
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Queue processing failed.',
            errorCode: 'QUEUE_INTERNAL_ERROR'
        });
    }
}

module.exports = {
    handleSliceFDM,
    handleSliceSLA
};