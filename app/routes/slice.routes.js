/**
 * Slice route definition for multipart file uploads.
 */

const express = require('express');
const multer = require('multer');
const { HELP_FILES_DIR } = require('../config/paths');
const { handleSlice } = require('../services/slice.service');

const router = express.Router();

/**
 * Multer upload middleware used for model and image input files.
 */
const upload = multer({
    dest: HELP_FILES_DIR,
    limits: {
        fileSize: 1024 * 1024 * 1024
    }
});

/**
 * Slice endpoint that processes uploaded files through conversion and slicing.
 */
router.post('/slice', upload.any(), handleSlice);

module.exports = router;