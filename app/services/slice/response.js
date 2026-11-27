/**
 * Slice response payload composition and pricing strategies.
 */

const path = require('node:path');
const { getRate, getMaterialCost, getSetupFee } = require('../pricing.service');
const { roundDimensions, roundToThree } = require('./common');

const MIN_BILLABLE_HOURS = 0.25;

/**
 * Round to two decimals for presentation of breakdown amounts.
 * @param {number} value Raw amount.
 * @returns {number} Rounded amount.
 */
function roundToTwo(value) {
    return Math.round(value * 100) / 100;
}

/**
 * Coerce to a finite non-negative number, otherwise 0.
 * @param {unknown} value Raw value.
 * @returns {number} Safe number.
 */
function toNonNegativeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : 0;
}

/**
 * Normalize quantity to an integer >= 1 (default 1).
 * @param {unknown} value Raw quantity.
 * @returns {number} Quantity.
 */
function normalizeQuantity(value) {
    const num = Math.floor(Number(value));
    return Number.isFinite(num) && num >= 1 ? num : 1;
}

/**
 * Material amount extractors per technology (FDM grams, SLA millilitres).
 */
const MATERIAL_USAGE = Object.freeze({
    FDM: { unit: 'g', read: (stats) => toNonNegativeNumber(stats.material_used_g) },
    SLA: { unit: 'ml', read: (stats) => toNonNegativeNumber(stats.material_used_ml) }
});

/**
 * Price calculator strategy: minimum quarter-hour billing, material cost, setup fee and quantity,
 * with upward rounding of the total to nearest 10 HUF.
 * perPiece = max(hours, 0.25) * hourlyRate + materialAmount * materialCostPerUnit
 * total = ceil((setupFee + quantity * perPiece) / 10) * 10
 * @param {{hourlyRate: number, materialCostPerUnit: number, setupFee: number, quantity: number, materialUnit: 'g'|'ml', stats: Record<string, number>}} input Pricing input.
 * @returns {Record<string, number|string>} Price breakdown including total_huf.
 */
function calculateQuarterHourMinimumPrice(input) {
    const { hourlyRate, materialCostPerUnit, setupFee, quantity, materialUnit, stats } = input;
    const usage = (MATERIAL_USAGE[materialUnit === 'ml' ? 'SLA' : 'FDM']).read(stats);
    const printHours = stats.print_time_seconds / 3600;
    const calcHours = Math.max(printHours, MIN_BILLABLE_HOURS);

    const timeCost = calcHours * hourlyRate;
    const materialCost = usage * materialCostPerUnit;
    const perPiece = timeCost + materialCost;
    const total = Math.ceil((setupFee + quantity * perPiece) / 10) * 10;

    return {
        time_cost_huf: roundToTwo(timeCost),
        material_cost_huf: roundToTwo(materialCost),
        setup_fee_huf: setupFee,
        per_piece_huf: roundToTwo(perPiece),
        quantity,
        total_huf: total,
        material_unit: materialUnit,
        material_cost_per_unit: materialCostPerUnit
    };
}

const PRICING_STRATEGIES = Object.freeze({
    FDM: calculateQuarterHourMinimumPrice,
    SLA: calculateQuarterHourMinimumPrice
});

/**
 * Resolve pricing calculation strategy for technology.
 * @param {'FDM'|'SLA'} technology Active print technology.
 * @returns {(input: object) => Record<string, number|string>} Pricing strategy.
 */
function resolvePricingStrategy(technology) {
    return PRICING_STRATEGIES[technology] || calculateQuarterHourMinimumPrice;
}

/**
 * Calculate request pricing for parsed print stats.
 * @param {'FDM'|'SLA'} technology Active print technology.
 * @param {string} material Material key.
 * @param {{print_time_seconds: number, material_used_g?: number, material_used_ml?: number}} stats Parsed print stats.
 * @param {number} [quantity] Number of pieces (default 1).
 * @returns {{hourlyRate: number, totalPrice: number, quantity: number, breakdown: Record<string, number|string>}} Pricing result.
 */
