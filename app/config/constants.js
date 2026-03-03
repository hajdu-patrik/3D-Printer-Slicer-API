/**
 * Shared runtime constants for slicing limits, supported extensions, and API port.
 */

/**
 * Shared numeric/string defaults for environment-backed runtime behavior.
 */
const DEFAULTS = {
    PORT: 3000,
    JSON_BODY_LIMIT: '1mb',
    FORM_BODY_LIMIT: '1mb',
    MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
    MAX_LOG_OUTPUT: 4000,
    SLICE_COMMAND_TIMEOUT_MS: 600000,
    SLICE_TIMEOUT_MINUTES: 10,
    SLICE_RATE_LIMIT_WINDOW_MS: 60_000,
    SLICE_RATE_LIMIT_MAX_REQUESTS: 3,
    MAX_SLICE_QUEUE_LENGTH: 100,
    MAX_SLICE_QUEUE_WAIT_MS: 300000,
    MAX_CONCURRENT_SLICES: 1,
    DEFAULT_LAYER_HEIGHT: 0.2,
    DEFAULT_INFIL_PERCENT: 20,
    DEFAULT_RELIEF_DEPTH_MM: 2,
    DEFAULT_FDM_MATERIAL: 'PLA',
    DEFAULT_SLA_MATERIAL: 'Standard',
    SLA_MIN_LAYER_HEIGHT_MM: 0.025,
    SLA_BASE_TIME_SECONDS: 120,
    SLA_SECONDS_PER_LAYER: 11,
    ORCA_DEFAULT_MACHINE_PROFILE: 'Bambu_P1S_0.4_nozzle.json'
};

/**
 * Layer-height presets by engine/technology.
 */
const LAYER_HEIGHTS = {
    PRUSA: [0.025, 0.05, 0.1, 0.2, 0.3],
    ORCA: [0.1, 0.2, 0.3],
    BY_TECHNOLOGY: {
        SLA: [0.025, 0.05],
        FDM: [0.1, 0.2, 0.3]
    }
};

/**
 * Orca default process-profile mapping by layer height.
 * Keys are normalized to one decimal place.
 */
const ORCA_PROCESS_PROFILE_BY_LAYER = {
    '0.1': 'FDM_0.1mm.json',
    '0.2': 'FDM_0.2mm.json',
    '0.3': 'FDM_0.3mm.json'
};

/**
 * Default fallback pricing matrix in HUF/hour.
 * @type {{FDM: Record<string, number>, SLA: Record<string, number>}}
 */
const DEFAULT_PRICING = {
    FDM: { PLA: 800, ABS: 800, PETG: 900, TPU: 900 },
    SLA: { Standard: 1800, 'ABS-Like': 1800, Flexible: 2400 }
};

/**
 * Maximum printable build volumes in millimeters by technology.
 * @type {{FDM: {x: number, y: number, z: number}, SLA: {x: number, y: number, z: number}}}
 */
const MAX_BUILD_VOLUMES = {
    FDM: { x: 250, y: 210, z: 210 },
    SLA: { x: 120, y: 120, z: 150 }
};

/**
 * Accepted file extensions grouped by processing pipeline.
 * @type {{direct: string[], cad: string[], image: string[], vector: string[], archive: string[]}}
 */
const EXTENSIONS = {
    direct: ['.stl', '.obj', '.3mf'],
    cad: ['.stp', '.step', '.igs', '.iges', '.ply'],
    image: ['.png', '.jpg', '.jpeg', '.bmp'],
    vector: ['.dxf', '.svg', '.eps', '.pdf'],
    archive: ['.zip']
};

/**
 * HTTP port used by the Express API.
 * @type {number}
 */
const PORT = DEFAULTS.PORT;

module.exports = {
    DEFAULTS,
    LAYER_HEIGHTS,
    ORCA_PROCESS_PROFILE_BY_LAYER,
    DEFAULT_PRICING,
    MAX_BUILD_VOLUMES,
    EXTENSIONS,
    PORT
};