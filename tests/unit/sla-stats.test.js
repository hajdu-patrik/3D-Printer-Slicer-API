'use strict';

process.env.PYTHON_EXECUTABLE = process.execPath;
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'unit-test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ZipArchive } = require('archiver');

const { parseIni, readSl1Metadata } = require('../../app/services/slice/sla-stats');
const { parseOutputDetailed } = require('../../app/services/slice/model-stats');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl1-'));
test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

/**
 * Write a zip with the given entries.
 * @param {string} file Target path.
 * @param {Record<string, string>} entries Entry name to content.
 * @returns {Promise<void>}
 */
function writeZip(file, entries) {
    return new Promise((resolve, reject) => {
        const out = fs.createWriteStream(file);
        const archive = new ZipArchive();
        out.on('close', resolve);
        out.on('error', reject);
        archive.on('error', reject);
        archive.pipe(out);
        for (const [name, content] of Object.entries(entries)) {
            archive.append(content, { name });
        }
        archive.finalize();
    });
}

test('parseIni parses key = value and skips comments', () => {
    const ini = parseIni('; c\n# c\nprintTime = 12.5\r\nusedMaterial=3.2\nbad line\n');
    assert.deepEqual(ini, { printTime: '12.5', usedMaterial: '3.2' });
});

test('readSl1Metadata reads printTime and usedMaterial from config.ini', async () => {
    const file = path.join(tmpDir, 'ok.sl1');
    await writeZip(file, {
        'config.ini': 'printTime = 3661.4\nusedMaterial = 12.5\nlayerHeight = 0.05\n',
        'layer0.png': 'x'
    });
    assert.deepEqual(await readSl1Metadata(file), { print_time_seconds: 3661, material_used_ml: 12.5 });
});

test('readSl1Metadata returns null without usable printTime', async () => {
    const file = path.join(tmpDir, 'none.sl1');
    await writeZip(file, { 'config.ini': 'usedMaterial = 1\n' });
    assert.equal(await readSl1Metadata(file), null);
});

test('parseOutputDetailed uses real SLA metadata with slicer source', async () => {
    const file = path.join(tmpDir, 'real.sl1');
    await writeZip(file, { 'config.ini': 'printTime = 5400\nusedMaterial = 20\n' });
    const stats = await parseOutputDetailed(file, 'SLA', 0.05, 30, 'prusa');
    assert.equal(stats.print_time_seconds, 5400);
    assert.equal(stats.print_time_source, 'slicer');
    assert.equal(stats.material_used_ml, 20);
    assert.equal(stats.print_time_readable, '1h 30m');
});

test('corrupt .sl1 falls back to the heuristic estimate', async () => {
    const file = path.join(tmpDir, 'corrupt.sl1');
    fs.writeFileSync(file, 'this is not a zip');
    const stats = await parseOutputDetailed(file, 'SLA', 0.05, 10, 'prusa');
    // 120 + ceil(10 / 0.05) * 11
    assert.equal(stats.print_time_seconds, 120 + 200 * 11);
    assert.equal(stats.print_time_source, 'estimate');
    assert.match(stats.print_time_readable, /\(Est\.\)$/);
});

test('FDM gcode output sets slicer source', async () => {
    const file = path.join(tmpDir, 'a.gcode');
    fs.writeFileSync(file, '; estimated printing time (normal mode) = 10m 0s\n; filament used [g] = 2\n');
    const stats = await parseOutputDetailed(file, 'FDM', 0.2, 20, 'prusa');
    assert.equal(stats.print_time_seconds, 600);
    assert.equal(stats.print_time_source, 'slicer');
    assert.equal(stats.material_used_g, 2);
    assert.equal(stats.print_time_readable, '0h 10m');
});
