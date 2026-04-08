/**
 * Shared client IP resolution utility for request logging and rate-limiting.
 */

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

/**
 * Resolve request origin IP.
 * Only trusts X-Forwarded-For when TRUST_PROXY=true is explicitly configured.
 * @param {import('express').Request} req Express request object.
 * @returns {string} Client IP string.
 */
function getClientIp(req) {
    if (TRUST_PROXY) {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string' && forwarded.length > 0) {
            return forwarded.split(',')[0].trim();
        }
    }

    return req.ip || req.socket?.remoteAddress || 'unknown';
}

module.exports = {
    getClientIp
};
