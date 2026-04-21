/**
 * Shared client IP resolution utility for request logging and rate-limiting.
 */

/**
 * Normalize IPv6-mapped IPv4 addresses for cleaner log output.
 * @param {string} ip Candidate IP string.
 * @returns {string} Normalized IP string.
 */
function normalizeIp(ip) {
    if (!ip) return 'unknown';
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * Resolve request origin IP.
 * Trust behavior is controlled by Express `trust proxy` setting configured at app bootstrap.
 * @param {import('express').Request} req Express request object.
 * @returns {string} Client IP string.
 */
function getClientIp(req) {
    return normalizeIp(req.ip || req.socket?.remoteAddress || 'unknown');
}

module.exports = {
    getClientIp
};
