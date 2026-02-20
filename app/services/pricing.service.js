/**
 * Pricing service for loading, persisting, and querying material hourly rates.
 */

const fs = require('node:fs');
const path = require('node:path');
const { PRICING_FILE, RUNTIME_PRICING_FILE } = require('../config/paths');

/**
 * Default fallback pricing matrix in HUF/hour.
 * @type {{FDM: Record<string, number>, SLA: Record<string, number>}}
 */
const DEFAULT_PRICING = {
    FDM: { PLA: 800, ABS: 800, PETG: 900, TPU: 900 },
    SLA: { Standard: 1800, 'ABS-Like': 1800, Flexible: 2400 }
};

let pricing = structuredClone(DEFAULT_PRICING);
let activePricingFile = PRICING_FILE;

function readPricingFile(filePath) {
    const pricingRaw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(pricingRaw);
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid pricing payload');

    const fdmSource = parsed.FDM && typeof parsed.FDM === 'object' ? parsed.FDM : undefined;
    const slaSource = parsed.SLA && typeof parsed.SLA === 'object' ? parsed.SLA : undefined;

    return {
        FDM: { ...DEFAULT_PRICING.FDM, ...fdmSource },
        SLA: { ...DEFAULT_PRICING.SLA, ...slaSource }
    };
}

function writePricingFile(filePath) {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(pricing, null, 2));
}

function getExistingCandidates() {
    const candidates = [PRICING_FILE, RUNTIME_PRICING_FILE].filter((filePath) => fs.existsSync(filePath));
    return candidates.sort((a, b) => {
        const aTime = fs.statSync(a).mtimeMs;
        const bTime = fs.statSync(b).mtimeMs;
        return bTime - aTime;
    });
}

/**
 * Persist current in-memory pricing to disk.
 * @returns {boolean} True when save succeeds, otherwise false.
 */
function savePricingToDisk() {
    const writeTargets = [activePricingFile, PRICING_FILE, RUNTIME_PRICING_FILE]
        .filter((value, index, arr) => arr.indexOf(value) === index);

    for (const targetFile of writeTargets) {
        try {
            writePricingFile(targetFile);
            activePricingFile = targetFile;
            return true;
        } catch (err) {
            console.error(`[PRICING UPDATE] Failed to save pricing file (${targetFile}): ${err.message}`);
        }
    }

    return false;
}

/**
 * Load pricing configuration from disk and merge with defaults.
 * If file is missing or invalid, defaults are restored and persisted.
 * @returns {void}
 */
function loadPricingFromDisk() {
    const existingCandidates = getExistingCandidates();

    if (existingCandidates.length === 0) {
        pricing = structuredClone(DEFAULT_PRICING);
        if (savePricingToDisk()) {
            console.log(`[PRICING UPDATE] Pricing file was missing. Default pricing created at ${activePricingFile}.`);
        } else {
            console.error('[PRICING UPDATE] Could not persist default pricing to any storage target.');
        }
        return;
    }

    for (const candidateFile of existingCandidates) {
        try {
            pricing = readPricingFile(candidateFile);
            activePricingFile = candidateFile;
            return;
        } catch (err) {
            console.warn(`[PRICING UPDATE] Failed to read ${candidateFile}. Reason: ${err.message}`);
        }
    }

    console.warn('[PRICING UPDATE] All pricing files were unreadable, using defaults.');
    pricing = structuredClone(DEFAULT_PRICING);
    savePricingToDisk();
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
    if (Object.hasOwn(techPricing, material)) {
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