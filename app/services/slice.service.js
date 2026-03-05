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
    resolveLatestOutputFile,
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
 * @returns {import('multer').File | undefined} Uploaded file descriptor when present.
 */
function findUploadedModelFile(req) {
    return req.files ? req.files.find((candidate) => candidate.fieldname === 'choosenFile') : null;
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

        const originalModelInfo = await getModelInfo(processableFile);
        const outputFilename = buildOutputFilename(originalName, technology);
        const outputPath = path.join(OUTPUT_DIR, outputFilename);

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
            outputPath,
            infillPercentage,
            engine,
            orcaMachineConfigFile
        );
        const slicerExecutable = resolveSlicerExecutable(engine);
        await runCommand(`${slicerExecutable} ${slicerArgs} "${processableFile}"`);

        const effectiveOutputPath = engine === 'orca'
            ? alignOrcaOutputFileName(resolveLatestOutputFile(OUTPUT_DIR, '.gcode'), outputPath)
            : outputPath;

        finalizeEngineMetadata(engine);

        const stats = await parseOutputDetailed(
            effectiveOutputPath,
            technology,
            layerHeight,
            effectiveModelInfo.height_mm,
            engine
        );

        const hourlyRate = getRate(technology, material);
        const printHours = stats.print_time_seconds / 3600;
        const calcHours = Math.max(printHours, 0.25);
        const totalPrice = Math.ceil((calcHours * hourlyRate) / 10) * 10;

        cleanupFiles(filesCleanupList);

        return res.json({
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
        });
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