function calculateSlicePricing(technology, material, stats, quantity = 1) {
    const hourlyRate = getRate(technology, material);
    const normalizedQuantity = normalizeQuantity(quantity);
    const breakdown = resolvePricingStrategy(technology)({
        hourlyRate,
        materialCostPerUnit: getMaterialCost(technology, material),
        setupFee: getSetupFee(technology),
        quantity: normalizedQuantity,
        materialUnit: technology === 'SLA' ? 'ml' : 'g',
        stats
    });

    return {
        hourlyRate,
        totalPrice: breakdown.total_huf,
        quantity: normalizedQuantity,
        breakdown
    };
}

const PROFILE_RESPONSE_MAPPERS = Object.freeze({
    orca: (context) => ({
        machine_profile: path.basename(context.orcaMachineConfigFile),
        process_profile: path.basename(context.baseConfigFile)
    }),
    prusa: (context) => ({
        prusa_profile: path.basename(context.baseConfigFile)
    })
});

/**
 * Resolve profile payload mapper based on selected slicing engine.
 * @param {'prusa'|'orca'} engine Engine key.
 * @returns {(context: {baseConfigFile: string, orcaMachineConfigFile: string | null}) => Record<string, string>} Mapper function.
 */
function resolveProfileMapper(engine) {
    return PROFILE_RESPONSE_MAPPERS[engine] || PROFILE_RESPONSE_MAPPERS.prusa;
}

/**
 * Build successful slice response payload.
 * @param {{
 * engine: 'prusa'|'orca',
 * technology: 'FDM'|'SLA',
 * material: string,
 * infillPercentage: string,
 * orcaMachineConfigFile: string | null,
 * baseConfigFile: string,
 * transformOptions: {unit: 'mm'|'inch', scalePercent: number | null},
 * transformPlan: {keepProportions: boolean, requestedTargetSize: {x: number | null, y: number | null, z: number | null}, scale: {x: number, y: number, z: number}, rotationDeg: {x: number, y: number, z: number}},
 * originalModelInfo: {x: number, y: number, z: number},
 * modelBoundsValidation: {dimensions: {x: number, y: number, z: number}},
 * buildVolumeLimits: {min: {x: number, y: number, z: number}, max: {x: number, y: number, z: number}, sourceProfile: string},
 * stats: {print_time_seconds: number, print_time_readable: string, material_used_m: number, object_height_mm: number, estimated_price_huf: number}
 * }} context Response context.
 * @returns {Record<string, unknown>} API response payload.
 */
function buildSliceSuccessResponse(context) {
    const {
        engine,
        technology,
        material,
        infillPercentage,
        transformOptions,
        transformPlan,
        originalModelInfo,
        modelBoundsValidation,
        buildVolumeLimits,
        stats,
        quantity: rawQuantity
    } = context;

    const { hourlyRate, totalPrice, quantity, breakdown } = calculateSlicePricing(technology, material, stats, rawQuantity);
    const profiles = resolveProfileMapper(engine)(context);

    return {
        success: true,
        slicer_engine: engine,
        technology,
        material,
        infill: infillPercentage,
        profiles,
        model_transform: {
            size_unit: transformOptions.unit,
            keep_proportions: transformPlan.keepProportions,
            requested_size: {
                x: transformPlan.requestedTargetSize.x === null ? null : roundToThree(transformPlan.requestedTargetSize.x),
                y: transformPlan.requestedTargetSize.y === null ? null : roundToThree(transformPlan.requestedTargetSize.y),
                z: transformPlan.requestedTargetSize.z === null ? null : roundToThree(transformPlan.requestedTargetSize.z)
            },
            scale_percent: transformOptions.scalePercent,
            scale_factors: roundDimensions(transformPlan.scale),
            rotation_deg: roundDimensions(transformPlan.rotationDeg),
            original_dimensions_mm: roundDimensions({
                x: originalModelInfo.x,
                y: originalModelInfo.y,
                z: originalModelInfo.z
            }),
            final_dimensions_mm: roundDimensions(modelBoundsValidation.dimensions)
        },
        build_volume_limits_mm: {
            min: roundDimensions(buildVolumeLimits.min),
            max: roundDimensions(buildVolumeLimits.max),
            source_profile: buildVolumeLimits.sourceProfile
        },
        hourly_rate: hourlyRate,
        quantity,
        price_breakdown: breakdown,
        stats: {
            ...stats,
            estimated_price_huf: totalPrice
        }
    };
}

module.exports = {
    buildSliceSuccessResponse,
    calculateSlicePricing,
    resolveProfileMapper,
    resolvePricingStrategy
};
