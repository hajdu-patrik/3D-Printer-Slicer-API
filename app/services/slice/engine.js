/**
 * Slicer engine command composition helpers.
 */

const path = require('node:path');

/**
 * Resolve slicer executable name from engine identifier.
 * @param {'prusa'|'orca'} engine Slicer engine key.
 * @returns {'prusa-slicer'|'orca-slicer'} CLI executable name.
 */
function resolveSlicerExecutable(engine) {
    return engine === 'orca' ? 'orca-slicer' : 'prusa-slicer';
}

/**
 * Default bed center used when a profile exposes no parsable bed_shape.
 * Matches the PrusaSlicer default 200x200 bed.
 */
const DEFAULT_PRUSA_BED_CENTER = Object.freeze({ x: 100, y: 100 });

/**
 * Format a bed center for the PrusaSlicer `--center` option.
 * @param {{x: number, y: number} | null | undefined} bedCenter Bed center in mm.
 * @returns {string} `X,Y` value.
 */
function formatPrusaCenter(bedCenter) {
    const valid = bedCenter && Number.isFinite(bedCenter.x) && Number.isFinite(bedCenter.y);
    const center = valid ? bedCenter : DEFAULT_PRUSA_BED_CENTER;
    return `${center.x},${center.y}`;
}

/**
 * Build command-line arguments array for selected slicer engine and technology.
 * @param {'FDM'|'SLA'} technology Active print technology.
 * @param {string} configFile Runtime profile/config path.
 * @param {string} outputPath Desired output artifact path.
 * @param {string} infillPercentage Infill override (e.g. `20%`).
 * @param {'prusa'|'orca'} [engine='prusa'] Selected slicer engine.
 * @param {string | null} [orcaMachineConfigPath=null] Orca machine profile path.
 * @param {{x: number, y: number} | null} [prusaBedCenter=null] Prusa bed center from the profile bed_shape (falls back to 100,100).
 * @param {string | null} [orcaFilamentConfigPath=null] Optional Orca filament JSON passed via --load-filaments.
 * @returns {string[]} CLI argument array.
 */
function buildSlicerCommandArgs(
    technology,
    configFile,
    outputPath,
    infillPercentage,
    engine = 'prusa',
    orcaMachineConfigPath = null,
    prusaBedCenter = null,
    orcaFilamentConfigPath = null
) {
    if (engine === 'orca') {
        const outputDir = path.dirname(outputPath);
        const settingsFiles = [orcaMachineConfigPath, configFile].filter(Boolean).join(';');
        // --orient 0: keep the orientation already optimized by orient.py (Orca would otherwise re-orient).
        // --arrange 1: still needed to place the model on the plate (non-3MF input is always arranged).
        const args = ['--load-settings', settingsFiles];
        if (orcaFilamentConfigPath) {
            args.push('--load-filaments', orcaFilamentConfigPath);
        }
        args.push('--arrange', '1', '--orient', '0', '--slice', '0', '--outputdir', outputDir);
        return args;
    }

    const args = ['--load', configFile, '--center', formatPrusaCenter(prusaBedCenter)];

    if (technology === 'SLA') {
        args.push('--export-sla', '--output', outputPath);
    } else {
        args.push('--support-material', '--support-material-auto');
        args.push('--gcode-flavor', 'marlin', '--export-gcode', '--output', outputPath, '--fill-density', infillPercentage);
    }

    return args;
}

module.exports = {
    resolveSlicerExecutable,
    buildSlicerCommandArgs
};
