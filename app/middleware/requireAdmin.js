/**
 * Middleware that validates admin API key access for protected routes.
 */

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

/**
 * Enforce `x-api-key` based authentication for admin operations.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @param {import('express').NextFunction} next Express next callback.
 * @returns {void}
 */
function requireAdmin(req, res, next) {
    if (!ADMIN_API_KEY) {
        console.error('[SECURITY WARNING] ADMIN_API_KEY is not configured. Protected pricing endpoints are disabled.');
        return res.status(503).json({ success: false, error: 'Admin API key is not configured on server.' });
    }

    const apiKey = req.header('x-api-key');
    if (!apiKey || apiKey !== ADMIN_API_KEY) {
        console.warn(`[SECURITY WARNING] Unauthorized pricing access attempt from ${req.ip} on ${req.method} ${req.originalUrl}`);
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
}

module.exports = requireAdmin;