/**
 * Validation and normalization helpers for the optional pricing sections
 * (materialCost and setupFee).
 */

const TECHNOLOGIES = Object.freeze(['FDM', 'SLA']);
const MAX_MATERIAL_COST_PER_UNIT_HUF = 100000;
const MAX_SETUP_FEE_HUF = 10000000;

/**
 * Check a finite number within [0, max].
 * @param {unknown} value Candidate value.
 * @param {number} max Inclusive upper bound.
 * @returns {boolean} True when valid.
 */
function isValidAmount(value, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

/**
 * Normalize persisted/incoming materialCost section. Invalid entries are dropped.
 * @param {unknown} source Raw section.
 * @returns {{FDM: Record<string, number>, SLA: Record<string, number>}} Clean section.
 */
function normalizeMaterialCostSection(source) {
    const result = { FDM: {}, SLA: {} };
    if (!source || typeof source !== 'object') return result;

    for (const technology of TECHNOLOGIES) {
        const techSource = source[technology];
        if (!techSource || typeof techSource !== 'object') continue;
        for (const [material, value] of Object.entries(techSource)) {
            if (isValidAmount(value, MAX_MATERIAL_COST_PER_UNIT_HUF)) {
                result[technology][material] = value;
            }
        }
    }
    return result;
}

/**
 * Normalize persisted/incoming setupFee section. Invalid entries fall back to defaults.
 * @param {unknown} source Raw section.
 * @param {{FDM: number, SLA: number}} fallback Fallback values.
 * @returns {{FDM: number, SLA: number}} Clean section.
 */
function normalizeSetupFeeSection(source, fallback) {
    const result = { FDM: fallback?.FDM || 0, SLA: fallback?.SLA || 0 };
    if (!source || typeof source !== 'object') return result;

    for (const technology of TECHNOLOGIES) {
        if (isValidAmount(source[technology], MAX_SETUP_FEE_HUF)) {
            result[technology] = source[technology];
        }
    }
    return result;
}

module.exports = {
    MAX_MATERIAL_COST_PER_UNIT_HUF,
    MAX_SETUP_FEE_HUF,
    isValidAmount,
    normalizeMaterialCostSection,
    normalizeSetupFeeSection
};
