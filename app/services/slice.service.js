/**
 * Thin slicing service orchestrator using decomposed slice modules.
 *
 * The pipeline is transport-agnostic: runSlicePipeline() resolves to `{status, body}`
 * for success and every error path. Synchronous HTTP handlers and async jobs share it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { OUTPUT_DIR } = require('../config/paths');
const { getClientIp } = require('../utils/client-ip');
const { enqueueSliceJob, toQueueErrorResponse } = require('./slice/queue');
const { runCommand } = require('./slice/command');
const { extractFirstSupportedFromZip } = require('./slice/zip');
const { parseSliceOptions } = require('./slice/options');
const { convertCadToStl, preprocessModel, renderPreview } = require('./slice/input-processing');
const { parseOutputDetailed } = require('./slice/model-stats');
const { resolveSlicerExecutable, buildSlicerCommandArgs } = require('./slice/engine');
const { applyTransformAndValidateModel } = require('./slice/transform');
const { handleProcessingError } = require('./slice/errors');
const { buildSliceSuccessResponse } = require('./slice/response');
const {
    sliceResultCache,
    hashFile,
    buildCacheKey,
    pickPricingOnlyFields
} = require('./slice/result-cache');
const metrics = require('./metrics.service');
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
    finalizeEngineMetadata,
    resolvePrusaBedCenter,
    resolveOrcaFilamentConfigPath,
    resolveMaterialOverlayPath,
    resolvePrinterProfilePrefix
} = require('./slice/profiles');

/**
 * Internal control-flow signal carrying a ready-made `{status, body}` result.
 */
class PipelineAbort extends Error {
    /**
     * @param {number} status HTTP-equivalent status.
     * @param {Record<string, unknown>} body Response body.
     */
    constructor(status, body) {
        super('Pipeline aborted with response.');
        this.status = status;
        this.body = body;
    }
}

/**
 * Minimal response adapter capturing status/body from helpers that expect an Express response.
 * @returns {{status: (code: number) => object, json: (body: object) => object, getResult: () => {status: number, body: object} | null}} Capturing adapter.
 */
function createCapturingResponse() {
    let statusCode = 200;
    let captured = null;
    const adapter = {
        status(code) {
            statusCode = code;
            return adapter;
        },
        json(body) {
            captured = { status: statusCode, body };
            return adapter;
        },
        getResult() {
            return captured;
        }
    };
    return adapter;
}

/**
 * Map queue-layer errors to a `{status, body}` result.
 * @param {Error} err Queue error.
 * @returns {{status: number, body: Record<string, unknown>}} Result.
 */
function toQueueErrorResult(err) {
    const queueErrorResponse = toQueueErrorResponse(err);
    if (queueErrorResponse) {
        return { status: queueErrorResponse.status, body: queueErrorResponse.body };
    }

    return {
        status: 500,
        body: {
            success: false,
            error: 'Queue processing failed.',
            errorCode: 'QUEUE_INTERNAL_ERROR'
        }
    };
}

/**
 * Write a pipeline result to an Express response.
 * @param {import('express').Response} res Express response.
 * @param {{status: number, body: object}} result Result.
 * @returns {import('express').Response} Response.
 */
