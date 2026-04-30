/**
 * Pricing route definitions for read/update/delete pricing configuration.
 */

const express = require('express');
const requireAdmin = require('../middleware/requireAdmin');
const { adminRateLimiter } = require('../middleware/rateLimit');
const { getClientIp } = require('../utils/client-ip');
const {
    getPricing,
    savePricingToDisk,
    normalizeTechnology,
    findMaterialKey,
    updateMaterialPrice,
    removeMaterial
} = require('../services/pricing.service');

const router = express.Router();

/**
 * Parse and validate required material field.
 * @param {import('express').Response} res Express response object.
 * @param {unknown} rawMaterial Material input value.
 * @returns {{response: import('express').Response | null, material?: string}} Parse result.
 */
function parseMaterialOrResponse(res, rawMaterial) {
    let material = '';
    if (typeof rawMaterial === 'string') {
        material = rawMaterial.trim();
    } else if (typeof rawMaterial === 'number' || typeof rawMaterial === 'boolean') {
        material = `${rawMaterial}`.trim();
    }

    if (!material) {
        return {
            response: res.status(400).json({ success: false, error: 'material is required.' })
        };
    }

    return {
        response: null,
        material
    };
}

/**
 * Parse and validate positive price field.
 * @param {import('express').Response} res Express response object.
 * @param {unknown} rawPrice Price input value.
 * @returns {{response: import('express').Response | null, price?: number}} Parse result.
 */
function parsePriceOrResponse(res, rawPrice) {
    const price = Number(rawPrice);
    if (!Number.isFinite(price) || price <= 0) {
        return {
            response: res.status(400).json({ success: false, error: 'price must be a valid positive number.' })
        };
    }

    return {
        response: null,
        price
    };
}

/**
 * Parse and validate technology route parameter.
 * @param {import('express').Response} res Express response object.
 * @param {unknown} rawTechnology Technology parameter value.
 * @returns {{response: import('express').Response | null, technology?: 'FDM'|'SLA'}} Parse result.
 */
function parseTechnologyOrResponse(res, rawTechnology) {
    const technology = normalizeTechnology(rawTechnology);
    if (!technology) {
        return {
            response: res.status(400).json({ success: false, error: 'Technology must be FDM or SLA.' })
        };
    }

    return {
        response: null,
        technology
    };
}

/**
 * Persist pricing map and emit standardized HTTP response on write failure.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response | null} Error response when persistence fails.
 */
function persistPricingOrResponse(res) {
    if (savePricingToDisk()) {
        return null;
    }

    return res.status(500).json({ success: false, error: 'Failed to persist pricing update.' });
}

/**
 * Log pricing mutation details with request trace context.
 * @param {import('express').Request} req Express request object.
 * @param {'FDM'|'SLA'} technology Technology key.
 * @param {string} materialKey Material key.
 * @param {string} actionMessage Mutation summary message.
 * @returns {void}
 */
function logPricingUpdate(req, technology, materialKey, actionMessage) {
    const clientIp = getClientIp(req);
    const requestId = req.requestId || 'n/a';
    console.log(`[PRICING UPDATE] ${technology}.${materialKey} ${actionMessage} by ${clientIp} (requestId=${requestId})`);
}

/**
 * Create a new material entry for a specific technology.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @param {'FDM'|'SLA'} technology Technology key.
 * @returns {import('express').Response}
 */
function createMaterialForTechnology(req, res, technology) {
    const materialResult = parseMaterialOrResponse(res, req.body?.material);
    if (materialResult.response) {
        return materialResult.response;
    }
    const materialParam = materialResult.material;

    const priceResult = parsePriceOrResponse(res, req.body?.price);
    if (priceResult.response) {
        return priceResult.response;
    }
    const price = priceResult.price;

    if (findMaterialKey(technology, materialParam)) {
        return res.status(409).json({ success: false, error: 'Material already exists for this technology.' });
    }

    const materialKey = updateMaterialPrice(technology, materialParam, price);

    const saveErrorResponse = persistPricingOrResponse(res);
    if (saveErrorResponse) {
        return saveErrorResponse;
    }

    logPricingUpdate(req, technology, materialKey, `created at ${price} HUF/hour`);
    return res.status(201).json({
        success: true,
        technology,
        material: materialKey,
        price,
        message: 'Material created successfully.'
    });
}

/**
 * Get current pricing map.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.get('/pricing', (req, res) => {
    res.status(200).json(getPricing());
});

/**
 * Create a new FDM material.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.post('/pricing/FDM', adminRateLimiter, requireAdmin, (req, res) => createMaterialForTechnology(req, res, 'FDM'));

/**
 * Create a new SLA material.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.post('/pricing/SLA', adminRateLimiter, requireAdmin, (req, res) => createMaterialForTechnology(req, res, 'SLA'));

/**
 * Update an existing material hourly pricing entry.
 * Rejects unknown materials with HTTP 400.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.patch('/pricing/:technology/:material', adminRateLimiter, requireAdmin, (req, res) => {
    const technologyResult = parseTechnologyOrResponse(res, req.params.technology);
    if (technologyResult.response) {
        return technologyResult.response;
    }
    const technology = technologyResult.technology;

    const priceResult = parsePriceOrResponse(res, req.body?.price);
    if (priceResult.response) {
        return priceResult.response;
    }
    const price = priceResult.price;

    const materialResult = parseMaterialOrResponse(res, req.params.material);
    if (materialResult.response) {
        return materialResult.response;
    }
    const materialParam = materialResult.material;

    const existingMaterialKey = findMaterialKey(technology, materialParam);
    if (!existingMaterialKey) {
        return res.status(400).json({
            success: false,
            error: 'Material does not exist for this technology. Only existing materials can be updated.'
        });
    }

    const materialKey = updateMaterialPrice(technology, existingMaterialKey, price);

    const saveErrorResponse = persistPricingOrResponse(res);
    if (saveErrorResponse) {
        return saveErrorResponse;
    }

    logPricingUpdate(req, technology, materialKey, `updated to ${price} HUF/hour`);
    return res.status(200).json({
        success: true,
        technology,
        material: materialKey,
        price
    });
});

/**
 * Delete a material pricing entry from selected technology.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.delete('/pricing/:technology/:material', adminRateLimiter, requireAdmin, (req, res) => {
    const technologyResult = parseTechnologyOrResponse(res, req.params.technology);
    if (technologyResult.response) {
        return technologyResult.response;
    }
    const technology = technologyResult.technology;

    const materialResult = parseMaterialOrResponse(res, req.params.material);
    if (materialResult.response) {
        return materialResult.response;
    }
    const materialParam = materialResult.material;

    const materialKey = findMaterialKey(technology, materialParam);
    if (!materialKey) {
        return res.status(404).json({ success: false, error: 'Material not found.' });
    }

    removeMaterial(technology, materialKey);

    const saveErrorResponse = persistPricingOrResponse(res);
    if (saveErrorResponse) {
        return saveErrorResponse;
    }

    logPricingUpdate(req, technology, materialKey, 'deleted');
    return res.status(200).json({
        success: true,
        technology,
        material: materialKey,
        message: 'Material deleted successfully.'
    });
});

module.exports = router;