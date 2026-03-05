/**
 * Input conversion and orientation pipeline helpers.
 */

const fs = require('node:fs');
const path = require('node:path');
const { EXTENSIONS } = require('../../config/constants');
const { runCommand } = require('./command');

/**
 * Convert supported non-STL inputs to STL for downstream slicing.
 * @param {string} processableFile Source file path.
 * @param {number} depth Relief depth for 2D-driven conversions.
 * @param {string[]} filesCleanupList Temporary file collector.
 * @returns {Promise<string>} Final STL-compatible file path.
 */
async function convertInputToStl(processableFile, depth, filesCleanupList) {
    const currentExt = path.extname(processableFile).toLowerCase();
    let finalStlPath = processableFile;

    if (EXTENSIONS.image.includes(currentExt)) {
        console.log(`[INFO] Converting Image to STL (Depth: ${depth}mm)...`);
        finalStlPath = processableFile + '.stl';
        filesCleanupList.push(finalStlPath);
        await runCommand(`python3 img2stl.py "${processableFile}" "${finalStlPath}" ${depth}`);
        return finalStlPath;
    }

    if (EXTENSIONS.vector.includes(currentExt)) {
        console.log(`[INFO] Converting Vector to STL (Depth: ${depth}mm)...`);
        finalStlPath = processableFile + '.stl';
        filesCleanupList.push(finalStlPath);
        await runCommand(`python3 vector2stl.py "${processableFile}" "${finalStlPath}" ${depth}`);
        return finalStlPath;
    }

    if (['.obj', '.3mf', '.ply'].includes(currentExt)) {
        console.log('[INFO] Converting Mesh to STL...');
        finalStlPath = processableFile + '.stl';
        filesCleanupList.push(finalStlPath);
        await runCommand(`python3 mesh2stl.py "${processableFile}" "${finalStlPath}"`);
        return finalStlPath;
    }

    if (EXTENSIONS.cad.includes(currentExt)) {
        console.log('[INFO] Converting CAD to STL...');
        finalStlPath = processableFile + '.stl';
        filesCleanupList.push(finalStlPath);
        await runCommand(`python3 cad2stl.py "${processableFile}" "${finalStlPath}"`);
        return finalStlPath;
    }

    return finalStlPath;
}

/**
 * Attempt orientation optimization and fall back to original file on failure.
 * @param {string} processableFile STL input path.
 * @param {'FDM'|'SLA'} technology Active technology mode.
 * @param {string[]} filesCleanupList Temporary file collector.
 * @returns {Promise<string>} Optimized or original STL path.
 */
async function tryOptimizeOrientation(processableFile, technology, filesCleanupList) {
    console.log(`[INFO] Optimizing orientation for ${technology}...`);
    const orientedStlPath = processableFile.replace('.stl', '_oriented.stl');

    try {
        await runCommand(`python3 orient.py "${processableFile}" "${orientedStlPath}" ${technology}`);
        if (fs.existsSync(orientedStlPath)) {
            filesCleanupList.push(orientedStlPath);
            return orientedStlPath;
        }
    } catch (error_) {
        console.warn(`[WARN] Orientation optimization failed, proceeding with original. Error: ${error_.message}`);
    }

    return processableFile;
}

module.exports = {
    convertInputToStl,
    tryOptimizeOrientation
};
