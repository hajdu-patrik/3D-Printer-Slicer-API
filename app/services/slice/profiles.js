/**
 * Slicer profile resolution, build-volume parsing, and runtime profile generation.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
    DEFAULTS,
    ORCA_PROCESS_PROFILE_BY_LAYER,
    MAX_BUILD_VOLUMES,
    MIN_BUILD_VOLUMES
} = require('../../config/constants');
const {
    OUTPUT_DIR,
    HELP_FILES_DIR,
    PRUSA_CONFIGS_DIR,
    ORCA_CONFIGS_DIR
} = require('../../config/paths');
const { parseNumberLike } = require('./value-parsers');
const { roundToThree, cleanupOrcaResultMetadata } = require('./common');

/**
 * Resolve Orca process profile filename from explicit override, env, or defaults.
 * @param {number|string} layerKey Requested layer key.
 * @param {string | null} [explicitProfile=null] Optional explicit process profile.
 * @returns {string} Resolved Orca process profile filename.
 */
function resolveOrcaProcessProfileName(layerKey, explicitProfile = null) {
    if (explicitProfile) return explicitProfile;

    const normalizedLayerKey = Number.parseFloat(layerKey).toFixed(1).replace('.', '_');
    const envKey = `ORCA_PROCESS_PROFILE_${normalizedLayerKey}`;
    const fromEnv = String(process.env[envKey] || '').trim();
    if (fromEnv) return fromEnv;

    const fallback = ORCA_PROCESS_PROFILE_BY_LAYER[Number.parseFloat(layerKey).toFixed(1)];
    if (fallback) return fallback;

    return `FDM_${Number.parseFloat(layerKey).toFixed(1)}mm.json`;
}

/**
 * Resolve base profile config file path for selected engine/technology.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number} layerHeight Active layer height.
 * @param {{prusaProfile?: string | null, orcaMachineProfile?: string | null, orcaProcessProfile?: string | null}} [profileOverrides={}] Optional profile overrides.
 * @returns {string} Absolute config file path.
 */
function resolveConfigPath(engine, technology, layerHeight, profileOverrides = {}) {
    const normalizedLayer = Number.parseFloat(layerHeight).toFixed(1);
    const profileName = engine === 'orca'
        ? resolveOrcaProcessProfileName(normalizedLayer, profileOverrides.orcaProcessProfile)
        : (profileOverrides.prusaProfile || `${technology}_${layerHeight}mm.ini`);

    const baseDir = engine === 'orca' ? ORCA_CONFIGS_DIR : PRUSA_CONFIGS_DIR;
    return path.join(baseDir, profileName);
}

/**
 * Resolve Orca machine profile path from override/env/default.
 * @param {{orcaMachineProfile?: string | null}} [profileOverrides={}] Optional profile overrides.
 * @returns {string} Absolute Orca machine profile path.
 */
function resolveOrcaMachineConfigPath(profileOverrides = {}) {
    const requested = String(profileOverrides.orcaMachineProfile || '').trim();
    const configured = String(process.env.ORCA_MACHINE_PROFILE || '').trim();
    const profileName = requested || configured || DEFAULTS.ORCA_DEFAULT_MACHINE_PROFILE;
    return path.join(ORCA_CONFIGS_DIR, profileName);
}

/**
 * Parse planar coordinate list into rectangular X/Y dimensions.
 * @param {unknown[]} rawPoints Planar point list.
 * @returns {{x: number, y: number} | null} Parsed planar dimensions or null.
 */
function parsePlanarCoordinates(rawPoints) {
    if (!Array.isArray(rawPoints) || rawPoints.length === 0) return null;

    const coords = [];
    for (const point of rawPoints) {
        if (typeof point !== 'string' && typeof point !== 'number' && typeof point !== 'bigint') continue;
        const match = /(-?\d+(?:\.\d+)?)x(-?\d+(?:\.\d+)?)/i.exec(String(point).trim());
        if (!match) continue;

        const x = Number.parseFloat(match[1]);
        const y = Number.parseFloat(match[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        coords.push({ x, y });
    }

    if (coords.length < 2) return null;

    const xValues = coords.map((item) => item.x);
    const yValues = coords.map((item) => item.y);

    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);

    const width = maxX - minX;
    const depth = maxY - minY;
    if (width <= 0 || depth <= 0) return null;

    return { x: width, y: depth };
}

/**
 * Read INI file into lowercase key/value map.
 * @param {string} filePath INI file path.
 * @returns {Record<string, string>} Parsed INI map.
 */
function readIniKeyValues(filePath) {
    const map = {};
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex < 0) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim();
        if (!key) continue;
        map[key.toLowerCase()] = value;
    }

    return map;
}

