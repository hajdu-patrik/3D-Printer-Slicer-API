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
 * Build command-line arguments for selected slicer engine and technology.
 * @param {'FDM'|'SLA'} technology Active print technology.
 * @param {string} configFile Runtime profile/config path.
 * @param {string} outputPath Desired output artifact path.
 * @param {string} infillPercentage Infill override (e.g. `20%`).
 * @param {'prusa'|'orca'} [engine='prusa'] Selected slicer engine.
 * @param {string | null} [orcaMachineConfigPath=null] Orca machine profile path.
 * @returns {string} CLI argument string.
 */
function buildSlicerCommandArgs(technology, configFile, outputPath, infillPercentage, engine = 'prusa', orcaMachineConfigPath = null) {
    if (engine === 'orca') {
        const outputDir = path.dirname(outputPath);
        const settingsFiles = [orcaMachineConfigPath, configFile].filter(Boolean).join(';');
        return `--load-settings "${settingsFiles}" --arrange 1 --orient 1 --slice 0 --outputdir "${outputDir}"`;
    }

    let slicerArgs = `--load "${configFile}"`;
    slicerArgs += ' --center 100,100';

    if (technology === 'SLA') {
        slicerArgs += ` --export-sla --output "${outputPath}"`;
    } else {
        slicerArgs += ' --support-material --support-material-auto';
        slicerArgs += ` --gcode-flavor marlin --export-gcode --output "${outputPath}" --fill-density ${infillPercentage}`;
    }

    return slicerArgs;
}

module.exports = {
    resolveSlicerExecutable,
    buildSlicerCommandArgs
};
