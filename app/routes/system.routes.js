/**
 * System route definitions for health, static icon, and protected operational endpoints.
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { APP_ROOT, OUTPUT_DIR, PRUSA_CONFIGS_DIR, ORCA_CONFIGS_DIR } = require('../config/paths');
const requireAdmin = require('../middleware/requireAdmin');
const { getQueueStatus } = require('../services/slice/queue');

const router = express.Router();
const ALLOWED_OUTPUT_EXTENSIONS = new Set(['.gcode', '.sl1']);

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
        const pythonExe = process.env.PYTHON_EXECUTABLE || 'python3';
        let output = '';
        let isResolved = false;

        const proc = spawn(pythonExe, ['--version'], {
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
router.get('/health/detailed', async (req, res) => {
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
                    prusa: { available: slicerPathsOK.prusa, path: PRUSA_CONFIGS_DIR },
                    orca: { available: slicerPathsOK.orca, path: ORCA_CONFIGS_DIR }
                },
                storage: {
                    outputDir: { accessible: outputDirAccessible, path: OUTPUT_DIR }
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
        return res.status(500).json({
            status: 'ERROR',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            error: error_.message
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
router.get('/admin/output-files', requireAdmin, (req, res) => {
    try {
        const entries = fs
            .readdirSync(OUTPUT_DIR, { withFileTypes: true })
            .filter((entry) => entry.isFile() && ALLOWED_OUTPUT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
            .map((entry) => {
                const fullPath = path.join(OUTPUT_DIR, entry.name);
                const stat = fs.statSync(fullPath);

                return {
                    fileName: entry.name,
                    downloadUrl: `/download/${encodeURIComponent(entry.name)}`,
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
        return res.status(500).json({
            success: false,
            error: `Failed to list output files. ${error_.message}`
        });
    }
});

module.exports = router;