/**
 * Input conversion and orientation pipeline helpers.
 */

const fs = require('node:fs');
const path = require('node:path');
const { EXTENSIONS } = require('../../config/constants');
const { PYTHON_EXECUTABLE } = require('../../config/python');
const { runCommand } = require('./command');

/**
 * Convert supported non-STL inputs to STL for downstream slicing.
 * @param {string} processableFile Source file path.
 * @param {string[]} filesCleanupList Temporary file collector.
 * @returns {Promise<string>} Final STL-compatible file path.
 */
async function convertInputToStl(processableFile, filesCleanupList) {
    const currentExt = path.extname(processableFile).toLowerCase();
    let finalStlPath = processableFile;

    if (['.obj', '.3mf', '.ply'].includes(currentExt)) {
        console.log('[INFO] Converting Mesh to STL...');
        finalStlPath = processableFile + '.stl';
        filesCleanupList.push(finalStlPath);
        await runCommand(PYTHON_EXECUTABLE, ['mesh2stl.py', processableFile, finalStlPath]);
        return finalStlPath;
    }

    if (EXTENSIONS.cad.includes(currentExt)) {
        console.log('[INFO] Converting CAD to STL...');
        finalStlPath = processableFile + '.stl';
        filesCleanupList.push(finalStlPath);
        await runCommand(PYTHON_EXECUTABLE, ['cad2stl.py', processableFile, finalStlPath]);
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
        await runCommand(PYTHON_EXECUTABLE, ['orient.py', processableFile, orientedStlPath, technology]);
        if (fs.existsSync(orientedStlPath)) {
            filesCleanupList.push(orientedStlPath);
            return orientedStlPath;
        }
    } catch (error_) {
        console.warn(`[WARN] Orientation optimization failed, proceeding with original. Error: ${error_.message}`);
    }

    return processableFile;
}

const RESULT_MARKER = '@@RESULT@@';

/**
 * Extract the geometry JSON line emitted by preprocess.py.
 * @param {string} stdout Python stdout.
 * @returns {{x: number, y: number, z: number, height_mm: number, volume_mm3: number, surface_area_mm2: number, is_watertight: boolean, triangle_count: number}} Model info.
 */
function parsePreprocessResult(stdout) {
    const line = String(stdout || '').split(/\r?\n/).reverse().find((l) => l.startsWith(RESULT_MARKER));
    if (!line) {
        throw new Error('preprocess.py did not return a result line.');
    }
    const data = JSON.parse(line.slice(RESULT_MARKER.length));
    return { ...data, height_mm: data.z };
}

/**
 * Convert CAD inputs (.step/.stp/.igs/.iges) to STL. Non-CAD paths are returned unchanged.
 * @param {string} processableFile Source file path.
 * @param {string[]} filesCleanupList Temporary file collector.
 * @returns {Promise<string>} STL path (or original path for mesh formats).
 */
async function convertCadToStl(processableFile, filesCleanupList) {
    const currentExt = path.extname(processableFile).toLowerCase();
    if (!EXTENSIONS.cad.includes(currentExt)) return processableFile;
    console.log('[INFO] Converting CAD to STL...');
    const finalStlPath = processableFile + '.stl';
    filesCleanupList.push(finalStlPath);
    await runCommand(PYTHON_EXECUTABLE, ['cad2stl.py', processableFile, finalStlPath]);
    return finalStlPath;
}

/**
 * Single Python pass: load (STL/OBJ/3MF/PLY), optional orientation, plate placement, STL export, stats.
 * Geometry failures propagate (fail-fast, no fallback).
 * @param {string} processableFile STL or mesh file path (post CAD conversion).
 * @param {'FDM'|'SLA'} technology Active technology.
 * @param {boolean} autoOrient Whether to run orientation optimization.
 * @param {string[]} filesCleanupList Temporary file collector.
 * @returns {Promise<{processableFile: string, modelInfo: {x: number, y: number, z: number, height_mm: number, volume_mm3: number, surface_area_mm2: number, is_watertight: boolean, triangle_count: number}}>} Prepared model.
 */
async function preprocessModel(processableFile, technology, autoOrient, filesCleanupList) {
    console.log(`[INFO] Preprocessing model (${technology}, autoOrient=${autoOrient})...`);
    const outputPath = `${processableFile}_pre_${Date.now()}.stl`;
    filesCleanupList.push(outputPath);
    const { stdout } = await runCommand(PYTHON_EXECUTABLE, [
        'preprocess.py', 'preprocess', processableFile, outputPath,
        '--technology', technology,
        '--auto-orient', autoOrient ? '1' : '0'
    ]);
    return { processableFile: outputPath, modelInfo: parsePreprocessResult(stdout) };
}

module.exports = {
    convertInputToStl,
    tryOptimizeOrientation,
    convertCadToStl,
    preprocessModel,
    parsePreprocessResult
};
