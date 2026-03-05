/**
 * Model transformation planning (scale/rotate) and post-transform bounds validation.
 */

const { runCommand } = require('./command');
const { getModelInfo } = require('./model-stats');
const { validateModelDimensionsAgainstLimits } = require('./profiles');
const { roundDimensions } = require('./common');

/**
 * Check whether all base model dimensions are positive.
 * @param {{x: number, y: number, z: number}} dimensions Parsed dimensions.
 * @returns {boolean} True when all axes are strictly positive.
 */
function hasPositiveDimensions(dimensions) {
    return dimensions.x > 0 && dimensions.y > 0 && dimensions.z > 0;
}

/**
 * Check if any target sizing axis was requested.
 * @param {{x: number | null, y: number | null, z: number | null}} targetSizeMm Requested target size.
 * @returns {boolean} True when at least one axis is provided.
 */
function hasTargetSizing(targetSizeMm) {
    return targetSizeMm.x !== null || targetSizeMm.y !== null || targetSizeMm.z !== null;
}

/**
 * Build uniform scale factors from proportional target sizing.
 * @param {{x: number, y: number, z: number}} baseDimensions Current model dimensions.
 * @param {{x: number | null, y: number | null, z: number | null}} targetSizeMm Requested target size in millimeters.
 * @returns {{isValid: true, scale: {x: number, y: number, z: number}} | {isValid: false, error: string}} Scale result.
 */
function buildProportionalScale(baseDimensions, targetSizeMm) {
    const ratios = [];

    if (targetSizeMm.x !== null) ratios.push(targetSizeMm.x / baseDimensions.x);
    if (targetSizeMm.y !== null) ratios.push(targetSizeMm.y / baseDimensions.y);
    if (targetSizeMm.z !== null) ratios.push(targetSizeMm.z / baseDimensions.z);

    const factor = ratios.find((value) => Number.isFinite(value) && value > 0);
    if (!factor) {
        return {
            isValid: false,
            error: 'Invalid proportional scaling ratio derived from target size values.'
        };
    }

    return {
        isValid: true,
        scale: { x: factor, y: factor, z: factor }
    };
}

/**
 * Build independent per-axis scale factors.
 * @param {{x: number, y: number, z: number}} baseDimensions Current model dimensions.
 * @param {{x: number | null, y: number | null, z: number | null}} targetSizeMm Requested target size in millimeters.
 * @returns {{isValid: true, scale: {x: number, y: number, z: number}} | {isValid: false, error: string}} Scale result.
 */
function buildIndependentScale(baseDimensions, targetSizeMm) {
    const scaleX = targetSizeMm.x === null ? 1 : (targetSizeMm.x / baseDimensions.x);
    const scaleY = targetSizeMm.y === null ? 1 : (targetSizeMm.y / baseDimensions.y);
    const scaleZ = targetSizeMm.z === null ? 1 : (targetSizeMm.z / baseDimensions.z);

    if (![scaleX, scaleY, scaleZ].every((value) => Number.isFinite(value) && value > 0)) {
        return {
            isValid: false,
            error: 'Invalid non-proportional scaling ratio derived from target size values.'
        };
    }

    return {
        isValid: true,
        scale: { x: scaleX, y: scaleY, z: scaleZ }
    };
}

/**
 * Resolve final scale vector from transform options.
 * @param {{x: number, y: number, z: number}} baseDimensions Current model dimensions.
 * @param {{scalePercent: number | null, targetSizeMm: {x: number | null, y: number | null, z: number | null}, keepProportions: boolean}} transformOptions Parsed transform options.
 * @returns {{isValid: true, scale: {x: number, y: number, z: number}} | {isValid: false, error: string}} Scale resolution result.
 */
function resolveScaleFromOptions(baseDimensions, transformOptions) {
    if (transformOptions.scalePercent !== null) {
        const factor = transformOptions.scalePercent / 100;
        return {
            isValid: true,
            scale: { x: factor, y: factor, z: factor }
        };
    }

    if (!hasTargetSizing(transformOptions.targetSizeMm)) {
        return {
            isValid: true,
            scale: { x: 1, y: 1, z: 1 }
        };
    }

    if (transformOptions.keepProportions) {
        return buildProportionalScale(baseDimensions, transformOptions.targetSizeMm);
    }

    return buildIndependentScale(baseDimensions, transformOptions.targetSizeMm);
}

/**
 * Build full transform plan (scale + rotation) for model preprocessing.
 * @param {{x: number|string, y: number|string, z: number|string}} modelInfo Model dimensions.
 * @param {{unit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, targetSizeMm: {x: number | null, y: number | null, z: number | null}, scalePercent: number | null, rotationDeg: {x: number, y: number, z: number}}} transformOptions Parsed transform options.
 * @returns {{isValid: true, plan: {requiresTransform: boolean, scale: {x: number, y: number, z: number}, rotationDeg: {x: number, y: number, z: number}, requestedUnit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, predictedSizeMm: {x: number, y: number, z: number}}} | {isValid: false, error: string}} Transform plan result.
 */
