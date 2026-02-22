/**
 * Lightweight in-memory IP rate limiter.
 */

/**
 * Parse positive integer values from environment or user input with fallback.
 * @param {string | number | undefined} value Raw input value.
 * @param {number} fallback Value used when parsing fails.
 * @returns {number} A positive integer.
 */
function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolve request origin IP, preferring reverse-proxy forwarded header.
 * @param {import('express').Request} req Express request object.
 * @returns {string} Client IP string used as rate-limit key.
 */
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Build an Express middleware that enforces request-per-window limits by IP.
 * @param {{windowMs: number, maxRequests: number}} config Rate-limit configuration.
 * @returns {import('express').RequestHandler} Rate-limit middleware instance.
 */
function createIpRateLimiter({ windowMs, maxRequests }) {
    const buckets = new Map();

    return function ipRateLimiter(req, res, next) {
        const now = Date.now();
        const ip = getClientIp(req);

        const current = buckets.get(ip);
        if (!current || now > current.resetAt) {
            buckets.set(ip, { count: 1, resetAt: now + windowMs });
            return next();
        }

        if (current.count >= maxRequests) {
            const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
            res.setHeader('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({
                success: false,
                error: 'Too many requests. Please retry later.',
                errorCode: 'RATE_LIMIT_EXCEEDED',
                retryAfterSeconds
            });
        }

        current.count += 1;
        return next();
    };
}

const SLICE_RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.SLICE_RATE_LIMIT_WINDOW_MS, 60_000);
const SLICE_RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(process.env.SLICE_RATE_LIMIT_MAX_REQUESTS, 5);

/**
 * IP-based limiter used on slicing endpoints to reduce brute-force and flood traffic.
 * Default policy: 5 requests / 60 seconds / IP.
 */
const sliceRateLimiter = createIpRateLimiter({
    windowMs: SLICE_RATE_LIMIT_WINDOW_MS,
    maxRequests: SLICE_RATE_LIMIT_MAX_REQUESTS
});

module.exports = {
    sliceRateLimiter
};
