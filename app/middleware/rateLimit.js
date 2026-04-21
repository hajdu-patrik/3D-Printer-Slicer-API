/**
 * Lightweight in-memory IP rate limiter.
 */

const { DEFAULTS } = require('../config/constants');
const { getClientIp } = require('../utils/client-ip');

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
 * Build an Express middleware that enforces request-per-window limits by IP.
 * @param {{windowMs: number, maxRequests: number, errorCode?: string, errorMessage?: string}} config Rate-limit configuration.
 * @returns {import('express').RequestHandler} Rate-limit middleware instance.
 */
function createIpRateLimiter({ windowMs, maxRequests, errorCode = 'RATE_LIMIT_EXCEEDED', errorMessage = 'Too many requests. Please retry later.' }) {
    const buckets = new Map();

    const cleanupIntervalMs = Math.max(windowMs * 2, 60_000);
    setInterval(() => {
        const now = Date.now();
        for (const [ip, bucket] of buckets) {
            if (now > bucket.resetAt) {
                buckets.delete(ip);
            }
        }
    }, cleanupIntervalMs).unref();

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
                error: errorMessage,
                errorCode,
                retryAfterSeconds
            });
        }

        current.count += 1;
        return next();
    };
}

const SLICE_RATE_LIMIT_WINDOW_MS = parsePositiveInt(
    process.env.SLICE_RATE_LIMIT_WINDOW_MS,
    DEFAULTS.SLICE_RATE_LIMIT_WINDOW_MS
);
const SLICE_RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(
    process.env.SLICE_RATE_LIMIT_MAX_REQUESTS,
    DEFAULTS.SLICE_RATE_LIMIT_MAX_REQUESTS
);
const ADMIN_RATE_LIMIT_WINDOW_MS = parsePositiveInt(
    process.env.ADMIN_RATE_LIMIT_WINDOW_MS,
    DEFAULTS.ADMIN_RATE_LIMIT_WINDOW_MS
);
const ADMIN_RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(
    process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS,
    DEFAULTS.ADMIN_RATE_LIMIT_MAX_REQUESTS
);

/**
 * IP-based limiter used on slicing endpoints to reduce brute-force and flood traffic.
 * Default policy: 3 requests / 60 seconds / IP.
 */
const sliceRateLimiter = createIpRateLimiter({
    windowMs: SLICE_RATE_LIMIT_WINDOW_MS,
    maxRequests: SLICE_RATE_LIMIT_MAX_REQUESTS
});

/**
 * IP-based limiter used on admin endpoints to mitigate brute-force API key attempts.
 */
const adminRateLimiter = createIpRateLimiter({
    windowMs: ADMIN_RATE_LIMIT_WINDOW_MS,
    maxRequests: ADMIN_RATE_LIMIT_MAX_REQUESTS,
    errorCode: 'ADMIN_RATE_LIMIT_EXCEEDED',
    errorMessage: 'Too many admin requests. Please retry later.'
});

module.exports = {
    sliceRateLimiter,
    adminRateLimiter
};
