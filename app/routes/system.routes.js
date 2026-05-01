/**
 * System route definitions for health, static icon, and protected operational endpoints.
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const archiver = require('archiver');
const { APP_ROOT, OUTPUT_DIR, PRUSA_CONFIGS_DIR, ORCA_CONFIGS_DIR } = require('../config/paths');
const { PYTHON_EXECUTABLE } = require('../config/python');
const requireAdmin = require('../middleware/requireAdmin');
const { adminRateLimiter } = require('../middleware/rateLimit');
const { getClientIp } = require('../utils/client-ip');
const { getQueueStatus } = require('../services/slice/queue');

const router = express.Router();
const ALLOWED_OUTPUT_EXTENSIONS = new Set(['.gcode', '.sl1']);
const BULK_DOWNLOAD_ALL_TOKEN = 'ALL';

/**
 * Validate output file token for safe direct download lookup.
 * @param {string} fileName Raw requested file token.
 * @returns {boolean} True when token is safe and extension is allowed.
 */
function isAllowedOutputFileName(fileName) {
    if (!fileName || fileName.includes('/') || fileName.includes('\\')) return false;
    return ALLOWED_OUTPUT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/**
 * Verify that a candidate path resolves inside an allowed parent directory.
 * @param {string} parentPath Trusted parent path.
 * @param {string} candidatePath Candidate path.
 * @returns {boolean} True when candidate is inside parent.
 */
function isPathWithin(parentPath, candidatePath) {
    const relative = path.relative(parentPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Resolve output directory and canonical path for containment checks.
 * @returns {{success: true, resolvedOutputDir: string, resolvedOutputDirRealPath: string} | {success: false, status: number, error: string, errorCode: string}}
 */
function resolveOutputDirectoryPaths() {
    const resolvedOutputDir = path.resolve(OUTPUT_DIR);

    try {
        const resolvedOutputDirRealPath = fs.realpathSync(resolvedOutputDir);
        return {
            success: true,
            resolvedOutputDir,
            resolvedOutputDirRealPath
        };
    } catch {
        return {
            success: false,
            status: 500,
            error: 'Failed to access output directory.',
            errorCode: 'OUTPUT_DIRECTORY_UNAVAILABLE'
        };
    }
}

/**
 * Validate and resolve a single output file to a safe canonical path.
 * @param {string} fileName Requested file name.
 * @param {string} resolvedOutputDir Resolved output directory path.
 * @param {string} resolvedOutputDirRealPath Canonical output directory path.
 * @returns {{success: true, fileName: string, realPath: string} | {success: false, status: number, error: string, errorCode: string}}
 */
function resolveValidatedOutputFile(fileName, resolvedOutputDir, resolvedOutputDirRealPath) {
    if (!isAllowedOutputFileName(fileName)) {
        return {
            success: false,
            status: 400,
            error: 'Invalid output file name.',
            errorCode: 'INVALID_OUTPUT_FILE'
        };
    }

    const requestedPath = path.resolve(path.join(resolvedOutputDir, fileName));
    if (!isPathWithin(resolvedOutputDir, requestedPath)) {
        return {
            success: false,
            status: 400,
            error: 'Invalid output file path.',
            errorCode: 'INVALID_OUTPUT_FILE_PATH'
        };
    }

    if (!fs.existsSync(requestedPath)) {
        return {
            success: false,
            status: 404,
            error: 'Output file not found.',
            errorCode: 'OUTPUT_FILE_NOT_FOUND'
        };
    }

    let requestedFileStats;
    try {
        requestedFileStats = fs.lstatSync(requestedPath);
    } catch {
        return {
            success: false,
            status: 404,
            error: 'Output file not found.',
            errorCode: 'OUTPUT_FILE_NOT_FOUND'
        };
    }

    if (!requestedFileStats.isFile() || requestedFileStats.isSymbolicLink()) {
        return {
            success: false,
            status: 400,
            error: 'Invalid output file target.',
            errorCode: 'INVALID_OUTPUT_FILE_TARGET'
        };
    }

    let resolvedFileRealPath;
    try {
        resolvedFileRealPath = fs.realpathSync(requestedPath);
    } catch {
        return {
            success: false,
            status: 404,
            error: 'Output file not found.',
            errorCode: 'OUTPUT_FILE_NOT_FOUND'
        };
    }

    if (!isPathWithin(resolvedOutputDirRealPath, resolvedFileRealPath)) {
        return {
            success: false,
            status: 400,
            error: 'Invalid output file path.',
            errorCode: 'INVALID_OUTPUT_FILE_PATH'
        };
    }

    return {
        success: true,
        fileName,
        realPath: resolvedFileRealPath
    };
}

/**
 * Enumerate and validate all downloadable output files.
 * @param {string} resolvedOutputDir Resolved output directory path.
 * @param {string} resolvedOutputDirRealPath Canonical output directory path.
 * @returns {{success: true, files: Array<{fileName: string, realPath: string}>} | {success: false, status: number, error: string, errorCode: string}}
 */
function listValidatedOutputFiles(resolvedOutputDir, resolvedOutputDirRealPath) {
    let entries;
    try {
        entries = fs.readdirSync(resolvedOutputDir, { withFileTypes: true });
    } catch {
        return {
            success: false,
            status: 500,
            error: 'Failed to list output files.',
            errorCode: 'OUTPUT_FILES_LIST_FAILED'
        };
    }

    const files = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;

        const validated = resolveValidatedOutputFile(entry.name, resolvedOutputDir, resolvedOutputDirRealPath);
        if (!validated.success) {
            if (validated.errorCode === 'OUTPUT_FILE_NOT_FOUND') continue;

            if (
                validated.errorCode === 'INVALID_OUTPUT_FILE' ||
                validated.errorCode === 'INVALID_OUTPUT_FILE_PATH' ||
                validated.errorCode === 'INVALID_OUTPUT_FILE_TARGET'
            ) {
                const logToken = entry.name || 'n/a';
                console.warn(`[ADMIN DOWNLOAD] Skipping unsafe output entry: ${logToken}`);
                continue;
            }

            return validated;
        }

        files.push({
            fileName: validated.fileName,
            realPath: validated.realPath
        });
    }

    files.sort((left, right) => left.fileName.localeCompare(right.fileName));

    return {
        success: true,
        files
    };
}

/**
 * Liveness endpoint used by monitors and container health checks.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

/**
 * Check Python availability and version with timeout protection.
 * @returns {Promise<{available: boolean, version: string|null}>}
 */
async function checkPythonAvailability() {
    return new Promise((resolve) => {
        let output = '';
        let isResolved = false;

        const proc = spawn(PYTHON_EXECUTABLE, ['--version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 2000
        });

        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                try {
                    proc.kill();
                } catch {}
                resolve({ available: false, version: null });
            }
        }, 2000);

        proc.stdout?.on('data', (data) => {
            output += data.toString().trim();
        });
        proc.stderr?.on('data', (data) => {
            output += data.toString().trim();
        });

        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            if (!isResolved) {
                isResolved = true;
                if (code === 0 && output) {
                    resolve({ available: true, version: output });
                } else {
                    resolve({ available: false, version: null });
                }
            }
        });

        proc.on('error', () => {
            clearTimeout(timeoutId);
            if (!isResolved) {
                isResolved = true;
                resolve({ available: false, version: null });
            }
        });
    });
}

