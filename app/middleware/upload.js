/**
 * Shared multer upload middleware for model input files.
 * Restricted to single file on 'choosenFile' field with extension validation.
 */

const multer = require('multer');
const path = require('node:path');
const { HELP_FILES_DIR } = require('../config/paths');
const { DEFAULTS, EXTENSIONS } = require('../config/constants');

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
    ...EXTENSIONS.direct,
    ...EXTENSIONS.cad,
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
        err.code = 'UNSUPPORTED_FILE_FORMAT';
        return cb(err);
    }
});

module.exports = { upload };
