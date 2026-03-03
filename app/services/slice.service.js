/**
 * End-to-end slicing service:
 * file intake, conversion, orientation, slicing, estimation, and response mapping.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
    EXTENSIONS,
    DEFAULTS,
    LAYER_HEIGHTS,
    ORCA_PROCESS_PROFILE_BY_LAYER
} = require('../config/constants');
const { OUTPUT_DIR, HELP_FILES_DIR, PRUSA_CONFIGS_DIR, ORCA_CONFIGS_DIR } = require('../config/paths');
const { logError } = require('../utils/logger');
const { getRate } = require('./pricing.service');
const {
    resolveMaterialTechnology,
    isMaterialValidForTechnology,
    getAllowedMaterialsForTechnology
} = require('./pricing.service');
const { enqueueSliceJob } = require('./slice/queue');
const { extractFirstSupportedFromZip } = require('./slice/zip');
const { runCommand } = require('./slice/command');

function getSupportedInputExtensions() {
    return new Set([
        ...EXTENSIONS.direct,
        ...EXTENSIONS.cad,
        ...EXTENSIONS.image,
        ...EXTENSIONS.vector,
        ...EXTENSIONS.archive
    ]);
}

function isSupportedInputExtension(extension) {
    if (!extension) return false;
    return getSupportedInputExtensions().has(extension.toLowerCase());
}

function getSupportedInputExtensionsText() {
    return Array.from(getSupportedInputExtensions()).sort((a, b) => a.localeCompare(b)).join(', ');
}

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
    const days = /(\d+)\s*d/i.exec(timeStr);
    const hours = /(\d+)\s*h/i.exec(timeStr);
    const mins = /(\d+)\s*m/i.exec(timeStr);
    const secs = /(\d+)\s*s/i.exec(timeStr);
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
async function parseOutputDetailed(filePath, technology, layerHeight, knownHeight, engine = 'prusa') {
    const stats = {
        print_time_seconds: 0,
        print_time_readable: 'Unknown',
        material_used_m: 0,
        object_height_mm: knownHeight || 0,
        estimated_price_huf: 0
    };

    parseFdmOutputStats(stats, technology, filePath, engine);
    applySlaEstimateIfNeeded(stats, technology, layerHeight);
    finalizeReadableTime(stats, technology);

    return stats;
}

function extractPrintTimeFromGcode(content) {
    const m73Match = /M73 P0 R(\d+)/i.exec(content);
    if (m73Match) {
        const seconds = Number.parseInt(m73Match[1], 10) * 60;
        return {
            print_time_seconds: seconds,
            print_time_readable: `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
        };
    }

    const timePatterns = [
        /;\s*estimated printing time(?:\s*\([^)]*\))?\s*=\s*([^\r\n]+)/i,
        /;\s*total estimated time\s*[:=]\s*([^\r\n]+)/i,
        /;\s*print(?:ing)?_?time(?:_seconds)?\s*[:=]\s*([^\r\n]+)/i,
        /;\s*TIME\s*:\s*(\d+)/i,
        /;\s*PRINT_TIME\s*[:=]\s*(\d+)/i
    ];

    for (const pattern of timePatterns) {
        const timeMatch = pattern.exec(content);
        if (!timeMatch) continue;

        const rawTime = String(timeMatch[1] || '').trim();
        const parsedSeconds = parseTimeString(rawTime);
        if (parsedSeconds <= 0) continue;

        return {
            print_time_seconds: parsedSeconds,
            print_time_readable: rawTime
        };
    }

    return {
        print_time_seconds: 0,
        print_time_readable: 'Unknown'
    };
}

function extractMaterialUsedMetersFromGcode(content) {
    const filamentPatterns = [
        { regex: /;\s*filament used \[mm\]\s*=\s*([0-9.]+)/i, multiplier: 1 / 1000 },
        { regex: /;\s*total filament used \[mm\]\s*[:=]\s*([0-9.]+)/i, multiplier: 1 / 1000 },
        { regex: /;\s*filament used \[m\]\s*[:=]\s*([0-9.]+)/i, multiplier: 1 },
        { regex: /;\s*material_used_m\s*[:=]\s*([0-9.]+)/i, multiplier: 1 }
    ];

    for (const pattern of filamentPatterns) {
        const filMatch = pattern.regex.exec(content);
        if (!filMatch) continue;

        const materialUsed = Number.parseFloat(filMatch[1]) * pattern.multiplier;
        if (materialUsed > 0) return materialUsed;
    }

    return 0;
}

function parseFdmOutputStats(stats, technology, filePath, engine = 'prusa') {
    if (technology !== 'FDM' || !fs.existsSync(filePath)) return;

    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const printTime = extractPrintTimeFromGcode(content);
        stats.print_time_seconds = printTime.print_time_seconds;
        stats.print_time_readable = printTime.print_time_readable;
        stats.material_used_m = extractMaterialUsedMetersFromGcode(content);

        if (engine === 'orca' && stats.print_time_seconds === 0) {
            console.warn('[WARN] Orca output parsed without explicit print time metadata.');
        }
    } catch (error_) {
        console.error('[PARSER ERROR]', error_.message);
    }
}

function applySlaEstimateIfNeeded(stats, technology, layerHeight) {
    if (technology !== 'SLA' || stats.print_time_seconds > 0 || stats.object_height_mm <= 0) return;

    const totalLayers = Math.ceil(
        stats.object_height_mm / Math.max(Number.parseFloat(layerHeight), DEFAULTS.SLA_MIN_LAYER_HEIGHT_MM)
    );
    const secondsPerLayer = DEFAULTS.SLA_SECONDS_PER_LAYER;
    const baseTime = DEFAULTS.SLA_BASE_TIME_SECONDS;
    stats.print_time_seconds = baseTime + (totalLayers * secondsPerLayer);
}

function finalizeReadableTime(stats, technology) {
    if (stats.print_time_seconds <= 0) return;

    const h = Math.floor(stats.print_time_seconds / 3600);
    const m = Math.floor((stats.print_time_seconds % 3600) / 60);
    stats.print_time_readable = `${h}h ${m}m ${technology === 'SLA' ? '(Est.)' : ''}`;
}

function normalizeLayerHeight(layerHeightRaw) {
    const parsed = Number.parseFloat(layerHeightRaw || `${DEFAULTS.DEFAULT_LAYER_HEIGHT}`);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function validateLayerHeightForTechnology(technology, layerHeight) {
    const allowed = technology === 'SLA'
        ? LAYER_HEIGHTS.BY_TECHNOLOGY.SLA
        : LAYER_HEIGHTS.BY_TECHNOLOGY.FDM;
    return allowed.some((value) => Math.abs(value - layerHeight) < 1e-9);
}

function validateLayerHeightForPrusa(layerHeight) {
    const allowed = LAYER_HEIGHTS.PRUSA;
    return allowed.some((value) => Math.abs(value - layerHeight) < 1e-9);
}

function validateLayerHeightForOrca(layerHeight) {
    const allowed = LAYER_HEIGHTS.ORCA;
    return allowed.some((value) => Math.abs(value - layerHeight) < 1e-9);
}

function resolveSlicerExecutable(engine) {
    return engine === 'orca' ? 'orca-slicer' : 'prusa-slicer';
}

function resolveConfigPath(engine, technology, layerHeight) {
    const normalizedLayer = Number.parseFloat(layerHeight).toFixed(1);
    const profileName = engine === 'orca'
        ? resolveOrcaProcessProfileName(normalizedLayer)
        : `${technology}_${layerHeight}mm.ini`;

    const baseDir = engine === 'orca' ? ORCA_CONFIGS_DIR : PRUSA_CONFIGS_DIR;
    return path.join(baseDir, profileName);
}

function resolveOrcaMachineConfigPath() {
    const configured = String(process.env.ORCA_MACHINE_PROFILE || '').trim();
    const profileName = configured || DEFAULTS.ORCA_DEFAULT_MACHINE_PROFILE;
    return path.join(ORCA_CONFIGS_DIR, profileName);
}

function resolveOrcaProcessProfileName(layerKey) {
    const normalizedLayerKey = Number.parseFloat(layerKey).toFixed(1).replace('.', '_');
    const envKey = `ORCA_PROCESS_PROFILE_${normalizedLayerKey}`;
    const fromEnv = String(process.env[envKey] || '').trim();
    if (fromEnv) return fromEnv;

    const fallback = ORCA_PROCESS_PROFILE_BY_LAYER[Number.parseFloat(layerKey).toFixed(1)];
    if (fallback) return fallback;

    return `FDM_${Number.parseFloat(layerKey).toFixed(1)}mm.json`;
}

function resolveLatestOutputFile(outputDir, extension) {
    if (!fs.existsSync(outputDir)) return null;

    const candidates = fs.readdirSync(outputDir)
        .filter((name) => name.toLowerCase().endsWith(extension))
        .map((name) => {
            const filePath = path.join(outputDir, name);
            const stat = fs.statSync(filePath);
            return {
                filePath,
                mtimeMs: stat.mtimeMs
            };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return candidates[0]?.filePath || null;
}

function alignOrcaOutputFileName(generatedOutputPath, desiredOutputPath) {
    if (!generatedOutputPath || !fs.existsSync(generatedOutputPath)) {
        throw new Error('Orca did not produce a .gcode output file.');
    }

    if (generatedOutputPath === desiredOutputPath) {
        return desiredOutputPath;
    }

    if (fs.existsSync(desiredOutputPath)) {
        fs.unlinkSync(desiredOutputPath);
    }

    fs.renameSync(generatedOutputPath, desiredOutputPath);
    return desiredOutputPath;
}

function cleanupOrcaResultMetadata(outputDir) {
    const resultMetadataPath = path.join(outputDir, 'result.json');
    if (!fs.existsSync(resultMetadataPath)) return;

    try {
        fs.unlinkSync(resultMetadataPath);
    } catch (error_) {
        console.warn(`[WARN] Could not remove Orca metadata file (${resultMetadataPath}): ${error_.message}`);
    }
}

function createOrcaRuntimeProcessProfile(baseProcessProfilePath, infillPercentage, filesCleanupList) {
    const profileData = JSON.parse(fs.readFileSync(baseProcessProfilePath, 'utf8'));
    profileData.sparse_infill_density = infillPercentage;
    profileData.layer_gcode = 'G92 E0';
    profileData.use_relative_e_distances = '0';

    const runtimeProfilePath = path.join(HELP_FILES_DIR, `orca_runtime_${Date.now()}_${Math.floor(Math.random() * 100000)}.json`);
    fs.writeFileSync(runtimeProfilePath, JSON.stringify(profileData, null, 4));
    filesCleanupList.push(runtimeProfilePath);

    return runtimeProfilePath;
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
        combined.includes(`timed out after ${DEFAULTS.SLICE_TIMEOUT_MINUTES} minutes`) ||
        combined.includes('etimedout') ||
        err?.killed === true
    );
}

function isUnsupportedInputFormatError(err) {
    const combined = `${err?.message || ''}\n${err?.stderr || ''}`.toLowerCase();
    return (
        combined.includes('unknown file format') &&
        combined.includes('input file must have')
    );
}

function isOrcaPresetCompatibilityError(err) {
    const combined = `${err?.message || ''}\n${err?.stderr || ''}`.toLowerCase();
    return combined.includes('process not compatible with printer');
}

function validateMaterialForTechnology(technology, material) {
    const materialScope = resolveMaterialTechnology(material);
    const allowedMaterials = getAllowedMaterialsForTechnology(technology);
    const allowedList = allowedMaterials.join(', ');

    if (!isMaterialValidForTechnology(technology, material)) {
        if (materialScope === null) {
            return {
                isValid: false,
                response: {
                    success: false,
                    error: `Invalid material for ${technology}. Allowed values: ${allowedList}`,
                    errorCode: 'INVALID_MATERIAL_FOR_TECHNOLOGY'
                }
            };
        }

        if (materialScope === 'BOTH') {
            return {
                isValid: false,
                response: {
                    success: false,
                    error: `Material is not enabled for ${technology}. Allowed values: ${allowedList}`,
                    errorCode: 'INVALID_MATERIAL_FOR_TECHNOLOGY'
                }
            };
        }

        return {
            isValid: false,
            response: {
                success: false,
                error: `Material belongs to ${materialScope}, but request is ${technology}. Allowed ${technology} materials: ${allowedList}`,
                errorCode: 'MATERIAL_TECHNOLOGY_MISMATCH'
            }
        };
    }

    return { isValid: true };
}

function parseSliceOptions(req, forcedTechnology, engine = 'prusa') {
    const layerHeight = normalizeLayerHeight(req.body.layerHeight || `${DEFAULTS.DEFAULT_LAYER_HEIGHT}`);
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

    const material = req.body.material || DEFAULTS.DEFAULT_FDM_MATERIAL;
    const depth = Number.parseFloat(req.body.depth || `${DEFAULTS.DEFAULT_RELIEF_DEPTH_MM}`);

    let infillRaw = Number.parseInt(req.body.infill, 10);
    if (Number.isNaN(infillRaw)) infillRaw = DEFAULTS.DEFAULT_INFIL_PERCENT;
    infillRaw = Math.max(0, Math.min(100, infillRaw));
    const infillPercentage = `${infillRaw}%`;

    const technology = forcedTechnology || (layerHeight <= 0.05 ? 'SLA' : 'FDM');
    if (engine === 'prusa' && !forcedTechnology && !validateLayerHeightForPrusa(layerHeight)) {
        return {
            isValid: false,
            response: {
                success: false,
                error: 'Invalid layerHeight for PrusaSlicer. Allowed values: 0.025, 0.05, 0.1, 0.2, 0.3',
                errorCode: 'INVALID_LAYER_HEIGHT_FOR_ENGINE'
            }
        };
    }

    if (engine === 'orca' && !validateLayerHeightForOrca(layerHeight)) {
        return {
            isValid: false,
            response: {
                success: false,
                error: 'Invalid layerHeight for OrcaSlicer. Allowed values: 0.1, 0.2, 0.3',
                errorCode: 'INVALID_LAYER_HEIGHT_FOR_ENGINE'
            }
        };
    }

    if (engine !== 'orca' && forcedTechnology && !validateLayerHeightForTechnology(forcedTechnology, layerHeight)) {
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

    const materialValidation = validateMaterialForTechnology(technology, material);
    if (!materialValidation.isValid) {
        return {
            isValid: false,
            response: materialValidation.response
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

function buildSlicerCommandArgs(technology, configFile, outputPath, infillPercentage, engine = 'prusa', orcaMachineConfigPath = null) {
    if (engine === 'orca') {
        const outputDir = path.dirname(outputPath);
        const settingsFiles = [orcaMachineConfigPath, configFile].filter(Boolean).join(';');
        return `--load-settings "${settingsFiles}" --arrange 1 --orient 1 --slice 0 --outputdir "${outputDir}"`;
    }

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
            error: `Processing exceeded ${DEFAULTS.SLICE_TIMEOUT_MINUTES} minutes. The uploaded file may be too complex or invalid for automatic slicing. Please simplify or correct the file and try again.`,
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

    if (isUnsupportedInputFormatError(err)) {
        return res.status(400).json({
            success: false,
            error: `Unsupported file format. Supported file extensions: ${getSupportedInputExtensionsText()}`,
            errorCode: 'UNSUPPORTED_FILE_FORMAT'
        });
    }

    if (isOrcaPresetCompatibilityError(err)) {
        return res.status(422).json({
            success: false,
            error: 'Orca profile preset combination is incompatible. Please check machine/process profile pairing.',
            errorCode: 'ORCA_PROFILE_INCOMPATIBLE'
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
async function processSlice(req, res, options = {}) {
    const {
        forcedTechnology = null,
        engine = 'prusa'
    } = options;

    const file = req.files ? req.files.find((f) => f.fieldname === 'choosenFile') : null;
    if (!file) return res.status(400).json({ error: 'No file uploaded (use key "choosenFile")' });

    let inputFile = file.path;
    const originalName = file.originalname;
    const originalExt = path.extname(originalName).toLowerCase();
    const filesCleanupList = [];

    if (!isSupportedInputExtension(originalExt)) {
        cleanupFiles([inputFile]);
        return res.status(400).json({
            success: false,
            error: `Unsupported file format. Supported file extensions: ${getSupportedInputExtensionsText()}`,
            errorCode: 'UNSUPPORTED_FILE_FORMAT'
        });
    }

    const parsedRequest = parseSliceOptions(req, forcedTechnology, engine);
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
        const baseConfigFile = resolveConfigPath(engine, technology, layerHeight);
        const configFile = engine === 'orca'
            ? createOrcaRuntimeProcessProfile(baseConfigFile, infillPercentage, filesCleanupList)
            : baseConfigFile;
        const orcaMachineConfigFile = engine === 'orca' ? resolveOrcaMachineConfigPath() : null;

        if (!fs.existsSync(baseConfigFile)) throw new Error(`Missing config file: ${baseConfigFile}`);
        if (engine === 'orca' && (!orcaMachineConfigFile || !fs.existsSync(orcaMachineConfigFile))) {
            throw new Error(`Missing Orca machine config file: ${orcaMachineConfigFile}`);
        }
        if (engine === 'orca') {
            console.log(`[INFO] Slicing with ${path.basename(orcaMachineConfigFile)} + ${path.basename(baseConfigFile)} (infill override: ${infillPercentage})...`);
        } else {
            console.log(`[INFO] Slicing with ${path.basename(configFile)}...`);
        }

        const slicerArgs = buildSlicerCommandArgs(technology, configFile, outputPath, infillPercentage, engine, orcaMachineConfigFile);
        const slicerExecutable = resolveSlicerExecutable(engine);

        await runCommand(`${slicerExecutable} ${slicerArgs} "${processableFile}"`);

        const effectiveOutputPath = engine === 'orca'
            ? alignOrcaOutputFileName(resolveLatestOutputFile(OUTPUT_DIR, '.gcode'), outputPath)
            : outputPath;

        if (engine === 'orca') {
            cleanupOrcaResultMetadata(OUTPUT_DIR);
        }

        const stats = await parseOutputDetailed(effectiveOutputPath, technology, layerHeight, modelInfo.height_mm, engine);

        const hourlyRate = getRate(technology, material);
        const printHours = stats.print_time_seconds / 3600;

        const calcHours = Math.max(printHours, 0.25);
        const totalPrice = Math.ceil((calcHours * hourlyRate) / 10) * 10;

        cleanupFiles(filesCleanupList);

        res.json({
            success: true,
            slicer_engine: engine,
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

async function handleSlicePrusa(req, res) {
    try {
        return await enqueueSliceJob(() => processSlice(req, res, {
            forcedTechnology: null,
            engine: 'prusa'
        }));
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

async function handleSliceOrca(req, res) {
    try {
        return await enqueueSliceJob(() => processSlice(req, res, {
            forcedTechnology: 'FDM',
            engine: 'orca'
        }));
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
    handleSlicePrusa,
    handleSliceOrca
};