/**
 * Detailed health check which diagnostics subsystem availability (slicer paths, Python, queue).
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {Promise<import('express').Response>}
 */
router.get('/health/detailed', adminRateLimiter, requireAdmin, async (req, res) => {
    try {
        const timestamp = new Date().toISOString();
        const uptime = process.uptime();

        const slicerPathsOK = {
            prusa: fs.existsSync(PRUSA_CONFIGS_DIR),
            orca: fs.existsSync(ORCA_CONFIGS_DIR)
        };
        const outputDirAccessible = fs.existsSync(OUTPUT_DIR);
        const queueStatus = getQueueStatus();
        const pythonStatus = await checkPythonAvailability();

        const healthReport = {
            timestamp,
            status:
                slicerPathsOK.prusa && slicerPathsOK.orca && outputDirAccessible && pythonStatus.available
                    ? 'OK'
                    : 'DEGRADED',
            uptime,
            subsystems: {
                slicers: {
                    prusa: { available: slicerPathsOK.prusa },
                    orca: { available: slicerPathsOK.orca }
                },
                storage: {
                    outputDir: { accessible: outputDirAccessible }
                },
                queue: queueStatus,
                python: {
                    available: pythonStatus.available,
                    version: pythonStatus.version
                }
            }
        };

        const statusCode = healthReport.status === 'OK' ? 200 : 503;
        return res.status(statusCode).json(healthReport);
    } catch (error_) {
        console.error('[HEALTH DETAILED ERROR]', error_.message);
        return res.status(500).json({
            status: 'ERROR',
            timestamp: new Date().toISOString(),
            error: 'Internal server error while checking system health.'
        });
    }
});

/**
 * Favicon endpoint serving static icon if available.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {void}
 */
router.get('/favicon.ico', (req, res) => {
    const faviconPath = path.join(APP_ROOT, 'static', 'favicon.ico');
    if (fs.existsSync(faviconPath)) {
        res.sendFile(faviconPath);
    } else {
        res.status(404).end();
    }
});

