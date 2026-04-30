/**
 * Pricing service facade for loading, persisting, and querying material hourly rates.
 */

const { PRICING_FILE, LEGACY_PRICING_FILE } = require('../config/paths');
const { DEFAULT_PRICING } = require('../config/constants');
const { PricingRepository } = require('./pricing/repository');
const { PricingCatalog } = require('./pricing/catalog');

const pricingRepository = new PricingRepository({
    primaryFile: PRICING_FILE,
    legacyFile: LEGACY_PRICING_FILE,
    defaultPricing: DEFAULT_PRICING
});

const pricingCatalog = new PricingCatalog(DEFAULT_PRICING);
let activePricingFile = PRICING_FILE;

/**
 * Persist current in-memory pricing to disk.
 * @returns {boolean} True when save succeeds, otherwise false.
 */
function savePricingToDisk() {
    try {
        activePricingFile = pricingRepository.saveToPrimary(pricingCatalog.getPricing());
        return true;
    } catch (err) {
        console.error(`[PRICING UPDATE] Failed to save pricing file (${pricingRepository.primaryFile}): ${err.message}`);
        return false;
    }
}

/**
 * Load pricing configuration from disk and merge with defaults.
 * If file is missing or invalid, defaults are restored and persisted.
 * @returns {void}
 */
function loadPricingFromDisk() {
    const existingCandidates = pricingRepository.getExistingCandidates();

    if (existingCandidates.length === 0) {
        pricingCatalog.resetToDefault();
        if (savePricingToDisk()) {
            console.log(`[PRICING UPDATE] Pricing file was missing. Default pricing created at ${activePricingFile}.`);
        } else {
            console.error('[PRICING UPDATE] Could not persist default pricing to any storage target.');
        }
        return;
    }

    for (const candidateFile of existingCandidates) {
        try {
            const diskPricing = pricingRepository.readPricingFile(candidateFile);
            pricingCatalog.setPricing(diskPricing);
            activePricingFile = PRICING_FILE;
            if (candidateFile !== PRICING_FILE) {
                savePricingToDisk();
            }
            return;
        } catch (err) {
            console.warn(`[PRICING UPDATE] Failed to read ${candidateFile}. Reason: ${err.message}`);
        }
    }

    console.warn('[PRICING UPDATE] All pricing files were unreadable, using defaults.');
    pricingCatalog.resetToDefault();
    savePricingToDisk();
}

/**
 * Get current pricing object.
 * @returns {{FDM: Record<string, number>, SLA: Record<string, number>}}
 */
function getPricing() {
    return pricingCatalog.getPricing();
}

/**
 * Normalize and validate technology key.
 * @param {string} value Raw technology value.
 * @returns {'FDM' | 'SLA' | null} Normalized technology or null when invalid.
 */
function normalizeTechnology(value) {
    return pricingCatalog.normalizeTechnology(value);
}

/**
 * Normalize material identifier for case-insensitive comparisons.
 * @param {string} value Raw material label.
 * @returns {string} Canonical normalized token.
 */
function normalizeMaterialToken(value) {
    return pricingCatalog.normalizeMaterialToken(value);
}

/**
 * Resolve material key case-insensitively from pricing map.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} materialParam Material name from request.
 * @returns {string | null} Existing material key or null when not found.
 */
function findMaterialKey(technology, materialParam) {
    return pricingCatalog.findMaterialKey(technology, materialParam);
}

/**
 * Resolve where a material exists across technology maps.
 * @param {string} materialParam Material name.
 * @returns {'FDM' | 'SLA' | 'BOTH' | null} Resolved technology scope.
 */
function resolveMaterialTechnology(materialParam) {
    return pricingCatalog.resolveMaterialTechnology(materialParam);
}

/**
 * Check whether a material exists under selected technology.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} materialParam Material name.
 * @returns {boolean} True when material is configured for the selected technology.
 */
function isMaterialValidForTechnology(technology, materialParam) {
    return pricingCatalog.isMaterialValidForTechnology(technology, materialParam);
}

/**
 * Return currently configured material keys for selected technology.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @returns {string[]} Material key list.
 */
function getAllowedMaterialsForTechnology(technology) {
    return pricingCatalog.getAllowedMaterialsForTechnology(technology);
}

/**
 * Create or update material price for selected technology.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} materialParam Material key from request.
 * @param {number} price Hourly price in HUF.
 * @returns {string} Final material key that was updated.
 */
function updateMaterialPrice(technology, materialParam, price) {
    return pricingCatalog.updateMaterialPrice(technology, materialParam, price);
}

/**
 * Remove a material from pricing map.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} materialKey Material key to remove.
 * @returns {void}
 */
function removeMaterial(technology, materialKey) {
    pricingCatalog.removeMaterial(technology, materialKey);
}

/**
 * Get effective hourly rate for technology/material pair.
 * Falls back to technology default if material is missing.
 * @param {'FDM' | 'SLA'} technology Technology namespace.
 * @param {string} material Material key.
 * @returns {number} Hourly rate in HUF.
 */
function getRate(technology, material) {
    return pricingCatalog.getRate(technology, material);
}

module.exports = {
    DEFAULT_PRICING,
    loadPricingFromDisk,
    savePricingToDisk,
    getPricing,
    normalizeTechnology,
    normalizeMaterialToken,
    findMaterialKey,
    resolveMaterialTechnology,
    isMaterialValidForTechnology,
    getAllowedMaterialsForTechnology,
    updateMaterialPrice,
    removeMaterial,
    getRate
};