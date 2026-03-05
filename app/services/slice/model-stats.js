/**
 * Model metadata and slicing output statistics parsing.
 */

const fs = require('node:fs');
const { DEFAULTS } = require('../../config/constants');
const { runCommand } = require('./command');

/**
 * Read model dimensions from `prusa-slicer --info` output.
 * @param {string} filePath Path to mesh file.
 * @returns {Promise<{x: number, y: number, z: number, height_mm: number}>} Parsed size metrics.
 */
async function getModelInfo(filePath) {
    try {
        const { stdout } = await runCommand(`prusa-slicer --info "${filePath}"`);
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
 * Parse duration string (e.g. `1h 20m 10s`) into total seconds.
 * @param {string} timeStr Human-readable duration text.
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
 * Extract print-time metadata from G-code comment blocks.
 * @param {string} content Full G-code text content.
 * @returns {{print_time_seconds: number, print_time_readable: string}} Parsed print time payload.
 */
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

/**
 * Extract material usage in meters from G-code metadata comments.
 * @param {string} content Full G-code text content.
 * @returns {number} Material usage in meters.
 */
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

/**
 * Parse FDM-specific output metadata from generated G-code.
 * @param {{print_time_seconds: number, print_time_readable: string, material_used_m: number}} stats Mutable stats object.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {string} filePath Output file path.
 * @param {'prusa'|'orca'} [engine='prusa'] Engine identifier.
 * @returns {void}
 */
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

/**
 * Backfill SLA print-time estimate when explicit metadata is missing.
 * @param {{print_time_seconds: number, object_height_mm: number}} stats Mutable stats object.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {number|string} layerHeight Active layer height.
 * @returns {void}
 */
function applySlaEstimateIfNeeded(stats, technology, layerHeight) {
    if (technology !== 'SLA' || stats.print_time_seconds > 0 || stats.object_height_mm <= 0) return;

    const totalLayers = Math.ceil(
        stats.object_height_mm / Math.max(Number.parseFloat(layerHeight), DEFAULTS.SLA_MIN_LAYER_HEIGHT_MM)
    );
    const secondsPerLayer = DEFAULTS.SLA_SECONDS_PER_LAYER;
    const baseTime = DEFAULTS.SLA_BASE_TIME_SECONDS;
    stats.print_time_seconds = baseTime + (totalLayers * secondsPerLayer);
}

/**
 * Build normalized human-readable print time string from seconds.
 * @param {{print_time_seconds: number, print_time_readable: string}} stats Mutable stats object.
 * @param {'FDM'|'SLA'} technology Active technology.
 * @returns {void}
 */
function finalizeReadableTime(stats, technology) {
    if (stats.print_time_seconds <= 0) return;

    const h = Math.floor(stats.print_time_seconds / 3600);
    const m = Math.floor((stats.print_time_seconds % 3600) / 60);
    stats.print_time_readable = `${h}h ${m}m ${technology === 'SLA' ? '(Est.)' : ''}`;
}

/**
 * Build normalized print statistics from generated slicer output.
 * @param {string} filePath Output path to `.gcode` or `.sl1` artifact.
 * @param {'FDM' | 'SLA'} technology Active print technology.
 * @param {number|string} layerHeight Requested layer height.
 * @param {number} knownHeight Known model height in millimeters.
 * @param {'prusa'|'orca'} engine Slicer engine.
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

module.exports = {
    getModelInfo,
    parseOutputDetailed
};