/**
 * Protected endpoint to list generated slicing output files.
 * Requires valid x-api-key header.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.get('/admin/output-files', adminRateLimiter, requireAdmin, (req, res) => {
    try {
        const entries = fs
            .readdirSync(OUTPUT_DIR, { withFileTypes: true })
            .filter((entry) => entry.isFile() && ALLOWED_OUTPUT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
            .map((entry) => {
                const fullPath = path.join(OUTPUT_DIR, entry.name);
                const stat = fs.statSync(fullPath);

                return {
                    fileName: entry.name,
                    downloadUrl: `/admin/download/${encodeURIComponent(entry.name)}`,
                    sizeBytes: stat.size,
                    createdAt: stat.birthtime.toISOString(),
                    modifiedAt: stat.mtime.toISOString()
                };
            })
            .sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime());

        if (entries.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'Output directory is empty.',
                total: 0,
                files: []
            });
        }

        return res.status(200).json({
            success: true,
            total: entries.length,
            files: entries
        });
    } catch (error_) {
        console.error('[ADMIN OUTPUT FILES ERROR]', error_.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to list output files.'
        });
    }
});

/**
 * Protected endpoint for downloading generated output files.
 * Requires valid x-api-key header.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response | void}
 */
router.get('/admin/download/:fileName', adminRateLimiter, requireAdmin, (req, res) => {
    const fileName = String(req.params.fileName || '').trim();
    const clientIp = getClientIp(req);
    const requestId = req.requestId || 'n/a';

    const outputDirPaths = resolveOutputDirectoryPaths();
    if (!outputDirPaths.success) {
        return res.status(outputDirPaths.status).json({
            success: false,
            error: outputDirPaths.error,
            errorCode: outputDirPaths.errorCode
        });
    }

    const { resolvedOutputDir, resolvedOutputDirRealPath } = outputDirPaths;

    if (fileName.toUpperCase() === BULK_DOWNLOAD_ALL_TOKEN) {
        const validatedFiles = listValidatedOutputFiles(resolvedOutputDir, resolvedOutputDirRealPath);
        if (!validatedFiles.success) {
            return res.status(validatedFiles.status).json({
                success: false,
                error: validatedFiles.error,
                errorCode: validatedFiles.errorCode
            });
        }

        if (validatedFiles.files.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Output files not found.',
                errorCode: 'OUTPUT_FILES_NOT_FOUND'
            });
        }

        const archiveFileName = `output-files-${Date.now()}.zip`;
        console.log(
            `[ADMIN DOWNLOAD] ${BULK_DOWNLOAD_ALL_TOKEN} requested by ${clientIp} (requestId=${requestId}) -> ${validatedFiles.files.length} files`
        );

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${archiveFileName}"`);

        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('warning', (warning_) => {
            console.warn(`[ADMIN DOWNLOAD WARN] ${warning_.message}`);
        });

        archive.on('error', (error_) => {
            console.error(`[ADMIN DOWNLOAD ERROR] ${error_.message} (requestId=${requestId})`);
            if (res.headersSent) {
                res.destroy(error_);
                return;
            }

            res.status(500).json({
                success: false,
                error: 'Failed to download output files.',
                errorCode: 'BULK_DOWNLOAD_FAILED'
            });
        });

        res.on('close', () => {
            if (!res.writableEnded) {
                archive.abort();
            }
        });

        archive.pipe(res);
        for (const file of validatedFiles.files) {
            archive.file(file.realPath, { name: file.fileName });
        }

        const finalizeResult = archive.finalize();
        if (finalizeResult && typeof finalizeResult.catch === 'function') {
            finalizeResult.catch((error_) => {
                console.error(`[ADMIN DOWNLOAD ERROR] ${error_.message} (requestId=${requestId})`);
                if (res.headersSent) {
                    res.destroy(error_);
                    return;
                }

                res.status(500).json({
                    success: false,
                    error: 'Failed to download output files.',
                    errorCode: 'BULK_DOWNLOAD_FAILED'
                });
            });
        }

        return;
    }

    const validatedFile = resolveValidatedOutputFile(fileName, resolvedOutputDir, resolvedOutputDirRealPath);
    if (!validatedFile.success) {
        return res.status(validatedFile.status).json({
            success: false,
            error: validatedFile.error,
            errorCode: validatedFile.errorCode
        });
    }

    console.log(`[ADMIN DOWNLOAD] ${validatedFile.fileName} requested by ${clientIp} (requestId=${requestId})`);

    return res.download(validatedFile.realPath, validatedFile.fileName, (error_) => {
        if (error_ && !res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Failed to download output file.',
                errorCode: 'DOWNLOAD_FAILED'
            });
        }
    });
});

module.exports = router;