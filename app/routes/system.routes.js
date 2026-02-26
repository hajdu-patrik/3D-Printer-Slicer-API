/**
 * System route definitions for health, static icon, and protected operational endpoints.
 */

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { APP_ROOT, OUTPUT_DIR } = require('../config/paths');
const requireAdmin = require('../middleware/requireAdmin');

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