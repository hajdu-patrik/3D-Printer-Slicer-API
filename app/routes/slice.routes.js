/**
 * Slice route definition for multipart file uploads.
 */

const express = require('express');
const multer = require('multer');
const { HELP_FILES_DIR } = require('../config/paths');
const { handleSliceFDM, handleSliceSLA } = require('../services/slice.service');

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
 * FDM-only slice endpoint.
 */
router.post('/slice/FDM', upload.any(), handleSliceFDM);

/**
 * SLA-only slice endpoint.
 */
router.post('/slice/SLA', upload.any(), handleSliceSLA);

module.exports = router;