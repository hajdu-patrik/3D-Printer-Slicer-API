/**
 * In-memory pricing catalog containing pricing domain logic.
 */

/**
 * @typedef {{FDM: Record<string, number>, SLA: Record<string, number>}} PricingMap
 */

class PricingCatalog {
    /**
     * @param {PricingMap} defaultPricing Default pricing configuration.
     */
    constructor(defaultPricing) {
        this.defaultPricing = structuredClone(defaultPricing);
        this.pricing = structuredClone(defaultPricing);
    }

    /**
     * Replace in-memory pricing with defaults merged by payload.
     * @param {Partial<PricingMap> | Record<string, unknown>} pricingPayload Incoming pricing payload.
     * @returns {void}
     */
    setPricing(pricingPayload) {
        const fdmSource = pricingPayload?.FDM && typeof pricingPayload.FDM === 'object' ? pricingPayload.FDM : undefined;
        const slaSource = pricingPayload?.SLA && typeof pricingPayload.SLA === 'object' ? pricingPayload.SLA : undefined;

        this.pricing = {
            FDM: { ...this.defaultPricing.FDM, ...fdmSource },
            SLA: { ...this.defaultPricing.SLA, ...slaSource }
        };
    }

    /**
     * Reset in-memory pricing to defaults.
     * @returns {void}
     */
    resetToDefault() {
        this.pricing = structuredClone(this.defaultPricing);
    }

    /**
     * Get a defensive clone of current pricing.
     * @returns {PricingMap} Current pricing snapshot.
     */
    getPricing() {
        return structuredClone(this.pricing);
    }

    /**
     * Normalize and validate technology key.
     * @param {unknown} value Raw technology value.
     * @returns {'FDM' | 'SLA' | null} Normalized technology or null when invalid.
     */
    normalizeTechnology(value) {
        const normalized = String(value || '').toUpperCase();
        return normalized === 'FDM' || normalized === 'SLA' ? normalized : null;
    }

    /**
     * Normalize material identifier for case-insensitive comparisons.
     * @param {unknown} value Raw material label.
     * @returns {string} Canonical normalized token.
     */
    normalizeMaterialToken(value) {
        if (typeof value === 'string') {
            return value.trim().toUpperCase();
        }

        if (typeof value === 'number' || typeof value === 'boolean') {
            return `${value}`.trim().toUpperCase();
        }

        return '';
    }

    /**
     * Resolve material key case-insensitively from pricing map.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @param {unknown} materialParam Material name from request.
     * @returns {string | null} Existing material key or null when not found.
     */
    findMaterialKey(technology, materialParam) {
        const requested = this.normalizeMaterialToken(materialParam);
        return Object.keys(this.pricing[technology] || {}).find((key) => this.normalizeMaterialToken(key) === requested) || null;
    }

    /**
     * Resolve where a material exists across technology maps.
     * @param {unknown} materialParam Material name.
     * @returns {'FDM' | 'SLA' | 'BOTH' | null} Resolved technology scope.
     */
    resolveMaterialTechnology(materialParam) {
        const inFdm = Boolean(this.findMaterialKey('FDM', materialParam));
        const inSla = Boolean(this.findMaterialKey('SLA', materialParam));

        if (inFdm && inSla) return 'BOTH';
        if (inFdm) return 'FDM';
        if (inSla) return 'SLA';
        return null;
    }

    /**
     * Check whether a material exists under selected technology.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @param {unknown} materialParam Material name.
     * @returns {boolean} True when material is configured for the selected technology.
     */
    isMaterialValidForTechnology(technology, materialParam) {
        return Boolean(this.findMaterialKey(technology, materialParam));
    }

    /**
     * Return currently configured material keys for selected technology.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @returns {string[]} Material key list.
     */
    getAllowedMaterialsForTechnology(technology) {
        return Object.keys(this.pricing[technology] || {});
    }

    /**
     * Create or update material price for selected technology.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @param {unknown} materialParam Material key from request.
     * @param {number} price Hourly price in HUF.
     * @returns {string} Final material key that was updated.
     */
    updateMaterialPrice(technology, materialParam, price) {
        const existingMaterialKey = this.findMaterialKey(technology, materialParam);
        const materialKey = existingMaterialKey || this.normalizeMaterialToken(materialParam);
        this.pricing[technology][materialKey] = price;
        return materialKey;
    }

    /**
     * Remove a material from pricing map.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @param {string} materialKey Material key to remove.
     * @returns {void}
     */
    removeMaterial(technology, materialKey) {
        delete this.pricing[technology][materialKey];
    }

    /**
     * Get effective hourly rate for technology/material pair.
     * Falls back to technology default if material is missing.
     * @param {'FDM' | 'SLA'} technology Technology namespace.
     * @param {unknown} material Material key.
     * @returns {number} Hourly rate in HUF.
     */
    getRate(technology, material) {
        const techPricing = this.pricing[technology] || {};
        const materialKey = this.findMaterialKey(technology, material);
        if (materialKey && Object.hasOwn(techPricing, materialKey)) {
            return techPricing[materialKey];
        }

        const firstRate = Object.values(techPricing).find((value) => Number.isFinite(value) && value > 0);
        if (firstRate) return firstRate;

        const fallbackPricing = this.defaultPricing[technology] || {};
        return Object.values(fallbackPricing).find((value) => Number.isFinite(value) && value > 0) || 0;
    }
}

module.exports = {
    PricingCatalog
};
