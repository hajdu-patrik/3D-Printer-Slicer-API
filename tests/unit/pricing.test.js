'use strict';

process.env.PYTHON_EXECUTABLE = process.execPath;
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'unit-test-key';

const test = require('node:test');
const assert = require('node:assert/strict');

const pricing = require('../../app/services/pricing.service');
const { calculateSlicePricing, buildSliceSuccessResponse } = require('../../app/services/slice/response');
const normalize = require('../../app/services/pricing/normalize');
const { PricingCatalog } = require('../../app/services/pricing/catalog');

// Only in-memory setters are used; nothing here touches configs/pricing.json.
test.afterEach(() => {
    pricing.clearMaterialCost('FDM', 'PLA');
    pricing.clearMaterialCost('SLA', 'Standard');
    pricing.setSetupFee('FDM', 0);
    pricing.setSetupFee('SLA', 0);
});

const legacy = (hours, rate) => Math.ceil((Math.max(hours, 0.25) * rate) / 10) * 10;

test('old-format pricing (no material cost, no setup fee) equals the legacy formula', () => {
    for (const seconds of [0, 300, 900, 3600, 5400, 123456]) {
        const result = calculateSlicePricing('FDM', 'PLA', { print_time_seconds: seconds, material_used_g: 50 });
        assert.equal(result.hourlyRate, 800);
        assert.equal(result.totalPrice, legacy(seconds / 3600, 800), `seconds=${seconds}`);
        assert.equal(result.quantity, 1);
    }
});

test('material cost, setup fee and quantity formula', () => {
    pricing.setMaterialCost('FDM', 'PLA', 10);
    pricing.setSetupFee('FDM', 500);
    const stats = { print_time_seconds: 7200, material_used_g: 20 };
    const result = calculateSlicePricing('FDM', 'PLA', stats, 3);
    // perPiece = 2h * 800 + 20 * 10 = 1800; total = ceil((500 + 3*1800)/10)*10 = 5900
    assert.equal(result.totalPrice, 5900);
    assert.equal(result.quantity, 3);
    assert.equal(result.breakdown.time_cost_huf, 1600);
    assert.equal(result.breakdown.material_cost_huf, 200);
    assert.equal(result.breakdown.setup_fee_huf, 500);
    assert.equal(result.breakdown.per_piece_huf, 1800);
    assert.equal(result.breakdown.material_unit, 'g');
    assert.equal(result.breakdown.material_cost_per_unit, 10);
});

test('SLA pricing uses millilitres', () => {
    pricing.setMaterialCost('SLA', 'Standard', 5);
    const result = calculateSlicePricing('SLA', 'Standard', { print_time_seconds: 3600, material_used_ml: 10, material_used_g: 999 });
    assert.equal(result.breakdown.material_unit, 'ml');
    assert.equal(result.breakdown.material_cost_huf, 50);
    assert.equal(result.totalPrice, Math.ceil((1800 + 50) / 10) * 10);
});

test('invalid quantity normalizes to 1', () => {
    assert.equal(calculateSlicePricing('FDM', 'PLA', { print_time_seconds: 3600 }, 0).quantity, 1);
    assert.equal(calculateSlicePricing('FDM', 'PLA', { print_time_seconds: 3600 }, 'abc').quantity, 1);
    assert.equal(calculateSlicePricing('FDM', 'PLA', { print_time_seconds: 3600 }, 2.9).quantity, 2);
});

