/**
 * Slice route definition for multipart file uploads.
 */

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { HELP_FILES_DIR } = require('../config/paths');
const { DEFAULTS, EXTENSIONS } = require('../config/constants');
const { sliceRateLimiter } = require('../middleware/rateLimit');
const { handleSlicePrusa, handleSliceOrca } = require('../services/slice.service');

const router = express.Router();

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
    ...EXTENSIONS.direct,
    ...EXTENSIONS.cad,
    ...EXTENSIONS.image,
    ...EXTENSIONS.vector,
    ...EXTENSIONS.archive
]);

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
 * Restricted to single file on 'choosenFile' field with extension validation.
 */
const upload = multer({
    dest: HELP_FILES_DIR,
    limits: {
        fileSize: resolveMaxUploadBytes()
    },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
            return cb(null, true);
        }
        const err = new Error('Unsupported file format.');
        err.status = 400;
        return cb(err);
    }
});

router.post('/prusa/slice', sliceRateLimiter, upload.single('choosenFile'), handleSlicePrusa);
router.post('/orca/slice', sliceRateLimiter, upload.single('choosenFile'), handleSliceOrca);

module.exports = router;