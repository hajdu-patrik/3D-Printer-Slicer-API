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

router.get('/pricing', (req, res) => {
    res.status(200).json(getPricing());
});

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

router.delete('/pricing/:technology/:material', requireAdmin, (req, res) => {
    const technology = normalizeTechnology(req.params.technology);
    if (!technology) {
        return res.status(400).json({ success: false, error: 'Technology must be FDM or SLA.' });
    }

    const materialParam = String(req.params.material || '').trim();
    if (!materialParam) {
        return res.status(400).json({ success: false, error: 'material is required.' });
    }

    if (materialParam.toLowerCase() === 'default') {
        return res.status(400).json({ success: false, error: 'Deleting default material is not allowed.' });
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