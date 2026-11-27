'use strict';

process.env.PYTHON_EXECUTABLE = process.execPath;
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'unit-test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { parseSliceOptions } = require('../../app/services/slice/options');
const { buildSlicerCommandArgs } = require('../../app/services/slice/engine');
const { resolvePrusaBedCenter, resolveMaterialOverlayPath } = require('../../app/services/slice/profiles');

const REPO = path.resolve(__dirname, '..', '..');

test('parseSliceOptions defaults', () => {
    const result = parseSliceOptions({}, 'FDM', 'prusa');
    assert.equal(result.isValid, true);
    assert.equal(result.options.autoOrient, true);
    assert.equal(result.options.quantity, 1);
    assert.equal(result.options.technology, 'FDM');
    assert.match(result.options.infillPercentage, /^\d+%$/);
});

test('autoOrient accepts boolean-like values', () => {
    const cases = [['true', true], ['false', false], ['1', true], ['0', false], ['yes', true], ['no', false], [true, true], [false, false]];
    for (const [raw, expected] of cases) {
        const result = parseSliceOptions({ autoOrient: raw }, 'FDM');
        assert.equal(result.isValid, true, String(raw));
        assert.equal(result.options.autoOrient, expected, String(raw));
    }
});

test('autoOrient rejects invalid values', () => {
    const result = parseSliceOptions({ autoOrient: 'maybe' }, 'FDM');
    assert.equal(result.isValid, false);
    assert.equal(result.response.errorCode, 'INVALID_AUTO_ORIENT');
});

test('quantity accepts 1..1000 and rejects the rest', () => {
    for (const raw of ['1', '5', '1000', 7]) {
        const result = parseSliceOptions({ quantity: raw }, 'FDM');
        assert.equal(result.isValid, true, String(raw));
        assert.equal(result.options.quantity, Number(raw));
    }
    for (const raw of ['0', '1001', '-1', '1.5', 'abc', '1e2']) {
        const result = parseSliceOptions({ quantity: raw }, 'FDM');
        assert.equal(result.isValid, false, String(raw));
        assert.equal(result.response.errorCode, 'INVALID_QUANTITY');
    }
});

test('Prusa FDM args: --center from bed center, default 100,100 when null', () => {
    const withCenter = buildSlicerCommandArgs('FDM', 'cfg.ini', '/o/out.gcode', '20%', 'prusa', null, { x: 128, y: 128 });
    assert.deepEqual(withCenter.slice(0, 4), ['--load', 'cfg.ini', '--center', '128,128']);
    assert.ok(withCenter.includes('--export-gcode'));
    assert.equal(withCenter[withCenter.indexOf('--fill-density') + 1], '20%');

    const fallback = buildSlicerCommandArgs('FDM', 'cfg.ini', '/o/out.gcode', '20%', 'prusa', null, null);
    assert.equal(fallback[fallback.indexOf('--center') + 1], '100,100');
});

test('Prusa SLA args export sla', () => {
    const args = buildSlicerCommandArgs('SLA', 'cfg.ini', '/o/out.sl1', '20%', 'prusa');
    assert.ok(args.includes('--export-sla'));
    assert.ok(!args.includes('--export-gcode'));
});

test('Orca args: --orient 0 and --load-filaments only when given', () => {
    const out = path.join('o', 'x.gcode');
    const without = buildSlicerCommandArgs('FDM', 'proc.json', out, '20%', 'orca', 'machine.json');
    assert.equal(without[without.indexOf('--orient') + 1], '0');
    assert.equal(without[without.indexOf('--load-settings') + 1], 'machine.json;proc.json');
    assert.ok(!without.includes('--load-filaments'));
    assert.ok(!without.includes('--center'));

    const withFilament = buildSlicerCommandArgs('FDM', 'proc.json', out, '20%', 'orca', 'machine.json', null, 'fil.json');
    assert.equal(withFilament[withFilament.indexOf('--load-filaments') + 1], 'fil.json');
});

test('resolvePrusaBedCenter reads bed_shape from FDM_0.2mm.ini', () => {
    assert.deepEqual(resolvePrusaBedCenter(path.join(REPO, 'configs', 'prusa', 'FDM_0.2mm.ini')), { x: 128, y: 128 });
    assert.equal(resolvePrusaBedCenter(path.join(REPO, 'configs', 'prusa', 'does-not-exist.ini')), null);
    assert.equal(resolvePrusaBedCenter(null), null);
});

test('resolveMaterialOverlayPath resolves known and rejects unsafe/unknown names', () => {
    const known = resolveMaterialOverlayPath('prusa', 'FDM', 'PLA', 0.2);
    assert.ok(known && known.endsWith('FDM_PLA.ini'));
    const sla = resolveMaterialOverlayPath('prusa', 'SLA', 'Flexible', 0.05);
    assert.ok(sla && sla.endsWith('SLA_Flexible_0.05mm.ini'));

    assert.equal(resolveMaterialOverlayPath('prusa', 'FDM', '../x', 0.2), null);
    assert.equal(resolveMaterialOverlayPath('prusa', 'FDM', '..\\x', 0.2), null);
    assert.equal(resolveMaterialOverlayPath('prusa', 'FDM', 'PLA/../../x', 0.2), null);
    assert.equal(resolveMaterialOverlayPath('prusa', 'FDM', 'Unobtainium', 0.2), null);
    assert.equal(resolveMaterialOverlayPath('prusa', 'FDM', '', 0.2), null);
    assert.equal(resolveMaterialOverlayPath('prusa', 'FDM', null), null);
});
