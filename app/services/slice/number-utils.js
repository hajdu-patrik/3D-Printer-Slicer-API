/**
 * Shared numeric parsing helpers for slice modules.
 */

/**
 * Parse positive integer value with fallback.
 * @param {string | number | undefined} value Source value.
 * @param {number} fallback Fallback integer.
 * @returns {number} Parsed positive integer or fallback value.
 */
function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
    parsePositiveInt
};
