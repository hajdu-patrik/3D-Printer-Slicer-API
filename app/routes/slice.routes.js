const express = require('express');
const multer = require('multer');
const { HELP_FILES_DIR } = require('../config/paths');
const { handleSlice } = require('../services/slice.service');

const router = express.Router();

const upload = multer({
    dest: HELP_FILES_DIR,
    limits: {
        fileSize: 1024 * 1024 * 1024
    }
});

router.post('/slice', upload.any(), handleSlice);

module.exports = router;