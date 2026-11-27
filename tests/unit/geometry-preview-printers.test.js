'use strict';

process.env.PYTHON_EXECUTABLE = process.execPath;
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'unit-test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { parseSliceOptions } = require('../../app/services/slice/options');
const { buildModelGeometry } = require('../../app/services/slice/response');
const {
    resolveBuildVolumeLimits,
    resolvePrusaBedCenter,
    resolveMaterialOverlayPath,
    resolvePrinterProfilePrefix
} = require('../../app/services/slice/profiles');

const CONFIGS = path.resolve(__dirname, '..', '..', 'configs');

test('includePreview defaults to false and accepts boolean-like values', () => {
    assert.equal(parseSliceOptions({}, 'FDM').options.includePreview, false);
    for (const [raw, expected] of [['true', true], ['1', true], ['no', false], [false, false]]) {
        const result = parseSliceOptions({ includePreview: raw }, 'FDM');
        assert.equal(result.isValid, true, String(raw));
        assert.equal(result.options.includePreview, expected, String(raw));
    }
});

test('invalid includePreview returns INVALID_INCLUDE_PREVIEW', () => {
    const result = parseSliceOptions({ includePreview: 'maybe' }, 'FDM');
    assert.equal(result.isValid, false);
    assert.equal(result.response.errorCode, 'INVALID_INCLUDE_PREVIEW');
});

test('buildModelGeometry converts units and only reports volume for watertight meshes', () => {
    assert.deepEqual(
        buildModelGeometry({ volume_mm3: 13600, surface_area_mm2: 5480, is_watertight: true, triangle_count: 24 }),
        { volume_cm3: 13.6, surface_area_cm2: 54.8, is_watertight: true, triangle_count: 24 }
    );
    assert.equal(buildModelGeometry({ volume_mm3: 0, surface_area_mm2: 100, is_watertight: false, triangle_count: 4 }).volume_cm3, null);
    assert.deepEqual(buildModelGeometry(undefined), {
        volume_cm3: null, surface_area_cm2: null, is_watertight: null, triangle_count: null
    });
});

test('printer prefix is derived only from printer-specific profile names', () => {
    assert.equal(resolvePrinterProfilePrefix('/x/MK4_FDM_0.2mm.ini'), 'MK4');
    assert.equal(resolvePrinterProfilePrefix('/x/FDM_0.2mm.ini'), null);
    assert.equal(resolvePrinterProfilePrefix('/x/SLA_0.05mm.ini'), null);
    assert.equal(resolvePrinterProfilePrefix(null), null);
});

test('printer-specific material overlays win, with generic fallback', () => {
    assert.equal(path.basename(resolveMaterialOverlayPath('prusa', 'FDM', 'PETG', 0.2, 'MK4')), 'MK4_FDM_PETG.ini');
    assert.equal(path.basename(resolveMaterialOverlayPath('prusa', 'FDM', 'PETG', 0.2, null)), 'FDM_PETG.ini');
    assert.equal(path.basename(resolveMaterialOverlayPath('prusa', 'FDM', 'PETG', 0.2, 'NOPE')), 'FDM_PETG.ini');
    assert.equal(resolveMaterialOverlayPath('prusa', 'FDM', 'PETG', 0.2, '../x'), path.join(CONFIGS, 'prusa', 'materials', 'FDM_PETG.ini'));
});

test('MK4 profiles expose the real MK4 build volume and bed center', () => {
    for (const layer of ['0.1', '0.2', '0.3']) {
        const profile = path.join(CONFIGS, 'prusa', `MK4_FDM_${layer}mm.ini`);
        assert.deepEqual(resolveBuildVolumeLimits('prusa', 'FDM', profile, null).max, { x: 250, y: 210, z: 220 });
        assert.deepEqual(resolvePrusaBedCenter(profile), { x: 125, y: 105 });
    }
});

test('Bambu A1 and A1 mini machine profiles expose their build volumes', () => {
    const process02 = path.join(CONFIGS, 'orca', 'FDM_0.2mm.json');
    assert.deepEqual(
        resolveBuildVolumeLimits('orca', 'FDM', process02, path.join(CONFIGS, 'orca', 'Bambu_A1_0.4_nozzle.json')).max,
        { x: 256, y: 256, z: 256 }
    );
    assert.deepEqual(
        resolveBuildVolumeLimits('orca', 'FDM', process02, path.join(CONFIGS, 'orca', 'Bambu_A1_mini_0.4_nozzle.json')).max,
        { x: 180, y: 180, z: 180 }
    );
});
