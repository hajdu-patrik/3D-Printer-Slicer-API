/**
 * ZIP inspection and safe extraction helpers for uploaded archives.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { EXTENSIONS } = require('../../config/constants');
const { parsePositiveInt } = require('./number-utils');

const DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_ZIP_UNCOMPRESSED_BYTES = parsePositiveInt(
    process.env.MAX_ZIP_UNCOMPRESSED_BYTES || `${DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES}`,
    DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES
);
const MAX_ZIP_ENTRIES = parsePositiveInt(process.env.MAX_ZIP_ENTRIES || '200', 200);

/**
 * Open ZIP archive in lazy-entry mode for safe bounded traversal.
 * @param {string} zipPath Path to ZIP file.
 * @returns {Promise<import('yauzl').ZipFile>} Opened zip handle.
 */
function openZip(zipPath) {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
            if (err) return reject(err);
            return resolve(zipFile);
        });
    });
}

/**
 * Sleep helper for retry pacing.
 * @param {number} ms Wait duration in milliseconds.
 * @returns {Promise<void>} Promise resolved after timeout.
 */
function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Open ZIP with retries to mitigate transient filesystem visibility delays.
 * @param {string} zipPath ZIP path.
 * @param {number} [attempts=5] Maximum open attempts.
 * @param {number} [waitMs=80] Delay between retries in milliseconds.
 * @returns {Promise<import('yauzl').ZipFile>} Opened zip handle.
 */
async function openZipWithRetry(zipPath, attempts = 5, waitMs = 80) {
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await openZip(zipPath);
        } catch (error_) {
            lastError = error_;
            if (error_?.code !== 'ENOENT' || attempt === attempts) {
                throw error_;
            }
            await sleepMs(waitMs);
        }
    }

    throw lastError || new Error(`ZIP_GUARD|Unable to open ZIP file: ${zipPath}`);
}

/**
 * Detect unsafe ZIP entry names (path traversal / absolute paths).
 * @param {string} entryPath ZIP internal entry name.
 * @returns {boolean} True when the entry path is unsafe.
 */
function isUnsafeZipPath(entryPath) {
    const normalized = path.posix.normalize(entryPath).replaceAll('\\', '/');
    if (path.posix.isAbsolute(normalized)) return true;
    return normalized.split('/').includes('..');
}

/**
 * Inspect ZIP entries before extraction to enforce anti-zip-bomb constraints.
 * @param {string} zipPath Path to ZIP archive.
 * @param {Set<string>} supportedExts Allowed extension set.
 * @returns {Promise<string[]>} Candidate entry names matching supported extensions.
 */
async function inspectZipFile(zipPath, supportedExts) {
    const zipFile = await openZipWithRetry(zipPath);

    return new Promise((resolve, reject) => {
        let totalUncompressed = 0;
        let entryCount = 0;
        const candidates = [];

        zipFile.on('entry', (entry) => {
            entryCount += 1;
            if (entryCount > MAX_ZIP_ENTRIES) {
                zipFile.close();
                reject(new Error('ZIP_GUARD|ZIP contains too many files.'));
                return;
            }

            if (entry.generalPurposeBitFlag & 0x1) {
                zipFile.close();
                reject(new Error('ZIP_GUARD|Encrypted ZIP files are not supported.'));
                return;
            }

            if (isUnsafeZipPath(entry.fileName)) {
                zipFile.close();
                reject(new Error('ZIP_GUARD|ZIP contains unsafe file paths.'));
                return;
            }

            totalUncompressed += entry.uncompressedSize;
            if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
                zipFile.close();
                reject(new Error('ZIP_GUARD|ZIP extracted size exceeds allowed limit.'));
                return;
            }

            if (!entry.fileName.endsWith('/')) {
                const ext = path.extname(entry.fileName).toLowerCase();
                if (supportedExts.has(ext)) {
                    candidates.push(entry.fileName);
                }
            }

            zipFile.readEntry();
        });

        zipFile.once('end', () => {
            zipFile.close();
            resolve(candidates);
        });

        zipFile.once('error', (err) => {
            reject(err);
        });

        zipFile.readEntry();
    });
}