/**
 * Build default min/max build-volume limits for technology.
 * @param {string} profilePath Source profile path.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string}} Default limit object.
 */
function createDefaultBuildVolumeLimits(profilePath, technology) {
    const defaultMax = MAX_BUILD_VOLUMES[technology] || MAX_BUILD_VOLUMES.FDM;
    const defaultMin = MIN_BUILD_VOLUMES[technology] || MIN_BUILD_VOLUMES.FDM;
    return {
        min: { ...defaultMin },
        max: { ...defaultMax },
        sourceProfile: path.basename(profilePath)
    };
}

/**
 * Assign axis value only when finite and positive.
 * @param {{x?: number, y?: number, z?: number}} target Mutable target object.
 * @param {'x'|'y'|'z'} axis Axis key.
 * @param {number | null} value Candidate value.
 * @returns {void}
 */
function assignPositiveAxisValue(target, axis, value) {
    if (Number.isFinite(value) && value > 0) {
        target[axis] = value;
    }
}

/**
 * Apply axis values from generic object onto target bounds.
 * @param {{x?: number, y?: number, z?: number}} target Mutable target object.
 * @param {Record<string, unknown> | null | undefined} sourceObject Source object.
 * @returns {void}
 */
function applyAxisValuesFromObject(target, sourceObject) {
    if (!sourceObject || typeof sourceObject !== 'object') return;

    assignPositiveAxisValue(target, 'x', parseNumberLike(sourceObject.x));
    assignPositiveAxisValue(target, 'y', parseNumberLike(sourceObject.y));
    assignPositiveAxisValue(target, 'z', parseNumberLike(sourceObject.z));
}

/**
 * Apply axis values from INI map using configured key mapping.
 * @param {{x?: number, y?: number, z?: number}} target Mutable target object.
 * @param {Record<string, string>} iniMap INI key/value map.
 * @param {{x: string, y: string, z: string}} keyMap Axis-to-INI-key mapping.
 * @returns {void}
 */
function applyAxisValuesFromIniMap(target, iniMap, keyMap) {
    assignPositiveAxisValue(target, 'x', parseNumberLike(iniMap[keyMap.x]));
    assignPositiveAxisValue(target, 'y', parseNumberLike(iniMap[keyMap.y]));
    assignPositiveAxisValue(target, 'z', parseNumberLike(iniMap[keyMap.z]));
}

/**
 * Parse build-volume limits from Orca machine profile JSON.
 * @param {string} machineConfigPath Orca machine profile path.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string}} Parsed limits.
 */
function parseDimensionLimitsFromOrcaMachineProfile(machineConfigPath, technology) {
    const limits = createDefaultBuildVolumeLimits(machineConfigPath, technology);

    if (!machineConfigPath || !fs.existsSync(machineConfigPath)) return limits;

    const profileData = JSON.parse(fs.readFileSync(machineConfigPath, 'utf8'));
    const printableArea = parsePlanarCoordinates(profileData.printable_area);
    if (printableArea) {
        limits.max.x = printableArea.x;
        limits.max.y = printableArea.y;
    }

    assignPositiveAxisValue(limits.max, 'z', parseNumberLike(profileData.printable_height));
    applyAxisValuesFromObject(limits.min, profileData.min_printable_size);
    applyAxisValuesFromObject(limits.max, profileData.max_printable_size);

    return limits;
}

/**
 * Parse build-volume limits from Prusa INI profile.
 * @param {string} configPath Prusa profile path.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string}} Parsed limits.
 */
function parseDimensionLimitsFromPrusaProfile(configPath, technology) {
    const limits = createDefaultBuildVolumeLimits(configPath, technology);

    if (!configPath || !fs.existsSync(configPath)) return limits;

    const iniMap = readIniKeyValues(configPath);
    const bedShapeRaw = iniMap.bed_shape;
    if (bedShapeRaw) {
        const bedShape = parsePlanarCoordinates(String(bedShapeRaw).split(','));
        if (bedShape) {
            limits.max.x = bedShape.x;
            limits.max.y = bedShape.y;
        }
    }

    assignPositiveAxisValue(
        limits.max,
        'z',
        parseNumberLike(iniMap.max_print_height || iniMap.printable_height || iniMap.print_height)
    );

    applyAxisValuesFromIniMap(limits.min, iniMap, {
        x: 'min_print_size_x',
        y: 'min_print_size_y',
        z: 'min_print_size_z'
    });
    applyAxisValuesFromIniMap(limits.max, iniMap, {
        x: 'max_print_size_x',
        y: 'max_print_size_y',
        z: 'max_print_size_z'
    });

    return limits;
}

