/**
 * File-system backed pricing repository.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * @typedef {{FDM: Record<string, number>, SLA: Record<string, number>}} PricingMap
 */

class PricingRepository {
    /**
     * @param {{primaryFile: string, legacyFile: string, defaultPricing: PricingMap}} options Repository options.
     */
    constructor(options) {
        this.primaryFile = options.primaryFile;
        this.legacyFile = options.legacyFile;
        this.defaultPricing = structuredClone(options.defaultPricing);
    }

    /**
     * Read and normalize pricing payload from disk.
     * @param {string} filePath Absolute path to pricing file.
     * @returns {PricingMap} Parsed and merged pricing map.
     */
    readPricingFile(filePath) {
        const pricingRaw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(pricingRaw);
        if (!parsed || typeof parsed !== 'object') throw new Error('Invalid pricing payload');

        const fdmSource = parsed.FDM && typeof parsed.FDM === 'object' ? parsed.FDM : undefined;
        const slaSource = parsed.SLA && typeof parsed.SLA === 'object' ? parsed.SLA : undefined;

        return {
            FDM: { ...this.defaultPricing.FDM, ...fdmSource },
            SLA: { ...this.defaultPricing.SLA, ...slaSource }
        };
    }

    /**
     * Write pricing payload to a target file.
     * @param {string} filePath Absolute path to target pricing file.
     * @param {PricingMap} pricing Pricing payload.
     * @returns {void}
     */
    writePricingFile(filePath, pricing) {
        const parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(pricing, null, 2));
    }

    /**
     * Persist pricing snapshot to primary pricing file.
     * @param {PricingMap} pricing Pricing payload.
     * @returns {string} Written target file.
     */
    saveToPrimary(pricing) {
        this.writePricingFile(this.primaryFile, pricing);
        return this.primaryFile;
    }

    /**
     * Resolve candidate pricing files ordered by most recently modified.
     * @returns {string[]} Existing pricing file paths sorted descending by mtime.
     */
    getExistingCandidates() {
        const primaryExists = fs.existsSync(this.primaryFile);
        const candidates = primaryExists
            ? [this.primaryFile]
            : [this.primaryFile, this.legacyFile].filter((filePath) => fs.existsSync(filePath));

        return candidates.sort((a, b) => {
            const aTime = fs.statSync(a).mtimeMs;
            const bTime = fs.statSync(b).mtimeMs;
            return bTime - aTime;
        });
    }
}

module.exports = {
    PricingRepository
};
