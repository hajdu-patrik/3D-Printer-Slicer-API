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

const KNOWN_ERROR_RULES = Object.freeze([
    {
        match: (err) => err?.code === 'ADMIN_CORS_ORIGIN_NOT_ALLOWED',
        status: 403,
        message: 'Origin is not allowed for admin endpoints.',
        errorCode: 'ADMIN_CORS_ORIGIN_NOT_ALLOWED'
    },
    {
        match: (err) => err?.type === 'entity.parse.failed',
        status: 400,
        message: 'Invalid JSON request payload.',
        errorCode: 'INVALID_JSON_BODY'
    },
    {
        match: (err) => err?.type === 'entity.too.large',
        status: 413,
        message: 'Request payload is too large.',
        errorCode: 'PAYLOAD_TOO_LARGE'
    },
    {
        match: (err) => err?.code === 'LIMIT_FILE_SIZE',
        status: 413,
        message: 'Uploaded file is too large.',
        errorCode: 'UPLOADED_FILE_TOO_LARGE'
    },
    {
        match: (err) => err?.code === 'LIMIT_UNEXPECTED_FILE',
        status: 400,
        message: 'Unexpected file field. Use "choosenFile" for uploads.',
        errorCode: 'UNEXPECTED_FILE_FIELD'
    },
    {
        match: (err) => err?.name === 'MulterError',
        status: 400,
        message: 'Invalid file upload.',
        errorCode: 'UPLOAD_ERROR'
    }
]);

/**
 * Match known middleware/runtime errors to stable response metadata.
 * @param {Error & {status?: number, code?: string, type?: string}} err Error instance.
 * @returns {{status: number, message: string, errorCode: string} | null} Mapped error metadata.
 */
function resolveKnownErrorRule(err) {
    for (const rule of KNOWN_ERROR_RULES) {
        if (rule.match(err)) {
            return {
                status: rule.status,
                message: rule.message,
                errorCode: rule.errorCode
            };
        }
    }

    return null;
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

    const knownError = resolveKnownErrorRule(err);
    if (knownError) {
        return res.status(knownError.status).json(buildErrorResponse(knownError.message, knownError.errorCode));
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