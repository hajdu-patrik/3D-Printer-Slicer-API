/**
 * Advisory slice queue pre-check executed before multipart upload parsing,
 * so clients do not upload large files only to receive a queue rejection.
 */

const { getClientIp } = require('../utils/client-ip');
const { assertSliceQueueCapacity, toQueueErrorResponse } = require('../services/slice/queue');
const { recordQueueRejection } = require('../services/metrics.service');

/**
 * Reject early with the same queue error codes/statuses as enqueueSliceJob.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Next middleware.
 * @returns {void}
 */
function sliceQueuePrecheck(req, res, next) {
    try {
        assertSliceQueueCapacity(getClientIp(req));
        return next();
    } catch (err) {
        const mapped = toQueueErrorResponse(err);
        if (!mapped) {
            return next(err);
        }
        recordQueueRejection(mapped.body.errorCode, 'precheck');
        return res.status(mapped.status).json(mapped.body);
    }
}

module.exports = { sliceQueuePrecheck };
