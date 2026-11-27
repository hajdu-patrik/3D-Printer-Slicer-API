/**
 * SL1 (.sl1 ZIP) metadata parsing. Reads only the small ini entry in memory.
 *
 * PrusaSlicer SL1Archive::export_print writes `config.ini` with (among others):
 * printTime (seconds, float), usedMaterial (ml = mm3 / 1000), numFade, numSlow,
 * numFast, layerHeight, materialName. `prusaslicer.ini` holds the full print config.
 */

const yauzl = require('yauzl');

const MAX_INI_BYTES = 1024 * 1024;
const INI_ENTRY_NAMES = ['config.ini', 'prusaslicer.ini'];

/**
 * Parse `key = value` ini text into an object.
 * @param {string} text Ini content.
 * @returns {Record<string, string>} Key/value map.
 */
function parseIni(text) {
    const result = {};
    for (const line of String(text).split(/\r?\n/)) {
        const idx = line.indexOf('=');
        if (idx <= 0 || line.trimStart().startsWith(';') || line.trimStart().startsWith('#')) continue;
        result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return result;
}

/**
 * Read selected root-level ini entries from a ZIP, with a per-entry size cap.
 * @param {string} zipPath SL1 file path.
 * @returns {Promise<Record<string, string>>} Entry name (lowercase) to text.
 */
function readIniEntries(zipPath) {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (openErr, zipFile) => {
            if (openErr) return reject(openErr);

            const found = {};
            let settled = false;
            const finish = (err) => {
                if (settled) return;
                settled = true;
                zipFile.close();
                if (err) reject(err);
                else resolve(found);
            };

            zipFile.on('entry', (entry) => {
                const name = entry.fileName.toLowerCase();
                if (!INI_ENTRY_NAMES.includes(name) || entry.uncompressedSize > MAX_INI_BYTES) {
                    zipFile.readEntry();
                    return;
                }

                zipFile.openReadStream(entry, (streamErr, stream) => {
                    if (streamErr) return finish(streamErr);

                    const chunks = [];
                    let total = 0;
                    stream.on('data', (chunk) => {
                        total += chunk.length;
                        if (total > MAX_INI_BYTES) {
                            stream.destroy();
                            finish(new Error('SL1 ini entry exceeds size cap'));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    stream.once('error', finish);
                    stream.once('end', () => {
                        found[name] = Buffer.concat(chunks).toString('utf8');
                        zipFile.readEntry();
                    });
                    return undefined;
                });
            });

            zipFile.once('end', () => finish());
            zipFile.once('error', finish);
            zipFile.readEntry();
            return undefined;
        });
    });
}

/**
 * Read real SLA print time and material usage from an `.sl1` archive.
 * @param {string} filePath SL1 path.
 * @returns {Promise<{print_time_seconds: number, material_used_ml: number}|null>} Metadata, or null when unavailable.
 */
async function readSl1Metadata(filePath) {
    const entries = await readIniEntries(filePath);

    for (const name of INI_ENTRY_NAMES) {
        if (!entries[name]) continue;
        const ini = parseIni(entries[name]);
        const printTime = Number.parseFloat(ini.printTime);
        const usedMaterial = Number.parseFloat(ini.usedMaterial);
        if (Number.isFinite(printTime) && printTime > 0) {
            return {
                print_time_seconds: Math.round(printTime),
                material_used_ml: Number.isFinite(usedMaterial) && usedMaterial > 0 ? usedMaterial : 0
            };
        }
    }

    return null;
}

module.exports = { parseIni, readSl1Metadata };
