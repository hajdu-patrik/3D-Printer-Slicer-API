/**
 * Slice route definition for multipart file uploads.
 */

const express = require('express');
const multer = require('multer');
const { HELP_FILES_DIR } = require('../config/paths');
const { sliceRateLimiter } = require('../middleware/rateLimit');
const { handleSliceFDM, handleSliceSLA } = require('../services/slice.service');

const router = express.Router();

/**
 * Resolve maximum accepted multipart upload size from environment.
 * @returns {number} Maximum upload size in bytes.
 */
function resolveMaxUploadBytes() {
    const parsed = Number.parseInt(process.env.MAX_UPLOAD_BYTES || `${100 * 1024 * 1024}`, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 100 * 1024 * 1024;
}

/**
 * Multer upload middleware used for model and image input files.
 */
const upload = multer({
    dest: HELP_FILES_DIR,
    limits: {
        fileSize: resolveMaxUploadBytes()
    }
});

/**
 * FDM-only slice endpoint.
 */
router.post('/slice/FDM', sliceRateLimiter, upload.any(), handleSliceFDM);

/**
 * SLA-only slice endpoint.
 */
router.post('/slice/SLA', sliceRateLimiter, upload.any(), handleSliceSLA);

module.exports = router;