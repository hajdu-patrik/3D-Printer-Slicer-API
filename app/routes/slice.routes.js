/**
 * Slice route definition for multipart file uploads (synchronous endpoints).
 */

const express = require('express');
const { sliceRateLimiter } = require('../middleware/rateLimit');
const { sliceQueuePrecheck } = require('../middleware/queuePrecheck');
const { upload } = require('../middleware/upload');
const { handleSlicePrusa, handleSliceOrca } = require('../services/slice.service');

const router = express.Router();

router.post('/prusa/slice', sliceRateLimiter, sliceQueuePrecheck, upload.single('choosenFile'), handleSlicePrusa);
router.post('/orca/slice', sliceRateLimiter, sliceQueuePrecheck, upload.single('choosenFile'), handleSliceOrca);

module.exports = router;
