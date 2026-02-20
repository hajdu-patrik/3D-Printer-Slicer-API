/**
 * Pricing route definitions for read/update/delete pricing configuration.
 */

const express = require('express');
const requireAdmin = require('../middleware/requireAdmin');
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
 * Create a new material entry for a specific technology.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @param {'FDM'|'SLA'} technology Technology key.
 * @returns {import('express').Response}
 */
function createMaterialForTechnology(req, res, technology) {
    const materialParam = String(req.body?.material || '').trim();
    if (!materialParam) {
        return res.status(400).json({ success: false, error: 'material is required.' });
    }

    const price = Number(req.body?.price);
    if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ success: false, error: 'price must be a valid positive number.' });
    }

    if (findMaterialKey(technology, materialParam)) {
        return res.status(409).json({ success: false, error: 'Material already exists for this technology.' });
    }

    const materialKey = updateMaterialPrice(technology, materialParam, price);

    if (!savePricingToDisk()) {
        return res.status(500).json({ success: false, error: 'Failed to persist pricing update.' });
    }

    console.log(`[PRICING UPDATE] ${technology}.${materialKey} created at ${price} HUF/hour`);
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
router.post('/pricing/FDM', requireAdmin, (req, res) => createMaterialForTechnology(req, res, 'FDM'));

/**
 * Create a new SLA material.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.post('/pricing/SLA', requireAdmin, (req, res) => createMaterialForTechnology(req, res, 'SLA'));

/**
 * Create or update material hourly pricing.
 * @param {import('express').Request} req Express request object.
 * @param {import('express').Response} res Express response object.
 * @returns {import('express').Response}
 */
router.patch('/pricing/:technology/:material', requireAdmin, (req, res) => {
    const technology = normalizeTechnology(req.params.technology);
    if (!technology) {
        return res.status(400).json({ success: false, error: 'Technology must be FDM or SLA.' });
    }

    const price = Number(req.body?.price);
    if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ success: false, error: 'price must be a valid positive number.' });
    }

    const materialParam = String(req.params.material || '').trim();
    if (!materialParam) {
        return res.status(400).json({ success: false, error: 'material is required.' });
    }

    const materialKey = updateMaterialPrice(technology, materialParam, price);

    if (!savePricingToDisk()) {
        return res.status(500).json({ success: false, error: 'Failed to persist pricing update.' });
    }

    console.log(`[PRICING UPDATE] ${technology}.${materialKey} updated to ${price} HUF/hour`);
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
router.delete('/pricing/:technology/:material', requireAdmin, (req, res) => {
    const technology = normalizeTechnology(req.params.technology);
    if (!technology) {
        return res.status(400).json({ success: false, error: 'Technology must be FDM or SLA.' });
    }

    const materialParam = String(req.params.material || '').trim();
    if (!materialParam) {
        return res.status(400).json({ success: false, error: 'material is required.' });
    }

    const materialKey = findMaterialKey(technology, materialParam);
    if (!materialKey) {
        return res.status(404).json({ success: false, error: 'Material not found.' });
    }

    removeMaterial(technology, materialKey);

    if (!savePricingToDisk()) {
        return res.status(500).json({ success: false, error: 'Failed to persist pricing update.' });
    }

    console.log(`[PRICING UPDATE] ${technology}.${materialKey} deleted`);
    return res.status(200).json({
        success: true,
        technology,
        material: materialKey,
        message: 'Material deleted successfully.'
    });
});

module.exports = router;