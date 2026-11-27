'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    parseTimeString,
    extractPrintTimeSeconds,
    extractMaterialUsage,
    readGcodeMetadata
} = require('../../app/services/slice/gcode-metadata');

test('parseTimeString handles unit tokens and bare numbers', () => {
    assert.equal(parseTimeString('1d 2h 3m 4s'), 93784);
    assert.equal(parseTimeString('3m 4s'), 184);
    assert.equal(parseTimeString('350ms'), 0);
    assert.equal(parseTimeString('45'), 45);
    assert.equal(parseTimeString(''), 0);
    assert.equal(parseTimeString(undefined), 0);
    assert.equal(parseTimeString('2h'), 7200);
});

test('Prusa normal-mode estimate beats M73 remaining time', () => {
    const content = [
        'M73 P0 R99',
        '; estimated printing time (normal mode) = 1h 2m 3s'
    ].join('\n');
    assert.deepEqual(extractPrintTimeSeconds(content), { seconds: 3723, found: true });
});

test('Orca header total estimated time is parsed', () => {
    const content = '; total estimated time: 1h 5m 10s\n; other = 1';
    assert.deepEqual(extractPrintTimeSeconds(content), { seconds: 3910, found: true });
});

test('M73 P0 R minutes is the last-resort fallback', () => {
    assert.deepEqual(extractPrintTimeSeconds('M73 P0 R12\n'), { seconds: 720, found: true });
    assert.deepEqual(extractPrintTimeSeconds('G1 X1\n'), { seconds: 0, found: false });
});

test('material usage: meters, grams and cm3', () => {
    const content = [
        '; filament used [mm] = 2500.50',
        '; filament used [cm3] = 6.01',
        '; filament used [g] = 7.5'
    ].join('\n');
    const usage = extractMaterialUsage(content);
    assert.ok(Math.abs(usage.material_used_m - 2.5005) < 1e-9);
    assert.equal(usage.material_used_ml, 6.01);
    assert.equal(usage.material_used_g, 7.5);
});

test('multi-extruder comma lists are summed', () => {
    const content = '; filament used [g] = 1.5, 2.5\n; filament used [mm] = 1000, 500\n';
    const usage = extractMaterialUsage(content);
    assert.equal(usage.material_used_g, 4);
    assert.equal(usage.material_used_m, 1.5);
});

test('missing material data yields zeros', () => {
    assert.deepEqual(extractMaterialUsage('G1 X1\n'), {
        material_used_m: 0,
        material_used_g: 0,
        material_used_ml: 0
    });
});

test('readGcodeMetadata reads header and footer of a >600 KB file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcode-meta-'));
    try {
        const file = path.join(dir, 'big.gcode');
        const filler = 'G1 X10.000 Y10.000 E0.12345\n'.repeat(25000);
        const head = '; total estimated time: 2m 30s\n';
        const tail = '; filament used [g] = 3.25\n; filament used [mm] = 1000\n';
        fs.writeFileSync(file, head + filler + tail);
        assert.ok(fs.statSync(file).size > 600 * 1024);

        const meta = await readGcodeMetadata(file);
        assert.equal(meta.print_time_seconds, 150);
        assert.equal(meta.material_used_g, 3.25);
        assert.equal(meta.material_used_m, 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
