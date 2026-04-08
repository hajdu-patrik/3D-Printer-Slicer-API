/**
 * Middleware that validates admin API key access for protected routes.
 */

const crypto = require('node:crypto');
const { getClientIp } = require('../utils/client-ip');

/**
 * Constant-time comparison of two strings to prevent timing side-channel attacks.
 * @param {string} a First string.
 * @param {string} b Second string.
 * @returns {boolean} True when strings are equal.
 */
function timingSafeCompare(a, b) {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Enforce `x-api-key` based authentication for admin operations.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @param {import('express').NextFunction} next Express next callback.
 * @returns {void}
 */
function requireAdmin(req, res, next) {
    const adminApiKey = String(process.env.ADMIN_API_KEY || '').trim();

    if (!adminApiKey) {
        console.error('[SECURITY WARNING] ADMIN_API_KEY is not configured. Protected pricing endpoints are disabled.');
        return res.status(503).json({ success: false, error: 'Admin API key is not configured on server.' });
    }

    const apiKey = String(req.header('x-api-key') || '').trim();
    if (!apiKey || !timingSafeCompare(apiKey, adminApiKey)) {
        const clientIp = getClientIp(req);
        console.warn(`[SECURITY WARNING] Unauthorized pricing access attempt from ${clientIp} on ${req.method} ${req.originalUrl}`);
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
}

module.exports = requireAdmin;