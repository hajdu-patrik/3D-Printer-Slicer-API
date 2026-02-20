/**
 * Pricing service for loading, persisting, and querying material hourly rates.
 */

const fs = require('fs');
const { PRICING_FILE } = require('../config/paths');

/**
 * Default fallback pricing matrix in HUF/hour.
 * @type {{FDM: Record<string, number>, SLA: Record<string, number>}}
 */
const DEFAULT_PRICING = {
    FDM: { PLA: 800, ABS: 800, PETG: 900, TPU: 900 },
    SLA: { Standard: 1800, 'ABS-Like': 1800, Flexible: 2400 }
};

let pricing = JSON.parse(JSON.stringify(DEFAULT_PRICING));

/**
 * Persist current in-memory pricing to disk.
 * @returns {boolean} True when save succeeds, otherwise false.
 */
function savePricingToDisk() {
    try {
        fs.writeFileSync(PRICING_FILE, JSON.stringify(pricing, null, 2));
        return true;
    } catch (err) {
        console.error(`[PRICING UPDATE] Failed to save pricing file: ${err.message}`);
        return false;
    }
}

/**
 * Load pricing configuration from disk and merge with defaults.
 * If file is missing or invalid, defaults are restored and persisted.
 * @returns {void}
 */
function loadPricingFromDisk() {
    if (!fs.existsSync(PRICING_FILE)) {
        pricing = JSON.parse(JSON.stringify(DEFAULT_PRICING));
        try {
            fs.writeFileSync(PRICING_FILE, JSON.stringify(pricing, null, 2));
            console.log('[PRICING UPDATE] pricing.json was missing. Default pricing created.');
        } catch (err) {
            console.error(`[PRICING UPDATE] Could not create default pricing.json: ${err.message}`);
        }
        return;
    }

    try {
        const pricingRaw = fs.readFileSync(PRICING_FILE, 'utf8');
        const parsed = JSON.parse(pricingRaw);
        if (!parsed || typeof parsed !== 'object') throw new Error('Invalid pricing payload');

        pricing = {
            FDM: { ...DEFAULT_PRICING.FDM, ...(parsed.FDM || {}) },
            SLA: { ...DEFAULT_PRICING.SLA, ...(parsed.SLA || {}) }
        };
    } catch (err) {
        console.warn(`[PRICING UPDATE] Failed to read pricing.json, using defaults. Reason: ${err.message}`);
        pricing = JSON.parse(JSON.stringify(DEFAULT_PRICING));
        savePricingToDisk();
    }
}

/**
 * Get current pricing object.
 * @returns {{FDM: Record<string, number>, SLA: Record<string, number>}}
 */
function getPricing() {
    return pricing;
}

/**
 * Normalize and validate technology key.
 * @param {string} value Raw technology value.
 * @returns {'FDM' | 'SLA' | null} Normalized technology or null when invalid.
 */
function normalizeTechnology(value) {
    const normalized = String(value || '').toUpperCase();
    return normalized === 'FDM' || normalized === 'SLA' ? normalized : null;
}

/**
 * Resolve material key case-insensitively from pricing map.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} materialParam Material name from request.
 * @returns {string | null} Existing material key or null when not found.
 */
function findMaterialKey(technology, materialParam) {
    const requested = String(materialParam || '').toLowerCase();
    return Object.keys(pricing[technology] || {}).find((key) => key.toLowerCase() === requested) || null;
}

/**
 * Create or update material price for selected technology.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} materialParam Material key from request.
 * @param {number} price Hourly price in HUF.
 * @returns {string} Final material key that was updated.
 */
function updateMaterialPrice(technology, materialParam, price) {
    const existingMaterialKey = findMaterialKey(technology, materialParam);
    const materialKey = existingMaterialKey || materialParam;
    pricing[technology][materialKey] = price;
    return materialKey;
}

/**
 * Remove a material from pricing map.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} materialKey Material key to remove.
 * @returns {void}
 */
function removeMaterial(technology, materialKey) {
    delete pricing[technology][materialKey];
}

/**
 * Get effective hourly rate for technology/material pair.
 * Falls back to technology default if material is missing.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} material Material key.
 * @returns {number} Hourly rate in HUF.
 */
function getRate(technology, material) {
    const techPricing = pricing[technology] || {};
    if (Object.prototype.hasOwnProperty.call(techPricing, material)) {
        return techPricing[material];
    }

    const firstRate = Object.values(techPricing).find((value) => Number.isFinite(value) && value > 0);
    if (firstRate) return firstRate;

    const fallbackPricing = DEFAULT_PRICING[technology] || {};
    return Object.values(fallbackPricing).find((value) => Number.isFinite(value) && value > 0) || 0;
}

module.exports = {
    DEFAULT_PRICING,
    loadPricingFromDisk,
    savePricingToDisk,
    getPricing,
    normalizeTechnology,
    findMaterialKey,
    updateMaterialPrice,
    removeMaterial,
    getRate
};