/**
 * Async slice job routes (additive; synchronous slice endpoints are unchanged).
 */

const express = require('express');
const { sliceRateLimiter, jobPollRateLimiter } = require('../middleware/rateLimit');
const { sliceQueuePrecheck } = require('../middleware/queuePrecheck');
const { upload } = require('../middleware/upload');
const {
    submitPrusaSliceJob,
    submitOrcaSliceJob,
    getSliceJobStatus
} = require('../services/jobs/slice-jobs.service');

const router = express.Router();

router.post('/prusa/slice/jobs', sliceRateLimiter, sliceQueuePrecheck, upload.single('choosenFile'), submitPrusaSliceJob);
router.post('/orca/slice/jobs', sliceRateLimiter, sliceQueuePrecheck, upload.single('choosenFile'), submitOrcaSliceJob);
router.get('/slice/jobs/:jobId', jobPollRateLimiter, getSliceJobStatus);

module.exports = router;
