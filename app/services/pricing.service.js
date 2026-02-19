const fs = require('fs');
const { PRICING_FILE } = require('../config/paths');

const DEFAULT_PRICING = {
    FDM: { PLA: 800, ABS: 800, PETG: 900, TPU: 900, default: 800 },
    SLA: { Standard: 1800, 'ABS-Like': 1800, Flexible: 2400, default: 1800 }
};

let pricing = JSON.parse(JSON.stringify(DEFAULT_PRICING));

function savePricingToDisk() {
    try {
        fs.writeFileSync(PRICING_FILE, JSON.stringify(pricing, null, 2));
        return true;
    } catch (err) {
        console.error(`[PRICING UPDATE] Failed to save pricing file: ${err.message}`);
        return false;
    }
}

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

function getPricing() {
    return pricing;
}

function normalizeTechnology(value) {
    const normalized = String(value || '').toUpperCase();
    return normalized === 'FDM' || normalized === 'SLA' ? normalized : null;
}

function findMaterialKey(technology, materialParam) {
    const requested = String(materialParam || '').toLowerCase();
    return Object.keys(pricing[technology] || {}).find((key) => key.toLowerCase() === requested) || null;
}

function updateMaterialPrice(technology, materialParam, price) {
    const existingMaterialKey = findMaterialKey(technology, materialParam);
    const materialKey = existingMaterialKey || materialParam;
    pricing[technology][materialKey] = price;
    return materialKey;
}

function removeMaterial(technology, materialKey) {
    delete pricing[technology][materialKey];
}

function getRate(technology, material) {
    return pricing[technology][material] || pricing[technology].default;
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