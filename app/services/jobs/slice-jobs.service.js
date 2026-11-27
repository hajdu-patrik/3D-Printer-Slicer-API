/**
 * Async slice job submission and status lookup (additive to the synchronous slice endpoints).
 */

const { getClientIp } = require('../../utils/client-ip');
const { cleanupFiles } = require('../slice/common');
const { assertSliceQueueCapacity, toQueueErrorResponse } = require('../slice/queue');
const { sliceJobStore, JobStore, JobStoreFullError } = require('./job-store');
const metrics = require('../metrics.service');
const {
    ENGINE_OPTIONS,
    buildSubmission,
    validateSliceRequest,
    enqueueSlicePipeline,
    toQueueErrorResult,
    sendResult
} = require('../slice.service');

/**
 * Create an async submit handler (202 + jobId) for an engine.
 * Cheap validation failures and queue rejections are returned synchronously with the sync-endpoint bodies.
 * @param {'prusa'|'orca'} engineKey Engine key.
 * @returns {(req: import('express').Request, res: import('express').Response) => Promise<import('express').Response | void>} Handler.
 */
function createSubmitJobHandler(engineKey) {
    const engineOptions = ENGINE_OPTIONS[engineKey];

    return async function submitSliceJob(req, res) {
        let submission = null;
        try {
            submission = await buildSubmission(req);

            const validation = validateSliceRequest(submission, engineOptions);
            if (validation.result) {
                return sendResult(res, validation.result);
            }

            const queueKey = getClientIp(req);

            // Synchronous capacity check immediately followed by enqueue (no await in between),
            // so a queue rejection can never surface after the 202 was promised.
            assertSliceQueueCapacity(queueKey);
            const { jobId } = sliceJobStore.create();

            enqueueSlicePipeline(submission, engineOptions, queueKey, {
                onStart: () => sliceJobStore.markProcessing(jobId)
            }).then(
                (result) => sliceJobStore.complete(jobId, result),
                (err) => sliceJobStore.complete(jobId, toQueueErrorResult(err))
            );

            return res.status(202).json({
                success: true,
                jobId,
                status: 'queued',
                statusUrl: `/slice/jobs/${jobId}`
            });
        } catch (err) {
            if (submission?.file) {
                cleanupFiles([submission.file.path]);
            }

            if (err instanceof JobStoreFullError) {
                return res.status(err.status).json({
                    success: false,
                    error: err.message,
                    errorCode: err.errorCode
                });
            }

            const queueResponse = toQueueErrorResponse(err);
            if (queueResponse) {
                metrics.recordQueueRejection(queueResponse.body.errorCode, 'precheck');
            }
            return sendResult(res, toQueueErrorResult(err));
        }
    };
}

/**
 * GET /slice/jobs/:jobId handler.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @returns {import('express').Response} Response.
 */
function getSliceJobStatus(req, res) {
    const { jobId } = req.params;
    if (!JobStore.isValidJobId(jobId)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid job id.',
            errorCode: 'INVALID_JOB_ID'
        });
    }

    const job = sliceJobStore.get(jobId);
    if (!job) {
        return res.status(404).json({
            success: false,
            error: 'Job not found or expired.',
            errorCode: 'JOB_NOT_FOUND'
        });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(job);
}

module.exports = {
    submitPrusaSliceJob: createSubmitJobHandler('prusa'),
    submitOrcaSliceJob: createSubmitJobHandler('orca'),
    getSliceJobStatus
};
