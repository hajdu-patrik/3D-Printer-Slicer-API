/**
 * Thin slicing service orchestrator using decomposed slice modules.
 */

const fs = require('node:fs');
const path = require('node:path');
const { OUTPUT_DIR } = require('../config/paths');
const { getClientIp } = require('../utils/client-ip');
const { enqueueSliceJob, toQueueErrorResponse } = require('./slice/queue');
const { runCommand } = require('./slice/command');
const { extractFirstSupportedFromZip } = require('./slice/zip');
const { parseSliceOptions } = require('./slice/options');
const { convertInputToStl, tryOptimizeOrientation } = require('./slice/input-processing');
const { getModelInfo, parseOutputDetailed } = require('./slice/model-stats');
const { resolveSlicerExecutable, buildSlicerCommandArgs } = require('./slice/engine');
const { applyTransformAndValidateModel } = require('./slice/transform');
const { handleProcessingError } = require('./slice/errors');
const { buildSliceSuccessResponse } = require('./slice/response');
const {
    isSupportedInputExtension,
    getSupportedInputExtensionsText,
    buildOutputFilename,
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
    const queueErrorResponse = toQueueErrorResponse(err);
    if (queueErrorResponse) {
        return res.status(queueErrorResponse.status).json(queueErrorResponse.body);
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
    return req.file?.fieldname === 'choosenFile' ? req.file : null;
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
 * @typedef {{
 * layerHeight: number,
 * material: string,
 * depth: number,
 * infillPercentage: string,
 * technology: 'FDM'|'SLA',
 * transformOptions: {unit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, targetSizeMm: {x: number | null, y: number | null, z: number | null}, scalePercent: number | null, rotationDeg: {x: number, y: number, z: number}},
 * profileOverrides: {prusaProfile: string | null, orcaMachineProfile: string | null, orcaProcessProfile: string | null}
 * }} SliceRequestOptions
 */

/**
 * Parse request payload for slicing and emit HTTP response on validation failure.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {string} inputFile Uploaded temp file path.
 * @param {'FDM'|'SLA'|null} forcedTechnology Optional engine-enforced technology.
 * @param {'prusa'|'orca'} engine Active slicer engine.
 * @returns {{response: import('express').Response | null, options?: SliceRequestOptions}} Parsed options or response.
 */
function parseSliceRequestOrResponse(req, res, inputFile, forcedTechnology, engine) {
    const parsedRequest = parseSliceOptions(req.body, forcedTechnology, engine);
    if (!parsedRequest.isValid) {
        cleanupFiles([inputFile]);
        return {
            response: res.status(400).json(parsedRequest.response)
        };
    }

    return {
        response: null,
        options: parsedRequest.options
    };
}

/**
 * Resolve deterministic output targets for current slicing request.
 * @param {'prusa'|'orca'} engine Active slicer engine.
 * @param {string} originalName Original uploaded filename.
 * @param {'FDM'|'SLA'} technology Requested technology.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @returns {{outputPath: string, orcaOutputDir: string | null, slicerOutputPath: string}} Output path mapping.
 */
function resolveSliceOutputTargets(engine, originalName, technology, filesCleanupList) {
    const outputFilename = buildOutputFilename(originalName, technology);
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    const orcaOutputDir = engine === 'orca' ? createIsolatedOutputDir(OUTPUT_DIR) : null;
    if (orcaOutputDir) {
        filesCleanupList.push(orcaOutputDir);
    }

    const slicerOutputPath = engine === 'orca'
        ? path.join(orcaOutputDir, outputFilename)
        : outputPath;

    return {
        outputPath,
        orcaOutputDir,
        slicerOutputPath
    };
}

/**
 * Resolve profile files and emit HTTP response when profile selection is invalid.
 * @param {import('express').Response} res Express response.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @param {'prusa'|'orca'} engine Active slicer engine.
 * @param {'FDM'|'SLA'} technology Requested technology.
 * @param {number} layerHeight Requested layer height.
 * @param {{orcaMachineProfile?: string, processProfile?: string, prusaProfile?: string}} profileOverrides Optional profile overrides.
 * @returns {{response: import('express').Response | null, baseConfigFile?: string, orcaMachineConfigFile?: string | null}} Profile resolution result.
 */
function resolveProfilesOrResponse(res, filesCleanupList, engine, technology, layerHeight, profileOverrides) {
    const profileSelection = resolveProfileSelection(engine, technology, layerHeight, profileOverrides);
    if (!profileSelection.isValid) {
        cleanupFiles(filesCleanupList);
        return {
            response: res.status(profileSelection.status).json(profileSelection.response)
        };
    }

    return {
        response: null,
        baseConfigFile: profileSelection.baseConfigFile,
        orcaMachineConfigFile: profileSelection.orcaMachineConfigFile
    };
}

/**
 * Apply transform pipeline and emit HTTP response when transformed model is out of bounds.
 * @param {import('express').Response} res Express response.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @param {string} processableFile Current processable model path.
 * @param {{x: number, y: number, z: number, height_mm: number}} originalModelInfo Source model dimensions.
 * @param {{unit: 'mm'|'inch', scalePercent: number | null, keepProportions: boolean, targetSizeMm: {x: number | null, y: number | null, z: number | null}, rotationDeg: {x: number, y: number, z: number}}} transformOptions Transform options.
 * @param {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string}} buildVolumeLimits Build volume limits.
 * @returns {Promise<{
 * response: import('express').Response | null,
 * processableFile?: string,
 * transformPlan?: {keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, scale: {x: number, y: number, z: number}, rotationDeg: {x: number, y: number, z: number}},
 * effectiveModelInfo?: {x: number, y: number, z: number, height_mm: number},
 * modelBoundsValidation?: {dimensions: {x: number, y: number, z: number}}
 * }>} Model preparation result.
 */
async function prepareModelForSlicingOrResponse(
    res,
    filesCleanupList,
    processableFile,
    originalModelInfo,
    transformOptions,
    buildVolumeLimits
) {
    const modelPreparation = await applyTransformAndValidateModel(
        processableFile,
        originalModelInfo,
        transformOptions,
        buildVolumeLimits,
        filesCleanupList
    );

    if (!modelPreparation.isValid) {
        cleanupFiles(filesCleanupList);
        return {
            response: res.status(modelPreparation.status).json(modelPreparation.response)
        };
    }

    return {
        response: null,
        processableFile: modelPreparation.processableFile,
        transformPlan: modelPreparation.transformPlan,
        effectiveModelInfo: modelPreparation.effectiveModelInfo,
        modelBoundsValidation: modelPreparation.modelBoundsValidation
    };
}

/**
 * Execute slicer command and parse output stats.
 * @param {{
 * engine: 'prusa'|'orca',
 * technology: 'FDM'|'SLA',
 * layerHeight: number,
 * infillPercentage: string,
 * baseConfigFile: string,
 * orcaMachineConfigFile: string | null,
 * slicerOutputPath: string,
 * outputPath: string,
 * orcaOutputDir: string | null,
 * processableFile: string,
 * filesCleanupList: string[],
 * effectiveModelInfo: {height_mm: number}
 * }} context Slicer execution context.
 * @returns {Promise<{stats: {print_time_seconds: number, print_time_readable: string, material_used_m: number, object_height_mm: number, estimated_price_huf: number}}>} Parsed stats.
 */
async function runSlicerAndParseStats(context) {
    const {
        engine,
        technology,
        layerHeight,
        infillPercentage,
        baseConfigFile,
        orcaMachineConfigFile,
        slicerOutputPath,
        outputPath,
        orcaOutputDir,
        processableFile,
        filesCleanupList,
        effectiveModelInfo
    } = context;

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

    return { stats };
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

    const parsedRequest = parseSliceRequestOrResponse(req, res, inputFile, forcedTechnology, engine);
    if (parsedRequest.response) {
        return parsedRequest.response;
    }

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

        const {
            outputPath,
            orcaOutputDir,
            slicerOutputPath
        } = resolveSliceOutputTargets(engine, originalName, technology, filesCleanupList);

        const profileResolution = resolveProfilesOrResponse(
            res,
            filesCleanupList,
            engine,
            technology,
            layerHeight,
            profileOverrides
        );
        if (profileResolution.response) {
            return profileResolution.response;
        }
        const { baseConfigFile, orcaMachineConfigFile } = profileResolution;

        const buildVolumeLimits = resolveBuildVolumeLimits(engine, technology, baseConfigFile, orcaMachineConfigFile);
        const modelPreparation = await prepareModelForSlicingOrResponse(
            res,
            filesCleanupList,
            processableFile,
            originalModelInfo,
            transformOptions,
            buildVolumeLimits
        );
        if (modelPreparation.response) {
            return modelPreparation.response;
        }

        processableFile = modelPreparation.processableFile;
        const { transformPlan, effectiveModelInfo, modelBoundsValidation } = modelPreparation;

        const { stats } = await runSlicerAndParseStats({
            engine,
            technology,
            layerHeight,
            infillPercentage,
            baseConfigFile,
            orcaMachineConfigFile,
            slicerOutputPath,
            outputPath,
            orcaOutputDir,
            processableFile,
            filesCleanupList,
            effectiveModelInfo
        });

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
        const clientQueueKey = getClientIp(req);
        return await enqueueSliceJob(() => processSlice(req, res, {
            forcedTechnology: null,
            engine: 'prusa'
        }), { queueKey: clientQueueKey });
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
        const clientQueueKey = getClientIp(req);
        return await enqueueSliceJob(() => processSlice(req, res, {
            forcedTechnology: 'FDM',
            engine: 'orca'
        }), { queueKey: clientQueueKey });
    } catch (err) {
        return createQueueErrorResponse(err, res);
    }
}

module.exports = {
    handleSlicePrusa,
    handleSliceOrca
};