function sendResult(res, result) {
    return res.status(result.status).json(result.body);
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
 * @param {'FDM'|'SLA'} technology Requested technology.
 * @param {boolean} autoOrient Whether automatic orientation optimization runs.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @returns {Promise<{processableFile: string, originalModelInfo: {x: number, y: number, z: number, height_mm: number, volume_mm3?: number}}>} Preprocessing result.
 */
async function prepareProcessableModel(inputFile, technology, autoOrient, filesCleanupList) {
    let sourceFile = inputFile;
    if (path.extname(sourceFile).toLowerCase() === '.zip') {
        sourceFile = await extractFirstSupportedFromZip(inputFile, filesCleanupList);
    }

    sourceFile = await convertCadToStl(sourceFile, filesCleanupList);
    const { processableFile, modelInfo } = await preprocessModel(sourceFile, technology, autoOrient, filesCleanupList);
    return {
        processableFile,
        originalModelInfo: modelInfo
    };
}

/**
 * Cheap, synchronous request validation (upload presence, extension, option parsing).
 * Cleans the uploaded temp file when validation fails.
 * @param {{file: import('multer').File | null, body: Record<string, unknown>}} submission Request payload.
 * @param {{forcedTechnology?: 'FDM'|'SLA'|null, engine?: 'prusa'|'orca'}} [engineOptions] Pipeline mode options.
 * @returns {{result: {status: number, body: object} | null, options?: object, originalExt?: string}} Failure result or parsed options.
 */
function validateSliceRequest(submission, engineOptions = {}) {
    const { forcedTechnology = null, engine = 'prusa' } = engineOptions;
    const { file, body } = submission;

    if (!file) {
        return {
            result: {
                status: 400,
                body: {
                    success: false,
                    error: 'No file uploaded (use key "choosenFile")',
                    errorCode: 'NO_FILE_UPLOADED'
                }
            }
        };
    }

    const originalExt = path.extname(file.originalname).toLowerCase();
    if (!isSupportedInputExtension(originalExt)) {
        cleanupFiles([file.path]);
        return {
            result: {
                status: 400,
                body: {
                    success: false,
                    error: `Unsupported file format. Supported file extensions: ${getSupportedInputExtensionsText()}`,
                    errorCode: 'UNSUPPORTED_FILE_FORMAT'
                }
            }
        };
    }

    const parsedRequest = parseSliceOptions(body, forcedTechnology, engine);
    if (!parsedRequest.isValid) {
        cleanupFiles([file.path]);
        return { result: { status: 400, body: parsedRequest.response } };
    }

    return { result: null, options: parsedRequest.options, originalExt };
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
 * Resolve profile files; throws PipelineAbort when profile selection is invalid.
 * @param {'prusa'|'orca'} engine Active slicer engine.
 * @param {'FDM'|'SLA'} technology Requested technology.
 * @param {number} layerHeight Requested layer height.
 * @param {{orcaMachineProfile?: string, processProfile?: string, prusaProfile?: string}} profileOverrides Optional profile overrides.
 * @returns {{baseConfigFile: string, orcaMachineConfigFile: string | null}} Profile resolution result.
 */
function resolveProfilesOrAbort(engine, technology, layerHeight, profileOverrides) {
    const profileSelection = resolveProfileSelection(engine, technology, layerHeight, profileOverrides);
    if (!profileSelection.isValid) {
        throw new PipelineAbort(profileSelection.status, profileSelection.response);
    }

    return {
        baseConfigFile: profileSelection.baseConfigFile,
        orcaMachineConfigFile: profileSelection.orcaMachineConfigFile
    };
}

/**
 * Apply transform pipeline; throws PipelineAbort when the transformed model is invalid/out of bounds.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @param {string} processableFile Current processable model path.
 * @param {{x: number, y: number, z: number, height_mm: number}} originalModelInfo Source model dimensions.
 * @param {object} transformOptions Transform options.
 * @param {object} buildVolumeLimits Build volume limits.
 * @returns {Promise<{processableFile: string, transformPlan: object, effectiveModelInfo: {height_mm: number}, modelBoundsValidation: object}>} Model preparation result.
 */
async function prepareModelForSlicingOrAbort(
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
        throw new PipelineAbort(modelPreparation.status, modelPreparation.response);
    }

    return {
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
 * @returns {Promise<{stats: object}>} Parsed stats.
 */
async function runSlicerAndParseStats(context) {
    const {
        engine,
        technology,
        layerHeight,
        infillPercentage,
        material,
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
        filesCleanupList,
        material
    );

    logEngineProfileSelection(engine, orcaMachineConfigFile, baseConfigFile, infillPercentage, layerHeight);

    const prusaBedCenter = engine === 'prusa' ? resolvePrusaBedCenter(baseConfigFile) : null;
    const orcaFilamentConfigFile = engine === 'orca' ? resolveOrcaFilamentConfigPath(material) : null;
    const slicerArgs = buildSlicerCommandArgs(
        technology,
        runtimeConfigFile,
        slicerOutputPath,
        infillPercentage,
        engine,
        orcaMachineConfigFile,
        prusaBedCenter,
        orcaFilamentConfigFile
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
 * Assemble the full response-builder context from cacheable artifacts plus per-request pricing-only fields.
 * WIRING (response agent): pricing-only fields such as `quantity` flow in via pickPricingOnlyFields(options),
 * so cached artifacts never carry them and price is always recomputed on a cache hit.
 * @param {object} artifacts Cacheable slicing artifacts (no pricing-only fields).
 * @param {object} options Parsed request options.
 * @returns {object} buildSliceSuccessResponse context.
 */
function buildResponseContext(artifacts, options) {
    return { ...artifacts, ...pickPricingOnlyFields(options) };
}

/**
 * Compute the result-cache key for a request, or null when caching is not applicable.
 * Profile files are resolved early (cheap) so their mtime/size participate in the key.
 * @param {string | null} fileHash SHA-256 of uploaded bytes.
 * @param {'prusa'|'orca'} engine Active engine.
 * @param {object} options Parsed request options.
 * @returns {string | null} Cache key.
 */
function computeCacheKey(fileHash, engine, options) {
    if (!sliceResultCache.isEnabled() || !fileHash) return null;

    const selection = resolveProfileSelection(
        engine,
        options.technology,
        options.layerHeight,
        options.profileOverrides
    );
    if (!selection.isValid) return null;

    const materialProfileFile = engine === 'orca'
        ? resolveOrcaFilamentConfigPath(options.material)
        : resolveMaterialOverlayPath(
            engine,
            options.technology,
            options.material,
            options.layerHeight,
            resolvePrinterProfilePrefix(selection.baseConfigFile)
        );
    return buildCacheKey({
        fileHash,
        engine,
        options,
        profileFiles: [selection.baseConfigFile, selection.orcaMachineConfigFile, materialProfileFile]
    });
}

/**
 * Hash an uploaded file before enqueueing (null when caching is disabled or hashing fails).
 * @param {import('multer').File | null} file Uploaded file.
 * @returns {Promise<string | null>} Hex digest.
 */
async function hashUploadIfCacheEnabled(file) {
    if (!file || !sliceResultCache.isEnabled()) return null;
    try {
        return await hashFile(file.path);
    } catch (err) {
        console.warn(`[CACHE] Could not hash upload: ${err.message}`);
        return null;
    }
}

/**
 * Run the heavy slicing stages for a validated request.
 * @param {object} state Request state.
 * @returns {Promise<{status: number, body: object}>} Result.
 */
async function executeSlicing(state) {
    const { file, options, originalExt, engine, cacheKey } = state;
    const { layerHeight, infillPercentage, technology, transformOptions, profileOverrides } = options;
    const originalName = file.originalname;
    const filesCleanupList = state.filesCleanupList;

    let inputFile = file.path;
    try {
        inputFile = appendOriginalExtensionToUpload(inputFile, originalExt, filesCleanupList);
        state.inputFile = inputFile;

        const { processableFile: preparedFile, originalModelInfo } = await prepareProcessableModel(
            inputFile,
            technology,
            options.autoOrient !== false,
            filesCleanupList
        );

        const { outputPath, orcaOutputDir, slicerOutputPath } = resolveSliceOutputTargets(
            engine,
            originalName,
            technology,
            filesCleanupList
        );

        const { baseConfigFile, orcaMachineConfigFile } = resolveProfilesOrAbort(
            engine,
            technology,
            layerHeight,
            profileOverrides
        );

        const buildVolumeLimits = resolveBuildVolumeLimits(engine, technology, baseConfigFile, orcaMachineConfigFile);
        const modelPreparation = await prepareModelForSlicingOrAbort(
            filesCleanupList,
            preparedFile,
            originalModelInfo,
            transformOptions,
            buildVolumeLimits
        );

        const { transformPlan, effectiveModelInfo, modelBoundsValidation } = modelPreparation;

        const preview = options.includePreview
            ? await renderPreview(modelPreparation.processableFile, filesCleanupList)
            : null;

        const { stats } = await runSlicerAndParseStats({
            engine,
            technology,
            layerHeight,
            infillPercentage,
            material: options.material,
            baseConfigFile,
            orcaMachineConfigFile,
            slicerOutputPath,
            outputPath,
            orcaOutputDir,
            processableFile: modelPreparation.processableFile,
            filesCleanupList,
            effectiveModelInfo
        });

        const artifacts = {
            engine,
            technology,
            material: options.material,
            infillPercentage,
            orcaMachineConfigFile,
            baseConfigFile,
            transformOptions,
            transformPlan,
            originalModelInfo,
            modelGeometry: effectiveModelInfo,
            modelBoundsValidation,
            buildVolumeLimits,
            stats,
            preview
        };

        const body ={ ...buildSliceSuccessResponse(buildResponseContext(artifacts, options)), cache_hit: false };

        if (cacheKey) {
            sliceResultCache.set(cacheKey, artifacts);
        }

        cleanupFiles(filesCleanupList);
        return { status: 200, body };
    } catch (err) {
        if (err instanceof PipelineAbort) {
            cleanupFiles(filesCleanupList);
            return { status: err.status, body: err.body };
        }

        const capture = createCapturingResponse();
        handleProcessingError(err, capture, filesCleanupList, state.inputFile, getSupportedInputExtensionsText);
        return capture.getResult() || toQueueErrorResult(err);
    }
}

/**
 * Execute full slicing pipeline for one request. Never throws; always resolves `{status, body}`.
 * @param {{file: import('multer').File | null, body: Record<string, unknown>, fileHash?: string | null}} submission Request payload.
 * @param {{forcedTechnology?: 'FDM'|'SLA'|null, engine?: 'prusa'|'orca'}} [engineOptions] Pipeline mode options.
 * @returns {Promise<{status: number, body: object}>} Pipeline result.
 */
async function runSlicePipeline(submission, engineOptions = {}) {
    const { engine = 'prusa' } = engineOptions;
    const startedAt = Date.now();

    const validation = validateSliceRequest(submission, engineOptions);
    if (validation.result) {
        metrics.recordSliceResult({
            engine,
            technology: null,
            outcome: 'error',
            errorCode: validation.result.body?.errorCode
        });
        return validation.result;
    }

    const { options, originalExt } = validation;
    const { file } = submission;
    console.log(`[INFO] Request: ${file.originalname} | Tech: ${options.technology} | Mat: ${options.material}`);

    const cacheKey = computeCacheKey(submission.fileHash || null, engine, options);
    if (cacheKey) {
        const cached = sliceResultCache.get(cacheKey);
        metrics.recordCacheLookup(Boolean(cached));
        if (cached) {
            cleanupFiles([file.path]);
            metrics.recordSliceResult({ engine, technology: options.technology, outcome: 'cache_hit' });
            return {
                status: 200,
                body: { ...buildSliceSuccessResponse(buildResponseContext(cached, options)), cache_hit: true }
            };
        }
    }

    const result = await executeSlicing({
        file,
        options,
        originalExt,
        engine,
        cacheKey,
        inputFile: file.path,
        filesCleanupList: []
    });

    metrics.observeSliceDuration((Date.now() - startedAt) / 1000);
    metrics.recordSliceResult({
        engine,
        technology: options.technology,
        outcome: result.status === 200 ? 'success' : 'error',
        errorCode: result.body?.errorCode
    });
    return result;
}

/**
 * Enqueue a pipeline run for a client. Cleans the uploaded temp file when the job never started
 * (e.g. queue wait timeout). Rejects with queue-domain errors.
 * @param {{file: import('multer').File | null, body: Record<string, unknown>, fileHash?: string | null}} submission Request payload.
 * @param {{forcedTechnology?: 'FDM'|'SLA'|null, engine?: 'prusa'|'orca'}} engineOptions Pipeline mode options.
 * @param {string} queueKey Per-client queue key.
 * @param {{onStart?: () => void}} [hooks] Lifecycle hooks.
 * @returns {Promise<{status: number, body: object}>} Pipeline result.
 */
async function enqueueSlicePipeline(submission, engineOptions, queueKey, hooks = {}) {
    let started = false;
    try {
        return await enqueueSliceJob(() => {
            started = true;
            if (hooks.onStart) hooks.onStart();
            return runSlicePipeline(submission, engineOptions);
        }, { queueKey });
    } catch (err) {
        const queueResponse = toQueueErrorResponse(err);
        if (queueResponse) {
            metrics.recordQueueRejection(queueResponse.body.errorCode, 'enqueue');
        }
        if (!started && submission.file) {
            cleanupFiles([submission.file.path]);
        }
        throw err;
    }
}

/**
 * Build the engine options for each public engine.
 * @type {Record<'prusa'|'orca', {forcedTechnology: 'FDM'|null, engine: 'prusa'|'orca'}>}
 */
const ENGINE_OPTIONS = Object.freeze({
    prusa: Object.freeze({ forcedTechnology: null, engine: 'prusa' }),
    orca: Object.freeze({ forcedTechnology: 'FDM', engine: 'orca' })
});

/**
 * Build the submission payload from a request (hashes upload when cache is enabled).
 * @param {import('express').Request} req Express request.
 * @returns {Promise<{file: import('multer').File | null, body: Record<string, unknown>, fileHash: string | null}>} Submission.
 */
async function buildSubmission(req) {
    const file = findUploadedModelFile(req);
    const fileHash = file && isSupportedInputExtension(path.extname(file.originalname).toLowerCase())
        ? await hashUploadIfCacheEnabled(file)
        : null;
    return { file, body: req.body || {}, fileHash };
}

/**
 * Create a queue-aware synchronous Express handler for an engine.
 * @param {'prusa'|'orca'} engineKey Engine key.
 * @returns {(req: import('express').Request, res: import('express').Response) => Promise<import('express').Response | void>} Handler.
 */
function createSyncSliceHandler(engineKey) {
    return async function handleSlice(req, res) {
        try {
            const submission = await buildSubmission(req);
            const result = await enqueueSlicePipeline(submission, ENGINE_OPTIONS[engineKey], getClientIp(req));
            return sendResult(res, result);
        } catch (err) {
            return sendResult(res, toQueueErrorResult(err));
        }
    };
}

const handleSlicePrusa = createSyncSliceHandler('prusa');
const handleSliceOrca = createSyncSliceHandler('orca');

module.exports = {
    handleSlicePrusa,
    handleSliceOrca,
    runSlicePipeline,
    enqueueSlicePipeline,
    validateSliceRequest,
    buildSubmission,
    toQueueErrorResult,
    sendResult,
    ENGINE_OPTIONS
};