function buildModelTransformPlan(modelInfo, transformOptions) {
    const baseDimensions = {
        x: Number.parseFloat(modelInfo.x) || 0,
        y: Number.parseFloat(modelInfo.y) || 0,
        z: Number.parseFloat(modelInfo.z) || 0
    };

    const isSizingRequested = hasTargetSizing(transformOptions.targetSizeMm) || transformOptions.scalePercent !== null;
    if (isSizingRequested && !hasPositiveDimensions(baseDimensions)) {
        return {
            isValid: false,
            error: 'Model dimensions could not be resolved for scaling. Please provide a valid 3D model.'
        };
    }

    const scaleResult = resolveScaleFromOptions(baseDimensions, transformOptions);
    if (!scaleResult.isValid) {
        return scaleResult;
    }

    const scale = scaleResult.scale;
    const hasScale = Math.abs(scale.x - 1) > 1e-9 || Math.abs(scale.y - 1) > 1e-9 || Math.abs(scale.z - 1) > 1e-9;
    const hasRotation = Math.abs(transformOptions.rotationDeg.x) > 1e-9 || Math.abs(transformOptions.rotationDeg.y) > 1e-9 || Math.abs(transformOptions.rotationDeg.z) > 1e-9;

    return {
        isValid: true,
        plan: {
            requiresTransform: hasScale || hasRotation,
            scale,
            rotationDeg: { ...transformOptions.rotationDeg },
            requestedUnit: transformOptions.unit,
            keepProportions: transformOptions.keepProportions,
            requestedTargetSize: { ...transformOptions.requestedTargetSize },
            predictedSizeMm: {
                x: baseDimensions.x * scale.x,
                y: baseDimensions.y * scale.y,
                z: baseDimensions.z * scale.z
            }
        }
    };
}

/**
 * Execute Python-based scale/rotation transform for STL model.
 * @param {string} inputPath Input STL path.
 * @param {{scale: {x: number, y: number, z: number}, rotationDeg: {x: number, y: number, z: number}}} transformPlan Transform plan.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @returns {Promise<string>} Transformed STL path.
 */
async function applyModelTransform(inputPath, transformPlan, filesCleanupList) {
    const transformedPath = inputPath.replace(/\.stl$/i, `_scaled_${Date.now()}.stl`);
    filesCleanupList.push(transformedPath);

    const args = [
        transformPlan.scale.x,
        transformPlan.scale.y,
        transformPlan.scale.z,
        transformPlan.rotationDeg.x,
        transformPlan.rotationDeg.y,
        transformPlan.rotationDeg.z
    ].map((value) => Number.parseFloat(value).toString());

    await runCommand(
        `python3 scale_model.py "${inputPath}" "${transformedPath}" ${args.join(' ')}`
    );

    return transformedPath;
}

/**
 * Apply optional transform and validate final model bounds against build-volume limits.
 * @param {string} processableFile STL candidate path.
 * @param {{x: number|string, y: number|string, z: number|string, height_mm?: number}} originalModelInfo Original model metadata.
 * @param {{unit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, targetSizeMm: {x: number | null, y: number | null, z: number | null}, scalePercent: number | null, rotationDeg: {x: number, y: number, z: number}}} transformOptions Parsed transform options.
 * @param {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string}} buildVolumeLimits Printer limits.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @returns {Promise<
 *   {isValid: true, processableFile: string, transformPlan: {requiresTransform: boolean, scale: {x: number, y: number, z: number}, rotationDeg: {x: number, y: number, z: number}, requestedUnit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, predictedSizeMm: {x: number, y: number, z: number}}, effectiveModelInfo: {x: number, y: number, z: number, height_mm: number}, modelBoundsValidation: {isValid: true, dimensions: {x: number, y: number, z: number}}}
 *   | {isValid: false, status: number, response: {success: false, error: string, errorCode: string, model_dimensions_mm?: {x: number, y: number, z: number}, build_volume_limits_mm?: {min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, source_profile: string}}}
 * >} Validation result.
 */
async function applyTransformAndValidateModel(
    processableFile,
    originalModelInfo,
    transformOptions,
    buildVolumeLimits,
    filesCleanupList
) {
    const transformPlanResult = buildModelTransformPlan(originalModelInfo, transformOptions);
    if (!transformPlanResult.isValid) {
        return {
            isValid: false,
            status: 400,
            response: {
                success: false,
                error: transformPlanResult.error,
                errorCode: 'INVALID_SIZE_OPTIONS'
            }
        };
    }
    const transformPlan = transformPlanResult.plan;

    let transformedFilePath = processableFile;
    if (transformPlan.requiresTransform) {
        transformedFilePath = await applyModelTransform(processableFile, transformPlan, filesCleanupList);
    }

    const effectiveModelInfo = transformPlan.requiresTransform
        ? await getModelInfo(transformedFilePath)
        : originalModelInfo;

    const hasKnownFinalDimensions = [effectiveModelInfo.x, effectiveModelInfo.y, effectiveModelInfo.z]
        .every((value) => Number.parseFloat(value) > 0);
    if (!hasKnownFinalDimensions) {
        return {
            isValid: false,
            status: 422,
            response: {
                success: false,
                error: 'Model dimensions could not be resolved after preprocessing.',
                errorCode: 'MODEL_DIMENSIONS_UNAVAILABLE'
            }
        };
    }

    const modelBoundsValidation = validateModelDimensionsAgainstLimits(effectiveModelInfo, buildVolumeLimits);
    if (!modelBoundsValidation.isValid) {
        const issues = [
            ...modelBoundsValidation.tooSmall,
            ...modelBoundsValidation.tooLarge
        ].join('; ');

        return {
            isValid: false,
            status: 422,
            response: {
                success: false,
                error: `Model dimensions are outside selected printer limits. ${issues}`,
                errorCode: 'MODEL_OUT_OF_PRINTER_BOUNDS',
                model_dimensions_mm: roundDimensions(modelBoundsValidation.dimensions),
                build_volume_limits_mm: {
                    min: roundDimensions(buildVolumeLimits.min),
                    max: roundDimensions(buildVolumeLimits.max),
                    source_profile: buildVolumeLimits.sourceProfile
                }
            }
        };
    }

    return {
        isValid: true,
        processableFile: transformedFilePath,
        transformPlan,
        effectiveModelInfo,
        modelBoundsValidation
    };
}

module.exports = {
    applyTransformAndValidateModel
};
