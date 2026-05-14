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
const {
    BULK_DOWNLOAD_ALL_TOKEN,
    getValidatedOutputFile,
    getValidatedOutputFiles,
    listOutputFileSummaries,
    validateBulkDownloadLimits
} = require('../services/admin-output.service');
const { getQueueStatus } = require('../services/slice/queue');

const router = express.Router();

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
    const outputFiles = listOutputFileSummaries();
    if (!outputFiles.success) {
        console.error('[ADMIN OUTPUT FILES ERROR]', outputFiles.error);
        return res.status(outputFiles.status).json({
            success: false,
            error: outputFiles.error,
            errorCode: outputFiles.errorCode
        });
    }

    if (outputFiles.files.length === 0) {
        return res.status(200).json({
            success: true,
            message: 'Output directory is empty.',
            total: 0,
            files: []
        });
    }

    return res.status(200).json(outputFiles);
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

    if (fileName.toUpperCase() === BULK_DOWNLOAD_ALL_TOKEN) {
        const validatedFiles = getValidatedOutputFiles();
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

        const bulkDownloadLimits = validateBulkDownloadLimits(validatedFiles.files);
        if (!bulkDownloadLimits.success) {
            return res.status(bulkDownloadLimits.status).json({
                success: false,
                error: bulkDownloadLimits.error,
                errorCode: bulkDownloadLimits.errorCode
            });
        }

        const archiveFileName = `output-files-${Date.now()}.zip`;
        console.log(
            `[ADMIN DOWNLOAD] ${BULK_DOWNLOAD_ALL_TOKEN} requested by ${clientIp} (requestId=${requestId}) -> ${validatedFiles.files.length} files, ${bulkDownloadLimits.totalBytes} bytes`
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

    const validatedFile = getValidatedOutputFile(fileName);
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