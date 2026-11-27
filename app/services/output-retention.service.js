/**
 * Periodic retention cleanup for generated output artifacts and stale upload temp files.
 *
 * Safety: never follows symlinks (lstat only), deletes only allowlisted names, and verifies
 * containment inside the real runtime directory before every deletion.
 */

const fs = require('node:fs');
const path = require('node:path');
const { OUTPUT_DIR, HELP_FILES_DIR } = require('../config/paths');
const { parseNonNegativeInt } = require('../utils/env');

const HOUR_MS = 60 * 60 * 1000;
const OUTPUT_RETENTION_HOURS = parseNonNegativeInt(process.env.OUTPUT_RETENTION_HOURS, 168);
const UPLOAD_TEMP_RETENTION_MINUTES = parseNonNegativeInt(process.env.UPLOAD_TEMP_RETENTION_MINUTES, 60);
const CLEANUP_INTERVAL_MS = Math.max(
    60_000,
    parseNonNegativeInt(process.env.OUTPUT_CLEANUP_INTERVAL_MS, HOUR_MS)
);

const ALLOWED_OUTPUT_EXTENSIONS = new Set(['.gcode', '.sl1']);
/** Isolated dirs are created by createIsolatedOutputDir(): `orca-job-<ms>-<random>`. */
const ISOLATED_DIR_PATTERN = /^orca-job-\d+-[a-z0-9]+$/;
/** Multer temp names are 32 hex chars; derived artifacts keep that prefix. */
const UPLOAD_TEMP_PATTERN = /^[0-9a-f]{32}/;
/** Never delete isolated dirs younger than this, regardless of configuration (active slice safety). */
const MIN_ISOLATED_DIR_AGE_MS = HOUR_MS;

function isPathWithin(parentPath, candidatePath) {
    const relative = path.relative(parentPath, candidatePath);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Sweep one directory, deleting entries accepted by `shouldDelete`.
 * @param {string} rootDir Runtime directory.
 * @param {(entry: {name: string, stats: import('node:fs').Stats}) => boolean} shouldDelete Predicate on lstat results.
 * @returns {number} Number of removed entries.
 */
function sweepDirectory(rootDir, shouldDelete) {
    let realRoot;
    let names;
    try {
        realRoot = fs.realpathSync(rootDir);
        names = fs.readdirSync(realRoot);
    } catch {
        return 0;
    }

    let removed = 0;
    for (const name of names) {
        if (name.includes('/') || name.includes('\\')) continue;
        const target = path.join(realRoot, name);
        if (!isPathWithin(realRoot, target)) continue;

        try {
            const stats = fs.lstatSync(target);
            if (stats.isSymbolicLink()) continue;
            if (!shouldDelete({ name, stats })) continue;

            if (stats.isDirectory()) {
                fs.rmSync(target, { recursive: true, force: true });
            } else if (stats.isFile()) {
                fs.unlinkSync(target);
            } else {
                continue;
            }
            removed += 1;
        } catch (err) {
            console.warn(`[RETENTION] Could not remove ${target}: ${err.message}`);
        }
    }
    return removed;
}

/**
 * Run one retention pass.
 * @param {number} [now] Current timestamp (testing hook).
 * @returns {{outputFiles: number, isolatedDirs: number, uploadTempFiles: number}} Removal counts.
 */
function runRetentionCleanup(now = Date.now()) {
    const summary = { outputFiles: 0, isolatedDirs: 0, uploadTempFiles: 0 };

    if (OUTPUT_RETENTION_HOURS > 0) {
        const maxAgeMs = OUTPUT_RETENTION_HOURS * HOUR_MS;
        const isolatedMaxAgeMs = Math.max(maxAgeMs, MIN_ISOLATED_DIR_AGE_MS);
        let isolatedRemoved = 0;
        const total = sweepDirectory(OUTPUT_DIR, ({ name, stats }) => {
            const age = now - stats.mtimeMs;
            if (stats.isFile()) {
                return ALLOWED_OUTPUT_EXTENSIONS.has(path.extname(name).toLowerCase()) && age > maxAgeMs;
            }
            if (stats.isDirectory() && ISOLATED_DIR_PATTERN.test(name) && age > isolatedMaxAgeMs) {
                isolatedRemoved += 1;
                return true;
            }
            return false;
        });
        summary.isolatedDirs = isolatedRemoved;
        summary.outputFiles = total - isolatedRemoved;
    }

    if (UPLOAD_TEMP_RETENTION_MINUTES > 0) {
        const uploadMaxAgeMs = UPLOAD_TEMP_RETENTION_MINUTES * 60_000;
        summary.uploadTempFiles = sweepDirectory(HELP_FILES_DIR, ({ name, stats }) => (
            stats.isFile() && UPLOAD_TEMP_PATTERN.test(name) && now - stats.mtimeMs > uploadMaxAgeMs
        ));
    }

    const total = summary.outputFiles + summary.isolatedDirs + summary.uploadTempFiles;
    if (total > 0) {
        console.log(`[RETENTION] Removed ${summary.outputFiles} output file(s), ${summary.isolatedDirs} isolated dir(s), ${summary.uploadTempFiles} upload temp file(s).`);
    }
    return summary;
}

/**
 * Start the periodic retention scheduler (runs once shortly after boot).
 * @returns {void}
 */
function startOutputRetention() {
    if (OUTPUT_RETENTION_HOURS === 0 && UPLOAD_TEMP_RETENTION_MINUTES === 0) {
        console.log('[RETENTION] Disabled (OUTPUT_RETENTION_HOURS=0, UPLOAD_TEMP_RETENTION_MINUTES=0).');
        return;
    }

    const safeRun = () => {
        try {
            runRetentionCleanup();
        } catch (err) {
            console.error(`[RETENTION] Cleanup failed: ${err.message}`);
        }
    };

    setTimeout(safeRun, 30_000).unref();
    setInterval(safeRun, CLEANUP_INTERVAL_MS).unref();
}

module.exports = { startOutputRetention, runRetentionCleanup };
