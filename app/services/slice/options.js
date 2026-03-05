/**
 * Request option parsing and validation for slicing endpoints.
 */

const { DEFAULTS, LAYER_HEIGHTS } = require('../../config/constants');
const {
    resolveMaterialTechnology,
    isMaterialValidForTechnology,
    getAllowedMaterialsForTechnology
} = require('../pricing.service');
const {
    pickFirstNonEmptyValue,
    parseNumberLike,
    parseOptionalPositiveField,
    parseOptionalFiniteField,
    parseBooleanLike,
    normalizeSizeUnit,
    normalizeAxisDimensions,
    sanitizeProfileFileName
} = require('./value-parsers');

/**
 * Parse and validate layer-height numeric value.
 * @param {unknown} layerHeightRaw Raw layer height input.
 * @returns {number | null} Valid positive layer height or null.
 */
function normalizeLayerHeight(layerHeightRaw) {
    const parsed = Number.parseFloat(layerHeightRaw || `${DEFAULTS.DEFAULT_LAYER_HEIGHT}`);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

/**
 * Validate layer height against selected technology capabilities.
 * @param {'FDM'|'SLA'} technology Technology key.
 * @param {number} layerHeight Requested layer height.
 * @returns {boolean} True when layer height is allowed.
 */
function validateLayerHeightForTechnology(technology, layerHeight) {
    const allowed = technology === 'SLA'
        ? LAYER_HEIGHTS.BY_TECHNOLOGY.SLA
        : LAYER_HEIGHTS.BY_TECHNOLOGY.FDM;

    return allowed.some((value) => Math.abs(value - layerHeight) < 1e-9);
}

/**
 * Validate layer height against Prusa-supported values.
 * @param {number} layerHeight Requested layer height.
 * @returns {boolean} True when supported by Prusa endpoint.
 */
function validateLayerHeightForPrusa(layerHeight) {
    return LAYER_HEIGHTS.PRUSA.some((value) => Math.abs(value - layerHeight) < 1e-9);
}

/**
 * Validate layer height against Orca-supported values.
 * @param {number} layerHeight Requested layer height.
 * @returns {boolean} True when supported by Orca endpoint.
 */
function validateLayerHeightForOrca(layerHeight) {
    return LAYER_HEIGHTS.ORCA.some((value) => Math.abs(value - layerHeight) < 1e-9);
}

/**
 * Validate material selection for the selected technology.
 * @param {'FDM'|'SLA'} technology Technology key.
 * @param {string} material Requested material.
 * @returns {{isValid: true} | {isValid: false, response: {success: false, error: string, errorCode: string}}} Validation result.
 */
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

/**
 * Validate layer-height constraints per endpoint/forced technology mode.
 * @param {number} layerHeight Requested layer height.
 * @param {'FDM'|'SLA'|null} forcedTechnology Forced technology from endpoint mode.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @returns {{success: false, error: string, errorCode: string} | null} Error response payload or null when valid.
 */
function validateLayerHeightSelection(layerHeight, forcedTechnology, engine) {
    if (engine === 'prusa' && !forcedTechnology && !validateLayerHeightForPrusa(layerHeight)) {
        return {
            success: false,
            error: 'Invalid layerHeight for PrusaSlicer. Allowed values: 0.025, 0.05, 0.1, 0.2, 0.3',
            errorCode: 'INVALID_LAYER_HEIGHT_FOR_ENGINE'
        };
    }

    if (engine === 'orca' && !validateLayerHeightForOrca(layerHeight)) {
        return {
            success: false,
            error: 'Invalid layerHeight for OrcaSlicer. Allowed values: 0.1, 0.2, 0.3',
            errorCode: 'INVALID_LAYER_HEIGHT_FOR_ENGINE'
        };
    }

    if (engine !== 'orca' && forcedTechnology && !validateLayerHeightForTechnology(forcedTechnology, layerHeight)) {
        const allowedMessage = forcedTechnology === 'SLA' ? '0.025, 0.05' : '0.1, 0.2, 0.3';
        return {
            success: false,
            error: `Invalid layerHeight for ${forcedTechnology}. Allowed values: ${allowedMessage}`,
            errorCode: 'INVALID_LAYER_HEIGHT_FOR_TECHNOLOGY'
        };
    }

    return null;
}

/**
 * Parse and sanitize profile override fields from request body.
 * @param {Record<string, unknown>} body Request payload.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @returns {{isValid: true, profileOverrides: {prusaProfile: string | null, orcaMachineProfile: string | null, orcaProcessProfile: string | null}} | {isValid: false, response: {success: false, error: string, errorCode: string}}} Parsed profile overrides.
 */
function parseProfileOverrides(body, engine) {
    if (engine === 'orca') {
        const machineProfileRaw = pickFirstNonEmptyValue(body, ['printerProfile', 'orcaMachineProfile']);
        const processProfileRaw = pickFirstNonEmptyValue(body, ['processProfile', 'orcaProcessProfile']);

        const machineProfile = sanitizeProfileFileName(machineProfileRaw, '.json');
        if (machineProfile.error) {
            return {
                isValid: false,
                response: {
                    success: false,
                    error: `Invalid Orca machine profile: ${machineProfile.error}`,
                    errorCode: 'INVALID_PROFILE_NAME'
                }
            };
        }

        const processProfile = sanitizeProfileFileName(processProfileRaw, '.json');
        if (processProfile.error) {
            return {
                isValid: false,
                response: {
                    success: false,
                    error: `Invalid Orca process profile: ${processProfile.error}`,
                    errorCode: 'INVALID_PROFILE_NAME'
                }
            };
        }

        return {
            isValid: true,
            profileOverrides: {
                orcaMachineProfile: machineProfile.value,
                orcaProcessProfile: processProfile.value,
                prusaProfile: null
            }
        };
    }

    const prusaProfileRaw = pickFirstNonEmptyValue(body, ['printerProfile', 'prusaProfile', 'profile']);
    const prusaProfile = sanitizeProfileFileName(prusaProfileRaw, '.ini');
    if (prusaProfile.error) {
        return {
            isValid: false,
            response: {
                success: false,
                error: `Invalid Prusa profile: ${prusaProfile.error}`,
                errorCode: 'INVALID_PROFILE_NAME'
            }
        };
    }

    return {
        isValid: true,
        profileOverrides: {
            prusaProfile: prusaProfile.value,
            orcaMachineProfile: null,
            orcaProcessProfile: null
        }
    };
}

/**
 * Parse size/scale/rotation transform options from request payload.
 * @param {Record<string, unknown>} body Request payload.
 * @returns {{isValid: true, options: {unit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, targetSizeMm: {x: number | null, y: number | null, z: number | null}, scalePercent: number | null, rotationDeg: {x: number, y: number, z: number}}} | {isValid: false, response: {success: false, error: string, errorCode: string}}} Parsed transform options.
 */
function parseTransformOptions(body) {
    const unitRaw = pickFirstNonEmptyValue(body, ['sizeUnit', 'unit', 'dimensionUnit']);
    const normalizedUnit = normalizeSizeUnit(unitRaw);
    if (!normalizedUnit.isValid) {
        return {
            isValid: false,
            response: {
                success: false,
                error: normalizedUnit.error,
                errorCode: 'INVALID_SIZE_UNIT'
            }
        };
    }

    let keepProportions = true;
    const keepRaw = pickFirstNonEmptyValue(body, ['keepProportions', 'lockProportions']);
    if (keepRaw === undefined) {
        const unlockRaw = pickFirstNonEmptyValue(body, ['unlockProportions', 'allowNonProportional']);
        if (unlockRaw !== undefined) {
            const parsed = parseBooleanLike(unlockRaw);
            if (parsed === null) {
                return {
                    isValid: false,
                    response: {
                        success: false,
                        error: 'Invalid unlockProportions value. Allowed values: true/false.',
                        errorCode: 'INVALID_KEEP_PROPORTIONS'
                    }
                };
            }
            keepProportions = !parsed;
        }
    } else {
        const parsed = parseBooleanLike(keepRaw);
        if (parsed === null) {
            return {
                isValid: false,
                response: {
                    success: false,
                    error: 'Invalid keepProportions value. Allowed values: true/false.',
                    errorCode: 'INVALID_KEEP_PROPORTIONS'
                }
            };
        }
        keepProportions = parsed;
    }

    const targetX = parseOptionalPositiveField(body, ['targetSizeX', 'sizeX', 'dimensionX', 'targetX'], 'targetSizeX');
    const targetY = parseOptionalPositiveField(body, ['targetSizeY', 'sizeY', 'dimensionY', 'targetY'], 'targetSizeY');
    const targetZ = parseOptionalPositiveField(body, ['targetSizeZ', 'sizeZ', 'dimensionZ', 'targetZ'], 'targetSizeZ');
    const scalePercent = parseOptionalPositiveField(body, ['scalePercent'], 'scalePercent');

    if (targetX.error || targetY.error || targetZ.error || scalePercent.error) {
        return {
            isValid: false,
            response: {
                success: false,
                error: targetX.error || targetY.error || targetZ.error || scalePercent.error,
                errorCode: 'INVALID_SIZE_OPTIONS'
            }
        };
    }

    const requestedTargetSize = {
        x: targetX.value,
        y: targetY.value,
        z: targetZ.value
    };
    const hasTargetSize = requestedTargetSize.x !== null || requestedTargetSize.y !== null || requestedTargetSize.z !== null;

    if (hasTargetSize && scalePercent.value !== null) {
        return {
            isValid: false,
            response: {
                success: false,
                error: 'Use either scalePercent or targetSizeX/Y/Z in one request, not both.',
                errorCode: 'CONFLICTING_SIZE_OPTIONS'
            }
        };
    }

    const rotateX = parseOptionalFiniteField(body, ['rotationX', 'rotateX'], 'rotationX');
    const rotateY = parseOptionalFiniteField(body, ['rotationY', 'rotateY'], 'rotationY');
    const rotateZ = parseOptionalFiniteField(body, ['rotationZ', 'rotateZ'], 'rotationZ');

    if (rotateX.error || rotateY.error || rotateZ.error) {
        return {
            isValid: false,
            response: {
                success: false,
                error: rotateX.error || rotateY.error || rotateZ.error,
                errorCode: 'INVALID_ROTATION_OPTIONS'
            }
        };
    }

    return {
        isValid: true,
        options: {
            unit: normalizedUnit.value,
            keepProportions,
            requestedTargetSize,
            targetSizeMm: normalizeAxisDimensions(requestedTargetSize, normalizedUnit.value),
            scalePercent: scalePercent.value,
            rotationDeg: {
                x: rotateX.value ?? 0,
                y: rotateY.value ?? 0,
                z: rotateZ.value ?? 0
            }
        }
    };
}

/**
 * Parse and validate full slicing option set from request body.
 * @param {Record<string, unknown>} body Request payload.
 * @param {'FDM'|'SLA'|null} forcedTechnology Endpoint-forced technology.
 * @param {'prusa'|'orca'} [engine='prusa'] Slicer engine key.
 * @returns {{isValid: true, options: {layerHeight: number, material: string, depth: number, infillPercentage: string, technology: 'FDM'|'SLA', transformOptions: {unit: 'mm'|'inch', keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, targetSizeMm: {x: number | null, y: number | null, z: number | null}, scalePercent: number | null, rotationDeg: {x: number, y: number, z: number}}, profileOverrides: {prusaProfile: string | null, orcaMachineProfile: string | null, orcaProcessProfile: string | null}}} | {isValid: false, response: {success: false, error: string, errorCode: string}}} Parse result.
 */
function parseSliceOptions(body, forcedTechnology, engine = 'prusa') {
    const input = body || {};

    const layerHeight = normalizeLayerHeight(input.layerHeight || `${DEFAULTS.DEFAULT_LAYER_HEIGHT}`);
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

    const material = input.material || DEFAULTS.DEFAULT_FDM_MATERIAL;
    const parsedDepth = parseNumberLike(input.depth || `${DEFAULTS.DEFAULT_RELIEF_DEPTH_MM}`);
    const depth = Number.isFinite(parsedDepth) && parsedDepth > 0
        ? parsedDepth
        : DEFAULTS.DEFAULT_RELIEF_DEPTH_MM;

    let infillRaw = Number.parseInt(input.infill, 10);
    if (Number.isNaN(infillRaw)) infillRaw = DEFAULTS.DEFAULT_INFIL_PERCENT;
    infillRaw = Math.max(0, Math.min(100, infillRaw));
    const infillPercentage = `${infillRaw}%`;

    const transformOptionsResult = parseTransformOptions(input);
    if (!transformOptionsResult.isValid) {
        return {
            isValid: false,
            response: transformOptionsResult.response
        };
    }

    const profileOverridesResult = parseProfileOverrides(input, engine);
    if (!profileOverridesResult.isValid) {
        return {
            isValid: false,
            response: profileOverridesResult.response
        };
    }

    const technology = forcedTechnology || (layerHeight <= 0.05 ? 'SLA' : 'FDM');
    const layerHeightValidationError = validateLayerHeightSelection(layerHeight, forcedTechnology, engine);
    if (layerHeightValidationError) {
        return {
            isValid: false,
            response: layerHeightValidationError
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
            technology,
            transformOptions: transformOptionsResult.options,
            profileOverrides: profileOverridesResult.profileOverrides
        }
    };
}

module.exports = {
    parseSliceOptions,
    validateMaterialForTechnology
};
