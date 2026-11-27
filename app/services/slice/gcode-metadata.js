/**
 * G-code metadata parsing (print time, filament usage) from bounded head/tail chunks.
 */

const fs = require('node:fs');

const CHUNK_BYTES = 256 * 1024;

/**
 * Parse duration string (e.g. `1d 2h 3m 4s`) into total seconds.
 * Unit tokens must be a standalone letter so `ms` is never read as minutes.
 * @param {string} timeStr Human-readable duration text.
 * @returns {number} Duration in seconds.
 */
function parseTimeString(timeStr) {
    const text = String(timeStr || '').trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number.parseFloat(text));

    const multipliers = { d: 86400, h: 3600, m: 60, s: 1 };
    const tokenRegex = /(\d+(?:\.\d+)?)\s*([dhms])(?![a-z])/gi;
    let seconds = 0;
    let match = tokenRegex.exec(text);
    while (match) {
        seconds += Number.parseFloat(match[1]) * multipliers[match[2].toLowerCase()];
        match = tokenRegex.exec(text);
    }

    return Math.round(seconds);
}

/**
 * Read first and last CHUNK_BYTES of a file without loading it entirely.
 * Partial lines at artificial chunk boundaries are dropped.
 * @param {string} filePath File path.
 * @returns {Promise<string>} Concatenated head and tail text.
 */
async function readHeadAndTail(filePath) {
    const handle = await fs.promises.open(filePath, 'r');
    try {
        const { size } = await handle.stat();

        if (size <= CHUNK_BYTES * 2) {
            const buffer = Buffer.alloc(size);
            const { bytesRead } = await handle.read(buffer, 0, size, 0);
            return buffer.toString('utf8', 0, bytesRead);
        }

        const headBuffer = Buffer.alloc(CHUNK_BYTES);
        const tailBuffer = Buffer.alloc(CHUNK_BYTES);
        const headRead = await handle.read(headBuffer, 0, CHUNK_BYTES, 0);
        const tailRead = await handle.read(tailBuffer, 0, CHUNK_BYTES, size - CHUNK_BYTES);

        let head = headBuffer.toString('utf8', 0, headRead.bytesRead);
        let tail = tailBuffer.toString('utf8', 0, tailRead.bytesRead);

        const lastNewline = head.lastIndexOf('\n');
        if (lastNewline >= 0) head = head.slice(0, lastNewline + 1);
        const firstNewline = tail.indexOf('\n');
        if (firstNewline >= 0) tail = tail.slice(firstNewline + 1);

        return `${head}\n${tail}`;
    } finally {
        await handle.close();
    }
}

/**
 * Extract print time, preferring seconds-accurate comments over M73 minutes.
 * @param {string} content G-code head/tail text.
 * @returns {{seconds: number, found: boolean}} Parsed print time.
 */
function extractPrintTimeSeconds(content) {
    const secondPatterns = [
        /;\s*estimated printing time\s*\(normal mode\)\s*=\s*([^\r\n;]+)/i,
        /;\s*total estimated time\s*[:=]\s*([^\r\n;]+)/i,
        /;\s*model printing time\s*[:=]\s*([^\r\n;]+)/i,
        /;\s*estimated printing time(?:\s*\([^)]*\))?\s*=\s*([^\r\n;]+)/i,
        /;\s*print(?:ing)?_?time(?:_seconds)?\s*[:=]\s*([^\r\n;]+)/i,
        /;\s*TIME\s*:\s*(\d+)/i,
        /;\s*PRINT_TIME\s*[:=]\s*(\d+)/i
    ];

    for (const pattern of secondPatterns) {
        const match = pattern.exec(content);
        if (!match) continue;
        const seconds = parseTimeString(match[1]);
        if (seconds > 0) return { seconds, found: true };
    }

    const m73 = /M73 P0 R(\d+)/i.exec(content);
    if (m73) {
        const seconds = Number.parseInt(m73[1], 10) * 60;
        if (seconds > 0) return { seconds, found: true };
    }

    return { seconds: 0, found: false };
}

/**
 * Sum a possibly comma-separated numeric list (multi-extruder values).
 * @param {string} raw Raw value text.
 * @returns {number} Sum of numbers, 0 when none.
 */
function sumNumberList(raw) {
    return String(raw || '')
        .split(',')
        .map((part) => Number.parseFloat(part))
        .filter((n) => Number.isFinite(n))
        .reduce((a, b) => a + b, 0);
}

/**
 * Find the first positive value for the given patterns.
 * @param {string} content Text to search.
 * @param {Array<{regex: RegExp, multiplier: number}>} patterns Candidate patterns.
 * @returns {number} Scaled value or 0.
 */
function firstPositive(content, patterns) {
    for (const { regex, multiplier } of patterns) {
        const match = regex.exec(content);
        if (!match) continue;
        const value = sumNumberList(match[1]) * multiplier;
        if (value > 0) return value;
    }
    return 0;
}

/**
 * Extract filament usage (meters, grams, cm3) from G-code comments.
 * @param {string} content G-code head/tail text.
 * @returns {{material_used_m: number, material_used_g: number, material_used_ml: number}} Usage values.
 */
function extractMaterialUsage(content) {
    const num = '([0-9.,\\s]+?)\\s*(?:\\r?\\n|$)';
    return {
        material_used_m: firstPositive(content, [
            { regex: new RegExp(`;\\s*filament used \\[mm\\]\\s*=\\s*${num}`, 'im'), multiplier: 1 / 1000 },
            { regex: new RegExp(`;\\s*total filament used \\[mm\\]\\s*[:=]\\s*${num}`, 'im'), multiplier: 1 / 1000 },
            { regex: new RegExp(`;\\s*total filament length \\[mm\\]\\s*[:=]\\s*${num}`, 'im'), multiplier: 1 / 1000 },
            { regex: new RegExp(`;\\s*filament used \\[m\\]\\s*[:=]\\s*${num}`, 'im'), multiplier: 1 },
            { regex: new RegExp(`;\\s*material_used_m\\s*[:=]\\s*${num}`, 'im'), multiplier: 1 }
        ]),
        material_used_g: firstPositive(content, [
            { regex: new RegExp(`;\\s*filament used \\[g\\]\\s*=\\s*${num}`, 'im'), multiplier: 1 },
            { regex: new RegExp(`;\\s*total filament weight \\[g\\]\\s*[:=]\\s*${num}`, 'im'), multiplier: 1 },
            { regex: new RegExp(`;\\s*total filament used \\[g\\]\\s*[:=]\\s*${num}`, 'im'), multiplier: 1 }
        ]),
        material_used_ml: firstPositive(content, [
            { regex: new RegExp(`;\\s*filament used \\[cm3\\]\\s*=\\s*${num}`, 'im'), multiplier: 1 },
            { regex: new RegExp(`;\\s*total filament volume \\[cm\\^?3\\]\\s*[:=]\\s*${num}`, 'im'), multiplier: 1 }
        ])
    };
}

/**
 * Read bounded head/tail chunks of a G-code file and parse metadata.
 * @param {string} filePath G-code path.
 * @returns {Promise<{print_time_seconds: number, material_used_m: number, material_used_g: number, material_used_ml: number}>} Metadata.
 */
async function readGcodeMetadata(filePath) {
    const content = await readHeadAndTail(filePath);
    const time = extractPrintTimeSeconds(content);
    return {
        print_time_seconds: time.seconds,
        ...extractMaterialUsage(content)
    };
}

module.exports = {
    parseTimeString,
    extractPrintTimeSeconds,
    extractMaterialUsage,
    readGcodeMetadata
};
