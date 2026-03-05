/**
 * Slice pipeline error classification and HTTP response mapping.
 */

const { DEFAULTS } = require('../../config/constants');
const { logError } = require('../../utils/logger');
const { cleanupFiles } = require('./common');

/**
 * Detect converter-level geometry failures from command output.
 * @param {{message?: string, stderr?: string}} err Command error payload.
 * @returns {boolean} True when invalid source geometry is detected.
 */
function isSourceGeometryError(err) {
    const combined = `${err?.message || ''}\n${err?.stderr || ''}`.toLowerCase();

    const failedConverter = (
        combined.includes('vector2stl.py') ||
        combined.includes('cad2stl.py') ||
        combined.includes('mesh2stl.py') ||
        combined.includes('img2stl.py')
    );

    const geometryHints = [
        'critical error',
        'no 2d geometry found',
        'no closed 2d geometry',
        'invalid polygon geometry',
        'could not create any geometry',
        'scene is empty',
        'mesh generation failed',
        'conversion failed',
        'cannot identify image file',
        'failed to load path geometry',
        'no 2d geometry found',
        'could not be parsed into closed shapes',
        'contains open curves/paths',
        'contains invalid shapes',
        'not supported or is corrupted',
        'impossible to mesh periodic surface',
        'invalid file'
    ];

    return failedConverter && geometryHints.some((hint) => combined.includes(hint));
}

/**
 * Detect user-facing ZIP archive validation failures.
 * @param {{message?: string, stderr?: string}} err Command error payload.
 * @returns {boolean} True when archive validation failed.
 */
function isZipInputError(err) {
    const combined = `${err?.message || ''}\n${err?.stderr || ''}`.toLowerCase();
    return (
        combined.includes('zip_guard|') ||
        combined.includes('zip does not contain a supported') ||
        combined.includes('encrypted zip files are not supported') ||
        combined.includes('zip contains unsafe file paths') ||
        combined.includes('zip contains too many files') ||
        combined.includes('zip extracted size exceeds allowed limit') ||
        (combined.includes('enoent') && combined.includes('.zip'))
    );
}

/**
 * Detect timeout conditions from process execution errors.
 * @param {{message?: string, stderr?: string, killed?: boolean}} err Command error payload.
 * @returns {boolean} True when timeout condition matched.
 */
function isProcessingTimeoutError(err) {
    const combined = `${err?.message || ''}\n${err?.stderr || ''}`.toLowerCase();
    return (
        combined.includes(`timed out after ${DEFAULTS.SLICE_TIMEOUT_MINUTES} minutes`) ||
        combined.includes('etimedout') ||
        err?.killed === true
    );
}

/**
 * Detect unsupported input format failures emitted by converters/slicers.
 * @param {{message?: string, stderr?: string}} err Command error payload.
 * @returns {boolean} True when unsupported format is indicated.
 */
function isUnsupportedInputFormatError(err) {
    const combined = `${err?.message || ''}\n${err?.stderr || ''}`.toLowerCase();
    return (
        combined.includes('unknown file format') &&
        combined.includes('input file must have')
    );
}

/**
 * Detect Orca process/machine profile compatibility errors.
 * @param {{message?: string, stderr?: string}} err Command error payload.
 * @returns {boolean} True when incompatible preset combination is reported.
 */
function isOrcaPresetCompatibilityError(err) {
    const combined = `${err?.message || ''}\n${err?.stderr || ''}`.toLowerCase();
    return combined.includes('process not compatible with printer');
}

/**
 * Convert processing exceptions into stable API error responses.
 * @param {Error & {stderr?: string, killed?: boolean}} err Processing error.
 * @param {import('express').Response} res Express response.
 * @param {string[]} filesCleanupList Temporary files scheduled for cleanup.
 * @param {string} inputFile Uploaded input path.
 * @param {() => string} getSupportedInputExtensionsText Supported extension formatter callback.
 * @returns {import('express').Response} Serialized error response.
 */
function handleProcessingError(err, res, filesCleanupList, inputFile, getSupportedInputExtensionsText) {
    console.error('[CRITICAL ERROR]', err.message);
    cleanupFiles(filesCleanupList);

    if (isProcessingTimeoutError(err)) {
        return res.status(422).json({
            success: false,
            error: `Processing exceeded ${DEFAULTS.SLICE_TIMEOUT_MINUTES} minutes. The uploaded file may be too complex or invalid for automatic slicing. Please simplify or correct the file and try again.`,
            errorCode: 'FILE_PROCESSING_TIMEOUT'
        });
    }

    if (isSourceGeometryError(err)) {
        return res.status(400).json({
            success: false,
            error: 'Uploaded model/image/vector contains invalid or non-printable source data. Automatic repair is disabled to preserve exact model fidelity. Please upload a corrected source file.',
            errorCode: 'INVALID_SOURCE_GEOMETRY'
        });
    }

    if (isZipInputError(err)) {
        return res.status(400).json({
            success: false,
            error: 'Uploaded ZIP file is invalid or does not contain a supported model/image/vector file.',
            errorCode: 'INVALID_SOURCE_ARCHIVE'
        });
    }

    if (isUnsupportedInputFormatError(err)) {
        return res.status(400).json({
            success: false,
            error: `Unsupported file format. Supported file extensions: ${getSupportedInputExtensionsText()}`,
            errorCode: 'UNSUPPORTED_FILE_FORMAT'
        });
    }

    if (isOrcaPresetCompatibilityError(err)) {
        return res.status(422).json({
            success: false,
            error: 'Orca profile preset combination is incompatible. Please check machine/process profile pairing.',
            errorCode: 'ORCA_PROFILE_INCOMPATIBLE'
        });
    }

    try {
        logError({
            message: err.message,
            stderr: err.stderr,
            stack: err.stack,
            path: inputFile
        });
    } catch (error_) {
        console.error(`[LOGGER ERROR] ${error_.message}`);
    }

    return res.status(500).json({
        success: false,
        error: 'Slicing failed. The error has been logged for review.',
        errorCode: 'INTERNAL_PROCESSING_ERROR'
    });
}

module.exports = {
    handleProcessingError
};