/**
 * Extract a single validated ZIP entry to destination path.
 * @param {string} zipPath Path to ZIP archive.
 * @param {string} entryName Entry name inside ZIP.
 * @param {string} destinationPath Absolute output path.
 * @returns {Promise<string>} Extracted file path.
 */
async function extractZipEntry(zipPath, entryName, destinationPath) {
    const zipFile = await openZipWithRetry(zipPath);

    return new Promise((resolve, reject) => {
        let extracted = false;

        zipFile.on('entry', (entry) => {
            if (entry.fileName !== entryName) {
                zipFile.readEntry();
                return;
            }

            extracted = true;

            zipFile.openReadStream(entry, async (err, readStream) => {
                if (err) {
                    zipFile.close();
                    reject(err);
                    return;
                }

                try {
                    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
                    await pipeline(readStream, fs.createWriteStream(destinationPath, { flags: 'w' }));
                    zipFile.close();
                    resolve(destinationPath);
                } catch (error_) {
                    zipFile.close();
                    reject(error_);
                }
            });
        });

        zipFile.once('end', () => {
            if (!extracted) {
                reject(new Error('ZIP_GUARD|No supported file found in ZIP archive.'));
            }
        });

        zipFile.once('error', (err) => {
            reject(err);
        });

        zipFile.readEntry();
    });
}

/**
 * Resolve runtime ZIP path variations (`.zip` renamed during upload pipeline).
 * @param {string} zipPath Candidate ZIP file path.
 * @returns {string} Existing ZIP path.
 */
function resolveExistingZipPath(zipPath) {
    if (fs.existsSync(zipPath)) return zipPath;

    if (zipPath.toLowerCase().endsWith('.zip')) {
        const withoutExt = zipPath.slice(0, -4);
        if (fs.existsSync(withoutExt)) return withoutExt;
    } else {
        const withExt = `${zipPath}.zip`;
        if (fs.existsSync(withExt)) return withExt;
    }

    throw new Error(`ZIP_GUARD|Uploaded ZIP file is not accessible at runtime: ${zipPath}`);
}

/**
 * Extract first supported file from uploaded ZIP archive.
 * @param {string} inputFile Uploaded zip file path.
 * @param {string[]} filesCleanupList Collector for temp paths.
 * @returns {Promise<string>} Extracted file path.
 */
async function extractFirstSupportedFromZip(inputFile, filesCleanupList) {
    console.log('[INFO] Extracting ZIP...');
    const zipPath = resolveExistingZipPath(inputFile);

    const unzipDir = path.join(path.dirname(inputFile), `unzip_${Date.now()}`);
    if (!fs.existsSync(unzipDir)) fs.mkdirSync(unzipDir);

    filesCleanupList.push(unzipDir);
    const supportedExts = new Set([...EXTENSIONS.direct, ...EXTENSIONS.cad, ...EXTENSIONS.image, ...EXTENSIONS.vector]);

    const zipCandidates = await inspectZipFile(zipPath, supportedExts);
    const selectedEntry = zipCandidates[0];
    if (!selectedEntry) throw new Error('ZIP does not contain a supported 3D/Image/Vector file.');

    const selectedName = path.basename(selectedEntry);
    const extractedPath = path.join(unzipDir, selectedName);
    await extractZipEntry(zipPath, selectedEntry, extractedPath);

    const extractedFiles = fs.readdirSync(unzipDir);
    const foundFile = extractedFiles.find((f) => supportedExts.has(path.extname(f).toLowerCase()));
    if (!foundFile) throw new Error('ZIP does not contain a supported 3D/Image/Vector file.');

    console.log(`[INFO] Found in ZIP: ${foundFile}`);
    return path.join(unzipDir, foundFile);
}

module.exports = {
    extractFirstSupportedFromZip
};
