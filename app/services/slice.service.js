/**
 * Thin slicing service orchestrator using decomposed slice modules.
 */

const fs = require('node:fs');
const path = require('node:path');
const { OUTPUT_DIR } = require('../config/paths');
const { getRate } = require('./pricing.service');
const { enqueueSliceJob } = require('./slice/queue');
const { runCommand } = require('./slice/command');
const { extractFirstSupportedFromZip } = require('./slice/zip');
const { parseSliceOptions } = require('./slice/options');
const { convertInputToStl, tryOptimizeOrientation } = require('./slice/input-processing');
const { getModelInfo, parseOutputDetailed } = require('./slice/model-stats');
const { resolveSlicerExecutable, buildSlicerCommandArgs } = require('./slice/engine');
const { applyTransformAndValidateModel } = require('./slice/transform');
const { handleProcessingError } = require('./slice/errors');
const {
    isSupportedInputExtension,
    getSupportedInputExtensionsText,
    buildOutputFilename,
    roundDimensions,
    roundToThree,
    createIsolatedOutputDir,
    resolveSingleOutputFile,
    alignOrcaOutputFileName,
    cleanupFiles
} = require('./slice/common');
const {
    resolveBuildVolumeLimits,
    createRuntimeSlicerProfile,
    resolveProfileSelection,
    logEngineProfileSelection,
    finalizeEngineMetadata
} = require('./slice/profiles');

/**
 * Map queue-layer errors to consistent HTTP responses.
 * @param {Error} err Queue error.
 * @param {import('express').Response} res Express response.
 * @returns {import('express').Response} Serialized queue error response.
 */
