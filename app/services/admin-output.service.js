/**
 * Admin output artifact validation and listing service.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULTS } = require('../config/constants');
const { OUTPUT_DIR } = require('../config/paths');
const { parsePositiveInt } = require('./slice/number-utils');

const ALLOWED_OUTPUT_EXTENSIONS = new Set(['.gcode', '.sl1']);
const BULK_DOWNLOAD_ALL_TOKEN = 'ALL';
const MAX_BULK_DOWNLOAD_ENTRIES = parsePositiveInt(
    process.env.MAX_ZIP_ENTRIES || `${DEFAULTS.MAX_ZIP_ENTRIES}`,
    DEFAULTS.MAX_ZIP_ENTRIES
);
const MAX_BULK_DOWNLOAD_BYTES = parsePositiveInt(
    process.env.MAX_ZIP_UNCOMPRESSED_BYTES || `${DEFAULTS.MAX_ZIP_UNCOMPRESSED_BYTES}`,
    DEFAULTS.MAX_ZIP_UNCOMPRESSED_BYTES
);

function createFailure(status, error, errorCode) {
    return {
        success: false,
        status,
        error,
        errorCode
    };
}

function isAllowedOutputFileName(fileName) {
    if (!fileName || fileName.includes('/') || fileName.includes('\\')) return false;
    return ALLOWED_OUTPUT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isPathWithin(parentPath, candidatePath) {
    const relative = path.relative(parentPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveOutputDirectoryPaths() {
    const resolvedOutputDir = path.resolve(OUTPUT_DIR);

    try {
        const resolvedOutputDirRealPath = fs.realpathSync(resolvedOutputDir);
        return {
            success: true,
            resolvedOutputDir,
            resolvedOutputDirRealPath
        };
    } catch {
        return createFailure(500, 'Failed to access output directory.', 'OUTPUT_DIRECTORY_UNAVAILABLE');
    }
}

function resolveValidatedOutputFile(fileName, resolvedOutputDir, resolvedOutputDirRealPath) {
    if (!isAllowedOutputFileName(fileName)) {
        return createFailure(400, 'Invalid output file name.', 'INVALID_OUTPUT_FILE');
    }

    const requestedPath = path.resolve(path.join(resolvedOutputDir, fileName));
    if (!isPathWithin(resolvedOutputDir, requestedPath)) {
        return createFailure(400, 'Invalid output file path.', 'INVALID_OUTPUT_FILE_PATH');
    }

    if (!fs.existsSync(requestedPath)) {
        return createFailure(404, 'Output file not found.', 'OUTPUT_FILE_NOT_FOUND');
    }

    let requestedFileStats;
    try {
        requestedFileStats = fs.lstatSync(requestedPath);
    } catch {
        return createFailure(404, 'Output file not found.', 'OUTPUT_FILE_NOT_FOUND');
    }

    if (!requestedFileStats.isFile() || requestedFileStats.isSymbolicLink()) {
        return createFailure(400, 'Invalid output file target.', 'INVALID_OUTPUT_FILE_TARGET');
    }

    let resolvedFileRealPath;
    try {
        resolvedFileRealPath = fs.realpathSync(requestedPath);
    } catch {
        return createFailure(404, 'Output file not found.', 'OUTPUT_FILE_NOT_FOUND');
    }

    if (!isPathWithin(resolvedOutputDirRealPath, resolvedFileRealPath)) {
        return createFailure(400, 'Invalid output file path.', 'INVALID_OUTPUT_FILE_PATH');
    }

    return {
        success: true,
        fileName,
        realPath: resolvedFileRealPath,
        sizeBytes: requestedFileStats.size,
        createdAt: requestedFileStats.birthtime.toISOString(),
        modifiedAt: requestedFileStats.mtime.toISOString()
    };
}

function shouldSkipUnsafeOutputEntry(validated) {
    return (
        validated.errorCode === 'OUTPUT_FILE_NOT_FOUND' ||
        validated.errorCode === 'INVALID_OUTPUT_FILE' ||
        validated.errorCode === 'INVALID_OUTPUT_FILE_PATH' ||
        validated.errorCode === 'INVALID_OUTPUT_FILE_TARGET'
    );
}

function listValidatedOutputFiles(resolvedOutputDir, resolvedOutputDirRealPath) {
    let entries;
    try {
        entries = fs.readdirSync(resolvedOutputDir, { withFileTypes: true });
    } catch {
        return createFailure(500, 'Failed to list output files.', 'OUTPUT_FILES_LIST_FAILED');
    }

    const files = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;

        const validated = resolveValidatedOutputFile(entry.name, resolvedOutputDir, resolvedOutputDirRealPath);
        if (!validated.success) {
            if (shouldSkipUnsafeOutputEntry(validated) && validated.errorCode !== 'OUTPUT_FILE_NOT_FOUND') {
                const logToken = entry.name || 'n/a';
                console.warn(`[ADMIN OUTPUT] Skipping unsafe output entry: ${logToken}`);
            }

            if (shouldSkipUnsafeOutputEntry(validated)) continue;
            return validated;
        }

        files.push(validated);
    }

    files.sort((left, right) => left.fileName.localeCompare(right.fileName));

    return {
        success: true,
        files
    };
}

function getValidatedOutputFile(fileName) {
    const outputDirPaths = resolveOutputDirectoryPaths();
    if (!outputDirPaths.success) return outputDirPaths;

    return resolveValidatedOutputFile(
        fileName,
        outputDirPaths.resolvedOutputDir,
        outputDirPaths.resolvedOutputDirRealPath
    );
}

function getValidatedOutputFiles() {
    const outputDirPaths = resolveOutputDirectoryPaths();
    if (!outputDirPaths.success) return outputDirPaths;

    return listValidatedOutputFiles(outputDirPaths.resolvedOutputDir, outputDirPaths.resolvedOutputDirRealPath);
}

function listOutputFileSummaries() {
    const validatedFiles = getValidatedOutputFiles();
    if (!validatedFiles.success) return validatedFiles;

    const files = validatedFiles.files
        .map((file) => ({
            fileName: file.fileName,
            downloadUrl: `/admin/download/${encodeURIComponent(file.fileName)}`,
            sizeBytes: file.sizeBytes,
            createdAt: file.createdAt,
            modifiedAt: file.modifiedAt
        }))
        .sort((left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime());

    return {
        success: true,
        total: files.length,
        files
    };
}

function validateBulkDownloadLimits(files) {
    if (files.length > MAX_BULK_DOWNLOAD_ENTRIES) {
        return createFailure(
            413,
            `Bulk download exceeds the maximum file count of ${MAX_BULK_DOWNLOAD_ENTRIES}.`,
            'BULK_DOWNLOAD_LIMIT_EXCEEDED'
        );
    }

    const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (totalBytes > MAX_BULK_DOWNLOAD_BYTES) {
        return createFailure(
            413,
            `Bulk download exceeds the maximum archive input size of ${MAX_BULK_DOWNLOAD_BYTES} bytes.`,
            'BULK_DOWNLOAD_LIMIT_EXCEEDED'
        );
    }

    return {
        success: true,
        totalBytes,
        maxEntries: MAX_BULK_DOWNLOAD_ENTRIES,
        maxBytes: MAX_BULK_DOWNLOAD_BYTES
    };
}

module.exports = {
    BULK_DOWNLOAD_ALL_TOKEN,
    getValidatedOutputFile,
    getValidatedOutputFiles,
    listOutputFileSummaries,
    validateBulkDownloadLimits
};
