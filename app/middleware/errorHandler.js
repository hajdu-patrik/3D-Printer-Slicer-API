/**
 * Global Express error handler.
 * Normalizes runtime and middleware errors into stable JSON payloads.
 */

/**
 * Build standardized API error payload.
 * @param {string} message Human-readable error message.
 * @param {string} errorCode Stable machine-readable code.
 * @returns {{success: false, error: string, errorCode: string}} Serialized error payload.
 */
function buildErrorResponse(message, errorCode) {
    return {
        success: false,
        error: message,
        errorCode
    };
}

/**
 * Express error middleware.
 * @param {Error & {status?: number, code?: string, type?: string}} err Error instance.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next callback.
 * @returns {import('express').Response | void}
 */
function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }

    if (err?.code === 'ADMIN_CORS_ORIGIN_NOT_ALLOWED') {
        return res.status(403).json(buildErrorResponse('Origin is not allowed for admin endpoints.', 'ADMIN_CORS_ORIGIN_NOT_ALLOWED'));
    }

    if (err?.type === 'entity.parse.failed') {
        return res.status(400).json(buildErrorResponse('Invalid JSON request payload.', 'INVALID_JSON_BODY'));
    }

    if (err?.type === 'entity.too.large') {
        return res.status(413).json(buildErrorResponse('Request payload is too large.', 'PAYLOAD_TOO_LARGE'));
    }

    if (err?.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json(buildErrorResponse('Uploaded file is too large.', 'UPLOADED_FILE_TOO_LARGE'));
    }

    if (err?.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json(buildErrorResponse('Unexpected file field. Use "choosenFile" for uploads.', 'UNEXPECTED_FILE_FIELD'));
    }

    if (err?.name === 'MulterError') {
        return res.status(400).json(buildErrorResponse('Invalid file upload.', 'UPLOAD_ERROR'));
    }

    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    const isServerError = status >= 500;

    if (isServerError) {
        console.error(`[ERROR] Unhandled request failure (${req.method} ${req.originalUrl}):`, err);
    }

    const payload = isServerError
        ? buildErrorResponse('Internal server error.', 'INTERNAL_SERVER_ERROR')
        : buildErrorResponse(err?.message || 'Request failed.', 'REQUEST_FAILED');

    return res.status(status).json(payload);
}

module.exports = errorHandler;