function createQueueErrorResponse(err, res) {
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

/**
 * Locate uploaded multipart input by expected field name.
 * @param {import('express').Request} req Express request.
 * @returns {import('multer').File | null} Uploaded file descriptor when present.
 */
function findUploadedModelFile(req) {
    return req.file && req.file.fieldname === 'choosenFile' ? req.file : null;
}

/**
 * Build standardized unsupported-format response and cleanup upload temp file.
 * @param {import('express').Response} res Express response.
 * @param {string} inputFile Uploaded temp file path.
 * @returns {import('express').Response} Error response.
 */
function createUnsupportedFormatResponse(res, inputFile) {
    cleanupFiles([inputFile]);
    return res.status(400).json({
        success: false,
        error: `Unsupported file format. Supported file extensions: ${getSupportedInputExtensionsText()}`,
        errorCode: 'UNSUPPORTED_FILE_FORMAT'
    });
}

/**
 * Rename uploaded temporary file to include original extension.
 * @param {string} inputFile Uploaded temp file path.
 * @param {string} originalExt Original extension including dot.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @returns {string} Renamed file path.
 */
function appendOriginalExtensionToUpload(inputFile, originalExt, filesCleanupList) {
    const tempFileWithExt = inputFile + originalExt;
    fs.renameSync(inputFile, tempFileWithExt);
    filesCleanupList.push(tempFileWithExt);
    return tempFileWithExt;
}

/**
 * Execute input preprocessing pipeline until a slicer-ready file is available.
 * @param {string} inputFile Input file path with original extension.
 * @param {number} depth Requested conversion depth.
 * @param {'FDM'|'SLA'} technology Requested technology.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @returns {Promise<{processableFile: string, originalModelInfo: {x: number, y: number, z: number, height_mm: number}}>} Preprocessing result.
 */
async function prepareProcessableModel(inputFile, depth, technology, filesCleanupList) {
    let processableFile = inputFile;
    if (path.extname(processableFile).toLowerCase() === '.zip') {
        processableFile = await extractFirstSupportedFromZip(inputFile, filesCleanupList);
    }

    processableFile = await convertInputToStl(processableFile, depth, filesCleanupList);
    processableFile = await tryOptimizeOrientation(processableFile, technology, filesCleanupList);

    const originalModelInfo = await getModelInfo(processableFile);
    return {
        processableFile,
        originalModelInfo
    };
}

/**
 * Calculate request pricing for parsed print stats.
 * @param {'FDM'|'SLA'} technology Active print technology.
 * @param {string} material Material key.
 * @param {{print_time_seconds: number}} stats Parsed print stats.
 * @returns {{hourlyRate: number, totalPrice: number}} Pricing result.
 */
function calculateSlicePricing(technology, material, stats) {
    const hourlyRate = getRate(technology, material);
    const printHours = stats.print_time_seconds / 3600;
    const calcHours = Math.max(printHours, 0.25);
    const totalPrice = Math.ceil((calcHours * hourlyRate) / 10) * 10;

    return {
        hourlyRate,
        totalPrice
    };
}

/**
 * Build successful slice response payload.
 * @param {{
 * engine: 'prusa'|'orca',
 * technology: 'FDM'|'SLA',
 * material: string,
 * infillPercentage: string,
 * orcaMachineConfigFile: string | null,
 * baseConfigFile: string,
 * transformOptions: {unit: 'mm'|'inch', scalePercent: number | null},
 * transformPlan: {keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, scale: {x: number, y: number, z: number}, rotationDeg: {x: number, y: number, z: number}},
 * originalModelInfo: {x: number, y: number, z: number},
 * modelBoundsValidation: {dimensions: {x: number, y: number, z: number}},
 * buildVolumeLimits: {min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string},
 * stats: {print_time_seconds: number, print_time_readable: string, material_used_m: number, object_height_mm: number, estimated_price_huf: number}
 * }} context Response context.
 * @returns {Record<string, unknown>} API response payload.
 */
function buildSliceSuccessResponse(context) {
    const {
        engine,
        technology,
        material,
        infillPercentage,
        orcaMachineConfigFile,
        baseConfigFile,
        transformOptions,
        transformPlan,
        originalModelInfo,
        modelBoundsValidation,
        buildVolumeLimits,
        stats
    } = context;

    const { hourlyRate, totalPrice } = calculateSlicePricing(technology, material, stats);

    return {
        success: true,
        slicer_engine: engine,
        technology,
        material,
        infill: infillPercentage,
        profiles: engine === 'orca'
            ? {
                machine_profile: path.basename(orcaMachineConfigFile),
                process_profile: path.basename(baseConfigFile)
            }
            : {
                prusa_profile: path.basename(baseConfigFile)
            },
        model_transform: {
            size_unit: transformOptions.unit,
            keep_proportions: transformPlan.keepProportions,
            requested_size: {
                x: transformPlan.requestedTargetSize.x === null ? null : roundToThree(transformPlan.requestedTargetSize.x),
                y: transformPlan.requestedTargetSize.y === null ? null : roundToThree(transformPlan.requestedTargetSize.y),
                z: transformPlan.requestedTargetSize.z === null ? null : roundToThree(transformPlan.requestedTargetSize.z)
            },
            scale_percent: transformOptions.scalePercent,
            scale_factors: roundDimensions(transformPlan.scale),
            rotation_deg: roundDimensions(transformPlan.rotationDeg),
            original_dimensions_mm: roundDimensions({
                x: originalModelInfo.x,
                y: originalModelInfo.y,
                z: originalModelInfo.z
            }),
            final_dimensions_mm: roundDimensions(modelBoundsValidation.dimensions)
        },
        build_volume_limits_mm: {
            min: roundDimensions(buildVolumeLimits.min),
            max: roundDimensions(buildVolumeLimits.max),
            source_profile: buildVolumeLimits.sourceProfile
        },
        hourly_rate: hourlyRate,
        stats: {
            ...stats,
            estimated_price_huf: totalPrice
        }
    };
}

/**
 * Execute full slicing pipeline for one request.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {{forcedTechnology?: 'FDM'|'SLA'|null, engine?: 'prusa'|'orca'}} [options] Pipeline mode options.
 * @returns {Promise<import('express').Response | void>} API response promise.
 */
async function processSlice(req, res, options = {}) {
    const { forcedTechnology = null, engine = 'prusa' } = options;

    const file = findUploadedModelFile(req);
    if (!file) {
        return res.status(400).json({
            success: false,
            error: 'No file uploaded (use key "choosenFile")',
            errorCode: 'NO_FILE_UPLOADED'
        });
    }

    let inputFile = file.path;
    const originalName = file.originalname;
    const originalExt = path.extname(originalName).toLowerCase();
    const filesCleanupList = [];

    if (!isSupportedInputExtension(originalExt)) {
        return createUnsupportedFormatResponse(res, inputFile);
    }

    const parsedRequest = parseSliceOptions(req.body, forcedTechnology, engine);
    if (!parsedRequest.isValid) return res.status(400).json(parsedRequest.response);

    const {
        layerHeight,
        material,
        depth,
        infillPercentage,
        technology,
        transformOptions,
        profileOverrides
    } = parsedRequest.options;

    console.log(`[INFO] Request: ${originalName} | Tech: ${technology} | Mat: ${material}`);

    try {
        inputFile = appendOriginalExtensionToUpload(inputFile, originalExt, filesCleanupList);

        let { processableFile, originalModelInfo } = await prepareProcessableModel(
            inputFile,
            depth,
            technology,
            filesCleanupList
        );

        const outputFilename = buildOutputFilename(originalName, technology);
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        const orcaOutputDir = engine === 'orca' ? createIsolatedOutputDir(OUTPUT_DIR) : null;
        if (orcaOutputDir) {
            filesCleanupList.push(orcaOutputDir);
        }
        const slicerOutputPath = engine === 'orca'
            ? path.join(orcaOutputDir, outputFilename)
            : outputPath;

        const profileSelection = resolveProfileSelection(engine, technology, layerHeight, profileOverrides);
        if (!profileSelection.isValid) {
            cleanupFiles(filesCleanupList);
            return res.status(profileSelection.status).json(profileSelection.response);
        }
        const { baseConfigFile, orcaMachineConfigFile } = profileSelection;

        const buildVolumeLimits = resolveBuildVolumeLimits(engine, technology, baseConfigFile, orcaMachineConfigFile);
        const modelPreparation = await applyTransformAndValidateModel(
            processableFile,
            originalModelInfo,
            transformOptions,
            buildVolumeLimits,
            filesCleanupList
        );
        if (!modelPreparation.isValid) {
            cleanupFiles(filesCleanupList);
            return res.status(modelPreparation.status).json(modelPreparation.response);
        }

        processableFile = modelPreparation.processableFile;
        const { transformPlan, effectiveModelInfo, modelBoundsValidation } = modelPreparation;

        const runtimeConfigFile = createRuntimeSlicerProfile(
            engine,
            baseConfigFile,
            technology,
            layerHeight,
            infillPercentage,
            filesCleanupList
        );

        logEngineProfileSelection(engine, orcaMachineConfigFile, baseConfigFile, infillPercentage, layerHeight);

        const slicerArgs = buildSlicerCommandArgs(
            technology,
            runtimeConfigFile,
            slicerOutputPath,
            infillPercentage,
            engine,
            orcaMachineConfigFile
        );
        const slicerExecutable = resolveSlicerExecutable(engine);
        await runCommand(slicerExecutable, [...slicerArgs, processableFile]);

        const effectiveOutputPath = engine === 'orca'
            ? alignOrcaOutputFileName(resolveSingleOutputFile(orcaOutputDir, '.gcode'), outputPath)
            : outputPath;

        finalizeEngineMetadata(engine, orcaOutputDir || OUTPUT_DIR);

        const stats = await parseOutputDetailed(
            effectiveOutputPath,
            technology,
            layerHeight,
            effectiveModelInfo.height_mm,
            engine
        );

        const responsePayload = buildSliceSuccessResponse({
            engine,
            technology,
            material,
            infillPercentage,
            orcaMachineConfigFile,
            baseConfigFile,
            transformOptions,
            transformPlan,
            originalModelInfo,
            modelBoundsValidation,
            buildVolumeLimits,
            stats
        });

        cleanupFiles(filesCleanupList);
        return res.json(responsePayload);
    } catch (err) {
        return handleProcessingError(err, res, filesCleanupList, inputFile, getSupportedInputExtensionsText);
    }
}

/**
 * Queue-aware public handler for Prusa slicing endpoint.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @returns {Promise<import('express').Response | void>} Endpoint response promise.
 */
async function handleSlicePrusa(req, res) {
    try {
        return await enqueueSliceJob(() => processSlice(req, res, {
            forcedTechnology: null,
            engine: 'prusa'
        }));
    } catch (err) {
        return createQueueErrorResponse(err, res);
    }
}

/**
 * Queue-aware public handler for Orca slicing endpoint.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @returns {Promise<import('express').Response | void>} Endpoint response promise.
 */
async function handleSliceOrca(req, res) {
    try {
        return await enqueueSliceJob(() => processSlice(req, res, {
            forcedTechnology: 'FDM',
            engine: 'orca'
        }));
    } catch (err) {
        return createQueueErrorResponse(err, res);
    }
}

module.exports = {
    handleSlicePrusa,
    handleSliceOrca
};