/**
 * Resolve effective build-volume limits for selected engine/profile pair.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {string} configFile Process/profile config file.
 * @param {string | null} orcaMachineConfigFile Orca machine config path.
 * @returns {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string}} Resolved limits.
 */
function resolveBuildVolumeLimits(engine, technology, configFile, orcaMachineConfigFile) {
    if (engine === 'orca') {
        return parseDimensionLimitsFromOrcaMachineProfile(orcaMachineConfigFile, technology);
    }

    return parseDimensionLimitsFromPrusaProfile(configFile, technology);
}

/**
 * Validate model dimensions against configured printer limits.
 * @param {{x: number|string, y: number|string, z: number|string}} modelInfo Model dimension payload.
 * @param {{min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string}} buildVolumeLimits Printer limits.
 * @returns {{isValid: true, dimensions: {x: number, y: number, z: number}} | {isValid: false, dimensions: {x: number, y: number, z: number}, tooSmall: string[], tooLarge: string[]}} Validation result.
 */
function validateModelDimensionsAgainstLimits(modelInfo, buildVolumeLimits) {
    const dimensions = {
        x: Number.parseFloat(modelInfo.x) || 0,
        y: Number.parseFloat(modelInfo.y) || 0,
        z: Number.parseFloat(modelInfo.z) || 0
    };

    const axes = ['x', 'y', 'z'];
    const tooSmall = [];
    const tooLarge = [];

    for (const axis of axes) {
        if (dimensions[axis] > 0 && dimensions[axis] < buildVolumeLimits.min[axis]) {
            tooSmall.push(`${axis.toUpperCase()}: ${roundToThree(dimensions[axis])}mm < ${roundToThree(buildVolumeLimits.min[axis])}mm`);
        }

        if (dimensions[axis] > buildVolumeLimits.max[axis]) {
            tooLarge.push(`${axis.toUpperCase()}: ${roundToThree(dimensions[axis])}mm > ${roundToThree(buildVolumeLimits.max[axis])}mm`);
        }
    }

    if (tooSmall.length === 0 && tooLarge.length === 0) {
        return {
            isValid: true,
            dimensions
        };
    }

    return {
        isValid: false,
        dimensions,
        tooSmall,
        tooLarge
    };
}

/**
 * Create temporary Orca process profile with runtime overrides.
 * @param {string} baseProcessProfilePath Source process profile path.
 * @param {number} layerHeight Requested layer height.
 * @param {string} infillPercentage Infill override.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @returns {string} Runtime profile path.
 */
function createOrcaRuntimeProcessProfile(baseProcessProfilePath, layerHeight, infillPercentage, filesCleanupList) {
    const profileData = JSON.parse(fs.readFileSync(baseProcessProfilePath, 'utf8'));
    profileData.layer_height = `${layerHeight}`;
    profileData.sparse_infill_density = infillPercentage;
    profileData.layer_gcode = 'G92 E0';
    profileData.use_relative_e_distances = '0';

    const runtimeProfilePath = path.join(HELP_FILES_DIR, `orca_runtime_${Date.now()}_${Math.floor(Math.random() * 100000)}.json`);
    fs.writeFileSync(runtimeProfilePath, JSON.stringify(profileData, null, 4));
    filesCleanupList.push(runtimeProfilePath);

    return runtimeProfilePath;
}

/**
 * Insert or replace INI key value pair in textual INI content.
 * @param {string} content Original INI content.
 * @param {string} key INI key to update.
 * @param {string} value INI value to set.
 * @returns {string} Updated INI content.
 */
function upsertIniKey(content, key, value) {
    const escapedKey = key.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const keyPattern = new RegExp(String.raw`^\s*${escapedKey}\s*=`);
    const lines = String(content || '').split(/\r\n|\n|\r/);

    while (lines.length > 0 && lines.at(-1) === '') {
        lines.pop();
    }

    let replaced = false;
    const updatedLines = lines.map((line) => {
        if (!replaced && keyPattern.test(line)) {
            replaced = true;
            return `${key} = ${value}`;
        }
        return line;
    });

    if (!replaced) {
        updatedLines.push(`${key} = ${value}`);
    }

    return `${updatedLines.join('\n')}\n`;
}

