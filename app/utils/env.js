/**
 * Environment value parsing helpers.
 */

/**
 * Parse a non-negative integer (0 allowed) with fallback.
 * @param {string | number | undefined} value Raw value.
 * @param {number} fallback Fallback when parsing fails or value is negative.
 * @returns {number} Parsed non-negative integer.
 */
function parseNonNegativeInt(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

module.exports = { parseNonNegativeInt };
