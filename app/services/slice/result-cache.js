/**
 * In-memory LRU + TTL cache for slice results (everything except pricing).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const { parseNonNegativeInt } = require('../../utils/env');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;

/**
 * Parsed option fields that only influence pricing and must never be part of the cache key.
 * Every other parsed option is treated as slicing-relevant (so future options are safe by default).
 */
const PRICING_ONLY_OPTION_FIELDS = Object.freeze(['quantity']);

/**
 * Stream-hash a file with SHA-256.
 * @param {string} filePath File path.
 * @returns {Promise<string>} Hex digest.
 */
function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

/**
 * Deterministic JSON serialization with sorted object keys.
 * @param {unknown} value Any JSON-compatible value.
 * @returns {string} Stable JSON string.
 */
function stableStringify(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/**
 * Remove pricing-only fields from parsed options.
 * @param {Record<string, unknown>} options Parsed slice options.
 * @returns {Record<string, unknown>} Slicing-relevant options only.
 */
function omitPricingOnlyFields(options) {
    const copy = { ...options };
    for (const field of PRICING_ONLY_OPTION_FIELDS) delete copy[field];
    return copy;
}

/**
 * Pick pricing-only fields (e.g. quantity) from parsed options.
 * @param {Record<string, unknown>} options Parsed slice options.
 * @returns {Record<string, unknown>} Pricing-only fields that are defined.
 */
function pickPricingOnlyFields(options) {
    const picked = {};
    for (const field of PRICING_ONLY_OPTION_FIELDS) {
        if (options[field] !== undefined) picked[field] = options[field];
    }
    return picked;
}

/**
 * Describe profile files by size and mtime so edits invalidate cached results.
 * @param {Array<string | null | undefined>} filePaths Resolved profile file paths.
 * @returns {Array<{file: string, size: number, mtimeMs: number} | null>} Descriptors, or null entries for unreadable files.
 */
function describeProfileFiles(filePaths) {
    return filePaths.filter(Boolean).map((filePath) => {
        try {
            const stats = fs.statSync(filePath);
            return { file: filePath, size: stats.size, mtimeMs: stats.mtimeMs };
        } catch {
            return null;
        }
    });
}

/**
 * Build a cache key; returns null when a key cannot be built safely.
 * @param {{fileHash: string | null, engine: string, options: Record<string, unknown>, profileFiles: Array<string | null | undefined>}} input Key inputs.
 * @returns {string | null} Hex SHA-256 cache key.
 */
function buildCacheKey({ fileHash, engine, options, profileFiles }) {
    if (!fileHash) return null;
    const described = describeProfileFiles(profileFiles);
    if (described.some((entry) => entry === null)) return null;

    return crypto
        .createHash('sha256')
        .update(stableStringify({ fileHash, engine, options: omitPricingOnlyFields(options), profiles: described }))
        .digest('hex');
}

/**
 * LRU cache with per-entry TTL.
 */
class SliceResultCache {
    /**
     * @param {{ttlMs: number, maxEntries: number}} config Cache config; 0 disables.
     */
    constructor({ ttlMs, maxEntries }) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.entries = new Map();
    }

    /** @returns {boolean} True when caching is active. */
    isEnabled() {
        return this.ttlMs > 0 && this.maxEntries > 0;
    }

    /**
     * Fetch a deep copy of a cached value, refreshing LRU order.
     * @param {string} key Cache key.
     * @returns {object | null} Cached value or null.
     */
    get(key) {
        if (!this.isEnabled() || !key) return null;
        const entry = this.entries.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.entries.delete(key);
            return null;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return structuredClone(entry.value);
    }

    /**
     * Store a deep copy of a value.
     * @param {string} key Cache key.
     * @param {object} value Value (never an error result).
     * @returns {void}
     */
    set(key, value) {
        if (!this.isEnabled() || !key) return;
        this.entries.delete(key);
        this.entries.set(key, { value: structuredClone(value), expiresAt: Date.now() + this.ttlMs });
        while (this.entries.size > this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
        }
    }

    /** Drop expired entries. */
    prune() {
        const now = Date.now();
        for (const [key, entry] of this.entries) {
            if (now > entry.expiresAt) this.entries.delete(key);
        }
    }

    /** @returns {number} Current entry count. */
    get size() {
        return this.entries.size;
    }
}

const sliceResultCache = new SliceResultCache({
    ttlMs: parseNonNegativeInt(process.env.SLICE_RESULT_CACHE_TTL_MS, DEFAULT_TTL_MS),
    maxEntries: parseNonNegativeInt(process.env.SLICE_RESULT_CACHE_MAX_ENTRIES, DEFAULT_MAX_ENTRIES)
});

if (sliceResultCache.isEnabled()) {
    setInterval(() => sliceResultCache.prune(), Math.min(sliceResultCache.ttlMs, 10 * 60 * 1000)).unref();
}

module.exports = {
    sliceResultCache,
    SliceResultCache,
    hashFile,
    buildCacheKey,
    pickPricingOnlyFields,
    omitPricingOnlyFields,
    PRICING_ONLY_OPTION_FIELDS
};
