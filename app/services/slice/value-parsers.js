/**
 * Shared value parser helpers for slicing request and profile metadata handling.
 */

const path = require('node:path');

/**
 * Convert primitive values to trimmed string safely.
 * @param {unknown} raw Raw value.
 * @returns {string | null} Trimmed primitive string or null for non-primitive values.
 */
function toTrimmedPrimitiveString(raw) {
    if (typeof raw === 'string') return raw.trim();
    if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') {
        return String(raw).trim();
    }

    return null;
}

/**
 * Return first existing and non-empty value from candidate keys.
 * @param {Record<string, unknown> | undefined | null} source Source object.
 * @param {string[]} keys Candidate key names in priority order.
 * @returns {unknown} First non-empty value or undefined.
 */
function pickFirstNonEmptyValue(source, keys) {
    const input = source || {};

    for (const key of keys) {
        if (!Object.hasOwn(input, key)) continue;
        const value = input[key];
        if (value === undefined || value === null) continue;
        if (typeof value === 'string' && value.trim() === '') continue;
        return value;
    }

    return undefined;
}

/**
 * Parse loose numeric input with comma/dot decimal normalization.
 * @param {unknown} raw Raw input value.
 * @returns {number | null} Parsed number, `null` when empty, `NaN` when invalid.
 */
function parseNumberLike(raw) {
    if (raw === undefined || raw === null) return null;

    const normalizedRaw = toTrimmedPrimitiveString(raw);
    if (normalizedRaw === null) return Number.NaN;

    const normalized = normalizedRaw.replace(',', '.');
    if (!normalized) return null;

    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed)) return Number.NaN;
    return parsed;
}

/**
 * Parse optional positive numeric field from source object.
 * @param {Record<string, unknown>} source Source object.
 * @param {string[]} keys Candidate keys.
 * @param {string} fieldLabel Field label used in validation message.
 * @returns {{provided: boolean, value: number | null, error?: string}} Parse result payload.
 */
function parseOptionalPositiveField(source, keys, fieldLabel) {
    const raw = pickFirstNonEmptyValue(source, keys);
    if (raw === undefined) {
        return { provided: false, value: null };
    }

    const value = parseNumberLike(raw);
    if (!Number.isFinite(value) || value <= 0) {
        return {
            provided: true,
            value: null,
            error: `${fieldLabel} must be a positive number.`
        };
    }

    return { provided: true, value };
}

/**
 * Parse optional finite numeric field from source object.
 * @param {Record<string, unknown>} source Source object.
 * @param {string[]} keys Candidate keys.
 * @param {string} fieldLabel Field label used in validation message.
 * @returns {{provided: boolean, value: number | null, error?: string}} Parse result payload.
 */
function parseOptionalFiniteField(source, keys, fieldLabel) {
    const raw = pickFirstNonEmptyValue(source, keys);
    if (raw === undefined) {
        return { provided: false, value: null };
    }

    const value = parseNumberLike(raw);
    if (!Number.isFinite(value)) {
        return {
            provided: true,
            value: null,
            error: `${fieldLabel} must be a finite number.`
        };
    }

    return { provided: true, value };
}

/**
 * Parse flexible boolean-like values (`true/false`, `1/0`, `yes/no`, ...).
 * @param {unknown} raw Raw value.
 * @returns {boolean | null} Parsed boolean or null when invalid.
 */
function parseBooleanLike(raw) {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') {
        if (raw === 1) return true;
        if (raw === 0) return false;
        return null;
    }

    const normalizedRaw = toTrimmedPrimitiveString(raw);
    if (!normalizedRaw) return null;

    const normalized = normalizedRaw.toLowerCase();
    if (!normalized) return null;
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
    return null;
}

/**
 * Normalize accepted size unit aliases.
 * @param {unknown} rawUnit Raw unit value.
 * @returns {{isValid: true, value: 'mm'|'inch'} | {isValid: false, error: string}} Normalized unit result.
 */
function normalizeSizeUnit(rawUnit) {
    if (rawUnit === undefined || rawUnit === null) {
        return { isValid: true, value: 'mm' };
    }

    const normalizedRawUnit = toTrimmedPrimitiveString(rawUnit);
    if (normalizedRawUnit === null) {
        return {
            isValid: false,
            error: 'Invalid size unit. Allowed values: mm, inch.'
        };
    }

    if (!normalizedRawUnit) return { isValid: true, value: 'mm' };

    const unit = normalizedRawUnit.toLowerCase();
    if (['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'].includes(unit)) {
        return { isValid: true, value: 'mm' };
    }
    if (['inch', 'inches', 'in'].includes(unit)) {
        return { isValid: true, value: 'inch' };
    }

    return {
        isValid: false,
        error: 'Invalid size unit. Allowed values: mm, inch.'
    };
}

/**
 * Convert unit value to millimeters.
 * @param {number} value Numeric value in input unit.
 * @param {'mm'|'inch'} unit Input unit.
 * @returns {number} Value converted to millimeters.
 */
function toMillimeters(value, unit) {
    return unit === 'inch' ? value * 25.4 : value;
}

/**
 * Convert optional XYZ dimension object into millimeters.
 * @param {{x: number | null, y: number | null, z: number | null}} rawDimensions Raw dimension values.
 * @param {'mm'|'inch'} unit Input unit for raw dimensions.
 * @returns {{x: number | null, y: number | null, z: number | null}} Millimeter-normalized dimensions.
 */
function normalizeAxisDimensions(rawDimensions, unit) {
    return {
        x: rawDimensions.x === null ? null : toMillimeters(rawDimensions.x, unit),
        y: rawDimensions.y === null ? null : toMillimeters(rawDimensions.y, unit),
        z: rawDimensions.z === null ? null : toMillimeters(rawDimensions.z, unit)
    };
}

/**
 * Validate and sanitize profile file name.
 * @param {unknown} rawValue Raw profile file name.
 * @param {string} expectedExtension Required extension (e.g. `.ini`, `.json`).
 * @returns {{provided: boolean, value: string | null, error?: string}} Sanitization result.
 */
function sanitizeProfileFileName(rawValue, expectedExtension) {
    if (rawValue === undefined || rawValue === null) {
        return { provided: false, value: null };
    }

    const trimmed = toTrimmedPrimitiveString(rawValue);
    if (trimmed === null) {
        return {
            provided: true,
            value: null,
            error: 'Profile filename must be a string.'
        };
    }

    if (!trimmed) {
        return { provided: false, value: null };
    }

    const baseName = path.basename(trimmed);
    if (baseName !== trimmed) {
        return {
            provided: true,
            value: null,
            error: 'Profile filename must not contain path separators.'
        };
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(baseName)) {
        return {
            provided: true,
            value: null,
            error: 'Profile filename contains unsupported characters.'
        };
    }

    const extension = path.extname(baseName).toLowerCase();
    if (extension !== expectedExtension.toLowerCase()) {
        return {
            provided: true,
            value: null,
            error: `Profile filename must end with ${expectedExtension}.`
        };
    }

    return { provided: true, value: baseName };
}

module.exports = {
    pickFirstNonEmptyValue,
    parseNumberLike,
    parseOptionalPositiveField,
    parseOptionalFiniteField,
    parseBooleanLike,
    normalizeSizeUnit,
    normalizeAxisDimensions,
    sanitizeProfileFileName
};
