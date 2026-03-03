/**
 * Slice route definition for multipart file uploads.
 */

const express = require('express');
const multer = require('multer');
const { HELP_FILES_DIR } = require('../config/paths');
const { DEFAULTS } = require('../config/constants');
const { sliceRateLimiter } = require('../middleware/rateLimit');
const { handleSlicePrusa, handleSliceOrca } = require('../services/slice.service');

const router = express.Router();

/**
 * Resolve maximum accepted multipart upload size from environment.
 * @returns {number} Maximum upload size in bytes.
 */
function resolveMaxUploadBytes() {
    const parsed = Number.parseInt(process.env.MAX_UPLOAD_BYTES || `${DEFAULTS.MAX_UPLOAD_BYTES}`, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULTS.MAX_UPLOAD_BYTES;
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

router.post('/prusa/slice', sliceRateLimiter, upload.any(), handleSlicePrusa);
router.post('/orca/slice', sliceRateLimiter, upload.any(), handleSliceOrca);

module.exports = router;