test('buildSliceSuccessResponse exposes price_breakdown and stats price', () => {
    const zero = { x: 0, y: 0, z: 0 };
    const response = buildSliceSuccessResponse({
        engine: 'prusa',
        technology: 'FDM',
        material: 'PLA',
        infillPercentage: '20%',
        orcaMachineConfigFile: null,
        baseConfigFile: '/x/FDM_0.2mm.ini',
        transformOptions: { unit: 'mm', scalePercent: null },
        transformPlan: {
            keepProportions: true,
            requestedTargetSize: { x: null, y: null, z: null },
            scale: { x: 1, y: 1, z: 1 },
            rotationDeg: zero
        },
        originalModelInfo: { x: 10, y: 10, z: 10 },
        modelBoundsValidation: { dimensions: { x: 10, y: 10, z: 10 } },
        buildVolumeLimits: { min: zero, max: { x: 250, y: 210, z: 210 }, sourceProfile: 'FDM_0.2mm.ini' },
        stats: { print_time_seconds: 3600, material_used_g: 5, estimated_price_huf: 0 },
        quantity: 2
    });
    assert.equal(response.success, true);
    assert.equal(response.quantity, 2);
    assert.equal(response.hourly_rate, 800);
    assert.deepEqual(response.profiles, { prusa_profile: 'FDM_0.2mm.ini' });
    for (const key of ['time_cost_huf', 'material_cost_huf', 'setup_fee_huf', 'per_piece_huf', 'quantity', 'total_huf', 'material_unit', 'material_cost_per_unit']) {
        assert.ok(key in response.price_breakdown, key);
    }
    assert.equal(response.stats.estimated_price_huf, response.price_breakdown.total_huf);
    assert.equal(response.price_breakdown.total_huf, 1600);
});

test('normalize: isValidAmount bounds', () => {
    assert.equal(normalize.isValidAmount(0, 10), true);
    assert.equal(normalize.isValidAmount(10, 10), true);
    assert.equal(normalize.isValidAmount(10.01, 10), false);
    assert.equal(normalize.isValidAmount(-1, 10), false);
    assert.equal(normalize.isValidAmount(Number.NaN, 10), false);
    assert.equal(normalize.isValidAmount(Infinity, 10), false);
    assert.equal(normalize.isValidAmount('5', 10), false);
});

test('normalize: material cost section drops invalid entries', () => {
    const max = normalize.MAX_MATERIAL_COST_PER_UNIT_HUF;
    const result = normalize.normalizeMaterialCostSection({
        FDM: { PLA: 1.5, BAD: -1, HUGE: max + 1, EDGE: max, STR: '3' },
        SLA: 'nope',
        OTHER: { X: 1 }
    });
    assert.deepEqual(result, { FDM: { PLA: 1.5, EDGE: max }, SLA: {} });
    assert.deepEqual(normalize.normalizeMaterialCostSection(null), { FDM: {}, SLA: {} });
});

test('normalize: setup fee section falls back on invalid values', () => {
    const fallback = { FDM: 100, SLA: 200 };
    assert.deepEqual(normalize.normalizeSetupFeeSection({ FDM: 50, SLA: -5 }, fallback), { FDM: 50, SLA: 200 });
    assert.deepEqual(normalize.normalizeSetupFeeSection({ FDM: normalize.MAX_SETUP_FEE_HUF + 1 }, fallback), fallback);
    assert.deepEqual(normalize.normalizeSetupFeeSection(undefined, fallback), fallback);
    assert.deepEqual(normalize.normalizeSetupFeeSection(null, undefined), { FDM: 0, SLA: 0 });
});

test('PricingCatalog (standalone) merges payload over defaults and normalizes', () => {
    const catalog = new PricingCatalog({
        FDM: { PLA: 800 },
        SLA: { Standard: 1800 },
        materialCost: { FDM: {}, SLA: {} },
        setupFee: { FDM: 0, SLA: 0 }
    });
    catalog.setPricing({ FDM: { PETG: 900 }, materialCost: { FDM: { PLA: 2, BAD: -3 } }, setupFee: { SLA: 70 } });
    const snapshot = catalog.getPricing();
    assert.deepEqual(snapshot.FDM, { PLA: 800, PETG: 900 });
    assert.deepEqual(snapshot.materialCost.FDM, { PLA: 2 });
    assert.equal(catalog.getSetupFee('SLA'), 70);
    assert.equal(catalog.getRate('FDM', 'petg'), 900);
    assert.equal(catalog.getRate('FDM', 'unknown'), 800);
    catalog.resetToDefault();
    assert.equal(catalog.getSetupFee('SLA'), 0);
});
