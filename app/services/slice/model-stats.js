/**
 * Model metadata and slicing output statistics parsing.
 */

const fs = require('node:fs');
const { DEFAULTS } = require('../../config/constants');
const { runCommand } = require('./command');
const { readGcodeMetadata } = require('./gcode-metadata');
const { readSl1Metadata } = require('./sla-stats');

/**
 * Read model dimensions from `prusa-slicer --info` output.
 * @param {string} filePath Path to mesh file.
 * @returns {Promise<{x: number, y: number, z: number, height_mm: number}>} Parsed size metrics.
 */
async function getModelInfo(filePath) {
    try {
        const { stdout } = await runCommand('prusa-slicer', ['--info', filePath]);
        let x = 0;
        let y = 0;
        let z = 0;

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
 * Round to 3 decimals.
 * @param {number} value Number to round.
 * @returns {number} Rounded number.
 */
function round3(value) {
    return Math.round((Number(value) || 0) * 1000) / 1000;
}

/**
 * Parse FDM output metadata from bounded head/tail G-code chunks.
 * @param {object} stats Mutable stats object.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {string} filePath Output file path.
 * @param {'prusa'|'orca'} [engine='prusa'] Engine identifier.
 * @returns {Promise<void>}
 */
async function parseFdmOutputStats(stats, technology, filePath, engine = 'prusa') {
    if (technology !== 'FDM' || !fs.existsSync(filePath)) return;

    try {
        const meta = await readGcodeMetadata(filePath);
        stats.print_time_seconds = meta.print_time_seconds;
        stats.material_used_m = round3(meta.material_used_m);
        stats.material_used_g = round3(meta.material_used_g);
        stats.material_used_ml = round3(meta.material_used_ml);
        if (meta.print_time_seconds > 0) stats.print_time_source = 'slicer';

        if (engine === 'orca' && stats.print_time_seconds === 0) {
            console.warn('[WARN] Orca output parsed without explicit print time metadata.');
        }
    } catch (error_) {
        console.error('[PARSER ERROR]', error_.message);
    }
}

/**
 * Parse real SLA time/material from the .sl1 archive; heuristic is fallback only.
 * @param {object} stats Mutable stats object.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {string} filePath Output file path.
 * @returns {Promise<void>}
 */
async function parseSlaOutputStats(stats, technology, filePath) {
    if (technology !== 'SLA' || !fs.existsSync(filePath)) return;

    try {
        const meta = await readSl1Metadata(filePath);
        if (!meta) return;
        stats.print_time_seconds = meta.print_time_seconds;
        stats.material_used_ml = round3(meta.material_used_ml);
        stats.print_time_source = 'slicer';
    } catch (error_) {
        console.warn(`[WARN] Could not parse SL1 metadata, using estimate: ${error_.message}`);
    }
}

/**
 * Backfill SLA print-time estimate when real metadata is missing.
 * @param {object} stats Mutable stats object.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number|string} layerHeight Active layer height.
 * @returns {void}
 */
function applySlaEstimateIfNeeded(stats, technology, layerHeight) {
    if (technology !== 'SLA' || stats.print_time_seconds > 0 || stats.object_height_mm <= 0) return;

    const totalLayers = Math.ceil(
        stats.object_height_mm / Math.max(Number.parseFloat(layerHeight), DEFAULTS.SLA_MIN_LAYER_HEIGHT_MM)
    );
    stats.print_time_seconds = DEFAULTS.SLA_BASE_TIME_SECONDS + (totalLayers * DEFAULTS.SLA_SECONDS_PER_LAYER);
    stats.print_time_source = 'estimate';
}

/**
 * Build normalized human-readable print time string from seconds.
 * "(Est.)" is appended only when the time is estimated.
 * @param {object} stats Mutable stats object.
 * @returns {void}
 */
function finalizeReadableTime(stats) {
    if (stats.print_time_seconds <= 0) return;

    const h = Math.floor(stats.print_time_seconds / 3600);
    const m = Math.floor((stats.print_time_seconds % 3600) / 60);
    stats.print_time_readable = `${h}h ${m}m${stats.print_time_source === 'estimate' ? ' (Est.)' : ''}`;
}

/**
 * Build normalized print statistics from generated slicer output.
 * @param {string} filePath Output path to `.gcode` or `.sl1` artifact.
 * @param {'FDM' | 'SLA'} technology Active print technology.
 * @param {number|string} layerHeight Requested layer height.
 * @param {number} knownHeight Known model height in millimeters.
 * @param {'prusa'|'orca'} engine Slicer engine.
 * @returns {Promise<{print_time_seconds: number, print_time_readable: string, print_time_source: 'slicer'|'estimate', material_used_m: number, material_used_g: number, material_used_ml: number, object_height_mm: number, estimated_price_huf: number}>}
 */
async function parseOutputDetailed(filePath, technology, layerHeight, knownHeight, engine = 'prusa') {
    const stats = {
        print_time_seconds: 0,
        print_time_readable: 'Unknown',
        print_time_source: 'estimate',
        material_used_m: 0,
        material_used_g: 0,
        material_used_ml: 0,
        object_height_mm: knownHeight || 0,
        estimated_price_huf: 0
    };

    await parseFdmOutputStats(stats, technology, filePath, engine);
    await parseSlaOutputStats(stats, technology, filePath);
    applySlaEstimateIfNeeded(stats, technology, layerHeight);
    finalizeReadableTime(stats);

    return stats;
}

module.exports = {
    getModelInfo,
    parseOutputDetailed
};