/**
 * Create temporary Prusa runtime profile with request-time overrides.
 * @param {string} baseConfigPath Source profile path.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number} layerHeight Requested layer height.
 * @param {string} infillPercentage Infill override.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @returns {string} Runtime profile path.
 */
function createPrusaRuntimeProfile(baseConfigPath, technology, layerHeight, infillPercentage, filesCleanupList) {
    let iniContent = fs.readFileSync(baseConfigPath, 'utf8');
    iniContent = upsertIniKey(iniContent, 'layer_height', `${layerHeight}`);

    if (technology === 'FDM') {
        iniContent = upsertIniKey(iniContent, 'fill_density', infillPercentage);
    }

    const runtimeProfilePath = path.join(HELP_FILES_DIR, `prusa_runtime_${Date.now()}_${Math.floor(Math.random() * 100000)}.ini`);
    fs.writeFileSync(runtimeProfilePath, iniContent);
    filesCleanupList.push(runtimeProfilePath);

    return runtimeProfilePath;
}

/**
 * Create runtime slicer profile for selected engine.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @param {string} baseConfigFile Source config path.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number} layerHeight Requested layer height.
 * @param {string} infillPercentage Infill override.
 * @param {string[]} filesCleanupList Cleanup collector.
 * @returns {string} Runtime profile path.
 */
function createRuntimeSlicerProfile(engine, baseConfigFile, technology, layerHeight, infillPercentage, filesCleanupList) {
    if (engine === 'orca') {
        return createOrcaRuntimeProcessProfile(baseConfigFile, layerHeight, infillPercentage, filesCleanupList);
    }

    return createPrusaRuntimeProfile(baseConfigFile, technology, layerHeight, infillPercentage, filesCleanupList);
}

/**
 * Validate and resolve profile file selection for request.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number} layerHeight Requested layer height.
 * @param {{prusaProfile?: string | null, orcaMachineProfile?: string | null, orcaProcessProfile?: string | null}} profileOverrides Profile overrides.
 * @returns {{isValid: true, baseConfigFile: string, orcaMachineConfigFile: string | null} | {isValid: false, status: number, response: {success: false, error: string, errorCode: string}}} Selection result.
 */
function resolveProfileSelection(engine, technology, layerHeight, profileOverrides) {
    const baseConfigFile = resolveConfigPath(engine, technology, layerHeight, profileOverrides);
    const orcaMachineConfigFile = engine === 'orca'
        ? resolveOrcaMachineConfigPath(profileOverrides)
        : null;

    if (!fs.existsSync(baseConfigFile)) {
        return {
            isValid: false,
            status: 400,
            response: {
                success: false,
                error: `Selected profile file not found: ${path.basename(baseConfigFile)}`,
                errorCode: 'PROFILE_NOT_FOUND'
            }
        };
    }

    if (engine === 'orca' && (!orcaMachineConfigFile || !fs.existsSync(orcaMachineConfigFile))) {
        return {
            isValid: false,
            status: 400,
            response: {
                success: false,
                error: `Selected Orca machine profile not found: ${path.basename(orcaMachineConfigFile || '')}`,
                errorCode: 'PROFILE_NOT_FOUND'
            }
        };
    }

    return {
        isValid: true,
        baseConfigFile,
        orcaMachineConfigFile
    };
}

/**
 * Emit selected profile info to logs.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @param {string | null} orcaMachineConfigFile Orca machine profile path.
 * @param {string} baseConfigFile Process/base profile path.
 * @param {string} infillPercentage Infill override.
 * @param {number} layerHeight Layer height override.
 * @returns {void}
 */
function logEngineProfileSelection(engine, orcaMachineConfigFile, baseConfigFile, infillPercentage, layerHeight) {
    if (engine === 'orca') {
        console.log(`[INFO] Slicing with ${path.basename(orcaMachineConfigFile)} + ${path.basename(baseConfigFile)} (infill override: ${infillPercentage})...`);
        return;
    }

    console.log(`[INFO] Slicing with ${path.basename(baseConfigFile)} (runtime layer=${layerHeight}, infill=${infillPercentage})...`);
}

/**
 * Apply engine-specific post-processing cleanup.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @returns {void}
 */
function finalizeEngineMetadata(engine) {
    if (engine === 'orca') {
        cleanupOrcaResultMetadata(OUTPUT_DIR);
    }
}

module.exports = {
    resolveConfigPath,
    resolveOrcaMachineConfigPath,
    resolveBuildVolumeLimits,
    validateModelDimensionsAgainstLimits,
    createRuntimeSlicerProfile,
    resolveProfileSelection,
    logEngineProfileSelection,
    finalizeEngineMetadata
};
